//! iCalendar (RFC 5545) and the shared content-line format used by vCard.
//!
//! Components are kept as generic property lists so unknown properties
//! survive edits (important when changing events created by other clients).

use std::collections::HashMap;
use std::str::FromStr;

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use nexora_mail_core::model::Address;

use crate::model::*;

// ------------------------------------------------------------------ parsing

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prop {
    pub name: String,
    pub params: Vec<(String, String)>,
    pub value: String,
}

impl Prop {
    pub fn new(name: &str, value: impl Into<String>) -> Self {
        Self { name: name.to_string(), params: Vec::new(), value: value.into() }
    }

    pub fn with_param(mut self, k: &str, v: impl Into<String>) -> Self {
        self.params.push((k.to_string(), v.into()));
        self
    }

    pub fn param(&self, k: &str) -> Option<&str> {
        self.params.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Component {
    pub name: String,
    pub props: Vec<Prop>,
    pub children: Vec<Component>,
}

impl Component {
    pub fn new(name: &str) -> Self {
        Self { name: name.to_string(), ..Default::default() }
    }

    pub fn prop(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name.eq_ignore_ascii_case(name))
    }

    pub fn props_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Prop> + 'a {
        self.props.iter().filter(move |p| p.name.eq_ignore_ascii_case(name))
    }

    pub fn value(&self, name: &str) -> Option<&str> {
        self.prop(name).map(|p| p.value.as_str())
    }

    pub fn text(&self, name: &str) -> String {
        self.value(name).map(unescape).unwrap_or_default()
    }

    pub fn remove(&mut self, name: &str) {
        self.props.retain(|p| !p.name.eq_ignore_ascii_case(name));
    }

    pub fn set(&mut self, prop: Prop) {
        self.remove(&prop.name);
        self.props.push(prop);
    }

    pub fn set_text(&mut self, name: &str, value: &str) {
        if value.is_empty() {
            self.remove(name);
        } else {
            self.set(Prop::new(name, escape(value)));
        }
    }
}

pub fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => out.push('\n'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

fn parse_line(line: &str) -> Option<Prop> {
    // name[;param=value]*:value — ':' and ';' inside quoted params do not count.
    let mut in_quotes = false;
    let mut colon = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = Vec::new();
    let mut cur = String::new();
    in_quotes = false;
    for c in head.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            ';' if !in_quotes => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    let mut it = parts.into_iter();
    let name = it.next()?.to_ascii_uppercase();
    // vCard groups ("item1.EMAIL") are dropped.
    let name = name.rsplit('.').next().unwrap_or(&name).to_string();
    let params = it
        .filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.to_string())))
        .collect();
    Some(Prop { name, params, value: value.to_string() })
}

/// Parse a stream of components (`BEGIN:VCALENDAR … END:VCALENDAR` or
/// several `BEGIN:VCARD` blocks).
pub fn parse(text: &str) -> Vec<Component> {
    // Unfold continuation lines.
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().expect("non-empty").push_str(&raw[1..]);
        } else if !raw.is_empty() {
            lines.push(raw.to_string());
        }
    }
    let mut stack: Vec<Component> = vec![Component::new("#root")];
    for line in lines {
        let Some(prop) = parse_line(&line) else { continue };
        match prop.name.as_str() {
            "BEGIN" => stack.push(Component::new(&prop.value.to_ascii_uppercase())),
            "END" => {
                if stack.len() > 1 {
                    let c = stack.pop().expect("len > 1");
                    stack.last_mut().expect("root").children.push(c);
                }
            }
            _ => stack.last_mut().expect("root").props.push(prop),
        }
    }
    while stack.len() > 1 {
        let c = stack.pop().expect("len > 1");
        stack.last_mut().expect("root").children.push(c);
    }
    stack.pop().expect("root").children
}

fn fold(line: &str, out: &mut String) {
    // Fold at 75 octets without splitting UTF-8 characters.
    let mut count = 0;
    for c in line.chars() {
        let len = c.len_utf8();
        if count + len > 75 {
            out.push_str("\r\n ");
            count = 1;
        }
        out.push(c);
        count += len;
    }
    out.push_str("\r\n");
}

pub fn serialize(c: &Component) -> String {
    let mut out = String::new();
    write_component(c, &mut out);
    out
}

