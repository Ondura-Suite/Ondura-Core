// Commands of the Tabellen ribbon that Excel has and that need more than a
// one-liner: cell styles, paste special, go to special, custom sort,
// subtotals, advanced filter, names from selection, forecast sheet,
// workbook statistics, watch window and their dialogs.

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Option, Radio, RadioGroup, Text } from "@fluentui/react-components";
import { Delete16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { type Book, type CalcResult, type CellStyle, type ClipBlock, type Rect, type SCell, type SheetState, internStyle, key, parseRange, setCells, shiftAxis, unkey, usedRange, withSheet } from "./model";
import { type Scalar, colName, isError, mapTokens, shiftFormula } from "./formula";
import { tl } from "../../lib/i18n";

// ------------------------------------------------------------ cell styles --

export interface CellStylePreset {
  group: string;
  name: string;
  style: CellStyle;
  /** Number format styles only change the number format. */
  numberOnly?: boolean;
}

const accent = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

/** Zellenformatvorlagen as in Excel. */
export const CELL_STYLES: CellStylePreset[] = [
  { group: tl("Gut, Schlecht und Neutral"), name: tl("Standard"), style: {} },
  { group: tl("Gut, Schlecht und Neutral"), name: tl("Gut"), style: { fill: "#c6efce", color: "#006100" } },
  { group: tl("Gut, Schlecht und Neutral"), name: tl("Schlecht"), style: { fill: "#ffc7ce", color: "#9c0006" } },
  { group: tl("Gut, Schlecht und Neutral"), name: tl("Neutral"), style: { fill: "#ffeb9c", color: "#9c5700" } },
  { group: tl("Daten und Modell"), name: tl("Berechnung"), style: { fill: "#f2f2f2", color: "#fa7d00", bold: true, borderTop: "thin", borderBottom: "thin", borderLeft: "thin", borderRight: "thin" } },
  { group: tl("Daten und Modell"), name: tl("Eingabe"), style: { fill: "#ffcc99", color: "#3f3f76", borderTop: "thin", borderBottom: "thin", borderLeft: "thin", borderRight: "thin" } },
  { group: tl("Daten und Modell"), name: tl("Ausgabe"), style: { fill: "#f2f2f2", color: "#3f3f3f", bold: true, borderTop: "thin", borderBottom: "thin", borderLeft: "thin", borderRight: "thin" } },
  { group: tl("Daten und Modell"), name: tl("Notiz"), style: { fill: "#ffffcc", borderTop: "thin", borderBottom: "thin", borderLeft: "thin", borderRight: "thin" } },
  { group: tl("Daten und Modell"), name: tl("Warnender Text"), style: { color: "#ff0000" } },
  { group: tl("Daten und Modell"), name: tl("Erklärender Text"), style: { color: "#7f7f7f", italic: true } },
  { group: tl("Daten und Modell"), name: tl("Zelle überprüfen"), style: { fill: "#a5a5a5", color: "#ffffff", bold: true, borderTop: "double", borderBottom: "double", borderLeft: "double", borderRight: "double" } },
  { group: tl("Titel und Überschriften"), name: tl("Titel"), style: { size10: 180, color: "#44546a" } },
  { group: tl("Titel und Überschriften"), name: tl("Überschrift 1"), style: { size10: 150, bold: true, color: "#44546a", borderBottom: "thick" } },
  { group: tl("Titel und Überschriften"), name: tl("Überschrift 2"), style: { size10: 130, bold: true, color: "#44546a", borderBottom: "medium" } },
  { group: tl("Titel und Überschriften"), name: tl("Überschrift 3"), style: { bold: true, color: "#44546a", borderBottom: "medium" } },
  { group: tl("Titel und Überschriften"), name: tl("Überschrift 4"), style: { bold: true, color: "#44546a" } },
  { group: tl("Titel und Überschriften"), name: tl("Ergebnis"), style: { bold: true, borderTop: "thin", borderBottom: "double" } },
  ...accent.map((c, i) => ({ group: tl("Designbasierte Zellenformatvorlagen"), name: tl("Akzent{0}", i + 1), style: { fill: c, color: "#ffffff" } })),
  ...accent.map((c, i) => ({ group: tl("Designbasierte Zellenformatvorlagen"), name: tl("20 % – Akzent{0}", i + 1), style: { fill: `${c}33` } })),
  { group: tl("Zahlenformat"), name: tl("Komma"), style: { numFmt: "#,##0.00" }, numberOnly: true },
  { group: tl("Zahlenformat"), name: tl("Komma [0]"), style: { numFmt: "#,##0" }, numberOnly: true },
  { group: tl("Zahlenformat"), name: tl("Prozent"), style: { numFmt: "0%" }, numberOnly: true },
  { group: tl("Zahlenformat"), name: tl("Währung"), style: { numFmt: '#,##0.00 "€"' }, numberOnly: true },
  { group: tl("Zahlenformat"), name: tl("Währung [0]"), style: { numFmt: '#,##0 "€"' }, numberOnly: true },
];

/** The style a cell gets from a preset (keeps the number format and protection). */
export function applyCellStyle(st: CellStyle, preset: CellStylePreset): CellStyle {
  // An 8-digit fill like "#4472c433" is a tint: mixed with white for the cell.
  const tint = (c: string | undefined) => {
    if (!c || c.length !== 9) return c;
    const a = parseInt(c.slice(7), 16) / 255;
    const ch = (i: number) => Math.round(255 - (255 - parseInt(c.slice(i, i + 2), 16)) * a);
    return `#${[1, 3, 5].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`;
  };
  if (preset.numberOnly) return { ...st, numFmt: preset.style.numFmt };
  const keep: CellStyle = { numFmt: st.numFmt, locked: st.locked, hideFormula: st.hideFormula, hAlign: st.hAlign, vAlign: st.vAlign, wrap: st.wrap, indent: st.indent, rotation: st.rotation };
  const next: CellStyle = { ...keep, ...preset.style, fill: tint(preset.style.fill) };
  for (const k of Object.keys(next) as (keyof CellStyle)[]) if (next[k] === undefined) delete next[k];
  return next;
}

// ----------------------------------------------------------- paste special --

export type PasteMode = "values" | "formulas" | "formats" | "valuesFormats" | "noBorders" | "transpose" | "columnWidths" | "link";

const quoteSheet = (n: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/** Inhalte einfügen: pastes part of a copied block at r0/c0. `valueOf` gives
 *  the calculated value of a source cell. */
export function pasteSpecial(book: Book, si: number, r0: number, c0: number, block: ClipBlock, mode: PasteMode, valueOf: (sheet: number, r: number, c: number) => Scalar): Book {
  const src = block.source;
  const at = new Map(block.cells.map(([r, c, cell]) => [r * 100000 + c, cell]));
  const dest = book.sheets[si];
  if (mode === "columnWidths") {
    const from = book.sheets[src.sheet];
    return withSheet(book, si, (s) => {
      const cols = new Map(s.cols);
      for (let c = 0; c < block.cols; c++) {
        const w = from.cols.get(src.rect.c1 + c);
        if (w === undefined) cols.delete(c0 + c);
        else cols.set(c0 + c, w);
      }
      return { ...s, cols };
    });
  }
  let styles = book.styles;
  const noBorder = (s: number | undefined) => {
    if (!s) return s;
    const st = { ...(styles[s] ?? {}) };
    delete st.borderTop;
    delete st.borderBottom;
    delete st.borderLeft;
    delete st.borderRight;
    const [n, idx] = internStyle(styles, st);
    styles = n;
    return idx || undefined;
  };
  const constant = (v: Scalar): Pick<SCell, "v" | "e"> => (isError(v) ? { e: v.error } : v === null ? {} : { v });
  const updates: { r: number; c: number; cell: SCell | null }[] = [];
  const rows = mode === "transpose" ? block.cols : block.rows;
  const cols = mode === "transpose" ? block.rows : block.cols;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const [sr, sc] = mode === "transpose" ? [j, i] : [i, j];
      const cell = at.get(sr * 100000 + sc);
      const r = r0 + i;
      const c = c0 + j;
      const old = dest.cells.get(key(r, c));
      const srcR = src.rect.r1 + sr;
      const srcC = src.rect.c1 + sc;
      let next: SCell | null;
      switch (mode) {
        case "values":
          next = cell ? { ...constant(cell.f ? valueOf(src.sheet, srcR, srcC) : cell.e ? { error: cell.e } : (cell.v ?? null)), s: old?.s } : old?.s ? { s: old.s } : null;
          break;
        case "valuesFormats":
          next = cell ? { ...constant(cell.f ? valueOf(src.sheet, srcR, srcC) : cell.e ? { error: cell.e } : (cell.v ?? null)), s: cell.s } : null;
          break;
        case "formulas":
          next = cell ? (cell.f ? { f: shiftFormula(cell.f, r - srcR, c - srcC), s: old?.s } : { v: cell.v, e: cell.e, s: old?.s }) : old?.s ? { s: old.s } : null;
          break;
        case "formats":
          next = old || cell?.s ? { ...(old ?? {}), s: cell?.s } : null;
          break;
        case "link":
          next = { f: `${src.sheet === si ? "" : `${quoteSheet(book.sheets[src.sheet].name)}!`}${colName(srcC)}${srcR + 1}`, s: old?.s };
          break;
        case "noBorders":
          next = cell ? { ...cell, f: cell.f ? shiftFormula(cell.f, r - srcR, c - srcC) : undefined, s: noBorder(cell.s) } : null;
          break;
        case "transpose":
          next = cell ? { ...cell, f: cell.f ? transposeFormula(cell.f, srcR, srcC, r, c) : undefined } : null;
          break;
      }
      if (next) for (const k of Object.keys(next) as (keyof SCell)[]) if (next[k] === undefined) delete next[k];
      updates.push({ r, c, cell: next && Object.keys(next).length ? next : null });
    }
  return setCells({ ...book, styles }, si, updates);
}

/** A formula moved from (sr, sc) to (dr, dc) with its relative references
 *  transposed (rows become columns), as Excel's "Transponieren" does. */
export function transposeFormula(f: string, sr: number, sc: number, dr: number, dc: number): string {
  return mapTokens(f, (t) => {
    if (t.t !== "ref" || t.wholeCol || t.wholeRow) return t;
    if (t.ar || t.ac) return { ...t, r: t.ar ? t.r : t.r + dr - sr, c: t.ac ? t.c : t.c + dc - sc };
    return { ...t, r: dr + (t.c - sc), c: dc + (t.r - sr) };
  });
}

// --------------------------------------------------------- go to special --

export type SpecialKind = "formulas" | "constants" | "blanks" | "notes" | "errors" | "conditional" | "validation" | "lastCell";

/** Cells of a kind (Inhalte auswählen) in the used range. */
export function specialCells(sheet: SheetState, values: Map<number, Scalar> | undefined, kind: SpecialKind): { r: number; c: number }[] {
  const used = usedRange(sheet);
  if (!used) return [];
  if (kind === "lastCell") return [{ r: used.r2, c: used.c2 }];
  if (kind === "notes") return sheet.notes.map((n) => ({ r: n.r, c: n.c }));
  const inRects = (rects: Rect[]) => {
    const out: { r: number; c: number }[] = [];
    for (const x of rects) for (let r = x.r1; r <= Math.min(x.r2, used.r2); r++) for (let c = x.c1; c <= Math.min(x.c2, used.c2); c++) out.push({ r, c });
    return out;
  };
  if (kind === "conditional") return inRects(sheet.condFormats.flatMap((f) => f.ranges));
  if (kind === "validation") return inRects(sheet.validations.flatMap((v) => v.ranges));
  const out: { r: number; c: number }[] = [];
  if (kind === "blanks") {
    for (let r = used.r1; r <= used.r2; r++)
      for (let c = used.c1; c <= used.c2; c++) {
        const cell = sheet.cells.get(key(r, c));
        if (!cell || (cell.v === undefined && !cell.f && !cell.e) || cell.v === "") out.push({ r, c });
      }
    return out;
  }
  for (const [k, cell] of sheet.cells) {
    const { r, c } = unkey(k);
    const v = cell.f ? (values?.get(k) ?? null) : cell.e ? { error: cell.e } : (cell.v ?? null);
    if (kind === "formulas" ? !!cell.f : kind === "constants" ? !cell.f && (cell.v !== undefined || !!cell.e) : isError(v)) out.push({ r, c });
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** Cells joined into few rectangles: runs per row, merged with equal runs below. */
export function cellsToRanges(cells: { r: number; c: number }[]): Rect[] {
  const sorted = [...cells].sort((a, b) => a.r - b.r || a.c - b.c);
  const runs: Rect[] = [];
  for (const x of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.r1 === x.r && last.c2 === x.c - 1) last.c2 = x.c;
    else runs.push({ r1: x.r, r2: x.r, c1: x.c, c2: x.c });
  }
  const out: Rect[] = [];
  for (const run of runs) {
    const above = out.find((o) => o.r2 === run.r1 - 1 && o.c1 === run.c1 && o.c2 === run.c2);
    if (above) above.r2 = run.r2;
    else out.push({ ...run });
  }
  return out;
}

// ------------------------------------------------------------- multi sort --

export interface SortKey {
  col: number;
  asc: boolean;
}

/** Benutzerdefiniertes Sortieren: several keys, one stable sort. */
export function sortByKeys(book: Book, si: number, rect: Rect, keys: SortKey[], hasHeader: boolean, values: CalcResult): Book {
  const s = book.sheets[si];
  const start = hasHeader ? rect.r1 + 1 : rect.r1;
  const val = (r: number, c: number): Scalar => {
    const cell = s.cells.get(key(r, c));
    return cell?.f ? (values[si]?.get(key(r, c)) ?? null) : (cell?.v ?? null);
  };
  const rows: { cells: (SCell | undefined)[]; keys: Scalar[] }[] = [];
  for (let r = start; r <= rect.r2; r++) {
    const cells: (SCell | undefined)[] = [];
    for (let c = rect.c1; c <= rect.c2; c++) cells.push(s.cells.get(key(r, c)));
    rows.push({ cells, keys: keys.map((k) => val(r, k.col)) });
  }
  const rank = (v: Scalar) => (v === null || v === "" ? 3 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  rows.sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const x = a.keys[i];
      const y = b.keys[i];
      const ra = rank(x);
      const rb = rank(y);
      if (ra === 3 || rb === 3) {
        if (ra !== rb) return ra - rb;
        continue;
      }
      if (ra !== rb) return (ra - rb) * (keys[i].asc ? 1 : -1);
      const cmp = typeof x === "string" ? x.localeCompare(y as string, undefined, { sensitivity: "base", numeric: true }) : typeof x === "number" ? x - (y as number) : Number(x) - Number(y);
      if (cmp) return keys[i].asc ? cmp : -cmp;
    }
    return 0;
  });
  const updates: { r: number; c: number; cell: SCell | null }[] = [];
  rows.forEach((row, i) => row.cells.forEach((cell, j) => updates.push({ r: start + i, c: rect.c1 + j, cell: cell ?? null })));
  return setCells(book, si, updates);
}

