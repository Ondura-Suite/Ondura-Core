// Ondura PDF: view, comment on, edit, organise, protect and sign PDF files.
//
// pdf.js renders the pages (with text selection, links, search and form
// filling) and provides the annotation editors (text, drawing, highlighting,
// images); its `saveDocument()` writes them into the file as real PDF
// annotations, as an incremental update. Page and document operations run on
// the bytes with pdf-lib (ops.ts), digital signatures in sign.ts with the
// CMS made by the backend.

import { removeTemp, runPrintJob, tempFile, type PrintJob } from "../../lib/print";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, MessageBar, MessageBarActions, MessageBarBody, Spinner, Text, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  ArrowAutofitWidth24Regular,
  ArrowExportLtr24Regular,
  ArrowRedo24Regular,
  ArrowRotateClockwise24Regular,
  ArrowRotateCounterclockwise24Regular,
  ArrowSplit24Regular,
  ArrowUndo24Regular,
  Certificate24Regular,
  CheckmarkCircle16Filled,
  Copy24Regular,
  Cursor24Regular,
  Delete24Regular,
  DismissCircle16Filled,
  Dismiss24Regular,
  DocumentAdd24Regular,
  DocumentOnePage24Regular,
  DocumentPdf24Regular,
  Drop24Regular,
  Eraser24Regular,
  Form24Regular,
  Highlight24Regular,
  ImageAdd24Regular,
  ImageMultiple24Regular,
  Info24Regular,
  InkStroke24Regular,
  LockClosed24Regular,
  NumberSymbol24Regular,
  PanelLeft24Regular,
  PanelRight24Regular,
  Print24Regular,
  Save24Regular,
  Search24Regular,
  ShieldCheckmark24Regular,
  Signature24Regular,
  Square24Regular,
  TableCellsMerge24Regular,
  Textbox24Regular,
  Warning16Filled,
  ZoomIn24Regular,
  ZoomOut24Regular,
} from "@fluentui/react-icons";
import { api, errorMessage, isTauri } from "../../lib/api";
import { LOCALE, tl, tlc } from "../../lib/i18n";
import { addRecent, baseName, guardClose, initialFile, openDocumentWindow, openTemplateWindow, pickOpenPath, pickSavePath, setWindowTitle, takeTemplate, withoutExt } from "../../lib/office";
import { askPassword } from "../../shell/password";
import { Backstage, BigButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton, StatusBar, type BackstageStart, type OfficeTemplate, type RibbonTab, useUnsavedPrompt } from "../../shell/office";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { openDocument, pdfjsLib, loadViewer, type PDFDocumentProxy, type ViewerModule } from "./pdfjs";
import * as ops from "./ops";
import { embedSignature, findSignatures, pdfDate, prepareSignature, type FoundSignature } from "./sign";
import { DigitalSignDialog, PageNumbersDialog, ProtectDialog, SignaturePadDialog, SplitDialog, WatermarkDialog, certName, savedSignature, type DigitalSignRequest } from "./pdfDialogs";
import { samplePdf } from "./sample";
import "./pdf.css";

const COLOR = "#c4314b";
const { AnnotationEditorType: ED, AnnotationEditorParamsType: PARAM } = pdfjsLib;

type Tool = "select" | "highlight" | "freetext" | "ink" | "image" | "cover" | "redact" | "signarea";
/** Tools drawn by Ondura itself (rectangles), not by a pdf.js editor. */
const AREA_TOOLS: Tool[] = ["cover", "redact", "signarea"];

const EDITOR_MODE: Partial<Record<Tool, number>> = { select: ED.NONE, highlight: ED.HIGHLIGHT, freetext: ED.FREETEXT, ink: ED.INK, image: ED.STAMP };

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  main: { flex: 1, minHeight: 0, display: "flex", gap: "8px", margin: "0 8px" },
  panel: {
    width: "196px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  panelHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px", fontWeight: tokens.fontWeightSemibold },
  thumbs: { flex: 1, overflowY: "auto", padding: "4px 12px 16px", display: "flex", flexDirection: "column", gap: "14px", alignItems: "center" },
  thumb: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
    cursor: "pointer",
    border: "none",
    background: "none",
    padding: 0,
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase200,
  },
  thumbImg: {
    width: "132px",
    backgroundColor: "#fff",
    boxShadow: tokens.shadow4,
    borderRadius: "2px",
    outline: "2px solid transparent",
    outlineOffset: "3px",
    minHeight: "60px",
    display: "block",
  },
  thumbSel: { outline: `2px solid ${COLOR}` },
  thumbCurrent: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  dropBefore: { boxShadow: `0 -3px 0 ${COLOR}` },
  stage: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  container: { position: "absolute", inset: 0, overflow: "auto" },
  overlay: { position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 5 },
  mark: { position: "absolute", boxSizing: "border-box" },
  markCover: { backgroundColor: "rgba(255,255,255,0.85)", border: "1px dashed #8a8a8a" },
  markRedact: { backgroundColor: "rgba(0,0,0,0.55)", border: "1px solid #000" },
  markSign: { border: `2px dashed ${COLOR}`, backgroundColor: "rgba(196,49,75,0.06)" },
  areaMode: { cursor: "crosshair" },
  empty: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", color: tokens.colorNeutralForeground3 },
  hint: { position: "absolute", top: "10px", left: "50%", transform: "translateX(-50%)", zIndex: 6, minWidth: "420px" },
  find: {
    position: "absolute",
    top: "10px",
    right: "18px",
    zIndex: 6,
    display: "flex",
    gap: "6px",
    alignItems: "center",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
  },
  side: {
    width: "300px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  sigList: { flex: 1, overflowY: "auto", padding: "4px 12px 16px", display: "flex", flexDirection: "column", gap: "10px" },
  sig: { padding: "10px", borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "4px" },
  sigHead: { display: "flex", gap: "6px", alignItems: "center", fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  swatch: { width: "18px", height: "18px", borderRadius: "50%", border: `1px solid ${tokens.colorNeutralStroke1}`, cursor: "pointer", padding: 0 },
  swatchOn: { outline: `2px solid ${tokens.colorNeutralForeground1}`, outlineOffset: "1px" },
  printArea: { display: "none" },
});

const INK_COLORS = ["#1b2a5a", "#000000", "#c4314b", "#107c41", "#2b5bd7", "#ff8c00"];
const HIGHLIGHT_COLORS = ["#fff066", "#aaf08a", "#80ebff", "#ff9eda", "#ffbe73"];

/** Rectangle in PDF units → viewport pixels [x1, y1, x2, y2] (any order). */
const toViewport = (vp: { convertToViewportPoint(x: number, y: number): number[] }, r: [number, number, number, number]) => [...vp.convertToViewportPoint(r[0], r[1]), ...vp.convertToViewportPoint(r[2], r[3])];

const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const dataUrlBytes = (url: string) => fromB64(url.split(",")[1]);

async function readFile(path: string): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  return new Uint8Array(await invoke<ArrayBuffer>("read_bytes", { path }));
}
async function writeFile(path: string, bytes: Uint8Array) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_bytes", { path, data: toB64(bytes) });
}
/** Files chosen with the browser's file picker (images, PDFs to insert). */
function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

interface SignatureState {
  sig: FoundSignature;
  check: Awaited<ReturnType<typeof api.pdfVerify>> | null;
}

interface Mark extends ops.PageRect {
  kind: "cover" | "redact";
}

