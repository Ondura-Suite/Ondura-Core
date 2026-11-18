// Workbook state of Nexora Tabellen and conversion to/from the Rust model
// (crates/office/src/xlsx.rs).

import type { Chart } from "../chart/ChartView";
import { type Node, type Scalar, ERRORS, adjustFormula, colName, err, evaluate, isError, parse, renameSheetInFormula, shiftFormula, VOLATILE } from "./formula";

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;
export const DEFAULT_COL = 64;
export const DEFAULT_ROW = 20;

export const key = (r: number, c: number) => r * MAX_COLS + c;
export const unkey = (k: number) => ({ r: Math.floor(k / MAX_COLS), c: k % MAX_COLS });

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string;
  size10?: number;
  color?: string;
  fill?: string;
  hAlign?: string;
  vAlign?: string;
  wrap?: boolean;
  numFmt?: string;
  borderTop?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRight?: string;
  indent?: number;
}

export interface SCell {
  v?: number | string | boolean;
  f?: string;
  e?: string;
  s?: number;
}

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface DefinedName {
  name: string;
  /** Formula without "=" in English notation, e.g. Tabelle1!$A$1:$A$9. */
  formula: string;
  /** Sheet index for sheet-scoped names. */
  sheet?: number;
}

export interface FilterColumn {
  /** Offset inside the filter range. */
  col: number;
  /** Displayed texts that stay visible ("" = blank cells). */
  values: string[];
}

export interface AutoFilter {
  range: Rect;
  columns: FilterColumn[];
}

export interface CondRule {
  kind: string;
  operator?: string;
  formulas?: string[];
  text?: string;
  rank?: number;
  bottom?: boolean;
  percent?: boolean;
  below?: boolean;
  stop?: boolean;
  style?: CellStyle;
  colors?: string[];
}

export interface CondFormat {
  ranges: Rect[];
  rules: CondRule[];
}