// --------------------------------------------------------------- subtotal --

/** SUBTOTAL function numbers of the Teilergebnis dialog. */
export const SUBTOTAL_FNS: [number, string][] = [
  [9, tl("Summe")],
  [3, tl("Anzahl")],
  [1, tl("Mittelwert")],
  [4, tl("Maximum")],
  [5, tl("Minimum")],
  [6, tl("Produkt")],
  [2, tl("Anzahl Zahlen")],
  [7, tl("Standardabweichung (Stichprobe)")],
  [8, tl("Standardabweichung (Grundgesamtheit)")],
  [10, tl("Varianz (Stichprobe)")],
  [11, tl("Varianz (Grundgesamtheit)")],
];

const displayKey = (v: Scalar) => (v === null ? "" : isError(v) ? v.error : String(v));

/** Teilergebnis: a SUBTOTAL row after each group of `groupCol` and a grand
 *  total; rows get outline levels (details 2, subtotals 1). */
export function addSubtotals(book: Book, si: number, rect: Rect, groupCol: number, fn: number, cols: number[], valueOf: (r: number, c: number) => Scalar): { book: Book; rect: Rect } {
  const groups: { start: number; end: number; label: string }[] = [];
  for (let r = rect.r1 + 1; r <= rect.r2; r++) {
    const label = displayKey(valueOf(r, groupCol));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.end = r;
    else groups.push({ start: r, end: r, label });
  }
  let b = book;
  const ref = (c: number, r1: number, r2: number) => `SUBTOTAL(${fn},${colName(c)}${r1 + 1}:${colName(c)}${r2 + 1})`;
  // Bottom-up, so earlier rows keep their positions.
  for (let g = groups.length - 1; g >= 0; g--) {
    const { start, end, label } = groups[g];
    b = shiftAxis(b, si, "row", end + 1, 1);
    b = setCells(b, si, [{ r: end + 1, c: groupCol, cell: { v: tl("{0} Ergebnis", label) } }, ...cols.map((c) => ({ r: end + 1, c, cell: { f: ref(c, start, end) } as SCell }))]);
  }
  const last = rect.r2 + groups.length;
  b = shiftAxis(b, si, "row", last + 1, 1);
  b = setCells(b, si, [{ r: last + 1, c: groupCol, cell: { v: tl("Gesamtergebnis") } }, ...cols.map((c) => ({ r: last + 1, c, cell: { f: ref(c, rect.r1 + 1, last) } as SCell }))]);
  // Outline: details level 2, group subtotals level 1.
  b = withSheet(b, si, (s) => {
    const rowLevels = new Map(s.rowLevels);
    let r = rect.r1 + 1;
    for (const g of groups) {
      for (let i = g.start; i <= g.end; i++) rowLevels.set(r++, 2);
      rowLevels.set(r++, 1);
    }
    return { ...s, rowLevels };
  });
  return { book: b, rect: { ...rect, r2: last + 1 } };
}

