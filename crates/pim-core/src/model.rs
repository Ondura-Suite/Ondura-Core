//! Calendars, contacts and tasks. All types are serialised to the frontend.
//!
//! Times are UTC. All-day events start at 00:00 UTC of their first day and
//! end at 00:00 UTC of the day after their last day (exclusive); the UI
//! treats them as plain dates.

use chrono::{DateTime, NaiveDate, Utc};
use ondura_mail_core::model::Address;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type CollectionId = String;

/// Account id of the built-in local store (no server).
pub const LOCAL_ACCOUNT: &str = "local";

const ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d69_7272_612d_7069_6d2d_6964_732d_0001);

pub fn collection_id(account_id: &str, remote_id: &str) -> CollectionId {
    Uuid::new_v5(&ID_NAMESPACE, format!("{account_id}/c/{remote_id}").as_bytes()).to_string()
}

pub fn item_id(collection_id: &str, remote_id: &str) -> String {
    Uuid::new_v5(&ID_NAMESPACE, format!("{collection_id}/i/{remote_id}").as_bytes()).to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CollectionKind {
    Calendar,
    Contacts,
    Tasks,
}

impl CollectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CollectionKind::Calendar => "calendar",
            CollectionKind::Contacts => "contacts",
            CollectionKind::Tasks => "tasks",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "contacts" => CollectionKind::Contacts,
            "tasks" => CollectionKind::Tasks,
            _ => CollectionKind::Calendar,
        }
    }
}

/// A calendar, address book or task list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: CollectionId,
    pub account_id: String,
    pub remote_id: String,
    pub kind: CollectionKind,
    pub name: String,
    pub color: Option<String>,
    pub read_only: bool,
    /// Shown in the calendar (user setting, kept across syncs).
    pub visible: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Freq {
    Daily,
    #[default]
    Weekly,
    Monthly,
    Yearly,
}

/// One step of a task's checklist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskStep {
    pub title: String,
    #[serde(default)]
    pub done: bool,
}

/// The recurrence patterns the editor offers (a subset of RRULE).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub freq: Freq,
    #[serde(default = "one")]
    pub interval: u32,
    /// Weekdays for weekly rules: "MO" … "SU".
    #[serde(default)]
    pub by_day: Vec<String>,
    #[serde(default)]
    pub until: Option<NaiveDate>,
    #[serde(default)]
    pub count: Option<u32>,
}

fn one() -> u32 {
    1
}

pub const WEEKDAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

impl Recurrence {
    /// Next date of the pattern after `from` (used for recurring tasks).
    /// `None` when the pattern ends before.
    pub fn next_date(&self, from: NaiveDate) -> Option<NaiveDate> {
        use chrono::{Datelike, Duration, Months};
        let n = self.interval.max(1);
        let next = match self.freq {
            Freq::Daily => from + Duration::days(n as i64),
            Freq::Weekly => {
                const DAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
                let wanted: Vec<u32> = self.by_day.iter().filter_map(|d| DAYS.iter().position(|x| x == d).map(|i| i as u32)).collect();
                let today = from.weekday().num_days_from_monday();
                match wanted.iter().copied().filter(|d| *d > today).min() {
                    Some(d) => from + Duration::days((d - today) as i64),
                    None => {
                        let first = wanted.iter().copied().min().unwrap_or(today);
                        let monday = from - Duration::days(today as i64) + Duration::weeks(n as i64);
                        monday + Duration::days(first as i64)
                    }
                }
            }
            Freq::Monthly => from.checked_add_months(Months::new(n))?,
            Freq::Yearly => from.checked_add_months(Months::new(12 * n))?,
        };
        match self.until {
            Some(u) if next > u => None,
            _ => Some(next),
        }
    }

    pub fn to_rrule(&self) -> String {
        let freq = match self.freq {
            Freq::Daily => "DAILY",
            Freq::Weekly => "WEEKLY",
            Freq::Monthly => "MONTHLY",
            Freq::Yearly => "YEARLY",
        };
        let mut r = format!("FREQ={freq}");
        if self.interval > 1 {
            r.push_str(&format!(";INTERVAL={}", self.interval));
        }
        if self.freq == Freq::Weekly && !self.by_day.is_empty() {
            r.push_str(&format!(";BYDAY={}", self.by_day.join(",")));
        }
        if let Some(c) = self.count {
            r.push_str(&format!(";COUNT={c}"));
        } else if let Some(u) = self.until {
            r.push_str(&format!(";UNTIL={}T235959Z", u.format("%Y%m%d")));
        }
        r
    }