/** Floating object position: top-left cell, offset and size in px at 100 %. */
export interface Anchor {
  col: number;
  row: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export interface Validation {
  ranges: Rect[];
  /** list, whole, decimal, date, time, textLength, custom */
  kind: string;
  operator?: string;
  /** Formula 1 and 2 (English, without "="); a list is "a,b,c" in quotes or a reference. */
  formulas?: string[];
  allowBlank?: boolean;
  hideDropdown?: boolean;
  /** stop (default), warning, information */
  errorStyle?: string;
  errorTitle?: string;
  error?: string;
  promptTitle?: string;
  prompt?: string;
}

export interface Sparkline {
  r: number;
  c: number;
  /** Data range, e.g. Tabelle1!B2:G2 */
  source: string;
  /** line, column, stacked */
  kind: string;
  color?: string;
  negativeColor?: string;
  markers?: boolean;
}

export interface SheetObject {
  id: string;
  type: "chart" | "image";
  anchor: Anchor;
  chart?: Chart;
  src?: string;
  name?: string;
}

export interface SheetState {
  name: string;
  cells: Map<number, SCell>;
  cols: Map<number, number>;
  rows: Map<number, number>;
  hiddenCols: Set<number>;
  hiddenRows: Set<number>;
  merges: Rect[];
  freezeRows: number;
  freezeCols: number;
  showGrid: boolean;
  autoFilter?: AutoFilter;
  condFormats: CondFormat[];
  objects: SheetObject[];
  validations: Validation[];
  sparklines: Sparkline[];
}

export interface Book {
  sheets: SheetState[];
  styles: CellStyle[];
  active: number;
  title: string;
  author: string;
  names: DefinedName[];
}

// ------------------------------------------------------------- rust model --

export interface RustCell {
  v?: number | string | boolean;
  f?: string;
  e?: string;
  s?: number;
}
export interface RustSheet {
  name: string;
  cells: Record<string, RustCell>;
  cols: Record<string, number>;
  rows: Record<string, number>;
  hiddenCols: number[];
  hiddenRows: number[];
  merges: string[];
  freezeRows: number;
  freezeCols: number;
  showGrid: boolean;
  autoFilter?: { range: string; columns: FilterColumn[] } | null;
  condFormats?: { range: string; rules: CondRule[] }[];
  charts?: (Chart & { anchor: Anchor })[];
  images?: { src: string; anchor: Anchor; name?: string }[];
  validations?: (Omit<Validation, "ranges"> & { range: string })[];
  sparklines?: (Omit<Sparkline, "r" | "c"> & { cell: string })[];
}
export interface RustWorkbook {
  sheets: RustSheet[];
  styles: CellStyle[];
  active: number;
  title: string;
  author: string;
  names?: DefinedName[];
}

let objectSeq = 0;
export const newObjectId = () => `obj${++objectSeq}`;

export function parseA1(ref: string): { r: number; c: number } | null {
  const m = ref.trim().toUpperCase().match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
}

export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;

export function parseRange(s: string): Rect | null {
  const [a, b] = s.split(":");
  const p = parseA1(a);
  const q = b ? parseA1(b) : p;
  if (!p || !q) return null;
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
}

export const rangeName = (x: Rect) => (x.r1 === x.r2 && x.c1 === x.c2 ? a1(x.r1, x.c1) : `${a1(x.r1, x.c1)}:${a1(x.r2, x.c2)}`);

export function fromRust(wb: RustWorkbook): Book {
  return {
    title: wb.title ?? "",
    author: wb.author ?? "",
    active: wb.active ?? 0,
    styles: wb.styles?.length ? wb.styles : [{}],
    names: wb.names ?? [],
    sheets: wb.sheets.map((s) => {
      const cells = new Map<number, SCell>();
      for (const [ref, c] of Object.entries(s.cells ?? {})) {
        const p = parseA1(ref);
        if (p) cells.set(key(p.r, p.c), c);
      }
      return {
        name: s.name,
        cells,
        cols: new Map(Object.entries(s.cols ?? {}).map(([k, v]) => [Number(k), v])),
        rows: new Map(Object.entries(s.rows ?? {}).map(([k, v]) => [Number(k), v])),
        hiddenCols: new Set(s.hiddenCols ?? []),
        hiddenRows: new Set(s.hiddenRows ?? []),
        merges: (s.merges ?? []).map(parseRange).filter((x): x is Rect => !!x),
        freezeRows: s.freezeRows ?? 0,
        freezeCols: s.freezeCols ?? 0,
        showGrid: s.showGrid ?? true,
        autoFilter: s.autoFilter ? { range: parseRange(s.autoFilter.range) ?? { r1: 0, c1: 0, r2: 0, c2: 0 }, columns: s.autoFilter.columns ?? [] } : undefined,
        condFormats: (s.condFormats ?? []).map((cf) => ({ ranges: cf.range.split(/\s+/).map(parseRange).filter((x): x is Rect => !!x), rules: cf.rules ?? [] })).filter((cf) => cf.ranges.length),
        validations: (s.validations ?? []).map(({ range, ...v }) => ({ ...v, ranges: range.split(/\s+/).map(parseRange).filter((x): x is Rect => !!x) })).filter((v) => v.ranges.length),
        sparklines: (s.sparklines ?? []).flatMap(({ cell, ...sp }) => {
          const p = parseA1(cell);
          return p ? [{ ...sp, r: p.r, c: p.c }] : [];
        }),
        objects: [
          ...(s.charts ?? []).map(({ anchor, ...chart }) => ({ id: newObjectId(), type: "chart" as const, anchor, chart: { ...chart, series: (chart.series ?? []).map((x) => ({ ...x, categories: x.categories ?? [], values: x.values ?? [] })) } })),
          ...(s.images ?? []).map((im) => ({ id: newObjectId(), type: "image" as const, anchor: im.anchor, src: im.src, name: im.name })),
        ],
      };
    }),
  };
}

export function toRust(book: Book, values: CalcResult): RustWorkbook {
  return {
    title: book.title,
    author: book.author,
    active: book.active,
    styles: book.styles,
    names: book.names,
    sheets: book.sheets.map((s, si) => {
      const cells: Record<string, RustCell> = {};
      for (const [k, c] of s.cells) {
        const { r, c: col } = unkey(k);
        const out: RustCell = {};
        if (c.s) out.s = c.s;
        if (c.f) {
          out.f = c.f;
          const v = values[si]?.get(k);
          if (isError(v)) out.e = v.error;
          else if (v !== null && v !== undefined) out.v = v;
        } else if (c.e) out.e = c.e;
        else if (c.v !== undefined && c.v !== "") out.v = c.v;
        if (out.v !== undefined || out.f || out.e || out.s) cells[a1(r, col)] = out;
      }
      return {
        name: s.name,
        cells,
        cols: Object.fromEntries(s.cols),
        rows: Object.fromEntries(s.rows),
        hiddenCols: [...s.hiddenCols],
        hiddenRows: [...s.hiddenRows],
        merges: s.merges.map(rangeName),
        freezeRows: s.freezeRows,
        freezeCols: s.freezeCols,
        showGrid: s.showGrid,
        autoFilter: s.autoFilter ? { range: rangeName(s.autoFilter.range), columns: s.autoFilter.columns } : null,
        condFormats: s.condFormats.map((cf) => ({ range: cf.ranges.map(rangeName).join(" "), rules: cf.rules })),
        charts: s.objects.filter((o) => o.type === "chart" && o.chart).map((o) => ({ ...o.chart!, anchor: o.anchor })),
        images: s.objects.filter((o) => o.type === "image" && o.src).map((o) => ({ src: o.src!, anchor: o.anchor, name: o.name })),
        validations: s.validations.map(({ ranges, ...v }) => ({ ...v, range: ranges.map(rangeName).join(" ") })),
        sparklines: s.sparklines.map(({ r, c, ...sp }) => ({ ...sp, cell: a1(r, c) })),
      };
    }),
  };
}

export function newSheet(name: string): SheetState {
  return { name, cells: new Map(), cols: new Map(), rows: new Map(), hiddenCols: new Set(), hiddenRows: new Set(), merges: [], freezeRows: 0, freezeCols: 0, showGrid: true, condFormats: [], objects: [], validations: [], sparklines: [] };
}

export function newBook(): Book {
  return { sheets: [newSheet("Tabelle1")], styles: [{}], active: 0, title: "", author: "", names: [] };
}

// ------------------------------------------------------------------ axes --

/** Positions of rows or columns with default size, overrides and hidden ones. */
export class Axis {
  private keys: number[];
  private prefix: number[];
  constructor(
    readonly def: number,
    private sizes: Map<number, number>,
    private hidden: Set<number>,
    readonly zoom = 1,
  ) {
    const all = new Set<number>([...sizes.keys(), ...hidden]);
    this.keys = [...all].sort((a, b) => a - b);
    this.prefix = [];
    let acc = 0;
    for (const k of this.keys) {
      acc += this.rawSize(k) - def;
      this.prefix.push(acc);
    }
  }
  private rawSize(i: number) {
    return this.hidden.has(i) ? 0 : this.sizes.get(i) ?? this.def;
  }
  size(i: number) {
    return this.rawSize(i) * this.zoom;
  }
  /** Start of item i. */
  pos(i: number) {
    // Number of overrides with key < i.
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.keys[m] < i) lo = m + 1;
      else hi = m;
    }
    return (i * this.def + (lo ? this.prefix[lo - 1] : 0)) * this.zoom;
  }
  /** Index of the item at a position. */
  at(px: number, max: number) {
    let lo = 0;
    let hi = max;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.pos(m) <= px) lo = m;
      else hi = m - 1;
    }
    return lo;
  }
}

