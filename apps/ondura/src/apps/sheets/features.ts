// Conditional formatting, auto filters and chart data for Ondura Tabellen.

import type { Chart, ChartKind, ChartSeries } from "../chart/ChartView";
import { type Scalar, colName, dateToSerial, evaluate, isError, serialToDate, shiftFormula } from "./formula";
import { formatValue } from "./format";
import { type Book, type CalcResult, type CellStyle, type CondRule, type Rect, type SCell, type SheetState, type Validation, evalContext, internStyle, key, newSheet, parsed, unkey } from "./model";
import { tl, LOCALE } from "../../lib/i18n";

// ------------------------------------------------------------------ values --

export function cellValue(book: Book, values: CalcResult, si: number, r: number, c: number): Scalar {
  const cell = book.sheets[si]?.cells.get(key(r, c));
  // Cells without content may hold a spilled value of a dynamic array.
  if (!cell || cell.f || (cell.v === undefined && !cell.e)) return values[si]?.get(key(r, c)) ?? null;
  if (cell.e) return { error: cell.e };
  return cell.v === undefined || cell.v === "" ? null : cell.v;
}

export function displayText(book: Book, values: CalcResult, si: number, r: number, c: number): string {
  const cell = book.sheets[si]?.cells.get(key(r, c));
  return formatValue(cellValue(book, values, si, r, c), book.styles[cell?.s ?? 0]?.numFmt).text;
}

