// Number formats (Excel format codes, displayed with German separators)
// and parsing of typed input.

import { type Scalar, ERROR_DE, dateToSerial, formatGeneral, isError, serialToDate, setTextFormatter } from "./formula";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mrz", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export interface Formatted {
  text: string;
  color?: string;
  /** Numbers are right-aligned by default. */
  numeric: boolean;
}

const COLORS: Record<string, string> = { red: "#c00000", rot: "#c00000", blue: "#0070c0", blau: "#0070c0", green: "#00a000", grün: "#00a000", black: "#000000", schwarz: "#000000", magenta: "#c000c0", cyan: "#00a0c0", yellow: "#c0a000", white: "#ffffff" };

interface Section {
  code: string;
  color?: string;
  cond?: { op: string; v: number };
}

const cache = new Map<string, Section[]>();

function sections(code: string): Section[] {
  let s = cache.get(code);
  if (s) return s;
  const parts: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') q = !q;
    if (ch === "\\" && !q) {
      cur += ch + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === ";" && !q) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  s = parts.map((p) => {
    const sec: Section = { code: p };
    sec.code = sec.code.replace(/\[([^\]]*)\]/g, (m, inner: string) => {
      const low = inner.toLowerCase();
      if (COLORS[low]) {
        sec.color = COLORS[low];
        return "";
      }
      const cond = inner.match(/^(<=|>=|<>|<|>|=)(-?[\d.]+)$/);
      if (cond) {
        sec.cond = { op: cond[1], v: parseFloat(cond[2]) };
        return "";
      }
      // [$€-407] → "€"; [h], [mm] stay (elapsed time).
      if (inner.startsWith("$")) return `"${inner.slice(1).split("-")[0]}"`;
      if (/^[hms]+$/i.test(inner)) return m;
      return "";
    });
    return sec;
  });
  cache.set(code, s);
  return s;
}