fn write_component(c: &Component, out: &mut String) {
    out.push_str(&format!("BEGIN:{}\r\n", c.name));
    for p in &c.props {
        let mut line = p.name.clone();
        for (k, v) in &p.params {
            let quoted = v.contains([':', ';', ',']);
            line.push_str(&if quoted { format!(";{k}=\"{v}\"") } else { format!(";{k}={v}") });
        }
        line.push(':');
        line.push_str(&p.value);
        fold(&line, out);
    }
    for child in &c.children {
        write_component(child, out);
    }
    out.push_str(&format!("END:{}\r\n", c.name));
}

// -------------------------------------------------------------------- time

/// Time zone of a DATE-TIME value.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Zone {
    Utc,
    Iana(chrono_tz::Tz),
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParsedTime {
    pub utc: DateTime<Utc>,
    pub date_only: bool,
    pub zone: Zone,
    pub naive: NaiveDateTime,
}

/// IANA zone of this computer (falls back to UTC).
pub fn local_zone() -> Option<chrono_tz::Tz> {
    iana_time_zone::get_timezone().ok().and_then(|n| chrono_tz::Tz::from_str(&n).ok())
}

fn windows_zone(name: &str) -> Option<&'static str> {
    Some(match name {
        "W. Europe Standard Time" => "Europe/Berlin",
        "Central Europe Standard Time" => "Europe/Budapest",
        "Central European Standard Time" => "Europe/Warsaw",
        "Romance Standard Time" => "Europe/Paris",
        "GMT Standard Time" => "Europe/London",
        "E. Europe Standard Time" => "Europe/Chisinau",
        "FLE Standard Time" => "Europe/Kiev",
        "Pacific Standard Time" => "America/Los_Angeles",
        "Mountain Standard Time" => "America/Denver",
        "Central Standard Time" => "America/Chicago",
        "Eastern Standard Time" => "America/New_York",
        "UTC" | "Coordinated Universal Time" => "UTC",
        _ => return None,
    })
}

pub fn resolve_zone(tzid: &str) -> Zone {
    let tzid = tzid.trim_matches('"');
    if let Ok(tz) = chrono_tz::Tz::from_str(tzid) {
        return Zone::Iana(tz);
    }
    if let Some(iana) = windows_zone(tzid).and_then(|n| chrono_tz::Tz::from_str(n).ok()) {
        return Zone::Iana(iana);
    }
    // "/mozilla.org/20070129_1/Europe/Berlin" and similar prefixes.
    let parts: Vec<&str> = tzid.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() >= 2
        && let Ok(tz) = chrono_tz::Tz::from_str(&parts[parts.len() - 2..].join("/"))
    {
        return Zone::Iana(tz);
    }
    Zone::Local
}

fn to_utc(zone: Zone, naive: NaiveDateTime) -> DateTime<Utc> {
    match zone {
        Zone::Utc => Utc.from_utc_datetime(&naive),
        Zone::Iana(tz) => tz
            .from_local_datetime(&naive)
            .earliest()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|| Utc.from_utc_datetime(&naive)),
        Zone::Local => chrono::Local
            .from_local_datetime(&naive)
            .earliest()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|| Utc.from_utc_datetime(&naive)),
    }
}

pub fn parse_time(p: &Prop) -> Option<ParsedTime> {
    let v = p.value.trim();
    let date_only = p.param("VALUE").is_some_and(|x| x.eq_ignore_ascii_case("DATE")) || v.len() == 8;
    if date_only {
        let d = NaiveDate::parse_from_str(&v[..8.min(v.len())], "%Y%m%d").ok()?;
        let naive = d.and_hms_opt(0, 0, 0)?;
        return Some(ParsedTime { utc: Utc.from_utc_datetime(&naive), date_only: true, zone: Zone::Utc, naive });
    }
    let (body, zone) = match v.strip_suffix('Z') {
        Some(b) => (b, Zone::Utc),
        None => (v, p.param("TZID").map(resolve_zone).unwrap_or(Zone::Local)),
    };
    let naive = NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M%S").ok()?;
    Some(ParsedTime { utc: to_utc(zone, naive), date_only: false, zone, naive })
}

