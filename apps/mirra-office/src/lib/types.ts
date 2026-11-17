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
  | { type: "ews"; url: string; username: string };

export interface Account {
  id: string;
  displayName: string;
  email: string;
  kind: AccountKind;
  color?: string | null;
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
}

export type SyncEvent =
  | { type: "syncStarted"; accountId: string }
  | { type: "foldersChanged"; accountId: string }
  | { type: "folderUpdated"; accountId: string; folderId: string }
  | { type: "syncFinished"; accountId: string }
  | { type: "error"; accountId: string; message: string };
