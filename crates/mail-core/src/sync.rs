//! The sync engine mirrors remote state into the [`Store`] and pushes user
//! actions (read, flag, move, delete, send) back to the server.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::error::{Error, Result};
use crate::model::*;
use crate::preview::attachment_bytes;
use crate::provider::{MailProvider, RemoteFolder};
use crate::store::Store;

/// Number of newest messages per folder whose bodies are downloaded eagerly
/// (for previews and offline reading).
const PREFETCH_BODIES: u32 = 25;

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
}

pub struct SyncEngine {
    store: Arc<Store>,
    providers: RwLock<HashMap<AccountId, Arc<dyn MailProvider>>>,
    account_locks: Mutex<HashMap<AccountId, Arc<tokio::sync::Mutex<()>>>>,
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

impl SyncEngine {
    pub fn new(store: Arc<Store>) -> Arc<Self> {
        let (events, _) = broadcast::channel(256);
        Arc::new(Self {
            store,
            providers: RwLock::default(),
            account_locks: Mutex::default(),
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

    pub fn register(&self, account_id: &str, provider: Arc<dyn MailProvider>) {
        self.providers.write().unwrap().insert(account_id.to_string(), provider);
    }

    pub fn unregister(&self, account_id: &str) {
        self.providers.write().unwrap().remove(account_id);
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
            .ok_or_else(|| Error::NotFound(format!("no provider for account {account_id}")))
    }

    fn account_lock(&self, account_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.account_locks
            .lock()
            .unwrap()
            .entry(account_id.to_string())
            .or_default()
            .clone()
    }

    // -------------------------------------------------------------------- sync

    /// Full incremental sync of one account: folder list, then every folder
    /// (inbox first). Errors in single folders do not abort the run.
    pub async fn sync_account(&self, account_id: &str) -> Result<()> {
        let lock = self.account_lock(account_id);
        let Ok(_guard) = lock.try_lock() else {
            debug!(account_id, "sync already running, skipping");
            return Ok(());
        };
        self.emit(SyncEvent::SyncStarted { account_id: account_id.into() });
        let result = self.sync_account_inner(account_id).await;
        if let Err(e) = &result {
            warn!(account_id, error = %e, "account sync failed");
            self.emit(SyncEvent::Error { account_id: account_id.into(), message: e.to_string() });
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
        for rf in &remote {
            let folder = self.store.get_folder(&folder_id(account_id, &rf.remote_id))?;
            if let Err(e) = self.sync_one(&*provider, &folder, rf).await {
                warn!(account_id, folder = %folder.name, error = %e, "folder sync failed");
                self.emit(SyncEvent::Error {
                    account_id: account_id.into(),
                    message: format!("{}: {e}", folder.name),
                });
            }
        }
        info!(account_id, folders = remote.len(), "account synced");
        Ok(())
    }

    async fn sync_one(&self, provider: &dyn MailProvider, folder: &Folder, remote: &RemoteFolder) -> Result<()> {
        let state = self.store.folder_sync_state(&folder.id)?;
        let changes = provider.sync_folder(remote, state.as_deref()).await?;
        let changed = changes.reset
            || !changes.upserted.is_empty()
            || !changes.removed.is_empty()
            || !changes.flags.is_empty()
            || changes.present.is_some();
        self.store.apply_changes(folder, &changes)?;
        if changed {
            self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
        }

        // Prefetch the newest bodies so previews and offline reading work.
        if matches!(folder.role, FolderRole::Inbox | FolderRole::Sent | FolderRole::Other) {
            let missing = self.store.messages_without_body(&folder.id, PREFETCH_BODIES)?;
            let mut fetched_any = false;
            for id in missing {
                let summary = self.store.get_message(&id)?;
                match provider.fetch_body(&folder.remote_id, &summary.remote_id).await {
                    Ok(body) => {
                        self.store.save_body(&id, &body)?;
                        fetched_any = true;
                    }
                    Err(e) => {
                        debug!(error = %e, "body prefetch failed");
                        break;
                    }
                }
            }
            if fetched_any {
                self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
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

    /// Sync all accounts forever in the given interval.
    pub fn spawn_periodic(self: &Arc<Self>, interval: Duration) -> tokio::task::JoinHandle<()> {
        let engine = Arc::clone(self);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                for account_id in engine.account_ids() {
                    let _ = engine.sync_account(&account_id).await;
                }
            }
        })
    }

    // ----------------------------------------------------------------- reading

    /// Message with body; downloads the body if it is not stored yet.
    pub async fn get_message(&self, message_id: &str) -> Result<MessageDetail> {
        let summary = self.store.get_message(message_id)?;
        let body = match self.store.get_body(message_id)? {
            Some(body) => body,
            None => {
                let folder = self.store.get_folder(&summary.folder_id)?;
                let provider = self.provider(&summary.account_id)?;
                let fetched = provider.fetch_body(&folder.remote_id, &summary.remote_id).await?;
                self.store.save_body(message_id, &fetched)?;
                fetched.body
            }
        };
        Ok(MessageDetail { summary: self.store.get_message(message_id)?, body })
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

    pub async fn set_read(&self, message_id: &str, read: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        if !self.store.set_read(message_id, read)? {
            return Ok(());
        }
        self.store.adjust_unread(&summary.folder_id, if read { -1 } else { 1 })?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        let result = self
            .provider(&summary.account_id)?
            .set_flags(&folder.remote_id, &summary.remote_id, Some(read), None)
            .await;
        if result.is_err() {
            // Roll back the optimistic local change.
            self.store.set_read(message_id, !read)?;
            self.store.adjust_unread(&summary.folder_id, if read { 1 } else { -1 })?;
        }
        result
    }

    pub async fn set_flagged(&self, message_id: &str, flagged: bool) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        self.store.set_flagged(message_id, flagged)?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        let result = self
            .provider(&summary.account_id)?
            .set_flags(&folder.remote_id, &summary.remote_id, None, Some(flagged))
            .await;
        if result.is_err() {
            self.store.set_flagged(message_id, summary.is_flagged)?;
        }
        result
    }

    pub async fn move_message(&self, message_id: &str, target_folder_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let source = self.store.get_folder(&summary.folder_id)?;
        let target = self.store.get_folder(target_folder_id)?;
        if source.account_id != target.account_id {
            return Err(Error::Unsupported("moving messages between accounts".into()));
        }
        self.provider(&summary.account_id)?
            .move_message(&source.remote_id, &summary.remote_id, &target.remote_id)
            .await?;
        self.store.delete_message(message_id)?;
        if !summary.is_read {
            self.store.adjust_unread(&source.id, -1)?;
        }
        self.emit(SyncEvent::FolderUpdated { account_id: source.account_id.clone(), folder_id: source.id.clone() });
        // Pick up the moved message in the target folder.
        let _ = self.sync_folder(&target.id).await;
        Ok(())
    }

    /// Moves to "Deleted items"; deletes permanently when already there.
    pub async fn delete_message(&self, message_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let folder = self.store.get_folder(&summary.folder_id)?;
        if folder.role != FolderRole::Trash
            && let Some(trash) = self.store.folder_by_role(&summary.account_id, FolderRole::Trash)?
        {
            return self.move_message(message_id, &trash.id).await;
        }
        self.provider(&summary.account_id)?
            .delete_message(&folder.remote_id, &summary.remote_id)
            .await?;
        self.store.delete_message(message_id)?;
        self.emit(SyncEvent::FolderUpdated { account_id: folder.account_id.clone(), folder_id: folder.id.clone() });
        Ok(())
    }

    pub async fn archive_message(&self, message_id: &str) -> Result<()> {
        let summary = self.store.get_message(message_id)?;
        let archive = self
            .store
            .folder_by_role(&summary.account_id, FolderRole::Archive)?
            .ok_or_else(|| Error::NotFound("archive folder".into()))?;
        self.move_message(message_id, &archive.id).await
    }

    pub async fn send(&self, account_id: &str, message: &OutgoingMessage) -> Result<()> {
        self.provider(account_id)?.send(message).await?;
        if let Some(sent) = self.store.folder_by_role(account_id, FolderRole::Sent)? {
            let _ = self.sync_folder(&sent.id).await;
        }
        Ok(())
    }
}