// ------------------------------------------------------------ calculation --

export type CalcResult = Map<number, Scalar>[];

const parseCache = new Map<string, Node | Error>();
export function parsed(f: string): Node | Error {
  let n = parseCache.get(f);
  if (!n) {
    try {
      n = parse(f, "en");
    } catch (e) {
      n = e instanceof Error ? e : new Error(String(e));
    }
    if (parseCache.size > 20000) parseCache.clear();
    parseCache.set(f, n);
  }
  return n;
}

export function extentOf(s: SheetState) {
  let rows = 0;
  let cols = 0;
  for (const k of s.cells.keys()) {
    const { r, c } = unkey(k);
    if (r + 1 > rows) rows = r + 1;
    if (c + 1 > cols) cols = c + 1;
  }
  return { rows, cols };
}

/** Evaluate all formulas of the workbook. */
export function calculate(book: Book): CalcResult {
  const out: CalcResult = book.sheets.map(() => new Map());
  const extents = book.sheets.map(extentOf);
  const visiting = new Set<string>();
  const byName = new Map(book.sheets.map((s, i) => [s.name.toLowerCase(), i]));
  const name = nameResolver(book);

  const cellValue = (si: number, r: number, c: number): Scalar => {
    const sheet = book.sheets[si];
    if (!sheet) return err(ERRORS.ref);
    const k = key(r, c);
    const cached = out[si].get(k);
    if (cached !== undefined) return cached;
    const cell = sheet.cells.get(k);
    if (!cell) return null;
    if (!cell.f) {
      const v = cell.e ? err(cell.e) : cell.v === undefined || cell.v === "" ? null : cell.v;
      return v;
    }
    const id = `${si}:${k}`;
    if (visiting.has(id)) return err(ERRORS.circ);
    visiting.add(id);
    let v: Scalar;
    const node = parsed(cell.f);
    if (node instanceof Error) v = err(ERRORS.name);
    else {
      const res = evaluate(node, {
        cell: cellValue,
        sheetIndex: (n) => byName.get(n.toLowerCase()) ?? -1,
        extent: (s) => extents[s] ?? { rows: 0, cols: 0 },
        name,
        sheet: si,
        row: r,
        col: c,
      });
      v = Array.isArray(res) ? res[0]?.[0] ?? null : res;
    }
    // Unknown functions: keep the value Excel saved.
    if (isError(v) && v.error === ERRORS.name && (cell.v !== undefined || cell.e)) v = cell.e ? err(cell.e) : (cell.v as Scalar);
    visiting.delete(id);
    out[si].set(k, v);
    return v;
  };

  book.sheets.forEach((s, si) => {
    for (const [k, c] of s.cells) {
      if (c.f) {
        const { r, c: col } = unkey(k);
        cellValue(si, r, col);
      }
    }
  });
  return out;
}

