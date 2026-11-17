// TypeScript mirrors of the Rust model in crates/mail-core/src/model.rs.

export type Security = "tls" | "startTls";

export interface ImapConfig {
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  username: string;
}

export type AccountKind =
  | ({ type: "imap" } & ImapConfig)
  | { type: "graph"; tenant: string; clientId: string }
  | { type: "ews"; url: string; username: string }
  | { type: "dav"; url: string; username: string };

export interface Account {
  id: string;
  displayName: string;
  email: string;
  kind: AccountKind;
  color?: string | null;
  signature?: string | null;
}

export interface AccountStatus {
  accountId: string;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
  needsAuth: boolean;
  pendingOps: number;
  outbox: number;
}

export interface AppSettings {
  syncIntervalMinutes: number;
  notifications: boolean;
  runInBackground: boolean;
  loadRemoteImages: boolean;
  keyringAvailable: boolean;
}

export type FolderRole = "inbox" | "drafts" | "sent" | "archive" | "junk" | "trash" | "other";

export interface Folder {
  id: string;
  accountId: string;
  remoteId: string;
  name: string;
  parentId: string | null;
  role: FolderRole;
  unreadCount: number;
  totalCount: number;
}

export interface Address {
  name: string | null;
  email: string;
}

export type Importance = "low" | "normal" | "high";

export interface MessageSummary {
  id: string;
  threadKey?: string;
  accountId: string;
  folderId: string;
  remoteId: string;
  subject: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  date: string; // RFC 3339
  preview: string;
  isRead: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  importance: Importance;
  internetMessageId: string | null;
}

export interface AttachmentInfo {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
}

export interface MessageBody {
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
}

export interface MessageDetail {
  summary: MessageSummary;
  body: MessageBody;
}

export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string | null;
  attachments?: OutgoingAttachment[];
  draftId?: string | null;
}

export type OutgoingAttachment =
  | { source: "file"; path: string }
  | { source: "message"; messageId: string; attachmentId: string; name: string; contentType: string };

export interface OutboxItem {
  opId: number;
  message: OutgoingMessage;
  error: string | null;
}

export type SyncEvent =
  | { type: "syncStarted"; accountId: string }
  | { type: "foldersChanged"; accountId: string }
  | { type: "folderUpdated"; accountId: string; folderId: string }
  | { type: "syncFinished"; accountId: string }
  | { type: "error"; accountId: string; message: string }
  | { type: "status"; status: AccountStatus }
  | { type: "newMail"; accountId: string; folderId: string; messageId: string; count: number; from: string; subject: string }
  | { type: "messageSent"; accountId: string; subject: string }
  | { type: "sendFailed"; accountId: string; subject: string; message: string };
