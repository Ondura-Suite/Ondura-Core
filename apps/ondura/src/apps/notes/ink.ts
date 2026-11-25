// Handwriting and drawings of OneNote pages. Microsoft Graph returns ink
// only when asked for it (`includeInkML=true`), as an InkML part next to the
// page HTML in a multipart answer. Ondura draws it as SVG; editing ink is
// left to OneNote.

/** One pen stroke in page coordinates (himetric, origin top left). */
export interface Stroke {
  points: [number, number][];
  color: string;
  width: number;
  opacity: number;
  /** Highlighter: drawn behind and blended with what is underneath. */
  highlighter: boolean;
}

/** Himetric (1/1000 cm) per CSS pixel. */
export const HIMETRIC_PER_PX = 2540 / 96;

/** Splits a multipart answer into its parts (content type → body). */
export function multipartParts(body: string, contentType: string | null): { type: string; body: string }[] | null {
  const m = /boundary="?([^";]+)"?/i.exec(contentType ?? "");
  if (!m || !/^multipart\//i.test(contentType ?? "")) return null;
  const parts: { type: string; body: string }[] = [];
  for (const chunk of body.split(`--${m[1]}`)) {
    const trimmed = chunk.replace(/^\r?\n/, "");
    if (!trimmed.trim() || trimmed.startsWith("--")) continue;
    const split = /\r?\n\r?\n/.exec(trimmed);
    if (!split) continue;
    const headers = trimmed.slice(0, split.index);
    const type = /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1].trim().toLowerCase() ?? "";
    parts.push({ type, body: trimmed.slice(split.index + split[0].length).replace(/\r?\n$/, "") });
  }
  return parts;
}

