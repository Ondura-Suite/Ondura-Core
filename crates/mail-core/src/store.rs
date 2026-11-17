//! Local SQLite store. The UI reads exclusively from here.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{Error, Result};
use crate::model::*;
use crate::preview::preview_from_body;
use crate::provider::{FetchedBody, FolderChanges, RemoteFolder, RemoteMessage};

const SCHEMA_VERSION: i64 = 1;

const SCHEMA: &str = r#"
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
        conn.execute_batch(SCHEMA)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("store mutex poisoned")
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
    pub fn apply_changes(&self, folder: &Folder, changes: &FolderChanges) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if changes.reset {
            tx.execute("DELETE FROM messages WHERE folder_id = ?1", [&folder.id])?;
        }
        for m in &changes.upserted {
            upsert_message(&tx, folder, m)?;
        }
        for f in &changes.flags {
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

    fn summary_from_row(r: &Row<'_>) -> rusqlite::Result<MessageSummary> {
        let from_email: Option<String> = r.get("from_email")?;
        let to_json: String = r.get("to_json")?;
        let cc_json: String = r.get("cc_json")?;
        let importance: String = r.get("importance")?;
        Ok(MessageSummary {
            id: r.get("id")?,
            account_id: r.get("account_id")?,
            folder_id: r.get("folder_id")?,
            remote_id: r.get("remote_id")?,
            subject: r.get("subject")?,
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

    /// Simple full-text-ish search over subject, sender and preview.
    pub fn search(&self, query: &str, account_id: Option<&str>, limit: u32) -> Result<Vec<MessageSummary>> {
        let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let conn = self.conn();
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

    /// Store a downloaded body; also fills in the preview if it was empty.
    pub fn save_body(&self, message_id: &str, fetched: &FetchedBody) -> Result<()> {
        let att = serde_json::to_string(&fetched.body.attachments)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO bodies(message_id, html, text, attachments, raw) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![message_id, fetched.body.html, fetched.body.text, att, fetched.raw],
        )?;
        let preview = preview_from_body(&fetched.body);
        tx.execute(
            "UPDATE messages SET preview = ?2 WHERE id = ?1 AND preview = ''",
            params![message_id, preview],
        )?;
        if !fetched.body.attachments.iter().all(|a| a.is_inline) {
            tx.execute("UPDATE messages SET has_attachments = 1 WHERE id = ?1", [message_id])?;
        }
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
}

fn ts(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(secs, 0).single().unwrap_or_default()
}

fn upsert_message(tx: &rusqlite::Transaction<'_>, folder: &Folder, m: &RemoteMessage) -> Result<()> {
    let id = message_id(&folder.id, &m.remote_id);
    let importance = match m.importance {
        Importance::High => "high",
        Importance::Low => "low",
        Importance::Normal => "normal",
    };
    tx.execute(
        "INSERT INTO messages(id, account_id, folder_id, remote_id, subject, from_name, from_email, to_json, cc_json,
                              date, preview, is_read, is_flagged, has_attachments, importance, internet_message_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, from_name = excluded.from_name,
            from_email = excluded.from_email, to_json = excluded.to_json, cc_json = excluded.cc_json,
            date = excluded.date,
            preview = CASE WHEN excluded.preview = '' THEN messages.preview ELSE excluded.preview END,
            is_read = excluded.is_read, is_flagged = excluded.is_flagged,
            has_attachments = MAX(messages.has_attachments, excluded.has_attachments),
            importance = excluded.importance, internet_message_id = excluded.internet_message_id",
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
        }
    }

    #[test]
    fn folders_and_messages_roundtrip() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_account(&account()).unwrap();
        let folders = store
            .sync_folders("acc1", &[remote_folder("Archiv", FolderRole::Other), remote_folder("INBOX", FolderRole::Inbox)])
            .unwrap();
        assert_eq!(folders[0].role, FolderRole::Inbox, "inbox sorts first");
        let inbox = &folders[0];

        let changes = FolderChanges {
            upserted: vec![msg("1", 100), msg("2", 200)],
            new_state: Some("state-1".into()),
            ..Default::default()
        };
        store.apply_changes(inbox, &changes).unwrap();
        let list = store.list_messages(&inbox.id, 0, 50).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].remote_id, "2", "newest first");
        assert_eq!(store.folder_sync_state(&inbox.id).unwrap().as_deref(), Some("state-1"));

        // `present` removes everything not listed.
        store
            .apply_changes(inbox, &FolderChanges { present: Some(vec!["2".into()]), ..Default::default() })
            .unwrap();
        assert_eq!(store.list_messages(&inbox.id, 0, 50).unwrap().len(), 1);

        // Search
        assert_eq!(store.search("alice", None, 10).unwrap().len(), 1);
        assert!(store.search("bob", None, 10).unwrap().is_empty());

        // Folder removal cascades.
        store.sync_folders("acc1", &[remote_folder("Archiv", FolderRole::Other)]).unwrap();
        assert!(store.get_folder(&inbox.id).is_err());
    }
}
