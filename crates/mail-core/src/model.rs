//! Domain model shared between the store, the sync engine, the adapters and
//! the UI (all types are `serde` serializable and sent to the frontend as-is).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type AccountId = String;
pub type FolderId = String;
pub type MessageId = String;

/// Namespace for deterministic local ids (UUIDv5).
const ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d69_7272_612d_6f66_6669_6365_2d69_6473);

/// Local folder id derived from the account and the remote folder id.
/// Deterministic ids let us upsert without a lookup table.
pub fn folder_id(account_id: &str, remote_id: &str) -> FolderId {
    Uuid::new_v5(&ID_NAMESPACE, format!("{account_id}/f/{remote_id}").as_bytes()).to_string()
}

/// Local message id derived from the folder and the remote message id.
pub fn message_id(folder_id: &str, remote_id: &str) -> MessageId {
    Uuid::new_v5(&ID_NAMESPACE, format!("{folder_id}/m/{remote_id}").as_bytes()).to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: AccountId,
    pub display_name: String,
    pub email: String,
    pub kind: AccountKind,
    /// Accent colour shown in the folder pane, e.g. `#0f6cbd`.
    #[serde(default)]
    pub color: Option<String>,
    /// HTML signature appended to new messages and replies.
    #[serde(default)]
    pub signature: Option<String>,
    /// Optional CalDAV/CardDAV server for calendars and contacts of a mail
    /// account (e.g. an IMAP account whose server also runs Nextcloud).
    #[serde(default)]
    pub dav: Option<DavConfig>,
}

