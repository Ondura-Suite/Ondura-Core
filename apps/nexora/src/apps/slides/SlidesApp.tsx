import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { Button, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { Backstage, DocumentInfo, StatusBar, useUnsavedPrompt } from "../../shell/office";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { errorMessage, isTauri } from "../../lib/api";
import { addRecent, baseName, extOf, guardClose, initialFile, lossMessage, officeInvoke, openDocumentWindow, pickOpenPath, pickPdfPath, pickSavePath, printToPdf, setWindowTitle, withoutExt } from "../../lib/office";
import { type AnimClass, type AnimEffect, type Animation, type DesignTheme, pathPoints, presetPath, type LayoutId, type Para, type Presentation, type Run, type Shape, type Slide, type Table, THEMES, emptyPresentation, newSlide, newTable, nextId } from "./model";
import { ChartDataDialog, sampleChart } from "./objects";
import { type Chart, type ChartKind } from "../chart/ChartView";
import { TextDialog } from "../text/dialogs";
import { SlideThumb, SlideView } from "./SlideView";
import { ShapeTextEditor, docToParas, useShapeEditor } from "./TextEditor";
import { AudienceWindow, PreviewOverlay, SHOW_PREFIX, SlideShow, animationSteps } from "./Show";
import { SlidesRibbon, type TableAction, type TextState } from "./SlidesRibbon";
import { samplePresentation } from "./sample";
import "./slides.css";

const COLOR = "#c43e1c";

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  main: { flex: 1, minHeight: 0, display: "flex", margin: "8px 8px 0", gap: "8px" },
  editor: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, overflow: "hidden", boxShadow: tokens.shadow4, position: "relative" },
  loading: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 },
});

interface Loaded {
  presentation: Presentation;
  warnings: string[];
}

type Drag =
  | { kind: "move"; start: { x: number; y: number }; orig: Shape[] }
  | { kind: "resize"; handle: string; start: { x: number; y: number }; orig: Shape }
  | { kind: "rotate"; center: { x: number; y: number }; orig: Shape }
  | { kind: "marquee"; start: { x: number; y: number }; cur: { x: number; y: number } };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const mapRuns = (s: Shape, f: (r: Run) => Run): Shape => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, runs: p.runs.map(f) })) });
const mapParas = (s: Shape, f: (p: Para) => Para): Shape => ({ ...s, paragraphs: s.paragraphs.map(f) });

/** Poster of an audio clip: a speaker symbol as PNG (PowerPoint needs a bitmap). */
function speakerIcon() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4472c4";
  g.beginPath();
  g.moveTo(16, 48);
  g.lineTo(40, 48);
  g.lineTo(72, 18);
  g.lineTo(72, 110);
  g.lineTo(40, 80);
  g.lineTo(16, 80);
  g.closePath();
  g.fill();
  g.strokeStyle = "#4472c4";
  g.lineWidth = 8;
  g.lineCap = "round";
  for (const r of [22, 40]) {
    g.beginPath();
    g.arc(72, 64, r, -Math.PI / 4, Math.PI / 4);
    g.stroke();
  }
  return c.toDataURL("image/png");
}

export function SlidesApp() {
  const show = initialFile();
  if (show?.startsWith(SHOW_PREFIX)) return <AudienceWindow channelId={show.slice(SHOW_PREFIX.length)} />;
  return <SlidesEditor />;
}

