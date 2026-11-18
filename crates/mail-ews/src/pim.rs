//! Calendars and contacts on Exchange Server via EWS.
//!
//! Events are read with `FindItem` + `CalendarView`, which expands
//! recurring series on the server. Tasks are not offered for EWS.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use ondura_mail_core::model::Address;
use ondura_mail_core::xml::{Node, escape};
use ondura_mail_core::{Error, Result};
use ondura_pim_core::provider::*;
use ondura_pim_core::*;

use crate::EwsProvider;

const EVENT_PROPS: &str = r#"<t:AdditionalProperties>
<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="calendar:Start"/><t:FieldURI FieldURI="calendar:End"/>
<t:FieldURI FieldURI="calendar:IsAllDayEvent"/><t:FieldURI FieldURI="calendar:Location"/><t:FieldURI FieldURI="calendar:CalendarItemType"/>
<t:FieldURI FieldURI="item:ReminderIsSet"/><t:FieldURI FieldURI="item:ReminderMinutesBeforeStart"/><t:FieldURI FieldURI="calendar:LegacyFreeBusyStatus"/>
<t:FieldURI FieldURI="calendar:Organizer"/><t:FieldURI FieldURI="calendar:MyResponseType"/><t:FieldURI FieldURI="calendar:IsCancelled"/><t:FieldURI FieldURI="item:Preview"/>
</t:AdditionalProperties>"#;

fn fmt(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn parse_utc(s: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s?).ok().map(|d| d.with_timezone(&Utc))
}

/// All-day events are stored by Exchange as local midnights; Ondura uses
/// UTC midnights of the date.
fn local_date(t: DateTime<Utc>) -> NaiveDate {
    match ical::local_zone() {
        Some(tz) => t.with_timezone(&tz).date_naive(),
        None => t.with_timezone(&chrono::Local).date_naive(),
    }
}

fn local_midnight(d: NaiveDate) -> DateTime<Utc> {
    let naive = d.and_hms_opt(0, 0, 0).expect("midnight");
    match ical::local_zone() {
        Some(tz) => tz.from_local_datetime(&naive).earliest().map(|x| x.with_timezone(&Utc)),
        None => chrono::Local.from_local_datetime(&naive).earliest().map(|x| x.with_timezone(&Utc)),
    }
    .unwrap_or_else(|| naive.and_utc())
}

fn event_from_item(item: &Node) -> Option<Event> {
    let id = item.child("ItemId")?.attr("Id")?.to_string();
    let all_day = item.text_of("IsAllDayEvent") == Some("true");
    let mut start = parse_utc(item.text_of("Start"))?;
    let mut end = parse_utc(item.text_of("End")).unwrap_or(start);
    if all_day {
        start = local_date(start).and_hms_opt(0, 0, 0)?.and_utc();
        end = local_date(end).and_hms_opt(0, 0, 0)?.and_utc().max(start + chrono::Duration::days(1));
    }
    let kind = item.text_of("CalendarItemType").unwrap_or("Single");
    let recurring = matches!(kind, "Occurrence" | "Exception");
    Some(Event {
        id: String::new(),
        collection_id: String::new(),
        account_id: String::new(),
        remote_id: id.clone(),
        resource_id: id.clone(),
        series_id: recurring.then(|| id.clone()),
        title: item.text_of("Subject").unwrap_or_default().to_string(),
        location: item.text_of("Location").unwrap_or_default().to_string(),
        body: item.text_of("Preview").unwrap_or_default().to_string(),
        start,
        end,
        all_day,
        is_recurring: recurring,
        recurrence: None,
        rrule: None,
        reminder_minutes: (item.text_of("ReminderIsSet") == Some("true"))
            .then(|| item.text_of("ReminderMinutesBeforeStart").and_then(|m| m.parse().ok()))
            .flatten(),
        show_as: match item.text_of("LegacyFreeBusyStatus") {
            Some("Free") => ShowAs::Free,
            Some("Tentative") => ShowAs::Tentative,
            Some("OOF") => ShowAs::OutOfOffice,
            _ => ShowAs::Busy,
        },
        organizer: item.child("Organizer").and_then(|o| o.find("Mailbox")).map(|m| {
            Address::new(m.text_of("Name").map(str::to_string), m.text_of("EmailAddress").unwrap_or_default())
        }),
        attendees: vec![],
        is_cancelled: item.text_of("IsCancelled") == Some("true"),
        online_meeting_url: None,
        my_response: match item.text_of("MyResponseType") {
            Some("Organizer") => Some("organizer".into()),
            Some("Accept") => Some("accepted".into()),
            Some("Tentative") => Some("tentative".into()),
            Some("Decline") => Some("declined".into()),
            Some("NoResponseReceived") => Some("needsAction".into()),
            _ => None,
        },
        etag: None,
        raw: None,
    })
}

