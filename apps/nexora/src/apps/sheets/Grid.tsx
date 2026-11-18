// The spreadsheet grid: virtualised rendering of the visible cells with
// frozen panes, selection, editing, resizing and the fill handle.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Scalar } from "./formula";
import { colName, isError } from "./formula";
import { formatValue } from "./format";
import { type Anchor, Axis, type Book, type CalcResult, type CellStyle, DEFAULT_COL, DEFAULT_ROW, MAX_COLS, MAX_ROWS, type Rect, extentOf, key, mergeAt } from "./model";
import type { CondCell } from "./features";
import { type Chart, ChartView } from "../chart/ChartView";

export interface Pos {
  r: number;
  c: number;
}
export interface Selection {
  anchor: Pos;
  focus: Pos;
}

export const selRect = (s: Selection): Rect => ({
  r1: Math.min(s.anchor.r, s.focus.r),
  c1: Math.min(s.anchor.c, s.focus.c),
  r2: Math.max(s.anchor.r, s.focus.r),
  c2: Math.max(s.anchor.c, s.focus.c),
});

export interface Editing {
  r: number;
  c: number;
  text: string;
  /** "enter": arrow keys commit and move; "edit": arrow keys move the caret. */
  mode: "enter" | "edit";
}

export interface GridHandle {
  focus: () => void;
  scrollTo: (r: number, c: number) => void;
}

export interface GridProps {
  book: Book;
  values: CalcResult;
  sheet: number;
  selection: Selection;
  onSelection: (s: Selection) => void;
  editing: Editing | null;
  onEditText: (text: string, caret?: number) => void;
  onStartEdit: (text: string | null, mode: "enter" | "edit") => void;
  onCommit: (move: [number, number] | null) => void;
  onCancel: () => void;
  /** While typing a formula: a clicked cell/range is inserted as reference. */
  pointMode: boolean;
  onPoint: (rect: Rect, extend: boolean) => void;
  onResize: (axis: "row" | "col", index: number, size: number) => void;
  onAutoFit: (axis: "row" | "col", index: number) => void;
  onFill: (src: Rect, dest: Rect) => void;
  onKey: (e: React.KeyboardEvent) => boolean;
  onCopy: (e: React.ClipboardEvent) => void;
  onCut: (e: React.ClipboardEvent) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onContextMenu: (x: number, y: number) => void;
  zoom: number;
  copyRect: Rect | null;
  /** Conditional formatting result of the sheet. */
  cond: Map<number, CondCell>;
  selectedObject: string | null;
  onSelectObject: (id: string | null) => void;
  onObjectAnchor: (id: string, anchor: Anchor) => void;
  onObjectOpen: (id: string) => void;
  /** Chart with its data read from the cells. */
  chartData: (c: Chart) => Chart;
  onFilterButton: (col: number, at: DOMRect) => void;
  /** Sparklines with their data. */
  sparks: SparkView[];
  /** The active cell has a list validation: show the drop-down arrow. */
  listButton: boolean;
  onListButton: (at: DOMRect) => void;
  /** Input message of the active cell's validation. */
  prompt: { title?: string; text?: string } | null;
}

export interface SparkView {
  r: number;
  c: number;
  kind: string;
  color?: string;
  negativeColor?: string;
  markers?: boolean;
  values: (number | null)[];
}

