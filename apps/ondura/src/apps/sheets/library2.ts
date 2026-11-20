// More functions of Ondura Tabellen: complex numbers, Bessel functions,
// securities (coupons, price, yield, duration), depreciation of the French
// accounting system, exponential smoothing forecasts (FORECAST.ETS), PIVOTBY,
// TRIMRANGE and smaller additions. Registered after library.ts, so it may
// build on functions defined there (YEARFRAC, F.DIST.RT, …).

import type { EvalContext, FormulaError, Matrix, Node, Scalar, Value } from "./formula";
import type { Helpers } from "./library";

type Fn = (args: Value[], ctx: EvalContext, raw: Node[]) => Value;

export const LIBRARY2_DE: Record<string, string> = {
  COMPLEX: "KOMPLEXE", IMAGINARY: "IMAGINÄRTEIL", IMREAL: "IMREALTEIL", IMCONJUGATE: "IMKONJUGIERTE", IMCOSH: "IMCOSHYP", IMCSC: "IMCOSEC", IMCSCH: "IMCOSECHYP",
  IMPOWER: "IMAPOTENZ", IMPRODUCT: "IMPRODUKT", IMSECH: "IMSECHYP", IMSINH: "IMSINHYP", IMSQRT: "IMWURZEL", IMSUM: "IMSUMME",
  ACCRINT: "AUFGELZINS", ACCRINTM: "AUFGELZINSF", AMORDEGRC: "AMORDEGRK", AMORLINC: "AMORLINEARK",
  COUPDAYBS: "ZINSTERMTAGVA", COUPDAYS: "ZINSTERMTAGE", COUPDAYSNC: "ZINSTERMTAGNZ", COUPNCD: "ZINSTERMNZ", COUPNUM: "ZINSTERMZAHL", COUPPCD: "ZINSTERMVZ",
  DISC: "DISAGIO", INTRATE: "ZINSSATZ", PRICE: "KURS", PRICEDISC: "KURSDISAGIO", PRICEMAT: "KURSFÄLLIG", RECEIVED: "AUSZAHLUNG",
  TBILLEQ: "TBILLÄQUIV", TBILLPRICE: "TBILLKURS", TBILLYIELD: "TBILLRENDITE", YIELD: "RENDITE", YIELDDISC: "RENDITEDIS", YIELDMAT: "RENDITEFÄLL",
  "FORECAST.ETS": "PROGNOSE.ETS", "FORECAST.ETS.CONFINT": "PROGNOSE.ETS.KONFINT", "FORECAST.ETS.SEASONALITY": "PROGNOSE.ETS.SAISONALITÄT", "FORECAST.ETS.STAT": "PROGNOSE.ETS.STAT",
  HYPGEOMDIST: "HYPGEOMVERT", NEGBINOMDIST: "NEGBINOMVERT", "BINOM.DIST.RANGE": "BINOM.VERT.BEREICH",
  PIVOTBY: "PIVOTMIT", TRIMRANGE: "BEREICH.KÜRZEN", FINDB: "FINDENB", SEARCHB: "SUCHENB", REPLACEB: "ERSETZENB",
};

export const LIBRARY2_CATEGORIES: { name: string; fns: string[] }[] = [
  { name: "Finanzen", fns: ["PRICE", "YIELD", "DURATION", "MDURATION", "ACCRINT", "ACCRINTM", "COUPNUM", "COUPNCD", "COUPPCD", "DISC", "INTRATE", "TBILLPRICE", "TBILLYIELD", "AMORLINC", "EUROCONVERT"] },
  { name: "Statistik", fns: ["FORECAST.ETS", "FORECAST.ETS.CONFINT", "FORECAST.ETS.SEASONALITY", "F.TEST"] },
  { name: "Technik", fns: ["COMPLEX", "IMREAL", "IMAGINARY", "IMABS", "IMSUM", "IMPRODUCT", "IMDIV", "IMSQRT", "IMPOWER", "BESSELJ", "BESSELY", "BESSELI", "BESSELK"] },
  { name: "Nachschlagen", fns: ["PIVOTBY", "TRIMRANGE"] },
];

export const LIBRARY2_ELEMENTWISE = [
  "COMPLEX", "IMABS", "IMAGINARY", "IMARGUMENT", "IMCONJUGATE", "IMCOS", "IMCOSH", "IMCOT", "IMCSC", "IMCSCH", "IMEXP", "IMLN", "IMLOG10", "IMLOG2",
  "IMREAL", "IMSEC", "IMSECH", "IMSIN", "IMSINH", "IMSQRT", "IMTAN", "IMPOWER", "IMDIV", "IMSUB", "BESSELI", "BESSELJ", "BESSELK", "BESSELY", "ASC", "EUROCONVERT",
  "COUPDAYBS", "COUPDAYS", "COUPDAYSNC", "COUPNCD", "COUPNUM", "COUPPCD", "PRICE", "YIELD", "DURATION", "MDURATION", "DISC", "INTRATE", "RECEIVED",
  "PRICEDISC", "PRICEMAT", "YIELDDISC", "YIELDMAT", "TBILLEQ", "TBILLPRICE", "TBILLYIELD", "ACCRINTM",
];

/** Fixed conversion rates of the former euro currencies (per euro). */
const EURO_RATES: Record<string, [number, number]> = {
  EUR: [1, 2], DEM: [1.95583, 2], ATS: [13.7603, 2], BEF: [40.3399, 0], LUF: [40.3399, 0], ESP: [166.386, 0], FIM: [5.94573, 2], FRF: [6.55957, 2],
  IEP: [0.787564, 2], ITL: [1936.27, 0], NLG: [2.20371, 2], PTE: [200.482, 0], GRD: [340.75, 0], SIT: [239.64, 2], CYP: [0.585274, 2], MTL: [0.4293, 2],
  SKK: [30.126, 2], EEK: [15.6466, 2], LVL: [0.702804, 2], LTL: [3.4528, 2], HRK: [7.5345, 2],
};

