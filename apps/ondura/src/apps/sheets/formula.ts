// Formula engine of Ondura Tabellen: tokenizer, parser, evaluator and the
// function library. Formulas are stored like in the file format (English
// function names, "," as argument separator, "." as decimal point) and are
// shown and typed in the German form (SUMME, ";", ",").

export type Scalar = number | string | boolean | null | FormulaError;
export interface FormulaError {
  error: string;
}
export type Matrix = Scalar[][];
export type Value = Scalar | Matrix;

export const err = (code: string): FormulaError => ({ error: code });
export const isError = (v: unknown): v is FormulaError => typeof v === "object" && v !== null && !Array.isArray(v) && "error" in v;
const isMatrix = (v: Value): v is Matrix => Array.isArray(v);

export const ERRORS = {
  div0: "#DIV/0!",
  value: "#VALUE!",
  ref: "#REF!",
  name: "#NAME?",
  na: "#N/A",
  num: "#NUM!",
  circ: "#CIRC!",
  spill: "#SPILL!",
  calc: "#CALC!",
};

/** German display names of error values. */
export const ERROR_DE: Record<string, string> = {
  "#DIV/0!": "#DIV/0!",
  "#VALUE!": "#WERT!",
  "#REF!": "#BEZUG!",
  "#NAME?": "#NAME?",
  "#N/A": "#NV",
  "#NUM!": "#ZAHL!",
  "#NULL!": "#NULL!",
  "#CIRC!": "#ZIRKEL!",
  "#SPILL!": "#ÜBERLAUF!",
  "#CALC!": "#KALK!",
};

import { ELEMENTWISE, LIBRARY_CATEGORIES, LIBRARY_DE, registerLibrary, type Helpers } from "./library";
import { LIBRARY2_CATEGORIES, LIBRARY2_DE, LIBRARY2_ELEMENTWISE, registerLibrary2 } from "./library2";
import { type TableInfo, bracketEnd, resolveSpec, specText } from "./tables";
import { LANG, LOCALE, tl } from "../../lib/i18n";

// ------------------------------------------------------------- tokenizer --

export type Token =
  | { t: "num"; v: number; raw: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; sheet?: string; r: number; c: number; ar: boolean; ac: boolean; wholeCol?: boolean; wholeRow?: boolean }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "("; }
  | { t: ")"; }
  | { t: "sep" }
  | { t: ":" }
  | { t: "ws"; v: string }
  /** Array constant {1,2;3,4}. */
  | { t: "arr"; v: Matrix }
  /** Structured reference: Tabelle1[Umsatz], [@Menge] (table "" = own). */
  | { t: "sref"; table: string; spec: string }
  /** Text inserted by mapTokens. */
  | { t: "raw"; v: string };

export type Locale = "en" | "de";

function colIndex(letters: string): number {
  let c = 0;
  for (const ch of letters.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

export function colName(c: number): string {
  let s = "";
  c += 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export function refName(r: number, c: number, ar = false, ac = false) {
  return `${ac ? "$" : ""}${colName(c)}${ar ? "$" : ""}${r + 1}`;
}

const ERROR_RE = /^(#DIV\/0!|#VALUE!|#REF!|#NAME\?|#N\/A|#NUM!|#NULL!|#WERT!|#BEZUG!|#NV|#ZAHL!|#CIRC!|#ZIRKEL!|#SPILL!|#ÜBERLAUF!|#CALC!|#KALK!)/i;

export function tokenize(src: string, locale: Locale = "en", starts?: number[]): Token[] {
  const out: Token[] = [];
  const argSep = locale === "de" ? ";" : ",";
  const dec = locale === "de" ? "," : ".";
  let i = 0;
  let pendingSheet: string | undefined;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (/\s/.test(ch)) {
      const m = rest.match(/^\s+/)![0];
      (starts?.push(i), out).push({ t: "ws", v: m });
      i += m.length;
      continue;
    }
    if (ch === "{") {
      const m = arrayConstant(src, i, locale);
      (starts?.push(i), out).push({ t: "arr", v: m.value });
      i = m.end;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      (starts?.push(i), out).push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const m = rest.match(ERROR_RE);
      if (m) {
        const de = Object.entries(ERROR_DE).find(([, d]) => d === m[1].toUpperCase());
        (starts?.push(i), out).push({ t: "err", v: de ? de[0] : m[1].toUpperCase() });
        i += m[1].length;
        continue;
      }
      // Spill range operator: A1#
      if (out[out.length - 1]?.t === "ref") {
        (starts?.push(i), out).push({ t: "op", v: "#" });
        i++;
        continue;
      }
    }
    // Sheet prefix: 'My Sheet'!A1 or Sheet1!A1
    if (ch === "'") {
      const j = src.indexOf("'!", i + 1);
      if (j > 0) {
        pendingSheet = src.slice(i + 1, j).replace(/''/g, "'");
        i = j + 2;
        continue;
      }
    }
    const sheetM = rest.match(/^([A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*)!/);
    if (sheetM) {
      pendingSheet = sheetM[1];
      i += sheetM[0].length;
      continue;
    }
    // Cell reference (A1, $A$1), whole column (A:A) or whole row (1:1).
    const refM = rest.match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/);
    if (refM) {
      const r = parseInt(refM[4], 10) - 1;
      if (r >= 0) {
        (starts?.push(i), out).push({ t: "ref", sheet: pendingSheet, r, c: colIndex(refM[2]), ac: !!refM[1], ar: !!refM[3] });
        pendingSheet = undefined;
        i += refM[0].length;
        continue;
      }
    }
    const colM = rest.match(/^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(])/);
    if (colM) {
      (starts?.push(i), out).push({ t: "ref", sheet: pendingSheet, r: 0, c: colIndex(colM[2]), ac: !!colM[1], ar: true, wholeCol: true });
      (starts?.push(i), out).push({ t: ":" });
      (starts?.push(i), out).push({ t: "ref", sheet: pendingSheet, r: 1048575, c: colIndex(colM[4]), ac: !!colM[3], ar: true, wholeCol: true });
      pendingSheet = undefined;
      i += colM[0].length;
      continue;
    }
    const rowM = rest.match(/^(\$?)(\d+):(\$?)(\d+)(?![\w(.,])/);
    if (rowM && (out.length === 0 || !["num", "ref"].includes(out[out.length - 1].t))) {
      (starts?.push(i), out).push({ t: "ref", sheet: pendingSheet, r: parseInt(rowM[2], 10) - 1, c: 0, ar: !!rowM[1], ac: true, wholeRow: true });
      (starts?.push(i), out).push({ t: ":" });
      (starts?.push(i), out).push({ t: "ref", sheet: pendingSheet, r: parseInt(rowM[4], 10) - 1, c: 16383, ar: !!rowM[3], ac: true, wholeRow: true });
      pendingSheet = undefined;
      i += rowM[0].length;
      continue;
    }
    const numRe = dec === "," ? /^(\d+(,\d*)?|,\d+)([eE][+-]?\d+)?/ : /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
    const numM = rest.match(numRe);
    if (numM) {
      (starts?.push(i), out).push({ t: "num", v: parseFloat(numM[0].replace(",", ".")), raw: numM[0] });
      i += numM[0].length;
      continue;
    }
    // Structured reference: Table[spec] or [spec] inside a table.
    const srefM = rest.match(/^([A-Za-zÄÖÜäöüß_\\][\wÄÖÜäöüß.]*)?\[/);
    if (srefM && (srefM[1] || !["num", "ref", "str", ")"].includes(out[out.length - 1]?.t ?? ""))) {
      const open = i + (srefM[1]?.length ?? 0);
      const end = bracketEnd(src, open);
      if (end > 0) {
        (starts?.push(i), out).push({ t: "sref", table: srefM[1] ?? "", spec: specText(src.slice(open + 1, end - 1), "en") });
        i = end;
        continue;
      }
    }
    const idM = rest.match(/^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*/);
    if (idM) {
      const up = idM[0].toUpperCase();
      if ((up === "TRUE" || up === "WAHR") && src[i + idM[0].length] !== "(") (starts?.push(i), out).push({ t: "bool", v: true });
      else if ((up === "FALSE" || up === "FALSCH") && src[i + idM[0].length] !== "(") (starts?.push(i), out).push({ t: "bool", v: false });
      else (starts?.push(i), out).push({ t: "ident", v: idM[0] });
      i += idM[0].length;
      continue;
    }
    if (ch === "(") (starts?.push(i), out).push({ t: "(" });
    else if (ch === ")") (starts?.push(i), out).push({ t: ")" });
    else if (ch === argSep) (starts?.push(i), out).push({ t: "sep" });
    else if (ch === ":") (starts?.push(i), out).push({ t: ":" });
    else if (rest.startsWith("<>") || rest.startsWith("<=") || rest.startsWith(">=")) {
      (starts?.push(i), out).push({ t: "op", v: rest.slice(0, 2) });
      i += 2;
      continue;
    } else if ("+-*/^&=<>%".includes(ch)) (starts?.push(i), out).push({ t: "op", v: ch });
    else if (ch === "," || ch === ";") (starts?.push(i), out).push({ t: "sep" });
    else throw new Error(tl("Unerwartetes Zeichen „{0}“", ch));
    i++;
  }
  return out;
}

/** Parses an array constant starting at `{`; columns "," (German "."), rows ";". */
function arrayConstant(src: string, start: number, locale: Locale): { value: Matrix; end: number } {
  const colSep = locale === "de" ? "." : ",";
  const rows: Matrix = [[]];
  let i = start + 1;
  let item = "";
  let quoted: string | null = null;
  const push = () => {
    const t = item.trim();
    item = "";
    let v: Scalar;
    if (quoted !== null) v = quoted;
    else if (/^(TRUE|WAHR)$/i.test(t)) v = true;
    else if (/^(FALSE|FALSCH)$/i.test(t)) v = false;
    else if (ERROR_RE.test(t)) {
      const up = t.toUpperCase();
      const de = Object.entries(ERROR_DE).find(([, d]) => d === up);
      v = err(de ? de[0] : up);
    } else {
      const n = Number(locale === "de" ? t.replace(",", ".") : t);
      if (t === "" || !Number.isFinite(n)) throw new Error(tl("Ungültige Matrixkonstante"));
      v = n;
    }
    quoted = null;
    rows[rows.length - 1].push(v);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) {
        if (src[j] === '"') j++;
        s += src[j++];
      }
      quoted = s;
      i = j + 1;
      continue;
    }
    if (ch === "}") {
      push();
      const w = rows[0].length;
      if (rows.some((r) => r.length !== w)) throw new Error(tl("Ungültige Matrixkonstante"));
      return { value: rows, end: i + 1 };
    }
    if (ch === colSep) push();
    else if (ch === ";") {
      push();
      rows.push([]);
    } else item += ch;
    i++;
  }
  throw new Error(tl("Fehlende Klammer }"));
}

function arrayText(m: Matrix, to: Locale): string {
  const colSep = to === "de" ? "." : ",";
  const item = (v: Scalar) => {
    if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
    if (typeof v === "boolean") return to === "de" ? (v ? "WAHR" : "FALSCH") : v ? "TRUE" : "FALSE";
    if (isError(v)) return to === "de" ? ERROR_DE[v.error] ?? v.error : v.error;
    if (typeof v === "number") return to === "de" ? String(v).replace(".", ",") : String(v);
    return "";
  };
  return "{" + m.map((r) => r.map(item).join(colSep)).join(";") + "}";
}

// ---------------------------------------------------------------- parser --

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: string }
  | { k: "ref"; sheet?: string; r: number; c: number }
  | { k: "range"; sheet?: string; r1: number; c1: number; r2: number; c2: number }
  | { k: "fn"; name: string; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "pct"; a: Node }
  | { k: "name"; v: string }
  | { k: "arr"; v: Matrix }
  | { k: "sref"; table: string; spec: string }
  /** Spill range of a dynamic array formula: `A1#`. */
  | { k: "spill"; sheet?: string; r: number; c: number }
  /** Call of a lambda value: `LAMBDA(x, x*2)(3)`. */
  | { k: "call"; fn: Node; args: Node[] }
  /** Body of a function used as a value (`SUM` as a lambda). */
  | { k: "eta"; fn: string; params: string[] };

export function parse(src: string, locale: Locale = "en"): Node {
  const toks = tokenize(src, locale).filter((t) => t.t !== "ws");
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: string) => {
    const x = next();
    if (!x || x.t !== t) throw new Error(tl("Syntaxfehler in der Formel"));
  };
  const prec: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

  function args(): Node[] {
    // Called after "(".
    const out: Node[] = [];
    if (peek()?.t === ")") {
      p++;
      return out;
    }
    for (;;) {
      // Empty argument, e.g. IF(A1,,1)
      if (peek()?.t === "sep" || peek()?.t === ")") out.push({ k: "str", v: "" });
      else out.push(expr(0));
      const s = next();
      if (!s) throw new Error(tl("Fehlende Klammer"));
      if (s.t === ")") break;
      if (s.t !== "sep") throw new Error(tl("Syntaxfehler in der Formel"));
    }
    return out;
  }

  /** Calls of the value of `n`: `LAMBDA(x, x)(1)(…)`. */
  function calls(n: Node): Node {
    while (peek()?.t === "(") {
      p++;
      n = { k: "call", fn: n, args: args() };
    }
    return n;
  }

  function primary(): Node {
    const t = next();
    if (!t) throw new Error(tl("Unvollständige Formel"));
    switch (t.t) {
      case "num":
        return { k: "num", v: t.v };
      case "str":
        return { k: "str", v: t.v };
      case "bool":
        return { k: "bool", v: t.v };
      case "err":
        return { k: "err", v: t.v };
      case "arr":
        return { k: "arr", v: t.v };
      case "sref":
        return { k: "sref", table: t.table, spec: t.spec };
      case "ref": {
        if (peek()?.t === ":" && toks[p + 1]?.t === "ref") {
          p++;
          const u = next() as Extract<Token, { t: "ref" }>;
          return { k: "range", sheet: t.sheet ?? u.sheet, r1: Math.min(t.r, u.r), c1: Math.min(t.c, u.c), r2: Math.max(t.r, u.r), c2: Math.max(t.c, u.c) };
        }
        if (peek()?.t === "op" && (peek() as { v: string }).v === "#") {
          p++;
          return { k: "spill", sheet: t.sheet, r: t.r, c: t.c };
        }
        return { k: "ref", sheet: t.sheet, r: t.r, c: t.c };
      }
      case "ident": {
        if (peek()?.t === "(") {
          p++;
          return calls({ k: "fn", name: canonicalName(t.v), args: args() });
        }
        return { k: "name", v: t.v.replace(/^_xlpm\./i, "") };
      }
      case "(": {
        const e = expr(0);
        expect(")");
        return calls(e);
      }
      case "op":
        if (t.v === "-" || t.v === "+") return { k: "un", op: t.v, a: unary() };
        break;
    }
    throw new Error(tl("Syntaxfehler in der Formel"));
  }

  function unary(): Node {
    let n = primary();
    while (peek()?.t === "op" && (peek() as { v: string }).v === "%") {
      p++;
      n = { k: "pct", a: n };
    }
    return n;
  }

  function expr(min: number): Node {
    let a = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v in prec)) break;
      const pr = prec[t.v];
      if (pr < min) break;
      p++;
      const b = expr(t.v === "^" ? pr : pr + 1);
      a = { k: "bin", op: t.v, a, b };
    }
    return a;
  }

  const n = expr(0);
  if (p < toks.length) throw new Error(tl("Syntaxfehler in der Formel"));
  return n;
}