/// ISO 8601 duration as used by DURATION and TRIGGER (`-PT15M`, `P1D`).
pub fn parse_duration(s: &str) -> Option<Duration> {
    let s = s.trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let s = s.strip_prefix('P')?;
    let mut total = Duration::zero();
    let mut num = String::new();
    let mut in_time = false;
    for c in s.chars() {
        match c {
            '0'..='9' => num.push(c),
            'T' => in_time = true,
            'W' | 'D' | 'H' | 'M' | 'S' => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += match (c, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
            _ => return None,
        }
    }
    Some(if neg { -total } else { total })
}

fn fmt_utc(t: DateTime<Utc>) -> String {
    t.format("%Y%m%dT%H%M%SZ").to_string()
}

/// DTSTART/DTEND/RECURRENCE-ID/EXDATE property for `t`. All-day values are
/// dates; others use the local IANA zone so recurrences follow DST.
fn time_prop(name: &str, t: DateTime<Utc>, all_day: bool) -> Prop {
    if all_day {
        return Prop::new(name, t.format("%Y%m%d").to_string()).with_param("VALUE", "DATE");
    }
    match local_zone() {
        Some(tz) if tz != chrono_tz::UTC => {
            Prop::new(name, t.with_timezone(&tz).format("%Y%m%dT%H%M%S").to_string()).with_param("TZID", tz.name())
        }
        _ => Prop::new(name, fmt_utc(t)),
    }
}

/// Same value type and zone as an existing DTSTART (for RECURRENCE-ID/EXDATE).
fn time_prop_like(name: &str, t: DateTime<Utc>, like: &ParsedTime) -> Prop {
    if like.date_only {
        return Prop::new(name, t.format("%Y%m%d").to_string()).with_param("VALUE", "DATE");
    }
    match like.zone {
        Zone::Utc => Prop::new(name, fmt_utc(t)),
        Zone::Iana(tz) => Prop::new(name, t.with_timezone(&tz).format("%Y%m%dT%H%M%S").to_string()).with_param("TZID", tz.name()),
        Zone::Local => Prop::new(name, t.with_timezone(&chrono::Local).format("%Y%m%dT%H%M%S").to_string()),
    }
}

// ------------------------------------------------------------------ events

fn mailto(v: &str) -> String {
    let v = v.trim();
    v.strip_prefix("mailto:").or_else(|| v.strip_prefix("MAILTO:")).unwrap_or(v).to_string()
}

/// End, reminder, availability, organizer, attendees and meeting URL of a VEVENT.
type VeventFields = (DateTime<Utc>, Option<i32>, ShowAs, Option<Address>, Vec<Attendee>, Option<String>);

fn vevent_fields(c: &Component, start: &ParsedTime) -> VeventFields {
    let end = c
        .prop("DTEND")
        .and_then(parse_time)
        .map(|t| t.utc)
        .or_else(|| c.value("DURATION").and_then(parse_duration).map(|d| start.utc + d))
        .unwrap_or(if start.date_only { start.utc + Duration::days(1) } else { start.utc + Duration::hours(1) });
    let reminder = c.children.iter().filter(|a| a.name == "VALARM").find_map(|a| {
        let trigger = a.prop("TRIGGER")?;
        if trigger.param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE-TIME")) {
            let at = parse_time(trigger)?;
            return Some((start.utc - at.utc).num_minutes() as i32);
        }
        let d = parse_duration(&trigger.value)?;
        Some((-d.num_minutes()) as i32)
    });
    let mut show_as = if c.value("TRANSP").is_some_and(|v| v.eq_ignore_ascii_case("TRANSPARENT")) { ShowAs::Free } else { ShowAs::Busy };
    if let Some(v) = c.value("X-MICROSOFT-CDO-BUSYSTATUS") {
        show_as = match v.to_ascii_uppercase().as_str() {
            "FREE" => ShowAs::Free,
            "TENTATIVE" => ShowAs::Tentative,
            "OOF" => ShowAs::OutOfOffice,
            _ => ShowAs::Busy,
        };
    }
    let organizer = c.prop("ORGANIZER").map(|p| Address::new(p.param("CN").map(|s| s.trim_matches('"').to_string()), mailto(&p.value)));
    let attendees = c
        .props_named("ATTENDEE")
        .map(|p| Attendee {
            address: Address::new(p.param("CN").map(|s| s.trim_matches('"').to_string()), mailto(&p.value)),
            response: match p.param("PARTSTAT").map(str::to_ascii_uppercase).as_deref() {
                Some("ACCEPTED") => "accepted",
                Some("DECLINED") => "declined",
                Some("TENTATIVE") => "tentative",
                _ => "needsAction",
            }
            .to_string(),
            required: !p.param("ROLE").is_some_and(|r| r.eq_ignore_ascii_case("OPT-PARTICIPANT")),
        })
        .collect();
    let meeting = ["X-MICROSOFT-SKYPETEAMSMEETINGURL", "X-GOOGLE-CONFERENCE", "URL"]
        .iter()
        .find_map(|n| c.value(n).filter(|v| v.starts_with("http")).map(str::to_string));
    (end, reminder, show_as, organizer, attendees, meeting)
}