/** Looks up defined names (sheet-scoped first) as parsed formulas. */
export function nameResolver(book: Book) {
  const global = new Map<string, string>();
  const local = new Map<string, string>();
  for (const n of book.names ?? []) {
    if (n.sheet === undefined) global.set(n.name.toLowerCase(), n.formula);
    else local.set(`${n.sheet}:${n.name.toLowerCase()}`, n.formula);
  }
  return (n: string, sheet: number): Node | null => {
    const f = local.get(`${sheet}:${n.toLowerCase()}`) ?? global.get(n.toLowerCase());
    if (f === undefined) return null;
    const node = parsed(f);
    return node instanceof Error ? null : node;
  };
}

/** Context for evaluating an extra formula (conditional formats, charts). */
export function evalContext(book: Book, values: CalcResult, si: number, r: number, c: number) {
  const byName = new Map(book.sheets.map((s, i) => [s.name.toLowerCase(), i]));
  const extents = new Map<number, { rows: number; cols: number }>();
  return {
    cell: (s: number, rr: number, cc: number): Scalar => {
      const cell = book.sheets[s]?.cells.get(key(rr, cc));
      if (!cell) return null;
      if (cell.f) return values[s]?.get(key(rr, cc)) ?? null;
      if (cell.e) return err(cell.e);
      return cell.v === undefined || cell.v === "" ? null : cell.v;
    },
    sheetIndex: (n: string) => byName.get(n.toLowerCase()) ?? -1,
    extent: (s: number) => {
      let e = extents.get(s);
      if (!e) extents.set(s, (e = book.sheets[s] ? extentOf(book.sheets[s]) : { rows: 0, cols: 0 }));
      return e;
    },
    name: nameResolver(book),
    sheet: si,
    row: r,
    col: c,
  };
}

export function hasVolatile(book: Book) {
  for (const s of book.sheets) for (const c of s.cells.values()) if (c.f && [...VOLATILE].some((f) => c.f!.toUpperCase().includes(f + "("))) return true;
  return false;
}

// ----------------------------------------------------------------- styles --

const styleKeys = new WeakMap<CellStyle[], Map<string, number>>();

function normStyle(s: CellStyle): CellStyle {
  const out: CellStyle = {};
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && v !== false && v !== "") (out as Record<string, unknown>)[k] = v;
  return out;
}

const styleKey = (s: CellStyle) =>
  JSON.stringify(
    Object.keys(s)
      .sort()
      .map((k) => [k, (s as Record<string, unknown>)[k]]),
  );

