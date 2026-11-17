import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { PersonAdd24Regular } from "@fluentui/react-icons";
import type { Account, AccountStatus, AppSettings, Folder, MessageDetail, MessageSummary, OutgoingMessage } from "../../lib/types";
import { api, errorMessage, isTauri } from "../../lib/api";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { AppTile, suiteApp, useModuleActive } from "../../suite";
import { FolderPane } from "./FolderPane";
import { MessageList } from "./MessageList";
import { ReadingPane } from "./ReadingPane";
import { Ribbon, type ReadingPanePosition } from "./Ribbon";
import { Compose, type ComposeMode, type ComposeState } from "./Compose";
import { AccountDialog } from "./AccountDialog";
import { SettingsDialog } from "./SettingsDialog";
import { OutboxDialog, ReauthDialog } from "./AccountDialogs";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  panes: { flex: 1, display: "flex", minHeight: 0, padding: "8px", gap: "8px" },
  content: { flex: 1, display: "flex", gap: "8px", minWidth: 0, minHeight: 0 },
  welcome: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", textAlign: "center" },
});

const PANE_KEY = "nexora-orbit.readingPane";
const PAGE = 100;

function loadPanePosition(): ReadingPanePosition {
  try {
    return (localStorage.getItem(PANE_KEY) as ReadingPanePosition) || "right";
  } catch {
    return "right";
  }
}