/** Positions of a rectangle; for huge ranges only the cells that exist. */
function positions(sheet: SheetState, rect: Rect, limit = 60000): { r: number; c: number }[] {
  const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
  const out: { r: number; c: number }[] = [];
  if (area <= limit) {
    for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) out.push({ r, c });
  } else {
    for (const k of sheet.cells.keys()) {
      const p = unkey(k);
      if (p.r >= rect.r1 && p.r <= rect.r2 && p.c >= rect.c1 && p.c <= rect.c2) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------- conditional formats --

export interface CondCell {
  style?: CellStyle;
  /** Data bar: fraction of the cell width and colour. */
  bar?: { start: number; end: number; color: string };
  /** Colour scale background. */
  fill?: string;
}

const hex = (c: string) => {
  const v = parseInt(c.replace("#", "").slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mix = (a: string, b: string, t: number) => {
  const A = hex(a);
  const B = hex(b);
  return `#${A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join("")}`;
};

const truthy = (v: Scalar) => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : typeof v === "string" ? v.toUpperCase() === "TRUE" || v.toUpperCase() === "WAHR" : false);

function compareScalar(a: Scalar, b: Scalar): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = a === null ? "" : String(a).toLowerCase();
  const sb = b === null ? "" : String(b).toLowerCase();
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(sa.replace(",", "."));
    const nb = Number(sb.replace(",", "."));
    if (Number.isFinite(na) && Number.isFinite(nb) && sa !== "" && sb !== "") return na - nb;
    return typeof a === "number" ? -1 : 1;
  }
  return sa.localeCompare(sb, LOCALE);
}

/** Effective conditional format of every affected cell of a sheet. */
export function condFormatting(book: Book, values: CalcResult, si: number): Map<number, CondCell> {
  const sheet = book.sheets[si];
  const out = new Map<number, CondCell>();
  if (!sheet?.condFormats.length) return out;
  const stopped = new Set<number>();
  const evalAt = (f: string, base: Rect, r: number, c: number): Scalar => {
    const node = parsed(shiftFormula(f, r - base.r1, c - base.c1));
    if (node instanceof Error) return null;
    const v = evaluate(node, evalContext(book, values, si, r, c));
    return Array.isArray(v) ? v[0]?.[0] ?? null : v;
  };
  const merge = (k: number, patch: CondCell) => {
    const cur = out.get(k) ?? {};
    const style = patch.style ? { ...patch.style, ...(cur.style ?? {}) } : cur.style;
    out.set(k, { style, bar: cur.bar ?? patch.bar, fill: cur.fill ?? patch.fill });
  };

  for (const cf of sheet.condFormats) {
    const cells = cf.ranges.flatMap((rect) => positions(sheet, rect));
    const base = cf.ranges[0];
    const vals = cells.map((p) => cellValue(book, values, si, p.r, p.c));
    const nums = vals.filter((v): v is number => typeof v === "number");
    for (const rule of cf.rules) {
      const hit = (i: number, matched: boolean) => {
        const k = key(cells[i].r, cells[i].c);
        if (!matched || stopped.has(k)) return;
        merge(k, { style: rule.style });
        if (rule.stop) stopped.add(k);
      };
      switch (rule.kind) {
        case "cellIs": {
          const [f1, f2] = rule.formulas ?? [];
          if (f1 === undefined) break;
          cells.forEach((p, i) => {
            const v = vals[i];
            if (v === null) return hit(i, false);
            const a = evalAt(f1, base, p.r, p.c);
            const b = f2 !== undefined ? evalAt(f2, base, p.r, p.c) : null;
            const ca = compareScalar(v, a);
            const lo = b !== null && compareScalar(a, b) > 0 ? b : a;
            const hi = b !== null && compareScalar(a, b) > 0 ? a : b;
            let m = false;
            switch (rule.operator) {
              case "greaterThan": m = ca > 0; break;
              case "lessThan": m = ca < 0; break;
              case "greaterThanOrEqual": m = ca >= 0; break;
              case "lessThanOrEqual": m = ca <= 0; break;
              case "equal": m = ca === 0; break;
              case "notEqual": m = ca !== 0; break;
              case "between": m = compareScalar(v, lo) >= 0 && compareScalar(v, hi) <= 0; break;
              case "notBetween": m = compareScalar(v, lo) < 0 || compareScalar(v, hi) > 0; break;
            }
            hit(i, m);
          });
          break;
        }
        case "expression": {
          const f = rule.formulas?.[0];
          if (f) cells.forEach((p, i) => hit(i, truthy(evalAt(f, base, p.r, p.c))));
          break;
        }
        case "containsText":
        case "notContainsText":
        case "beginsWith":
        case "endsWith": {
          const t = (rule.text ?? "").toLowerCase();
          cells.forEach((p, i) => {
            if (vals[i] === null) return hit(i, rule.kind === "notContainsText");
            const s = displayText(book, values, si, p.r, p.c).toLowerCase();
            const m = rule.kind === "containsText" ? s.includes(t) : rule.kind === "notContainsText" ? !s.includes(t) : rule.kind === "beginsWith" ? s.startsWith(t) : s.endsWith(t);
            hit(i, m);
          });
          break;
        }
        case "containsBlanks":
        case "notContainsBlanks":
          cells.forEach((_, i) => {
            const blank = vals[i] === null || (typeof vals[i] === "string" && !(vals[i] as string).trim());
            hit(i, rule.kind === "containsBlanks" ? blank : !blank);
          });
          break;
        case "duplicateValues":
        case "uniqueValues": {
          const counts = new Map<string, number>();
          const keyOf = (v: Scalar) => (v === null ? null : typeof v === "string" ? `s${v.toLowerCase()}` : `${typeof v}${String(v)}`);
          vals.forEach((v) => {
            const k = keyOf(v);
            if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
          });
          vals.forEach((v, i) => {
            const k = keyOf(v);
            if (!k) return;
            const dup = (counts.get(k) ?? 0) > 1;
            hit(i, rule.kind === "duplicateValues" ? dup : !dup);
          });
          break;
        }
        case "top10": {
          if (!nums.length) break;
          const sorted = [...nums].sort((a, b) => (rule.bottom ? a - b : b - a));
          const n = rule.percent ? Math.max(1, Math.floor((nums.length * (rule.rank ?? 10)) / 100)) : rule.rank ?? 10;
          const threshold = sorted[Math.min(n, sorted.length) - 1];
          vals.forEach((v, i) => hit(i, typeof v === "number" && (rule.bottom ? v <= threshold : v >= threshold)));
          break;
        }
        case "aboveAverage": {
          if (!nums.length) break;
          const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
          vals.forEach((v, i) => hit(i, typeof v === "number" && (rule.below ? v < avg : v > avg)));
          break;
        }
        case "colorScale": {
          if (!nums.length) break;
          const colors = rule.colors?.length ? rule.colors : ["#f8696b", "#ffeb84", "#63be7b"];
          const min = Math.min(...nums);
          const max = Math.max(...nums);
          const sorted = [...nums].sort((a, b) => a - b);
          const mid = sorted[Math.floor((sorted.length - 1) / 2)] + (sorted.length % 2 ? 0 : (sorted[sorted.length / 2] - sorted[sorted.length / 2 - 1]) / 2);
          vals.forEach((v, i) => {
            if (typeof v !== "number") return;
            const k = key(cells[i].r, cells[i].c);
            if (stopped.has(k)) return;
            let fill: string;
            if (colors.length >= 3) fill = v <= mid ? mix(colors[0], colors[1], mid === min ? 1 : (v - min) / (mid - min)) : mix(colors[1], colors[2], max === mid ? 1 : (v - mid) / (max - mid));
            else fill = mix(colors[0], colors[1], max === min ? 1 : (v - min) / (max - min));
            merge(k, { fill });
          });
          break;
        }
        case "dataBar": {
          if (!nums.length) break;
          const color = rule.colors?.[0] ?? "#638ec6";
          const lo = Math.min(0, ...nums);
          const hi = Math.max(0, ...nums);
          const span = hi - lo || 1;
          const zero = (0 - lo) / span;
          vals.forEach((v, i) => {
            if (typeof v !== "number") return;
            const k = key(cells[i].r, cells[i].c);
            if (stopped.has(k)) return;
            const at = (v - lo) / span;
            merge(k, { bar: { start: Math.min(zero, at), end: Math.max(zero, at), color } });
          });
          break;
        }
      }
    }
  }
  return out;
}

/** Highlight presets offered in the conditional formatting dialogs. */
export const COND_PRESETS: { label: string; style: CellStyle }[] = [
  { label: tl("Hellrote Füllung 2 mit dunkelrotem Text"), style: { fill: "#ffc7ce", color: "#9c0006" } },
  { label: tl("Gelbe Füllung 2 mit dunkelgelbem Text"), style: { fill: "#ffeb9c", color: "#9c5700" } },
  { label: tl("Grüne Füllung 2 mit dunkelgrünem Text"), style: { fill: "#c6efce", color: "#006100" } },
  { label: tl("Hellrote Füllung"), style: { fill: "#ffc7ce" } },
  { label: tl("Roter Text"), style: { color: "#9c0006" } },
  { label: tl("Fett"), style: { bold: true } },
];

export function ruleRanges(book: Book, si: number, sel: Rect) {
  return book.sheets[si].condFormats.filter((cf) => cf.ranges.some((r) => r.r1 <= sel.r2 && r.r2 >= sel.r1 && r.c1 <= sel.c2 && r.c2 >= sel.c1));
}

/** Rule as readable German text (rules manager). */
export function describeRule(r: CondRule): string {
  const f = (i: number) => (r.formulas?.[i] ?? "").replace(/^=/, "");
  const ops: Record<string, string> = {
    greaterThan: "Zellwert > ",
    lessThan: "Zellwert < ",
    greaterThanOrEqual: "Zellwert ≥ ",
    lessThanOrEqual: "Zellwert ≤ ",
    equal: "Zellwert = ",
    notEqual: "Zellwert ≠ ",
  };
  switch (r.kind) {
    case "cellIs":
      if (r.operator === "between") return tl("Zellwert zwischen {0} und {1}", f(0), f(1));
      if (r.operator === "notBetween") return tl("Zellwert nicht zwischen {0} und {1}", f(0), f(1));
      return `${ops[r.operator ?? ""] ?? tl("Zellwert ")}${f(0)}`;
    case "expression":
      return `Formel: =${f(0)}`;
    case "containsText":
      return tl("Text enthält „{0}“", r.text ?? "");
    case "notContainsText":
      return tl("Text enthält nicht „{0}“", r.text ?? "");
    case "beginsWith":
      return tl("Beginnt mit „{0}“", r.text ?? "");
    case "endsWith":
      return tl("Endet mit „{0}“", r.text ?? "");
    case "containsBlanks":
      return tl("Leere Zellen");
    case "notContainsBlanks":
      return tl("Keine leeren Zellen");
    case "duplicateValues":
      return tl("Doppelte Werte");
    case "uniqueValues":
      return tl("Eindeutige Werte");
    case "top10":
      return `${r.bottom ? tl("Untere") : tl("Obere")} ${r.rank ?? 10}${r.percent ? " %" : ""}`;
    case "aboveAverage":
      return r.below ? tl("Unter dem Durchschnitt") : tl("Über dem Durchschnitt");
    case "colorScale":
      return tl("Farbskala ({0} Farben)", r.colors?.length ?? 3);
    case "dataBar":
      return tl("Datenbalken");
  }
  return r.kind;
}

// ----------------------------------------------------------------- filter --

/** The filters of a sheet: its auto filter and the filters of its tables. */
export function sheetFilters(s: SheetState): { range: Rect; columns: { col: number; values: string[] }[]; table?: string }[] {
  const out: { range: Rect; columns: { col: number; values: string[] }[]; table?: string }[] = s.autoFilter ? [s.autoFilter] : [];
  for (const t of s.tables) if (t.filter && t.headerRow) out.push({ range: { ...t.range, r2: t.range.r2 - (t.totalsRow && t.range.r2 > t.range.r1 ? 1 : 0) }, columns: t.filterColumns ?? [], table: t.name });
  return out;
}

/** Distinct displayed texts of a filter column (sorted). */
export function filterValues(book: Book, values: CalcResult, si: number, col: number, table?: string): string[] {
  const s = book.sheets[si];
  const af = sheetFilters(s).find((f) => f.table === table);
  if (!af) return [];
  const set = new Set<string>();
  for (let r = af.range.r1 + 1; r <= af.range.r2; r++) set.add(displayText(book, values, si, r, af.range.c1 + col));
  return [...set].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, LOCALE, { numeric: true })));
}

