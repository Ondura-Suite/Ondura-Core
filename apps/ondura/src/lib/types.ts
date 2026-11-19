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
  | { type: "graph"; tenant: string; clientId: string; mailbox?: string }
  | { type: "ews"; url: string; username: string; mailbox?: string }
  | { type: "dav"; url: string; username: string };

export interface Account {
  id: string;
  displayName: string;
  email: string;
  kind: AccountKind;
  color?: string | null;
  signature?: string | null;
}

/** Automatic replies (out of office), see `AutoReply` in model.rs. */
export interface AutoReply {
  enabled: boolean;
  /** ISO times; both set = only within this period. */
  start: string | null;
  end: string | null;
  /** HTML. */
  internal: string;
  external: string;
  externalAudience: "none" | "known" | "all";
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
  categories?: string[];
  /** Pinned to the top of the list. */
  pinned?: boolean;
  /** Snoozed until (RFC 3339). */
  snoozedUntil?: string | null;
  /** Focused inbox: true = focused, false = other. */
  focused?: boolean | null;
}

/** Person or group from the global address list (see `DirectoryEntry`). */
export interface DirectoryEntry {
  name: string;
  email: string;
  jobTitle?: string | null;
  department?: string | null;
  office?: string | null;
  phone?: string | null;
  isGroup?: boolean;
}

export interface OrgInfo {
  person: DirectoryEntry | null;
  manager: DirectoryEntry | null;
  reports: DirectoryEntry[];
}

export interface Quota {
  used: number;
  limit: number | null;
}

export interface AttachmentInfo {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
}

/** S/MIME state of a received message (see crates/smime). */
export interface SecurityInfo {
  encrypted: boolean;
  decryptError?: string;
  signature?: {
    valid: boolean;
    trusted: boolean;
    signerName: string;
    signerEmails: string[];
    issuer: string;
    notAfter: string | null;
    signingTime: string | null;
    problem: string | null;
    fingerprint: string | null;
  };
}

/** An S/MIME certificate as shown in the settings. */
export interface CertInfo {
  subject: string;
  issuer: string;
  emails: string[];
  notBefore: string;
  notAfter: string;
  fingerprint: string;
  trusted?: boolean;
}

export interface MessageBody {
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
  security?: SecurityInfo;
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
  /** Delayed sending (RFC 3339). */
  sendAt?: string | null;
  /** S/MIME signature / encryption. */
  sign?: boolean;
  encrypt?: boolean;
  importance?: Importance;
  readReceipt?: boolean;
  deliveryReceipt?: boolean;
  /** Send as / on behalf of another mailbox. */
  from?: Address | null;
}

export type OutgoingAttachment =
  | { source: "file"; path: string }
  | { source: "message"; messageId: string; attachmentId: string; name: string; contentType: string }
  | { source: "text"; name: string; contentType: string; text: string };

export interface OutboxItem {
  opId: number;
  message: OutgoingMessage;
  error: string | null;
  /** Unix seconds of a delayed send. */
  sendAt?: number | null;
}

/** Client-side rule for new mail (mirrors `MailRule` in mail-core). */
export interface MailRule {
  id: string;
  name: string;
  enabled: boolean;
  accountId: string | null;
  fromContains: string | null;
  subjectContains: string | null;
  toContains: string | null;
  moveTo: string | null;
  markRead: boolean;
  flag: boolean;
  category: string | null;
  delete: boolean;
  stop: boolean;
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
