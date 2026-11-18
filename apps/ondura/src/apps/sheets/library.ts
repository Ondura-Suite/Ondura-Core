// Extended function library of Ondura Tabellen: statistics and
// distributions, financial math, engineering, database functions, dynamic
// arrays and lambda helpers, text and date additions. Registered into the
// engine's FUNCTIONS table by formula.ts (`registerLibrary`), which passes
// its helpers in so this module does not import engine values at load time.

import type { EvalContext, FormulaError, LambdaValue, Matrix, Node, Scalar, Value } from "./formula";

type Fn = (args: Value[], ctx: EvalContext, raw: Node[]) => Value;

export interface Helpers {
  err: (code: string) => FormulaError;
  ERRORS: Record<"div0" | "value" | "ref" | "name" | "na" | "num" | "circ" | "spill" | "calc", string>;
  isError: (v: unknown) => v is FormulaError;
  isLambda: (v: unknown) => v is LambdaValue;
  applyLambda: (l: LambdaValue, args: Value[], ctx: EvalContext) => Value;
  toNum: (v: Scalar) => number | FormulaError;
  toStr: (v: Scalar) => string | FormulaError;
  toBool: (v: Scalar) => boolean | FormulaError;
  scalar: (v: Value | undefined) => Scalar;
  collect: (args: Value[], countText?: boolean) => number[] | FormulaError;
  criterion: (c: Scalar) => (v: Scalar) => boolean;
  compare: (a: Scalar, b: Scalar) => number;
  lookupEq: (a: Scalar, b: Scalar) => boolean;
  dateToSerial: (y: number, m: number, d: number) => number;
  serialToDate: (s: number) => { y: number; m: number; d: number; wd: number };
  evaluate: (n: Node, ctx: EvalContext) => Value;
  parse: (src: string) => Node;
  formatText: (v: Scalar, code: string) => string;
}

/** German names of the functions added here. */
export const LIBRARY_DE: Record<string, string> = {
  ACOS: "ARCCOS", ACOSH: "ARCCOSHYP", ACOT: "ARCCOT", ACOTH: "ARCCOTHYP", ASIN: "ARCSIN", ASINH: "ARCSINHYP", ATAN: "ARCTAN", ATAN2: "ARCTAN2", ATANH: "ARCTANHYP",
  COSH: "COSHYP", COTH: "COTHYP", CSC: "COSEC", CSCH: "COSECHYP", SECH: "SECHYP", SINH: "SINHYP", TANH: "TANHYP",
  BASE: "BASIS", DECIMAL: "DEZIMAL", ARABIC: "ARABISCH", ROMAN: "RÖMISCH", COMBIN: "KOMBINATIONEN", COMBINA: "KOMBINATIONEN2", PERMUT: "VARIATIONEN", PERMUTATIONA: "VARIATIONEN2",
  EVEN: "GERADE", ODD: "UNGERADE", FACTDOUBLE: "ZWEIFAKULTÄT", MROUND: "VRUNDEN", MULTINOMIAL: "POLYNOMIAL", SERIESSUM: "POTENZREIHE", SQRTPI: "WURZELPI",
  SUMX2MY2: "SUMMEX2MY2", SUMX2PY2: "SUMMEX2PY2", SUMXMY2: "SUMMEXMY2", SUBTOTAL: "TEILERGEBNIS", AGGREGATE: "AGGREGAT", RANDARRAY: "ZUFALLSMATRIX",
  MDETERM: "MDET", MINVERSE: "MINV", MUNIT: "MEINHEIT", "CEILING.PRECISE": "OBERGRENZE.GENAU", "FLOOR.PRECISE": "UNTERGRENZE.GENAU", "ISO.CEILING": "ISO.OBERGRENZE",
  "CEILING.MATH": "OBERGRENZE.MATHEMATIK", "FLOOR.MATH": "UNTERGRENZE.MATHEMATIK",
  AVEDEV: "MITTELABW", CORREL: "KORREL", RSQ: "BESTIMMTHEITSMASS", COVAR: "KOVAR", "COVARIANCE.P": "KOVARIANZ.P", "COVARIANCE.S": "KOVARIANZ.S", DEVSQ: "SUMQUADABW",
  FORECAST: "SCHÄTZER", "FORECAST.LINEAR": "PROGNOSE.LINEAR", GEOMEAN: "GEOMITTEL", HARMEAN: "HARMITTEL", INTERCEPT: "ACHSENABSCHNITT", SLOPE: "STEIGUNG", STEYX: "STFEHLERYX",
  SKEW: "SCHIEFE", "SKEW.P": "SCHIEFE.P", "MODE.MULT": "MODUS.VIELF", PERCENTILE: "QUANTIL", "PERCENTILE.INC": "QUANTIL.INKL", "PERCENTILE.EXC": "QUANTIL.EXKL",
  PERCENTRANK: "QUANTILSRANG", "PERCENTRANK.INC": "QUANTILSRANG.INKL", "PERCENTRANK.EXC": "QUANTILSRANG.EXKL", "QUARTILE.INC": "QUARTILE.INKL", "QUARTILE.EXC": "QUARTILE.EXKL",
  "RANK.EQ": "RANG.GLEICH", "RANK.AVG": "RANG.MITTELW", STANDARDIZE: "STANDARDISIERUNG", STDEVA: "STABWA", STDEVPA: "STABWNA", STDEVP: "STABWN",
  VARA: "VARIANZA", VARP: "VARIANZEN", VARPA: "VARIANZENA", TRIMMEAN: "GESTUTZTMITTEL", FREQUENCY: "HÄUFIGKEIT", GROWTH: "VARIATION", LINEST: "RGP", LOGEST: "RKP",
  "NORM.DIST": "NORM.VERT", "NORM.S.DIST": "NORM.S.VERT", NORMDIST: "NORMVERT", NORMSDIST: "STANDNORMVERT", NORMSINV: "STANDNORMINV",
  "BINOM.DIST": "BINOM.VERT", BINOMDIST: "BINOMVERT", "BINOM.INV": "BINOM.INV", "POISSON.DIST": "POISSON.VERT", "EXPON.DIST": "EXPON.VERT", EXPONDIST: "EXPONVERT",
  "T.DIST": "T.VERT", "T.DIST.2T": "T.VERT.2S", "T.DIST.RT": "T.VERT.RE", "T.INV.2T": "T.INV.2S", TDIST: "TVERT",
  "CHISQ.DIST": "CHIQU.VERT", "CHISQ.DIST.RT": "CHIQU.VERT.RE", "CHISQ.INV": "CHIQU.INV", "CHISQ.INV.RT": "CHIQU.INV.RE", "CHISQ.TEST": "CHIQU.TEST", CHIDIST: "CHIVERT", CHIINV: "CHIINV",
  "F.DIST": "F.VERT", "F.DIST.RT": "F.VERT.RE", "F.INV.RT": "F.INV.RE", FDIST: "FVERT", "GAMMALN.PRECISE": "GAMMALN.GENAU", "GAMMA.DIST": "GAMMA.VERT", GAMMADIST: "GAMMAVERT",
  "BETA.DIST": "BETA.VERT", BETADIST: "BETAVERT", "LOGNORM.DIST": "LOGNORM.VERT", LOGNORMDIST: "LOGNORMVERT", "WEIBULL.DIST": "WEIBULL.VERT", WEIBULL: "WEIBULL",
  "CONFIDENCE.NORM": "KONFIDENZ.NORM", "CONFIDENCE.T": "KONFIDENZ.T", CONFIDENCE: "KONFIDENZ", "Z.TEST": "G.TEST", ZTEST: "GTEST", TTEST: "TTEST", PROB: "WAHRSCHBEREICH",
  "HYPGEOM.DIST": "HYPGEOM.VERT", "NEGBINOM.DIST": "NEGBINOM.VERT",
  NPER: "ZZR", RATE: "ZINS", IPMT: "ZINSZ", PPMT: "KAPZ", CUMIPMT: "KUMZINSZ", CUMPRINC: "KUMKAPITAL", NPV: "NBW", XNPV: "XKAPITALWERT", IRR: "IKV", XIRR: "XINTZINSFUSS",
  MIRR: "QIKV", EFFECT: "EFFEKTIV", SLN: "LIA", SYD: "DIA", DB: "GDA2", DDB: "GDA", FVSCHEDULE: "ZW2", RRI: "ZSATZINVEST", DOLLARDE: "NOTIERUNGDEZ", DOLLARFR: "NOTIERUNGBRU",
  TEXTBEFORE: "TEXTVOR", TEXTAFTER: "TEXTNACH", TEXTSPLIT: "TEXTTEILEN", UNICHAR: "UNIZEICHEN", ARRAYTOTEXT: "MATRIXZUTEXT", VALUETOTEXT: "WERTZUTEXT",
  REGEXEXTRACT: "REGEXEXTRAHIEREN", REGEXREPLACE: "REGEXERSETZEN", ENCODEURL: "URLCODIEREN", LEFTB: "LINKSB", RIGHTB: "RECHTSB", LENB: "LÄNGEB",
  DATEVALUE: "DATWERT", TIMEVALUE: "ZEITWERT", DAYS360: "TAGE360", YEARFRAC: "BRTEILJAHRE", "NETWORKDAYS.INTL": "NETTOARBEITSTAGE.INTL", "WORKDAY.INTL": "ARBEITSTAG.INTL",
  LOOKUP: "VERWEIS", XMATCH: "XVERGLEICH", OFFSET: "BEREICH.VERSCHIEBEN", INDIRECT: "INDIREKT", ADDRESS: "ADRESSE", CHOOSECOLS: "SPALTENWAHL", CHOOSEROWS: "ZEILENWAHL",
  DROP: "WEGLASSEN", TAKE: "ÜBERNEHMEN", EXPAND: "ERWEITERN", HSTACK: "HSTAPELN", VSTACK: "VSTAPELN", TOCOL: "ZUSPALTE", TOROW: "ZUZEILE", WRAPCOLS: "UMBRUCHSPALTEN",
  WRAPROWS: "UMBRUCHZEILEN", SORTBY: "SORTIERENNACH", FORMULATEXT: "FORMELTEXT", AREAS: "BEREICHE", "MULTIPLE.OPERATIONS": "MEHRFACH.OPERATIONEN",
  SWITCH: "ERSTERWERT", MAP: "ZUORDNEN", REDUCE: "REDUZIEREN", BYROW: "NACHZEILE", BYCOL: "NACHSPALTE", MAKEARRAY: "MATRIXERSTELLEN", ISOMITTED: "ISTAUSGELASSEN",
  TYPE: "TYP", "ERROR.TYPE": "FEHLER.TYP", ISNONTEXT: "ISTKTEXT", ISFORMULA: "ISTFORMEL", ISREF: "ISTBEZUG", CELL: "ZELLE", SHEET: "BLATT", SHEETS: "BLÄTTER",
  BIN2DEC: "BININDEZ", DEC2BIN: "DEZINBIN", HEX2DEC: "HEXINDEZ", DEC2HEX: "DEZINHEX", OCT2DEC: "OKTINDEZ", DEC2OCT: "DEZINOKT", BIN2HEX: "BININHEX", HEX2BIN: "HEXINBIN",
  BIN2OCT: "BININOKT", OCT2BIN: "OKTINBIN", HEX2OCT: "HEXINOKT", OCT2HEX: "OKTINHEX", BITAND: "BITUND", BITOR: "BITODER", BITXOR: "BITXODER", BITLSHIFT: "BITLVERSCHIEB",
  BITRSHIFT: "BITRVERSCHIEB", GESTEP: "GGANZZAHL", CONVERT: "UMWANDELN", ERF: "GAUSSFEHLER", ERFC: "GAUSSFKOMPL", "ERF.PRECISE": "GAUSSF.GENAU", "ERFC.PRECISE": "GAUSSFKOMPL.GENAU",
  DSUM: "DBSUMME", DAVERAGE: "DBMITTELWERT", DCOUNT: "DBANZAHL", DCOUNTA: "DBANZAHL2", DMAX: "DBMAX", DMIN: "DBMIN", DGET: "DBAUSZUG", DPRODUCT: "DBPRODUKT",
  DSTDEV: "DBSTDABW", DSTDEVP: "DBSTDABWN", DVAR: "DBVARIANZ", DVARP: "DBVARIANZEN", GROUPBY: "GRUPPIERENNACH", PERCENTOF: "PROZENTVON",
};

