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

/// Who gets the external automatic reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAudience {
    /// No reply to senders outside the organisation.
    None,
    /// Only to senders in the own contacts.
    Known,
    /// To every sender.
    #[default]
    All,
}

/// Automatic replies ("Abwesenheitsnotiz", out of office).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoReply {
    pub enabled: bool,
    /// Only reply within this period (both set) – otherwise until turned off.
    #[serde(default)]
    pub start: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub end: Option<chrono::DateTime<chrono::Utc>>,
    /// HTML reply to senders inside the organisation (or to everyone, for
    /// servers without that distinction).
    #[serde(default)]
    pub internal: String,
    /// HTML reply to senders outside the organisation.
    #[serde(default)]
    pub external: String,
    #[serde(default)]
    pub external_audience: ExternalAudience,
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
    /// Address of a shared mailbox opened with the signed-in user's access.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mailbox: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EwsConfig {
    /// e.g. `https://mail.example.com/EWS/Exchange.asmx`
    pub url: String,
    pub username: String,
    /// Address of a shared mailbox opened with this user's access rights.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mailbox: Option<String>,
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
    /// Colour categories ("Rot", "Projekt X", …), like in Outlook.
    #[serde(default)]
    pub categories: Vec<String>,
    /// Pinned to the top of the list (local only).
    #[serde(default)]
    pub pinned: bool,
    /// Hidden until this time ("snooze"); comes back unread afterwards.
    #[serde(default)]
    pub snoozed_until: Option<DateTime<Utc>>,
    /// Focused inbox: `Some(true)` = focused, `Some(false)` = other,
    /// `None` = not classified yet.
    #[serde(default)]
    pub focused: Option<bool>,
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
    /// S/MIME signature and encryption of the message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security: Option<crate::smime::SecurityInfo>,
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
    /// Delayed sending: the message stays in the outbox until then.
    #[serde(default)]
    pub send_at: Option<DateTime<Utc>>,
    /// Sign with the sender's S/MIME certificate.
    #[serde(default)]
    pub sign: bool,
    /// Encrypt for all recipients with S/MIME.
    #[serde(default)]
    pub encrypt: bool,
    #[serde(default)]
    pub importance: Importance,
    /// Ask the recipients for a read receipt (`Disposition-Notification-To`).
    #[serde(default)]
    pub read_receipt: bool,
    /// Ask the server for a delivery receipt.
    #[serde(default)]
    pub delivery_receipt: bool,
    /// Send as / on behalf of another mailbox (delegation, shared mailbox).
    #[serde(default)]
    pub from: Option<Address>,
}

/// A person or group found in the organisation's directory (global address
/// list) or in the server's "people" ranking.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub job_title: Option<String>,
    #[serde(default)]
    pub department: Option<String>,
    #[serde(default)]
    pub office: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    /// Distribution list / Microsoft 365 group.
    #[serde(default)]
    pub is_group: bool,
}

/// Mailbox size and limit in bytes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub used: u64,
    /// `None` = unlimited or unknown.
    pub limit: Option<u64>,
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
    /// Generated text content (e.g. an iCalendar invitation).
    #[serde(rename_all = "camelCase")]
    Text { name: String, content_type: String, text: String },
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

/// A client-side rule for new mail in the inbox ("Regeln" in Outlook).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MailRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// Only for this account; `None` = all accounts.
    pub account_id: Option<AccountId>,
    /// Conditions (all given ones must match, case-insensitive substrings).
    pub from_contains: Option<String>,
    pub subject_contains: Option<String>,
    pub to_contains: Option<String>,
    /// Actions.
    pub move_to: Option<FolderId>,
    pub mark_read: bool,
    pub flag: bool,
    pub category: Option<String>,
    pub delete: bool,
    /// Do not apply further rules after this one.
    pub stop: bool,
}

impl MailRule {
    pub fn matches(&self, m: &MessageSummary) -> bool {
        let has = |hay: &str, needle: &Option<String>| match needle.as_deref().map(str::trim) {
            None | Some("") => true,
            Some(n) => hay.to_lowercase().contains(&n.to_lowercase()),
        };
        let from = m.from.as_ref().map(|a| format!("{} {}", a.name.clone().unwrap_or_default(), a.email)).unwrap_or_default();
        let to = m.to.iter().chain(&m.cc).map(|a| format!("{} {}", a.name.clone().unwrap_or_default(), a.email)).collect::<Vec<_>>().join(" ");
        let any_condition = [&self.from_contains, &self.subject_contains, &self.to_contains]
            .iter()
            .any(|c| c.as_deref().is_some_and(|s| !s.trim().is_empty()));
        self.enabled
            && any_condition
            && self.account_id.as_ref().is_none_or(|a| *a == m.account_id)
            && has(&from, &self.from_contains)
            && has(&m.subject, &self.subject_contains)
            && has(&to, &self.to_contains)
    }
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
    #[serde(rename_all = "camelCase")]
    SetCategories { folder_remote_id: String, message_remote_id: String, categories: Vec<String> },
}

impl PendingOp {
    pub fn kind(&self) -> &'static str {
        match self {
            PendingOp::SetFlags { .. } => "flags",
            PendingOp::Move { .. } => "move",
            PendingOp::Delete { .. } => "delete",
            PendingOp::Send { .. } => "send",
            PendingOp::SaveDraft { .. } => "draft",
            PendingOp::SetCategories { .. } => "categories",
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