const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EWS_DAYS: [(&str, &str); 7] = [("MO", "Monday"), ("TU", "Tuesday"), ("WE", "Wednesday"), ("TH", "Thursday"), ("FR", "Friday"), ("SA", "Saturday"), ("SU", "Sunday")];

fn recurrence_xml(r: &Recurrence, start: DateTime<Utc>) -> String {
    use chrono::Datelike;
    let pattern = match r.freq {
        Freq::Daily => format!("<t:DailyRecurrence><t:Interval>{}</t:Interval></t:DailyRecurrence>", r.interval),
        Freq::Weekly => {
            let days: Vec<&str> = if r.by_day.is_empty() {
                vec![EWS_DAYS[start.weekday().num_days_from_monday() as usize].1]
            } else {
                r.by_day.iter().filter_map(|d| EWS_DAYS.iter().find(|(i, _)| i == d).map(|(_, e)| *e)).collect()
            };
            format!("<t:WeeklyRecurrence><t:Interval>{}</t:Interval><t:DaysOfWeek>{}</t:DaysOfWeek></t:WeeklyRecurrence>", r.interval, days.join(" "))
        }
        Freq::Monthly => format!("<t:AbsoluteMonthlyRecurrence><t:Interval>{}</t:Interval><t:DayOfMonth>{}</t:DayOfMonth></t:AbsoluteMonthlyRecurrence>", r.interval, start.day()),
        Freq::Yearly => format!("<t:AbsoluteYearlyRecurrence><t:DayOfMonth>{}</t:DayOfMonth><t:Month>{}</t:Month></t:AbsoluteYearlyRecurrence>", start.day(), MONTHS[start.month0() as usize]),
    };
    let sd = local_date(start).format("%Y-%m-%d");
    let range = match (r.count, r.until) {
        (Some(n), _) => format!("<t:NumberedRecurrence><t:StartDate>{sd}</t:StartDate><t:NumberOfOccurrences>{n}</t:NumberOfOccurrences></t:NumberedRecurrence>"),
        (None, Some(u)) => format!("<t:EndDateRecurrence><t:StartDate>{sd}</t:StartDate><t:EndDate>{}</t:EndDate></t:EndDateRecurrence>", u.format("%Y-%m-%d")),
        _ => format!("<t:NoEndRecurrence><t:StartDate>{sd}</t:StartDate></t:NoEndRecurrence>"),
    };
    format!("<t:Recurrence>{pattern}{range}</t:Recurrence>")
}

fn free_busy(s: ShowAs) -> &'static str {
    match s {
        ShowAs::Free => "Free",
        ShowAs::Tentative => "Tentative",
        ShowAs::OutOfOffice => "OOF",
        ShowAs::Busy => "Busy",
    }
}

fn attendees_xml(list: &[Address]) -> String {
    let inner: String = list
        .iter()
        .map(|a| format!("<t:Attendee><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:Attendee>", escape(&a.email)))
        .collect();
    format!("<t:RequiredAttendees>{inner}</t:RequiredAttendees>")
}

fn times(input: &EventInput, start: DateTime<Utc>, end: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    if input.all_day {
        (local_midnight(start.date_naive()), local_midnight(end.date_naive()))
    } else {
        (start, end)
    }
}

fn invitations(input: &EventInput) -> &'static str {
    if input.attendees.is_empty() { "SendToNone" } else { "SendToAllAndSaveCopy" }
}