fn base_event(c: &Component, resource_id: &str, start: &ParsedTime) -> Event {
    let (end, reminder, show_as, organizer, attendees, meeting) = vevent_fields(c, start);
    let rrule = c.value("RRULE").map(str::to_string);
    Event {
        id: String::new(),
        collection_id: String::new(),
        account_id: String::new(),
        remote_id: resource_id.to_string(),
        resource_id: resource_id.to_string(),
        series_id: None,
        title: c.text("SUMMARY"),
        location: c.text("LOCATION"),
        body: c.text("DESCRIPTION"),
        start: start.utc,
        end: end.max(start.utc),
        all_day: start.date_only,
        is_recurring: false,
        recurrence: rrule.as_deref().and_then(Recurrence::from_rrule),
        rrule,
        reminder_minutes: reminder,
        show_as,
        organizer,
        attendees,
        is_cancelled: c.value("STATUS").is_some_and(|s| s.eq_ignore_ascii_case("CANCELLED")),
        online_meeting_url: meeting,
        etag: None,
        raw: None,
    }
}

/// Make an RRULE acceptable for the `rrule` crate (UNTIL must be UTC).
fn normalize_rrule(rule: &str) -> String {
    rule.split(';')
        .map(|part| match part.split_once('=') {
            Some((k, v)) if k.eq_ignore_ascii_case("UNTIL") => {
                let v = if v.len() == 8 { format!("{v}T235959Z") } else if !v.ends_with('Z') { format!("{v}Z") } else { v.to_string() };
                format!("UNTIL={v}")
            }
            _ => part.to_string(),
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn occurrences(start: &ParsedTime, rule: &str, window_end: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let dtstart = if start.date_only {
        format!("DTSTART:{}", fmt_utc(start.utc))
    } else {
        match start.zone {
            Zone::Utc => format!("DTSTART:{}", fmt_utc(start.utc)),
            Zone::Iana(tz) => format!("DTSTART;TZID={}:{}", tz.name(), start.naive.format("%Y%m%dT%H%M%S")),
            Zone::Local => match local_zone() {
                Some(tz) => format!("DTSTART;TZID={}:{}", tz.name(), start.naive.format("%Y%m%dT%H%M%S")),
                None => format!("DTSTART:{}", fmt_utc(start.utc)),
            },
        }
    };
    let text = format!("{dtstart}\nRRULE:{}", normalize_rrule(rule));
    match text.parse::<rrule::RRuleSet>() {
        Ok(set) => {
            let before = window_end.with_timezone(&rrule::Tz::UTC);
            set.before(before).all(2000).dates.into_iter().map(|d| d.with_timezone(&Utc)).collect()
        }
        Err(e) => {
            tracing::debug!(error = %e, rule, "cannot expand RRULE");
            vec![start.utc]
        }
    }
}

/// Expand the VEVENTs of one iCalendar resource into occurrences that touch
/// `window`. Occurrence ids are `<resource>#<original start>` for series.
pub fn expand_events(ics: &str, resource_id: &str, window: (DateTime<Utc>, DateTime<Utc>)) -> Vec<Event> {
    let mut out = Vec::new();
    for cal in parse(ics).into_iter().filter(|c| c.name == "VCALENDAR") {
        let events: Vec<&Component> = cal.children.iter().filter(|c| c.name == "VEVENT").collect();
        let mut overrides: HashMap<i64, &Component> = HashMap::new();
        for e in &events {
            if let Some(rid) = e.prop("RECURRENCE-ID").and_then(parse_time) {
                overrides.insert(rid.utc.timestamp(), e);
            }
        }
        for master in events.iter().filter(|e| e.prop("RECURRENCE-ID").is_none()) {
            let Some(start) = master.prop("DTSTART").and_then(parse_time) else { continue };
            let base = base_event(master, resource_id, &start);
            let Some(rule) = master.value("RRULE") else {
                if base.end > window.0 && base.start < window.1 {
                    out.push(base);
                }
                continue;
            };
            let duration = base.end - base.start;
            let exdates: std::collections::HashSet<i64> = master
                .props_named("EXDATE")
                .flat_map(|p| {
                    p.value
                        .split(',')
                        .filter_map(|v| parse_time(&Prop { name: "EXDATE".into(), params: p.params.clone(), value: v.to_string() }))
                        .map(|t| t.utc.timestamp())
                        .collect::<Vec<_>>()
                })
                .collect();
            let mut seen = std::collections::HashSet::new();
            for occ in occurrences(&start, rule, window.1) {
                let ts = occ.timestamp();
                if exdates.contains(&ts) {
                    continue;
                }
                seen.insert(ts);
                let mut ev = match overrides.get(&ts) {
                    Some(ov) => {
                        let ov_start = ov.prop("DTSTART").and_then(parse_time).unwrap_or(ParsedTime { utc: occ, ..start });
                        let mut e = base_event(ov, resource_id, &ov_start);
                        e.recurrence = base.recurrence.clone();
                        e.rrule = base.rrule.clone();
                        e
                    }
                    None => Event { start: occ, end: occ + duration, ..base.clone() },
                };
                ev.remote_id = format!("{resource_id}#{ts}");
                ev.series_id = Some(resource_id.to_string());
                ev.is_recurring = true;
                if ev.end > window.0 && ev.start < window.1 && !ev.is_cancelled {
                    out.push(ev);
                }
            }
            // Overrides for occurrences the rule no longer produces.
            for (ts, ov) in &overrides {
                if seen.contains(ts) || exdates.contains(ts) {
                    continue;
                }
                let Some(ov_start) = ov.prop("DTSTART").and_then(parse_time) else { continue };
                let mut e = base_event(ov, resource_id, &ov_start);
                e.remote_id = format!("{resource_id}#{ts}");
                e.series_id = Some(resource_id.to_string());
                e.is_recurring = true;
                if e.end > window.0 && e.start < window.1 {
                    out.push(e);
                }
            }
        }
    }
    out
}

fn set_event_props(c: &mut Component, input: &EventInput, start: DateTime<Utc>, end: DateTime<Utc>, organizer: Option<&Address>) {
    c.set_text("SUMMARY", &input.title);
    c.set_text("LOCATION", &input.location);
    if let Some(body) = &input.body {
        c.set_text("DESCRIPTION", body);
    }
    c.remove("DURATION");
    c.set(time_prop("DTSTART", start, input.all_day));
    c.set(time_prop("DTEND", end, input.all_day));
    c.remove("X-MICROSOFT-CDO-BUSYSTATUS");
    match input.show_as {
        ShowAs::Free => c.set(Prop::new("TRANSP", "TRANSPARENT")),
        other => {
            c.set(Prop::new("TRANSP", "OPAQUE"));
            let v = match other {
                ShowAs::Tentative => "TENTATIVE",
                ShowAs::OutOfOffice => "OOF",
                _ => "BUSY",
            };
            c.set(Prop::new("X-MICROSOFT-CDO-BUSYSTATUS", v));
        }
    }
    // Attendees: keep existing entries (with their responses), add new ones.
    let existing: Vec<Prop> = c.props_named("ATTENDEE").cloned().collect();
    c.remove("ATTENDEE");
    for a in &input.attendees {
        let keep = existing.iter().find(|p| mailto(&p.value).eq_ignore_ascii_case(&a.email));
        c.props.push(keep.cloned().unwrap_or_else(|| {
            let mut p = Prop::new("ATTENDEE", format!("mailto:{}", a.email)).with_param("ROLE", "REQ-PARTICIPANT").with_param("PARTSTAT", "NEEDS-ACTION").with_param("RSVP", "TRUE");
            if let Some(n) = a.name.as_deref().filter(|n| !n.is_empty()) {
                p = p.with_param("CN", n);
            }
            p
        }));
    }
    if input.attendees.is_empty() {
        c.remove("ORGANIZER");
    } else if c.prop("ORGANIZER").is_none()
        && let Some(o) = organizer
    {
        let mut p = Prop::new("ORGANIZER", format!("mailto:{}", o.email));
        if let Some(n) = o.name.as_deref().filter(|n| !n.is_empty()) {
            p = p.with_param("CN", n);
        }
        c.props.push(p);
    }
    c.children.retain(|a| a.name != "VALARM");
    if let Some(m) = input.reminder_minutes {
        let mut alarm = Component::new("VALARM");
        alarm.props.push(Prop::new("ACTION", "DISPLAY"));
        alarm.props.push(Prop::new("DESCRIPTION", escape(&input.title)));
        alarm.props.push(Prop::new("TRIGGER", format!("-PT{}M", m.max(0))));
        c.children.push(alarm);
    }
    let seq: u32 = c.value("SEQUENCE").and_then(|v| v.parse().ok()).unwrap_or(0);
    c.set(Prop::new("SEQUENCE", (seq + 1).to_string()));
    c.set(Prop::new("DTSTAMP", fmt_utc(Utc::now())));
    c.set(Prop::new("LAST-MODIFIED", fmt_utc(Utc::now())));
}

fn calendar_wrapper(children: Vec<Component>) -> Component {
    let mut cal = Component::new("VCALENDAR");
    cal.props.push(Prop::new("VERSION", "2.0"));
    cal.props.push(Prop::new("PRODID", "-//MirraNET//Nexora//DE"));
    cal.children = children;
    cal
}

/// A new iCalendar resource for an event.
pub fn new_event_ics(uid: &str, input: &EventInput, organizer: Option<&Address>) -> String {
    let mut ev = Component::new("VEVENT");
    ev.props.push(Prop::new("UID", uid));
    ev.props.push(Prop::new("CREATED", fmt_utc(Utc::now())));
    set_event_props(&mut ev, input, input.start, input.end, organizer);
    ev.set(Prop::new("SEQUENCE", "0"));
    if let Some(rule) = input.rule() {
        ev.props.push(Prop::new("RRULE", rule));
    }
    serialize(&calendar_wrapper(vec![ev]))
}

/// Original start of an occurrence, from its id (`<resource>#<ts>`).
pub fn original_start(event: &Event) -> DateTime<Utc> {
    event
        .remote_id
        .rsplit_once('#')
        .and_then(|(_, ts)| ts.parse::<i64>().ok())
        .and_then(|ts| Utc.timestamp_opt(ts, 0).single())
        .unwrap_or(event.start)
}

fn calendar_of(ics: &str) -> Result<Component, String> {
    parse(ics).into_iter().find(|c| c.name == "VCALENDAR").ok_or_else(|| "no VCALENDAR".to_string())
}

fn master_index(cal: &Component) -> Result<usize, String> {
    cal.children
        .iter()
        .position(|c| c.name == "VEVENT" && c.prop("RECURRENCE-ID").is_none())
        .or_else(|| cal.children.iter().position(|c| c.name == "VEVENT"))
        .ok_or_else(|| "no VEVENT".to_string())
}

/// Apply an edit to an existing resource.
pub fn update_event_ics(ics: &str, instance: &Event, input: &EventInput, scope: EditScope, organizer: Option<&Address>) -> Result<String, String> {
    let mut cal = calendar_of(ics)?;
    let mi = master_index(&cal)?;
    let master_start = cal.children[mi].prop("DTSTART").and_then(parse_time).ok_or("master without DTSTART")?;

    if !instance.is_recurring || scope == EditScope::Series {
        // Shift the series by the change made to this occurrence.
        let delta = input.start - instance.start;
        let new_start = master_start.utc + delta;
        let new_end = new_start + (input.end - input.start);
        let old_rule = cal.children[mi].value("RRULE").map(str::to_string);
        let new_rule = input.rule();
        let master = &mut cal.children[mi];
        set_event_props(master, input, new_start, new_end, organizer);
        master.remove("RRULE");
        if let Some(r) = &new_rule {
            master.props.push(Prop::new("RRULE", r.clone()));
        }
        if delta != Duration::zero() || old_rule != new_rule || input.all_day != master_start.date_only {
            // Exceptions refer to the old times; drop them.
            master.remove("EXDATE");
            cal.children.retain(|c| !(c.name == "VEVENT" && c.prop("RECURRENCE-ID").is_some()));
        }
        return Ok(serialize(&cal));
    }

    // Single occurrence → override VEVENT with RECURRENCE-ID.
    let orig = original_start(instance);
    let existing = cal.children.iter().position(|c| {
        c.name == "VEVENT" && c.prop("RECURRENCE-ID").and_then(parse_time).is_some_and(|t| t.utc == orig)
    });
    let mut ov = match existing {
        Some(i) => cal.children.remove(i),
        None => {
            let mut c = cal.children[mi].clone();
            for p in ["RRULE", "RDATE", "EXDATE", "EXRULE"] {
                c.remove(p);
            }
            c.set(time_prop_like("RECURRENCE-ID", orig, &master_start));
            c
        }
    };
    let single = EventInput { recurrence: None, rrule: None, ..input.clone() };
    set_event_props(&mut ov, &single, input.start, input.end, organizer);
    cal.children.push(ov);
    Ok(serialize(&cal))
}

/// Remove one occurrence (EXDATE on the master).
pub fn delete_occurrence_ics(ics: &str, instance: &Event) -> Result<String, String> {
    let mut cal = calendar_of(ics)?;
    let mi = master_index(&cal)?;
    let master_start = cal.children[mi].prop("DTSTART").and_then(parse_time).ok_or("master without DTSTART")?;
    let orig = original_start(instance);
    cal.children.retain(|c| !(c.name == "VEVENT" && c.prop("RECURRENCE-ID").and_then(parse_time).is_some_and(|t| t.utc == orig)));
    let mi = master_index(&cal)?;
    cal.children[mi].props.push(time_prop_like("EXDATE", orig, &master_start));
    Ok(serialize(&cal))
}

// ------------------------------------------------------------------- tasks

pub fn parse_task(ics: &str, resource_id: &str) -> Option<Task> {
    let cal = parse(ics).into_iter().find(|c| c.name == "VCALENDAR")?;
    let t = cal.children.iter().find(|c| c.name == "VTODO")?;
    let priority: u8 = t.value("PRIORITY").and_then(|v| v.parse().ok()).unwrap_or(0);
    let status_done = t.value("STATUS").is_some_and(|s| s.eq_ignore_ascii_case("COMPLETED"));
    Some(Task {
        id: String::new(),
        collection_id: String::new(),
        account_id: String::new(),
        remote_id: resource_id.to_string(),
        title: t.text("SUMMARY"),
        notes: t.text("DESCRIPTION"),
        due: t.prop("DUE").and_then(parse_time).map(|d| {
            if d.date_only { d.utc.date_naive() } else { d.utc.with_timezone(&chrono::Local).date_naive() }
        }),
        completed: status_done || t.prop("COMPLETED").is_some(),
        completed_at: t.prop("COMPLETED").and_then(parse_time).map(|d| d.utc),
        importance: match priority {
            1..=4 => TaskImportance::High,
            6..=9 => TaskImportance::Low,
            _ => TaskImportance::Normal,
        },
        created: t.prop("CREATED").and_then(parse_time).map(|d| d.utc).unwrap_or_else(Utc::now),
        etag: None,
        raw: None,
    })
}

/// New or updated VTODO resource (keeps unknown properties of `existing`).
pub fn task_ics(existing: Option<&str>, uid: &str, task: &Task) -> String {
    let mut cal = existing.and_then(|e| calendar_of(e).ok()).unwrap_or_else(|| calendar_wrapper(vec![]));
    let idx = match cal.children.iter().position(|c| c.name == "VTODO") {
        Some(i) => i,
        None => {
            let mut t = Component::new("VTODO");
            t.props.push(Prop::new("UID", uid));
            t.props.push(Prop::new("CREATED", fmt_utc(task.created)));
            cal.children.push(t);
            cal.children.len() - 1
        }
    };
    let t = &mut cal.children[idx];
    t.set_text("SUMMARY", &task.title);
    t.set_text("DESCRIPTION", &task.notes);
    match task.due {
        Some(d) => t.set(Prop::new("DUE", d.format("%Y%m%d").to_string()).with_param("VALUE", "DATE")),
        None => t.remove("DUE"),
    }
    if task.completed {
        t.set(Prop::new("STATUS", "COMPLETED"));
        t.set(Prop::new("PERCENT-COMPLETE", "100"));
        t.set(Prop::new("COMPLETED", fmt_utc(task.completed_at.unwrap_or_else(Utc::now))));
    } else {
        t.set(Prop::new("STATUS", "NEEDS-ACTION"));
        t.remove("COMPLETED");
        t.remove("PERCENT-COMPLETE");
    }
    match task.importance {
        TaskImportance::High => t.set(Prop::new("PRIORITY", "1")),
        TaskImportance::Low => t.set(Prop::new("PRIORITY", "9")),
        TaskImportance::Normal => t.remove("PRIORITY"),
    }
    t.set(Prop::new("DTSTAMP", fmt_utc(Utc::now())));
    t.set(Prop::new("LAST-MODIFIED", fmt_utc(Utc::now())));
    serialize(&cal)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const WEEKLY: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:abc\r\n\
DTSTART;TZID=Europe/Berlin:20261005T090000\r\nDTEND;TZID=Europe/Berlin:20261005T100000\r\n\
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6\r\nEXDATE;TZID=Europe/Berlin:20261012T090000\r\n\
SUMMARY:Team\\, Weekly\r\nDESCRIPTION:Zeile 1\\nZeile 2\r\n\
BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:abc\r\nRECURRENCE-ID;TZID=Europe/Berlin:20261019T090000\r\n\
DTSTART;TZID=Europe/Berlin:20261019T140000\r\nDTEND;TZID=Europe/Berlin:20261019T150000\r\nSUMMARY:Team (verschoben)\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn expands_recurring_events_with_dst_exdate_and_override() {
        let window = (utc("2026-09-01T00:00:00Z"), utc("2027-01-01T00:00:00Z"));
        let events = expand_events(WEEKLY, "/cal/abc.ics", window);
        assert_eq!(events.len(), 5, "6 occurrences minus one EXDATE");
        assert_eq!(events[0].title, "Team, Weekly");
        assert_eq!(events[0].body, "Zeile 1\nZeile 2");
        assert_eq!(events[0].reminder_minutes, Some(15));
        assert_eq!(events[0].start, utc("2026-10-05T07:00:00Z"), "CEST");
        let moved = events.iter().find(|e| e.title.contains("verschoben")).unwrap();
        assert_eq!(moved.start, utc("2026-10-19T12:00:00Z"));
        let after_dst = events.iter().find(|e| e.start.date_naive() == NaiveDate::from_ymd_opt(2026, 11, 2).unwrap()).unwrap();
        assert_eq!(after_dst.start, utc("2026-11-02T08:00:00Z"), "09:00 CET after the DST switch");
        assert!(events.iter().all(|e| e.series_id.as_deref() == Some("/cal/abc.ics")));
        assert_eq!(events[0].recurrence.as_ref().unwrap().freq, Freq::Weekly);
    }

    #[test]
    fn edits_occurrences_and_series() {
        let window = (utc("2026-09-01T00:00:00Z"), utc("2027-01-01T00:00:00Z"));
        let events = expand_events(WEEKLY, "r", window);
        let third = events.iter().find(|e| e.start == utc("2026-10-26T08:00:00Z")).unwrap().clone();

        // Delete one occurrence.
        let ics = delete_occurrence_ics(WEEKLY, &third).unwrap();
        assert_eq!(expand_events(&ics, "r", window).len(), 4);

        // Move a single occurrence.
        let input = EventInput { title: "Sonder".into(), start: third.start + Duration::hours(1), end: third.end + Duration::hours(1), ..Default::default() };
        let ics = update_event_ics(WEEKLY, &third, &input, EditScope::Occurrence, None).unwrap();
        let after = expand_events(&ics, "r", window);
        assert_eq!(after.len(), 5);
        assert!(after.iter().any(|e| e.title == "Sonder" && e.start == utc("2026-10-26T09:00:00Z")));

        // Change the series: shift by 30 minutes, drops exceptions.
        let input = EventInput { title: "Team neu".into(), start: third.start + Duration::minutes(30), end: third.end + Duration::minutes(30), recurrence: third.recurrence.clone(), ..Default::default() };
        let ics = update_event_ics(WEEKLY, &third, &input, EditScope::Series, None).unwrap();
        let after = expand_events(&ics, "r", window);
        assert_eq!(after.len(), 6, "EXDATE and override dropped after a time change");
        assert!(after.iter().all(|e| e.title == "Team neu"));
        assert_eq!(after[0].start, utc("2026-10-05T07:30:00Z"));
    }

    #[test]
    fn creates_all_day_and_tasks() {
        let day = utc("2026-12-24T00:00:00Z");
        let input = EventInput { title: "Heiligabend".into(), start: day, end: day + Duration::days(1), all_day: true, reminder_minutes: Some(60), ..Default::default() };
        let ics = new_event_ics("x1", &input, None);
        assert!(ics.contains("DTSTART;VALUE=DATE:20261224"));
        let ev = &expand_events(&ics, "r", (day - Duration::days(1), day + Duration::days(2)))[0];
        assert!(ev.all_day);
        assert_eq!((ev.start, ev.end), (day, day + Duration::days(1)));
        assert_eq!(ev.reminder_minutes, Some(60));

        let task = Task { title: "Steuer, Erklärung".into(), due: NaiveDate::from_ymd_opt(2027, 5, 31), importance: TaskImportance::High, ..Default::default() };
        let ics = task_ics(None, "t1", &task);
        let parsed = parse_task(&ics, "t1.ics").unwrap();
        assert_eq!(parsed.title, "Steuer, Erklärung");
        assert_eq!(parsed.due, task.due);
        assert_eq!(parsed.importance, TaskImportance::High);
        let done = Task { completed: true, ..parsed.clone() };
        let ics2 = task_ics(Some(&ics), "t1", &done);
        assert!(parse_task(&ics2, "t1.ics").unwrap().completed);
        assert_eq!(ics2.matches("BEGIN:VTODO").count(), 1);
    }

    #[test]
    fn folds_and_unfolds_long_lines() {
        let long = "ä".repeat(100);
        let input = EventInput { title: long.clone(), start: Utc::now(), end: Utc::now(), ..Default::default() };
        let ics = new_event_ics("u", &input, None);
        assert!(ics.lines().all(|l| l.len() <= 76));
        let cal = parse(&ics);
        assert_eq!(cal[0].children[0].text("SUMMARY"), long);
    }
}