/** Hide the rows of the filter range that do not match its criteria. */
export function applyFilter(book: Book, si: number, values: CalcResult): Book {
  const s = book.sheets[si];
  const filters = sheetFilters(s);
  if (!filters.length) return book;
  const inside = (r: number) => filters.some((af) => r > af.range.r1 && r <= af.range.r2);
  const hidden = new Set([...s.hiddenRows].filter((r) => !inside(r)));
  for (const af of filters) {
    const sets = af.columns.map((fc) => ({ col: fc.col, values: new Set(fc.values) }));
    if (!sets.length) continue;
    for (let r = af.range.r1 + 1; r <= af.range.r2; r++) {
      if (sets.some((f) => !f.values.has(displayText(book, values, si, r, af.range.c1 + f.col)))) hidden.add(r);
    }
  }
  return { ...book, sheets: book.sheets.map((x, i) => (i === si ? { ...x, hiddenRows: hidden } : x)) };
}

/** The contiguous data block around a cell (Excel's "current region"). */
export function currentRegion(sheet: SheetState, r: number, c: number): Rect {
  const filled = (rr: number, cc: number) => {
    const cell = sheet.cells.get(key(rr, cc));
    return !!cell && (cell.v !== undefined && cell.v !== "" || !!cell.f || !!cell.e);
  };
  let rect = { r1: r, c1: c, r2: r, c2: c };
  for (let guard = 0; guard < 200; guard++) {
    const { r1, c1, r2, c2 } = rect;
    const grow = { ...rect };
    const rowHas = (rr: number, a: number, b: number) => {
      for (let x = Math.max(0, a); x <= b; x++) if (filled(rr, x)) return true;
      return false;
    };
    const colHas = (cc: number, a: number, b: number) => {
      for (let y = Math.max(0, a); y <= b; y++) if (filled(y, cc)) return true;
      return false;
    };
    if (r1 > 0 && rowHas(r1 - 1, c1 - 1, c2 + 1)) grow.r1--;
    if (rowHas(r2 + 1, c1 - 1, c2 + 1)) grow.r2++;
    if (c1 > 0 && colHas(c1 - 1, r1 - 1, r2 + 1)) grow.c1--;
    if (colHas(c2 + 1, r1 - 1, r2 + 1)) grow.c2++;
    if (grow.r1 === r1 && grow.r2 === r2 && grow.c1 === c1 && grow.c2 === c2) break;
    rect = grow;
  }
  return rect;
}