function SlidesEditor() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();
  const [pres, setPresState] = useState<Presentation>(() => (isTauri ? emptyPresentation() : samplePresentation()));
  const [history, setHistory] = useState<{ past: Presentation[]; future: Presentation[] }>({ past: [], future: [] });
  const [saved, setSaved] = useState<Presentation>(pres);
  const [path, setPath] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tab, setTab] = useState("home");
  const [backstage, setBackstage] = useState<null | "open" | "info">(null);
  const [showNotes, setShowNotes] = useState(true);
  const [showing, setShowing] = useState<null | { start: number; presenter: boolean }>(null);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [thumbMenu, setThumbMenu] = useState<null | { x: number; y: number; index: number }>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [theme, setTheme] = useState<DesignTheme>(THEMES[0]);
  // Table cell being edited ([shape, row, col]) and the last clicked cell.
  const [editCell, setEditCell] = useState<[number, number, number] | null>(null);
  const [cellText, setCellText] = useState("");
  const [cellBox, setCellBox] = useState<{ left: number; top: number; width: number; height: number; font: number; align?: string } | null>(null);
  const cellInput = useRef<HTMLTextAreaElement>(null);
  const lastCell = useRef<[number, number, number] | null>(null);
  const [chartEdit, setChartEdit] = useState<number | null>(null);
  const [chartTitle, setChartTitle] = useState<number | null>(null);
  const [preview, setPreview] = useState<null | { mode: "transition" | "animations"; key: number }>(null);
  const clipboard = useRef<Shape[] | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  // Index (in the slide's animation list) of the animation shown in the ribbon.
  const [animSel, setAnimSel] = useState(-1);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 500 });

  const slide = pres.slides[Math.min(index, pres.slides.length - 1)];
  const dirty = pres !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const setPres = useCallback((next: Presentation | ((p: Presentation) => Presentation)) => {
    setPresState((cur) => {
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      setHistory((h) => ({ past: [...h.past.slice(-99), cur], future: [] }));
      return n;
    });
  }, []);

  const undo = () =>
    setHistory((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      setPresState((cur) => {
        setTimeout(() => setHistory((x) => ({ ...x, future: [cur, ...x.future] })));
        return prev;
      });
      return { ...h, past: h.past.slice(0, -1) };
    });
  const redo = () =>
    setHistory((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      setPresState((cur) => {
        setTimeout(() => setHistory((x) => ({ ...x, past: [...x.past, cur] })));
        return next;
      });
      return { ...h, future: h.future.slice(1) };
    });

  const updateSlide = useCallback((f: (s: Slide) => Slide, i = index) => setPres((p) => ({ ...p, slides: p.slides.map((x, k) => (k === i ? f(x) : x)) })), [index, setPres]);
  const updateShapes = useCallback((ids: number[], f: (s: Shape) => Shape) => updateSlide((sl) => ({ ...sl, shapes: sl.shapes.map((x) => (ids.includes(x.id) ? f(x) : x)) })), [updateSlide]);

  const name = path ? baseName(path) : pres.title || "Präsentation1";
  useEffect(() => void setWindowTitle(`${dirty ? "• " : ""}${withoutExt(name)} – Nexora Präsentation`), [name, dirty]);
  useEffect(() => splashDone(), []);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showNotes]);

  const scale = Math.max(0.1, Math.min((canvasSize.w - 64) / pres.width, (canvasSize.h - 48) / pres.height));

  // ----------------------------------------------------------- text editing --

  const editingShape = slide?.shapes.find((x) => x.id === editingId) ?? null;
  const editor = useShapeEditor(editingShape);

  const stopEditing = useCallback(() => {
    if (editingId === null || !editor) {
      setEditingId(null);
      return;
    }
    const paras = docToParas(editor.getJSON());
    const id = editingId;
    setEditingId(null);
    updateShapes([id], (x) => (JSON.stringify(x.paragraphs) === JSON.stringify(paras) ? x : { ...x, paragraphs: paras }));
  }, [editingId, editor, updateShapes]);

  const textState: TextState = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (e && editingId !== null) {
        const ts = e.getAttributes("textStyle");
        const pa = e.getAttributes("paragraph");
        return {
          bold: e.isActive("bold"),
          italic: e.isActive("italic"),
          underline: e.isActive("underline"),
          strike: e.isActive("strike"),
          font: (ts.fontFamily as string)?.replace(/["']/g, "").split(",")[0] || "Calibri",
          size: ts.fontSize ? parseFloat(ts.fontSize) : pa.size ?? 18,
          align: pa.textAlign ?? "left",
          bullet: pa.bullet ?? null,
        };
      }
      return null;
    },
  }) ?? (() => {
    const sh = slide?.shapes.find((x) => x.id === selected[0]);
    const p = sh?.paragraphs[0];
    const r = p?.runs[0];
    return { bold: !!r?.bold, italic: !!r?.italic, underline: !!r?.underline, strike: !!r?.strike, font: r?.font ?? "Calibri", size: r?.size ?? p?.size ?? 18, align: p?.align ?? "left", bullet: p?.bullet ?? null };
  })();

  const textCmd = (cmd: Parameters<NonNullable<React.ComponentProps<typeof SlidesRibbon>["onText"]>>[0]) => {
    if (editingId !== null && editor) {
      const c = editor.chain().focus();
      if (cmd.toggle === "bold") c.toggleBold();
      if (cmd.toggle === "italic") c.toggleItalic();
      if (cmd.toggle === "underline") c.toggleUnderline();
      if (cmd.toggle === "strike") c.toggleStrike();
      if (cmd.font) c.setFontFamily(`"${cmd.font}", "Segoe UI", Calibri, Carlito, sans-serif`);
      if (cmd.size) c.setFontSize(`${cmd.size}pt`);
      if (cmd.grow) c.setFontSize(`${Math.max(1, Math.round((textState.size + cmd.grow * Math.max(2, textState.size * 0.1)) * 2) / 2)}pt`);
      if (cmd.color !== undefined) cmd.color ? c.setColor(cmd.color) : c.unsetColor();
      if (cmd.align) c.setTextAlign(cmd.align);
      c.run();
      if (cmd.bullet || cmd.indent) {
        const { state } = editor;
        const { from, to } = state.selection;
        const tr = state.tr;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== "paragraph") return;
          const attrs = { ...node.attrs };
          if (cmd.bullet) attrs.bullet = textState.bullet === cmd.bullet ? null : cmd.bullet;
          if (cmd.indent) attrs.level = Math.max(0, Math.min(8, (attrs.level ?? 0) + cmd.indent));
          tr.setNodeMarkup(pos, undefined, attrs);
        });
        editor.view.dispatch(tr);
      }
      return;
    }
    if (!selected.length) return;
    updateShapes(selected, (sh) => {
      let x = sh;
      if (cmd.toggle) {
        const on = !sh.paragraphs[0]?.runs[0]?.[cmd.toggle];
        x = mapRuns(x, (r) => ({ ...r, [cmd.toggle!]: on || undefined }));
      }
      if (cmd.font) x = mapRuns(x, (r) => ({ ...r, font: cmd.font }));
      if (cmd.size) x = mapParas(mapRuns(x, (r) => ({ ...r, size: cmd.size })), (p) => ({ ...p, size: p.size ? cmd.size : undefined }));
      if (cmd.grow) x = mapParas(mapRuns(x, (r) => ({ ...r, size: Math.max(1, Math.round(((r.size ?? 18) + cmd.grow! * Math.max(2, (r.size ?? 18) * 0.1)) * 2) / 2) })), (p) => ({ ...p, size: p.size ? Math.max(1, p.size + cmd.grow! * 2) : undefined }));
      if (cmd.color !== undefined) x = mapRuns(x, (r) => ({ ...r, color: cmd.color ?? undefined }));
      if (cmd.align) x = mapParas(x, (p) => ({ ...p, align: cmd.align === "left" ? undefined : cmd.align }));
      if (cmd.bullet) {
        const on = sh.paragraphs[0]?.bullet !== cmd.bullet;
        x = mapParas(x, (p) => ({ ...p, bullet: on ? cmd.bullet : undefined }));
      }
      if (cmd.indent) x = mapParas(x, (p) => ({ ...p, level: Math.max(0, Math.min(8, (p.level ?? 0) + cmd.indent!)) || undefined }));
      return x;
    });
  };


  // ------------------------------------------------------- tables, charts --

  const insertTable = (rows: number, cols: number) => {
    const id = nextId(slide);
    const w = Math.min(pres.width - 160, cols * 180);
    const shape: Shape = { id, kind: "table", x: Math.round((pres.width - w) / 2), y: Math.round(pres.height * 0.28), w, h: rows * 40, paragraphs: [], table: newTable(rows, cols, w, theme.accent) };
    shape.table!.rows.forEach((r) => r.cells.forEach((c) => (c.paragraphs = [{ runs: [], size: 18 }])));
    updateSlide((sl) => ({ ...sl, shapes: [...sl.shapes, shape] }));
    setSelected([id]);
    setTab("table");
  };

  const insertChart = (kind: ChartKind) => {
    const id = nextId(slide);
    const w = 720;
    const h = 420;
    updateSlide((sl) => ({ ...sl, shapes: [...sl.shapes, { id, kind: "chart", x: Math.round((pres.width - w) / 2), y: Math.round((pres.height - h) / 2 + 30), w, h, paragraphs: [], chart: sampleChart(kind) }] }));
    setSelected([id]);
    setTab("chart");
    setChartEdit(id);
  };

  const selTable = slide?.shapes.find((x) => x.id === selected[0] && x.kind === "table" && x.table);
  const selChart = slide?.shapes.find((x) => x.id === selected[0] && x.kind === "chart" && x.chart);
  useEffect(() => {
    if ((tab === "table" && !selTable) || (tab === "chart" && !selChart)) setTab("home");
  }, [tab, selTable, selChart]);

  const patchTable = (id: number, f: (t: Table) => Table) => updateShapes([id], (x) => (x.table ? { ...x, table: f(x.table) } : x));
  const patchChart = (id: number, patch: Partial<Chart>) => updateShapes([id], (x) => (x.chart ? { ...x, chart: { ...x.chart, ...patch } } : x));

  const tableAction = (a: TableAction) => {
    const sh = selTable;
    if (!sh?.table) return;
    const t = sh.table;
    const cur = lastCell.current && lastCell.current[0] === sh.id ? lastCell.current : [sh.id, t.rows.length - 1, t.cols.length - 1];
    const [, r, c] = cur;
    const empty = () => ({ paragraphs: [{ runs: [], size: t.rows[r]?.cells[0]?.paragraphs[0]?.runs[0]?.size ?? 18 }] });
    patchTable(sh.id, (tb) => {
      switch (a) {
        case "header":
          return { ...tb, header: !tb.header };
        case "banded":
          return { ...tb, banded: !tb.banded };
        case "rowAbove":
        case "rowBelow": {
          const at = a === "rowAbove" ? r : r + 1;
          const rows = [...tb.rows];
          rows.splice(at, 0, { h: tb.rows[r]?.h ?? 40, cells: tb.cols.map(empty) });
          return { ...tb, rows };
        }
        case "colLeft":
        case "colRight": {
          const at = a === "colLeft" ? c : c + 1;
          const w = tb.cols[c] ?? 120;
          const cols = [...tb.cols];
          cols.splice(at, 0, w);
          // Keep the table width: scale all columns.
          const sum = cols.reduce((x, y) => x + y, 0);
          const total = tb.cols.reduce((x, y) => x + y, 0);
          return { ...tb, cols: cols.map((x) => (x * total) / sum), rows: tb.rows.map((row) => ({ ...row, cells: [...row.cells.slice(0, at), empty(), ...row.cells.slice(at)] })) };
        }
        case "delRow":
          return tb.rows.length > 1 ? { ...tb, rows: tb.rows.filter((_, i) => i !== r) } : tb;
        case "delCol": {
          if (tb.cols.length <= 1) return tb;
          const total = tb.cols.reduce((x, y) => x + y, 0);
          const cols = tb.cols.filter((_, i) => i !== c);
          const sum = cols.reduce((x, y) => x + y, 0);
          return { ...tb, cols: cols.map((x) => (x * total) / sum), rows: tb.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== c) })) };
        }
      }
    });
    if (a === "rowAbove" || a === "rowBelow") updateShapes([sh.id], (x) => ({ ...x, h: x.h + (t.rows[r]?.h ?? 40) }));
    if (a === "delRow") updateShapes([sh.id], (x) => ({ ...x, h: Math.max(20, x.h - (t.rows[r]?.h ?? 40)) }));
  };

  const cellParas = (sh: Shape, r: number, c: number) => sh.table?.rows[r]?.cells[c]?.paragraphs ?? [];

  const startCellEdit = (id: number, r: number, c: number) => {
    const sh = slide.shapes.find((x) => x.id === id);
    if (!sh?.table) return;
    stopEditing();
    lastCell.current = [id, r, c];
    setSelected([id]);
    setEditCell([id, r, c]);
    setCellText(cellParas(sh, r, c).map((p) => p.runs.map((x) => x.text).join("")).join("\n"));
  };

  const commitCell = useCallback(
    (next?: [number, number, number] | null) => {
      if (!editCell) return;
      const [id, r, c] = editCell;
      const text = cellText;
      updateShapes([id], (x) => {
        if (!x.table) return x;
        const cell = x.table.rows[r]?.cells[c];
        if (!cell) return x;
        const base = cell.paragraphs[0];
        const style = base?.runs[0] ?? { text: "", size: base?.size ?? 18 };
        const lines = text.split("\n");
        const old = cell.paragraphs.map((p) => p.runs.map((y) => y.text).join("")).join("\n");
        if (old === text) return x;
        const paragraphs: Para[] = lines.map((l) => ({ align: base?.align, runs: l ? [{ ...style, text: l }] : [], size: style.size ?? 18 }));
        return { ...x, table: { ...x.table, rows: x.table.rows.map((row, ri) => (ri === r ? { ...row, cells: row.cells.map((cc, ci) => (ci === c ? { ...cc, paragraphs } : cc)) } : row)) } };
      });
      setEditCell(null);
      if (next) startCellEdit(...next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editCell, cellText, updateShapes],
  );

  useLayoutEffect(() => {
    if (!editCell) return setCellBox(null);
    const [id, r, c] = editCell;
    const sh = slide.shapes.find((x) => x.id === id);
    const td = stageRef.current?.querySelector<HTMLTableCellElement>(`[data-shape="${id}"] [data-cell="${r}:${c}"]`);
    if (!sh || !td) return setCellBox(null);
    const size = cellParas(sh, r, c)[0]?.runs[0]?.size ?? cellParas(sh, r, c)[0]?.size ?? 18;
    setCellBox({ left: sh.x + td.offsetLeft, top: sh.y + td.offsetTop, width: td.offsetWidth, height: td.offsetHeight, font: (size * 96) / 72, align: cellParas(sh, r, c)[0]?.align });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCell, slide]);

  // Like PowerPoint, moving into a cell selects its text.
  useEffect(() => {
    if (editCell) requestAnimationFrame(() => (cellInput.current?.focus(), cellInput.current?.select()));
  }, [editCell]);

  const moveCell = (d: 1 | -1) => {
    if (!editCell) return;
    const sh = slide.shapes.find((x) => x.id === editCell[0]);
    const t = sh?.table;
    if (!t) return;
    const nCols = t.cols.length;
    let i = editCell[1] * nCols + editCell[2] + d;
    // Skip covered cells.
    while (i >= 0 && i < t.rows.length * nCols && t.rows[Math.floor(i / nCols)]?.cells[i % nCols]?.merged) i += d;
    if (i < 0 || i >= t.rows.length * nCols) return commitCell(null);
    commitCell([editCell[0], Math.floor(i / nCols), i % nCols]);
  };

  // ------------------------------------------------ animations, transitions --

  const anims = slide?.animations ?? [];
  // Animations of the first selected shape; the ribbon edits one of them.
  const shapeAnimIdx = anims.flatMap((a, i) => (a.shape === selected[0] ? [i] : []));
  const curAnimIdx = shapeAnimIdx.includes(animSel) ? animSel : (shapeAnimIdx[0] ?? -1);
  const selAnim = curAnimIdx >= 0 ? anims[curAnimIdx] : undefined;

  /** The animation edited for each selected shape: the current one or the shape's first. */
  const targetIndex = (list: Animation[], id: number) => (id === selected[0] && list[curAnimIdx]?.shape === id ? curAnimIdx : list.findIndex((a) => a.shape === id));

  const setAnimation = (patch: Partial<Animation> | null) => {
    if (!selected.length) return;
    updateSlide((sl) => {
      let list = [...(sl.animations ?? [])];
      // Indices shift when entries are removed, so resolve them first.
      const targets = selected.map((id) => [id, targetIndex(list, id)] as const);
      const removed = new Set<number>();
      for (const [id, i] of targets) {
        if (patch === null) {
          if (i >= 0) removed.add(i);
          continue;
        }
        if (i >= 0) {
          const next = { ...list[i], ...patch };
          // Motion path presets carry their path; other classes have none.
          if ((next.class ?? "entr") === "path") {
            if (patch.effect || patch.class) next.path = presetPath(next.effect, pres.width / pres.height);
            if (patch.class === "path" && (list[i].class ?? "entr") !== "path") next.duration = 2000;
          } else delete next.path;
          if (patch.effect && ["fly", "wipe"].includes(patch.effect) && !next.dir) next.dir = "b";
          if (patch.class === "emph" || (patch.effect && !["fly", "wipe"].includes(patch.effect))) delete next.dir;
          list[i] = next;
        } else list.push({ shape: id, effect: "fade", trigger: "click", duration: 500, ...patch, dir: patch.dir ?? (patch.effect === "fly" || patch.effect === "wipe" ? "b" : undefined) } as Animation);
      }
      list = list.filter((a, i) => !removed.has(i) && sl.shapes.some((x) => x.id === a.shape));
      return { ...sl, animations: list.length ? list : undefined };
    });
    if (patch?.effect) setPreview({ mode: "animations", key: Date.now() });
  };

  const addAnimation = (cls: AnimClass, effect: AnimEffect) => {
    if (!selected.length) return;
    const start = anims.length;
    updateSlide((sl) => ({
      ...sl,
      animations: [
        ...(sl.animations ?? []),
        ...selected.map((id): Animation => ({
          shape: id,
          class: cls === "entr" ? undefined : cls,
          effect,
          path: cls === "path" ? presetPath(effect, pres.width / pres.height) : undefined,
          trigger: "click",
          duration: cls === "path" ? 2000 : cls === "emph" && effect !== "pulse" ? 1000 : 500,
          dir: effect === "fly" || effect === "wipe" ? "b" : undefined,
        })),
      ],
    }));
    setAnimSel(start);
    setPreview({ mode: "animations", key: Date.now() });
  };

  const moveAnimation = (d: -1 | 1) => {
    const i = curAnimIdx;
    const j = i + d;
    if (i < 0 || j < 0 || j >= anims.length) return;
    updateSlide((sl) => {
      const list = [...(sl.animations ?? [])];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...sl, animations: list };
    });
    setAnimSel(j);
  };

  /** Inserts a video (poster: first frame) or an audio clip (poster: speaker icon). */
  const insertMedia = (file: File) => {
    const video = file.type.startsWith("video/");
    const reader = new FileReader();
    reader.onload = () => {
      const media = String(reader.result);
      const place = (src: string, w: number, h: number) => {
        const id = nextId(slide);
        const x = Math.round((pres.width - w) / 2);
        const y = Math.round((pres.height - h) / 2);
        updateSlide((sl) => ({ ...sl, shapes: [...sl.shapes, { id, kind: "image", src, media, mediaKind: video ? "video" : "audio", x, y, w, h, paragraphs: [] }] }));
        setSelected([id]);
      };
      if (!video) return place(speakerIcon(), 64, 64);
      const el = document.createElement("video");
      el.muted = true;
      el.preload = "auto";
      let done = false;
      const grab = () => {
        if (done) return;
        done = true;
        const vw = el.videoWidth || 640;
        const vh = el.videoHeight || 360;
        const c = document.createElement("canvas");
        c.width = vw;
        c.height = vh;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, vw, vh);
        try {
          ctx.drawImage(el, 0, 0, vw, vh);
        } catch {
          /* poster stays black */
        }
        const sc = Math.min(1, (pres.width * 0.6) / vw, (pres.height * 0.6) / vh);
        place(c.toDataURL("image/png"), Math.round(vw * sc), Math.round(vh * sc));
      };
      el.onloadeddata = () => (el.currentTime = Math.min(0.5, (el.duration || 1) / 4));
      el.onseeked = grab;
      el.onerror = grab;
      setTimeout(grab, 4000);
      el.src = media;
    };
    reader.readAsDataURL(file);
  };

  /** Click number shown next to animated shapes (0 = with the slide). */
  const animBadges = useMemo(() => {
    const out = new Map<number, number[]>();
    const { groups, auto } = animationSteps(slide);
    groups.forEach((g, i) => g.forEach((x) => {
      const n = auto ? i : i + 1;
      const list = out.get(x.shape) ?? [];
      if (!list.includes(n)) out.set(x.shape, [...list, n]);
    }));
    return out;
  }, [slide]);

  // -------------------------------------------------------------- pointer --

  const toSlide = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const hitShape = (pt: { x: number; y: number }) => {
    for (let i = slide.shapes.length - 1; i >= 0; i--) {
      const sh = slide.shapes[i];
      // Point in the shape's own (unrotated) frame.
      const cx = sh.x + sh.w / 2;
      const cy = sh.y + sh.h / 2;
      const a = (-(sh.rotation ?? 0) * Math.PI) / 180;
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a) + sh.w / 2;
      const ly = dx * Math.sin(a) + dy * Math.cos(a) + sh.h / 2;
      const pad = sh.kind === "line" ? 6 / scale : 0;
      if (lx >= -pad && ly >= -pad && lx <= sh.w + pad && ly <= sh.h + pad) return sh;
    }
    return null;
  };

  const cellAt = (e: React.MouseEvent, id: number): [number, number] | null => {
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x instanceof HTMLElement && x.dataset.cell && x.closest(`[data-shape="${id}"]`)) as HTMLElement | undefined;
    const m = el?.dataset.cell?.split(":").map(Number);
    return m && m.length === 2 ? [m[0], m[1]] : null;
  };

  const onStageDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pt = toSlide(e);
    const hit = hitShape(pt);
    if (editCell) commitCell(null);
    if (hit?.kind === "table") {
      const cell = cellAt(e, hit.id);
      if (cell) lastCell.current = [hit.id, cell[0], cell[1]];
      if (e.detail === 2 && cell) {
        // Keep the focus in the cell editor that opens now.
        e.preventDefault();
        startCellEdit(hit.id, cell[0], cell[1]);
        return;
      }
    }
    if (hit?.kind === "chart" && e.detail === 2) {
      setSelected([hit.id]);
      setChartEdit(hit.id);
      return;
    }
    if (editingId !== null && hit?.id !== editingId) stopEditing();
    if (!hit) {
      setSelected([]);
      setDrag({ kind: "marquee", start: pt, cur: pt });
      return;
    }
    if (e.detail === 2 && !["image", "line", "table", "chart"].includes(hit.kind)) {
      setSelected([hit.id]);
      setEditingId(hit.id);
      return;
    }
    let sel = selected;
    if (e.shiftKey || e.ctrlKey) sel = selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : [...selected, hit.id];
    else if (!selected.includes(hit.id)) sel = [hit.id];
    setSelected(sel);
    setDrag({ kind: "move", start: pt, orig: slide.shapes.filter((x) => sel.includes(x.id)) });
  };

  const onHandleDown = (e: React.MouseEvent, sh: Shape, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (handle === "rot") setDrag({ kind: "rotate", center: { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 }, orig: sh });
    else setDrag({ kind: "resize", handle, start: toSlide(e), orig: sh });
  };

  useEffect(() => {
    if (!drag) return;
    let first = true;
    const move = (e: MouseEvent) => {
      const pt = toSlide(e);
      if (drag.kind === "marquee") {
        setDrag({ ...drag, cur: pt });
        return;
      }
      const apply = (f: (s: Shape) => Shape, ids: number[]) => {
        // The first change of a drag is one undo step; the rest replace it.
        if (first) {
          first = false;
          updateShapes(ids, f);
        } else setPresState((p) => ({ ...p, slides: p.slides.map((x, k) => (k === index ? { ...x, shapes: x.shapes.map((sh) => (ids.includes(sh.id) ? f(sh) : sh)) } : x)) }));
      };
      if (drag.kind === "move") {
        let dx = pt.x - drag.start.x;
        let dy = pt.y - drag.start.y;
        if (Math.abs(dx) < 2 / scale && Math.abs(dy) < 2 / scale && first) return;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        // Snap the moved group to the slide centre/edges and other shapes.
        const b = drag.orig.reduce((a, s) => ({ x1: Math.min(a.x1, s.x), y1: Math.min(a.y1, s.y), x2: Math.max(a.x2, s.x + s.w), y2: Math.max(a.y2, s.y + s.h) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
        const others = slide.shapes.filter((s) => !drag.orig.some((o) => o.id === s.id));
        const xs = [0, pres.width / 2, pres.width, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
        const ys = [0, pres.height / 2, pres.height, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
        const tol = 6 / scale;
        const g: { x?: number; y?: number } = {};
        if (!e.altKey) {
          for (const [edge, off] of [[b.x1 + dx, 0], [(b.x1 + b.x2) / 2 + dx, (b.x2 - b.x1) / 2], [b.x2 + dx, b.x2 - b.x1]] as const) {
            const t = xs.find((x) => Math.abs(x - edge) < tol);
            if (t !== undefined) {
              dx = t - off - b.x1;
              g.x = t;
              break;
            }
          }
          for (const [edge, off] of [[b.y1 + dy, 0], [(b.y1 + b.y2) / 2 + dy, (b.y2 - b.y1) / 2], [b.y2 + dy, b.y2 - b.y1]] as const) {
            const t = ys.find((y) => Math.abs(y - edge) < tol);
            if (t !== undefined) {
              dy = t - off - b.y1;
              g.y = t;
              break;
            }
          }
        }
        setGuides(g);
        const orig = new Map(drag.orig.map((o) => [o.id, o]));
        apply((s) => ({ ...s, x: Math.round(orig.get(s.id)!.x + dx), y: Math.round(orig.get(s.id)!.y + dy) }), drag.orig.map((o) => o.id));
      } else if (drag.kind === "resize") {
        const o = drag.orig;
        // Work in the shape's rotated frame.
        const a = ((o.rotation ?? 0) * Math.PI) / 180;
        const ddx = pt.x - drag.start.x;
        const ddy = pt.y - drag.start.y;
        const lx = ddx * Math.cos(a) + ddy * Math.sin(a);
        const ly = -ddx * Math.sin(a) + ddy * Math.cos(a);
        const h = drag.handle;
        let { x, y, w, h: hh } = o;
        let nw = w + (h.includes("e") ? lx : h.includes("w") ? -lx : 0);
        let nh = hh + (h.includes("s") ? ly : h.includes("n") ? -ly : 0);
        const keep = (o.kind === "image" ? !e.shiftKey : e.shiftKey) && h.length === 2;
        if (keep) {
          const ratio = w / Math.max(1, hh);
          if (Math.abs(nw / w) > Math.abs(nh / hh)) nh = nw / ratio;
          else nw = nh * ratio;
        }
        nw = Math.max(o.kind === "line" ? 0 : 8, nw);
        nh = Math.max(o.kind === "line" ? 0 : 8, nh);
        // Keep the opposite side fixed (in the rotated frame).
        const fx = h.includes("w") ? w - nw : 0;
        const fy = h.includes("n") ? hh - nh : 0;
        const cx0 = x + w / 2;
        const cy0 = y + hh / 2;
        const ocx = fx + nw / 2 - w / 2;
        const ocy = fy + nh / 2 - hh / 2;
        const cx = cx0 + ocx * Math.cos(a) - ocy * Math.sin(a);
        const cy = cy0 + ocx * Math.sin(a) + ocy * Math.cos(a);
        x = cx - nw / 2;
        y = cy - nh / 2;
        w = nw;
        hh = nh;
        apply((s) => ({ ...s, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) }), [o.id]);
      } else if (drag.kind === "rotate") {
        let deg = (Math.atan2(pt.y - drag.center.y, pt.x - drag.center.x) * 180) / Math.PI + 90;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((Math.round(deg) % 360) + 360) % 360;
        apply((s) => ({ ...s, rotation: deg || undefined }), [drag.orig.id]);
      }
    };
    const up = () => {
      if (drag.kind === "marquee") {
        const x1 = Math.min(drag.start.x, drag.cur.x);
        const x2 = Math.max(drag.start.x, drag.cur.x);
        const y1 = Math.min(drag.start.y, drag.cur.y);
        const y2 = Math.max(drag.start.y, drag.cur.y);
        if (x2 - x1 > 3 && y2 - y1 > 3) setSelected(slide.shapes.filter((sh) => sh.x >= x1 && sh.y >= y1 && sh.x + sh.w <= x2 && sh.y + sh.h <= y2).map((sh) => sh.id));
      }
      setDrag(null);
      setGuides({});
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, scale, index]);

  // ------------------------------------------------------------- commands --

  const goSlide = (i: number) => {
    if (editingId !== null) stopEditing();
    setIndex(Math.max(0, Math.min(pres.slides.length - 1, i)));
    setSelected([]);
  };

  const addSlide = (layout: LayoutId) => {
    const sl = newSlide(pres.width, pres.height, layout, theme);
    setPres((p) => {
      const slides = [...p.slides];
      slides.splice(index + 1, 0, sl);
      return { ...p, slides };
    });
    setIndex(index + 1);
    setSelected([]);
  };

  const duplicateSlide = (i = index) => {
    setPres((p) => {
      const slides = [...p.slides];
      slides.splice(i + 1, 0, structuredClone(p.slides[i]));
      return { ...p, slides };
    });
    setIndex(i + 1);
  };

  const deleteSlide = (i = index) => {
    if (pres.slides.length <= 1) {
      setPres((p) => ({ ...p, slides: [newSlide(p.width, p.height, "blank", theme)] }));
      return;
    }
    setPres((p) => ({ ...p, slides: p.slides.filter((_, k) => k !== i) }));
    setIndex(Math.max(0, Math.min(i, pres.slides.length - 2)));
    setSelected([]);
  };

  const changeLayout = (layout: LayoutId) => {
    const fresh = newSlide(pres.width, pres.height, layout, theme);
    updateSlide((sl) => {
      // Keep text of matching placeholders; keep everything else.
      const used = new Set<number>();
      const shapes = fresh.shapes.map((f) => {
        const old = sl.shapes.find((o) => !used.has(o.id) && (o.placeholder === f.placeholder || (f.placeholder === "ctrTitle" && o.placeholder === "title") || (f.placeholder === "title" && o.placeholder === "ctrTitle")));
        if (!old) return { ...f, id: nextId({ ...sl, shapes: [...sl.shapes, ...fresh.shapes] }) + f.id };
        used.add(old.id);
        return { ...f, id: old.id, paragraphs: old.paragraphs };
      });
      return { ...sl, shapes: [...sl.shapes.filter((o) => !used.has(o.id) && !o.placeholder), ...shapes] };
    });
  };

  const insertShape = (kind: string) => {
    const id = nextId(slide);
    const w = kind === "line" ? 240 : 220;
    const h = kind === "line" ? 0 : 140;
    const shape: Shape = {
      id,
      kind,
      x: Math.round(pres.width / 2 - w / 2),
      y: Math.round(pres.height / 2 - h / 2),
      w,
      h,
      fill: kind === "line" ? undefined : theme.accent,
      line: kind === "line" ? theme.accent : undefined,
      lineWidth: kind === "line" ? 2.25 : undefined,
      anchor: "middle",
      paragraphs: kind === "line" ? [] : [{ align: "center", runs: [{ text: "", size: 18, color: "#ffffff", font: theme.font }] }],
    };
    updateSlide((sl) => ({ ...sl, shapes: [...sl.shapes, shape] }));
    setSelected([id]);
  };

  const insertTextBox = () => {
    const id = nextId(slide);
    updateSlide((sl) => ({
      ...sl,
      shapes: [...sl.shapes, { id, kind: "text", x: Math.round(pres.width / 2 - 200), y: Math.round(pres.height / 2 - 30), w: 400, h: 60, paragraphs: [{ runs: [{ text: "", size: 18, font: theme.font, color: theme.text }] }] }],
    }));
    setSelected([id]);
    setEditingId(id);
  };

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new window.Image();
      img.onload = () => {
        const sc = Math.min(1, (pres.width * 0.7) / img.naturalWidth, (pres.height * 0.7) / img.naturalHeight);
        const w = Math.round(img.naturalWidth * sc);
        const h = Math.round(img.naturalHeight * sc);
        const id = nextId(slide);
        updateSlide((sl) => ({ ...sl, shapes: [...sl.shapes, { id, kind: "image", src, x: Math.round((pres.width - w) / 2), y: Math.round((pres.height - h) / 2), w, h, paragraphs: [] }] }));
        setSelected([id]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const arrange = (a: "front" | "back" | "forward" | "backward") =>
    updateSlide((sl) => {
      const shapes = [...sl.shapes];
      const ids = new Set(selected);
      if (a === "front") return { ...sl, shapes: [...shapes.filter((x) => !ids.has(x.id)), ...shapes.filter((x) => ids.has(x.id))] };
      if (a === "back") return { ...sl, shapes: [...shapes.filter((x) => ids.has(x.id)), ...shapes.filter((x) => !ids.has(x.id))] };
      const order = a === "forward" ? [...shapes.keys()].reverse() : [...shapes.keys()];
      for (const i of order) {
        const j = a === "forward" ? i + 1 : i - 1;
        if (ids.has(shapes[i].id) && j >= 0 && j < shapes.length && !ids.has(shapes[j].id)) [shapes[i], shapes[j]] = [shapes[j], shapes[i]];
      }
      return { ...sl, shapes };
    });

  const alignShapes = (a: "left" | "center" | "right" | "top" | "middle" | "bottom") =>
    updateShapes(selected, (x) => {
      // One shape aligns to the slide, several to their common box.
      const sel = slide.shapes.filter((s) => selected.includes(s.id));
      const box = sel.length > 1 ? sel.reduce((b, s) => ({ x1: Math.min(b.x1, s.x), y1: Math.min(b.y1, s.y), x2: Math.max(b.x2, s.x + s.w), y2: Math.max(b.y2, s.y + s.h) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }) : { x1: 0, y1: 0, x2: pres.width, y2: pres.height };
      switch (a) {
        case "left":
          return { ...x, x: box.x1 };
        case "center":
          return { ...x, x: Math.round((box.x1 + box.x2) / 2 - x.w / 2) };
        case "right":
          return { ...x, x: box.x2 - x.w };
        case "top":
          return { ...x, y: box.y1 };
        case "middle":
          return { ...x, y: Math.round((box.y1 + box.y2) / 2 - x.h / 2) };
        default:
          return { ...x, y: box.y2 - x.h };
      }
    });

  const applyTheme = (t: DesignTheme) => {
    setTheme(t);
    setPres((p) => ({
      ...p,
      slides: p.slides.map((sl) => ({
        ...sl,
        background: t.background === "#ffffff" ? undefined : t.background,
        backgroundImage: undefined,
        shapes: sl.shapes.map((sh) => {
          if (sh.placeholder === "title" || sh.placeholder === "ctrTitle") return mapRuns(sh, (r) => ({ ...r, color: t.title, font: t.headingFont }));
          if (sh.kind === "text") return mapRuns(sh, (r) => ({ ...r, color: t.text, font: t.font }));
          if (sh.kind !== "image" && sh.kind !== "line" && sh.fill) return { ...sh, fill: t.accent };
          if (sh.kind === "line") return { ...sh, line: t.accent };
          return sh;
        }),
      })),
    }));
  };

  const setSize = (ratio: "16:9" | "4:3") => {
    const w = ratio === "16:9" ? 1280 : 960;
    const h = 720;
    if (w === pres.width && h === pres.height) return;
    const sx = w / pres.width;
    setPres((p) => ({ ...p, width: w, height: h, slides: p.slides.map((sl) => ({ ...sl, shapes: sl.shapes.map((s) => ({ ...s, x: Math.round(s.x * sx), w: Math.round(s.w * sx) })) })) }));
  };

  const copyShapes = (cut: boolean) => {
    const sel = slide.shapes.filter((x) => selected.includes(x.id));
    if (!sel.length) return;
    clipboard.current = structuredClone(sel);
    void navigator.clipboard?.writeText(sel.map((x) => x.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n")).join("\n\n")).catch(() => {});
    if (cut) {
      updateSlide((sl) => ({ ...sl, shapes: sl.shapes.filter((x) => !selected.includes(x.id)) }));
      setSelected([]);
    }
  };

  const pasteShapes = () => {
    const clip = clipboard.current;
    if (!clip?.length) return;
    let id = nextId(slide);
    const pasted = clip.map((x) => ({ ...structuredClone(x), id: id++, x: x.x + 16, y: x.y + 16 }));
    clipboard.current = pasted;
    updateSlide((sl) => ({ ...sl, shapes: [...sl.shapes, ...pasted] }));
    setSelected(pasted.map((x) => x.id));
  };

  // ---------------------------------------------------------------- files --

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const r = await officeInvoke<Loaded>("slides_open", { path: p });
        setPresState(r.presentation);
        setSaved(r.presentation);
        setHistory({ past: [], future: [] });
        setIndex(0);
        setSelected([]);
        setPath(p);
        setWarnings(r.warnings);
        addRecent("slides", p);
        if (r.warnings.length) notify("Nicht alles konnte übernommen werden", "Details unter Datei › Informationen.", "warning");
      } catch (e) {
        notify("Öffnen fehlgeschlagen", errorMessage(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    const f = initialFile();
    if (f && !f.startsWith(SHOW_PREFIX)) void load(f);
  }, [load]);

  const presentationNow = useCallback((): Presentation => {
    // Include text that is being edited.
    if (editingId !== null && editor) {
      const paras = docToParas(editor.getJSON());
      return { ...pres, slides: pres.slides.map((sl, i) => (i === index ? { ...sl, shapes: sl.shapes.map((x) => (x.id === editingId ? { ...x, paragraphs: paras } : x)) } : sl)) };
    }
    return pres;
  }, [pres, editingId, editor, index]);

  const saveTo = useCallback(
    async (target: string) => {
      const p = presentationNow();
      const lost = await officeInvoke<string[]>("slides_save", { path: target, presentation: p });
      setPath(target);
      setSaved(p);
      setPresState(p);
      addRecent("slides", target);
      const warn = lossMessage(lost);
      if (warn) notify(`Gespeichert: ${baseName(target)}`, warn, "warning");
      else notify("Gespeichert", baseName(target), "success");
    },
    [presentationNow, notify],
  );

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (!isTauri) {
      notify("Speichern", "Im Browser-Vorschaumodus nicht verfügbar.");
      return false;
    }
    const target = await pickSavePath("slides", withoutExt(name), path ? extOf(path) : undefined);
    if (!target) return false;
    try {
      await saveTo(target);
      return true;
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      return false;
    }
  }, [name, notify, saveTo, path]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!path) return saveAs();
    try {
      await saveTo(path);
      return true;
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      return false;
    }
  }, [path, saveAs, saveTo, notify]);

  const open = useCallback(
    async (target?: string) => {
      const p = target ?? (await pickOpenPath("slides"));
      if (!p) return;
      setBackstage(null);
      if (!path && !dirtyRef.current) await load(p);
      else await openDocumentWindow("slides", p);
    },
    [load, path],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(withoutExt(name)), save), [name, save, unsaved]);

  const startShow = (mode: "start" | "current" | "presenter") => {
    if (editingId !== null) stopEditing();
    setShowing({ start: mode === "start" ? 0 : index, presenter: mode === "presenter" });
  };

  /** Prints the slides (one per page) or exports them as PDF. */
  const print = (pdf?: string) => {
    setBackstage(null);
    const style = document.createElement("style");
    style.textContent = `@page { size: ${pres.width * 0.75}pt ${pres.height * 0.75}pt; margin: 0; }`;
    document.head.appendChild(style);
    setPrinting(true);
    setTimeout(async () => {
      if (pdf) {
        const mm = (px: number) => (px * 25.4) / 96;
        try {
          await printToPdf(pdf, mm(pres.width), mm(pres.height));
          notify("Als PDF exportiert", baseName(pdf));
        } catch (e) {
          notify("PDF-Export fehlgeschlagen", errorMessage(e), "error");
        }
      } else window.print();
      style.remove();
      setPrinting(false);
    }, 200);
  };

  const exportPdf = async () => {
    const target = await pickPdfPath(withoutExt(name));
    if (target) print(target);
  };

  // ------------------------------------------------------------- keyboard --

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const inInput = (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]");
      if (ctrl && k === "s") return e.preventDefault(), void (e.shiftKey ? saveAs() : save());
      if (ctrl && k === "o") return e.preventDefault(), void open();
      if (ctrl && k === "n") return e.preventDefault(), void openDocumentWindow("slides");
      if (ctrl && k === "p") return e.preventDefault(), print();
      if (e.key === "F5") return e.preventDefault(), startShow(e.shiftKey ? "current" : "start");
      if (ctrl && k === "m") return e.preventDefault(), addSlide("titleContent");
      if (editingId !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          stopEditing();
        }
        return;
      }
      if (inInput || editCell) return;
      if (ctrl && k === "z") return e.preventDefault(), undo();
      if (ctrl && k === "y") return e.preventDefault(), redo();
      if (ctrl && k === "c") return e.preventDefault(), copyShapes(false);
      if (ctrl && k === "x") return e.preventDefault(), copyShapes(true);
      if (ctrl && k === "v") return e.preventDefault(), pasteShapes();
      if (ctrl && k === "a") return e.preventDefault(), setSelected(slide.shapes.map((x) => x.id));
      if (ctrl && k === "d") {
        e.preventDefault();
        if (selected.length) {
          copyShapes(false);
          pasteShapes();
        } else duplicateSlide();
        return;
      }
      if (ctrl && ["b", "i", "u"].includes(k) && selected.length) return e.preventDefault(), textCmd({ toggle: k === "b" ? "bold" : k === "i" ? "italic" : "underline" });
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
        e.preventDefault();
        updateSlide((sl) => ({ ...sl, shapes: sl.shapes.filter((x) => !selected.includes(x.id)), animations: sl.animations?.filter((a) => !selected.includes(a.shape)) }));
        setSelected([]);
        return;
      }
      if (e.key.startsWith("Arrow") && selected.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const [dx, dy] = e.key === "ArrowLeft" ? [-d, 0] : e.key === "ArrowRight" ? [d, 0] : e.key === "ArrowUp" ? [0, -d] : [0, d];
        updateShapes(selected, (x) => ({ ...x, x: x.x + dx, y: x.y + dy }));
        return;
      }
      if ((e.key === "PageDown" || e.key === "ArrowDown" || e.key === "ArrowRight") && !selected.length) return e.preventDefault(), goSlide(index + 1);
      if ((e.key === "PageUp" || e.key === "ArrowUp" || e.key === "ArrowLeft") && !selected.length) return e.preventDefault(), goSlide(index - 1);
      if (e.key === "Escape") setSelected([]);
      if ((e.key === "Enter" || e.key === "F2") && selected.length === 1) {
        const sh = slide.shapes.find((x) => x.id === selected[0]);
        if (sh?.kind === "table") return e.preventDefault(), startCellEdit(sh.id, 0, 0);
        if (sh?.kind === "chart") return e.preventDefault(), setChartEdit(sh.id);
        if (sh && sh.kind !== "image" && sh.kind !== "line") (e.preventDefault(), setEditingId(sh.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --------------------------------------------------------------- render --

  const selShapes = slide.shapes.filter((x) => selected.includes(x.id));
  const ratio = Math.abs(pres.width / pres.height - 16 / 9) < 0.02 ? "16:9" : Math.abs(pres.width / pres.height - 4 / 3) < 0.02 ? "4:3" : "custom";
  const virtualTarget = (x: number, y: number) => ({ getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect });
  const handleSize = 10 / scale;

  const thumbs = useMemo(
    () =>
      pres.slides.map((sl, i) => (
        <div key={i}>
          {dropAt === i && <div className="nx-thumb-drop" />}
          <div
            className={`nx-thumb ${i === index ? "nx-thumb-active" : ""} ${sl.hidden ? "nx-thumb-hidden" : ""}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/x-nexora-slide", String(i))}
            onDragOver={(e) => {
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData("text/x-nexora-slide"));
              const to = dropAt ?? i;
              setDropAt(null);
              if (Number.isNaN(from) || to === from || to === from + 1) return;
              setPres((p) => {
                const slides = [...p.slides];
                const [x] = slides.splice(from, 1);
                slides.splice(to > from ? to - 1 : to, 0, x);
                return { ...p, slides };
              });
              setIndex(to > from ? to - 1 : to);
            }}
            onClick={() => goSlide(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              goSlide(i);
              setThumbMenu({ x: e.clientX, y: e.clientY, index: i });
            }}
          >
            <span className="nx-thumb-num">{i + 1}</span>
            <div className="nx-thumb-frame">
              <SlideThumb slide={sl} width={160} presWidth={pres.width} presHeight={pres.height} />
            </div>
          </div>
        </div>
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pres, index, dropAt],
  );

  return (
    <div className={s.root}>
      <SuiteHeader appName="Präsentation" logo="/slides.svg" center={`${withoutExt(name)}${dirty ? " •" : ""}${path ? "" : " – nicht gespeichert"}`} />
      <SlidesRibbon
        color={COLOR}
        tab={tab}
        onTab={setTab}
        text={textState}
        hasSelection={selected.length > 0 || editingId !== null}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        slideHidden={!!slide.hidden}
        showNotes={showNotes}
        ratio={ratio}
        onFile={() => setBackstage("open")}
        onUndo={undo}
        onRedo={redo}
        onClipboard={(a) => (a === "paste" ? pasteShapes() : copyShapes(a === "cut"))}
        onNewSlide={addSlide}
        onDuplicateSlide={() => duplicateSlide()}
        onDeleteSlide={() => deleteSlide()}
        onHideSlide={() => updateSlide((sl) => ({ ...sl, hidden: !sl.hidden || undefined }))}
        onLayout={changeLayout}
        onText={textCmd}
        onAnchor={(a) => updateShapes(editingId !== null ? [editingId] : selected, (x) => ({ ...x, anchor: a }))}
        onInsertText={insertTextBox}
        onInsertImage={() => imageInput.current?.click()}
        onInsertShape={insertShape}
        onFill={(c) => updateShapes(selected, (x) => ({ ...x, fill: c ?? undefined }))}
        onLine={(c, w) => updateShapes(selected, (x) => ({ ...x, line: c === null ? undefined : c ?? x.line ?? "#000000", lineWidth: c === null ? undefined : w ?? x.lineWidth ?? 1 }))}
        onArrange={arrange}
        onAlign={alignShapes}
        onFlip={(a) => updateShapes(selected, (x) => (a === "h" ? { ...x, flipH: !x.flipH || undefined } : a === "v" ? { ...x, flipV: !x.flipV || undefined } : { ...x, rotation: (((x.rotation ?? 0) + 90) % 360) || undefined }))}
        onTheme={applyTheme}
        onBackground={(c, all) =>
          all ? setPres((p) => ({ ...p, slides: p.slides.map((sl) => ({ ...sl, background: slide.background, backgroundImage: slide.backgroundImage })) })) : updateSlide((sl) => ({ ...sl, background: c ?? undefined, backgroundImage: undefined }))
        }
        onSize={setSize}
        onShow={startShow}
        onToggleNotes={() => setShowNotes((v) => !v)}
        onFit={() => setCanvasSize((x) => ({ ...x }))}
        onInsertTable={insertTable}
        onInsertChart={insertChart}
        table={selTable?.table ?? null}
        chart={selChart?.chart ?? null}
        onTable={tableAction}
        onTableColor={(c) => selTable && patchTable(selTable.id, (t) => ({ ...t, color: c }))}
        onCellFill={(c) =>
          selTable &&
          patchTable(selTable.id, (t) => {
            const cell = lastCell.current && lastCell.current[0] === selTable.id ? lastCell.current : null;
            return { ...t, rows: t.rows.map((row, ri) => ({ ...row, cells: row.cells.map((x, ci) => (!cell || (cell[1] === ri && cell[2] === ci) ? { ...x, fill: c ?? undefined } : x)) })) };
          })
        }
        onChartPatch={(patch) => selChart && patchChart(selChart.id, patch)}
        onChartData={() => selChart && setChartEdit(selChart.id)}
        onChartTitle={() => selChart && setChartTitle(selChart.id)}
        transition={slide?.transition}
        onTransition={(t) => {
          updateSlide((sl) => ({ ...sl, transition: t ?? undefined }));
          if (t && t.kind !== "cut") setPreview({ mode: "transition", key: Date.now() });
        }}
        onTransitionAll={() => setPres((p) => ({ ...p, slides: p.slides.map((x) => ({ ...x, transition: slide.transition })) }))}
        onPreview={() => setPreview({ mode: tab === "animations" ? "animations" : "transition", key: Date.now() })}
        animation={selAnim}
        shapeAnimations={shapeAnimIdx.map((i) => anims[i])}
        animIndex={Math.max(0, shapeAnimIdx.indexOf(curAnimIdx))}
        onAnimPick={(i) => setAnimSel(shapeAnimIdx[i] ?? -1)}
        onAnimation={setAnimation}
        onAddAnimation={addAnimation}
        onAnimMove={moveAnimation}
        onInsertMedia={(kind) => {
          if (!mediaInput.current) return;
          mediaInput.current.accept = kind === "video" ? "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov" : "audio/mpeg,audio/mp4,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg";
          mediaInput.current.click();
        }}
      />
      <div className={s.main}>
        <div className="nx-thumbs" onDragLeave={() => setDropAt(null)}>
          {thumbs}
        </div>
        <div className={s.editor}>
          <div ref={canvasRef} className="nx-slide-canvas" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={(e) => e.target === canvasRef.current && (editingId !== null ? stopEditing() : setSelected([]))}>
            <div ref={stageRef} className="nx-stage" style={{ width: pres.width * scale, height: pres.height * scale, flexShrink: 0 }} onMouseDown={onStageDown}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: pres.width, height: pres.height, position: "relative" }}>
                <SlideView slide={slide} width={pres.width} height={pres.height} editingId={editingId} showPrompts editCell={editCell} />
                {editingShape && <ShapeTextEditor shape={editingShape} editor={editor} />}
                {editCell && cellBox && (
                  <textarea
                    ref={cellInput}
                    className="nx-cell-editor"
                    value={cellText}
                    style={{ left: cellBox.left, top: cellBox.top, width: cellBox.width, height: Math.max(cellBox.height, (cellText.split("\n").length * 1.2 + 0.6) * cellBox.font), fontSize: cellBox.font, textAlign: (cellBox.align as React.CSSProperties["textAlign"]) ?? "left" }}
                    onChange={(e) => setCellText(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onBlur={() => commitCell(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        moveCell(e.shiftKey ? -1 : 1);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        commitCell(null);
                      }
                    }}
                  />
                )}
                {tab === "animations" &&
                  (() => {
                    // Motion paths of the selected shapes, from the shape's centre;
                    // consecutive paths start where the previous one ends.
                    const ends = new Map<number, [number, number]>();
                    return (slide.animations ?? []).map((a, i) => {
                      if (a.class !== "path" || !a.path) return null;
                      const sh = slide.shapes.find((x) => x.id === a.shape);
                      const [sx, sy] = ends.get(a.shape) ?? [0, 0];
                      const pts = pathPoints(a.path);
                      const last = pts[pts.length - 1];
                      ends.set(a.shape, [sx + last[0], sy + last[1]]);
                      if (!sh || !selected.includes(sh.id)) return null;
                      const W = pres.width;
                      const H = pres.height;
                      const xy = pts.map(([x, y]) => [sh.x + sh.w / 2 + (sx + x) * W, sh.y + sh.h / 2 + (sy + y) * H]);
                      const [ex, ey] = xy[xy.length - 1];
                      return (
                        <svg key={`path${i}`} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 19 }}>
                          <polyline points={xy.map((p) => p.join(",")).join(" ")} fill="none" stroke="#c43e1c" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />
                          <circle cx={xy[0][0]} cy={xy[0][1]} r={5 / scale} fill="#2e9e44" />
                          <circle cx={ex} cy={ey} r={5 / scale} fill="#c43e1c" />
                        </svg>
                      );
                    });
                  })()}
                {tab === "animations" &&
                  slide.shapes
                    .filter((sh) => animBadges.has(sh.id))
                    .map((sh) => (
                      <div key={`b${sh.id}`} className="nx-anim-badge" style={{ left: sh.x - 22 / scale, top: sh.y, transform: `scale(${1 / scale})`, transformOrigin: "100% 0" }}>
                        {animBadges.get(sh.id)?.join(", ")}
                      </div>
                    ))}
                {preview && <PreviewOverlay key={preview.key} pres={pres} index={index} mode={preview.mode} onDone={() => setPreview(null)} />}
                {selShapes.map((sh) => (
                  <div
                    key={sh.id}
                    style={{ position: "absolute", left: sh.x, top: sh.y, width: sh.w, height: sh.h, transform: sh.rotation ? `rotate(${sh.rotation}deg)` : undefined, pointerEvents: "none", zIndex: 10 }}
                  >
                    <div className="nx-sel-box" style={{ inset: 0, borderWidth: 1 / scale, borderStyle: editingId === sh.id ? "dashed" : "solid" }} />
                    {selShapes.length === 1 &&
                      editingId === null &&
                      HANDLES.filter((h) => sh.kind !== "line" || h === "nw" || h === "se").map((h) => {
                        const left = h.includes("w") ? 0 : h.includes("e") ? sh.w : sh.w / 2;
                        const top = h.includes("n") ? 0 : h.includes("s") ? sh.h : sh.h / 2;
                        return (
                          <div
                            key={h}
                            className="nx-handle"
                            style={{ left: left - handleSize / 2, top: top - handleSize / 2, width: handleSize, height: handleSize, borderWidth: 1.5 / scale, cursor: `${h}-resize` }}
                            onMouseDown={(e) => onHandleDown(e, sh, h)}
                          />
                        );
                      })}
                    {selShapes.length === 1 && editingId === null && sh.kind !== "line" && (
                      <div className="nx-rot" style={{ left: sh.w / 2 - 7 / scale, top: -28 / scale, width: 14 / scale, height: 14 / scale, borderWidth: 1.5 / scale }} onMouseDown={(e) => onHandleDown(e, sh, "rot")} />
                    )}
                  </div>
                ))}
                {guides.x !== undefined && <div className="nx-guide" style={{ left: guides.x, top: 0, bottom: 0, width: 1 / scale }} />}
                {guides.y !== undefined && <div className="nx-guide" style={{ top: guides.y, left: 0, right: 0, height: 1 / scale }} />}
                {drag?.kind === "marquee" && (
                  <div
                    className="nx-marquee"
                    style={{ left: Math.min(drag.start.x, drag.cur.x), top: Math.min(drag.start.y, drag.cur.y), width: Math.abs(drag.cur.x - drag.start.x), height: Math.abs(drag.cur.y - drag.start.y), borderWidth: 1 / scale }}
                  />
                )}
              </div>
            </div>
            {loading && (
              <div className={s.loading}>
                <Spinner label="Präsentation wird geöffnet…" />
              </div>
            )}
          </div>
          {showNotes && (
            <textarea
              className="nx-notes"
              placeholder="Klicken Sie, um Notizen hinzuzufügen"
              value={slide.notes}
              onChange={(e) => {
                const v = e.target.value;
                setPresState((p) => ({ ...p, slides: p.slides.map((sl, i) => (i === index ? { ...sl, notes: v } : sl)) }));
              }}
            />
          )}
        </div>
      </div>
      <StatusBar>
        <span>
          Folie {index + 1} von {pres.slides.length}
        </span>
        <span>Deutsch (Deutschland)</span>
        {warnings.length > 0 && (
          <Button size="small" appearance="transparent" onClick={() => setBackstage("info")} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
            ⚠ Kompatibilitätshinweise
          </Button>
        )}
        <span style={{ marginLeft: "auto" }}>{Math.round(scale * 100)} %</span>
      </StatusBar>

      <input
        ref={mediaInput}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertMedia(f);
          e.target.value = "";
        }}
      />
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

      <Menu open={!!thumbMenu} onOpenChange={(_, d) => !d.open && setThumbMenu(null)} positioning={{ target: thumbMenu ? virtualTarget(thumbMenu.x, thumbMenu.y) : undefined, position: "below", align: "start" }}>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => addSlide("titleContent")}>Neue Folie</MenuItem>
            <MenuItem onClick={() => thumbMenu && duplicateSlide(thumbMenu.index)}>Folie duplizieren</MenuItem>
            <MenuItem onClick={() => thumbMenu && deleteSlide(thumbMenu.index)}>Folie löschen</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => thumbMenu && updateSlide((sl) => ({ ...sl, hidden: !sl.hidden || undefined }), thumbMenu.index)}>
              {thumbMenu && pres.slides[thumbMenu.index]?.hidden ? "Folie einblenden" : "Folie ausblenden"}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      {backstage && (
        <Backstage
          app="slides"
          color={COLOR}
          initialPage={backstage}
          onClose={() => setBackstage(null)}
          onNew={() => (setBackstage(null), void openDocumentWindow("slides"))}
          onOpen={(p) => void open(p)}
          onSave={() => (setBackstage(null), void save())}
          onSaveAs={() => (setBackstage(null), void saveAs())}
          onPrint={() => print()}
          onExportPdf={isTauri ? () => void exportPdf() : undefined}
          info={
            <DocumentInfo
              path={path}
              title={pres.title}
              author={pres.author}
              onChange={(title, author) => setPres((p) => ({ ...p, title, author }))}
              warnings={warnings}
              stats={<Text>{pres.slides.length} Folien · {ratio === "custom" ? `${Math.round(pres.width)}×${Math.round(pres.height)}` : ratio}</Text>}
            />
          }
        />
      )}
      {showing && <SlideShow pres={presentationNow()} start={showing.start} presenter={showing.presenter} onExit={() => setShowing(null)} />}
      {unsaved.dialog}
      <ChartDataDialog
        chart={slide?.shapes.find((x) => x.id === chartEdit)?.chart ?? null}
        onClose={() => setChartEdit(null)}
        onApply={(c) => chartEdit !== null && patchChart(chartEdit, c)}
      />
      <TextDialog
        open={chartTitle !== null}
        title="Diagrammtitel"
        label="Titel (leer = kein Titel)"
        initial={slide?.shapes.find((x) => x.id === chartTitle)?.chart?.title ?? ""}
        onClose={() => setChartTitle(null)}
        onApply={(v) => chartTitle !== null && patchChart(chartTitle, { title: v.trim() || undefined })}
      />
      {printing &&
        createPortal(
          <div className="nx-print-root">
            {pres.slides.map((sl, i) =>
              sl.hidden ? null : (
                <div key={i} className="nx-print-slide" style={{ width: pres.width * 0.75 + "pt", height: pres.height * 0.75 + "pt" }}>
                  <div style={{ transform: "scale(1)", transformOrigin: "0 0" }}>
                    <SlideView slide={sl} width={pres.width} height={pres.height} />
                  </div>
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