const isDateCode = (code: string) => /(^|[^"\\])[dmyhs]/i.test(code.replace(/"[^"]*"/g, "").replace(/\\./g, "")) && !/[0#?]/.test(code.replace(/"[^"]*"/g, "").replace(/\\./g, ""));

function pad(n: number, w: number) {
  return String(n).padStart(w, "0");
}

function formatDate(v: number, code: string): string {
  const { y, m, d, wd } = serialToDate(v);
  const secs = Math.round((v - Math.floor(v)) * 86400);
  const H = Math.floor(secs / 3600) % 24;
  const M = Math.floor((secs % 3600) / 60);
  const S = secs % 60;
  const ampm = /AM\/PM|A\/P/i.test(code);
  const toks = code.match(/"[^"]*"|\\.|\[h+\]|\[m+\]|\[s+\]|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\.0+|[^"\\]/gi) ?? [];
  let out = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const low = t.toLowerCase();
    // "m" is minutes after an hour token or before a seconds token.
    const prev = toks.slice(0, i).reverse().find((x) => /^[a-z[]/i.test(x))?.toLowerCase() ?? "";
    const next = toks.slice(i + 1).find((x) => /^[a-z[]/i.test(x))?.toLowerCase() ?? "";
    const minute = (low === "m" || low === "mm") && (prev.startsWith("h") || prev.startsWith("[h") || next.startsWith("s"));
    if (t.startsWith('"')) out += t.slice(1, -1);
    else if (t.startsWith("\\")) out += t.slice(1);
    else if (/^\[h+\]$/i.test(t)) out += Math.floor(v * 24);
    else if (/^\[m+\]$/i.test(t)) out += Math.floor(v * 1440);
    else if (/^\[s+\]$/i.test(t)) out += Math.round(v * 86400);
    else if (low === "yyyy") out += y;
    else if (low === "yy") out += pad(y % 100, 2);
    else if (low === "mmmmm") out += MONTHS[m - 1][0];
    else if (low === "mmmm") out += MONTHS[m - 1];
    else if (low === "mmm") out += MONTHS_SHORT[m - 1];
    else if (minute) out += low === "mm" ? pad(M, 2) : M;
    else if (low === "mm") out += pad(m, 2);
    else if (low === "m") out += m;
    else if (low === "dddd") out += DAYS[wd];
    else if (low === "ddd") out += DAYS_SHORT[wd];
    else if (low === "dd") out += pad(d, 2);
    else if (low === "d") out += d;
    else if (low === "hh") out += pad(ampm ? H % 12 || 12 : H, 2);
    else if (low === "h") out += ampm ? H % 12 || 12 : H;
    else if (low === "ss") out += pad(S, 2);
    else if (low === "s") out += S;
    else if (low === "am/pm") out += H < 12 ? "AM" : "PM";
    else if (low === "a/p") out += H < 12 ? "A" : "P";
    else if (t.startsWith(".0")) out += "," + pad(Math.round(((v * 86400) % 1) * 10 ** (t.length - 1)), t.length - 1);
    else out += t;
  }
  return out;
}

function formatNumber(v: number, code: string): string {
  // Literal parts and the numeric pattern.
  let pct = 0;
  const plain = code.replace(/"[^"]*"|\\./g, "");
  for (const ch of plain) if (ch === "%") pct++;
  v = v * Math.pow(100, pct);
  const sci = plain.match(/[0#?.,]+E[+-]([0#]+)/i);
  const numPart = plain.match(/[0#?][0#?,.]*|\.[0#?]+/);
  if (!numPart) {
    return code.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, "");
  }
  const pattern = numPart[0];
  const [intPat, fracPat = ""] = pattern.split(".");
  const decimals = fracPat.replace(/[^0#?]/g, "").length;
  const minDecimals = fracPat.replace(/[^0]/g, "").length;
  const group = intPat.includes(",");
  // Trailing commas scale by 1000.
  const scale = (intPat.match(/,+$/)?.[0].length ?? 0) * 3;
  v = v / Math.pow(10, scale);
  let body: string;
  if (sci) {
    const exp = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)));
    const mant = v / Math.pow(10, exp);
    body = `${mant.toFixed(decimals).replace(".", ",")}E${exp < 0 ? "-" : "+"}${pad(Math.abs(exp), sci[1].length)}`;
  } else {
    const minInt = (intPat.replace(/,/g, "").match(/0/g) ?? []).length;
    let s = Math.abs(v).toFixed(decimals);
    let [ip, fp = ""] = s.split(".");
    if (decimals > minDecimals) fp = fp.replace(new RegExp(`0{1,${decimals - minDecimals}}$`), "");
    ip = ip.replace(/^0+/, "");
    if (ip.length < minInt) ip = ip.padStart(minInt, "0");
    if (group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    s = ip + (fp ? "," + fp : decimals && minDecimals ? "," : "");
    body = s;
  }
  // Re-insert literals around the number.
  const idx = code.indexOf(numPart[0]);
  const before = idx >= 0 ? code.slice(0, idx) : "";
  const after = idx >= 0 ? code.slice(idx + numPart[0].length) : "";
  const lit = (x: string) => x.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, "").replace(/E[+-][0#]+/i, "");
  return lit(before) + body + lit(after);
}

/** Format a cell value with an Excel format code. */
export function formatValue(v: Scalar, code: string | undefined | null): Formatted {
  if (v === null || v === undefined) return { text: "", numeric: false };
  if (isError(v)) return { text: ERROR_DE[v.error] ?? v.error, numeric: false };
  if (typeof v === "boolean") return { text: v ? "WAHR" : "FALSCH", numeric: false };
  const fmt = code && code !== "General" ? code : null;
  if (typeof v === "string") {
    const text = fmt ? sections(fmt)[3]?.code : undefined;
    return { text: text ? text.replace(/@/g, v).replace(/"([^"]*)"/g, "$1") : v, numeric: false };
  }
  if (!fmt) return { text: formatGeneral(v), numeric: true };
  if (fmt === "@") return { text: formatGeneral(v), numeric: false };
  const secs = sections(fmt);
  let sec = secs[0];
  let val = v;
  const conds = secs.some((s) => s.cond);
  if (conds) {
    const test = (s: Section) => {
      const c = s.cond!;
      return c.op === "<" ? v < c.v : c.op === ">" ? v > c.v : c.op === "<=" ? v <= c.v : c.op === ">=" ? v >= c.v : c.op === "=" ? v === c.v : v !== c.v;
    };
    sec = secs.find((s) => s.cond && test(s)) ?? secs.find((s) => !s.cond) ?? secs[0];
  } else if (v < 0 && secs.length > 1) {
    sec = secs[1];
    val = -v;
  } else if (v === 0 && secs.length > 2) sec = secs[2];
  const code2 = sec.code;
  if (code2.trim().toLowerCase() === "general" || code2.trim() === "") return { text: formatGeneral(val), numeric: true, color: sec.color };
  try {
    const text = isDateCode(code2) ? formatDate(val, code2) : formatNumber(val, code2);
    return { text: (v < 0 && sec === secs[0] && !isDateCode(code2) && text !== "" ? "-" : "") + text, numeric: true, color: sec.color };
  } catch {
    return { text: formatGeneral(v), numeric: true };
  }
}

setTextFormatter((v, code) => formatValue(v, code).text);

export const isDateFormat = (code: string | undefined | null) => !!code && isDateCode(sections(code)[0].code);

// ---------------------------------------------------------------- input --

export interface ParsedInput {
  v: number | string | boolean | null;
  /** Format to apply if the cell has none (e.g. a typed date). */
  numFmt?: string;
}

/** Interpret typed text the way German Excel does. */
export function parseInput(raw: string): ParsedInput {
  const s = raw.trim();
  if (raw.startsWith("'")) return { v: raw.slice(1) };
  if (s === "") return { v: null };
  const up = s.toUpperCase();
  if (up === "WAHR" || up === "TRUE") return { v: true };
  if (up === "FALSCH" || up === "FALSE") return { v: false };
  // Percent
  let m = s.match(/^([+-]?[\d.]*\d(?:,\d+)?)\s?%$/);
  if (m) {
    const n = germanNumber(m[1]);
    if (n !== null) return { v: n / 100, numFmt: m[1].includes(",") ? "0.00%" : "0%" };
  }
  // Currency
  m = s.match(/^(?:€\s?([+-]?[\d.]*\d(?:,\d+)?)|([+-]?[\d.]*\d(?:,\d+)?)\s?€)$/);
  if (m) {
    const n = germanNumber(m[1] ?? m[2]);
    if (n !== null) return { v: n, numFmt: "#,##0.00 €" };
  }
  // Number (German: 1.234,56)
  const n = germanNumber(s);
  if (n !== null) return { v: n, numFmt: /\d\.\d{3}/.test(s) ? (s.includes(",") ? "#,##0.00" : "#,##0") : undefined };
  // Dates: 18.11.2026, 18.11.26, 18.11., 2026-11-18
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += y < 30 ? 2000 : 1900;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: dateToSerial(y, mo, d), numFmt: "dd.mm.yyyy" };
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { v: dateToSerial(+m[1], +m[2], +m[3]), numFmt: "dd.mm.yyyy" };
  // Date with time
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return { v: dateToSerial(y, +m[2], +m[1]) + (+m[4] * 3600 + +m[5] * 60 + +(m[6] ?? 0)) / 86400, numFmt: "dd.mm.yyyy hh:mm" };
  }
  // Time
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return { v: (+m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0)) / 86400, numFmt: m[3] ? "hh:mm:ss" : "hh:mm" };
  return { v: raw };
}

function germanNumber(s: string): number | null {
  const t = s.replace(/\s/g, "");
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^[+-]?\d+(,\d+)?$/.test(t) || /^[+-]?,\d+$/.test(t)) return parseFloat(t.replace(/\./g, "").replace(",", "."));
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(t)) return parseFloat(t);
  return null;
}