// ----------------------------------------------------------------- charts --

const quote = (name: string) => (/^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const absRange = (sheet: string, r1: number, c1: number, r2: number, c2: number) =>
  `${quote(sheet)}!$${colName(c1)}$${r1 + 1}${r1 === r2 && c1 === c2 ? "" : `:$${colName(c2)}$${r2 + 1}`}`;

/** Build a chart for a data range (header row / label column detected). */
export function chartFromRange(book: Book, values: CalcResult, si: number, rect: Rect, kind: ChartKind, forceByColumn?: boolean): Chart {
  const sheetName = book.sheets[si].name;
  const isText = (r: number, c: number) => typeof cellValue(book, values, si, r, c) === "string";
  const isEmpty = (r: number, c: number) => cellValue(book, values, si, r, c) === null;
  // Header row: text in the value columns of the first row.
  const header = rect.r2 > rect.r1 && Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, i) => rect.c1 + i).some((c) => c > rect.c1 && isText(rect.r1, c));
  // Label column: text (or empty top-left) in the first column below the header.
  const labels = rect.c2 > rect.c1 && (isText(header ? rect.r1 + 1 : rect.r1, rect.c1) || (header && isEmpty(rect.r1, rect.c1) && !isText(rect.r1 + 1, rect.c1 + 1)));
  const dataR1 = header ? rect.r1 + 1 : rect.r1;
  const dataC1 = labels ? rect.c1 + 1 : rect.c1;
  const rowsN = rect.r2 - dataR1 + 1;
  const colsN = rect.c2 - dataC1 + 1;
  const byColumn = kind === "scatter" || (forceByColumn ?? (rowsN >= colsN || kind === "pie" || kind === "doughnut"));
  const series: ChartSeries[] = [];
  if (kind === "scatter") {
    // First column = x values, the others = y series.
    const xc = labels ? rect.c1 : dataC1;
    const ys = labels ? dataC1 : dataC1 + 1;
    for (let c = ys; c <= rect.c2; c++)
      series.push({ nameRef: header ? absRange(sheetName, rect.r1, c, rect.r1, c) : undefined, catRef: absRange(sheetName, dataR1, xc, rect.r2, xc), valRef: absRange(sheetName, dataR1, c, rect.r2, c), categories: [], values: [] });
  } else if (byColumn) {
    for (let c = dataC1; c <= rect.c2; c++)
      series.push({
        nameRef: header ? absRange(sheetName, rect.r1, c, rect.r1, c) : undefined,
        catRef: labels ? absRange(sheetName, dataR1, rect.c1, rect.r2, rect.c1) : undefined,
        valRef: absRange(sheetName, dataR1, c, rect.r2, c),
        categories: [],
        values: [],
      });
  } else {
    for (let r = dataR1; r <= rect.r2; r++)
      series.push({
        nameRef: labels ? absRange(sheetName, r, rect.c1, r, rect.c1) : undefined,
        catRef: header ? absRange(sheetName, rect.r1, dataC1, rect.r1, rect.c2) : undefined,
        valRef: absRange(sheetName, r, dataC1, r, rect.c2),
        categories: [],
        values: [],
      });
  }
  const pie = kind === "pie" || kind === "doughnut";
  return { kind, series: pie ? series.slice(0, 1) : series, legend: pie || series.length > 1 ? (pie ? "r" : "b") : undefined };
}

