// Excel tables ("intelligente Tabellen"): styles, structured references,
// totals rows, automatic expansion and calculated columns.

import type { Rect, SCell, SheetState, TableDef } from "./model";
import { tl } from "../../lib/i18n";

// ----------------------------------------------------------------- styles --

/** Accent colours of the table styles (Excel's Office theme). */
const ACCENTS = ["#404040", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];
export const TABLE_FAMILIES = [
  { id: "Light", label: tl("Hell") },
  { id: "Medium", label: tl("Mittel") },
  { id: "Dark", label: tl("Dunkel") },
] as const;
/** Style names of the gallery: TableStyle{Light|Medium|Dark}{1…7}. */
export const TABLE_STYLES = TABLE_FAMILIES.flatMap((f) => ACCENTS.map((_, i) => `TableStyle${f.id}${i + 1}`));

export function tint(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function styleParts(name: string) {
  const m = name.match(/^TableStyle(Light|Medium|Dark)(\d+)$/);
  if (!m) return { family: tl("Medium"), accent: ACCENTS[1] };
  // Excel's numbering repeats the seven colours in blocks (1–7, 8–14, …).
  return { family: m[1], accent: ACCENTS[(Number(m[2]) - 1) % 7] };
}

export interface TableLook {
  fill?: string;
  color?: string;
  bold?: boolean;
  /** CSS borders. */
  top?: string;
  bottom?: string;
}

/** Formatting a table adds to a cell (below the cell's own format). */
export function tableLook(t: TableDef, r: number, c: number): TableLook {
  const { family, accent } = styleParts(t.style);
  const header = t.headerRow && r === t.range.r1;
  const totals = t.totalsRow && r === t.range.r2;
  const dataRow = r - t.range.r1 - (t.headerRow ? 1 : 0);
  const dataCol = c - t.range.c1;
  const band = (t.bandedRows && dataRow % 2 === 0) || (t.bandedCols && dataCol % 2 === 0);
  const edgeCol = (t.firstCol && c === t.range.c1) || (t.lastCol && c === t.range.c2);
  const out: TableLook = {};
  if (family === "Dark") {
    if (header) Object.assign(out, { fill: "#000000", color: "#ffffff", bold: true });
    else if (totals) Object.assign(out, { fill: tint(accent, -0.5), color: "#ffffff", bold: true });
    else Object.assign(out, { fill: band ? tint(accent, -0.25) : accent, color: "#ffffff", bold: edgeCol || undefined });
    return out;
  }
  if (family === "Medium") {
    if (header) Object.assign(out, { fill: accent, color: "#ffffff", bold: true });
    else if (totals) Object.assign(out, { bold: true, top: `3px double ${accent}` });
    else if (band) out.fill = tint(accent, 0.8);
    if (edgeCol && !header) out.bold = true;
    return out;
  }
  // Light
  if (header) Object.assign(out, { bold: true, bottom: `1px solid ${accent}` });
  else if (totals) Object.assign(out, { bold: true, top: `3px double ${accent}` });
  else if (band) out.fill = tint(accent, 0.85);
  if (edgeCol) out.bold = true;
  if (r === t.range.r1) out.top ??= `1px solid ${accent}`;
  if (r === t.range.r2) out.bottom ??= `1px solid ${accent}`;
  return out;
}

/** Colour swatch of a style for the gallery: [header, band, body]. */
export function styleSwatch(name: string): [string, string, string] {
  const { family, accent } = styleParts(name);
  if (family === "Dark") return ["#000000", tint(accent, -0.25), accent];
  if (family === "Medium") return [accent, tint(accent, 0.8), "#ffffff"];
  return ["#ffffff", tint(accent, 0.85), "#ffffff"];
}

export const tableAt = (sheet: SheetState, r: number, c: number) => sheet.tables.find((t) => r >= t.range.r1 && r <= t.range.r2 && c >= t.range.c1 && c <= t.range.c2);

/** Data rows of a table (without header and totals). */
export const dataRows = (t: TableDef) => ({ r1: t.range.r1 + (t.headerRow ? 1 : 0), r2: t.range.r2 - (t.totalsRow ? 1 : 0) });

/** Range the table's filter covers (header and data). */
export const filterRange = (t: TableDef): Rect => ({ ...t.range, r2: t.range.r2 - (t.totalsRow && t.range.r2 > t.range.r1 ? 1 : 0) });

// ------------------------------------------------------ structured refs --

const KEYWORDS: [string, string][] = [
  ["#All", "#Alle"],
  ["#Data", "#Daten"],
  ["#Headers", "#Kopfzeilen"],
  ["#Totals", "#Ergebnisse"],
  ["#This Row", "#Diese Zeile"],
];

/** End (exclusive) of the bracket group at `start`. */
export function bracketEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") i++;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Spec text in a locale: keywords and the separators between parts. */
export function specText(spec: string, to: "en" | "de"): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === "'") {
      out += ch + (spec[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (depth === 0 && (ch === "," || ch === ";")) out += to === "de" ? ";" : ",";
    else out += ch;
  }
  for (const [en, de] of KEYWORDS) out = out.replace(new RegExp((to === "de" ? en : de).replace(/ /g, "\\s"), "gi"), to === "de" ? de : en);
  return out;
}

export interface TableInfo {
  sheet: number;
  range: Rect;
  headerRow: boolean;
  totalsRow: boolean;
  columns: string[];
}

const colName = (spec: string) => {
  const t = spec.trim();
  return (t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t).replace(/'(.)/g, "$1");
};

/** Range a structured reference stands for, or null (#REF!). */
export function resolveSpec(t: TableInfo, spec: string, row: number): Rect | null {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] === "[") {
      const end = bracketEnd(spec, i);
      if (end < 0) return null;
      cur += spec.slice(i, end);
      i = end - 1;
      continue;
    }
    if (spec[i] === "," || spec[i] === ";") (parts.push(cur), (cur = ""));
    else cur += spec[i];
  }
  parts.push(cur);
  let r1 = t.range.r1 + (t.headerRow ? 1 : 0);
  let r2 = t.range.r2 - (t.totalsRow ? 1 : 0);
  let c1 = t.range.c1;
  let c2 = t.range.c2;
  const col = (n: string) => {
    const i = t.columns.findIndex((c) => c.toLowerCase() === n.trim().toLowerCase());
    return i < 0 ? null : t.range.c1 + i;
  };
  for (const raw of parts) {
    const p = raw.trim();
    const k = colName(p).toLowerCase();
    if (!k && !p.startsWith("@")) continue;
    if (k === "#all" || k === "#alle") [r1, r2] = [t.range.r1, t.range.r2];
    else if (k === "#data" || k === "#daten") continue;
    else if (k === "#headers" || k === "#kopfzeilen") {
      if (!t.headerRow) return null;
      [r1, r2] = [t.range.r1, t.range.r1];
    } else if (k === "#totals" || k === "#ergebnisse") {
      if (!t.totalsRow) return null;
      [r1, r2] = [t.range.r2, t.range.r2];
    } else if (k === "#this row" || k === "#diese zeile") [r1, r2] = [row, row];
    else if (p.startsWith("@")) {
      [r1, r2] = [row, row];
      const c = colName(p.slice(1));
      if (c) {
        const x = col(c);
        if (x === null) return null;
        [c1, c2] = [x, x];
      }
    } else {
      const inner = p.startsWith("[") && p.endsWith("]") ? p.slice(1, -1) : p;
      const sep = inner.indexOf("]:[");
      if (sep >= 0) {
        const a = col(colName(inner.slice(0, sep)));
        const b = col(colName(inner.slice(sep + 3)));
        if (a === null || b === null) return null;
        [c1, c2] = [Math.min(a, b), Math.max(a, b)];
      } else {
        const x = col(colName(inner));
        if (x === null) return null;
        [c1, c2] = [x, x];
      }
    }
  }
  if (r2 < r1) return null;
  return { r1, c1, r2, c2 };
}

