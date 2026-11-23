// More Excel functions: securities with an odd first or last period
// (ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD), full-width text (DBCS/JIS),
// PHONETIC, BAHTTEXT and FILTERXML. Registered by formula.ts like the other
// libraries.

import type { EvalContext, FormulaError, Matrix, Scalar, Value } from "./formula";
import type { Helpers } from "./library";

type Fn = (args: Value[], ctx: EvalContext, raw: import("./formula").Node[]) => Value;

export const LIBRARY3_DE: Record<string, string> = { ODDFPRICE: "UNREGER.KURS", ODDFYIELD: "UNREGER.REND", ODDLPRICE: "UNREGLE.KURS", ODDLYIELD: "UNREGLE.REND", DBCS: "DBCS", PHONETIC: "PHONETIC", BAHTTEXT: "BAHTTEXT", FILTERXML: "XMLFILTERN", GETPIVOTDATA: "PIVOTDATENZUORDNEN" };

export const LIBRARY3_CATEGORIES: { name: string; fns: string[] }[] = [
  { name: "Finanzen", fns: ["ODDFPRICE", "ODDFYIELD", "ODDLPRICE", "ODDLYIELD"] },
  { name: "Nachschlagen", fns: ["GETPIVOTDATA"] },
  { name: "Text", fns: ["DBCS", "PHONETIC", "BAHTTEXT", "FILTERXML"] },
];

export const LIBRARY3_ELEMENTWISE = ["ODDFPRICE", "ODDFYIELD", "ODDLPRICE", "ODDLYIELD", "DBCS", "JIS", "BAHTTEXT"];

/** Half-width katakana → full-width (with voiced marks combined). */
const KANA: Record<string, string> = Object.fromEntries([..."｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ"].map((c, i) => [c, [..."。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜"][i]]));
const VOICED = "カキクケコサシスセソタチツテトハヒフヘホウ";
const SEMI = "ハヒフヘホ";

export function toFullWidth(s: string): string {
  let out = "";
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code === 0x20) out += "　";
    else if (code > 0x20 && code < 0x7f) out += String.fromCharCode(code + 0xfee0);
    else if (KANA[c]) {
      const k = KANA[c];
      const last = out.slice(-1);
      if (k === "゛" && VOICED.includes(last)) out = out.slice(0, -1) + (last === "ウ" ? "ヴ" : String.fromCharCode(last.charCodeAt(0) + 1));
      else if (k === "゜" && SEMI.includes(last)) out = out.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 2);
      else out += k;
    } else out += c;
  }
  return out;
}

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** A whole number in Thai words (millions repeat "ล้าน"). */
function thaiNumber(n: number): string {
  if (n === 0) return "";
  if (n >= 1_000_000) return thaiNumber(Math.floor(n / 1_000_000)) + "ล้าน" + thaiNumber(n % 1_000_000);
  const digits = String(n).split("").map(Number);
  let out = "";
  digits.forEach((d, i) => {
    const place = digits.length - 1 - i;
    if (d === 0) return;
    if (place === 1 && d === 1) out += "สิบ";
    else if (place === 1 && d === 2) out += "ยี่สิบ";
    else if (place === 0 && d === 1 && digits.length > 1) out += "เอ็ด";
    else out += THAI_DIGITS[d] + THAI_PLACES[place];
  });
  return out;
}

/** Excel's BAHTTEXT: an amount in Thai words with baht and satang. */
export function bahtText(x: number): string {
  const neg = x < 0;
  const v = Math.round(Math.abs(x) * 100);
  const baht = Math.floor(v / 100);
  const satang = v % 100;
  let out = "";
  if (baht > 0) out += thaiNumber(baht) + "บาท";
  if (satang > 0) out += thaiNumber(satang) + "สตางค์";
  else out += baht > 0 ? "ถ้วน" : "ศูนย์บาทถ้วน";
  return (neg ? "ลบ" : "") + out;
}