// ------------------------------------------------------- localisation --

/** German ⇄ English function names (only the ones that differ). */
const DE_NAMES: Record<string, string> = {
  SUM: "SUMME", AVERAGE: "MITTELWERT", COUNT: "ANZAHL", COUNTA: "ANZAHL2", COUNTBLANK: "ANZAHLLEEREZELLEN", COUNTIF: "ZÄHLENWENN", COUNTIFS: "ZÄHLENWENNS",
  SUMIF: "SUMMEWENN", SUMIFS: "SUMMEWENNS", AVERAGEIF: "MITTELWERTWENN", AVERAGEIFS: "MITTELWERTWENNS", MAXIFS: "MAXWENNS", MINIFS: "MINWENNS",
  IF: "WENN", IFERROR: "WENNFEHLER", IFNA: "WENNNV", IFS: "WENNS", AND: "UND", OR: "ODER", NOT: "NICHT", XOR: "XODER", TRUE: "WAHR", FALSE: "FALSCH",
  ROUND: "RUNDEN", ROUNDUP: "AUFRUNDEN", ROUNDDOWN: "ABRUNDEN", INT: "GANZZAHL", MOD: "REST", POWER: "POTENZ", SQRT: "WURZEL", ABS: "ABS", SIGN: "VORZEICHEN",
  CEILING: "OBERGRENZE", FLOOR: "UNTERGRENZE", TRUNC: "KÜRZEN", PRODUCT: "PRODUKT", SUMPRODUCT: "SUMMENPRODUKT", MEDIAN: "MEDIAN", MODE: "MODALWERT",
  STDEV: "STABW", "STDEV.S": "STABW.S", "STDEV.P": "STABW.N", VAR: "VARIANZ", LARGE: "KGRÖSSTE", SMALL: "KKLEINSTE", RANK: "RANG",
  CONCATENATE: "VERKETTEN", CONCAT: "TEXTKETTE", TEXTJOIN: "TEXTVERKETTEN", LEFT: "LINKS", RIGHT: "RECHTS", MID: "TEIL", LEN: "LÄNGE",
  UPPER: "GROSS", LOWER: "KLEIN", PROPER: "GROSS2", TRIM: "GLÄTTEN", SUBSTITUTE: "WECHSELN", REPLACE: "ERSETZEN", FIND: "FINDEN", SEARCH: "SUCHEN",
  TEXT: "TEXT", VALUE: "WERT", REPT: "WIEDERHOLEN", EXACT: "IDENTISCH", CHAR: "ZEICHEN", CODE: "CODE",
  TODAY: "HEUTE", NOW: "JETZT", DATE: "DATUM", TIME: "ZEIT", YEAR: "JAHR", MONTH: "MONAT", DAY: "TAG", HOUR: "STUNDE", MINUTE: "MINUTE", SECOND: "SEKUNDE",
  WEEKDAY: "WOCHENTAG", WEEKNUM: "KALENDERWOCHE", ISOWEEKNUM: "ISOKALENDERWOCHE", EDATE: "EDATUM", EOMONTH: "MONATSENDE", DATEDIF: "DATEDIF", DAYS: "TAGE",
  NETWORKDAYS: "NETTOARBEITSTAGE", WORKDAY: "ARBEITSTAG",
  VLOOKUP: "SVERWEIS", HLOOKUP: "WVERWEIS", XLOOKUP: "XVERWEIS", INDEX: "INDEX", MATCH: "VERGLEICH", CHOOSE: "WAHL", ROWS: "ZEILEN", COLUMNS: "SPALTEN",
  ROW: "ZEILE", COLUMN: "SPALTE", ISBLANK: "ISTLEER", ISNUMBER: "ISTZAHL", ISTEXT: "ISTTEXT", ISERROR: "ISTFEHLER", ISERR: "ISTFEHL", ISNA: "ISTNV",
  ISLOGICAL: "ISTLOG", ISEVEN: "ISTGERADE", ISODD: "ISTUNGERADE", PI: "PI", RAND: "ZUFALLSZAHL", RANDBETWEEN: "ZUFALLSBEREICH", NA: "NV",
  LN: "LN", LOG: "LOG", LOG10: "LOG10", EXP: "EXP", MAX: "MAX", MIN: "MIN", FIXED: "FEST", DOLLAR: "DM", PMT: "RMZ", FV: "ZW", PV: "BW", NPER: "ZZR",
  UNIQUE: "EINDEUTIG", SORT: "SORTIEREN", FILTER: "FILTERN", SEQUENCE: "SEQUENZ", TRANSPOSE: "MTRANS", COUNTUNIQUE: "COUNTUNIQUE", N: "N", T: "T",
  CLEAN: "SÄUBERN", NUMBERVALUE: "ZAHLENWERT", SUMSQ: "QUADRATESUMME", QUOTIENT: "QUOTIENT", GCD: "GGT", LCM: "KGV", FACT: "FAKULTÄT",
  RADIANS: "BOGENMASS", DEGREES: "GRAD", SIN: "SIN", COS: "COS", TAN: "TAN", AVERAGEA: "MITTELWERTA", MAXA: "MAXA", MINA: "MINA",
  ...LIBRARY_DE,
  ...LIBRARY2_DE,
};
const EN_FROM_DE: Record<string, string> = Object.fromEntries(Object.entries(DE_NAMES).map(([en, de]) => [de, en]));

