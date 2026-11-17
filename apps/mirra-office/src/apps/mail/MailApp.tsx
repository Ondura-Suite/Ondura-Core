import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { PersonAdd24Regular } from "@fluentui/react-icons";
import type { Account, Folder, MessageDetail, MessageSummary, OutgoingMessage } from "../../lib/types";
import { api, errorMessage, isTauri } from "../../lib/api";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { AppTile, suiteApp } from "../../suite";
import { FolderPane } from "./FolderPane";
import { MessageList } from "./MessageList";
import { ReadingPane } from "./ReadingPane";
import { Ribbon, type ReadingPanePosition } from "./Ribbon";
import { Compose, type ComposeMode, type ComposeState } from "./Compose";
import { AccountDialog } from "./AccountDialog";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  panes: { flex: 1, display: "flex", minHeight: 0, padding: "8px", gap: "8px" },
  content: { flex: 1, display: "flex", gap: "8px", minWidth: 0, minHeight: 0 },
  welcome: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", textAlign: "center" },
});

const PANE_KEY = "mirra-mail.readingPane";

export function MailApp() {
  const s = useStyles();
  const notify = useNotify();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [folders, setFolders] = useState<Record<string, Folder[]>>({});
  const [folderId, setFolderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showFolders, setShowFolders] = useState(true);
  const [accountDialog, setAccountDialog] = useState(false);
  const [readingPane, setReadingPane] = useState<ReadingPanePosition>(() => {
    try {
      return (localStorage.getItem(PANE_KEY) as ReadingPanePosition) || "right";
    } catch {
      return "right";
    }
  });

  const allFolders = useMemo(() => Object.values(folders).flat(), [folders]);
  const currentFolder = allFolders.find((f) => f.id === folderId) ?? null;
  const selected = messages.find((m) => m.id === selectedId) ?? null;
  const folderRef = useRef(folderId);
  folderRef.current = folderId;
  const queryRef = useRef(query);
  queryRef.current = query;

  // ------------------------------------------------------------- loading

  const loadFolders = useCallback(async (accountId: string) => {
    const list = await api.listFolders(accountId);
    setFolders((f) => ({ ...f, [accountId]: list }));
    return list;
  }, []);

  const loadMessages = useCallback(async (fid: string | null = folderRef.current) => {
    if (queryRef.current.trim()) {
      setMessages(await api.search(queryRef.current.trim()));
      return;
    }
    if (!fid) return setMessages([]);
    setListLoading(true);
    try {
      const list = await api.listMessages(fid, 0, 200);
      if (fid === folderRef.current) setMessages(list);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
    const all = await Promise.all(list.map((a) => loadFolders(a.id)));
    if (!folderRef.current) {
      const inbox = all.flat().find((f) => f.role === "inbox") ?? all.flat()[0];
      if (inbox) setFolderId(inbox.id);
    }
    return list;
  }, [loadFolders]);

  useEffect(() => {
    loadAccounts().catch((e) => notify("Konten konnten nicht geladen werden", errorMessage(e), "error"));
  }, [loadAccounts, notify]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    loadMessages(folderId);
    if (folderId) api.syncFolder(folderId).catch(() => {});
  }, [folderId, loadMessages]);

  useEffect(() => {
    const t = setTimeout(() => loadMessages(), 200);
    return () => clearTimeout(t);
  }, [query, loadMessages]);

  // Live updates from the sync engine.
  useEffect(() => {
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const unlisten = api.onSync((e) => {
      switch (e.type) {
        case "syncStarted":
          setSyncing((s) => new Set(s).add(e.accountId));
          break;
        case "syncFinished":
          setSyncing((s) => {
            const n = new Set(s);
            n.delete(e.accountId);
            return n;
          });
          break;
        case "error":
          notify("Synchronisierung fehlgeschlagen", e.message, "error");
          break;
        case "foldersChanged":
        case "folderUpdated":
          pending.add(e.accountId);
          clearTimeout(refresh);
          refresh = setTimeout(() => {
            pending.forEach((id) => loadFolders(id));
            pending.clear();
            loadMessages();
          }, 250);
          break;
      }
    });
    return () => {
      clearTimeout(refresh);
      unlisten.then((u) => u());
    };
  }, [loadFolders, loadMessages, notify]);

  // ------------------------------------------------------------- actions

  const refreshCounts = (accountId: string) => loadFolders(accountId).catch(() => {});

  const patchMessage = (id: string, patch: Partial<MessageSummary>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const select = async (m: MessageSummary) => {
    setCompose(null);
    setSelectedId(m.id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await api.getMessage(m.id);
      setDetail(d);
      if (!m.isRead) {
        patchMessage(m.id, { isRead: true });
        await api.setRead(m.id, true);
        refreshCounts(m.accountId);
      }
      // The body download may have filled in the preview.
      patchMessage(m.id, { preview: d.summary.preview, hasAttachments: d.summary.hasAttachments });
    } catch (e) {
      notify("Nachricht konnte nicht geladen werden", errorMessage(e), "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      notify(label, errorMessage(e), "error");
      loadMessages();
    }
  };

  const removeFromList = (m: MessageSummary) => {
    setMessages((list) => {
      const idx = list.findIndex((x) => x.id === m.id);
      const next = list.filter((x) => x.id !== m.id);
      if (selectedId === m.id) {
        const neighbour = next[idx] ?? next[idx - 1];
        if (neighbour) setTimeout(() => select(neighbour), 0);
        else {
          setSelectedId(null);
          setDetail(null);
        }
      }
      return next;
    });
  };

  const toggleRead = (m: MessageSummary) =>
    run("Status konnte nicht geändert werden", async () => {
      patchMessage(m.id, { isRead: !m.isRead });
      await api.setRead(m.id, !m.isRead);
      refreshCounts(m.accountId);
    });

  const toggleFlag = (m: MessageSummary) =>
    run("Kennzeichnung fehlgeschlagen", async () => {
      patchMessage(m.id, { isFlagged: !m.isFlagged });
      if (detail?.summary.id === m.id) setDetail({ ...detail, summary: { ...detail.summary, isFlagged: !m.isFlagged } });
      await api.setFlagged(m.id, !m.isFlagged);
    });

  const del = (m: MessageSummary) =>
    run("Löschen fehlgeschlagen", async () => {
      removeFromList(m);
      await api.deleteMessage(m.id);
      refreshCounts(m.accountId);
    });

  const archive = (m: MessageSummary) =>
    run("Archivieren fehlgeschlagen", async () => {
      await api.archiveMessage(m.id);
      removeFromList(m);
      refreshCounts(m.accountId);
    });

  const move = (m: MessageSummary, target: string) =>
    run("Verschieben fehlgeschlagen", async () => {
      removeFromList(m);
      await api.moveMessage(m.id, target);
      refreshCounts(m.accountId);
    });

  const startCompose = (mode: ComposeMode) => {
    if (!accounts?.length) return setAccountDialog(true);
    const accountId = (mode === "new" ? currentFolder?.accountId : detail?.summary.accountId) ?? accounts[0].id;
    setCompose({ mode, accountId, original: mode === "new" ? undefined : detail ?? undefined });
  };

  const send = async (accountId: string, message: OutgoingMessage) => {
    try {
      await api.send(accountId, message);
      notify("Nachricht gesendet", undefined, "success");
      setCompose(null);
      refreshCounts(accountId);
      loadMessages();
    } catch (e) {
      notify("Senden fehlgeschlagen", errorMessage(e), "error");
      throw e;
    }
  };

  const syncAll = () => accounts?.forEach((a) => syncAccount(a));

  const syncAccount = (a: Account) => {
    if (!isTauri) {
      setSyncing((s) => new Set(s).add(a.id));
      setTimeout(() => setSyncing(new Set()), 800);
    }
    api.syncAccount(a.id).catch((e) => notify("Synchronisierung fehlgeschlagen", errorMessage(e), "error"));
  };

  const removeAccount = (a: Account) =>
    run("Konto konnte nicht entfernt werden", async () => {
      await api.removeAccount(a.id);
      setFolders(({ [a.id]: _, ...rest }) => rest);
      if (currentFolder?.accountId === a.id) setFolderId(null);
      await loadAccounts();
      notify("Konto entfernt", a.email, "success");
    });

  // Keyboard shortcuts (Outlook-compatible where possible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Delete" && selected) del(selected);
      else if (ctrl && e.key.toLowerCase() === "n") (e.preventDefault(), startCompose("new"));
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === "r" && detail) (e.preventDefault(), startCompose("replyAll"));
      else if (ctrl && e.key.toLowerCase() === "r" && detail) (e.preventDefault(), startCompose("reply"));
      else if (ctrl && e.key.toLowerCase() === "f" && detail) (e.preventDefault(), startCompose("forward"));
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && messages.length) {
        e.preventDefault();
        const idx = messages.findIndex((m) => m.id === selectedId);
        const next = messages[Math.min(messages.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next && next.id !== selectedId) select(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------- render

  const me = accounts?.[0];
  const listTitle = query.trim() ? `Suchergebnisse für „${query.trim()}“` : currentFolder?.name ?? "";
  const mailApp = suiteApp("mail")!;

  const right = compose ? (
    <Compose key={`${compose.mode}-${compose.original?.summary.id ?? "new"}`} state={compose} accounts={accounts ?? []} onSend={send} onDiscard={() => setCompose(null)} />
  ) : (
    <ReadingPane detail={detail} loading={detailLoading} onReply={startCompose} onDelete={() => selected && del(selected)} onNotify={notify} />
  );

  return (
    <div className={s.root}>
      <SuiteHeader appName="Mail" searchPlaceholder="Suchen" onSearch={setQuery} userName={me?.displayName} />
      <div className={s.body}>
        <AppRail current="mail" />
        <div className={s.main}>
          {accounts && accounts.length === 0 ? (
            <div className={s.welcome}>
              <AppTile app={mailApp} size={72} />
              <Text size={600} weight="semibold">Willkommen bei Mirra Mail</Text>
              <Text>Fügen Sie ein Konto hinzu – Microsoft 365, Exchange oder IMAP.</Text>
              <Button appearance="primary" size="large" icon={<PersonAdd24Regular />} onClick={() => setAccountDialog(true)}>
                Konto hinzufügen
              </Button>
            </div>
          ) : (
            <>
              <Ribbon
                selected={selected}
                folders={allFolders}
                syncing={syncing.size > 0}
                onToggleFolders={() => setShowFolders((v) => !v)}
                onNew={() => startCompose("new")}
                onReply={startCompose}
                onDelete={() => selected && del(selected)}
                onArchive={() => selected && archive(selected)}
                onMove={(target) => selected && move(selected, target)}
                onToggleRead={() => selected && toggleRead(selected)}
                onToggleFlag={() => selected && toggleFlag(selected)}
                onSync={syncAll}
                onAddAccount={() => setAccountDialog(true)}
                readingPane={readingPane}
                onReadingPane={(p) => {
                  setReadingPane(p);
                  try {
                    localStorage.setItem(PANE_KEY, p);
                  } catch {
                    /* ignore */
                  }
                }}
              />
              <div className={s.panes}>
                {showFolders && (
                  <FolderPane
                    accounts={accounts ?? []}
                    folders={folders}
                    selectedFolderId={query.trim() ? null : folderId}
                    syncing={syncing}
                    onSelect={(f) => {
                      setQuery("");
                      setCompose(null);
                      setFolderId(f.id);
                    }}
                    onAddAccount={() => setAccountDialog(true)}
                    onRemoveAccount={removeAccount}
                    onSyncAccount={syncAccount}
                  />
                )}
                <div className={s.content} style={{ flexDirection: readingPane === "bottom" ? "column" : "row" }}>
                  <div style={readingPane === "bottom" ? { height: "40%", display: "flex" } : { width: 380, flexShrink: 0, display: "flex" }}>
                    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
                      <MessageList
                        title={listTitle}
                        messages={messages}
                        loading={listLoading}
                        selectedId={selectedId}
                        onSelect={select}
                        onDelete={del}
                        onToggleRead={toggleRead}
                        onToggleFlag={toggleFlag}
                        showFrom={currentFolder?.role === "sent" || currentFolder?.role === "drafts" ? "to" : "from"}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0 }}>
                    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>{right}</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <AccountDialog
        open={accountDialog}
        onClose={() => setAccountDialog(false)}
        onAdded={async (a) => {
          notify("Konto hinzugefügt", `${a.email} wird synchronisiert…`, "success");
          await loadAccounts();
          syncAccount(a);
        }}
      />
    </div>
  );
}
