//! Providers that store each item as an iCalendar/vCard resource: CalDAV /
//! CardDAV servers and the local store. Both share all parsing, recurrence
//! expansion and editing logic; only the transport differs.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use nexora_mail_core::model::Address;
use nexora_mail_core::{Error, Result};

use crate::ical;
use crate::model::*;
use crate::provider::*;
use crate::store::PimStore;
use crate::vcard;

/// Transport for resource-based providers.
#[async_trait]
pub trait ResourceBackend: Send + Sync {
    async fn collections(&self) -> Result<Vec<RemoteCollection>>;
    /// href → etag of all resources, plus a collection version (CTag) if known.
    async fn list(&self, col: &RemoteCollection) -> Result<(HashMap<String, String>, Option<String>)>;
    /// (href, etag, data) for the requested resources.
    async fn fetch(&self, col: &RemoteCollection, hrefs: &[String]) -> Result<Vec<(String, String, String)>>;
    /// Create (`href = None`) or replace a resource; returns its href.
    async fn put(&self, col: &RemoteCollection, href: Option<&str>, name: &str, data: &str, etag: Option<&str>) -> Result<String>;
    async fn delete(&self, col: &RemoteCollection, href: &str, etag: Option<&str>) -> Result<()>;
    /// Organizer for invitations.
    fn owner(&self) -> Option<Address>;
}

pub struct ResourceProvider<B> {
    backend: B,
}

impl<B: ResourceBackend> ResourceProvider<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    /// Changed hrefs (by etag) and removed ones; shared by all item kinds.
    async fn diff(&self, col: &RemoteCollection, state: Option<&str>, known: &Known) -> Result<Option<(Vec<(String, String, String)>, Vec<String>, Option<String>)>> {
        let (list, ctag) = self.backend.list(col).await?;
        if ctag.is_some() && ctag.as_deref() == state && list.len() == known.len() {
            return Ok(None); // nothing changed
        }
        let changed: Vec<String> = list
            .iter()
            .filter(|(href, etag)| known.get(*href).and_then(|e| e.as_deref()) != Some(etag.as_str()))
            .map(|(href, _)| href.clone())
            .collect();
        let removed: Vec<String> = known.keys().filter(|k| !list.contains_key(*k)).cloned().collect();
        let mut fetched = Vec::new();
        for chunk in changed.chunks(50) {
            fetched.extend(self.backend.fetch(col, chunk).await?);
        }
        Ok(Some((fetched, removed, ctag.or_else(|| Some(String::new())))))
    }
}

fn resource_name(uid: &str, ext: &str) -> String {
    format!("{uid}.{ext}")
}

#[async_trait]
impl<B: ResourceBackend> PimProvider for ResourceProvider<B> {
    async fn list_collections(&self) -> Result<Vec<RemoteCollection>> {
        self.backend.collections().await
    }

    async fn sync_events(&self, col: &RemoteCollection, window: Window, state: Option<&str>, known: &Known) -> Result<Changes<EventResource>> {
        // The expansion window moves; a missing state means "expand everything again".
        let known = if state.is_none() { &Known::new() } else { known };
        let Some((fetched, removed, ctag)) = self.diff(col, state, known).await? else {
            return Ok(Changes::default());
        };
        let upserted = fetched
            .into_iter()
            .filter(|(_, _, data)| data.contains("BEGIN:VEVENT"))
            .map(|(href, etag, data)| EventResource {
                events: ical::expand_events(&data, &href, (window.start, window.end)),
                resource_id: href,
                etag: Some(etag),
                raw: Some(data),
            })
            .collect();
        Ok(Changes { upserted, removed, reset: state.is_none(), new_state: ctag })
    }

    async fn create_event(&self, col: &RemoteCollection, input: &EventInput) -> Result<()> {
        let uid = uuid::Uuid::new_v4().to_string();
        let ics = ical::new_event_ics(&uid, input, self.backend.owner().as_ref());
        self.backend.put(col, None, &resource_name(&uid, "ics"), &ics, None).await.map(|_| ())
    }

    async fn update_event(&self, col: &RemoteCollection, event: &Event, input: &EventInput, scope: EditScope) -> Result<()> {
        let raw = event.raw.as_deref().ok_or_else(|| Error::Other("Termin ohne Rohdaten".into()))?;
        let ics = ical::update_event_ics(raw, event, input, scope, self.backend.owner().as_ref()).map_err(Error::Other)?;
        self.backend.put(col, Some(&event.resource_id), "", &ics, event.etag.as_deref()).await.map(|_| ())
    }

    async fn delete_event(&self, col: &RemoteCollection, event: &Event, scope: EditScope) -> Result<()> {
        if event.is_recurring && scope == EditScope::Occurrence {
            let raw = event.raw.as_deref().ok_or_else(|| Error::Other("Termin ohne Rohdaten".into()))?;
            let ics = ical::delete_occurrence_ics(raw, event).map_err(Error::Other)?;
            return self.backend.put(col, Some(&event.resource_id), "", &ics, event.etag.as_deref()).await.map(|_| ());
        }
        self.backend.delete(col, &event.resource_id, event.etag.as_deref()).await
    }