/** Tiny line, column or win/loss chart inside a cell. */
function SparkSvg({ s, w, h }: { s: SparkView; w: number; h: number }) {
  const vals = s.values;
  const nums = vals.filter((v): v is number => v !== null);
  if (!nums.length || w < 6 || h < 6) return null;
  const pad = 3;
  const color = s.color ?? "#376092";
  const neg = s.negativeColor ?? "#d00000";
  const n = vals.length;
  if (s.kind === "line") {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const y = (v: number) => pad + (h - 2 * pad) * (hi === lo ? 0.5 : 1 - (v - lo) / (hi - lo));
    const x = (i: number) => pad + (n <= 1 ? (w - 2 * pad) / 2 : ((w - 2 * pad) * i) / (n - 1));
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(i)},${y(v)}`;
      pen = true;
    });
    return (
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <path d={d} fill="none" stroke={color} strokeWidth={1.25} />
        {s.markers && vals.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r={1.6} fill={color} />)}
      </svg>
    );
  }
  const bw = (w - 2 * pad) / n;
  if (s.kind === "stacked") {
    return (
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        {vals.map((v, i) => v !== null && v !== 0 && <rect key={i} x={pad + i * bw + bw * 0.1} y={v > 0 ? pad : h / 2} width={bw * 0.8} height={h / 2 - pad} fill={v > 0 ? color : neg} />)}
      </svg>
    );
  }
  const lo = Math.min(0, ...nums);
  const hi = Math.max(0, ...nums);
  const y = (v: number) => pad + (h - 2 * pad) * (hi === lo ? 0.5 : 1 - (v - lo) / (hi - lo));
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
      {vals.map((v, i) => v !== null && <rect key={i} x={pad + i * bw + bw * 0.1} y={Math.min(y(v), y(0))} width={bw * 0.8} height={Math.max(1, Math.abs(y(v) - y(0)))} fill={v < 0 ? neg : color} />)}
    </svg>
  );
}

type ObjDrag = { id: string; mode: string; sx: number; sy: number; d: { x: number; y: number; w: number; h: number } };

const HEADER_W = 46;
const HEADER_H = 24;

const BORDER: Record<string, string> = {
  thin: "1px solid #000",
  hair: "1px solid #999",
  medium: "2px solid #000",
  thick: "3px solid #000",
  double: "3px double #000",
  dashed: "1px dashed #000",
  dotted: "1px dotted #000",
  mediumDashed: "2px dashed #000",
  dashDot: "1px dashed #000",
  mediumDashDot: "2px dashed #000",
  dashDotDot: "1px dotted #000",
  slantDashDot: "2px dashed #000",
};

export function cellCss(st: CellStyle | undefined, zoom: number): React.CSSProperties {
  const s = st ?? {};
  return {
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? "italic" : undefined,
    textDecoration: [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || undefined,
    fontFamily: s.font ? `"${s.font}", Calibri, Carlito, sans-serif` : undefined,
    fontSize: `${((s.size10 ?? 110) / 10) * (4 / 3) * zoom}px`,
    color: s.color,
    backgroundColor: s.fill,
  };
}

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(p, ref) {
  const sheet = p.book.sheets[p.sheet];
  const scroller = useRef<HTMLDivElement>(null);
  const keyInput = useRef<HTMLTextAreaElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState({ w: 800, h: 600 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [resizing, setResizing] = useState<null | { axis: "row" | "col"; index: number; start: number; size: number; cur: number }>(null);
  const [fill, setFill] = useState<null | Rect>(null);
  const drag = useRef<null | "select" | "point" | "fill" | "rows" | "cols">(null);
  const [objDrag, setObjDrag] = useState<ObjDrag | null>(null);
  const z = p.zoom;

  const cols = useMemo(() => new Axis(DEFAULT_COL, resizing?.axis === "col" ? new Map([...sheet.cols, [resizing.index, resizing.cur]]) : sheet.cols, sheet.hiddenCols, z), [sheet.cols, sheet.hiddenCols, z, resizing]);
  const rows = useMemo(() => new Axis(DEFAULT_ROW, resizing?.axis === "row" ? new Map([...sheet.rows, [resizing.index, resizing.cur]]) : sheet.rows, sheet.hiddenRows, z), [sheet.rows, sheet.hiddenRows, z, resizing]);
  const extent = useMemo(() => extentOf(sheet), [sheet]);
  const sel = selRect(p.selection);

  // Scrollable size grows with content and as the user scrolls.
  const nRows = Math.min(MAX_ROWS, Math.max(200, extent.rows + 100, sel.r2 + 50, rows.at(scroll.y + view.h * 2, MAX_ROWS)));
  const nCols = Math.min(MAX_COLS, Math.max(40, extent.cols + 20, sel.c2 + 10, cols.at(scroll.x + view.w * 2, MAX_COLS)));
  const frozenW = cols.pos(sheet.freezeCols);
  const frozenH = rows.pos(sheet.freezeRows);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xOf = useCallback((c: number) => HEADER_W + cols.pos(c) - (c >= sheet.freezeCols ? scroll.x : 0), [cols, sheet.freezeCols, scroll.x]);
  const yOf = useCallback((r: number) => HEADER_H + rows.pos(r) - (r >= sheet.freezeRows ? scroll.y : 0), [rows, sheet.freezeRows, scroll.y]);

  const scrollTo = useCallback(
    (r: number, c: number) => {
      const el = scroller.current;
      if (!el) return;
      let { scrollLeft: x, scrollTop: y } = el;
      if (c >= sheet.freezeCols) {
        const left = cols.pos(c) - frozenW;
        const right = cols.pos(c + 1) - (view.w - HEADER_W);
        if (left < x) x = left;
        else if (right > x) x = right;
      }
      if (r >= sheet.freezeRows) {
        const top = rows.pos(r) - frozenH;
        const bottom = rows.pos(r + 1) - (view.h - HEADER_H);
        if (top < y) y = top;
        else if (bottom > y) y = bottom;
      }
      if (x !== el.scrollLeft || y !== el.scrollTop) el.scrollTo(Math.max(0, x), Math.max(0, y));
    },
    [cols, rows, frozenW, frozenH, view, sheet.freezeCols, sheet.freezeRows],
  );

  useImperativeHandle(ref, () => ({ focus: () => keyInput.current?.focus({ preventScroll: true }), scrollTo }), [scrollTo]);

  useEffect(() => {
    scrollTo(p.selection.focus.r, p.selection.focus.c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selection.focus.r, p.selection.focus.c, p.sheet]);

  useEffect(() => {
    if (p.editing) {
      const el = editInput.current;
      if (el && document.activeElement !== el) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
      }
    } else keyInput.current?.focus({ preventScroll: true });
  }, [p.editing === null, p.editing?.r, p.editing?.c]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------- hit test --

  const hit = (clientX: number, clientY: number) => {
    const rect = scroller.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cx = x - HEADER_W;
    const cy = y - HEADER_H;
    const c = cx < 0 ? -1 : cols.at(cx < frozenW ? cx : cx + scroll.x, nCols - 1);
    const r = cy < 0 ? -1 : rows.at(cy < frozenH ? cy : cy + scroll.y, nRows - 1);
    return { x, y, r, c };
  };

  const boundaryNear = (axis: "row" | "col", px: number): number | null => {
    // Header position → index whose trailing edge is within 4px.
    const a = axis === "col" ? cols : rows;
    const frozen = axis === "col" ? frozenW : frozenH;
    const off = axis === "col" ? scroll.x : scroll.y;
    const v = px < frozen ? px : px + off;
    const i = a.at(v, axis === "col" ? nCols - 1 : nRows - 1);
    const end = a.pos(i + 1);
    const start = a.pos(i);
    if (Math.abs(v - end) <= 4) return i;
    if (Math.abs(v - start) <= 4 && i > 0) return i - 1;
    return null;
  };

  const [cursor, setCursor] = useState("cell");

  const onMouseMove = (e: React.MouseEvent) => {
    if (drag.current || resizing) return;
    const h = hit(e.clientX, e.clientY);
    if (h.y < HEADER_H && h.x > HEADER_W && boundaryNear("col", h.x - HEADER_W) !== null) setCursor("col-resize");
    else if (h.x < HEADER_W && h.y > HEADER_H && boundaryNear("row", h.y - HEADER_H) !== null) setCursor("row-resize");
    else if (h.y < HEADER_H || h.x < HEADER_W) setCursor(h.y < HEADER_H && h.x >= HEADER_W ? "s-resize" : h.x < HEADER_W && h.y >= HEADER_H ? "e-resize" : "default");
    else setCursor("cell");
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (p.selectedObject) p.onSelectObject(null);
    if (e.button === 2) {
      const h = hit(e.clientX, e.clientY);
      if (h.r >= 0 && h.c >= 0 && !(h.r >= sel.r1 && h.r <= sel.r2 && h.c >= sel.c1 && h.c <= sel.c2)) p.onSelection({ anchor: { r: h.r, c: h.c }, focus: { r: h.r, c: h.c } });
      return;
    }
    if (e.button !== 0) return;
    const h = hit(e.clientX, e.clientY);
    // Resize handles in the headers.
    if (h.y < HEADER_H && h.x > HEADER_W) {
      const i = boundaryNear("col", h.x - HEADER_W);
      if (i !== null) {
        e.preventDefault();
        if (e.detail === 2) return p.onAutoFit("col", i);
        setResizing({ axis: "col", index: i, start: e.clientX, size: cols.size(i) / z, cur: cols.size(i) / z });
        return;
      }
    }
    if (h.x < HEADER_W && h.y > HEADER_H) {
      const i = boundaryNear("row", h.y - HEADER_H);
      if (i !== null) {
        e.preventDefault();
        if (e.detail === 2) return p.onAutoFit("row", i);
        setResizing({ axis: "row", index: i, start: e.clientY, size: rows.size(i) / z, cur: rows.size(i) / z });
        return;
      }
    }
    e.preventDefault();
    if (h.y < HEADER_H && h.x < HEADER_W) {
      p.onSelection({ anchor: { r: 0, c: 0 }, focus: { r: MAX_ROWS - 1, c: MAX_COLS - 1 } });
      return;
    }
    if (h.y < HEADER_H) {
      drag.current = "cols";
      const anchor = e.shiftKey ? { r: 0, c: p.selection.anchor.c } : { r: 0, c: h.c };
      p.onSelection({ anchor, focus: { r: MAX_ROWS - 1, c: h.c } });
      return;
    }
    if (h.x < HEADER_W) {
      drag.current = "rows";
      const anchor = e.shiftKey ? { r: p.selection.anchor.r, c: 0 } : { r: h.r, c: 0 };
      p.onSelection({ anchor, focus: { r: h.r, c: MAX_COLS - 1 } });
      return;
    }
    if (p.pointMode) {
      drag.current = "point";
      p.onPoint({ r1: h.r, c1: h.c, r2: h.r, c2: h.c }, false);
      pointStart.current = { r: h.r, c: h.c };
      return;
    }
    if (p.editing) p.onCommit(null);
    if (e.detail === 2) {
      p.onSelection({ anchor: { r: h.r, c: h.c }, focus: { r: h.r, c: h.c } });
      p.onStartEdit(null, "edit");
      return;
    }
    drag.current = "select";
    const m = mergeAt(sheet, h.r, h.c);
    if (e.shiftKey) p.onSelection({ anchor: p.selection.anchor, focus: { r: h.r, c: h.c } });
    else p.onSelection({ anchor: { r: m?.r1 ?? h.r, c: m?.c1 ?? h.c }, focus: { r: m?.r2 ?? h.r, c: m?.c2 ?? h.c } });
  };
  const pointStart = useRef<Pos>({ r: 0, c: 0 });

  const onFillDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = "fill";
    setFill(sel);
  };

  // Window-level drag tracking.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (resizing) {
        const d = (resizing.axis === "col" ? e.clientX : e.clientY) - resizing.start;
        setResizing({ ...resizing, cur: Math.max(resizing.axis === "col" ? 8 : 6, resizing.size + d / z) });
        return;
      }
      const mode = drag.current;
      if (!mode) return;
      const h = hit(e.clientX, e.clientY);
      const r = Math.max(0, h.r);
      const c = Math.max(0, h.c);
      if (mode === "select") p.onSelection({ anchor: p.selection.anchor, focus: { r, c } });
      else if (mode === "cols") p.onSelection({ anchor: p.selection.anchor, focus: { r: MAX_ROWS - 1, c } });
      else if (mode === "rows") p.onSelection({ anchor: p.selection.anchor, focus: { r, c: MAX_COLS - 1 } });
      else if (mode === "point") {
        const s0 = pointStart.current;
        p.onPoint({ r1: Math.min(s0.r, r), c1: Math.min(s0.c, c), r2: Math.max(s0.r, r), c2: Math.max(s0.c, c) }, true);
      } else if (mode === "fill") {
        // Extend along the axis with the larger distance.
        const dr = r > sel.r2 ? r - sel.r2 : r < sel.r1 ? r - sel.r1 : 0;
        const dc = c > sel.c2 ? c - sel.c2 : c < sel.c1 ? c - sel.c1 : 0;
        if (Math.abs(dr) >= Math.abs(dc)) setFill({ ...sel, r1: Math.min(sel.r1, r), r2: Math.max(sel.r2, r) });
        else setFill({ ...sel, c1: Math.min(sel.c1, c), c2: Math.max(sel.c2, c) });
      }
    };
    const up = () => {
      if (resizing) {
        p.onResize(resizing.axis, resizing.index, Math.round(resizing.cur));
        setResizing(null);
      }
      if (drag.current === "fill" && fill) {
        const same = fill.r1 === sel.r1 && fill.r2 === sel.r2 && fill.c1 === sel.c1 && fill.c2 === sel.c2;
        if (!same) {
          // Destination is the part outside the source.
          const dest = fill.r2 > sel.r2 ? { ...fill, r1: sel.r2 + 1 } : fill.r1 < sel.r1 ? { ...fill, r2: sel.r1 - 1 } : fill.c2 > sel.c2 ? { ...fill, c1: sel.c2 + 1 } : { ...fill, c2: sel.c1 - 1 };
          p.onFill(sel, dest);
          p.onSelection({ anchor: { r: fill.r1, c: fill.c1 }, focus: { r: fill.r2, c: fill.c2 } });
        }
        setFill(null);
      }
      drag.current = null;
      if (!p.editing) keyInput.current?.focus({ preventScroll: true });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  // ------------------------------------------------------------ rendering --

  const value = (r: number, c: number): Scalar => {
    const k = key(r, c);
    const cell = sheet.cells.get(k);
    if (!cell) return null;
    if (cell.f) return p.values[p.sheet]?.get(k) ?? null;
    if (cell.e) return { error: cell.e };
    return cell.v ?? null;
  };

  const visCols = (from: number, to: number) => {
    const out: number[] = [];
    for (let c = from; c <= to && c < nCols; c++) if (!sheet.hiddenCols.has(c)) out.push(c);
    return out;
  };
  const visRows = (from: number, to: number) => {
    const out: number[] = [];
    for (let r = from; r <= to && r < nRows; r++) if (!sheet.hiddenRows.has(r)) out.push(r);
    return out;
  };
  const scrolledCols = visCols(Math.max(sheet.freezeCols, cols.at(scroll.x + frozenW, nCols - 1)), cols.at(scroll.x + view.w - HEADER_W, nCols - 1));
  const scrolledRows = visRows(Math.max(sheet.freezeRows, rows.at(scroll.y + frozenH, nRows - 1)), rows.at(scroll.y + view.h - HEADER_H, nRows - 1));
  const frozenCols = visCols(0, sheet.freezeCols - 1);
  const frozenRows = visRows(0, sheet.freezeRows - 1);
  const allCols = [...frozenCols, ...scrolledCols];
  const allRows = [...frozenRows, ...scrolledRows];

  const editingKey = p.editing ? key(p.editing.r, p.editing.c) : -1;
  const merges = sheet.merges.filter((m) => allRows.some((r) => r >= m.r1 && r <= m.r2) && allCols.some((c) => c >= m.c1 && c <= m.c2));
  const inMerge = (r: number, c: number) => merges.some((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);

  const renderCell = (r: number, c: number, x: number, y: number, w: number, h: number, layer: number, extraW = 0) => {
    const k = key(r, c);
    const cell = sheet.cells.get(k);
    if (!cell || k === editingKey) return null;
    const cf = p.cond.get(k);
    const base = cell.s ? p.book.styles[cell.s] : undefined;
    const st = cf?.style ? { ...(base ?? {}), ...cf.style } : base;
    const v = value(r, c);
    const f = formatValue(v, st?.numFmt);
    const numeric = f.numeric || typeof v === "boolean" || isError(v);
    const hAlign = st?.hAlign ?? (typeof v === "boolean" || isError(v) ? "center" : numeric ? "right" : "left");
    let text = f.text;
    // Numbers that do not fit are shown as ### like in Excel.
    if (f.numeric && !st?.wrap && text.length * 7 * z * ((st?.size10 ?? 110) / 110) > w + 2 && typeof v === "number" && !(st?.numFmt ?? "").includes("@")) text = "#".repeat(Math.max(1, Math.floor(w / (7 * z))));
    const css: React.CSSProperties = {
      ...cellCss(st, z),
      position: "absolute",
      left: x,
      top: y,
      width: w + extraW,
      height: h,
      zIndex: layer,
      display: "flex",
      alignItems: st?.vAlign === "top" ? "flex-start" : st?.vAlign === "middle" ? "center" : "flex-end",
      justifyContent: hAlign === "center" ? "center" : hAlign === "right" ? "flex-end" : "flex-start",
      textAlign: hAlign as React.CSSProperties["textAlign"],
      whiteSpace: st?.wrap ? "pre-wrap" : "pre",
      overflow: "hidden",
      padding: `0 ${3 * z}px`,
      paddingLeft: st?.indent ? `${(3 + st.indent * 9) * z}px` : undefined,
      boxSizing: "border-box",
      lineHeight: 1.15,
      color: cf?.style?.color ?? f.color ?? st?.color,
      backgroundColor: cf?.fill ?? st?.fill ?? (extraW ? "#fff" : undefined),
    };
    const borders = st && (st.borderTop || st.borderBottom || st.borderLeft || st.borderRight);
    return (
      <div key={`c${k}`} className="nx-cell" style={css}>
        {cf?.bar && (
          <span
            className="nx-databar"
            style={{ left: `calc(${cf.bar.start * 100}% + 2px)`, width: `calc(${(cf.bar.end - cf.bar.start) * 100}% - 4px)`, background: `linear-gradient(90deg, ${cf.bar.color}, ${cf.bar.color}40)`, borderColor: cf.bar.color }}
          />
        )}
        <span style={{ position: "relative", overflow: "hidden", textOverflow: st?.wrap ? undefined : "clip", maxWidth: "100%", wordBreak: st?.wrap ? "break-word" : undefined }}>{text}</span>
        {borders && (
          <span
            style={{
              position: "absolute",
              inset: "-1px 0 0 -1px",
              width: w + 1,
              height: h + 1,
              borderTop: st.borderTop ? BORDER[st.borderTop] ?? BORDER.thin : undefined,
              borderBottom: st.borderBottom ? BORDER[st.borderBottom] ?? BORDER.thin : undefined,
              borderLeft: st.borderLeft ? BORDER[st.borderLeft] ?? BORDER.thin : undefined,
              borderRight: st.borderRight ? BORDER[st.borderRight] ?? BORDER.thin : undefined,
              pointerEvents: "none",
              boxSizing: "border-box",
            }}
          />
        )}
      </div>
    );
  };

  const cellsOf = (rs: number[], cs: number[]) => {
    const out: React.ReactNode[] = [];
    for (const r of rs) {
      const y = yOf(r);
      const h = rows.size(r);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (inMerge(r, c)) continue;
        const cell = sheet.cells.get(key(r, c));
        if (!cell) continue;
        let extra = 0;
        // Left-aligned text overflows into empty neighbours.
        const st = cell.s ? p.book.styles[cell.s] : undefined;
        const v = cell.f ? p.values[p.sheet]?.get(key(r, c)) : cell.v;
        const approx = typeof v === "string" ? v.length * 7 * z * ((st?.size10 ?? 110) / 110) : 0;
        if (typeof v === "string" && !st?.wrap && (!st?.hAlign || st.hAlign === "left") && approx > cols.size(c)) {
          for (let j = i + 1; j < cs.length && j < i + 30; j++) {
            const n = sheet.cells.get(key(r, cs[j]));
            if ((n && (n.v !== undefined || n.f)) || inMerge(r, cs[j])) break;
            extra += cols.size(cs[j]);
            if (approx < cols.size(c) + extra) break;
          }
        }
        const node = renderCell(r, c, xOf(c), y, cols.size(c), h, extra ? 2 : 1, extra);
        if (node) out.push(node);
      }
    }
    return out;
  };

  const rectBox = (rc: Rect) => {
    const x1 = xOf(rc.c1);
    const y1 = yOf(rc.r1);
    const x2 = xOf(Math.min(rc.c2, nCols - 1)) + cols.size(Math.min(rc.c2, nCols - 1));
    const y2 = yOf(Math.min(rc.r2, nRows - 1)) + rows.size(Math.min(rc.r2, nRows - 1));
    return { left: x1, top: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
  };
  const selBox = rectBox(sel);
  const activeM = mergeAt(sheet, p.selection.anchor.r, p.selection.anchor.c);
  const activeBox = rectBox(activeM ?? { r1: p.selection.anchor.r, c1: p.selection.anchor.c, r2: p.selection.anchor.r, c2: p.selection.anchor.c });
  const fullRows = sel.c1 === 0 && sel.c2 >= MAX_COLS - 1;
  const fullCols = sel.r1 === 0 && sel.r2 >= MAX_ROWS - 1;

  const editStyle = p.editing ? p.book.styles[sheet.cells.get(key(p.editing.r, p.editing.c))?.s ?? 0] : undefined;
  const editBox = p.editing ? rectBox(mergeAt(sheet, p.editing.r, p.editing.c) ?? { r1: p.editing.r, c1: p.editing.c, r2: p.editing.r, c2: p.editing.c }) : null;

  const af = sheet.autoFilter;

  /** Screen box of a floating object (following an active drag). */
  const objectBox = (id: string, a: Anchor) => {
    let x = xOf(a.col) + a.dx * z;
    let y = yOf(a.row) + a.dy * z;
    let w = a.w * z;
    let h = a.h * z;
    if (objDrag?.id === id) {
      x += objDrag.d.x;
      y += objDrag.d.y;
      w += objDrag.d.w;
      h += objDrag.d.h;
    }
    return { x, y, w, h };
  };

  const startObjDrag = (e: React.MouseEvent, id: string, mode: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (p.editing) p.onCommit(null);
    p.onSelectObject(id);
    setObjDrag({ id, mode, sx: e.clientX, sy: e.clientY, d: { x: 0, y: 0, w: 0, h: 0 } });
  };

  useEffect(() => {
    if (!objDrag) return;
    const move = (e: MouseEvent) => {
      const dx = e.clientX - objDrag.sx;
      const dy = e.clientY - objDrag.sy;
      const o = sheet.objects.find((x) => x.id === objDrag.id);
      if (!o) return;
      const W = o.anchor.w * z;
      const H = o.anchor.h * z;
      const d = { x: 0, y: 0, w: 0, h: 0 };
      const m = objDrag.mode;
      if (m === "move") {
        d.x = dx;
        d.y = dy;
      } else {
        if (m.includes("e")) d.w = Math.max(20 - W, dx);
        if (m.includes("s")) d.h = Math.max(20 - H, dy);
        if (m.includes("w")) {
          d.x = Math.min(dx, W - 20);
          d.w = -d.x;
        }
        if (m.includes("n")) {
          d.y = Math.min(dy, H - 20);
          d.h = -d.y;
        }
        // Corner handles keep the aspect ratio of pictures.
        if (o.type === "image" && m.length === 2) {
          const ratio = W / H;
          const nw = W + d.w;
          const nh = nw / ratio;
          if (m.includes("n")) d.y = H - nh;
          d.h = nh - H;
        }
      }
      setObjDrag({ ...objDrag, d });
    };
    const up = () => {
      const o = sheet.objects.find((x) => x.id === objDrag.id);
      const d = objDrag.d;
      setObjDrag(null);
      if (!o || (!d.x && !d.y && !d.w && !d.h)) return;
      const X = Math.max(0, cols.pos(o.anchor.col) + o.anchor.dx * z + d.x);
      const Y = Math.max(0, rows.pos(o.anchor.row) + o.anchor.dy * z + d.y);
      const col = cols.at(X, MAX_COLS - 1);
      const row = rows.at(Y, MAX_ROWS - 1);
      p.onObjectAnchor(o.id, { col, row, dx: (X - cols.pos(col)) / z, dy: (Y - rows.pos(row)) / z, w: Math.max(20, o.anchor.w * z + d.w) / z, h: Math.max(20, o.anchor.h * z + d.h) / z });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  /** One pane (frozen or scrolling part) with its own clipping. */
  const pane = (id: string, rs: number[], cs: number[], box: { left: number; top: number; width: number; height: number }) => {
    if (box.width <= 0 || box.height <= 0) return null;
    const off = (b: { left: number; top: number; width: number; height: number }) => ({ ...b, left: b.left - box.left, top: b.top - box.top });
    const at = (x: number, y: number) => ({ left: x - box.left, top: y - box.top });
    return (
      <div key={id} className="nx-pane" style={box}>
        {sheet.showGrid && cs.map((c) => <div key={`v${c}`} className="nx-gl-v" style={{ left: xOf(c) + cols.size(c) - 1 - box.left }} />)}
        {sheet.showGrid && rs.map((r) => <div key={`h${r}`} className="nx-gl-h" style={{ top: yOf(r) + rows.size(r) - 1 - box.top }} />)}
        <div style={{ position: "absolute", left: -box.left, top: -box.top }}>{cellsOf(rs, cs)}</div>
        {p.sparks
          .filter((sp) => rs.includes(sp.r) && cs.includes(sp.c))
          .map((sp) => (
            <div key={`sp${sp.r}:${sp.c}`} style={{ position: "absolute", left: xOf(sp.c) - box.left, top: yOf(sp.r) - box.top, width: cols.size(sp.c), height: rows.size(sp.r), pointerEvents: "none" }}>
              <SparkSvg s={sp} w={cols.size(sp.c)} h={rows.size(sp.r)} />
            </div>
          ))}
        {p.listButton && rs.includes(p.selection.anchor.r) && cs.includes(p.selection.anchor.c) && !p.editing && (
          <button
            className="nx-filter-btn"
            title="Auswahl"
            style={{ left: activeBox.left + activeBox.width + 1 - box.left, top: activeBox.top + activeBox.height - 18 - box.top, width: 17, height: 17, zIndex: 13 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => p.onListButton(e.currentTarget.getBoundingClientRect())}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1.5 3h7L5 7.5z" fill="currentColor" />
            </svg>
          </button>
        )}
        {p.prompt && !p.editing && rs.includes(p.selection.anchor.r) && cs.includes(p.selection.anchor.c) && (
          <div className="nx-dv-prompt" style={{ left: activeBox.left + 12 - box.left, top: activeBox.top + activeBox.height + 4 - box.top }}>
            {p.prompt.title && <b>{p.prompt.title}</b>}
            {p.prompt.text}
          </div>
        )}
        {af &&
          rs.includes(af.range.r1) &&
          cs
            .filter((c) => c >= af.range.c1 && c <= af.range.c2)
            .map((c) => {
              const col = c - af.range.c1;
              const on = af.columns.some((x) => x.col === col);
              const size = Math.min(17, rows.size(af.range.r1) - 2);
              return (
                <button
                  key={`fb${c}`}
                  className={`nx-filter-btn${on ? " on" : ""}`}
                  title={on ? "Gefiltert" : "Filtern"}
                  style={{ left: xOf(c) + cols.size(c) - size - 2 - box.left, top: yOf(af.range.r1) + rows.size(af.range.r1) - size - 2 - box.top, width: size, height: size, zIndex: 13 }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => p.onFilterButton(col, e.currentTarget.getBoundingClientRect())}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    {on ? <path d="M1 1.5h8L6 5v3.5L4 9.5V5z" fill="currentColor" /> : <path d="M1.5 3h7L5 7.5z" fill="currentColor" />}
                  </svg>
                </button>
              );
            })}
        {merges.map((m) => {
          const b = rectBox(m);
          return (
            <div key={`m${m.r1}:${m.c1}`} style={{ position: "absolute", ...off(b), zIndex: 3, background: "#fff", borderRight: sheet.showGrid ? "1px solid #e1e1e6" : undefined, borderBottom: sheet.showGrid ? "1px solid #e1e1e6" : undefined, boxSizing: "border-box" }}>
              {renderCell(m.r1, m.c1, 0, 0, b.width, b.height, 0)}
            </div>
          );
        })}
        <div className="nx-sel" style={{ ...off(selBox), zIndex: 10 }} />
        {(sel.r1 !== sel.r2 || sel.c1 !== sel.c2) &&
          // The range is shaded except for the active cell.
          [
            { left: selBox.left, top: selBox.top, width: selBox.width, height: activeBox.top - selBox.top },
            { left: selBox.left, top: activeBox.top + activeBox.height, width: selBox.width, height: selBox.top + selBox.height - activeBox.top - activeBox.height },
            { left: selBox.left, top: activeBox.top, width: activeBox.left - selBox.left, height: activeBox.height },
            { left: activeBox.left + activeBox.width, top: activeBox.top, width: selBox.left + selBox.width - activeBox.left - activeBox.width, height: activeBox.height },
          ]
            .filter((b) => b.width > 0 && b.height > 0)
            .map((b, i) => <div key={`sf${i}`} className="nx-sel-fill" style={{ ...off(b), zIndex: 10 }} />)}
        {!fullCols && !fullRows && !p.editing && (
          <div className="nx-fill-handle" style={{ ...at(selBox.left + selBox.width - 4, selBox.top + selBox.height - 4), zIndex: 12 }} onMouseDown={onFillDown} />
        )}
        {fill && <div className="nx-fill-outline" style={{ ...off(rectBox(fill)), zIndex: 11 }} />}
        {p.copyRect && <div className="nx-copy-ants" style={{ ...off(rectBox(p.copyRect)), zIndex: 11 }} />}
      </div>
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (p.onKey(e)) {
      e.preventDefault();
      return;
    }
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ed = p.editing!;
    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      p.onCommit([e.shiftKey ? -1 : 1, 0]);
    } else if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const pos = el.selectionStart;
      p.onEditText(ed.text.slice(0, pos) + "\n" + ed.text.slice(el.selectionEnd), pos + 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      p.onCommit([0, e.shiftKey ? -1 : 1]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      p.onCancel();
    } else if (e.key === "F2") {
      e.preventDefault();
      p.onStartEdit(ed.text, ed.mode === "edit" ? "enter" : "edit");
    } else if (ed.mode === "enter" && !p.pointMode && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      p.onCommit(e.key === "ArrowUp" ? [-1, 0] : e.key === "ArrowDown" ? [1, 0] : e.key === "ArrowLeft" ? [0, -1] : [0, 1]);
    } else if (p.pointMode && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && ed.mode === "enter") {
      // Arrow keys pick a reference while typing a formula.
      e.preventDefault();
      p.onKey(e);
    }
  };

  // Caret position for reference insertion.
  useEffect(() => {
    const el = editInput.current;
    if (el && p.editing && el.value !== p.editing.text) el.value = p.editing.text;
  });

  return (
    <div
      ref={scroller}
      className="nx-grid"
      style={{ cursor: cursor === "cell" ? "cell" : cursor }}
      onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onContextMenu={(e) => {
        e.preventDefault();
        p.onContextMenu(e.clientX, e.clientY);
      }}
    >
      <div className="nx-grid-view" style={{ width: view.w, height: view.h, marginBottom: -view.h }}>
        {pane("main", scrolledRows, scrolledCols, { left: HEADER_W + frozenW, top: HEADER_H + frozenH, width: view.w - HEADER_W - frozenW, height: view.h - HEADER_H - frozenH })}
        {sheet.freezeRows > 0 && pane("top", frozenRows, scrolledCols, { left: HEADER_W + frozenW, top: HEADER_H, width: view.w - HEADER_W - frozenW, height: frozenH })}
        {sheet.freezeCols > 0 && pane("left", scrolledRows, frozenCols, { left: HEADER_W, top: HEADER_H + frozenH, width: frozenW, height: view.h - HEADER_H - frozenH })}
        {sheet.freezeRows > 0 && sheet.freezeCols > 0 && pane("corner", frozenRows, frozenCols, { left: HEADER_W, top: HEADER_H, width: frozenW, height: frozenH })}
        {sheet.objects.length > 0 && (
          <div className="nx-pane" style={{ left: HEADER_W, top: HEADER_H, width: view.w - HEADER_W, height: view.h - HEADER_H, pointerEvents: "none" }}>
        {sheet.objects.map((o) => {
            const b = objectBox(o.id, o.anchor);
            const selected = p.selectedObject === o.id;
            return (
              <div
                key={o.id}
                className={`nx-object${selected ? " selected" : ""}`}
                style={{ left: b.x - HEADER_W, top: b.y - HEADER_H, width: b.w, height: b.h, zIndex: 14 }}
                onMouseDown={(e) => startObjDrag(e, o.id, "move")}
                onDoubleClick={(e) => (e.stopPropagation(), p.onObjectOpen(o.id))}
                onContextMenu={(e) => e.stopPropagation()}
              >
                {o.type === "chart" && o.chart ? <ChartView chart={p.chartData(o.chart)} width={Math.max(20, b.w)} height={Math.max(20, b.h)} scale={z} /> : <img src={o.src} alt={o.name ?? ""} draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />}
                {selected &&
                  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
                    <span key={h} className={`nx-handle nx-handle-${h}`} onMouseDown={(e) => startObjDrag(e, o.id, h)} />
                  ))}
              </div>
            );
          })}
          </div>
        )}
        {sheet.freezeCols > 0 && <div className="nx-freeze-line nx-freeze-v" style={{ left: HEADER_W + frozenW - 1 }} />}
        {sheet.freezeRows > 0 && <div className="nx-freeze-line nx-freeze-h" style={{ top: HEADER_H + frozenH - 1 }} />}

        {/* Headers */}
        <div className="nx-head-row" style={{ height: HEADER_H, width: view.w }}>
          {allCols.map((c) => (
            <div key={c} className={`nx-head-cell ${c >= sel.c1 && c <= sel.c2 ? (fullCols ? "nx-head-full" : "nx-head-sel") : ""}`} style={{ left: xOf(c), width: cols.size(c), zIndex: c < sheet.freezeCols ? 2 : 1 }}>
              {colName(c)}
            </div>
          ))}
        </div>
        <div className="nx-head-col" style={{ width: HEADER_W, height: view.h }}>
          {allRows.map((r) => (
            <div key={r} className={`nx-head-cell ${r >= sel.r1 && r <= sel.r2 ? (fullRows ? "nx-head-full" : "nx-head-sel") : ""}`} style={{ top: yOf(r), height: rows.size(r), width: HEADER_W, zIndex: r < sheet.freezeRows ? 2 : 1 }}>
              {r + 1}
            </div>
          ))}
        </div>
        <div className="nx-head-corner" style={{ width: HEADER_W, height: HEADER_H }} />
        {resizing && (
          <div
            className="nx-resize-line"
            style={resizing.axis === "col" ? { left: xOf(resizing.index) + resizing.cur * z, top: 0, bottom: 0, width: 1 } : { top: yOf(resizing.index) + resizing.cur * z, left: 0, right: 0, height: 1 }}
          />
        )}
        {resizing && (
          <div className="nx-resize-tip" style={resizing.axis === "col" ? { left: xOf(resizing.index) + resizing.cur * z + 6, top: 2 } : { top: yOf(resizing.index) + resizing.cur * z + 4, left: 4 }}>
            {resizing.axis === "col" ? `Breite: ${Math.round(resizing.cur)} Pixel` : `Höhe: ${Math.round(resizing.cur * 0.75 * 4) / 4} Pt`}
          </div>
        )}

        {/* Editor */}
        {p.editing && editBox && (
          <textarea
            ref={editInput}
            className="nx-cell-editor"
            defaultValue={p.editing.text}
            spellCheck={false}
            style={{
              ...cellCss(editStyle, z),
              left: editBox.left - 1,
              top: editBox.top - 1,
              minWidth: editBox.width + 2,
              minHeight: editBox.height + 2,
              width: Math.min(view.w - editBox.left - 4, Math.max(editBox.width + 2, (Math.max(...p.editing.text.split("\n").map((l) => l.length)) + 2) * 7.5 * z)),
              height: Math.max(editBox.height + 2, p.editing.text.split("\n").length * 15 * z + 6),
              textAlign: (editStyle?.hAlign as React.CSSProperties["textAlign"]) ?? "left",
              zIndex: 20,
            }}
            onChange={(e) => p.onEditText(e.target.value, e.target.selectionStart)}
            onSelect={(e) => p.onEditText(e.currentTarget.value, e.currentTarget.selectionStart)}
            onKeyDown={onEditKey}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
        <textarea
          ref={keyInput}
          className="nx-key-input"
          aria-label="Tabelle"
          style={{ left: activeBox.left, top: activeBox.top }}
          onKeyDown={onKeyDown}
          onInput={(e) => {
            const v = e.currentTarget.value;
            e.currentTarget.value = "";
            if (v && !p.editing) p.onStartEdit(v, "enter");
          }}
          onCopy={p.onCopy}
          onCut={p.onCut}
          onPaste={p.onPaste}
        />
      </div>
      <div style={{ width: HEADER_W + cols.pos(nCols), height: HEADER_H + rows.pos(nRows) }} />
    </div>
  );
});
