import type { CertificateInfo, ProbeMode } from "./certs";
// Thin wrapper around the Tauri commands in src-tauri/src/commands.rs.
// Falls back to an in-memory demo backend when not running inside Tauri.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Account,
  AccountStatus,
  AutoReply,
  CertInfo,
  AppSettings,
  DirectoryEntry,
  OrgInfo,
  Quota,
  Folder,
  ImapConfig,
  MessageDetail,
  MessageSummary,
  MailRule,
  OutboxItem,
  OutgoingMessage,
  Security,
  SyncEvent,
} from "./types";
import { mockAccounts, mockFolders, mockMessages, mockSend } from "./mock";
import { threadKeyOf } from "./format";
import { tl } from "./i18n";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export interface NewImapAccount {
  displayName: string;
  email: string;
  password: string;
  config: ImapConfig;
}

export interface NewEwsAccount {
  displayName: string;
  email: string;
  password: string;
  config: { url: string; username: string };
}

export interface NewDavAccount {
  displayName: string;
  email: string;
  password: string;
  url: string;
  username: string;
}

export interface NewGraphAccount {
  tenant: string;
  clientId: string;
}

const mockRules: MailRule[] = [];
const mockAutoReplies: Record<string, AutoReply> = {};
const mockCerts: CertInfo[] = [];

const mockSettings: AppSettings = { syncIntervalMinutes: 5, notifications: true, runInBackground: true, loadRemoteImages: false, keyringAvailable: true };
const mockListeners = new Set<(e: SyncEvent) => void>();
const mockEmit = (e: SyncEvent) => mockListeners.forEach((l) => l(e));

export interface MailServer {
  host: string;
  port: number;
  security: Security;
}

/** Result of `discoverMailSettings`. */
export interface MailDiscovery {
  imap?: MailServer | null;
  smtp?: MailServer | null;
  username?: string | null;
  source?: "provider" | "ispdb" | "dns" | "probe" | null;
  provider?: string | null;
  suggest?: "microsoft365" | "exchange" | null;
  ewsUrl?: string | null;
}

export type SweepAction = { type: "delete" } | { type: "keepLatest" } | { type: "archive" } | { type: "move"; folderId: string };

const mockFocusOverrides = new Map<string, boolean>();
/** Demo classification: known senders and the server's verdict, like the backend. */
function mockFocus(m: MessageSummary): boolean {
  const o = m.from ? mockFocusOverrides.get(m.from.email.toLowerCase()) : undefined;
  if (o !== undefined) return o;
  if (m.focused !== undefined && m.focused !== null) return m.focused;
  return !/newsletter|noreply|no-reply|news@|info@/i.test(m.from?.email ?? "");
}

const mockDirectory: DirectoryEntry[] = [
  { name: "Anna Becker", email: "anna.becker@mirranet.de", jobTitle: "Projektleitung", department: "Entwicklung", office: "Saarbrücken" },
  { name: "Jonas Weber", email: "jonas.weber@mirranet.de", jobTitle: "Systemadministrator", department: "IT" },
  { name: "Vertrieb", email: "vertrieb@mirranet.de", isGroup: true },
];

let channel: BroadcastChannel | null | undefined;
/** Browser preview: windows of the same origin talk over a BroadcastChannel. */
function mailChannel(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ondura-mail");
  return channel;
}

