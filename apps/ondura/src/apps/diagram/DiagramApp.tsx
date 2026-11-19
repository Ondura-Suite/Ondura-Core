// Ondura Diagramme: flowcharts, org charts and network plans like Visio or
// diagrams.net. Shapes from the panel on the left, connectors that follow
// their shapes, formatting on the right, several pages; saved as .drawio.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPortal } from "react-dom";
import {
  Button,
  Checkbox,
  Dropdown,
  Field,
  Input,
  Option,
  SearchBox,
  SpinButton,
  Text,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add16Regular,
  AlignBottom24Regular,
  AlignCenterHorizontal24Regular,
  AlignCenterVertical24Regular,
  AlignLeft24Regular,
  AlignRight24Regular,
  AlignTop24Regular,
  ArrowRedo24Regular,
  ArrowUndo24Regular,
  ArrowExportLtr24Regular,
  ClipboardPaste24Regular,
  Copy24Regular,
  Cut24Regular,
  Delete24Regular,
  DocumentPdf24Regular,
  FolderOpen24Regular,
  Grid24Regular,
  Image24Regular,
  Print24Regular,
  Save24Regular,
  SaveEdit24Regular,
  PositionToBack24Regular,
  PositionToFront24Regular,
  TextBold24Regular,
  TextItalic24Regular,
  TextAlignCenter24Regular,
  TextAlignLeft24Regular,
  TextAlignRight24Regular,
  ZoomFit24Regular,
  ZoomIn24Regular,
  ZoomOut24Regular,
  Dismiss24Regular,
} from "@fluentui/react-icons";
import { PDFDocument } from "@cantoo/pdf-lib";
import { errorMessage, isTauri } from "../../lib/api";
import { tl, tlc } from "../../lib/i18n";
import { guardClose, initialFile, setWindowTitle } from "../../lib/office";
import { openTextFile, readTextFile, saveFile, type FileFilter } from "../../lib/files";
import { NO_BROWSER_HEADER } from "../../lib/print";
import { BigButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton, StatusBar, type RibbonTab, useUnsavedPrompt } from "../../shell/office";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { useNotify } from "../../shell/notify";
import { openContextMenu } from "../../shell/contextMenu";
import { splashDone } from "../../shell/splash";
import { PORTS, inRect, portDir, portPoint, route, snap } from "./geometry";
import { isIcon, newEdge, newPage, newShape, pageBounds, uid, type Align, type Arrow, type Diagram, type Edge, type EdgeStyle, type Page, type Point, type Port, type Shape, type ShapeKind } from "./model";
import { STENCILS, ShapeSvg, ShapeText, StencilIcon } from "./shapes";
import { parseDrawio, toDrawio } from "./drawio";
import { TEMPLATES, blankDiagram } from "./templates";

const COLOR = "#4f52b2";
const GRID = 10;
const FILTER: FileFilter = { name: "draw.io", extensions: ["drawio"] };
const CLIP = "ondura.diagram.clipboard";
const SWATCHES = ["#ffffff", "#f5f5f5", "#dae8fc", "#d5e8d4", "#fff2cc", "#f8cecc", "#e1d5e7", "#ffe6cc", "#6c8ebf", "#82b366", "#d6b656", "#b85450", "#9673a6", "#4f52b2", "#333333", "none"];