impl Account {
    /// `false` for calendar/contacts-only accounts.
    pub fn has_mail(&self) -> bool {
        !matches!(self.kind, AccountKind::Dav(_))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AccountKind {
    /// Generic IMAP + SMTP (e.g. the own mail server on mirranet.de).
    Imap(ImapConfig),
    /// Microsoft 365 / Exchange Online via Microsoft Graph.
    Graph(GraphConfig),
    /// Exchange Server on premises via EWS.
    Ews(EwsConfig),
    /// Calendars, contacts and tasks only (CalDAV/CardDAV, e.g. Nextcloud).
    Dav(DavConfig),
}

impl AccountKind {
    pub fn label(&self) -> &'static str {
        match self {
            AccountKind::Imap(_) => "IMAP",
            AccountKind::Graph(_) => "Microsoft 365",
            AccountKind::Ews(_) => "Exchange",
            AccountKind::Dav(_) => "CalDAV/CardDAV",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Security {
    /// Implicit TLS (IMAPS 993, SMTPS 465).
    Tls,
    /// Plain connection upgraded with STARTTLS (IMAP 143, Submission 587).
    StartTls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapConfig {
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: Security,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: Security,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphConfig {
    /// Azure AD tenant: `common`, `organizations` or a tenant id/domain.
    pub tenant: String,
    /// Client id of the (public client) app registration.
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EwsConfig {
    /// e.g. `https://mail.example.com/EWS/Exchange.asmx`
    pub url: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DavConfig {
    /// Server or principal URL, e.g. `https://cloud.example.com/remote.php/dav/`.
    pub url: String,
    pub username: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderRole {
    Inbox,
    Drafts,
    Sent,
    Archive,
    Junk,
    Trash,
    Other,
}

impl FolderRole {
    /// Sort order used by the folder pane (well-known folders first).
    pub fn sort_key(self) -> u8 {
        match self {
            FolderRole::Inbox => 0,
            FolderRole::Drafts => 1,
            FolderRole::Sent => 2,
            FolderRole::Archive => 3,
            FolderRole::Junk => 4,
            FolderRole::Trash => 5,
            FolderRole::Other => 9,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            FolderRole::Inbox => "inbox",
            FolderRole::Drafts => "drafts",
            FolderRole::Sent => "sent",
            FolderRole::Archive => "archive",
            FolderRole::Junk => "junk",
            FolderRole::Trash => "trash",
            FolderRole::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "inbox" => FolderRole::Inbox,
            "drafts" => FolderRole::Drafts,
            "sent" => FolderRole::Sent,
            "archive" => FolderRole::Archive,
            "junk" => FolderRole::Junk,
            "trash" => FolderRole::Trash,
            _ => FolderRole::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: FolderId,
    pub account_id: AccountId,
    pub remote_id: String,
    pub name: String,
    pub parent_id: Option<FolderId>,
    pub role: FolderRole,
    pub unread_count: u32,
    pub total_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

impl Address {
    pub fn new(name: Option<String>, email: impl Into<String>) -> Self {
        Self { name, email: email.into() }
    }

    pub fn display(&self) -> &str {
        self.name.as_deref().filter(|n| !n.is_empty()).unwrap_or(&self.email)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Importance {
    Low,
    #[default]
    Normal,
    High,
}

/// Everything needed to render a row in the message list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: MessageId,
    /// Conversation id (normalised subject), used to group threads.
    #[serde(default)]
    pub thread_key: String,
    pub account_id: AccountId,
    pub folder_id: FolderId,
    pub remote_id: String,
    pub subject: String,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub date: DateTime<Utc>,
    pub preview: String,
    pub is_read: bool,
    pub is_flagged: bool,
    pub has_attachments: bool,
    pub importance: Importance,
    /// RFC 5322 `Message-ID`, used for threading and replies.
    pub internet_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub id: String,
    pub name: String,
    pub content_type: String,
    pub size: u64,
    pub is_inline: bool,
    pub content_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageBody {
    pub html: Option<String>,
    pub text: Option<String>,
    pub attachments: Vec<AttachmentInfo>,
}

/// A full message as shown in the reading pane.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    pub summary: MessageSummary,
    pub body: MessageBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessage {
    pub to: Vec<Address>,
    #[serde(default)]
    pub cc: Vec<Address>,
    #[serde(default)]
    pub bcc: Vec<Address>,
    pub subject: String,
    pub body_html: String,
    /// `Message-ID` of the message this one replies to.
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub attachments: Vec<OutgoingAttachment>,
    /// Local id of the draft this message was created from; the draft is
    /// removed after sending or re-saving.
    #[serde(default)]
    pub draft_id: Option<MessageId>,
}

/// An attachment of an outgoing message, resolved by the engine right
/// before the message is handed to the provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "camelCase")]
pub enum OutgoingAttachment {
    /// A file on disk (picked in the compose window).
    #[serde(rename_all = "camelCase")]
    File { path: String },
    /// An attachment of a stored message (forwarding).
    #[serde(rename_all = "camelCase")]
    Message { message_id: MessageId, attachment_id: String, name: String, content_type: String },
}

/// Attachment with its content loaded.
#[derive(Debug, Clone)]
pub struct ResolvedAttachment {
    pub name: String,
    pub content_type: String,
    pub data: Vec<u8>,
}

/// Connection state of an account as shown in the folder pane.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub account_id: AccountId,
    pub syncing: bool,
    /// Unix timestamp of the last successful sync.
    pub last_sync: Option<i64>,
    /// Last error, cleared by the next successful sync.
    pub error: Option<String>,
    /// `true` if the error requires the user to sign in again.
    pub needs_auth: bool,
    /// Actions waiting to be sent to the server (incl. outgoing mail).
    pub pending_ops: u32,
    pub outbox: u32,
}

/// Normalised subject used to group a conversation ("AW: WG: Hallo" → "hallo").
pub fn thread_key(subject: &str) -> String {
    let mut s = subject.trim();
    loop {
        let lower = s.to_lowercase();
        let stripped = ["re:", "aw:", "wg:", "fw:", "fwd:", "antw:", "sv:", "vs:", "tr:", "rif:"]
            .iter()
            .find(|p| lower.starts_with(*p))
            .map(|p| s[p.len()..].trim_start());
        match stripped {
            Some(rest) => s = rest,
            None => break,
        }
    }
    s.to_lowercase()
}

/// An action that was applied locally and still has to reach the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PendingOp {
    #[serde(rename_all = "camelCase")]
    SetFlags { folder_remote_id: String, message_remote_id: String, read: Option<bool>, flagged: Option<bool> },
    #[serde(rename_all = "camelCase")]
    Move { folder_remote_id: String, message_remote_id: String, target_folder_remote_id: String },
    #[serde(rename_all = "camelCase")]
    Delete { folder_remote_id: String, message_remote_id: String },
    #[serde(rename_all = "camelCase")]
    Send { message: OutgoingMessage },
    #[serde(rename_all = "camelCase")]
    SaveDraft { message: OutgoingMessage },
}

impl PendingOp {
    pub fn kind(&self) -> &'static str {
        match self {
            PendingOp::SetFlags { .. } => "flags",
            PendingOp::Move { .. } => "move",
            PendingOp::Delete { .. } => "delete",
            PendingOp::Send { .. } => "send",
            PendingOp::SaveDraft { .. } => "draft",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::thread_key;

    #[test]
    fn normalises_subjects() {
        assert_eq!(thread_key("AW: WG: Re: Hallo Welt"), "hallo welt");
        assert_eq!(thread_key("Fwd:Angebot"), "angebot");
        assert_eq!(thread_key("Rechnung"), "rechnung");
    }
}
