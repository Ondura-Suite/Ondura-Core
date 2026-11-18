// Formula auditing (Formelüberwachung): precedents and dependents, error
// checking and step-by-step evaluation ("Formel auswerten").

import { type Scalar, type Token, type Value, evaluate, formatGeneral, isError, parse, tokenize } from "./formula";
import { type Book, type CalcResult, type Rect, evalContext, key, unkey, usedRange } from "./model";

/** A trace arrow: from a cell or range to a formula cell (same sheet). */
export interface Arrow {
  from: Rect;
  to: { r: number; c: number };
  /** The source is on another sheet (drawn as a short arrow with a sheet icon). */
  external?: boolean;
}

/** Ranges referenced by formula `f` (English form) on cell sheet `si`. */
export function formulaRanges(book: Book, si: number, f: string): { rect: Rect; sheet: number }[] {
  let toks: Token[];
  try {
    toks = tokenize(f, "en").filter((t) => t.t !== "ws");
  } catch {
    return [];
  }
  const sheetIndex = (name: string | undefined) => (name === undefined ? si : book.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()));
  const out: { rect: Rect; sheet: number }[] = [];
  const clip = (rect: Rect, sheet: number): Rect => {
    const u = usedRange(book.sheets[sheet]) ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
    return { r1: rect.r1, c1: rect.c1, r2: Math.min(rect.r2, u.r2), c2: Math.min(rect.c2, u.c2) };
  };
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    if (a.t === "ident") {
      // Defined names that point at ranges.
      const n = book.names.find((x) => x.name.toLowerCase() === a.v.toLowerCase() && (x.sheet === undefined || x.sheet === si));
      if (n && toks[i + 1]?.t !== "(") out.push(...formulaRanges(book, n.sheet ?? si, n.formula));
      continue;
    }
    if (a.t !== "ref") continue;
    const sheet = sheetIndex(a.sheet);
    if (sheet < 0) continue;
    const b = toks[i + 1]?.t === ":" ? toks[i + 2] : undefined;
    let rect: Rect = { r1: a.r, c1: a.c, r2: a.r, c2: a.c };
    if (b?.t === "ref") {
      rect = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
      i += 2;
    }
    if (a.wholeCol) rect = { ...rect, r1: 0, r2: 1_048_575 };
    if (a.wholeRow) rect = { ...rect, c1: 0, c2: 16_383 };
    out.push({ rect: a.wholeCol || a.wholeRow ? clip(rect, sheet) : rect, sheet });
  }
  return out;
}

/** Arrows from the precedents of r/c. */
export function precedentArrows(book: Book, si: number, r: number, c: number): Arrow[] {
  const f = book.sheets[si].cells.get(key(r, c))?.f;
  if (!f) return [];
  return formulaRanges(book, si, f).map(({ rect, sheet }) => ({ from: rect, to: { r, c }, external: sheet !== si }));
}

/** Arrows to the formula cells (on this sheet) that use r/c. */
export function dependentArrows(book: Book, si: number, r: number, c: number): Arrow[] {
  const out: Arrow[] = [];
  for (const [k, cell] of book.sheets[si].cells) {
    if (!cell.f) continue;
    const at = unkey(k);
    if (formulaRanges(book, si, cell.f).some(({ rect, sheet }) => sheet === si && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2)) {
      out.push({ from: { r1: r, c1: c, r2: r, c2: c }, to: at });
    }
  }
  // Other sheets that refer to this cell.
  book.sheets.forEach((sh, s2) => {
    if (s2 === si) return;
    for (const cell of sh.cells.values()) {
      if (cell.f && formulaRanges(book, s2, cell.f).some(({ rect, sheet }) => sheet === si && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2)) {
        out.push({ from: { r1: r, c1: c, r2: r, c2: c }, to: { r, c }, external: true });
        return;
      }
    }
  });
  return out;
}

/** Explanation of an error value, for the error check. */
export const ERROR_HELP: Record<string, string> = {
  "#DIV/0!": "Die Formel teilt durch null oder eine leere Zelle.",
  "#N/A": "Ein Wert ist nicht verfügbar, z. B. wurde ein Suchwert nicht gefunden.",
  "#NAME?": "Die Formel enthält unbekannten Text – ein falsch geschriebener Funktions- oder Bereichsname.",
  "#NULL!": "Zwei Bereiche überschneiden sich nicht.",
  "#NUM!": "Die Formel enthält ungültige numerische Werte.",
  "#REF!": "Die Formel bezieht sich auf eine Zelle, die nicht mehr vorhanden ist.",
  "#VALUE!": "Ein Argument hat den falschen Datentyp.",
  "#SPILL!": "Der Überlaufbereich ist nicht leer.",
  "#CALC!": "Bei der Berechnung ist ein Fehler aufgetreten, z. B. ein leeres Array.",
};