type C = [number, number];

/** Simpson integration of `f` over [a, b] with `n` (even) steps. */
function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

export function registerLibrary2(F: Record<string, Fn>, h: Helpers) {
  const { err, ERRORS, isError, toNum, toStr, toBool, scalar, collect } = h;
  const isMatrix = (v: Value): v is Matrix => Array.isArray(v);
  const asMatrix = (v: Value): Matrix => (isMatrix(v) ? v : [[v]]);
  const E = (k: keyof Helpers["ERRORS"]) => err(ERRORS[k]);
  const fin = (x: number): Scalar => (Number.isFinite(x) ? x : E("num"));
  const def = (name: string, f: Fn) => (F[name] = f);
  const nums = (a: Value[], i: number, def?: number): number | FormulaError => {
    if (a[i] === undefined || a[i] === null || (a[i] === "" && def !== undefined)) return def ?? E("value");
    return toNum(scalar(a[i]));
  };
  const numeric = (defs: (number | undefined)[], f: (...x: number[]) => Scalar): Fn => (a) => {
    const xs: number[] = [];
    for (let i = 0; i < defs.length; i++) {
      const v = nums(a, i, defs[i]);
      if (isError(v)) return v;
      xs.push(v);
    }
    const r = f(...xs);
    return typeof r === "number" ? fin(r) : r;
  };
  const call = (name: string, args: Value[], ctx: EvalContext): Value => F[name](args, ctx, []);

  // ------------------------------------------------------ complex numbers --
  const parseC = (v: Scalar): { c: C; unit: string } | FormulaError => {
    if (isError(v)) return v;
    if (typeof v === "number") return { c: [v, 0], unit: "i" };
    if (typeof v === "boolean") return E("value");
    const s = String(v ?? "").replace(/\s+/g, "");
    if (s === "") return { c: [0, 0], unit: "i" };
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?(?:([+-])((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?([ij]))?$/.exec(s);
    if (m && (m[1] !== undefined || m[4])) {
      const re = m[1] !== undefined ? Number(m[1]) : 0;
      const im = m[4] ? (m[2] === "-" ? -1 : 1) * (m[3] !== undefined ? Number(m[3]) : 1) : 0;
      return { c: [re, im], unit: m[4] ?? "i" };
    }
    // Pure imaginary: "3i", "-i", "i".
    const p = /^([+-]?)((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?([ij])$/.exec(s);
    if (p) return { c: [0, (p[1] === "-" ? -1 : 1) * (p[2] !== undefined ? Number(p[2]) : 1)], unit: p[3] };
    return E("num");
  };
  const fmtN = (x: number) => {
    if (Math.abs(x) < 1e-300) return "0";
    const s = Number(x.toPrecision(15));
    return String(s).replace("e+", "E+").replace("e-", "E-");
  };
  const fmtC = ([re, im]: C, unit = "i"): Scalar => {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return E("num");
    const r = Number(re.toPrecision(15));
    const i = Number(im.toPrecision(15));
    if (i === 0) return fmtN(r);
    const is = i === 1 ? "" : i === -1 ? "-" : fmtN(i);
    if (r === 0) return `${is}${unit}`;
    return `${fmtN(r)}${i > 0 ? "+" : is === "-" ? "" : ""}${is}${unit}`;
  };
  const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cdiv = (a: C, b: C): C => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  };
  const cexp = ([x, y]: C): C => [Math.exp(x) * Math.cos(y), Math.exp(x) * Math.sin(y)];
  const cabs = ([x, y]: C) => Math.hypot(x, y);
  const carg = ([x, y]: C) => Math.atan2(y, x);
  const cln = (z: C): C => [Math.log(cabs(z)), carg(z)];
  const csin = ([x, y]: C): C => [Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y)];
  const ccos = ([x, y]: C): C => [Math.cos(x) * Math.cosh(y), -Math.sin(x) * Math.sinh(y)];
  const csinh = ([x, y]: C): C => [Math.sinh(x) * Math.cos(y), Math.cosh(x) * Math.sin(y)];
  const ccosh = ([x, y]: C): C => [Math.cosh(x) * Math.cos(y), Math.sinh(x) * Math.sin(y)];
  const inv = (z: C): C => cdiv([1, 0], z);
  const cpow = (z: C, n: number): C => {
    if (z[0] === 0 && z[1] === 0) return n > 0 ? [0, 0] : [NaN, NaN];
    const r = Math.pow(cabs(z), n);
    const t = carg(z) * n;
    return [r * Math.cos(t), r * Math.sin(t)];
  };

  const unary = (f: (z: C) => C | number, real = false): Fn => (a) => {
    const z = parseC(scalar(a[0]));
    if (isError(z)) return z;
    const r = f(z.c);
    if (typeof r === "number") return real ? fin(r) : fmtC([r, 0], z.unit);
    if (real) return fin(r[0]);
    return fmtC(r, z.unit);
  };
  def("COMPLEX", (a) => {
    const re = nums(a, 0);
    const im = nums(a, 1);
    if (isError(re)) return re;
    if (isError(im)) return im;
    const u = a[2] === undefined || a[2] === null || a[2] === "" ? "i" : toStr(scalar(a[2]));
    if (isError(u)) return u;
    if (u !== "i" && u !== "j") return E("value");
    return fmtC([re, im], u);
  });
  def("IMREAL", unary((z) => z[0], true));
  def("IMAGINARY", unary((z) => z[1], true));
  def("IMABS", unary((z) => cabs(z), true));
  def("IMARGUMENT", (a) => {
    const z = parseC(scalar(a[0]));
    if (isError(z)) return z;
    return z.c[0] === 0 && z.c[1] === 0 ? E("div0") : carg(z.c);
  });
  def("IMCONJUGATE", unary(([x, y]) => [x, -y]));
  def("IMEXP", unary(cexp));
  def("IMLN", unary((z) => cln(z)));
  def("IMLOG10", unary((z) => {
    const l = cln(z);
    return [l[0] / Math.LN10, l[1] / Math.LN10];
  }));
  def("IMLOG2", unary((z) => {
    const l = cln(z);
    return [l[0] / Math.LN2, l[1] / Math.LN2];
  }));
  def("IMSIN", unary(csin));
  def("IMCOS", unary(ccos));
  def("IMTAN", unary((z) => cdiv(csin(z), ccos(z))));
  def("IMCOT", unary((z) => cdiv(ccos(z), csin(z))));
  def("IMSEC", unary((z) => inv(ccos(z))));
  def("IMCSC", unary((z) => inv(csin(z))));
  def("IMSINH", unary(csinh));
  def("IMCOSH", unary(ccosh));
  def("IMSECH", unary((z) => inv(ccosh(z))));
  def("IMCSCH", unary((z) => inv(csinh(z))));
  def("IMSQRT", unary((z) => cpow(z, 0.5)));
  def("IMPOWER", (a) => {
    const z = parseC(scalar(a[0]));
    if (isError(z)) return z;
    const n = nums(a, 1);
    if (isError(n)) return n;
    return fmtC(cpow(z.c, n), z.unit);
  });
  const binary = (f: (x: C, y: C) => C): Fn => (a) => {
    const x = parseC(scalar(a[0]));
    const y = parseC(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(y)) return y;
    if (x.unit !== y.unit && x.c[1] !== 0 && y.c[1] !== 0) return E("value");
    return fmtC(f(x.c, y.c), x.c[1] !== 0 ? x.unit : y.unit);
  };
  def("IMSUB", binary((x, y) => [x[0] - y[0], x[1] - y[1]]));
  def("IMDIV", (a, ctx, raw) => {
    const y = parseC(scalar(a[1]));
    if (!isError(y) && y.c[0] === 0 && y.c[1] === 0) return E("num");
    return binary(cdiv)(a, ctx, raw);
  });
  const fold = (start: C, f: (acc: C, z: C) => C): Fn => (a) => {
    let acc: C = start;
    let unit = "i";
    for (const v of a) {
      for (const s of asMatrix(v).flat()) {
        if (s === null || s === "") continue;
        const z = parseC(s);
        if (isError(z)) return z;
        if (z.c[1] !== 0) unit = z.unit;
        acc = f(acc, z.c);
      }
    }
    return fmtC(acc, unit);
  };
  def("IMSUM", fold([0, 0], (x, y) => [x[0] + y[0], x[1] + y[1]]));
  def("IMPRODUCT", fold([1, 0], cmul));

  // --------------------------------------------------------------- Bessel --
  const besselJ = (x: number, n: number) => simpson((t) => Math.cos(n * t - x * Math.sin(t)), 0, Math.PI) / Math.PI;
  const besselI = (x: number, n: number) => simpson((t) => Math.exp(x * Math.cos(t)) * Math.cos(n * t), 0, Math.PI) / Math.PI;
  // Upper bound of the t integrals: where e^(-x cosh t) has died out.
  const tMax = (x: number, n: number) => Math.acosh(Math.max(1, (40 + n * 5) / x)) + 1;
  const besselY = (x: number, n: number) => {
    const a = simpson((t) => Math.sin(x * Math.sin(t) - n * t), 0, Math.PI) / Math.PI;
    const b = simpson((t) => (Math.exp(n * t) + (n % 2 ? -1 : 1) * Math.exp(-n * t)) * Math.exp(-x * Math.sinh(t)), 0, Math.asinh((50 + n * 4) / x) + 1, 4000) / Math.PI;
    return a - b;
  };
  const besselK = (x: number, n: number) => simpson((t) => Math.exp(-x * Math.cosh(t)) * Math.cosh(n * t), 0, tMax(x, n), 4000);
  const bessel = (f: (x: number, n: number) => number, positive: boolean): Fn =>
    numeric([undefined, undefined], (x, n) => {
      n = Math.trunc(n);
      if (n < 0 || (positive && x <= 0)) return E("num");
      return f(x, n);
    });
  def("BESSELJ", bessel(besselJ, false));
  def("BESSELI", bessel(besselI, false));
  def("BESSELY", bessel(besselY, true));
  def("BESSELK", bessel(besselK, true));

  // ----------------------------------------------------------- securities --
  const yf = (s: number, e: number, basis: number, ctx: EvalContext): number => {
    const v = call("YEARFRAC", [s, e, basis], ctx);
    return typeof v === "number" ? v : NaN;
  };
  const d360 = (s: number, e: number, eu: boolean, ctx: EvalContext): number => {
    const v = call("DAYS360", [s, e, eu], ctx);
    return typeof v === "number" ? v : NaN;
  };
  const addMonths = (serial: number, months: number, eom: boolean): number => {
    const d = h.serialToDate(serial);
    const m0 = d.m - 1 + months;
    const y = d.y + Math.floor(m0 / 12);
    const m = ((m0 % 12) + 12) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return h.dateToSerial(y, m + 1, eom ? last : Math.min(d.d, last));
  };
  const isEom = (serial: number) => {
    const d = h.serialToDate(serial);
    return new Date(Date.UTC(d.y, d.m, 0)).getUTCDate() === d.d;
  };
  /** Coupon dates around the settlement: previous, next and the number left. */
  const coupons = (settle: number, mat: number, freq: number) => {
    const step = 12 / freq;
    const eom = isEom(mat);
    let n = 0;
    let ncd = mat;
    let pcd = addMonths(mat, -step, eom);
    while (pcd > settle) {
      ncd = pcd;
      n++;
      pcd = addMonths(mat, -step * (n + 1), eom);
    }
    return { pcd, ncd, num: n + 1 };
  };
  const secArgs = (a: Value[], n: number): number[] | FormulaError => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = nums(a, i, i === n - 1 ? 0 : undefined);
      if (isError(v)) return v;
      out.push(v);
    }
    return out;
  };
  const checkFreq = (freq: number, basis: number) => [1, 2, 4].includes(freq) && basis >= 0 && basis <= 4;
  /** Days of the coupon period, days since its start, days to the next coupon. */
  const couponDays = (settle: number, mat: number, freq: number, basis: number, ctx: EvalContext) => {
    const { pcd, ncd, num } = coupons(settle, mat, freq);
    const E_ = basis === 1 ? ncd - pcd : basis === 3 ? 365 / freq : 360 / freq;
    const A = basis === 0 ? d360(pcd, settle, false, ctx) : basis === 4 ? d360(pcd, settle, true, ctx) : settle - pcd;
    const DSC = basis === 0 || basis === 4 ? E_ - A : ncd - settle;
    return { pcd, ncd, num, E: E_, A, DSC };
  };
  const coupon = (f: (c: ReturnType<typeof couponDays>) => number): Fn => (a, ctx) => {
    const x = secArgs(a, 4);
    if (isError(x)) return x;
    const [s, m, freq, basis] = [Math.floor(x[0]), Math.floor(x[1]), Math.trunc(x[2]), Math.trunc(x[3])];
    if (s >= m || !checkFreq(freq, basis)) return E("num");
    return fin(f(couponDays(s, m, freq, basis, ctx)));
  };
  def("COUPPCD", coupon((c) => c.pcd));
  def("COUPNCD", coupon((c) => c.ncd));
  def("COUPNUM", coupon((c) => c.num));
  def("COUPDAYS", coupon((c) => c.E));
  def("COUPDAYBS", coupon((c) => c.A));
  def("COUPDAYSNC", coupon((c) => c.DSC));

  const price = (s: number, m: number, rate: number, yld: number, red: number, freq: number, basis: number, ctx: EvalContext) => {
    const { num: N, E: E_, A, DSC } = couponDays(s, m, freq, basis, ctx);
    const c = (100 * rate) / freq;
    if (N === 1) return (red + c) / (1 + (DSC / E_) * (yld / freq)) - c * (A / E_);
    let p = red / Math.pow(1 + yld / freq, N - 1 + DSC / E_);
    for (let k = 1; k <= N; k++) p += c / Math.pow(1 + yld / freq, k - 1 + DSC / E_);
    return p - c * (A / E_);
  };
  def("PRICE", (a, ctx) => {
    const x = secArgs(a, 7);
    if (isError(x)) return x;
    const [s, m, rate, yld, red, freq, basis] = [Math.floor(x[0]), Math.floor(x[1]), x[2], x[3], x[4], Math.trunc(x[5]), Math.trunc(x[6])];
    if (s >= m || rate < 0 || yld < 0 || red <= 0 || !checkFreq(freq, basis)) return E("num");
    return fin(price(s, m, rate, yld, red, freq, basis, ctx));
  });
  def("YIELD", (a, ctx) => {
    const x = secArgs(a, 7);
    if (isError(x)) return x;
    const [s, m, rate, pr, red, freq, basis] = [Math.floor(x[0]), Math.floor(x[1]), x[2], x[3], x[4], Math.trunc(x[5]), Math.trunc(x[6])];
    if (s >= m || rate < 0 || pr <= 0 || red <= 0 || !checkFreq(freq, basis)) return E("num");
    const { num: N, E: E_, A, DSC } = couponDays(s, m, freq, basis, ctx);
    if (N === 1) {
      const c = (100 * rate) / freq;
      return fin(((red + c - (pr + c * (A / E_))) / (pr + c * (A / E_))) * ((freq * E_) / DSC));
    }
    // Bisection: the price falls as the yield rises.
    let lo = -0.99 * freq;
    let hi = 10;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (price(s, m, rate, mid, red, freq, basis, ctx) > pr) lo = mid;
      else hi = mid;
    }
    return fin((lo + hi) / 2);
  });
  const duration = (s: number, m: number, cpn: number, yld: number, freq: number, basis: number, ctx: EvalContext) => {
    const { num: N, E: E_, DSC } = couponDays(s, m, freq, basis, ctx);
    const c = (100 * cpn) / freq;
    let pv = 0;
    let t = 0;
    for (let k = 1; k <= N; k++) {
      const time = k - 1 + DSC / E_;
      const cf = c + (k === N ? 100 : 0);
      const v = cf / Math.pow(1 + yld / freq, time);
      pv += v;
      t += time * v;
    }
    return t / pv / freq;
  };
  const durFn = (modified: boolean): Fn => (a, ctx) => {
    const x = secArgs(a, 6);
    if (isError(x)) return x;
    const [s, m, cpn, yld, freq, basis] = [Math.floor(x[0]), Math.floor(x[1]), x[2], x[3], Math.trunc(x[4]), Math.trunc(x[5])];
    if (s >= m || cpn < 0 || yld < 0 || !checkFreq(freq, basis)) return E("num");
    const d = duration(s, m, cpn, yld, freq, basis, ctx);
    return fin(modified ? d / (1 + yld / freq) : d);
  };
  def("DURATION", durFn(false));
  def("MDURATION", durFn(true));

  /** Discounted securities: settlement, maturity, two values, basis. */
  const disc = (f: (s: number, m: number, x: number, y: number, t: number) => number, positive = true): Fn => (a, ctx) => {
    const v = secArgs(a, 5);
    if (isError(v)) return v;
    const [s, m, x, y, basis] = [Math.floor(v[0]), Math.floor(v[1]), v[2], v[3], Math.trunc(v[4])];
    if (s >= m || basis < 0 || basis > 4 || (positive && (x <= 0 || y <= 0))) return E("num");
    return fin(f(s, m, x, y, yf(s, m, basis, ctx)));
  };
  def("DISC", disc((_s, _m, pr, red, t) => (red - pr) / red / t));
  def("INTRATE", disc((_s, _m, inv, red, t) => (red - inv) / inv / t));
  def("RECEIVED", disc((_s, _m, inv, d, t) => inv / (1 - d * t)));
  def("PRICEDISC", disc((_s, _m, d, red, t) => red - d * red * t));
  def("YIELDDISC", disc((_s, _m, pr, red, t) => (red - pr) / pr / t));
  def("PRICEMAT", (a, ctx) => {
    const v = secArgs(a, 6);
    if (isError(v)) return v;
    const [s, m, iss, rate, yld, basis] = [Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2]), v[3], v[4], Math.trunc(v[5])];
    if (s >= m || rate < 0 || yld < 0) return E("num");
    const im = yf(iss, m, basis, ctx);
    const is = yf(iss, s, basis, ctx);
    const sm = yf(s, m, basis, ctx);
    return fin((100 + im * rate * 100) / (1 + sm * yld) - is * rate * 100);
  });
  def("YIELDMAT", (a, ctx) => {
    const v = secArgs(a, 6);
    if (isError(v)) return v;
    const [s, m, iss, rate, pr, basis] = [Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2]), v[3], v[4], Math.trunc(v[5])];
    if (s >= m || rate < 0 || pr <= 0) return E("num");
    const im = yf(iss, m, basis, ctx);
    const is = yf(iss, s, basis, ctx);
    const sm = yf(s, m, basis, ctx);
    return fin(((1 + im * rate) / (pr / 100 + is * rate) - 1) / sm);
  });
  def("ACCRINTM", (a, ctx) => {
    const v = nums(a, 0);
    const s = nums(a, 1);
    const rate = nums(a, 2);
    const par = nums(a, 3, 1000);
    const basis = nums(a, 4, 0);
    for (const x of [v, s, rate, par, basis]) if (isError(x)) return x;
    if ((v as number) >= (s as number) || (rate as number) <= 0 || (par as number) <= 0) return E("num");
    return fin((par as number) * (rate as number) * yf(v as number, s as number, Math.trunc(basis as number), ctx));
  });
  def("ACCRINT", (a, ctx) => {
    // ACCRINT(issue, first_interest, settlement, rate, par, frequency, [basis], [calc_method])
    const iss = nums(a, 0);
    const first = nums(a, 1);
    const s = nums(a, 2);
    const rate = nums(a, 3);
    const par = nums(a, 4, 1000);
    const freq = nums(a, 5);
    const basis = nums(a, 6, 0);
    for (const x of [iss, first, s, rate, par, freq, basis]) if (isError(x)) return x;
    const fromIssue = a[7] === undefined || a[7] === null || a[7] === "" ? true : toBool(scalar(a[7]));
    if (isError(fromIssue)) return fromIssue;
    if ((iss as number) >= (s as number) || (rate as number) <= 0 || (par as number) <= 0 || !checkFreq(Math.trunc(freq as number), Math.trunc(basis as number))) return E("num");
    // Without calc_method, interest runs from the last coupon before the settlement.
    let start = iss as number;
    if (!fromIssue && (s as number) > (first as number)) {
      const step = 12 / Math.trunc(freq as number);
      let c = first as number;
      while (addMonths(c, step, false) <= (s as number)) c = addMonths(c, step, false);
      start = c;
    }
    return fin((par as number) * (rate as number) * yf(start, s as number, Math.trunc(basis as number), ctx));
  });
  const tbill = (f: (dsm: number, x: number) => number): Fn => (a) => {
    const v = secArgs(a, 3);
    if (isError(v)) return v;
    const dsm = Math.floor(v[1]) - Math.floor(v[0]);
    if (dsm <= 0 || dsm > 366 || v[2] <= 0) return E("num");
    return fin(f(dsm, v[2]));
  };
  // secArgs defaults the last argument to 0, which is not wanted here.
  def("TBILLPRICE", (a, ctx, raw) => (a.length < 3 ? E("value") : tbill((dsm, d) => 100 * (1 - (d * dsm) / 360))(a, ctx, raw)));
  def("TBILLYIELD", (a, ctx, raw) => (a.length < 3 ? E("value") : tbill((dsm, pr) => ((100 - pr) / pr) * (360 / dsm))(a, ctx, raw)));
  def("TBILLEQ", (a, ctx, raw) =>
    a.length < 3
      ? E("value")
      : tbill((dsm, d) => {
          if (dsm <= 182) return (365 * d) / (360 - d * dsm);
          const p = 100 * (1 - (d * dsm) / 360);
          const t = dsm / 365;
          return (-2 * t + 2 * Math.sqrt(t * t - (2 * t - 1) * (1 - 100 / p))) / (2 * t - 1);
        })(a, ctx, raw),
  );

  // French depreciation (AMORLINC, AMORDEGRC).
  const amor = (degressive: boolean): Fn => (a, ctx) => {
    const v = secArgs(a, 7);
    if (isError(v)) return v;
    const [cost, bought, first, salvage, period, rate, basis] = [v[0], Math.floor(v[1]), Math.floor(v[2]), v[3], Math.trunc(v[4]), v[5], Math.trunc(v[6])];
    if (cost <= 0 || salvage < 0 || salvage > cost || rate <= 0 || period < 0 || basis === 2) return E("num");
    const t0 = yf(bought, first, basis, ctx);
    if (!degressive) {
      const full = cost * rate;
      const firstDep = cost * rate * t0;
      const left = cost - salvage;
      if (period === 0) return Math.min(firstDep, left);
      const after = left - firstDep;
      const n = Math.floor(after / full);
      if (period <= n) return full;
      if (period === n + 1) return Math.max(0, after - n * full);
      return 0;
    }
    const life = 1 / rate;
    const coef = life < 3 ? 1 : life < 5 ? 1.5 : life <= 6 ? 2 : 2.5;
    const r = rate * coef;
    let dep = Math.round(cost * r * t0);
    let rest = cost - dep;
    if (period === 0) return dep;
    for (let p = 1; p <= period; p++) {
      const remaining = Math.ceil(life) - p;
      if (remaining <= 1) {
        // The last two periods share what is left.
        dep = remaining === 1 ? Math.round(rest * 0.5) : remaining === 0 ? rest - salvage - Math.round(rest * 0.5) : 0;
        dep = Math.max(0, dep);
      } else dep = Math.round(rest * r);
      if (rest - dep < salvage) dep = Math.max(0, rest - salvage);
      rest -= dep;
    }
    return dep;
  };
  def("AMORLINC", amor(false));
  def("AMORDEGRC", amor(true));

  def("EUROCONVERT", (a) => {
    const n = nums(a, 0);
    if (isError(n)) return n;
    const from = toStr(scalar(a[1]));
    const to = toStr(scalar(a[2]));
    if (isError(from)) return from;
    if (isError(to)) return to;
    const A = EURO_RATES[from.toUpperCase()];
    const B = EURO_RATES[to.toUpperCase()];
    if (!A || !B) return E("value");
    const full = a[3] === undefined || a[3] === null || a[3] === "" ? false : toBool(scalar(a[3]));
    if (isError(full)) return full;
    let eur = n / A[0];
    const tri = nums(a, 4, -1);
    if (isError(tri)) return tri;
    if (tri >= 3) eur = Number(eur.toFixed(tri));
    const r = eur * B[0];
    return full ? r : Number(r.toFixed(B[1]));
  });

  // ------------------------------------------------------------ statistics --
  def("F.TEST", (a, ctx) => {
    const x = collect([a[0]]);
    const y = collect([a[1]]);
    if (isError(x)) return x;
    if (isError(y)) return y;
    if (x.length < 2 || y.length < 2) return E("div0");
    const v = (s: number[]) => {
      const m = s.reduce((p, q) => p + q, 0) / s.length;
      return s.reduce((p, q) => p + (q - m) ** 2, 0) / (s.length - 1);
    };
    const vx = v(x);
    const vy = v(y);
    if (vx === 0 || vy === 0) return E("div0");
    const p = call("F.DIST.RT", [vx / vy, x.length - 1, y.length - 1], ctx);
    if (typeof p !== "number") return p as Scalar;
    return 2 * Math.min(p, 1 - p);
  });
  F.FTEST = F["F.TEST"];
  def("HYPGEOMDIST", (a, ctx) => call("HYPGEOM.DIST", [a[0], a[1], a[2], a[3], false], ctx));
  def("NEGBINOMDIST", (a, ctx) => call("NEGBINOM.DIST", [a[0], a[1], a[2], false], ctx));
  def("BINOM.DIST.RANGE", (a) => {
    const n = nums(a, 0);
    const p = nums(a, 1);
    const s1 = nums(a, 2);
    if (isError(n)) return n;
    if (isError(p)) return p;
    if (isError(s1)) return s1;
    const s2 = nums(a, 3, s1);
    if (isError(s2)) return s2;
    const N = Math.trunc(n);
    const lo = Math.trunc(s1);
    const hi = Math.trunc(s2);
    if (p < 0 || p > 1 || lo < 0 || lo > N || hi < lo || hi > N) return E("num");
    let lc = 0; // log C(N, k)
    let sum = 0;
    for (let k = 0; k <= hi; k++) {
      if (k > 0) lc += Math.log((N - k + 1) / k);
      if (k >= lo) sum += Math.exp(lc + k * Math.log(p || 1e-300) + (N - k) * Math.log(1 - p || 1e-300));
    }
    return fin(p === 0 ? (lo === 0 ? 1 : 0) : p === 1 ? (hi === N ? 1 : 0) : sum);
  });

  // Exponential smoothing (additive Holt-Winters, AAA, as FORECAST.ETS in .xlsx files expects).
  interface Ets {
    level: number;
    trend: number;
    season: number[];
    period: number;
    alpha: number;
    beta: number;
    gamma: number;
    sse: number;
    n: number;
    fitted: number[];
    mae: number;
    rmse: number;
    smape: number;
    mase: number;
    step: number;
    last: number;
  }
  const detectSeason = (y: number[]): number => {
    const n = y.length;
    const m = y.reduce((p, q) => p + q, 0) / n;
    // Detrended autocorrelation; the first strong peak is the period.
    const d = y.map((v, i) => v - m - ((i - (n - 1) / 2) * (y[n - 1] - y[0])) / Math.max(1, n - 1));
    const c0 = d.reduce((p, q) => p + q * q, 0);
    if (c0 === 0) return 1;
    let best = 1;
    let bestR = 0.3;
    for (let lag = 2; lag <= Math.min(Math.floor(n / 2), 8760); lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += d[i] * d[i - lag];
      const r = s / c0;
      if (r > bestR) {
        bestR = r;
        best = lag;
      }
    }
    return best;
  };
  const holt = (y: number[], period: number, alpha: number, beta: number, gamma: number) => {
    const L = period > 1 ? period : 1;
    const init = Math.min(y.length, L);
    let level = y.slice(0, init).reduce((p, q) => p + q, 0) / init;
    let trend = L > 1 && y.length >= 2 * L ? (y.slice(L, 2 * L).reduce((p, q) => p + q, 0) / L - level) / L : y.length > 1 ? y[1] - y[0] : 0;
    const season = L > 1 ? y.slice(0, L).map((v) => v - level) : [0];
    let sse = 0;
    const fitted: number[] = [];
    for (let t = 0; t < y.length; t++) {
      const s = season[t % L];
      const f = level + trend + s;
      fitted.push(f);
      if (t > 0) sse += (y[t] - f) ** 2;
      const prev = level;
      level = alpha * (y[t] - s) + (1 - alpha) * (level + trend);
      trend = beta * (level - prev) + (1 - beta) * trend;
      if (L > 1) season[t % L] = gamma * (y[t] - level) + (1 - gamma) * s;
    }
    return { level, trend, season, sse, fitted };
  };
  const ets = (values: Value, timeline: Value, seasonality: number, completion: number): Ets | FormulaError => {
    const vs = asMatrix(values).flat();
    const ts = asMatrix(timeline).flat();
    if (vs.length !== ts.length || vs.length < 3) return E("na");
    const pts: [number, number | null][] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = toNum(ts[i]);
      if (isError(t)) return E("value");
      const v = vs[i] === null || vs[i] === "" ? null : toNum(vs[i]);
      if (v !== null && isError(v)) return E("value");
      pts.push([t, v as number | null]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    const diffs = pts.slice(1).map((p, i) => p[0] - pts[i][0]).filter((d) => d > 0);
    if (!diffs.length) return E("num");
    const step = diffs.sort((p, q) => p - q)[0];
    // Values on the regular grid; gaps are interpolated (or zero).
    const first = pts[0][0];
    const last = pts[pts.length - 1][0];
    const n = Math.round((last - first) / step) + 1;
    if (n > 100000) return E("num");
    const grid: (number | null)[] = Array(n).fill(null);
    for (const [t, v] of pts) {
      const i = Math.round((t - first) / step);
      if (Math.abs(first + i * step - t) > step * 1e-6) return E("num");
      if (v !== null) grid[i] = grid[i] === null ? v : (grid[i] as number) + v;
    }
    for (let i = 0; i < n; i++) {
      if (grid[i] !== null) continue;
      if (completion === 0) {
        grid[i] = 0;
        continue;
      }
      let a = i - 1;
      while (a >= 0 && grid[a] === null) a--;
      let b = i + 1;
      while (b < n && grid[b] === null) b++;
      const va = a >= 0 ? (grid[a] as number) : null;
      const vb = b < n ? (grid[b] as number) : null;
      grid[i] = va !== null && vb !== null ? va + ((vb - va) * (i - a)) / (b - a) : (va ?? vb ?? 0);
    }
    const y = grid as number[];
    const period = seasonality === 1 ? detectSeason(y) : seasonality > 1 ? Math.trunc(seasonality) : 1;
    if (period > y.length / 2 && period > 1) return E("num");
    let best: (ReturnType<typeof holt> & { alpha: number; beta: number; gamma: number }) | null = null;
    const grid1 = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
    const gridB = [0.001, 0.05, 0.1, 0.2, 0.4];
    const gridG = period > 1 ? [0.001, 0.05, 0.1, 0.3, 0.5] : [0];
    for (const alpha of grid1)
      for (const beta of gridB)
        for (const gamma of gridG) {
          const r = holt(y, period, alpha, beta, gamma);
          if (!best || r.sse < best.sse) best = { ...r, alpha, beta, gamma };
        }
    const b = best!;
    const errs = y.slice(1).map((v, i) => v - b.fitted[i + 1]);
    const mae = errs.reduce((p, q) => p + Math.abs(q), 0) / errs.length;
    const rmse = Math.sqrt(errs.reduce((p, q) => p + q * q, 0) / errs.length);
    const smape = (y.slice(1).reduce((p, v, i) => p + (Math.abs(v) + Math.abs(b.fitted[i + 1]) === 0 ? 0 : (2 * Math.abs(v - b.fitted[i + 1])) / (Math.abs(v) + Math.abs(b.fitted[i + 1]))), 0)) / errs.length;
    const naive = y.slice(1).reduce((p, v, i) => p + Math.abs(v - y[i]), 0) / (y.length - 1);
    return { ...b, period, n: y.length, mae, rmse, smape, mase: naive ? mae / naive : 0, step, last };
  };
  const etsArgs = (a: Value[], at: number) => {
    const seasonality = nums(a, at, 1);
    const completion = nums(a, at + 1, 1);
    if (isError(seasonality)) return seasonality;
    if (isError(completion)) return completion;
    if (seasonality < 0 || seasonality > 8760) return E("num");
    return { seasonality, completion };
  };
  const forecastAt = (m: Ets, target: number): number => {
    const hSteps = (target - m.last) / m.step;
    const k = Math.max(1, Math.ceil(hSteps));
    const s = m.period > 1 ? m.season[(m.n - 1 + k) % m.period] : 0;
    return m.level + hSteps * m.trend + s;
  };
  def("FORECAST.ETS", (a) => {
    const target = nums(a, 0);
    if (isError(target)) return target;
    const o = etsArgs(a, 3);
    if (isError(o)) return o;
    const m = ets(a[1], a[2], o.seasonality, o.completion);
    if (isError(m)) return m;
    if (target < m.last) return E("num");
    return fin(forecastAt(m, target));
  });
  def("FORECAST.ETS.CONFINT", (a, ctx) => {
    const target = nums(a, 0);
    if (isError(target)) return target;
    const level = nums(a, 3, 0.95);
    if (isError(level)) return level;
    if (level <= 0 || level >= 1) return E("num");
    const o = etsArgs(a, 4);
    if (isError(o)) return o;
    const m = ets(a[1], a[2], o.seasonality, o.completion);
    if (isError(m)) return m;
    const z = call("NORM.S.INV", [(1 + level) / 2], ctx);
    if (typeof z !== "number") return z as Scalar;
    const hSteps = Math.max(1, (target - m.last) / m.step);
    // Prediction variance of the additive model grows with the horizon.
    const v = 1 + (hSteps - 1) * m.alpha * m.alpha * (1 + hSteps * m.beta + (hSteps * (2 * hSteps - 1) * m.beta * m.beta) / 6);
    return fin(z * m.rmse * Math.sqrt(v));
  });
  def("FORECAST.ETS.SEASONALITY", (a) => {
    const o = etsArgs(a, 2);
    if (isError(o)) return o;
    const m = ets(a[0], a[1], o.seasonality, o.completion);
    if (isError(m)) return m;
    return m.period > 1 ? m.period : 0;
  });
  def("FORECAST.ETS.STAT", (a) => {
    const type = nums(a, 2);
    if (isError(type)) return type;
    const o = etsArgs(a, 3);
    if (isError(o)) return o;
    const m = ets(a[0], a[1], o.seasonality, o.completion);
    if (isError(m)) return m;
    const stats = [m.alpha, m.beta, m.gamma, m.mase, m.smape, m.mae, m.rmse, m.step];
    const t = Math.trunc(type);
    return t >= 1 && t <= 8 ? stats[t - 1] : E("num");
  });

  // ------------------------------------------------------------------ text --
  def("ASC", (a) => {
    const s = toStr(scalar(a[0]));
    if (isError(s)) return s;
    return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
  });
  for (const [b, base] of [["FINDB", "FIND"], ["SEARCHB", "SEARCH"], ["REPLACEB", "REPLACE"]]) if (F[base]) F[b] = F[base];
  def("INFO", (a, ctx) => {
    const t = toStr(scalar(a[0]));
    if (isError(t)) return t;
    switch (t.toLowerCase()) {
      case "directory":
        return "";
      case "numfile":
        return ctx.sheetCount ?? 1;
      case "origin":
        return "$A:$A$1";
      case "osversion":
        return typeof navigator !== "undefined" ? navigator.platform || "Ondura" : "Ondura";
      case "recalc":
        return "Automatic";
      case "release":
        return "16.0";
      case "system":
        return typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "mac" : "pcdos";
      default:
        return E("value");
    }
  });

  // -------------------------------------------------------------- arrays --
  def("TRIMRANGE", (a) => {
    const m = asMatrix(a[0]);
    const rowsMode = nums(a, 1, 3);
    const colsMode = nums(a, 2, 3);
    if (isError(rowsMode)) return rowsMode;
    if (isError(colsMode)) return colsMode;
    const blank = (v: Scalar) => v === null || v === "";
    let top = 0;
    let bottom = m.length - 1;
    let left = 0;
    let right = (m[0]?.length ?? 1) - 1;
    const rowEmpty = (r: number) => m[r].every(blank);
    const colEmpty = (c: number) => m.every((row) => blank(row[c]));
    if (rowsMode === 1 || rowsMode === 3) while (top < bottom && rowEmpty(top)) top++;
    if (rowsMode === 2 || rowsMode === 3) while (bottom > top && rowEmpty(bottom)) bottom--;
    if (colsMode === 1 || colsMode === 3) while (left < right && colEmpty(left)) left++;
    if (colsMode === 2 || colsMode === 3) while (right > left && colEmpty(right)) right--;
    return m.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
  });

  def("PIVOTBY", (a, ctx) => {
    // PIVOTBY(row_fields, col_fields, values, function, [field_headers], [row_total_depth],
    //         [row_sort_order], [col_total_depth], [col_sort_order])
    const rk = asMatrix(a[0]);
    const ck = asMatrix(a[1]);
    const vals = asMatrix(a[2]);
    const f = h.isLambda(a[3]) ? a[3] : null;
    if (!f || rk.length !== vals.length || ck.length !== vals.length) return E("value");
    const headers = nums(a, 4, 0) as number;
    const rowTotals = nums(a, 5, 1) as number;
    const rowSort = nums(a, 6, 1) as number;
    const colTotals = nums(a, 7, 1) as number;
    const colSort = nums(a, 8, 1) as number;
    const start = headers === 1 || headers === 3 ? 1 : 0;
    const key = (r: Scalar[]) => JSON.stringify(r);
    const rows = new Map<string, Scalar[]>();
    const cols = new Map<string, Scalar[]>();
    for (let i = start; i < vals.length; i++) {
      rows.set(key(rk[i]), rk[i]);
      cols.set(key(ck[i]), ck[i]);
    }
    const order = (list: Scalar[][], s: number) => (s === 0 ? list : list.sort((x, y) => h.compare(x[0] ?? null, y[0] ?? null) * (s < 0 ? -1 : 1)));
    const rlist = order([...rows.values()], rowSort);
    const clist = order([...cols.values()], colSort);
    const width = vals[0]?.length ?? 1;
    const agg = (pick: (i: number) => boolean) => {
      const out: Scalar[] = [];
      for (let c = 0; c < width; c++) {
        const sel: Matrix = [];
        for (let i = start; i < vals.length; i++) if (pick(i)) sel.push([vals[i][c]]);
        out.push(sel.length ? scalar(h.applyLambda(f, [sel], ctx)) : "");
      }
      return out;
    };
    const total = "Gesamt";
    const out: Matrix = [];
    const rkw = rlist[0]?.length ?? 1;
    // Header: column keys (one row per column field level).
    const ckw = clist[0]?.length ?? 1;
    for (let lvl = 0; lvl < ckw; lvl++) {
      const row: Scalar[] = Array(rkw).fill("");
      for (const c of clist) for (let v = 0; v < width; v++) row.push(c[lvl] ?? "");
      if (colTotals !== 0) for (let v = 0; v < width; v++) row.push(lvl === 0 ? total : "");
      out.push(row);
    }
    if (headers >= 2 && start === 1) {
      const row: Scalar[] = [...rk[0]];
      for (let i = 0; i < clist.length + (colTotals !== 0 ? 1 : 0); i++) row.push(...vals[0]);
      out.push(row);
    }
    for (const r of rlist) {
      const rkKey = key(r);
      const row: Scalar[] = [...r];
      for (const c of clist) {
        const ckKey = key(c);
        row.push(...agg((i) => key(rk[i]) === rkKey && key(ck[i]) === ckKey));
      }
      if (colTotals !== 0) row.push(...agg((i) => key(rk[i]) === rkKey));
      out.push(row);
    }
    if (rowTotals !== 0) {
      const row: Scalar[] = [total, ...Array(rkw - 1).fill("")];
      for (const c of clist) {
        const ckKey = key(c);
        row.push(...agg((i) => key(ck[i]) === ckKey));
      }
      if (colTotals !== 0) row.push(...agg(() => true));
      out.push(row);
    }
    return out;
  });
}
