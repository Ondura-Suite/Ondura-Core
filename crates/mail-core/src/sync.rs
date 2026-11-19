//! The sync engine mirrors remote state into the [`Store`] and pushes user
//! actions back to the server.
//!
//! * User actions (read, flag, move, delete, send, save draft) are applied to
//!   the store immediately and queued in `pending_ops`. A background flusher
//!   sends them to the server in order and retries with backoff while the
//!   server is unreachable, so the UI never waits for the network.
//! * Every account gets a watcher task: IMAP accounts hold an IDLE connection
//!   on the inbox (new mail arrives within seconds), other accounts poll the
//!   inbox every minute. All folders are synced every few minutes.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::{Notify, broadcast};
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::error::{Error, Result};
use crate::model::*;
use crate::preview::attachment_bytes;
use crate::provider::{MailProvider, RemoteFolder};
use crate::store::Store;

/// Number of newest messages per folder whose bodies are downloaded eagerly
/// (for previews, search and offline reading).
const PREFETCH_BODIES: u32 = 25;
/// How long an IMAP IDLE command is kept open before it is renewed.
const IDLE_TIMEOUT: Duration = Duration::from_secs(25 * 60);
/// Inbox poll interval for accounts without push.
const POLL_INTERVAL: Duration = Duration::from_secs(60);
/// Default interval for a full sync of all folders (setting `syncIntervalMinutes`).
const DEFAULT_FULL_SYNC_MINUTES: u64 = 5;
/// Parked actions (e.g. a message the server refused) are not retried automatically.
const PARKED: i64 = i64::MAX;

/// Events emitted for the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncEvent {
    #[serde(rename_all = "camelCase")]
    SyncStarted { account_id: AccountId },
    #[serde(rename_all = "camelCase")]
    FoldersChanged { account_id: AccountId },
    #[serde(rename_all = "camelCase")]
    FolderUpdated { account_id: AccountId, folder_id: FolderId },
    #[serde(rename_all = "camelCase")]
    SyncFinished { account_id: AccountId },
    #[serde(rename_all = "camelCase")]
    Error { account_id: AccountId, message: String },
    #[serde(rename_all = "camelCase")]
    Status { status: AccountStatus },
    #[serde(rename_all = "camelCase")]
    NewMail { account_id: AccountId, folder_id: FolderId, message_id: MessageId, count: usize, from: String, subject: String },
    #[serde(rename_all = "camelCase")]
    MessageSent { account_id: AccountId, subject: String },
    #[serde(rename_all = "camelCase")]
    SendFailed { account_id: AccountId, subject: String, message: String },
}

/// What "Sweep" does with the messages of a sender.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SweepAction {
    Delete,
    /// Delete all but the newest one.
    KeepLatest,
    Archive,
    #[serde(rename_all = "camelCase")]
    Move { folder_id: FolderId },
}

/// An entry of the outbox as shown in the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub op_id: i64,
    pub message: OutgoingMessage,
    pub error: Option<String>,
    /// Delayed sending: unix seconds when the message goes out.
    pub send_at: Option<i64>,
}

/// Setting with the certificates of other people (JSON list of base64 DER).
pub const KNOWN_CERTS_KEY: &str = "smime.knownCertificates";

pub struct SyncEngine {
    store: Arc<Store>,
    providers: RwLock<HashMap<AccountId, Arc<dyn MailProvider>>>,
    account_locks: Mutex<HashMap<AccountId, Arc<tokio::sync::Mutex<()>>>>,
    flush_locks: Mutex<HashMap<AccountId, Arc<tokio::sync::Mutex<()>>>>,
    status: Mutex<HashMap<AccountId, AccountStatus>>,
    watchers: Mutex<HashMap<AccountId, JoinHandle<()>>>,
    flush: Notify,
    events: broadcast::Sender<SyncEvent>,
}

fn to_remote(folder: &Folder) -> RemoteFolder {
    RemoteFolder {
        remote_id: folder.remote_id.clone(),
        name: folder.name.clone(),
        parent_remote_id: None,
        role: folder.role,
        unread_count: folder.unread_count,
        total_count: folder.total_count,
        selectable: true,
    }
}

fn now() -> i64 {
    Utc::now().timestamp()
}

/// Retry delay for queued actions: 15 s, 30 s, 1 min, … up to 15 min.
fn backoff(attempts: u32) -> i64 {
    (15i64 << attempts.min(6)).min(15 * 60)
}

