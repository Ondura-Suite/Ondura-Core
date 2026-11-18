// Data tools: text to columns (Text in Spalten) and flash fill (Blitzvorschau).

// ------------------------------------------------------- text to columns --

export interface SplitOptions {
  mode: "delimited" | "fixed";
  /** Delimiters for "delimited" (tab, ";", ",", " ", or custom characters). */
  delimiters: string[];
  /** Consecutive delimiters count as one. */
  merge: boolean;
  /** Text qualifier: delimiters inside are ignored. */
  quote: '"' | "'" | "";
  /** Column starts (character positions) for "fixed". */
  breaks: number[];
}

/** Splits one text into fields. */
export function splitText(text: string, o: SplitOptions): string[] {
  if (o.mode === "fixed") {
    const cuts = [0, ...o.breaks.filter((b) => b > 0).sort((a, b) => a - b)];
    return cuts.map((c, i) => text.slice(c, cuts[i + 1]).trim());
  }
  const delims = new Set(o.delimiters);
  if (!delims.size) return [text];
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let lastWasDelim = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (o.quote && ch === o.quote) {
      if (quoted && text[i + 1] === o.quote) {
        cur += ch;
        i++;
      } else quoted = !quoted;
      lastWasDelim = false;
      continue;
    }
    if (!quoted && delims.has(ch)) {
      if (!(o.merge && lastWasDelim)) {
        out.push(cur);
        cur = "";
      }
      lastWasDelim = true;
      continue;
    }
    cur += ch;
    lastWasDelim = false;
  }
  out.push(cur);
  return out;
}

/** Proposed column breaks for fixed width: positions where every line has a space. */
export function guessBreaks(lines: string[]): number[] {
  const max = Math.max(0, ...lines.map((l) => l.length));
  const out: number[] = [];
  for (let p = 1; p < max; p++) {
    const blank = lines.every((l) => p >= l.length || l[p - 1] === " ");
    const next = lines.some((l) => p < l.length && l[p] !== " ");
    if (blank && next) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------ flash fill --

type Transform = "same" | "upper" | "lower" | "proper";

/** One piece of a flash-fill program. */
type Piece =
  | { k: "lit"; s: string }
  /** Word `i` (negative = from the end) of source column `col`, maybe only its first letter. */
  | { k: "tok"; col: number; i: number; tf: Transform; initial?: boolean }
  /** The whole source value. */
  | { k: "all"; col: number; tf: Transform }
  /** Fixed character range of a source value. */
  | { k: "sub"; col: number; from: number; len: number; tf: Transform };

const WORD = /[\p{L}\p{N}]+/gu;
const words = (s: string) => s.match(WORD) ?? [];

function apply(tf: Transform, s: string): string {
  if (tf === "upper") return s.toLocaleUpperCase("de");
  if (tf === "lower") return s.toLocaleLowerCase("de");
  if (tf === "proper") return s.toLocaleLowerCase("de").replace(/(^|[^\p{L}])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase("de"));
  return s;
}

function run(piece: Piece, src: string[]): string | null {
  switch (piece.k) {
    case "lit":
      return piece.s;
    case "all":
      return apply(piece.tf, src[piece.col] ?? "");
    case "sub": {
      const v = src[piece.col] ?? "";
      if (v.length < piece.from + piece.len) return null;
      return apply(piece.tf, v.slice(piece.from, piece.from + piece.len));
    }
    case "tok": {
      const w = words(src[piece.col] ?? "");
      const t = piece.i >= 0 ? w[piece.i] : w[w.length + piece.i];
      if (t === undefined) return null;
      return apply(piece.tf, piece.initial ? t[0] : t);
    }
  }
}

const runAll = (prog: Piece[], src: string[]) => {
  let out = "";
  for (const p of prog) {
    const v = run(p, src);
    if (v === null) return null;
    out += v;
  }
  return out;
};

/** Candidate pieces that produce a prefix of `target` from `src`. */
function candidates(src: string[], target: string): Piece[] {
  const out: Piece[] = [];
  const tfs: Transform[] = ["same", "upper", "lower", "proper"];
  src.forEach((v, col) => {
    const w = words(v);
    for (const tf of tfs) {
      out.push({ k: "all", col, tf });
      w.forEach((_, i) => {
        out.push({ k: "tok", col, i, tf });
        out.push({ k: "tok", col, i: i - w.length, tf });
        out.push({ k: "tok", col, i, tf, initial: true });
        out.push({ k: "tok", col, i: i - w.length, tf, initial: true });
      });
    }
    // Fixed positions (e.g. the first three characters of a code).
    for (let from = 0; from < Math.min(v.length, 12); from++)
      for (let len = 1; len <= Math.min(v.length - from, 12); len++) out.push({ k: "sub", col, from, len, tf: "same" });
  });
  return out.filter((p) => {
    const s = run(p, src);
    return s !== null && s.length > 0 && target.startsWith(s);
  });
}

/** Programs that turn `src` into `target` (bounded search, longest pieces first). */
function programs(src: string[], target: string, limit = 400): Piece[][] {
  const found: Piece[][] = [];
  const walk = (rest: string, prog: Piece[]) => {
    if (found.length >= limit) return;
    if (!rest) {
      found.push(prog);
      return;
    }
    const cands = candidates(src, rest)
      .map((p) => ({ p, n: run(p, src)!.length }))
      .sort((a, b) => b.n - a.n || rank(a.p) - rank(b.p));
    // Single characters from fixed positions are mostly coincidence.
    // A one-letter piece inside a run of letters ("inter|n|et") is a coincidence.
    const at = target.length - rest.length;
    const alnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
    const isolated = !alnum(target[at - 1]) || !alnum(target[at + 1]);
    for (const { p, n } of cands.filter((c) => c.n > 1 || (c.p.k !== "sub" && isolated)).slice(0, 6)) walk(rest.slice(n), [...prog, p]);
    // A literal character (separators like ", " or "@", constant text).
    const last = prog[prog.length - 1];
    walk(rest.slice(1), last?.k === "lit" ? [...prog.slice(0, -1), { k: "lit", s: last.s + rest[0] }] : [...prog, { k: "lit", s: rest[0] }]);
  };
  walk(target, []);
  return found;
}

/** Prefer words over fixed positions and unchanged case. */
const rank = (p: Piece) => (p.k === "lit" ? 0 : p.k === "tok" ? (p.initial ? 2 : 0) : p.k === "all" ? 1 : 3) + (p.k !== "lit" && p.tf !== "same" ? 0.5 : 0);

/**
 * Flash fill: from example rows (sources → typed result) find a program and
 * apply it to the other rows. Returns null when no consistent pattern exists.
 */
export function flashFill(examples: { src: string[]; out: string }[], rows: string[][]): string[] | null {
  if (!examples.length) return null;
  const [first, ...more] = examples;
  const progs = programs(first.src, first.out).filter((prog) => more.every((e) => runAll(prog, e.src) === e.out));
  if (!progs.length) return null;
  // Simplest program: fewest pieces, then best ranked.
  // Constant letters and digits are a last resort: they rarely generalise.
  const cost = (prog: Piece[]) => prog.length + prog.reduce((n, p) => n + (p.k === "lit" ? 3 * (p.s.match(/[\p{L}\p{N}]/gu)?.length ?? 0) : 0), 0);
  progs.sort((a, b) => cost(a) - cost(b) || a.reduce((n, p) => n + rank(p), 0) - b.reduce((n, p) => n + rank(p), 0));
  const best = progs[0];
  return rows.map((src) => runAll(best, src) ?? "");
}
