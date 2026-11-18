//! The abstraction every protocol adapter implements.

use std::collections::HashSet;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::error::{Error, Result};
use crate::model::{Address, AutoReply, FolderRole, Importance, MessageBody, OutgoingMessage, ResolvedAttachment};

/// A folder as reported by the server.
#[derive(Debug, Clone)]
pub struct RemoteFolder {
    pub remote_id: String,
    pub name: String,
    pub parent_remote_id: Option<String>,
    pub role: FolderRole,
    pub unread_count: u32,
    pub total_count: u32,
    /// `false` for IMAP `\Noselect` containers.
    pub selectable: bool,
}

/// A message header as reported by the server.
#[derive(Debug, Clone)]
pub struct RemoteMessage {
    pub remote_id: String,
    pub subject: String,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub date: DateTime<Utc>,
    /// May be empty; the engine fills it in once the body is downloaded.
    pub preview: String,
    pub is_read: bool,
    pub is_flagged: bool,
    pub has_attachments: bool,
    pub importance: Importance,
    pub internet_message_id: Option<String>,
    /// `None` = the adapter does not know categories; local ones are kept.
    pub categories: Option<Vec<String>>,
}

/// Partial flag information (used for incremental flag refreshes where the
/// adapter does not resend the full header).
#[derive(Debug, Clone)]
pub struct RemoteFlags {
    pub remote_id: String,
    pub is_read: bool,
    pub is_flagged: bool,
}

/// Result of one incremental folder synchronisation.
#[derive(Debug, Default)]
pub struct FolderChanges {
    /// New or changed messages.
    pub upserted: Vec<RemoteMessage>,
    /// Flag-only updates for already known messages.
    pub flags: Vec<RemoteFlags>,
    /// Remote ids that were deleted / moved away.
    pub removed: Vec<String>,
    /// If set, this is the authoritative list of remote ids still present in
    /// the synced window; every other local message gets removed.
    pub present: Option<Vec<String>>,
    /// If `true` all local messages of the folder are dropped before applying.
    pub reset: bool,
    /// Opaque state to pass into the next `sync_folder` call.
    pub new_state: Option<String>,
}

/// Body fetched from the server, optionally with the raw RFC 5322 source
/// (IMAP), which is kept so attachments can be served offline.
#[derive(Debug)]
pub struct FetchedBody {
    pub body: MessageBody,
    pub raw: Option<Vec<u8>>,
    /// Sender/recipients taken from the full message, for adapters whose
    /// list view lacks them (EWS returns no recipient addresses there).
    pub recipients: Option<Recipients>,
}

#[derive(Debug, Clone)]
pub struct Recipients {
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
}

#[async_trait]
pub trait MailProvider: Send + Sync {
    /// List all folders of the account.
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>>;

    /// Incrementally synchronise a folder. `state` is whatever this adapter
    /// returned as `new_state` last time (or `None` for the initial sync).
    async fn sync_folder(&self, folder: &RemoteFolder, state: Option<&str>) -> Result<FolderChanges>;

    /// Download the full body of a message.
    async fn fetch_body(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<FetchedBody>;

    /// Download several bodies at once (used for prefetching). The default
    /// implementation fetches them one by one; adapters override it with a
    /// single round trip where the protocol allows.
    async fn fetch_bodies(&self, folder_remote_id: &str, message_remote_ids: &[String]) -> Result<Vec<(String, FetchedBody)>> {
        let mut out = Vec::with_capacity(message_remote_ids.len());
        for id in message_remote_ids {
            out.push((id.clone(), self.fetch_body(folder_remote_id, id).await?));
        }
        Ok(out)
    }

    /// Messages older than the ones synced so far ("load more").
    /// `known` are the remote ids already stored locally, `oldest_date` the
    /// date of the oldest of them.
    async fn fetch_older(
        &self,
        folder: &RemoteFolder,
        known: &HashSet<String>,
        oldest_date: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<RemoteMessage>>;

    /// Download an attachment that is not available from a stored raw message.
    async fn fetch_attachment(&self, folder_remote_id: &str, message_remote_id: &str, attachment_id: &str) -> Result<Vec<u8>>;

    /// Change the read / flagged state; `None` leaves the flag untouched.
    async fn set_flags(&self, folder_remote_id: &str, message_remote_id: &str, read: Option<bool>, flagged: Option<bool>) -> Result<()>;

    /// Move a message. Returns the new remote id if the server assigns one.
    async fn move_message(&self, folder_remote_id: &str, message_remote_id: &str, target_folder_remote_id: &str) -> Result<Option<String>>;

    /// Permanently delete a message.
    async fn delete_message(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<()>;

    /// Send a message (and store it in "Sent" where the server does not do
    /// that automatically).
    async fn send(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()>;

    /// Store a message in the drafts folder.
    async fn save_draft(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()>;

    /// Block until the server reports a change in the folder (IMAP IDLE) or
    /// `timeout` passes. Returns `true` on a change. Adapters without push
    /// support return [`Error::Unsupported`] and are polled instead.
    async fn wait_for_change(&self, _folder_remote_id: &str, _timeout: Duration) -> Result<bool> {
        Err(Error::Unsupported("push".into()))
    }

    /// Set the categories of a message on the server. Adapters without
    /// category support keep them locally only.
    async fn set_categories(&self, _folder_remote_id: &str, _message_remote_id: &str, _categories: &[String]) -> Result<()> {
        Ok(())
    }

    /// Search the whole mailbox on the server. Returns the folder remote id
    /// and header of each hit (newest first). Default: no server search.
    async fn search(&self, _query: &str, _limit: usize) -> Result<Vec<(String, RemoteMessage)>> {
        Err(Error::Unsupported("search".into()))
    }

    /// Automatic replies (out of office) as currently set on the server.
    async fn auto_reply(&self) -> Result<AutoReply> {
        Err(Error::Unsupported("automatic replies".into()))
    }

    /// Change the automatic replies on the server.
    async fn set_auto_reply(&self, _reply: &AutoReply) -> Result<()> {
        Err(Error::Unsupported("automatic replies".into()))
    }
}
