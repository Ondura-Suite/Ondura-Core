//! Keeps calendars, contacts and tasks of all accounts in sync and performs
//! edits (server first, then a re-sync of the affected collection).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use chrono::{Duration as Span, Utc};
use nexora_mail_core::{Error, Result};
use serde::Serialize;
use tokio::sync::broadcast;
use tracing::{debug, warn};

use crate::model::*;
use crate::provider::*;
use crate::resource::{LocalBackend, ResourceProvider};
use crate::store::PimStore;

/// Mirrored time range around today.
const WINDOW_PAST_DAYS: i64 = 180;
const WINDOW_FUTURE_DAYS: i64 = 540;
/// Re-expand recurring events when the window has moved this far.
const WINDOW_REFRESH_DAYS: i64 = 30;
const SYNC_INTERVAL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PimEvent {
    #[serde(rename_all = "camelCase")]
    Changed { kind: CollectionKind, account_id: String },
    #[serde(rename_all = "camelCase")]
    CollectionsChanged { account_id: String },
    #[serde(rename_all = "camelCase")]
    Reminder { event_id: String, title: String, start: chrono::DateTime<Utc>, location: String, all_day: bool },
    #[serde(rename_all = "camelCase")]
    Error { account_id: String, message: String },
}

pub struct PimEngine {
    store: Arc<PimStore>,
    providers: RwLock<HashMap<String, Arc<dyn PimProvider>>>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    reminded: Mutex<HashSet<(String, i64)>>,
    events: broadcast::Sender<PimEvent>,
}

pub fn window() -> Window {
    let now = Utc::now();
    Window { start: now - Span::days(WINDOW_PAST_DAYS), end: now + Span::days(WINDOW_FUTURE_DAYS) }
}

impl PimEngine {
    /// Creates the engine with the local account (and default collections on first start).
    pub fn new(store: Arc<PimStore>) -> Result<Arc<Self>> {
        if store.collections_of(LOCAL_ACCOUNT)?.is_empty() {
            store.create_local_collection(CollectionKind::Calendar, "Kalender", Some("#4f54d4"), true)?;
            store.create_local_collection(CollectionKind::Contacts, "Kontakte", None, true)?;
            store.create_local_collection(CollectionKind::Tasks, "Aufgaben", None, true)?;
        }
        let (events, _) = broadcast::channel(256);
        let engine = Arc::new(Self {
            store: Arc::clone(&store),
            providers: RwLock::default(),
            locks: Mutex::default(),
            reminded: Mutex::default(),
            events,
        });
        engine
            .providers
            .write()
            .unwrap()
            .insert(LOCAL_ACCOUNT.into(), Arc::new(ResourceProvider::new(LocalBackend::new(store))));
        Ok(engine)
    }