    /// Parse an RRULE value; `None` for rules the editor cannot represent.
    pub fn from_rrule(rule: &str) -> Option<Self> {
        let mut rec = Recurrence { interval: 1, ..Default::default() };
        let mut freq = None;
        for part in rule.split(';') {
            let (k, v) = part.split_once('=')?;
            match k.to_ascii_uppercase().as_str() {
                "FREQ" => {
                    freq = Some(match v {
                        "DAILY" => Freq::Daily,
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        _ => return None,
                    })
                }
                "INTERVAL" => rec.interval = v.parse().ok()?,
                "BYDAY" => {
                    for d in v.split(',') {
                        if !WEEKDAYS.contains(&d) {
                            return None; // "1MO", "-1FR" etc.
                        }
                        rec.by_day.push(d.to_string());
                    }
                }
                "COUNT" => rec.count = v.parse().ok(),
                "UNTIL" => rec.until = NaiveDate::parse_from_str(&v[..8.min(v.len())], "%Y%m%d").ok(),
                "WKST" => {}
                _ => return None,
            }
        }
        rec.freq = freq?;
        if rec.freq != Freq::Weekly && !rec.by_day.is_empty() {
            return None;
        }
        Some(rec)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ShowAs {
    Free,
    Tentative,
    #[default]
    Busy,
    OutOfOffice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub address: Address,
    /// accepted, declined, tentative, needsAction
    pub response: String,
    pub required: bool,
}

/// One occurrence of an event (recurring events are stored expanded).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub collection_id: CollectionId,
    pub account_id: String,
    /// Id of this occurrence on the server.
    pub remote_id: String,
    /// Server resource holding the event (DAV href, Graph/EWS item id).
    pub resource_id: String,
    /// Id of the series (all occurrences share it); `None` for single events.
    pub series_id: Option<String>,
    pub title: String,
    pub location: String,
    pub body: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    pub is_recurring: bool,
    pub recurrence: Option<Recurrence>,
    /// Raw RRULE for rules the editor cannot show.
    pub rrule: Option<String>,
    pub reminder_minutes: Option<i32>,
    pub show_as: ShowAs,
    pub organizer: Option<Address>,
    pub attendees: Vec<Attendee>,
    pub is_cancelled: bool,
    pub online_meeting_url: Option<String>,
    /// Own answer to the invitation: "accepted", "tentative", "declined",
    /// "needsAction" or "organizer"; `None` for events without invitation.
    #[serde(default)]
    pub my_response: Option<String>,
    /// Colour categories, like in Outlook.
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(skip)]
    pub etag: Option<String>,
    #[serde(skip)]
    pub raw: Option<String>,
}

/// What the editor sends when creating or changing an event.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub title: String,
    #[serde(default)]
    pub location: String,
    /// `None` keeps the existing description.
    #[serde(default)]
    pub body: Option<String>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub recurrence: Option<Recurrence>,
    /// Unchanged complex rule (when `recurrence` is `None`).
    #[serde(default)]
    pub rrule: Option<String>,
    #[serde(default)]
    pub reminder_minutes: Option<i32>,
    #[serde(default)]
    pub show_as: ShowAs,
    #[serde(default)]
    pub attendees: Vec<Address>,
    #[serde(default)]
    pub categories: Vec<String>,
    /// Create a Teams meeting (Microsoft 365).
    #[serde(default)]
    pub online_meeting: bool,
}

impl EventInput {
    pub fn rule(&self) -> Option<String> {
        self.recurrence.as_ref().map(Recurrence::to_rrule).or_else(|| self.rrule.clone())
    }
}

/// Someone's access to a shared calendar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarPermission {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub name: Option<String>,
    /// freeBusyRead, limitedRead, read, write, delegateWithoutPrivateEventAccess, delegateWithPrivateEventAccess
    pub role: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditScope {
    /// Only this occurrence of a series.
    Occurrence,
    /// The whole series (or the single event).
    Series,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Labeled {
    /// work, home, mobile, other
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PostalAddress {
    pub label: String,
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub country: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub collection_id: CollectionId,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub remote_id: String,
    pub display_name: String,
    #[serde(default)]
    pub given_name: String,
    #[serde(default)]
    pub family_name: String,
    #[serde(default)]
    pub company: String,
    #[serde(default)]
    pub job_title: String,
    #[serde(default)]
    pub emails: Vec<Labeled>,
    #[serde(default)]
    pub phones: Vec<Labeled>,
    #[serde(default)]
    pub addresses: Vec<PostalAddress>,
    #[serde(default)]
    pub birthday: Option<NaiveDate>,
    #[serde(default)]
    pub notes: String,
    /// Contact groups (vCard CATEGORIES / Outlook categories).
    #[serde(default)]
    pub groups: Vec<String>,
    /// Photo as data URI (`data:image/jpeg;base64,…`).
    #[serde(default)]
    pub photo: Option<String>,
    #[serde(skip)]
    pub etag: Option<String>,
    #[serde(skip)]
    pub raw: Option<String>,
}

impl Contact {
    /// Display name, falling back to "Given Family", company or e-mail.
    pub fn effective_name(&self) -> String {
        let name = self.display_name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
        let full = format!("{} {}", self.given_name, self.family_name).trim().to_string();
        if !full.is_empty() {
            return full;
        }
        if !self.company.is_empty() {
            return self.company.clone();
        }
        self.emails.first().map(|e| e.value.clone()).unwrap_or_default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TaskImportance {
    Low,
    #[default]
    Normal,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub collection_id: CollectionId,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub remote_id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub due: Option<NaiveDate>,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub importance: TaskImportance,
    /// Checklist ("Schritte" in Microsoft To Do).
    #[serde(default)]
    pub steps: Vec<TaskStep>,
    /// Repeats relative to the due date.
    #[serde(default)]
    pub recurrence: Option<Recurrence>,
    /// Reminder time.
    #[serde(default)]
    pub reminder: Option<DateTime<Utc>>,
    /// People the task is assigned to (Microsoft Planner).
    #[serde(default)]
    pub assignees: Vec<Address>,
    #[serde(default = "Utc::now")]
    pub created: DateTime<Utc>,
    #[serde(skip)]
    pub etag: Option<String>,
    #[serde(skip)]
    pub raw: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rrule_roundtrip() {
        let r = Recurrence { freq: Freq::Weekly, interval: 2, by_day: vec!["MO".into(), "WE".into()], until: None, count: Some(10) };
        let s = r.to_rrule();
        assert_eq!(s, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10");
        assert_eq!(Recurrence::from_rrule(&s), Some(r));
        assert!(Recurrence::from_rrule("FREQ=MONTHLY;BYDAY=-1FR").is_none(), "editor cannot show it");
        let until = Recurrence::from_rrule("FREQ=DAILY;UNTIL=20261231T235959Z").unwrap();
        assert_eq!(until.until, NaiveDate::from_ymd_opt(2026, 12, 31));
    }
}
