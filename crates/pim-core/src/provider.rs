//! What calendar/contact/task adapters implement.

use std::collections::HashMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use nexora_mail_core::{Error, Result};

use crate::model::*;

/// A calendar / address book / task list as reported by the server.
#[derive(Debug, Clone)]
pub struct RemoteCollection {
    pub remote_id: String,
    pub kind: CollectionKind,
    pub name: String,
    pub color: Option<String>,
    pub read_only: bool,
    pub is_default: bool,
}

impl From<&Collection> for RemoteCollection {
    fn from(c: &Collection) -> Self {
        Self {
            remote_id: c.remote_id.clone(),
            kind: c.kind,
            name: c.name.clone(),
            color: c.color.clone(),
            read_only: c.read_only,
            is_default: c.is_default,
        }
    }
}

/// Time range that is mirrored locally.
#[derive(Debug, Clone, Copy)]
pub struct Window {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

/// One server resource and the occurrences it expands to.
#[derive(Debug, Clone)]
pub struct EventResource {
    pub resource_id: String,
    pub etag: Option<String>,
    pub raw: Option<String>,
    pub events: Vec<Event>,
}

#[derive(Debug)]
pub struct Changes<T> {
    pub upserted: Vec<T>,
    /// Resource ids that disappeared.
    pub removed: Vec<String>,
    /// Drop everything local before applying.
    pub reset: bool,
    pub new_state: Option<String>,
}

impl<T> Default for Changes<T> {
    fn default() -> Self {
        Self { upserted: Vec::new(), removed: Vec::new(), reset: false, new_state: None }
    }
}

/// Resource id → etag of what is stored locally.
pub type Known = HashMap<String, Option<String>>;

fn unsupported<T>(what: &str) -> Result<T> {
    Err(Error::Unsupported(what.to_string()))
}


/// Answer to a meeting invitation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventResponse {
    Accept,
    Tentative,
    Decline,
}

impl EventResponse {
    pub fn partstat(self) -> &'static str {
        match self {
            EventResponse::Accept => "ACCEPTED",
            EventResponse::Tentative => "TENTATIVE",
            EventResponse::Decline => "DECLINED",
        }
    }
}

/// A busy period of someone's calendar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusySlot {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub status: ShowAs,
}

/// Free/busy information of one person.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub email: String,
    /// `false` if the server has no information about this address.
    pub known: bool,
    pub slots: Vec<BusySlot>,
}

#[async_trait]
pub trait PimProvider: Send + Sync {
    async fn list_collections(&self) -> Result<Vec<RemoteCollection>>;

    async fn sync_events(&self, _col: &RemoteCollection, _window: Window, _state: Option<&str>, _known: &Known) -> Result<Changes<EventResource>> {
        unsupported("calendar")
    }
    async fn create_event(&self, _col: &RemoteCollection, _input: &EventInput) -> Result<()> {
        unsupported("calendar")
    }
    async fn update_event(&self, _col: &RemoteCollection, _event: &Event, _input: &EventInput, _scope: EditScope) -> Result<()> {
        unsupported("calendar")
    }
    async fn delete_event(&self, _col: &RemoteCollection, _event: &Event, _scope: EditScope) -> Result<()> {
        unsupported("calendar")
    }

    /// Answer an invitation (sends the reply to the organizer where the
    /// server supports it).
    async fn respond_event(&self, _col: &RemoteCollection, _event: &Event, _response: EventResponse) -> Result<()> {
        unsupported("Antworten auf Einladungen")
    }
    /// Free/busy times of other people (scheduling assistant).
    async fn free_busy(&self, _emails: &[String], _start: DateTime<Utc>, _end: DateTime<Utc>) -> Result<Vec<Availability>> {
        unsupported("Frei/Gebucht")
    }
    /// Store a calendar object (e.g. from an e-mail invitation) as is.
    async fn import_ics(&self, _col: &RemoteCollection, _ics: &str) -> Result<()> {
        unsupported("iCalendar-Import")
    }

    async fn sync_contacts(&self, _col: &RemoteCollection, _state: Option<&str>, _known: &Known) -> Result<Changes<Contact>> {
        unsupported("contacts")
    }
    /// Create (empty `remote_id`) or update a contact.
    async fn save_contact(&self, _col: &RemoteCollection, _contact: &Contact) -> Result<()> {
        unsupported("contacts")
    }
    async fn delete_contact(&self, _col: &RemoteCollection, _contact: &Contact) -> Result<()> {
        unsupported("contacts")
    }

    async fn sync_tasks(&self, _col: &RemoteCollection, _state: Option<&str>, _known: &Known) -> Result<Changes<Task>> {
        unsupported("tasks")
    }
    /// Create (empty `remote_id`) or update a task.
    async fn save_task(&self, _col: &RemoteCollection, _task: &Task) -> Result<()> {
        unsupported("tasks")
    }
    async fn delete_task(&self, _col: &RemoteCollection, _task: &Task) -> Result<()> {
        unsupported("tasks")
    }
}