/** Removes subtotal rows (rows with a SUBTOTAL formula) of a list. */
export function removeSubtotals(book: Book, si: number, rect: Rect): Book {
  let b = book;
  for (let r = rect.r2; r > rect.r1; r--) {
    const s = b.sheets[si];
    let sub = false;
    for (let c = rect.c1; c <= rect.c2 && !sub; c++) sub = /^SUBTOTAL\(/i.test(s.cells.get(key(r, c))?.f ?? "");
    if (sub) b = shiftAxis(b, si, "row", r, -1);
  }
  return withSheet(b, si, (s) => {
    const rowLevels = new Map(s.rowLevels);
    for (let r = rect.r1; r <= rect.r2; r++) rowLevels.delete(r);
    return { ...s, rowLevels, hiddenRows: new Set([...s.hiddenRows].filter((r) => r < rect.r1 || r > rect.r2)) };
  });
}

// --------------------------------------------------------- advanced filter --

/** Does a value match a criteria cell (">5", "<>x", "=x", "abc*", "abc")? */
export function matchCriterion(v: Scalar, crit: Scalar): boolean {
  if (crit === null || crit === "") return true;
  if (typeof crit !== "string") return v === crit || (typeof v === "string" && v === String(crit));
  const m = crit.match(/^(<=|>=|<>|=|<|>)(.*)$/);
  const op = m ? m[1] : "";
  const raw = m ? m[2] : crit;
  const num = raw.trim() !== "" && !Number.isNaN(Number(raw.replace(",", "."))) ? Number(raw.replace(",", ".")) : null;
  const text = v === null ? "" : isError(v) ? v.error : String(v);
  const wild = (pattern: string, exact: boolean) =>
    new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}${exact ? "$" : ""}`,
      "i",
    ).test(text);
  if (num !== null && typeof v === "number") {
    switch (op) {
      case "<":
        return v < num;
      case ">":
        return v > num;
      case "<=":
        return v <= num;
      case ">=":
        return v >= num;
      case "<>":
        return v !== num;
      default:
        return v === num;
    }
  }
  switch (op) {
    case "=":
      return wild(raw, true);
    case "<>":
      return !wild(raw, true);
    case "<":
      return text.localeCompare(raw, undefined, { sensitivity: "base" }) < 0;
    case ">":
      return text.localeCompare(raw, undefined, { sensitivity: "base" }) > 0;
    case "<=":
      return text.localeCompare(raw, undefined, { sensitivity: "base" }) <= 0;
    case ">=":
      return text.localeCompare(raw, undefined, { sensitivity: "base" }) >= 0;
    default:
      // Plain text: "begins with", as in Excel.
      return wild(raw, false);
  }
}

/** Rows of `list` (without its header) that match the criteria range: one
 *  criteria row is AND, several rows are OR. */
export function advancedMatches(list: Rect, criteria: Rect, valueOf: (r: number, c: number) => Scalar, unique: boolean): number[] {
  const head = (c: number) => displayKey(valueOf(list.r1, c)).trim().toLowerCase();
  const colOf = new Map<string, number>();
  for (let c = list.c1; c <= list.c2; c++) colOf.set(head(c), c);
  const conds: { col: number; crit: Scalar }[][] = [];
  for (let r = criteria.r1 + 1; r <= criteria.r2; r++) {
    const row: { col: number; crit: Scalar }[] = [];
    for (let c = criteria.c1; c <= criteria.c2; c++) {
      const col = colOf.get(displayKey(valueOf(criteria.r1, c)).trim().toLowerCase());
      const crit = valueOf(r, c);
      if (col !== undefined && crit !== null && crit !== "") row.push({ col, crit });
    }
    conds.push(row);
  }
  const seen = new Set<string>();
  const out: number[] = [];
  for (let r = list.r1 + 1; r <= list.r2; r++) {
    const ok = !conds.length || conds.some((row) => row.every((x) => matchCriterion(valueOf(r, x.col), x.crit)));
    if (!ok) continue;
    if (unique) {
      const sig = Array.from({ length: list.c2 - list.c1 + 1 }, (_, i) => displayKey(valueOf(r, list.c1 + i))).join("\u0001");
      if (seen.has(sig)) continue;
      seen.add(sig);
    }
    out.push(r);
  }
  return out;
}

// ------------------------------------------------------- names, forecast --

/** Names from the labels of a selection (Aus Auswahl erstellen). */
export function namesFromSelection(sheetName: string, rect: Rect, where: { top: boolean; left: boolean; bottom: boolean; right: boolean }, valueOf: (r: number, c: number) => Scalar): { name: string; formula: string }[] {
  const out: { name: string; formula: string }[] = [];
  const sheet = quoteSheet(sheetName);
  const clean = (v: Scalar) => {
    let n = displayKey(v)
      .trim()
      .replace(/[^\p{L}\p{N}_.]+/gu, "_");
    if (!n) return null;
    if (!/^[\p{L}_]/u.test(n)) n = `_${n}`;
    if (/^[A-Za-z]{1,3}\d+$/.test(n) || /^[rRcC]$/.test(n)) n = `${n}_`;
    return n;
  };
  const abs = (r1: number, c1: number, r2: number, c2: number) => `${sheet}!$${colName(c1)}$${r1 + 1}:$${colName(c2)}$${r2 + 1}`;
  const r1 = rect.r1 + (where.top ? 1 : 0);
  const r2 = rect.r2 - (where.bottom ? 1 : 0);
  const c1 = rect.c1 + (where.left ? 1 : 0);
  const c2 = rect.c2 - (where.right ? 1 : 0);
  if (r1 > r2 || c1 > c2) return out;
  if (where.top) for (let c = c1; c <= c2; c++) ((n) => n && out.push({ name: n, formula: abs(r1, c, r2, c) }))(clean(valueOf(rect.r1, c)));
  if (where.bottom) for (let c = c1; c <= c2; c++) ((n) => n && out.push({ name: n, formula: abs(r1, c, r2, c) }))(clean(valueOf(rect.r2, c)));
  if (where.left) for (let r = r1; r <= r2; r++) ((n) => n && out.push({ name: n, formula: abs(r, c1, r, c2) }))(clean(valueOf(r, rect.c1)));
  if (where.right) for (let r = r1; r <= r2; r++) ((n) => n && out.push({ name: n, formula: abs(r, c1, r, c2) }))(clean(valueOf(r, rect.c2)));
  return out;
}

/** Prognoseblatt: a new sheet with the history and FORECAST.ETS values and
 *  confidence bounds for `horizon` further steps. `rect` holds a timeline
 *  column and a value column (with a header row). */
export function forecastSheet(book: Book, si: number, rect: Rect, horizon: number, valueOf: (r: number, c: number) => Scalar): { book: Book; sheet: number; rows: number } | null {
  if (rect.c2 - rect.c1 < 1 || rect.r2 - rect.r1 < 3) return null;
  const tc = rect.c1;
  const vc = rect.c1 + 1;
  const hasHeader = typeof valueOf(rect.r1, vc) === "string";
  const first = hasHeader ? rect.r1 + 1 : rect.r1;
  const times: number[] = [];
  const vals: Scalar[] = [];
  for (let r = first; r <= rect.r2; r++) {
    const t = valueOf(r, tc);
    if (typeof t !== "number") return null;
    times.push(t);
    vals.push(valueOf(r, vc));
  }
  const step = times[times.length - 1] - times[times.length - 2];
  if (!(step > 0)) return null;
  let n = 1;
  while (book.sheets.some((s) => s.name.toLowerCase() === `prognose${n}`)) n++;
  const name = `Prognose${n}`;
  const src = book.sheets[si];
  const timeStyle = src.cells.get(key(first, tc))?.s;
  const header = [hasHeader ? displayKey(valueOf(rect.r1, tc)) : tl("Zeitachse"), hasHeader ? displayKey(valueOf(rect.r1, vc)) : tl("Werte"), tl("Prognose"), tl("Untere Konfidenzgrenze"), tl("Obere Konfidenzgrenze")];
  const cells = new Map<number, SCell>();
  header.forEach((h, c) => cells.set(key(0, c), { v: h }));
  const h = times.length;
  times.forEach((t, i) => {
    cells.set(key(i + 1, 0), { v: t, s: timeStyle });
    const v = vals[i];
    if (v !== null && !isError(v)) cells.set(key(i + 1, 1), { v });
  });
  const hist = `$B$2:$B$${h + 1}`;
  const line = `$A$2:$A$${h + 1}`;
  // The last actual value starts the forecast lines.
  cells.set(key(h, 2), { f: `B${h + 1}` });
  cells.set(key(h, 3), { f: `B${h + 1}` });
  cells.set(key(h, 4), { f: `B${h + 1}` });
  for (let i = 1; i <= horizon; i++) {
    const r = h + i;
    cells.set(key(r, 0), { f: `A${r}+${step}`, s: timeStyle });
    cells.set(key(r, 2), { f: `FORECAST.ETS(A${r + 1},${hist},${line})` });
    cells.set(key(r, 3), { f: `C${r + 1}-FORECAST.ETS.CONFINT(A${r + 1},${hist},${line})` });
    cells.set(key(r, 4), { f: `C${r + 1}+FORECAST.ETS.CONFINT(A${r + 1},${hist},${line})` });
  }
  const sheet: SheetState = {
    ...emptySheetLike(src),
    name,
    cells,
    cols: new Map([
      [0, 110],
      [1, 100],
      [2, 100],
      [3, 170],
      [4, 170],
    ]),
  };
  const sheets = [...book.sheets];
  sheets.splice(si, 0, sheet);
  return { book: { ...book, sheets, active: si }, sheet: si, rows: h + horizon + 1 };
}

function emptySheetLike(s: SheetState): SheetState {
  return {
    ...s,
    cells: new Map(),
    cols: new Map(),
    rows: new Map(),
    hiddenCols: new Set(),
    hiddenRows: new Set(),
    merges: [],
    freezeRows: 1,
    freezeCols: 0,
    showGrid: true,
    autoFilter: undefined,
    condFormats: [],
    objects: [],
    validations: [],
    sparklines: [],
    tables: [],
    scenarios: [],
    notes: [],
    links: [],
    protection: undefined,
    hidden: false,
    tabColor: undefined,
    rowLevels: new Map(),
    colLevels: new Map(),
    page: undefined,
    threads: [],
    views: [],
    checkboxes: [],
  };
}

/** Arbeitsmappenstatistik. */
export function workbookStats(book: Book, si: number): [string, number][] {
  const s = book.sheets[si];
  const used = usedRange(s);
  const count = (f: (x: SheetState) => number) => book.sheets.reduce((n, x) => n + f(x), 0);
  const formulas = (x: SheetState) => [...x.cells.values()].filter((c) => c.f).length;
  return [
    [tl("Aktuelles Blatt: Ende der Zelle"), used ? (used.r2 + 1) * 1000 + used.c2 + 1 : 0],
    [tl("Aktuelles Blatt: Zellen mit Daten"), [...s.cells.values()].filter((c) => c.v !== undefined || c.f || c.e).length],
    [tl("Aktuelles Blatt: Tabellen"), s.tables.length],
    [tl("Aktuelles Blatt: Formeln"), formulas(s)],
    [tl("Aktuelles Blatt: Diagramme"), s.objects.filter((o) => o.chart).length],
    [tl("Aktuelles Blatt: Bilder und Formen"), s.objects.filter((o) => !o.chart).length],
    [tl("Aktuelles Blatt: Notizen"), s.notes.length],
    [tl("Aktuelles Blatt: Kommentare"), s.threads?.length ?? 0],
    [tl("Arbeitsmappe: Blätter"), book.sheets.length],
    [tl("Arbeitsmappe: Zellen mit Daten"), count((x) => [...x.cells.values()].filter((c) => c.v !== undefined || c.f || c.e).length)],
    [tl("Arbeitsmappe: Formeln"), count(formulas)],
    [tl("Arbeitsmappe: Tabellen"), count((x) => x.tables.length)],
    [tl("Arbeitsmappe: Diagramme"), count((x) => x.objects.filter((o) => o.chart).length)],
    [tl("Arbeitsmappe: Namen"), book.names.length],
    [tl("Arbeitsmappe: Datenabfragen"), book.queries?.length ?? 0],
  ];
}

// ---------------------------------------------------------------- dialogs --

function Shell({ open, title, onClose, onOk, okLabel, children, width = 460 }: { open: boolean; title: string; onClose: () => void; onOk?: () => void; okLabel?: string; children: React.ReactNode; width?: number }) {
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</DialogContent>
          <DialogActions>
            {onOk && (
              <Button appearance="primary" onClick={onOk}>
                {okLabel ?? tl("OK")}
              </Button>
            )}
            <Button onClick={onClose}>{onOk ? tl("Abbrechen") : tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Benutzerdefiniertes Sortieren. `headers` are labels of the columns. */
export function CustomSortDialog({ open, headers, firstCol, onClose, onApply }: { open: boolean; headers: string[]; firstCol: number; onClose: () => void; onApply: (keys: SortKey[], hasHeader: boolean) => void }) {
  const [hasHeader, setHasHeader] = useState(true);
  const [keys, setKeys] = useState<SortKey[]>([{ col: firstCol, asc: true }]);
  useEffect(() => {
    if (open) setKeys([{ col: firstCol, asc: true }]);
  }, [open, firstCol]);
  const label = (c: number) => (hasHeader && headers[c - firstCol] ? headers[c - firstCol] : tl("Spalte {0}", colName(c)));
  return (
    <Shell open={open} title={tl("Sortieren")} onClose={onClose} onOk={() => (onApply(keys, hasHeader), onClose())} width={560}>
      <Checkbox checked={hasHeader} label={tl("Daten haben Überschriften")} onChange={(_, d) => setHasHeader(!!d.checked)} />
      {keys.map((k, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Text style={{ width: 90 }}>{i === 0 ? tl("Sortieren nach") : tl("Dann nach")}</Text>
          <Dropdown style={{ minWidth: 180 }} value={label(k.col)} selectedOptions={[String(k.col)]} onOptionSelect={(_, d) => setKeys((x) => x.map((y, j) => (j === i ? { ...y, col: Number(d.optionValue) } : y)))}>
            {headers.map((_, j) => (
              <Option key={j} value={String(firstCol + j)}>
                {label(firstCol + j)}
              </Option>
            ))}
          </Dropdown>
          <Dropdown style={{ minWidth: 150 }} value={k.asc ? tl("A bis Z") : tl("Z bis A")} selectedOptions={[k.asc ? "a" : "d"]} onOptionSelect={(_, d) => setKeys((x) => x.map((y, j) => (j === i ? { ...y, asc: d.optionValue === "a" } : y)))}>
            <Option value="a">{tl("A bis Z")}</Option>
            <Option value="d">{tl("Z bis A")}</Option>
          </Dropdown>
          {keys.length > 1 && <Button appearance="subtle" icon={<Delete16Regular />} aria-label={tl("Ebene löschen")} onClick={() => setKeys((x) => x.filter((_, j) => j !== i))} />}
        </div>
      ))}
      <div>
        <Button size="small" disabled={keys.length >= 8} onClick={() => setKeys((x) => [...x, { col: firstCol, asc: true }])}>
          {tl("Ebene hinzufügen")}
        </Button>
      </div>
    </Shell>
  );
}

/** Teilergebnis. */
export function SubtotalDialog({ open, headers, firstCol, onClose, onApply, onRemove }: { open: boolean; headers: string[]; firstCol: number; onClose: () => void; onApply: (o: { groupCol: number; fn: number; cols: number[]; replace: boolean }) => void; onRemove: () => void }) {
  const [groupCol, setGroupCol] = useState(firstCol);
  const [fn, setFn] = useState(9);
  const [cols, setCols] = useState<number[]>([]);
  const [replace, setReplace] = useState(true);
  useEffect(() => {
    if (open) (setGroupCol(firstCol), setCols(headers.length > 1 ? [firstCol + headers.length - 1] : []));
  }, [open, firstCol, headers.length]);
  const label = (c: number) => headers[c - firstCol] || tl("Spalte {0}", colName(c));
  return (
    <Shell open={open} title={tl("Teilergebnis")} onClose={onClose} onOk={() => (onApply({ groupCol, fn, cols, replace }), onClose())}>
      <Field label={tl("Gruppieren nach")}>
        <Dropdown value={label(groupCol)} selectedOptions={[String(groupCol)]} onOptionSelect={(_, d) => setGroupCol(Number(d.optionValue))}>
          {headers.map((_, j) => (
            <Option key={j} value={String(firstCol + j)}>
              {label(firstCol + j)}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <Field label={tl("Unter Verwendung von")}>
        <Dropdown value={SUBTOTAL_FNS.find((x) => x[0] === fn)?.[1]} selectedOptions={[String(fn)]} onOptionSelect={(_, d) => setFn(Number(d.optionValue))}>
          {SUBTOTAL_FNS.map(([n, l]) => (
            <Option key={n} value={String(n)}>
              {l}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Text weight="semibold">{tl("Teilergebnis addieren zu")}</Text>
        <div style={{ maxHeight: 160, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {headers.map((_, j) => (
            <Checkbox key={j} label={label(firstCol + j)} checked={cols.includes(firstCol + j)} onChange={(_, d) => setCols((x) => (d.checked ? [...x, firstCol + j] : x.filter((y) => y !== firstCol + j)))} />
          ))}
        </div>
      </div>
      <Checkbox checked={replace} label={tl("Vorhandene Teilergebnisse ersetzen")} onChange={(_, d) => setReplace(!!d.checked)} />
      <div>
        <Button size="small" onClick={() => (onRemove(), onClose())}>
          {tl("Alle entfernen")}
        </Button>
      </div>
    </Shell>
  );
}

/** Spezialfilter (Erweitert). */
export function AdvancedFilterDialog({ open, list, onClose, onApply }: { open: boolean; list: string; onClose: () => void; onApply: (o: { list: Rect; criteria: Rect; copyTo: { r: number; c: number } | null; unique: boolean }) => void }) {
  const [listRef, setListRef] = useState(list);
  const [crit, setCrit] = useState("");
  const [copy, setCopy] = useState(false);
  const [dest, setDest] = useState("");
  const [unique, setUnique] = useState(false);
  useEffect(() => {
    if (open) setListRef(list);
  }, [open, list]);
  const l = parseRange(listRef.replace(/\$/g, ""));
  const cr = parseRange(crit.replace(/\$/g, ""));
  const d = copy ? parseRange(dest.replace(/\$/g, "")) : null;
  return (
    <Shell open={open} title={tl("Spezialfilter")} onClose={onClose} onOk={l && cr && (!copy || d) ? () => (onApply({ list: l, criteria: cr, copyTo: d ? { r: d.r1, c: d.c1 } : null, unique }), onClose()) : undefined}>
      <RadioGroup value={copy ? "copy" : "here"} onChange={(_, x) => setCopy(x.value === "copy")}>
        <Radio value="here" label={tl("Liste an gleicher Stelle filtern")} />
        <Radio value="copy" label={tl("An eine andere Stelle kopieren")} />
      </RadioGroup>
      <Field label={tl("Listenbereich")}>
        <Input value={listRef} onChange={(_, x) => setListRef(x.value)} placeholder="A1:D20" />
      </Field>
      <Field label={tl("Kriterienbereich")} hint={tl("Überschriften wie in der Liste, darunter Bedingungen wie >100 oder Text*. Eine Zeile = UND, mehrere Zeilen = ODER.")}>
        <Input value={crit} onChange={(_, x) => setCrit(x.value)} placeholder="F1:G2" />
      </Field>
      {copy && (
        <Field label={tl("Kopieren nach")}>
          <Input value={dest} onChange={(_, x) => setDest(x.value)} placeholder="I1" />
        </Field>
      )}
      <Checkbox checked={unique} label={tl("Keine Duplikate")} onChange={(_, x) => setUnique(!!x.checked)} />
    </Shell>
  );
}

/** Gehe zu / Inhalte auswählen. */
export function GoToDialog({ open, names, onClose, onGo, onSpecial }: { open: boolean; names: string[]; onClose: () => void; onGo: (ref: string) => void; onSpecial: (k: SpecialKind) => void }) {
  const [ref, setRef] = useState("");
  const [special, setSpecial] = useState<SpecialKind | "">("");
  const KINDS: [SpecialKind, string][] = [
    ["notes", tl("Notizen")],
    ["constants", tl("Konstanten")],
    ["formulas", tl("Formeln")],
    ["errors", tl("Fehler")],
    ["blanks", tl("Leerzellen")],
    ["lastCell", tl("Letzte Zelle")],
    ["conditional", tl("Bedingte Formate")],
    ["validation", tl("Datenüberprüfung")],
  ];
  return (
    <Shell
      open={open}
      title={tl("Gehe zu")}
      onClose={onClose}
      onOk={() => {
        if (special) onSpecial(special);
        else if (ref.trim()) onGo(ref.trim());
        onClose();
      }}
    >
      {names.length > 0 && (
        <div style={{ maxHeight: 140, overflow: "auto", border: "1px solid #ddd", borderRadius: 4 }}>
          {names.map((n) => (
            <div key={n} style={{ padding: "2px 8px", cursor: "pointer", background: ref === n ? "#e5f1fb" : undefined }} onClick={() => (setRef(n), setSpecial(""))} onDoubleClick={() => (onGo(n), onClose())}>
              {n}
            </div>
          ))}
        </div>
      )}
      <Field label={tl("Verweis")}>
        <Input value={ref} onChange={(_, d) => (setRef(d.value), setSpecial(""))} placeholder="B12" />
      </Field>
      <Field label={tl("Inhalte auswählen")}>
        <RadioGroup value={special} onChange={(_, d) => setSpecial(d.value as SpecialKind)} layout="horizontal" style={{ flexWrap: "wrap" }}>
          {KINDS.map(([k, l]) => (
            <Radio key={k} value={k} label={l} />
          ))}
        </RadioGroup>
      </Field>
    </Shell>
  );
}

/** Verschieben oder kopieren (Blatt). */
export function MoveCopyDialog({ open, sheets, current, onClose, onApply }: { open: boolean; sheets: string[]; current: number; onClose: () => void; onApply: (before: number, copy: boolean) => void }) {
  const [before, setBefore] = useState(current);
  const [copy, setCopy] = useState(false);
  useEffect(() => {
    if (open) (setBefore(current), setCopy(false));
  }, [open, current]);
  return (
    <Shell open={open} title={tl("Verschieben oder kopieren")} onClose={onClose} onOk={() => (onApply(before, copy), onClose())}>
      <Text>{tl("Einfügen vor:")}</Text>
      <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid #ddd", borderRadius: 4 }}>
        {[...sheets, tl("(ans Ende stellen)")].map((n, i) => (
          <div key={i} style={{ padding: "2px 8px", cursor: "pointer", background: before === i ? "#e5f1fb" : undefined }} onClick={() => setBefore(i)}>
            {n}
          </div>
        ))}
      </div>
      <Checkbox checked={copy} label={tl("Kopie erstellen")} onChange={(_, d) => setCopy(!!d.checked)} />
    </Shell>
  );
}

export interface SeriesOptions {
  byRows: boolean;
  type: "linear" | "growth" | "date";
  dateUnit: "day" | "weekday" | "month" | "year";
  step: number;
  stop: number | null;
}

/** Reihe (Ausfüllen > Reihe). */
export function SeriesDialog({ open, byRows, onClose, onApply }: { open: boolean; byRows: boolean; onClose: () => void; onApply: (o: SeriesOptions) => void }) {
  const [o, setO] = useState<SeriesOptions>({ byRows, type: "linear", dateUnit: "day", step: 1, stop: null });
  const [step, setStep] = useState("1");
  const [stop, setStop] = useState("");
  useEffect(() => {
    if (open) setO((x) => ({ ...x, byRows }));
  }, [open, byRows]);
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  return (
    <Shell open={open} title={tl("Reihe")} onClose={onClose} onOk={() => (onApply({ ...o, step: num(step) ?? 1, stop: num(stop) }), onClose())}>
      <div style={{ display: "flex", gap: 24 }}>
        <Field label={tl("Reihe in")}>
          <RadioGroup value={o.byRows ? "rows" : "cols"} onChange={(_, d) => setO({ ...o, byRows: d.value === "rows" })}>
            <Radio value="rows" label={tl("Zeilen")} />
            <Radio value="cols" label={tl("Spalten")} />
          </RadioGroup>
        </Field>
        <Field label={tl("Typ")}>
          <RadioGroup value={o.type} onChange={(_, d) => setO({ ...o, type: d.value as SeriesOptions["type"] })}>
            <Radio value="linear" label={tl("Arithmetisch")} />
            <Radio value="growth" label={tl("Geometrisch")} />
            <Radio value="date" label={tl("Datum")} />
          </RadioGroup>
        </Field>
        {o.type === "date" && (
          <Field label={tl("Zeiteinheit")}>
            <RadioGroup value={o.dateUnit} onChange={(_, d) => setO({ ...o, dateUnit: d.value as SeriesOptions["dateUnit"] })}>
              <Radio value="day" label={tl("Tag")} />
              <Radio value="weekday" label={tl("Wochentag")} />
              <Radio value="month" label={tl("Monat")} />
              <Radio value="year" label={tl("Jahr")} />
            </RadioGroup>
          </Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <Field label={tl("Inkrement")}>
          <Input value={step} onChange={(_, d) => setStep(d.value)} />
        </Field>
        <Field label={tl("Endwert")}>
          <Input value={stop} onChange={(_, d) => setStop(d.value)} />
        </Field>
      </div>
    </Shell>
  );
}

/** Values of a series from `start` (Reihe dialog). Dates are serial numbers. */
export function seriesValues(start: number, count: number, o: SeriesOptions): number[] {
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < count; i++) {
    if (o.stop !== null && (o.step >= 0 ? v > o.stop : v < o.stop)) break;
    out.push(v);
    if (o.type === "growth") v *= o.step;
    else if (o.type === "date" && o.dateUnit !== "day") {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      if (o.dateUnit === "month") d.setUTCMonth(d.getUTCMonth() + o.step);
      else if (o.dateUnit === "year") d.setUTCFullYear(d.getUTCFullYear() + o.step);
      else {
        let n = Math.abs(o.step);
        while (n > 0) {
          d.setUTCDate(d.getUTCDate() + Math.sign(o.step || 1));
          if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n--;
        }
      }
      v = Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    } else v += o.step;
  }
  return out;
}

/** Namen aus Auswahl erstellen. */
export function CreateNamesDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (w: { top: boolean; left: boolean; bottom: boolean; right: boolean }) => void }) {
  const [w, setW] = useState({ top: true, left: false, bottom: false, right: false });
  const row = (k: keyof typeof w, l: string) => <Checkbox checked={w[k]} label={l} onChange={(_, d) => setW({ ...w, [k]: !!d.checked })} />;
  return (
    <Shell open={open} title={tl("Namen aus Auswahl erstellen")} onClose={onClose} onOk={() => (onApply(w), onClose())} width={380}>
      <Text>{tl("Namen erstellen aus Werten in:")}</Text>
      {row("top", tl("Oberster Zeile"))}
      {row("left", tl("Linker Spalte"))}
      {row("bottom", tl("Unterster Zeile"))}
      {row("right", tl("Rechter Spalte"))}
    </Shell>
  );
}

/** Arbeitsmappenstatistik. */
export function StatsDialog({ open, stats, onClose }: { open: boolean; stats: [string, number][]; onClose: () => void }) {
  return (
    <Shell open={open} title={tl("Arbeitsmappenstatistik")} onClose={onClose} width={420}>
      <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {stats.map(([l, n], i) => (
            <tr key={i}>
              <td style={{ padding: "3px 12px 3px 0" }}>{l}</td>
              <td style={{ textAlign: "right" }}>{i === 0 && n ? `${colName((n % 1000) - 1)}${Math.floor(n / 1000)}` : n.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

export interface Watch {
  sheet: number;
  r: number;
  c: number;
}

/** Überwachungsfenster: cells whose values stay in view. */
export function WatchPane({
  items,
  sheetName,
  text,
  formula,
  onAdd,
  onRemove,
  onGo,
  onClose,
}: {
  items: Watch[];
  sheetName: (i: number) => string;
  text: (w: Watch) => string;
  formula: (w: Watch) => string;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onGo: (w: Watch) => void;
  onClose: () => void;
}) {
  return (
    <div className="nx-watch">
      <div className="nx-watch-head">
        <Text weight="semibold">{tl("Überwachungsfenster")}</Text>
        <span style={{ flex: 1 }} />
        <Button size="small" onClick={onAdd}>
          {tl("Überwachung hinzufügen")}
        </Button>
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      <table>
        <thead>
          <tr>
            <th>{tl("Blatt")}</th>
            <th>{tl("Zelle")}</th>
            <th>{tl("Wert")}</th>
            <th>{tl("Formel")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((w, i) => (
            <tr key={i} onDoubleClick={() => onGo(w)}>
              <td>{sheetName(w.sheet)}</td>
              <td>{`${colName(w.c)}${w.r + 1}`}</td>
              <td>{text(w)}</td>
              <td>{formula(w)}</td>
              <td>
                <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label={tl("Überwachung löschen")} onClick={() => onRemove(i)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