/** Next cell (row by row, after r/c, wrapping) whose value is an error. */
export function nextError(book: Book, values: CalcResult, si: number, r: number, c: number): { r: number; c: number; code: string } | null {
  const found: { r: number; c: number; code: string }[] = [];
  const sh = book.sheets[si];
  for (const [k, cell] of sh.cells) {
    const v = cell.f ? values[si]?.get(k) : cell.e ? { error: cell.e } : undefined;
    if (isError(v)) found.push({ ...unkey(k), code: v.error });
  }
  found.sort((a, b) => a.r - b.r || a.c - b.c);
  return found.find((x) => x.r > r || (x.r === r && x.c > c)) ?? found[0] ?? null;
}

// ------------------------------------------------------ evaluate formula --

/** A value as a formula literal (English form). */
function literal(v: Value): string | null {
  if (Array.isArray(v)) {
    if (v.length * (v[0]?.length ?? 0) > 50) return null;
    return `{${v.map((row) => row.map((x) => literal(x) ?? "0").join(",")).join(";")}}`;
  }
  if (v === null) return "0";
  if (typeof v === "number") return formatGeneral(v).replace(",", ".");
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
  if (isError(v) && !("lambda" in v)) return v.error;
  return null;
}

/**
 * One evaluation step of `expr` (English form) for cell si/r/c: the next
 * single-cell reference becomes its value, then the innermost function
 * call or parenthesis is calculated, finally the whole expression.
 * Returns the new expression and whether it is final.
 */
export function evaluateStep(book: Book, values: CalcResult, si: number, r: number, c: number, expr: string): { expr: string; done: boolean } {
  const ctx = evalContext(book, values, si, r, c);
  const calc = (src: string): Value => evaluate(parse(src, "en"), ctx as never);
  const whole = () => {
    let v: Value;
    try {
      v = calc(expr);
    } catch {
      v = { error: "#VALUE!" };
    }
    return { expr: literal(v) ?? "{…}", done: true };
  };
  let toks: Token[];
  const starts: number[] = [];
  try {
    toks = tokenize(expr, "en", starts);
  } catch {
    return whole();
  }
  if (starts.length !== toks.length) return whole();
  // Source text of each token, to rebuild the expression around a replacement.
  const parts = spans(expr, starts, toks);
  // 1. A single cell reference (not part of a range).
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "ref" || t.wholeCol || t.wholeRow) continue;
    const prev = toks.slice(0, i).reverse().find((x) => x.t !== "ws");
    const next = toks.slice(i + 1).find((x) => x.t !== "ws");
    if (prev?.t === ":" || next?.t === ":") continue;
    const v = calcSafe(calc, expr.slice(parts[i][0], parts[i][1]).trim());
    const lit = literal(v);
    if (lit === null) continue;
    return { expr: expr.slice(0, parts[i][0]) + lit + expr.slice(parts[i][1]), done: false };
  }
  // 2. The innermost parenthesis (function call or grouping).
  let open = -1;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === "(") open = i;
    if (toks[i].t === ")" && open >= 0) {
      const fnIdx = open - 1 >= 0 && toks[open - 1].t === "ident" ? open - 1 : open;
      const from = parts[fnIdx][0];
      const to = parts[i][1];
      const sub = expr.slice(from, to);
      if (from === 0 && to === expr.length) return whole();
      const lit = literal(calcSafe(calc, sub));
      if (lit === null) return whole();
      return { expr: expr.slice(0, from) + lit + expr.slice(to), done: false };
    }
  }
  return whole();
}

function calcSafe(calc: (s: string) => Value, src: string): Value {
  try {
    return calc(src);
  } catch {
    return { error: "#VALUE!" } as Scalar;
  }
}

/** Start/end offsets of every token of `src`; a sheet prefix belongs to its reference. */
function spans(src: string, starts: number[], toks: Token[]): [number, number][] {
  const st = starts.map((p, i) => {
    const t = toks[i];
    if (t.t !== "ref" || !t.sheet || src[p - 1] !== "!") return p;
    let j = p - 2;
    if (src[j] === "'") {
      j--;
      while (j >= 0 && !(src[j] === "'" && src[j - 1] !== "'")) j--;
      return Math.max(0, j);
    }
    while (j >= 0 && /[\p{L}\p{N}_.]/u.test(src[j])) j--;
    return j + 1;
  });
  return st.map((p, i) => [p, i + 1 < st.length ? st[i + 1] : src.length]);
}
