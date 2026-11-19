import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, Text, makeStyles, tokens } from "@fluentui/react-components";
import { PersonAdd24Regular } from "@fluentui/react-icons";
import type { Account, AccountStatus, AppSettings, Folder, MessageDetail, MessageSummary, OutgoingMessage } from "../../lib/types";
import { api, errorMessage, isTauri } from "../../lib/api";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { onComposeRequest, onOpenMessage } from "../../lib/bus";
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
import { AutoReplyDialog } from "./AutoReplyDialog";
import { SharedMailboxDialog } from "./SharedMailboxDialog";
import { tl, LOCALE } from "../../lib/i18n";
import { folderLabel } from "../../lib/format";
import { openContextMenu, type MenuEntry } from "../../shell/contextMenu";
import { QuickStepsDialog, SnoozeDialog, SweepDialog, actionLabel, loadQuickSteps, printMessage, snoozeMenu, taskFromMessage, type QuickStep } from "./MailExtras";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  panes: { flex: 1, display: "flex", minHeight: 0, padding: "8px", gap: "8px" },
  content: { flex: 1, display: "flex", gap: "8px", minWidth: 0, minHeight: 0 },
  autoReplyBar: { margin: "8px 8px 0 8px" },
  welcome: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", textAlign: "center" },
});

const PANE_KEY = "ondura-mail.readingPane";
const FOCUS_KEY = "ondura-mail.focusedInbox";
/** Virtual folder with the snoozed messages of all accounts. */
const SNOOZED = "__snoozed__";
const CONV_KEY = "ondura-mail.conversations";

