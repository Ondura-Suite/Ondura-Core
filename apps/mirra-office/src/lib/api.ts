// Thin wrapper around the Tauri commands in src-tauri/src/commands.rs.
// Falls back to an in-memory demo backend when not running inside Tauri.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Account, Folder, ImapConfig, MessageDetail, MessageSummary, OutgoingMessage, SyncEvent } from "./types";
import { mockAccounts, mockFolders, mockMessages, mockSend } from "./mock";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export interface NewImapAccount {
  displayName: string;
  email: string;
  password: string;
  config: ImapConfig;
}

export interface NewGraphAccount {
  tenant: string;
  clientId: string;
}

export const api = {
  async listAccounts(): Promise<Account[]> {
    if (!isTauri) return [...mockAccounts];
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

  async addGraphAccount(input: NewGraphAccount): Promise<Account> {
    if (!isTauri) throw new Error("Die Microsoft-Anmeldung ist nur in der Desktop-App verfügbar.");
    return invoke("add_graph_account", { input });
  },

  async defaultGraphClientId(): Promise<string | null> {
    if (!isTauri) return null;
    return invoke("default_graph_client_id");
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

  async search(query: string): Promise<MessageSummary[]> {
    if (!isTauri) {
      const q = query.toLowerCase();
      return mockMessages
        .map((m) => m.summary)
        .filter((m) => [m.subject, m.preview, m.from?.name, m.from?.email].some((v) => v?.toLowerCase().includes(q)));
    }
    return invoke("search_messages", { query });
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

  async send(accountId: string, message: OutgoingMessage): Promise<void> {
    if (!isTauri) {
      await delay(500);
      mockSend(accountId, message);
      return;
    }
    return invoke("send_message", { accountId, message });
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
    if (!isTauri) return () => {};
    return listen<SyncEvent>("mail-sync", (e) => handler(e.payload));
  },
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
