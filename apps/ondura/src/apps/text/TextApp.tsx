import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openDropped, useFileDrop } from "../../shell/fileDrop";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { getHTMLFromFragment } from "@tiptap/core";
import { Button, Checkbox, Input, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, Slider, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDown16Regular, ArrowUp16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { DocumentTitle, useCloudAutoSave } from "../../shell/cloud";
import { Backstage, type BackstageStart, DocumentInfo, StatusBar, useUnsavedPrompt } from "../../shell/office";
import { buildTextTemplate, textTemplates } from "./startPage";
import { useNotify } from "../../shell/notify";
import { key, openContextMenu, readClipboardHtml, readClipboardText } from "../../shell/contextMenu";
import { splashDone } from "../../shell/splash";
import { errorMessage, isTauri } from "../../lib/api";
import { NO_BROWSER_HEADER, runPrintJob, type PrintJob } from "../../lib/print";
import { addRecent, baseName, extOf, guardClose, initialFile, lossMessage, officeInvoke, openDocumentWindow, openTemplateWindow, pickOpenPath, pickPdfPath, pickSavePath, setWindowTitle, takeTemplate, withoutExt, openProtected } from "../../lib/office";
import { textExtensions, replaceAll, replaceCurrent, searchState, setSearch, stepSearch } from "./extensions";
import { pagePlace, refreshPagination } from "./pagination";
import { type Imposition, type ScreenPage, screenPrintLayout } from "./printLayout";
import { type DocLayout, type PageFrame, frameOf, pageMargins, paperWidth } from "./pageFrames";
import { TextRibbon } from "./TextRibbon";
import { HeaderFooterDialog, type HeaderFooterValue, LinkDialog, ParagraphDialog, type ParagraphValues, TextDialog } from "./dialogs";
import { ColumnsDialog, type DocumentPageOptions, PageSetupDialog, type PageSetupResult, defaultPageSetup } from "./pageSetup";
import { type Block, type Comment, type PageSetup, type Paragraph, type SectionStart, HF_KEYS, keepHeaders, type TextDocument, documentToPm, emptyDocument, mmToPx, pmBlocks, readSectionStarts, withSectionStarts } from "./model";
import { LineNumberLayer } from "./lineNumbers";
import { commentRanges, gotoChange, headingPosition, isTracking, trackKey, removeComment, resolveChanges, setTracking, tocEntries, updateTocs } from "./review";
import { CommentsPane, FootnoteList, roman } from "./ReviewPane";
import { AccessibilityPane, AltTextDialog, type A11yIssue } from "../../shell/a11y";
import { checkText } from "./a11y";
import { MacroDialog } from "../../shell/macros";
import { TEXT_MACRO_REFERENCE, TEXT_MACRO_TEMPLATE, runTextMacro } from "./macros";
import { sampleDocument } from "./sample";
import { misspelledAt, refreshSpelling, spell } from "./spell/spell";
import { SpellingDialog } from "./spell/SpellingDialog";
import { type RefStorage, bibliographyEntries, captionTargets, figureEntries, indexEntries, insertCaption, insertField, refreshFields, updateLists } from "./refs";
import { CaptionDialog, CrossRefDialog, MarkEntryDialog, SourcesDialog } from "./refDialogs";
import { type MergeState, activeRows, addressBlockContent, contactData, greetingContent, mergeAll, mergeState, parseCsv, recordOf, sheetData } from "./merge";
import { NewListDialog, RecipientsDialog, SheetPickDialog } from "./mergeDialogs";
import { type ControlAttrs, insertControl, selectedControl, updateControl } from "./controls";
import { ControlPropsDialog } from "./controlDialogs";
import { StyleDialog } from "./StyleDialog";
import { effective, setStyleDef, styleCss, styleFromSelection } from "./styles";
import type { StyleDef } from "./model";
import type { MergeAction } from "./TextRibbon";
import type { RustWorkbook } from "../sheets/model";
import { pim } from "../../lib/pim";
import type { Source } from "./model";
import "./text.css";
import { RecoveryBar, useAutoRecover, type Snapshot } from "../../lib/recovery";
import type { Protection } from "./model";
import type { ShapeAttrs } from "./layout";
import type { TextTool } from "./TextRibbon";
import { DesignDialog, EnvelopeDialog, LabelsDialog, MathDialog, PROTECTION_LABEL, ProtectDialog, ShapeDialog, sheetDecoration, type PageDesign } from "./textExtras";
import { GrammarDialog, TemplatesDialog, TranslateDialog, combineDocuments, compareDocuments, openInNewWindow, readAloud, startDictation, stopReading, takeHandoff, textToRead } from "./textTools";

import { tl, tlc, LOCALE } from "../../lib/i18n";
import { type CopiedFormat, DateTimeDialog, FieldsDialog, THEME_COLORS, THEME_FONTS, THEME_SPACING, captureScreen, chartPng, copyFormat, insertBlankPage, insertCoverPage, insertSignatureLine, insertWordArt, pasteFormat, type QuickPart, loadQuickParts, removeQuickPart, saveQuickPart } from "./insertTools";
import { IconsDialog, iconPng } from "../slides/slidesExtras";
import { ChartDataDialog, sampleChart } from "../slides/objects";
import type { Chart } from "../chart/ChartView";

const COLOR = "#2b5bd7";
const PANE_W = 290;
const GAP = 24;

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  work: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "8px 8px 0", borderRadius: `${tokens.borderRadiusLarge} ${tokens.borderRadiusLarge} 0 0`, overflow: "hidden", position: "relative" },
  find: {
    position: "absolute",
    top: "10px",
    right: "24px",
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    width: "340px",
  },
  findRow: { display: "flex", gap: "4px", alignItems: "center" },
  loading: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, backgroundColor: "rgba(0,0,0,0.04)" },
  zoom: { display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" },
});

interface Loaded {
  document: TextDocument;
  warnings: string[];
}

/** Margins with the gutter added (left, or top with "gutter at top"), in mm. */
export function effectiveMargins(p: PageSetup, gutterAtTop: boolean, layout?: Pick<DocLayout, "mirrorMargins" | "bookFold">) {
  if (layout) return pageMargins(p, { ...layout, gutterAtTop }, 1);
  const g = p.gutterMm ?? 0;
  return { top: p.marginTopMm + (gutterAtTop ? g : 0), bottom: p.marginBottomMm, left: p.marginLeftMm + (gutterAtTop ? 0 : g), right: p.marginRightMm };
}

interface HeadersFooters {
  header: Block[];
  footer: Block[];
  first: { enabled: boolean; header: Block[]; footer: Block[] };
  even: { enabled: boolean; header: Block[]; footer: Block[] };
}

/** Header or footer of a page (1-based): first page, even pages, the rest. */
/** The section breaks of the document, in order; the break ends a section
 *  and carries its page setup, `next` is how the following section starts. */
function sectionBreaks(doc: import("@tiptap/pm/model").Node): { pos: number; page: PageSetup | null; next: SectionStart | null }[] {
  const out: { pos: number; page: PageSetup | null; next: SectionStart | null }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "sectionBreak") out.push({ pos, page: n.attrs.page ?? null, next: n.attrs.next ?? null });
    return n.isBlock && n.type.name !== "paragraph";
  });
  return out;
}

/** A page setup without the section start (that lives on the break). */
const pageOnly = (p: PageSetup): PageSetup => {
  const { start: _start, ...rest } = p;
  return rest;
};

/** Headers and footers of a section: the document's, replaced by the own
 *  ones of the sections up to it (a section without own ones is linked to
 *  the section before). */
function hfOfSection(hf: HeadersFooters, setups: PageSetup[], section: number): HeadersFooters {
  const cur: Record<(typeof HF_KEYS)[number], Block[]> = { header: hf.header, footer: hf.footer, headerFirst: hf.first.header, footerFirst: hf.first.footer, headerEven: hf.even.header, footerEven: hf.even.footer };
  for (let i = 0; i <= Math.min(section, setups.length - 1); i++) for (const k of HF_KEYS) if (setups[i][k]) cur[k] = setups[i][k]!;
  return { header: cur.header, footer: cur.footer, first: { ...hf.first, header: cur.headerFirst, footer: cur.footerFirst }, even: { ...hf.even, header: cur.headerEven, footer: cur.footerEven } };
}

function hfFor(hf: HeadersFooters, page: number, which: "header" | "footer", firstPage = page === 1 && hf.first.enabled): Block[] {
  if (firstPage) return hf.first[which];
  if (hf.even.enabled && page % 2 === 0) return hf.even[which];
  return hf[which];
}

function hfDom(blocks: Block[], page: number, pages: number): HTMLElement | null {
  if (!blocks.length) return null;
  const wrap = document.createElement("div");
  for (const b of blocks) {
    if (b.type !== "paragraph") continue;
    const line = document.createElement("div");
    line.style.textAlign = b.align ?? "left";
    line.textContent = b.content.map((i) => (i.type === "text" ? i.text : i.type === "field" ? String(i.field === "pages" ? pages : page) : i.type === "tab" ? " " : "")).join("") || " ";
    wrap.appendChild(line);
  }
  return wrap;
}

function cssString(s: string) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `content:` value for an @page margin box. */
function hfCss(blocks: Block[]): { content: string; align: string } | null {
  const paras = blocks.filter((b): b is Paragraph => b.type === "paragraph");
  if (!paras.length) return null;
  const parts: string[] = [];
  paras.forEach((p, n) => {
    if (n > 0) parts.push('"\\A"');
    for (const i of p.content) {
      if (i.type === "text") parts.push(cssString(i.text));
      else if (i.type === "field") parts.push(i.field === "pages" ? "counter(pages)" : "counter(page)");
      else if (i.type === "tab") parts.push('"  "');
    }
  });
  return { content: parts.join(" ") || '""', align: paras[0].align ?? "left" };
}

