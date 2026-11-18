// Macros for Ondura Tabellen: JavaScript scripts with a small workbook API
// (in the spirit of Excel's Office Scripts), and a recorder that writes
// such scripts from cell entries and formatting.
//
// Scripts run on a copy of the workbook; the result is applied as one
// step, so a single "Rückgängig" undoes the whole macro.

import { parseInput } from "./format";
import { type Scalar, colName, fromDisplayFormula, isError, toDisplayFormula } from "./formula";
import { type Book, type CellStyle, type Rect, calculate, key, newSheet, parseRange, rangeName, setCells, styleRange } from "./model";
import { tl, LOCALE } from "../../lib/i18n";

/** Formatting a script can set (subset of CellStyle with friendly names). */
export interface ScriptFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
  numberFormat?: string;
  align?: "left" | "center" | "right";
  fontSize?: number;
  wrap?: boolean;
}

function toStyle(f: ScriptFormat): (s: CellStyle) => CellStyle {
  return (s) => ({
    ...s,
    ...(f.bold !== undefined && { bold: f.bold }),
    ...(f.italic !== undefined && { italic: f.italic }),
    ...(f.underline !== undefined && { underline: f.underline }),
    ...(f.color !== undefined && { color: f.color || undefined }),
    ...(f.fill !== undefined && { fill: f.fill || undefined }),
    ...(f.numberFormat !== undefined && { numFmt: f.numberFormat || undefined }),
    ...(f.align !== undefined && { hAlign: f.align }),
    ...(f.fontSize !== undefined && { size10: Math.round(f.fontSize * 10) }),
    ...(f.wrap !== undefined && { wrap: f.wrap }),
  });
}

/** Changed formatting between two styles, as script options. */
export function formatDiff(before: CellStyle, after: CellStyle): ScriptFormat {
  const d: ScriptFormat = {};
  if (!!before.bold !== !!after.bold) d.bold = !!after.bold;
  if (!!before.italic !== !!after.italic) d.italic = !!after.italic;
  if (!!before.underline !== !!after.underline) d.underline = !!after.underline;
  if (before.color !== after.color) d.color = after.color ?? "";
  if (before.fill !== after.fill) d.fill = after.fill ?? "";
  if (before.numFmt !== after.numFmt) d.numberFormat = after.numFmt ?? "";
  if (before.hAlign !== after.hAlign && after.hAlign) d.align = after.hAlign as ScriptFormat["align"];
  if (before.size10 !== after.size10 && after.size10) d.fontSize = after.size10 / 10;
  if (!!before.wrap !== !!after.wrap) d.wrap = !!after.wrap;
  return d;
}

type Value = number | string | boolean | null;

const plain = (v: Scalar | undefined): Value => (v === undefined || v === null ? null : isError(v) ? v.error : (v as Value));

export interface RunResult {
  book: Book;
  log: string[];
  error?: string;
  /** Selection after the script (if it selected a range). */
  select?: { sheet: number; rect: Rect };
}

/**
 * Run a script. `selection` is the current selection; the script gets
 * `workbook` and `console` as globals.
 */