type Drag =
  | { kind: "move"; start: Point; orig: Map<string, Point>; edgePts: Map<string, Point[]>; moved: boolean }
  | { kind: "resize"; id: string; handle: string; start: Point; orig: Shape }
  | { kind: "rubber"; start: Point; cur: Point }
  | { kind: "connect"; from: string; port: Port; cur: Point; over: string | null; overPort: Port | null }
  | { kind: "end"; edge: string; which: "source" | "target"; cur: Point; over: string | null; overPort: Port | null }
  | { kind: "pan"; x: number; y: number; sl: number; st: number };

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  main: { flex: 1, minHeight: 0, display: "flex", gap: "8px", margin: "0 8px" },
  panel: { width: "232px", flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden" },
  panelScroll: { flex: 1, overflowY: "auto", padding: "4px 10px 12px" },
  group: { fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground3, margin: "10px 2px 4px" },
  stencils: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "2px" },
  stencil: { border: "none", background: "none", borderRadius: tokens.borderRadiusMedium, cursor: "grab", padding: "2px", display: "flex", justifyContent: "center", color: tokens.colorNeutralForeground2, ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  stage: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden" },
  scroll: { flex: 1, overflow: "auto", position: "relative", backgroundColor: "#ffffff", outline: "none" },
  pages: { display: "flex", alignItems: "center", gap: "2px", padding: "2px 8px", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground2, overflowX: "auto" },
  pageTab: { border: "none", background: "none", padding: "5px 12px", borderRadius: tokens.borderRadiusMedium, cursor: "pointer", fontFamily: "inherit", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, whiteSpace: "nowrap", ":hover": { backgroundColor: tokens.colorNeutralBackground2Hover } },
  pageOn: { backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold, boxShadow: tokens.shadow2 },
  format: { width: "260px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "10px", padding: "12px", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflowY: "auto" },
  formatTitle: { fontWeight: tokens.fontWeightSemibold },
  swatches: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "4px" },
  swatch: { width: "24px", height: "24px", borderRadius: "5px", border: `1px solid ${tokens.colorNeutralStroke1}`, cursor: "pointer", padding: 0 },
  swatchOn: { outline: `2px solid ${COLOR}`, outlineOffset: "1px" },
  row: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
  editor: { position: "absolute", zIndex: 5, border: `1px solid ${COLOR}`, borderRadius: "2px", outline: "none", resize: "none", background: "rgba(255,255,255,0.96)", fontFamily: '"Segoe UI", Inter, Arial, sans-serif', padding: "4px", boxShadow: tokens.shadow8, lineHeight: 1.25 },
  start: { position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", backgroundColor: "var(--nx-solid-bg, #f6f6fa)" },
  tpls: { display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" },
  tpl: { width: "180px", display: "flex", flexDirection: "column", gap: "8px", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", color: tokens.colorNeutralForeground1, alignItems: "center" },
  tplThumb: { width: "180px", height: "130px", borderRadius: tokens.borderRadiusLarge, backgroundColor: "#fff", boxShadow: tokens.shadow8, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: `2px solid transparent`, ":hover": { border: `2px solid ${COLOR}` } },
  muted: { color: tokens.colorNeutralForeground3 },
});

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Static SVG of a page (export, print, thumbnails). */
function StaticPage({ page, pad = 20, scale = 1 }: { page: Page; pad?: number; scale?: number }) {
  const b = pageBounds(page);
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={w * scale} height={h * scale} viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}>
      <rect x={b.x - pad} y={b.y - pad} width={w} height={h} fill={page.background ?? "#ffffff"} />
      <PageContent page={page} />
    </svg>
  );
}

function ArrowMarker({ id, kind, color }: { id: string; kind: Arrow; color: string }) {
  if (kind === "none") return null;
  const path = kind === "diamond" ? "M0,5 L6,0 L12,5 L6,10 Z" : kind === "circle" ? "" : kind === "open" ? "M0,0 L10,5 L0,10" : "M0,0 L10,5 L0,10 Z";
  return (
    <marker id={id} viewBox="0 0 12 10" refX={kind === "diamond" ? 12 : kind === "circle" ? 10 : 10} refY={5} markerWidth={10} markerHeight={10} orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      {kind === "circle" ? <circle cx={5} cy={5} r={4.5} fill={color} /> : <path d={path} fill={kind === "open" ? "none" : color} stroke={color} strokeWidth={1.4} strokeLinejoin="round" />}
    </marker>
  );
}

function EdgeSvg({ e, page, selected }: { e: Edge; page: Page; selected?: boolean }) {
  const r = route(e, page);
  if (!r) return null;
  const mStart = `ms-${e.id}`;
  const mEnd = `me-${e.id}`;
  return (
    <g data-edge={e.id}>
      <defs>
        <ArrowMarker id={mStart} kind={e.startArrow} color={e.stroke} />
        <ArrowMarker id={mEnd} kind={e.endArrow} color={e.stroke} />
      </defs>
      <path d={r.d} fill="none" stroke="transparent" strokeWidth={12} data-edge-hit={e.id} />
      <path d={r.d} fill="none" stroke={selected ? COLOR : e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={e.dashed ? `${e.strokeWidth * 4} ${e.strokeWidth * 3}` : undefined} markerStart={e.startArrow !== "none" ? `url(#${mStart})` : undefined} markerEnd={e.endArrow !== "none" ? `url(#${mEnd})` : undefined} pointerEvents="none" />
      {e.text && (
        <g pointerEvents="none">
          <rect x={r.mid.x - (e.text.length * e.fontSize * 0.3 + 6)} y={r.mid.y - e.fontSize * 0.75} width={e.text.length * e.fontSize * 0.6 + 12} height={e.fontSize * 1.5} fill="#ffffff" opacity={0.9} rx={3} />
          <ShapeText s={{ text: e.text, fontSize: e.fontSize, fontColor: "#1f1f1f", bold: false, italic: false, align: "center" }} box={{ x: r.mid.x - 150, y: r.mid.y - e.fontSize, w: 300, h: e.fontSize * 2 }} />
        </g>
      )}
    </g>
  );
}

function PageContent({ page, selection }: { page: Page; selection?: Set<string> }) {
  // Containers lie behind everything else.
  const shapes = [...page.shapes.filter((s) => s.kind === "container"), ...page.shapes.filter((s) => s.kind !== "container")];
  return (
    <>
      {shapes.map((s) => (
        <ShapeSvg key={s.id} s={s} selected={selection?.has(s.id)} />
      ))}
      {page.edges.map((e) => (
        <EdgeSvg key={e.id} e={e} page={page} selected={selection?.has(e.id)} />
      ))}
    </>
  );
}

function svgMarkup(page: Page, scale = 1): string {
  return renderToStaticMarkup(<StaticPage page={page} scale={scale} />);
}

async function svgToPng(svg: string): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function DiagramApp() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();
  const [doc, setDoc] = useState<Diagram>(blankDiagram);
  const [pageIdx, setPageIdx] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(true);
  const [snapOn, setSnapOn] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [name, setName] = useState(tl("Diagramm"));
  const [dirty, setDirty] = useState(false);
  const [startOpen, setStartOpen] = useState(() => !initialFile());
  const [tab, setTab] = useState("start");
  const [stencilFilter, setStencilFilter] = useState("");
  const [printing, setPrinting] = useState(false);
  const undo = useRef<Diagram[]>([]);
  const redo = useRef<Diagram[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const page = doc.pages[Math.min(pageIdx, doc.pages.length - 1)];
  const selSet = useMemo(() => new Set(sel), [sel]);
  const selShapes = page.shapes.filter((x) => selSet.has(x.id));
  const selEdges = page.edges.filter((x) => selSet.has(x.id));

  // ---------------------------------------------------------- history --

  /** Changes the current page (one undo step unless `merge`). */
  const commit = useCallback(
    (fn: (p: Page) => Page, merge = false) => {
      setDoc((d) => {
        if (!merge) {
          undo.current = [...undo.current.slice(-80), d];
          redo.current = [];
        }
        const pages = d.pages.map((p, i) => (i === Math.min(pageIdx, d.pages.length - 1) ? fn(p) : p));
        return { ...d, pages };
      });
      setDirty(true);
    },
    [pageIdx],
  );
  const commitDoc = (fn: (d: Diagram) => Diagram) => {
    setDoc((d) => {
      undo.current = [...undo.current.slice(-80), d];
      redo.current = [];
      return fn(d);
    });
    setDirty(true);
  };
  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(docRef.current);
    setDoc(prev);
    setDirty(true);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(docRef.current);
    setDoc(next);
    setDirty(true);
  };

  // ------------------------------------------------------------- file --

  const load = useCallback(
    async (text: string, file: string | null, fileName: string) => {
      try {
        const d = await parseDrawio(text);
        setDoc(d);
        setPageIdx(0);
        setSel([]);
        undo.current = [];
        redo.current = [];
        setPath(file);
        setName(fileName.replace(/\.(drawio|xml)$/i, ""));
        setDirty(false);
        setStartOpen(false);
      } catch (e) {
        notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error");
      }
    },
    [notify],
  );

  useEffect(() => {
    setTimeout(splashDone, 50);
    const f = initialFile();
    if (f) void readTextFile(f).then((t) => load(t, f, f.split(/[\\/]/).pop() ?? f), (e) => notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error"));
  }, [load, notify]);

  useEffect(() => {
    void setWindowTitle(`${name}${dirty ? " •" : ""} – ${tl("Ondura Diagramme")}`);
  }, [name, dirty]);

  const save = useCallback(
    async (as = false): Promise<boolean> => {
      try {
        const target = await saveFile(as ? null : path, name, FILTER, toDrawio(docRef.current), "application/xml");
        if (!target) return false;
        if (isTauri) {
          setPath(target);
          setName((target.split(/[\\/]/).pop() ?? target).replace(/\.drawio$/i, ""));
        }
        setDirty(false);
        notify(tl("Gespeichert"), target.split(/[\\/]/).pop());
        return true;
      } catch (e) {
        notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
        return false;
      }
    },
    [path, name, notify],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(name), () => save()), [name, save, unsaved]);

  const openFile = async () => {
    const f = await openTextFile([{ name: tl("Diagramme"), extensions: ["drawio", "xml"] }]);
    if (!f) return;
    if (dirtyRef.current || path) {
      if (isTauri && f.path) {
        const { invoke } = await import("@tauri-apps/api/core");
        return void invoke("open_document", { appId: "diagram", path: f.path });
      }
    }
    await load(f.text, f.path, f.name);
  };

  const newFrom = async (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
    if ((dirtyRef.current || path) && isTauri) {
      // Like Office: a new document opens in a new window.
      localStorage.setItem("ondura.diagram.template", id);
      const { invoke } = await import("@tauri-apps/api/core");
      return void invoke("open_document", { appId: "diagram", path: null });
    }
    setDoc(t.make());
    setPageIdx(0);
    setSel([]);
    undo.current = [];
    redo.current = [];
    setPath(null);
    setName(tl("Diagramm"));
    setDirty(false);
    setStartOpen(false);
  };

  // A template chosen in another window.
  useEffect(() => {
    const id = localStorage.getItem("ondura.diagram.template");
    if (id && !initialFile()) {
      localStorage.removeItem("ondura.diagram.template");
      void newFrom(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------- export --

  const exportAs = async (kind: "svg" | "png" | "pdf") => {
    try {
      if (!page.shapes.length && !page.edges.length) return notify(tl("Die Seite ist leer."), undefined, "info");
      const base = `${name}${doc.pages.length > 1 ? ` – ${page.name}` : ""}`;
      let data: Uint8Array;
      let filter: FileFilter;
      let mime: string;
      if (kind === "svg") {
        data = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${svgMarkup(page)}`);
        filter = { name: "SVG", extensions: ["svg"] };
        mime = "image/svg+xml";
      } else if (kind === "png") {
        data = new Uint8Array(await (await svgToPng(svgMarkup(page, 2))).arrayBuffer());
        filter = { name: "PNG", extensions: ["png"] };
        mime = "image/png";
      } else {
        const pdf = await PDFDocument.create();
        for (const p of doc.pages) {
          if (!p.shapes.length && !p.edges.length) continue;
          const png = await pdf.embedPng(new Uint8Array(await (await svgToPng(svgMarkup(p, 3))).arrayBuffer()));
          const b = pageBounds(p);
          const w = (b.w + 40) * 0.75;
          const h = (b.h + 40) * 0.75;
          pdf.addPage([w, h]).drawImage(png, { x: 0, y: 0, width: w, height: h });
        }
        data = await pdf.save();
        filter = { name: tl("PDF-Dokument"), extensions: ["pdf"] };
        mime = "application/pdf";
      }
      const target = await saveFile(null, base, filter, data, mime);
      if (target) notify(tl("Exportiert"), target.split(/[\\/]/).pop());
    } catch (e) {
      notify(tl("Export fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const print = () => {
    setSel([]);
    setPrinting(true);
    const style = document.createElement("style");
    style.textContent = `@page { margin: 12mm; ${NO_BROWSER_HEADER} } @media print { #root { display: none !important; } .nx-diagram-print { display: block !important; } .nx-diagram-print svg { width: 100%; height: auto; max-height: 100vh; break-after: page; } }`;
    document.head.appendChild(style);
    setTimeout(() => {
      window.print();
      style.remove();
      setPrinting(false);
    }, 200);
  };

  // ---------------------------------------------------------- editing --

  const toDoc = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const vb = svgRef.current!.viewBox.baseVal;
    return { x: (clientX - r.left) / zoom + vb.x, y: (clientY - r.top) / zoom + vb.y };
  };

  const addShape = (kind: ShapeKind, text = "", at?: Point) => {
    let p = at;
    if (!p) {
      const el = scroller.current!;
      const vb = svgRef.current!.viewBox.baseVal;
      p = { x: (el.scrollLeft + el.clientWidth / 2) / zoom + vb.x, y: (el.scrollTop + el.clientHeight / 2) / zoom + vb.y };
    }
    const sh = newShape(kind, 0, 0, text);
    sh.x = snap(p.x - sh.w / 2, GRID, snapOn);
    sh.y = snap(p.y - sh.h / 2, GRID, snapOn);
    commit((pg) => ({ ...pg, shapes: [...pg.shapes, sh] }));
    setSel([sh.id]);
    return sh;
  };

  const removeSelection = () => {
    if (!sel.length) return;
    commit((pg) => ({
      ...pg,
      shapes: pg.shapes.filter((x) => !selSet.has(x.id)),
      // Connectors of removed shapes go with them.
      edges: pg.edges.filter((e) => !selSet.has(e.id) && !selSet.has(e.source ?? "") && !selSet.has(e.target ?? "")),
    }));
    setSel([]);
  };

  const patchShapes = (patch: Partial<Shape>) => commit((pg) => ({ ...pg, shapes: pg.shapes.map((x) => (selSet.has(x.id) ? { ...x, ...patch } : x)) }));
  const patchEdges = (patch: Partial<Edge>) => commit((pg) => ({ ...pg, edges: pg.edges.map((x) => (selSet.has(x.id) ? { ...x, ...patch } : x)) }));

  const copy = (cut = false) => {
    const shapes = clone(selShapes);
    const ids = new Set(shapes.map((x) => x.id));
    const edges = clone(page.edges.filter((e) => selSet.has(e.id) || (ids.has(e.source ?? "") && ids.has(e.target ?? ""))));
    if (!shapes.length && !edges.length) return;
    try {
      localStorage.setItem(CLIP, JSON.stringify({ shapes, edges }));
    } catch {
      /* too large */
    }
    if (cut) removeSelection();
  };

  const paste = (offset = 20) => {
    let clip: { shapes: Shape[]; edges: Edge[] } | null = null;
    try {
      clip = JSON.parse(localStorage.getItem(CLIP) ?? "null");
    } catch {
      clip = null;
    }
    if (!clip) return;
    const map = new Map<string, string>();
    const shapes = clip.shapes.map((x) => {
      const id = uid("s");
      map.set(x.id, id);
      return { ...x, id, x: x.x + offset, y: x.y + offset };
    });
    const edges = clip.edges.map((e) => ({
      ...e,
      id: uid("e"),
      source: e.source ? (map.get(e.source) ?? null) : null,
      target: e.target ? (map.get(e.target) ?? null) : null,
      from: e.from ? { x: e.from.x + offset, y: e.from.y + offset } : e.source && !map.get(e.source) ? null : e.from,
      to: e.to ? { x: e.to.x + offset, y: e.to.y + offset } : e.to,
      points: e.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
    }));
    commit((pg) => ({ ...pg, shapes: [...pg.shapes, ...shapes], edges: [...pg.edges, ...edges] }));
    setSel([...shapes.map((x) => x.id), ...edges.map((x) => x.id)]);
    try {
      // The next paste lands a bit further away.
      localStorage.setItem(CLIP, JSON.stringify({ shapes: shapes, edges }));
    } catch {
      /* ignore */
    }
  };

  const duplicate = () => {
    copy();
    paste();
  };

  const order = (front: boolean) =>
    commit((pg) => {
      const picked = pg.shapes.filter((x) => selSet.has(x.id));
      const rest = pg.shapes.filter((x) => !selSet.has(x.id));
      return { ...pg, shapes: front ? [...rest, ...picked] : [...picked, ...rest] };
    });

  const align = (how: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    if (selShapes.length < 2) return;
    const x0 = Math.min(...selShapes.map((x) => x.x));
    const x1 = Math.max(...selShapes.map((x) => x.x + x.w));
    const y0 = Math.min(...selShapes.map((x) => x.y));
    const y1 = Math.max(...selShapes.map((x) => x.y + x.h));
    commit((pg) => ({
      ...pg,
      shapes: pg.shapes.map((x) => {
        if (!selSet.has(x.id)) return x;
        switch (how) {
          case "left":
            return { ...x, x: x0 };
          case "right":
            return { ...x, x: x1 - x.w };
          case "center":
            return { ...x, x: Math.round((x0 + x1) / 2 - x.w / 2) };
          case "top":
            return { ...x, y: y0 };
          case "bottom":
            return { ...x, y: y1 - x.h };
          default:
            return { ...x, y: Math.round((y0 + y1) / 2 - x.h / 2) };
        }
      }),
    }));
  };

  const distribute = (axis: "h" | "v") => {
    if (selShapes.length < 3) return;
    const list = [...selShapes].sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
    const first = list[0];
    const last = list[list.length - 1];
    const total = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
    const sizes = list.reduce((n, x) => n + (axis === "h" ? x.w : x.h), 0);
    const gap = (total - sizes) / (list.length - 1);
    let pos = axis === "h" ? first.x : first.y;
    const at = new Map<string, number>();
    for (const x of list) {
      at.set(x.id, Math.round(pos));
      pos += (axis === "h" ? x.w : x.h) + gap;
    }
    commit((pg) => ({ ...pg, shapes: pg.shapes.map((x) => (at.has(x.id) ? (axis === "h" ? { ...x, x: at.get(x.id)! } : { ...x, y: at.get(x.id)! }) : x)) }));
  };

  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    const b = pageBounds(page);
    const z = Math.max(0.2, Math.min(2, Math.min((el.clientWidth - 80) / Math.max(200, b.w), (el.clientHeight - 80) / Math.max(150, b.h))));
    setZoom(Math.round(z * 100) / 100);
  };

  // ------------------------------------------------------ interaction --

  const shapeAt = (p: Point, exclude?: string): Shape | null => {
    for (let i = page.shapes.length - 1; i >= 0; i--) {
      const x = page.shapes[i];
      if (x.id === exclude) continue;
      // Containers are only hit on their header or border.
      if (x.kind === "container" && p.y > x.y + 30 && p.x > x.x + 6 && p.x < x.x + x.w - 6 && p.y < x.y + x.h - 6) continue;
      if (p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + x.h) return x;
    }
    return null;
  };

  const nearPort = (sh: Shape, p: Point): Port | null => {
    let best: Port | null = null;
    let dist = 16 / zoom;
    for (const port of PORTS) {
      const q = portPoint(sh, port);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < dist) (best = port), (dist = d);
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) commitText();
    const target = e.target as Element;
    const p = toDoc(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      const el = scroller.current!;
      setDrag({ kind: "pan", x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop });
      return;
    }
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const portEl = target.closest("[data-port]");
    if (portEl) {
      const [id, i] = portEl.getAttribute("data-port")!.split("|");
      setDrag({ kind: "connect", from: id, port: PORTS[Number(i)], cur: p, over: null, overPort: null });
      return;
    }
    const endEl = target.closest("[data-end]");
    if (endEl) {
      const [id, which] = endEl.getAttribute("data-end")!.split("|");
      setDrag({ kind: "end", edge: id, which: which as "source" | "target", cur: p, over: null, overPort: null });
      return;
    }
    const handleEl = target.closest("[data-handle]");
    if (handleEl && selShapes.length === 1) {
      setDrag({ kind: "resize", id: selShapes[0].id, handle: handleEl.getAttribute("data-handle")!, start: p, orig: clone(selShapes[0]) });
      return;
    }
    const edgeId = target.closest("[data-edge-hit]")?.getAttribute("data-edge-hit");
    const shape = edgeId ? null : shapeAt(p);
    const id = edgeId ?? shape?.id ?? null;
    if (!id) {
      if (!e.shiftKey) setSel([]);
      setDrag({ kind: "rubber", start: p, cur: p });
      return;
    }
    let next = sel;
    if (e.shiftKey || e.ctrlKey || e.metaKey) next = selSet.has(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else if (!selSet.has(id)) next = [id];
    setSel(next);
    if (edgeId) return;
    // Moving: the selected shapes (and the shapes inside a moved container).
    const ids = new Set(next.filter((x) => page.shapes.some((sh) => sh.id === x)));
    for (const c of page.shapes.filter((x) => ids.has(x.id) && x.kind === "container")) for (const x of page.shapes) if (x.x >= c.x && x.y >= c.y && x.x + x.w <= c.x + c.w && x.y + x.h <= c.y + c.h) ids.add(x.id);
    const orig = new Map<string, Point>();
    for (const x of page.shapes) if (ids.has(x.id)) orig.set(x.id, { x: x.x, y: x.y });
    const edgePts = new Map<string, Point[]>();
    for (const ed of page.edges) if ((ed.source && ids.has(ed.source)) || (ed.target && ids.has(ed.target)) || next.includes(ed.id)) edgePts.set(ed.id, clone(ed.points));
    setDrag({ kind: "move", start: p, orig, edgePts, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e.clientX, e.clientY);
    if (!drag) {
      const sh = shapeAt(p);
      setHover(sh?.id ?? (hover && page.shapes.find((x) => x.id === hover && p.x >= x.x - 14 && p.x <= x.x + x.w + 14 && p.y >= x.y - 14 && p.y <= x.y + x.h + 14) ? hover : null));
      return;
    }
    switch (drag.kind) {
      case "pan": {
        const el = scroller.current!;
        el.scrollLeft = drag.sl - (e.clientX - drag.x);
        el.scrollTop = drag.st - (e.clientY - drag.y);
        return;
      }
      case "rubber":
        return setDrag({ ...drag, cur: p });
      case "connect":
      case "end": {
        const exclude = drag.kind === "connect" ? drag.from : undefined;
        const over = shapeAt(p, exclude);
        return setDrag({ ...drag, cur: p, over: over?.id ?? null, overPort: over ? nearPort(over, p) : null });
      }
      case "move": {
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3 / zoom) return;
        const first = [...drag.orig.values()][0];
        if (first && snapOn) {
          dx = snap(first.x + dx, GRID, true) - first.x;
          dy = snap(first.y + dy, GRID, true) - first.y;
        }
        commit(
          (pg) => ({
            ...pg,
            shapes: pg.shapes.map((x) => {
              const o = drag.orig.get(x.id);
              return o ? { ...x, x: o.x + dx, y: o.y + dy } : x;
            }),
            edges: pg.edges.map((ed) => {
              const pts = drag.edgePts.get(ed.id);
              if (!pts) return ed;
              // Bends move along when both ends move (or the edge itself is selected).
              const both = (!ed.source || drag.orig.has(ed.source)) && (!ed.target || drag.orig.has(ed.target));
              return both ? { ...ed, points: pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : ed;
            }),
          }),
          drag.moved,
        );
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case "resize": {
        const o = drag.orig;
        let { x, y, w, h } = o;
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (drag.handle.includes("e")) w = Math.max(20, snap(o.w + dx, GRID, snapOn));
        if (drag.handle.includes("s")) h = Math.max(16, snap(o.h + dy, GRID, snapOn));
        if (drag.handle.includes("w")) {
          const nx = Math.min(o.x + o.w - 20, snap(o.x + dx, GRID, snapOn));
          w = o.w + (o.x - nx);
          x = nx;
        }
        if (drag.handle.includes("n")) {
          const ny = Math.min(o.y + o.h - 16, snap(o.y + dy, GRID, snapOn));
          h = o.h + (o.y - ny);
          y = ny;
        }
        if (e.shiftKey && o.w && o.h) {
          // Keep the proportions.
          const k = Math.max(w / o.w, h / o.h);
          w = Math.round(o.w * k);
          h = Math.round(o.h * k);
        }
        const merge = !!(drag as { started?: boolean }).started;
        commit((pg) => ({ ...pg, shapes: pg.shapes.map((sh) => (sh.id === drag.id ? { ...sh, x, y, w, h } : sh)) }), merge);
        if (!merge) setDrag({ ...drag, started: true } as Drag);
        return;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "rubber") {
      const r = { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), w: Math.abs(d.cur.x - d.start.x), h: Math.abs(d.cur.y - d.start.y) };
      if (r.w > 4 || r.h > 4) setSel((cur) => [...new Set([...cur, ...inRect(page, r)])]);
    } else if (d.kind === "connect") {
      const len = Math.hypot(d.cur.x - portPoint(page.shapes.find((x) => x.id === d.from)!, d.port).x, d.cur.y - portPoint(page.shapes.find((x) => x.id === d.from)!, d.port).y);
      if (len < 8 && !d.over) return;
      const e = newEdge(d.from, d.over);
      e.sourcePort = d.port;
      e.targetPort = d.over ? d.overPort : null;
      if (!d.over) e.to = { x: snap(d.cur.x, GRID, snapOn), y: snap(d.cur.y, GRID, snapOn) };
      commit((pg) => ({ ...pg, edges: [...pg.edges, e] }));
      setSel([e.id]);
    } else if (d.kind === "end") {
      commit((pg) => ({
        ...pg,
        edges: pg.edges.map((ed) => {
          if (ed.id !== d.edge) return ed;
          const free = { x: snap(d.cur.x, GRID, snapOn), y: snap(d.cur.y, GRID, snapOn) };
          return d.which === "source"
            ? { ...ed, source: d.over, sourcePort: d.over ? d.overPort : null, from: d.over ? null : free, points: [] }
            : { ...ed, target: d.over, targetPort: d.over ? d.overPort : null, to: d.over ? null : free, points: [] };
        }),
      }));
    }
  };

  const startEdit = (id: string) => {
    const sh = page.shapes.find((x) => x.id === id);
    const ed = page.edges.find((x) => x.id === id);
    if (sh) setEditing({ id, value: sh.text });
    else if (ed) setEditing({ id, value: ed.text });
  };

  const commitText = () => {
    if (!editing) return;
    const { id, value } = editing;
    setEditing(null);
    const sh = page.shapes.find((x) => x.id === id);
    const ed = page.edges.find((x) => x.id === id);
    if (sh && sh.text !== value) commit((pg) => ({ ...pg, shapes: pg.shapes.map((x) => (x.id === id ? { ...x, text: value } : x)) }));
    if (ed && ed.text !== value) commit((pg) => ({ ...pg, edges: pg.edges.map((x) => (x.id === id ? { ...x, text: value } : x)) }));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toDoc(e.clientX, e.clientY);
    const edgeId = (e.target as Element).closest("[data-edge-hit]")?.getAttribute("data-edge-hit");
    if (edgeId) return startEdit(edgeId);
    const sh = shapeAt(p);
    if (sh) return startEdit(sh.id);
    const t = addShape("text", "", p);
    setEditing({ id: t.id, value: "" });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "s") return e.preventDefault(), void save(e.shiftKey);
      if (ctrl && k === "o") return e.preventDefault(), void openFile();
      if (ctrl && k === "p") return e.preventDefault(), print();
      if (typing) return;
      if (ctrl && k === "z") return e.preventDefault(), e.shiftKey ? doRedo() : doUndo();
      if (ctrl && k === "y") return e.preventDefault(), doRedo();
      if (ctrl && k === "c") return e.preventDefault(), copy();
      if (ctrl && k === "x") return e.preventDefault(), copy(true);
      if (ctrl && k === "v") return e.preventDefault(), paste();
      if (ctrl && k === "d") return e.preventDefault(), duplicate();
      if (ctrl && k === "a") return e.preventDefault(), setSel([...page.shapes.map((x) => x.id), ...page.edges.map((x) => x.id)]);
      if (ctrl && (k === "+" || k === "=")) return e.preventDefault(), setZoom((z) => Math.min(4, z * 1.2));
      if (ctrl && k === "-") return e.preventDefault(), setZoom((z) => Math.max(0.2, z / 1.2));
      if (ctrl && k === "0") return e.preventDefault(), fit();
      if (k === "delete" || k === "backspace") return e.preventDefault(), removeSelection();
      if (k === "escape") return setSel([]);
      if (k === "f2" && sel.length === 1) return e.preventDefault(), startEdit(sel[0]);
      if (k.startsWith("arrow") && selShapes.length) {
        e.preventDefault();
        const step = e.shiftKey ? GRID : 1;
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
        const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
        commit((pg) => ({ ...pg, shapes: pg.shapes.map((x) => (selSet.has(x.id) ? { ...x, x: x.x + dx, y: x.y + dy } : x)) }));
        return;
      }
      // Typing on a selected shape starts editing its text.
      if (!ctrl && !e.altKey && e.key.length === 1 && sel.length === 1) {
        const sh = page.shapes.find((x) => x.id === sel[0]);
        if (sh) {
          e.preventDefault();
          setEditing({ id: sh.id, value: e.key });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Ctrl + wheel zooms.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(4, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ------------------------------------------------------------ pages --

  const addPage = () => {
    commitDoc((d) => ({ ...d, pages: [...d.pages, newPage(tl("Seite-{0}", d.pages.length + 1))] }));
    setPageIdx(doc.pages.length);
    setSel([]);
  };
  const renamePage = (i: number) => {
    const n = prompt(tl("Seite umbenennen"), doc.pages[i].name);
    if (n?.trim()) commitDoc((d) => ({ ...d, pages: d.pages.map((p, j) => (j === i ? { ...p, name: n.trim() } : p)) }));
  };
  const deletePage = (i: number) => {
    if (doc.pages.length < 2 || !confirm(tl("Seite „{0}“ löschen?", doc.pages[i].name))) return;
    commitDoc((d) => ({ ...d, pages: d.pages.filter((_, j) => j !== i) }));
    setPageIdx((x) => Math.max(0, Math.min(x, doc.pages.length - 2)));
    setSel([]);
  };
  const duplicatePage = (i: number) => {
    const copyP = { ...clone(doc.pages[i]), id: uid("p"), name: tl("{0} (Kopie)", doc.pages[i].name) };
    commitDoc((d) => ({ ...d, pages: [...d.pages.slice(0, i + 1), copyP, ...d.pages.slice(i + 1)] }));
    setPageIdx(i + 1);
  };

  // ------------------------------------------------------------- view --

  const bounds = pageBounds(page);
  const vb = { x: Math.min(0, bounds.x - 200), y: Math.min(0, bounds.y - 200), w: 0, h: 0 };
  vb.w = Math.max(2400, bounds.x + bounds.w + 600 - vb.x);
  vb.h = Math.max(1600, bounds.y + bounds.h + 600 - vb.y);

  const handles = (sh: Shape) => {
    const k = 1 / zoom;
    const pts: [string, number, number][] = [
      ["nw", 0, 0],
      ["n", 0.5, 0],
      ["ne", 1, 0],
      ["e", 1, 0.5],
      ["se", 1, 1],
      ["s", 0.5, 1],
      ["sw", 0, 1],
      ["w", 0, 0.5],
    ];
    return pts.map(([h, fx, fy]) => (
      <rect key={h} data-handle={h} x={sh.x + sh.w * fx - 4 * k} y={sh.y + sh.h * fy - 4 * k} width={8 * k} height={8 * k} fill="#fff" stroke={COLOR} strokeWidth={1.2 * k} style={{ cursor: `${h}-resize` }} />
    ));
  };

  const portDots = (sh: Shape) =>
    PORTS.map((port, i) => {
      const q = portPoint(sh, port);
      const d = portDir(port);
      const k = 1 / zoom;
      return (
        <g key={i} data-port={`${sh.id}|${i}`} style={{ cursor: "crosshair" }}>
          <circle cx={q.x + d.x * 14 * k} cy={q.y + d.y * 14 * k} r={9 * k} fill={COLOR} opacity={0.12} />
          <path d={`M${q.x + d.x * 8 * k},${q.y + d.y * 8 * k} L${q.x + d.x * 18 * k},${q.y + d.y * 18 * k}`} stroke={COLOR} strokeWidth={2 * k} markerEnd="url(#port-arrow)" />
          <circle cx={q.x} cy={q.y} r={3.5 * k} fill="#fff" stroke={COLOR} strokeWidth={1.4 * k} />
        </g>
      );
    });

  const overlay: ReactNode[] = [];
  if (selShapes.length === 1 && !drag) overlay.push(...handles(selShapes[0]));
  const portShape = page.shapes.find((x) => x.id === (drag?.kind === "connect" || drag?.kind === "end" ? drag.over : (hover ?? (selShapes.length === 1 ? selShapes[0].id : null))));
  if (portShape && (!drag || drag.kind === "connect" || drag.kind === "end")) overlay.push(<g key="ports">{portDots(portShape)}</g>);
  for (const ed of selEdges) {
    const r = route(ed, page);
    if (!r) continue;
    const k = 1 / zoom;
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    overlay.push(<circle key={`${ed.id}a`} data-end={`${ed.id}|source`} cx={a.x} cy={a.y} r={5 * k} fill={ed.source ? COLOR : "#fff"} stroke={COLOR} strokeWidth={1.5 * k} style={{ cursor: "move" }} />);
    overlay.push(<circle key={`${ed.id}b`} data-end={`${ed.id}|target`} cx={b.x} cy={b.y} r={5 * k} fill={ed.target ? COLOR : "#fff"} stroke={COLOR} strokeWidth={1.5 * k} style={{ cursor: "move" }} />);
  }
  if (drag?.kind === "connect" || drag?.kind === "end") {
    let a: Point;
    if (drag.kind === "connect") a = portPoint(page.shapes.find((x) => x.id === drag.from)!, drag.port);
    else {
      const ed = page.edges.find((x) => x.id === drag.edge)!;
      const r = route(ed, page);
      a = drag.which === "source" ? r!.points[r!.points.length - 1] : r!.points[0];
    }
    const over = page.shapes.find((x) => x.id === drag.over);
    const b = over && drag.overPort ? portPoint(over, drag.overPort) : drag.cur;
    overlay.push(<path key="preview" d={`M${a.x},${a.y} L${b.x},${b.y}`} stroke={COLOR} strokeWidth={1.5 / zoom} strokeDasharray={`${5 / zoom} ${4 / zoom}`} fill="none" pointerEvents="none" />);
    if (over) overlay.push(<rect key="over" x={over.x - 4} y={over.y - 4} width={over.w + 8} height={over.h + 8} fill="none" stroke="#2fb344" strokeWidth={2 / zoom} pointerEvents="none" rx={4} />);
  }
  if (drag?.kind === "rubber") {
    const r = { x: Math.min(drag.start.x, drag.cur.x), y: Math.min(drag.start.y, drag.cur.y), w: Math.abs(drag.cur.x - drag.start.x), h: Math.abs(drag.cur.y - drag.start.y) };
    overlay.push(<rect key="rubber" {...{ x: r.x, y: r.y, width: r.w, height: r.h }} fill="rgba(79,82,178,0.08)" stroke={COLOR} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} pointerEvents="none" />);
  }

  // Text editor over the shape or the edge label.
  let editorBox: { left: number; top: number; width: number; height: number; fontSize: number; align: Align } | null = null;
  if (editing) {
    const sh = page.shapes.find((x) => x.id === editing.id);
    const ed = page.edges.find((x) => x.id === editing.id);
    if (sh) {
      const below = isIcon(sh.kind);
      const box = below ? { x: sh.x - 30, y: sh.y + sh.h + 2, w: sh.w + 60, h: 44 } : { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
      editorBox = { left: (box.x - vb.x) * zoom, top: (box.y - vb.y) * zoom, width: Math.max(80, box.w * zoom), height: Math.max(30, box.h * zoom), fontSize: sh.fontSize * zoom, align: sh.align };
    } else if (ed) {
      const r = route(ed, page);
      if (r) editorBox = { left: (r.mid.x - 80 - vb.x) * zoom, top: (r.mid.y - 16 - vb.y) * zoom, width: 160 * zoom, height: 32 * zoom, fontSize: ed.fontSize * zoom, align: "center" };
    }
  }

  // ---------------------------------------------------------- ribbon --

  const one = selShapes[0];
  const edge = selEdges[0];
  const tabs: RibbonTab[] = [
    {
      id: "start",
      label: tl("Start"),
      content: (
        <>
          <RibbonGroup label={tl("Datei")}>
            <BigButton icon={<Save24Regular />} label={tl("Speichern")} onClick={() => void save()} />
            <Rows>
              <Row>
                <SmallButton icon={<FolderOpen24Regular />} label={tl("Öffnen")} text={tl("Öffnen")} onClick={() => void openFile()} shortcut="Strg+O" />
              </Row>
              <Row>
                <SmallButton icon={<SaveEdit24Regular />} label={tl("Speichern unter")} text={tl("Speichern unter")} onClick={() => void save(true)} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Zwischenablage")}>
            <BigButton icon={<ClipboardPaste24Regular />} label={tl("Einfügen")} onClick={() => paste()} />
            <Rows>
              <Row>
                <SmallButton icon={<Cut24Regular />} label={tl("Ausschneiden")} onClick={() => copy(true)} disabled={!sel.length} shortcut="Strg+X" />
                <SmallButton icon={<Copy24Regular />} label={tl("Kopieren")} onClick={() => copy()} disabled={!sel.length} shortcut="Strg+C" />
              </Row>
              <Row>
                <SmallButton icon={<ArrowUndo24Regular />} label={tl("Rückgängig")} onClick={doUndo} shortcut="Strg+Z" />
                <SmallButton icon={<ArrowRedo24Regular />} label={tl("Wiederholen")} onClick={doRedo} shortcut="Strg+Y" />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Schriftart")}>
            <Rows>
              <Row>
                <SmallButton icon={<TextBold24Regular />} label={tl("Fett")} pressed={one?.bold} onClick={() => patchShapes({ bold: !one?.bold })} disabled={!one} />
                <SmallButton icon={<TextItalic24Regular />} label={tl("Kursiv")} pressed={one?.italic} onClick={() => patchShapes({ italic: !one?.italic })} disabled={!one} />
              </Row>
              <Row>
                <SmallButton icon={<TextAlignLeft24Regular />} label={tl("Linksbündig")} pressed={one?.align === "left"} onClick={() => patchShapes({ align: "left" })} disabled={!one} />
                <SmallButton icon={<TextAlignCenter24Regular />} label={tl("Zentriert")} pressed={one?.align === "center"} onClick={() => patchShapes({ align: "center" })} disabled={!one} />
                <SmallButton icon={<TextAlignRight24Regular />} label={tl("Rechtsbündig")} pressed={one?.align === "right"} onClick={() => patchShapes({ align: "right" })} disabled={!one} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Anordnen")}>
            <BigButton icon={<PositionToFront24Regular />} label={tl("In den Vordergrund")} onClick={() => order(true)} disabled={!selShapes.length} />
            <BigButton icon={<PositionToBack24Regular />} label={tl("In den Hintergrund")} onClick={() => order(false)} disabled={!selShapes.length} />
            <Rows>
              <Row>
                <SmallButton icon={<AlignLeft24Regular />} label={tl("Links ausrichten")} onClick={() => align("left")} disabled={selShapes.length < 2} />
                <SmallButton icon={<AlignCenterHorizontal24Regular />} label={tl("Horizontal zentrieren")} onClick={() => align("center")} disabled={selShapes.length < 2} />
                <SmallButton icon={<AlignRight24Regular />} label={tl("Rechts ausrichten")} onClick={() => align("right")} disabled={selShapes.length < 2} />
              </Row>
              <Row>
                <SmallButton icon={<AlignTop24Regular />} label={tl("Oben ausrichten")} onClick={() => align("top")} disabled={selShapes.length < 2} />
                <SmallButton icon={<AlignCenterVertical24Regular />} label={tl("Vertikal zentrieren")} onClick={() => align("middle")} disabled={selShapes.length < 2} />
                <SmallButton icon={<AlignBottom24Regular />} label={tl("Unten ausrichten")} onClick={() => align("bottom")} disabled={selShapes.length < 2} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Bearbeiten")}>
            <BigButton icon={<Delete24Regular />} label={tl("Löschen")} onClick={removeSelection} disabled={!sel.length} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "view",
      label: tl("Ansicht"),
      content: (
        <>
          <RibbonGroup label={tl("Zoom")}>
            <BigButton icon={<ZoomFit24Regular />} label={tl("Einpassen")} onClick={fit} />
            <Rows>
              <Row>
                <SmallButton icon={<ZoomIn24Regular />} label={tl("Vergrößern")} onClick={() => setZoom((z) => Math.min(4, z * 1.2))} />
                <SmallButton icon={<ZoomOut24Regular />} label={tl("Verkleinern")} onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))} />
              </Row>
              <Row>
                <SmallButton icon={<span style={{ fontSize: 12, width: 24 }}>100</span>} label={tl("100 %")} text="100 %" onClick={() => setZoom(1)} />
              </Row>
            </Rows>
          </RibbonGroup>
          <RibbonGroup label={tl("Raster")}>
            <BigButton icon={<Grid24Regular />} label={tl("Raster anzeigen")} pressed={grid} onClick={() => setGrid((v) => !v)} />
            <BigButton icon={<Grid24Regular />} label={tl("Am Raster ausrichten")} pressed={snapOn} onClick={() => setSnapOn((v) => !v)} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: "export",
      label: tl("Exportieren"),
      content: (
        <>
          <RibbonGroup label={tl("Exportieren")}>
            <BigButton icon={<DocumentPdf24Regular />} label={tl("PDF")} onClick={() => void exportAs("pdf")} />
            <BigButton icon={<Image24Regular />} label={tl("PNG-Bild")} onClick={() => void exportAs("png")} />
            <BigButton icon={<ArrowExportLtr24Regular />} label={tl("SVG-Grafik")} onClick={() => void exportAs("svg")} />
          </RibbonGroup>
          <RibbonGroup label={tl("Drucken")}>
            <BigButton icon={<Print24Regular />} label={tl("Drucken")} onClick={print} />
          </RibbonGroup>
        </>
      ),
    },
  ];

  // ---------------------------------------------------------- format --

  const swatches = (value: string, onPick: (c: string) => void) => (
    <div className={s.swatches}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={mergeClasses(s.swatch, value === c && s.swatchOn)}
          style={{ background: c === "none" ? "linear-gradient(135deg, #fff 45%, #d13438 45%, #d13438 55%, #fff 55%)" : c }}
          title={c === "none" ? tl("Keine") : c}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );

  const arrowOptions: [Arrow, string][] = [
    ["none", tl("Keine")],
    ["arrow", tl("Pfeil")],
    ["open", tl("Offener Pfeil")],
    ["diamond", tl("Raute")],
    ["circle", tl("Punkt")],
  ];
  const styleOptions: [EdgeStyle, string][] = [
    ["orthogonal", tl("Gewinkelt")],
    ["straight", tl("Gerade")],
    ["curved", tl("Gebogen")],
  ];

  let format: ReactNode;
  if (one) {
    format = (
      <>
        <Text className={s.formatTitle}>{selShapes.length > 1 ? tl("{0} Formen", selShapes.length) : tl("Form")}</Text>
        <Field label={tl("Füllung")}>{swatches(one.fill, (c) => patchShapes({ fill: c }))}</Field>
        <Field label={tl("Linie")}>{swatches(one.stroke, (c) => patchShapes({ stroke: c }))}</Field>
        <div className={s.row}>
          <Field label={tl("Linienstärke")} style={{ width: 110 }}>
            <SpinButton size="small" min={0} max={12} step={0.5} value={one.strokeWidth} onChange={(_, d) => patchShapes({ strokeWidth: Number(d.value ?? d.displayValue) || 0 })} />
          </Field>
          <Checkbox label={tl("Gestrichelt")} checked={one.dashed} onChange={(_, d) => patchShapes({ dashed: !!d.checked })} style={{ marginTop: 18 }} />
        </div>
        <div className={s.row}>
          <Field label={tl("Schriftgröße")} style={{ width: 110 }}>
            <SpinButton size="small" min={6} max={96} value={one.fontSize} onChange={(_, d) => patchShapes({ fontSize: Number(d.value ?? d.displayValue) || 12 })} />
          </Field>
          <ToggleButton size="small" icon={<TextBold24Regular />} checked={one.bold} onClick={() => patchShapes({ bold: !one.bold })} style={{ marginTop: 18 }} />
          <ToggleButton size="small" icon={<TextItalic24Regular />} checked={one.italic} onClick={() => patchShapes({ italic: !one.italic })} style={{ marginTop: 18 }} />
        </div>
        <Field label={tl("Schriftfarbe")}>{swatches(one.fontColor, (c) => patchShapes({ fontColor: c === "none" ? "#000000" : c }))}</Field>
        {selShapes.length === 1 && (
          <div className={s.row}>
            {(["x", "y", "w", "h"] as const).map((k) => (
              <Field key={k} label={{ x: "X", y: "Y", w: tl("Breite"), h: tl("Höhe") }[k]} style={{ width: 106 }}>
                <SpinButton size="small" value={Math.round(one[k])} min={k === "w" || k === "h" ? 10 : -10000} max={20000} onChange={(_, d) => patchShapes({ [k]: Number(d.value ?? d.displayValue) || 0 } as Partial<Shape>)} />
              </Field>
            ))}
          </div>
        )}
        {selShapes.length >= 3 && (
          <div className={s.row}>
            <Button size="small" onClick={() => distribute("h")}>
              {tl("Horizontal verteilen")}
            </Button>
            <Button size="small" onClick={() => distribute("v")}>
              {tl("Vertikal verteilen")}
            </Button>
          </div>
        )}
      </>
    );
  } else if (edge) {
    format = (
      <>
        <Text className={s.formatTitle}>{tl("Verbinder")}</Text>
        <Field label={tl("Linie")}>{swatches(edge.stroke, (c) => patchEdges({ stroke: c === "none" ? "#333333" : c }))}</Field>
        <div className={s.row}>
          <Field label={tl("Linienstärke")} style={{ width: 110 }}>
            <SpinButton size="small" min={0.5} max={12} step={0.5} value={edge.strokeWidth} onChange={(_, d) => patchEdges({ strokeWidth: Number(d.value ?? d.displayValue) || 1 })} />
          </Field>
          <Checkbox label={tl("Gestrichelt")} checked={edge.dashed} onChange={(_, d) => patchEdges({ dashed: !!d.checked })} style={{ marginTop: 18 }} />
        </div>
        <Field label={tl("Verlauf")}>
          <Dropdown size="small" value={styleOptions.find((o) => o[0] === edge.style)?.[1]} selectedOptions={[edge.style]} onOptionSelect={(_, d) => patchEdges({ style: d.optionValue as EdgeStyle, points: [] })}>
            {styleOptions.map(([v, l]) => (
              <Option key={v} value={v}>
                {l}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <div className={s.row}>
          <Field label={tl("Anfang")} style={{ flex: 1 }}>
            <Dropdown size="small" style={{ minWidth: 0 }} value={arrowOptions.find((o) => o[0] === edge.startArrow)?.[1]} selectedOptions={[edge.startArrow]} onOptionSelect={(_, d) => patchEdges({ startArrow: d.optionValue as Arrow })}>
              {arrowOptions.map(([v, l]) => (
                <Option key={v} value={v}>
                  {l}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label={tl("Ende")} style={{ flex: 1 }}>
            <Dropdown size="small" style={{ minWidth: 0 }} value={arrowOptions.find((o) => o[0] === edge.endArrow)?.[1]} selectedOptions={[edge.endArrow]} onOptionSelect={(_, d) => patchEdges({ endArrow: d.optionValue as Arrow })}>
              {arrowOptions.map(([v, l]) => (
                <Option key={v} value={v}>
                  {l}
                </Option>
              ))}
            </Dropdown>
          </Field>
        </div>
        <Field label={tl("Beschriftung")}>
          <Input size="small" value={edge.text} onChange={(_, d) => patchEdges({ text: d.value })} />
        </Field>
      </>
    );
  } else {
    format = (
      <>
        <Text className={s.formatTitle}>{tl("Seite")}</Text>
        <Field label={tl("Name")}>
          <Input size="small" value={page.name} onChange={(_, d) => commit((pg) => ({ ...pg, name: d.value }), true)} />
        </Field>
        <Field label={tl("Hintergrund")}>{swatches(page.background ?? "#ffffff", (c) => commit((pg) => ({ ...pg, background: c === "none" || c === "#ffffff" ? null : c })))}</Field>
        <Checkbox label={tl("Raster anzeigen")} checked={grid} onChange={() => setGrid((v) => !v)} />
        <Checkbox label={tl("Am Raster ausrichten")} checked={snapOn} onChange={() => setSnapOn((v) => !v)} />
        <Text size={200} className={s.muted}>
          {tl("Tipp: Ziehen Sie an den blauen Pfeilen einer Form, um sie zu verbinden. Doppelklick bearbeitet den Text, Doppelklick auf eine freie Stelle fügt Text ein.")}
        </Text>
      </>
    );
  }

  const q = stencilFilter.trim().toLowerCase();

  return (
    <div className={s.root}>
      <SuiteHeader appName={tlc("app", "Diagramme")} logo="/diagram.svg" center={`${name}${dirty ? " •" : ""}${!path ? tl(" – nicht gespeichert") : ""}`} />
      <div style={{ padding: "0 0 8px" }}>
        <OfficeRibbon tabs={tabs} active={tab} onTab={setTab} onFile={() => setStartOpen(true)} color={COLOR} />
      </div>
      <div className={s.main}>
        <div className={s.panel}>
          <div style={{ padding: "8px 8px 0" }}>
            <SearchBox size="small" placeholder={tl("Formen suchen")} value={stencilFilter} onChange={(_, d) => setStencilFilter(d.value)} style={{ width: "100%" }} />
          </div>
          <div className={s.panelScroll}>
            {STENCILS.map((g) => {
              const items = g.items.filter((it) => !q || it.label().toLowerCase().includes(q));
              if (!items.length) return null;
              return (
                <div key={g.group()}>
                  <div className={s.group}>{g.group()}</div>
                  <div className={s.stencils}>
                    {items.map((it, i) => (
                      <Tooltip key={i} content={it.label()} relationship="label">
                        <button
                          className={s.stencil}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("application/x-ondura-shape", JSON.stringify({ kind: it.kind, text: it.text?.() ?? "" }))}
                          onClick={() => addShape(it.kind, it.text?.() ?? "")}
                        >
                          <StencilIcon kind={it.kind} />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={s.stage} style={{ position: "relative" }}>
          <div
            className={s.scroll}
            ref={scroller}
            tabIndex={0}
            onDragOver={(e) => e.dataTransfer.types.includes("application/x-ondura-shape") && e.preventDefault()}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData("application/x-ondura-shape");
              if (!raw) return;
              e.preventDefault();
              const { kind, text } = JSON.parse(raw) as { kind: ShapeKind; text: string };
              addShape(kind, text, toDoc(e.clientX, e.clientY));
            }}
            style={{ backgroundColor: page.background ?? "#ffffff" }}
          >
            <svg
              ref={svgRef}
              width={vb.w * zoom}
              height={vb.h * zoom}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => !drag && setHover(null)}
              onDoubleClick={onDoubleClick}
              onContextMenu={(e) => {
                const p = toDoc(e.clientX, e.clientY);
                const edgeId = (e.target as Element).closest("[data-edge-hit]")?.getAttribute("data-edge-hit");
                const sh = edgeId ? null : shapeAt(p);
                const id = edgeId ?? sh?.id;
                if (id && !selSet.has(id)) setSel([id]);
                openContextMenu(e, [
                  !!id && { label: tl("Text bearbeiten"), onClick: () => startEdit(id) },
                  !!id && { label: tl("Ausschneiden"), shortcut: "Strg+X", onClick: () => copy(true) },
                  !!id && { label: tl("Kopieren"), shortcut: "Strg+C", onClick: () => copy() },
                  { label: tl("Einfügen"), shortcut: "Strg+V", onClick: () => paste() },
                  !!id && { label: tl("Duplizieren"), shortcut: "Strg+D", onClick: duplicate },
                  sh && "divider",
                  sh && { label: tl("In den Vordergrund"), onClick: () => order(true) },
                  sh && { label: tl("In den Hintergrund"), onClick: () => order(false) },
                  !!id && "divider",
                  !!id && { label: tl("Löschen"), shortcut: "Entf", onClick: removeSelection },
                ]);
              }}
              style={{ display: "block", touchAction: "none", cursor: drag?.kind === "pan" ? "grabbing" : undefined }}
            >
              <defs>
                <pattern id="nx-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <path d={`M${GRID},0 L0,0 0,${GRID}`} fill="none" stroke="#e6e6ef" strokeWidth={0.6} />
                </pattern>
                <pattern id="nx-grid5" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
                  <rect width={GRID * 5} height={GRID * 5} fill="url(#nx-grid)" />
                  <path d={`M${GRID * 5},0 L0,0 0,${GRID * 5}`} fill="none" stroke="#d6d6e4" strokeWidth={0.8} />
                </pattern>
                <marker id="port-arrow" viewBox="0 0 10 10" refX={5} refY={5} markerWidth={5} markerHeight={5} orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill={COLOR} />
                </marker>
              </defs>
              {grid && <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#nx-grid5)" />}
              <PageContent page={page} selection={selSet} />
              {overlay}
            </svg>
            {editing && editorBox && (
              <textarea
                autoFocus
                className={s.editor}
                style={{ left: editorBox.left, top: editorBox.top, width: editorBox.width, height: editorBox.height, fontSize: editorBox.fontSize, textAlign: editorBox.align }}
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(null);
                  else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitText();
                  e.stopPropagation();
                }}
                onBlur={commitText}
              />
            )}
          </div>
          <div className={s.pages}>
            {doc.pages.map((p, i) => (
              <button
                key={p.id}
                className={mergeClasses(s.pageTab, i === pageIdx && s.pageOn)}
                onClick={() => (setPageIdx(i), setSel([]))}
                onDoubleClick={() => renamePage(i)}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    { label: tl("Umbenennen"), onClick: () => renamePage(i) },
                    { label: tl("Duplizieren"), onClick: () => duplicatePage(i) },
                    { label: tl("Löschen"), onClick: () => deletePage(i), disabled: doc.pages.length < 2 },
                  ])
                }
              >
                {p.name}
              </button>
            ))}
            <Tooltip content={tl("Seite hinzufügen")} relationship="label">
              <Button size="small" appearance="subtle" icon={<Add16Regular />} onClick={addPage} />
            </Tooltip>
          </div>
          {startOpen && (
            <div className={s.start}>
              <Text size={600} weight="semibold">
                {tl("Neues Diagramm")}
              </Text>
              <div className={s.tpls}>
                {TEMPLATES.map((t) => {
                  const d = t.make();
                  return (
                    <button key={t.id} className={s.tpl} onClick={() => void newFrom(t.id)}>
                      <div className={s.tplThumb} dangerouslySetInnerHTML={{ __html: d.pages[0].shapes.length ? svgMarkup(d.pages[0], 1).replace(/width="[\d.]+" height="[\d.]+"/, 'width="170" height="120"') : "" }} />
                      <Text>{t.label()}</Text>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button icon={<FolderOpen24Regular />} onClick={() => void openFile()}>
                  {tl("Öffnen …")}
                </Button>
                {(page.shapes.length > 0 || doc.pages.length > 1) && (
                  <Button icon={<Dismiss24Regular />} appearance="subtle" onClick={() => setStartOpen(false)}>
                    {tl("Zurück zum Diagramm")}
                  </Button>
                )}
              </div>
              <Text size={200} className={s.muted}>
                {tl("Diagramme werden im draw.io-Format gespeichert und lassen sich auch mit diagrams.net öffnen.")}
              </Text>
            </div>
          )}
        </div>
        <div className={s.format}>{format}</div>
      </div>
      <StatusBar>
        <span>{tl("Seite {0} von {1}", pageIdx + 1, doc.pages.length)}</span>
        <span>{tl("{0} Formen, {1} Verbinder", page.shapes.length, page.edges.length)}</span>
        <span style={{ flex: 1 }} />
        <span>{Math.round(zoom * 100)} %</span>
      </StatusBar>
      {unsaved.dialog}
      {printing &&
        createPortal(<div className="nx-diagram-print" style={{ display: "none" }} dangerouslySetInnerHTML={{ __html: doc.pages.filter((p) => p.shapes.length || p.edges.length).map((p) => svgMarkup(p)).join("") }} />, document.body)}
    </div>
  );
}