function canonicalName(name: string): string {
  const up = name.toUpperCase().replace(/^_XLFN\.(_XLWS\.)?/, "");
  return EN_FROM_DE[up] ?? up;
}

function quoteSheet(s: string) {
  return /^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(s) && !/^[A-Za-z]{1,3}\d+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
}

function serialize(toks: Token[], to: Locale): string {
  let s = "";
  let lastSheet: string | undefined;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    switch (t.t) {
      case "num":
        s += to === "de" ? String(t.raw).replace(".", ",") : String(t.raw).replace(",", ".");
        break;
      case "str":
        s += `"${t.v.replace(/"/g, '""')}"`;
        break;
      case "bool":
        s += to === "de" ? (t.v ? "WAHR" : "FALSCH") : t.v ? "TRUE" : "FALSE";
        break;
      case "err":
        s += to === "de" ? ERROR_DE[t.v] ?? t.v : t.v;
        break;
      case "ref": {
        // The second half of a whole column/row range repeats no sheet.
        const second = i > 1 && toks[i - 1].t === ":";
        if (t.sheet && !(second && lastSheet === t.sheet)) s += `${quoteSheet(t.sheet)}!`;
        lastSheet = t.sheet;
        if (t.wholeCol) s += `${t.ac ? "$" : ""}${colName(t.c)}`;
        else if (t.wholeRow) s += `${t.ar ? "$" : ""}${t.r + 1}`;
        else s += refName(t.r, t.c, t.ar, t.ac);
        break;
      }
      case "ident": {
        const isFn = toks[i + 1]?.t === "(";
        // A bare function name passed as a function (=GROUPBY(A:A; B:B; SUMME)).
        const bare = !isFn && canonicalName(t.v) in FUNCTIONS && t.v.length > 1;
        if (!isFn && !bare) s += t.v;
        else {
          const en = canonicalName(t.v);
          s += to === "de" ? DE_NAMES[en] ?? en : en;
        }
        break;
      }
      case "op":
        s += t.v;
        break;
      case "(":
        s += "(";
        break;
      case ")":
        s += ")";
        break;
      case "sep":
        s += to === "de" ? ";" : ",";
        break;
      case ":":
        s += ":";
        break;
      case "ws":
        s += t.v;
        break;
      case "arr":
        s += arrayText(t.v, to);
        break;
      case "sref":
        s += `${t.table}[${specText(t.spec, to)}]`;
        break;
      case "raw":
        s += t.v;
        break;
    }
  }
  return s;
}

/**
 * Formula language of the user interface: German function names, `;` and
 * decimal comma in the German UI, the stored (English) form otherwise.
 */
export const UI_FORMULA_LOCALE: Locale = LANG === "de" ? "de" : "en";

/** Display names of error values in the UI language. */
export const ERROR_TEXT: Record<string, string> = UI_FORMULA_LOCALE === "de" ? ERROR_DE : {};

/** Stored (English) formula → display form of the UI language. */
export function toDisplayFormula(f: string): string {
  if (UI_FORMULA_LOCALE === "en") return f;
  try {
    return serialize(tokenize(f, "en"), "de");
  } catch {
    return f;
  }
}

/** Typed formula (UI language) → stored form. */
export function fromDisplayFormula(f: string): string {
  try {
    return serialize(tokenize(f, UI_FORMULA_LOCALE), "en");
  } catch {
    return f;
  }
}

/** Shift relative references (copy/paste, fill). */
/** Rewrites the tokens of a formula (English form). */
export function mapTokens(f: string, fn: (t: Token) => Token): string {
  try {
    return serialize(tokenize(f, "en").map(fn), "en");
  } catch {
    return f;
  }
}

export function shiftFormula(f: string, dr: number, dc: number): string {
  try {
    const toks = tokenize(f, "en").map((t) => {
      if (t.t !== "ref") return t;
      const r = t.ar || t.wholeCol ? t.r : t.r + dr;
      const c = t.ac || t.wholeRow ? t.c : t.c + dc;
      if (r < 0 || c < 0) return { t: "err", v: ERRORS.ref } as Token;
      return { ...t, r, c };
    });
    return serialize(toks, "en");
  } catch {
    return f;
  }
}

/**
 * Adjust references after rows/columns were inserted (count > 0) or
 * deleted (count < 0) at `at` in sheet `sheet`. `own` is true for formulas
 * on that sheet (their unqualified references point to it).
 */
export function adjustFormula(f: string, sheet: string, own: boolean, axis: "row" | "col", at: number, count: number): string {
  try {
    const toks = tokenize(f, "en");
    const out: Token[] = [];
    for (const t of toks) {
      if (t.t !== "ref") {
        out.push(t);
        continue;
      }
      const target = t.sheet ? t.sheet.toLowerCase() === sheet.toLowerCase() : own;
      if (!target) {
        out.push(t);
        continue;
      }
      const v = axis === "row" ? t.r : t.c;
      if ((axis === "row" && t.wholeRow === undefined && t.wholeCol) || (axis === "col" && t.wholeRow)) {
        out.push(t);
        continue;
      }
      let nv = v;
      if (count > 0 && v >= at) nv = v + count;
      else if (count < 0) {
        if (v >= at && v < at - count) {
          out.push({ t: "err", v: ERRORS.ref });
          continue;
        }
        if (v >= at - count) nv = v + count;
      }
      out.push(axis === "row" ? { ...t, r: nv } : { ...t, c: nv });
    }
    return serialize(out, "en");
  } catch {
    return f;
  }
}

/** Rename a sheet inside references. */
export function renameSheetInFormula(f: string, from: string, to: string): string {
  try {
    return serialize(
      tokenize(f, "en").map((t) => (t.t === "ref" && t.sheet && t.sheet.toLowerCase() === from.toLowerCase() ? { ...t, sheet: to } : t)),
      "en",
    );
  } catch {
    return f;
  }
}

// ------------------------------------------------------------ evaluation --

export interface EvalContext {
  /** Value of a cell (evaluating its formula if needed). */
  cell: (sheet: number, r: number, c: number) => Scalar;
  sheetIndex: (name: string) => number;
  /** Defined name lookup (sheet-scoped names first). */
  name?: (name: string, sheet: number) => Node | null;
  /** Used size of a sheet, to bound whole column/row references. */
  extent: (sheet: number) => { rows: number; cols: number };
  sheet: number;
  row: number;
  col: number;
  /** Names bound by LET and lambda parameters (lower case). */
  scope?: Map<string, Value>;
  /** Formula of a cell (FORMULATEXT, ISFORMULA). */
  formula?: (sheet: number, r: number, c: number) => string | null;
  sheetCount?: number;
  /** Excel table by name ("" = the table of the formula's cell). */
  table?: (name: string, sheet: number, r: number, c: number) => TableInfo | null;
  /** Value of a cell with other cells replaced (MULTIPLE.OPERATIONS). */
  evalWith?: (sheet: number, r: number, c: number, overrides: { sheet: number; r: number; c: number; v: Scalar }[]) => Scalar;
  /** Size of the spill range of a dynamic array formula. */
  spill?: (sheet: number, r: number, c: number) => { rows: number; cols: number } | null;
}

/** A LAMBDA value; shown as #CALC! where a value is needed. */
export interface LambdaValue extends FormulaError {
  lambda: { params: string[]; body: Node; scope?: Map<string, Value> };
}
export const isLambda = (v: unknown): v is LambdaValue => isError(v) && "lambda" in v;
/** Marker of a lambda parameter that was not passed (ISOMITTED). */
const OMITTED: FormulaError = { error: "#VALUE!" };

const SPECIAL_FORMS = new Set(["LET", "LAMBDA", "ISOMITTED", "IF", "IFS", "IFERROR", "IFNA", "CHOOSE", "SWITCH", "AND", "OR"]);
const etaCache = new Map<string, LambdaValue>();
/** `SUM` used as a value: LAMBDA(a, b, …, SUM(a, b, …)). */
function etaLambda(fn: string): LambdaValue {
  let l = etaCache.get(fn);
  if (!l) {
    const params = ["_eta1", "_eta2", "_eta3"];
    l = { error: ERRORS.calc, lambda: { params, body: { k: "eta", fn, params } } };
    etaCache.set(fn, l);
  }
  return l;
}

export function applyLambda(l: LambdaValue, args: Value[], ctx: EvalContext): Value {
  const { params, body, scope } = l.lambda;
  if (args.length > params.length) return err(ERRORS.value);
  const inner = new Map(scope);
  params.forEach((p, i) => inner.set(p, i < args.length ? args[i] : OMITTED));
  return evaluate(body, { ...ctx, scope: inner });
}

