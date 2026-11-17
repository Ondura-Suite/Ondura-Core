// Thin wrapper around the Tauri commands in src-tauri/src/commands.rs.
// Falls back to an in-memory demo backend when not running inside Tauri.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Account,
  AccountStatus,
  AppSettings,
  Folder,
  ImapConfig,
  MessageDetail,
  MessageSummary,
  MailRule,
  OutboxItem,
  OutgoingMessage,
  SyncEvent,
} from "./types";
import { mockAccounts, mockFolders, mockMessages, mockSend } from "./mock";
import { threadKeyOf } from "./format";

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

const mockSettings: AppSettings = { syncIntervalMinutes: 5, notifications: true, runInBackground: true, loadRemoteImages: false, keyringAvailable: true };
const mockListeners = new Set<(e: SyncEvent) => void>();
const mockEmit = (e: SyncEvent) => mockListeners.forEach((l) => l(e));

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
    if (!isTauri) throw new Error("Die Microsoft-Anmeldung ist nur in der Desktop-App verfügbar.");
    return invoke("add_graph_account", { input });
  },

  /** Whether the build has a built-in client id (the id itself stays in Rust). */
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
    if (!isTauri) throw new Error("Nur in der Desktop-App verfügbar.");
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

  async listMessages(folderId: string, offset = 0, limit = 100): Promise<MessageSummary[]> {
    if (!isTauri) {
      await delay(60);
      return mockMessages
        .filter((m) => m.summary.folderId === folderId)
        .map((m) => ({ ...m.summary }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(offset, offset + limit);
    }
    return invoke("list_messages", { folderId, offset, limit });
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
      if (!m) throw new Error("Nachricht nicht gefunden");
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
      if (!archive) throw new Error("Kein Archivordner vorhanden");
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
  async confirm(message: string, title = "Nexora"): Promise<boolean> {
    if (!isTauri) return window.confirm(message);
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel: "Ja", cancelLabel: "Abbrechen" });
  },

  /** File picker for attachments; returns absolute paths. */
  async pickFiles(): Promise<string[]> {
    if (!isTauri) return ["/home/demo/Dokumente/Angebot.pdf"];
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ multiple: true, title: "Dateien anhängen" });
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