fn guess_content_type(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" | "log" => "text/plain",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "zip" => "application/zip",
        "7z" => "application/x-7z-compressed",
        "json" => "application/json",
        "xml" => "application/xml",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "ics" => "text/calendar",
        "eml" => "message/rfc822",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

impl SyncEngine {
    pub fn new(store: Arc<Store>) -> Arc<Self> {
        let (events, _) = broadcast::channel(512);
        Arc::new(Self {
            store,
            providers: RwLock::default(),
            account_locks: Mutex::default(),
            flush_locks: Mutex::default(),
            status: Mutex::default(),
            watchers: Mutex::default(),
            flush: Notify::new(),
            events,
        })
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SyncEvent> {
        self.events.subscribe()
    }

    fn emit(&self, event: SyncEvent) {
        // No receivers is fine (e.g. in tests).
        let _ = self.events.send(event);
    }

    /// Register an account's adapter. With `watch` a background task keeps the
    /// inbox up to date (IDLE or polling); tests usually pass `false`.
    pub fn register(self: &Arc<Self>, account_id: &str, provider: Arc<dyn MailProvider>, watch: bool) {
        self.providers.write().unwrap().insert(account_id.to_string(), provider);
        self.update_status(account_id, |s| {
            s.error = None;
            s.needs_auth = false;
        });
        if watch {
            let engine = Arc::clone(self);
            let id = account_id.to_string();
            let handle = tokio::spawn(async move { engine.watch_inbox(id).await });
            if let Some(old) = self.watchers.lock().unwrap().insert(account_id.to_string(), handle) {
                old.abort();
            }
        }
        self.flush.notify_one();
    }

    pub fn unregister(&self, account_id: &str) {
        self.providers.write().unwrap().remove(account_id);
        if let Some(h) = self.watchers.lock().unwrap().remove(account_id) {
            h.abort();
        }
        self.status.lock().unwrap().remove(account_id);
    }

    pub fn account_ids(&self) -> Vec<AccountId> {
        self.providers.read().unwrap().keys().cloned().collect()
    }

    fn provider(&self, account_id: &str) -> Result<Arc<dyn MailProvider>> {
        self.providers
            .read()
            .unwrap()
            .get(account_id)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("account {account_id} is not connected")))
    }

    fn lock_for(map: &Mutex<HashMap<AccountId, Arc<tokio::sync::Mutex<()>>>>, account_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        map.lock().unwrap().entry(account_id.to_string()).or_default().clone()
    }

    // ------------------------------------------------------------------ status

    fn update_status(&self, account_id: &str, f: impl FnOnce(&mut AccountStatus)) {
        let status = {
            let mut map = self.status.lock().unwrap();
            let s = map.entry(account_id.to_string()).or_insert_with(|| AccountStatus {
                account_id: account_id.to_string(),
                ..Default::default()
            });
            f(s);
            if let Ok(c) = self.store.op_counts(account_id) {
                s.pending_ops = c.pending;
                s.outbox = c.outbox;
            }
            s.clone()
        };
        self.emit(SyncEvent::Status { status });
    }

    /// Record an error for the account (shown in the folder pane).
    pub fn set_account_error(&self, account_id: &str, error: &Error) {
        let needs_auth = matches!(error, Error::Auth(_));
        self.update_status(account_id, |s| {
            s.error = Some(error.to_string());
            s.needs_auth = needs_auth;
        });
    }

    pub fn statuses(&self) -> Vec<AccountStatus> {
        let accounts: Vec<String> = self.store.list_accounts().map(|a| a.into_iter().map(|a| a.id).collect()).unwrap_or_default();
        let map = self.status.lock().unwrap();
        accounts
            .into_iter()
            .map(|id| {
                let mut s = map.get(&id).cloned().unwrap_or_else(|| AccountStatus { account_id: id.clone(), ..Default::default() });
                if let Ok(c) = self.store.op_counts(&id) {
                    s.pending_ops = c.pending;
                    s.outbox = c.outbox;
                }
                if !self.providers.read().unwrap().contains_key(&id) && s.error.is_none() {
                    s.error = Some(ondura_i18n::tr!("Konto ist nicht verbunden"));
                }
                s
            })
            .collect()
    }

    // -------------------------------------------------------------------- sync

    /// Full incremental sync of one account: queued actions first, then the
    /// folder list, then every folder (inbox first). Errors in single folders
    /// do not abort the run.
    pub async fn sync_account(&self, account_id: &str) -> Result<()> {
        let lock = Self::lock_for(&self.account_locks, account_id);
        let Ok(_guard) = lock.try_lock() else {
            debug!(account_id, "sync already running, skipping");
            return Ok(());
        };
        self.emit(SyncEvent::SyncStarted { account_id: account_id.into() });
        self.update_status(account_id, |s| s.syncing = true);
        let _ = self.flush_account(account_id).await;
        let result = self.sync_account_inner(account_id).await;
        match &result {
            Ok(()) => self.update_status(account_id, |s| {
                s.syncing = false;
                s.error = None;
                s.needs_auth = false;
                s.last_sync = Some(now());
            }),
            Err(e) => {
                warn!(account_id, error = %e, "account sync failed");
                self.update_status(account_id, |s| s.syncing = false);
                self.set_account_error(account_id, e);
                self.emit(SyncEvent::Error { account_id: account_id.into(), message: e.to_string() });
            }
        }
        self.emit(SyncEvent::SyncFinished { account_id: account_id.into() });
        result
    }

    async fn sync_account_inner(&self, account_id: &str) -> Result<()> {
        let provider = self.provider(account_id)?;
        let mut remote = provider.list_folders().await?;
        self.store.sync_folders(account_id, &remote)?;
        self.emit(SyncEvent::FoldersChanged { account_id: account_id.into() });

        remote.retain(|f| f.selectable);
        remote.sort_by_key(|f| f.role.sort_key());
        let mut first_error = None;
        for rf in &remote {
            let folder = self.store.get_folder(&folder_id(account_id, &rf.remote_id))?;
            if let Err(e) = self.sync_one(&*provider, &folder, rf).await {
                warn!(account_id, folder = %folder.name, error = %e, "folder sync failed");
                // A broken connection fails every following folder as well.
                if matches!(e, Error::Network(_) | Error::Auth(_)) {
                    return Err(e);
                }
                first_error.get_or_insert(Error::Protocol(format!("{}: {e}", folder.name)));
            }
        }
        info!(account_id, folders = remote.len(), "account synced");
        match first_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    async fn sync_one(&self, provider: &dyn MailProvider, folder: &Folder, remote: &RemoteFolder) -> Result<()> {
        let state = self.store.folder_sync_state(&folder.id)?;
        let changes = provider.sync_folder(remote, state.as_deref()).await?;
        let changed = changes.reset
            || !changes.upserted.is_empty()
            || !changes.removed.is_empty()
            || !changes.flags.is_empty()
            || changes.present.is_some();

        // New unread mail in the inbox (not on the very first sync).
        let mut new_mail = Vec::new();
        if state.is_some() && !changes.reset && folder.role == FolderRole::Inbox {
            let cutoff = Utc::now() - chrono::Duration::days(2);
            for m in changes.upserted.iter().filter(|m| !m.is_read && m.date > cutoff) {
                let id = message_id(&folder.id, &m.remote_id);
                if !self.store.message_exists(&id)? {
                    new_mail.push((id, m.from.as_ref().map(|a| a.display().to_string()).unwrap_or_default(), m.subject.clone()));
                }
            }
        }

        self.store.apply_changes(folder, &changes)?;
        if !new_mail.is_empty() {
            let ids: Vec<String> = new_mail.iter().map(|(id, _, _)| id.clone()).collect();
            let remaining = self.apply_rules(&ids).await;
            new_mail.retain(|(id, _, _)| remaining.contains(id));
        }
        if changed {
            self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
        }
        if let Some((message_id, from, subject)) = new_mail.first().cloned() {
            self.emit(SyncEvent::NewMail {
                account_id: folder.account_id.clone(),
                folder_id: folder.id.clone(),
                message_id,
                count: new_mail.len(),
                from,
                subject,
            });
        }

        // Prefetch the newest bodies so previews, search and offline reading work.
        if !matches!(folder.role, FolderRole::Junk | FolderRole::Trash) {
            let missing = self.store.messages_without_body(&folder.id, PREFETCH_BODIES)?;
            if !missing.is_empty() {
                let mut remote_ids = Vec::with_capacity(missing.len());
                for id in &missing {
                    remote_ids.push(self.store.get_message(id)?.remote_id);
                }
                match provider.fetch_bodies(&folder.remote_id, &remote_ids).await {
                    Ok(bodies) => {
                        for (remote_id, body) in bodies {
                            self.store.save_body(&message_id(&folder.id, &remote_id), &body)?;
                        }
                        self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
                    }
                    Err(e) => debug!(error = %e, "body prefetch failed"),
                }
            }
        }
        Ok(())
    }

    /// Sync a single folder (e.g. when the user opens it).
    pub async fn sync_folder(&self, folder_id: &str) -> Result<()> {
        let folder = self.store.get_folder(folder_id)?;
        let provider = self.provider(&folder.account_id)?;
        self.sync_one(&*provider, &folder, &to_remote(&folder)).await
    }

    /// Fetch up to `limit` messages older than the oldest local one.
    /// Returns how many were added (0 = nothing more on the server).
    pub async fn load_older(&self, folder_id: &str, limit: usize) -> Result<usize> {
        let folder = self.store.get_folder(folder_id)?;
        let provider = self.provider(&folder.account_id)?;
        let oldest = self.store.oldest_message(folder_id)?.map(|(_, d)| d);
        let known = self.store.remote_ids(folder_id)?;
        let messages = provider.fetch_older(&to_remote(&folder), &known, oldest, limit).await?;
        self.store.insert_messages(&folder, &messages)?;
        if !messages.is_empty() {
            self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
        }
        Ok(messages.len())
    }

    /// Background work: the action queue flusher and the periodic full sync.
    pub fn start(self: &Arc<Self>) {
        let engine = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = engine.flush.notified() => {}
                    _ = tokio::time::sleep(Duration::from_secs(15)) => {}
                }
                engine.wake_snoozed().await;
                let accounts = engine.store.accounts_with_ops().unwrap_or_default();
                for account_id in accounts {
                    let _ = engine.flush_account(&account_id).await;
                }
            }
        });
        let engine = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                for account_id in engine.account_ids() {
                    let _ = engine.sync_account(&account_id).await;
                }
                let minutes = engine
                    .store
                    .setting("syncIntervalMinutes")
                    .ok()
                    .flatten()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(DEFAULT_FULL_SYNC_MINUTES)
                    .clamp(1, 120);
                tokio::time::sleep(Duration::from_secs(minutes * 60)).await;
            }
        });
    }

    /// Keeps the inbox current: IMAP IDLE where supported, polling otherwise.
    async fn watch_inbox(self: Arc<Self>, account_id: String) {
        let mut failures = 0u32;
        loop {
            let Ok(provider) = self.provider(&account_id) else { return };
            let inbox = match self.store.folder_by_role(&account_id, FolderRole::Inbox) {
                Ok(Some(f)) => f,
                _ => {
                    // Not synced yet.
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };
            match provider.wait_for_change(&inbox.remote_id, IDLE_TIMEOUT).await {
                Ok(changed) => {
                    failures = 0;
                    if changed {
                        debug!(account_id, "IDLE: inbox changed");
                        let _ = self.sync_folder(&inbox.id).await;
                    }
                }
                Err(Error::Unsupported(_)) => {
                    tokio::time::sleep(POLL_INTERVAL).await;
                    let _ = self.sync_folder(&inbox.id).await;
                }
                Err(e) => {
                    failures += 1;
                    debug!(account_id, error = %e, "inbox watch failed");
                    tokio::time::sleep(Duration::from_secs((30 * failures as u64).min(300))).await;
                    let _ = self.sync_folder(&inbox.id).await;
                }
            }
        }
    }

    // ----------------------------------------------------------------- reading

    /// Message with body; downloads the body if it is not stored yet.
    pub async fn get_message(&self, message_id: &str) -> Result<MessageDetail> {
        let summary = self.store.get_message(message_id)?;
        let stored = self.store.get_body(message_id)?;
        // S/MIME: open again from the raw message so the signature status
        // is current and encrypted content is never stored decrypted.
        let raw = if stored.is_some() { self.store.get_raw(message_id)?.filter(|r| ondura_smime::is_protected(r)) } else { None };
        let mut body = match (stored, raw) {
            (_, Some(raw)) => crate::preview::parse_body(&raw),
            (Some(body), None) => body,
            (None, _) => {
                let folder = self.store.get_folder(&summary.folder_id)?;
                let provider = self.provider(&summary.account_id)?;
                let fetched = provider.fetch_body(&folder.remote_id, &summary.remote_id).await?;
                self.store.save_body(message_id, &fetched)?;
                fetched.body
            }
        };
        self.learn_certificate(&mut body);
        Ok(MessageDetail { summary: self.store.get_message(message_id)?, body })
    }

    /// Keep the certificate of a valid signature, so replies can be
    /// encrypted for its owner.
    fn learn_certificate(&self, body: &mut MessageBody) {
        let Some(sig) = body.security.as_mut().and_then(|s| s.signature.as_mut()) else { return };
        let Some(der) = sig.certificate.take() else { return };
        if !sig.valid {
            return;
        }
        if let Ok(cert) = ondura_smime::Certificate::from_der(&der)
            && crate::smime::add_known(cert)
        {
            let all: Vec<String> = crate::smime::known_der().iter().map(|d| base64::Engine::encode(&base64::engine::general_purpose::STANDARD, d)).collect();
            if let Ok(json) = serde_json::to_string(&all) {
                let _ = self.store.set_setting(KNOWN_CERTS_KEY, &json);
            }
        }
    }

    pub async fn get_attachment(&self, message_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        if let Some(raw) = self.store.get_raw(message_id)? {
            let index: usize = attachment_id.parse().map_err(|_| Error::NotFound(attachment_id.into()))?;
            return attachment_bytes(&raw, index).ok_or_else(|| Error::NotFound(attachment_id.into()));
        }
        let summary = self.store.get_message(message_id)?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        self.provider(&summary.account_id)?
            .fetch_attachment(&folder.remote_id, &summary.remote_id, attachment_id)
            .await
    }

    // ----------------------------------------------------------------- actions
    //
    // All actions change the store immediately and queue the server side.

    fn enqueue(&self, summary: Option<&MessageSummary>, account_id: &str, op: PendingOp) -> Result<()> {
        self.store.enqueue_op(
            account_id,
            summary.map(|s| s.folder_id.as_str()),
            summary.map(|s| s.remote_id.as_str()),
            &op,
        )?;
        self.update_status(account_id, |_| {});
        self.flush.notify_one();
        Ok(())
    }

    pub async fn set_read(&self, message_id: &str, read: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        if !self.store.set_read(message_id, read)? {
            return Ok(());
        }
        self.store.adjust_unread(&summary.folder_id, if read { -1 } else { 1 })?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        let op = PendingOp::SetFlags {
            folder_remote_id: folder.remote_id,
            message_remote_id: summary.remote_id.clone(),
            read: Some(read),
            flagged: None,
        };
        self.enqueue(Some(&summary), &summary.account_id, op)
    }

    pub async fn set_flagged(&self, message_id: &str, flagged: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        self.store.set_flagged(message_id, flagged)?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        let op = PendingOp::SetFlags {
            folder_remote_id: folder.remote_id,
            message_remote_id: summary.remote_id.clone(),
            read: None,
            flagged: Some(flagged),
        };
        self.enqueue(Some(&summary), &summary.account_id, op)
    }

    pub async fn move_message(&self, message_id: &str, target_folder_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let source = self.store.get_folder(&summary.folder_id)?;
        let target = self.store.get_folder(target_folder_id)?;
        if source.account_id != target.account_id {
            return Err(Error::Unsupported(ondura_i18n::tr!("Nachrichten können nicht zwischen Konten verschoben werden")));
        }
        if source.id == target.id {
            return Ok(());
        }
        self.store.delete_message(message_id)?;
        if !summary.is_read {
            self.store.adjust_unread(&source.id, -1)?;
        }
        let op = PendingOp::Move {
            folder_remote_id: source.remote_id.clone(),
            message_remote_id: summary.remote_id.clone(),
            target_folder_remote_id: target.remote_id,
        };
        self.enqueue(Some(&summary), &summary.account_id, op)?;
        self.emit(SyncEvent::FolderUpdated { account_id: source.account_id.clone(), folder_id: source.id.clone() });
        Ok(())
    }

    /// Moves to "Deleted items"; deletes permanently when already there (or
    /// when the message is a draft).
    pub async fn delete_message(&self, message_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        if !matches!(folder.role, FolderRole::Trash | FolderRole::Drafts)
            && let Some(trash) = self.store.folder_by_role(&summary.account_id, FolderRole::Trash)?
        {
            return self.move_message(message_id, &trash.id).await;
        }
        self.delete_permanently(&summary, &folder)
    }

    fn delete_permanently(&self, summary: &MessageSummary, folder: &Folder) -> Result<()> {
        self.store.delete_message(&summary.id)?;
        if !summary.is_read {
            self.store.adjust_unread(&folder.id, -1)?;
        }
        let op = PendingOp::Delete { folder_remote_id: folder.remote_id.clone(), message_remote_id: summary.remote_id.clone() };
        self.enqueue(Some(summary), &summary.account_id, op)?;
        self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
        Ok(())
    }

    pub async fn set_categories(&self, message_id: &str, categories: &[String]) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let mut cats: Vec<String> = Vec::new();
        for c in categories.iter().map(|c| c.trim()).filter(|c| !c.is_empty()) {
            if !cats.iter().any(|x| x.eq_ignore_ascii_case(c)) {
                cats.push(c.to_string());
            }
        }
        self.store.set_categories(message_id, &cats)?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        let op = PendingOp::SetCategories {
            folder_remote_id: folder.remote_id,
            message_remote_id: summary.remote_id.clone(),
            categories: cats,
        };
        self.enqueue(Some(&summary), &summary.account_id, op)
    }

    /// Pin a message to the top of its folder (local only).
    pub fn set_pinned(&self, message_id: &str, pinned: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        self.store.set_pinned(message_id, pinned)?;
        self.emit(SyncEvent::FolderUpdated { account_id: summary.account_id, folder_id: summary.folder_id });
        Ok(())
    }

    /// Hide a message until `until`; it comes back as unread ("Snooze").
    /// `None` brings it back now.
    pub async fn snooze(&self, message_id: &str, until: Option<chrono::DateTime<Utc>>) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        self.store.set_snooze(message_id, until.filter(|t| t.timestamp() > now()))?;
        if until.is_none() {
            self.set_read(message_id, false).await?;
        }
        self.emit(SyncEvent::FolderUpdated { account_id: summary.account_id, folder_id: summary.folder_id });
        Ok(())
    }

    /// Bring back snoozed messages that are due (called by the flusher loop).
    async fn wake_snoozed(&self) {
        for id in self.store.due_snoozes(now()).unwrap_or_default() {
            let Ok(summary) = self.store.get_message(&id) else { continue };
            let _ = self.store.set_snooze(&id, None);
            let _ = self.set_read(&id, false).await;
            self.emit(SyncEvent::NewMail {
                account_id: summary.account_id.clone(),
                folder_id: summary.folder_id.clone(),
                message_id: id.clone(),
                count: 1,
                from: summary.from.as_ref().map(|a| a.display().to_string()).unwrap_or_default(),
                subject: summary.subject.clone(),
            });
            self.emit(SyncEvent::FolderUpdated { account_id: summary.account_id, folder_id: summary.folder_id });
        }
    }

    pub fn snoozed(&self) -> Result<Vec<MessageSummary>> {
        self.store.snoozed()
    }

    pub fn list_messages(&self, folder_id: &str, offset: u32, limit: u32, focused: Option<bool>) -> Result<Vec<MessageSummary>> {
        self.store.list_messages_filtered(folder_id, offset, limit, focused)
    }

    /// Move a message between "Focused" and "Other".
    pub fn set_focused(&self, message_id: &str, focused: bool, always: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        self.store.set_focused(message_id, focused, always)?;
        self.emit(SyncEvent::FolderUpdated { account_id: summary.account_id, folder_id: summary.folder_id });
        Ok(())
    }

    pub fn focus_unread(&self, folder_id: &str) -> Result<(u32, u32)> {
        self.store.focus_unread(folder_id)
    }

    /// "Ignore conversation": every message of the thread goes to deleted
    /// items, now and when new ones arrive.
    pub async fn ignore_conversation(&self, message_id: &str, ignore: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        self.store.ignore_thread(&summary.account_id, &summary.thread_key, ignore)?;
        if ignore {
            for m in self.store.conversation(&summary.account_id, &summary.thread_key, 1000)? {
                self.delete_message(&m.id).await?;
            }
        }
        Ok(())
    }

    /// "Sweep": act on every message from the sender of `message_id` in its
    /// folder. Returns the number of messages handled.
    pub async fn sweep(&self, message_id: &str, action: SweepAction) -> Result<usize> {
        let summary = self.store.get_message(message_id)?;
        let email = summary.from.as_ref().map(|a| a.email.clone()).ok_or_else(|| Error::NotFound("sender".into()))?;
        let ids = self.store.messages_from(&summary.folder_id, &email)?;
        let ids: Vec<String> = match action {
            SweepAction::KeepLatest => ids.into_iter().skip(1).collect(),
            _ => ids,
        };
        for id in &ids {
            match &action {
                SweepAction::Delete | SweepAction::KeepLatest => self.delete_message(id).await?,
                SweepAction::Archive => self.archive_message(id).await?,
                SweepAction::Move { folder_id } => self.move_message(id, folder_id).await?,
            }
        }
        Ok(ids.len())
    }

    /// Block a sender: a rule moves their mail to junk, and the messages
    /// already received go there now.
    pub async fn block_sender(&self, message_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let email = summary.from.as_ref().map(|a| a.email.clone()).ok_or_else(|| Error::NotFound("sender".into()))?;
        let junk = self
            .store
            .folder_by_role(&summary.account_id, FolderRole::Junk)?
            .ok_or_else(|| Error::NotFound(ondura_i18n::tr!("Junk-E-Mail-Ordner")))?;
        let mut rules = self.rules()?;
        if !rules.iter().any(|r| r.move_to.as_deref() == Some(junk.id.as_str()) && r.from_contains.as_deref().is_some_and(|f| f.eq_ignore_ascii_case(&email))) {
            rules.push(MailRule {
                id: uuid::Uuid::new_v4().to_string(),
                name: ondura_i18n::tr!("Blockiert: {0}", email),
                enabled: true,
                account_id: Some(summary.account_id.clone()),
                from_contains: Some(email.clone()),
                move_to: Some(junk.id.clone()),
                stop: true,
                ..Default::default()
            });
            self.save_rules(&rules)?;
        }
        for id in self.store.messages_from(&summary.folder_id, &email)? {
            self.move_message(&id, &junk.id).await?;
        }
        Ok(())
    }

    /// Recipient suggestions: frequent correspondents plus the directories
    /// (global address list) of the accounts.
    pub async fn search_people(&self, query: &str, limit: usize) -> Result<Vec<DirectoryEntry>> {
        let mut out: Vec<DirectoryEntry> = Vec::new();
        let providers: Vec<Arc<dyn MailProvider>> = self.providers.read().unwrap().values().cloned().collect();
        let lookups = providers.iter().map(|p| p.search_directory(query, limit));
        for found in futures::future::join_all(lookups).await.into_iter().flatten() {
            for e in found {
                if !out.iter().any(|x| x.email.eq_ignore_ascii_case(&e.email)) {
                    out.push(e);
                }
            }
        }
        for a in self.store.frequent_addresses(query, limit as u32)? {
            if !out.iter().any(|x| x.email.eq_ignore_ascii_case(&a.email)) {
                out.push(DirectoryEntry {
                    name: a.name.clone().unwrap_or_else(|| a.email.clone()),
                    email: a.email,
                    job_title: None,
                    department: None,
                    office: None,
                    phone: None,
                    is_group: false,
                });
            }
        }
        out.truncate(limit);
        Ok(out)
    }

    /// Org chart of a person from the first directory that knows them.
    pub async fn org_info(&self, email: &str) -> Result<OrgInfo> {
        let providers: Vec<Arc<dyn MailProvider>> = self.providers.read().unwrap().values().cloned().collect();
        let mut last = Error::Unsupported("org chart".into());
        for p in providers {
            match p.org_info(email).await {
                Ok(info) if info.person.is_some() || info.manager.is_some() || !info.reports.is_empty() => return Ok(info),
                Ok(_) => {}
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    pub fn flagged(&self, limit: u32) -> Result<Vec<MessageSummary>> {
        self.store.flagged(limit)
    }

    pub async fn quota(&self, account_id: &str) -> Result<Quota> {
        self.provider(account_id)?.quota().await
    }

    pub fn categories(&self) -> Result<Vec<String>> {
        self.store.all_categories()
    }

    /// The conversation a message belongs to, oldest first.
    pub fn conversation(&self, message_id: &str) -> Result<Vec<MessageSummary>> {
        let summary = self.store.get_message(message_id)?;
        let list = self.store.conversation(&summary.account_id, &summary.thread_key, 100)?;
        Ok(if list.is_empty() { vec![summary] } else { list })
    }

    pub fn thread_counts(&self, account_id: &str, keys: &[String]) -> Result<HashMap<String, u32>> {
        self.store.thread_counts(account_id, keys)
    }

    /// Search the mailboxes on the servers. Hits are stored locally (like
    /// "load older") so they can be opened like any other message.
    pub async fn search_server(&self, query: &str, limit: usize) -> Result<Vec<MessageSummary>> {
        let accounts: Vec<(AccountId, Arc<dyn MailProvider>)> =
            self.providers.read().unwrap().iter().map(|(k, v)| (k.clone(), Arc::clone(v))).collect();
        let mut out = Vec::new();
        let mut last_error = None;
        for (account_id, provider) in accounts {
            match provider.search(query, limit).await {
                Ok(hits) => {
                    for (folder_remote_id, m) in hits {
                        let Ok(folder) = self.store.get_folder(&folder_id(&account_id, &folder_remote_id)) else { continue };
                        self.store.insert_messages(&folder, std::slice::from_ref(&m))?;
                        if let Ok(summary) = self.store.get_message(&message_id(&folder.id, &m.remote_id)) {
                            out.push(summary);
                        }
                    }
                }
                Err(Error::Unsupported(_)) => {}
                Err(e) => {
                    warn!(account_id, error = %e, "server search failed");
                    last_error = Some(e);
                }
            }
        }
        if out.is_empty()
            && let Some(e) = last_error
        {
            return Err(e);
        }
        out.sort_by_key(|m| std::cmp::Reverse(m.date));
        out.dedup_by(|a, b| a.id == b.id);
        Ok(out)
    }

    // ------------------------------------------------------------------ rules

    /// Automatic replies of an account, read from the server.
    pub async fn auto_reply(&self, account_id: &str) -> Result<crate::model::AutoReply> {
        self.provider(account_id)?.auto_reply().await
    }

    /// Change the automatic replies of an account on the server.
    pub async fn set_auto_reply(&self, account_id: &str, reply: &crate::model::AutoReply) -> Result<()> {
        self.provider(account_id)?.set_auto_reply(reply).await
    }

    pub fn rules(&self) -> Result<Vec<MailRule>> {
        Ok(self.store.setting("rules")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn save_rules(&self, rules: &[MailRule]) -> Result<()> {
        self.store.set_setting("rules", &serde_json::to_string(rules)?)
    }

    /// Apply the rules to newly arrived messages. Returns the ids that are
    /// still in the inbox afterwards (for the new-mail notification).
    async fn apply_rules(&self, message_ids: &[String]) -> Vec<String> {
        let rules = self.rules().unwrap_or_default();
        let mut remaining = Vec::new();
        for id in message_ids {
            let Ok(summary) = self.store.get_message(id) else { continue };
            if self.store.is_thread_ignored(&summary.account_id, &summary.thread_key).unwrap_or(false) {
                let _ = self.delete_message(id).await;
                continue;
            }
            let mut moved = false;
            for rule in rules.iter().filter(|r| r.matches(&summary)) {
                let result: Result<()> = async {
                    if rule.mark_read {
                        self.set_read(id, true).await?;
                    }
                    if rule.flag {
                        self.set_flagged(id, true).await?;
                    }
                    if let Some(c) = rule.category.as_deref().filter(|c| !c.trim().is_empty()) {
                        let current = self.store.get_message(id)?.categories;
                        let mut cats = current.clone();
                        cats.push(c.to_string());
                        self.set_categories(id, &cats).await?;
                    }
                    if rule.delete {
                        self.delete_message(id).await?;
                        moved = true;
                    } else if let Some(target) = rule.move_to.as_deref() {
                        self.move_message(id, target).await?;
                        moved = true;
                    }
                    Ok(())
                }
                .await;
                if let Err(e) = result {
                    warn!(rule = %rule.name, error = %e, "rule failed");
                }
                if rule.stop || moved {
                    break;
                }
            }
            if !moved {
                remaining.push(id.clone());
            }
        }
        remaining
    }

    pub async fn archive_message(&self, message_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let archive = self
            .store
            .folder_by_role(&summary.account_id, FolderRole::Archive)?
            .ok_or_else(|| Error::NotFound("Archivordner".into()))?;
        self.move_message(message_id, &archive.id).await
    }

    fn drop_draft(&self, draft_id: Option<&str>) -> Result<()> {
        if let Some(id) = draft_id
            && let Ok(summary) = self.store.get_message(id)
        {
            let folder = self.store.get_folder(&summary.folder_id)?;
            self.delete_permanently(&summary, &folder)?;
        }
        Ok(())
    }

    /// Queue a message for sending. Returns immediately; the result arrives
    /// as [`SyncEvent::MessageSent`] or [`SyncEvent::SendFailed`].
    pub async fn send(&self, account_id: &str, message: &OutgoingMessage) -> Result<()> {
        self.provider(account_id)?; // fail fast for unknown accounts
        self.drop_draft(message.draft_id.as_deref())?;
        let send_at = message.send_at.map(|t| t.timestamp()).filter(|t| *t > now());
        self.store.enqueue_op_at(account_id, None, None, &PendingOp::Send { message: message.clone() }, send_at)?;
        self.update_status(account_id, |_| {});
        self.flush.notify_one();
        Ok(())
    }

    pub async fn save_draft(&self, account_id: &str, message: &OutgoingMessage) -> Result<()> {
        self.provider(account_id)?;
        self.drop_draft(message.draft_id.as_deref())?;
        self.enqueue(None, account_id, PendingOp::SaveDraft { message: message.clone() })
    }

    pub fn outbox(&self, account_id: &str) -> Result<Vec<OutboxItem>> {
        Ok(self
            .store
            .due_ops(account_id, PARKED)?
            .into_iter()
            .filter_map(|(op_id, _, op)| match op {
                PendingOp::Send { message } => Some(OutboxItem { op_id, message, error: None, send_at: None }),
                _ => None,
            })
            .map(|mut item| {
                item.error = self.store.op_error(item.op_id).ok().flatten();
                item.send_at = self.store.op_send_at(item.op_id).ok().flatten().filter(|t| *t > now());
                item
            })
            .collect())
    }

    pub fn retry_pending(&self, account_id: &str) -> Result<()> {
        self.store.retry_ops_now(account_id)?;
        self.flush.notify_one();
        Ok(())
    }

    pub fn discard_op(&self, account_id: &str, op_id: i64) -> Result<()> {
        self.store.complete_op(op_id)?;
        self.update_status(account_id, |_| {});
        Ok(())
    }

    // ---------------------------------------------------------- queue flusher

    async fn resolve_attachments(&self, message: &OutgoingMessage) -> Result<Vec<ResolvedAttachment>> {
        let mut out = Vec::with_capacity(message.attachments.len());
        for a in &message.attachments {
            out.push(match a {
                OutgoingAttachment::File { path } => {
                    let data = tokio::fs::read(path)
                        .await
                        .map_err(|e| Error::Other(ondura_i18n::tr!("Anhang {0} konnte nicht gelesen werden: {1}", path, e)))?;
                    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| ondura_i18n::tr!("Anhang"));
                    ResolvedAttachment { content_type: guess_content_type(&name).to_string(), name, data }
                }
                OutgoingAttachment::Message { message_id, attachment_id, name, content_type } => ResolvedAttachment {
                    data: self.get_attachment(message_id, attachment_id).await?,
                    name: name.clone(),
                    content_type: content_type.clone(),
                },
                OutgoingAttachment::Text { name, content_type, text } => ResolvedAttachment {
                    data: text.clone().into_bytes(),
                    name: name.clone(),
                    content_type: content_type.clone(),
                },
            });
        }
        Ok(out)
    }

    async fn execute(&self, provider: &dyn MailProvider, op: &PendingOp) -> Result<()> {
        match op {
            PendingOp::SetFlags { folder_remote_id, message_remote_id, read, flagged } => {
                provider.set_flags(folder_remote_id, message_remote_id, *read, *flagged).await
            }
            PendingOp::Move { folder_remote_id, message_remote_id, target_folder_remote_id } => {
                provider.move_message(folder_remote_id, message_remote_id, target_folder_remote_id).await.map(|_| ())
            }
            PendingOp::Delete { folder_remote_id, message_remote_id } => provider.delete_message(folder_remote_id, message_remote_id).await,
            PendingOp::Send { message } => {
                let attachments = self.resolve_attachments(message).await?;
                provider.send(message, &attachments).await
            }
            PendingOp::SaveDraft { message } => {
                let attachments = self.resolve_attachments(message).await?;
                provider.save_draft(message, &attachments).await
            }
            PendingOp::SetCategories { folder_remote_id, message_remote_id, categories } => {
                provider.set_categories(folder_remote_id, message_remote_id, categories).await
            }
        }
    }

    /// Send all due queued actions of an account to the server, in order.
    pub async fn flush_account(&self, account_id: &str) -> Result<()> {
        let lock = Self::lock_for(&self.flush_locks, account_id);
        let _guard = lock.lock().await;
        let Ok(provider) = self.provider(account_id) else { return Ok(()) };
        let ops = self.store.due_ops(account_id, now())?;
        if ops.is_empty() {
            return Ok(());
        }
        let mut resync = Vec::new();
        for (id, attempts, op) in ops {
            match self.execute(&*provider, &op).await {
                Ok(()) => {
                    self.store.complete_op(id)?;
                    match &op {
                        PendingOp::Send { message } => {
                            self.emit(SyncEvent::MessageSent { account_id: account_id.into(), subject: message.subject.clone() });
                            resync.push(FolderRole::Sent);
                        }
                        PendingOp::SaveDraft { .. } => resync.push(FolderRole::Drafts),
                        PendingOp::Move { target_folder_remote_id, .. } => {
                            if let Ok(f) = self.store.get_folder(&folder_id(account_id, target_folder_remote_id)) {
                                let _ = self.sync_folder(&f.id).await;
                            }
                        }
                        _ => {}
                    }
                }
                Err(e @ (Error::Network(_) | Error::Auth(_))) => {
                    // Server unreachable or login broken: keep order, retry later.
                    self.store.retry_op_later(id, &e.to_string(), now() + backoff(attempts))?;
                    self.set_account_error(account_id, &e);
                    break;
                }
                Err(e) => match &op {
                    PendingOp::Send { message } | PendingOp::SaveDraft { message } => {
                        // Keep the message; the user can retry, edit or discard it.
                        self.store.retry_op_later(id, &e.to_string(), PARKED)?;
                        self.emit(SyncEvent::SendFailed { account_id: account_id.into(), subject: message.subject.clone(), message: e.to_string() });
                    }
                    _ => {
                        // The server refused (message gone etc.): drop the action
                        // and let the next sync restore the real state.
                        warn!(account_id, error = %e, kind = op.kind(), "queued action failed, dropping");
                        self.store.complete_op(id)?;
                        self.emit(SyncEvent::Error { account_id: account_id.into(), message: e.to_string() });
                    }
                },
            }
        }
        self.update_status(account_id, |_| {});
        for role in resync {
            if let Ok(Some(f)) = self.store.folder_by_role(account_id, role) {
                let _ = self.sync_folder(&f.id).await;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicU32, Ordering};

    use async_trait::async_trait;
    use chrono::{DateTime, Utc};

    use super::*;
    use crate::provider::{FetchedBody, FolderChanges, RemoteMessage};

    /// Provider whose write operations fail with a network error until
    /// `failures` reaches zero; sends fail permanently if `reject_send`.
    struct Flaky {
        failures: AtomicU32,
        calls: AtomicU32,
        reject_send: bool,
    }

    #[async_trait]
    impl MailProvider for Flaky {
        async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
            Ok(vec![RemoteFolder {
                remote_id: "INBOX".into(),
                name: "Posteingang".into(),
                parent_remote_id: None,
                role: FolderRole::Inbox,
                unread_count: 1,
                total_count: 1,
                selectable: true,
            }])
        }
        async fn sync_folder(&self, _f: &RemoteFolder, _s: Option<&str>) -> Result<FolderChanges> {
            Ok(FolderChanges {
                upserted: vec![RemoteMessage {
                    remote_id: "1".into(),
                    subject: "Hallo".into(),
                    from: None,
                    to: vec![],
                    cc: vec![],
                    date: Utc::now(),
                    preview: "x".into(),
                    is_read: false,
                    is_flagged: false,
                    has_attachments: false,
                    importance: Importance::Normal,
                    internet_message_id: None,
                    categories: None,
                    focused: None,
                }],
                new_state: Some("s".into()),
                ..Default::default()
            })
        }
        async fn fetch_body(&self, _f: &str, _m: &str) -> Result<FetchedBody> {
            Err(Error::Network("offline".into()))
        }
        async fn fetch_older(&self, _f: &RemoteFolder, _k: &HashSet<String>, _d: Option<DateTime<Utc>>, _l: usize) -> Result<Vec<RemoteMessage>> {
            Ok(vec![])
        }
        async fn fetch_attachment(&self, _f: &str, _m: &str, _a: &str) -> Result<Vec<u8>> {
            Err(Error::NotFound("x".into()))
        }
        async fn set_flags(&self, _f: &str, _m: &str, _r: Option<bool>, _fl: Option<bool>) -> Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.failures.load(Ordering::SeqCst) > 0 {
                self.failures.fetch_sub(1, Ordering::SeqCst);
                return Err(Error::Network("offline".into()));
            }
            Ok(())
        }
        async fn move_message(&self, _f: &str, _m: &str, _t: &str) -> Result<Option<String>> {
            Ok(None)
        }
        async fn delete_message(&self, _f: &str, _m: &str) -> Result<()> {
            Ok(())
        }
        async fn send(&self, _m: &OutgoingMessage, _a: &[ResolvedAttachment]) -> Result<()> {
            if self.reject_send { Err(Error::Protocol("550 mailbox unavailable".into())) } else { Ok(()) }
        }
        async fn save_draft(&self, _m: &OutgoingMessage, _a: &[ResolvedAttachment]) -> Result<()> {
            Ok(())
        }
    }

    async fn setup(provider: Arc<Flaky>) -> (Arc<SyncEngine>, Arc<Store>, MessageId) {
        let store = Arc::new(Store::open_in_memory().unwrap());
        store
            .upsert_account(&Account {
                id: "a".into(),
                display_name: "A".into(),
                email: "a@b.c".into(),
                kind: AccountKind::Ews(EwsConfig { url: "x".into(), username: "u".into(), mailbox: None }),
                color: None,
                signature: None,
                dav: None,
            })
            .unwrap();
        let engine = SyncEngine::new(store.clone());
        engine.register("a", provider, false);
        engine.sync_account("a").await.unwrap(); // body prefetch fails quietly
        let inbox = store.folder_by_role("a", FolderRole::Inbox).unwrap().unwrap();
        let id = message_id(&inbox.id, "1");
        assert!(store.message_exists(&id).unwrap());
        (engine, store, id)
    }

    #[tokio::test]
    async fn queued_actions_survive_network_errors() {
        let provider = Arc::new(Flaky { failures: AtomicU32::new(1), calls: AtomicU32::new(0), reject_send: false });
        let (engine, store, id) = setup(provider.clone()).await;

        engine.set_read(&id, true).await.unwrap();
        assert!(store.get_message(&id).unwrap().is_read, "applied locally at once");

        engine.flush_account("a").await.unwrap();
        assert_eq!(store.op_counts("a").unwrap().pending, 1, "kept after a network error");
        assert!(engine.statuses()[0].error.is_some(), "account shows the error");

        // A sync before the retry must not undo the local change.
        let inbox = store.folder_by_role("a", FolderRole::Inbox).unwrap().unwrap();
        engine.sync_folder(&inbox.id).await.unwrap();
        assert!(store.get_message(&id).unwrap().is_read);

        engine.retry_pending("a").unwrap();
        engine.flush_account("a").await.unwrap();
        assert_eq!(store.op_counts("a").unwrap().pending, 0);
        assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn refused_messages_stay_in_the_outbox() {
        let provider = Arc::new(Flaky { failures: AtomicU32::new(0), calls: AtomicU32::new(0), reject_send: true });
        let (engine, store, _) = setup(provider).await;
        let mut events = engine.subscribe();

        let msg = OutgoingMessage { subject: "Wichtig".into(), to: vec![Address::new(None, "x@y.z")], ..Default::default() };
        engine.send("a", &msg).await.unwrap();
        engine.flush_account("a").await.unwrap();

        let outbox = engine.outbox("a").unwrap();
        assert_eq!(outbox.len(), 1);
        assert!(outbox[0].error.as_deref().unwrap().contains("550"));
        assert_eq!(store.op_counts("a").unwrap().outbox, 1);
        let mut failed = false;
        while let Ok(e) = events.try_recv() {
            failed |= matches!(e, SyncEvent::SendFailed { .. });
        }
        assert!(failed, "SendFailed event emitted");

        // Parked: not retried automatically …
        engine.flush_account("a").await.unwrap();
        assert_eq!(engine.outbox("a").unwrap().len(), 1);
        // … and can be discarded.
        engine.discard_op("a", outbox[0].op_id).unwrap();
        assert!(engine.outbox("a").unwrap().is_empty());
    }
}