/** Element-wise operation with Excel's broadcasting of arrays. */
export function broadcast(vals: Value[], f: (xs: Scalar[]) => Scalar): Value {
  if (!vals.some((v) => isMatrix(v) && (v.length > 1 || (v[0]?.length ?? 0) > 1))) return f(vals.map((v) => scalar(v)));
  const ms = vals.map(asMatrix);
  const rows = Math.max(...ms.map((m) => m.length));
  const cols = Math.max(...ms.map((m) => m[0]?.length ?? 0));
  const at = (m: Matrix, r: number, c: number): Scalar => {
    const rr = m.length === 1 ? 0 : r;
    const cc = (m[0]?.length ?? 0) === 1 ? 0 : c;
    return rr < m.length && cc < (m[rr]?.length ?? 0) ? m[rr][cc] : err(ERRORS.na);
  };
  const out: Matrix = [];
  for (let r = 0; r < rows; r++) {
    const row: Scalar[] = [];
    for (let c = 0; c < cols; c++) row.push(f(ms.map((m) => at(m, r, c))));
    out.push(row);
  }
  return out;
}

const toNum = (v: Scalar): number | FormulaError => {
  if (isError(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && v.trim() !== "" ? n : err(ERRORS.value);
};

const toStr = (v: Scalar): string | FormulaError => {
  if (isError(v)) return v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "WAHR" : "FALSCH";
  if (typeof v === "number") return formatGeneral(v);
  return v;
};

const toBool = (v: Scalar): boolean | FormulaError => {
  if (isError(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null || v === "") return false;
  const u = v.toUpperCase();
  if (u === "TRUE" || u === "WAHR") return true;
  if (u === "FALSE" || u === "FALSCH") return false;
  return err(ERRORS.value);
};

/** Number → text in the "General" number format (German decimal comma). */
export function formatGeneral(n: number): string {
  if (!Number.isFinite(n)) return "#ZAHL!";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  let s: string;
  if (abs !== 0 && (abs < 1e-9 || abs >= 1e15)) s = n.toExponential(5).replace(/\.?0+e/, "e").replace("e", "E");
  else s = String(parseFloat(n.toPrecision(15)));
  return s.replace(".", ",");
}

function flatten(v: Value): Scalar[] {
  return isMatrix(v) ? v.flat() : [v];
}

function* numbers(args: Value[], countText = false): Generator<number | FormulaError> {
  for (const a of args) {
    if (isMatrix(a)) {
      for (const x of a.flat()) {
        if (isError(x)) yield x;
        else if (typeof x === "number") yield x;
        else if (countText && (typeof x === "boolean" || (typeof x === "string" && x !== ""))) yield typeof x === "boolean" ? (x ? 1 : 0) : 0;
      }
    } else {
      const n = toNum(a);
      yield n;
    }
  }
}

function collect(args: Value[], countText = false): number[] | FormulaError {
  const out: number[] = [];
  for (const n of numbers(args, countText)) {
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}

/** COUNTIF-style criteria: ">5", "<>x", "=a*", "abc", 5. */
function criterion(c: Scalar): (v: Scalar) => boolean {
  if (typeof c === "number" || typeof c === "boolean") return (v) => v === c || (typeof v === "string" && toNum(v) === c);
  const s = c === null ? "" : isError(c) ? c.error : String(c);
  const m = s.match(/^(<=|>=|<>|<|>|=)?(.*)$/s)!;
  const op = m[1] ?? "=";
  const rhs = m[2];
  const rn = rhs.trim() !== "" ? Number(rhs.replace(",", ".")) : NaN;
  if (!Number.isNaN(rn) && op !== "=" && op !== "<>") {
    return (v) => {
      if (typeof v !== "number") return false;
      return op === "<" ? v < rn : op === ">" ? v > rn : op === "<=" ? v <= rn : v >= rn;
    };
  }
  const wildcard = new RegExp(
    "^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?") + "$",
    "i",
  );
  const eq = (v: Scalar) => {
    if (!Number.isNaN(rn) && typeof v === "number") return v === rn;
    if (rhs === "") return v === null || v === "";
    return wildcard.test(v === null ? "" : String(isError(v) ? v.error : v));
  };
  return op === "<>" ? (v) => !eq(v) : eq;
}

const asMatrix = (v: Value): Matrix => (isMatrix(v) ? v : [[v]]);

function lookupEq(a: Scalar, b: Scalar): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function compare(a: Scalar, b: Scalar): number {
  // Excel order: numbers < text < booleans.
  const rank = (v: Scalar) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, LOCALE, { sensitivity: "base" });
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}

// Dates: serial numbers of the 1900 date system (.xlsx).
const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - EPOCH) / 86400000;
export function serialToDate(serial: number) {
  const ms = EPOCH + Math.floor(serial) * 86400000;
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
}
const nowSerial = () => {
  const n = new Date();
  return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate()) + (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
};

type Fn = (args: Value[], ctx: EvalContext, raw: Node[]) => Value;

const num1 = (f: (x: number) => number): Fn => (a) => {
  const x = toNum(scalar(a[0]));
  if (isError(x)) return x;
  const r = f(x);
  return Number.isFinite(r) ? r : err(ERRORS.num);
};

function scalar(v: Value | undefined): Scalar {
  if (v === undefined) return null;
  if (isMatrix(v)) return v[0]?.[0] ?? null;
  return v;
}

const roundTo = (x: number, d: number, mode: "round" | "up" | "down") => {
  const f = Math.pow(10, d);
  const v = Math.abs(x) * f;
  const r = mode === "round" ? Math.round(v + 1e-9) : mode === "up" ? Math.ceil(v - 1e-9) : Math.floor(v + 1e-9);
  return (Math.sign(x) * r) / f;
};

function ifsAggregate(args: Value[], first: number): boolean[] | FormulaError {
  // Pairs of (range, criterion) starting at `first`.
  const ranges: Matrix[] = [];
  const tests: ((v: Scalar) => boolean)[] = [];
  for (let i = first; i + 1 < args.length; i += 2) {
    ranges.push(asMatrix(args[i]));
    tests.push(criterion(scalar(args[i + 1])));
  }
  if (!ranges.length) return err(ERRORS.value);
  const n = ranges[0].flat().length;
  const flat = ranges.map((r) => r.flat());
  if (flat.some((f) => f.length !== n)) return err(ERRORS.value);
  return Array.from({ length: n }, (_, i) => tests.every((t, k) => t(flat[k][i])));
}

function workdays(start: number, end: number, holidays: Set<number>) {
  let n = 0;
  const step = start <= end ? 1 : -1;
  for (let d = Math.floor(start); step > 0 ? d <= end : d >= end; d += step) {
    const wd = serialToDate(d).wd;
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) n++;
  }
  return n * step;
}