/** Cells of a reference like 'Blatt 1'!$A$1:$A$9. */
function refCells(book: Book, values: CalcResult, si: number, ref: string): { v: Scalar; text: string }[] | null {
  const m = ref.match(/^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i);
  if (!m) return null;
  const sheetName = (m[1]?.replace(/''/g, "'") ?? m[2])?.toLowerCase();
  const s = sheetName ? book.sheets.findIndex((x) => x.name.toLowerCase() === sheetName) : si;
  if (s < 0) return null;
  const col = (t: string) => [...t.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const c1 = col(m[3]);
  const r1 = Number(m[4]) - 1;
  const c2 = m[5] ? col(m[5]) : c1;
  const r2 = m[6] ? Number(m[6]) - 1 : r1;
  const out: { v: Scalar; text: string }[] = [];
  const sheet = book.sheets[s];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2) && out.length < 5000; r++)
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      // Hidden (filtered) rows are skipped like in Excel.
      if (sheet.hiddenRows.has(r) || sheet.hiddenCols.has(c)) continue;
      out.push({ v: cellValue(book, values, s, r, c), text: displayText(book, values, s, r, c) });
    }
  return out;
}

export const refCellsPublic = (book: Book, values: CalcResult, si: number, ref: string) => refCells(book, values, si, ref);

/** The chart with series data read from the workbook. */
export function resolveChart(book: Book, values: CalcResult, si: number, chart: Chart): Chart {
  return {
    ...chart,
    series: chart.series.map((s) => {
      const name = s.nameRef ? refCells(book, values, si, s.nameRef)?.[0]?.text : undefined;
      const cats = s.catRef ? refCells(book, values, si, s.catRef) : null;
      const vals = s.valRef ? refCells(book, values, si, s.valRef) : null;
      return {
        ...s,
        name: name ?? s.name,
        categories: cats ? cats.map((x) => x.text) : s.categories,
        values: vals ? vals.map((x) => (typeof x.v === "number" && !isError(x.v) ? x.v : null)) : s.values,
      };
    }),
  };
}

/** Data range of a chart (for "Daten auswählen"), if it is one block. */
export function chartRange(chart: Chart): string {
  const refs = chart.series.flatMap((s) => [s.nameRef, s.catRef, s.valRef]).filter((x): x is string => !!x);
  if (!refs.length) return "";
  const parts = refs.map((r) => r.match(/^(.*!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i)).filter((m): m is RegExpMatchArray => !!m);
  if (!parts.length) return "";
  const col = (t: string) => [...t.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
  for (const m of parts) {
    const a = { c: col(m[2]), r: Number(m[3]) - 1 };
    const b = m[4] ? { c: col(m[4]), r: Number(m[5]) - 1 } : a;
    r1 = Math.min(r1, a.r, b.r);
    c1 = Math.min(c1, a.c, b.c);
    r2 = Math.max(r2, a.r, b.r);
    c2 = Math.max(c2, a.c, b.c);
  }
  return `${parts[0][1] ?? ""}$${colName(c1)}$${r1 + 1}:$${colName(c2)}$${r2 + 1}`;
}

// ------------------------------------------------------- data validation --

export const validationAt = (sheet: SheetState, r: number, c: number) => sheet.validations.find((v) => v.ranges.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2));

function evalFormula(book: Book, values: CalcResult, si: number, f: string, base: Rect | null, r: number, c: number): Scalar | Scalar[][] {
  const node = parsed(base ? shiftFormula(f, r - base.r1, c - base.c1) : f);
  if (node instanceof Error) return null;
  return evaluate(node, evalContext(book, values, si, r, c)) as Scalar | Scalar[][];
}

/** Entries of a list validation ("a,b,c" or a range). */
export function validationList(book: Book, values: CalcResult, si: number, v: Validation): string[] {
  const f = (v.formulas?.[0] ?? "").trim();
  if (f.startsWith('"')) return f.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean);
  const res = evalFormula(book, values, si, f, null, 0, 0);
  const flat = Array.isArray(res) ? res.flat() : [res];
  return flat.filter((x) => x !== null && x !== "" && !isError(x)).map((x) => formatValue(x as Scalar, null).text);
}