    async fn sync_contacts(&self, col: &RemoteCollection, state: Option<&str>, known: &Known) -> Result<Changes<Contact>> {
        let Some((fetched, removed, ctag)) = self.diff(col, state, known).await? else {
            return Ok(Changes::default());
        };
        let upserted = fetched
            .into_iter()
            .filter_map(|(href, etag, data)| {
                let mut c = vcard::parse_contact(&data, &href)?;
                c.etag = Some(etag);
                c.raw = Some(data);
                Some(c)
            })
            .collect();
        Ok(Changes { upserted, removed, reset: false, new_state: ctag })
    }

    async fn save_contact(&self, col: &RemoteCollection, contact: &Contact) -> Result<()> {
        if contact.remote_id.is_empty() {
            let uid = uuid::Uuid::new_v4().to_string();
            let card = vcard::contact_vcard(contact.raw.as_deref(), &uid, contact);
            self.backend.put(col, None, &resource_name(&uid, "vcf"), &card, None).await.map(|_| ())
        } else {
            let card = vcard::contact_vcard(contact.raw.as_deref(), "", contact);
            self.backend.put(col, Some(&contact.remote_id), "", &card, contact.etag.as_deref()).await.map(|_| ())
        }
    }

    async fn delete_contact(&self, col: &RemoteCollection, contact: &Contact) -> Result<()> {
        self.backend.delete(col, &contact.remote_id, contact.etag.as_deref()).await
    }

    async fn sync_tasks(&self, col: &RemoteCollection, state: Option<&str>, known: &Known) -> Result<Changes<Task>> {
        let Some((fetched, removed, ctag)) = self.diff(col, state, known).await? else {
            return Ok(Changes::default());
        };
        let upserted = fetched
            .into_iter()
            .filter_map(|(href, etag, data)| {
                let mut t = ical::parse_task(&data, &href)?;
                t.etag = Some(etag);
                t.raw = Some(data);
                Some(t)
            })
            .collect();
        Ok(Changes { upserted, removed, reset: false, new_state: ctag })
    }

    async fn save_task(&self, col: &RemoteCollection, task: &Task) -> Result<()> {
        if task.remote_id.is_empty() {
            let uid = uuid::Uuid::new_v4().to_string();
            let ics = ical::task_ics(None, &uid, task);
            self.backend.put(col, None, &resource_name(&uid, "ics"), &ics, None).await.map(|_| ())
        } else {
            let ics = ical::task_ics(task.raw.as_deref(), "", task);
            self.backend.put(col, Some(&task.remote_id), "", &ics, task.etag.as_deref()).await.map(|_| ())
        }
    }

    async fn delete_task(&self, col: &RemoteCollection, task: &Task) -> Result<()> {
        self.backend.delete(col, &task.remote_id, task.etag.as_deref()).await
    }
}

// ------------------------------------------------------------------- local

/// Resources kept in `pim.sqlite` (no server).
pub struct LocalBackend {
    store: Arc<PimStore>,
}

impl LocalBackend {
    pub fn new(store: Arc<PimStore>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl ResourceBackend for LocalBackend {
    async fn collections(&self) -> Result<Vec<RemoteCollection>> {
        Ok(self.store.collections_of(LOCAL_ACCOUNT)?.iter().map(RemoteCollection::from).collect())
    }

    async fn list(&self, col: &RemoteCollection) -> Result<(HashMap<String, String>, Option<String>)> {
        let id = collection_id(LOCAL_ACCOUNT, &col.remote_id);
        let list: HashMap<String, String> = self.store.local_list(&id)?.into_iter().collect();
        // Version = sorted etags, so unchanged collections are skipped cheaply.
        let mut etags: Vec<&String> = list.values().collect();
        etags.sort();
        let ctag = format!("{}:{}", list.len(), etags.iter().map(|e| e.get(..8).unwrap_or(e)).collect::<String>());
        Ok((list, Some(ctag)))
    }

    async fn fetch(&self, col: &RemoteCollection, hrefs: &[String]) -> Result<Vec<(String, String, String)>> {
        let id = collection_id(LOCAL_ACCOUNT, &col.remote_id);
        let mut out = Vec::new();
        for href in hrefs {
            if let Some((etag, data)) = self.store.local_get(&id, href)? {
                out.push((href.clone(), etag, data));
            }
        }
        Ok(out)
    }

    async fn put(&self, col: &RemoteCollection, href: Option<&str>, name: &str, data: &str, _etag: Option<&str>) -> Result<String> {
        let id = collection_id(LOCAL_ACCOUNT, &col.remote_id);
        let href = href.map(str::to_string).unwrap_or_else(|| name.to_string());
        self.store.local_put(&id, &href, &uuid::Uuid::new_v4().to_string(), data)?;
        Ok(href)
    }

    async fn delete(&self, col: &RemoteCollection, href: &str, _etag: Option<&str>) -> Result<()> {
        self.store.local_delete(&collection_id(LOCAL_ACCOUNT, &col.remote_id), href)
    }

    fn owner(&self) -> Option<Address> {
        None
    }
}
