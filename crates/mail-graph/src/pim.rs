//! Calendars, contacts and Microsoft To Do via Microsoft Graph.

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, Utc};
use ondura_mail_core::model::Address;
use ondura_mail_core::{Error, Result};
use ondura_pim_core::provider::*;
use ondura_pim_core::*;
use reqwest::Method;
use serde_json::{Value, json};

use crate::GraphProvider;

const PREFER_UTC_TEXT: &str = "outlook.timezone=\"UTC\", outlook.body-content-type=\"text\"";
const EVENT_SELECT: &str = "subject,body,start,end,isAllDay,location,type,seriesMasterId,reminderMinutesBeforeStart,isReminderOn,showAs,organizer,attendees,isCancelled,onlineMeeting,responseStatus,categories";
const DEFAULT_CONTACTS: &str = "default";
const TODO_PREFIX: &str = "todo:";
/// Remote id prefix of another person's calendar opened by address.
const SHARED_PREFIX: &str = "user:";

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn parse_dt(v: &Value) -> Option<DateTime<Utc>> {
    let raw = v["dateTime"].as_str()?;
    let naive = NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    Some(naive.and_utc())
}

fn graph_dt(t: DateTime<Utc>) -> Value {
    json!({ "dateTime": t.format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone": "UTC" })
}

fn address(v: &Value) -> Option<Address> {
    let email = v["emailAddress"]["address"].as_str()?.to_string();
    Some(Address::new(v["emailAddress"]["name"].as_str().map(str::to_string), email))
}

const DAYS: [(&str, &str); 7] = [
    ("MO", "monday"),
    ("TU", "tuesday"),
    ("WE", "wednesday"),
    ("TH", "thursday"),
    ("FR", "friday"),
    ("SA", "saturday"),
    ("SU", "sunday"),
];

fn recurrence_from_graph(r: &Value) -> Option<Recurrence> {
    let p = &r["pattern"];
    let freq = match p["type"].as_str()? {
        "daily" => Freq::Daily,
        "weekly" => Freq::Weekly,
        "absoluteMonthly" => Freq::Monthly,
        "absoluteYearly" => Freq::Yearly,
        _ => return None, // relative patterns ("2nd Tuesday") are kept untouched
    };
    let by_day = p["daysOfWeek"]
        .as_array()
        .map(|a| a.iter().filter_map(|d| DAYS.iter().find(|(_, g)| Some(*g) == d.as_str()).map(|(i, _)| i.to_string())).collect())
        .unwrap_or_default();
    let range = &r["range"];
    let (until, count) = match range["type"].as_str() {
        Some("endDate") => (range["endDate"].as_str().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()), None),
        Some("numbered") => (None, range["numberOfOccurrences"].as_u64().map(|n| n as u32)),
        _ => (None, None),
    };
    Some(Recurrence { freq, interval: p["interval"].as_u64().unwrap_or(1) as u32, by_day: if freq == Freq::Weekly { by_day } else { vec![] }, until, count })
}

fn recurrence_to_graph(r: &Recurrence, start: DateTime<Utc>) -> Value {
    let weekday = DAYS[start.weekday().num_days_from_monday() as usize].1;
    let pattern = match r.freq {
        Freq::Daily => json!({ "type": "daily", "interval": r.interval }),
        Freq::Weekly => {
            let days: Vec<&str> = if r.by_day.is_empty() {
                vec![weekday]
            } else {
                r.by_day.iter().filter_map(|d| DAYS.iter().find(|(i, _)| i == d).map(|(_, g)| *g)).collect()
            };
            json!({ "type": "weekly", "interval": r.interval, "daysOfWeek": days, "firstDayOfWeek": "monday" })
        }
        Freq::Monthly => json!({ "type": "absoluteMonthly", "interval": r.interval, "dayOfMonth": start.day() }),
        Freq::Yearly => json!({ "type": "absoluteYearly", "interval": r.interval, "dayOfMonth": start.day(), "month": start.month() }),
    };
    let start_date = start.format("%Y-%m-%d").to_string();
    let range = match (r.count, r.until) {
        (Some(n), _) => json!({ "type": "numbered", "startDate": start_date, "numberOfOccurrences": n }),
        (None, Some(u)) => json!({ "type": "endDate", "startDate": start_date, "endDate": u.format("%Y-%m-%d").to_string() }),
        _ => json!({ "type": "noEnd", "startDate": start_date }),
    };
    json!({ "pattern": pattern, "range": range })
}

fn event_from_graph(v: &Value, masters: &HashMap<String, Option<Recurrence>>) -> Option<Event> {
    let id = v["id"].as_str()?.to_string();
    let all_day = v["isAllDay"].as_bool().unwrap_or(false);
    let start = parse_dt(&v["start"])?;
    let end = parse_dt(&v["end"]).unwrap_or(start);
    let series_id = v["seriesMasterId"].as_str().map(str::to_string);
    let recurrence = series_id.as_ref().and_then(|m| masters.get(m).cloned().flatten());
    Some(Event {
        id: String::new(),
        collection_id: String::new(),
        account_id: String::new(),
        remote_id: id.clone(),
        resource_id: id,
        is_recurring: series_id.is_some(),
        series_id,
        title: s(&v["subject"]),
        location: s(&v["location"]["displayName"]),
        body: s(&v["body"]["content"]).trim().to_string(),
        start,
        end,
        all_day,
        rrule: recurrence.as_ref().map(Recurrence::to_rrule),
        recurrence,
        reminder_minutes: if v["isReminderOn"].as_bool().unwrap_or(false) { v["reminderMinutesBeforeStart"].as_i64().map(|m| m as i32) } else { None },
        show_as: match v["showAs"].as_str() {
            Some("free") => ShowAs::Free,
            Some("tentative") => ShowAs::Tentative,
            Some("oof") => ShowAs::OutOfOffice,
            _ => ShowAs::Busy,
        },
        organizer: address(&v["organizer"]),
        attendees: v["attendees"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| {
                        Some(Attendee {
                            address: address(x)?,
                            response: match x["status"]["response"].as_str() {
                                Some("accepted" | "organizer") => "accepted",
                                Some("declined") => "declined",
                                Some("tentativelyAccepted") => "tentative",
                                _ => "needsAction",
                            }
                            .to_string(),
                            required: x["type"].as_str() != Some("optional"),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        is_cancelled: v["isCancelled"].as_bool().unwrap_or(false),
        online_meeting_url: v["onlineMeeting"]["joinUrl"].as_str().map(str::to_string),
        my_response: match v["responseStatus"]["response"].as_str() {
            Some("organizer") => Some("organizer".into()),
            Some("accepted") => Some("accepted".into()),
            Some("declined") => Some("declined".into()),
            Some("tentativelyAccepted") => Some("tentative".into()),
            Some("notResponded") => Some("needsAction".into()),
            _ => None,
        },
        categories: v["categories"].as_array().map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        etag: None,
        raw: None,
    })
}

/// Graph path of a calendar's owner: `/me` or `/users/{address}` for a
/// calendar opened from someone else.
fn owner(col: &RemoteCollection) -> String {
    match col.remote_id.strip_prefix(SHARED_PREFIX) {
        Some(email) => format!("/users/{}", crate::percent_encode(email)),
        None => "/me".into(),
    }
}

/// Calendar path: `/me/calendars/{id}` or `/users/{address}/calendar`.
fn calendar_path(col: &RemoteCollection) -> String {
    match col.remote_id.strip_prefix(SHARED_PREFIX) {
        Some(_) => format!("{}/calendar", owner(col)),
        None => format!("/me/calendars/{}", col.remote_id),
    }
}

fn event_json(input: &EventInput, start: DateTime<Utc>, end: DateTime<Utc>, with_recurrence: bool) -> Value {
    let mut v = json!({
        "subject": input.title,
        "start": graph_dt(start),
        "end": graph_dt(end),
        "isAllDay": input.all_day,
        "location": { "displayName": input.location },
        "showAs": match input.show_as { ShowAs::Free => "free", ShowAs::Tentative => "tentative", ShowAs::OutOfOffice => "oof", ShowAs::Busy => "busy" },
        "isReminderOn": input.reminder_minutes.is_some(),
        "attendees": input.attendees.iter().map(|a| json!({ "emailAddress": { "address": a.email, "name": a.name.clone().unwrap_or_default() }, "type": "required" })).collect::<Vec<_>>(),
        "categories": input.categories,
    });
    if input.online_meeting {
        v["isOnlineMeeting"] = json!(true);
        v["onlineMeetingProvider"] = json!("teamsForBusiness");
    }
    if let Some(m) = input.reminder_minutes {
        v["reminderMinutesBeforeStart"] = json!(m);
    }
    if let Some(body) = &input.body {
        v["body"] = json!({ "contentType": "text", "content": body });
    }
    if with_recurrence && let Some(r) = &input.recurrence {
        v["recurrence"] = recurrence_to_graph(r, start);
    }
    v
}

fn contact_from_graph(v: &Value) -> Option<Contact> {
    let id = v["id"].as_str()?.to_string();
    let mut phones = Vec::new();
    for (key, label) in [("businessPhones", "work"), ("homePhones", "home")] {
        for p in v[key].as_array().into_iter().flatten() {
            if let Some(n) = p.as_str().filter(|n| !n.is_empty()) {
                phones.push(Labeled { label: label.into(), value: n.into() });
            }
        }
    }
    if let Some(m) = v["mobilePhone"].as_str().filter(|n| !n.is_empty()) {
        phones.push(Labeled { label: "mobile".into(), value: m.into() });
    }
    let addresses = [("businessAddress", "work"), ("homeAddress", "home"), ("otherAddress", "other")]
        .iter()
        .filter_map(|(k, label)| {
            let a = &v[*k];
            let pa = PostalAddress { label: label.to_string(), street: s(&a["street"]), city: s(&a["city"]), postal_code: s(&a["postalCode"]), country: s(&a["countryOrRegion"]) };
            (!(pa.street.is_empty() && pa.city.is_empty() && pa.postal_code.is_empty())).then_some(pa)
        })
        .collect();
    Some(Contact {
        remote_id: id,
        display_name: s(&v["displayName"]),
        given_name: s(&v["givenName"]),
        family_name: s(&v["surname"]),
        company: s(&v["companyName"]),
        job_title: s(&v["jobTitle"]),
        emails: v["emailAddresses"]
            .as_array()
            .map(|a| a.iter().filter_map(|e| e["address"].as_str().map(|x| Labeled { label: "other".into(), value: x.into() })).collect())
            .unwrap_or_default(),
        phones,
        addresses,
        birthday: v["birthday"].as_str().and_then(|b| NaiveDate::parse_from_str(&b[..10.min(b.len())], "%Y-%m-%d").ok()),
        notes: s(&v["personalNotes"]),
        groups: v["categories"].as_array().map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        ..Default::default()
    })
}

fn contact_json(c: &Contact) -> Value {
    let phones = |label: &str| -> Vec<String> { c.phones.iter().filter(|p| p.label == label).map(|p| p.value.clone()).collect() };
    let addr = |label: &str| {
        c.addresses
            .iter()
            .find(|a| a.label == label)
            .map(|a| json!({ "street": a.street, "city": a.city, "postalCode": a.postal_code, "countryOrRegion": a.country }))
            .unwrap_or(json!({}))
    };
    json!({
        "displayName": c.effective_name(),
        "givenName": c.given_name,
        "surname": c.family_name,
        "companyName": c.company,
        "jobTitle": c.job_title,
        "emailAddresses": c.emails.iter().take(3).map(|e| json!({ "address": e.value, "name": c.effective_name() })).collect::<Vec<_>>(),
        "businessPhones": phones("work"),
        "homePhones": phones("home"),
        "mobilePhone": c.phones.iter().find(|p| p.label == "mobile").map(|p| p.value.clone()),
        "businessAddress": addr("work"),
        "homeAddress": addr("home"),
        "birthday": c.birthday.map(|b| format!("{}T11:59:00Z", b.format("%Y-%m-%d"))),
        "personalNotes": c.notes,
        "categories": c.groups,
    })
}

fn task_from_graph(v: &Value) -> Option<Task> {
    Some(Task {
        remote_id: v["id"].as_str()?.to_string(),
        title: s(&v["title"]),
        notes: s(&v["body"]["content"]).trim().to_string(),
        due: parse_dt(&v["dueDateTime"]).map(|d| d.date_naive()),
        completed: v["status"].as_str() == Some("completed"),
        completed_at: parse_dt(&v["completedDateTime"]),
        importance: match v["importance"].as_str() {
            Some("high") => TaskImportance::High,
            Some("low") => TaskImportance::Low,
            _ => TaskImportance::Normal,
        },
        created: v["createdDateTime"].as_str().and_then(|d| DateTime::parse_from_rfc3339(d).ok()).map(|d| d.with_timezone(&Utc)).unwrap_or_else(Utc::now),
        steps: v["checklistItems"]
            .as_array()
            .map(|a| a.iter().map(|i| TaskStep { title: s(&i["displayName"]), done: i["isChecked"].as_bool().unwrap_or(false) }).collect())
            .unwrap_or_default(),
        recurrence: recurrence_from_graph(&v["recurrence"]),
        reminder: if v["isReminderOn"].as_bool().unwrap_or(false) { parse_dt(&v["reminderDateTime"]) } else { None },
        ..Default::default()
    })
}

fn task_json(t: &Task) -> Value {
    let mut v = json!({
        "title": t.title,
        "body": { "contentType": "text", "content": t.notes },
        "status": if t.completed { "completed" } else { "notStarted" },
        "importance": match t.importance { TaskImportance::High => "high", TaskImportance::Low => "low", TaskImportance::Normal => "normal" },
        "dueDateTime": t.due.map(|d| json!({ "dateTime": format!("{}T00:00:00", d.format("%Y-%m-%d")), "timeZone": "UTC" })),
    });
    if t.completed {
        v["completedDateTime"] = graph_dt(t.completed_at.unwrap_or_else(Utc::now));
    }
    v["isReminderOn"] = json!(t.reminder.is_some());
    v["reminderDateTime"] = t.reminder.map(graph_dt).unwrap_or(Value::Null);
    v["recurrence"] = match (&t.recurrence, t.due) {
        (Some(r), Some(d)) => recurrence_to_graph(r, d.and_hms_opt(0, 0, 0).unwrap().and_utc()),
        _ => Value::Null,
    };
    v
}

impl GraphProvider {
    /// All pages of a Graph collection.
    async fn get_all(&self, url: &str, prefer: Option<&str>) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut next = Some(url.to_string());
        while let Some(u) = next {
            let page: Value = self.get_json(&u, prefer).await?;
            out.extend(page["value"].as_array().cloned().unwrap_or_default());
            next = page["@odata.nextLink"].as_str().map(str::to_string);
        }
        Ok(out)
    }

    /// Recurrence patterns of series masters (one `$batch` per 20 masters).
    async fn masters(&self, base: &str, ids: &HashSet<String>) -> Result<HashMap<String, (Option<Recurrence>, Value)>> {
        let ids: Vec<&String> = ids.iter().collect();
        let mut out = HashMap::new();
        for chunk in ids.chunks(20) {
            let requests: Vec<Value> = chunk
                .iter()
                .map(|id| json!({ "id": id, "method": "GET", "url": self.path(&format!("{base}/events/{id}?$select=recurrence,start,end")), "headers": { "Prefer": "outlook.timezone=\"UTC\"" } }))
                .collect();
            let resp: Value = self.request(Method::POST, "/$batch", Some(&json!({ "requests": requests })), None).await?.json().await.map_err(Error::network)?;
            for r in resp["responses"].as_array().into_iter().flatten() {
                if let (Some(id), Some(200)) = (r["id"].as_str(), r["status"].as_u64()) {
                    out.insert(id.to_string(), (recurrence_from_graph(&r["body"]["recurrence"]), r["body"].clone()));
                }
            }
        }
        Ok(out)
    }
}

#[async_trait]
impl PimProvider for GraphProvider {
    async fn list_collections(&self) -> Result<Vec<RemoteCollection>> {
        let mut out = Vec::new();
        for c in self.get_all("/me/calendars?$select=id,name,hexColor,canEdit,isDefaultCalendar&$top=100", None).await? {
            out.push(RemoteCollection {
                remote_id: s(&c["id"]),
                kind: CollectionKind::Calendar,
                name: s(&c["name"]),
                color: c["hexColor"].as_str().filter(|h| h.starts_with('#')).map(str::to_string),
                read_only: !c["canEdit"].as_bool().unwrap_or(true),
                is_default: c["isDefaultCalendar"].as_bool().unwrap_or(false),
            });
        }
        out.push(RemoteCollection { remote_id: DEFAULT_CONTACTS.into(), kind: CollectionKind::Contacts, name: "Kontakte".into(), color: None, read_only: false, is_default: true });
        if let Ok(folders) = self.get_all("/me/contactFolders?$top=100", None).await {
            for f in folders {
                out.push(RemoteCollection { remote_id: s(&f["id"]), kind: CollectionKind::Contacts, name: s(&f["displayName"]), color: None, read_only: false, is_default: false });
            }
        }
        // To Do needs Tasks.ReadWrite; older sign-ins lack it and simply have no task lists.
        match self.get_all("/me/todo/lists", None).await {
            Ok(lists) => {
                for l in lists {
                    out.push(RemoteCollection {
                        remote_id: format!("{TODO_PREFIX}{}", s(&l["id"])),
                        kind: CollectionKind::Tasks,
                        name: s(&l["displayName"]),
                        color: None,
                        read_only: false,
                        is_default: l["wellknownListName"].as_str() == Some("defaultList"),
                    });
                }
            }
            Err(e) => tracing::debug!(error = %e, "Microsoft To Do not available"),
        }
        Ok(out)
    }

    async fn sync_events(&self, col: &RemoteCollection, window: Window, _state: Option<&str>, _known: &Known) -> Result<Changes<EventResource>> {
        let url = format!(
            "{}/calendarView?startDateTime={}&endDateTime={}&$top=250&$select={EVENT_SELECT}",
            calendar_path(col),
            window.start.format("%Y-%m-%dT%H:%M:%SZ"),
            window.end.format("%Y-%m-%dT%H:%M:%SZ")
        );
        let raw = self.get_all(&url, Some(PREFER_UTC_TEXT)).await?;
        let master_ids: HashSet<String> = raw.iter().filter_map(|v| v["seriesMasterId"].as_str().map(str::to_string)).collect();
        let masters: HashMap<String, Option<Recurrence>> = self.masters(&owner(col), &master_ids).await.unwrap_or_default().into_iter().map(|(k, (r, _))| (k, r)).collect();
        let upserted = raw
            .iter()
            .filter_map(|v| event_from_graph(v, &masters))
            .filter(|e| !e.is_cancelled)
            .map(|e| EventResource { resource_id: e.resource_id.clone(), etag: None, raw: None, events: vec![e] })
            .collect();
        Ok(Changes { upserted, removed: vec![], reset: true, new_state: Some(Utc::now().to_rfc3339()) })
    }

    async fn create_event(&self, col: &RemoteCollection, input: &EventInput) -> Result<()> {
        let body = event_json(input, input.start, input.end, true);
        self.request(Method::POST, &format!("{}/events", calendar_path(col)), Some(&body), None).await.map(|_| ())
    }

    async fn open_shared_calendar(&self, email: &str) -> Result<RemoteCollection> {
        let email = email.trim();
        let v: Value = self.get_json(&format!("/users/{}/calendar?$select=id,name,canEdit,owner", crate::percent_encode(email)), None).await?;
        let who = v["owner"]["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(email);
        Ok(RemoteCollection {
            remote_id: format!("{SHARED_PREFIX}{email}"),
            kind: CollectionKind::Calendar,
            name: who.to_string(),
            color: None,
            read_only: !v["canEdit"].as_bool().unwrap_or(false),
            is_default: false,
        })
    }

    async fn calendar_permissions(&self, col: &RemoteCollection) -> Result<Vec<CalendarPermission>> {
        let list = self.get_all(&format!("{}/calendarPermissions", calendar_path(col)), None).await?;
        Ok(list
            .iter()
            .filter_map(|p| {
                Some(CalendarPermission {
                    id: p["id"].as_str()?.to_string(),
                    email: p["emailAddress"]["address"].as_str()?.to_string(),
                    name: p["emailAddress"]["name"].as_str().map(str::to_string),
                    role: p["role"].as_str().unwrap_or("read").to_string(),
                })
            })
            .collect())
    }

    async fn share_calendar(&self, col: &RemoteCollection, email: &str, role: &str) -> Result<()> {
        let existing = self.calendar_permissions(col).await.unwrap_or_default();
        let path = calendar_path(col);
        if let Some(p) = existing.iter().find(|p| p.email.eq_ignore_ascii_case(email)) {
            return self.request(Method::PATCH, &format!("{path}/calendarPermissions/{}", p.id), Some(&json!({ "role": role })), None).await.map(|_| ());
        }
        let body = json!({ "emailAddress": { "address": email }, "isInsideOrganization": true, "isRemovable": true, "role": role });
        self.request(Method::POST, &format!("{path}/calendarPermissions"), Some(&body), None).await.map(|_| ())
    }

    async fn unshare_calendar(&self, col: &RemoteCollection, permission_id: &str) -> Result<()> {
        self.request(Method::DELETE, &format!("{}/calendarPermissions/{permission_id}", calendar_path(col)), None, None).await.map(|_| ())
    }

    async fn propose_time(&self, col: &RemoteCollection, event: &Event, start: DateTime<Utc>, end: DateTime<Utc>, comment: &str) -> Result<()> {
        let body = json!({
            "sendResponse": true,
            "comment": comment,
            "proposedNewTime": { "start": graph_dt(start), "end": graph_dt(end) },
        });
        self.request(Method::POST, &format!("{}/events/{}/tentativelyAccept", owner(col), event.remote_id), Some(&body), None).await.map(|_| ())
    }

    async fn update_event(&self, col: &RemoteCollection, event: &Event, input: &EventInput, scope: EditScope) -> Result<()> {
        let base = owner(col);
        if scope == EditScope::Series
            && let Some(master) = &event.series_id
        {
            // Shift the series by the change made to this occurrence.
            let ids: HashSet<String> = [master.clone()].into();
            let info = self.masters(&base, &ids).await?;
            let m = info.get(master).ok_or_else(|| Error::NotFound("Serie".into()))?;
            let master_start = parse_dt(&m.1["start"]).ok_or_else(|| Error::protocol("Serie ohne Beginn"))?;
            let start = master_start + (input.start - event.start);
            let end = start + (input.end - input.start);
            let body = event_json(input, start, end, input.recurrence.is_some());
            return self.request(Method::PATCH, &format!("{base}/events/{master}"), Some(&body), None).await.map(|_| ());
        }
        let body = event_json(input, input.start, input.end, !event.is_recurring);
        self.request(Method::PATCH, &format!("{base}/events/{}", event.remote_id), Some(&body), None).await.map(|_| ())
    }

    async fn respond_event(&self, col: &RemoteCollection, event: &Event, response: EventResponse) -> Result<()> {
        // Answers the whole series for recurring meetings, like Outlook's default.
        let id = event.series_id.clone().unwrap_or_else(|| event.remote_id.clone());
        let action = match response {
            EventResponse::Accept => "accept",
            EventResponse::Tentative => "tentativelyAccept",
            EventResponse::Decline => "decline",
        };
        self.request(Method::POST, &format!("{}/events/{id}/{action}", owner(col)), Some(&json!({ "sendResponse": true })), None)
            .await
            .map(|_| ())
    }

    async fn free_busy(&self, emails: &[String], start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Vec<Availability>> {
        let body = json!({
            "schedules": emails,
            "startTime": { "dateTime": start.format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone": "UTC" },
            "endTime": { "dateTime": end.format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone": "UTC" },
            "availabilityViewInterval": 30,
        });
        let resp: Value = self
            .request(Method::POST, "/me/calendar/getSchedule", Some(&body), Some("outlook.timezone=\"UTC\""))
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        let utc = |v: &Value| {
            NaiveDateTime::parse_from_str(v["dateTime"].as_str().unwrap_or_default().split('.').next().unwrap_or_default(), "%Y-%m-%dT%H:%M:%S")
                .ok()
                .map(|t| t.and_utc())
        };
        Ok(resp["value"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|s| Availability {
                email: s["scheduleId"].as_str().unwrap_or_default().to_string(),
                known: s["error"].is_null(),
                slots: s["scheduleItems"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|i| {
                        Some(BusySlot {
                            start: utc(&i["start"])?,
                            end: utc(&i["end"])?,
                            status: match i["status"].as_str() {
                                Some("tentative") => ShowAs::Tentative,
                                Some("oof") => ShowAs::OutOfOffice,
                                Some("free") => ShowAs::Free,
                                _ => ShowAs::Busy,
                            },
                        })
                    })
                    .collect(),
            })
            .collect())
    }

    async fn delete_event(&self, col: &RemoteCollection, event: &Event, scope: EditScope) -> Result<()> {
        let id = match (&event.series_id, scope) {
            (Some(master), EditScope::Series) => master.clone(),
            _ => event.remote_id.clone(),
        };
        self.request(Method::DELETE, &format!("{}/events/{id}", owner(col)), None, None).await.map(|_| ())
    }

    async fn rooms(&self) -> Result<Vec<Room>> {
        let v: Value = self
            .send(Method::GET, "/places/microsoft.graph.room?$top=500", None, None, Some(crate::auth::PLACES_SCOPE))
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        Ok(parse_rooms(&v))
    }

    async fn sync_contacts(&self, col: &RemoteCollection, _state: Option<&str>, _known: &Known) -> Result<Changes<Contact>> {
        let url = if col.remote_id == DEFAULT_CONTACTS { "/me/contacts?$top=500".to_string() } else { format!("/me/contactFolders/{}/contacts?$top=500", col.remote_id) };
        let upserted = self.get_all(&url, None).await?.iter().filter_map(contact_from_graph).collect();
        Ok(Changes { upserted, removed: vec![], reset: true, new_state: None })
    }

    async fn save_contact(&self, col: &RemoteCollection, contact: &Contact) -> Result<()> {
        let body = contact_json(contact);
        if contact.remote_id.is_empty() {
            let url = if col.remote_id == DEFAULT_CONTACTS { "/me/contacts".to_string() } else { format!("/me/contactFolders/{}/contacts", col.remote_id) };
            self.request(Method::POST, &url, Some(&body), None).await.map(|_| ())
        } else {
            self.request(Method::PATCH, &format!("/me/contacts/{}", contact.remote_id), Some(&body), None).await.map(|_| ())
        }
    }

    async fn delete_contact(&self, _col: &RemoteCollection, contact: &Contact) -> Result<()> {
        self.request(Method::DELETE, &format!("/me/contacts/{}", contact.remote_id), None, None).await.map(|_| ())
    }

    async fn sync_tasks(&self, col: &RemoteCollection, _state: Option<&str>, _known: &Known) -> Result<Changes<Task>> {
        let list = col.remote_id.trim_start_matches(TODO_PREFIX);
        let upserted = self
            .get_all(&format!("/me/todo/lists/{list}/tasks?$top=200&$expand=checklistItems"), None)
            .await?
            .iter()
            .filter_map(task_from_graph)
            .collect();
        Ok(Changes { upserted, removed: vec![], reset: true, new_state: None })
    }

    async fn save_task(&self, col: &RemoteCollection, task: &Task) -> Result<()> {
        let list = col.remote_id.trim_start_matches(TODO_PREFIX);
        let body = task_json(task);
        let id = if task.remote_id.is_empty() {
            let created: Value = self
                .request(Method::POST, &format!("/me/todo/lists/{list}/tasks"), Some(&body), None)
                .await?
                .json()
                .await
                .map_err(Error::network)?;
            created["id"].as_str().unwrap_or_default().to_string()
        } else {
            self.request(Method::PATCH, &format!("/me/todo/lists/{list}/tasks/{}", task.remote_id), Some(&body), None).await?;
            task.remote_id.clone()
        };
        // Steps: replace the checklist when it changed.
        let base = format!("/me/todo/lists/{list}/tasks/{id}/checklistItems");
        let existing = if task.remote_id.is_empty() { Vec::new() } else { self.get_all(&base, None).await.unwrap_or_default() };
        let current: Vec<TaskStep> = existing
            .iter()
            .map(|i| TaskStep { title: s(&i["displayName"]), done: i["isChecked"].as_bool().unwrap_or(false) })
            .collect();
        if id.is_empty() || current == task.steps {
            return Ok(());
        }
        for item in &existing {
            if let Some(item_id) = item["id"].as_str() {
                self.request(Method::DELETE, &format!("{base}/{item_id}"), None, None).await?;
            }
        }
        for step in &task.steps {
            self.request(Method::POST, &base, Some(&json!({ "displayName": step.title, "isChecked": step.done })), None).await?;
        }
        Ok(())
    }

    fn completes_recurring_tasks(&self) -> bool {
        true
    }

    async fn delete_task(&self, col: &RemoteCollection, task: &Task) -> Result<()> {
        let list = col.remote_id.trim_start_matches(TODO_PREFIX);
        self.request(Method::DELETE, &format!("/me/todo/lists/{list}/tasks/{}", task.remote_id), None, None).await.map(|_| ())
    }
}

fn parse_rooms(v: &Value) -> Vec<Room> {
    v["value"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let email = r["emailAddress"].as_str().filter(|e| !e.is_empty())?;
            Some(Room {
                name: r["displayName"].as_str().unwrap_or(email).to_string(),
                email: email.to_string(),
                capacity: r["capacity"].as_u64().filter(|c| *c > 0).map(|c| c as u32),
                building: r["building"].as_str().filter(|b| !b.is_empty()).map(str::to_string),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rooms() {
        let v = json!({ "value": [
            { "displayName": "Konferenz 1", "emailAddress": "k1@example.com", "capacity": 12, "building": "Haus A" },
            { "displayName": "Ohne Adresse", "emailAddress": "" }
        ] });
        assert_eq!(parse_rooms(&v), vec![Room { name: "Konferenz 1".into(), email: "k1@example.com".into(), capacity: Some(12), building: Some("Haus A".into()) }]);
    }

    #[test]
    fn maps_events_and_recurrence() {
        let rec = json!({ "pattern": { "type": "weekly", "interval": 2, "daysOfWeek": ["monday", "thursday"] }, "range": { "type": "numbered", "startDate": "2026-11-16", "numberOfOccurrences": 8 } });
        let r = recurrence_from_graph(&rec).unwrap();
        assert_eq!(r, Recurrence { freq: Freq::Weekly, interval: 2, by_day: vec!["MO".into(), "TH".into()], until: None, count: Some(8) });
        let start = DateTime::parse_from_rfc3339("2026-11-16T08:00:00Z").unwrap().with_timezone(&Utc);
        let back = recurrence_to_graph(&r, start);
        assert_eq!(back["pattern"]["daysOfWeek"], json!(["monday", "thursday"]));
        assert_eq!(back["range"]["numberOfOccurrences"], json!(8));
        assert!(recurrence_from_graph(&json!({ "pattern": { "type": "relativeMonthly" } })).is_none());

        let v = json!({
            "id": "OCC1", "subject": "Jour fixe", "seriesMasterId": "M1", "type": "occurrence",
            "start": { "dateTime": "2026-11-16T08:00:00.0000000", "timeZone": "UTC" },
            "end": { "dateTime": "2026-11-16T09:00:00.0000000", "timeZone": "UTC" },
            "isReminderOn": true, "reminderMinutesBeforeStart": 15, "showAs": "tentative",
            "location": { "displayName": "Raum 1" },
            "attendees": [{ "emailAddress": { "name": "Anna", "address": "anna@contoso.com" }, "status": { "response": "accepted" }, "type": "optional" }],
            "onlineMeeting": { "joinUrl": "https://teams.example/join" }
        });
        let masters = HashMap::from([("M1".to_string(), Some(r.clone()))]);
        let e = event_from_graph(&v, &masters).unwrap();
        assert_eq!(e.start, start);
        assert!(e.is_recurring);
        assert_eq!(e.recurrence, Some(r));
        assert_eq!(e.reminder_minutes, Some(15));
        assert_eq!(e.show_as, ShowAs::Tentative);
        assert!(!e.attendees[0].required);
        assert_eq!(e.online_meeting_url.as_deref(), Some("https://teams.example/join"));
    }

    #[test]
    fn maps_contacts_and_tasks() {
        let c = Contact {
            display_name: "Max Becker".into(),
            given_name: "Max".into(),
            family_name: "Becker".into(),
            emails: vec![Labeled { label: "work".into(), value: "max@example.com".into() }],
            phones: vec![Labeled { label: "mobile".into(), value: "0170".into() }, Labeled { label: "work".into(), value: "0681".into() }],
            birthday: NaiveDate::from_ymd_opt(1990, 5, 1),
            ..Default::default()
        };
        let mut v = contact_json(&c);
        v["id"] = json!("C1");
        let back = contact_from_graph(&v).unwrap();
        assert_eq!(back.emails[0].value, "max@example.com");
        assert_eq!(back.phones.len(), 2);
        assert_eq!(back.birthday, c.birthday);

        let t = Task { title: "Bericht".into(), due: NaiveDate::from_ymd_opt(2026, 12, 1), completed: true, importance: TaskImportance::High, ..Default::default() };
        let mut v = task_json(&t);
        v["id"] = json!("T1");
        v["dueDateTime"] = json!({ "dateTime": "2026-12-01T00:00:00.0000000", "timeZone": "UTC" });
        let back = task_from_graph(&v).unwrap();
        assert_eq!(back.due, t.due);
        assert!(back.completed);
        assert_eq!(back.importance, TaskImportance::High);
    }
}
