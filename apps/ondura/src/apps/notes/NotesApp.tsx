// Ondura Notizen: notebooks with sections and pages, like OneNote.
// Notebooks live on this computer (JSON in the data directory) or in
// OneNote (Microsoft account, through Graph); both are edited the same way.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  SearchBox,
  Spinner,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowRedo24Regular,
  ArrowUndo24Regular,
  CalendarLtr24Regular,
  CheckboxChecked24Regular,
  ChevronDown20Regular,
  Clock24Regular,
  CloudArrowUp20Regular,
  Delete20Regular,
  Desktop20Regular,
  DocumentAdd24Regular,
  Image24Regular,
  Link24Regular,
  Notebook20Regular,
  PanelLeft24Regular,
  QuestionCircle24Regular,
  Star24Regular,
  Table24Regular,
  TagDismiss24Regular,
  TextBold24Regular,
  TextBulletListLtr24Regular,
  TextHeader124Regular,
  TextHeader224Regular,
  TextHeader324Regular,
  TextItalic24Regular,
  TextNumberListLtr24Regular,
  TextStrikethrough24Regular,
  TextUnderline24Regular,
  Highlight24Regular,
  TextIndentIncreaseLtr24Regular,
  TextIndentDecreaseLtr24Regular,
  TextT24Regular,
} from "@fluentui/react-icons";
import { errorMessage, isTauri } from "../../lib/api";
import { LOCALE, tl, tlc } from "../../lib/i18n";
import { ConsentRequired, grantAccess, microsoftAccounts, newId, storeDelete, storeList, storeRead, storeWrite, type CloudAccountInfo, type StoredDoc } from "../../lib/graphApps";
import { myers } from "../pdf/diff";
import { BigButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton, StatusBar, type RibbonTab } from "../../shell/office";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { useNotify } from "../../shell/notify";
import { setWindowTitle } from "../../lib/office";
import { splashDone } from "../../shell/splash";
import { openContextMenu } from "../../shell/contextMenu";
import { TAGS, editorBlocks, htmlText, noteExtensions, setTag, toggleDone } from "./editor";
import * as one from "./onenote";
import "./notes.css";

const COLOR = "#7719aa";
const SECTION_COLORS = ["#7719aa", "#2b5bd7", "#107c41", "#c43e1c", "#c27c0e", "#0b7a75", "#b4009e", "#4f52b2"];
const LAST = "ondura.notes.last";

// ---------------------------------------------------------------- model --

interface LocalPage {
  id: string;
  title: string;
  created: number;
  modified: number;
  /** 0 = page, 1 = subpage. */
  level: number;
  html: string;
}
interface LocalSection {
  id: string;
  name: string;
  color: string;
  pages: LocalPage[];
}
interface LocalNotebook {
  name: string;
  color: string;
  created: number;
  sections: LocalSection[];
}

/** A notebook: on this computer ("local") or in an account's OneNote. */
interface NbRef {
  source: string;
  id: string;
  name: string;
}
interface SectionInfo {
  id: string;
  name: string;
  color: string;
  group?: string;
}
interface PageInfo {
  id: string;
  title: string;
  created: string;
  modified: string;
  level: number;
  /** Text preview (local pages). */
  preview?: string;
}

const isLocal = (nb: NbRef | null) => nb?.source === "local";

function welcomeNotebook(): LocalNotebook {
  const now = Date.now();
  return {
    name: tl("Mein Notizbuch"),
    color: COLOR,
    created: now,
    sections: [
      {
        id: newId("s"),
        name: tl("Schnelle Notizen"),
        color: SECTION_COLORS[0],
        pages: [
          {
            id: newId("p"),
            title: tl("Willkommen bei Ondura Notizen"),
            created: now,
            modified: now,
            level: 0,
            html: `<p>${tl("Hier sammeln Sie Notizen in Notizbüchern, Abschnitten und Seiten – wie in OneNote.")}</p><p data-tag="to-do">${tl("Eine neue Seite anlegen")}</p><p data-tag="to-do">${tl("Eine Aufgabe abhaken (Klick auf das Kästchen)")}</p><p data-tag="important">${tl("Mit „Kategorien“ markieren Sie Wichtiges, Fragen und Ideen.")}</p><p>${tl("Über das Notizbuch-Menü oben links öffnen Sie auch Ihre OneNote-Notizbücher aus dem Microsoft-Konto.")}</p>`,
          },
        ],
      },
    ],
  };
}