    pub fn store(&self) -> &Arc<PimStore> {
        &self.store
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PimEvent> {
        self.events.subscribe()
    }

    fn emit(&self, e: PimEvent) {
        let _ = self.events.send(e);
    }

    pub fn register(&self, account_id: &str, provider: Arc<dyn PimProvider>) {
        self.providers.write().unwrap().insert(account_id.to_string(), provider);
    }

    /// Remove an account and its local data.
    pub fn unregister(&self, account_id: &str) -> Result<()> {
        self.providers.write().unwrap().remove(account_id);
        self.store.delete_account(account_id)?;
        self.emit(PimEvent::CollectionsChanged { account_id: account_id.into() });
        Ok(())
    }

    fn provider(&self, account_id: &str) -> Result<Arc<dyn PimProvider>> {
        self.providers
            .read()
            .unwrap()
            .get(account_id)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("account {account_id} is not connected")))
    }

    fn lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().unwrap().entry(key.to_string()).or_default().clone()
    }

    pub fn account_ids(&self) -> Vec<String> {
        self.providers.read().unwrap().keys().cloned().collect()
    }

    // -------------------------------------------------------------------- sync

    pub async fn sync_all(&self) {
        for id in self.account_ids() {
            if let Err(e) = self.sync_account(&id).await {
                warn!(account = id, error = %e, "PIM sync failed");
                if !matches!(e, Error::Unsupported(_)) {
                    self.emit(PimEvent::Error { account_id: id, message: e.to_string() });
                }
            }
        }
    }

    pub async fn sync_account(&self, account_id: &str) -> Result<()> {
        let lock = self.lock(account_id);
        let Ok(_g) = lock.try_lock() else { return Ok(()) };
        let provider = self.provider(account_id)?;
        let remote = provider.list_collections().await?;
        if account_id != LOCAL_ACCOUNT {
            self.store.sync_collections(account_id, &remote)?;
        }
        self.emit(PimEvent::CollectionsChanged { account_id: account_id.into() });
        let mut first_err = None;
        for col in self.store.collections_of(account_id)? {
            if let Err(e) = self.sync_collection_with(&*provider, &col).await {
                debug!(collection = col.name, error = %e, "collection sync failed");
                if matches!(e, Error::Network(_) | Error::Auth(_)) {
                    return Err(e);
                }
                first_err.get_or_insert(e);
            }
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    async fn sync_collection_with(&self, provider: &dyn PimProvider, col: &Collection) -> Result<()> {
        let remote = RemoteCollection::from(col);
        let (state, synced_from) = self.store.collection_state(&col.id)?;
        match col.kind {
            CollectionKind::Calendar => {
                let w = window();
                // Re-expand when the window has moved (recurrences, ranges).
                let fresh = synced_from.is_some_and(|f| (w.start.timestamp() - f) < WINDOW_REFRESH_DAYS * 86_400);
                let state = if fresh { state } else { None };
                let known = self.store.known_event_resources(&col.id)?;
                let changes = provider.sync_events(&remote, w, state.as_deref(), &known).await?;
                let changed = changes.reset || !changes.upserted.is_empty() || !changes.removed.is_empty();
                self.store.apply_event_changes(col, &changes, w.start.timestamp())?;
                if changed {
                    self.emit(PimEvent::Changed { kind: col.kind, account_id: col.account_id.clone() });
                }
            }
            CollectionKind::Contacts => {
                let known = self.store.known_contacts(&col.id)?;
                let changes = provider.sync_contacts(&remote, state.as_deref(), &known).await?;
                let changed = changes.reset || !changes.upserted.is_empty() || !changes.removed.is_empty();
                self.store.apply_contact_changes(col, &changes)?;
                if changed {
                    self.emit(PimEvent::Changed { kind: col.kind, account_id: col.account_id.clone() });
                }
            }
            CollectionKind::Tasks => {
                let known = self.store.known_tasks(&col.id)?;
                let changes = provider.sync_tasks(&remote, state.as_deref(), &known).await?;
                let changed = changes.reset || !changes.upserted.is_empty() || !changes.removed.is_empty();
                self.store.apply_task_changes(col, &changes)?;
                if changed {
                    self.emit(PimEvent::Changed { kind: col.kind, account_id: col.account_id.clone() });
                }
            }
        }
        Ok(())
    }

    pub async fn sync_collection(&self, collection_id: &str) -> Result<()> {
        let col = self.store.get_collection(collection_id)?;
        let provider = self.provider(&col.account_id)?;
        self.sync_collection_with(&*provider, &col).await
    }

    /// Periodic sync and reminder checks.
    pub fn start(self: &Arc<Self>) {
        let engine = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                engine.sync_all().await;
                tokio::time::sleep(SYNC_INTERVAL).await;
            }
        });
        let engine = Arc::clone(self);
        tokio::spawn(async move {
            let mut last = Utc::now();
            loop {
                tokio::time::sleep(Duration::from_secs(20)).await;
                let now = Utc::now();
                engine.check_reminders(last, now);
                last = now;
            }
        });
    }

    fn check_reminders(&self, from: chrono::DateTime<Utc>, to: chrono::DateTime<Utc>) {
        let Ok(due) = self.store.reminders_due(from, to) else { return };
        for e in due {
            let key = (e.id.clone(), e.start.timestamp());
            if self.reminded.lock().unwrap().insert(key) {
                self.emit(PimEvent::Reminder { event_id: e.id, title: e.title, start: e.start, location: e.location, all_day: e.all_day });
            }
        }
    }

    // ------------------------------------------------------------------ events

    fn writable(&self, collection_id: &str) -> Result<(Collection, Arc<dyn PimProvider>)> {
        let col = self.store.get_collection(collection_id)?;
        if col.read_only {
            return Err(Error::Unsupported("Dieser Kalender ist schreibgeschützt".into()));
        }
        let provider = self.provider(&col.account_id)?;
        Ok((col, provider))
    }

    async fn after_write(&self, col: &Collection, provider: &dyn PimProvider) -> Result<()> {
        self.sync_collection_with(provider, col).await?;
        self.emit(PimEvent::Changed { kind: col.kind, account_id: col.account_id.clone() });
        Ok(())
    }

    pub async fn create_event(&self, collection_id: &str, input: &EventInput) -> Result<()> {
        validate_event(input)?;
        let (col, provider) = self.writable(collection_id)?;
        provider.create_event(&RemoteCollection::from(&col), input).await?;
        self.after_write(&col, &*provider).await
    }

    pub async fn update_event(&self, event_id: &str, input: &EventInput, scope: EditScope) -> Result<()> {
        validate_event(input)?;
        let event = self.store.get_event(event_id)?;
        let (col, provider) = self.writable(&event.collection_id)?;
        provider.update_event(&RemoteCollection::from(&col), &event, input, scope).await?;
        self.after_write(&col, &*provider).await
    }

    /// Move an event to another calendar of the same account.
    pub async fn move_event(&self, event_id: &str, target_collection_id: &str) -> Result<()> {
        let event = self.store.get_event(event_id)?;
        if event.collection_id == target_collection_id {
            return Ok(());
        }
        let input = EventInput {
            title: event.title.clone(),
            location: event.location.clone(),
            body: Some(event.body.clone()),
            start: event.start,
            end: event.end,
            all_day: event.all_day,
            recurrence: event.recurrence.clone(),
            rrule: event.rrule.clone(),
            reminder_minutes: event.reminder_minutes,
            show_as: event.show_as,
            attendees: event.attendees.iter().map(|a| a.address.clone()).collect(),
        };
        self.create_event(target_collection_id, &input).await?;
        self.delete_event(event_id, EditScope::Series).await
    }

    pub async fn delete_event(&self, event_id: &str, scope: EditScope) -> Result<()> {
        let event = self.store.get_event(event_id)?;
        let (col, provider) = self.writable(&event.collection_id)?;
        provider.delete_event(&RemoteCollection::from(&col), &event, scope).await?;
        self.after_write(&col, &*provider).await
    }

    // ---------------------------------------------------------------- contacts

    pub async fn save_contact(&self, collection_id: &str, contact: &Contact) -> Result<()> {
        if contact.effective_name().trim().is_empty() {
            return Err(Error::Other("Bitte einen Namen oder eine E-Mail-Adresse angeben".into()));
        }
        let (col, provider) = self.writable(collection_id)?;
        let mut c = contact.clone();
        // Keep server data (raw/etag) of the stored version.
        if !c.id.is_empty()
            && let Ok(stored) = self.store.get_contact(&c.id)
        {
            c.raw = stored.raw;
            c.etag = stored.etag;
            c.remote_id = stored.remote_id;
        }
        provider.save_contact(&RemoteCollection::from(&col), &c).await?;
        self.after_write(&col, &*provider).await
    }

    pub async fn delete_contact(&self, contact_id: &str) -> Result<()> {
        let contact = self.store.get_contact(contact_id)?;
        let (col, provider) = self.writable(&contact.collection_id)?;
        provider.delete_contact(&RemoteCollection::from(&col), &contact).await?;
        self.after_write(&col, &*provider).await
    }

    // ------------------------------------------------------------------- tasks

    pub async fn save_task(&self, collection_id: &str, task: &Task) -> Result<()> {
        if task.title.trim().is_empty() {
            return Err(Error::Other("Die Aufgabe braucht einen Titel".into()));
        }
        let (col, provider) = self.writable(collection_id)?;
        let mut t = task.clone();
        if !t.id.is_empty()
            && let Ok(stored) = self.store.get_task(&t.id)
        {
            t.raw = stored.raw;
            t.etag = stored.etag;
            t.remote_id = stored.remote_id;
            if t.completed && !stored.completed {
                t.completed_at = Some(Utc::now());
            }
        }
        provider.save_task(&RemoteCollection::from(&col), &t).await?;
        self.after_write(&col, &*provider).await
    }

    pub async fn delete_task(&self, task_id: &str) -> Result<()> {
        let task = self.store.get_task(task_id)?;
        let (col, provider) = self.writable(&task.collection_id)?;
        provider.delete_task(&RemoteCollection::from(&col), &task).await?;
        self.after_write(&col, &*provider).await
    }

    // ------------------------------------------------------------- collections

    pub fn create_local_collection(&self, kind: CollectionKind, name: &str, color: Option<&str>) -> Result<Collection> {
        let c = self.store.create_local_collection(kind, name, color, false)?;
        self.emit(PimEvent::CollectionsChanged { account_id: LOCAL_ACCOUNT.into() });
        Ok(c)
    }

    pub fn delete_local_collection(&self, id: &str) -> Result<()> {
        let col = self.store.get_collection(id)?;
        if col.account_id != LOCAL_ACCOUNT {
            return Err(Error::Unsupported("Nur lokale Sammlungen können hier gelöscht werden".into()));
        }
        if col.is_default {
            return Err(Error::Unsupported("Die Standardsammlung kann nicht gelöscht werden".into()));
        }
        self.store.delete_collection(id)?;
        self.emit(PimEvent::CollectionsChanged { account_id: LOCAL_ACCOUNT.into() });
        Ok(())
    }
}

