//! Local SQLite store. The UI reads exclusively from here.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{Error, Result};
use crate::model::*;
use crate::preview::{html_to_text, preview_from_body};
use crate::provider::{FetchedBody, FolderChanges, RemoteFolder, RemoteMessage};

/// Maximum number of body characters put into the full-text index.
const FTS_BODY_LIMIT: usize = 20_000;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    role        TEXT NOT NULL,
    unread      INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    selectable  INTEGER NOT NULL DEFAULT 1,
    sync_state  TEXT
);
CREATE INDEX IF NOT EXISTS folders_account ON folders(account_id);
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    folder_id       TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    remote_id       TEXT NOT NULL,
    subject         TEXT NOT NULL,
    from_name       TEXT,
    from_email      TEXT,
    to_json         TEXT NOT NULL,
    cc_json         TEXT NOT NULL,
    date            INTEGER NOT NULL,
    preview         TEXT NOT NULL,
    is_read         INTEGER NOT NULL,
    is_flagged      INTEGER NOT NULL,
    has_attachments INTEGER NOT NULL,
    importance      TEXT NOT NULL,
    internet_message_id TEXT
);
CREATE INDEX IF NOT EXISTS messages_folder_date ON messages(folder_id, date DESC);
CREATE TABLE IF NOT EXISTS bodies (
    message_id  TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    html        TEXT,
    text        TEXT,
    attachments TEXT NOT NULL,
    raw         BLOB
);
"#;

/// v2: action queue, full-text search, settings.
const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS pending_ops (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,
    folder_id   TEXT,
    remote_id   TEXT,
    kind        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    next_try    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pending_ops_account ON pending_ops(account_id, id);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    subject, sender, body, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject, sender, body)
    VALUES (new.rowid, new.subject, COALESCE(new.from_name, '') || ' ' || COALESCE(new.from_email, ''), new.preview);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF subject, from_name, from_email ON messages BEGIN
    UPDATE messages_fts
       SET subject = new.subject, sender = COALESCE(new.from_name, '') || ' ' || COALESCE(new.from_email, '')
     WHERE rowid = new.rowid;
END;
INSERT INTO messages_fts(rowid, subject, sender, body)
    SELECT m.rowid, m.subject, COALESCE(m.from_name, '') || ' ' || COALESCE(m.from_email, ''), COALESCE(b.text, m.preview)
      FROM messages m LEFT JOIN bodies b ON b.message_id = m.id
     WHERE m.rowid NOT IN (SELECT rowid FROM messages_fts);
"#;

/// v3: conversations, categories, delayed sending.
const SCHEMA_V3: &str = r#"
ALTER TABLE messages ADD COLUMN thread_key TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS messages_thread ON messages(account_id, thread_key);
ALTER TABLE pending_ops ADD COLUMN send_at INTEGER;
"#;

const SCHEMA_VERSION: i64 = 3;