export const FUNCTIONS: Record<string, Fn> = {
  SUM: (a) => {
    const n = collect(a);
    return isError(n) ? n : n.reduce((x, y) => x + y, 0);
  },
  PRODUCT: (a) => {
    const n = collect(a);
    return isError(n) ? n : n.reduce((x, y) => x * y, 1);
  },
  SUMSQ: (a) => {
    const n = collect(a);
    return isError(n) ? n : n.reduce((x, y) => x + y * y, 0);
  },
  AVERAGE: (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err(ERRORS.div0);
  },
  AVERAGEA: (a) => {
    const n = collect(a, true);
    if (isError(n)) return n;
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err(ERRORS.div0);
  },
  MIN: (a) => {
    const n = collect(a);
    return isError(n) ? n : n.length ? Math.min(...n) : 0;
  },
  MAX: (a) => {
    const n = collect(a);
    return isError(n) ? n : n.length ? Math.max(...n) : 0;
  },
  MINA: (a) => FUNCTIONS.MIN(a.map((x) => (isMatrix(x) ? x.map((r) => r.map((v) => (typeof v === "boolean" ? Number(v) : typeof v === "string" && v !== "" ? 0 : v))) : x)), null!, []),
  MAXA: (a) => FUNCTIONS.MAX(a.map((x) => (isMatrix(x) ? x.map((r) => r.map((v) => (typeof v === "boolean" ? Number(v) : typeof v === "string" && v !== "" ? 0 : v))) : x)), null!, []),
  MEDIAN: (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (!n.length) return err(ERRORS.num);
    const s = [...n].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
  MODE: (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const counts = new Map<number, number>();
    let best: number | null = null;
    let bestC = 1;
    for (const x of n) {
      const c = (counts.get(x) ?? 0) + 1;
      counts.set(x, c);
      if (c > bestC) {
        bestC = c;
        best = x;
      }
    }
    return best ?? err(ERRORS.na);
  },
  STDEV: (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (n.length < 2) return err(ERRORS.div0);
    const m = n.reduce((x, y) => x + y, 0) / n.length;
    return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1));
  },
  "STDEV.P": (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (!n.length) return err(ERRORS.div0);
    const m = n.reduce((x, y) => x + y, 0) / n.length;
    return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / n.length);
  },
  VAR: (a) => {
    const s = FUNCTIONS.STDEV(a, null!, []);
    return typeof s === "number" ? s * s : s;
  },
  LARGE: (a) => {
    const n = collect([a[0]]);
    const k = toNum(scalar(a[1]));
    if (isError(n)) return n;
    if (isError(k)) return k;
    const s = [...n].sort((x, y) => y - x);
    return k >= 1 && k <= s.length ? s[Math.floor(k) - 1] : err(ERRORS.num);
  },
  SMALL: (a) => {
    const n = collect([a[0]]);
    const k = toNum(scalar(a[1]));
    if (isError(n)) return n;
    if (isError(k)) return k;
    const s = [...n].sort((x, y) => x - y);
    return k >= 1 && k <= s.length ? s[Math.floor(k) - 1] : err(ERRORS.num);
  },
  RANK: (a) => {
    const x = toNum(scalar(a[0]));
    const n = collect([a[1]]);
    if (isError(x)) return x;
    if (isError(n)) return n;
    const asc = a[2] !== undefined && toNum(scalar(a[2])) !== 0;
    if (!n.includes(x)) return err(ERRORS.na);
    return 1 + n.filter((v) => (asc ? v < x : v > x)).length;
  },
  COUNT: (a) => a.flatMap(flatten).filter((v) => typeof v === "number").length,
  COUNTA: (a) => a.flatMap(flatten).filter((v) => v !== null && v !== "").length,
  COUNTBLANK: (a) => a.flatMap(flatten).filter((v) => v === null || v === "").length,
  COUNTUNIQUE: (a) => new Set(a.flatMap(flatten).filter((v) => v !== null && v !== "").map((v) => (typeof v === "string" ? v.toLowerCase() : JSON.stringify(v)))).size,
  COUNTIF: (a) => {
    const test = criterion(scalar(a[1]));
    return asMatrix(a[0]).flat().filter(test).length;
  },
  COUNTIFS: (a) => {
    const m = ifsAggregate(a, 0);
    return isError(m) ? m : m.filter(Boolean).length;
  },
  SUMIF: (a) => {
    const test = criterion(scalar(a[1]));
    const range = asMatrix(a[0]).flat();
    const sum = asMatrix(a[2] ?? a[0]).flat();
    let s = 0;
    range.forEach((v, i) => {
      if (test(v) && typeof sum[i] === "number") s += sum[i] as number;
    });
    return s;
  },
  SUMIFS: (a) => {
    const m = ifsAggregate(a, 1);
    if (isError(m)) return m;
    const sum = asMatrix(a[0]).flat();
    return m.reduce((s, ok, i) => s + (ok && typeof sum[i] === "number" ? (sum[i] as number) : 0), 0);
  },
  AVERAGEIF: (a) => {
    const test = criterion(scalar(a[1]));
    const range = asMatrix(a[0]).flat();
    const vals = asMatrix(a[2] ?? a[0]).flat();
    const n = range.map((v, i) => (test(v) && typeof vals[i] === "number" ? (vals[i] as number) : null)).filter((x): x is number => x !== null);
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err(ERRORS.div0);
  },
  AVERAGEIFS: (a) => {
    const m = ifsAggregate(a, 1);
    if (isError(m)) return m;
    const vals = asMatrix(a[0]).flat();
    const n = vals.filter((v, i) => m[i] && typeof v === "number") as number[];
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err(ERRORS.div0);
  },
  MAXIFS: (a) => {
    const m = ifsAggregate(a, 1);
    if (isError(m)) return m;
    const n = asMatrix(a[0]).flat().filter((v, i) => m[i] && typeof v === "number") as number[];
    return n.length ? Math.max(...n) : 0;
  },
  MINIFS: (a) => {
    const m = ifsAggregate(a, 1);
    if (isError(m)) return m;
    const n = asMatrix(a[0]).flat().filter((v, i) => m[i] && typeof v === "number") as number[];
    return n.length ? Math.min(...n) : 0;
  },
  SUMPRODUCT: (a) => {
    const ms = a.map((x) => asMatrix(x).flat());
    const n = ms[0]?.length ?? 0;
    if (ms.some((m) => m.length !== n)) return err(ERRORS.value);
    let s = 0;
    for (let i = 0; i < n; i++) s += ms.reduce((p, m) => p * (typeof m[i] === "number" ? (m[i] as number) : 0), 1);
    return s;
  },
  IF: (a) => {
    const c = toBool(scalar(a[0]));
    if (isError(c)) return c;
    return c ? a[1] ?? true : a[2] ?? false;
  },
  IFS: (a) => {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const c = toBool(scalar(a[i]));
      if (isError(c)) return c;
      if (c) return a[i + 1];
    }
    return err(ERRORS.na);
  },
  IFERROR: (a) => (isError(scalar(a[0])) ? a[1] ?? "" : a[0]),
  IFNA: (a) => {
    const v = scalar(a[0]);
    return isError(v) && v.error === ERRORS.na ? a[1] ?? "" : a[0];
  },
  AND: (a) => {
    for (const v of a.flatMap(flatten)) {
      if (v === null) continue;
      const b = toBool(v);
      if (isError(b)) return b;
      if (!b) return false;
    }
    return true;
  },
  OR: (a) => {
    for (const v of a.flatMap(flatten)) {
      if (v === null) continue;
      const b = toBool(v);
      if (isError(b)) return b;
      if (b) return true;
    }
    return false;
  },
  XOR: (a) => a.flatMap(flatten).filter((v) => v !== null && toBool(v) === true).length % 2 === 1,
  NOT: (a) => {
    const b = toBool(scalar(a[0]));
    return isError(b) ? b : !b;
  },
  TRUE: () => true,
  FALSE: () => false,
  ROUND: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1] ?? 0));
    return isError(x) ? x : isError(d) ? d : roundTo(x, Math.trunc(d), "round");
  },
  ROUNDUP: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1] ?? 0));
    return isError(x) ? x : isError(d) ? d : roundTo(x, Math.trunc(d), "up");
  },
  ROUNDDOWN: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1] ?? 0));
    return isError(x) ? x : isError(d) ? d : roundTo(x, Math.trunc(d), "down");
  },
  TRUNC: (a) => FUNCTIONS.ROUNDDOWN(a, null!, []),
  INT: num1(Math.floor),
  ABS: num1(Math.abs),
  SIGN: num1(Math.sign),
  SQRT: (a) => {
    const x = toNum(scalar(a[0]));
    return isError(x) ? x : x < 0 ? err(ERRORS.num) : Math.sqrt(x);
  },
  EXP: num1(Math.exp),
  LN: (a) => {
    const x = toNum(scalar(a[0]));
    return isError(x) ? x : x <= 0 ? err(ERRORS.num) : Math.log(x);
  },
  LOG10: (a) => {
    const x = toNum(scalar(a[0]));
    return isError(x) ? x : x <= 0 ? err(ERRORS.num) : Math.log10(x);
  },
  LOG: (a) => {
    const x = toNum(scalar(a[0]));
    const b = toNum(scalar(a[1] ?? 10));
    return isError(x) ? x : isError(b) ? b : x <= 0 || b <= 0 || b === 1 ? err(ERRORS.num) : Math.log(x) / Math.log(b);
  },
  SIN: num1(Math.sin),
  COS: num1(Math.cos),
  TAN: num1(Math.tan),
  RADIANS: num1((x) => (x * Math.PI) / 180),
  DEGREES: num1((x) => (x * 180) / Math.PI),
  PI: () => Math.PI,
  RAND: () => Math.random(),
  RANDBETWEEN: (a) => {
    const lo = toNum(scalar(a[0]));
    const hi = toNum(scalar(a[1]));
    if (isError(lo)) return lo;
    if (isError(hi)) return hi;
    return Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo);
  },
  MOD: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(d)) return d;
    if (d === 0) return err(ERRORS.div0);
    return x - d * Math.floor(x / d);
  },
  QUOTIENT: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(d)) return d;
    return d === 0 ? err(ERRORS.div0) : Math.trunc(x / d);
  },
  POWER: (a) => {
    const x = toNum(scalar(a[0]));
    const y = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(y)) return y;
    const r = Math.pow(x, y);
    return Number.isFinite(r) ? r : err(ERRORS.num);
  },
  CEILING: (a) => {
    const x = toNum(scalar(a[0]));
    const s = toNum(scalar(a[1] ?? 1));
    if (isError(x)) return x;
    if (isError(s)) return s;
    return s === 0 ? 0 : Math.ceil(x / s - 1e-12) * s;
  },
  FLOOR: (a) => {
    const x = toNum(scalar(a[0]));
    const s = toNum(scalar(a[1] ?? 1));
    if (isError(x)) return x;
    if (isError(s)) return s;
    return s === 0 ? err(ERRORS.div0) : Math.floor(x / s + 1e-12) * s;
  },
  FACT: (a) => {
    const x = toNum(scalar(a[0]));
    if (isError(x)) return x;
    if (x < 0) return err(ERRORS.num);
    let r = 1;
    for (let i = 2; i <= Math.floor(x); i++) r *= i;
    return r;
  },
  GCD: (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
    return n.map(Math.floor).reduce((x, y) => g(x, y), 0);
  },
  LCM: (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
    return n.map(Math.floor).reduce((x, y) => (x * y) / g(x, y), 1);
  },
  CONCATENATE: (a) => {
    let s = "";
    for (const v of a.flatMap(flatten)) {
      const t = toStr(v);
      if (isError(t)) return t;
      s += t;
    }
    return s;
  },
  CONCAT: (a) => FUNCTIONS.CONCATENATE(a, null!, []),
  TEXTJOIN: (a) => {
    const d = toStr(scalar(a[0]));
    const skip = toBool(scalar(a[1]));
    if (isError(d)) return d;
    if (isError(skip)) return skip;
    const parts: string[] = [];
    for (const v of a.slice(2).flatMap(flatten)) {
      const t = toStr(v);
      if (isError(t)) return t;
      if (skip && t === "") continue;
      parts.push(t);
    }
    return parts.join(d);
  },
  LEFT: (a) => {
    const s = toStr(scalar(a[0]));
    const n = toNum(scalar(a[1] ?? 1));
    return isError(s) ? s : isError(n) ? n : s.slice(0, Math.max(0, n));
  },
  RIGHT: (a) => {
    const s = toStr(scalar(a[0]));
    const n = toNum(scalar(a[1] ?? 1));
    return isError(s) ? s : isError(n) ? n : n <= 0 ? "" : s.slice(-n);
  },
  MID: (a) => {
    const s = toStr(scalar(a[0]));
    const st = toNum(scalar(a[1]));
    const n = toNum(scalar(a[2]));
    if (isError(s)) return s;
    if (isError(st)) return st;
    if (isError(n)) return n;
    return st < 1 ? err(ERRORS.value) : s.substr(st - 1, Math.max(0, n));
  },
  LEN: (a) => {
    const s = toStr(scalar(a[0]));
    return isError(s) ? s : s.length;
  },
  UPPER: (a) => {
    const s = toStr(scalar(a[0]));
    return isError(s) ? s : s.toUpperCase();
  },
  LOWER: (a) => {
    const s = toStr(scalar(a[0]));
    return isError(s) ? s : s.toLowerCase();
  },
  PROPER: (a) => {
    const s = toStr(scalar(a[0]));
    return isError(s) ? s : s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
  },
  TRIM: (a) => {
    const s = toStr(scalar(a[0]));
    return isError(s) ? s : s.trim().replace(/ +/g, " ");
  },
  CLEAN: (a) => {
    const s = toStr(scalar(a[0]));
    // eslint-disable-next-line no-control-regex
    return isError(s) ? s : s.replace(/[\x00-\x1f]/g, "");
  },
  REPT: (a) => {
    const s = toStr(scalar(a[0]));
    const n = toNum(scalar(a[1]));
    return isError(s) ? s : isError(n) ? n : n < 0 ? err(ERRORS.value) : s.repeat(Math.floor(n));
  },
  EXACT: (a) => toStr(scalar(a[0])) === toStr(scalar(a[1])),
  CHAR: (a) => {
    const n = toNum(scalar(a[0]));
    return isError(n) ? n : String.fromCharCode(n);
  },
  CODE: (a) => {
    const s = toStr(scalar(a[0]));
    return isError(s) ? s : s ? s.charCodeAt(0) : err(ERRORS.value);
  },
  SUBSTITUTE: (a) => {
    const s = toStr(scalar(a[0]));
    const o = toStr(scalar(a[1]));
    const n = toStr(scalar(a[2]));
    if (isError(s)) return s;
    if (isError(o)) return o;
    if (isError(n)) return n;
    if (!o) return s;
    if (a[3] !== undefined) {
      const k = toNum(scalar(a[3]));
      if (isError(k)) return k;
      let idx = -1;
      for (let i = 0; i < k; i++) {
        idx = s.indexOf(o, idx + 1);
        if (idx < 0) return s;
      }
      return s.slice(0, idx) + n + s.slice(idx + o.length);
    }
    return s.split(o).join(n);
  },
  REPLACE: (a) => {
    const s = toStr(scalar(a[0]));
    const st = toNum(scalar(a[1]));
    const n = toNum(scalar(a[2]));
    const r = toStr(scalar(a[3]));
    if (isError(s)) return s;
    if (isError(st)) return st;
    if (isError(n)) return n;
    if (isError(r)) return r;
    return s.slice(0, st - 1) + r + s.slice(st - 1 + n);
  },
  FIND: (a) => {
    const f = toStr(scalar(a[0]));
    const s = toStr(scalar(a[1]));
    const st = toNum(scalar(a[2] ?? 1));
    if (isError(f)) return f;
    if (isError(s)) return s;
    if (isError(st)) return st;
    const i = s.indexOf(f, st - 1);
    return i < 0 ? err(ERRORS.value) : i + 1;
  },
  SEARCH: (a) => {
    const f = toStr(scalar(a[0]));
    const s = toStr(scalar(a[1]));
    const st = toNum(scalar(a[2] ?? 1));
    if (isError(f)) return f;
    if (isError(s)) return s;
    if (isError(st)) return st;
    const re = new RegExp(f.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "i");
    const m = s.slice(st - 1).search(re);
    return m < 0 ? err(ERRORS.value) : m + st;
  },
  VALUE: (a) => {
    const v = scalar(a[0]);
    if (typeof v === "number") return v;
    const s = toStr(v);
    if (isError(s)) return s;
    const n = Number(s.trim().replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && s.trim() ? n : err(ERRORS.value);
  },
  NUMBERVALUE: (a) => FUNCTIONS.VALUE(a, null!, []),
  N: (a) => {
    const v = scalar(a[0]);
    return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : 0;
  },
  T: (a) => {
    const v = scalar(a[0]);
    return typeof v === "string" ? v : "";
  },
  TEXT: (a) => {
    const v = scalar(a[0]);
    const f = toStr(scalar(a[1]));
    if (isError(f)) return f;
    return textFormatter ? textFormatter(v, f) : toStr(v);
  },
  FIXED: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1] ?? 2));
    if (isError(x)) return x;
    if (isError(d)) return d;
    const noSep = a[2] !== undefined && toBool(scalar(a[2])) === true;
    return x.toLocaleString(LOCALE, { minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d), useGrouping: !noSep });
  },
  DOLLAR: (a) => {
    const x = toNum(scalar(a[0]));
    const d = toNum(scalar(a[1] ?? 2));
    if (isError(x)) return x;
    if (isError(d)) return d;
    return x.toLocaleString(LOCALE, { style: "currency", currency: "EUR", minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d) });
  },
  TODAY: () => Math.floor(nowSerial()),
  NOW: () => nowSerial(),
  DATE: (a) => {
    const y = toNum(scalar(a[0]));
    const m = toNum(scalar(a[1]));
    const d = toNum(scalar(a[2]));
    if (isError(y)) return y;
    if (isError(m)) return m;
    if (isError(d)) return d;
    return dateToSerial(y < 1900 ? y + 1900 : y, m, d);
  },
  TIME: (a) => {
    const h = toNum(scalar(a[0]));
    const m = toNum(scalar(a[1]));
    const s = toNum(scalar(a[2]));
    if (isError(h)) return h;
    if (isError(m)) return m;
    if (isError(s)) return s;
    return ((h * 3600 + m * 60 + s) / 86400) % 1;
  },
  YEAR: num1((x) => serialToDate(x).y),
  MONTH: num1((x) => serialToDate(x).m),
  DAY: num1((x) => serialToDate(x).d),
  HOUR: num1((x) => Math.floor(((x % 1) * 86400 + 0.5) / 3600)),
  MINUTE: num1((x) => Math.floor((((x % 1) * 86400 + 0.5) % 3600) / 60)),
  SECOND: num1((x) => Math.floor(((x % 1) * 86400 + 0.5) % 60)),
  WEEKDAY: (a) => {
    const x = toNum(scalar(a[0]));
    const t = toNum(scalar(a[1] ?? 1));
    if (isError(x)) return x;
    if (isError(t)) return t;
    const wd = serialToDate(x).wd;
    return t === 2 ? ((wd + 6) % 7) + 1 : t === 3 ? (wd + 6) % 7 : wd + 1;
  },
  ISOWEEKNUM: num1((x) => {
    const { y, m, d } = serialToDate(x);
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((date.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }),
  WEEKNUM: (a) => FUNCTIONS.ISOWEEKNUM(a, null!, []),
  EDATE: (a) => {
    const x = toNum(scalar(a[0]));
    const n = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(n)) return n;
    const { y, m, d } = serialToDate(x);
    const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
    return dateToSerial(y, m + n, Math.min(d, last));
  },
  EOMONTH: (a) => {
    const x = toNum(scalar(a[0]));
    const n = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(n)) return n;
    const { y, m } = serialToDate(x);
    return dateToSerial(y, m + n + 1, 0);
  },
  DAYS: (a) => {
    const e = toNum(scalar(a[0]));
    const s = toNum(scalar(a[1]));
    if (isError(e)) return e;
    if (isError(s)) return s;
    return Math.floor(e) - Math.floor(s);
  },
  DATEDIF: (a) => {
    const s = toNum(scalar(a[0]));
    const e = toNum(scalar(a[1]));
    const u = toStr(scalar(a[2]));
    if (isError(s)) return s;
    if (isError(e)) return e;
    if (isError(u)) return u;
    if (e < s) return err(ERRORS.num);
    const A = serialToDate(s);
    const B = serialToDate(e);
    const months = (B.y - A.y) * 12 + (B.m - A.m) - (B.d < A.d ? 1 : 0);
    switch (u.toUpperCase()) {
      case "D":
        return Math.floor(e) - Math.floor(s);
      case "M":
        return months;
      case "Y":
        return Math.floor(months / 12);
      case "YM":
        return months % 12;
      case "MD":
        return B.d >= A.d ? B.d - A.d : B.d + new Date(Date.UTC(B.y, B.m - 1, 0)).getUTCDate() - A.d;
      default:
        return err(ERRORS.num);
    }
  },
  NETWORKDAYS: (a) => {
    const s = toNum(scalar(a[0]));
    const e = toNum(scalar(a[1]));
    if (isError(s)) return s;
    if (isError(e)) return e;
    const hol = new Set((a[2] ? asMatrix(a[2]).flat() : []).filter((x): x is number => typeof x === "number").map(Math.floor));
    return workdays(s, e, hol);
  },
  WORKDAY: (a) => {
    const s = toNum(scalar(a[0]));
    const n = toNum(scalar(a[1]));
    if (isError(s)) return s;
    if (isError(n)) return n;
    const hol = new Set((a[2] ? asMatrix(a[2]).flat() : []).filter((x): x is number => typeof x === "number").map(Math.floor));
    let d = Math.floor(s);
    let left = Math.abs(Math.trunc(n));
    const step = n >= 0 ? 1 : -1;
    while (left > 0) {
      d += step;
      const wd = serialToDate(d).wd;
      if (wd !== 0 && wd !== 6 && !hol.has(d)) left--;
    }
    return d;
  },
  VLOOKUP: (a) => {
    const key = scalar(a[0]);
    const table = asMatrix(a[1]);
    const col = toNum(scalar(a[2]));
    if (isError(col)) return col;
    const approx = a[3] === undefined ? true : toBool(scalar(a[3]));
    if (isError(approx)) return approx;
    if (col < 1 || col > (table[0]?.length ?? 0)) return err(ERRORS.ref);
    let hit = -1;
    for (let i = 0; i < table.length; i++) {
      const v = table[i][0];
      if (!approx && lookupEq(v, key)) {
        hit = i;
        break;
      }
      if (approx) {
        if (v === null) continue;
        if (compare(v, key) <= 0) hit = i;
        else break;
      }
    }
    return hit < 0 ? err(ERRORS.na) : table[hit][col - 1];
  },
  HLOOKUP: (a) => {
    const t = asMatrix(a[1]);
    const transposed = t[0]?.map((_, c) => t.map((r) => r[c])) ?? [];
    return FUNCTIONS.VLOOKUP([a[0], transposed, a[2], a[3] as Value], null!, []);
  },
  MATCH: (a) => {
    const key = scalar(a[0]);
    const list = asMatrix(a[1]).flat();
    const type = a[2] === undefined ? 1 : toNum(scalar(a[2]));
    if (isError(type)) return type;
    if (type === 0) {
      const test = typeof key === "string" && /[*?]/.test(key) ? criterion(key) : (v: Scalar) => lookupEq(v, key);
      const i = list.findIndex(test);
      return i < 0 ? err(ERRORS.na) : i + 1;
    }
    let hit = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === null) continue;
      const c = compare(list[i], key);
      if (type > 0 ? c <= 0 : c >= 0) hit = i;
      else break;
    }
    return hit < 0 ? err(ERRORS.na) : hit + 1;
  },
  XLOOKUP: (a) => {
    const key = scalar(a[0]);
    const look = asMatrix(a[1]).flat();
    const ret = asMatrix(a[2]);
    const flatRet = ret.length === 1 ? ret[0] : ret.map((r) => r[0]);
    const i = look.findIndex((v) => lookupEq(v, key));
    if (i < 0) return a[3] !== undefined ? a[3] : err(ERRORS.na);
    return flatRet[i] ?? err(ERRORS.na);
  },
  INDEX: (a) => {
    const m = asMatrix(a[0]);
    const r = toNum(scalar(a[1] ?? 0));
    const c = toNum(scalar(a[2] ?? 0));
    if (isError(r)) return r;
    if (isError(c)) return c;
    if (m.length === 1 && a[2] === undefined) return m[0][r - 1] ?? err(ERRORS.ref);
    if (r === 0) return m.map((row) => [row[c - 1]]);
    if (c === 0 && m[0].length > 1) return [m[r - 1] ?? []];
    return m[r - 1]?.[Math.max(1, c) - 1] ?? err(ERRORS.ref);
  },
  CHOOSE: (a) => {
    const i = toNum(scalar(a[0]));
    if (isError(i)) return i;
    return a[Math.floor(i)] ?? err(ERRORS.value);
  },
  ROWS: (a, _c, raw) => (raw[0]?.k === "range" ? raw[0].r2 - raw[0].r1 + 1 : asMatrix(a[0]).length),
  COLUMNS: (a, _c, raw) => (raw[0]?.k === "range" ? raw[0].c2 - raw[0].c1 + 1 : asMatrix(a[0])[0]?.length ?? 1),
  ROW: (_a, ctx, raw) => (raw[0]?.k === "ref" ? raw[0].r + 1 : raw[0]?.k === "range" ? raw[0].r1 + 1 : ctx.row + 1),
  COLUMN: (_a, ctx, raw) => (raw[0]?.k === "ref" ? raw[0].c + 1 : raw[0]?.k === "range" ? raw[0].c1 + 1 : ctx.col + 1),
  TRANSPOSE: (a) => {
    const m = asMatrix(a[0]);
    return m[0]?.map((_, c) => m.map((r) => r[c])) ?? [[]];
  },
  UNIQUE: (a) => {
    const seen = new Set<string>();
    const out: Matrix = [];
    for (const row of asMatrix(a[0])) {
      const k = JSON.stringify(row.map((v) => (typeof v === "string" ? v.toLowerCase() : v)));
      if (!seen.has(k)) {
        seen.add(k);
        out.push(row);
      }
    }
    return out;
  },
  SORT: (a) => {
    const m = asMatrix(a[0]).map((r) => [...r]);
    const idx = toNum(scalar(a[1] ?? 1));
    const order = toNum(scalar(a[2] ?? 1));
    if (isError(idx)) return idx;
    if (isError(order)) return order;
    return m.sort((x, y) => compare(x[idx - 1], y[idx - 1]) * (order < 0 ? -1 : 1));
  },
  FILTER: (a) => {
    const m = asMatrix(a[0]);
    const inc = asMatrix(a[1]).flat();
    const out = m.filter((_, i) => toBool(inc[i] ?? false) === true);
    return out.length ? out : a[2] !== undefined ? a[2] : err("#CALC!");
  },
  SEQUENCE: (a) => {
    const r = toNum(scalar(a[0]));
    const c = toNum(scalar(a[1] ?? 1));
    const s = toNum(scalar(a[2] ?? 1));
    const st = toNum(scalar(a[3] ?? 1));
    if ([r, c, s, st].some(isError)) return err(ERRORS.value);
    const out: Matrix = [];
    let v = s as number;
    for (let i = 0; i < (r as number); i++) {
      const row: Scalar[] = [];
      for (let j = 0; j < (c as number); j++, v += st as number) row.push(v);
      out.push(row);
    }
    return out;
  },
  ISBLANK: (a) => scalar(a[0]) === null,
  ISNUMBER: (a) => typeof scalar(a[0]) === "number",
  ISTEXT: (a) => typeof scalar(a[0]) === "string",
  ISLOGICAL: (a) => typeof scalar(a[0]) === "boolean",
  ISERROR: (a) => isError(scalar(a[0])),
  ISERR: (a) => {
    const v = scalar(a[0]);
    return isError(v) && v.error !== ERRORS.na;
  },
  ISNA: (a) => {
    const v = scalar(a[0]);
    return isError(v) && v.error === ERRORS.na;
  },
  ISEVEN: num1((x) => (Math.floor(Math.abs(x)) % 2 === 0 ? 1 : 0)),
  ISODD: num1((x) => (Math.floor(Math.abs(x)) % 2 === 1 ? 1 : 0)),
  NA: () => err(ERRORS.na),
  PMT: (a) => {
    const [r, n, pv, fv = 0, type = 0] = a.map((x) => toNum(scalar(x)));
    if ([r, n, pv, fv, type].some(isError)) return err(ERRORS.value);
    const R = r as number, N = n as number, P = pv as number, F = fv as number, T = type as number;
    if (R === 0) return -(P + F) / N;
    const f = Math.pow(1 + R, N);
    return (-(P * f + F) * R) / ((1 + R * T) * (f - 1));
  },
  FV: (a) => {
    const [r, n, pmt, pv = 0, type = 0] = a.map((x) => toNum(scalar(x)));
    if ([r, n, pmt, pv, type].some(isError)) return err(ERRORS.value);
    const R = r as number, N = n as number, M = pmt as number, P = pv as number, T = type as number;
    if (R === 0) return -(P + M * N);
    const f = Math.pow(1 + R, N);
    return -(P * f + (M * (1 + R * T) * (f - 1)) / R);
  },
  PV: (a) => {
    const [r, n, pmt, fv = 0, type = 0] = a.map((x) => toNum(scalar(x)));
    if ([r, n, pmt, fv, type].some(isError)) return err(ERRORS.value);
    const R = r as number, N = n as number, M = pmt as number, F = fv as number, T = type as number;
    if (R === 0) return -(F + M * N);
    const f = Math.pow(1 + R, N);
    return -(F + (M * (1 + R * T) * (f - 1)) / R) / f;
  },
};
FUNCTIONS["STDEV.S"] = FUNCTIONS.STDEV;
FUNCTIONS["MODE.SNGL"] = FUNCTIONS.MODE;
FUNCTIONS["CEILING.MATH"] = FUNCTIONS.CEILING;
FUNCTIONS["FLOOR.MATH"] = FUNCTIONS.FLOOR;