// ------------------------------------------------------------- creation --

/** Unique table name: Tabelle1, Tabelle2, … */
export function newTableName(sheets: SheetState[], base = tl("Tabelle")) {
  const used = new Set(sheets.flatMap((s) => s.tables.map((t) => t.name.toLowerCase())));
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
}

/** Column names from header texts: empty ones become "SpalteN", duplicates get a number. */
export function columnNames(texts: string[]): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  texts.forEach((t, i) => {
    let n = t.trim() || tl("Spalte{0}", i + 1);
    if (used.has(n.toLowerCase())) {
      let k = 2;
      while (used.has(`${n}${k}`.toLowerCase())) k++;
      n = `${n}${k}`;
    }
    used.add(n.toLowerCase());
    out.push(n);
  });
  return out;
}

/** SUBTOTAL codes of the totals row functions. */
export const TOTALS_FUNCTIONS: { id: string; label: string; code: number | null }[] = [
  { id: "none", label: tl("Keine"), code: null },
  { id: "average", label: tl("Mittelwert"), code: 101 },
  { id: "count", label: tl("Anzahl"), code: 103 },
  { id: "countNums", label: tl("Anzahl Zahlen"), code: 102 },
  { id: "max", label: tl("Max"), code: 104 },
  { id: "min", label: tl("Min"), code: 105 },
  { id: "sum", label: tl("Summe"), code: 109 },
  { id: "stdDev", label: tl("StdAbw"), code: 107 },
  { id: "var", label: tl("Varianz"), code: 110 },
];

/** Formula of a totals row cell. */
export const totalsFormula = (t: TableDef, column: string, fn: string) => {
  const code = TOTALS_FUNCTIONS.find((f) => f.id === fn)?.code;
  const ref = /^[\wÄÖÜäöüß]+$/.test(column) ? `[${column}]` : `[[${column.replace(/([[\]#'])/g, "'$1")}]]`;
  return code ? `SUBTOTAL(${code},${t.name}${ref})` : null;
};

/** Renames a column inside structured references of a formula. */
export function renameColumnInFormula(f: string, table: string, from: string, to: string, ownTable: boolean): string {
  if (!f.includes("[")) return f;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = ownTable ? `(?:${esc(table)})?` : esc(table);
  return f.replace(new RegExp(`(${prefix}\\[(?:[^\\]"]*?\\[)?@?\\[?)${esc(from)}(\\]?)`, "gi"), (m, a: string, b: string) => {
    void m;
    return `${a}${to}${b}`;
  });
}

export const cellText = (c: SCell | undefined) => (c?.v === undefined || c.v === null ? "" : String(c.v));