export function TextApp() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();

  const initial = useMemo<TextDocument>(() => {
    if (!isTauri) return sampleDocument();
    const d = { ...emptyDocument(), ...defaultDesign() };
    const def = defaultPageSetup();
    return def ? { ...d, page: def } : d;
  }, []);
  const [path, setPath] = useState<string | null>(null);
  /** Password of a protected document (kept for saving). */
  const [password, setPassword] = useState<string | null>(null);
  // The document is dirty when its content differs from the last
  // loaded/saved state, or when page setup, header/footer or properties
  // were changed.
  const [docDirty, setDocDirty] = useState(false);
  const [metaDirty, setDirty] = useState(false);
  const dirty = docDirty || metaDirty;
  const savedDoc = useRef<import("@tiptap/pm/model").Node | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [page, setPage] = useState<PageSetup>(initial.page);
  const [header, setHeader] = useState<Block[]>(initial.header);
  const [footer, setFooter] = useState<Block[]>(initial.footer);
  const [first, setFirst] = useState({ enabled: !!initial.differentFirst, header: initial.headerFirst ?? [], footer: initial.footerFirst ?? [] });
  // Different header/footer on even pages.
  const [even, setEven] = useState({ enabled: !!initial.differentOddEven, header: initial.headerEven ?? [], footer: initial.footerEven ?? [] });
  // Document-wide page options (Page Setup dialog): facing pages, gutter
  // position and automatic hyphenation.
  const [docLayout, setDocLayout] = useState<DocLayout>({ mirrorMargins: !!initial.mirrorMargins, gutterAtTop: !!initial.gutterAtTop, hyphenation: !!initial.hyphenation, twoOnOne: !!initial.twoOnOne, bookFold: !!initial.bookFold, bookFoldSheets: initial.bookFoldSheets ?? 0 });
  const [comments, setComments] = useState<Comment[]>(initial.comments ?? []);
  const [sources, setSources] = useState<Source[]>(initial.sources ?? []);
  const [refDialog, setRefDialog] = useState<null | "caption" | "crossref" | "mark" | "cite" | "sources">(null);
  // Mail merge: recipients, preview record, field highlighting and dialogs.
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [mergePreview, setMergePreview] = useState(false);
  const [mergeIndex, setMergeIndex] = useState(0);
  const [mergeHighlight, setMergeHighlight] = useState(false);
  const [mergeDialog, setMergeDialog] = useState<null | "recipients" | "new">(null);
  const [styleDefs, setStyleDefs] = useState<StyleDef[]>(initial.styles ?? []);
  // Word ribbon parity: format painter, ¶ marks, views, markup display,
  // navigation pane, gridlines and the dialogs of the Insert tab.
  const [painter, setPainter] = useState<CopiedFormat | null>(null);
  const painterRef = useRef<CopiedFormat | null>(null);
  painterRef.current = painter;
  const [showMarks, setShowMarks] = useState(false);
  const [viewMode, setViewMode] = useState<"print" | "web" | "draft">("print");
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const [markup, setMarkup] = useState<"all" | "simple" | "none" | "original">("all");
  const [navPane, setNavPane] = useState(false);
  const [gridlines, setGridlines] = useState(false);
  const [parts, setParts] = useState<QuickPart[]>([]);
  useEffect(() => {
    void loadQuickParts().then(setParts);
  }, []);
  const [insertDialog, setInsertDialog] = useState<null | "datetime" | "icons" | "bookmark" | "signature" | "quickPartSave" | "wordart">(null);
  const [pending, setPending] = useState<string>("");
  const [chartEdit, setChartEdit] = useState<Chart | null>(null);
  const textFileInput = useRef<HTMLInputElement>(null);
  const [styleEdit, setStyleEdit] = useState<string | null>(null);
  const [controlProps, setControlProps] = useState<{ pos: number; attrs: ControlAttrs } | null>(null);
  const [sheetPick, setSheetPick] = useState<{ wb: RustWorkbook; name: string } | null>(null);
  const [userName, setUserName] = useState(() => {
    try {
      return localStorage.getItem("ondura.userName") ?? "";
    } catch {
      return "";
    }
  });
  const [footnoteEdit, setFootnoteEdit] = useState<null | { pos: number | null; text: string; endnote: boolean }>(null);
  // Page setup of the section that ends at a section break (its position).
  // Page setup dialog for one section (index into the sections of the document).
  const [sectionEdit, setSectionEdit] = useState<null | { index: number; tab?: "margins" | "paper" | "layout"; scope?: "section" }>(null);
  const [columnsEdit, setColumnsEdit] = useState<null | { count: number; gap: number; line: boolean }>(null);
  const [focusComment, setFocusComment] = useState<number | null>(null);
  const [meta, setMeta] = useState({ title: initial.title, author: initial.author, font: initial.defaultFont ?? null, size: initial.defaultSize ?? null });
  // Pages from the pagination: their number, the section of each, and the
  // editor height that fills the last one.
  const [layout, setLayout] = useState<{ pages: number; sections: number[]; minHeight: number }>({ pages: 1, sections: [0], minHeight: 0 });
  const [zoom, setZoom] = useState(1);
  const [backstage, setBackstage] = useState<null | BackstageStart>(null);
  const templateList = useMemo(textTemplates, []);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [a11yIssues, setA11yIssues] = useState<A11yIssue[]>([]);
  const [altFor, setAltFor] = useState<{ pos: number; alt: string } | null>(null);
  const [dialog, setDialog] = useState<null | "page" | "hf" | "link" | "paragraph" | "name">(null);
  const [spelling, setSpelling] = useState(false);
  const [spellAuto, setSpellAuto] = useState(() => localStorage.getItem("ondura.spell.auto") !== "0");
  const [spellLang, setSpellLang] = useState(spell.lang);
  const spellLangRef = useRef(spellLang);
  spellLangRef.current = spellLang;
  const [spellMenu, setSpellMenu] = useState<null | { x: number; y: number; from: number; to: number; word: string; suggestions: string[] | null }>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const editorMenuRef = useRef<((e: MouseEvent) => void) | null>(null);
  const [find, setFind] = useState<null | { replace: boolean }>(null);
  const [loading, setLoading] = useState(false);
  // Print layout in the DOM: a copy of the screen pages (`screen`) or, for
  // documents that are not on screen (mail merge), the text in flow.
  const [printing, setPrinting] = useState<{ html: string; screen: boolean } | null>(null);
  const screenPrint = useRef<{ css: string; first: { width: number; height: number } } | null>(null);
  /** What the screen shows, for printing it (updated on every render). */
  const screenRef = useRef<{ zoom: number; plain: boolean; pages: ScreenPage[]; imposition: Imposition; bookletSheets: number }>({ zoom: 1, plain: true, pages: [], imposition: "single", bookletSheets: 0 });
  // Target file while the print view is exported as PDF instead of printed.
  /** Job for the next print layout (PDF export, preview, printer or dialog) and its completion. */
  const printJob = useRef<{ job: PrintJob; done: (error?: unknown) => void } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // Page of the cursor: number of page gaps above it.
  const cursorPage = useCallback((e: Editor) => {
    try {
      const c = e.view.coordsAtPos(e.state.selection.from);
      const top = (c.top + c.bottom) / 2;
      const spacers = e.view.dom.querySelectorAll<HTMLElement>(".nx-page-spacer");
      let n = 1;
      spacers.forEach((sp) => {
        if (sp.getBoundingClientRect().bottom < top) n++;
      });
      setCurrentPage(n);
    } catch {
      /* position not rendered */
    }
  }, []);

  const pageRef = useRef(page);
  const hfRef = useRef({ header, footer, first, even });
  const docLayoutRef = useRef(docLayout);
  pageRef.current = page;
  hfRef.current = { header, footer, first, even };
  docLayoutRef.current = docLayout;
  const author = userName.trim() || meta.author.trim() || tl("Ich");
  const authorRef = useRef(author);
  authorRef.current = author;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const canvas = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const recipientInput = useRef<HTMLInputElement>(null);
  const [paperSize, setPaperSize] = useState({ w: 0, h: 0 });
  // Height of what is on the paper (text and footnotes), without the
  // sheets' own minimum height (measuring the paper would feed back).
  const [contentHeight, setContentHeight] = useState(0);
  const [notesHeight, setNotesHeight] = useState(0);
  const [design, setDesign] = useState<PageDesign>({ pageColor: initial.pageColor ?? null, pageBorder: initial.pageBorder ?? null, watermark: initial.watermark ?? null });
  const [protection, setProtection] = useState<Protection | null>(initial.protection ?? null);
  const [mathEdit, setMathEdit] = useState<null | { pos: number | null; latex: string; display: boolean }>(null);
  const [shapeEdit, setShapeEdit] = useState<null | { pos: number | null; attrs: ShapeAttrs }>(null);
  const [designDialog, setDesignDialog] = useState<null | "color" | "border" | "watermark">(null);
  const [toolDialog, setToolDialog] = useState<null | "protect" | "envelope" | "labels" | "grammar" | "translate" | "templates">(null);
  const [speaking, setSpeaking] = useState(false);
  const [dictation, setDictation] = useState<null | (() => void)>(null);
  const [outline, setOutline] = useState(false);
  const [readMode, setReadMode] = useState(false);

  // Page setups of the sections (the last one is `page`), cached per document.
  const setupCache = useRef<{ doc: unknown; page: PageSetup | null; setups: PageSetup[] }>({ doc: null, page: null, setups: [] });
  const sectionSetups = useCallback((): PageSetup[] => {
    const doc = editorRef.current?.state.doc;
    const c = setupCache.current;
    if (!doc) return [pageRef.current];
    if (c.doc !== doc || c.page !== pageRef.current) {
      const setups: PageSetup[] = [];
      doc.forEach((n) => void (n.type.name === "sectionBreak" && setups.push((n.attrs.page as PageSetup | null) ?? pageRef.current)));
      setups.push(pageRef.current);
      setupCache.current = { doc, page: pageRef.current, setups };
    }
    return setupCache.current.setups;
  }, []);
  const frameFor = useCallback((pageNumber: number, section: number): PageFrame => {
    const setups = sectionSetups();
    return frameOf(setups[Math.min(section, setups.length - 1)], docLayoutRef.current, pageNumber);
  }, [sectionSetups]);
  const paperW = useCallback(() => paperWidth(sectionSetups(), docLayoutRef.current), [sectionSetups]);
  /** "Different first page" of a section (its own setting or the document's). */
  const titlePage = useCallback(
    (section: number) => {
      const setups = sectionSetups();
      return setups[Math.min(section, setups.length - 1)]?.titlePage ?? hfRef.current.first.enabled;
    },
    [sectionSetups],
  );

  const editor = useEditor({
    extensions: textExtensions({
      pagination: {
        frame: frameFor,
        paperWidth: paperW,
        gap: GAP,
        renderHeader: (pg, n, f, place) => {
          const el = hfDom(hfFor(hfOfSection(hfRef.current, sectionSetups(), place.section), pg, "header", place.first && titlePage(place.section)), pg, n);
          if (el) el.style.paddingTop = `${f.headerDist}px`;
          return el;
        },
        renderFooter: (pg, n, f, place) => {
          const el = hfDom(hfFor(hfOfSection(hfRef.current, sectionSetups(), place.section), pg, "footer", place.first && titlePage(place.section)), pg, n);
          if (el) {
            el.style.marginTop = "auto";
            el.style.paddingBottom = `${f.footerDist}px`;
          }
          return el;
        },
        onLayout: (l) => setLayout({ pages: l.pages.length, sections: l.pages.map((p) => p.section), minHeight: l.minHeight }),
        // Web and draft view: one flow that wraps at the window width.
        enabled: () => viewModeRef.current === "print",
      },
      author: () => authorRef.current,
      hyphenation: { enabled: () => docLayoutRef.current.hyphenation, lang: () => spellLangRef.current },
    }),
    content: documentToPm(initial),
    editorProps: {
      // Ondura checks spelling itself (same result in every webview).
      attributes: { spellcheck: "false", lang: spell.lang },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const ed = editorRef.current;
          const w = at && ed ? misspelledAt(ed, at.pos) : null;
          if (!w) {
            // Right-click outside the selection moves the cursor there.
            const { from, to } = view.state.selection;
            if (at && ed && (at.pos < from || at.pos > to)) ed.commands.setTextSelection(at.pos);
            editorMenuRef.current?.(event);
            return true;
          }
          event.preventDefault();
          setSpellMenu({ x: event.clientX, y: event.clientY, ...w, suggestions: null });
          void spell.suggest(w.word).then((s) => setSpellMenu((m) => (m && m.from === w.from ? { ...m, suggestions: s } : m)));
          return true;
        },
      },
      handleDoubleClickOn: (view, pos, node) => {
        if (node.type.name === "sectionBreak") {
          setSectionEdit({ index: sectionBreaks(view.state.doc).filter((b) => b.pos < pos).length, scope: "section" });
          return true;
        }
        if (node.type.name !== "footnote") return false;
        setFootnoteEdit({ pos, text: node.attrs.text ?? "", endnote: !!node.attrs.endnote });
        return true;
      },
      handleClickOn: (view, _pos, node, _nodePos, event) => {
        if (node.type.name !== "toc") return false;
        const entry = (event.target as HTMLElement).closest("[data-index]");
        if (!entry) return false;
        const target = headingPosition({ state: view.state } as never, Number(entry.getAttribute("data-index")));
        if (target !== null) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).scrollIntoView());
          view.focus();
        }
        return true;
      },
    },
    onCreate: ({ editor: e }) => {
      savedDoc.current = e.state.doc;
      // Normalisation on the first transactions (trailing paragraph) is not an edit.
      requestAnimationFrame(() => (savedDoc.current = e.state.doc));
      if (!isTauri) (window as { __onduraText?: unknown }).__onduraText = e;
    },
    onUpdate: ({ editor: e }) => setDocDirty(!savedDoc.current || !e.state.doc.eq(savedDoc.current)),
    onSelectionUpdate: ({ editor: e }) => cursorPage(e),
  });

  editorRef.current = editor;
  // Page breaks are laid out after the selection moved.
  useEffect(() => {
    if (editor) cursorPage(editor);
  }, [editor, layout, cursorPage]);
  const words = useEditorState({ editor, selector: ({ editor: e }) => (e?.storage.characterCount?.words?.() ?? 0) }) ?? 0;

  const name = path ? baseName(path) : meta.title || "Dokument1";
  useEffect(() => {
    void setWindowTitle(tl("{0}{1} – Ondura Text", dirty ? "• " : "", withoutExt(name)));
  }, [name, dirty]);

  // Re-render headers/footers and re-measure when the page setup changes.
  useEffect(() => {
    if (editor) refreshPagination(editor.view);
  }, [editor, page, header, footer, first, even, docLayout]);

  useEffect(() => {
    const el = paper.current;
    if (!el) return;
    const measure = () => {
      setPaperSize({ w: el.offsetWidth, h: el.offsetHeight });
      // The editor is stretched to whole pages, so measure where its last
      // block really ends; footnotes follow it on the last sheet.
      const pm = el.querySelector<HTMLElement>(":scope > .tiptap-wrap > .ProseMirror");
      const last = pm?.lastElementChild as HTMLElement | null | undefined;
      const end = last ? last.offsetTop + last.offsetHeight + (parseFloat(getComputedStyle(last).marginBottom) || 0) : 0;
      const notes = [...el.querySelectorAll<HTMLElement>(":scope > .nx-footnotes")].reduce((h, n) => h + n.offsetHeight + (parseFloat(getComputedStyle(n).marginTop) || 0), 0);
      setNotesHeight(notes);
      setContentHeight(end + notes);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const pm = el.querySelector(":scope > .tiptap-wrap > .ProseMirror");
    if (pm) ro.observe(pm);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true });
    if (pm) mo.observe(pm, { childList: true, subtree: true, characterData: true });
    return () => (ro.disconnect(), mo.disconnect());
  }, []);

  useEffect(() => splashDone(), []);

  // ---------------------------------------------------------------- files --

  const currentDocument = useCallback((): TextDocument => {
    const blocks = pmBlocks(editor?.getJSON().content ?? []);
    return withSectionStarts({
      page,
      blocks: blocks.length ? blocks : [{ type: "paragraph", content: [] }],
      header,
      footer,
      title: meta.title,
      author: meta.author,
      defaultFont: meta.font,
      defaultSize: meta.size,
      differentFirst: first.enabled,
      headerFirst: first.enabled ? first.header : [],
      footerFirst: first.enabled ? first.footer : [],
      comments,
      sources,
      styles: styleDefs,
      pageColor: design.pageColor,
      pageBorder: design.pageBorder,
      watermark: design.watermark,
      protection,
      differentOddEven: even.enabled,
      headerEven: even.enabled ? even.header : [],
      footerEven: even.enabled ? even.footer : [],
      ...docLayout,
    });
  }, [editor, page, header, footer, meta, first, even, docLayout, comments, sources, styleDefs, design, protection]);

  // `apply` uses the live editor (editorRef): tiptap can replace its instance
  // while the window starts, and a document that finishes loading afterwards
  // must go into the current one, not a destroyed one (whose schema is gone).
  const apply = useCallback((loaded: TextDocument) => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    const doc = readSectionStarts(loaded);
    setPage(doc.page);
    setHeader(doc.header ?? []);
    setFooter(doc.footer ?? []);
    setFirst({ enabled: !!doc.differentFirst, header: doc.headerFirst ?? [], footer: doc.footerFirst ?? [] });
    setEven({ enabled: !!doc.differentOddEven, header: doc.headerEven ?? [], footer: doc.footerEven ?? [] });
    setDocLayout({ mirrorMargins: !!doc.mirrorMargins, gutterAtTop: !!doc.gutterAtTop, hyphenation: !!doc.hyphenation, twoOnOne: !!doc.twoOnOne, bookFold: !!doc.bookFold, bookFoldSheets: doc.bookFoldSheets ?? 0 });
    setComments(doc.comments ?? []);
    setSources(doc.sources ?? []);
    setStyleDefs(doc.styles ?? []);
    setDesign({ pageColor: doc.pageColor ?? null, pageBorder: doc.pageBorder ?? null, watermark: doc.watermark ?? null });
    setProtection(doc.protection ?? null);
    setMeta({ title: doc.title ?? "", author: doc.author ?? "", font: doc.defaultFont ?? null, size: doc.defaultSize ?? null });
    // A fresh state also resets the undo history.
    const node = editor.schema.nodeFromJSON(documentToPm(doc));
    editor.view.updateState(EditorState.create({ doc: node, plugins: editor.state.plugins, schema: editor.schema }));
    editor.commands.setTextSelection(1);
    savedDoc.current = editor.state.doc;
    setDocDirty(false);
    setDirty(false);
  }, []);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const { loaded: r, password: pw } = await openProtected<Loaded>("text_open", p);
        setPassword(pw);
        apply(r.document);
        // A template opens as a new document based on it.
        if (extOf(p) === "dotx") {
          setPath(null);
          setMeta((m) => ({ ...m, title: m.title || withoutExt(baseName(p)) }));
        } else setPath(p);
        setWarnings(r.warnings);
        addRecent("text", p);
        if (r.warnings.length) notify(tl("Nicht alles konnte übernommen werden"), tl("Details unter Datei › Informationen."), "warning");
      } catch (e) {
        notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [apply, notify],
  );

  // What this window starts with is decided once (hand-offs are read once),
  // then applied whenever the editor (re)appears.
  const startup = useRef<null | { file: string | null; doc: TextDocument | null; fromHandoff: boolean; home: boolean }>(null);
  useEffect(() => {
    // tiptap discards its first instance when the window mounts slowly and
    // creates a new one; only the live instance takes the document.
    if (!editor || editor.isDestroyed) return;
    if (!startup.current) {
      const file = initialFile();
      const handoff = file ? null : takeHandoff();
      const tpl = file || handoff ? null : takeTemplate("text");
      startup.current = { file, doc: handoff ?? (tpl ? buildTextTemplate(tpl) : null), fromHandoff: !!handoff, home: !file && !handoff && !tpl };
    }
    const st = startup.current;
    if (st.file) void load(st.file);
    else if (st.doc) {
      // A document made by another window (compare, labels …) or a template.
      apply(st.doc);
      if (st.fromHandoff) setDirty(true);
    } else if (st.home) setBackstage("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const saveTo = useCallback(
    async (target: string, quiet = false) => {
      // Page numbers in tables of contents are refreshed on save.
      if (editor) updateTocs(editor);
      const lost = await officeInvoke<string[]>("text_save", { path: target, password, document: currentDocument() });
      setPath(target);
      savedDoc.current = editor?.state.doc ?? null;
      setDocDirty(false);
      setDirty(false);
      addRecent("text", target);
      const warn = lossMessage(lost);
      if (warn) notify(tl("Gespeichert: {0}", baseName(target)), warn, "warning");
      else if (!quiet) notify(tl("Gespeichert"), baseName(target), "success");
    },
    [currentDocument, notify, editor, password],
  );

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (!isTauri) {
      notify(tl("Speichern"), tl("Im Browser-Vorschaumodus nicht verfügbar."), "info");
      return false;
    }
    const target = await pickSavePath("text", withoutExt(name), path ? extOf(path) : undefined);
    if (!target) return false;
    try {
      await saveTo(target);
      return true;
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
      return false;
    }
  }, [name, notify, saveTo, path]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!path) return saveAs();
    try {
      await saveTo(path);
      return true;
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
      return false;
    }
  }, [path, saveAs, saveTo, notify]);
  // AutoRecover: snapshot every minute while there are unsaved changes.
  useAutoRecover<TextDocument>("text", dirty, () => ({ name, path, data: currentDocument() }));
  const restore = (snap: Snapshot<TextDocument>) => {
    apply(snap.data);
    setPath(snap.path);
    setDirty(true);
    notify(tl("Dokument wiederhergestellt"), tl("Speichern Sie es, um die Änderungen zu behalten."), "info");
  };

  // AutoSave for documents in OneDrive/SharePoint.
  const autoSave = useCloudAutoSave(
    path,
    dirty,
    useCallback(async () => {
      if (!path) return false;
      try {
        await saveTo(path, true);
        return true;
      } catch {
        return false;
      }
    }, [path, saveTo]),
  );

  const open = useCallback(
    async (target?: string) => {
      const p = target ?? (await pickOpenPath("text"));
      if (!p) return;
      setBackstage(null);
      // An untouched new document is replaced.
      if (!path && !dirtyRef.current) await load(p);
      else await openDocumentWindow("text", p);
    },
    [load, path],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(withoutExt(name)), save), [name, save, unsaved]);

  // --------------------------------------------------------------- print --

  const sectionCss = useRef("");
  // The backstage (print view) stays open: it is hidden in print media.
  const printDoc = useCallback(
    (doc: PMNode) => {
      if (!editor) return;
      // The document on screen prints as it is laid out there.
      const sc = screenRef.current;
      if (doc === editor.state.doc && paper.current && sc.plain && sc.pages.length) {
        const r = screenPrintLayout(paper.current, sc.zoom, sc.pages, sc.imposition, sc.bookletSheets);
        screenPrint.current = { css: r.css, first: r.first };
        setPrinting({ html: r.html, screen: true });
        return;
      }
      const notes: string[] = [];
      const endnotes: string[] = [];
      doc.descendants((n) => {
        if (n.type.name === "footnote") (n.attrs.endnote ? endnotes : notes).push(n.attrs.text ?? "");
      });
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const list = notes.length ? `<div class="nx-footnotes">${notes.map((t, i) => `<div class="nx-footnote"><sup>${i + 1}</sup> ${esc(t)}</div>`).join("")}</div>` : "";
      const endList = endnotes.length ? `<div class="nx-footnotes"><div class="nx-endnotes-title">Endnoten</div>${endnotes.map((t, i) => `<div class="nx-footnote"><sup>${roman(i)}</sup> ${esc(t)}</div>`).join("")}</div>` : "";
      // Sections become named pages with their own size and margins.
      const pages: PageSetup[] = [];
      const starts: (string | null)[] = [];
      doc.forEach((n) => {
        if (n.type.name === "sectionBreak") {
          if (n.attrs.page) pages.push(n.attrs.page as PageSetup);
          starts.push(n.attrs.next ?? null);
        }
      });
      const parts = getHTMLFromFragment(doc.content, editor.schema).split(/<div[^>]*data-section-break[^>]*>.*?<\/div>/);
      const gutterTop = docLayoutRef.current.gutterAtTop;
      let css = "";
      const html = parts
        .map((part, i) => {
          const sp = pages[i];
          // How this section starts: on a new page (left = even, right = odd) or
          // straight after the one before.
          const start = i > 0 ? starts[i - 1] : null;
          const startCss = i === 0 ? "" : start === "continuous" || start === "nextColumn" ? "break-before: auto;" : start === "evenPage" ? "break-before: left;" : start === "oddPage" ? "break-before: right;" : "break-before: page;";
          if (!sp) return `<div class="nx-sec"${startCss ? ` style="${startCss}"` : ""}>${part}${list}${endList}</div>`;
          const m = effectiveMargins(sp, gutterTop);
          css += `@page nxs${i} { size: ${sp.widthMm}mm ${sp.heightMm}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; ${NO_BROWSER_HEADER} } .nx-sec-${i} { page: nxs${i}; }`;
          return `<div class="nx-sec nx-sec-${i}"${startCss ? ` style="${startCss}"` : ""}>${part}</div>`;
        })
        .join("");
      sectionCss.current = css;
      setPrinting({ html, screen: false });
    },
    [editor],
  );
  /** Lays out `doc` for printing and runs `job` on it. */
  const printWith = useCallback(
    (doc: Parameters<typeof printDoc>[0], job: PrintJob) =>
      new Promise<void>((resolve, reject) => {
        printJob.current = { job, done: (e) => (e ? reject(e) : resolve()) };
        printDoc(doc);
      }),
    [printDoc],
  );
  /** Print view in the backstage (Strg+P). */
  const print = useCallback(() => setBackstage("print"), []);
  const printSupport = useMemo(() => (editor ? { run: (job: PrintJob) => printWith(editor.state.doc, job) } : undefined), [editor, printWith]);

  useEffect(() => {
    if (printing == null || !printing.screen) return;
    const sp = screenPrint.current;
    const style = document.createElement("style");
    style.textContent = sp?.css ?? "";
    document.head.appendChild(style);
    const t = setTimeout(async () => {
      const pending = printJob.current ?? { job: { kind: "dialog" } as PrintJob, done: () => {} };
      printJob.current = null;
      try {
        await runPrintJob(pending.job, sp?.first.width ?? 210, sp?.first.height ?? 297, [0, 0, 0, 0]);
        pending.done();
      } catch (e) {
        pending.done(e);
      }
      style.remove();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printing]);

  useEffect(() => {
    if (printing == null || printing.screen) return;
    const p = page;
    const m = effectiveMargins(p, docLayout.gutterAtTop);
    const h = hfCss(header);
    const f = hfCss(footer);
    const h1 = first.enabled ? hfCss(first.header) : null;
    const f1 = first.enabled ? hfCss(first.footer) : null;
    const h2 = even.enabled ? hfCss(even.header) : null;
    const f2 = even.enabled ? hfCss(even.footer) : null;
    const box = (where: "top" | "bottom", v: { content: string; align: string } | null) =>
      v ? `@${where}-${v.align === "center" ? "center" : v.align === "right" ? "right" : "left"} { content: ${v.content}; white-space: pre; font: 9pt Calibri, Carlito, sans-serif; color: #555; vertical-align: ${where === "top" ? "bottom" : "top"}; }` : "";
    const style = document.createElement("style");
    // Facing pages: on even (left) pages the inside margin is on the right.
    const mirror = docLayout.mirrorMargins ? ` @page :left { margin-left: ${m.right}mm; margin-right: ${m.left}mm; }` : "";
    // Pages: the first is a right page, so even pages are :left.
    const evenHf = even.enabled ? ` @page :left { ${box("top", h2)} ${box("bottom", f2)} }` : "";
    style.textContent = `@page { size: ${p.widthMm}mm ${p.heightMm}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; ${NO_BROWSER_HEADER} ${box("top", h)} ${box("bottom", f)} }${mirror}${evenHf}${first.enabled ? ` @page :first { ${box("top", h1)} ${box("bottom", f1)} }` : ""} ${sectionCss.current}${docLayout.hyphenation ? " .nx-print-root .ProseMirror { hyphens: auto; }" : ""}`;
    document.head.appendChild(style);
    const t = setTimeout(async () => {
      const pending = printJob.current ?? { job: { kind: "dialog" } as PrintJob, done: () => {} };
      printJob.current = null;
      try {
        await runPrintJob(pending.job, p.widthMm, p.heightMm, [m.top, m.right, m.bottom, m.left]);
        pending.done();
      } catch (e) {
        pending.done(e);
      }
      style.remove();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printing, page, header, footer, first, even, docLayout, notify]);

  const exportPdf = async () => {
    const target = await pickPdfPath(withoutExt(name));
    if (!target) return;
    try {
      await printWith(editor!.state.doc, { kind: "pdf", path: target });
      notify(tl("Als PDF exportiert"), baseName(target));
    } catch (e) {
      notify(tl("PDF-Export fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  // ------------------------------------------------------- review commands --

  const commentAction = (action: "new" | "delete" | "next" | "prev") => {
    if (!editor) return;
    if (action === "new") {
      const { from, to, empty } = editor.state.selection;
      let a = from;
      let b = to;
      if (empty) {
        // Comment on the word at the cursor.
        const $p = editor.state.doc.resolve(from);
        const text = $p.parent.textContent;
        const off = $p.parentOffset;
        let s0 = off;
        let e0 = off;
        while (s0 > 0 && /[\p{L}\p{N}]/u.test(text[s0 - 1])) s0--;
        while (e0 < text.length && /[\p{L}\p{N}]/u.test(text[e0])) e0++;
        if (s0 === e0) return notify(tl("Kommentar"), tl("Markiere zuerst den Text, den du kommentieren möchtest."), "info");
        a = from - (off - s0);
        b = from + (e0 - off);
      }
      const id = Math.max(0, ...comments.map((c) => c.id)) + 1;
      editor.chain().focus().setTextSelection({ from: a, to: b }).setMark("comment", { id }).run();
      setComments((c) => [...c, { id, author, date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), text: "" }]);
      setFocusComment(id);
      setDirty(true);
    } else if (action === "delete") {
      const id = editor.getAttributes("comment").id;
      if (id != null) deleteComment(Number(id));
    } else {
      const ranges = [...commentRanges(editor.state.doc).entries()].sort((x, y) => x[1].from - y[1].from);
      if (!ranges.length) return;
      const cur = editor.state.selection.from;
      const hit = action === "next" ? ranges.find(([, r]) => r.from > cur) ?? ranges[0] : [...ranges].reverse().find(([, r]) => r.to < cur) ?? ranges[ranges.length - 1];
      editor.chain().focus().setTextSelection(hit[1]).scrollIntoView().run();
      setFocusComment(hit[0]);
    }
  };

  const deleteComment = (id: number) => {
    // A reply has no range; deleting a comment deletes its replies.
    if (editor && !comments.find((c) => c.id === id)?.parent) removeComment(editor, id);
    setComments((c) => c.filter((x) => x.id !== id && x.parent !== id));
    setDirty(true);
  };

  const trackAction = (action: "toggle" | "accept" | "acceptAll" | "reject" | "rejectAll" | "next" | "prev") => {
    if (!editor) return;
    if (protection && action !== "next" && action !== "prev") {
      notify(tl("Bearbeitung eingeschränkt"), tl("Das Dokument ist geschützt: {0}.", PROTECTION_LABEL[protection.edit]), "info");
      return;
    }
    switch (action) {
      case "toggle":
        setTracking(editor, !isTracking(editor));
        break;
      case "accept":
      case "acceptAll":
      case "reject":
      case "rejectAll":
        resolveChanges(editor, action.startsWith("accept"), action.endsWith("All"));
        break;
      default:
        if (!gotoChange(editor, action === "next" ? 1 : -1)) notify(tl("Keine nachverfolgten Änderungen im Dokument."));
    }
  };

  // ------------------------------------------------------------ references --

  // Field values come from the editor's storage.
  useEffect(() => {
    if (!editor) return;
    // The extension storage only exists once the editor has been created;
    // before that, defer to the "create" event.
    const apply = () => {
      const st = (editor.extensionStorage as unknown as Record<string, RefStorage | undefined>).refs;
      if (!st || editor.isDestroyed) return;
      st.sources = sources;
      st.meta = { author: meta.author, title: meta.title, file: path ? baseName(path) : `${meta.title || "Dokument1"}.docx` };
      const rows = merge ? activeRows(merge) : [];
      st.record = merge && mergePreview && rows.length ? recordOf(merge.data, rows[Math.min(mergeIndex, rows.length - 1)]) : null;
      refreshFields(editor);
    };
    if ((editor.extensionStorage as unknown as Record<string, unknown>).refs) {
      apply();
      return;
    }
    editor.on("create", apply);
    return () => {
      editor.off("create", apply);
    };
  }, [editor, sources, meta.author, meta.title, path, merge, mergePreview, mergeIndex]);

  // ---------------------------------------------------------------- styles --

  /** Stores a changed style; for "Standard", font and size are the document defaults. */
  const applyStyle = (d: StyleDef) => {
    if (d.id === "normal") {
      setMeta((m) => ({ ...m, font: d.font ?? m.font, size: d.size ?? m.size }));
      d = { ...d, font: null, size: null };
    }
    setStyleDefs((x) => setStyleDef(x, d));
    setDirty(true);
  };

  const galleryCss = useMemo(() => {
    const out: Record<string, React.CSSProperties> = {};
    for (const d of styleDefs) {
      const e = effective(styleDefs, d.id);
      out[d.id] = { ...(d.font ? { fontFamily: d.font } : {}), color: e.color, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? "italic" : "normal" };
    }
    return out;
  }, [styleDefs]);

  // ------------------------------------------------------------ mail merge --

  const takeRecipients = (data: ReturnType<typeof parseCsv>) => {
    if (!data.rows.length) {
      notify(tl("Keine Empfänger"), tl("{0} enthält keine Datensätze unter der Kopfzeile.", data.source), "warning");
      return;
    }
    setMerge(mergeState(data));
    setMergeIndex(0);
    notify(tl("Empfänger ausgewählt"), tl("{0} Empfänger aus {1}", data.rows.length, data.source), "success");
  };

  const pickRecipientFile = async () => {
    if (!isTauri) {
      recipientInput.current?.click();
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, title: tl("Datenquelle auswählen"), filters: [{ name: tl("Adresslisten"), extensions: ["csv", "txt", "xlsx", "xlsm", "ods"] }] });
    if (typeof r !== "string") return;
    try {
      if (/\.(xlsx|xlsm|ods)$/i.test(r)) {
        const { workbook } = await officeInvoke<{ workbook: RustWorkbook }>("sheets_open", { path: r });
        if (workbook.sheets.length > 1) setSheetPick({ wb: workbook, name: baseName(r) });
        else takeRecipients(sheetData(workbook, 0, baseName(r)));
      } else takeRecipients(parseCsv(await officeInvoke<string>("read_text_file", { path: r }), baseName(r)));
    } catch (e) {
      notify(tl("Datenquelle konnte nicht gelesen werden"), errorMessage(e), "error");
    }
  };

  /** Content of the merged document for the selected recipients. */
  const mergedDoc = (): PMNode | null => {
    if (!editor || !merge) return null;
    const content = mergeAll(editor.getJSON(), merge.data, activeRows(merge));
    return editor.schema.nodeFromJSON({ type: "doc", content });
  };

  const mergeAction = async (a: MergeAction) => {
    if (!editor) return;
    const rows = merge ? activeRows(merge) : [];
    switch (a) {
      case "new":
        setMergeDialog("new");
        break;
      case "file":
        await pickRecipientFile();
        break;
      case "contacts":
        try {
          takeRecipients(contactData(await pim.contacts()));
        } catch (e) {
          notify(tl("Kontakte konnten nicht geladen werden"), errorMessage(e), "error");
        }
        break;
      case "edit":
        setMergeDialog("recipients");
        break;
      case "address":
      case "greeting":
        if (!merge) return;
        editor.chain().focus().insertContent(a === "address" ? addressBlockContent(merge.data.columns) : greetingContent(merge.data.columns)).run();
        setDirty(true);
        break;
      case "highlight":
        setMergeHighlight((v) => !v);
        break;
      case "preview":
        setMergePreview((v) => !v);
        break;
      case "first":
        setMergeIndex(0);
        break;
      case "prev":
        setMergeIndex((i) => Math.max(0, i - 1));
        break;
      case "next":
        setMergeIndex((i) => Math.min(rows.length - 1, i + 1));
        break;
      case "last":
        setMergeIndex(rows.length - 1);
        break;
      case "finishPrint": {
        const doc = mergedDoc();
        if (doc) void printWith(doc, { kind: "dialog" });
        break;
      }
      case "finishPdf": {
        const doc = mergedDoc();
        const target = doc && (await pickPdfPath(`${withoutExt(name)} – Seriendruck`));
        if (!doc || !target) return;
        try {
          await printWith(doc, { kind: "pdf", path: target });
          notify(tl("Als PDF exportiert"), baseName(target));
        } catch (e) {
          notify(tl("PDF-Export fehlgeschlagen"), errorMessage(e), "error");
        }
        break;
      }
      case "finishEdit": {
        const doc = mergedDoc();
        if (!doc) return;
        const merged: TextDocument = { ...currentDocument(), blocks: pmBlocks(doc.toJSON().content ?? []), title: meta.title };
        if (!isTauri) {
          // Browser preview: show the result in place of the template.
          apply(merged);
          setMerge(null);
          setMergePreview(false);
          notify(tl("Seriendruck erstellt"), `${rows.length} Dokumente`, "success");
          return;
        }
        const target = await pickSavePath("text", `${withoutExt(name)} – Serienbriefe`);
        if (!target) return;
        try {
          await officeInvoke<string[]>("text_save", { path: target, document: merged });
          await openDocumentWindow("text", target);
        } catch (e) {
          notify(tl("Seriendruck fehlgeschlagen"), errorMessage(e), "error");
        }
        break;
      }
    }
  };

  const refAction = (a: "caption" | "crossref" | "figures" | "mark" | "index" | "cite" | "sources" | "bibliography" | "update") => {
    if (!editor) return;
    const later = () => setTimeout(() => updateLists(editor), 300);
    switch (a) {
      case "figures": {
        const label = captionTargets(editor)[0]?.label ?? tl("Abbildung");
        editor.chain().focus().insertContent([{ type: "toc", attrs: { title: tl("Abbildungsverzeichnis"), caption: label, entries: figureEntries(editor, label) } }, { type: "paragraph" }]).run();
        later();
        return;
      }
      case "index":
        editor.chain().focus().insertContent([{ type: "docIndex", attrs: { entries: indexEntries(editor) } }, { type: "paragraph" }]).run();
        later();
        return;
      case "bibliography":
        editor.chain().focus().insertContent([{ type: "bibliography", attrs: { title: tl("Literaturverzeichnis"), entries: bibliographyEntries(editor, sources) } }, { type: "paragraph" }]).run();
        return;
      case "update": {
        const a1 = updateTocs(editor);
        const a2 = updateLists(editor);
        refreshFields(editor);
        if (!a1 && !a2) notify(tl("Alle Verzeichnisse sind aktuell"));
        return;
      }
      default:
        setRefDialog(a);
    }
  };

  const tocAction = (mode: "insert" | "update") => {
    if (!editor) return;
    if (mode === "insert") {
      editor.chain().focus().insertContent([{ type: "toc", attrs: { title: tl("Inhalt"), entries: tocEntries(editor) } }, { type: "paragraph" }]).run();
      // Page numbers shift once the table itself is laid out.
      setTimeout(() => updateTocs(editor), 300);
    } else if (!updateTocs(editor)) notify(tl("Inhaltsverzeichnis ist aktuell"));
  };

  // ------------------------------------------------------------ commands --

  const fitZoom = useCallback(
    (z: number | "width" | "page") => {
      const c = canvas.current;
      if (z === "width" && c) setZoom(Math.max(0.2, Math.min(5, (c.clientWidth - 48) / paperW())));
      else if (z === "page" && c) setZoom(Math.max(0.2, Math.min(5, (c.clientHeight - 48) / frameFor(1, 0).height)));
      else if (typeof z === "number") setZoom(Math.round(z * 100) / 100);
    },
    [page],
  );

  // Accessibility checker: re-run while the pane is open.
  const runA11y = () => editor && setA11yIssues(checkText(editor, meta.title, { editAlt: (pos, alt) => setAltFor({ pos, alt }), editTitle: () => setBackstage("info") }));
  useEffect(() => {
    if (!editor || !a11yOpen) return;
    runA11y();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      clearTimeout(t);
      t = setTimeout(runA11y, 600);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(t);
      editor.off("update", onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, a11yOpen, meta.title]);

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new window.Image();
      img.onload = () => {
        const max = mmToPx(page.widthMm - page.marginLeftMm - page.marginRightMm);
        const scale = Math.min(1, max / img.naturalWidth);
        editor?.chain().focus().setImage({ src, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) }).run();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };
  // Pictures dropped from the file manager go where they are dropped.
  const imageDrop = useFileDrop((files, e) => {
    // Documents open in their apps, pictures go into the text.
    const images = files.filter((f) => f.type.startsWith("image/"));
    const others = files.filter((f) => !f.type.startsWith("image/"));
    if (others.length) openDropped(e, others);
    if (!images.length) return;
    const at = editor?.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (at) editor?.commands.setTextSelection(at.pos);
    images.forEach(insertImage);
  }, !readMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F7" && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSpelling(true);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
      } else if (k === "o") {
        e.preventDefault();
        void open();
      } else if (k === "n") {
        e.preventDefault();
        void openTemplateWindow("text", "blank");
      } else if (k === "p") {
        e.preventDefault();
        print();
      } else if (k === "f" || k === "h") {
        e.preventDefault();
        setFind({ replace: k === "h" });
      } else if (k === "k") {
        e.preventDefault();
        setDialog("link");
      } else if (k === "f7") {
        e.preventDefault();
        setSpelling(true);
      } else if (e.key === ">" || (e.shiftKey && e.key === ".")) {
        e.preventDefault();
        const cur = parseFloat(editor?.getAttributes("textStyle").fontSize ?? "11") || 11;
        editor?.chain().focus().setFontSize(`${cur + 1}pt`).run();
      } else if (e.key === "<" || (e.shiftKey && e.key === ",")) {
        e.preventDefault();
        const cur = parseFloat(editor?.getAttributes("textStyle").fontSize ?? "11") || 11;
        editor?.chain().focus().setFontSize(`${Math.max(1, cur - 1)}pt`).run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, open, print, save, saveAs]);

  // Ctrl+wheel and touchpad pinch zoom around the pointer. A touchpad sends
  // many small steps, a mouse wheel about 100 per notch, so the zoom follows
  // the size of each step. The listener is not passive: React's onWheel is,
  // and then the browser would zoom the whole window as well.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomAnchor = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const old = zoomRef.current;
      const next = Math.max(0.2, Math.min(5, Math.round(old * Math.exp(-step * 0.002) * 100) / 100));
      if (next === old) return;
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      // Point under the pointer in unzoomed document pixels.
      zoomAnchor.current = { x: (el.scrollLeft + cx) / old, y: (el.scrollTop + cy - 24) / old, cx, cy };
      zoomRef.current = next;
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editor]);
  // Keep that point under the pointer once the new zoom is laid out.
  useLayoutEffect(() => {
    const el = canvas.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    zoomAnchor.current = null;
    el.scrollTop = a.y * zoom + 24 - a.cy;
    if (el.scrollWidth > el.clientWidth) el.scrollLeft = a.x * zoom - a.cx;
  }, [zoom]);

  // Hyphenation and the browser's own text handling follow the document
  // language; an empty transaction lets the hyphenation re-check its settings.
  useEffect(() => {
    try {
      if (editor && !editor.isDestroyed) {
        editor.view.dom.setAttribute("lang", spellLang);
        editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
      }
    } catch {
      /* view not mounted yet */
    }
  }, [editor, spellLang, docLayout.hyphenation]);
  if (!editor) return null;

  // Pages on screen: frame (size, margins), top and left edge of each sheet.
  const setups = sectionSetups();
  const pW = paperWidth(setups, docLayout);
  const sheetsOf = () => {
    const out: { f: PageFrame; top: number; x: number }[] = [];
    let y = 0;
    const add = (section: number) => {
      const f = frameOf(setups[Math.min(section, setups.length - 1)], docLayout, out.length + 1);
      out.push({ f, top: y, x: (pW - f.width) / 2 });
      y += f.height + GAP;
    };
    for (let i = 0; i < Math.max(1, layout.pages); i++) add(layout.sections[i] ?? layout.sections[layout.sections.length - 1] ?? 0);
    // Footnotes are listed after the text and may need more sheets. What
    // reaches into the last bottom margin (the spacing after the last
    // paragraph) needs none.
    const textEnd = out[0].f.marginTop + contentHeight;
    for (let guard = 0; guard < 200; guard++) {
      const last = out[out.length - 1];
      if (last.top + last.f.height - last.f.marginBottom >= textEnd - 0.5) break;
      add(layout.sections[layout.sections.length - 1] ?? 0);
    }
    return out;
  };
  const sheetList = sheetsOf();
  const firstSheet = sheetList[0];
  const lastSheet = sheetList[sheetList.length - 1];
  const paperHeight = lastSheet.top + lastSheet.f.height;
  const mt = firstSheet.f.marginTop;
  const mb = lastSheet.f.marginBottom;
  /** Padding that puts content into the text area of a sheet. */
  const inset = (sh: (typeof sheetList)[number]) => ({ left: sh.x + sh.f.marginLeft, right: pW - sh.x - sh.f.width + sh.f.marginRight });
  const firstInset = inset(firstSheet);
  screenRef.current = {
    zoom,
    plain: !outline && !readMode,
    imposition: docLayout.bookFold ? "bookFold" : docLayout.twoOnOne ? "twoOnOne" : "single",
    bookletSheets: docLayout.bookFoldSheets,
    pages: sheetList.map((sh, i) => {
      const sp = setups[Math.min(layout.sections[i] ?? layout.sections[layout.sections.length - 1] ?? 0, setups.length - 1)];
      return { top: sh.top, x: sh.x, width: sh.f.width, height: sh.f.height, sheetMm: { width: sp.widthMm, height: sp.heightMm } };
    }),
  };
  const lastInset = inset(lastSheet);
  const hfAll = { header, footer, first, even };
  const firstHeader = hfDom(hfFor(hfOfSection(hfAll, setups, layout.sections[0] ?? 0), 1, "header", titlePage(layout.sections[0] ?? 0)), 1, layout.pages)?.innerHTML;
  const lastPlace = pagePlace(layout.sections.map((section) => ({ section })), layout.pages);
  const lastFooter = hfDom(hfFor(hfOfSection(hfAll, setups, lastPlace.section), layout.pages, "footer", lastPlace.first && titlePage(lastPlace.section)), layout.pages, layout.pages)?.innerHTML;
  const showComments = comments.length > 0;
  const para = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  const paraValues: ParagraphValues = {
    indent: Number(para.indent) || 0,
    firstLine: Number(para.firstLine) || 0,
    spaceBefore: para.spaceBefore ?? 0,
    spaceAfter: para.spaceAfter ?? 8,
    lineHeight: parseFloat(para.lineHeight) || 1.15,
  };
  const docStyle = {
    "--nx-doc-font": meta.font ? `"${meta.font}", Calibri, Carlito, sans-serif` : undefined,
    "--nx-doc-size": meta.size ? `${meta.size}pt` : undefined,
  } as React.CSSProperties;

  /** Context menu of the document text. */
  editorMenuRef.current = (e: MouseEvent) => {
    if (!editor) return;
    const run = () => editor.chain().focus();
    const hasSel = !editor.state.selection.empty;
    const inTable = editor.isActive("table");
    const inLink = editor.isActive("link");
    openContextMenu(e, [
      { label: tl("Ausschneiden"), shortcut: key("X"), disabled: !hasSel, onClick: () => (editor.commands.focus(), document.execCommand("cut")) },
      { label: tl("Kopieren"), shortcut: key("C"), disabled: !hasSel, onClick: () => (editor.commands.focus(), document.execCommand("copy")) },
      {
        label: tlc("paste", "Einfügen"),
        shortcut: key("V"),
        onClick: () =>
          void readClipboardHtml().then(async (html) => {
            editor.commands.focus();
            if (html) editor.view.pasteHTML(html);
            else {
              const text = await readClipboardText();
              if (text) editor.view.pasteText(text);
            }
          }),
      },
      { label: tl("Nur Text einfügen"), onClick: () => void readClipboardText().then((t) => (editor.commands.focus(), t && editor.view.pasteText(t))) },
      "divider",
      inLink
        ? { label: tl("Link bearbeiten"), onClick: () => setDialog("link") }
        : { label: tl("Link einfügen"), shortcut: key("K"), onClick: () => setDialog("link") },
      inLink && { label: tl("Link entfernen"), onClick: () => run().extendMarkRange("link").unsetLink().run() },
      { label: tl("Neuer Kommentar"), disabled: !hasSel, onClick: () => commentAction("new") },
      inTable && {
        label: tl("Tabelle"),
        items: [
          { label: tl("Zeile oberhalb einfügen"), onClick: () => run().addRowBefore().run() },
          { label: tl("Zeile unterhalb einfügen"), onClick: () => run().addRowAfter().run() },
          { label: tl("Spalte links einfügen"), onClick: () => run().addColumnBefore().run() },
          { label: tl("Spalte rechts einfügen"), onClick: () => run().addColumnAfter().run() },
          "divider",
          { label: tl("Zellen verbinden"), disabled: !editor.can().mergeCells(), onClick: () => run().mergeCells().run() },
          { label: tl("Zellen teilen"), disabled: !editor.can().splitCell(), onClick: () => run().splitCell().run() },
          "divider",
          { label: tl("Zeile löschen"), onClick: () => run().deleteRow().run() },
          { label: tl("Spalte löschen"), onClick: () => run().deleteColumn().run() },
          { label: tl("Tabelle löschen"), onClick: () => run().deleteTable().run() },
        ],
      },
      "divider",
      { label: tl("Absatzoptionen…"), onClick: () => setDialog("paragraph") },
      { label: tl("Alles auswählen"), shortcut: key("A"), onClick: () => run().selectAll().run() },
    ]);
  };

  /** A click on the page outside the text (below the last line, in the
   * margins) puts the cursor on the nearest line. */
  const placeCaret = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest(".ProseMirror, .nx-hf-fixed, .nx-footnotes, button, a, input, textarea, [contenteditable]")) return;
    const dom = editor.view.dom as HTMLElement;
    const r = dom.getBoundingClientRect();
    const left = Math.min(Math.max(e.clientX, r.left + 1), r.right - 1);
    const top = Math.min(Math.max(e.clientY, r.top + 1), r.bottom - 1);
    const hit = editor.view.posAtCoords({ left, top });
    e.preventDefault();
    if (hit) editor.chain().focus().setTextSelection(hit.pos).run();
    else editor.commands.focus(e.clientY < r.top ? "start" : "end");
  };

  // ------------------------------------------------------------ tools --

  // Editing restriction and reading mode.
  const locked = !!protection && protection.edit !== "trackedChanges";
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const ready = () => setMounted(true);
    if (editor.isInitialized) ready();
    editor.on("create", ready);
    return () => void editor.off("create", ready);
  }, [editor]);
  useEffect(() => {
    if (!editor || !mounted) return;
    editor.setEditable(!readMode && !locked, false);
    if (protection?.edit === "trackedChanges" && !isTracking(editor)) setTracking(editor, true);
  }, [editor, mounted, readMode, locked, protection]);

  useEffect(() => {
    if (!readMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setReadMode(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readMode]);

  // Double-click on formulas and shapes.
  useEffect(() => {
    const dom = paper.current;
    if (!editor || !dom) return;
    const onMath = (e: Event) => {
      const d = (e as CustomEvent<{ pos: number; latex: string; display: boolean }>).detail;
      if (editor.isEditable) setMathEdit({ pos: d.pos, latex: d.latex, display: d.display });
    };
    const onShape = (e: Event) => {
      const d = (e as CustomEvent<{ pos: number; attrs: ShapeAttrs }>).detail;
      if (editor.isEditable) setShapeEdit({ pos: d.pos, attrs: d.attrs });
    };
    dom.addEventListener("ondura-edit-math", onMath);
    dom.addEventListener("ondura-edit-shape", onShape);
    return () => {
      dom.removeEventListener("ondura-edit-math", onMath);
      dom.removeEventListener("ondura-edit-shape", onShape);
    };
  }, [editor]);

  useEffect(() => () => stopReading(), []);

  /** Überprüfen › Kombinieren: the other version's revisions as tracked changes in this document. */
  const combine = async () => {
    if (!editor) return;
    if (!isTauri) return notify(tl("Kombinieren"), tl("Im Browser-Vorschaumodus nicht verfügbar."), "info");
    const p = await pickOpenPath("text");
    if (!p) return;
    try {
      const { loaded } = await openProtected<Loaded>("text_open", p);
      const other = loaded.document;
      const merged = combineDocuments(currentDocument(), other, other.author?.trim() || baseName(p));
      const node = editor.schema.nodeFromJSON(documentToPm({ ...currentDocument(), blocks: merged.blocks }));
      // One undoable step that the change tracking must not record again.
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content).setMeta(trackKey, true));
      setComments(merged.comments);
      notify(tl("Kombinieren"), tl("Die Überarbeitungen aus „{0}“ wurden als Änderungen übernommen.", baseName(p)), "success");
    } catch (e) {
      notify(tl("Kombinieren fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const compare = async () => {
    if (!isTauri) return notify(tl("Vergleichen"), tl("Im Browser-Vorschaumodus nicht verfügbar."), "info");
    const p = await pickOpenPath("text");
    if (!p) return;
    try {
      const { loaded } = await openProtected<Loaded>("text_open", p);
      await openInNewWindow(compareDocuments(loaded.document, currentDocument(), author));
      notify(tl("Vergleichen"), tl("Das Ergebnis mit den Unterschieden zu „{0}“ als Änderungen wurde in einem neuen Fenster geöffnet.", baseName(p)), "success");
    } catch (e) {
      notify(tl("Vergleichen fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  /** Breaks and the setup of every section (the last one is the document page). */
  const sectionsOf = () => {
    const breaks = editor ? sectionBreaks(editor.state.doc) : [];
    return { breaks, setups: [...breaks.map((b) => b.page ?? page), page] };
  };
  /** Document page options for the dialog, with "different first page" as
   *  it applies to the section with setup `p`. */
  const pageOptions = (p: PageSetup): DocumentPageOptions => ({ mirrorMargins: docLayout.mirrorMargins, twoOnOne: docLayout.twoOnOne, bookFold: docLayout.bookFold, bookFoldSheets: docLayout.bookFoldSheets, gutterAtTop: docLayout.gutterAtTop, differentFirst: p.titlePage ?? first.enabled, differentOddEven: even.enabled });
  /** Changes the setup of section `index` (a section break's or the last). */
  const setSectionSetup = (index: number, patch: Partial<PageSetup>) => {
    if (!editor) return;
    const breaks = sectionBreaks(editor.state.doc);
    if (index < breaks.length) {
      const b = breaks[index];
      editor.view.dispatch(editor.state.tr.setNodeMarkup(b.pos, undefined, { ...editor.state.doc.nodeAt(b.pos)?.attrs, page: { ...(b.page ?? page), ...patch } }));
      // Headers are drawn by the pagination: draw them again.
      refreshPagination(editor.view);
    } else setPage((p) => ({ ...p, ...patch }));
  };
  /** Index and setup of the section with the cursor. */
  const cursorSection = () => {
    const { breaks, setups } = sectionsOf();
    const at = editor?.state.selection.from ?? 0;
    const index = breaks.filter((b) => b.pos < at).length;
    return { index, page: setups[index] ?? page, start: index > 0 ? breaks[index - 1].next : null };
  };
  const openPageSetup = (tab?: "margins" | "paper" | "layout") => setSectionEdit({ index: cursorSection().index, tab });
  /** Ribbon changes (margins, orientation, size, line numbers) apply to the
   *  section with the cursor, as in Word. */
  const changeSectionPage = (f: (p: PageSetup) => PageSetup) => {
    const c = cursorSection();
    applyPageSetup(c.index, { page: f(c.page), options: pageOptions(c.page), scope: sectionsOf().setups.length > 1 ? "section" : "all", start: c.start });
  };
  /** Section break before the paragraph with the cursor; the section that
   *  ends there keeps its setup. */
  const insertSectionBreak = (next: SectionStart | null) => {
    if (!editor) return;
    const { breaks, setups } = sectionsOf();
    const at = editor.state.selection.from;
    const own = setups[breaks.filter((b) => b.pos < at).length] ?? page;
    editor.chain().focus().setSectionBreak(pageOnly(own), next).run();
  };
  const applyPageSetup = (index: number, r: PageSetupResult) => {
    if (!editor) return;
    // "Different first page": for the whole document it is the document's
    // setting; for sections it is kept on their setup where it differs.
    const ownFirst = r.scope === "all" ? null : r.options.differentFirst === first.enabled ? null : r.options.differentFirst;
    const p = { ...pageOnly(r.page), titlePage: ownFirst };
    setDocLayout((d) => ({ ...d, mirrorMargins: r.options.mirrorMargins, twoOnOne: r.options.twoOnOne, bookFold: r.options.bookFold, bookFoldSheets: r.options.bookFoldSheets, gutterAtTop: r.options.mirrorMargins || r.options.bookFold ? false : r.options.gutterAtTop }));
    if (r.scope === "all") setFirst((f) => ({ ...f, enabled: r.options.differentFirst }));
    setEven((e) => ({ ...e, enabled: r.options.differentOddEven }));
    const state = editor.state;
    const breaks = sectionBreaks(state.doc);
    const tr = state.tr;
    const set = (pos: number, attrs: Record<string, unknown>) => {
      const m = tr.mapping.map(pos);
      tr.setNodeMarkup(m, undefined, { ...tr.doc.nodeAt(m)?.attrs, ...attrs });
    };
    if (r.scope === "forward") {
      // A new section starts at the paragraph with the cursor; it and all
      // sections after it get the new setup.
      const $from = state.selection.$from;
      const before = $from.depth > 0 ? $from.before(1) : $from.pos;
      const old = breaks[index]?.page ?? page;
      for (const b of breaks) if (b.pos >= before) set(b.pos, { page: keepHeaders(p, b.page) });
      tr.insert(tr.mapping.map(before), state.schema.nodes.sectionBreak.create({ page: old, next: r.start }));
      setPage(keepHeaders(p, page));
    } else {
      if (index > 0 && breaks[index - 1]) set(breaks[index - 1].pos, { next: r.start });
      if (r.scope === "all") {
        for (const b of breaks) set(b.pos, { page: keepHeaders(p, b.page) });
        setPage(keepHeaders(p, page));
      } else if (index < breaks.length) set(breaks[index].pos, { page: keepHeaders(p, breaks[index].page) });
      else setPage(keepHeaders(p, page));
    }
    if (tr.docChanged) {
      editor.view.dispatch(tr);
      refreshPagination(editor.view);
    }
    setDirty(true);
  };
  /** Inserts a picture (data URL) at the cursor, at most `maxW` px wide. */
  const insertPicture = async (src: string, maxW = 480) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, maxW / img.naturalWidth);
    editor?.chain().focus().setImage({ src, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) }).run();
  };

  /** Inserts the body of another document (Einfügen > Objekt > Text aus Datei). */
  const insertFromFile = async () => {
    if (!editor) return;
    if (!isTauri) return textFileInput.current?.click();
    const p = await pickOpenPath("text");
    if (!p) return;
    try {
      const { loaded } = await openProtected<Loaded>("text_open", p);
      const content = documentToPm(loaded.document).content ?? [];
      editor.chain().focus().insertContent(content).run();
    } catch (e) {
      notify(tl("Text aus Datei"), errorMessage(e), "error");
    }
  };

  /** Design presets: theme fonts, colours and paragraph spacing. */
  const applyDesign = (kind: "fonts" | "colors" | "spacing", i: number) => {
    if (!editor) return;
    const heads = ["title", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6"];
    if (kind === "fonts") {
      const f = THEME_FONTS[i];
      setMeta((m) => ({ ...m, font: f.body }));
      setStyleDefs((x) => heads.reduce((acc, id) => setStyleDef(acc, { ...effective(acc, id), id, font: f.heading }), x));
    } else if (kind === "colors") {
      const c = THEME_COLORS[i];
      setStyleDefs((x) => heads.reduce((acc, id, k) => setStyleDef(acc, { ...effective(acc, id), id, color: k <= 2 ? c.heading : c.accent }), x));
    } else {
      const sp = THEME_SPACING[i];
      setStyleDefs((x) => setStyleDef(x, { ...effective(x, "normal"), id: "normal", font: null, size: null, spaceBefore: sp.before, spaceAfter: sp.after }));
      const tr = editor.state.tr;
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === "paragraph") tr.setNodeMarkup(pos, undefined, { ...n.attrs, lineHeight: sp.line === 1 ? null : String(sp.line) });
        return !n.isTextblock;
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    }
    setDirty(true);
  };

  /** Further commands of the ribbon (Word parity). */
  const extraAction = async (a: string) => {
    if (!editor) return;
    const i = a.indexOf(":");
    const cmd = i < 0 ? a : a.slice(0, i);
    const arg = i < 0 ? "" : a.slice(i + 1);
    switch (cmd) {
      case "painter":
        return setPainter((p) => (p ? null : copyFormat(editor)));
      case "marks":
        return setShowMarks((v) => !v);
      case "cover":
        return insertCoverPage(editor, arg as "simple" | "band" | "centered", meta.title, meta.author || author);
      case "blankPage":
        return insertBlankPage(editor);
      case "icons":
        return setInsertDialog("icons");
      case "chart":
        return setChartEdit(sampleChart("column"));
      case "screenshot":
        try {
          const shot = await captureScreen();
          if (!shot) return notify(tl("Screenshot"), tl("Bildschirmaufnahmen werden hier nicht unterstützt."), "info");
          return insertPicture(shot.src, 600);
        } catch {
          return;
        }
      case "bookmark":
      case "signature":
      case "quickPartSave":
      case "datetime":
        return setInsertDialog(cmd);
      case "wordart":
        setPending(arg);
        return setInsertDialog("wordart");
      case "quickPartRemove":
        return void removeQuickPart(arg).then(setParts);
      case "quickPart": {
        const part = parts.find((x) => x.name === arg);
        if (part) editor.chain().focus().insertContent(part.content as never).run();
        return;
      }
      case "insertFile":
        return insertFromFile();
      case "nextNote": {
        const from = editor.state.selection.to;
        let target: number | null = null;
        let firstPos: number | null = null;
        editor.state.doc.descendants((n, pos) => {
          if (n.type.name !== "footnote") return;
          if (firstPos === null) firstPos = pos;
          if (target === null && pos >= from) target = pos;
        });
        const go = target ?? firstPos;
        if (go === null) return notify(tl("Nächste Fußnote"), tl("Das Dokument enthält keine Fuß- oder Endnoten."), "info");
        editor.chain().focus().setTextSelection((go as number) + 1).scrollIntoView().run();
        return;
      }
      case "showNotes": {
        const notes = paper.current?.querySelector(".nx-page-notes, .nx-endnotes, .nx-footnotes");
        if (notes) notes.scrollIntoView({ behavior: "smooth", block: "center" });
        else notify(tl("Notizen anzeigen"), tl("Das Dokument enthält keine Fuß- oder Endnoten."), "info");
        return;
      }
      case "markup":
        return setMarkup(arg as typeof markup);
      case "combine":
        return combine();
      case "view":
        setReadMode(false);
        setViewMode(arg as typeof viewMode);
        requestAnimationFrame(() => refreshPagination(editor.view));
        return;
      case "navPane":
        return setNavPane((v) => !v);
      case "gridlines":
        return setGridlines((v) => !v);
      case "focus":
        if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
        return void document.documentElement.requestFullscreen?.().catch(() => {});
      case "fonts":
      case "colors":
      case "spacing":
        return applyDesign(cmd, Number(arg));
      case "designDefault":
        try {
          localStorage.setItem(DESIGN_KEY, JSON.stringify({ styles: styleDefs, defaultFont: meta.font, defaultSize: meta.size }));
          notify(tl("Als Standard festlegen"), tl("Neue Dokumente verwenden diese Formatierung."), "success");
        } catch {
          /* no storage */
        }
        return;
    }
  };

  const toolAction = async (a: TextTool) => {
    if (!editor) return;
    switch (a) {
      case "math":
        return setMathEdit({ pos: null, latex: "", display: false });
      case "textBox":
        return setShapeEdit({ pos: null, attrs: { kind: "textBox", widthMm: 60, heightMm: 30, fill: "#ffffff", line: "#000000", text: "", wrap: "right" } });
      case "pageColor":
        return setDesignDialog("color");
      case "pageBorder":
        return setDesignDialog("border");
      case "watermark":
        return setDesignDialog("watermark");
      case "protect":
      case "envelope":
      case "labels":
      case "grammar":
      case "translate":
        return setToolDialog(a);
      case "compare":
        return compare();
      case "outline":
        return setOutline((v) => !v);
      case "reading":
        return setReadMode((v) => !v);
      case "readAloud": {
        if (speaking) {
          stopReading();
          return setSpeaking(false);
        }
        const t = textToRead(editor);
        if (!t.trim()) return;
        setSpeaking(true);
        try {
          await readAloud(t, spellLang);
        } catch (e) {
          notify(tl("Laut vorlesen"), errorMessage(e), "error");
        } finally {
          setSpeaking(false);
        }
        return;
      }
      case "dictate": {
        if (dictation) {
          dictation();
          return setDictation(null);
        }
        const r = await startDictation(editor, spellLang, () => setDictation(null));
        if (r === null) notify(tl("Diktieren"), tl("Auf diesem System ist keine Spracherkennung verfügbar."), "info");
        else if (r === "system") notify(tl("Diktieren"), tl("Die Spracheingabe von Windows wurde geöffnet. Sprechen Sie, der Text erscheint an der Cursorposition."), "info");
        else setDictation(() => r);
        return;
      }
    }
  };

  const deco = sheetDecoration(design);
  /** Web and draft view: no pages, the text wraps at the window width. */
  const flow = viewMode !== "print";

  return (
    <div className={readMode ? `${s.root} nx-reading` : s.root}>
      <SuiteHeader appName={tlc("app", "Text")} logo="/text.svg" center={<DocumentTitle name={withoutExt(name)} dirty={dirty} path={path} autoSave={autoSave} />} />
      <RecoveryBar<TextDocument> app="text" canRestore={!dirty && !path} onRestore={restore} />
      {readMode ? (
        <div className="nx-reading-bar">
          <Text weight="semibold">{tl("Lesemodus")}</Text>
          <Button size="small" onClick={() => setReadMode(false)}>{tl("Lesemodus beenden (Esc)")}</Button>
        </div>
      ) : (
        <TextRibbon
          onTool={(a) => void toolAction(a)}
          onExtra={(a) => void extraAction(a)}
          painter={!!painter}
          showMarks={showMarks}
          viewMode={viewMode}
          markup={markup}
          navPane={navPane}
          gridlines={gridlines}
          quickParts={parts}
          speaking={speaking}
          readMode={readMode}
          dictating={!!dictation}
          outline={outline}
          restricted={!!protection}
          editor={editor}
          color={COLOR}
          page={page}
          zoom={zoom}
          onFile={() => setBackstage("open")}
          onLink={() => setDialog("link")}
          onImage={() => imageInput.current?.click()}
          onPageSetup={() => openPageSetup()}
          onPageChange={(p) => changeSectionPage(() => p)}
          onColumnsMore={() => {
            const $from = editor.state.selection.$from;
            let cols = { count: 2, gap: 12.5, line: false };
            for (let d = $from.depth; d > 0; d--) {
              const n = $from.node(d);
              if (n.type.name === "columns") cols = { count: n.attrs.count, gap: n.attrs.gap, line: !!n.attrs.line };
            }
            setColumnsEdit(cols);
          }}
          lineNumbers={cursorSection().page.lineNumbers ?? null}
          onLineNumbers={(m) => {
            if (m === "options") return openPageSetup("layout");
            if (m === "suppress")
              return void editor
                .chain()
                .focus()
                .setParagraphSpacing({ suppressLn: editor.getAttributes("paragraph").suppressLn ? null : true })
                .run();
            changeSectionPage((p) => ({ ...p, lineNumbers: m === "none" ? null : { countBy: 1, start: 1, distanceMm: null, ...(p.lineNumbers ?? {}), restart: m } }));
          }}
          hyphenation={docLayout.hyphenation}
          onHyphenation={(on) => (setDocLayout((d) => ({ ...d, hyphenation: on })), setDirty(true))}
          onHeaderFooter={() => setDialog("hf")}
          onParagraph={() => setDialog("paragraph")}
          onFind={(replace) => setFind({ replace })}
          onZoom={fitZoom}
          onToc={tocAction}
          onFootnote={(endnote) => setFootnoteEdit({ pos: null, text: "", endnote })}
          onSectionBreak={(next) => insertSectionBreak(next ?? null)}
          onComment={commentAction}
          onTrack={trackAction}
          onUserName={() => setDialog("name")}
          hasComments={comments.length > 0}
          onRefs={refAction}
          onInsertField={(f) => editor && insertField(editor, f)}
          merge={merge ? { columns: merge.data.columns, preview: mergePreview, highlight: mergeHighlight, index: Math.min(mergeIndex, Math.max(0, activeRows(merge).length - 1)), count: activeRows(merge).length } : null}
          onMerge={(a) => void mergeAction(a)}
          onStyleEdit={(id, action) => {
            if (action === "modify") return setStyleEdit(id);
            applyStyle(styleFromSelection(editor, id, styleDefs));
          }}
          styleCss={galleryCss}
          onControl={(a) => {
            if (a === "properties") setControlProps(selectedControl(editor));
            else (insertControl(editor, a), setDirty(true));
          }}
          spellAuto={spellAuto}
          spellLang={spellLang}
          onSpelling={() => setSpelling(true)}
          onSpellAuto={() => {
            const on = !spellAuto;
            setSpellAuto(on);
            localStorage.setItem("ondura.spell.auto", on ? "1" : "0");
            editor.storage.spellCheck.enabled = on;
            refreshSpelling(editor);
          }}
          onSpellLang={(l) => {
            spell.setLang(l);
            setSpellLang(l);
            refreshSpelling(editor);
          }}
          a11yOpen={a11yOpen}
          onMacros={() => setMacrosOpen(true)}
          onA11y={() => setA11yOpen((v) => !v)}
          onWordCount={() => {
            const t = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
            const words = (t.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []).length;
            const paras = editor.state.doc.content.childCount;
            notify(tl("Wörter zählen"), tl("{0} Wörter · {1} Zeichen ohne Leerzeichen · {2} mit Leerzeichen · {3} Absätze · {4} Seiten", words.toLocaleString(LOCALE), t.replace(/\s/g, "").length.toLocaleString(LOCALE), t.length.toLocaleString(LOCALE), paras, layout.pages));
          }}
        />
      )}
      {protection && !readMode && (
        <div className="nx-protect-bar">
          <Text size={200}>{tl("Bearbeitung eingeschränkt: {0}", PROTECTION_LABEL[protection.edit])}</Text>
          <Button size="small" appearance="subtle" onClick={() => setToolDialog("protect")}>{tl("Schutz aufheben…")}</Button>
        </div>
      )}
      <div className={s.work}>
        {find && editor && <FindBar editor={editor} replace={find.replace} onClose={() => (setFind(null), setSearch(editor, "", false), editor.commands.focus())} />}
        {loading && (
          <div className={s.loading}>
            <Spinner label={tl("Dokument wird geöffnet…")} />
          </div>
        )}
        {navPane && <NavigationPane editor={editor} onClose={() => setNavPane(false)} />}
        <div className={`nx-canvas${viewMode !== "print" ? ` nx-view-flow nx-view-${viewMode}` : ""}${navPane ? " nx-with-nav" : ""}`} ref={canvas} {...imageDrop.props} onMouseDown={(e) => e.target === canvas.current && editor.commands.focus("end")}>
          <div style={flow ? { margin: "16px 24px", paddingBottom: 24 } : { width: ((paperSize.w || pW) + (showComments ? PANE_W : 0)) * zoom, height: (paperSize.h || paperHeight) * zoom, margin: "24px auto", paddingBottom: 24 }}>
            <div className="nx-zoom" style={flow ? { zoom, display: "flex", alignItems: "flex-start" } : { transform: `scale(${zoom})`, width: pW + (showComments ? PANE_W : 0), display: "flex", alignItems: "flex-start" }}>
              <div
                ref={paper}
                className={`nx-paper${mergeHighlight ? " nx-merge-highlight" : ""}${outline ? " nx-outline" : ""}${docLayout.hyphenation ? " nx-hyphenate" : ""}${showMarks ? " nx-show-marks" : ""}${gridlines ? " nx-gridlines" : ""}${markup !== "all" ? ` nx-markup-${markup}` : ""}${painter ? " nx-painter" : ""}`}
                onMouseDown={(e) => placeCaret(e)}
                onMouseUp={() => {
                  const f = painterRef.current;
                  if (!f) return;
                  // Format painter: applies to the selection made with the mouse.
                  requestAnimationFrame(() => {
                    if (!editor.state.selection.empty) pasteFormat(editor, f);
                    setPainter(null);
                  });
                }}
                onDoubleClick={(e) => {
                  // A footnote at the bottom of a page: edit it.
                  const n = Number((e.target as HTMLElement).closest<HTMLElement>("[data-note]")?.dataset.note);
                  if (!n) return;
                  let i = 0;
                  editor.state.doc.descendants((node, pos) => {
                    if (node.type.name === "footnote" && !node.attrs.endnote && ++i === n) setFootnoteEdit({ pos, text: node.attrs.text ?? "", endnote: false });
                  });
                }}
                style={(flow ? { ...docStyle, "--nx-fl": `${FLOW_INSET}px`, "--nx-fr": `${FLOW_INSET}px`, flex: 1, minWidth: 0, minHeight: 400, padding: "32px 0" } : { ...docStyle, "--nx-fl": `${lastInset.left}px`, "--nx-fr": `${lastInset.right}px`, width: pW, flexShrink: 0, minHeight: paperHeight, padding: `${mt}px 0 ${mb}px 0` }) as unknown as React.CSSProperties}
              >
                {sheetList.map((sh, i) => (
                  <div key={i} className="nx-sheet" style={{ top: sh.top, left: sh.x, width: sh.f.width, height: sh.f.height, ...deco.style }}>
                    {deco.watermark}
                  </div>
                ))}
                {firstHeader && <div className="nx-hf-fixed" style={{ top: 0, height: mt, padding: `${firstSheet.f.headerDist}px ${firstInset.right}px 0 ${firstInset.left}px` }} dangerouslySetInnerHTML={{ __html: firstHeader }} />}
                <EditorContent editor={editor} className="tiptap-wrap" style={(flow ? { "--nx-l": `${FLOW_INSET}px`, "--nx-r": `${FLOW_INSET}px` } : { "--nx-l": `${firstInset.left}px`, "--nx-r": `${firstInset.right}px`, minHeight: Math.max(0, (layout.minHeight || firstSheet.f.height - mt - firstSheet.f.marginBottom) - notesHeight) }) as unknown as React.CSSProperties} />
                {!flow && <LineNumberLayer editor={editor} paper={paper} zoom={zoom} setups={setups} layoutKey={layout} />}
                <FootnoteList editor={editor} all={flow} />
                {lastFooter && (
                  <div className="nx-hf-fixed" style={{ top: lastSheet.top + lastSheet.f.height - mb, height: mb, justifyContent: "flex-end", padding: `0 ${lastInset.right}px ${lastSheet.f.footerDist}px ${lastInset.left}px` }} dangerouslySetInnerHTML={{ __html: lastFooter }} />
                )}
              </div>
              {showComments && (
                <CommentsPane
                  editor={editor}
                  paper={paper}
                  zoom={zoom}
                  comments={comments}
                  focus={focusComment}
                  onFocused={() => setFocusComment(null)}
                  onChange={(id, text) => (setComments((c) => c.map((x) => (x.id === id ? { ...x, text } : x))), setDirty(true))}
                  onDelete={deleteComment}
                  author={author}
                  onReply={(parent) => {
                    const id = Math.max(0, ...comments.map((c) => c.id)) + 1;
                    setComments((c) => [...c, { id, parent, author, date: new Date().toISOString(), text: "" }]);
                    setFocusComment(id);
                    setDirty(true);
                  }}
                  onDone={(id, done) => (setComments((c) => c.map((x) => (x.id === id ? { ...x, done } : x))), setDirty(true))}
                />
              )}
            </div>
          </div>
        </div>
        {a11yOpen && <AccessibilityPane issues={a11yIssues} onClose={() => setA11yOpen(false)} onRefresh={runA11y} />}
      </div>
      <DateTimeDialog open={insertDialog === "datetime"} onClose={() => setInsertDialog(null)} onInsert={(t) => (editor.chain().focus().insertContent(t).run(), setInsertDialog(null))} />
      <IconsDialog
        open={insertDialog === "icons"}
        color="#2f5597"
        onClose={() => setInsertDialog(null)}
        onInsert={(names, color) => {
          setInsertDialog(null);
          void (async () => {
            for (const n of names) {
              const src = await iconPng(n, color, 256);
              if (src) editor.chain().focus().setImage({ src, width: 96, height: 96 }).run();
            }
          })();
        }}
      />
      {chartEdit && <ChartDataDialog chart={chartEdit} onClose={() => setChartEdit(null)} onApply={(c) => (setChartEdit(null), void chartPng(c).then((src) => insertPicture(src, 520)))} />}
      {insertDialog === "bookmark" && (
        <FieldsDialog
          open
          title={tl("Textmarke")}
          fields={[{ label: tl("Name der Textmarke"), initial: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").replace(/\W+/g, "_").slice(0, 40) }]}
          onClose={() => setInsertDialog(null)}
          onApply={([name]) => {
            setInsertDialog(null);
            const n = name.trim().replace(/\s+/g, "_");
            if (!n) return;
            const { from, to } = editor.state.selection;
            editor
              .chain()
              .focus()
              .insertContentAt(to, { type: "bookmark", attrs: { name: n, end: true } })
              .insertContentAt(from, { type: "bookmark", attrs: { name: n, end: false } })
              .run();
          }}
        />
      )}
      {insertDialog === "signature" && (
        <FieldsDialog
          open
          title={tl("Signaturzeile")}
          fields={[{ label: tl("Vorgeschlagener Unterzeichner"), initial: author }, { label: tl("Titel des Unterzeichners") }]}
          onClose={() => setInsertDialog(null)}
          onApply={([n, t]) => (setInsertDialog(null), insertSignatureLine(editor, n, t))}
        />
      )}
      {insertDialog === "wordart" && (
        <FieldsDialog
          open
          title={tl("WordArt")}
          fields={[{ label: tl("Text"), initial: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ") || tl("Hier steht Ihr Text") }]}
          onClose={() => setInsertDialog(null)}
          onApply={([t]) => (setInsertDialog(null), t.trim() && insertWordArt(editor, t, Number(pending)))}
        />
      )}
      {insertDialog === "quickPartSave" && (
        <FieldsDialog
          open
          title={tl("Neuen Baustein erstellen")}
          fields={[{ label: tl("Name") }]}
          onClose={() => setInsertDialog(null)}
          onApply={([n]) => {
            setInsertDialog(null);
            if (!n.trim()) return;
            void saveQuickPart(editor, n.trim())
              .then((list) => (list ? setParts(list) : notify(tl("Schnellbausteine"), tl("Markieren Sie zuerst den Text, der als Baustein gespeichert werden soll."), "info")))
              .catch((e) => notify(tl("Schnellbausteine"), errorMessage(e), "error"));
          }}
        />
      )}
      <input
        ref={textFileInput}
        type="file"
        accept=".txt,.md,.html,.htm"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void file.text().then((t) => {
            if (/\.html?$/i.test(file.name)) editor.chain().focus().insertContent(t).run();
            else editor.chain().focus().insertContent(t.split(/\r?\n/).map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] }))).run();
          });
        }}
      />
      <MacroDialog
        open={macrosOpen}
        app="text"
        template={TEXT_MACRO_TEMPLATE}
        reference={TEXT_MACRO_REFERENCE}
        onRun={(code) => {
          if (!editor) return { log: [], error: tl("Kein Dokument") };
          const r = runTextMacro(editor, code);
          setDirty(true);
          return r;
        }}
        onClose={() => setMacrosOpen(false)}
      />
      <AltTextDialog
        open={!!altFor}
        initial={altFor?.alt ?? ""}
        onClose={() => setAltFor(null)}
        onSave={(alt) => {
          if (editor && altFor) {
            editor.chain().focus().setNodeSelection(altFor.pos).updateAttributes("image", { alt }).run();
            setDirty(true);
          }
          setAltFor(null);
          runA11y();
        }}
      />
      <StatusBar>
        <Button size="small" appearance="transparent" onClick={() => setA11yOpen(true)} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
          {a11yOpen ? (a11yIssues.length ? tl("Barrierefreiheit: {0} Hinweise", a11yIssues.length) : tl("Barrierefreiheit: Alles in Ordnung")) : tl("Barrierefreiheit: Untersuchen")}
        </Button>
        <span>
          {tl("Seite")} {Math.min(currentPage, layout.pages)} {tl("von")} {layout.pages}
        </span>
        <span>{words.toLocaleString(LOCALE)} {tl("Wörter")}</span>
        <span>{spellLang === "en" ? tl("Englisch (USA)") : spellLang === "fr" ? tl("Französisch (Frankreich)") : tl("Deutsch (Deutschland)")}</span>
        {warnings.length > 0 && (
          <Button size="small" appearance="transparent" onClick={() => setBackstage("info")} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
            {tl("⚠ Kompatibilitätshinweise")}
          </Button>
        )}
        <span className={s.zoom}>
          <Button size="small" appearance="transparent" style={{ minWidth: 20, padding: 0 }} onClick={() => fitZoom(Math.max(0.2, zoom - 0.1))}>
            −
          </Button>
          <Slider size="small" min={20} max={300} value={Math.round(zoom * 100)} onChange={(_, d) => setZoom(d.value / 100)} style={{ width: 120, minWidth: 0 }} />
          <Button size="small" appearance="transparent" style={{ minWidth: 20, padding: 0 }} onClick={() => fitZoom(Math.min(5, zoom + 0.1))}>
            +
          </Button>
          <Button size="small" appearance="transparent" style={{ minWidth: 44, padding: 0, fontSize: 12 }} onClick={() => fitZoom(1)}>
            {Math.round(zoom * 100)} %
          </Button>
        </span>
      </StatusBar>

      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImage(f);
          e.target.value = "";
        }}
      />

      {/* Recipient list in the browser preview (CSV only). */}
      <input
        ref={recipientInput}
        type="file"
        accept=".csv,.txt,text/csv"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) takeRecipients(parseCsv(await f.text(), f.name));
        }}
      />

      <StyleDialog
        open={styleEdit != null}
        styleId={styleEdit ?? "normal"}
        defs={styleDefs}
        docFont={meta.font ?? "Calibri"}
        docSize={meta.size ?? 11}
        onClose={() => setStyleEdit(null)}
        onApply={(d) => (applyStyle(d), setStyleEdit(null))}
        onReset={(id) => (setStyleDefs((x) => x.filter((d) => d.id !== id)), setDirty(true), setStyleEdit(null))}
      />
      <style>{styleCss(styleDefs)}</style>
      <ControlPropsDialog
        attrs={controlProps?.attrs ?? null}
        onClose={() => setControlProps(null)}
        onApply={(a) => {
          if (editor && controlProps) updateControl(editor, controlProps.pos, a);
          setControlProps(null);
          setDirty(true);
        }}
      />
      {merge && mergeDialog === "recipients" && (
        <RecipientsDialog
          state={merge}
          onClose={() => setMergeDialog(null)}
          onApply={(m) => {
            setMerge(m);
            setMergeIndex(0);
            setMergeDialog(null);
          }}
        />
      )}
      <NewListDialog open={mergeDialog === "new"} onClose={() => setMergeDialog(null)} onCreate={(d) => (takeRecipients(d), setMergeDialog(null))} />
      <SheetPickDialog sheets={sheetPick ? sheetPick.wb.sheets.map((x) => x.name) : null} onClose={() => setSheetPick(null)} onPick={(i) => (sheetPick && takeRecipients(sheetData(sheetPick.wb, i, `${sheetPick.name} › ${sheetPick.wb.sheets[i].name}`)), setSheetPick(null))} />

      {editor && (
        <>
          <CaptionDialog open={refDialog === "caption"} inTable={editor.isActive("table")} onClose={() => setRefDialog(null)} onInsert={(label, text, above) => (insertCaption(editor, label, text, above), setRefDialog(null), setDirty(true))} />
          <CrossRefDialog open={refDialog === "crossref"} targets={refDialog === "crossref" ? captionTargets(editor) : []} onClose={() => setRefDialog(null)} onInsert={(t) => (insertField(editor, `ref ${t.name}`), setRefDialog(null))} />
          <MarkEntryDialog
            open={refDialog === "mark"}
            initial={refDialog === "mark" ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").trim().slice(0, 80) : ""}
            onClose={() => setRefDialog(null)}
            onMark={(term) => {
              // The entry goes after the selection (as an XE field in .docx).
              editor.chain().focus().setTextSelection(editor.state.selection.to).insertContent({ type: "field", attrs: { field: `xe ${term}`, result: null } }).run();
              setRefDialog(null);
              notify(tl("Indexeintrag festgelegt"), term);
            }}
          />
          <SourcesDialog
            open={refDialog === "sources" || refDialog === "cite"}
            cite={refDialog === "cite"}
            sources={sources}
            onClose={() => setRefDialog(null)}
            onSave={(s) => (setSources(s), setDirty(true))}
            onCite={(tag) => (insertField(editor, `cite ${tag}`), setRefDialog(null))}
          />
        </>
      )}
      {editor && <SpellingDialog editor={editor} open={spelling} onClose={(done) => (setSpelling(false), done && notify(tl("Die Rechtschreibprüfung ist abgeschlossen.")), editor.commands.focus())} />}
      <Menu open={!!spellMenu} onOpenChange={(_, d) => !d.open && setSpellMenu(null)} positioning={{ target: spellMenu ? { getBoundingClientRect: () => ({ x: spellMenu.x, y: spellMenu.y, left: spellMenu.x, top: spellMenu.y, right: spellMenu.x, bottom: spellMenu.y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect } : undefined, position: "below", align: "start" }}>
        <MenuPopover>
          <MenuList>
            {spellMenu?.suggestions === null && <MenuItem disabled>{tl("Vorschläge werden gesucht …")}</MenuItem>}
            {spellMenu?.suggestions?.length === 0 && <MenuItem disabled>{tl("(Keine Vorschläge)")}</MenuItem>}
            {spellMenu?.suggestions?.slice(0, 6).map((s) => (
              <MenuItem key={s} style={{ fontWeight: 600 }} onClick={() => editor.chain().focus().insertContentAt({ from: spellMenu.from, to: spellMenu.to }, s).run()}>
                {s}
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={() => spellMenu && (spell.ignore(spellMenu.word), refreshSpelling(editor))}>{tl("Alle ignorieren")}</MenuItem>
            <MenuItem onClick={() => spellMenu && void spell.add(spellMenu.word).then(() => refreshSpelling(editor))}>{tl("Zum Wörterbuch hinzufügen")}</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {backstage && (
        <Backstage
          protection={{ password, onChange: (pw) => (setPassword(pw), setDirty(true)) }}
          app="text"
          color={COLOR}
          initialPage={backstage}
          onClose={() => setBackstage(null)}
          onNew={() => (setBackstage(null), setToolDialog("templates"))}
          templates={templateList}
          onTemplate={(id) => {
            // An untouched window takes the template itself.
            if (!path && !dirty) {
              const d = buildTextTemplate(id);
              if (d) apply(d);
              setBackstage(null);
            } else void openTemplateWindow("text", id);
          }}
          onOpenTemplateFile={async () => {
            const p = await pickOpenPath("text");
            if (p) await openDocumentWindow("text", p);
          }}
          onOpen={(p) => void open(p)}
          onSave={() => (setBackstage(null), void save())}
          onSaveAs={() => (setBackstage(null), void saveAs())}
          path={path}
          suggestedName={withoutExt(name)}
          onSaveToPath={async (target) => {
            await saveTo(target);
            setBackstage(null);
          }}
          onPrint={print}
          printSupport={printSupport}
          onExportPdf={isTauri ? () => void exportPdf() : undefined}
          info={
            <DocumentInfo
              app="text"
              dirty={dirty}
              path={path}
              title={meta.title}
              author={meta.author}
              onChange={(title, author) => (setMeta({ ...meta, title, author }), setDirty(true))}
              warnings={warnings}
              stats={
                <Text>
                  {layout.pages === 1 ? tl("1 Seite") : tl("{0} Seiten", layout.pages)} · {words.toLocaleString(LOCALE)} {tl("Wörter ·")} {(editor.storage.characterCount?.characters?.() ?? 0).toLocaleString(LOCALE)} {tl("Zeichen")}
                </Text>
              }
            />
          }
        />
      )}

      <MathDialog
        open={!!mathEdit}
        initial={mathEdit?.latex ?? ""}
        initialDisplay={mathEdit?.display ?? false}
        onClose={() => setMathEdit(null)}
        onInsert={(latex, display) => {
          const c = editor.chain().focus();
          if (mathEdit?.pos != null) c.setNodeSelection(mathEdit.pos);
          c.insertMath(latex, display).run();
        }}
      />
      <ShapeDialog
        open={!!shapeEdit}
        initial={shapeEdit?.attrs ?? null}
        onClose={() => setShapeEdit(null)}
        onApply={(a) => {
          const c = editor.chain().focus();
          if (shapeEdit?.pos != null) c.setNodeSelection(shapeEdit.pos);
          c.insertShape(a).run();
        }}
      />
      <DesignDialog kind={designDialog} value={design} onClose={() => setDesignDialog(null)} onApply={(v) => (setDesign(v), setDirty(true))} />
      <ProtectDialog
        open={toolDialog === "protect"}
        protection={protection}
        onClose={() => setToolDialog(null)}
        onStart={(p) => (setProtection(p), setDirty(true))}
        onStop={async (pw) => {
          if (!protection) return true;
          let ok = true;
          if (protection.password) ok = pw === protection.password;
          else if (protection.hash) ok = isTauri && (await officeInvoke<boolean>("text_check_protection", { protection, password: pw }).catch(() => false));
          if (ok) (setProtection(null), setDirty(true));
          return ok;
        }}
      />
      <EnvelopeDialog open={toolDialog === "envelope"} onClose={() => setToolDialog(null)} onCreate={(d) => void openInNewWindow(d)} />
      <LabelsDialog open={toolDialog === "labels"} onClose={() => setToolDialog(null)} onCreate={(d) => void openInNewWindow(d)} />
      {toolDialog === "grammar" && <GrammarDialog open editor={editor} lang={spellLang} onClose={() => setToolDialog(null)} />}
      <TranslateDialog open={toolDialog === "translate"} editor={editor} onClose={() => setToolDialog(null)} />
      <TemplatesDialog
        open={toolDialog === "templates"}
        onClose={() => setToolDialog(null)}
        onPick={(d) => void openInNewWindow(d)}
        onOpenTemplate={async () => {
          const p = await pickOpenPath("text");
          if (p) await openDocumentWindow("text", p);
        }}
      />
      {sectionEdit && (
        <PageSetupDialog
          open
          page={sectionsOf().setups[sectionEdit.index] ?? page}
          start={sectionEdit.index > 0 ? (sectionsOf().breaks[sectionEdit.index - 1]?.next ?? null) : null}
          sectionIndex={sectionEdit.index}
          sections={sectionsOf().setups.length}
          options={pageOptions(sectionsOf().setups[sectionEdit.index] ?? page)}
          onClose={() => setSectionEdit(null)}
          onApply={(r) => applyPageSetup(sectionEdit.index, r)}
          initialTab={sectionEdit.tab}
          initialScope={sectionEdit.scope ?? "section"}
          onBorders={() => (setSectionEdit(null), setDesignDialog("border"))}
        />
      )}
      <ColumnsDialog open={!!columnsEdit} initial={columnsEdit ?? { count: 2, gap: 12.5, line: false }} onClose={() => setColumnsEdit(null)} onApply={(v) => editor?.chain().focus().setColumns(v.count, { gap: v.gap, line: v.line }).run()} />
      {dialog === "hf" &&
        (() => {
          // The section with the cursor: its headers (own or linked).
          const { index } = cursorSection();
          const setups = sectionSetups();
          const own = setups[index];
          const linked = index > 0 && HF_KEYS.every((k) => !own?.[k]);
          const res = hfOfSection({ header, footer, first, even }, setups, index);
          return (
            <HeaderFooterDialog
              open
              section={{ index, count: setups.length, linked }}
              value={{ header: res.header, footer: res.footer, differentFirst: own?.titlePage ?? first.enabled, headerFirst: res.first.header, footerFirst: res.first.footer, differentOddEven: even.enabled, headerEven: res.even.header, footerEven: res.even.footer } satisfies HeaderFooterValue}
              onClose={() => setDialog(null)}
              onApply={(v, keepLinked) => {
                setEven({ enabled: v.differentOddEven, header: index === 0 ? v.headerEven : even.header, footer: index === 0 ? v.footerEven : even.footer });
                if (index === 0) {
                  setHeader(v.header);
                  setFooter(v.footer);
                  setFirst({ enabled: v.differentFirst, header: v.headerFirst, footer: v.footerFirst });
                } else {
                  const patch: Partial<PageSetup> = { titlePage: v.differentFirst === first.enabled ? null : v.differentFirst };
                  for (const k of HF_KEYS) patch[k] = keepLinked ? null : v[k];
                  setSectionSetup(index, patch);
                }
                setDirty(true);
              }}
            />
          );
        })()}
      <TextDialog
        open={dialog === "name"}
        title={tl("Benutzername")}
        label={tl("Name für Kommentare und nachverfolgte Änderungen")}
        initial={author === tl("Ich") ? "" : author}
        onClose={() => setDialog(null)}
        onApply={(v) => {
          setUserName(v.trim());
          try {
            localStorage.setItem("ondura.userName", v.trim());
          } catch {
            /* ignore */
          }
        }}
      />
      <TextDialog
        open={!!footnoteEdit}
        title={`${footnoteEdit?.endnote ? tl("Endnote") : tl("Fußnote")} ${footnoteEdit?.pos == null ? tl("einfügen") : "bearbeiten"}`}
        label={footnoteEdit?.endnote ? tl("Text der Endnote") : tl("Text der Fußnote")}
        multiline
        initial={footnoteEdit?.text ?? ""}
        onClose={() => setFootnoteEdit(null)}
        onApply={(text) => {
          const fe = footnoteEdit;
          if (!fe || !text.trim()) return;
          if (fe.pos == null) editor.chain().focus().insertContent({ type: "footnote", attrs: { text: text.trim(), endnote: fe.endnote } }).run();
          else editor.view.dispatch(editor.state.tr.setNodeMarkup(fe.pos, undefined, { text: text.trim(), endnote: fe.endnote }));
        }}
      />
      <LinkDialog
        open={dialog === "link"}
        initial={editor.getAttributes("link").href ?? ""}
        onClose={() => setDialog(null)}
        onApply={(href) => {
          const c = editor.chain().focus().extendMarkRange("link");
          if (!href) c.unsetLink().run();
          else if (editor.state.selection.empty && !editor.isActive("link")) c.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
          else c.setLink({ href }).run();
        }}
      />
      <ParagraphDialog
        open={dialog === "paragraph"}
        initial={paraValues}
        onClose={() => setDialog(null)}
        onApply={(v) =>
          editor
            .chain()
            .focus()
            .setParagraphSpacing({
              indent: v.indent || null,
              firstLine: v.firstLine || null,
              spaceBefore: v.spaceBefore || null,
              spaceAfter: v.spaceAfter === 8 ? null : v.spaceAfter,
              lineHeight: Math.abs(v.lineHeight - 1.15) < 0.01 ? null : String(v.lineHeight),
            })
            .run()
        }
      />
      {unsaved.dialog}
      {printing != null &&
        createPortal(
          printing.screen ? (
            <div className="nx-print-root nx-print-screen" dangerouslySetInnerHTML={{ __html: printing.html }} />
          ) : (
            <div className="nx-print-root">
              <div className="nx-paper" style={docStyle}>
                <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: printing.html }} />
              </div>
            </div>
          ),
          document.body,
        )}
    </div>
  );
}

function FindBar({ editor, replace, onClose }: { editor: import("@tiptap/react").Editor; replace: boolean; onClose: () => void }) {
  const s = useStyles();
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    return from !== to && to - from < 100 ? editor.state.doc.textBetween(from, to) : "";
  });
  const [caseSensitive, setCase] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(replace);
  const st = useEditorState({ editor, selector: ({ editor: e }) => { const x = searchState(e); return { n: x?.matches.length ?? 0, i: x?.index ?? 0 }; } })!;
  const notify = useNotify();
  useEffect(() => setShowReplace(replace), [replace]);
  useEffect(() => setSearch(editor, query, caseSensitive), [editor, query, caseSensitive]);
  return (
    <div className={s.find} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className={s.findRow}>
        <Input
          autoFocus
          size="small"
          style={{ flex: 1 }}
          placeholder={tl("Im Dokument suchen")}
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          onKeyDown={(e) => e.key === "Enter" && stepSearch(editor, e.shiftKey ? -1 : 1)}
          contentAfter={<Text size={200} style={{ whiteSpace: "nowrap" }}>{query ? (st.n ? `${st.i + 1}/${st.n}` : "0/0") : ""}</Text>}
        />
        <Button size="small" appearance="subtle" icon={<ArrowUp16Regular />} aria-label={tl("Vorheriges")} onClick={() => stepSearch(editor, -1)} />
        <Button size="small" appearance="subtle" icon={<ArrowDown16Regular />} aria-label={tl("Nächstes")} onClick={() => stepSearch(editor, 1)} />
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      {showReplace && (
        <div className={s.findRow}>
          <Input size="small" style={{ flex: 1 }} placeholder={tl("Ersetzen durch")} value={replacement} onChange={(_, d) => setReplacement(d.value)} onKeyDown={(e) => e.key === "Enter" && replaceCurrent(editor, replacement)} />
          <Button size="small" onClick={() => replaceCurrent(editor, replacement)} disabled={!st.n}>
            {tl("Ersetzen")}
          </Button>
          <Button size="small" onClick={() => notify(`${replaceAll(editor, replacement)} Ersetzungen`)} disabled={!st.n}>
            {tl("Alle")}
          </Button>
        </div>
      )}
      <div className={s.findRow}>
        <Checkbox size="medium" checked={caseSensitive} onChange={(_, d) => setCase(!!d.checked)} label={tl("Groß-/Kleinschreibung")} />
        {!showReplace && (
          <Button size="small" appearance="transparent" style={{ marginLeft: "auto" }} onClick={() => setShowReplace(true)}>
            {tl("Ersetzen…")}
          </Button>
        )}
      </div>
    </div>
  );
}