/** Index of a style, appending it if new. Returns [styles, index]. */
export function internStyle(styles: CellStyle[], s: CellStyle): [CellStyle[], number] {
  const n = normStyle(s);
  let map = styleKeys.get(styles);
  if (!map) {
    map = new Map(styles.map((x, i) => [styleKey(normStyle(x)), i]));
    styleKeys.set(styles, map);
  }
  const k = styleKey(n);
  const hit = map.get(k);
  if (hit !== undefined) return [styles, hit];
  const next = [...styles, n];
  const nextMap = new Map(map);
  nextMap.set(k, next.length - 1);
  styleKeys.set(next, nextMap);
  return [next, next.length - 1];
}

// ------------------------------------------------------------- operations --

export function withSheet(book: Book, si: number, f: (s: SheetState) => SheetState): Book {
  return { ...book, sheets: book.sheets.map((s, i) => (i === si ? f(s) : s)) };
}

export function setCells(book: Book, si: number, updates: { r: number; c: number; cell: SCell | null }[]): Book {
  return withSheet(book, si, (s) => {
    const cells = new Map(s.cells);
    for (const u of updates) {
      const k = key(u.r, u.c);
      if (!u.cell || (u.cell.v === undefined && !u.cell.f && !u.cell.e && !u.cell.s)) cells.delete(k);
      else cells.set(k, u.cell);
    }
    return { ...s, cells };
  });
}

/** Apply a style change to every cell of a range (creating styled empty cells). */
export function styleRange(book: Book, si: number, rect: Rect, patch: (s: CellStyle) => CellStyle): Book {
  let styles = book.styles;
  const sheet = book.sheets[si];
  const cells = new Map(sheet.cells);
  const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
  const apply = (k: number) => {
    const c = cells.get(k) ?? {};
    const [next, idx] = internStyle(styles, patch({ ...(styles[c.s ?? 0] ?? {}) }));
    styles = next;
    if (idx === 0 && c.v === undefined && !c.f && !c.e) cells.delete(k);
    else cells.set(k, { ...c, s: idx || undefined });
  };
  if (area <= 200000) {
    for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) apply(key(r, c));
  } else {
    // Whole rows/columns: only existing cells.
    for (const k of [...cells.keys()]) {
      const { r, c } = unkey(k);
      if (r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2) apply(k);
    }
  }
  return { ...book, styles, sheets: book.sheets.map((s, i) => (i === si ? { ...s, cells } : s)) };
}

export function clearRange(book: Book, si: number, rect: Rect, what: "contents" | "all" | "formats"): Book {
  return withSheet(book, si, (s) => {
    const cells = new Map(s.cells);
    for (const k of [...cells.keys()]) {
      const { r, c } = unkey(k);
      if (r < rect.r1 || r > rect.r2 || c < rect.c1 || c > rect.c2) continue;
      const cell = cells.get(k)!;
      if (what === "all") cells.delete(k);
      else if (what === "contents") {
        if (cell.s) cells.set(k, { s: cell.s });
        else cells.delete(k);
      } else {
        const { s: _s, ...rest } = cell;
        void _s;
        if (rest.v === undefined && !rest.f && !rest.e) cells.delete(k);
        else cells.set(k, rest);
      }
    }
    return { ...s, cells, merges: what === "contents" ? s.merges : s.merges.filter((m) => !(m.r1 >= rect.r1 && m.r2 <= rect.r2 && m.c1 >= rect.c1 && m.c2 <= rect.c2)) };
  });
}

/** Insert (count > 0) or delete (count < 0) rows or columns at `at`. */
/** Shift a rectangle for inserted/deleted rows or columns; null if deleted. */
export function shiftRect(m: Rect, axis: "row" | "col", at: number, count: number): Rect | null {
  const [a, b] = axis === "row" ? [m.r1, m.r2] : [m.c1, m.c2];
  let na = a >= at ? a + count : a;
  let nb = b >= at ? b + count : b;
  if (count < 0) {
    if (a >= at && b < at - count) return null;
    na = a >= at - count ? a + count : Math.min(a, at);
    nb = b >= at - count ? b + count : Math.min(b, at - 1);
  }
  const out = axis === "row" ? { ...m, r1: na, r2: nb } : { ...m, c1: na, c2: nb };
  return out.r2 >= out.r1 && out.c2 >= out.c1 ? out : null;
}