fn set_field(uri: &str, element: &str, inner: &str) -> String {
    format!(r#"<t:SetItemField><t:FieldURI FieldURI="{uri}"/><t:CalendarItem>{}</t:CalendarItem></t:SetItemField>"#, wrap(element, inner))
}

fn wrap(element: &str, inner: &str) -> String {
    format!("<t:{element}>{inner}</t:{element}>")
}

// ---------------------------------------------------------------- contacts

const EMAIL_KEYS: [&str; 3] = ["EmailAddress1", "EmailAddress2", "EmailAddress3"];
const PHONE_KEYS: [(&str, &str); 3] = [("BusinessPhone", "work"), ("MobilePhone", "mobile"), ("HomePhone", "home")];
const ADDRESS_KEYS: [(&str, &str); 2] = [("Business", "work"), ("Home", "home")];

fn contact_from_item(c: &Node) -> Option<Contact> {
    let id = c.child("ItemId")?.attr("Id")?.to_string();
    let entries = |list: &str| -> Vec<&Node> { c.child(list).map(|l| l.children_named("Entry").collect()).unwrap_or_default() };
    Some(Contact {
        remote_id: id,
        display_name: c.text_of("DisplayName").unwrap_or_default().to_string(),
        given_name: c.text_of("GivenName").unwrap_or_default().to_string(),
        family_name: c.text_of("Surname").unwrap_or_default().to_string(),
        company: c.text_of("CompanyName").unwrap_or_default().to_string(),
        job_title: c.text_of("JobTitle").unwrap_or_default().to_string(),
        emails: entries("EmailAddresses")
            .into_iter()
            .filter(|e| !e.text.is_empty())
            .map(|e| Labeled { label: "other".into(), value: e.text.trim_start_matches("SMTP:").to_string() })
            .collect(),
        phones: entries("PhoneNumbers")
            .into_iter()
            .filter(|e| !e.text.is_empty())
            .map(|e| Labeled {
                label: PHONE_KEYS.iter().find(|(k, _)| Some(*k) == e.attr("Key")).map(|(_, l)| l.to_string()).unwrap_or_else(|| "other".into()),
                value: e.text.clone(),
            })
            .collect(),
        addresses: entries("PhysicalAddresses")
            .into_iter()
            .map(|e| PostalAddress {
                label: ADDRESS_KEYS.iter().find(|(k, _)| Some(*k) == e.attr("Key")).map(|(_, l)| l.to_string()).unwrap_or_else(|| "other".into()),
                street: e.text_of("Street").unwrap_or_default().to_string(),
                city: e.text_of("City").unwrap_or_default().to_string(),
                postal_code: e.text_of("PostalCode").unwrap_or_default().to_string(),
                country: e.text_of("CountryOrRegion").unwrap_or_default().to_string(),
            })
            .collect(),
        birthday: parse_utc(c.text_of("Birthday")).map(|d| d.date_naive()),
        notes: c.child("Body").map(|b| b.text.clone()).unwrap_or_default(),
        ..Default::default()
    })
}

fn opt(element: &str, value: &str) -> String {
    if value.is_empty() { String::new() } else { wrap(element, &escape(value)) }
}

fn contact_create_xml(c: &Contact) -> String {
    let emails: String = c.emails.iter().zip(EMAIL_KEYS).map(|(e, k)| format!(r#"<t:Entry Key="{k}">{}</t:Entry>"#, escape(&e.value))).collect();
    let addresses: String = ADDRESS_KEYS
        .iter()
        .filter_map(|(k, label)| c.addresses.iter().find(|a| a.label == *label).map(|a| (k, a)))
        .map(|(k, a)| {
            format!(
                r#"<t:Entry Key="{k}">{}{}{}{}</t:Entry>"#,
                opt("Street", &a.street),
                opt("City", &a.city),
                opt("CountryOrRegion", &a.country),
                opt("PostalCode", &a.postal_code)
            )
        })
        .collect();
    let phones: String = PHONE_KEYS
        .iter()
        .filter_map(|(k, label)| c.phones.iter().find(|p| p.label == *label).map(|p| format!(r#"<t:Entry Key="{k}">{}</t:Entry>"#, escape(&p.value))))
        .collect();
    format!(
        "<t:Contact>{body}{fileas}{display}{given}{company}{emails}{addresses}{phones}{birthday}{job}{surname}</t:Contact>",
        body = if c.notes.is_empty() { String::new() } else { format!(r#"<t:Body BodyType="Text">{}</t:Body>"#, escape(&c.notes)) },
        fileas = wrap("FileAs", &escape(&c.effective_name())),
        display = wrap("DisplayName", &escape(&c.effective_name())),
        given = opt("GivenName", &c.given_name),
        company = opt("CompanyName", &c.company),
        emails = if emails.is_empty() { String::new() } else { wrap("EmailAddresses", &emails) },
        addresses = if addresses.is_empty() { String::new() } else { wrap("PhysicalAddresses", &addresses) },
        phones = if phones.is_empty() { String::new() } else { wrap("PhoneNumbers", &phones) },
        birthday = c.birthday.map(|b| wrap("Birthday", &format!("{}T11:59:00Z", b.format("%Y-%m-%d")))).unwrap_or_default(),
        job = opt("JobTitle", &c.job_title),
        surname = opt("Surname", &c.family_name),
    )
}

fn contact_update_xml(c: &Contact) -> String {
    let mut u = String::new();
    let simple = |u: &mut String, uri: &str, element: &str, value: &str| {
        if value.is_empty() {
            u.push_str(&format!(r#"<t:DeleteItemField><t:FieldURI FieldURI="{uri}"/></t:DeleteItemField>"#));
        } else {
            u.push_str(&format!(r#"<t:SetItemField><t:FieldURI FieldURI="{uri}"/><t:Contact>{}</t:Contact></t:SetItemField>"#, wrap(element, &escape(value))));
        }
    };
    simple(&mut u, "contacts:DisplayName", "DisplayName", &c.effective_name());
    simple(&mut u, "contacts:GivenName", "GivenName", &c.given_name);
    simple(&mut u, "contacts:Surname", "Surname", &c.family_name);
    simple(&mut u, "contacts:CompanyName", "CompanyName", &c.company);
    simple(&mut u, "contacts:JobTitle", "JobTitle", &c.job_title);
    u.push_str(&format!(
        r#"<t:SetItemField><t:FieldURI FieldURI="item:Body"/><t:Contact><t:Body BodyType="Text">{}</t:Body></t:Contact></t:SetItemField>"#,
        escape(&c.notes)
    ));
    for (i, key) in EMAIL_KEYS.iter().enumerate() {
        match c.emails.get(i) {
            Some(e) => u.push_str(&format!(
                r#"<t:SetItemField><t:IndexedFieldURI FieldURI="contacts:EmailAddress" FieldIndex="{key}"/><t:Contact><t:EmailAddresses><t:Entry Key="{key}">{}</t:Entry></t:EmailAddresses></t:Contact></t:SetItemField>"#,
                escape(&e.value)
            )),
            None => u.push_str(&format!(r#"<t:DeleteItemField><t:IndexedFieldURI FieldURI="contacts:EmailAddress" FieldIndex="{key}"/></t:DeleteItemField>"#)),
        }
    }
    for (key, label) in PHONE_KEYS {
        match c.phones.iter().find(|p| p.label == label) {
            Some(p) => u.push_str(&format!(
                r#"<t:SetItemField><t:IndexedFieldURI FieldURI="contacts:PhoneNumber" FieldIndex="{key}"/><t:Contact><t:PhoneNumbers><t:Entry Key="{key}">{}</t:Entry></t:PhoneNumbers></t:Contact></t:SetItemField>"#,
                escape(&p.value)
            )),
            None => u.push_str(&format!(r#"<t:DeleteItemField><t:IndexedFieldURI FieldURI="contacts:PhoneNumber" FieldIndex="{key}"/></t:DeleteItemField>"#)),
        }
    }
    u
}

impl EwsProvider {
    async fn folder_ids(&self, distinguished: &[&str]) -> HashMap<String, String> {
        let ids: String = distinguished.iter().map(|n| format!(r#"<t:DistinguishedFolderId Id="{n}"/>"#)).collect();
        let mut out = HashMap::new();
        if let Ok(doc) = self
            .call_lenient(&format!(r#"<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds>{ids}</m:FolderIds></m:GetFolder>"#))
            .await
        {
            let responses = doc.find("ResponseMessages").map(|r| r.children.clone()).unwrap_or_default();
            for (name, resp) in distinguished.iter().zip(responses.iter()) {
                if let Some(id) = resp.find("FolderId").and_then(|f| f.attr("Id")) {
                    out.insert(id.to_string(), name.to_string());
                }
            }
        }
        out
    }

    async fn master_start(&self, occurrence_id: &str) -> Result<DateTime<Utc>> {
        let doc = self
            .call(&format!(
                r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="calendar:Start"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:RecurringMasterItemId OccurrenceId="{}"/></m:ItemIds></m:GetItem>"#,
                escape(occurrence_id)
            ))
            .await?;
        parse_utc(doc.find("Start").map(|s| s.text.as_str())).ok_or_else(|| Error::protocol("Serie ohne Beginn"))
    }
}

#[async_trait]
impl PimProvider for EwsProvider {
    async fn list_collections(&self) -> Result<Vec<RemoteCollection>> {
        let defaults = self.folder_ids(&["calendar", "contacts"]).await;
        let doc = self
            .call(
                r#"<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="folder:FolderClass"/></t:AdditionalProperties></m:FolderShape><m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>"#,
            )
            .await?;
        let mut out = Vec::new();
        for (element, kind, class) in [("CalendarFolder", CollectionKind::Calendar, "IPF.Appointment"), ("ContactsFolder", CollectionKind::Contacts, "IPF.Contact")] {
            let mut folders = Vec::new();
            doc.find_all(element, &mut folders);
            for f in folders {
                if !f.text_of("FolderClass").unwrap_or(class).starts_with(class) {
                    continue;
                }
                let Some(id) = f.child("FolderId").and_then(|i| i.attr("Id")) else { continue };
                out.push(RemoteCollection {
                    remote_id: id.to_string(),
                    kind,
                    name: f.text_of("DisplayName").unwrap_or_default().to_string(),
                    color: None,
                    read_only: false,
                    is_default: defaults.contains_key(id),
                });
            }
        }
        Ok(out)
    }

    async fn sync_events(&self, col: &RemoteCollection, window: Window, _state: Option<&str>, _known: &Known) -> Result<Changes<EventResource>> {
        let doc = self
            .call(&format!(
                r#"<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>{EVENT_PROPS}</m:ItemShape><m:CalendarView MaxEntriesReturned="1000" StartDate="{}" EndDate="{}"/><m:ParentFolderIds><t:FolderId Id="{}"/></m:ParentFolderIds></m:FindItem>"#,
                fmt(window.start),
                fmt(window.end),
                escape(&col.remote_id)
            ))
            .await?;
        let mut items = Vec::new();
        doc.find_all("CalendarItem", &mut items);
        let upserted = items
            .into_iter()
            .filter_map(event_from_item)
            .filter(|e| !e.is_cancelled)
            .map(|e| EventResource { resource_id: e.resource_id.clone(), etag: None, raw: None, events: vec![e] })
            .collect();
        Ok(Changes { upserted, removed: vec![], reset: true, new_state: Some(Utc::now().to_rfc3339()) })
    }

    async fn create_event(&self, col: &RemoteCollection, input: &EventInput) -> Result<()> {
        let (start, end) = times(input, input.start, input.end);
        let body = input.body.as_deref().map(|b| format!(r#"<t:Body BodyType="Text">{}</t:Body>"#, escape(b))).unwrap_or_default();
        let reminder = match input.reminder_minutes {
            Some(m) => format!("<t:ReminderIsSet>true</t:ReminderIsSet><t:ReminderMinutesBeforeStart>{m}</t:ReminderMinutesBeforeStart>"),
            None => "<t:ReminderIsSet>false</t:ReminderIsSet>".into(),
        };
        let attendees = if input.attendees.is_empty() { String::new() } else { attendees_xml(&input.attendees) };
        let recurrence = input.recurrence.as_ref().map(|r| recurrence_xml(r, start)).unwrap_or_default();
        let item = format!(
            "<t:CalendarItem><t:Subject>{}</t:Subject>{body}{reminder}<t:Start>{}</t:Start><t:End>{}</t:End><t:IsAllDayEvent>{}</t:IsAllDayEvent><t:LegacyFreeBusyStatus>{}</t:LegacyFreeBusyStatus><t:Location>{}</t:Location>{attendees}{recurrence}</t:CalendarItem>",
            escape(&input.title),
            fmt(start),
            fmt(end),
            input.all_day,
            free_busy(input.show_as),
            escape(&input.location)
        );
        self.call(&format!(
            r#"<m:CreateItem SendMeetingInvitations="{}"><m:SavedItemFolderId><t:FolderId Id="{}"/></m:SavedItemFolderId><m:Items>{item}</m:Items></m:CreateItem>"#,
            invitations(input),
            escape(&col.remote_id)
        ))
        .await
        .map(|_| ())
    }

    async fn update_event(&self, _col: &RemoteCollection, event: &Event, input: &EventInput, scope: EditScope) -> Result<()> {
        let series = scope == EditScope::Series && event.is_recurring;
        let (start, end) = if series {
            let master = self.master_start(&event.remote_id).await?;
            let s = master + (input.start - event.start);
            (s, s + (input.end - input.start))
        } else {
            (input.start, input.end)
        };
        let (start, end) = times(input, start, end);
        let mut u = String::new();
        u.push_str(&set_field("item:Subject", "Subject", &escape(&input.title)));
        u.push_str(&set_field("calendar:Location", "Location", &escape(&input.location)));
        u.push_str(&set_field("calendar:Start", "Start", &fmt(start)));
        u.push_str(&set_field("calendar:End", "End", &fmt(end)));
        u.push_str(&set_field("calendar:IsAllDayEvent", "IsAllDayEvent", &input.all_day.to_string()));
        u.push_str(&set_field("calendar:LegacyFreeBusyStatus", "LegacyFreeBusyStatus", free_busy(input.show_as)));
        u.push_str(&set_field("item:ReminderIsSet", "ReminderIsSet", &input.reminder_minutes.is_some().to_string()));
        if let Some(m) = input.reminder_minutes {
            u.push_str(&set_field("item:ReminderMinutesBeforeStart", "ReminderMinutesBeforeStart", &m.to_string()));
        }
        if let Some(b) = &input.body {
            u.push_str(&format!(r#"<t:SetItemField><t:FieldURI FieldURI="item:Body"/><t:CalendarItem><t:Body BodyType="Text">{}</t:Body></t:CalendarItem></t:SetItemField>"#, escape(b)));
        }
        if !input.attendees.is_empty() {
            u.push_str(&format!(r#"<t:SetItemField><t:FieldURI FieldURI="calendar:RequiredAttendees"/><t:CalendarItem>{}</t:CalendarItem></t:SetItemField>"#, attendees_xml(&input.attendees)));
        }
        if (series || !event.is_recurring)
            && let Some(r) = &input.recurrence
        {
            u.push_str(&format!(r#"<t:SetItemField><t:FieldURI FieldURI="calendar:Recurrence"/><t:CalendarItem>{}</t:CalendarItem></t:SetItemField>"#, recurrence_xml(r, start)));
        }
        let target = if series {
            format!(r#"<t:RecurringMasterItemId OccurrenceId="{}"/>"#, escape(&event.remote_id))
        } else {
            format!(r#"<t:ItemId Id="{}"/>"#, escape(&event.remote_id))
        };
        self.call(&format!(
            r#"<m:UpdateItem ConflictResolution="AlwaysOverwrite" SendMeetingInvitationsOrCancellations="{}"><m:ItemChanges><t:ItemChange>{target}<t:Updates>{u}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>"#,
            invitations(input)
        ))
        .await
        .map(|_| ())
    }

    async fn respond_event(&self, _col: &RemoteCollection, event: &Event, response: EventResponse) -> Result<()> {
        let element = match response {
            EventResponse::Accept => "AcceptItem",
            EventResponse::Tentative => "TentativelyAcceptItem",
            EventResponse::Decline => "DeclineItem",
        };
        self.call(&format!(
            r#"<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:{element}><t:ReferenceItemId Id="{}"/></t:{element}></m:Items></m:CreateItem>"#,
            escape(&event.remote_id)
        ))
        .await
        .map(|_| ())
    }

    async fn free_busy(&self, emails: &[String], start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Vec<Availability>> {
        // UTC time zone (bias 0) so all times come back in UTC.
        let tz = r#"<t:TimeZone><t:Bias>0</t:Bias><t:StandardTime><t:Bias>0</t:Bias><t:Time>00:00:00</t:Time><t:DayOrder>1</t:DayOrder><t:Month>1</t:Month><t:DayOfWeek>Sunday</t:DayOfWeek></t:StandardTime><t:DaylightTime><t:Bias>0</t:Bias><t:Time>00:00:00</t:Time><t:DayOrder>1</t:DayOrder><t:Month>1</t:Month><t:DayOfWeek>Sunday</t:DayOfWeek></t:DaylightTime></t:TimeZone>"#;
        let mailboxes: String = emails
            .iter()
            .map(|e| format!("<t:MailboxData><t:Email><t:Address>{}</t:Address></t:Email><t:AttendeeType>Required</t:AttendeeType><t:ExcludeConflicts>false</t:ExcludeConflicts></t:MailboxData>", escape(e)))
            .collect();
        let doc = self
            .call_lenient(&format!(
                r#"<m:GetUserAvailabilityRequest>{tz}<m:MailboxDataArray>{mailboxes}</m:MailboxDataArray><t:FreeBusyViewOptions><t:TimeWindow><t:StartTime>{}</t:StartTime><t:EndTime>{}</t:EndTime></t:TimeWindow><t:MergedFreeBusyIntervalInMinutes>30</t:MergedFreeBusyIntervalInMinutes><t:RequestedView>Detailed</t:RequestedView></t:FreeBusyViewOptions></m:GetUserAvailabilityRequest>"#,
                start.format("%Y-%m-%dT%H:%M:%S"),
                end.format("%Y-%m-%dT%H:%M:%S")
            ))
            .await?;
        let mut responses = Vec::new();
        doc.find_all("FreeBusyResponse", &mut responses);
        let local = |s: Option<&str>| {
            chrono::NaiveDateTime::parse_from_str(s?.split('.').next()?, "%Y-%m-%dT%H:%M:%S").ok().map(|t| t.and_utc())
        };
        Ok(emails
            .iter()
            .zip(responses)
            .map(|(email, r)| {
                let ok = r.find("ResponseMessage").and_then(|m| m.attr("ResponseClass")) != Some("Error");
                let mut events = Vec::new();
                r.find_all("CalendarEvent", &mut events);
                Availability {
                    email: email.clone(),
                    known: ok,
                    slots: events
                        .into_iter()
                        .filter_map(|e| {
                            Some(BusySlot {
                                start: local(e.text_of("StartTime"))?,
                                end: local(e.text_of("EndTime"))?,
                                status: match e.text_of("BusyType") {
                                    Some("Tentative") => ShowAs::Tentative,
                                    Some("OOF") => ShowAs::OutOfOffice,
                                    Some("Free") => ShowAs::Free,
                                    _ => ShowAs::Busy,
                                },
                            })
                        })
                        .collect(),
                }
            })
            .collect())
    }

    async fn delete_event(&self, _col: &RemoteCollection, event: &Event, scope: EditScope) -> Result<()> {
        let target = if scope == EditScope::Series && event.is_recurring {
            format!(r#"<t:RecurringMasterItemId OccurrenceId="{}"/>"#, escape(&event.remote_id))
        } else {
            format!(r#"<t:ItemId Id="{}"/>"#, escape(&event.remote_id))
        };
        self.call(&format!(
            r#"<m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="SendToAllAndSaveCopy"><m:ItemIds>{target}</m:ItemIds></m:DeleteItem>"#
        ))
        .await
        .map(|_| ())
    }

    async fn sync_contacts(&self, col: &RemoteCollection, _state: Option<&str>, _known: &Known) -> Result<Changes<Contact>> {
        let doc = self
            .call(&format!(
                r#"<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="2000" Offset="0" BasePoint="Beginning"/><m:ParentFolderIds><t:FolderId Id="{}"/></m:ParentFolderIds></m:FindItem>"#,
                escape(&col.remote_id)
            ))
            .await?;
        let mut ids = Vec::new();
        doc.find_all("ItemId", &mut ids);
        let ids: Vec<String> = ids.iter().filter_map(|i| i.attr("Id").map(str::to_string)).collect();
        let mut upserted = Vec::new();
        for chunk in ids.chunks(100) {
            let item_ids: String = chunk.iter().map(|id| format!(r#"<t:ItemId Id="{}"/>"#, escape(id))).collect();
            let doc = self
                .call_lenient(&format!(
                    r#"<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>Text</t:BodyType></m:ItemShape><m:ItemIds>{item_ids}</m:ItemIds></m:GetItem>"#
                ))
                .await?;
            let mut contacts = Vec::new();
            doc.find_all("Contact", &mut contacts);
            upserted.extend(contacts.into_iter().filter_map(contact_from_item));
        }
        Ok(Changes { upserted, removed: vec![], reset: true, new_state: None })
    }

    async fn save_contact(&self, col: &RemoteCollection, contact: &Contact) -> Result<()> {
        if contact.remote_id.is_empty() {
            self.call(&format!(
                r#"<m:CreateItem><m:SavedItemFolderId><t:FolderId Id="{}"/></m:SavedItemFolderId><m:Items>{}</m:Items></m:CreateItem>"#,
                escape(&col.remote_id),
                contact_create_xml(contact)
            ))
            .await
            .map(|_| ())
        } else {
            self.call(&format!(
                r#"<m:UpdateItem ConflictResolution="AlwaysOverwrite"><m:ItemChanges><t:ItemChange><t:ItemId Id="{}"/><t:Updates>{}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>"#,
                escape(&contact.remote_id),
                contact_update_xml(contact)
            ))
            .await
            .map(|_| ())
        }
    }

    async fn delete_contact(&self, _col: &RemoteCollection, contact: &Contact) -> Result<()> {
        self.call(&format!(
            r#"<m:DeleteItem DeleteType="MoveToDeletedItems"><m:ItemIds><t:ItemId Id="{}"/></m:ItemIds></m:DeleteItem>"#,
            escape(&contact.remote_id)
        ))
        .await
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_calendar_items_and_contacts() {
        let xml = r#"<s:Envelope xmlns:s="s"><s:Body><m:FindItemResponse><m:ResponseMessages><m:FindItemResponseMessage ResponseClass="Success"><m:RootFolder><t:Items>
<t:CalendarItem><t:ItemId Id="OCC"/><t:Subject>Jour fixe</t:Subject><t:Start>2026-11-16T08:00:00Z</t:Start><t:End>2026-11-16T09:00:00Z</t:End>
<t:IsAllDayEvent>false</t:IsAllDayEvent><t:CalendarItemType>Occurrence</t:CalendarItemType><t:ReminderIsSet>true</t:ReminderIsSet>
<t:ReminderMinutesBeforeStart>15</t:ReminderMinutesBeforeStart><t:LegacyFreeBusyStatus>Tentative</t:LegacyFreeBusyStatus><t:Location>Raum 2</t:Location></t:CalendarItem>
</t:Items></m:RootFolder></m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse></s:Body></s:Envelope>"#;
        let doc = Node::parse(xml).unwrap();
        let e = event_from_item(doc.find("CalendarItem").unwrap()).unwrap();
        assert!(e.is_recurring);
        assert_eq!(e.reminder_minutes, Some(15));
        assert_eq!(e.show_as, ShowAs::Tentative);
        assert_eq!(e.location, "Raum 2");

        let contact = r#"<t:Contact><t:ItemId Id="C1"/><t:DisplayName>Max Becker</t:DisplayName><t:GivenName>Max</t:GivenName><t:Surname>Becker</t:Surname>
<t:EmailAddresses><t:Entry Key="EmailAddress1">max@corp.local</t:Entry></t:EmailAddresses>
<t:PhoneNumbers><t:Entry Key="MobilePhone">0170 1</t:Entry><t:Entry Key="BusinessPhone"/></t:PhoneNumbers>
<t:PhysicalAddresses><t:Entry Key="Business"><t:Street>Hauptstr. 1</t:Street><t:City>Homburg</t:City></t:Entry></t:PhysicalAddresses>
<t:Birthday>1990-05-01T11:59:00Z</t:Birthday></t:Contact>"#;
        let c = contact_from_item(&Node::parse(contact).unwrap().children[0]).unwrap();
        assert_eq!(c.emails[0].value, "max@corp.local");
        assert_eq!(c.phones.len(), 1);
        assert_eq!(c.phones[0].label, "mobile");
        assert_eq!(c.addresses[0].city, "Homburg");
        assert_eq!(c.birthday, NaiveDate::from_ymd_opt(1990, 5, 1));

        // Element order matters in EWS: Body first, Surname last.
        let xml = contact_create_xml(&c);
        assert!(xml.find("<t:GivenName>").unwrap() < xml.find("<t:EmailAddresses>").unwrap());
        assert!(xml.find("<t:PhoneNumbers>").unwrap() < xml.find("<t:Surname>").unwrap());
    }

    #[test]
    fn builds_recurrence() {
        let start = DateTime::parse_from_rfc3339("2026-11-16T08:00:00Z").unwrap().with_timezone(&Utc);
        let r = Recurrence { freq: Freq::Weekly, interval: 1, by_day: vec!["MO".into(), "TH".into()], until: None, count: Some(5) };
        let xml = recurrence_xml(&r, start);
        assert!(xml.contains("<t:DaysOfWeek>Monday Thursday</t:DaysOfWeek>"));
        assert!(xml.contains("<t:NumberOfOccurrences>5</t:NumberOfOccurrences>"));
    }
}