const DESIGN_KEY = "ondura.text.defaultDesign";
/** Text inset from the window edge in the web and draft views. */
const FLOW_INSET = 48;

/** Formatting saved with "Als Standard festlegen" for new documents. */
function defaultDesign(): Partial<TextDocument> {
  try {
    const v = JSON.parse(localStorage.getItem(DESIGN_KEY) ?? "null");
    if (!v || typeof v !== "object") return {};
    return { styles: Array.isArray(v.styles) ? v.styles : [], defaultFont: v.defaultFont ?? null, defaultSize: v.defaultSize ?? null };
  } catch {
    return {};
  }
}

/** Navigationsbereich: the headings of the document; a click goes there. */
function NavigationPane({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [q, setQ] = useState("");
  const entries = useEditorState({ editor, selector: ({ editor: e }) => (e ? tocEntries(e) : []), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }) ?? [];
  return (
    <div className="nx-nav-pane">
      <div className="nx-nav-head">
        <Text weight="semibold">{tl("Navigation")}</Text>
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      <Input size="small" placeholder={tl("Dokument durchsuchen")} value={q} onChange={(_, d) => setQ(d.value)} />
      <div className="nx-nav-list">
        {entries.length === 0 && <Text size={200}>{tl("Erstellen Sie interaktive Gliederungen, indem Sie Überschriftenformatvorlagen verwenden.")}</Text>}
        {entries.map((e, i) =>
          q && !e.text.toLowerCase().includes(q.toLowerCase()) ? null : (
            <button
              key={i}
              className="nx-nav-item"
              style={{ paddingLeft: 8 + (e.level - 1) * 14 }}
              onClick={() => {
                const pos = headingPosition(editor, i);
                if (pos !== null) editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
              }}
            >
              {e.text}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