/// Counts for the account status line.
#[derive(Debug, Default, Clone, Copy)]
pub struct OpCounts {
    pub pending: u32,
    pub outbox: u32,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
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
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        conn.execute_batch(SCHEMA_V1)?;
        if version < 2 {
            conn.execute_batch(SCHEMA_V2)?;
        }
        if version < 3 {
            conn.execute_batch(SCHEMA_V3)?;
            // Thread keys are derived from the subject; fill them in for existing mail.
            let rows: Vec<(String, String)> = {
                let mut stmt = conn.prepare("SELECT id, subject FROM messages")?;
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
            };
            let mut stmt = conn.prepare("UPDATE messages SET thread_key = ?2 WHERE id = ?1")?;
            for (id, subject) in rows {
                stmt.execute(params![id, thread_key(&subject)])?;
            }
        }
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("store mutex poisoned")
    }

    // ---------------------------------------------------------------- settings

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // ---------------------------------------------------------------- accounts

    pub fn upsert_account(&self, account: &Account) -> Result<()> {
        let data = serde_json::to_string(account)?;
        self.conn().execute(
            "INSERT INTO accounts(id, data, sort) VALUES (?1, ?2, (SELECT COALESCE(MAX(sort), 0) + 1 FROM accounts))
             ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            params![account.id, data],
        )?;
        Ok(())
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT data FROM accounts ORDER BY sort")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn get_account(&self, id: &str) -> Result<Account> {
        let data: Option<String> = self
            .conn()
            .query_row("SELECT data FROM accounts WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        let data = data.ok_or_else(|| Error::NotFound(format!("account {id}")))?;
        Ok(serde_json::from_str(&data)?)
    }

    pub fn delete_account(&self, id: &str) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM pending_ops WHERE account_id = ?1", [id])?;
        tx.execute("DELETE FROM messages WHERE account_id = ?1", [id])?;
        tx.execute("DELETE FROM folders WHERE account_id = ?1", [id])?;
        tx.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    // ----------------------------------------------------------------- folders

    /// Replace the folder list of an account with what the server reported.
    /// Folders that disappeared are removed together with their messages.
    pub fn sync_folders(&self, account_id: &str, remote: &[RemoteFolder]) -> Result<Vec<Folder>> {
        {
            let mut conn = self.conn();
            let tx = conn.transaction()?;
            let ids: Vec<String> = remote.iter().map(|f| folder_id(account_id, &f.remote_id)).collect();
            for (f, id) in remote.iter().zip(&ids) {
                let parent = f.parent_remote_id.as_deref().map(|p| folder_id(account_id, p));
                tx.execute(
                    "INSERT INTO folders(id, account_id, remote_id, name, parent_id, role, unread, total, selectable)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id,
                        role = excluded.role, unread = excluded.unread, total = excluded.total,
                        selectable = excluded.selectable",
                    params![id, account_id, f.remote_id, f.name, parent, f.role.as_str(), f.unread_count, f.total_count, f.selectable],
                )?;
            }
            let existing: Vec<String> = {
                let mut stmt = tx.prepare("SELECT id FROM folders WHERE account_id = ?1")?;
                stmt.query_map([account_id], |r| r.get(0))?.collect::<Result<_, _>>()?
            };
            for old in existing.into_iter().filter(|id| !ids.contains(id)) {
                tx.execute("DELETE FROM messages WHERE folder_id = ?1", [&old])?;
                tx.execute("DELETE FROM folders WHERE id = ?1", [&old])?;
            }
            tx.commit()?;
        }
        self.list_folders(account_id)
    }

    fn folder_from_row(r: &Row<'_>) -> rusqlite::Result<Folder> {
        Ok(Folder {
            id: r.get("id")?,
            account_id: r.get("account_id")?,
            remote_id: r.get("remote_id")?,
            name: r.get("name")?,
            parent_id: r.get("parent_id")?,
            role: FolderRole::parse(&r.get::<_, String>("role")?),
            unread_count: r.get("unread")?,
            total_count: r.get("total")?,
        })
    }

    /// Folders of an account, well-known folders first, then alphabetically.
    /// Non-selectable IMAP containers are hidden unless they have children.
    pub fn list_folders(&self, account_id: &str) -> Result<Vec<Folder>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT * FROM folders f WHERE account_id = ?1
               AND (selectable = 1 OR EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = f.id))",
        )?;
        let mut folders: Vec<Folder> = stmt.query_map([account_id], Self::folder_from_row)?.collect::<Result<_, _>>()?;
        folders.sort_by(|a, b| {
            a.role
                .sort_key()
                .cmp(&b.role.sort_key())
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(folders)
    }

    pub fn get_folder(&self, id: &str) -> Result<Folder> {
        self.conn()
            .query_row("SELECT * FROM folders WHERE id = ?1", [id], Self::folder_from_row)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("folder {id}")))
    }

    pub fn folder_by_role(&self, account_id: &str, role: FolderRole) -> Result<Option<Folder>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT * FROM folders WHERE account_id = ?1 AND role = ?2 LIMIT 1",
                params![account_id, role.as_str()],
                Self::folder_from_row,
            )
            .optional()?)
    }

    pub fn folder_sync_state(&self, folder_id: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT sync_state FROM folders WHERE id = ?1", [folder_id], |r| r.get(0))
            .optional()?
            .flatten())
    }

    pub fn adjust_unread(&self, folder_id: &str, delta: i64) -> Result<()> {
        self.conn().execute(
            "UPDATE folders SET unread = MAX(0, unread + ?2) WHERE id = ?1",
            params![folder_id, delta],
        )?;
        Ok(())
    }

    // ---------------------------------------------------------------- messages

    /// Apply the result of [`crate::MailProvider::sync_folder`] atomically.
    /// Messages with queued local changes keep their local state, so a sync
    /// that runs before the change reached the server does not undo it.
    pub fn apply_changes(&self, folder: &Folder, changes: &FolderChanges) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let pending: HashMap<String, String> = {
            let mut stmt = tx.prepare("SELECT remote_id, kind FROM pending_ops WHERE folder_id = ?1 AND remote_id IS NOT NULL")?;
            stmt.query_map([&folder.id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?
        };
        let moved_away = |remote: &str| matches!(pending.get(remote).map(String::as_str), Some("move" | "delete"));

        if changes.reset {
            tx.execute("DELETE FROM messages WHERE folder_id = ?1", [&folder.id])?;
        }
        for m in &changes.upserted {
            if moved_away(&m.remote_id) {
                continue;
            }
            let keep_flags = pending.get(&m.remote_id).is_some_and(|k| k == "flags");
            upsert_message(&tx, folder, m, keep_flags)?;
        }
        for f in &changes.flags {
            if pending.contains_key(&f.remote_id) {
                continue;
            }
            tx.execute(
                "UPDATE messages SET is_read = ?2, is_flagged = ?3 WHERE id = ?1",
                params![message_id(&folder.id, &f.remote_id), f.is_read, f.is_flagged],
            )?;
        }
        for r in &changes.removed {
            tx.execute("DELETE FROM messages WHERE id = ?1", [message_id(&folder.id, r)])?;
        }
        if let Some(present) = &changes.present {
            let keep: std::collections::HashSet<String> = present.iter().map(|r| message_id(&folder.id, r)).collect();
            let local: Vec<String> = {
                let mut stmt = tx.prepare("SELECT id FROM messages WHERE folder_id = ?1")?;
                stmt.query_map([&folder.id], |r| r.get(0))?.collect::<Result<_, _>>()?
            };
            for id in local.into_iter().filter(|id| !keep.contains(id)) {
                tx.execute("DELETE FROM messages WHERE id = ?1", [id])?;
            }
        }
        if let Some(state) = &changes.new_state {
            tx.execute("UPDATE folders SET sync_state = ?2 WHERE id = ?1", params![folder.id, state])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Insert messages fetched with "load older" (never removes anything).
    pub fn insert_messages(&self, folder: &Folder, messages: &[RemoteMessage]) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for m in messages {
            upsert_message(&tx, folder, m, false)?;
        }
        tx.commit()?;
        Ok(())
    }

    fn summary_from_row(r: &Row<'_>) -> rusqlite::Result<MessageSummary> {
        let from_email: Option<String> = r.get("from_email")?;
        let to_json: String = r.get("to_json")?;
        let cc_json: String = r.get("cc_json")?;
        let importance: String = r.get("importance")?;
        let subject: String = r.get("subject")?;
        let categories: String = r.get("categories")?;
        Ok(MessageSummary {
            id: r.get("id")?,
            thread_key: thread_key(&subject),
            categories: serde_json::from_str(&categories).unwrap_or_default(),
            account_id: r.get("account_id")?,
            folder_id: r.get("folder_id")?,
            remote_id: r.get("remote_id")?,
            subject,
            from: from_email.map(|e| Address::new(r.get("from_name").ok().flatten(), e)),
            to: serde_json::from_str(&to_json).unwrap_or_default(),
            cc: serde_json::from_str(&cc_json).unwrap_or_default(),
            date: ts(r.get("date")?),
            preview: r.get("preview")?,
            is_read: r.get("is_read")?,
            is_flagged: r.get("is_flagged")?,
            has_attachments: r.get("has_attachments")?,
            importance: match importance.as_str() {
                "high" => Importance::High,
                "low" => Importance::Low,
                _ => Importance::Normal,
            },
            internet_message_id: r.get("internet_message_id")?,
        })
    }

    pub fn list_messages(&self, folder_id: &str, offset: u32, limit: u32) -> Result<Vec<MessageSummary>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT * FROM messages WHERE folder_id = ?1 ORDER BY date DESC LIMIT ?2 OFFSET ?3")?;
        Ok(stmt
            .query_map(params![folder_id, limit, offset], Self::summary_from_row)?
            .collect::<Result<_, _>>()?)
    }

    pub fn count_messages(&self, folder_id: &str) -> Result<u32> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM messages WHERE folder_id = ?1", [folder_id], |r| r.get(0))?)
    }

    /// Oldest local message of a folder (remote id and date).
    pub fn oldest_message(&self, folder_id: &str) -> Result<Option<(String, DateTime<Utc>)>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT remote_id, date FROM messages WHERE folder_id = ?1 ORDER BY date ASC LIMIT 1",
                [folder_id],
                |r| Ok((r.get::<_, String>(0)?, ts(r.get(1)?))),
            )
            .optional()?)
    }

    pub fn remote_ids(&self, folder_id: &str) -> Result<std::collections::HashSet<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT remote_id FROM messages WHERE folder_id = ?1")?;
        Ok(stmt.query_map([folder_id], |r| r.get(0))?.collect::<Result<_, _>>()?)
    }

    /// All messages of a conversation in one account, oldest first (without
    /// deleted items and junk).
    pub fn conversation(&self, account_id: &str, thread_key: &str, limit: u32) -> Result<Vec<MessageSummary>> {
        if thread_key.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT m.* FROM messages m JOIN folders f ON f.id = m.folder_id
              WHERE m.account_id = ?1 AND m.thread_key = ?2 AND f.role NOT IN ('trash', 'junk')
              ORDER BY m.date DESC LIMIT ?3",
        )?;
        let mut list = stmt.query_map(params![account_id, thread_key, limit], Self::summary_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        list.reverse();
        Ok(list)
    }

    /// Number of messages per conversation in a folder's account (for the
    /// conversation badge in the message list).
    pub fn thread_counts(&self, account_id: &str, keys: &[String]) -> Result<HashMap<String, u32>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT COUNT(*) FROM messages m JOIN folders f ON f.id = m.folder_id
              WHERE m.account_id = ?1 AND m.thread_key = ?2 AND f.role NOT IN ('trash', 'junk')",
        )?;
        let mut out = HashMap::new();
        for k in keys.iter().filter(|k| !k.is_empty()) {
            let n: u32 = stmt.query_row(params![account_id, k], |r| r.get(0))?;
            out.insert(k.clone(), n);
        }
        Ok(out)
    }

    pub fn set_categories(&self, message_id: &str, categories: &[String]) -> Result<()> {
        self.conn()
            .execute("UPDATE messages SET categories = ?2 WHERE id = ?1", params![message_id, serde_json::to_string(categories)?])?;
        Ok(())
    }

    /// All categories in use (for the category picker).
    pub fn all_categories(&self) -> Result<Vec<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT DISTINCT categories FROM messages WHERE categories != '[]'")?;
        let mut set = std::collections::BTreeSet::new();
        for json in stmt.query_map([], |r| r.get::<_, String>(0))? {
            set.extend(serde_json::from_str::<Vec<String>>(&json?).unwrap_or_default());
        }
        Ok(set.into_iter().collect())
    }

    pub fn message_exists(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn()
            .query_row("SELECT 1 FROM messages WHERE id = ?1", [id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    /// Full-text search over subject, sender and body (FTS5, prefix match on
    /// every word). Falls back to LIKE for queries FTS cannot parse.
    pub fn search(&self, query: &str, account_id: Option<&str>, limit: u32) -> Result<Vec<MessageSummary>> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.replace('"', ""))
            .filter(|t| !t.is_empty())
            .map(|t| format!("\"{t}\"*"))
            .collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let fts_query = terms.join(" ");
        let conn = self.conn();
        let fts = conn
            .prepare(
                "SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
                 WHERE messages_fts MATCH ?1 AND (?2 IS NULL OR m.account_id = ?2)
                 ORDER BY m.date DESC LIMIT ?3",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![fts_query, account_id, limit], Self::summary_from_row)?
                    .collect::<Result<Vec<_>, _>>()
            });
        match fts {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
                let mut stmt = conn.prepare(
                    "SELECT * FROM messages
                     WHERE (?2 IS NULL OR account_id = ?2)
                       AND (subject LIKE ?1 ESCAPE '\\' OR from_name LIKE ?1 ESCAPE '\\'
                            OR from_email LIKE ?1 ESCAPE '\\' OR preview LIKE ?1 ESCAPE '\\')
                     ORDER BY date DESC LIMIT ?3",
                )?;
                Ok(stmt
                    .query_map(params![pattern, account_id, limit], Self::summary_from_row)?
                    .collect::<Result<_, _>>()?)
            }
        }
    }

    pub fn get_message(&self, id: &str) -> Result<MessageSummary> {
        self.conn()
            .query_row("SELECT * FROM messages WHERE id = ?1", [id], Self::summary_from_row)
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("message {id}")))
    }

    /// Ids of the newest messages in a folder that have no stored body yet.
    pub fn messages_without_body(&self, folder_id: &str, limit: u32) -> Result<Vec<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT m.id FROM messages m LEFT JOIN bodies b ON b.message_id = m.id
             WHERE m.folder_id = ?1 AND b.message_id IS NULL ORDER BY m.date DESC LIMIT ?2",
        )?;
        Ok(stmt.query_map(params![folder_id, limit], |r| r.get(0))?.collect::<Result<_, _>>()?)
    }

    pub fn get_body(&self, message_id: &str) -> Result<Option<MessageBody>> {
        let row: Option<(Option<String>, Option<String>, String)> = self
            .conn()
            .query_row(
                "SELECT html, text, attachments FROM bodies WHERE message_id = ?1",
                [message_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        Ok(match row {
            Some((html, text, att)) => Some(MessageBody { html, text, attachments: serde_json::from_str(&att)? }),
            None => None,
        })
    }

    pub fn get_raw(&self, message_id: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .conn()
            .query_row("SELECT raw FROM bodies WHERE message_id = ?1", [message_id], |r| r.get(0))
            .optional()?
            .flatten())
    }

    /// Store a downloaded body; also fills in the preview if it was empty and
    /// indexes the text for search.
    pub fn save_body(&self, message_id: &str, fetched: &FetchedBody) -> Result<()> {
        let att = serde_json::to_string(&fetched.body.attachments)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let exists: bool = tx
            .query_row("SELECT 1 FROM messages WHERE id = ?1", [message_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !exists {
            // Deleted or moved while the body was downloading.
            return Ok(());
        }
        tx.execute(
            "INSERT OR REPLACE INTO bodies(message_id, html, text, attachments, raw) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![message_id, fetched.body.html, fetched.body.text, att, fetched.raw],
        )?;
        let preview = preview_from_body(&fetched.body);
        tx.execute(
            "UPDATE messages SET preview = ?2 WHERE id = ?1 AND preview = ''",
            params![message_id, preview],
        )?;
        if let Some(r) = &fetched.recipients {
            tx.execute(
                "UPDATE messages SET to_json = ?2, cc_json = ?3,
                    from_name = COALESCE(?4, from_name), from_email = COALESCE(?5, from_email) WHERE id = ?1",
                params![
                    message_id,
                    serde_json::to_string(&r.to)?,
                    serde_json::to_string(&r.cc)?,
                    r.from.as_ref().and_then(|a| a.name.clone()),
                    r.from.as_ref().map(|a| a.email.clone()),
                ],
            )?;
        }
        if !fetched.body.attachments.iter().all(|a| a.is_inline) {
            tx.execute("UPDATE messages SET has_attachments = 1 WHERE id = ?1", [message_id])?;
        }
        let text = match (&fetched.body.text, &fetched.body.html) {
            (Some(t), _) if !t.trim().is_empty() => t.clone(),
            (_, Some(h)) => html_to_text(h),
            _ => String::new(),
        };
        let text: String = text.chars().take(FTS_BODY_LIMIT).collect();
        tx.execute(
            "UPDATE messages_fts SET body = ?2 WHERE rowid = (SELECT rowid FROM messages WHERE id = ?1)",
            params![message_id, text],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Returns `true` if the state actually changed.
    pub fn set_read(&self, message_id: &str, read: bool) -> Result<bool> {
        let changed = self.conn().execute(
            "UPDATE messages SET is_read = ?2 WHERE id = ?1 AND is_read != ?2",
            params![message_id, read],
        )?;
        Ok(changed > 0)
    }

    pub fn set_flagged(&self, message_id: &str, flagged: bool) -> Result<()> {
        self.conn()
            .execute("UPDATE messages SET is_flagged = ?2 WHERE id = ?1", params![message_id, flagged])?;
        Ok(())
    }

    pub fn delete_message(&self, message_id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM messages WHERE id = ?1", [message_id])?;
        Ok(())
    }

    // ------------------------------------------------------------ action queue

    /// Queue an action for the server. `folder_id`/`remote_id` identify the
    /// affected message so syncs leave its local state alone meanwhile.
    pub fn enqueue_op(&self, account_id: &str, folder_id: Option<&str>, remote_id: Option<&str>, op: &PendingOp) -> Result<i64> {
        self.enqueue_op_at(account_id, folder_id, remote_id, op, None)
    }

    /// Queue an action that must not run before `send_at` (unix seconds).
    pub fn enqueue_op_at(&self, account_id: &str, folder_id: Option<&str>, remote_id: Option<&str>, op: &PendingOp, send_at: Option<i64>) -> Result<i64> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO pending_ops(account_id, folder_id, remote_id, kind, payload, next_try, send_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![account_id, folder_id, remote_id, op.kind(), serde_json::to_string(op)?, send_at.unwrap_or(0)],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Scheduled time of a queued action (delayed sending).
    pub fn op_send_at(&self, id: i64) -> Result<Option<i64>> {
        Ok(self
            .conn()
            .query_row("SELECT send_at FROM pending_ops WHERE id = ?1", [id], |r| r.get::<_, Option<i64>>(0))
            .optional()?
            .flatten()
            .filter(|t| *t > 0))
    }

    /// Queued actions of an account that are due, oldest first.
    pub fn due_ops(&self, account_id: &str, now: i64) -> Result<Vec<(i64, u32, PendingOp)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, attempts, payload FROM pending_ops WHERE account_id = ?1 AND next_try <= ?2 ORDER BY id",
        )?;
        let rows: Vec<(i64, u32, String)> = stmt
            .query_map(params![account_id, now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, attempts, payload) in rows {
            match serde_json::from_str(&payload) {
                Ok(op) => out.push((id, attempts, op)),
                Err(_) => {
                    conn.execute("DELETE FROM pending_ops WHERE id = ?1", [id])?;
                }
            }
        }
        Ok(out)
    }

    pub fn op_error(&self, id: i64) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT last_error FROM pending_ops WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .flatten())
    }

    pub fn complete_op(&self, id: i64) -> Result<()> {
        self.conn().execute("DELETE FROM pending_ops WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn retry_op_later(&self, id: i64, error: &str, next_try: i64) -> Result<()> {
        self.conn().execute(
            "UPDATE pending_ops SET attempts = attempts + 1, last_error = ?2, next_try = ?3 WHERE id = ?1",
            params![id, error, next_try],
        )?;
        Ok(())
    }

    /// Make every queued action of an account due now (e.g. after reconnect).
    pub fn retry_ops_now(&self, account_id: &str) -> Result<()> {
        self.conn()
            .execute("UPDATE pending_ops SET next_try = COALESCE(send_at, 0) WHERE account_id = ?1", [account_id])?;
        Ok(())
    }

    pub fn op_counts(&self, account_id: &str) -> Result<OpCounts> {
        Ok(self.conn().query_row(
            "SELECT COUNT(*), COALESCE(SUM(kind = 'send'), 0) FROM pending_ops WHERE account_id = ?1",
            [account_id],
            |r| Ok(OpCounts { pending: r.get(0)?, outbox: r.get(1)? }),
        )?)
    }

    /// Account ids that have queued actions.
    pub fn accounts_with_ops(&self) -> Result<Vec<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT DISTINCT account_id FROM pending_ops")?;
        Ok(stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?)
    }
}

fn ts(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(secs, 0).single().unwrap_or_default()
}

fn upsert_message(tx: &rusqlite::Transaction<'_>, folder: &Folder, m: &RemoteMessage, keep_flags: bool) -> Result<()> {
    let id = message_id(&folder.id, &m.remote_id);
    let importance = match m.importance {
        Importance::High => "high",
        Importance::Low => "low",
        Importance::Normal => "normal",
    };
    tx.execute(
        "INSERT INTO messages(id, account_id, folder_id, remote_id, subject, from_name, from_email, to_json, cc_json,
                              date, preview, is_read, is_flagged, has_attachments, importance, internet_message_id,
                              thread_key, categories)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?18, COALESCE(?19, '[]'))
         ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, from_name = excluded.from_name,
            from_email = excluded.from_email, to_json = excluded.to_json, cc_json = excluded.cc_json,
            date = excluded.date,
            preview = CASE WHEN excluded.preview = '' THEN messages.preview ELSE excluded.preview END,
            is_read = CASE WHEN ?17 THEN messages.is_read ELSE excluded.is_read END,
            is_flagged = CASE WHEN ?17 THEN messages.is_flagged ELSE excluded.is_flagged END,
            has_attachments = MAX(messages.has_attachments, excluded.has_attachments),
            importance = excluded.importance, internet_message_id = excluded.internet_message_id,
            thread_key = excluded.thread_key,
            categories = CASE WHEN ?19 IS NULL OR ?17 THEN messages.categories ELSE excluded.categories END",
        params![
            id,
            folder.account_id,
            folder.id,
            m.remote_id,
            m.subject,
            m.from.as_ref().and_then(|a| a.name.clone()),
            m.from.as_ref().map(|a| a.email.clone()),
            serde_json::to_string(&m.to)?,
            serde_json::to_string(&m.cc)?,
            m.date.timestamp(),
            m.preview,
            m.is_read,
            m.is_flagged,
            m.has_attachments,
            importance,
            m.internet_message_id,
            keep_flags,
            thread_key(&m.subject),
            m.categories.as_ref().map(serde_json::to_string).transpose()?,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account() -> Account {
        Account {
            id: "acc1".into(),
            display_name: "Niklas".into(),
            email: "niklas@mirranet.de".into(),
            kind: AccountKind::Imap(ImapConfig {
                imap_host: "mail.mirranet.de".into(),
                imap_port: 993,
                imap_security: Security::Tls,
                smtp_host: "mail.mirranet.de".into(),
                smtp_port: 587,
                smtp_security: Security::StartTls,
                username: "niklas".into(),
            }),
            color: None,
            signature: None,
            dav: None,
        }
    }

    fn remote_folder(id: &str, role: FolderRole) -> RemoteFolder {
        RemoteFolder {
            remote_id: id.into(),
            name: id.into(),
            parent_remote_id: None,
            role,
            unread_count: 1,
            total_count: 2,
            selectable: true,
        }
    }

    fn msg(id: &str, secs: i64) -> RemoteMessage {
        RemoteMessage {
            remote_id: id.into(),
            subject: format!("Subject {id}"),
            from: Some(Address::new(Some("Alice".into()), "alice@example.com")),
            to: vec![],
            cc: vec![],
            date: ts(secs),
            preview: String::new(),
            is_read: false,
            is_flagged: false,
            has_attachments: false,
            importance: Importance::Normal,
            internet_message_id: None,
            categories: None,
        }
    }

    fn setup() -> (Store, Folder) {
        let store = Store::open_in_memory().unwrap();
        store.upsert_account(&account()).unwrap();
        let folders = store
            .sync_folders("acc1", &[remote_folder("Archiv", FolderRole::Other), remote_folder("INBOX", FolderRole::Inbox)])
            .unwrap();
        assert_eq!(folders[0].role, FolderRole::Inbox, "inbox sorts first");
        let inbox = folders[0].clone();
        (store, inbox)
    }

    #[test]
    fn folders_and_messages_roundtrip() {
        let (store, inbox) = setup();
        let changes = FolderChanges {
            upserted: vec![msg("1", 100), msg("2", 200)],
            new_state: Some("state-1".into()),
            ..Default::default()
        };
        store.apply_changes(&inbox, &changes).unwrap();
        let list = store.list_messages(&inbox.id, 0, 50).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].remote_id, "2", "newest first");
        assert_eq!(store.folder_sync_state(&inbox.id).unwrap().as_deref(), Some("state-1"));
        assert_eq!(store.oldest_message(&inbox.id).unwrap().unwrap().0, "1");

        store
            .apply_changes(&inbox, &FolderChanges { present: Some(vec!["2".into()]), ..Default::default() })
            .unwrap();
        assert_eq!(store.list_messages(&inbox.id, 0, 50).unwrap().len(), 1);

        store.sync_folders("acc1", &[remote_folder("Archiv", FolderRole::Other)]).unwrap();
        assert!(store.get_folder(&inbox.id).is_err());
    }

    #[test]
    fn full_text_search_includes_bodies() {
        let (store, inbox) = setup();
        store
            .apply_changes(&inbox, &FolderChanges { upserted: vec![msg("1", 100), msg("2", 200)], ..Default::default() })
            .unwrap();
        let id = message_id(&inbox.id, "1");
        let body = MessageBody { html: Some("<p>Die Rechnung für den Serverschrank</p>".into()), text: None, attachments: vec![] };
        store.save_body(&id, &FetchedBody { body, raw: None, recipients: None }).unwrap();

        assert_eq!(store.search("serverschr", None, 10).unwrap().len(), 1, "prefix match in body");
        assert_eq!(store.search("rechnung fur", None, 10).unwrap().len(), 1, "diacritics are folded");
        assert_eq!(store.search("alice", None, 10).unwrap().len(), 2, "sender");
        assert!(store.search("bob", None, 10).unwrap().is_empty());
        store.delete_message(&id).unwrap();
        assert!(store.search("serverschrank", None, 10).unwrap().is_empty(), "index follows deletes");
    }

    #[test]
    fn pending_ops_protect_local_state() {
        let (store, inbox) = setup();
        store
            .apply_changes(&inbox, &FolderChanges { upserted: vec![msg("1", 100), msg("2", 200)], ..Default::default() })
            .unwrap();
        let id1 = message_id(&inbox.id, "1");
        let id2 = message_id(&inbox.id, "2");

        // Local "read" not yet on the server, message 2 deleted locally.
        store.set_read(&id1, true).unwrap();
        let op = PendingOp::SetFlags { folder_remote_id: "INBOX".into(), message_remote_id: "1".into(), read: Some(true), flagged: None };
        store.enqueue_op("acc1", Some(&inbox.id), Some("1"), &op).unwrap();
        store.delete_message(&id2).unwrap();
        let op = PendingOp::Delete { folder_remote_id: "INBOX".into(), message_remote_id: "2".into() };
        store.enqueue_op("acc1", Some(&inbox.id), Some("2"), &op).unwrap();

        // A sync with the old server state must not undo either change.
        store
            .apply_changes(&inbox, &FolderChanges { upserted: vec![msg("1", 100), msg("2", 200)], ..Default::default() })
            .unwrap();
        assert!(store.get_message(&id1).unwrap().is_read);
        assert!(!store.message_exists(&id2).unwrap());

        let counts = store.op_counts("acc1").unwrap();
        assert_eq!((counts.pending, counts.outbox), (2, 0));
        let due = store.due_ops("acc1", i64::MAX).unwrap();
        assert_eq!(due.len(), 2);
        store.retry_op_later(due[0].0, "offline", i64::MAX).unwrap();
        assert_eq!(store.due_ops("acc1", 0).unwrap().len(), 1);
        store.complete_op(due[1].0).unwrap();
        assert_eq!(store.op_counts("acc1").unwrap().pending, 1);
    }

    #[test]
    fn conversations_categories_and_scheduled_ops() {
        let (store, folder) = setup();
        let mut a = msg("1", 100);
        a.subject = "Angebot".into();
        let mut b = msg("2", 200);
        b.subject = "AW: Angebot".into();
        b.categories = Some(vec!["Rot".into()]);
        let c = msg("3", 300);
        store.insert_messages(&folder, &[a, b, c]).unwrap();
        let id1 = message_id(&folder.id, "1");
        let thread = store.conversation("acc1", "angebot", 10).unwrap();
        assert_eq!(thread.iter().map(|m| m.remote_id.as_str()).collect::<Vec<_>>(), ["1", "2"]);
        assert_eq!(thread[1].categories, ["Rot"]);
        store.set_categories(&id1, &["Blau".to_string()]).unwrap();
        assert_eq!(store.all_categories().unwrap(), ["Blau", "Rot"]);
        assert_eq!(store.thread_counts("acc1", &["angebot".into()]).unwrap()["angebot"], 2);

        // A sync without category information keeps local categories.
        let mut again = msg("1", 100);
        again.subject = "Angebot".into();
        store.insert_messages(&folder, &[again]).unwrap();
        assert_eq!(store.get_message(&id1).unwrap().categories, ["Blau"]);

        // Delayed sending: not due before send_at, and "retry now" keeps the time.
        let op = PendingOp::Delete { folder_remote_id: "INBOX".into(), message_remote_id: "1".into() };
        let id = store.enqueue_op_at("acc1", None, None, &op, Some(5_000)).unwrap();
        assert!(store.due_ops("acc1", 4_999).unwrap().is_empty());
        store.retry_ops_now("acc1").unwrap();
        assert!(store.due_ops("acc1", 4_999).unwrap().is_empty());
        assert_eq!(store.due_ops("acc1", 5_000).unwrap().len(), 1);
        assert_eq!(store.op_send_at(id).unwrap(), Some(5_000));
    }

    #[test]
    fn migrates_v1_database() {
        let path = std::env::temp_dir().join(format!("ondura-migrate-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA_V1).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            conn.execute("INSERT INTO accounts(id, data) VALUES ('a', ?1)", [serde_json::to_string(&account()).unwrap()]).unwrap();
            conn.execute("INSERT INTO folders(id, account_id, remote_id, name, role) VALUES ('f', 'a', 'INBOX', 'Inbox', 'inbox')", []).unwrap();
            conn.execute(
                "INSERT INTO messages VALUES ('m', 'a', 'f', '1', 'Altes Angebot', 'Bob', 'bob@x.de', '[]', '[]', 1, 'vorschau', 0, 0, 0, 'normal', NULL)",
                [],
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.search("angebot", None, 10).unwrap().len(), 1, "existing rows are indexed");
        assert_eq!(store.list_accounts().unwrap().len(), 1);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }
}