export function shiftAxis(book: Book, si: number, axis: "row" | "col", at: number, count: number): Book {
  const name = book.sheets[si].name;
  const adjRef = (r?: string) => (r ? adjustFormula(r, name, false, axis, at, count) : r);
  book = {
    ...book,
    names: book.names.map((n) => ({ ...n, formula: adjustFormula(n.formula, name, n.sheet === si, axis, at, count) })),
    sheets: book.sheets.map((s, i) => {
      const objects = s.objects.map((o) => {
        let anchor = o.anchor;
        if (i === si) {
          const v = axis === "row" ? anchor.row : anchor.col;
          const nv = v >= at ? Math.max(at, v + count) : v;
          anchor = axis === "row" ? { ...anchor, row: nv } : { ...anchor, col: nv };
        }
        const chart = o.chart && { ...o.chart, series: o.chart.series.map((x) => ({ ...x, nameRef: adjRef(x.nameRef), catRef: adjRef(x.catRef), valRef: adjRef(x.valRef) })) };
        return { ...o, anchor, chart };
      });
      if (i !== si) return { ...s, objects };
      const autoFilter = s.autoFilter && shiftRect(s.autoFilter.range, axis, at, count);
      return {
        ...s,
        objects,
        autoFilter: autoFilter ? { ...s.autoFilter!, range: autoFilter } : undefined,
        condFormats: s.condFormats.map((cf) => ({ ...cf, ranges: cf.ranges.map((r) => shiftRect(r, axis, at, count)).filter((r): r is Rect => !!r) })).filter((cf) => cf.ranges.length),
        validations: s.validations.map((v) => ({ ...v, ranges: v.ranges.map((r) => shiftRect(r, axis, at, count)).filter((r): r is Rect => !!r) })).filter((v) => v.ranges.length),
        sparklines: s.sparklines.flatMap((sp) => {
          const moved = shiftRect({ r1: sp.r, c1: sp.c, r2: sp.r, c2: sp.c }, axis, at, count);
          return moved ? [{ ...sp, r: moved.r1, c: moved.c1, source: adjustFormula(sp.source, name, false, axis, at, count) }] : [];
        }),
      };
    }),
  };
  const sheets = book.sheets.map((s, i) => {
    let cells = s.cells;
    // Adjust formulas everywhere that reference the changed sheet.
    const fixFormulas = (map: Map<number, SCell>) => {
      const out = new Map<number, SCell>();
      for (const [k, c] of map) out.set(k, c.f ? { ...c, f: adjustFormula(c.f, name, i === si, axis, at, count) } : c);
      return out;
    };
    cells = fixFormulas(cells);
    if (i !== si) return { ...s, cells };
    const moved = new Map<number, SCell>();
    for (const [k, c] of cells) {
      const p = unkey(k);
      const v = axis === "row" ? p.r : p.c;
      if (count < 0 && v >= at && v < at - count) continue;
      const nv = v >= at ? v + count : v;
      moved.set(axis === "row" ? key(nv, p.c) : key(p.r, nv), c);
    }
    const shiftMap = (m: Map<number, number>) => {
      const out = new Map<number, number>();
      for (const [k, v] of m) {
        if (count < 0 && k >= at && k < at - count) continue;
        out.set(k >= at ? k + count : k, v);
      }
      return out;
    };
    const shiftSet = (m: Set<number>) => new Set([...m].filter((k) => !(count < 0 && k >= at && k < at - count)).map((k) => (k >= at ? k + count : k)));
    const merges = s.merges
      .map((m) => {
        const [a, b] = axis === "row" ? [m.r1, m.r2] : [m.c1, m.c2];
        let na = a >= at ? a + count : a;
        let nb = b >= at ? b + count : b;
        if (count < 0) {
          if (a >= at && b < at - count) return null;
          na = a >= at - count ? a + count : Math.min(a, at);
          nb = b >= at - count ? b + count : Math.min(b, at - 1);
        }
        return axis === "row" ? { ...m, r1: na, r2: nb } : { ...m, c1: na, c2: nb };
      })
      .filter((m): m is Rect => !!m && m.r2 >= m.r1 && m.c2 >= m.c1 && (m.r2 > m.r1 || m.c2 > m.c1));
    return axis === "row"
      ? { ...s, cells: moved, rows: shiftMap(s.rows), hiddenRows: shiftSet(s.hiddenRows), merges }
      : { ...s, cells: moved, cols: shiftMap(s.cols), hiddenCols: shiftSet(s.hiddenCols), merges };
  });
  return { ...book, sheets };
}