const fmtDate = (iso: string | number) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
};
const fmtLong = (iso: string | number) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}  ${d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`;
};

// --------------------------------------------------------------- styles --

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  main: { flex: 1, minHeight: 0, display: "flex", gap: "8px", margin: "0 8px" },
  nav: { width: "236px", flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden" },
  pagesPane: { width: "250px", flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden" },
  nbButton: { justifyContent: "flex-start", margin: "8px", minHeight: "40px", fontWeight: tokens.fontWeightSemibold },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 4px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold },
  list: { flex: 1, overflowY: "auto", padding: "2px 6px 8px" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    border: "none",
    background: "none",
    textAlign: "left",
    padding: "7px 10px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  itemOn: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  swatch: { width: "4px", alignSelf: "stretch", borderRadius: "2px", flexShrink: 0 },
  group: { padding: "8px 10px 2px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100, textTransform: "uppercase", letterSpacing: "0.04em" },
  pageItem: { flexDirection: "column", alignItems: "stretch", gap: "1px" },
  pageTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pageMeta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  addRow: { display: "flex", gap: "4px", padding: "6px 8px", borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  canvas: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden", position: "relative" },
  paper: { flex: 1, overflowY: "auto", padding: "28px 48px 80px" },
  title: {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: "28px",
    fontWeight: tokens.fontWeightSemibold,
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    padding: "0 0 4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  date: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, margin: "6px 0 18px", display: "block" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", color: tokens.colorNeutralForeground3, padding: "24px", textAlign: "center" },
  bar: { margin: "8px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// ------------------------------------------------------------------ app --

export function NotesApp() {
  const s = useStyles();
  const notify = useNotify();
  const [tab, setTab] = useState("start");
  const [navOpen, setNavOpen] = useState(true);
  const [localList, setLocalList] = useState<StoredDoc[]>([]);
  const [accounts, setAccounts] = useState<CloudAccountInfo[]>([]);
  const [oneBooks, setOneBooks] = useState<Record<string, one.OneNotebook[] | "loading" | "consent" | { error: string }>>({});
  const [nb, setNb] = useState<NbRef | null>(null);
  const [localNb, setLocalNbState] = useState<LocalNotebook | null>(null);
  /** The local notebook as last written (state updates are asynchronous). */
  const localRef = useRef<LocalNotebook | null>(null);
  const setLocalNb = useCallback((doc: LocalNotebook | null) => {
    localRef.current = doc;
    setLocalNbState(doc);
  }, []);
  const [oneNb, setOneNb] = useState<one.OneNotebook | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [created, setCreated] = useState<string>("");
  const [pageLoading, setPageLoading] = useState(false);
  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "error">("idle");
  const [consent, setConsent] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ask, setAsk] = useState<null | { label: string; value: string; onOk: (v: string) => void }>(null);

  // OneNote state of the open page: what is on the server.
  const baseline = useRef<{ blocks: one.Block[]; title: string } | null>(null);
  const silent = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const savePending = useRef<(() => Promise<void>) | null>(null);
  const current = useRef({ nb, sectionId, pageId, title });
  current.current = { nb, sectionId, pageId, title };

  const editor = useEditor({
    extensions: noteExtensions(),
    content: "",
    editorProps: {
      attributes: { class: "nx-note", spellcheck: "true" },
      handleClickOn: (view, _pos, node, nodePos, event) => {
        // A click on a to-do box (left of the text) ticks it off.
        const tag = node.attrs?.tag as string | undefined;
        if (!tag?.startsWith("to-do")) return false;
        const dom = view.nodeDOM(nodePos) as HTMLElement | null;
        if (!dom || event.clientX - dom.getBoundingClientRect().left > 24) return false;
        if (editorRef.current) toggleDone(editorRef.current, nodePos);
        return true;
      },
    },
    onUpdate: () => {
      if (silent.current) return;
      scheduleSave();
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // ------------------------------------------------------ notebooks --

  const refreshLocal = useCallback(async () => {
    let list = await storeList("notes");
    if (!list.length) {
      const id = newId("nb");
      await storeWrite("notes", id, welcomeNotebook());
      list = await storeList("notes");
    }
    setLocalList(list);
    return list;
  }, []);

  const loadOneBooks = useCallback(async (account: string) => {
    setOneBooks((m) => ({ ...m, [account]: "loading" }));
    try {
      const list = await one.notebooks(account);
      setOneBooks((m) => ({ ...m, [account]: list }));
      return list;
    } catch (e) {
      setOneBooks((m) => ({ ...m, [account]: e instanceof ConsentRequired ? "consent" : { error: errorMessage(e) } }));
      return null;
    }
  }, []);

  const openNotebook = useCallback(
    async (ref: NbRef, wanted?: { section?: string; page?: string }) => {
      await flushSave();
      setNb(ref);
      setPageId(null);
      setPages([]);
      setSectionId(null);
      setConsent(null);
      setSearch("");
      try {
        localStorage.setItem(LAST, JSON.stringify({ ...ref, section: wanted?.section, page: wanted?.page }));
      } catch {
        /* ignore */
      }
      if (isLocal(ref)) {
        const doc = await storeRead<LocalNotebook>("notes", ref.id);
        setLocalNb(doc);
        setOneNb(null);
        const sec = doc.sections.find((x) => x.id === wanted?.section) ?? doc.sections[0];
        if (sec) {
          setSectionId(sec.id);
          const p = sec.pages.find((x) => x.id === wanted?.page) ?? sec.pages[0];
          if (p) setPageId(p.id);
        }
      } else {
        setLocalNb(null);
        let books = oneBooks[ref.source];
        if (!Array.isArray(books)) books = (await loadOneBooks(ref.source)) ?? [];
        const book = (books as one.OneNotebook[]).find((b) => b.id === ref.id) ?? null;
        setOneNb(book);
        if (!book) {
          setConsent(oneBooks[ref.source] === "consent" ? ref.source : null);
          return;
        }
        const sec = book.sections.find((x) => x.id === wanted?.section) ?? book.sections[0];
        if (sec) setSectionId(sec.id);
        if (wanted?.page) setPageId(wanted.page);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oneBooks, loadOneBooks],
  );

  // Start: last notebook, or the first local one.
  useEffect(() => {
    void (async () => {
      setTimeout(splashDone, 50);
      const list = await refreshLocal();
      const accs = await microsoftAccounts();
      setAccounts(accs);
      let last: (NbRef & { section?: string; page?: string }) | null = null;
      try {
        last = JSON.parse(localStorage.getItem(LAST) ?? "null");
      } catch {
        last = null;
      }
      const validLast = last && ((last.source === "local" && list.some((d) => d.id === last!.id)) || accs.some((a) => a.key === last!.source));
      if (last && validLast) await openNotebook(last, { section: last.section, page: last.page }).catch(() => openNotebook({ source: "local", id: list[0].id, name: list[0].name }));
      else await openNotebook({ source: "local", id: list[0].id, name: list[0].name });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------- sections --

  const sections: SectionInfo[] = useMemo(() => {
    if (localNb) return localNb.sections.map((x) => ({ id: x.id, name: x.name, color: x.color }));
    if (oneNb) return oneNb.sections.map((x, i) => ({ id: x.id, name: x.name, group: x.group, color: SECTION_COLORS[i % SECTION_COLORS.length] }));
    return [];
  }, [localNb, oneNb]);

  // Pages of the section.
  useEffect(() => {
    if (!nb || !sectionId) return;
    if (localNb) {
      const sec = localNb.sections.find((x) => x.id === sectionId);
      setPages(
        (sec?.pages ?? []).map((p) => ({ id: p.id, title: p.title, created: new Date(p.created).toISOString(), modified: new Date(p.modified).toISOString(), level: p.level, preview: htmlText(p.html).slice(0, 80) })),
      );
      return;
    }
    let cancelled = false;
    setPagesLoading(true);
    one
      .pages(nb.source, sectionId)
      .then((list) => {
        if (cancelled) return;
        setPages(list);
        setPageId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null)));
      })
      .catch((e) => !cancelled && (e instanceof ConsentRequired ? setConsent(nb.source) : notify(tl("Seiten konnten nicht geladen werden"), errorMessage(e), "error")))
      .finally(() => !cancelled && setPagesLoading(false));
    return () => {
      cancelled = true;
    };
    // Local pages are recomputed whenever the notebook changes.
  }, [nb, sectionId, localNb, notify]);

  // ------------------------------------------------------------- page --

  const setEditorContent = useCallback((html: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    silent.current = true;
    ed.commands.setContent(html || "<p></p>", { emitUpdate: false });
    silent.current = false;
  }, []);

  // Load the page into the editor.
  useEffect(() => {
    if (!editor || !nb || !sectionId) return;
    baseline.current = null;
    if (!pageId) {
      setEditorContent("");
      setTitle("");
      return;
    }
    if (localNb) {
      const p = localNb.sections.find((x) => x.id === sectionId)?.pages.find((x) => x.id === pageId);
      if (!p) return;
      setTitle(p.title);
      setCreated(new Date(p.created).toISOString());
      setEditorContent(p.html);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    void (async () => {
      try {
        const c = await one.pageContent(nb.source, pageId);
        const html = await one.inlineImages(nb.source, c.blocks.map((b) => b.html).join(""));
        if (cancelled) return;
        setTitle(c.title);
        setCreated(c.created || pages.find((p) => p.id === pageId)?.created || "");
        setEditorContent(html);
        baseline.current = { blocks: editorBlocks(editor).map((b) => ({ id: b.id ?? "", html: b.html })).filter((b) => b.id), title: c.title };
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ConsentRequired) setConsent(nb.source);
          else notify(tl("Seite konnte nicht geladen werden"), errorMessage(e), "error");
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The local notebook object changes on every keystroke; only the ids matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, nb, sectionId, pageId]);

  // ------------------------------------------------------------- save --

  const persistLocal = useCallback(async (ref: NbRef, doc: LocalNotebook) => {
    await storeWrite("notes", ref.id, doc);
  }, []);

  /** Writes the open page (local: into the notebook; OneNote: PATCH). */
  const saveNow = useCallback(async () => {
    const ed = editorRef.current;
    const { nb: ref, sectionId: sec, pageId: pid, title: t } = current.current;
    if (!ed || !ref || !sec || !pid) return;
    if (isLocal(ref)) {
      const doc = localRef.current;
      if (!doc) return;
      const next: LocalNotebook = {
        ...doc,
        sections: doc.sections.map((x) => (x.id !== sec ? x : { ...x, pages: x.pages.map((p) => (p.id !== pid ? p : { ...p, title: t, html: ed.getHTML(), modified: Date.now() })) })),
      };
      setLocalNb(next);
      await persistLocal(ref, next);
      return;
    }
    const base = baseline.current;
    if (!base) return;
    const after = editorBlocks(ed);
    const cmds = one.diffBlocks(base.blocks, after, base.title, t);
    if (!cmds.length) return;
    await one.patchPage(ref.source, pid, cmds);
    // New ids of inserted and replaced blocks: align the fresh page with the editor.
    const fresh = await one.pageContent(ref.source, pid);
    if (current.current.pageId !== pid) return;
    const key = (html: string) => `${/^<(\w+)/.exec(html)?.[1] ?? ""}|${htmlText(html)}`;
    const now = editorBlocks(ed);
    const serverBlocks = fresh.blocks.filter((b) => htmlText(b.html) || /<(img|table|object)/i.test(b.html));
    const ops = myers(now.map((b) => key(b.html)), serverBlocks.map((b) => key(b.html)), undefined, 2000);
    const ids = new Map<number, string>();
    for (const op of ops ?? []) if (op.kind === "equal") ids.set(op.a, serverBlocks[op.b].id);
    const missing = now.some((b, i) => !ids.has(i) && (htmlText(b.html) || /<(img|table)/i.test(b.html)));
    if (missing) {
      // Could not match every block: reload the page to stay in sync.
      const html = await one.inlineImages(ref.source, fresh.blocks.map((b) => b.html).join(""));
      setEditorContent(html);
    } else {
      silent.current = true;
      const tr = ed.state.tr;
      let i = 0;
      ed.state.doc.forEach((node, offset) => {
        const id = ids.get(i++);
        if (id && node.attrs.oneId !== id) tr.setNodeAttribute(offset, "oneId", id);
      });
      tr.setMeta("addToHistory", false);
      ed.view.dispatch(tr);
      silent.current = false;
    }
    baseline.current = { blocks: editorBlocks(ed).filter((b) => b.id).map((b) => ({ id: b.id!, html: b.html })), title: t };
    setPages((ps) => ps.map((p) => (p.id === pid ? { ...p, title: t, modified: new Date().toISOString() } : p)));
  }, [persistLocal, setEditorContent, setLocalNb]);

  const runSave = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    savePending.current = null;
    setSaving("saving");
    try {
      await saveNow();
      setSaving("idle");
    } catch (e) {
      setSaving("error");
      if (e instanceof ConsentRequired) setConsent(current.current.nb?.source ?? null);
      else notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
    }
  }, [saveNow, notify]);

  function scheduleSave() {
    setSaving("pending");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    savePending.current = runSave;
    saveTimer.current = window.setTimeout(() => void runSave(), isLocal(current.current.nb) ? 700 : 2500);
  }

  async function flushSave() {
    if (savePending.current) await savePending.current();
  }

  // Save before the window closes.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (savePending.current) {
        void savePending.current();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void runSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void addPage();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Remember where the user was.
  useEffect(() => {
    if (!nb) return;
    try {
      localStorage.setItem(LAST, JSON.stringify({ ...nb, section: sectionId, page: pageId }));
    } catch {
      /* ignore */
    }
  }, [nb, sectionId, pageId]);

  useEffect(() => {
    void setWindowTitle(nb ? `${nb.name} – ${tl("Ondura Notizen")}` : tl("Ondura Notizen"));
  }, [nb]);

  // ---------------------------------------------------------- actions --

  const selectPage = async (id: string) => {
    if (id === pageId) return;
    await flushSave();
    setPageId(id);
    try {
      const last = JSON.parse(localStorage.getItem(LAST) ?? "{}");
      localStorage.setItem(LAST, JSON.stringify({ ...last, section: sectionId, page: id }));
    } catch {
      /* ignore */
    }
  };

  const selectSection = async (id: string) => {
    if (id === sectionId) return;
    await flushSave();
    setPageId(null);
    setSectionId(id);
    if (localNb) setPageId(localNb.sections.find((x) => x.id === id)?.pages[0]?.id ?? null);
  };

  const updateLocal = async (fn: (doc: LocalNotebook) => LocalNotebook) => {
    if (!nb || !localRef.current) return;
    const next = fn(localRef.current);
    setLocalNb(next);
    await persistLocal(nb, next);
  };

  async function addPage(level = 0) {
    if (!nb || !sectionId) return;
    await flushSave();
    const t = "";
    if (localNb) {
      const now = Date.now();
      const p: LocalPage = { id: newId("p"), title: t, created: now, modified: now, level, html: "<p></p>" };
      await updateLocal((doc) => ({
        ...doc,
        sections: doc.sections.map((x) => {
          if (x.id !== sectionId) return x;
          // Subpages go right after the current page.
          const i = level && pageId ? x.pages.findIndex((q) => q.id === pageId) + 1 : x.pages.length;
          return { ...x, pages: [...x.pages.slice(0, i), p, ...x.pages.slice(i)] };
        }),
      }));
      setPageId(p.id);
    } else {
      try {
        const p = await one.createPage(nb.source, sectionId, tl("Unbenannte Seite"));
        setPages((ps) => [...ps, p]);
        setPageId(p.id);
      } catch (e) {
        notify(tl("Seite konnte nicht erstellt werden"), errorMessage(e), "error");
      }
    }
    setTimeout(() => document.getElementById("nx-note-title")?.focus(), 150);
  }

  const deletePage = async (id: string) => {
    if (!nb || !sectionId) return;
    const pg = pages.find((p) => p.id === id);
    if (!confirm(tl("Seite „{0}“ löschen?", pg?.title || tl("Unbenannte Seite")))) return;
    if (id === pageId) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      savePending.current = null;
    }
    if (localNb) {
      await updateLocal((doc) => ({ ...doc, sections: doc.sections.map((x) => (x.id !== sectionId ? x : { ...x, pages: x.pages.filter((p) => p.id !== id) })) }));
    } else {
      try {
        await one.deletePage(nb.source, id);
        setPages((ps) => ps.filter((p) => p.id !== id));
      } catch (e) {
        return notify(tl("Löschen fehlgeschlagen"), errorMessage(e), "error");
      }
    }
    if (id === pageId) setPageId(pages.find((p) => p.id !== id)?.id ?? null);
  };

  const movePage = async (id: string, delta: number) => {
    await updateLocal((doc) => ({
      ...doc,
      sections: doc.sections.map((x) => {
        if (x.id !== sectionId) return x;
        const i = x.pages.findIndex((p) => p.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= x.pages.length) return x;
        const list = [...x.pages];
        [list[i], list[j]] = [list[j], list[i]];
        return { ...x, pages: list };
      }),
    }));
  };

  const setLevel = async (id: string, level: number) => {
    await updateLocal((doc) => ({ ...doc, sections: doc.sections.map((x) => (x.id !== sectionId ? x : { ...x, pages: x.pages.map((p) => (p.id === id ? { ...p, level } : p)) })) }));
  };

  const addSection = () =>
    setAsk({
      label: tl("Name des Abschnitts"),
      value: tl("Neuer Abschnitt"),
      onOk: async (name) => {
        if (!nb) return;
        if (localNb) {
          const sec: LocalSection = { id: newId("s"), name, color: SECTION_COLORS[localNb.sections.length % SECTION_COLORS.length], pages: [] };
          await updateLocal((doc) => ({ ...doc, sections: [...doc.sections, sec] }));
          await flushSave();
          setSectionId(sec.id);
          setPageId(null);
        } else if (oneNb) {
          try {
            const sec = await one.createSection(nb.source, oneNb.id, name);
            setOneNb({ ...oneNb, sections: [...oneNb.sections, sec] });
            setOneBooks((m) => ({ ...m, [nb.source]: Array.isArray(m[nb.source]) ? (m[nb.source] as one.OneNotebook[]).map((b) => (b.id === oneNb.id ? { ...b, sections: [...b.sections, sec] } : b)) : m[nb.source] }));
            setSectionId(sec.id);
          } catch (e) {
            notify(tl("Abschnitt konnte nicht erstellt werden"), errorMessage(e), "error");
          }
        }
      },
    });

  const renameSection = (id: string) => {
    const sec = localNb?.sections.find((x) => x.id === id);
    if (!sec) return;
    setAsk({ label: tl("Abschnitt umbenennen"), value: sec.name, onOk: (name) => void updateLocal((doc) => ({ ...doc, sections: doc.sections.map((x) => (x.id === id ? { ...x, name } : x)) })) });
  };

  const deleteSection = async (id: string) => {
    const sec = localNb?.sections.find((x) => x.id === id);
    if (!sec || !confirm(tl("Abschnitt „{0}“ mit {1} Seiten löschen?", sec.name, sec.pages.length))) return;
    await updateLocal((doc) => ({ ...doc, sections: doc.sections.filter((x) => x.id !== id) }));
    if (sectionId === id) {
      const rest = localNb!.sections.filter((x) => x.id !== id);
      setSectionId(rest[0]?.id ?? null);
      setPageId(rest[0]?.pages[0]?.id ?? null);
    }
  };

  const newNotebook = (source: string) =>
    setAsk({
      label: tl("Name des Notizbuchs"),
      value: tl("Neues Notizbuch"),
      onOk: async (name) => {
        try {
          if (source === "local") {
            const id = newId("nb");
            const doc: LocalNotebook = { name, color: COLOR, created: Date.now(), sections: [{ id: newId("s"), name: tl("Neuer Abschnitt"), color: SECTION_COLORS[0], pages: [] }] };
            await storeWrite("notes", id, doc);
            await refreshLocal();
            await openNotebook({ source: "local", id, name });
          } else {
            const book = await one.createNotebook(source, name);
            const sec = await one.createSection(source, book.id, tl("Neuer Abschnitt"));
            book.sections.push(sec);
            setOneBooks((m) => ({ ...m, [source]: [...(Array.isArray(m[source]) ? (m[source] as one.OneNotebook[]) : []), book] }));
            setOneNb(book);
            setNb({ source, id: book.id, name });
            setSectionId(sec.id);
          }
        } catch (e) {
          notify(tl("Notizbuch konnte nicht erstellt werden"), errorMessage(e), "error");
        }
      },
    });

  const deleteNotebook = async () => {
    if (!nb || !isLocal(nb)) return;
    if (!confirm(tl("Notizbuch „{0}“ von diesem Computer löschen? Das kann nicht rückgängig gemacht werden.", nb.name))) return;
    await storeDelete("notes", nb.id);
    const list = await refreshLocal();
    await openNotebook({ source: "local", id: list[0].id, name: list[0].name });
  };

  const grant = async (account: string) => {
    try {
      await grantAccess(account, "notes");
      setConsent(null);
      const books = await loadOneBooks(account);
      if (nb && nb.source === account && books) await openNotebook(nb);
    } catch (e) {
      notify(tl("Zugriff nicht erteilt"), errorMessage(e), "error");
    }
  };

  // ----------------------------------------------------------- search --

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    if (localNb)
      return localNb.sections.flatMap((sec) =>
        sec.pages
          .filter((p) => p.title.toLowerCase().includes(q) || htmlText(p.html).toLowerCase().includes(q))
          .map((p) => {
            const text = htmlText(p.html);
            const i = text.toLowerCase().indexOf(q);
            return { section: sec.id, sectionName: sec.name, id: p.id, title: p.title, snippet: i >= 0 ? text.slice(Math.max(0, i - 30), i + 60) : "" };
          }),
      );
    return pages.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({ section: sectionId!, sectionName: "", id: p.id, title: p.title, snippet: "" }));
  }, [search, localNb, pages, sectionId]);

  // ------------------------------------------------------------ ribbon --

  const ed = editor;
  const noPage = !ed || !pageId;
  const cmd = (fn: (c: ReturnType<NonNullable<typeof ed>["chain"]>) => ReturnType<NonNullable<typeof ed>["chain"]>) => ed && fn(ed.chain().focus()).run();
  const insertImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f || !ed) return;
      const r = new FileReader();
      r.onload = () => ed.chain().focus().setImage({ src: String(r.result), alt: f.name }).run();
      r.readAsDataURL(f);
    };
    input.click();
  };
  const tabs: RibbonTab[] = [
    {
      id: "start",
      label: tl("Start"),
      content: (
        <>
          <RibbonGroup label={tl("Rückgängig")}>
            <Rows>
              <Row>
                <SmallButton icon={<ArrowUndo24Regular />} label={tl("Rückgängig")} onClick={() => cmd((c) => c.undo())} disabled={noPage} shortcut="Strg+Z" />
              </Row>
              <Row>
                <SmallButton icon={<ArrowRedo24Regular />} label={tl("Wiederholen")} onClick={() => cmd((c) => c.redo())} disabled={noPage} shortcut="Strg+Y" />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Text")}>
            <Rows>
              <Row>
                <SmallButton icon={<TextBold24Regular />} label={tl("Fett")} pressed={ed?.isActive("bold")} onClick={() => cmd((c) => c.toggleBold())} disabled={noPage} shortcut="Strg+B" />
                <SmallButton icon={<TextItalic24Regular />} label={tl("Kursiv")} pressed={ed?.isActive("italic")} onClick={() => cmd((c) => c.toggleItalic())} disabled={noPage} shortcut="Strg+I" />
                <SmallButton icon={<TextUnderline24Regular />} label={tl("Unterstrichen")} pressed={ed?.isActive("underline")} onClick={() => cmd((c) => c.toggleUnderline())} disabled={noPage} shortcut="Strg+U" />
                <SmallButton icon={<TextStrikethrough24Regular />} label={tl("Durchgestrichen")} pressed={ed?.isActive("strike")} onClick={() => cmd((c) => c.toggleStrike())} disabled={noPage} />
                <SmallButton icon={<Highlight24Regular />} label={tl("Hervorheben")} pressed={ed?.isActive("highlight")} onClick={() => cmd((c) => c.toggleHighlight({ color: "#fff176" }))} disabled={noPage} />
              </Row>
              <Row>
                <SmallButton icon={<TextBulletListLtr24Regular />} label={tl("Aufzählung")} pressed={ed?.isActive("bulletList")} onClick={() => cmd((c) => c.toggleBulletList())} disabled={noPage} />
                <SmallButton icon={<TextNumberListLtr24Regular />} label={tl("Nummerierung")} pressed={ed?.isActive("orderedList")} onClick={() => cmd((c) => c.toggleOrderedList())} disabled={noPage} />
                <SmallButton icon={<TextIndentDecreaseLtr24Regular />} label={tl("Einzug verkleinern")} onClick={() => cmd((c) => c.liftListItem("listItem"))} disabled={noPage} />
                <SmallButton icon={<TextIndentIncreaseLtr24Regular />} label={tl("Einzug vergrößern")} onClick={() => cmd((c) => c.sinkListItem("listItem"))} disabled={noPage} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Formatvorlagen")}>
            <BigButton icon={<TextT24Regular />} label={tl("Standard")} pressed={ed?.isActive("paragraph")} onClick={() => cmd((c) => c.setParagraph())} disabled={noPage} />
            <BigButton icon={<TextHeader124Regular />} label={tl("Überschrift 1")} pressed={ed?.isActive("heading", { level: 1 })} onClick={() => cmd((c) => c.toggleHeading({ level: 1 }))} disabled={noPage} />
            <BigButton icon={<TextHeader224Regular />} label={tl("Überschrift 2")} pressed={ed?.isActive("heading", { level: 2 })} onClick={() => cmd((c) => c.toggleHeading({ level: 2 }))} disabled={noPage} />
            <BigButton icon={<TextHeader324Regular />} label={tl("Überschrift 3")} pressed={ed?.isActive("heading", { level: 3 })} onClick={() => cmd((c) => c.toggleHeading({ level: 3 }))} disabled={noPage} />
          </RibbonGroup>
          <RibbonGroup label={tl("Kategorien")}>
            <BigButton icon={<CheckboxChecked24Regular />} label={tl("Aufgabe")} onClick={() => ed && setTag(ed, "to-do")} disabled={noPage} />
            <BigButton icon={<Star24Regular />} label={tl("Wichtig")} onClick={() => ed && setTag(ed, "important")} disabled={noPage} />
            <BigButton icon={<QuestionCircle24Regular />} label={tl("Frage")} onClick={() => ed && setTag(ed, "question")} disabled={noPage} />
            <Rows>
              {TAGS.slice(3).map((t) => (
                <Row key={t.id}>
                  <SmallButton icon={<span style={{ width: 20, textAlign: "center" }}>{t.icon}</span>} label={t.label()} text={t.label()} onClick={() => ed && setTag(ed, t.id)} disabled={noPage} />
                </Row>
              ))}
            </Rows>
            <BigButton icon={<TagDismiss24Regular />} label={tl("Kategorie entfernen")} onClick={() => ed && setTag(ed, null)} disabled={noPage} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "insert",
      label: tl("Einfügen"),
      content: (
        <>
          <RibbonGroup label={tl("Seiten")}>
            <BigButton icon={<DocumentAdd24Regular />} label={tl("Neue Seite")} onClick={() => void addPage()} disabled={!sectionId} />
          </RibbonGroup>
          <RibbonGroup label={tl("Tabellen")}>
            <BigButton icon={<Table24Regular />} label={tl("Tabelle")} onClick={() => cmd((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: false }))} disabled={noPage} />
          </RibbonGroup>
          <RibbonGroup label={tl("Bilder")}>
            <BigButton icon={<Image24Regular />} label={tl("Bild")} onClick={insertImage} disabled={noPage} />
          </RibbonGroup>
          <RibbonGroup label={tl("Links")}>
            <BigButton
              icon={<Link24Regular />}
              label={tl("Link")}
              onClick={() => {
                const url = prompt(tl("Adresse des Links"), "https://");
                if (url) cmd((c) => c.extendMarkRange("link").setLink({ href: url }));
              }}
              disabled={noPage}
            />
          </RibbonGroup>
          <RibbonGroup label={tl("Zeitstempel")}>
            <BigButton icon={<CalendarLtr24Regular />} label={tl("Datum")} onClick={() => cmd((c) => c.insertContent(new Date().toLocaleDateString(LOCALE)))} disabled={noPage} />
            <BigButton icon={<Clock24Regular />} label={tl("Uhrzeit")} onClick={() => cmd((c) => c.insertContent(new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })))} disabled={noPage} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "view",
      label: tl("Ansicht"),
      content: (
        <RibbonGroup label={tl("Bereiche")}>
          <BigButton icon={<PanelLeft24Regular />} label={tl("Navigation")} pressed={navOpen} onClick={() => setNavOpen((v) => !v)} />
        </RibbonGroup>
      ),
    },
  ];

  // -------------------------------------------------------------- view --

  const nbLabel = (ref: NbRef | null) => ref?.name ?? tl("Notizbuch");
  const sourceLabel = (src: string) => (src === "local" ? tl("Auf diesem Computer") : (accounts.find((a) => a.key === src)?.email ?? ""));

  const notebookMenu = (
    <Menu onOpenChange={(_, d) => d.open && accounts.forEach((a) => oneBooks[a.key] === undefined && void loadOneBooks(a.key))}>
      <MenuTrigger disableButtonEnhancement>
        <Button className={s.nbButton} appearance="subtle" icon={<Notebook20Regular style={{ color: COLOR }} />} iconPosition="before">
          <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nbLabel(nb)}</span>
          <ChevronDown20Regular />
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>{tl("Auf diesem Computer")}</MenuGroupHeader>
            {localList.map((d) => (
              <MenuItem key={d.id} icon={<Desktop20Regular />} onClick={() => void openNotebook({ source: "local", id: d.id, name: d.name })}>
                {d.name || tl("Notizbuch")}
              </MenuItem>
            ))}
            <MenuItem icon={<Add20Regular />} onClick={() => newNotebook("local")}>
              {tl("Neues Notizbuch")}
            </MenuItem>
          </MenuGroup>
          {accounts.map((a) => {
            const books = oneBooks[a.key];
            return (
              <MenuGroup key={a.key}>
                <MenuDivider />
                <MenuGroupHeader>{tl("OneNote – {0}", a.email)}</MenuGroupHeader>
                {books === "loading" || books === undefined ? (
                  <MenuItem disabled icon={<Spinner size="extra-tiny" />}>
                    {tl("Wird geladen …")}
                  </MenuItem>
                ) : books === "consent" ? (
                  <MenuItem icon={<CloudArrowUp20Regular />} onClick={() => void grant(a.key)}>
                    {tl("Zugriff auf OneNote erlauben …")}
                  </MenuItem>
                ) : !Array.isArray(books) ? (
                  <MenuItem disabled>{books.error}</MenuItem>
                ) : (
                  <>
                    {books.map((b) => (
                      <MenuItem key={b.id} icon={<Notebook20Regular />} onClick={() => void openNotebook({ source: a.key, id: b.id, name: b.name })}>
                        {b.name}
                      </MenuItem>
                    ))}
                    <MenuItem icon={<Add20Regular />} onClick={() => newNotebook(a.key)}>
                      {tl("Neues Notizbuch in OneNote")}
                    </MenuItem>
                  </>
                )}
              </MenuGroup>
            );
          })}
          {isTauri && accounts.length === 0 && (
            <>
              <MenuDivider />
              <MenuItem disabled>{tl("Für OneNote: Microsoft-Konto in Ondura Mail oder unter Datei › Konto hinzufügen.")}</MenuItem>
            </>
          )}
          {isLocal(nb) && localList.length > 1 && (
            <>
              <MenuDivider />
              <MenuItem icon={<Delete20Regular />} onClick={() => void deleteNotebook()}>
                {tl("Dieses Notizbuch löschen …")}
              </MenuItem>
            </>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  let lastGroup: string | undefined;
  const sectionList = sections.map((sec) => {
    const header = sec.group && sec.group !== lastGroup ? <div className={s.group}>{sec.group}</div> : null;
    lastGroup = sec.group;
    return (
      <div key={sec.id}>
        {header}
        <button
          className={mergeClasses(s.item, sec.id === sectionId && s.itemOn)}
          onClick={() => void selectSection(sec.id)}
          onContextMenu={(e) =>
            localNb &&
            openContextMenu(e, [
              { label: tl("Umbenennen"), onClick: () => renameSection(sec.id) },
              {
                label: tl("Farbe"),
                items: SECTION_COLORS.map((c) => ({ label: c, icon: <span style={{ width: 14, height: 14, borderRadius: 3, background: c, display: "inline-block" }} />, onClick: () => void updateLocal((doc) => ({ ...doc, sections: doc.sections.map((x) => (x.id === sec.id ? { ...x, color: c } : x)) })) })),
              },
              "divider",
              { label: tl("Abschnitt löschen"), icon: <Delete20Regular />, onClick: () => void deleteSection(sec.id) },
            ])
          }
        >
          <span className={s.swatch} style={{ backgroundColor: sec.color }} />
          <span className={s.pageTitle}>{sec.name}</span>
        </button>
      </div>
    );
  });

  const pageList = results
    ? results.map((r) => (
        <button key={r.id} className={mergeClasses(s.item, s.pageItem, r.id === pageId && s.itemOn)} onClick={() => (r.section !== sectionId ? (setSectionId(r.section), setPageId(r.id)) : void selectPage(r.id))}>
          <span className={s.pageTitle}>{r.title || tl("Unbenannte Seite")}</span>
          <span className={s.pageMeta}>{r.snippet || r.sectionName}</span>
        </button>
      ))
    : pages.map((p) => (
        <button
          key={p.id}
          className={mergeClasses(s.item, s.pageItem, p.id === pageId && s.itemOn)}
          style={{ paddingLeft: 10 + p.level * 16 }}
          onClick={() => void selectPage(p.id)}
          onContextMenu={(e) =>
            openContextMenu(e, [
              localNb && { label: tl("Nach oben"), onClick: () => void movePage(p.id, -1) },
              localNb && { label: tl("Nach unten"), onClick: () => void movePage(p.id, 1) },
              localNb && (p.level ? { label: tl("Unterseite höherstufen"), onClick: () => void setLevel(p.id, 0) } : { label: tl("Als Unterseite"), onClick: () => void setLevel(p.id, 1) }),
              localNb && "divider",
              { label: tl("Seite löschen"), icon: <Delete20Regular />, onClick: () => void deletePage(p.id) },
            ])
          }
        >
          <span className={s.pageTitle}>{(p.id === pageId ? title : p.title) || tl("Unbenannte Seite")}</span>
          <span className={s.pageMeta}>{p.preview || fmtDate(p.modified)}</span>
        </button>
      ));

  const savingText = saving === "pending" || saving === "saving" ? tl("Wird gespeichert …") : saving === "error" ? tl("Nicht gespeichert") : nb && !isLocal(nb) ? tl("In OneNote gespeichert") : tl("Gespeichert");

  return (
    <div className={s.root}>
      <SuiteHeader appName={tlc("app", "Notizen")} logo="/notes.svg" center={nb ? `${nb.name}${nb.source !== "local" ? " – OneNote" : ""}` : undefined} />
      <div style={{ padding: "0 0 8px" }}>
        <OfficeRibbon tabs={tabs} active={tab} onTab={setTab} onFile={() => setNavOpen(true)} color={COLOR} />
      </div>
      <div className={s.main}>
        {navOpen && (
          <div className={s.nav}>
            {notebookMenu}
            <div className={s.head}>
              <span>{tl("Abschnitte")}</span>
              <Text size={100} className={s.muted}>
                {nb ? sourceLabel(nb.source) : ""}
              </Text>
            </div>
            <div className={s.list}>{sectionList}</div>
            <div className={s.addRow}>
              <Button appearance="subtle" icon={<Add20Regular />} onClick={addSection} disabled={!nb || (!localNb && !oneNb)}>
                {tl("Abschnitt hinzufügen")}
              </Button>
            </div>
          </div>
        )}
        {navOpen && (
          <div className={s.pagesPane}>
            <div style={{ padding: "8px 8px 4px" }}>
              <SearchBox size="small" placeholder={localNb ? tl("Notizbuch durchsuchen") : tl("Seiten durchsuchen")} value={search} onChange={(_, d) => setSearch(d.value)} style={{ width: "100%" }} />
            </div>
            <div className={s.head}>
              <span>{results ? tl("{0} Treffer", results.length) : tl("Seiten")}</span>
              {pagesLoading && <Spinner size="extra-tiny" />}
            </div>
            <div className={s.list}>{pageList}</div>
            <div className={s.addRow}>
              <Button appearance="subtle" icon={<Add20Regular />} onClick={() => void addPage()} disabled={!sectionId}>
                {tl("Seite hinzufügen")}
              </Button>
              {localNb && (
                <Tooltip content={tl("Unterseite hinzufügen")} relationship="label">
                  <Button appearance="subtle" icon={<DocumentAdd24Regular />} onClick={() => void addPage(1)} disabled={!pageId} />
                </Tooltip>
              )}
            </div>
          </div>
        )}
        <div className={s.canvas}>
          {consent && (
            <MessageBar intent="warning" className={s.bar}>
              <MessageBarBody>{tl("Für OneNote braucht Ondura Ihre Zustimmung ({0}).", accounts.find((a) => a.key === consent)?.email ?? "")}</MessageBarBody>
              <MessageBarActions>
                <Button appearance="primary" size="small" onClick={() => void grant(consent)}>
                  {tl("Zugriff erlauben")}
                </Button>
              </MessageBarActions>
            </MessageBar>
          )}
          {!pageId ? (
            <div className={s.empty}>
              <Notebook20Regular style={{ width: 48, height: 48, color: COLOR }} />
              <Text size={400} weight="semibold">
                {sectionId ? tl("Dieser Abschnitt ist leer.") : tl("Wählen Sie einen Abschnitt.")}
              </Text>
              {sectionId && (
                <Button appearance="primary" icon={<Add20Regular />} onClick={() => void addPage()}>
                  {tl("Seite hinzufügen")}
                </Button>
              )}
            </div>
          ) : (
            <div className={s.paper}>
              <input
                id="nx-note-title"
                className={s.title}
                value={title}
                placeholder={tl("Seitentitel")}
                onChange={(e) => {
                  setTitle(e.target.value);
                  current.current.title = e.target.value;
                  scheduleSave();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    if (editor) {
                      editor.commands.setTextSelection(1);
                      editor.view.focus();
                    }
                  }
                }}
              />
              <span className={s.date}>{fmtLong(created)}</span>
              {pageLoading ? <Spinner label={tl("Seite wird geladen …")} style={{ marginTop: 40 }} /> : null}
              <div style={{ display: pageLoading ? "none" : undefined }}>
                <EditorContent editor={editor} />
              </div>
            </div>
          )}
        </div>
      </div>
      <StatusBar>
        <span>{pages.length === 1 ? tl("1 Seite") : tl("{0} Seiten", pages.length)}</span>
        <span style={{ flex: 1 }} />
        <span>{savingText}</span>
      </StatusBar>
      <AskName ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

function AskName({ ask, onClose }: { ask: null | { label: string; value: string; onOk: (v: string) => void }; onClose: () => void }) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(ask?.value ?? ""), [ask]);
  const ok = () => {
    if (!ask || !value.trim()) return;
    ask.onOk(value.trim());
    onClose();
  };
  return (
    <Dialog open={!!ask} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{ask?.label}</DialogTitle>
          <DialogContent>
            <Field>
              <Input autoFocus value={value} onChange={(_, d) => setValue(d.value)} onKeyDown={(e) => e.key === "Enter" && ok()} onFocus={(e) => e.target.select()} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={ok} disabled={!value.trim()}>
              {tl("OK")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