/** Set by format.ts: TEXT() needs the number formatter. */
let textFormatter: ((v: Scalar, code: string) => string) | null = null;
export function setTextFormatter(f: (v: Scalar, code: string) => string) {
  textFormatter = f;
}

/** Functions whose arguments must not be evaluated eagerly. */
const LAZY = new Set(["IF", "IFERROR", "IFNA", "IFS", "CHOOSE"]);
/** Functions that receive whole ranges without implicit intersection. */
export const VOLATILE = new Set(["TODAY", "NOW", "RAND", "RANDBETWEEN"]);

let nameDepth = 0;

export function evaluate(node: Node, ctx: EvalContext): Value {
  switch (node.k) {
    case "eta": {
      const args: Value[] = [];
      const raw: Node[] = [];
      for (const p of node.params) {
        const v = ctx.scope?.get(p);
        if (v === undefined || v === OMITTED) break;
        args.push(v);
        raw.push({ k: "name", v: p });
      }
      return FUNCTIONS[node.fn](args, ctx, raw);
    }
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "bool":
      return node.v;
    case "err":
      return err(node.v);
    case "arr":
      return node.v;
    case "sref": {
      const t = ctx.table?.(node.table, ctx.sheet, ctx.row, ctx.col);
      const r = t && resolveSpec(t, node.spec, ctx.row);
      if (!t || !r) return err(ERRORS.ref);
      return rangeValue(t.sheet, r, ctx);
    }
    case "name": {
      const local = ctx.scope?.get(node.v.toLowerCase());
      if (local !== undefined) return local === OMITTED ? null : local;
      const target = ctx.name?.(node.v, ctx.sheet);
      if (!target) {
        // A table name alone stands for its data.
        const t = ctx.table?.(node.v, ctx.sheet, ctx.row, ctx.col);
        const r = t && node.v && resolveSpec(t, "", ctx.row);
        if (t && r) return rangeValue(t.sheet, r, ctx);
      }
      if (!target) {
        // A function name alone is that function as a lambda (eta reduction).
        const fn = canonicalName(node.v);
        if (FUNCTIONS[fn] && !SPECIAL_FORMS.has(fn)) return etaLambda(fn);
      }
      if (!target || nameDepth > 32) return err(ERRORS.name);
      nameDepth++;
      try {
        return evaluate(target, ctx);
      } finally {
        nameDepth--;
      }
    }
    case "ref": {
      const s = node.sheet ? ctx.sheetIndex(node.sheet) : ctx.sheet;
      if (s < 0) return err(ERRORS.ref);
      return ctx.cell(s, node.r, node.c);
    }
    case "range": {
      const s = node.sheet ? ctx.sheetIndex(node.sheet) : ctx.sheet;
      if (s < 0) return err(ERRORS.ref);
      const ext = ctx.extent(s);
      const r2 = Math.min(node.r2, Math.max(node.r1, ext.rows - 1));
      const c2 = Math.min(node.c2, Math.max(node.c1, ext.cols - 1));
      const m: Matrix = [];
      for (let r = node.r1; r <= r2; r++) {
        const row: Scalar[] = [];
        for (let c = node.c1; c <= c2; c++) row.push(ctx.cell(s, r, c));
        m.push(row);
      }
      return m;
    }
    case "spill": {
      const s = node.sheet ? ctx.sheetIndex(node.sheet) : ctx.sheet;
      const size = s < 0 ? null : ctx.spill?.(s, node.r, node.c);
      if (!size) return err(ERRORS.ref);
      return evaluate({ k: "range", sheet: node.sheet, r1: node.r, c1: node.c, r2: node.r + size.rows - 1, c2: node.c + size.cols - 1 }, ctx);
    }
    case "call": {
      const f = evaluate(node.fn, ctx);
      if (!isLambda(f)) return isError(f) ? f : err(ERRORS.value);
      return applyLambda(f, node.args.map((a) => evaluate(a, ctx)), ctx);
    }
    case "pct":
      return broadcast([evaluate(node.a, ctx)], ([x]) => {
        const v = toNum(x);
        return isError(v) ? v : v / 100;
      });
    case "un":
      return broadcast([evaluate(node.a, ctx)], ([x]) => {
        const v = toNum(x);
        return isError(v) ? v : node.op === "-" ? -v : v;
      });
    case "bin":
      return broadcast([evaluate(node.a, ctx), evaluate(node.b, ctx)], ([a, b]) => binary(node.op, a, b));
    case "fn": {
      if (node.name === "LET") {
        // LET(name1, value1, [name2, value2, …], result)
        const scope = new Map(ctx.scope);
        const inner = { ...ctx, scope };
        for (let i = 0; i + 1 < node.args.length; i += 2) {
          const n = node.args[i];
          if (n.k !== "name") return err(ERRORS.value);
          scope.set(n.v.toLowerCase(), evaluate(node.args[i + 1], inner));
        }
        return node.args.length % 2 ? evaluate(node.args[node.args.length - 1], inner) : err(ERRORS.value);
      }
      if (node.name === "LAMBDA") {
        // Parameters: names, optional ones in brackets ([y]).
        const params = node.args.slice(0, -1).map((x) => (x.k === "name" ? x.v : x.k === "sref" && !x.table && /^[\wÄÖÜäöüß.]+$/.test(x.spec) ? x.spec : null));
        if (!node.args.length || params.some((x) => x === null)) return err(ERRORS.value);
        const l: LambdaValue = { error: ERRORS.calc, lambda: { params: params.map((x) => x!.toLowerCase()), body: node.args[node.args.length - 1], scope: ctx.scope } };
        return l;
      }
      if (node.name === "ISOMITTED") {
        const n = node.args[0];
        return n?.k === "name" && ctx.scope?.get(n.v.toLowerCase()) === OMITTED;
      }
      if (!FUNCTIONS[node.name]) {
        // A LET-bound lambda or a defined name holding a LAMBDA.
        const f = evaluate({ k: "name", v: node.name }, ctx);
        if (isLambda(f)) return applyLambda(f, node.args.map((a) => evaluate(a, ctx)), ctx);
        return err(ERRORS.name);
      }
      return callFunction(node, ctx);
    }
  }
}