/** Text shown in the formula bar / editor for a cell value. */
export function editText(v: Scalar, code: string | undefined | null): string {
  if (v === null) return "";
  if (typeof v === "number") {
    if (isDateFormat(code)) {
      const hasTime = /[hs]/i.test(code!.replace(/"[^"]*"/g, ""));
      const hasDate = /[dy]/i.test(code!.replace(/"[^"]*"/g, ""));
      if (hasDate && hasTime) return formatValue(v, "dd.mm.yyyy hh:mm:ss").text;
      if (hasTime) return formatValue(v, "hh:mm:ss").text;
      return formatValue(v, "dd.mm.yyyy").text;
    }
    if (code && code.includes("%")) return formatGeneral(Math.round(v * 100 * 1e10) / 1e10) + "%";
    return formatGeneral(v);
  }
  if (typeof v === "boolean") return v ? "WAHR" : "FALSCH";
  if (isError(v)) return ERROR_DE[v.error] ?? v.error;
  return v;
}

/** Change the number of decimals of a format (Dezimalstelle hinzufügen/löschen). */
export function changeDecimals(code: string | undefined | null, delta: number, sample: number): string {
  let base = code && code !== "General" ? code : null;
  if (!base) {
    const s = formatGeneral(sample);
    const decs = s.includes(",") ? s.split(",")[1].replace(/E.*/, "").length : 0;
    base = decs ? `0.${"0".repeat(decs)}` : "0";
  }
  return base
    .split(";")
    .map((sec) =>
      sec.replace(/[0#?][0#?,]*(\.[0#?]*)?/, (m: string, frac?: string) => {
        const intPart = frac ? m.slice(0, m.length - frac.length) : m;
        const n = Math.max(0, (frac ? frac.length - 1 : 0) + delta);
        return intPart + (n ? "." + "0".repeat(n) : "");
      }),
    )
    .join(";");
}

export const NUMBER_FORMATS: { id: string; label: string; code: string | null }[] = [
  { id: "general", label: "Standard", code: null },
  { id: "number", label: "Zahl", code: "#,##0.00" },
  { id: "currency", label: "Währung", code: "#,##0.00 €" },
  { id: "accounting", label: "Buchhaltung", code: '_-* #,##0.00 €_-;-* #,##0.00 €_-;_-* "-"?? €_-;_-@_-' },
  { id: "date", label: "Datum, kurz", code: "dd.mm.yyyy" },
  { id: "datelong", label: "Datum, lang", code: "dddd, d. mmmm yyyy" },
  { id: "time", label: "Uhrzeit", code: "hh:mm:ss" },
  { id: "percent", label: "Prozent", code: "0.00%" },
  { id: "fraction", label: "Bruch", code: "# ?/?" },
  { id: "scientific", label: "Wissenschaftlich", code: "0.00E+00" },
  { id: "text", label: "Text", code: "@" },
];