export function runSheetMacro(code: string, start: Book, selection: Rect): RunResult {
  let book = start;
  let calc: ReturnType<typeof calculate> | null = null;
  const log: string[] = [];
  let select: RunResult["select"];
  const touch = (b: Book) => {
    book = b;
    calc = null;
  };
  const values = () => (calc ??= calculate(book));
  const sheetIndex = (name: string | number) => {
    const i = typeof name === "number" ? name : book.sheets.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
    if (i < 0 || i >= book.sheets.length) throw new Error(tl("Blatt „{0}“ gibt es nicht", name));
    return i;
  };

  const range = (si: number, rect: Rect) => {
    const each = <T,>(f: (r: number, c: number) => T): T[][] =>
      Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, j) => f(rect.r1 + i, rect.c1 + j)));
    const input = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      // Formulas as typed in a cell (German names, ";" between arguments).
      if (typeof v === "string" && v.startsWith("=")) return { f: fromDisplayFormula(v.slice(1)) };
      if (typeof v === "string") {
        const p = parseInput(v);
        return { v: p.v ?? undefined };
      }
      return { v: v as number | boolean };
    };
    const write = (data: unknown[][]) => {
      const updates: { r: number; c: number; cell: { v?: number | string | boolean; f?: string; s?: number } | null }[] = [];
      data.forEach((row, i) =>
        row.forEach((v, j) => {
          const r = rect.r1 + i;
          const c = rect.c1 + j;
          const old = book.sheets[si].cells.get(key(r, c));
          const cell = input(v);
          updates.push({ r, c, cell: cell ? { ...cell, s: old?.s } : old?.s !== undefined ? { s: old.s } : null });
        }),
      );
      touch(setCells(book, si, updates));
    };
    const api = {
      address: `${book.sheets[si].name}!${rangeName(rect)}`,
      rowCount: rect.r2 - rect.r1 + 1,
      columnCount: rect.c2 - rect.c1 + 1,
      /** Calculated values (2D). */
      get values(): Value[][] {
        return each((r, c) => plain(values()[si].get(key(r, c))));
      },
      get value(): Value {
        return plain(values()[si].get(key(rect.r1, rect.c1)));
      },
      /** Formulas with leading "=", or the constant. */
      get formulas(): Value[][] {
        return each((r, c) => {
          const cell = book.sheets[si].cells.get(key(r, c));
          return cell?.f ? `=${toDisplayFormula(cell.f)}` : (cell?.v ?? null);
        });
      },
      setValue(v: unknown) {
        write(each(() => v));
        return api;
      },
      setValues(data: unknown[][]) {
        if (!Array.isArray(data) || !data.every(Array.isArray)) throw new Error(tl("setValues erwartet ein zweidimensionales Array"));
        write(data);
        return api;
      },
      setFormula(f: string) {
        return api.setValue(f.startsWith("=") ? f : `=${f}`);
      },
      setFormat(f: ScriptFormat) {
        touch(styleRange(book, si, rect, toStyle(f)));
        return api;
      },
      clear() {
        write(each(() => null));
        return api;
      },
      select() {
        select = { sheet: si, rect };
        return api;
      },
      /** Single cell at an offset inside the range (0-based). */
      cell(row: number, col: number) {
        return range(si, { r1: rect.r1 + row, c1: rect.c1 + col, r2: rect.r1 + row, c2: rect.c1 + col });
      },
    };
    return api;
  };

  const sheetApi = (si: number) => ({
    get name() {
      return book.sheets[si].name;
    },
    range(address: string) {
      const r = parseRange(address.replace(/\$/g, "").toUpperCase());
      if (!r) throw new Error(tl("Ungültiger Bereich „{0}“", address));
      return range(si, r);
    },
    /** Range from row/column numbers (0-based). */
    cells(row: number, col: number, rows = 1, cols = 1) {
      return range(si, { r1: row, c1: col, r2: row + rows - 1, c2: col + cols - 1 });
    },
    usedRange() {
      let r2 = 0;
      let c2 = 0;
      for (const k of book.sheets[si].cells.keys()) {
        r2 = Math.max(r2, Math.floor(k / 16384));
        c2 = Math.max(c2, k % 16384);
      }
      return range(si, { r1: 0, c1: 0, r2, c2 });
    },
    activate() {
      touch({ ...book, active: si });
    },
  });

  const workbook = {
    get sheets() {
      return book.sheets.map((_, i) => sheetApi(i));
    },
    get activeSheet() {
      return sheetApi(book.active);
    },
    sheet: (name: string | number) => sheetApi(sheetIndex(name)),
    addSheet(name?: string) {
      let n = name ?? tl("Tabelle{0}", book.sheets.length + 1);
      while (book.sheets.some((s) => s.name.toLowerCase() === n.toLowerCase())) n += " (2)";
      touch({ ...book, sheets: [...book.sheets, newSheet(n)] });
      return sheetApi(book.sheets.length - 1);
    },
    get selection() {
      return range(book.active, selection);
    },
    /** Column letter for a 0-based index (0 → "A"). */
    columnName: colName,
  };
  const console = {
    log: (...a: unknown[]) => log.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
  };

  try {
    // User-written code from the macro list; it never comes from opened files.
    const fn = new Function("workbook", "console", `"use strict";\n${code}`);
    fn(workbook, console);
    return { book, log, select };
  } catch (e) {
    return { book: start, log, error: e instanceof Error ? e.message : String(e) };
  }
}

// --------------------------------------------------------------- recorder

/** Script lines from recorded actions. */
export class SheetRecorder {
  lines: string[] = [];
  private sheet: string | null = null;

  private target(sheetName: string) {
    if (sheetName !== this.sheet) {
      this.sheet = sheetName;
      this.lines.push(`sheet = workbook.sheet(${JSON.stringify(sheetName)});`);
    }
  }

  value(sheetName: string, r: number, c: number, text: string) {
    this.target(sheetName);
    // Text is parsed like an entry in the cell ("1.234,50", "12.05.2026", "=SUMME(…)").
    const v = text === "" ? "null" : JSON.stringify(text);
    this.lines.push(`sheet.range("${colName(c)}${r + 1}").setValue(${v});`);
  }

  format(sheetName: string, rect: Rect, diff: ScriptFormat) {
    if (!Object.keys(diff).length) return;
    this.target(sheetName);
    this.lines.push(`sheet.range("${rangeName(rect)}").setFormat(${JSON.stringify(diff)});`);
  }

  script(): string {
    return `// Aufgezeichnet am ${new Date().toLocaleString(LOCALE)}\nlet sheet = workbook.activeSheet;\n${this.lines.join("\n")}\n`;
  }
}