function rangeValue(sheet: number, r: { r1: number; c1: number; r2: number; c2: number }, ctx: EvalContext): Value {
  if (r.r1 === r.r2 && r.c1 === r.c2) return ctx.cell(sheet, r.r1, r.c1);
  const m: Matrix = [];
  for (let y = r.r1; y <= r.r2; y++) {
    const row: Scalar[] = [];
    for (let x = r.c1; x <= r.c2; x++) row.push(ctx.cell(sheet, y, x));
    m.push(row);
  }
  return m;
}

function binary(op: string, a: Scalar, b: Scalar): Scalar {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === "&") return `${toStr(a)}${toStr(b)}`;
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const A = a === null ? (typeof b === "string" ? "" : typeof b === "boolean" ? false : 0) : a;
    const B = b === null ? (typeof A === "string" ? "" : typeof A === "boolean" ? false : 0) : b;
    const c = typeof A === "string" && typeof B === "string" ? A.toLowerCase().localeCompare(B.toLowerCase()) : compare(A, B);
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c >= 0;
    }
  }
  const x = toNum(a);
  const y = toNum(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? err(ERRORS.div0) : x / y;
    case "^": {
      const r = Math.pow(x, y);
      return Number.isFinite(r) ? r : err(ERRORS.num);
    }
  }
  return err(ERRORS.value);
}