const local = (el: Element) => el.localName.replace(/^.*:/, "");
const byLocal = (root: Element | Document, name: string) => Array.from(root.getElementsByTagName("*")).filter((e) => local(e) === name);
const xmlId = (el: Element) => el.getAttribute("xml:id") ?? el.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") ?? el.getAttribute("id") ?? "";
const ref = (v: string | null) => (v ?? "").replace(/^#/, "");

interface Brush {
  color: string;
  width: number;
  opacity: number;
  highlighter: boolean;
}

/**
 * Reads the values of one trace. Besides plain values, InkML allows
 * difference coding: `'` switches a channel to first differences, `"` to
 * second differences and `!` back to explicit values.
 */
export function traceValues(text: string, channels: number): number[][] {
  const out: number[][] = [];
  const mode: string[] = Array(channels).fill("!");
  const last: number[] = Array(channels).fill(0);
  const vel: number[] = Array(channels).fill(0);
  for (const point of text.split(",")) {
    const tokens = point.trim().match(/[!'"]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
    if (!tokens) continue;
    const values: number[] = [];
    let ch = 0;
    for (const t of tokens) {
      if (t === "!" || t === "'" || t === '"') {
        mode[ch] = t;
        continue;
      }
      if (ch >= channels) break;
      const n = parseFloat(t);
      let v: number;
      if (mode[ch] === "'") {
        vel[ch] = n;
        v = last[ch] + n;
      } else if (mode[ch] === '"') {
        vel[ch] += n;
        v = last[ch] + vel[ch];
      } else {
        vel[ch] = n - last[ch];
        v = n;
      }
      last[ch] = v;
      values.push(v);
      ch++;
    }
    if (values.length >= 2) out.push(values);
  }
  return out;
}

/** Parses the InkML part of a page. */
export function parseInk(xml: string): Stroke[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  // Channel layout per context (position of X and Y, number of channels).
  const contexts = new Map<string, { x: number; y: number; n: number }>();
  for (const ctx of byLocal(doc, "context")) {
    const names = byLocal(ctx, "channel").map((c) => (c.getAttribute("name") ?? "").toUpperCase());
    if (names.length) contexts.set(xmlId(ctx), { x: Math.max(0, names.indexOf("X")), y: names.indexOf("Y") < 0 ? 1 : names.indexOf("Y"), n: names.length });
  }
  const fallbackCtx = (() => {
    const names = byLocal(doc, "traceFormat")[0] ? byLocal(byLocal(doc, "traceFormat")[0], "channel").map((c) => (c.getAttribute("name") ?? "").toUpperCase()) : [];
    return names.length ? { x: Math.max(0, names.indexOf("X")), y: names.indexOf("Y") < 0 ? 1 : names.indexOf("Y"), n: names.length } : { x: 0, y: 1, n: 3 };
  })();
  const brushes = new Map<string, Brush>();
  for (const b of byLocal(doc, "brush")) {
    const props = new Map(byLocal(b, "brushProperty").map((p) => [(p.getAttribute("name") ?? "").toLowerCase(), p.getAttribute("value") ?? ""]));
    const transparency = Math.min(255, Math.max(0, Number(props.get("transparency")) || 0));
    const highlighter = /maskpen/i.test(props.get("rasterop") ?? "");
    brushes.set(xmlId(b), { color: /^#[0-9a-f]{3,8}$/i.test(props.get("color") ?? "") ? props.get("color")! : "#000000", width: Number(props.get("width")) || 53, opacity: (1 - transparency / 256) * (highlighter ? 0.5 : 1), highlighter });
  }
  const defaultBrush: Brush = { color: "#000000", width: 53, opacity: 1, highlighter: false };
  const strokes: Stroke[] = [];
  for (const t of byLocal(doc, "trace")) {
    // brushRef/contextRef may sit on an enclosing traceGroup.
    let brushId = t.getAttribute("brushRef");
    let ctxId = t.getAttribute("contextRef");
    for (let p = t.parentElement; p && (!brushId || !ctxId); p = p.parentElement) {
      brushId ??= p.getAttribute("brushRef");
      ctxId ??= p.getAttribute("contextRef");
    }
    const ctx = contexts.get(ref(ctxId)) ?? fallbackCtx;
    const brush = brushes.get(ref(brushId)) ?? defaultBrush;
    const points = traceValues(t.textContent ?? "", ctx.n)
      .filter((v) => v.length > Math.max(ctx.x, ctx.y))
      .map((v) => [v[ctx.x], v[ctx.y]] as [number, number]);
    if (points.length) strokes.push({ points, ...brush });
  }
  return strokes;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function strokeBounds(strokes: Stroke[]): Bounds {
  const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const s of strokes) {
    const r = s.width / 2;
    for (const [x, y] of s.points) {
      b.left = Math.min(b.left, x - r);
      b.top = Math.min(b.top, y - r);
      b.right = Math.max(b.right, x + r);
      b.bottom = Math.max(b.bottom, y + r);
    }
  }
  return b;
}

/**
 * Groups strokes into vertical bands: strokes whose extents overlap (or are
 * closer than `gap`) belong to the same drawing, so ink can be placed
 * between the text blocks it sits between on the page.
 */
export function inkBands(strokes: Stroke[], gap = 1500): Stroke[][] {
  const items = strokes.map((s) => ({ s, b: strokeBounds([s]) })).sort((a, b) => a.b.top - b.b.top);
  const bands: { strokes: Stroke[]; bottom: number }[] = [];
  for (const it of items) {
    const last = bands[bands.length - 1];
    if (last && it.b.top <= last.bottom + gap) {
      last.strokes.push(it.s);
      last.bottom = Math.max(last.bottom, it.b.bottom);
    } else bands.push({ strokes: [it.s], bottom: it.b.bottom });
  }
  return bands.map((b) => b.strokes);
}

const isBlack = (color: string) => {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return true;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Black and near-black only; dark blue or red ink keeps its colour.
  return Math.max(r, g, b) < 60;
};

const num = (v: number) => (Math.round(v * 10) / 10).toString();

/**
 * SVG of strokes, cropped to their extent and sized like on the page.
 * Black ink follows the text colour, so it stays readable in dark mode
 * (as in OneNote).
 */
export function inkSvg(strokes: Stroke[]): string {
  if (!strokes.length) return "";
  const b = strokeBounds(strokes);
  const w = Math.max(1, b.right - b.left);
  const h = Math.max(1, b.bottom - b.top);
  const ordered = [...strokes.filter((s) => s.highlighter), ...strokes.filter((s) => !s.highlighter)];
  const paths = ordered.map((s) => {
    const [first, ...rest] = s.points;
    const d = `M${num(first[0] - b.left)} ${num(first[1] - b.top)}` + (rest.length ? rest.map(([x, y]) => `L${num(x - b.left)} ${num(y - b.top)}`).join("") : "l0 0");
    const color = isBlack(s.color) ? "currentColor" : s.color;
    const blend = s.highlighter ? ' style="mix-blend-mode:multiply"' : "";
    return `<path d="${d}" stroke="${color}" stroke-width="${num(s.width)}"${s.opacity < 1 ? ` stroke-opacity="${num(s.opacity)}"` : ""}${blend}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w / HIMETRIC_PER_PX)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</svg>`;
}