function loadConversations(): boolean {
  try {
    return localStorage.getItem(CONV_KEY) !== "off";
  } catch {
    return true;
  }
}
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
  const [conversations, setConversations] = useState(loadConversations);
  const [thread, setThread] = useState<MessageSummary[]>([]);
  const [threadCounts, setThreadCounts] = useState<Record<string, number>>({});
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [serverSearch, setServerSearch] = useState<"idle" | "loading" | "done">("idle");
  const [autoReplyFor, setAutoReplyFor] = useState<{ accountId: string | null } | null>(null);
  const [sharedOpen, setSharedOpen] = useState(false);
  /** Accounts whose automatic replies are on (checked once per load). */
  const [autoReplyOn, setAutoReplyOn] = useState<Record<string, boolean>>({});
  const [settingsTab, setSettingsTab] = useState<"general" | "accounts" | "rules" | undefined>(undefined);
  const [focusedInbox, setFocusedInbox] = useState(() => {
    try {
      return localStorage.getItem(FOCUS_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const [focusTab, setFocusTab] = useState<"focused" | "other">("focused");
  const [focusUnread, setFocusUnread] = useState<[number, number]>([0, 0]);
  const [snoozedCount, setSnoozedCount] = useState(0);
  const [snoozeFor, setSnoozeFor] = useState<MessageSummary | null>(null);
  const [sweepFor, setSweepFor] = useState<MessageSummary | null>(null);
  const [quickSteps, setQuickSteps] = useState<QuickStep[]>(loadQuickSteps);
  const [quickStepsOpen, setQuickStepsOpen] = useState(false);

  const allFolders = useMemo(() => Object.values(folders).flat(), [folders]);
  const currentFolder = allFolders.find((f) => f.id === folderId) ?? null;
  const focusActive = focusedInbox && currentFolder?.role === "inbox";
  const focusRef = useRef<boolean | null>(null);
  focusRef.current = focusActive ? focusTab === "focused" : null;
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
    api.snoozed().then((l) => setSnoozedCount(l.length), () => {});
    if (!fid) return setMessages([]);
    setListLoading(true);
    try {
      if (fid === SNOOZED) {
        setMessages(await api.snoozed());
        return;
      }
      const focused = focusRef.current;
      const list = await api.listMessages(fid, 0, limitRef.current, focused);
      if (focused !== null) api.focusUnread(fid).then(setFocusUnread, () => {});
      if (fid === folderRef.current && focused === focusRef.current) setMessages(list);
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
    // Remind of switched-on automatic replies (accounts without support are skipped).
    for (const a of list) {
      api.getAutoReply(a.id).then(
        (r) => setAutoReplyOn((m) => ({ ...m, [a.id]: r.enabled })),
        () => {},
      );
    }
    return list;
  }, [loadFolders, loadStatuses]);

  const turnOffAutoReply = async (accountId: string) => {
    try {
      const r = await api.getAutoReply(accountId);
      await api.setAutoReply(accountId, { ...r, enabled: false });
      setAutoReplyOn((m) => ({ ...m, [accountId]: false }));
      notify(tl("Automatische Antworten deaktiviert"), undefined, "success");
    } catch (e) {
      notify(tl("Automatische Antworten"), errorMessage(e), "error");
    }
  };

  useEffect(() => {
    loadAccounts().catch((e) => {
      splashDone();
      notify(tl("Konten konnten nicht geladen werden"), errorMessage(e), "error");
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

  useEffect(() => setServerSearch("idle"), [query]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    loadMessages();
  }, [focusTab, focusedInbox, loadMessages]);

  useEffect(() => {
    api.categories().then(setKnownCategories, () => {});
  }, []);

  // "E-Mail senden" from contacts and other modules.
  useEffect(
    () =>
      onComposeRequest((req) => {
        void api.listAccounts().then((list) => {
          if (!list.length) return setAccountDialog(true);
          setCompose({ mode: "edit", accountId: list[0].id, preset: { to: req.to, cc: [], bcc: [], subject: req.subject ?? "", bodyHtml: "" } });
        });
      }),
    [],
  );

  // "Gekennzeichnete E-Mails" in tasks: show the message in its folder.
  const selectRef = useRef<(m: MessageSummary) => void>(() => {});
  useEffect(
    () =>
      onOpenMessage((id) => {
        void api.getMessage(id).then(
          (d) => {
            setQuery("");
            setCompose(null);
            setFolderId(d.summary.folderId);
            setTimeout(() => selectRef.current(d.summary), 400);
          },
          (e) => notify(tl("Nachricht konnte nicht geladen werden"), errorMessage(e), "error"),
        );
      }),
    [notify],
  );

  // Conversation sizes for the badges in the list (per account of the folder).
  useEffect(() => {
    if (!conversations) return;
    const byAccount = new Map<string, Set<string>>();
    for (const m of messages) if (m.threadKey) (byAccount.get(m.accountId) ?? byAccount.set(m.accountId, new Set()).get(m.accountId)!).add(m.threadKey);
    let cancelled = false;
    Promise.all([...byAccount].map(([acc, keys]) => api.threadCounts(acc, [...keys]).catch(() => ({}) as Record<string, number>))).then((parts) => {
      if (!cancelled) setThreadCounts(Object.assign({}, ...parts));
    });
    return () => {
      cancelled = true;
    };
  }, [messages, conversations]);

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
          if (!/network|netzwerk|timed out|verbindung/i.test(e.message)) notify(tl("Fehler bei ") + accountName(e.accountId), e.message, "error");
          scheduleRefresh(e.accountId);
          break;
        case "messageSent":
          notify(tl("Nachricht gesendet"), e.subject || undefined, "success");
          scheduleRefresh(e.accountId);
          break;
        case "sendFailed":
          notify(tl("Senden fehlgeschlagen"), `${e.subject}: ${e.message}. Die Nachricht liegt im Postausgang.`, "error");
          break;
        case "foldersChanged":
        case "folderUpdated":
        case "newMail":
          scheduleRefresh(e.accountId);
          break;
      }
    });
    // Changes made in a message window (read, deleted, archived …).
    const unlistenLocal = api.onMailChange((accountId) => scheduleRefresh(accountId));
    return () => {
      clearTimeout(refresh);
      unlisten.then((u) => u());
      unlistenLocal.then((u) => u());
    };
  }, [loadFolders, loadMessages, notify]);

  // ------------------------------------------------------------- actions

  const refreshCounts = (accountId: string) => loadFolders(accountId).catch(() => {});

  const patchMessage = (id: string, patch: Partial<MessageSummary>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const setSelectedIdGuard = (id: string, apply: () => void) => {
    if (selectedRef.current === id) apply();
  };

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
      setThread([]);
      if (conversations) api.conversation(m.id).then((t) => setSelectedIdGuard(m.id, () => setThread(t)), () => {});
      if (!m.isRead) {
        patchMessage(m.id, { isRead: true });
        await api.setRead(m.id, true);
        refreshCounts(m.accountId);
      }
      // The body download may have filled in the preview.
      patchMessage(m.id, { preview: d.summary.preview, hasAttachments: d.summary.hasAttachments });
    } catch (e) {
      notify(tl("Nachricht konnte nicht geladen werden"), errorMessage(e), "error");
    } finally {
      setDetailLoading(false);
    }
  };

  selectRef.current = select;

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
    run(tl("Status konnte nicht geändert werden"), async () => {
      patchMessage(m.id, { isRead: !m.isRead });
      await api.setRead(m.id, !m.isRead);
      refreshCounts(m.accountId);
    });

  const toggleFlag = (m: MessageSummary) =>
    run(tl("Kennzeichnung fehlgeschlagen"), async () => {
      patchMessage(m.id, { isFlagged: !m.isFlagged });
      if (detail?.summary.id === m.id) setDetail({ ...detail, summary: { ...detail.summary, isFlagged: !m.isFlagged } });
      await api.setFlagged(m.id, !m.isFlagged);
    });

  const del = (m: MessageSummary) =>
    run(tl("Löschen fehlgeschlagen"), async () => {
      removeFromList(m);
      await api.deleteMessage(m.id);
      refreshCounts(m.accountId);
    });

  const archive = (m: MessageSummary) =>
    run(tl("Archivieren fehlgeschlagen"), async () => {
      await api.archiveMessage(m.id);
      removeFromList(m);
      refreshCounts(m.accountId);
    });

  const move = (m: MessageSummary, target: string) =>
    run(tl("Verschieben fehlgeschlagen"), async () => {
      removeFromList(m);
      await api.moveMessage(m.id, target);
      refreshCounts(m.accountId);
    });

  const categorize = (m: MessageSummary, categories: string[]) =>
    run(tl("Kategorie konnte nicht gesetzt werden"), async () => {
      patchMessage(m.id, { categories });
      if (detail?.summary.id === m.id) setDetail({ ...detail, summary: { ...detail.summary, categories } });
      await api.setCategories(m.id, categories);
      setKnownCategories((k) => [...new Set([...k, ...categories])].sort());
    });

  const togglePin = (m: MessageSummary) =>
    run(tl("Anheften fehlgeschlagen"), async () => {
      patchMessage(m.id, { pinned: !m.pinned });
      await api.setPinned(m.id, !m.pinned);
      loadMessages();
    });

  const snooze = (m: MessageSummary, at: Date | null) =>
    run(tl("Zurückstellen fehlgeschlagen"), async () => {
      if (at) removeFromList(m);
      await api.snooze(m.id, at ? at.toISOString() : null);
      if (at) notify(tl("Zurückgestellt bis {0}", at.toLocaleString(LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })), m.subject || undefined, "success");
      loadMessages();
      refreshCounts(m.accountId);
    });

  const moveFocus = (m: MessageSummary, focused: boolean, always: boolean) =>
    run(tl("Verschieben fehlgeschlagen"), async () => {
      removeFromList(m);
      await api.setFocused(m.id, focused, always);
      if (folderId) api.focusUnread(folderId).then(setFocusUnread, () => {});
    });

  const ignoreConversation = (m: MessageSummary) =>
    run(tl("Unterhaltung konnte nicht ignoriert werden"), async () => {
      if (!(await api.confirm(tl("Alle Nachrichten dieser Unterhaltung und künftige Antworten werden in „Gelöschte Elemente“ verschoben.")))) return;
      await api.ignoreConversation(m.id);
      setMessages((list) => list.filter((x) => (x.threadKey || x.id) !== (m.threadKey || m.id) || x.accountId !== m.accountId));
      setSelectedId(null);
      setDetail(null);
      refreshCounts(m.accountId);
    });

  const blockSender = (m: MessageSummary) =>
    run(tl("Absender konnte nicht blockiert werden"), async () => {
      const who = m.from?.email;
      if (!who || !(await api.confirm(tl("Nachrichten von {0} künftig direkt in „Junk-E-Mail“ verschieben?", who)))) return;
      await api.blockSender(m.id);
      setMessages((list) => list.filter((x) => x.from?.email.toLowerCase() !== who.toLowerCase()));
      notify(tl("Absender blockiert"), who, "success");
      refreshCounts(m.accountId);
    });

  const print = async (m: MessageSummary) => {
    const d = detail?.summary.id === m.id ? detail : await api.getMessage(m.id).catch(() => null);
    if (d) printMessage(d);
  };

  /** Run a quick step on a message, action by action. */
  const runQuickStep = (step: QuickStep, m: MessageSummary) =>
    run(tl("QuickStep „{0}“ fehlgeschlagen", step.name), async () => {
      let removed = false;
      for (const a of step.actions) {
        if (removed) break;
        switch (a.type) {
          case "markRead":
          case "markUnread":
            await api.setRead(m.id, a.type === "markRead");
            patchMessage(m.id, { isRead: a.type === "markRead" });
            break;
          case "flag":
          case "unflag":
            await api.setFlagged(m.id, a.type === "flag");
            patchMessage(m.id, { isFlagged: a.type === "flag" });
            break;
          case "category":
            if (a.name.trim()) await api.setCategories(m.id, [...new Set([...(m.categories ?? []), a.name.trim()])]);
            break;
          case "reply":
          case "replyAll":
            await composeFor(m, a.type);
            break;
          case "forward": {
            const original = await api.getMessage(m.id);
            setCompose({ mode: "forward", accountId: m.accountId, original, forwardTo: a.to.trim() || undefined });
            break;
          }
          case "move":
            await api.moveMessage(m.id, a.folderId);
            removed = true;
            break;
          case "archive":
            await api.archiveMessage(m.id);
            removed = true;
            break;
          case "delete":
            await api.deleteMessage(m.id);
            removed = true;
            break;
        }
      }
      if (removed) removeFromList(m);
      refreshCounts(m.accountId);
    });

  const quickStepMenu = (m: MessageSummary): MenuEntry[] => [
    ...quickSteps.map((q): MenuEntry => ({ label: q.name, onClick: () => runQuickStep(q, m) })),
    "divider",
    { label: tl("QuickSteps verwalten…"), onClick: () => setQuickStepsOpen(true) },
  ];

  const searchServer = async () => {
    const q = query.trim();
    if (!q) return;
    setServerSearch("loading");
    try {
      const hits = await api.searchServer(q);
      if (queryRef.current.trim() !== q) return;
      setMessages((list) => {
        const ids = new Set(list.map((m) => m.id));
        return [...list, ...hits.filter((h) => !ids.has(h.id))].sort((a, b) => b.date.localeCompare(a.date));
      });
      setServerSearch("done");
    } catch (e) {
      setServerSearch("idle");
      notify(tl("Suche auf dem Server fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  /** Reply/forward to a message that is not necessarily open. */
  const composeFor = async (m: MessageSummary, mode: ComposeMode) => {
    const original = detail?.summary.id === m.id ? detail : await api.getMessage(m.id).catch(() => null);
    if (original) setCompose({ mode, accountId: m.accountId, original });
  };

  /** A message in its own window; drafts open for editing as before. */
  const openWindow = (m: MessageSummary) => {
    if (currentFolder?.role === "drafts") return void select(m);
    void api.openMessageWindow(m.id, m.subject || tl("(Kein Betreff)")).catch((e) => notify(tl("Fenster konnte nicht geöffnet werden"), errorMessage(e), "error"));
  };

  const messageMenu = (m: MessageSummary, e: React.MouseEvent) => {
    if (m.id !== selectedId) void select(m);
    const targets = allFolders.filter((f) => f.accountId === m.accountId && f.id !== m.folderId);
    const mine = m.categories ?? [];
    const cats = [...new Set([...knownCategories, ...mine])];
    openContextMenu(e, [
      { label: tl("In neuem Fenster öffnen"), onClick: () => openWindow(m) },
      "divider",
      { label: tl("Antworten"), onClick: () => void composeFor(m, "reply") },
      { label: tl("Allen antworten"), onClick: () => void composeFor(m, "replyAll") },
      { label: tl("Weiterleiten"), onClick: () => void composeFor(m, "forward") },
      "divider",
      { label: m.isRead ? tl("Als ungelesen markieren") : tl("Als gelesen markieren"), onClick: () => toggleRead(m) },
      { label: m.isFlagged ? tl("Kennzeichnung entfernen") : tl("Kennzeichnen"), onClick: () => toggleFlag(m) },
      cats.length > 0 && {
        label: tl("Kategorisieren"),
        items: [
          ...cats.map((c): MenuEntry => ({
            label: `${mine.includes(c) ? "✓ " : ""}${c}`,
            onClick: () => categorize(m, mine.includes(c) ? mine.filter((x) => x !== c) : [...mine, c]),
          })),
          "divider",
          { label: tl("Alle Kategorien entfernen"), disabled: !mine.length, onClick: () => categorize(m, []) },
        ],
      },
      "divider",
      { label: m.pinned ? tl("Lösen") : tl("Anheften"), onClick: () => togglePin(m) },
      {
        label: tl("Als Aufgabe hinzufügen"),
        onClick: () =>
          void taskFromMessage(m).then(
            (list) => notify(tl("Aufgabe angelegt"), tl("In „{0}“", list), "success"),
            (e) => notify(tl("Aufgabe konnte nicht angelegt werden"), errorMessage(e), "error"),
          ),
      },
      { label: tl("Zurückstellen"), items: snoozeMenu((at) => snooze(m, at), () => setSnoozeFor(m), !!m.snoozedUntil) },
      { label: tl("QuickSteps"), items: quickStepMenu(m) },
      "divider",
      { label: tl("Verschieben"), disabled: !targets.length, items: targets.map((f) => ({ label: folderLabel(f), onClick: () => move(m, f.id) })) },
      focusActive && {
        label: focusTab === "focused" ? tl("Nach „Sonstige“ verschieben") : tl("Nach „Relevant“ verschieben"),
        items: [
          { label: tl("Nur diese Nachricht"), onClick: () => moveFocus(m, focusTab !== "focused", false) },
          { label: tl("Immer verschieben"), onClick: () => moveFocus(m, focusTab !== "focused", true) },
        ],
      },
      { label: tl("Archivieren"), onClick: () => archive(m) },
      { label: tl("Aufräumen…"), disabled: !m.from, onClick: () => setSweepFor(m) },
      { label: tl("Unterhaltung ignorieren"), onClick: () => ignoreConversation(m) },
      { label: tl("Absender blockieren"), disabled: !m.from, onClick: () => blockSender(m) },
      { label: tl("Löschen"), shortcut: tl("Entf"), onClick: () => del(m) },
      "divider",
      { label: tl("Drucken"), shortcut: tl("Strg+P"), onClick: () => void print(m) },
    ]);
  };

  const startCompose = (mode: ComposeMode) => {
    if (!accounts?.length) return setAccountDialog(true);
    const accountId = (mode === "new" ? currentFolder?.accountId : detail?.summary.accountId) ?? accounts[0].id;
    setCompose({ mode, accountId, original: mode === "new" ? undefined : detail ?? undefined });
  };

  const send = async (accountId: string, message: OutgoingMessage) => {
    try {
      await api.send(accountId, message);
      if (message.sendAt)
        notify(
          tl("Geplant für {0}", new Date(message.sendAt).toLocaleString(LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })),
          tl("{0} wartet im Postausgang.", message.subject || tl("(Kein Betreff)")),
          "success",
        );
      else notify(tl("Wird gesendet…"), message.subject || undefined, "info");
      setCompose(null);
      if (currentFolder?.role === "drafts") loadMessages();
    } catch (e) {
      notify(tl("Senden fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const saveDraft = async (accountId: string, message: OutgoingMessage) => {
    try {
      await api.saveDraft(accountId, message);
      notify(tl("Entwurf gespeichert"), message.subject || undefined, "success");
      setCompose(null);
      if (currentFolder?.role === "drafts") loadMessages();
    } catch (e) {
      notify(tl("Entwurf konnte nicht gespeichert werden"), errorMessage(e), "error");
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
      notify(tl("Ältere Nachrichten konnten nicht geladen werden"), errorMessage(e), "error");
    }
  };

  const syncAll = () => accounts?.forEach((a) => syncAccount(a));

  const syncAccount = (a: Account) => {
    if (!isTauri) {
      setSyncing((s) => new Set(s).add(a.id));
      setTimeout(() => setSyncing(new Set()), 800);
    }
    api.syncAccount(a.id).catch((e) => notify(tl("Synchronisierung fehlgeschlagen"), errorMessage(e), "error"));
  };

  const removeAccount = (a: Account) =>
    run(tl("Konto konnte nicht entfernt werden"), async () => {
      if (!(await api.confirm(tl("Konto {0} wirklich entfernen? Lokale Daten werden gelöscht, auf dem Server bleibt alles erhalten.", a.email)))) return;
      await api.removeAccount(a.id);
      setFolders(({ [a.id]: _, ...rest }) => rest);
      if (currentFolder?.accountId === a.id) setFolderId(null);
      setSettingsFor(null);
      await loadAccounts();
      notify(tl("Konto entfernt"), a.email, "success");
    });

  // Keyboard shortcuts (Outlook-compatible where possible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName) || document.querySelector("[role=dialog]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Delete" && selected) del(selected);
      else if (e.key === "Enter" && selected && target.closest("[role=listbox], [role=option]")) openWindow(selected);
      else if (ctrl && e.key.toLowerCase() === "n") (e.preventDefault(), startCompose("new"));
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === "r" && detail) (e.preventDefault(), startCompose("replyAll"));
      else if (ctrl && e.key.toLowerCase() === "r" && detail) (e.preventDefault(), startCompose("reply"));
      else if (ctrl && e.key.toLowerCase() === "f" && detail) (e.preventDefault(), startCompose("forward"));
      else if (ctrl && e.key.toLowerCase() === "q" && selected) (e.preventDefault(), toggleRead(selected));
      else if (ctrl && e.key.toLowerCase() === "p" && detail) (e.preventDefault(), printMessage(detail));
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
  const listTitle = query.trim()
    ? tl("Suchergebnisse für „{0}“", query.trim())
    : folderId === SNOOZED
      ? tl("Zurückgestellt")
      : currentFolder
        ? folderLabel(currentFolder)
        : "";
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
      thread={conversations ? thread : undefined}
      accounts={accounts ?? []}
      onReplyTo={(d, mode) => setCompose({ mode, accountId: d.summary.accountId, original: d })}
      onPrint={() => detail && printMessage(detail)}
    />
  );

  return (
    <div className={s.root}>
      <SuiteHeader
        appName={tl("Ondura Mail")}
        searchPlaceholder={tl("In allen Konten suchen")}
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
              <Text size={600} weight="semibold">{tl("Willkommen bei Ondura Mail")}</Text>
              <Text>{tl("Fügen Sie ein Konto hinzu – Microsoft 365, Exchange oder IMAP.")}</Text>
              <Button appearance="primary" size="large" icon={<PersonAdd24Regular />} onClick={() => setAccountDialog(true)}>
                {tl("Konto hinzufügen")}
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
                conversations={conversations}
                onToggleConversations={() =>
                  setConversations((v) => {
                    try {
                      localStorage.setItem(CONV_KEY, v ? "off" : "on");
                    } catch {
                      /* ignore */
                    }
                    if (v) setThread([]);
                    return !v;
                  })
                }
                knownCategories={knownCategories}
                onCategorize={(c) => selected && categorize(selected, c)}
                onRules={() => (setSettingsTab("rules"), setSettingsFor({ accountId: null }))}
                onAutoReplies={() => setAutoReplyFor({ accountId: currentFolder?.accountId ?? null })}
                onSharedMailbox={() => setSharedOpen(true)}
                onPin={() => selected && togglePin(selected)}
                onSnoozeMenu={(e) => selected && openContextMenu(e, snoozeMenu((at) => snooze(selected, at), () => setSnoozeFor(selected), !!selected.snoozedUntil))}
                onSweep={() => selected && setSweepFor(selected)}
                onBlock={() => selected && blockSender(selected)}
                onPrint={() => detail && printMessage(detail)}
                quickSteps={quickSteps.map((q) => ({ id: q.id, name: q.name, title: q.actions.map((a) => actionLabel(a, allFolders)).join(" › ") }))}
                onQuickStep={(id) => {
                  const q = quickSteps.find((x) => x.id === id);
                  if (q && selected) runQuickStep(q, selected);
                }}
                onManageQuickSteps={() => setQuickStepsOpen(true)}
                focusedInbox={focusedInbox}
                onToggleFocusedInbox={() =>
                  setFocusedInbox((v) => {
                    try {
                      localStorage.setItem(FOCUS_KEY, v ? "off" : "on");
                    } catch {
                      /* ignore */
                    }
                    return !v;
                  })
                }
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
              {currentFolder && autoReplyOn[currentFolder.accountId] && (
                <MessageBar intent="warning" className={s.autoReplyBar}>
                  <MessageBarBody>
                    <MessageBarTitle>{tl("Automatische Antworten")}</MessageBarTitle>
                    {tl("Für")} {accounts?.find((a) => a.id === currentFolder.accountId)?.email} {tl("werden automatische Antworten gesendet.")}
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button size="small" onClick={() => setAutoReplyFor({ accountId: currentFolder.accountId })}>{tl("Bearbeiten")}</Button>
                    <Button size="small" onClick={() => turnOffAutoReply(currentFolder.accountId)}>{tl("Deaktivieren")}</Button>
                  </MessageBarActions>
                </MessageBar>
              )}
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
                      setFocusTab("focused");
                      setFolderId(f.id);
                    }}
                    snoozedCount={snoozedCount}
                    snoozedSelected={!searching && folderId === SNOOZED}
                    onOpenSnoozed={() => (setQuery(""), setCompose(null), setFolderId(SNOOZED))}
                    onAddAccount={() => setAccountDialog(true)}
                    onRemoveAccount={removeAccount}
                    onSyncAccount={syncAccount}
                    onFixAccount={setReauth}
                    onOpenOutbox={setOutboxFor}
                    onAccountSettings={(a) => setSettingsFor({ accountId: a.id })}
                    onFolderMenu={(f, a, e) =>
                      openContextMenu(e, [
                        { label: tl("Öffnen"), onClick: () => (setQuery(""), setCompose(null), setFolderId(f.id)) },
                        { label: tl("Jetzt synchronisieren"), onClick: () => syncAccount(a) },
                        "divider",
                        { label: tl("Kontoeinstellungen…"), onClick: () => setSettingsFor({ accountId: a.id }) },
                      ])
                    }
                    onAccountMenu={(a, e) =>
                      openContextMenu(e, [
                        { label: tl("Jetzt synchronisieren"), onClick: () => syncAccount(a) },
                        { label: tl("Postausgang"), onClick: () => setOutboxFor(a) },
                        { label: tl("Automatische Antworten"), onClick: () => setAutoReplyFor({ accountId: a.id }) },
                        "divider",
                        { label: tl("Kontoeinstellungen…"), onClick: () => setSettingsFor({ accountId: a.id }) },
                        { label: tl("Konto entfernen"), onClick: () => removeAccount(a) },
                      ])
                    }
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
                      onOpen={openWindow}
                      onDelete={del}
                      onToggleRead={toggleRead}
                      onToggleFlag={toggleFlag}
                      onContextMenu={messageMenu}
                      onTogglePin={togglePin}
                      focusTab={focusActive && !searching ? focusTab : undefined}
                      focusUnread={focusUnread}
                      onFocusTab={setFocusTab}
                      showFrom={currentFolder?.role === "sent" || currentFolder?.role === "drafts" ? "to" : "from"}
                      onEndReached={() => {
                        if (!searching && messages.length >= limit) setLimit((l) => l + PAGE);
                      }}
                      onLoadOlder={!searching && folderId && folderId !== SNOOZED && !focusActive && messages.length < limit ? loadOlder : undefined}
                      olderState={olderState}
                      conversations={conversations && !searching}
                      threadCounts={threadCounts}
                      onSearchServer={searching ? searchServer : undefined}
                      serverSearchState={serverSearch}
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
          notify(tl("Konto hinzugefügt"), tl("{0} wird synchronisiert…", a.email), "success");
          await loadAccounts();
          syncAccount(a);
        }}
      />
      <SettingsDialog
        open={!!settingsFor}
        accounts={accounts ?? []}
        initialAccountId={settingsFor?.accountId}
        initialTab={settingsTab}
        folders={allFolders}
        onClose={() => (setSettingsFor(null), setSettingsTab(undefined))}
        onAccountsChanged={() => loadAccounts()}
        onRemoveAccount={removeAccount}
        onReauth={(a) => (setSettingsFor(null), setReauth(a))}
        onSettingsChanged={setSettings}
      />
      <AutoReplyDialog
        open={!!autoReplyFor}
        accounts={accounts ?? []}
        initialAccountId={autoReplyFor?.accountId}
        onClose={() => setAutoReplyFor(null)}
        onSaved={(id, r) => {
          setAutoReplyOn((m) => ({ ...m, [id]: r.enabled }));
          notify(r.enabled ? tl("Automatische Antworten aktiviert") : tl("Automatische Antworten deaktiviert"), undefined, "success");
        }}
      />
      <SharedMailboxDialog
        open={sharedOpen}
        accounts={accounts ?? []}
        onClose={() => setSharedOpen(false)}
        onAdded={async (a) => {
          notify(tl("Freigegebenes Postfach hinzugefügt"), tl("{0} wird synchronisiert…", a.email), "success");
          await loadAccounts();
          syncAccount(a);
        }}
      />
      <SnoozeDialog open={!!snoozeFor} onClose={() => setSnoozeFor(null)} onSnooze={(at) => snoozeFor && snooze(snoozeFor, at)} />
      <SweepDialog
        message={sweepFor}
        folders={allFolders}
        onClose={() => setSweepFor(null)}
        onDone={(n) => {
          notify(tl("Aufgeräumt"), tl("{0} Nachricht(en)", n), "success");
          loadMessages();
          if (sweepFor) refreshCounts(sweepFor.accountId);
        }}
      />
      <QuickStepsDialog open={quickStepsOpen} folders={allFolders} onClose={(list) => (setQuickSteps(list), setQuickStepsOpen(false))} />
      <ReauthDialog account={reauth} onClose={() => setReauth(null)} onDone={() => (notify(tl("Konto verbunden"), reauth?.email, "success"), loadStatuses())} />
      <OutboxDialog
        account={outboxFor}
        onClose={() => (setOutboxFor(null), loadStatuses())}
        onEdit={(accountId, message) => setCompose({ mode: "edit", accountId, preset: message })}
      />
    </div>
  );
}