export function renameSheet(book: Book, si: number, name: string): Book {
  const from = book.sheets[si].name;
  const ren = (f?: string) => (f ? renameSheetInFormula(f, from, name) : f);
  return {
    ...book,
    names: book.names.map((n) => ({ ...n, formula: ren(n.formula)! })),
    sheets: book.sheets.map((s, i) => {
      const cells = new Map<number, SCell>();
      for (const [k, c] of s.cells) cells.set(k, c.f ? { ...c, f: renameSheetInFormula(c.f, from, name) } : c);
      const objects = s.objects.map((o) => (o.chart ? { ...o, chart: { ...o.chart, series: o.chart.series.map((x) => ({ ...x, nameRef: ren(x.nameRef), catRef: ren(x.catRef), valRef: ren(x.valRef) })) } } : o));
      return i === si ? { ...s, name, cells, objects } : { ...s, cells, objects };
    }),
  };
}

/** Copy a block of cells (with formulas shifted) to a new origin. */
export interface ClipBlock {
  rows: number;
  cols: number;
  /** [dr, dc, cell] relative to the top-left corner. */
  cells: [number, number, SCell][];
  merges: Rect[];
  source: { sheet: number; rect: Rect };
}

export function copyBlock(book: Book, si: number, rect: Rect): ClipBlock {
  const s = book.sheets[si];
  const cells: [number, number, SCell][] = [];
  for (const [k, c] of s.cells) {
    const { r, c: col } = unkey(k);
    if (r >= rect.r1 && r <= rect.r2 && col >= rect.c1 && col <= rect.c2) cells.push([r - rect.r1, col - rect.c1, c]);
  }
  const merges = s.merges.filter((m) => m.r1 >= rect.r1 && m.r2 <= rect.r2 && m.c1 >= rect.c1 && m.c2 <= rect.c2).map((m) => ({ r1: m.r1 - rect.r1, r2: m.r2 - rect.r1, c1: m.c1 - rect.c1, c2: m.c2 - rect.c1 }));
  return { rows: rect.r2 - rect.r1 + 1, cols: rect.c2 - rect.c1 + 1, cells, merges, source: { sheet: si, rect } };
}

export function pasteBlock(book: Book, si: number, r0: number, c0: number, block: ClipBlock, styles?: CellStyle[]): Book {
  // Repeat the block to fill a larger selection is handled by the caller.
  const dr = r0 - block.source.rect.r1;
  const dc = c0 - block.source.rect.c1;
  let b = clearRange(book, si, { r1: r0, c1: c0, r2: r0 + block.rows - 1, c2: c0 + block.cols - 1 }, "all");
  let st = b.styles;
  const updates = block.cells.map(([r, c, cell]) => {
    let s = cell.s;
    // Styles from another workbook are re-interned.
    if (styles && s) {
      const [n, idx] = internStyle(st, styles[s] ?? {});
      st = n;
      s = idx;
    }
    return { r: r0 + r, c: c0 + c, cell: { ...cell, s, f: cell.f ? shiftFormula(cell.f, dr, dc) : undefined } };
  });
  b = setCells({ ...b, styles: st }, si, updates);
  if (block.merges.length)
    b = withSheet(b, si, (s) => ({ ...s, merges: [...s.merges, ...block.merges.map((m) => ({ r1: m.r1 + r0, r2: m.r2 + r0, c1: m.c1 + c0, c2: m.c2 + c0 }))] }));
  return b;
}