export function registerLibrary3(F: Record<string, Fn>, h: Helpers) {
  const { err, ERRORS, isError, toNum, toStr, scalar } = h;
  const E = (k: keyof Helpers["ERRORS"]) => err(ERRORS[k]);
  const def = (name: string, f: Fn) => (F[name] = f);
  const call = (name: string, args: Value[], ctx: EvalContext): Value => F[name](args, ctx, []);
  const fin = (x: number): Scalar => (Number.isFinite(x) ? x : E("num"));
  const numsOf = (a: Value[], n: number, defaults: (number | undefined)[] = []): number[] | FormulaError => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = a[i] === undefined || scalar(a[i]) === null ? defaults[i] : toNum(scalar(a[i]));
      if (v === undefined) return E("value");
      if (isError(v)) return v;
      out.push(v);
    }
    return out;
  };
  /** Year fraction (YEARFRAC) as a number of coupon periods. */
  const periods = (a: number, b: number, freq: number, basis: number, ctx: EvalContext) => {
    if (b <= a) return 0;
    const v = call("YEARFRAC", [a, b, basis], ctx);
    return typeof v === "number" ? v * freq : NaN;
  };
  const addMonths = (serial: number, months: number) => {
    const d = h.serialToDate(serial);
    const m0 = d.m - 1 + months;
    const y = d.y + Math.floor(m0 / 12);
    const m = ((m0 % 12) + 12) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return h.dateToSerial(y, m + 1, Math.min(d.d, last));
  };
  const checkFreq = (freq: number, basis: number) => [1, 2, 4].includes(freq) && basis >= 0 && basis <= 4;

  // Odd first period: the first coupon (on `first`) covers the time since
  // `issue`, longer or shorter than a regular period.
  const oddFirstPrice = (settle: number, mat: number, issue: number, first: number, rate: number, yld: number, red: number, freq: number, basis: number, ctx: EvalContext) => {
    const c = (100 * rate) / freq;
    const step = 12 / freq;
    const dates: number[] = [first];
    for (let k = 1; ; k++) {
      const d = addMonths(first, step * k);
      if (d >= mat - 0.5) break;
      dates.push(d);
    }
    let pv = 0;
    const disc = (d: number) => Math.pow(1 + yld / freq, periods(settle, d, freq, basis, ctx));
    pv += (c * periods(issue, first, freq, basis, ctx)) / disc(first);
    for (const d of dates.slice(1)) pv += c / disc(d);
    pv += (red + c) / disc(mat);
    return pv - c * periods(issue, settle, freq, basis, ctx);
  };
  // Odd last period: from the last coupon (`last`) to maturity.
  const oddLastPrice = (settle: number, mat: number, last: number, rate: number, yld: number, red: number, freq: number, basis: number, ctx: EvalContext) => {
    const c = (100 * rate) / freq;
    const odd = c * periods(last, mat, freq, basis, ctx);
    if (settle >= last) {
      // Within the odd period: simple interest to maturity.
      const accrued = c * periods(last, settle, freq, basis, ctx);
      return (red + odd) / (1 + (periods(settle, mat, freq, basis, ctx) * yld) / freq) - accrued;
    }
    const step = 12 / freq;
    const dates: number[] = [];
    let prev = last;
    for (let k = 0; ; k++) {
      const d = addMonths(last, -step * k);
      if (d <= settle) {
        prev = d;
        break;
      }
      dates.unshift(d);
    }
    const disc = (d: number) => Math.pow(1 + yld / freq, periods(settle, d, freq, basis, ctx));
    let pv = 0;
    for (const d of dates) pv += c / disc(d);
    pv += (red + odd) / (disc(last) * (1 + (periods(last, mat, freq, basis, ctx) * yld) / freq));
    return pv - c * periods(prev, settle, freq, basis, ctx);
  };
  /** Yield that gives `price` (bisection: the price falls as the yield rises). */
  const solve = (price: (y: number) => number, target: number) => {
    let lo = -0.99;
    let hi = 10;
    if (!(price(lo) >= target && price(hi) <= target)) return NaN;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (price(mid) > target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  def("ODDFPRICE", (a, ctx) => {
    const x = numsOf(a, 9, [, , , , , , , , 0]);
    if (isError(x)) return x;
    const [s, m, iss, fc, rate, yld, red, freq, basis] = [...x.slice(0, 4).map(Math.floor), x[4], x[5], x[6], Math.trunc(x[7]), Math.trunc(x[8])];
    if (!(m > fc && fc > s && s > iss) || rate < 0 || yld < 0 || red <= 0 || !checkFreq(freq, basis)) return E("num");
    return fin(oddFirstPrice(s, m, iss, fc, rate, yld, red, freq, basis, ctx));
  });
  def("ODDFYIELD", (a, ctx) => {
    const x = numsOf(a, 9, [, , , , , , , , 0]);
    if (isError(x)) return x;
    const [s, m, iss, fc, rate, pr, red, freq, basis] = [...x.slice(0, 4).map(Math.floor), x[4], x[5], x[6], Math.trunc(x[7]), Math.trunc(x[8])];
    if (!(m > fc && fc > s && s > iss) || rate < 0 || pr <= 0 || red <= 0 || !checkFreq(freq, basis)) return E("num");
    return fin(solve((y) => oddFirstPrice(s, m, iss, fc, rate, y, red, freq, basis, ctx), pr));
  });
  def("ODDLPRICE", (a, ctx) => {
    const x = numsOf(a, 8, [, , , , , , , 0]);
    if (isError(x)) return x;
    const [s, m, li, rate, yld, red, freq, basis] = [...x.slice(0, 3).map(Math.floor), x[3], x[4], x[5], Math.trunc(x[6]), Math.trunc(x[7])];
    if (!(m > s && m > li) || rate < 0 || yld < 0 || red <= 0 || !checkFreq(freq, basis)) return E("num");
    return fin(oddLastPrice(s, m, li, rate, yld, red, freq, basis, ctx));
  });
  def("ODDLYIELD", (a, ctx) => {
    const x = numsOf(a, 8, [, , , , , , , 0]);
    if (isError(x)) return x;
    const [s, m, li, rate, pr, red, freq, basis] = [...x.slice(0, 3).map(Math.floor), x[3], x[4], x[5], Math.trunc(x[6]), Math.trunc(x[7])];
    if (!(m > s && m > li) || rate < 0 || pr <= 0 || red <= 0 || !checkFreq(freq, basis)) return E("num");
    return fin(solve((y) => oddLastPrice(s, m, li, rate, y, red, freq, basis, ctx), pr));
  });

  const text1 =
    (f: (s: string) => string): Fn =>
    (a) => {
      const s = toStr(scalar(a[0]));
      return isError(s) ? s : f(s);
    };
  def("DBCS", text1(toFullWidth));
  F.JIS = F.DBCS;
  // Furigana are not stored with the text: PHONETIC returns the text itself.
  def("PHONETIC", (a) => {
    const v = a[0];
    const first = Array.isArray(v) ? v[0]?.[0] : v;
    const s = toStr(scalar(first as Value));
    return isError(s) ? s : s;
  });
  def("BAHTTEXT", (a) => {
    const n = toNum(scalar(a[0]));
    return isError(n) ? n : bahtText(n);
  });
  // A value of a PivotTable (as Ondura lays them out: a header row with the
  // row field in column A, column items to the right, a grand total row and
  // column "Gesamtergebnis").
  def("GETPIVOTDATA", (a, ctx, raw) => {
    const ref = raw[1];
    if (!ref || (ref.k !== "ref" && ref.k !== "range")) return E("ref");
    const sheet = ref.sheet ? ctx.sheetIndex(ref.sheet) : ctx.sheet;
    if (sheet < 0) return E("ref");
    const text = (r: number, c: number) => {
      const v = ctx.cell(sheet, r, c);
      return v === null || isError(v) ? "" : String(v).trim().toLowerCase();
    };
    const pairs: [string, string][] = [];
    for (let i = 2; i + 1 < a.length; i += 2) {
      const f = toStr(scalar(a[i]));
      const v = scalar(a[i + 1]);
      if (isError(f)) return f;
      pairs.push([f.trim().toLowerCase(), v === null ? "" : String(v).trim().toLowerCase()]);
    }
    const { rows, cols } = ctx.extent(sheet);
    // The header row: the first row (from the top) whose column A is followed
    // by values and that has a "Gesamtergebnis" row below.
    let head = -1;
    let totalRow = -1;
    for (let r = 0; r < Math.min(rows, 60) && head < 0; r++) {
      for (let r2 = r + 1; r2 < rows; r2++) {
        if (text(r2, 0) === "gesamtergebnis" || text(r2, 0) === "grand total") {
          if (text(r, 0) && text(r + 1, 0) !== "") {
            head = r;
            totalRow = r2;
          }
          break;
        }
      }
    }
    if (head < 0) return E("ref");
    const rowField = text(head, 0);
    let row = totalRow;
    let col = -1;
    const other: [string, string][] = [];
    for (const [f, v] of pairs) {
      if (f === rowField) {
        row = -1;
        for (let r = head + 1; r < totalRow; r++) if (text(r, 0) === v) row = r;
        if (row < 0) return E("ref");
      } else other.push([f, v]);
    }
    const width = Math.min(cols, 200);
    if (other.length) {
      const v = other[0][1];
      for (let c = 1; c < width; c++) if (text(head, c) === v) col = c;
      if (col < 0) return E("ref");
    } else {
      // The grand total column, or the only value column.
      for (let c = 1; c < width; c++) if (text(head, c) === "gesamtergebnis" || text(head, c) === "grand total") col = c;
      if (col < 0) col = 1;
    }
    const out = ctx.cell(sheet, row, col);
    return out === null ? E("ref") : out;
  });
  def("FILTERXML", (a) => {
    const xml = toStr(scalar(a[0]));
    const path = toStr(scalar(a[1]));
    if (isError(xml)) return xml;
    if (isError(path)) return path;
    if (typeof DOMParser === "undefined" || typeof XPathResult === "undefined") return E("value");
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    if (dom.getElementsByTagName("parsererror").length) return E("value");
    let res: XPathResult;
    try {
      res = dom.evaluate(path, dom, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch {
      return E("value");
    }
    const out: Matrix = [];
    for (let i = 0; i < res.snapshotLength; i++) {
      const t = res.snapshotItem(i)?.textContent ?? "";
      const n = Number(t);
      out.push([t.trim() !== "" && Number.isFinite(n) ? n : t]);
    }
    if (!out.length) return E("value");
    return out.length === 1 ? out[0][0] : out;
  });
}