/** Function menu categories of the functions added here. */
export const LIBRARY_CATEGORIES: { name: string; fns: string[] }[] = [
  { name: "Mathematik", fns: ["MROUND", "EVEN", "ODD", "CEILING.MATH", "FLOOR.MATH", "COMBIN", "PERMUT", "SUBTOTAL", "AGGREGATE", "RANDARRAY", "MMULT", "MINVERSE", "MDETERM", "ROMAN", "ARABIC", "BASE", "DECIMAL", "SUMXMY2"] },
  { name: "Trigonometrie", fns: ["SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "SINH", "COSH", "TANH", "RADIANS", "DEGREES"] },
  { name: "Statistik", fns: ["CORREL", "RSQ", "SLOPE", "INTERCEPT", "FORECAST.LINEAR", "TREND", "LINEST", "PERCENTILE.INC", "QUARTILE.INC", "RANK.EQ", "STDEV.P", "VAR.S", "GEOMEAN", "TRIMMEAN", "FREQUENCY", "SKEW", "KURT"] },
  { name: "Verteilungen", fns: ["NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "T.DIST", "T.INV", "T.TEST", "CHISQ.DIST", "CHISQ.TEST", "F.DIST", "BINOM.DIST", "POISSON.DIST", "EXPON.DIST", "CONFIDENCE.NORM"] },
  { name: "Finanzen", fns: ["NPER", "RATE", "IPMT", "PPMT", "NPV", "XNPV", "IRR", "XIRR", "MIRR", "EFFECT", "NOMINAL", "SLN", "DB", "DDB", "CUMIPMT", "CUMPRINC"] },
  { name: "Text", fns: ["TEXTBEFORE", "TEXTAFTER", "TEXTSPLIT", "REGEXTEST", "REGEXEXTRACT", "REGEXREPLACE", "UNICHAR", "UNICODE", "ARRAYTOTEXT"] },
  { name: "Datum & Uhrzeit", fns: ["DATEVALUE", "TIMEVALUE", "YEARFRAC", "DAYS360", "NETWORKDAYS.INTL", "WORKDAY.INTL"] },
  { name: "Nachschlagen", fns: ["XMATCH", "LOOKUP", "OFFSET", "INDIRECT", "ADDRESS", "SORTBY", "TAKE", "DROP", "CHOOSECOLS", "CHOOSEROWS", "HSTACK", "VSTACK", "TOCOL", "TOROW", "WRAPROWS", "EXPAND", "GROUPBY"] },
  { name: "Logik", fns: ["SWITCH", "LET", "LAMBDA", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "MAKEARRAY"] },
  { name: "Datenbank", fns: ["DSUM", "DAVERAGE", "DCOUNT", "DCOUNTA", "DMAX", "DMIN", "DGET", "DPRODUCT", "DSTDEV", "DVAR"] },
  { name: "Technik", fns: ["CONVERT", "DEC2BIN", "BIN2DEC", "DEC2HEX", "HEX2DEC", "DEC2OCT", "OCT2DEC", "BITAND", "BITOR", "BITXOR", "DELTA", "GESTEP", "ERF", "ERFC"] },
  { name: "Information", fns: ["TYPE", "ERROR.TYPE", "ISFORMULA", "FORMULATEXT", "ISNONTEXT", "SHEET", "SHEETS", "CELL"] },
];

/** Functions applied element by element when given arrays (dynamic arrays). */
export const ELEMENTWISE = [
  "ABS", "INT", "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "SQRT", "LN", "LOG", "LOG10", "EXP", "SIN", "COS", "TAN", "MOD", "POWER", "SIGN", "QUOTIENT", "RADIANS", "DEGREES",
  "LEN", "LEFT", "RIGHT", "MID", "UPPER", "LOWER", "PROPER", "TRIM", "CLEAN", "SUBSTITUTE", "REPLACE", "FIND", "SEARCH", "TEXT", "VALUE", "NUMBERVALUE", "CHAR", "CODE", "EXACT", "REPT", "FIXED",
  "YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "WEEKDAY", "WEEKNUM", "ISOWEEKNUM", "DATE", "TIME", "EDATE", "EOMONTH", "DAYS", "DATEDIF",
  "ISBLANK", "ISNUMBER", "ISTEXT", "ISLOGICAL", "ISERROR", "ISERR", "ISNA", "ISEVEN", "ISODD", "N", "T", "NOT", "CEILING", "FLOOR", "FACT",
  "ACOS", "ACOSH", "ACOT", "ACOTH", "ASIN", "ASINH", "ATAN", "ATAN2", "ATANH", "COSH", "COT", "COTH", "CSC", "CSCH", "SEC", "SECH", "SINH", "TANH",
  "EVEN", "ODD", "MROUND", "CEILING.MATH", "FLOOR.MATH", "CEILING.PRECISE", "FLOOR.PRECISE", "ISO.CEILING", "ROMAN", "ARABIC", "BASE", "DECIMAL", "FACTDOUBLE", "SQRTPI", "COMBIN", "PERMUT",
  "TEXTBEFORE", "TEXTAFTER", "UNICHAR", "UNICODE", "REGEXTEST", "REGEXREPLACE", "DATEVALUE", "TIMEVALUE", "YEARFRAC", "DAYS360", "TYPE", "ISNONTEXT",
  "BIN2DEC", "DEC2BIN", "HEX2DEC", "DEC2HEX", "OCT2DEC", "DEC2OCT", "BIN2HEX", "HEX2BIN", "BIN2OCT", "OCT2BIN", "HEX2OCT", "OCT2HEX",
  "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT", "DELTA", "GESTEP", "CONVERT", "ERF", "ERFC", "ERF.PRECISE", "ERFC.PRECISE", "GAMMA", "GAMMALN", "GAMMALN.PRECISE", "FISHER", "FISHERINV", "PHI", "GAUSS",
  "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "NORMDIST", "NORMINV", "NORMSDIST", "NORMSINV", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV", "T.INV.2T", "TDIST", "TINV",
  "CHISQ.DIST", "CHISQ.DIST.RT", "CHISQ.INV", "CHISQ.INV.RT", "CHIDIST", "CHIINV", "F.DIST", "F.DIST.RT", "F.INV", "F.INV.RT", "FDIST", "FINV",
  "BINOM.DIST", "BINOMDIST", "BINOM.INV", "POISSON.DIST", "POISSON", "EXPON.DIST", "EXPONDIST", "GAMMA.DIST", "GAMMADIST", "GAMMA.INV", "GAMMAINV",
  "BETA.DIST", "BETADIST", "BETA.INV", "BETAINV", "LOGNORM.DIST", "LOGNORM.INV", "LOGNORMDIST", "LOGINV", "WEIBULL.DIST", "WEIBULL", "STANDARDIZE",
  "HYPGEOM.DIST", "NEGBINOM.DIST", "CONFIDENCE.NORM", "CONFIDENCE.T", "CONFIDENCE",
  "PMT", "FV", "PV", "NPER", "RATE", "IPMT", "PPMT", "EFFECT", "NOMINAL", "SLN", "SYD", "DB", "DDB", "PDURATION", "RRI", "ISPMT", "DOLLARDE", "DOLLARFR", "ENCODEURL",
];

// ------------------------------------------------------------ numerics --

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gammaFn(x: number): number {
  if (Number.isInteger(x) && x <= 0) return NaN;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  if (Number.isInteger(x) && x <= 171) {
    let r = 1;
    for (let i = 2; i < x; i++) r *= i;
    return r;
  }
  return Math.exp(lnGamma(x));
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 1000; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  return 1 - gammaQcf(a, x);
}

function gammaQcf(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export const erf = (x: number) => (x >= 0 ? gammaP(0.5, x * x) : -gammaP(0.5, x * x));
const erfc = (x: number) => (x >= 0 ? (x * x < 1.5 ? 1 - gammaP(0.5, x * x) : gammaQcf(0.5, x * x)) : 1 + gammaP(0.5, x * x));
export const normCdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2);
const normPdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Inverse standard normal (Acklam with a Newton step). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.928510446969, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

const tCdf = (t: number, v: number) => {
  const p = 0.5 * betaI(v / (v + t * t), v / 2, 0.5);
  return t > 0 ? 1 - p : p;
};
const chiCdf = (x: number, k: number) => gammaP(k / 2, x / 2);
const fCdf = (x: number, d1: number, d2: number) => (x <= 0 ? 0 : betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2));

/** Inverse of an increasing CDF by bracketing and bisection. */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 200 && cdf(b) < p; i++) b = b * 2 + 1;
  for (let i = 0; i < 200 && lo < 0 && cdf(a) > p; i++) a = a * 2 - 1;
  for (let i = 0; i < 300; i++) {
    const m = (a + b) / 2;
    if (cdf(m) < p) a = m;
    else b = m;
    if (Math.abs(b - a) <= 1e-15 * Math.max(1, Math.abs(m))) break;
  }
  return (a + b) / 2;
}

const lnComb = (n: number, k: number) => lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
const binomPmf = (k: number, n: number, p: number) => (p === 0 ? (k === 0 ? 1 : 0) : p === 1 ? (k === n ? 1 : 0) : Math.exp(lnComb(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)));

// ---------------------------------------------------------------- units --

const PREFIX: Record<string, number> = { Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1, d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 };
/** [category, factor to the base unit, takes metric prefixes]. */
const UNITS: Record<string, [string, number, boolean]> = {
  g: ["mass", 1, true], sg: ["mass", 14593.90294, false], lbm: ["mass", 453.59237, false], u: ["mass", 1.66053906660e-24, true], ozm: ["mass", 28.349523125, false], stone: ["mass", 6350.29318, false], ton: ["mass", 907184.74, false], uk_ton: ["mass", 1016046.9088, false], LTON: ["mass", 1016046.9088, false], brton: ["mass", 1016046.9088, false], cwt: ["mass", 45359.237, false], shweight: ["mass", 45359.237, false], uk_cwt: ["mass", 50802.34544, false], lcwt: ["mass", 50802.34544, false], hweight: ["mass", 50802.34544, false], grain: ["mass", 0.06479891, false],
  m: ["length", 1, true], mi: ["length", 1609.344, false], Nmi: ["length", 1852, false], in: ["length", 0.0254, false], ft: ["length", 0.3048, false], yd: ["length", 0.9144, false], ang: ["length", 1e-10, true], ell: ["length", 1.143, false], ly: ["length", 9.4607304725808e15, true], parsec: ["length", 3.08567758149137e16, true], pc: ["length", 3.08567758149137e16, true], Pica: ["length", 0.0254 / 72, false], Picapt: ["length", 0.0254 / 72, false], pica: ["length", 0.0254 / 6, false], survey_mi: ["length", 1609.3472186944, false],
  yr: ["time", 31557600, false], day: ["time", 86400, false], d: ["time", 86400, false], hr: ["time", 3600, false], mn: ["time", 60, false], min: ["time", 60, false], sec: ["time", 1, true], s: ["time", 1, true],
  Pa: ["pressure", 1, true], p: ["pressure", 1, true], atm: ["pressure", 101325, true], at: ["pressure", 101325, true], mmHg: ["pressure", 133.322368421, true], psi: ["pressure", 6894.75729316836, false], Torr: ["pressure", 133.322368421, false],
  N: ["force", 1, true], dyn: ["force", 1e-5, true], dy: ["force", 1e-5, true], lbf: ["force", 4.4482216152605, false], pond: ["force", 9.80665e-3, true],
  J: ["energy", 1, true], e: ["energy", 1e-7, true], c: ["energy", 4.184, true], cal: ["energy", 4.1868, true], eV: ["energy", 1.602176634e-19, true], ev: ["energy", 1.602176634e-19, true], HPh: ["energy", 2684519.53769617, false], hh: ["energy", 2684519.53769617, false], Wh: ["energy", 3600, true], wh: ["energy", 3600, true], flb: ["energy", 0.0421401100938048, false], BTU: ["energy", 1055.05585262, false], btu: ["energy", 1055.05585262, false],
  HP: ["power", 745.69987158227, false], h: ["power", 745.69987158227, false], PS: ["power", 735.49875, false], W: ["power", 1, true], w: ["power", 1, true],
  T: ["magnetism", 1, true], ga: ["magnetism", 1e-4, true],
  l: ["volume", 1e-3, true], L: ["volume", 1e-3, true], lt: ["volume", 1e-3, true], "m3": ["volume", 1, true], tsp: ["volume", 4.92892159375e-6, false], tspm: ["volume", 5e-6, false], tbs: ["volume", 1.478676478125e-5, false], oz: ["volume", 2.95735295625e-5, false], cup: ["volume", 2.365882365e-4, false], pt: ["volume", 4.73176473e-4, false], us_pt: ["volume", 4.73176473e-4, false], uk_pt: ["volume", 5.6826125e-4, false], qt: ["volume", 9.46352946e-4, false], uk_qt: ["volume", 1.1365225e-3, false], gal: ["volume", 3.785411784e-3, false], uk_gal: ["volume", 4.54609e-3, false], barrel: ["volume", 0.158987294928, false], bushel: ["volume", 0.03523907016688, false], "ft3": ["volume", 0.028316846592, false], "in3": ["volume", 1.6387064e-5, false], "yd3": ["volume", 0.764554857984, false], "mi3": ["volume", 4168181825.44058, false],
  "m2": ["area", 1, true], ha: ["area", 1e4, false], ar: ["area", 100, true], uk_acre: ["area", 4046.8564224, false], us_acre: ["area", 4046.87260987425, false], "ft2": ["area", 0.09290304, false], "in2": ["area", 6.4516e-4, false], "yd2": ["area", 0.83612736, false], "mi2": ["area", 2589988.110336, false], Morgen: ["area", 2500, false],
  bit: ["information", 1, true], byte: ["information", 8, true],
  "m/s": ["speed", 1, true], "m/sec": ["speed", 1, true], "m/h": ["speed", 1 / 3600, true], "m/hr": ["speed", 1 / 3600, true], mph: ["speed", 0.44704, false], kn: ["speed", 0.514444444444444, false], admkn: ["speed", 0.514773333333333, false],
};
function unit(u: string): [string, number] | null {
  const direct = UNITS[u];
  if (direct) return [direct[0], direct[1]];
  for (const pre of ["da", "Ki", "Mi", "Gi", "Ti", ...Object.keys(PREFIX)]) {
    if (u.startsWith(pre) && u.length > pre.length) {
      const base = u.slice(pre.length);
      const b = UNITS[base];
      if (b && b[2]) {
        // Squared and cubed units scale with the prefix squared/cubed.
        const pow = base.endsWith("2") ? 2 : base.endsWith("3") ? 3 : 1;
        return [b[0], b[1] * Math.pow(PREFIX[pre], pow)];
      }
    }
  }
  return null;
}
function convertTemp(x: number, from: string, to: string): number | null {
  const k: Record<string, [(v: number) => number, (v: number) => number]> = {
    C: [(v) => v + 273.15, (v) => v - 273.15], cel: [(v) => v + 273.15, (v) => v - 273.15],
    F: [(v) => ((v - 32) * 5) / 9 + 273.15, (v) => ((v - 273.15) * 9) / 5 + 32], fah: [(v) => ((v - 32) * 5) / 9 + 273.15, (v) => ((v - 273.15) * 9) / 5 + 32],
    K: [(v) => v, (v) => v], kel: [(v) => v, (v) => v],
    Rank: [(v) => (v * 5) / 9, (v) => (v * 9) / 5], Reau: [(v) => v * 1.25 + 273.15, (v) => (v - 273.15) * 0.8],
  };
  if (!k[from] || !k[to]) return null;
  return k[to][1](k[from][0](x));
}

// ------------------------------------------------------------- registry --

export function registerLibrary(F: Record<string, Fn>, h: Helpers) {
  const { err, ERRORS, isError, toNum, toStr, toBool, scalar, collect, criterion, compare, lookupEq, dateToSerial, serialToDate } = h;
  const isMatrix = (v: Value): v is Matrix => Array.isArray(v);
  const asMatrix = (v: Value): Matrix => (isMatrix(v) ? v : [[v]]);
  const E = (k: keyof Helpers["ERRORS"]) => err(ERRORS[k]);
  const fin = (x: number): Scalar => (Number.isFinite(x) ? x : E("num"));
  /** Numbers of the arguments, or the first error. */
  const nums = (a: Value[], i: number, def?: number): number | FormulaError => {
    if (a[i] === undefined || (a[i] === "" && def !== undefined)) return def ?? E("value");
    return toNum(scalar(a[i]));
  };
  /** Wraps a function of numeric arguments with optional defaults. */
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
  const one = (f: (x: number) => number) => numeric([undefined], (x) => f(x));
  const bool = (v: Value | undefined, def: boolean) => {
    if (v === undefined || v === "") return def;
    const b = toBool(scalar(v));
    return isError(b) ? def : b;
  };
  /** Pairs of numbers from two arrays (both numeric), for regressions. */
  const pairs = (ya: Value, xa: Value): [number[], number[]] | FormulaError => {
    const y = asMatrix(ya).flat();
    const x = asMatrix(xa).flat();
    if (x.length !== y.length) return E("na");
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < x.length; i++) {
      if (isError(x[i])) return x[i] as FormulaError;
      if (isError(y[i])) return y[i] as FormulaError;
      if (typeof x[i] === "number" && typeof y[i] === "number") (xs.push(x[i] as number), ys.push(y[i] as number));
    }
    return [ys, xs];
  };
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const sumSq = (v: number[]) => {
    const m = mean(v);
    return v.reduce((s, x) => s + (x - m) * (x - m), 0);
  };
  /** Numbers in arguments including logicals and text as in the …A functions. */
  const numsA = (a: Value[]) => {
    const out: number[] = [];
    for (const v of a) {
      for (const x of asMatrix(v).flat()) {
        if (isError(x)) return x;
        if (typeof x === "number") out.push(x);
        else if (typeof x === "boolean") out.push(x ? 1 : 0);
        else if (typeof x === "string" && isMatrix(v)) out.push(0);
        else if (typeof x === "string" && x !== "") {
          const n = toNum(x);
          if (isError(n)) return n;
          out.push(n);
        }
      }
    }
    return out;
  };
  const variance = (v: number[], sample: boolean) => (v.length - (sample ? 1 : 0) <= 0 ? E("div0") : sumSq(v) / (v.length - (sample ? 1 : 0)));
  const sorted = (a: Value): number[] | FormulaError => {
    const n = collect([a]);
    return isError(n) ? n : [...n].sort((x, y) => x - y);
  };
  const percentile = (v: number[], k: number, exclusive: boolean): Scalar => {
    const n = v.length;
    if (!n) return E("num");
    if (exclusive) {
      const pos = k * (n + 1);
      if (pos < 1 || pos > n) return E("num");
      const lo = Math.floor(pos);
      return v[lo - 1] + (pos - lo) * ((v[lo] ?? v[lo - 1]) - v[lo - 1]);
    }
    if (k < 0 || k > 1) return E("num");
    const pos = k * (n - 1);
    const lo = Math.floor(pos);
    return v[lo] + (pos - lo) * ((v[lo + 1] ?? v[lo]) - v[lo]);
  };
  const def = (name: string, f: Fn) => {
    F[name] = f;
  };
  const alias = (to: string, ...names: string[]) => names.forEach((n) => (F[n] = F[to]));

  // ------------------------------------------------------ math & trig --
  def("ACOS", one(Math.acos));
  def("ACOSH", one(Math.acosh));
  def("ACOT", one((x) => Math.PI / 2 - Math.atan(x)));
  def("ACOTH", one((x) => 0.5 * Math.log((x + 1) / (x - 1))));
  def("ASIN", one(Math.asin));
  def("ASINH", one(Math.asinh));
  def("ATAN", one(Math.atan));
  def("ATAN2", numeric([undefined, undefined], (x, y) => (x === 0 && y === 0 ? E("div0") : Math.atan2(y, x))));
  def("ATANH", one(Math.atanh));
  def("COSH", one(Math.cosh));
  def("COT", one((x) => (x === 0 ? NaN : 1 / Math.tan(x))));
  def("COTH", one((x) => (x === 0 ? NaN : 1 / Math.tanh(x))));
  def("CSC", one((x) => (x === 0 ? NaN : 1 / Math.sin(x))));
  def("CSCH", one((x) => (x === 0 ? NaN : 1 / Math.sinh(x))));
  def("SEC", one((x) => 1 / Math.cos(x)));
  def("SECH", one((x) => 1 / Math.cosh(x)));
  def("SINH", one(Math.sinh));
  def("TANH", one(Math.tanh));
  def("SQRTPI", one((x) => Math.sqrt(x * Math.PI)));
  def("EVEN", one((x) => {
    const r = Math.ceil(Math.abs(x) / 2) * 2;
    return x < 0 ? -r : r;
  }));
  def("ODD", one((x) => {
    let r = Math.ceil(Math.abs(x));
    if (r % 2 === 0) r += 1;
    return x < 0 ? -r : r;
  }));
  def("FACTDOUBLE", one((x) => {
    if (x < 0) return NaN;
    let r = 1;
    for (let i = Math.floor(x); i > 1; i -= 2) r *= i;
    return r;
  }));
  def("MROUND", numeric([undefined, undefined], (x, m) => (m === 0 ? 0 : x * m < 0 ? E("num") : Math.round(x / m + 1e-12 * Math.sign(x / m)) * m)));
  def("CEILING.PRECISE", numeric([undefined, 1], (x, s) => (s === 0 ? 0 : Math.ceil(x / Math.abs(s)) * Math.abs(s))));
  alias("CEILING.PRECISE", "ISO.CEILING");
  def("FLOOR.PRECISE", numeric([undefined, 1], (x, s) => (s === 0 ? 0 : Math.floor(x / Math.abs(s)) * Math.abs(s))));
  def("CEILING.MATH", numeric([undefined, 1, 0], (x, s, mode) => {
    if (s === 0) return 0;
    const st = Math.abs(s);
    return x < 0 && mode ? -Math.ceil(-x / st) * st : Math.ceil(x / st) * st;
  }));
  def("FLOOR.MATH", numeric([undefined, 1, 0], (x, s, mode) => {
    if (s === 0) return 0;
    const st = Math.abs(s);
    return x < 0 && mode ? -Math.floor(-x / st) * st : Math.floor(x / st) * st;
  }));
  const fact = (n: number) => Math.exp(lnGamma(n + 1));
  def("COMBIN", numeric([undefined, undefined], (n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    return n < 0 || k < 0 || k > n ? E("num") : Math.round(Math.exp(lnComb(n, k)));
  }));
  def("COMBINA", numeric([undefined, undefined], (n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    return n < 0 || k < 0 ? E("num") : n === 0 && k === 0 ? 1 : Math.round(Math.exp(lnComb(n + k - 1, k)));
  }));
  def("PERMUT", numeric([undefined, undefined], (n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    return n < 0 || k < 0 || k > n ? E("num") : Math.round(fact(n) / fact(n - k));
  }));
  def("PERMUTATIONA", numeric([undefined, undefined], (n, k) => (n < 0 || k < 0 ? E("num") : Math.pow(Math.trunc(n), Math.trunc(k)))));
  def("MULTINOMIAL", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (n.some((x) => x < 0)) return E("num");
    const ints = n.map(Math.trunc);
    return Math.round(Math.exp(lnGamma(ints.reduce((s, x) => s + x, 0) + 1) - ints.reduce((s, x) => s + lnGamma(x + 1), 0)));
  });
  def("SERIESSUM", (a) => {
    const [x, n, m] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(x)) return x;
    if (isError(n)) return n;
    if (isError(m)) return m;
    const c = collect([a[3]]);
    if (isError(c)) return c;
    return fin(c.reduce((s, ci, i) => s + ci * Math.pow(x, n + i * m), 0));
  });
  const pairSum = (f: (x: number, y: number) => number): Fn => (a) => {
    const x = asMatrix(a[0]).flat();
    const y = asMatrix(a[1]).flat();
    if (x.length !== y.length) return E("na");
    let s = 0;
    for (let i = 0; i < x.length; i++) if (typeof x[i] === "number" && typeof y[i] === "number") s += f(x[i] as number, y[i] as number);
    return s;
  };
  def("SUMX2MY2", pairSum((x, y) => x * x - y * y));
  def("SUMX2PY2", pairSum((x, y) => x * x + y * y));
  def("SUMXMY2", pairSum((x, y) => (x - y) * (x - y)));
  def("ROMAN", numeric([undefined, 0], (n) => {
    n = Math.trunc(n);
    if (n < 0 || n > 3999) return E("value");
    const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let s = "";
    for (const [v, r] of t) while (n >= v) (s += r), (n -= v);
    return s;
  }));
  def("ARABIC", (a) => {
    const s = toStr(scalar(a[0]));
    if (isError(s)) return s;
    const t = s.trim().toUpperCase();
    const neg = t.startsWith("-");
    const r = neg ? t.slice(1) : t;
    const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let n = 0;
    for (let i = 0; i < r.length; i++) {
      const c = v[r[i]];
      if (!c) return E("value");
      const nx = v[r[i + 1]] ?? 0;
      n += c < nx ? -c : c;
    }
    return neg ? -n : n;
  });
  def("BASE", numeric([undefined, undefined, 0], (n, radix, len) => {
    if (n < 0 || radix < 2 || radix > 36) return E("num");
    return Math.trunc(n).toString(Math.trunc(radix)).toUpperCase().padStart(Math.trunc(len), "0");
  }));
  def("DECIMAL", (a) => {
    const s = toStr(scalar(a[0]));
    const r = toNum(scalar(a[1]));
    if (isError(s)) return s;
    if (isError(r)) return r;
    if (r < 2 || r > 36) return E("num");
    const t = s.trim().toLowerCase();
    if (![...t].every((ch) => parseInt(ch, r) >= 0)) return E("num");
    return parseInt(t, r);
  });
  const AGG: Record<number, string> = { 1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN", 6: "PRODUCT", 7: "STDEV.S", 8: "STDEV.P", 9: "SUM", 10: "VAR.S", 11: "VAR.P", 12: "MEDIAN", 13: "MODE.SNGL", 14: "LARGE", 15: "SMALL", 16: "PERCENTILE.INC", 17: "QUARTILE.INC", 18: "PERCENTILE.EXC", 19: "QUARTILE.EXC" };
  def("SUBTOTAL", (a, ctx, raw) => {
    const n = toNum(scalar(a[0]));
    if (isError(n)) return n;
    const name = AGG[Math.trunc(n) % 100];
    if (!name || Math.trunc(n) % 100 > 11) return E("value");
    return F[name](a.slice(1), ctx, raw.slice(1));
  });
  def("AGGREGATE", (a, ctx, raw) => {
    const n = toNum(scalar(a[0]));
    const opt = toNum(scalar(a[1] ?? 0));
    if (isError(n)) return n;
    if (isError(opt)) return opt;
    const name = AGG[Math.trunc(n)];
    if (!name) return E("value");
    // Options 2, 3, 6, 7 ignore error values.
    const skipErr = [2, 3, 6, 7].includes(Math.trunc(opt));
    const clean = (v: Value): Value => (skipErr && isMatrix(v) ? v.map((r) => r.map((x) => (isError(x) ? null : x))) : v);
    const k = n >= 14 ? [a[3]] : [];
    const data = n >= 14 ? [clean(a[2])] : a.slice(2).map(clean);
    return F[name]([...data, ...k], ctx, raw.slice(2));
  });
  def("RANDARRAY", (a) => {
    const [rows, cols, min, max] = [nums(a, 0, 1), nums(a, 1, 1), nums(a, 2, 0), nums(a, 3, 1)];
    for (const v of [rows, cols, min, max]) if (isError(v)) return v;
    const whole = bool(a[4], false);
    const out: Matrix = [];
    for (let r = 0; r < (rows as number); r++) {
      const row: Scalar[] = [];
      for (let c = 0; c < (cols as number); c++) {
        const x = (min as number) + Math.random() * ((max as number) - (min as number) + (whole ? 1 : 0));
        row.push(whole ? Math.floor(x) : x);
      }
      out.push(row);
    }
    return out;
  });
  const numMatrix = (v: Value): number[][] | FormulaError => {
    const m = asMatrix(v);
    const out: number[][] = [];
    for (const r of m) {
      const row: number[] = [];
      for (const x of r) {
        if (typeof x !== "number") return isError(x) ? x : E("value");
        row.push(x);
      }
      out.push(row);
    }
    return out;
  };
  def("MMULT", (a) => {
    const x = numMatrix(a[0]);
    const y = numMatrix(a[1]);
    if (isError(x)) return x;
    if (isError(y)) return y;
    if ((x[0]?.length ?? 0) !== y.length) return E("value");
    return x.map((r) => y[0].map((_, j) => r.reduce((s, v, k) => s + v * y[k][j], 0)));
  });
  const det = (m: number[][]): number => {
    const n = m.length;
    const a = m.map((r) => [...r]);
    let d = 1;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
      if (a[p][i] === 0) return 0;
      if (p !== i) ([a[p], a[i]] = [a[i], a[p]]), (d = -d);
      d *= a[i][i];
      for (let r = i + 1; r < n; r++) {
        const f = a[r][i] / a[i][i];
        for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
      }
    }
    return d;
  };
  def("MDETERM", (a) => {
    const m = numMatrix(a[0]);
    if (isError(m)) return m;
    if (m.some((r) => r.length !== m.length)) return E("value");
    return det(m);
  });
  def("MINVERSE", (a) => {
    const m = numMatrix(a[0]);
    if (isError(m)) return m;
    const n = m.length;
    if (m.some((r) => r.length !== n)) return E("value");
    const aug = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(aug[r][i]) > Math.abs(aug[p][i])) p = r;
      if (Math.abs(aug[p][i]) < 1e-15) return E("num");
      [aug[p], aug[i]] = [aug[i], aug[p]];
      const d = aug[i][i];
      for (let c = 0; c < 2 * n; c++) aug[i][c] /= d;
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const f = aug[r][i];
        for (let c = 0; c < 2 * n; c++) aug[r][c] -= f * aug[i][c];
      }
    }
    return aug.map((r) => r.slice(n));
  });
  def("MUNIT", (a) => {
    const n = toNum(scalar(a[0]));
    if (isError(n)) return n;
    if (n < 1) return E("value");
    return Array.from({ length: Math.trunc(n) }, (_, i) => Array.from({ length: Math.trunc(n) }, (_, j) => (i === j ? 1 : 0)));
  });

  // -------------------------------------------------------- statistics --
  def("AVEDEV", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (!n.length) return E("num");
    const m = mean(n);
    return n.reduce((s, x) => s + Math.abs(x - m), 0) / n.length;
  });
  def("DEVSQ", (a) => {
    const n = collect(a);
    return isError(n) ? n : n.length ? sumSq(n) : 0;
  });
  def("GEOMEAN", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (!n.length || n.some((x) => x <= 0)) return E("num");
    return Math.exp(n.reduce((s, x) => s + Math.log(x), 0) / n.length);
  });
  def("HARMEAN", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    if (!n.length || n.some((x) => x <= 0)) return E("num");
    return n.length / n.reduce((s, x) => s + 1 / x, 0);
  });
  const varFn = (sample: boolean, withText: boolean, root: boolean): Fn => (a) => {
    const n = withText ? numsA(a) : collect(a);
    if (isError(n)) return n;
    const v = variance(n, sample);
    return isError(v) ? v : root ? Math.sqrt(v) : v;
  };
  def("VAR.S", varFn(true, false, false));
  def("VAR.P", varFn(false, false, false));
  def("VARA", varFn(true, true, false));
  def("VARPA", varFn(false, true, false));
  def("STDEVA", varFn(true, true, true));
  def("STDEVPA", varFn(false, true, true));
  alias("VAR.P", "VARP");
  if (!F["STDEV.P"]) def("STDEV.P", varFn(false, false, true));
  alias("STDEV.P", "STDEVP");
  def("KURT", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const N = n.length;
    if (N < 4) return E("div0");
    const m = mean(n);
    const s = Math.sqrt(sumSq(n) / (N - 1));
    if (s === 0) return E("div0");
    const k = n.reduce((t, x) => t + Math.pow((x - m) / s, 4), 0);
    return ((N * (N + 1)) / ((N - 1) * (N - 2) * (N - 3))) * k - (3 * (N - 1) * (N - 1)) / ((N - 2) * (N - 3));
  });
  def("SKEW", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const N = n.length;
    if (N < 3) return E("div0");
    const m = mean(n);
    const s = Math.sqrt(sumSq(n) / (N - 1));
    if (s === 0) return E("div0");
    return (N / ((N - 1) * (N - 2))) * n.reduce((t, x) => t + Math.pow((x - m) / s, 3), 0);
  });
  def("SKEW.P", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const N = n.length;
    if (N < 1) return E("div0");
    const m = mean(n);
    const s = Math.sqrt(sumSq(n) / N);
    if (s === 0) return E("div0");
    return n.reduce((t, x) => t + Math.pow((x - m) / s, 3), 0) / N;
  });
  def("STANDARDIZE", numeric([undefined, undefined, undefined], (x, m, s) => (s <= 0 ? E("num") : (x - m) / s)));
  const reg = (a: Value[]) => {
    const p = pairs(a[0], a[1]);
    if (isError(p)) return p;
    const [y, x] = p;
    if (x.length < 2) return E("div0");
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < x.length; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) ** 2;
      syy += (y[i] - my) ** 2;
    }
    return { x, y, mx, my, sxy, sxx, syy, n: x.length };
  };
  def("SLOPE", (a) => {
    const r = reg(a);
    if (isError(r)) return r;
    return r.sxx === 0 ? E("div0") : r.sxy / r.sxx;
  });
  def("INTERCEPT", (a) => {
    const r = reg(a);
    if (isError(r)) return r;
    return r.sxx === 0 ? E("div0") : r.my - (r.sxy / r.sxx) * r.mx;
  });
  def("CORREL", (a) => {
    const r = reg(a);
    if (isError(r)) return r;
    return r.sxx === 0 || r.syy === 0 ? E("div0") : r.sxy / Math.sqrt(r.sxx * r.syy);
  });
  alias("CORREL", "PEARSON");
  def("RSQ", (a) => {
    const r = reg(a);
    if (isError(r)) return r;
    return r.sxx === 0 || r.syy === 0 ? E("div0") : (r.sxy * r.sxy) / (r.sxx * r.syy);
  });
  def("STEYX", (a) => {
    const r = reg(a);
    if (isError(r)) return r;
    if (r.n < 3 || r.sxx === 0) return E("div0");
    return Math.sqrt((r.syy - (r.sxy * r.sxy) / r.sxx) / (r.n - 2));
  });
  def("COVARIANCE.P", (a) => {
    const r = reg([a[1], a[0]]);
    return isError(r) ? r : r.sxy / r.n;
  });
  alias("COVARIANCE.P", "COVAR");
  def("COVARIANCE.S", (a) => {
    const r = reg([a[1], a[0]]);
    return isError(r) ? r : r.sxy / (r.n - 1);
  });
  def("FORECAST.LINEAR", (a) => {
    const x0 = toNum(scalar(a[0]));
    if (isError(x0)) return x0;
    const r = reg([a[1], a[2]]);
    if (isError(r)) return r;
    if (r.sxx === 0) return E("div0");
    const b = r.sxy / r.sxx;
    return r.my - b * r.mx + b * x0;
  });
  alias("FORECAST.LINEAR", "FORECAST");
  /** Least squares for y = b0 + b·x with several x columns (normal equations). */
  const linest = (yv: Value, xv: Value | undefined, constant: boolean, log: boolean) => {
    const y = numMatrix(yv);
    if (isError(y)) return y;
    const ys = y.flat().map((v) => (log ? Math.log(v) : v));
    if (ys.some((v) => !Number.isFinite(v))) return E("num");
    const n = ys.length;
    let X: number[][];
    if (xv === undefined || xv === "") X = ys.map((_, i) => [i + 1]);
    else {
      const xm = numMatrix(xv);
      if (isError(xm)) return xm;
      // One x per observation: columns if y is a column, rows otherwise.
      const yCol = y.length === n;
      X = yCol ? xm : xm[0].map((_, j) => xm.map((r) => r[j]));
      if (X.length !== n) return E("ref");
    }
    const k = X[0].length;
    const A = X.map((r) => (constant ? [...r, 1] : r));
    const p = A[0].length;
    const AtA = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
    const Aty = Array.from({ length: p }, (_, i) => A.reduce((s, r, t) => s + r[i] * ys[t], 0));
    // Gauss-Jordan
    const M = AtA.map((r, i) => [...r, Aty[i]]);
    for (let i = 0; i < p; i++) {
      let piv = i;
      for (let r = i + 1; r < p; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      if (Math.abs(M[piv][i]) < 1e-12) return E("num");
      [M[piv], M[i]] = [M[i], M[piv]];
      const d = M[i][i];
      for (let c = i; c <= p; c++) M[i][c] /= d;
      for (let r = 0; r < p; r++) if (r !== i) {
        const f = M[r][i];
        for (let c = i; c <= p; c++) M[r][c] -= f * M[i][c];
      }
    }
    const coef = M.map((r) => r[p]);
    const slopes = coef.slice(0, k);
    const b0 = constant ? coef[k] : 0;
    return { slopes, b0, X, ys, n, k };
  };
  def("LINEST", (a) => {
    const r = linest(a[0], a[1], bool(a[2], true), false);
    if (isError(r)) return r;
    // Excel lists the slopes in reverse order, the constant last.
    return [[...[...r.slopes].reverse(), r.b0]];
  });
  def("LOGEST", (a) => {
    const r = linest(a[0], a[1], bool(a[2], true), true);
    if (isError(r)) return r;
    return [[...[...r.slopes].reverse().map(Math.exp), Math.exp(r.b0)]];
  });
  const trend = (log: boolean): Fn => (a) => {
    const r = linest(a[0], a[1], bool(a[3], true), log);
    if (isError(r)) return r;
    let newX: number[][];
    if (a[2] === undefined || a[2] === "") newX = r.X;
    else {
      const m = numMatrix(a[2]);
      if (isError(m)) return m;
      newX = r.k === 1 ? m.flat().map((v) => [v]) : m;
    }
    const out = newX.map((row) => {
      const v = r.b0 + row.reduce((s, x, i) => s + x * r.slopes[i], 0);
      return log ? Math.exp(v) : v;
    });
    const shapeOf = a[2] !== undefined && a[2] !== "" ? asMatrix(a[2]) : asMatrix(a[0]);
    return shapeOf.length === 1 && r.k === 1 ? [out] : out.map((v) => [v]);
  };
  def("TREND", trend(false));
  def("GROWTH", trend(true));
  def("PERCENTILE.INC", (a) => {
    const v = sorted(a[0]);
    const k = toNum(scalar(a[1]));
    if (isError(v)) return v;
    if (isError(k)) return k;
    return percentile(v, k, false);
  });
  alias("PERCENTILE.INC", "PERCENTILE");
  def("PERCENTILE.EXC", (a) => {
    const v = sorted(a[0]);
    const k = toNum(scalar(a[1]));
    if (isError(v)) return v;
    if (isError(k)) return k;
    return percentile(v, k, true);
  });
  def("QUARTILE.INC", (a) => {
    const v = sorted(a[0]);
    const q = toNum(scalar(a[1]));
    if (isError(v)) return v;
    if (isError(q)) return q;
    const k = Math.trunc(q);
    return k < 0 || k > 4 ? E("num") : percentile(v, k / 4, false);
  });
  alias("QUARTILE.INC", "QUARTILE");
  def("QUARTILE.EXC", (a) => {
    const v = sorted(a[0]);
    const q = toNum(scalar(a[1]));
    if (isError(v)) return v;
    if (isError(q)) return q;
    const k = Math.trunc(q);
    return k < 1 || k > 3 ? E("num") : percentile(v, k / 4, true);
  });
  const prank = (exclusive: boolean): Fn => (a) => {
    const v = sorted(a[0]);
    const x = toNum(scalar(a[1]));
    const sig = nums(a, 2, 3);
    if (isError(v)) return v;
    if (isError(x)) return x;
    if (isError(sig)) return sig;
    const n = v.length;
    if (!n || x < v[0] || x > v[n - 1]) return E("na");
    let i = 0;
    while (i < n - 1 && v[i + 1] <= x) i++;
    // Position of x (interpolated) among the sorted values.
    const pos = v[i] === x ? v.indexOf(x) : i + (x - v[i]) / (v[i + 1] - v[i]);
    const r = exclusive ? (pos + 1) / (n + 1) : n === 1 ? 1 : pos / (n - 1);
    const f = Math.pow(10, Math.trunc(sig));
    return Math.floor(r * f + 1e-9) / f;
  };
  def("PERCENTRANK.INC", prank(false));
  alias("PERCENTRANK.INC", "PERCENTRANK");
  def("PERCENTRANK.EXC", prank(true));
  const rankFn = (avg: boolean): Fn => (a) => {
    const x = toNum(scalar(a[0]));
    const v = collect([a[1]]);
    if (isError(x)) return x;
    if (isError(v)) return v;
    const asc = bool(a[2], false);
    if (!v.includes(x)) return E("na");
    const better = v.filter((y) => (asc ? y < x : y > x)).length;
    const same = v.filter((y) => y === x).length;
    return avg ? better + (same + 1) / 2 : better + 1;
  };
  def("RANK.EQ", rankFn(false));
  def("RANK.AVG", rankFn(true));
  def("TRIMMEAN", (a) => {
    const v = sorted(a[0]);
    const p = toNum(scalar(a[1]));
    if (isError(v)) return v;
    if (isError(p)) return p;
    if (p < 0 || p >= 1) return E("num");
    const cut = Math.floor((v.length * p) / 2);
    const rest = v.slice(cut, v.length - cut);
    return rest.length ? mean(rest) : E("num");
  });
  def("MODE.MULT", (a) => {
    const n = collect(a);
    if (isError(n)) return n;
    const counts = new Map<number, number>();
    for (const x of n) counts.set(x, (counts.get(x) ?? 0) + 1);
    const max = Math.max(0, ...counts.values());
    if (max < 2) return E("na");
    return [...counts].filter(([, c]) => c === max).map(([x]) => [x]);
  });
  def("FREQUENCY", (a) => {
    const data = collect([a[0]]);
    const bins = collect([a[1]]);
    if (isError(data)) return data;
    if (isError(bins)) return bins;
    const order = bins.map((b, i) => [b, i] as const).sort((x, y) => x[0] - y[0]);
    const out = new Array(bins.length + 1).fill(0);
    for (const d of data) {
      const hit = order.find(([b]) => d <= b);
      out[hit ? hit[1] : bins.length]++;
    }
    return out.map((v) => [v]);
  });
  def("PROB", (a) => {
    const x = collect([a[0]]);
    const p = collect([a[1]]);
    if (isError(x)) return x;
    if (isError(p)) return p;
    const lo = toNum(scalar(a[2]));
    if (isError(lo)) return lo;
    const hi = a[3] === undefined ? lo : toNum(scalar(a[3]));
    if (isError(hi)) return hi;
    if (x.length !== p.length) return E("na");
    if (Math.abs(p.reduce((s, v) => s + v, 0) - 1) > 1e-9) return E("num");
    return x.reduce((s, v, i) => s + (v >= lo && v <= hi ? p[i] : 0), 0);
  });

  // ----------------------------------------------------- distributions --
  def("GAMMA", one((x) => gammaFn(x)));
  def("GAMMALN", one((x) => (x <= 0 ? NaN : lnGamma(x))));
  alias("GAMMALN", "GAMMALN.PRECISE");
  def("ERF", (a) => {
    const lo = toNum(scalar(a[0]));
    if (isError(lo)) return lo;
    if (a[1] === undefined) return erf(lo);
    const hi = toNum(scalar(a[1]));
    return isError(hi) ? hi : erf(hi) - erf(lo);
  });
  def("ERF.PRECISE", one(erf));
  def("ERFC", one(erfc));
  alias("ERFC", "ERFC.PRECISE");
  def("PHI", one(normPdf));
  def("GAUSS", one((z) => normCdf(z) - 0.5));
  def("FISHER", one((x) => (x <= -1 || x >= 1 ? NaN : 0.5 * Math.log((1 + x) / (1 - x)))));
  def("FISHERINV", one((y) => Math.tanh(y)));
  def("NORM.S.DIST", (a) => {
    const z = toNum(scalar(a[0]));
    if (isError(z)) return z;
    return bool(a[1], true) ? normCdf(z) : normPdf(z);
  });
  def("NORMSDIST", one(normCdf));
  def("NORM.S.INV", one((p) => (p <= 0 || p >= 1 ? NaN : normInv(p))));
  alias("NORM.S.INV", "NORMSINV");
  def("NORM.DIST", (a) => {
    const [x, m, s] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(x)) return x;
    if (isError(m)) return m;
    if (isError(s)) return s;
    if (s <= 0) return E("num");
    const z = (x - m) / s;
    return bool(a[3], false) ? normCdf(z) : normPdf(z) / s;
  });
  alias("NORM.DIST", "NORMDIST");
  def("NORM.INV", numeric([undefined, undefined, undefined], (p, m, s) => (p <= 0 || p >= 1 || s <= 0 ? E("num") : m + s * normInv(p))));
  alias("NORM.INV", "NORMINV");
  def("LOGNORM.DIST", (a) => {
    const [x, m, s] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(x)) return x;
    if (isError(m)) return m;
    if (isError(s)) return s;
    if (x <= 0 || s <= 0) return E("num");
    const z = (Math.log(x) - m) / s;
    return bool(a[3], false) ? normCdf(z) : normPdf(z) / (x * s);
  });
  def("LOGNORMDIST", numeric([undefined, undefined, undefined], (x, m, s) => (x <= 0 || s <= 0 ? E("num") : normCdf((Math.log(x) - m) / s))));
  def("LOGNORM.INV", numeric([undefined, undefined, undefined], (p, m, s) => (p <= 0 || p >= 1 || s <= 0 ? E("num") : Math.exp(m + s * normInv(p)))));
  alias("LOGNORM.INV", "LOGINV");
  def("T.DIST", (a) => {
    const t = toNum(scalar(a[0]));
    const v = toNum(scalar(a[1]));
    if (isError(t)) return t;
    if (isError(v)) return v;
    if (v < 1) return E("num");
    if (bool(a[2], false)) return tCdf(t, v);
    return Math.exp(lnGamma((v + 1) / 2) - lnGamma(v / 2)) / Math.sqrt(v * Math.PI) * Math.pow(1 + (t * t) / v, -(v + 1) / 2);
  });
  def("T.DIST.RT", numeric([undefined, undefined], (t, v) => (v < 1 ? E("num") : 1 - tCdf(t, v))));
  def("T.DIST.2T", numeric([undefined, undefined], (t, v) => (v < 1 || t < 0 ? E("num") : 2 * (1 - tCdf(t, v)))));
  def("TDIST", numeric([undefined, undefined, undefined], (t, v, tails) => (v < 1 || t < 0 ? E("num") : tails === 1 ? 1 - tCdf(t, v) : 2 * (1 - tCdf(t, v)))));
  def("T.INV", numeric([undefined, undefined], (p, v) => (p <= 0 || p >= 1 || v < 1 ? E("num") : invert((x) => tCdf(x, v), p, -10, 10))));
  def("T.INV.2T", numeric([undefined, undefined], (p, v) => (p <= 0 || p > 1 || v < 1 ? E("num") : invert((x) => tCdf(x, v), 1 - p / 2, -10, 10))));
  alias("T.INV.2T", "TINV");
  def("CHISQ.DIST", (a) => {
    const x = toNum(scalar(a[0]));
    const k = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(k)) return k;
    if (x < 0 || k < 1) return E("num");
    if (bool(a[2], false)) return chiCdf(x, k);
    return x === 0 && k === 2 ? 0.5 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.log(2) - lnGamma(k / 2));
  });
  def("CHISQ.DIST.RT", numeric([undefined, undefined], (x, k) => (x < 0 || k < 1 ? E("num") : 1 - chiCdf(x, k))));
  alias("CHISQ.DIST.RT", "CHIDIST");
  def("CHISQ.INV", numeric([undefined, undefined], (p, k) => (p < 0 || p >= 1 || k < 1 ? E("num") : invert((x) => chiCdf(x, k), p, 0, k + 10))));
  def("CHISQ.INV.RT", numeric([undefined, undefined], (p, k) => (p <= 0 || p > 1 || k < 1 ? E("num") : invert((x) => chiCdf(x, k), 1 - p, 0, k + 10))));
  alias("CHISQ.INV.RT", "CHIINV");
  def("CHISQ.TEST", (a) => {
    const obs = numMatrix(a[0]);
    const exp = numMatrix(a[1]);
    if (isError(obs)) return obs;
    if (isError(exp)) return exp;
    const r = obs.length;
    const c = obs[0]?.length ?? 0;
    if (exp.length !== r || exp[0]?.length !== c) return E("na");
    let x = 0;
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) x += (obs[i][j] - exp[i][j]) ** 2 / exp[i][j];
    const df = r > 1 && c > 1 ? (r - 1) * (c - 1) : r * c - 1;
    return 1 - chiCdf(x, df);
  });
  alias("CHISQ.TEST", "CHITEST");
  def("F.DIST", (a) => {
    const [x, d1, d2] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(x)) return x;
    if (isError(d1)) return d1;
    if (isError(d2)) return d2;
    if (x < 0 || d1 < 1 || d2 < 1) return E("num");
    if (bool(a[3], false)) return fCdf(x, d1, d2);
    return Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lnGamma(d1 / 2) + lnGamma(d2 / 2) - lnGamma((d1 + d2) / 2)));
  });
  def("F.DIST.RT", numeric([undefined, undefined, undefined], (x, d1, d2) => (x < 0 || d1 < 1 || d2 < 1 ? E("num") : 1 - fCdf(x, d1, d2))));
  alias("F.DIST.RT", "FDIST");
  def("F.INV", numeric([undefined, undefined, undefined], (p, d1, d2) => (p < 0 || p >= 1 || d1 < 1 || d2 < 1 ? E("num") : invert((x) => fCdf(x, d1, d2), p, 0, 10))));
  def("F.INV.RT", numeric([undefined, undefined, undefined], (p, d1, d2) => (p <= 0 || p > 1 || d1 < 1 || d2 < 1 ? E("num") : invert((x) => fCdf(x, d1, d2), 1 - p, 0, 10))));
  alias("F.INV.RT", "FINV");
  def("GAMMA.DIST", (a) => {
    const [x, al, be] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(x)) return x;
    if (isError(al)) return al;
    if (isError(be)) return be;
    if (x < 0 || al <= 0 || be <= 0) return E("num");
    if (bool(a[3], false)) return gammaP(al, x / be);
    return x === 0 ? (al === 1 ? 1 / be : 0) : Math.exp((al - 1) * Math.log(x) - x / be - al * Math.log(be) - lnGamma(al));
  });
  alias("GAMMA.DIST", "GAMMADIST");
  def("GAMMA.INV", numeric([undefined, undefined, undefined], (p, al, be) => (p < 0 || p >= 1 || al <= 0 || be <= 0 ? E("num") : invert((x) => gammaP(al, x / be), p, 0, al * be + 10))));
  alias("GAMMA.INV", "GAMMAINV");
  def("BETA.DIST", (a) => {
    const [x, al, be] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    const lo = nums(a, 4, 0);
    const hi = nums(a, 5, 1);
    if (isError(x)) return x;
    if (isError(al)) return al;
    if (isError(be)) return be;
    if (isError(lo)) return lo;
    if (isError(hi)) return hi;
    if (al <= 0 || be <= 0 || x < lo || x > hi || lo === hi) return E("num");
    const t = (x - lo) / (hi - lo);
    if (bool(a[3], true)) return betaI(t, al, be);
    return Math.exp((al - 1) * Math.log(t) + (be - 1) * Math.log(1 - t) - (lnGamma(al) + lnGamma(be) - lnGamma(al + be))) / (hi - lo);
  });
  def("BETADIST", numeric([undefined, undefined, undefined, 0, 1], (x, al, be, lo, hi) => (al <= 0 || be <= 0 || x < lo || x > hi ? E("num") : betaI((x - lo) / (hi - lo), al, be))));
  def("BETA.INV", numeric([undefined, undefined, undefined, 0, 1], (p, al, be, lo, hi) => (p <= 0 || p > 1 || al <= 0 || be <= 0 ? E("num") : lo + (hi - lo) * invert((x) => betaI(x, al, be), p, 0, 1))));
  alias("BETA.INV", "BETAINV");
  def("WEIBULL.DIST", (a) => {
    const [x, al, be] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(x)) return x;
    if (isError(al)) return al;
    if (isError(be)) return be;
    if (x < 0 || al <= 0 || be <= 0) return E("num");
    if (bool(a[3], false)) return 1 - Math.exp(-Math.pow(x / be, al));
    return (al / Math.pow(be, al)) * Math.pow(x, al - 1) * Math.exp(-Math.pow(x / be, al));
  });
  alias("WEIBULL.DIST", "WEIBULL");
  def("EXPON.DIST", (a) => {
    const x = toNum(scalar(a[0]));
    const l = toNum(scalar(a[1]));
    if (isError(x)) return x;
    if (isError(l)) return l;
    if (x < 0 || l <= 0) return E("num");
    return bool(a[2], false) ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x);
  });
  alias("EXPON.DIST", "EXPONDIST");
  def("BINOM.DIST", (a) => {
    const [k0, n0, p] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(k0)) return k0;
    if (isError(n0)) return n0;
    if (isError(p)) return p;
    const k = Math.trunc(k0);
    const n = Math.trunc(n0);
    if (k < 0 || k > n || p < 0 || p > 1) return E("num");
    if (!bool(a[3], false)) return binomPmf(k, n, p);
    let s = 0;
    for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
    return Math.min(1, s);
  });
  alias("BINOM.DIST", "BINOMDIST");
  def("BINOM.INV", numeric([undefined, undefined, undefined], (n, p, alpha) => {
    if (n < 0 || p < 0 || p > 1 || alpha <= 0 || alpha >= 1) return E("num");
    let s = 0;
    for (let k = 0; k <= n; k++) {
      s += binomPmf(k, Math.trunc(n), p);
      if (s >= alpha) return k;
    }
    return Math.trunc(n);
  }));
  alias("BINOM.INV", "CRITBINOM");
  def("NEGBINOM.DIST", (a) => {
    const [f0, s0, p] = [0, 1, 2].map((i) => toNum(scalar(a[i])));
    if (isError(f0)) return f0;
    if (isError(s0)) return s0;
    if (isError(p)) return p;
    const f = Math.trunc(f0);
    const s = Math.trunc(s0);
    if (f < 0 || s < 1 || p <= 0 || p >= 1) return E("num");
    const pmf = (x: number) => Math.exp(lnComb(x + s - 1, s - 1) + s * Math.log(p) + x * Math.log(1 - p));
    if (!bool(a[3], false)) return pmf(f);
    let t = 0;
    for (let i = 0; i <= f; i++) t += pmf(i);
    return t;
  });
  def("HYPGEOM.DIST", (a) => {
    const [x0, n0, M0, N0] = [0, 1, 2, 3].map((i) => toNum(scalar(a[i])));
    for (const v of [x0, n0, M0, N0]) if (isError(v)) return v;
    const [x, n, M, N] = [x0, n0, M0, N0].map((v) => Math.trunc(v as number));
    if (x < 0 || x > n || x > M || n > N || M > N) return E("num");
    const pmf = (k: number) => Math.exp(lnComb(M, k) + lnComb(N - M, n - k) - lnComb(N, n));
    if (!bool(a[4], false)) return pmf(x);
    let t = 0;
    for (let i = Math.max(0, n - N + M); i <= x; i++) t += pmf(i);
    return t;
  });
  def("POISSON.DIST", (a) => {
    const x0 = toNum(scalar(a[0]));
    const l = toNum(scalar(a[1]));
    if (isError(x0)) return x0;
    if (isError(l)) return l;
    const x = Math.trunc(x0);
    if (x < 0 || l < 0) return E("num");
    const pmf = (k: number) => Math.exp(k * Math.log(l) - l - lnGamma(k + 1));
    if (!bool(a[2], false)) return l === 0 ? (x === 0 ? 1 : 0) : pmf(x);
    return l === 0 ? 1 : 1 - gammaP(x + 1, l);
  });
  alias("POISSON.DIST", "POISSON");
  def("CONFIDENCE.NORM", numeric([undefined, undefined, undefined], (al, s, n) => (al <= 0 || al >= 1 || s <= 0 || n < 1 ? E("num") : (normInv(1 - al / 2) * s) / Math.sqrt(n))));
  alias("CONFIDENCE.NORM", "CONFIDENCE");
  def("CONFIDENCE.T", numeric([undefined, undefined, undefined], (al, s, n) => (al <= 0 || al >= 1 || s <= 0 || n < 2 ? E("num") : (invert((x) => tCdf(x, n - 1), 1 - al / 2, -10, 10) * s) / Math.sqrt(n))));
  def("Z.TEST", (a) => {
    const v = collect([a[0]]);
    const x = toNum(scalar(a[1]));
    if (isError(v)) return v;
    if (isError(x)) return x;
    if (v.length < 2) return E("div0");
    const s = a[2] !== undefined ? toNum(scalar(a[2])) : Math.sqrt(sumSq(v) / (v.length - 1));
    if (isError(s)) return s;
    return 1 - normCdf((mean(v) - x) / (s / Math.sqrt(v.length)));
  });
  alias("Z.TEST", "ZTEST");
  def("T.TEST", (a) => {
    const x = collect([a[0]]);
    const y = collect([a[1]]);
    const tails = toNum(scalar(a[2]));
    const type = toNum(scalar(a[3]));
    if (isError(x)) return x;
    if (isError(y)) return y;
    if (isError(tails)) return tails;
    if (isError(type)) return type;
    let t: number;
    let df: number;
    if (type === 1) {
      if (x.length !== y.length) return E("na");
      const d = x.map((v, i) => v - y[i]);
      const n = d.length;
      t = mean(d) / Math.sqrt(sumSq(d) / (n - 1) / n);
      df = n - 1;
    } else if (type === 2) {
      const n1 = x.length;
      const n2 = y.length;
      const sp = (sumSq(x) + sumSq(y)) / (n1 + n2 - 2);
      t = (mean(x) - mean(y)) / Math.sqrt(sp * (1 / n1 + 1 / n2));
      df = n1 + n2 - 2;
    } else {
      const v1 = sumSq(x) / (x.length - 1) / x.length;
      const v2 = sumSq(y) / (y.length - 1) / y.length;
      t = (mean(x) - mean(y)) / Math.sqrt(v1 + v2);
      df = (v1 + v2) ** 2 / (v1 ** 2 / (x.length - 1) + v2 ** 2 / (y.length - 1));
    }
    const p = 1 - tCdf(Math.abs(t), df);
    return fin(tails === 1 ? p : 2 * p);
  });
  alias("T.TEST", "TTEST");

  // ---------------------------------------------------------- finance --
  const rate0 = (r: number, n: number, pmt: number, pv: number, fv: number, type: number) => {
    if (r === 0) return pv + pmt * n + fv;
    const f = Math.pow(1 + r, n);
    return pv * f + (pmt * (1 + r * type) * (f - 1)) / r + fv;
  };
  def("NPER", numeric([undefined, undefined, undefined, 0, 0], (r, pmt, pv, fv, type) => {
    if (r === 0) return pmt === 0 ? E("num") : -(pv + fv) / pmt;
    const num = pmt * (1 + r * type) - fv * r;
    const den = pv * r + pmt * (1 + r * type);
    return Math.log(num / den) / Math.log(1 + r);
  }));
  def("RATE", numeric([undefined, undefined, undefined, 0, 0, 0.1], (n, pmt, pv, fv, type, guess) => {
    let r = guess;
    for (let i = 0; i < 100; i++) {
      const y = rate0(r, n, pmt, pv, fv, type);
      const h = 1e-7;
      const d = (rate0(r + h, n, pmt, pv, fv, type) - y) / h;
      if (d === 0) break;
      const nr = r - y / d;
      if (!Number.isFinite(nr)) return E("num");
      if (Math.abs(nr - r) < 1e-12) return nr;
      r = nr;
    }
    return Math.abs(rate0(r, n, pmt, pv, fv, type)) < 1e-6 ? r : E("num");
  }));
  const pmt = (r: number, n: number, pv: number, fv: number, type: number) => {
    if (r === 0) return -(pv + fv) / n;
    const f = Math.pow(1 + r, n);
    return (-(pv * f + fv) * r) / ((1 + r * type) * (f - 1));
  };
  const fvx = (r: number, n: number, p: number, pv: number, type: number) => {
    if (r === 0) return -(pv + p * n);
    const f = Math.pow(1 + r, n);
    return -(pv * f + (p * (1 + r * type) * (f - 1)) / r);
  };
  def("IPMT", numeric([undefined, undefined, undefined, undefined, 0, 0], (r, per, n, pv, fv, type) => {
    if (per < 1 || per > n) return E("num");
    const p = pmt(r, n, pv, fv, type);
    if (per === 1) return type === 1 ? 0 : -pv * r;
    const bal = type === 1 ? fvx(r, per - 2, p, pv, 1) - p : fvx(r, per - 1, p, pv, 0);
    return bal * r;
  }));
  def("PPMT", numeric([undefined, undefined, undefined, undefined, 0, 0], (r, per, n, pv, fv, type) => {
    if (per < 1 || per > n) return E("num");
    const i = F.IPMT([r, per, n, pv, fv, type], null!, []) as number;
    return pmt(r, n, pv, fv, type) - i;
  }));
  const cum = (principal: boolean): Fn => numeric([undefined, undefined, undefined, undefined, undefined, undefined], (r, n, pv, s, e, type) => {
    if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n || (type !== 0 && type !== 1)) return E("num");
    let t = 0;
    for (let per = Math.trunc(s); per <= Math.trunc(e); per++) {
      const i = F.IPMT([r, per, n, pv, 0, type], null!, []) as number;
      t += principal ? pmt(r, n, pv, 0, type) - i : i;
    }
    return t;
  });
  def("CUMIPMT", cum(false));
  def("CUMPRINC", cum(true));
  def("ISPMT", numeric([undefined, undefined, undefined, undefined], (r, per, n, pv) => -pv * r * (1 - per / n)));
  def("NPV", (a) => {
    const r = toNum(scalar(a[0]));
    if (isError(r)) return r;
    const v = collect(a.slice(1));
    if (isError(v)) return v;
    return v.reduce((s, x, i) => s + x / Math.pow(1 + r, i + 1), 0);
  });
  const irr = (f: (r: number) => number, guess: number): Scalar => {
    let r = guess;
    for (let i = 0; i < 200; i++) {
      const y = f(r);
      const h = 1e-7;
      const d = (f(r + h) - y) / h;
      if (d === 0 || !Number.isFinite(d)) break;
      const nr = r - y / d;
      if (Math.abs(nr - r) < 1e-12) return nr;
      r = nr <= -1 ? (r - 1) / 2 : nr;
    }
    // Fall back to bisection over a wide range.
    let lo = -0.9999;
    let hi = 10;
    if (Math.sign(f(lo)) === Math.sign(f(hi))) return E("num");
    for (let i = 0; i < 300; i++) {
      const m = (lo + hi) / 2;
      if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  def("IRR", (a) => {
    const v = collect([a[0]]);
    const g = nums(a, 1, 0.1);
    if (isError(v)) return v;
    if (isError(g)) return g;
    if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) return E("num");
    return irr((r) => v.reduce((s, x, i) => s + x / Math.pow(1 + r, i), 0), g);
  });
  const xflows = (a: Value[]): [number[], number[]] | FormulaError => {
    const v = collect([a[0]]);
    const d = collect([a[1]]);
    if (isError(v)) return v;
    if (isError(d)) return d;
    if (v.length !== d.length) return E("num");
    return [v, d];
  };
  def("XNPV", (a) => {
    const r = toNum(scalar(a[0]));
    if (isError(r)) return r;
    const f = xflows(a.slice(1));
    if (isError(f)) return f;
    const [v, d] = f;
    return v.reduce((s, x, i) => s + x / Math.pow(1 + r, (d[i] - d[0]) / 365), 0);
  });
  def("XIRR", (a) => {
    const f = xflows(a);
    const g = nums(a, 2, 0.1);
    if (isError(f)) return f;
    if (isError(g)) return g;
    const [v, d] = f;
    if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) return E("num");
    return irr((r) => v.reduce((s, x, i) => s + x / Math.pow(1 + r, (d[i] - d[0]) / 365), 0), g);
  });
  def("MIRR", (a) => {
    const v = collect([a[0]]);
    const fr = toNum(scalar(a[1]));
    const rr = toNum(scalar(a[2]));
    if (isError(v)) return v;
    if (isError(fr)) return fr;
    if (isError(rr)) return rr;
    const n = v.length;
    const pos = v.reduce((s, x, i) => s + (x > 0 ? x * Math.pow(1 + rr, n - 1 - i) : 0), 0);
    const neg = v.reduce((s, x, i) => s + (x < 0 ? x / Math.pow(1 + fr, i) : 0), 0);
    if (pos === 0 || neg === 0) return E("div0");
    return Math.pow(-pos / neg, 1 / (n - 1)) - 1;
  });
  def("EFFECT", numeric([undefined, undefined], (r, n) => (r <= 0 || n < 1 ? E("num") : Math.pow(1 + r / Math.trunc(n), Math.trunc(n)) - 1)));
  def("NOMINAL", numeric([undefined, undefined], (r, n) => (r <= 0 || n < 1 ? E("num") : Math.trunc(n) * (Math.pow(1 + r, 1 / Math.trunc(n)) - 1))));
  def("SLN", numeric([undefined, undefined, undefined], (c, s, l) => (l === 0 ? E("div0") : (c - s) / l)));
  def("SYD", numeric([undefined, undefined, undefined, undefined], (c, s, l, per) => (l <= 0 || per < 1 || per > l ? E("num") : ((c - s) * (l - per + 1) * 2) / (l * (l + 1)))));
  def("DB", numeric([undefined, undefined, undefined, undefined, 12], (c, s, l, per, m) => {
    if (c < 0 || s < 0 || l <= 0 || per < 1 || m < 1 || m > 12 || per > l + 1) return E("num");
    const rate = Math.round((1 - Math.pow(s / c, 1 / l)) * 1000) / 1000;
    let total = 0;
    let dep = 0;
    for (let p = 1; p <= per; p++) {
      if (p === 1) dep = (c * rate * m) / 12;
      else if (p === l + 1) dep = ((c - total) * rate * (12 - m)) / 12;
      else dep = (c - total) * rate;
      total += dep;
    }
    return dep;
  }));
  const ddb = (c: number, s: number, l: number, per: number, f: number) => {
    let total = 0;
    let dep = 0;
    for (let p = 1; p <= per; p++) {
      dep = Math.min((c - total) * (f / l), Math.max(0, c - s - total));
      total += dep;
    }
    return dep;
  };
  def("DDB", numeric([undefined, undefined, undefined, undefined, 2], (c, s, l, per, f) => (c < 0 || s < 0 || l <= 0 || per < 1 || per > l || f <= 0 ? E("num") : ddb(c, s, l, Math.trunc(per), f))));
  def("VDB", (a) => {
    const [c, s, l, st, en] = [0, 1, 2, 3, 4].map((i) => toNum(scalar(a[i])));
    const f = nums(a, 5, 2);
    for (const v of [c, s, l, st, en, f]) if (isError(v)) return v;
    const noSwitch = bool(a[6], false);
    const C = c as number, S = s as number, L = l as number, A = st as number, B = en as number, Fc = f as number;
    if (A < 0 || B < A || B > L) return E("num");
    // Depreciation per period with an optional switch to straight line.
    let total = 0;
    let book = C;
    const per: number[] = [];
    for (let p = 0; p < Math.ceil(L); p++) {
      const ddbDep = Math.min(book * (Fc / L), Math.max(0, book - S));
      const sl = (book - S) / (L - p);
      const dep = !noSwitch && sl > ddbDep ? sl : ddbDep;
      per.push(dep);
      book -= dep;
    }
    for (let p = Math.floor(A); p < Math.ceil(B); p++) {
      const from = Math.max(A, p);
      const to = Math.min(B, p + 1);
      total += per[p] * (to - from);
    }
    return total;
  });
  def("FVSCHEDULE", (a) => {
    const p = toNum(scalar(a[0]));
    const s = collect([a[1]]);
    if (isError(p)) return p;
    if (isError(s)) return s;
    return s.reduce((v, r) => v * (1 + r), p);
  });
  def("PDURATION", numeric([undefined, undefined, undefined], (r, pv, fv) => (r <= 0 || pv <= 0 || fv <= 0 ? E("num") : (Math.log(fv) - Math.log(pv)) / Math.log(1 + r))));
  def("RRI", numeric([undefined, undefined, undefined], (n, pv, fv) => (n <= 0 || pv === 0 ? E("num") : Math.pow(fv / pv, 1 / n) - 1)));
  def("DOLLARDE", numeric([undefined, undefined], (d, f) => {
    f = Math.trunc(f);
    if (f <= 0) return E("div0");
    const i = Math.trunc(d);
    const digits = Math.ceil(Math.log10(f));
    return i + ((d - i) * Math.pow(10, digits)) / f;
  }));
  def("DOLLARFR", numeric([undefined, undefined], (d, f) => {
    f = Math.trunc(f);
    if (f <= 0) return E("div0");
    const i = Math.trunc(d);
    const digits = Math.ceil(Math.log10(f));
    return i + ((d - i) * f) / Math.pow(10, digits);
  }));

  // ------------------------------------------------------------- text --
  const str = (v: Value | undefined) => toStr(scalar(v));
  const delims = (v: Value | undefined): string[] => asMatrix(v ?? "").flat().map((x) => String(x ?? "")).filter((x) => x !== "");
  /** Position of the n-th delimiter occurrence: [start, length] or null. */
  const findDelim = (text: string, ds: string[], n: number, ci: boolean, matchEnd: boolean): [number, number] | null => {
    const hay = ci ? text.toLowerCase() : text;
    const hits: [number, number][] = [];
    for (let i = 0; i <= hay.length; i++) {
      for (const d0 of ds) {
        const d = ci ? d0.toLowerCase() : d0;
        if (hay.startsWith(d, i)) {
          hits.push([i, d.length]);
          break;
        }
      }
    }
    if (matchEnd) hits.push([text.length, 0]);
    if (n > 0) return hits[n - 1] ?? null;
    return hits[hits.length + n] ?? null;
  };
  const textAround = (after: boolean): Fn => (a) => {
    const t = str(a[0]);
    if (isError(t)) return t;
    const ds = delims(a[1]);
    const n = nums(a, 2, 1);
    const mode = nums(a, 3, 0);
    const end = nums(a, 4, 0);
    if (isError(n)) return n;
    if (isError(mode)) return mode;
    if (isError(end)) return end;
    if (n === 0 || Math.abs(n) > t.length + 1) return E("value");
    if (!ds.length) return after ? (n > 0 ? t : "") : n > 0 ? "" : t;
    const hit = findDelim(t, ds, Math.trunc(n), mode === 1, end === 1 && n > 0);
    const hitEnd = !hit && end === 1 && n < 0 ? ([0, 0] as [number, number]) : hit;
    if (!hitEnd) return a[5] !== undefined ? scalar(a[5]) : E("na");
    return after ? t.slice(hitEnd[0] + hitEnd[1]) : t.slice(0, hitEnd[0]);
  };
  def("TEXTBEFORE", textAround(false));
  def("TEXTAFTER", textAround(true));
  def("TEXTSPLIT", (a) => {
    const t = str(a[0]);
    if (isError(t)) return t;
    const cd = delims(a[1]);
    const rd = delims(a[2]);
    const ignore = bool(a[3], false);
    const ci = (nums(a, 4, 0) as number) === 1;
    const pad = a[5] !== undefined ? scalar(a[5]) : E("na");
    const split = (s: string, ds: string[]) => {
      if (!ds.length) return [s];
      const esc = ds.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const parts = s.split(new RegExp(esc.join("|"), ci ? "i" : ""));
      return ignore ? parts.filter((p) => p !== "") : parts;
    };
    const rows = split(t, rd).map((r) => split(r, cd));
    const w = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => [...r, ...Array(w - r.length).fill(pad)]);
  });
  def("UNICHAR", (a) => {
    const n = toNum(scalar(a[0]));
    if (isError(n)) return n;
    if (n < 1 || n > 0x10ffff) return E("value");
    return String.fromCodePoint(Math.trunc(n));
  });
  def("UNICODE", (a) => {
    const s = str(a[0]);
    if (isError(s)) return s;
    return s ? s.codePointAt(0)! : E("value");
  });
  const textOf = (v: Scalar, strict: boolean): string => {
    if (isError(v)) return v.error;
    if (typeof v === "string") return strict ? `"${v.replace(/"/g, '""')}"` : v;
    const s = toStr(v);
    return isError(s) ? s.error : s;
  };
  def("VALUETOTEXT", (a) => textOf(scalar(a[0]), (nums(a, 1, 0) as number) === 1));
  def("ARRAYTOTEXT", (a) => {
    const strict = (nums(a, 1, 0) as number) === 1;
    const m = asMatrix(a[0]);
    if (!strict) return m.flat().map((v) => textOf(v, false)).join(", ");
    return "{" + m.map((r) => r.map((v) => textOf(v, true)).join(",")).join(";") + "}";
  });
  const regex = (pattern: string, ci: boolean, global = false) => new RegExp(pattern, (ci ? "i" : "") + (global ? "g" : "") + "u");
  def("REGEXTEST", (a) => {
    const t = str(a[0]);
    const p = str(a[1]);
    if (isError(t)) return t;
    if (isError(p)) return p;
    try {
      return regex(p, (nums(a, 2, 0) as number) === 1).test(t);
    } catch {
      return E("value");
    }
  });
  def("REGEXEXTRACT", (a) => {
    const t = str(a[0]);
    const p = str(a[1]);
    if (isError(t)) return t;
    if (isError(p)) return p;
    const mode = nums(a, 2, 0) as number;
    const ci = (nums(a, 3, 0) as number) === 1;
    try {
      if (mode === 1) {
        const all = [...t.matchAll(regex(p, ci, true))].map((m) => [m[0]]);
        return all.length ? all.map((r) => r) : E("na");
      }
      const m = t.match(regex(p, ci));
      if (!m) return E("na");
      if (mode === 2) return m.length > 1 ? [m.slice(1).map((x) => x ?? "")] : E("na");
      return m[0];
    } catch {
      return E("value");
    }
  });
  def("REGEXREPLACE", (a) => {
    const t = str(a[0]);
    const p = str(a[1]);
    const r = str(a[2]);
    if (isError(t)) return t;
    if (isError(p)) return p;
    if (isError(r)) return r;
    const n = nums(a, 3, 0) as number;
    const ci = (nums(a, 4, 0) as number) === 1;
    try {
      if (n === 0) return t.replace(regex(p, ci, true), r);
      // Only the n-th occurrence (negative: from the end).
      const all = [...t.matchAll(regex(p, ci, true))];
      const m = all[n > 0 ? n - 1 : all.length + n];
      if (!m || m.index === undefined) return t;
      return t.slice(0, m.index) + m[0].replace(regex(p, ci), r) + t.slice(m.index + m[0].length);
    } catch {
      return E("value");
    }
  });
  def("ENCODEURL", (a) => {
    const s = str(a[0]);
    return isError(s) ? s : encodeURIComponent(s);
  });
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  def("LENB", (a) => {
    const s = str(a[0]);
    return isError(s) ? s : bytes(s);
  });
  alias("LEFT", "LEFTB");
  alias("RIGHT", "RIGHTB");
  alias("MID", "MIDB");

  // ------------------------------------------------------------ dates --
  const parseDate = (s: string): number | null => {
    const t = s.trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return dateToSerial(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +(m[6] ?? 0)) / 86400 : 0);
    m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += y < 30 ? 2000 : 1900;
      return dateToSerial(y, +m[2], +m[1]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +(m[6] ?? 0)) / 86400 : 0);
    }
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += y < 30 ? 2000 : 1900;
      return dateToSerial(y, +m[1], +m[2]);
    }
    const months = ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
    const en = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    m = t.match(/^(\d{1,2})\.?\s*([A-Za-zäÄ]+)\.?\s*(\d{4})$/);
    if (m) {
      const k = m[2].slice(0, 3).toLowerCase();
      const i = months.indexOf(k) >= 0 ? months.indexOf(k) : en.indexOf(k);
      if (i >= 0) return dateToSerial(+m[3], i + 1, +m[1]);
    }
    return null;
  };
  const parseTime = (s: string): number | null => {
    const m = s.trim().match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = +m[1];
    if (m[4]) h = (h % 12) + (m[4].toLowerCase() === "pm" ? 12 : 0);
    return (h * 3600 + +m[2] * 60 + +(m[3] ?? 0)) / 86400;
  };
  def("DATEVALUE", (a) => {
    const s = str(a[0]);
    if (isError(s)) return s;
    const d = parseDate(s);
    return d === null ? E("value") : Math.floor(d);
  });
  def("TIMEVALUE", (a) => {
    const s = str(a[0]);
    if (isError(s)) return s;
    const t = parseTime(s);
    if (t !== null) return t;
    const d = parseDate(s);
    return d === null ? E("value") : d - Math.floor(d);
  });
  const days360 = (s: number, e: number, european: boolean) => {
    const A = serialToDate(s);
    const B = serialToDate(e);
    let d1 = A.d;
    let d2 = B.d;
    const lastFeb = (x: { y: number; m: number; d: number }) => x.m === 2 && x.d === serialToDate(dateToSerial(x.y, 3, 1) - 1).d;
    if (european) {
      if (d1 === 31) d1 = 30;
      if (d2 === 31) d2 = 30;
    } else {
      if (lastFeb(A)) {
        if (lastFeb(B)) d2 = 30;
        d1 = 30;
      }
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
    }
    return (B.y - A.y) * 360 + (B.m - A.m) * 30 + (d2 - d1);
  };
  def("DAYS360", (a) => {
    const s = toNum(scalar(a[0]));
    const e = toNum(scalar(a[1]));
    if (isError(s)) return s;
    if (isError(e)) return e;
    return days360(Math.floor(s), Math.floor(e), bool(a[2], false));
  });
  def("YEARFRAC", numeric([undefined, undefined, 0], (s, e, basis) => {
    if (s > e) [s, e] = [e, s];
    s = Math.floor(s);
    e = Math.floor(e);
    switch (Math.trunc(basis)) {
      case 0:
        return days360(s, e, false) / 360;
      case 1: {
        const A = serialToDate(s);
        const B = serialToDate(e);
        const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        if (A.y === B.y) return (e - s) / (leap(A.y) ? 366 : 365);
        const oneYear = e - s <= 366 && (B.y - A.y === 1) && (B.m < A.m || (B.m === A.m && B.d <= A.d));
        if (oneYear) {
          const feb29 = (leap(A.y) && (A.m < 3)) || (leap(B.y) && (B.m > 2 || (B.m === 2 && B.d === 29)));
          return (e - s) / (feb29 ? 366 : 365);
        }
        let days = 0;
        for (let y = A.y; y <= B.y; y++) days += leap(y) ? 366 : 365;
        return (e - s) / (days / (B.y - A.y + 1));
      }
      case 2:
        return (e - s) / 360;
      case 3:
        return (e - s) / 365;
      case 4:
        return days360(s, e, true) / 360;
    }
    return E("num");
  }));
  const weekendMask = (v: Value | undefined): boolean[] | FormulaError => {
    const x = scalar(v ?? 1);
    if (typeof x === "string" && /^[01]{7}$/.test(x)) return [...x].map((c) => c === "1"); // Mon..Sun
    const n = toNum(x === "" || x === null ? 1 : x);
    if (isError(n)) return n;
    const two: Record<number, [number, number]> = { 1: [5, 6], 2: [6, 0], 3: [0, 1], 4: [1, 2], 5: [2, 3], 6: [3, 4], 7: [4, 5] };
    const mask = Array(7).fill(false);
    if (two[n]) two[n].forEach((i) => (mask[i] = true));
    else if (n >= 11 && n <= 17) mask[(n - 11 + 6) % 7] = true;
    else return E("num");
    return mask;
  };
  /** Monday = 0 … Sunday = 6. */
  const dow = (s: number) => (serialToDate(s).wd + 6) % 7;
  def("NETWORKDAYS.INTL", (a) => {
    const s = toNum(scalar(a[0]));
    const e = toNum(scalar(a[1]));
    const mask = weekendMask(a[2]);
    if (isError(s)) return s;
    if (isError(e)) return e;
    if (isError(mask)) return mask;
    const hol = new Set((collect([a[3] ?? []]) as number[]).map(Math.floor));
    const [lo, hi] = s <= e ? [Math.floor(s), Math.floor(e)] : [Math.floor(e), Math.floor(s)];
    let n = 0;
    for (let d = lo; d <= hi; d++) if (!mask[dow(d)] && !hol.has(d)) n++;
    return s <= e ? n : -n;
  });
  def("WORKDAY.INTL", (a) => {
    const s = toNum(scalar(a[0]));
    const days = toNum(scalar(a[1]));
    const mask = weekendMask(a[2]);
    if (isError(s)) return s;
    if (isError(days)) return days;
    if (isError(mask)) return mask;
    if (mask.every(Boolean)) return E("value");
    const hol = new Set((collect([a[3] ?? []]) as number[]).map(Math.floor));
    let d = Math.floor(s);
    let left = Math.trunc(days);
    const step = left < 0 ? -1 : 1;
    while (left !== 0) {
      d += step;
      if (!mask[dow(d)] && !hol.has(d)) left -= step;
    }
    return d;
  });

  // --------------------------------------------------- lookup & arrays --
  def("XMATCH", (a) => {
    const v = scalar(a[0]);
    const arr = asMatrix(a[1]).flat();
    const mode = nums(a, 2, 0) as number;
    const search = nums(a, 3, 1) as number;
    const idx = arr.map((_, i) => i);
    if (search === -1 || search === -2) idx.reverse();
    const wild = mode === 2 ? criterion(typeof v === "string" ? v : String(v ?? "")) : null;
    let best = -1;
    for (const i of idx) {
      const x = arr[i];
      if (wild ? typeof x === "string" && wild(x) : lookupEq(x, v)) return i + 1;
      if (mode === -1 && compare(x, v) < 0 && typeof x === typeof v && (best < 0 || compare(x, arr[best]) > 0)) best = i;
      if (mode === 1 && compare(x, v) > 0 && typeof x === typeof v && (best < 0 || compare(x, arr[best]) < 0)) best = i;
    }
    return best >= 0 ? best + 1 : E("na");
  });
  def("LOOKUP", (a) => {
    const v = scalar(a[0]);
    const m = asMatrix(a[1]);
    // Two-argument form: search the first row or column, return the last.
    let keys: Scalar[];
    let res: Scalar[];
    if (a[2] !== undefined) {
      keys = m.flat();
      res = asMatrix(a[2]).flat();
    } else if ((m[0]?.length ?? 0) > m.length) {
      keys = m[0];
      res = m[m.length - 1];
    } else {
      keys = m.map((r) => r[0]);
      res = m.map((r) => r[r.length - 1]);
    }
    let hit = -1;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === null || isError(k)) continue;
      if (typeof k !== typeof v) continue;
      if (compare(k, v) <= 0) hit = i;
      else break;
    }
    return hit >= 0 ? res[hit] ?? E("na") : E("na");
  });
  /** Reference (sheet, rect) of an argument node, for OFFSET and friends. */
  const refOf = (n: Node | undefined, ctx: EvalContext) => {
    if (!n) return null;
    if (n.k === "ref") return { sheet: n.sheet, r1: n.r, c1: n.c, r2: n.r, c2: n.c };
    if (n.k === "range") return { sheet: n.sheet, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
    if (n.k === "spill") {
      const s = n.sheet ? ctx.sheetIndex(n.sheet) : ctx.sheet;
      const size = ctx.spill?.(s, n.r, n.c);
      return size ? { sheet: n.sheet, r1: n.r, c1: n.c, r2: n.r + size.rows - 1, c2: n.c + size.cols - 1 } : null;
    }
    if (n.k === "fn" && (n.name === "OFFSET" || n.name === "INDIRECT")) return refTarget(n, ctx);
    return null;
  };
  const rangeNode = (r: { sheet?: string; r1: number; c1: number; r2: number; c2: number }): Node =>
    r.r1 === r.r2 && r.c1 === r.c2 ? { k: "ref", sheet: r.sheet, r: r.r1, c: r.c1 } : { k: "range", ...r };
  const refTarget = (n: Extract<Node, { k: "fn" }>, ctx: EvalContext): { sheet?: string; r1: number; c1: number; r2: number; c2: number } | null => {
    if (n.name === "OFFSET") {
      const base = refOf(n.args[0], ctx);
      if (!base) return null;
      const v = n.args.slice(1).map((x) => (x ? toNum(scalar(h.evaluate(x, ctx))) : 0));
      if (v.some(isError)) return null;
      const [dr, dc] = v as number[];
      const hh = n.args[3] && !(n.args[3].k === "str" && n.args[3].v === "") ? (v[2] as number) : base.r2 - base.r1 + 1;
      const ww = n.args[4] && !(n.args[4].k === "str" && n.args[4].v === "") ? (v[3] as number) : base.c2 - base.c1 + 1;
      const r1 = base.r1 + Math.trunc(dr);
      const c1 = base.c1 + Math.trunc(dc);
      if (r1 < 0 || c1 < 0 || hh < 1 || ww < 1) return null;
      return { sheet: base.sheet, r1, c1, r2: r1 + Math.trunc(hh) - 1, c2: c1 + Math.trunc(ww) - 1 };
    }
    const text = toStr(scalar(h.evaluate(n.args[0], ctx)));
    if (isError(text)) return null;
    let t = text.trim();
    if (n.args[1] && !bool(h.evaluate(n.args[1], ctx), true)) {
      // R1C1 style: R2C3 or R2C3:R4C5
      const m = t.match(/^(?:(.+)!)?R(\d+)C(\d+)(?::R(\d+)C(\d+))?$/i);
      if (!m) return null;
      return { sheet: m[1]?.replace(/^'|'$/g, ""), r1: +m[2] - 1, c1: +m[3] - 1, r2: +(m[4] ?? m[2]) - 1, c2: +(m[5] ?? m[3]) - 1 };
    }
    try {
      const node = h.parse(t.startsWith("=") ? (t = t.slice(1)) : t);
      if (node.k === "ref" || node.k === "range") return refOf(node, ctx);
      // A defined name holding a range.
      if (node.k === "name") {
        const target = ctx.name?.(node.v, ctx.sheet);
        return target ? refOf(target, ctx) : null;
      }
    } catch {
      return null;
    }
    return null;
  };
  def("OFFSET", (_a, ctx, raw) => {
    const r = refTarget({ k: "fn", name: "OFFSET", args: raw }, ctx);
    return r ? h.evaluate(rangeNode(r), ctx) : E("ref");
  });
  def("INDIRECT", (_a, ctx, raw) => {
    const r = refTarget({ k: "fn", name: "INDIRECT", args: raw }, ctx);
    return r ? h.evaluate(rangeNode(r), ctx) : E("ref");
  });
  def("AREAS", (_a, _c, raw) => (raw[0] ? 1 : E("value")));
  def("ISREF", (_a, ctx, raw) => !!refOf(raw[0], ctx));
  def("ADDRESS", (a) => {
    const r = toNum(scalar(a[0]));
    const c = toNum(scalar(a[1]));
    if (isError(r)) return r;
    if (isError(c)) return c;
    const abs = nums(a, 2, 1) as number;
    const a1 = bool(a[3], true);
    const sheet = a[4] !== undefined ? str(a[4]) : "";
    if (isError(sheet)) return sheet;
    if (r < 1 || c < 1) return E("value");
    let ref: string;
    if (a1) {
      let col = "";
      let n = Math.trunc(c);
      while (n > 0) {
        const m = (n - 1) % 26;
        col = String.fromCharCode(65 + m) + col;
        n = Math.floor((n - 1) / 26);
      }
      const ar = abs === 1 || abs === 2;
      const ac = abs === 1 || abs === 3;
      ref = `${ac ? "$" : ""}${col}${ar ? "$" : ""}${Math.trunc(r)}`;
    } else {
      const ar = abs === 1 || abs === 2;
      const ac = abs === 1 || abs === 3;
      ref = `R${ar ? Math.trunc(r) : `[${Math.trunc(r)}]`}C${ac ? Math.trunc(c) : `[${Math.trunc(c)}]`}`;
    }
    return sheet ? `${/[^\wÄÖÜäöüß.]/.test(sheet) ? `'${sheet.replace(/'/g, "''")}'` : sheet}!${ref}` : ref;
  });
  def("HYPERLINK", (a) => scalar(a[1] ?? a[0]));
  const pick = (cols: boolean): Fn => (a) => {
    const m = asMatrix(a[0]);
    const n = cols ? m[0]?.length ?? 0 : m.length;
    const idx: number[] = [];
    for (const v of a.slice(1)) {
      for (const x of asMatrix(v).flat()) {
        const i = toNum(x);
        if (isError(i)) return i;
        const k = Math.trunc(i);
        if (k === 0 || Math.abs(k) > n) return E("value");
        idx.push(k > 0 ? k - 1 : n + k);
      }
    }
    return cols ? m.map((r) => idx.map((i) => r[i])) : idx.map((i) => m[i]);
  };
  def("CHOOSECOLS", pick(true));
  def("CHOOSEROWS", pick(false));
  const takeDrop = (take: boolean): Fn => (a) => {
    const m = asMatrix(a[0]);
    const rows = a[1] === undefined || a[1] === "" ? null : toNum(scalar(a[1]));
    const cols = a[2] === undefined || a[2] === "" ? null : toNum(scalar(a[2]));
    if (isError(rows)) return rows;
    if (isError(cols)) return cols;
    const cut = <T,>(arr: T[], n: number | null): T[] => {
      if (n === null) return arr;
      const k = Math.trunc(n);
      if (take) return k >= 0 ? arr.slice(0, k) : arr.slice(Math.max(0, arr.length + k));
      return k >= 0 ? arr.slice(k) : arr.slice(0, Math.max(0, arr.length + k));
    };
    const out = cut(m, rows).map((r) => cut(r, cols));
    return out.length && out[0].length ? out : E("calc");
  };
  def("TAKE", takeDrop(true));
  def("DROP", takeDrop(false));
  def("EXPAND", (a) => {
    const m = asMatrix(a[0]);
    const rows = nums(a, 1, m.length);
    const cols = nums(a, 2, m[0]?.length ?? 1);
    if (isError(rows)) return rows;
    if (isError(cols)) return cols;
    if (rows < m.length || cols < (m[0]?.length ?? 0)) return E("value");
    const pad = a[3] !== undefined ? scalar(a[3]) : E("na");
    return Array.from({ length: Math.trunc(rows) }, (_, r) => Array.from({ length: Math.trunc(cols) }, (_, c) => m[r]?.[c] ?? pad));
  });
  def("VSTACK", (a) => {
    const ms = a.map(asMatrix);
    const w = Math.max(...ms.map((m) => m[0]?.length ?? 0));
    return ms.flatMap((m) => m.map((r) => [...r, ...Array(w - r.length).fill(E("na"))]));
  });
  def("HSTACK", (a) => {
    const ms = a.map(asMatrix);
    const hgt = Math.max(...ms.map((m) => m.length));
    return Array.from({ length: hgt }, (_, r) => ms.flatMap((m) => m[r] ?? Array(m[0]?.length ?? 0).fill(E("na"))));
  });
  const keep = (x: Scalar, ignore: number) => !((ignore === 1 || ignore === 3) && x === null) && !((ignore === 2 || ignore === 3) && isError(x));
  def("TOCOL", (a) => {
    const m = asMatrix(a[0]);
    const ignore = nums(a, 1, 0) as number;
    const byCol = bool(a[2], false);
    const flat = byCol ? (m[0] ?? []).flatMap((_, c) => m.map((r) => r[c])) : m.flat();
    return flat.filter((x) => keep(x, ignore)).map((x) => [x]);
  });
  def("TOROW", (a) => {
    const m = asMatrix(a[0]);
    const ignore = nums(a, 1, 0) as number;
    const byCol = bool(a[2], false);
    const flat = byCol ? (m[0] ?? []).flatMap((_, c) => m.map((r) => r[c])) : m.flat();
    return [flat.filter((x) => keep(x, ignore))];
  });
  const wrap = (rowsFirst: boolean): Fn => (a) => {
    const v = asMatrix(a[0]).flat();
    const n = toNum(scalar(a[1]));
    if (isError(n)) return n;
    const k = Math.trunc(n);
    if (k < 1) return E("value");
    const pad = a[2] !== undefined ? scalar(a[2]) : E("na");
    const groups: Scalar[][] = [];
    for (let i = 0; i < v.length; i += k) groups.push([...v.slice(i, i + k), ...Array(Math.max(0, i + k - v.length)).fill(pad)]);
    return rowsFirst ? groups : groups[0].map((_, r) => groups.map((g) => g[r]));
  };
  def("WRAPROWS", wrap(true));
  def("WRAPCOLS", wrap(false));
  def("SORTBY", (a) => {
    const m = asMatrix(a[0]);
    const keys: { v: Scalar[]; asc: boolean }[] = [];
    for (let i = 1; i < a.length; i += 2) {
      const k = asMatrix(a[i]).flat();
      if (k.length !== m.length && k.length !== (m[0]?.length ?? 0)) return E("value");
      const o = a[i + 1] !== undefined ? toNum(scalar(a[i + 1])) : 1;
      keys.push({ v: k, asc: o !== -1 });
    }
    const byCol = keys[0] && keys[0].v.length !== m.length;
    const idx = (byCol ? m[0] : m).map((_, i) => i);
    idx.sort((x, y) => {
      for (const k of keys) {
        const c = compare(k.v[x], k.v[y]);
        if (c) return k.asc ? c : -c;
      }
      return x - y;
    });
    return byCol ? m.map((r) => idx.map((i) => r[i])) : idx.map((i) => m[i]);
  });
  def("FORMULATEXT", (_a, ctx, raw) => {
    const r = refOf(raw[0], ctx);
    if (!r) return E("na");
    const s = r.sheet ? ctx.sheetIndex(r.sheet) : ctx.sheet;
    const f = ctx.formula?.(s, r.r1, r.c1);
    return f ? "=" + f : E("na");
  });
  def("ISFORMULA", (_a, ctx, raw) => {
    const r = refOf(raw[0], ctx);
    if (!r) return E("value");
    const s = r.sheet ? ctx.sheetIndex(r.sheet) : ctx.sheet;
    return !!ctx.formula?.(s, r.r1, r.c1);
  });
  def("SHEET", (a, ctx, raw) => {
    if (!raw.length) return ctx.sheet + 1;
    const r = refOf(raw[0], ctx);
    if (r) return (r.sheet ? ctx.sheetIndex(r.sheet) : ctx.sheet) + 1;
    const s = str(a[0]);
    if (isError(s)) return s;
    const i = ctx.sheetIndex(s);
    return i >= 0 ? i + 1 : E("na");
  });
  def("SHEETS", (_a, ctx) => ctx.sheetCount ?? 1);
  def("CELL", (a, ctx, raw) => {
    const what = str(a[0]);
    if (isError(what)) return what;
    const r = raw[1] ? refOf(raw[1], ctx) : { sheet: undefined, r1: ctx.row, c1: ctx.col, r2: ctx.row, c2: ctx.col };
    if (!r) return E("value");
    const v = raw[1] ? scalar(a[1]) : null;
    switch (what.toLowerCase()) {
      case "address":
      case "adresse":
        return F.ADDRESS([r.r1 + 1, r.c1 + 1], ctx, []);
      case "row":
      case "zeile":
        return r.r1 + 1;
      case "col":
      case "spalte":
        return r.c1 + 1;
      case "contents":
      case "inhalt":
        return v;
      case "type":
      case "typ":
        return v === null ? "b" : typeof v === "string" ? "l" : "v";
    }
    return E("value");
  });
  def("TYPE", (a) => {
    const v = a[0];
    if (isMatrix(v) && (v.length > 1 || (v[0]?.length ?? 0) > 1)) return 64;
    const s = scalar(v);
    return typeof s === "number" || s === null ? 1 : typeof s === "string" ? 2 : typeof s === "boolean" ? 4 : 16;
  });
  def("ERROR.TYPE", (a) => {
    const v = scalar(a[0]);
    if (!isError(v)) return E("na");
    const codes: Record<string, number> = { "#NULL!": 1, "#DIV/0!": 2, "#VALUE!": 3, "#REF!": 4, "#NAME?": 5, "#NUM!": 6, "#N/A": 7, "#GETTING_DATA": 8, "#SPILL!": 9, "#CALC!": 14 };
    return codes[v.error] ?? E("na");
  });
  def("ISNONTEXT", (a) => typeof scalar(a[0]) !== "string");

  // ----------------------------------------------- logic and lambdas --
  def("SWITCH", (a) => {
    const v = scalar(a[0]);
    if (isError(v)) return v;
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (lookupEq(scalar(a[i]), v)) return a[i + 1];
    return i < a.length ? a[i] : E("na");
  });
  const lambdaArg = (v: Value | undefined) => (h.isLambda(v) ? v : null);
  def("MAP", (a, ctx) => {
    const f = lambdaArg(a[a.length - 1]);
    if (!f) return E("value");
    const arrays = a.slice(0, -1).map(asMatrix);
    const rows = Math.max(...arrays.map((m) => m.length));
    const cols = Math.max(...arrays.map((m) => m[0]?.length ?? 0));
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => scalar(h.applyLambda(f, arrays.map((m) => m[r]?.[c] ?? E("na")), ctx))));
  });
  def("REDUCE", (a, ctx) => {
    const f = lambdaArg(a[2]);
    if (!f) return E("value");
    let acc: Value = a[0] === "" ? 0 : a[0];
    for (const x of asMatrix(a[1]).flat()) acc = h.applyLambda(f, [acc, x], ctx);
    return acc;
  });
  def("SCAN", (a, ctx) => {
    const f = lambdaArg(a[2]);
    if (!f) return E("value");
    let acc: Value = a[0] === "" ? 0 : a[0];
    return asMatrix(a[1]).map((r) =>
      r.map((x) => {
        acc = h.applyLambda(f, [acc, x], ctx);
        return scalar(acc);
      }),
    );
  });
  def("BYROW", (a, ctx) => {
    const f = lambdaArg(a[1]);
    if (!f) return E("value");
    return asMatrix(a[0]).map((r) => [scalar(h.applyLambda(f, [[r]], ctx))]);
  });
  def("BYCOL", (a, ctx) => {
    const f = lambdaArg(a[1]);
    if (!f) return E("value");
    const m = asMatrix(a[0]);
    return [(m[0] ?? []).map((_, c) => scalar(h.applyLambda(f, [m.map((r) => [r[c]])], ctx)))];
  });
  def("MAKEARRAY", (a, ctx) => {
    const rows = toNum(scalar(a[0]));
    const cols = toNum(scalar(a[1]));
    const f = lambdaArg(a[2]);
    if (isError(rows)) return rows;
    if (isError(cols)) return cols;
    if (!f || rows < 1 || cols < 1) return E("value");
    return Array.from({ length: Math.trunc(rows) }, (_, r) => Array.from({ length: Math.trunc(cols) }, (_, c) => scalar(h.applyLambda(f, [r + 1, c + 1], ctx))));
  });
  def("GROUPBY", (a, ctx) => {
    // GROUPBY(row_fields, values, function, [field_headers], [total_depth], [sort_order])
    const keys = asMatrix(a[0]);
    const vals = asMatrix(a[1]);
    const f = lambdaArg(a[2]);
    if (!f) return E("value");
    if (keys.length !== vals.length) return E("value");
    const headers = nums(a, 3, 0) as number;
    const totals = nums(a, 4, 1) as number;
    const sort = nums(a, 5, 1) as number;
    const start = headers === 1 || headers === 3 ? 1 : 0;
    const groups = new Map<string, { key: Scalar[]; rows: Scalar[][] }>();
    for (let i = start; i < keys.length; i++) {
      const k = JSON.stringify(keys[i]);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { key: keys[i], rows: [] }));
      g.rows.push(vals[i]);
    }
    const list = [...groups.values()];
    const col = Math.abs(sort) - 1;
    if (col >= 0) list.sort((x, y) => compare(x.key[col] ?? null, y.key[col] ?? null) * (sort < 0 ? -1 : 1));
    const agg = (rows: Scalar[][]) => (vals[0] ?? []).map((_, c) => scalar(h.applyLambda(f, [rows.map((r) => [r[c]])], ctx)));
    const out: Matrix = [];
    if (headers >= 2 && start === 1) out.push([...keys[0], ...vals[0]]);
    for (const g of list) out.push([...g.key, ...agg(g.rows)]);
    if (totals !== 0) out.push([...keys[0].map((_, i) => (i === 0 ? "Gesamt" : null)), ...agg(vals.slice(start))]);
    return out;
  });
  // MULTIPLE.OPERATIONS(Formelzelle; Zelle1; Wert1 [; Zelle2; Wert2]): the
  // formula cell's value with cells replaced (data tables, like LibreOffice).
  def("MULTIPLE.OPERATIONS", (a, ctx, raw) => {
    const target = refOf(raw[0], ctx);
    if (!target || !ctx.evalWith) return E("ref");
    const sheetOf = (r: { sheet?: string }) => (r.sheet ? ctx.sheetIndex(r.sheet) : ctx.sheet);
    const pairs: { sheet: number; r: number; c: number; v: Scalar }[] = [];
    for (let i = 1; i + 1 < raw.length; i += 2) {
      const cell = refOf(raw[i], ctx);
      if (!cell) return E("ref");
      pairs.push({ sheet: sheetOf(cell), r: cell.r1, c: cell.c1, v: scalar(a[i + 1]) });
    }
    return ctx.evalWith(sheetOf(target), target.r1, target.c1, pairs);
  });
  def("PERCENTOF", (a) => {
    const part = collect([a[0]]);
    const all = collect([a[1]]);
    if (isError(part)) return part;
    if (isError(all)) return all;
    const t = all.reduce((s, x) => s + x, 0);
    return t === 0 ? E("div0") : part.reduce((s, x) => s + x, 0) / t;
  });

  // ------------------------------------------------------ engineering --
  const toBase = (n: number, radix: number, places: number | undefined): Scalar => {
    const max = { 2: 512, 8: 536870912, 16: 549755813888 }[radix]!;
    if (n < -max || n >= max) return E("num");
    let s = (n < 0 ? Math.pow(radix, 10) + n : n).toString(radix).toUpperCase();
    if (places !== undefined && n >= 0) {
      if (s.length > places) return E("num");
      s = s.padStart(places, "0");
    }
    return s;
  };
  const fromBase = (s: string, radix: number): Scalar => {
    const t = s.trim().toUpperCase();
    if (t.length > 10 || !t.length || ![...t].every((c) => parseInt(c, radix) >= 0)) return E("num");
    const v = parseInt(t, radix);
    // Ten digits: the first one is the sign bit (two's complement).
    return t.length === 10 && parseInt(t[0], radix) >= radix / 2 ? v - Math.pow(radix, 10) : v;
  };
  const baseFns: [string, number, number][] = [["BIN", 2, 0], ["OCT", 8, 0], ["HEX", 16, 0], ["DEC", 10, 0]];
  for (const [from, rf] of baseFns) {
    for (const [to, rt] of baseFns) {
      if (from === to) continue;
      def(`${from}2${to}`, (a) => {
        const raw0 = scalar(a[0]);
        let n: Scalar;
        if (rf === 10) {
          const x = toNum(raw0);
          if (isError(x)) return x;
          n = Math.trunc(x);
        } else {
          const s = toStr(raw0);
          if (isError(s)) return s;
          n = fromBase(s, rf);
        }
        if (isError(n)) return n;
        const places = a[1] !== undefined ? toNum(scalar(a[1])) : undefined;
        if (isError(places)) return places;
        return rt === 10 ? n : toBase(n as number, rt, places === undefined ? undefined : Math.trunc(places));
      });
    }
  }
  const bitOp = (f: (x: bigint, y: bigint) => bigint): Fn => numeric([undefined, undefined], (x, y) => {
    if (x < 0 || y < 0 || x >= 2 ** 48 || y >= 2 ** 48 || !Number.isInteger(x) || !Number.isInteger(y)) return E("num");
    return Number(f(BigInt(x), BigInt(y)));
  });
  def("BITAND", bitOp((x, y) => x & y));
  def("BITOR", bitOp((x, y) => x | y));
  def("BITXOR", bitOp((x, y) => x ^ y));
  def("BITLSHIFT", numeric([undefined, undefined], (x, s) => (x < 0 || x >= 2 ** 48 || Math.abs(s) > 53 ? E("num") : Number(s >= 0 ? BigInt(x) << BigInt(s) : BigInt(x) >> BigInt(-s)))));
  def("BITRSHIFT", numeric([undefined, undefined], (x, s) => (x < 0 || x >= 2 ** 48 || Math.abs(s) > 53 ? E("num") : Number(s >= 0 ? BigInt(x) >> BigInt(s) : BigInt(x) << BigInt(-s)))));
  def("DELTA", numeric([undefined, 0], (x, y) => (x === y ? 1 : 0)));
  def("GESTEP", numeric([undefined, 0], (x, s) => (x >= s ? 1 : 0)));
  def("CONVERT", (a) => {
    const x = toNum(scalar(a[0]));
    const from = str(a[1]);
    const to = str(a[2]);
    if (isError(x)) return x;
    if (isError(from)) return from;
    if (isError(to)) return to;
    const t = convertTemp(x, from, to);
    if (t !== null) return t;
    const f = unit(from);
    const g = unit(to);
    if (!f || !g || f[0] !== g[0]) return E("na");
    return (x * f[1]) / g[1];
  });

  // --------------------------------------------------------- database --
  const dbValues = (a: Value[]): Scalar[] | FormulaError => {
    const db = asMatrix(a[0]);
    const crit = asMatrix(a[2]);
    const head = db[0] ?? [];
    const fieldV = scalar(a[1]);
    let col = -1;
    if (typeof fieldV === "number") col = Math.trunc(fieldV) - 1;
    else if (typeof fieldV === "string") col = head.findIndex((x) => typeof x === "string" && x.toLowerCase() === fieldV.toLowerCase());
    if (col < 0 || col >= head.length) return E("value");
    const chead = crit[0] ?? [];
    const conds = crit.slice(1).map((row) =>
      row
        .map((c, j) => ({ c, j: head.findIndex((x) => typeof x === "string" && typeof chead[j] === "string" && x.toLowerCase() === (chead[j] as string).toLowerCase()) }))
        .filter(({ c }) => c !== null && c !== ""),
    );
    if (conds.some((cs) => cs.some(({ j }) => j < 0))) return E("value");
    const out: Scalar[] = [];
    for (const row of db.slice(1)) {
      const hit = !conds.length || conds.some((cs) => cs.every(({ c, j }) => criterion(c)(row[j])));
      if (hit) out.push(row[col]);
    }
    return out;
  };
  const dbFn = (fn: string, raw = false): Fn => (a, ctx) => {
    const v = dbValues(a);
    if (isError(v)) return v;
    if (raw) return F[fn]([[v]], ctx, []);
    return F[fn]([[v.filter((x) => typeof x === "number")]], ctx, []);
  };
  def("DSUM", dbFn("SUM"));
  def("DAVERAGE", dbFn("AVERAGE"));
  def("DCOUNT", dbFn("COUNT", true));
  def("DCOUNTA", dbFn("COUNTA", true));
  def("DMAX", dbFn("MAX"));
  def("DMIN", dbFn("MIN"));
  def("DPRODUCT", dbFn("PRODUCT"));
  def("DSTDEV", dbFn("STDEV.S"));
  def("DSTDEVP", dbFn("STDEV.P"));
  def("DVAR", dbFn("VAR.S"));
  def("DVARP", dbFn("VAR.P"));
  def("DGET", (a) => {
    const v = dbValues(a);
    if (isError(v)) return v;
    return v.length === 1 ? v[0] : v.length ? E("num") : E("value");
  });
}
