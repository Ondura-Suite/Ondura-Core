//! Local SQLite store for calendars, contacts and tasks (`pim.sqlite`).

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, Utc};
use ondura_mail_core::{Error, Result};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::model::*;
use crate::provider::{Changes, EventResource, Known, RemoteCollection};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    remote_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT,
    read_only   INTEGER NOT NULL DEFAULT 0,
    visible     INTEGER NOT NULL DEFAULT 1,
    is_default  INTEGER NOT NULL DEFAULT 0,
    sync_state  TEXT,
    synced_from INTEGER
);
CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    account_id    TEXT NOT NULL,
    remote_id     TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    etag          TEXT,
    series_id     TEXT,
    start         INTEGER NOT NULL,
    end           INTEGER NOT NULL,
    reminder      INTEGER,
    data          TEXT NOT NULL,
    raw           TEXT
);
CREATE INDEX IF NOT EXISTS events_range ON events(start, end);
CREATE INDEX IF NOT EXISTS events_resource ON events(collection_id, resource_id);
CREATE TABLE IF NOT EXISTS contacts (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    account_id    TEXT NOT NULL,
    remote_id     TEXT NOT NULL,
    etag          TEXT,
    name          TEXT NOT NULL,
    search        TEXT NOT NULL,
    data          TEXT NOT NULL,
    raw           TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    account_id    TEXT NOT NULL,
    remote_id     TEXT NOT NULL,
    etag          TEXT,
    data          TEXT NOT NULL,
    raw           TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_resources (
    collection_id TEXT NOT NULL,
    href          TEXT NOT NULL,
    etag          TEXT NOT NULL,
    data          TEXT NOT NULL,
    PRIMARY KEY (collection_id, href)
);
"#;

pub struct PimStore {
    conn: Mutex<Connection>,
}

impl PimStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("pim store poisoned")
    }

    // ---------------------------------------------------------------- settings

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn().query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn()
            .execute("INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    // ------------------------------------------------------------- collections

    fn collection_from_row(r: &Row<'_>) -> rusqlite::Result<Collection> {
        Ok(Collection {
            id: r.get("id")?,
            account_id: r.get("account_id")?,
            remote_id: r.get("remote_id")?,
            kind: CollectionKind::parse(&r.get::<_, String>("kind")?),
            name: r.get("name")?,
            color: r.get("color")?,
            read_only: r.get("read_only")?,
            visible: r.get("visible")?,
            is_default: r.get("is_default")?,
        })
    }

    /// Replace the collections of an account (kind-wise) with what the
    /// server reported; user settings (visibility, own colour) are kept.
    pub fn sync_collections(&self, account_id: &str, remote: &[RemoteCollection]) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let ids: Vec<String> = remote.iter().map(|c| collection_id(account_id, &c.remote_id)).collect();
        for (c, id) in remote.iter().zip(&ids) {
            tx.execute(
                "INSERT INTO collections(id, account_id, remote_id, kind, name, color, read_only, is_default)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, read_only = excluded.read_only,
                    is_default = excluded.is_default, color = COALESCE(collections.color, excluded.color)",
                params![id, account_id, c.remote_id, c.kind.as_str(), c.name, c.color, c.read_only, c.is_default],
            )?;
        }
        let existing: Vec<String> = {
            let mut stmt = tx.prepare("SELECT id FROM collections WHERE account_id = ?1")?;
            stmt.query_map([account_id], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        for old in existing.into_iter().filter(|id| !ids.contains(id)) {
            tx.execute("DELETE FROM collections WHERE id = ?1", [&old])?;
            tx.execute("DELETE FROM local_resources WHERE collection_id = ?1", [&old])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_collections(&self) -> Result<Vec<Collection>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT * FROM collections ORDER BY account_id = 'local' DESC, account_id, is_default DESC, name")?;
        Ok(stmt.query_map([], Self::collection_from_row)?.collect::<Result<_, _>>()?)
    }

    pub fn collections_of(&self, account_id: &str) -> Result<Vec<Collection>> {
        Ok(self.list_collections()?.into_iter().filter(|c| c.account_id == account_id).collect())
    }

    pub fn get_collection(&self, id: &str) -> Result<Collection> {
        self.conn()
            .query_row("SELECT * FROM collections WHERE id = ?1", [id], Self::collection_from_row)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("collection {id}")))
    }

    pub fn set_collection_visible(&self, id: &str, visible: bool) -> Result<()> {
        self.conn().execute("UPDATE collections SET visible = ?2 WHERE id = ?1", params![id, visible])?;
        Ok(())
    }

    pub fn set_collection_color(&self, id: &str, color: &str) -> Result<()> {
        self.conn().execute("UPDATE collections SET color = ?2 WHERE id = ?1", params![id, color])?;
        Ok(())
    }

    pub fn rename_collection(&self, id: &str, name: &str) -> Result<()> {
        self.conn().execute("UPDATE collections SET name = ?2 WHERE id = ?1", params![id, name])?;
        Ok(())
    }

    pub fn collection_state(&self, id: &str) -> Result<(Option<String>, Option<i64>)> {
        Ok(self
            .conn()
            .query_row("SELECT sync_state, synced_from FROM collections WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .unwrap_or((None, None)))
    }

    pub fn delete_account(&self, account_id: &str) -> Result<()> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM local_resources WHERE collection_id IN (SELECT id FROM collections WHERE account_id = ?1)",
            [account_id],
        )?;
        conn.execute("DELETE FROM collections WHERE account_id = ?1", [account_id])?;
        Ok(())
    }

    // ------------------------------------------------------------------ events

    pub fn apply_event_changes(&self, col: &Collection, changes: &Changes<EventResource>, window_start: i64) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if changes.reset {
            tx.execute("DELETE FROM events WHERE collection_id = ?1", [&col.id])?;
        }
        for r in &changes.removed {
            tx.execute("DELETE FROM events WHERE collection_id = ?1 AND resource_id = ?2", params![col.id, r])?;
        }
        for res in &changes.upserted {
            tx.execute("DELETE FROM events WHERE collection_id = ?1 AND resource_id = ?2", params![col.id, res.resource_id])?;
            for e in &res.events {
                let id = item_id(&col.id, &e.remote_id);
                let mut e = e.clone();
                e.id = id.clone();
                e.collection_id = col.id.clone();
                e.account_id = col.account_id.clone();
                e.resource_id = res.resource_id.clone();
                tx.execute(
                    "INSERT OR REPLACE INTO events(id, collection_id, account_id, remote_id, resource_id, etag, series_id, start, end, reminder, data, raw)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        id,
                        col.id,
                        col.account_id,
                        e.remote_id,
                        res.resource_id,
                        res.etag,
                        e.series_id,
                        e.start.timestamp(),
                        e.end.timestamp(),
                        e.reminder_minutes,
                        serde_json::to_string(&e)?,
                        res.raw,
                    ],
                )?;
            }
        }
        if let Some(state) = &changes.new_state {
            tx.execute("UPDATE collections SET sync_state = ?2, synced_from = ?3 WHERE id = ?1", params![col.id, state, window_start])?;
        } else if changes.reset {
            tx.execute("UPDATE collections SET synced_from = ?2 WHERE id = ?1", params![col.id, window_start])?;
        }
        tx.commit()?;
        Ok(())
    }

    fn event_from_row(r: &Row<'_>) -> rusqlite::Result<Event> {
        let data: String = r.get("data")?;
        let mut e: Event = serde_json::from_str(&data).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
        e.etag = r.get("etag")?;
        e.raw = r.get("raw")?;
        Ok(e)
    }

    pub fn known_event_resources(&self, collection_id: &str) -> Result<Known> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT DISTINCT resource_id, etag FROM events WHERE collection_id = ?1")?;
        Ok(stmt.query_map([collection_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
    }

    /// Occurrences overlapping `[from, to)` in visible calendars.
    pub fn events_between(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<Event>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT e.* FROM events e JOIN collections c ON c.id = e.collection_id
             WHERE c.visible = 1 AND e.end > ?1 AND e.start < ?2 ORDER BY e.start",
        )?;
        Ok(stmt
            .query_map(params![from.timestamp(), to.timestamp()], Self::event_from_row)?
            .collect::<Result<_, _>>()?)
    }

    pub fn get_event(&self, id: &str) -> Result<Event> {
        self.conn()
            .query_row("SELECT * FROM events WHERE id = ?1", [id], Self::event_from_row)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("event {id}")))
    }

    /// Events whose reminder falls into `(from, to]`.
    pub fn reminders_due(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<Event>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT * FROM events WHERE reminder IS NOT NULL AND start - reminder * 60 > ?1 AND start - reminder * 60 <= ?2",
        )?;
        Ok(stmt
            .query_map(params![from.timestamp(), to.timestamp()], Self::event_from_row)?
            .collect::<Result<_, _>>()?)
    }

    /// Text search over upcoming and past events (title, location).
    pub fn search_events(&self, query: &str, limit: u32) -> Result<Vec<Event>> {
        let pattern = format!("%{}%", query.to_lowercase());
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT * FROM events WHERE lower(data) LIKE ?1 ORDER BY start DESC LIMIT ?2")?;
        Ok(stmt.query_map(params![pattern, limit], Self::event_from_row)?.collect::<Result<_, _>>()?)
    }

    // ---------------------------------------------------------------- contacts

    pub fn apply_contact_changes(&self, col: &Collection, changes: &Changes<Contact>) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if changes.reset {
            tx.execute("DELETE FROM contacts WHERE collection_id = ?1", [&col.id])?;
        }
        for r in &changes.removed {
            tx.execute("DELETE FROM contacts WHERE id = ?1", [item_id(&col.id, r)])?;
        }
        for c in &changes.upserted {
            let id = item_id(&col.id, &c.remote_id);
            let mut c = c.clone();
            c.id = id.clone();
            c.collection_id = col.id.clone();
            c.account_id = col.account_id.clone();
            let search = format!(
                "{} {} {} {} {}",
                c.effective_name(),
                c.company,
                c.emails.iter().map(|e| e.value.as_str()).collect::<Vec<_>>().join(" "),
                c.phones.iter().map(|e| e.value.as_str()).collect::<Vec<_>>().join(" "),
                c.job_title
            )
            .to_lowercase();
            tx.execute(
                "INSERT OR REPLACE INTO contacts(id, collection_id, account_id, remote_id, etag, name, search, data, raw)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, col.id, col.account_id, c.remote_id, c.etag, c.effective_name(), search, serde_json::to_string(&c)?, c.raw],
            )?;
        }
        if let Some(state) = &changes.new_state {
            tx.execute("UPDATE collections SET sync_state = ?2 WHERE id = ?1", params![col.id, state])?;
        }
        tx.commit()?;
        Ok(())
    }

    fn contact_from_row(r: &Row<'_>) -> rusqlite::Result<Contact> {
        let data: String = r.get("data")?;
        let mut c: Contact = serde_json::from_str(&data).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
        c.etag = r.get("etag")?;
        c.raw = r.get("raw")?;
        Ok(c)
    }

    pub fn known_contacts(&self, collection_id: &str) -> Result<Known> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT remote_id, etag FROM contacts WHERE collection_id = ?1")?;
        Ok(stmt.query_map([collection_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
    }

    /// Contacts, optionally of one collection and/or matching a query.
    pub fn list_contacts(&self, collection: Option<&str>, query: Option<&str>, limit: u32) -> Result<Vec<Contact>> {
        let pattern = query.map(|q| format!("%{}%", q.to_lowercase()));
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT * FROM contacts WHERE (?1 IS NULL OR collection_id = ?1) AND (?2 IS NULL OR search LIKE ?2)
             ORDER BY name COLLATE NOCASE LIMIT ?3",
        )?;
        Ok(stmt
            .query_map(params![collection, pattern, limit], Self::contact_from_row)?
            .collect::<Result<_, _>>()?)
    }

    pub fn get_contact(&self, id: &str) -> Result<Contact> {
        self.conn()
            .query_row("SELECT * FROM contacts WHERE id = ?1", [id], Self::contact_from_row)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("contact {id}")))
    }

    // ------------------------------------------------------------------- tasks

    pub fn apply_task_changes(&self, col: &Collection, changes: &Changes<Task>) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if changes.reset {
            tx.execute("DELETE FROM tasks WHERE collection_id = ?1", [&col.id])?;
        }
        for r in &changes.removed {
            tx.execute("DELETE FROM tasks WHERE id = ?1", [item_id(&col.id, r)])?;
        }
        for t in &changes.upserted {
            let id = item_id(&col.id, &t.remote_id);
            let mut t = t.clone();
            t.id = id.clone();
            t.collection_id = col.id.clone();
            t.account_id = col.account_id.clone();
            tx.execute(
                "INSERT OR REPLACE INTO tasks(id, collection_id, account_id, remote_id, etag, data, raw) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, col.id, col.account_id, t.remote_id, t.etag, serde_json::to_string(&t)?, t.raw],
            )?;
        }
        if let Some(state) = &changes.new_state {
            tx.execute("UPDATE collections SET sync_state = ?2 WHERE id = ?1", params![col.id, state])?;
        }
        tx.commit()?;
        Ok(())
    }

    fn task_from_row(r: &Row<'_>) -> rusqlite::Result<Task> {
        let data: String = r.get("data")?;
        let mut t: Task = serde_json::from_str(&data).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
        t.etag = r.get("etag")?;
        t.raw = r.get("raw")?;
        Ok(t)
    }

    pub fn known_tasks(&self, collection_id: &str) -> Result<Known> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT remote_id, etag FROM tasks WHERE collection_id = ?1")?;
        Ok(stmt.query_map([collection_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
    }

    pub fn list_tasks(&self, collection: Option<&str>) -> Result<Vec<Task>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT * FROM tasks WHERE (?1 IS NULL OR collection_id = ?1)")?;
        let mut tasks: Vec<Task> = stmt.query_map(params![collection], Self::task_from_row)?.collect::<Result<_, _>>()?;
        tasks.sort_by(|a, b| {
            a.completed
                .cmp(&b.completed)
                .then_with(|| a.due.is_none().cmp(&b.due.is_none()))
                .then_with(|| a.due.cmp(&b.due))
                .then_with(|| b.created.cmp(&a.created))
        });
        Ok(tasks)
    }

    pub fn get_task(&self, id: &str) -> Result<Task> {
        self.conn()
            .query_row("SELECT * FROM tasks WHERE id = ?1", [id], Self::task_from_row)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("task {id}")))
    }

    // --------------------------------------------------------- local resources

    pub fn local_list(&self, collection_id: &str) -> Result<Vec<(String, String)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT href, etag FROM local_resources WHERE collection_id = ?1")?;
        Ok(stmt.query_map([collection_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
    }

    pub fn local_get(&self, collection_id: &str, href: &str) -> Result<Option<(String, String)>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT etag, data FROM local_resources WHERE collection_id = ?1 AND href = ?2",
                params![collection_id, href],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    pub fn local_put(&self, collection_id: &str, href: &str, etag: &str, data: &str) -> Result<()> {
        self.conn().execute(
            "INSERT OR REPLACE INTO local_resources(collection_id, href, etag, data) VALUES (?1, ?2, ?3, ?4)",
            params![collection_id, href, etag, data],
        )?;
        Ok(())
    }

    pub fn local_delete(&self, collection_id: &str, href: &str) -> Result<()> {
        self.conn()
            .execute("DELETE FROM local_resources WHERE collection_id = ?1 AND href = ?2", params![collection_id, href])?;
        Ok(())
    }

    /// Insert a local collection (calendar / address book / task list).
    pub fn create_local_collection(&self, kind: CollectionKind, name: &str, color: Option<&str>, is_default: bool) -> Result<Collection> {
        let remote_id = format!("{}-{}", kind.as_str(), uuid::Uuid::new_v4());
        let id = collection_id(LOCAL_ACCOUNT, &remote_id);
        self.conn().execute(
            "INSERT INTO collections(id, account_id, remote_id, kind, name, color, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, LOCAL_ACCOUNT, remote_id, kind.as_str(), name, color, is_default],
        )?;
        self.get_collection(&id)
    }

    pub fn delete_collection(&self, id: &str) -> Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM local_resources WHERE collection_id = ?1", [id])?;
        conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        Ok(())
    }
}
