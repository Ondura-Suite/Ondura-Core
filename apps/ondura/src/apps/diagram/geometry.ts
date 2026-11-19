// Geometry of Ondura Diagramme: connection points, connector routes
// (orthogonal with automatic sides, straight, curved), arrow heads and
// text wrapping.

import type { Edge, Page, Point, Port, Shape } from "./model";

/** The four default connection points (top, right, bottom, left). */
export const PORTS: Port[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
];

export const portPoint = (s: Shape, p: Port): Point => ({ x: s.x + s.w * p.x, y: s.y + s.h * p.y });

/** Outward direction of a port (unit vector along the nearest side). */
export function portDir(p: Port): Point {
  const d = [
    { v: p.y, dir: { x: 0, y: -1 } },
    { v: 1 - p.x, dir: { x: 1, y: 0 } },
    { v: 1 - p.y, dir: { x: 0, y: 1 } },
    { v: p.x, dir: { x: -1, y: 0 } },
  ].sort((a, b) => a.v - b.v);
  return d[0].dir;
}

const center = (s: Shape): Point => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

/** Sides facing each other when no port was chosen. */
export function autoPorts(a: Shape, b: Shape): [Port, Port] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  // Clearly side by side: right/left; otherwise top/bottom.
  if (Math.abs(dx) - (a.w + b.w) / 4 > Math.abs(dy) - (a.h + b.h) / 4) return dx > 0 ? [PORTS[1], PORTS[3]] : [PORTS[3], PORTS[1]];
  return dy > 0 ? [PORTS[2], PORTS[0]] : [PORTS[0], PORTS[2]];
}

/** Port of a shape facing a free point. */
function portTowards(s: Shape, p: Point): Port {
  const c = center(s);
  const dx = (p.x - c.x) / Math.max(1, s.w);
  const dy = (p.y - c.y) / Math.max(1, s.h);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? PORTS[1] : PORTS[3]) : dy > 0 ? PORTS[2] : PORTS[0];
}

export interface Route {
  points: Point[];
  /** SVG path. */
  d: string;
  /** Middle of the route (label position). */
  mid: Point;
  startDir: Point;
  endDir: Point;
}

function polylineMid(pts: Point[]): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= l && l > 0) return { x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * half) / l, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * half) / l };
    half -= l;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

/** Orthogonal route between two points leaving/entering in the given directions. */
export function orthogonal(a: Point, da: Point, b: Point, db: Point, gap = 18): Point[] {
  const a1 = { x: a.x + da.x * gap, y: a.y + da.y * gap };
  const b1 = { x: b.x + db.x * gap, y: b.y + db.y * gap };
  const horizA = da.x !== 0;
  const horizB = db.x !== 0;
  let mid: Point[];
  if (horizA && horizB) {
    const mx = (a1.x + b1.x) / 2;
    mid = [{ x: mx, y: a1.y }, { x: mx, y: b1.y }];
  } else if (!horizA && !horizB) {
    const my = (a1.y + b1.y) / 2;
    mid = [{ x: a1.x, y: my }, { x: b1.x, y: my }];
  } else if (horizA) mid = [{ x: b1.x, y: a1.y }];
  else mid = [{ x: a1.x, y: b1.y }];
  const pts = [a, a1, ...mid, b1, b];
  // Drop points that lie on a straight segment.
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const q = pts[i - 1];
    const r = pts[i + 1];
    const same = (Math.abs(q.x - p.x) < 0.5 && Math.abs(p.x - r.x) < 0.5) || (Math.abs(q.y - p.y) < 0.5 && Math.abs(p.y - r.y) < 0.5);
    const dup = Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5;
    return !same && !dup;
  });
}

/** Route of a connector on a page. */
export function route(e: Edge, page: Page): Route | null {
  const src = e.source ? page.shapes.find((s) => s.id === e.source) : undefined;
  const dst = e.target ? page.shapes.find((s) => s.id === e.target) : undefined;
  const endFree = dst ? null : (e.to ?? null);
  const startFree = src ? null : (e.from ?? null);
  if ((!src && !startFree) || (!dst && !endFree)) return null;
  let pa: Port | null = e.sourcePort ?? null;
  let pb: Port | null = e.targetPort ?? null;
  if (src && dst && (!pa || !pb)) {
    const [x, y] = autoPorts(src, dst);
    pa ??= x;
    pb ??= y;
  }
  if (src && !pa) pa = portTowards(src, e.points[0] ?? endFree!);
  if (dst && !pb) pb = portTowards(dst, e.points[e.points.length - 1] ?? startFree!);
  const a = src ? portPoint(src, pa!) : startFree!;
  const b = dst ? portPoint(dst, pb!) : endFree!;
  const da = pa ? portDir(pa) : unit(a, e.points[0] ?? b);
  const db = pb ? portDir(pb) : unit(b, e.points[e.points.length - 1] ?? a);
  let pts: Point[];
  if (e.points.length) pts = [a, ...e.points, b];
  else if (e.style === "orthogonal") pts = orthogonal(a, da, b, db);
  else pts = [a, b];
  let d: string;
  if (e.style === "curved" && !e.points.length) {
    const k = Math.max(30, Math.hypot(b.x - a.x, b.y - a.y) / 3);
    d = `M${a.x},${a.y} C${a.x + da.x * k},${a.y + da.y * k} ${b.x + db.x * k},${b.y + db.y * k} ${b.x},${b.y}`;
  } else d = "M" + pts.map((p) => `${round(p.x)},${round(p.y)}`).join(" L");
  const last = pts[pts.length - 2] ?? a;
  const first = pts[1] ?? b;
  return {
    points: pts,
    d,
    mid: e.style === "curved" && !e.points.length ? { x: (a.x + b.x) / 2 + (da.x + db.x) * 10, y: (a.y + b.y) / 2 + (da.y + db.y) * 10 } : polylineMid(pts),
    startDir: e.style === "curved" ? { x: -da.x, y: -da.y } : unit(first, a),
    endDir: e.style === "curved" ? { x: -db.x, y: -db.y } : unit(last, b),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

function unit(from: Point, to: Point): Point {
  const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / l, y: (to.y - from.y) / l };
}

/** Lines of a text wrapped to `width` (measured with a canvas). */
let measureCtx: CanvasRenderingContext2D | null = null;
export function wrapText(text: string, width: number, fontSize: number, bold = false, italic = false): string[] {
  if (!text) return [];
  if (typeof document === "undefined") return text.split("\n");
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  if (!ctx) return text.split("\n");
  ctx.font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${fontSize}px "Segoe UI", Inter, Arial, sans-serif`;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next.trimEnd()).width > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
        // A single word wider than the box is broken by characters.
        while (ctx.measureText(line).width > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Snaps a value to the grid. */
export const snap = (v: number, grid: number, on: boolean) => (on ? Math.round(v / grid) * grid : Math.round(v));

/** Shapes and edges inside a rectangle (rubber-band selection). */
export function inRect(page: Page, r: { x: number; y: number; w: number; h: number }): string[] {
  const ids = page.shapes.filter((s) => s.x >= r.x && s.y >= r.y && s.x + s.w <= r.x + r.w && s.y + s.h <= r.y + r.h).map((s) => s.id);
  for (const e of page.edges) {
    const rt = route(e, page);
    if (rt && rt.points.every((p) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h)) ids.push(e.id);
  }
  return ids;
}