fn validate_event(input: &EventInput) -> Result<()> {
    if input.end < input.start {
        return Err(Error::Other("Das Ende liegt vor dem Beginn".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;

    fn engine() -> Arc<PimEngine> {
        PimEngine::new(Arc::new(PimStore::open_in_memory().unwrap())).unwrap()
    }

    fn default_of(e: &PimEngine, kind: CollectionKind) -> Collection {
        e.store().list_collections().unwrap().into_iter().find(|c| c.kind == kind && c.is_default).unwrap()
    }

    #[tokio::test]
    async fn local_calendar_roundtrip() {
        let e = engine();
        e.sync_all().await;
        let cal = default_of(&e, CollectionKind::Calendar);
        let start = Utc::now().date_naive().and_hms_opt(9, 0, 0).unwrap().and_utc() + Span::days(1);
        let input = EventInput {
            title: "Jour fixe".into(),
            start,
            end: start + Span::hours(1),
            recurrence: Some(Recurrence { freq: Freq::Daily, interval: 1, count: Some(3), ..Default::default() }),
            reminder_minutes: Some(10),
            ..Default::default()
        };
        e.create_event(&cal.id, &input).await.unwrap();
        let events = e.store().events_between(start - Span::days(1), start + Span::days(10)).unwrap();
        assert_eq!(events.len(), 3);

        // Change only the second occurrence, then delete the third.
        let second = events[1].clone();
        let moved = EventInput { title: "Jour fixe (später)".into(), start: second.start + Span::hours(2), end: second.end + Span::hours(2), ..input.clone() };
        e.update_event(&second.id, &moved, EditScope::Occurrence).await.unwrap();
        let events = e.store().events_between(start - Span::days(1), start + Span::days(10)).unwrap();
        assert!(events.iter().any(|ev| ev.title == "Jour fixe (später)"));
        let third = events.iter().max_by_key(|ev| ev.start).unwrap().clone();
        e.delete_event(&third.id, EditScope::Occurrence).await.unwrap();
        assert_eq!(e.store().events_between(start - Span::days(1), start + Span::days(10)).unwrap().len(), 2);

        // Reminders fire once.
        let mut rx = e.subscribe();
        let first = start - Span::minutes(10);
        e.check_reminders(first - Span::seconds(30), first);
        e.check_reminders(first - Span::seconds(30), first);
        let mut reminders = 0;
        while let Ok(ev) = rx.try_recv() {
            if matches!(ev, PimEvent::Reminder { .. }) {
                reminders += 1;
            }
        }
        assert_eq!(reminders, 1);

        // Hidden calendars are not listed.
        e.store().set_collection_visible(&cal.id, false).unwrap();
        assert!(e.store().events_between(start - Span::days(1), start + Span::days(10)).unwrap().is_empty());
    }

    #[tokio::test]
    async fn local_contacts_and_tasks() {
        let e = engine();
        let book = default_of(&e, CollectionKind::Contacts);
        let contact = Contact {
            display_name: "Anna Schmitt".into(),
            given_name: "Anna".into(),
            family_name: "Schmitt".into(),
            emails: vec![Labeled { label: "work".into(), value: "anna@example.com".into() }],
            ..Default::default()
        };
        e.save_contact(&book.id, &contact).await.unwrap();
        let found = e.store().list_contacts(None, Some("anna@ex"), 10).unwrap();
        assert_eq!(found.len(), 1);
        let mut edited = found[0].clone();
        edited.company = "Beispiel GmbH".into();
        e.save_contact(&book.id, &edited).await.unwrap();
        let all = e.store().list_contacts(Some(&book.id), None, 10).unwrap();
        assert_eq!(all.len(), 1, "updated in place");
        assert_eq!(all[0].company, "Beispiel GmbH");
        e.delete_contact(&all[0].id).await.unwrap();
        assert!(e.store().list_contacts(None, None, 10).unwrap().is_empty());

        let list = default_of(&e, CollectionKind::Tasks);
        let task = Task { title: "Angebot schreiben".into(), due: NaiveDate::from_ymd_opt(2026, 12, 1), ..Default::default() };
        e.save_task(&list.id, &task).await.unwrap();
        let mut t = e.store().list_tasks(Some(&list.id)).unwrap()[0].clone();
        t.completed = true;
        e.save_task(&list.id, &t).await.unwrap();
        let t = &e.store().list_tasks(Some(&list.id)).unwrap()[0];
        assert!(t.completed && t.completed_at.is_some());

        assert!(e.save_task(&list.id, &Task::default()).await.is_err(), "title required");
    }
}