/** Whether a value satisfies the validation of cell (r, c). */
export function validate(book: Book, values: CalcResult, si: number, v: Validation, value: Scalar, r: number, c: number): boolean {
  if (value === null || value === "") return v.allowBlank !== false;
  const base = v.ranges[0] ?? null;
  const num = (i: number): number | null => {
    const f = v.formulas?.[i];
    if (f === undefined) return null;
    const x = evalFormula(book, values, si, f, base, r, c);
    const s = Array.isArray(x) ? x[0]?.[0] : x;
    return typeof s === "number" ? s : typeof s === "string" && s.trim() !== "" && Number.isFinite(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : null;
  };
  const cmp = (x: number) => {
    const a = num(0);
    const b = num(1);
    if (a === null) return true;
    switch (v.operator ?? "between") {
      case "between":
        return b === null || (x >= Math.min(a, b) && x <= Math.max(a, b));
      case "notBetween":
        return b === null || x < Math.min(a, b) || x > Math.max(a, b);
      case "equal":
        return x === a;
      case "notEqual":
        return x !== a;
      case "greaterThan":
        return x > a;
      case "lessThan":
        return x < a;
      case "greaterThanOrEqual":
        return x >= a;
      case "lessThanOrEqual":
        return x <= a;
    }
    return true;
  };
  switch (v.kind) {
    case "list": {
      const text = formatValue(value, null).text.toLowerCase();
      return validationList(book, values, si, v).some((x) => x.toLowerCase() === text);
    }
    case "whole":
      return typeof value === "number" && Number.isInteger(value) && cmp(value);
    case "decimal":
    case "date":
    case "time":
      return typeof value === "number" && cmp(value);
    case "textLength":
      return cmp(formatValue(value, null).text.length);
    case "custom": {
      const f = v.formulas?.[0];
      if (!f) return true;
      const x = evalFormula(book, values, si, f, base, r, c);
      const s = Array.isArray(x) ? x[0]?.[0] : x;
      return s === true || (typeof s === "number" && s !== 0);
    }
  }
  return true;
}

// ------------------------------------------------------------- sparklines --

/** Numbers of a sparkline's source range. */
export function sparklineValues(book: Book, values: CalcResult, si: number, source: string): (number | null)[] {
  return (refCellsPublic(book, values, si, source) ?? []).map((x) => (typeof x.v === "number" ? x.v : null));
}

// ------------------------------------------------------------ pivot table --

export type PivotAgg = "SUM" | "COUNT" | "AVERAGE" | "MAX" | "MIN";
export const PIVOT_AGGS: { fn: PivotAgg; label: string }[] = [
  { fn: "SUM", label: tl("Summe") },
  { fn: "COUNT", label: tl("Anzahl") },
  { fn: "AVERAGE", label: tl("Mittelwert") },
  { fn: "MAX", label: tl("Maximum") },
  { fn: "MIN", label: tl("Minimum") },
];

/**
 * A pivot table as formulas (SUMIFS, COUNTIFS, …) on a new sheet: unique
 * values of the row field down, of the column field across, and totals.
 * The formulas stay live when the source data changes.
 */
/** Sort orders of month and weekday names (German and English, long and short). */
const CUSTOM_LISTS: string[][] = [
  ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"],
  ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"],
  ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"],
  ["mo", "di", "mi", "do", "fr", "sa", "so"],
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
];

/** Grouping of a date row field. */
export type PivotGroup = "month" | "quarter" | "year";

export interface PivotOptions {
  /** Group dates of the row field. */
  group?: PivotGroup;
  /** Report filter: field and value (shown above the table, editable). */
  filterCol?: number;
  filterValue?: string;
  /** Row items (labels, lower case) left out. */
  hidden?: string[];
}

const MONTHS_SHORT = [tl("Jan"), tl("Feb"), tl("Mär"), tl("Apr"), tl("Mai"), tl("Jun"), tl("Jul"), tl("Aug"), tl("Sep"), tl("Okt"), tl("Nov"), tl("Dez")];

/** Row items of a pivot field: label, sort key and SUMIFS criteria bounds. */
export function pivotItems(book: Book, values: CalcResult, si: number, src: Rect, c: number, group?: PivotGroup): { label: string | number; key: string; text: string; from?: number; to?: number }[] {
  if (!group) {
    const fmt = book.styles[book.sheets[si].cells.get(key(src.r1 + 1, c))?.s ?? 0]?.numFmt;
    return pivotUnique(book, values, si, src, c).map((v) => ({ label: v as string | number, key: String(v).toLowerCase(), text: typeof v === "number" && fmt ? formatValue(v, fmt).text : String(v) }));
  }
  const map = new Map<string, { label: string | number; key: string; text: string; from: number; to: number; order: number }>();
  for (let r = src.r1 + 1; r <= src.r2; r++) {
    const v = cellValue(book, values, si, r, c);
    if (typeof v !== "number") continue;
    const { y, m } = serialToDate(v);
    let label: string | number, from: number, to: number, order: number;
    if (group === "year") {
      [label, from, to, order] = [y, dateToSerial(y, 1, 1), dateToSerial(y + 1, 1, 1), y * 12];
    } else if (group === "quarter") {
      const q = Math.floor((m - 1) / 3);
      [label, from, to, order] = [`Q${q + 1} ${y}`, dateToSerial(y, q * 3 + 1, 1), dateToSerial(y, q * 3 + 4, 1), y * 12 + q * 3];
    } else {
      [label, from, to, order] = [`${MONTHS_SHORT[m - 1]} ${y}`, dateToSerial(y, m, 1), dateToSerial(y, m + 1, 1), y * 12 + m - 1];
    }
    const key = String(label).toLowerCase();
    if (!map.has(key)) map.set(key, { label, key, text: String(label), from, to, order });
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

/** Distinct values of a column of the source (sorted, calendar names in calendar order). */
export function pivotUnique(book: Book, values: CalcResult, si: number, src: Rect, c: number): Scalar[] {
  const set = new Map<string, Scalar>();
  for (let r = src.r1 + 1; r <= src.r2; r++) {
    const v = cellValue(book, values, si, r, c);
    if (v === null || v === "" || isError(v)) continue;
    const k = typeof v === "string" ? v.toLowerCase() : String(v);
    if (!set.has(k)) set.set(k, v);
  }
  const list = [...set.values()];
  const custom = CUSTOM_LISTS.find((l) => list.every((v) => typeof v === "string" && l.includes(v.trim().toLowerCase())));
  if (custom) return list.sort((a, b) => custom.indexOf(String(a).trim().toLowerCase()) - custom.indexOf(String(b).trim().toLowerCase()));
  return list.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), LOCALE, { numeric: true })));
}