export const api = {
  async listAccounts(): Promise<Account[]> {
    if (!isTauri) return mockAccounts.filter((a) => a.kind.type !== "dav");
    return invoke("list_accounts");
  },

  async addImapAccount(input: NewImapAccount): Promise<Account> {
    if (!isTauri) {
      await delay(800);
      const account: Account = { id: crypto.randomUUID(), displayName: input.displayName, email: input.email, kind: { type: "imap", ...input.config } };
      mockAccounts.push(account);
      return account;
    }
    return invoke("add_imap_account", { input });
  },

  async addEwsAccount(input: NewEwsAccount): Promise<Account> {
    if (!isTauri) {
      await delay(800);
      const account: Account = { id: crypto.randomUUID(), displayName: input.displayName, email: input.email, kind: { type: "ews", ...input.config } };
      mockAccounts.push(account);
      return account;
    }
    return invoke("add_ews_account", { input });
  },

  /** Mail and calendar/contacts-only accounts. */
  async listAllAccounts(): Promise<Account[]> {
    if (!isTauri) return [...mockAccounts];
    return invoke("list_all_accounts");
  },

  async addDavAccount(input: NewDavAccount): Promise<Account> {
    if (!isTauri) {
      await delay(800);
      const account: Account = { id: crypto.randomUUID(), displayName: input.displayName, email: input.email, kind: { type: "dav", url: input.url, username: input.username } };
      mockAccounts.push(account);
      return account;
    }
    return invoke("add_dav_account", { input });
  },

  async addGraphAccount(input: NewGraphAccount): Promise<Account> {
    if (!isTauri) throw new Error(tl("Die Microsoft-Anmeldung ist nur in der Desktop-App verfügbar."));
    return invoke("add_graph_account", { input });
  },

  /** Open a shared mailbox with the rights of a Microsoft 365 / Exchange account. */
  async addSharedMailbox(parentId: string, address: string, displayName: string): Promise<Account> {
    if (!isTauri) {
      await delay(600);
      const parent = mockAccounts.find((a) => a.id === parentId)!;
      const kind = parent.kind.type === "graph" || parent.kind.type === "ews" ? { ...parent.kind, mailbox: address } : parent.kind;
      const account: Account = { id: crypto.randomUUID(), displayName: displayName || address, email: address, kind, color: "#8764b8" };
      mockAccounts.push(account);
      return account;
    }
    return invoke("add_shared_mailbox", { parentId, address, displayName });
  },

  async getAutoReply(accountId: string): Promise<AutoReply> {
    if (!isTauri) {
      await delay(150);
      return { ...(mockAutoReplies[accountId] ?? { enabled: false, start: null, end: null, internal: "", external: "", externalAudience: "all" }) };
    }
    return invoke("get_auto_reply", { accountId });
  },

  async setAutoReply(accountId: string, reply: AutoReply): Promise<void> {
    if (!isTauri) {
      await delay(300);
      mockAutoReplies[accountId] = { ...reply };
      return;
    }
    return invoke("set_auto_reply", { accountId, reply });
  },

  // ------------------------------------------------------------ S/MIME

  async smimeIdentities(): Promise<CertInfo[]> {
    if (!isTauri) return mockCerts.map((c) => ({ ...c }));
    return invoke("smime_identities");
  },

  /** Import a .p12/.pfx file (base64). */
  /** `anyPurpose`: also certificates without an email address (PDF signing). */
  async smimeImport(data: string, password: string, anyPurpose = false): Promise<CertInfo> {
    if (!isTauri) {
      await delay(400);
      if (!password) throw new Error(tl("Falsches Passwort oder beschädigte Datei"));
      const now = new Date();
      const c: CertInfo = {
        subject: "Demo Benutzer",
        issuer: "Ondura Test CA (MirraNET)",
        emails: ["demo@mirranet.de"],
        notBefore: now.toISOString(),
        notAfter: new Date(now.getTime() + 365 * 86400_000).toISOString(),
        fingerprint: Array.from(data.slice(0, 32)).map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
        trusted: true,
      };
      mockCerts.splice(0, mockCerts.length, c);
      return c;
    }
    return invoke("smime_import", { data, password, anyPurpose });
  },

  async smimeRemove(fingerprint: string): Promise<void> {
    if (!isTauri) {
      mockCerts.splice(0, mockCerts.length, ...mockCerts.filter((c) => c.fingerprint !== fingerprint));
      return;
    }
    return invoke("smime_remove", { fingerprint });
  },

  async smimeTrust(fingerprint: string): Promise<void> {
    if (!isTauri) return;
    return invoke("smime_trust", { fingerprint });
  },

  /** Addresses without a known certificate. */
  async smimeMissing(emails: string[]): Promise<string[]> {
    if (!isTauri) return emails.filter((e) => !e.endsWith("@mirranet.de"));
    return invoke("smime_missing", { emails });
  },

  async smimeCanSign(email: string): Promise<boolean> {
    if (!isTauri) return mockCerts.some((c) => c.emails.includes(email));
    return invoke("smime_can_sign", { email });
  },

  /** Whether the build has a built-in client id (the id itself stays in Rust). */
  /** Mail server settings for an address (autoconfig, ISP database, DNS, probing). */
  async discoverMailSettings(email: string): Promise<MailDiscovery> {
    if (!isTauri) {
      await new Promise((r) => setTimeout(r, 700));
      const domain = email.split("@")[1] ?? "example.com";
      return { imap: { host: `imap.${domain}`, port: 993, security: "tls" }, smtp: { host: `smtp.${domain}`, port: 465, security: "tls" }, username: email, source: "probe" };
    }
    return invoke("discover_mail_settings", { email });
  },

  async hasBuiltinGraphClientId(): Promise<boolean> {
    if (!isTauri) return false;
    return invoke("has_builtin_graph_client_id");
  },

  async updateAccount(accountId: string, update: { displayName: string; signature: string | null; color?: string | null }): Promise<Account> {
    if (!isTauri) {
      const a = mockAccounts.find((x) => x.id === accountId)!;
      Object.assign(a, update);
      return { ...a };
    }
    return invoke("update_account", { accountId, update });
  },

  async updatePassword(accountId: string, password: string): Promise<void> {
    if (!isTauri) return;
    return invoke("update_password", { accountId, password });
  },

  async reauthGraph(accountId: string): Promise<void> {
    if (!isTauri) throw new Error(tl("Nur in der Desktop-App verfügbar."));
    return invoke("reauth_graph", { accountId });
  },

  async accountStatuses(): Promise<AccountStatus[]> {
    if (!isTauri) {
      // `?demoError` shows the error state of the second demo account.
      const demoError = new URLSearchParams(window.location.search).has("demoError");
      return mockAccounts.map((a, i) => ({
        accountId: a.id,
        syncing: false,
        lastSync: Date.now() / 1000,
        error: demoError && i === 1 ? "authentication failed: invalid_grant: AADSTS700082: The refresh token has expired" : null,
        needsAuth: demoError && i === 1,
        pendingOps: demoError && i === 0 ? 2 : 0,
        outbox: demoError && i === 0 ? 1 : 0,
      }));
    }
    return invoke("account_statuses");
  },

  async removeAccount(accountId: string): Promise<void> {
    if (!isTauri) {
      const i = mockAccounts.findIndex((a) => a.id === accountId);
      if (i >= 0) mockAccounts.splice(i, 1);
      return;
    }
    return invoke("remove_account", { accountId });
  },

  async listFolders(accountId: string): Promise<Folder[]> {
    if (!isTauri) return mockFolders.filter((f) => f.accountId === accountId).map((f) => ({ ...f }));
    return invoke("list_folders", { accountId });
  },

  async listMessages(folderId: string, offset = 0, limit = 100, focused: boolean | null = null): Promise<MessageSummary[]> {
    if (!isTauri) {
      await delay(60);
      const now = new Date().toISOString();
      return mockMessages
        .filter((m) => m.summary.folderId === folderId)
        .filter((m) => !m.summary.snoozedUntil || m.summary.snoozedUntil <= now)
        .filter((m) => focused === null || mockFocus(m.summary) === focused)
        .map((m) => ({ ...m.summary }))
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date))
        .slice(offset, offset + limit);
    }
    return invoke("list_messages", { folderId, offset, limit, focused });
  },

  /** Unread counts of the "Focused" and "Other" tabs. */
  async focusUnread(folderId: string): Promise<[number, number]> {
    if (!isTauri) {
      const unread = mockMessages.filter((m) => m.summary.folderId === folderId && !m.summary.isRead);
      return [unread.filter((m) => mockFocus(m.summary)).length, unread.filter((m) => !mockFocus(m.summary)).length];
    }
    return invoke("focus_unread", { folderId });
  },

  async setFocused(messageId: string, focused: boolean, always: boolean): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m) m.summary.focused = focused;
      if (always && m?.summary.from) mockFocusOverrides.set(m.summary.from.email.toLowerCase(), focused);
      return;
    }
    return invoke("set_focused", { messageId, focused, always });
  },

  async setPinned(messageId: string, pinned: boolean): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m) m.summary.pinned = pinned;
      return;
    }
    return invoke("set_pinned", { messageId, pinned });
  },

  /** Hide a message until `until` (RFC 3339); `null` brings it back now. */
  async snooze(messageId: string, until: string | null): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m) m.summary.snoozedUntil = until;
      return;
    }
    return invoke("snooze_message", { messageId, until });
  },

  async snoozed(): Promise<MessageSummary[]> {
    if (!isTauri) {
      const now = new Date().toISOString();
      return mockMessages.filter((m) => m.summary.snoozedUntil && m.summary.snoozedUntil > now).map((m) => ({ ...m.summary }));
    }
    return invoke("snoozed_messages");
  },

  async ignoreConversation(messageId: string, ignore = true): Promise<void> {
    if (!isTauri) return;
    return invoke("ignore_conversation", { messageId, ignore });
  },

  /** "Sweep": act on all messages of the sender in the folder. */
  async sweep(messageId: string, action: SweepAction): Promise<number> {
    if (!isTauri) return 0;
    return invoke("sweep", { messageId, action });
  },

  async blockSender(messageId: string): Promise<void> {
    if (!isTauri) return;
    return invoke("block_sender", { messageId });
  },

  /** Global address list and frequent contacts. */
  async searchPeople(query: string, limit = 12): Promise<DirectoryEntry[]> {
    if (!isTauri) {
      const q = query.toLowerCase();
      return mockDirectory.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q)).slice(0, limit);
    }
    return invoke("search_people", { query, limit });
  },

  /** Manager and direct reports (Microsoft 365 directory); null if unknown. */
  async orgInfo(email: string): Promise<OrgInfo | null> {
    if (!isTauri) {
      const me = mockDirectory.find((p) => p.email === email);
      if (!me) return null;
      return { person: me, manager: mockDirectory[0] === me ? null : mockDirectory[0], reports: mockDirectory[0] === me ? [mockDirectory[1]] : [] };
    }
    return invoke("org_info", { email });
  },

  /** Flagged messages of all accounts. */
  async flagged(): Promise<MessageSummary[]> {
    if (!isTauri) return mockMessages.filter((m) => m.summary.isFlagged).map((m) => ({ ...m.summary }));
    return invoke("flagged_messages");
  },

  async quota(accountId: string): Promise<Quota | null> {
    if (!isTauri) return { used: 3.2e9, limit: 50e9 };
    return invoke("mailbox_quota", { accountId });
  },

  /** Fetches older messages from the server; resolves to the number added. */
  async loadOlder(folderId: string, limit = 100): Promise<number> {
    if (!isTauri) {
      await delay(500);
      return 0;
    }
    return invoke("load_older", { folderId, limit });
  },

  async search(query: string): Promise<MessageSummary[]> {
    if (!isTauri) {
      const q = query.toLowerCase();
      return mockMessages
        .map((m) => m.summary)
        .filter((m) => [m.subject, m.preview, m.from?.name, m.from?.email].some((v) => v?.toLowerCase().includes(q)));
    }
    return invoke("search_messages", { query });
  },

  async attachmentText(messageId: string, attachmentId: string): Promise<string> {
    if (!isTauri) {
      return "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:demo-invite\r\nSUMMARY:Projektbesprechung\r\nDTSTART:20261125T130000Z\r\nDTEND:20261125T140000Z\r\nLOCATION:Teams\r\nORGANIZER;CN=Sophie Berger:mailto:sophie.berger@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }
    return invoke("attachment_text", { messageId, attachmentId });
  },

  /** Search on the servers (IMAP SEARCH, Graph $search, EWS AQS). */
  async searchServer(query: string): Promise<MessageSummary[]> {
    if (!isTauri) {
      await delay(600);
      return [];
    }
    return invoke("search_server", { query });
  },

  /** Messages of the conversation, oldest first. */
  async conversation(messageId: string): Promise<MessageSummary[]> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId)?.summary;
      if (!m) return [];
      const key = threadKeyOf(m.subject);
      return mockMessages
        .map((x) => x.summary)
        .filter((x) => x.accountId === m.accountId && key && threadKeyOf(x.subject) === key)
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    return invoke("conversation", { messageId });
  },

  async threadCounts(accountId: string, keys: string[]): Promise<Record<string, number>> {
    if (!isTauri) {
      const out: Record<string, number> = {};
      for (const k of keys) out[k] = mockMessages.filter((x) => x.summary.accountId === accountId && threadKeyOf(x.summary.subject) === k).length;
      return out;
    }
    return invoke("thread_counts", { accountId, keys });
  },

  async setCategories(messageId: string, categories: string[]): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m) m.summary.categories = categories;
      return;
    }
    return invoke("set_categories", { messageId, categories });
  },

  async categories(): Promise<string[]> {
    if (!isTauri) return [...new Set(mockMessages.flatMap((m) => m.summary.categories ?? []))].sort();
    return invoke("categories");
  },

  async rules(): Promise<MailRule[]> {
    if (!isTauri) return [...mockRules];
    return invoke("rules");
  },

  async saveRules(rules: MailRule[]): Promise<void> {
    if (!isTauri) {
      mockRules.splice(0, mockRules.length, ...rules);
      return;
    }
    return invoke("save_rules", { rules });
  },

  async getMessage(messageId: string): Promise<MessageDetail> {
    if (!isTauri) {
      await delay(80);
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (!m) throw new Error(tl("Nachricht nicht gefunden"));
      return structuredClone(m);
    }
    return invoke("get_message", { messageId });
  },

  async setRead(messageId: string, read: boolean): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m && m.summary.isRead !== read) {
        m.summary.isRead = read;
        const f = mockFolders.find((x) => x.id === m.summary.folderId);
        if (f) f.unreadCount = Math.max(0, f.unreadCount + (read ? -1 : 1));
      }
      return;
    }
    return invoke("set_read", { messageId, read });
  },

  async setFlagged(messageId: string, flagged: boolean): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m) m.summary.isFlagged = flagged;
      return;
    }
    return invoke("set_flagged", { messageId, flagged });
  },

  async moveMessage(messageId: string, targetFolderId: string): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (m) m.summary.folderId = targetFolderId;
      return;
    }
    return invoke("move_message", { messageId, targetFolderId });
  },

  async deleteMessage(messageId: string): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      if (!m) return;
      const trash = mockFolders.find((f) => f.accountId === m.summary.accountId && f.role === "trash");
      if (trash && m.summary.folderId !== trash.id) m.summary.folderId = trash.id;
      else mockMessages.splice(mockMessages.indexOf(m), 1);
      return;
    }
    return invoke("delete_message", { messageId });
  },

  async archiveMessage(messageId: string): Promise<void> {
    if (!isTauri) {
      const m = mockMessages.find((x) => x.summary.id === messageId);
      const archive = m && mockFolders.find((f) => f.accountId === m.summary.accountId && f.role === "archive");
      if (!archive) throw new Error(tl("Kein Archivordner vorhanden"));
      m.summary.folderId = archive.id;
      return;
    }
    return invoke("archive_message", { messageId });
  },

  /** Queues a message; the outcome arrives as `messageSent` / `sendFailed`. */
  async send(accountId: string, message: OutgoingMessage): Promise<void> {
    if (!isTauri) {
      setTimeout(() => {
        mockSend(accountId, message);
        mockEmit({ type: "messageSent", accountId, subject: message.subject });
        mockEmit({ type: "folderUpdated", accountId, folderId: "" });
      }, 700);
      return;
    }
    return invoke("send_message", { accountId, message });
  },

  async saveDraft(accountId: string, message: OutgoingMessage): Promise<void> {
    if (!isTauri) {
      await delay(200);
      return;
    }
    return invoke("save_draft", { accountId, message });
  },

  async outbox(accountId: string): Promise<OutboxItem[]> {
    if (!isTauri) return [];
    return invoke("outbox", { accountId });
  },

  async retryPending(accountId: string): Promise<void> {
    if (!isTauri) return;
    return invoke("retry_pending", { accountId });
  },

  async discardPending(accountId: string, opId: number): Promise<void> {
    if (!isTauri) return;
    return invoke("discard_pending", { accountId, opId });
  },

  async probeCertificate(host: string, port: number, mode: ProbeMode): Promise<CertificateInfo> {
    if (!isTauri) return { host, port, fingerprint: "3A:7F:00:C2:91:5E:44:0B:8D:21:6C:FA:13:9E:52:77:A0:0D:4E:BB:68:19:F2:C3:7E:5A:11:90:D4:2B:66:E8", problem: "invalid peer certificate: UnknownIssuer", trusted: false };
    return invoke("probe_certificate", { host, port, mode });
  },

  async setCertificateTrust(fingerprint: string, trusted: boolean): Promise<void> {
    if (!isTauri) return;
    return invoke("set_certificate_trust", { fingerprint, trusted });
  },

  async trustedCertificates(): Promise<string[]> {
    if (!isTauri) return [];
    return invoke("trusted_certificates");
  },

  async getSettings(): Promise<AppSettings> {
    if (!isTauri) return { ...mockSettings };
    return invoke("get_settings");
  },

  async saveSettings(settings: AppSettings): Promise<void> {
    if (!isTauri) {
      Object.assign(mockSettings, settings);
      return;
    }
    return invoke("save_settings", { settings });
  },

  /** Native yes/no question (window.confirm is unreliable in webviews). */
  async confirm(message: string, title = tl("Ondura")): Promise<boolean> {
    if (!isTauri) return window.confirm(message);
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel: tl("Ja"), cancelLabel: tl("Abbrechen") });
  },

  /** File picker for attachments; returns absolute paths. */
  async pickFiles(): Promise<string[]> {
    if (!isTauri) return ["/home/demo/Dokumente/Angebot.pdf"];
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ multiple: true, title: tl("Dateien anhängen") });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  },

  async syncAccount(accountId: string): Promise<void> {
    if (!isTauri) {
      await delay(600);
      return;
    }
    return invoke("sync_account", { accountId });
  },

  async syncFolder(folderId: string): Promise<void> {
    if (!isTauri) return;
    return invoke("sync_folder", { folderId });
  },

  /** Saves an attachment to the Downloads folder and opens it. */
  async openAttachment(messageId: string, attachmentId: string, fileName: string): Promise<string> {
    if (!isTauri) return `~/Downloads/${fileName}`;
    return invoke("open_attachment", { messageId, attachmentId, fileName });
  },

  async openExternal(url: string): Promise<void> {
    if (!isTauri) {
      window.open(url, "_blank", "noopener");
      return;
    }
    return invoke("open_external", { url });
  },

  /** Apps chosen in the installer (Ondura Mail and/or the office apps). */
  async installedApps(): Promise<string[] | null> {
    if (!isTauri) return null;
    return invoke<string[]>("installed_apps");
  },

  /** Opens a message in its own window (double-click in the list, like Outlook). */
  async openMessageWindow(messageId: string, subject: string): Promise<void> {
    if (!isTauri) {
      window.open(`${location.pathname}#/message/${encodeURIComponent(messageId)}`, "_blank", "width=1000,height=800");
      return;
    }
    return invoke("open_message_window", { messageId, title: subject });
  },

  /** CMS signature over the signed bytes of a PDF (base64 in and out). */
  async pdfSign(fingerprint: string, data: string): Promise<string> {
    return invoke("pdf_sign", { fingerprint, data });
  },

  async pdfVerify(contents: string, signed: string): Promise<{ valid: boolean; trusted: boolean; signer: CertInfo | null; signingTime: string | null; problem: string | null }> {
    if (!isTauri) return { valid: false, trusted: false, signer: null, signingTime: null, problem: tl("Signaturen werden nur in der Desktop-App geprüft.") };
    return invoke("pdf_verify", { contents, signed });
  },

  /** mailto: links passed to the running app (it is the default email app). */
  async onMailto(handler: (link: string) => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen<string>("mailto", (e) => handler(e.payload));
  },

  /** Tells the other Ondura Mail windows that messages of an account changed. */
  async announceMailChange(accountId: string): Promise<void> {
    if (!isTauri) {
      mailChannel()?.postMessage(accountId);
      return;
    }
    const { emit } = await import("@tauri-apps/api/event");
    await emit("mail-local-change", accountId);
  },

  async onMailChange(handler: (accountId: string) => void): Promise<UnlistenFn> {
    if (!isTauri) {
      const ch = mailChannel();
      const on = (e: MessageEvent) => handler(String(e.data));
      ch?.addEventListener("message", on);
      return () => ch?.removeEventListener("message", on);
    }
    return listen<string>("mail-local-change", (e) => handler(e.payload));
  },

  /** Opens (or focuses) another app of the suite in its own window. */
  async openApp(app: string): Promise<void> {
    if (!isTauri) {
      window.location.hash = `#/${app}`;
      return;
    }
    return invoke("open_app", { appId: app });
  },

  async onSync(handler: (e: SyncEvent) => void): Promise<UnlistenFn> {
    if (!isTauri) {
      mockListeners.add(handler);
      return () => mockListeners.delete(handler);
    }
    return listen<SyncEvent>("mail-sync", (e) => handler(e.payload));
  },
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