function callFunction(node: Extract<Node, { k: "fn" }>, ctx: EvalContext): Value {
  const f = FUNCTIONS[node.name];
  if (LAZY.has(node.name)) {
    // Evaluate the condition first, then only the branch taken.
    if (node.name === "IF") {
      const cv = evaluate(node.args[0] ?? { k: "bool", v: false }, ctx);
      if (isMatrix(cv) && (cv.length > 1 || (cv[0]?.length ?? 0) > 1)) {
        // Array condition: both branches, element by element.
        const t = node.args[1] ? evaluate(node.args[1], ctx) : true;
        const e = node.args[2] ? evaluate(node.args[2], ctx) : false;
        return broadcast([cv, t, e], ([c, x, y]) => {
          const b = toBool(c);
          return isError(b) ? b : b ? x : y;
        });
      }
      const c = toBool(scalar(cv));
      if (isError(c)) return c;
      const branch = c ? node.args[1] : node.args[2];
      return branch ? evaluate(branch, ctx) : c;
    }
    if (node.name === "IFERROR" || node.name === "IFNA") {
      const v = evaluate(node.args[0], ctx);
      const s = scalar(v);
      const hit = isError(s) && (node.name === "IFERROR" || s.error === ERRORS.na);
      return hit ? (node.args[1] ? evaluate(node.args[1], ctx) : "") : v;
    }
    if (node.name === "CHOOSE") {
      const i = toNum(scalar(evaluate(node.args[0], ctx)));
      if (isError(i)) return i;
      const pick = node.args[Math.floor(i)];
      return pick ? evaluate(pick, ctx) : err(ERRORS.value);
    }
    if (node.name === "IFS") {
      for (let i = 0; i + 1 < node.args.length; i += 2) {
        const c = toBool(scalar(evaluate(node.args[i], ctx)));
        if (isError(c)) return c;
        if (c) return evaluate(node.args[i + 1], ctx);
      }
      return err(ERRORS.na);
    }
  }
  try {
    return f(
      node.args.map((a) => evaluate(a, ctx)),
      ctx,
      node.args,
    );
  } catch {
    return err(ERRORS.value);
  }
}

const HELPERS: Helpers = {
  err,
  ERRORS,
  isError,
  isLambda,
  applyLambda,
  toNum,
  toStr,
  toBool,
  scalar,
  collect,
  criterion,
  compare,
  lookupEq,
  dateToSerial,
  serialToDate,
  evaluate,
  parse: (src) => parse(src, "en"),
  formatText: (v, code) => (textFormatter ? textFormatter(v, code) : String(v ?? "")),
};
registerLibrary(FUNCTIONS, HELPERS);
registerLibrary2(FUNCTIONS, HELPERS);
// Evaluated specially in evaluate(); listed here for autocomplete and checks.
for (const n of ["LET", "LAMBDA", "ISOMITTED"]) FUNCTIONS[n] = () => err(ERRORS.value);
// Scalar functions applied to arrays work element by element (dynamic arrays).
for (const name of [...ELEMENTWISE, ...LIBRARY2_ELEMENTWISE]) {
  const f = FUNCTIONS[name];
  if (!f) continue;
  FUNCTIONS[name] = (args, ctx, raw) => {
    if (!args.some((v) => isMatrix(v) && (v.length > 1 || (v[0]?.length ?? 0) > 1))) return f(args, ctx, raw);
    return broadcast(args, (xs) => scalar(f(xs, ctx, raw)));
  };
}

/** All function names, German first, for autocomplete and the function menu. */
export const FUNCTION_CATEGORIES: { name: string; fns: string[] }[] = [
  { name: tl("Mathematik"), fns: ["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT", "PRODUCT", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS", "MOD", "POWER", "SQRT", "PI", "RAND", "RANDBETWEEN"] },
  { name: tl("Statistik"), fns: ["AVERAGE", "AVERAGEIF", "AVERAGEIFS", "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "MIN", "MAX", "MINIFS", "MAXIFS", "MEDIAN", "MODE", "STDEV", "LARGE", "SMALL", "RANK"] },
  { name: tl("Logik"), fns: ["IF", "IFS", "IFERROR", "AND", "OR", "NOT", "XOR"] },
  { name: tl("Text"), fns: ["CONCAT", "TEXTJOIN", "LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "PROPER", "TRIM", "SUBSTITUTE", "FIND", "SEARCH", "TEXT", "VALUE"] },
  { name: "Datum & Uhrzeit", fns: ["TODAY", "NOW", "DATE", "YEAR", "MONTH", "DAY", "WEEKDAY", "ISOWEEKNUM", "EDATE", "EOMONTH", "DATEDIF", "NETWORKDAYS", "WORKDAY"] },
  { name: tl("Nachschlagen"), fns: ["VLOOKUP", "HLOOKUP", "XLOOKUP", "INDEX", "MATCH", "CHOOSE", "UNIQUE", "SORT", "FILTER"] },
  { name: tl("Finanzen"), fns: ["PMT", "FV", "PV"] },
  { name: tl("Information"), fns: ["ISBLANK", "ISNUMBER", "ISTEXT", "ISERROR", "ISNA"] },
];

for (const cat of [...LIBRARY_CATEGORIES, ...LIBRARY2_CATEGORIES]) {
  const name = tl(cat.name);
  const own = FUNCTION_CATEGORIES.find((c) => c.name === name);
  if (own) own.fns.push(...cat.fns.filter((f) => !own.fns.includes(f)));
  else FUNCTION_CATEGORIES.push({ name, fns: [...cat.fns] });
}

/** Function name in the UI language (German names only in the German UI). */
export const germanName = (en: string) => (UI_FORMULA_LOCALE === "de" ? DE_NAMES[en] ?? en : en);
export const allFunctionNames = () => Object.keys(FUNCTIONS).map((en) => germanName(en));