export function sortRange(book: Book, si: number, rect: Rect, col: number, asc: boolean, values: CalcResult, hasHeader: boolean): Book {
  const s = book.sheets[si];
  const start = hasHeader ? rect.r1 + 1 : rect.r1;
  const rows: { cells: (SCell | undefined)[]; key: Scalar }[] = [];
  for (let r = start; r <= rect.r2; r++) {
    const cells: (SCell | undefined)[] = [];
    for (let c = rect.c1; c <= rect.c2; c++) cells.push(s.cells.get(key(r, c)));
    const k = key(r, col);
    const cell = s.cells.get(k);
    rows.push({ cells, key: cell?.f ? values[si]?.get(k) ?? null : cell?.v ?? null });
  }
  const rank = (v: Scalar) => (v === null || v === "" ? 3 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  rows.sort((a, b) => {
    const ra = rank(a.key);
    const rb = rank(b.key);
    if (ra === 3 || rb === 3) return ra - rb; // blanks always last
    if (ra !== rb) return (ra - rb) * (asc ? 1 : -1);
    const cmp = typeof a.key === "string" ? (a.key as string).localeCompare(b.key as string, "de", { sensitivity: "base", numeric: true }) : (a.key as number) - (b.key as number);
    return asc ? cmp : -cmp;
  });
  const updates: { r: number; c: number; cell: SCell | null }[] = [];
  rows.forEach((row, i) =>
    row.cells.forEach((cell, j) => {
      const r = start + i;
      const from = cell?.f ? shiftFormula(cell.f, 0, 0) : undefined;
      updates.push({ r, c: rect.c1 + j, cell: cell ? { ...cell, f: from } : null });
    }),
  );
  return setCells(book, si, updates);
}

/** Merge that contains a cell, if any. */
export function mergeAt(s: SheetState, r: number, c: number): Rect | undefined {
  return s.merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
}

export function usedRange(s: SheetState): Rect | null {
  if (!s.cells.size) return null;
  let r2 = 0;
  let c2 = 0;
  for (const k of s.cells.keys()) {
    const { r, c } = unkey(k);
    r2 = Math.max(r2, r);
    c2 = Math.max(c2, c);
  }
  return { r1: 0, c1: 0, r2, c2 };
}

/** Values for an auto-fill: numbers and dates continue a series. */
export function fillSeries(book: Book, si: number, src: Rect, dest: Rect, values: CalcResult): Book {
  const s = book.sheets[si];
  const vertical = dest.c1 === src.c1 && dest.c2 === src.c2;
  const updates: { r: number; c: number; cell: SCell | null }[] = [];
  const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
  const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
  for (let line = 0; line < lines; line++) {
    const at = (i: number) => (vertical ? { r: src.r1 + i, c: src.c1 + line } : { r: src.r1 + line, c: src.c1 + i });
    const seq = Array.from({ length: len }, (_, i) => s.cells.get(key(at(i).r, at(i).c)));
    const nums = seq.map((c) => (c && !c.f && typeof c.v === "number" ? c.v : null));
    const allNum = nums.every((n) => n !== null);
    const step = allNum && len > 1 ? (nums[len - 1]! - nums[0]!) / (len - 1) : allNum ? 1 : 0;
    const textNum = len === 1 && typeof seq[0]?.v === "string" ? (seq[0].v as string).match(/^(.*?)(\d+)$/) : null;
    const span = vertical ? dest.r2 - dest.r1 + 1 : dest.c2 - dest.c1 + 1;
    const start = vertical ? dest.r1 : dest.c1;
    const srcStart = vertical ? src.r1 : src.c1;
    const forward = start > srcStart;
    for (let i = 0; i < span; i++) {
      const pos = start + i;
      const idx = forward ? pos - srcStart : pos - srcStart;
      const k = ((idx % len) + len) % len;
      const base = seq[k];
      const r = vertical ? pos : src.r1 + line;
      const c = vertical ? src.c1 + line : pos;
      if (!base) {
        updates.push({ r, c, cell: null });
        continue;
      }
      let cell: SCell = { ...base };
      if (base.f) cell.f = shiftFormula(base.f, vertical ? pos - at(k).r : 0, vertical ? 0 : pos - at(k).c);
      else if (allNum && (len > 1 || (base.s && /[dy]/i.test(book.styles[base.s]?.numFmt ?? "")))) cell.v = nums[0]! + step * idx;
      else if (textNum) cell = { ...base, v: `${textNum[1]}${Number(textNum[2]) + idx}` };
      updates.push({ r, c, cell });
    }
  }
  void values;
  return setCells(book, si, updates);
}