export function MailApp() {
  const s = useStyles();
  const notify = useNotify();
  const active = useModuleActive("mail");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [folders, setFolders] = useState<Record<string, Folder[]>>({});
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [olderState, setOlderState] = useState<"idle" | "loading" | "done">("idle");
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showFolders, setShowFolders] = useState(true);
  const [accountDialog, setAccountDialog] = useState(false);
  const [settingsFor, setSettingsFor] = useState<{ accountId: string | null } | null>(null);
  const [reauth, setReauth] = useState<Account | null>(null);
  const [outboxFor, setOutboxFor] = useState<Account | null>(null);
  const [readingPane, setReadingPane] = useState<ReadingPanePosition>(loadPanePosition);

  const allFolders = useMemo(() => Object.values(folders).flat(), [folders]);
  const currentFolder = allFolders.find((f) => f.id === folderId) ?? null;
  const selected = messages.find((m) => m.id === selectedId) ?? null;
  const folderRef = useRef(folderId);
  folderRef.current = folderId;
  const queryRef = useRef(query);
  queryRef.current = query;
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

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
      const list = await api.listMessages(fid, 0, limitRef.current);
      if (fid === folderRef.current) setMessages(list);
    } finally {
      setListLoading(false);
      splashDone();
    }
  }, []);

  const loadStatuses = useCallback(async () => {
    const list = await api.accountStatuses();
    setStatuses(Object.fromEntries(list.map((st) => [st.accountId, st])));
  }, []);

  const loadAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
    const all = await Promise.all(list.map((a) => loadFolders(a.id)));
    if (!folderRef.current || !all.flat().some((f) => f.id === folderRef.current)) {
      const inbox = all.flat().find((f) => f.role === "inbox") ?? all.flat()[0];
      setFolderId(inbox?.id ?? null);
      // Without any folder there is no message list to wait for.
      if (!inbox) splashDone();
    }
    loadStatuses().catch(() => {});
    return list;
  }, [loadFolders, loadStatuses]);

  useEffect(() => {
    loadAccounts().catch((e) => {
      splashDone();
      notify("Konten konnten nicht geladen werden", errorMessage(e), "error");
    });
    api.getSettings().then(setSettings).catch(() => {});
  }, [loadAccounts, notify]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setLimit(PAGE);
    limitRef.current = PAGE;
    setOlderState("idle");
    loadMessages(folderId);
    if (folderId) api.syncFolder(folderId).catch(() => {});
  }, [folderId, loadMessages]);

  useEffect(() => {
    const t = setTimeout(() => loadMessages(), 200);
    return () => clearTimeout(t);
  }, [query, limit, loadMessages]);

  // Live updates from the sync engine.
  useEffect(() => {
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const scheduleRefresh = (accountId: string) => {
      pending.add(accountId);
      clearTimeout(refresh);
      refresh = setTimeout(() => {
        pending.forEach((id) => loadFolders(id).catch(() => {}));
        pending.clear();
        loadMessages();
      }, 250);
    };
    const accountName = (id: string) => accountsRef.current?.find((a) => a.id === id)?.email ?? "";
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
        case "status":
          setStatuses((m) => ({ ...m, [e.status.accountId]: e.status }));
          break;
        case "error":
          // Connection problems are shown at the account; only report others.
          if (!/network|netzwerk|timed out|verbindung/i.test(e.message)) notify("Fehler bei " + accountName(e.accountId), e.message, "error");
          scheduleRefresh(e.accountId);
          break;
        case "messageSent":
          notify("Nachricht gesendet", e.subject || undefined, "success");
          scheduleRefresh(e.accountId);
          break;
        case "sendFailed":
          notify("Senden fehlgeschlagen", `${e.subject}: ${e.message}. Die Nachricht liegt im Postausgang.`, "error");
          break;
        case "foldersChanged":
        case "folderUpdated":
        case "newMail":
          scheduleRefresh(e.accountId);
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
    setSelectedId(m.id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await api.getMessage(m.id);
      const folder = allFolders.find((f) => f.id === m.folderId);
      if (folder?.role === "drafts") {
        // Drafts open in the editor, like in Outlook.
        setCompose({ mode: "draft", accountId: m.accountId, original: d });
        return;
      }
      setCompose(null);
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
      notify("Wird gesendet…", message.subject || undefined, "info");
      setCompose(null);
      if (currentFolder?.role === "drafts") loadMessages();
    } catch (e) {
      notify("Senden fehlgeschlagen", errorMessage(e), "error");
    }
  };

  const saveDraft = async (accountId: string, message: OutgoingMessage) => {
    try {
      await api.saveDraft(accountId, message);
      notify("Entwurf gespeichert", message.subject || undefined, "success");
      setCompose(null);
      if (currentFolder?.role === "drafts") loadMessages();
    } catch (e) {
      notify("Entwurf konnte nicht gespeichert werden", errorMessage(e), "error");
    }
  };

  const loadOlder = async () => {
    if (!folderId) return;
    setOlderState("loading");
    try {
      const added = await api.loadOlder(folderId, PAGE);
      if (added === 0) setOlderState("done");
      else {
        setOlderState("idle");
        setLimit((l) => l + added);
      }
    } catch (e) {
      setOlderState("idle");
      notify("Ältere Nachrichten konnten nicht geladen werden", errorMessage(e), "error");
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
      if (!(await api.confirm(`Konto ${a.email} wirklich entfernen? Lokale Daten werden gelöscht, auf dem Server bleibt alles erhalten.`))) return;
      await api.removeAccount(a.id);
      setFolders(({ [a.id]: _, ...rest }) => rest);
      if (currentFolder?.accountId === a.id) setFolderId(null);
      setSettingsFor(null);
      await loadAccounts();
      notify("Konto entfernt", a.email, "success");
    });

  // Keyboard shortcuts (Outlook-compatible where possible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName) || document.querySelector("[role=dialog]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Delete" && selected) del(selected);
      else if (ctrl && e.key.toLowerCase() === "n") (e.preventDefault(), startCompose("new"));
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === "r" && detail) (e.preventDefault(), startCompose("replyAll"));
      else if (ctrl && e.key.toLowerCase() === "r" && detail) (e.preventDefault(), startCompose("reply"));
      else if (ctrl && e.key.toLowerCase() === "f" && detail) (e.preventDefault(), startCompose("forward"));
      else if (ctrl && e.key.toLowerCase() === "q" && selected) (e.preventDefault(), toggleRead(selected));
      else if (e.key === "F5" || (ctrl && e.key.toLowerCase() === "m")) (e.preventDefault(), syncAll());
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && messages.length && !compose) {
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
  const searching = !!query.trim();

  const right = compose ? (
    <Compose
      key={`${compose.mode}-${compose.original?.summary.id ?? compose.preset?.subject ?? "new"}`}
      state={compose}
      accounts={accounts ?? []}
      onSend={send}
      onSaveDraft={saveDraft}
      onClose={() => setCompose(null)}
    />
  ) : (
    <ReadingPane
      detail={detail}
      alwaysLoadRemote={settings?.loadRemoteImages}
      loading={detailLoading}
      onReply={startCompose}
      onDelete={() => selected && del(selected)}
      onNotify={notify}
    />
  );

  return (
    <div className={s.root}>
      <SuiteHeader
        appName="Orbit"
        searchPlaceholder="In allen Konten suchen"
        onSearch={setQuery}
        userName={me?.displayName}
        onSettings={() => setSettingsFor({ accountId: null })}
      />
      <div className={s.body}>
        <AppRail current="mail" />
        <div className={s.main}>
          {accounts && accounts.length === 0 ? (
            <div className={s.welcome}>
              <AppTile app={mailApp} size={72} />
              <Text size={600} weight="semibold">Willkommen bei Orbit</Text>
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
                    statuses={statuses}
                    selectedFolderId={searching ? null : folderId}
                    syncing={syncing}
                    onSelect={(f) => {
                      setQuery("");
                      setCompose(null);
                      setFolderId(f.id);
                    }}
                    onAddAccount={() => setAccountDialog(true)}
                    onRemoveAccount={removeAccount}
                    onSyncAccount={syncAccount}
                    onFixAccount={setReauth}
                    onOpenOutbox={setOutboxFor}
                    onAccountSettings={(a) => setSettingsFor({ accountId: a.id })}
                  />
                )}
                <div className={s.content} style={{ flexDirection: readingPane === "bottom" ? "column" : "row" }}>
                  <div style={readingPane === "bottom" ? { height: "40%", display: "flex" } : { width: 380, flexShrink: 0, display: "flex" }}>
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
                      onEndReached={() => {
                        if (!searching && messages.length >= limit) setLimit((l) => l + PAGE);
                      }}
                      onLoadOlder={!searching && folderId && messages.length < limit ? loadOlder : undefined}
                      olderState={olderState}
                    />
                  </div>
                  <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0 }}>{right}</div>
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
      <SettingsDialog
        open={!!settingsFor}
        accounts={accounts ?? []}
        initialAccountId={settingsFor?.accountId}
        onClose={() => setSettingsFor(null)}
        onAccountsChanged={() => loadAccounts()}
        onRemoveAccount={removeAccount}
        onReauth={(a) => (setSettingsFor(null), setReauth(a))}
        onSettingsChanged={setSettings}
      />
      <ReauthDialog account={reauth} onClose={() => setReauth(null)} onDone={() => (notify("Konto verbunden", reauth?.email, "success"), loadStatuses())} />
      <OutboxDialog
        account={outboxFor}
        onClose={() => (setOutboxFor(null), loadStatuses())}
        onEdit={(accountId, message) => setCompose({ mode: "edit", accountId, preset: message })}
      />
    </div>
  );
}