/** Templates of the start page: empty PDF, from images, merge. */
function pdfTemplates(): OfficeTemplate[] {
  const tile = (icon: React.ReactNode) => <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: COLOR, background: "#fff" }}>{icon}</div>;
  return [
    { id: "blank", label: tl("Leeres PDF"), preview: tile(<DocumentOnePage24Regular style={{ width: 48, height: 48 }} />) },
    { id: "images", label: tl("PDF aus Bildern"), preview: tile(<ImageMultiple24Regular style={{ width: 48, height: 48 }} />) },
    { id: "merge", label: tl("PDFs zusammenführen"), preview: tile(<TableCellsMerge24Regular style={{ width: 48, height: 48 }} />) },
  ];
}

export function PdfApp() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [name, setName] = useState(tl("Dokument"));
  const [dirty, setDirty] = useState(false);
  const [protection, setProtection] = useState<ops.Protection | null>(null);
  const [undo, setUndo] = useState<Uint8Array[]>([]);
  const [redo, setRedo] = useState<Uint8Array[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState("start");
  const [backstage, setBackstage] = useState<BackstageStart | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [tool, setToolState] = useState<Tool>("select");
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [inkWidth, setInkWidth] = useState(2);
  const [hlColor, setHlColor] = useState(HIGHLIGHT_COLORS[0]);
  const [textSize, setTextSize] = useState(12);
  const [thumbsOpen, setThumbsOpen] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [overlayTick, setOverlayTick] = useState(0);
  /** Counts shown documents (thumbnails are rendered per document). */
  const [docVersion, setDocVersion] = useState(0);
  const [find, setFind] = useState<{ query: string; count: string } | null>(null);
  const [signatures, setSignatures] = useState<SignatureState[]>([]);
  const [sidePanel, setSidePanel] = useState(false);
  const [dialog, setDialog] = useState<null | "numbers" | "watermark" | "protect" | "split" | "pad" | "digital">(null);
  const [pendingSign, setPendingSign] = useState<DigitalSignRequest | null>(null);
  const [printImages, setPrintImages] = useState<string[] | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const viewerDiv = useRef<HTMLDivElement>(null);
  const lib = useRef<ViewerModule | null>(null);
  const viewer = useRef<InstanceType<ViewerModule["PDFViewer"]> | null>(null);
  const eventBus = useRef<InstanceType<ViewerModule["EventBus"]> | null>(null);
  const linkService = useRef<InstanceType<ViewerModule["PDFLinkService"]> | null>(null);
  const findController = useRef<InstanceType<ViewerModule["PDFFindController"]> | null>(null);
  const uiManager = useRef<{ undo(): void; redo(): void; delete(): void } | null>(null);
  const pdf = useRef<PDFDocumentProxy | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  bytesRef.current = bytes;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const templates = useMemo(pdfTemplates, []);

  // ------------------------------------------------------------- viewer --

  /** Creates the pdf.js viewer once. */
  const ensureViewer = useCallback(async () => {
    if (viewer.current) return viewer.current;
    const m = (lib.current = await loadViewer());
    const bus = (eventBus.current = new m.EventBus());
    const links = (linkService.current = new m.PDFLinkService({ eventBus: bus, externalLinkTarget: m.LinkTarget.BLANK }));
    const finder = (findController.current = new m.PDFFindController({ eventBus: bus, linkService: links }));
    const v = new m.PDFViewer({
      container: container.current!,
      viewer: viewerDiv.current!,
      eventBus: bus,
      linkService: links,
      findController: finder,
      annotationEditorMode: ED.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS.map((c, i) => `${["yellow", "green", "blue", "pink", "red"][i]}=${c}`).join(","),
      l10n: new m.GenericL10n(undefined),
      removePageBorders: false,
    });
    links.setViewer(v);
    bus.on("pagechanging", (e: { pageNumber: number }) => setPage(e.pageNumber));
    bus.on("scalechanging", (e: { scale: number }) => {
      setScale(e.scale);
      setOverlayTick((t) => t + 1);
    });
    bus.on("pagesinit", () => {
      v.currentScaleValue = "auto";
      setOverlayTick((t) => t + 1);
    });
    bus.on("pagerendered", () => setOverlayTick((t) => t + 1));
    bus.on("annotationeditoruimanager", (e: { uiManager: { undo(): void; redo(): void; delete(): void } }) => (uiManager.current = e.uiManager));
    bus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) =>
      setFind((f) => f && { ...f, count: e.matchesCount.total ? tl("{0} von {1}", e.matchesCount.current, e.matchesCount.total) : tl("Keine Treffer") }),
    );
    // External links open in the browser, not in the webview.
    bus.on("annotationlayerrendered", () => undefined);
    viewer.current = v;
    return v;
  }, []);

  /** Shows `data` in the viewer, keeping the page if possible. */
  const show = useCallback(
    async (data: Uint8Array, keepPage = true) => {
      const v = await ensureViewer();
      const at = keepPage ? v.currentPageNumber : 1;
      const doc = await openDocument(data);
      const old = pdf.current;
      pdf.current = doc;
      (doc.annotationStorage as unknown as { onSetModified: () => void }).onSetModified = () => setDirty(true);
      v.setDocument(doc);
      linkService.current!.setDocument(doc, null);
      setPages(doc.numPages);
      setThumbs({});
      setDocVersion((n) => n + 1);
      setSelected((sel) => sel.filter((i) => i < doc.numPages));
      if (keepPage) {
        const once = () => {
          v.currentPageNumber = Math.min(at, doc.numPages);
          eventBus.current?.off("pagesinit", once);
        };
        eventBus.current!.on("pagesinit", once);
      }
      void old?.loadingTask.destroy();
    },
    [ensureViewer],
  );

  useEffect(() => {
    if (bytes) void show(bytes).catch((e) => notify(tl("Das PDF konnte nicht angezeigt werden"), errorMessage(e), "error"));
    // Only when the bytes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    setWindowTitle(`${withoutExt(name)} – ${tl("Ondura PDF")}`);
  }, [name]);

  // Links in the document open in the default browser.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.getAttribute("href")?.startsWith("#")) return;
      if (/^(https?:|mailto:)/i.test(a.href)) {
        e.preventDefault();
        void api.openExternal(a.href);
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  // ------------------------------------------------------- signatures --

  const checkSignatures = useCallback(async (file: Uint8Array) => {
    const found = findSignatures(file);
    setSignatures(found.map((sig) => ({ sig, check: null })));
    if (found.length) setSidePanel(true);
    const checks = await Promise.all(found.map((f) => api.pdfVerify(toB64(f.cms), toB64(f.signed)).catch((e) => ({ valid: false, trusted: false, signer: null, signingTime: null, problem: errorMessage(e) }))));
    setSignatures(found.map((sig, i) => ({ sig, check: checks[i] })));
  }, []);

  // ------------------------------------------------------------- files --

  const resetState = () => {
    setUndo([]);
    setRedo([]);
    setMarks([]);
    setSelected([]);
    setDirty(false);
  };

  /** Opens bytes (decrypting with the user's password if needed). */
  const openBytes = useCallback(
    async (raw: Uint8Array, fileName: string, filePath: string | null) => {
      let data = raw;
      let prot: ops.Protection | null = null;
      if (await ops.isEncrypted(raw)) {
        // Owner-only protection opens with an empty password.
        let pw: string | null = "";
        let wrong = false;
        for (;;) {
          try {
            data = await ops.decrypt(raw, pw ?? "");
            prot = { openPassword: pw ?? "", printing: true, copying: true, modifying: true };
            break;
          } catch {
            pw = await askPassword(fileName, wrong);
            wrong = true;
            if (pw === null) throw new Error(tl("Abgebrochen"));
          }
        }
        if (prot && !prot.openPassword) prot = null;
      }
      resetState();
      setProtection(prot);
      setBytes(data);
      setPath(filePath);
      setName(fileName);
      void checkSignatures(raw);
    },
    [checkSignatures],
  );

  const openPath = useCallback(
    async (p: string) => {
      setBusy(tl("Wird geöffnet …"));
      try {
        await openBytes(await readFile(p), baseName(p), p);
        addRecent("pdf", p);
      } catch (e) {
        notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error");
      } finally {
        setBusy(null);
      }
    },
    [notify, openBytes],
  );

  /** Open from Datei › Öffnen: here if the window is empty, else in a new one. */
  const open = async (p?: string) => {
    const target = p ?? (await pickOpenPath("pdf"));
    if (!target) return;
    setBackstage(null);
    if (bytes && (path || dirty)) await openDocumentWindow("pdf", target);
    else await openPath(target);
  };

  /** Current content including annotations and form values of pdf.js. */
  const current = useCallback(async (): Promise<Uint8Array> => {
    const doc = pdf.current;
    const data = bytesRef.current;
    if (!doc || !data) throw new Error(tl("Kein Dokument geöffnet"));
    // Leaving the editor mode commits a text box that is still being typed.
    const v = viewer.current;
    const mode = v?.annotationEditorMode as unknown as number | undefined;
    if (v && mode !== undefined && mode !== ED.NONE && mode !== ED.DISABLE) {
      v.annotationEditorMode = { mode: ED.NONE };
      setToolState("select");
      await new Promise((r) => setTimeout(r, 30));
    }
    return doc.annotationStorage.size > 0 ? new Uint8Array(await doc.saveDocument()) : data;
  }, []);

  /** Runs a document operation; the result becomes the new state. */
  const apply = useCallback(
    async (label: string, fn: (data: Uint8Array) => Promise<Uint8Array>) => {
      if (!bytesRef.current) return;
      if (signatures.length && !confirm(tl("Das PDF ist digital signiert. Diese Änderung macht die Signaturen ungültig. Trotzdem fortfahren?"))) return;
      setBusy(label);
      try {
        const data = await current();
        const out = await fn(data);
        // Undo returns to this state, annotations included.
        setUndo((u) => [...u.slice(-14), data]);
        setRedo([]);
        setBytes(out);
        setDirty(true);
        if (signatures.length) setSignatures([]);
      } catch (e) {
        notify(tl("Das hat nicht geklappt"), errorMessage(e), "error");
      } finally {
        setBusy(null);
      }
    },
    [current, notify, signatures.length],
  );

  const save = useCallback(
    async (as = false): Promise<boolean> => {
      if (!bytesRef.current) return false;
      let target = path;
      if (as || !target) {
        if (!isTauri) {
          notify(tl("Speichern ist in der Desktop-App verfügbar."), undefined, "info");
          return false;
        }
        target = await pickSavePath("pdf", withoutExt(name));
        if (!target) return false;
      }
      setBusy(tl("Wird gespeichert …"));
      try {
        const data = await current();
        const file = protection ? await ops.encrypt(data, protection) : data;
        await writeFile(target, file);
        setPath(target);
        setName(baseName(target));
        addRecent("pdf", target);
        setDirty(false);
        // Annotations are now part of the file; show it as saved.
        if (data !== bytesRef.current) setBytes(data);
        return true;
      } catch (e) {
        notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [current, name, notify, path, protection],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(withoutExt(name)), () => save()), [name, save, unsaved]);

  /** "Speichern unter" for a new file made from parts (extract, split). */
  const saveCopy = async (data: Uint8Array, suggested: string) => {
    if (!isTauri) return notify(tl("Speichern ist in der Desktop-App verfügbar."), undefined, "info");
    const target = await pickSavePath("pdf", suggested);
    if (!target) return;
    await writeFile(target, data);
    notify(tl("Gespeichert"), baseName(target), "success");
  };

  // Start: file from the command line / Explorer, a hand-off, or the start page.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const f = initialFile();
    const startWith = async () => {
      if (f) return openPath(f);
      const tpl = takeTemplate("pdf");
      if (tpl) return startFrom(tpl);
      if (!isTauri) await openBytes(await samplePdf(), tl("Beispiel.pdf"), null);
      setBackstage("home");
    };
    void startWith().finally(() => splashDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** New document from a template of the start page. */
  const startFrom = async (id: string) => {
    if (id === "blank") {
      const doc = await ops.insertBlank(await (await import("@cantoo/pdf-lib")).PDFDocument.create().then((d) => d.save()), 0);
      return openBytes(doc, tl("Dokument.pdf"), null);
    }
    if (id === "images") {
      const files = await pickFiles("image/png,image/jpeg");
      if (!files.length) return;
      const images = await Promise.all(files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), type: (/png$/i.test(f.type) ? "png" : "jpg") as "png" | "jpg" })));
      await openBytes(await ops.imagesToPdf(images), tl("Bilder.pdf"), null);
      setDirty(true);
      return;
    }
    if (id === "merge") {
      const files = await pickFiles("application/pdf");
      if (!files.length) return;
      const parts = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
      const [first, ...rest] = parts;
      await openBytes(rest.length ? await ops.insertDocuments(first, rest, (await (await import("@cantoo/pdf-lib")).PDFDocument.load(first, { ignoreEncryption: true })).getPageCount()) : first, tl("Zusammengeführt.pdf"), null);
      setDirty(true);
    }
  };

  // -------------------------------------------------------------- tools --

  const setTool = (t: Tool) => {
    const v = viewer.current;
    setToolState(t);
    if (!v || !pdf.current) return;
    const mode = EDITOR_MODE[t] ?? ED.NONE;
    try {
      v.annotationEditorMode = { mode };
    } catch {
      /* editor not available (XFA) */
    }
    if (t === "ink") {
      param(PARAM.INK_COLOR, inkColor);
      param(PARAM.INK_THICKNESS, inkWidth);
    } else if (t === "highlight") param(PARAM.HIGHLIGHT_COLOR, hlColor);
    else if (t === "freetext") param(PARAM.FREETEXT_SIZE, textSize);
  };
  const param = (type: number, value: unknown) => eventBus.current?.dispatch("switchannotationeditorparams", { source: null, type, value });

  /** Adds an image (or the signature) as a movable stamp on the current page. */
  const addImage = async (file: File) => {
    const v = viewer.current;
    if (!v) return;
    v.annotationEditorMode = { mode: ED.STAMP };
    setToolState("image");
    await new Promise((r) => setTimeout(r, 50));
    param(PARAM.CREATE, { bitmapFile: file });
  };

  const chooseImage = async () => {
    const [f] = await pickFiles("image/png,image/jpeg,image/webp", false);
    if (f) await addImage(f);
  };

  const insertSignature = (png: string) => {
    setDialog(null);
    const b = dataUrlBytes(png);
    void addImage(new File([b], "Unterschrift.png", { type: "image/png" }));
  };

  // Keyboard: Ctrl+S, Ctrl+O, Ctrl+P, Ctrl+F, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "s") (e.preventDefault(), void save(e.shiftKey));
      else if (ctrl && k === "o") (e.preventDefault(), void open());
      else if (ctrl && k === "p") (e.preventDefault(), print());
      else if (ctrl && k === "f") (e.preventDefault(), setFind({ query: find?.query ?? "", count: "" }));
      else if (e.key === "Escape" && AREA_TOOLS.includes(tool)) (setTool("select"), setPendingSign(null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const zoom = (factor: number | "page-width" | "page-fit") => {
    const v = viewer.current;
    if (!v) return;
    if (typeof factor === "string") v.currentScaleValue = factor;
    else v.currentScale = Math.max(0.25, Math.min(5, v.currentScale * factor));
  };

  const runFind = (query: string, previous = false, again = false) =>
    eventBus.current?.dispatch("find", { source: null, type: again ? "again" : "", query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });

  // ------------------------------------------------------- area tools --

  /** Page under a point and the point in PDF units. */
  const pagePoint = (clientX: number, clientY: number, pageNumber?: number) => {
    const v = viewer.current;
    if (!v) return null;
    let el = document.elementFromPoint(clientX, clientY)?.closest(".page") as HTMLElement | null;
    if (pageNumber) el = viewerDiv.current?.querySelector(`.page[data-page-number="${pageNumber}"]`) ?? el;
    if (!el) return null;
    const n = Number(el.dataset.pageNumber);
    const view = v.getPageView(n - 1);
    const r = el.getBoundingClientRect();
    const [x, y] = view.viewport.convertToPdfPoint(clientX - r.left - el.clientLeft, clientY - r.top - el.clientTop);
    return { page: n - 1, x, y };
  };

  const onAreaDown = (e: React.PointerEvent) => {
    if (!AREA_TOOLS.includes(tool) || e.button !== 0) return;
    const p = pagePoint(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ page: p.page, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onAreaMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pagePoint(e.clientX, e.clientY, drag.page + 1);
    if (p) setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onAreaUp = () => {
    if (!drag) return;
    const r = { page: drag.page, x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    if (r.width < 4 || r.height < 4) return;
    if (tool === "signarea" && pendingSign) {
      setTool("select");
      void signDigitally(pendingSign, r);
      setPendingSign(null);
    } else if (tool === "cover" || tool === "redact") setMarks((m) => [...m, { ...r, kind: tool }]);
  };

  /** Screen boxes of marks (and the rectangle being drawn). */
  const boxes = useMemo(() => {
    void overlayTick;
    const v = viewer.current;
    const c = container.current;
    if (!v || !c) return [];
    const list: { key: string; kind: string; style: React.CSSProperties }[] = [];
    const place = (key: string, kind: string, r: ops.PageRect) => {
      const el = viewerDiv.current?.querySelector(`.page[data-page-number="${r.page + 1}"]`) as HTMLElement | null;
      const view = v.getPageView(r.page);
      if (!el || !view) return;
      const [a, b, x2, y2] = toViewport(view.viewport, [r.x, r.y, r.x + r.width, r.y + r.height]);
      const left = el.offsetLeft + el.clientLeft + Math.min(a, x2);
      const top = el.offsetTop + el.clientTop + Math.min(b, y2);
      list.push({ key, kind, style: { left, top, width: Math.abs(x2 - a), height: Math.abs(y2 - b) } });
    };
    marks.forEach((m, i) => place(`m${i}`, m.kind, m));
    if (drag) place("drag", tool, { page: drag.page, x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) });
    return list;
  }, [marks, drag, overlayTick, tool]);

  /** Applies the drawn cover and redaction areas. */
  const applyMarks = async () => {
    const covers = marks.filter((m) => m.kind === "cover");
    const redacts = marks.filter((m) => m.kind === "redact");
    await apply(tl("Wird angewendet …"), async (data) => {
      let out = covers.length ? await ops.coverAreas(data, covers) : data;
      if (redacts.length) {
        // Render each page with black boxes and replace it by that image.
        const doc = await openDocument(out);
        const images = new Map<number, Uint8Array>();
        for (const n of [...new Set(redacts.map((m) => m.page))]) {
          const pg = await doc.getPage(n + 1);
          const vp = pg.getViewport({ scale: 2.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d")!;
          await pg.render({ canvas, canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
          ctx.fillStyle = "#000";
          for (const m of redacts.filter((r) => r.page === n)) {
            const [a, b, c, d] = toViewport(vp, [m.x, m.y, m.x + m.width, m.y + m.height]);
            ctx.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
          }
          const blob = await new Promise<Blob>((res) => canvas.toBlob((bl) => res(bl!), "image/png"));
          images.set(n, new Uint8Array(await blob.arrayBuffer()));
        }
        await doc.loadingTask.destroy();
        out = await ops.replaceWithImages(out, images);
      }
      return out;
    });
    setMarks([]);
    setTool("select");
  };

  // --------------------------------------------------------- signing --

  const signDigitally = async (req: DigitalSignRequest, area: ops.PageRect | null) => {
    if (protection) return notify(tl("Signieren nicht möglich"), tl("Entfernen Sie zuerst den Kennwortschutz – ein verschlüsseltes PDF kann hier nicht signiert werden."), "warning");
    if (!isTauri) return notify(tl("Digitale Signaturen sind in der Desktop-App verfügbar."), undefined, "info");
    let target = path;
    if (!target) {
      target = await pickSavePath("pdf", withoutExt(name));
      if (!target) return;
    }
    setBusy(tl("Wird signiert …"));
    try {
      const data = await current();
      const sigName = certName(req.cert);
      const now = new Date();
      const prepared = await prepareSignature(data, {
        name: sigName,
        reason: req.reason || undefined,
        location: req.location || undefined,
        date: now,
        dateText: tl("Digital signiert am {0}", now.toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" })),
        appearance: area ? { ...area, image: req.withImage ? dataUrlBytes(savedSignature()!) : undefined } : null,
      });
      const cms = fromB64(await api.pdfSign(req.cert.fingerprint, toB64(prepared.signed)));
      const signed = embedSignature(prepared, cms);
      await writeFile(target, signed);
      setPath(target);
      setName(baseName(target));
      addRecent("pdf", target);
      resetState();
      setBytes(signed);
      notify(tl("Digital signiert"), tl("Gespeichert als {0}", baseName(target)), "success");
      void checkSignatures(signed);
    } catch (e) {
      notify(tl("Signieren fehlgeschlagen"), errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------ print --

  /** Renders the pages as images for printing through the webview; resolves with the first page size in mm. */
  const renderPrintImages = async (data: Uint8Array): Promise<[number, number]> => {
    const d = await openDocument(data);
    const out: string[] = [];
    let size: [number, number] = [210, 297];
    for (let i = 1; i <= d.numPages; i++) {
      const pg = await d.getPage(i);
      if (i === 1) {
        const v = pg.getViewport({ scale: 1 });
        size = [(v.width * 25.4) / 72, (v.height * 25.4) / 72];
      }
      const vp = pg.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await pg.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, intent: "print", annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
      out.push(canvas.toDataURL("image/jpeg", 0.92));
    }
    await d.loadingTask.destroy();
    setPrintImages(out);
    await new Promise((r) => setTimeout(r, 300));
    return size;
  };

  /** Print job of the print view: the PDF itself is the preview; Linux/macOS print the file with CUPS. */
  const runPrint = async (job: PrintJob) => {
    const data = await current();
    if (job.kind === "pdf") return writeFile(job.path, data);
    if (job.kind === "printer" && isTauri && !/Windows/i.test(navigator.userAgent)) {
      const { invoke } = await import("@tauri-apps/api/core");
      const file = await tempFile("pdf");
      try {
        await writeFile(file, data);
        await invoke("print_pdf_file", { path: file, settings: { ...job.settings, widthMm: 210, heightMm: 297 } });
      } finally {
        void removeTemp(file);
      }
      return;
    }
    try {
      const [w, h] = await renderPrintImages(data);
      await runPrintJob(job, w, h);
    } finally {
      setPrintImages(null);
    }
  };
  const print = () => pdf.current && setBackstage("print");


  // ------------------------------------------------------- thumbnails --

  const renderThumb = useCallback(async (i: number) => {
    const doc = pdf.current;
    if (!doc || i >= doc.numPages) return;
    const pg = await doc.getPage(i + 1);
    const vp0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 264 / vp0.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await pg.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    const url = canvas.toDataURL("image/jpeg", 0.8);
    if (pdf.current === doc) setThumbs((t) => ({ ...t, [i]: url }));
  }, []);

  useEffect(() => {
    if (!thumbsOpen || !pages) return;
    let stop = false;
    void (async () => {
      for (let i = 0; i < pages && !stop; i++) if (!thumbs[i]) await renderThumb(i).catch(() => undefined);
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, thumbsOpen, renderThumb, docVersion]);

  const pageSel = () => (selected.length ? selected : [page - 1]);
  const goTo = (i: number) => {
    if (viewer.current) viewer.current.currentPageNumber = i + 1;
  };
  const clickThumb = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey && selected.length) {
      const a = Math.min(selected[selected.length - 1], i);
      const b = Math.max(selected[selected.length - 1], i);
      setSelected([...new Set([...selected, ...Array.from({ length: b - a + 1 }, (_, k) => a + k)])]);
    } else if (e.ctrlKey || e.metaKey) setSelected((sel) => (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]));
    else setSelected([i]);
    goTo(i);
  };

  // ------------------------------------------------------- operations --

  const rotate = (by: number) => apply(tl("Wird gedreht …"), (d) => ops.rotatePages(d, pageSel(), by));
  const removePages = () => apply(tl("Wird gelöscht …"), (d) => ops.deletePages(d, pageSel()));
  const duplicate = () => apply(tl("Wird dupliziert …"), (d) => ops.duplicatePages(d, pageSel()));
  const insertBlank = () => apply(tl("Wird eingefügt …"), (d) => ops.insertBlank(d, Math.max(...pageSel()) + 1));
  const insertFiles = async () => {
    const files = await pickFiles("application/pdf,image/png,image/jpeg");
    if (!files.length) return;
    const at = Math.max(...pageSel()) + 1;
    await apply(tl("Wird eingefügt …"), async (d) => {
      let out = d;
      const pdfs: Uint8Array[] = [];
      const images: ops.ImageInput[] = [];
      for (const f of files) {
        const b = new Uint8Array(await f.arrayBuffer());
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) pdfs.push(b);
        else images.push({ bytes: b, type: /png$/i.test(f.type) ? "png" : "jpg" });
      }
      if (images.length) pdfs.push(await ops.imagesToPdf(images));
      out = await ops.insertDocuments(out, pdfs, at);
      return out;
    });
  };
  const extract = async () => {
    const sel = pageSel();
    try {
      await saveCopy(await ops.extractPages(await current(), sel), `${withoutExt(name)} – ${tl("Seiten")} ${sel.map((i) => i + 1).join(", ")}`);
    } catch (e) {
      notify(tl("Das hat nicht geklappt"), errorMessage(e), "error");
    }
  };
  const split = async (every: number) => {
    setDialog(null);
    try {
      const parts = await ops.splitEvery(await current(), every);
      if (!isTauri) return notify(tl("Speichern ist in der Desktop-App verfügbar."), undefined, "info");
      const first = await pickSavePath("pdf", `${withoutExt(name)} – 1`);
      if (!first) return;
      const base = first.replace(/(?: – \d+)?\.pdf$/i, "");
      for (let i = 0; i < parts.length; i++) await writeFile(`${base} – ${i + 1}.pdf`, parts[i]);
      notify(tl("PDF geteilt"), tl("{0} Dateien gespeichert", parts.length), "success");
    } catch (e) {
      notify(tl("Das hat nicht geklappt"), errorMessage(e), "error");
    }
  };
  const moveTo = (to: number) => {
    const moving = selected.length ? selected : [page - 1];
    if (moving.length === 1 && (moving[0] === to || moving[0] + 1 === to)) return;
    void apply(tl("Wird verschoben …"), (d) => ops.reorderPages(d, ops.moveOrder(pages, moving, to)));
  };

  const undoStep = async () => {
    const prev = undo[undo.length - 1];
    if (!prev) return uiManager.current?.undo();
    const now = await current().catch(() => bytesRef.current!);
    setRedo((r) => [...r, now]);
    setUndo((u) => u.slice(0, -1));
    setBytes(prev);
    setDirty(true);
  };
  const redoStep = async () => {
    const next = redo[redo.length - 1];
    if (!next) return uiManager.current?.redo();
    const now = await current().catch(() => bytesRef.current!);
    setUndo((u) => [...u, now]);
    setRedo((r) => r.slice(0, -1));
    setBytes(next);
    setDirty(true);
  };

  // ------------------------------------------------------------ ribbon --

  const noDoc = !bytes;
  const swatches = (colors: string[], value: string, onPick: (c: string) => void) => (
    <div style={{ display: "flex", gap: 6, padding: "4px 2px" }}>
      {colors.map((c) => (
        <Tooltip key={c} content={c} relationship="label">
          <button className={mergeClasses(s.swatch, value === c && s.swatchOn)} style={{ backgroundColor: c }} onClick={() => onPick(c)} aria-label={c} />
        </Tooltip>
      ))}
    </div>
  );

  const tabs: RibbonTab[] = [
    {
      id: "start",
      label: tl("Start"),
      content: (
        <>
          <RibbonGroup label={tl("Datei")}>
            <BigButton icon={<Save24Regular />} label={tl("Speichern")} onClick={() => void save()} disabled={noDoc} />
            <Rows>
              <Row>
                <SmallButton icon={<Print24Regular />} label={tl("Drucken")} text={tl("Drucken")} onClick={() => print()} disabled={noDoc} shortcut="Strg+P" />
              </Row>
              <Row>
                <SmallButton icon={<ArrowUndo24Regular />} label={tl("Rückgängig")} onClick={() => void undoStep()} disabled={noDoc} />
                <SmallButton icon={<ArrowRedo24Regular />} label={tl("Wiederholen")} onClick={() => void redoStep()} disabled={noDoc} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Werkzeuge")}>
            <BigButton icon={<Cursor24Regular />} label={tl("Auswählen")} pressed={tool === "select"} onClick={() => setTool("select")} disabled={noDoc} />
            <BigButton icon={<Highlight24Regular />} label={tl("Markieren")} pressed={tool === "highlight"} onClick={() => setTool("highlight")} disabled={noDoc} />
            <BigButton icon={<Textbox24Regular />} label={tl("Text")} pressed={tool === "freetext"} onClick={() => setTool("freetext")} disabled={noDoc} />
            <BigButton icon={<InkStroke24Regular />} label={tl("Zeichnen")} pressed={tool === "ink"} onClick={() => setTool("ink")} disabled={noDoc} />
            <BigButton icon={<Signature24Regular />} label={tl("Unterschreiben")} onClick={() => setDialog("pad")} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Seite")}>
            <Rows>
              <Row>
                <SmallButton icon={<ArrowRotateCounterclockwise24Regular />} label={tl("Nach links drehen")} onClick={() => void rotate(-90)} disabled={noDoc} />
                <SmallButton icon={<ArrowRotateClockwise24Regular />} label={tl("Nach rechts drehen")} onClick={() => void rotate(90)} disabled={noDoc} />
              </Row>
              <Row>
                <SmallButton icon={<Delete24Regular />} label={tl("Seite löschen")} onClick={() => void removePages()} disabled={noDoc || pages < 2} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Zoom")}>
            <Rows>
              <Row>
                <SmallButton icon={<ZoomOut24Regular />} label={tl("Verkleinern")} onClick={() => zoom(1 / 1.15)} disabled={noDoc} />
                <SmallButton icon={<ZoomIn24Regular />} label={tl("Vergrößern")} onClick={() => zoom(1.15)} disabled={noDoc} />
              </Row>
              <Row>
                <SmallButton icon={<ArrowAutofitWidth24Regular />} label={tl("Seitenbreite")} onClick={() => zoom("page-width")} disabled={noDoc} />
                <SmallButton icon={<DocumentOnePage24Regular />} label={tl("Ganze Seite")} onClick={() => zoom("page-fit")} disabled={noDoc} />
              </Row>
            </Rows>
            <BigButton icon={<Search24Regular />} label={tl("Suchen")} onClick={() => setFind({ query: find?.query ?? "", count: "" })} disabled={noDoc} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "comment",
      label: tl("Kommentieren"),
      content: (
        <>
          <RibbonGroup label={tl("Markieren")}>
            <BigButton icon={<Highlight24Regular />} label={tl("Text markieren")} pressed={tool === "highlight"} onClick={() => setTool("highlight")} disabled={noDoc} />
            {swatches(HIGHLIGHT_COLORS, hlColor, (c) => (setHlColor(c), param(PARAM.HIGHLIGHT_COLOR, c)))}
          </RibbonGroup>
          <RibbonGroup label={tl("Text")}>
            <BigButton icon={<Textbox24Regular />} label={tl("Textfeld")} pressed={tool === "freetext"} onClick={() => setTool("freetext")} disabled={noDoc} />
            <Rows>
              <Row>
                <Text size={200}>{tl("Größe")}</Text>
                {[10, 12, 16, 24].map((n) => (
                  <SmallButton key={n} label={`${n} pt`} text={String(n)} pressed={textSize === n} onClick={() => (setTextSize(n), param(PARAM.FREETEXT_SIZE, n))} />
                ))}
              </Row>
              <Row>{swatches(INK_COLORS, inkColor, (c) => (setInkColor(c), param(PARAM.FREETEXT_COLOR, c), param(PARAM.INK_COLOR, c)))}</Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Zeichnen")}>
            <BigButton icon={<InkStroke24Regular />} label={tl("Stift")} pressed={tool === "ink"} onClick={() => setTool("ink")} disabled={noDoc} />
            <Rows>
              <Row>
                <Text size={200}>{tl("Stärke")}</Text>
                {[1, 2, 4, 8].map((n) => (
                  <SmallButton key={n} label={tl("{0} pt", n)} text={String(n)} pressed={inkWidth === n} onClick={() => (setInkWidth(n), param(PARAM.INK_THICKNESS, n))} />
                ))}
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Einfügen")}>
            <BigButton icon={<ImageAdd24Regular />} label={tl("Bild")} onClick={() => void chooseImage()} disabled={noDoc} />
            <BigButton icon={<Signature24Regular />} label={tl("Unterschrift")} onClick={() => setDialog("pad")} disabled={noDoc} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "edit",
      label: tl("Bearbeiten"),
      content: (
        <>
          <RibbonGroup label={tl("Inhalt")}>
            <BigButton icon={<Textbox24Regular />} label={tl("Text hinzufügen")} pressed={tool === "freetext"} onClick={() => setTool("freetext")} disabled={noDoc} />
            <BigButton icon={<ImageAdd24Regular />} label={tl("Bild hinzufügen")} onClick={() => void chooseImage()} disabled={noDoc} />
            <BigButton icon={<Eraser24Regular />} label={tl("Abdecken")} pressed={tool === "cover"} onClick={() => setTool("cover")} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Seitengestaltung")}>
            <BigButton icon={<NumberSymbol24Regular />} label={tl("Seitenzahlen")} onClick={() => setDialog("numbers")} disabled={noDoc} />
            <BigButton icon={<Drop24Regular />} label={tl("Wasserzeichen")} onClick={() => setDialog("watermark")} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Formular")}>
            <BigButton icon={<Form24Regular />} label={tl("Formular reduzieren")} onClick={() => void apply(tl("Wird reduziert …"), ops.flattenForm)} disabled={noDoc} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "pages",
      label: tl("Seiten"),
      content: (
        <>
          <RibbonGroup label={tl("Drehen")}>
            <BigButton icon={<ArrowRotateCounterclockwise24Regular />} label={tl("Links drehen")} onClick={() => void rotate(-90)} disabled={noDoc} />
            <BigButton icon={<ArrowRotateClockwise24Regular />} label={tl("Rechts drehen")} onClick={() => void rotate(90)} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Einfügen")}>
            <BigButton icon={<DocumentAdd24Regular />} label={tl("Leere Seite")} onClick={() => void insertBlank()} disabled={noDoc} />
            <BigButton icon={<TableCellsMerge24Regular />} label={tl("Aus Datei")} onClick={() => void insertFiles()} disabled={noDoc} />
            <BigButton icon={<Copy24Regular />} label={tl("Duplizieren")} onClick={() => void duplicate()} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Aufteilen")}>
            <BigButton icon={<ArrowExportLtr24Regular />} label={tl("Seiten extrahieren")} onClick={() => void extract()} disabled={noDoc} />
            <BigButton icon={<ArrowSplit24Regular />} label={tl("PDF teilen")} onClick={() => setDialog("split")} disabled={noDoc || pages < 2} />
          </RibbonGroup>
          <RibbonGroup label={tl("Entfernen")}>
            <BigButton icon={<Delete24Regular />} label={tl("Löschen")} onClick={() => void removePages()} disabled={noDoc || pages < 2} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "protect",
      label: tl("Schützen"),
      content: (
        <>
          <RibbonGroup label={tl("Signieren")}>
            <BigButton icon={<Signature24Regular />} label={tl("Unterschreiben")} onClick={() => setDialog("pad")} disabled={noDoc} />
            <BigButton icon={<Certificate24Regular />} label={tl("Digital signieren")} onClick={() => setDialog("digital")} disabled={noDoc} />
            <BigButton icon={<ShieldCheckmark24Regular />} label={tl("Signaturen")} pressed={sidePanel} onClick={() => setSidePanel((v) => !v)} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Schwärzen")}>
            <BigButton icon={<Square24Regular />} label={tl("Bereiche schwärzen")} pressed={tool === "redact"} onClick={() => setTool("redact")} disabled={noDoc} />
            <BigButton icon={<ShieldCheckmark24Regular />} label={tl("Schwärzungen anwenden")} onClick={() => void applyMarks()} disabled={!marks.some((m) => m.kind === "redact")} />
          </RibbonGroup>
          <RibbonGroup label={tl("Schutz")}>
            <BigButton icon={<LockClosed24Regular />} label={protection ? tl("Kennwortschutz ändern") : tl("Mit Kennwort schützen")} pressed={!!protection} onClick={() => setDialog("protect")} disabled={noDoc} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "view",
      label: tl("Ansicht"),
      content: (
        <>
          <RibbonGroup label={tl("Bereiche")}>
            <BigButton icon={<PanelLeft24Regular />} label={tl("Miniaturen")} pressed={thumbsOpen} onClick={() => setThumbsOpen((v) => !v)} />
            <BigButton icon={<PanelRight24Regular />} label={tl("Signaturen")} pressed={sidePanel} onClick={() => setSidePanel((v) => !v)} />
          </RibbonGroup>
          <RibbonGroup label={tl("Seitenanzeige")}>
            <BigButton icon={<DocumentOnePage24Regular />} label={tl("Einzelseite")} onClick={() => viewer.current && (viewer.current.spreadMode = 0)} disabled={noDoc} />
            <BigButton icon={<DocumentPdf24Regular />} label={tl("Zwei Seiten")} onClick={() => viewer.current && (viewer.current.spreadMode = 2)} disabled={noDoc} />
          </RibbonGroup>
          <RibbonGroup label={tl("Zoom")}>
            <BigButton icon={<ArrowAutofitWidth24Regular />} label={tl("Seitenbreite")} onClick={() => zoom("page-width")} disabled={noDoc} />
            <BigButton icon={<DocumentOnePage24Regular />} label={tl("Ganze Seite")} onClick={() => zoom("page-fit")} disabled={noDoc} />
          </RibbonGroup>
        </>
      ),
    },
  ];

  const areaHint =
    tool === "cover"
      ? tl("Ziehen Sie Rechtecke über die Stellen, die weiß abgedeckt werden sollen (der Text darunter bleibt in der Datei).")
      : tool === "redact"
        ? tl("Ziehen Sie Rechtecke über alles, was entfernt werden soll. Die Seiten werden beim Anwenden zu Bildern – Text darunter ist dann wirklich weg.")
        : tool === "signarea"
          ? tl("Ziehen Sie das Feld für die sichtbare Signatur auf.")
          : null;

  // ---------------------------------------------------------------- view --

  return (
    <div className={s.root}>
      <SuiteHeader appName={tlc("app", "PDF")} logo="/pdf.svg" center={`${withoutExt(name)}${dirty ? " •" : ""}${bytes && !path ? tl(" – nicht gespeichert") : ""}`} />
      <div style={{ padding: "0 0 8px" }}>
        <OfficeRibbon tabs={tabs} active={tab} onTab={setTab} onFile={() => setBackstage("open")} color={COLOR} />
      </div>
      <div className={s.main}>
        {thumbsOpen && bytes && (
          <div className={s.panel}>
            <div className={s.panelHead}>
              <span>{tl("Seiten")}</span>
              <Text size={200} className={s.muted}>
                {selected.length > 1 ? tl("{0} ausgewählt", selected.length) : ""}
              </Text>
            </div>
            <div
              className={s.thumbs}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dropAt !== null) moveTo(dropAt);
                setDropAt(null);
              }}
            >
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  className={mergeClasses(s.thumb, page === i + 1 && s.thumbCurrent, dropAt === i && s.dropBefore)}
                  onClick={(e) => clickThumb(i, e)}
                  draggable
                  onDragStart={(e) => {
                    if (!selected.includes(i)) setSelected([i]);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
                  }}
                  onContextMenu={(e) => {
                    if (!selected.includes(i)) setSelected([i]);
                    e.preventDefault();
                  }}
                >
                  {thumbs[i] ? <img src={thumbs[i]} alt="" className={mergeClasses(s.thumbImg, selected.includes(i) && s.thumbSel)} /> : <div className={mergeClasses(s.thumbImg, selected.includes(i) && s.thumbSel)} style={{ height: 170 }} />}
                  <span>{i + 1}</span>
                </button>
              ))}
              {dropAt === pages && <div style={{ height: 3, width: 132, background: COLOR }} />}
            </div>
          </div>
        )}
        <div className={s.stage}>
          <div
            ref={container}
            className={mergeClasses(s.container, AREA_TOOLS.includes(tool) && s.areaMode)}
            onPointerDownCapture={(e) => {
              if (AREA_TOOLS.includes(tool)) {
                e.stopPropagation();
                onAreaDown(e);
              }
            }}
            onPointerMove={onAreaMove}
            onPointerUp={onAreaUp}
          >
            <div ref={viewerDiv} className="pdfViewer" />
            <div className={s.overlay}>
              {boxes.map((b) => (
                <div key={b.key} className={mergeClasses(s.mark, b.kind === "redact" ? s.markRedact : b.kind === "signarea" ? s.markSign : s.markCover)} style={b.style} />
              ))}
            </div>
          </div>
          {!bytes && !busy && (
            <div className={s.empty}>
              <DocumentPdf24Regular style={{ width: 56, height: 56, color: COLOR }} />
              <Text size={500} weight="semibold">
                {tl("Kein PDF geöffnet")}
              </Text>
              <Button appearance="primary" onClick={() => void open()}>
                {tl("PDF öffnen …")}
              </Button>
            </div>
          )}
          {busy && (
            <div className={s.empty} style={{ background: "transparent", pointerEvents: "none" }}>
              <Spinner label={busy} />
            </div>
          )}
          {areaHint && (
            <MessageBar className={s.hint} intent="info">
              <MessageBarBody>{areaHint}</MessageBarBody>
              <MessageBarActions>
                {(tool === "cover" || tool === "redact") && marks.length > 0 && (
                  <Button size="small" appearance="primary" onClick={() => void applyMarks()}>
                    {tool === "redact" ? tl("Schwärzungen anwenden") : tl("Abdecken")}
                  </Button>
                )}
                {marks.length > 0 && tool !== "signarea" && (
                  <Button size="small" onClick={() => setMarks([])}>
                    {tl("Verwerfen")}
                  </Button>
                )}
                <Button size="small" appearance="subtle" icon={<Dismiss24Regular />} aria-label={tl("Schließen")} onClick={() => (setTool("select"), setPendingSign(null))} />
              </MessageBarActions>
            </MessageBar>
          )}
          {find && (
            <div className={s.find}>
              <Input
                autoFocus
                size="small"
                placeholder={tl("Im Dokument suchen")}
                value={find.query}
                onChange={(_, d) => {
                  setFind({ ...find, query: d.value });
                  runFind(d.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runFind(find.query, e.shiftKey, true);
                  if (e.key === "Escape") setFind(null);
                }}
              />
              <Text size={200} className={s.muted} style={{ minWidth: 70 }}>
                {find.count}
              </Text>
              <Button size="small" appearance="subtle" icon={<Dismiss24Regular />} aria-label={tl("Schließen")} onClick={() => setFind(null)} />
            </div>
          )}
        </div>
        {sidePanel && bytes && (
          <div className={s.side}>
            <div className={s.panelHead}>
              <span>{tl("Signaturen")}</span>
              <Button size="small" appearance="subtle" icon={<Dismiss24Regular />} aria-label={tl("Schließen")} onClick={() => setSidePanel(false)} />
            </div>
            <div className={s.sigList}>
              {signatures.length === 0 && <Text className={s.muted}>{tl("Dieses PDF enthält keine digitalen Signaturen.")}</Text>}
              {signatures.map(({ sig, check }, i) => {
                const ok = check?.valid && sig.coversAll;
                const when = check?.signingTime ? new Date(check.signingTime) : pdfDate(sig.time);
                return (
                  <div key={i} className={s.sig}>
                    <div className={s.sigHead}>
                      {!check ? <Spinner size="extra-tiny" /> : ok && check.trusted ? <CheckmarkCircle16Filled color={tokens.colorPaletteGreenForeground1} /> : check.valid ? <Warning16Filled color={tokens.colorPaletteYellowForeground2} /> : <DismissCircle16Filled color={tokens.colorPaletteRedForeground1} />}
                      <span>{check?.signer ? certName(check.signer) : (sig.name ?? tl("Unbekannt"))}</span>
                    </div>
                    <Text size={200}>
                      {!check
                        ? tl("Wird geprüft …")
                        : !check.valid
                          ? tl("Ungültig: {0}", check.problem ?? tl("Die Signatur passt nicht zum Inhalt."))
                          : !sig.coversAll
                            ? tl("Gültig für die signierte Fassung – das Dokument wurde danach noch geändert (z. B. Kommentare oder eine weitere Signatur).")
                            : check.trusted
                              ? tl("Gültig. Das Dokument wurde seit der Signatur nicht verändert.")
                              : tl("Gültig, aber das Zertifikat ist nicht vertrauenswürdig (es stammt von keiner bekannten Stelle).")}
                    </Text>
                    {when && (
                      <Text size={200} className={s.muted}>
                        {tl("Signiert am {0}", when.toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" }))}
                      </Text>
                    )}
                    {sig.reason && (
                      <Text size={200} className={s.muted}>
                        {tl("Grund: {0}", sig.reason)}
                      </Text>
                    )}
                    {check?.signer && (
                      <Text size={200} className={s.muted}>
                        {tl("Ausgestellt von {0}", /CN=([^,]+)/.exec(check.signer.issuer)?.[1] ?? check.signer.issuer)}
                      </Text>
                    )}
                  </div>
                );
              })}
              <Button icon={<Certificate24Regular />} onClick={() => setDialog("digital")} style={{ alignSelf: "flex-start" }}>
                {tl("Digital signieren …")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <StatusBar>
        <span>{bytes ? tl("Seite {0} von {1}", page, pages) : tl("Bereit")}</span>
        {protection && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <LockClosed24Regular style={{ width: 14, height: 14 }} /> {tl("Kennwortgeschützt")}
          </span>
        )}
        {signatures.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ShieldCheckmark24Regular style={{ width: 14, height: 14 }} /> {tl("{0} Signatur(en)", signatures.length)}
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>{bytes ? `${Math.round(scale * 100)} %` : ""}</span>
      </StatusBar>

      {backstage && (
        <Backstage
          app="pdf"
          color={COLOR}
          initialPage={backstage}
          onClose={() => setBackstage(null)}
          onNew={() => void openTemplateWindow("pdf", "blank")}
          onOpen={(p) => void open(p)}
          onSave={() => (setBackstage(null), void save())}
          onSaveAs={() => (setBackstage(null), void save(true))}
          onPrint={() => void runPrint({ kind: "dialog" })}
          printSupport={pdf.current ? { run: runPrint, optionsKey: String(docVersion) } : undefined}
          path={path}
          suggestedName={withoutExt(name)}
          templates={templates}
          onTemplate={(id) => {
            setBackstage(null);
            if (!bytes || (!path && !dirty)) void startFrom(id);
            else void openTemplateWindow("pdf", id);
          }}
          info={<PdfInfo bytes={bytes} path={path} pages={pages} protection={!!protection} signatures={signatures.length} onChange={(m) => void apply(tl("Wird gespeichert …"), (d) => ops.writeMetadata(d, m))} />}
        />
      )}

      <PageNumbersDialog open={dialog === "numbers"} onClose={() => setDialog(null)} onApply={(o) => (setDialog(null), void apply(tl("Wird eingefügt …"), (d) => ops.addPageNumbers(d, o)))} />
      <WatermarkDialog open={dialog === "watermark"} onClose={() => setDialog(null)} onApply={(o) => (setDialog(null), void apply(tl("Wird eingefügt …"), (d) => ops.addWatermark(d, o)))} />
      <ProtectDialog
        open={dialog === "protect"}
        current={protection}
        onClose={() => setDialog(null)}
        onApply={(p) => {
          setDialog(null);
          setProtection(p);
          setDirty(true);
          notify(p ? tl("Kennwortschutz festgelegt") : tl("Kennwortschutz entfernt"), tl("Wirksam beim nächsten Speichern."), "info");
        }}
      />
      <SplitDialog open={dialog === "split"} pages={pages} onClose={() => setDialog(null)} onApply={(n) => void split(n)} />
      <SignaturePadDialog open={dialog === "pad"} onClose={() => setDialog(null)} onDone={insertSignature} />
      <DigitalSignDialog
        open={dialog === "digital"}
        onClose={() => setDialog(null)}
        onSign={(r) => {
          setDialog(null);
          if (r.visible) {
            setPendingSign(r);
            setTool("signarea");
          } else void signDigitally(r, null);
        }}
      />
      {unsaved.dialog}
      {printImages && (
        <div className="ondura-pdf-print">
          {printImages.map((src, i) => (
            <img key={i} src={src} alt="" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Datei › Informationen. */
function PdfInfo({ bytes, path, pages, protection, signatures, onChange }: { bytes: Uint8Array | null; path: string | null; pages: number; protection: boolean; signatures: number; onChange: (m: ops.Metadata) => void }) {
  const [meta, setMeta] = useState<ops.Metadata | null>(null);
  useEffect(() => {
    if (bytes) void ops.readMetadata(bytes).then(setMeta, () => setMeta(null));
  }, [bytes]);
  if (!bytes) return <Text>{tl("Kein Dokument geöffnet")}</Text>;
  const field = (key: keyof ops.Metadata, label: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Text size={200}>{label}</Text>
      <Input value={meta?.[key] ?? ""} onChange={(_, d) => setMeta((m) => m && { ...m, [key]: d.value })} />
    </label>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      <Text>{path ?? tl("Noch nicht gespeichert")}</Text>
      <Text>
        <Info24Regular style={{ width: 16, height: 16, verticalAlign: "middle" }} /> {tl("{0} Seiten · {1} KB", pages, Math.round(bytes.length / 1024).toLocaleString(LOCALE))}
        {protection ? ` · ${tl("Kennwortgeschützt")}` : ""}
        {signatures ? ` · ${tl("{0} Signatur(en)", signatures)}` : ""}
      </Text>
      {meta && (
        <>
          {field("title", tl("Titel"))}
          {field("author", tl("Autor"))}
          {field("subject", tl("Betreff"))}
          {field("keywords", tl("Stichwörter"))}
          <Button appearance="primary" style={{ alignSelf: "flex-start" }} onClick={() => onChange(meta)}>
            {tl("Übernehmen")}
          </Button>
        </>
      )}
    </div>
  );
}