export function buildPivot(book: Book, values: CalcResult, si: number, src: Rect, rowCol: number, colCol: number | null, valCol: number, agg: PivotAgg, opts: PivotOptions = {}): { sheet: SheetState; styles: CellStyle[] } {
  const s = book.sheets[si];
  const head = (c: number) => displayText(book, values, si, src.r1, c) || colName(c);
  const uniq = (c: number) => pivotUnique(book, values, si, src, c);
  const quote = (n: string) => (/^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
  const col = (c: number) => `${quote(s.name)}!$${colName(c)}$${src.r1 + 2}:$${colName(c)}$${src.r2 + 1}`;
  const label = PIVOT_AGGS.find((x) => x.fn === agg)!.label;
  const hidden = new Set(opts.hidden ?? []);
  // Row labels keep the source format (e.g. dates).
  const labelFmt = book.styles[s.cells.get(key(src.r1 + 1, rowCol))?.s ?? 0]?.numFmt;
  const rows = pivotItems(book, values, si, src, rowCol, opts.group).filter((it) => !hidden.has(it.key));
  const cols = colCol === null ? [] : uniq(colCol);
  const out = newSheet(`PivotTable`);
  let styles = book.styles;
  const style = (st: CellStyle) => {
    const [n, idx] = internStyle(styles, st);
    styles = n;
    return idx;
  };
  const hdr = style({ bold: true, fill: "#dde5f1", borderBottom: "thin" });
  // Values keep the number format of the source column (not for counts).
  const numFmt = agg === "COUNT" ? undefined : book.styles[s.cells.get(key(src.r1 + 1, valCol))?.s ?? 0]?.numFmt;
  const num = style({ numFmt });
  const total = style({ bold: true, borderTop: "thin", fill: "#eef2f8", numFmt });
  const rowTotal = style({ bold: true, numFmt });
  const labelStyle = labelFmt ? style({ numFmt: labelFmt }) : undefined;
  const set = (r: number, c: number, cell: SCell) => out.cells.set(key(r, c), cell);
  const fn = (crit: string[]) => {
    const pairs = crit.join(",");
    switch (agg) {
      case "COUNT":
        return crit.length ? `COUNTIFS(${pairs})` : `COUNTA(${col(valCol)})`;
      case "SUM":
        return crit.length ? `SUMIFS(${col(valCol)},${pairs})` : `SUM(${col(valCol)})`;
      case "AVERAGE":
        return crit.length ? `AVERAGEIFS(${col(valCol)},${pairs})` : `AVERAGE(${col(valCol)})`;
      case "MAX":
        return crit.length ? `MAXIFS(${col(valCol)},${pairs})` : `MAX(${col(valCol)})`;
      case "MIN":
        return crit.length ? `MINIFS(${col(valCol)},${pairs})` : `MIN(${col(valCol)})`;
    }
  };
  set(0, 0, { v: tl("{0} von {1}", label, head(valCol)), s: style({ bold: true, size10: 130 }) });
  // Report filter: the value in B2 can be changed later ("(Alle)" = no filter).
  const filtered = opts.filterCol !== undefined;
  const top = filtered ? 3 : 2;
  const filterCrit: string[] = [];
  if (filtered) {
    set(1, 0, { v: head(opts.filterCol!), s: style({ bold: true }) });
    set(1, 1, { v: opts.filterValue ?? "(Alle)", s: style({ fill: "#fff2cc", borderBottom: "thin" }) });
    filterCrit.push(`${col(opts.filterCol!)},IF($B$2="(Alle)","*",$B$2)`);
    // Drop-down with the field's values for changing the filter later.
    const choices = ["(Alle)", ...pivotUnique(book, values, si, src, opts.filterCol!).map(String)].map((v) => v.replace(/[",]/g, " "));
    if (choices.join(",").length < 250) out.validations.push({ ranges: [{ r1: 1, c1: 1, r2: 1, c2: 1 }], kind: "list", formulas: [`"${choices.join(",")}"`], prompt: tl("Filterwert wählen") });
  }
  set(top, 0, { v: head(rowCol), s: hdr });
  const colsOut = cols.length ? cols : [null];
  // Criteria of a row: its label cell, or the date bounds of its group.
  const rowCriteria = (it: { from?: number; to?: number }, r: number) => (it.from !== undefined ? `${col(rowCol)},">=${it.from}",${col(rowCol)},"<${it.to}"` : `${col(rowCol)},$A${r + 1}`);
  colsOut.forEach((cv, j) => set(top, 1 + j, cv === null ? { v: label, s: hdr } : { v: cv as string | number, s: hdr }));
  if (cols.length) set(top, 1 + cols.length, { v: "Gesamtergebnis", s: hdr });
  rows.forEach((rv, i) => {
    const r = top + 1 + i;
    set(r, 0, { v: rv.label, s: typeof rv.label === "number" && !opts.group ? labelStyle : undefined });
    const rowCrit = rowCriteria(rv, r);
    colsOut.forEach((cv, j) => {
      const crit = [rowCrit, ...filterCrit];
      if (cv !== null) crit.push(`${col(colCol!)},${colName(1 + j)}$${top + 1}`);
      set(r, 1 + j, { f: fn(crit), s: num || undefined });
    });
    if (cols.length) set(r, 1 + cols.length, { f: fn([rowCrit, ...filterCrit]), s: rowTotal });
  });
  const tr = top + 1 + rows.length;
  set(tr, 0, { v: "Gesamtergebnis", s: total });
  // With hidden items the totals only cover the rows shown.
  const totalOf = (extra: string[], c: number) => {
    if (!hidden.size) return fn([...filterCrit, ...extra]);
    const range = `${colName(c)}${top + 2}:${colName(c)}${tr}`;
    if (!rows.length) return "0";
    if (agg === "SUM" || agg === "COUNT") return `SUM(${range})`;
    if (agg === "MAX" || agg === "MIN") return `${agg}(${range})`;
    const terms = (f: "SUMIFS" | "COUNTIFS") => rows.map((it, i) => `${f}(${f === "SUMIFS" ? `${col(valCol)},` : ""}${[rowCriteria(it, top + 1 + i), ...filterCrit, ...extra].join(",")})`).join("+");
    return `(${terms("SUMIFS")})/(${terms("COUNTIFS")})`;
  };
  colsOut.forEach((cv, j) => set(tr, 1 + j, { f: totalOf(cv === null ? [] : [`${col(colCol!)},${colName(1 + j)}$${top + 1}`], 1 + j), s: total }));
  if (cols.length) set(tr, 1 + cols.length, { f: totalOf([], 1 + cols.length), s: total });
  out.cols.set(0, 160);
  for (let j = 0; j <= cols.length; j++) out.cols.set(1 + j, 110);
  out.freezeRows = top + 1;
  return { sheet: out, styles };
}
