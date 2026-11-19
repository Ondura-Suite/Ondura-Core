// Treemap, sunburst and box & whisker charts (Excel 2016 chart types).

import type { Chart, ChartSeries } from "./ChartView";
import { LOCALE } from "../../lib/i18n";

const PALETTE = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"];
const fmt = (v: number) => v.toLocaleString(LOCALE, { maximumFractionDigits: 2 });

interface TreeNode {
  name: string;
  value: number;
  children: TreeNode[];
  /** Index of the top-level branch (colour). */
  branch: number;
}

/** Tree of the category paths of a series (empty path parts are skipped). */
export function buildTree(s: ChartSeries): TreeNode {
  const root: TreeNode = { name: "", value: 0, children: [], branch: 0 };
  const n = Math.max(s.values.length, s.levels?.length ?? s.categories.length);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, s.values[i] ?? 0);
    if (!v) continue;
    const path = (s.levels?.[i] ?? [s.categories[i] ?? String(i + 1)]).filter((x) => x !== "");
    let node = root;
    root.value += v;
    path.forEach((name, d) => {
      let child = node.children.find((c) => c.name === name);
      if (!child) {
        child = { name, value: 0, children: [], branch: d === 0 ? root.children.length : node.branch };
        node.children.push(child);
      }
      child.value += v;
      node = child;
    });
  }
  return root;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout of `items` (sorted by size) in `box`. */
function squarify<T extends { value: number }>(items: T[], box: Rect): (T & Rect)[] {
  const out: (T & Rect)[] = [];
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / total;
  const rest = [...items].sort((a, b) => b.value - a.value);
  let { x, y, w, h } = box;
  while (rest.length) {
    const side = Math.min(w, h);
    const row: T[] = [];
    let worst = Infinity;
    while (rest.length) {
      const cand = [...row, rest[0]];
      const sum = cand.reduce((a, b) => a + b.value * scale, 0);
      const max = Math.max(...cand.map((c) => c.value * scale));
      const min = Math.min(...cand.map((c) => c.value * scale));
      const ratio = Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
      if (ratio > worst) break;
      worst = ratio;
      row.push(rest.shift()!);
    }
    const sum = row.reduce((a, b) => a + b.value * scale, 0);
    const thick = sum / side;
    let off = 0;
    for (const it of row) {
      const len = (it.value * scale) / thick;
      out.push(w >= h ? { ...it, x, y: y + off, w: thick, h: len } : { ...it, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
  }
  return out;
}

const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

export function renderTreemap(chart: Chart, box: Rect, scale: number, font: number, out: React.ReactNode[]) {
  const s = chart.series.find((x) => x.values.length);
  if (!s) return;
  const root = buildTree(s);
  const pad = 2 * scale;
  const header = font * 1.4;
  const draw = (nodes: TreeNode[], area: Rect, depth: number) => {
    for (const n of squarify(nodes, area)) {
      const color = PALETTE[n.branch % PALETTE.length];
      const key = `tm${depth}-${n.branch}-${n.name}-${Math.round(n.x)}-${Math.round(n.y)}`;
      if (n.children.length) {
        out.push(<rect key={key} x={n.x} y={n.y} width={Math.max(0, n.w)} height={Math.max(0, n.h)} fill={shade(color, 0.15 * depth)} stroke="#fff" strokeWidth={pad} />);
        if (n.h > header * 1.6 && n.w > font * 3) {
          out.push(<text key={`${key}t`} x={n.x + 4 * scale} y={n.y + font * 1.05} fontSize={font} fill="#fff" fontWeight={600}>{n.name}</text>);
          draw(n.children, { x: n.x + pad, y: n.y + header, w: n.w - 2 * pad, h: n.h - header - pad }, depth + 1);
        } else draw(n.children, { x: n.x + pad, y: n.y + pad, w: n.w - 2 * pad, h: n.h - 2 * pad }, depth + 1);
      } else {
        out.push(<rect key={key} x={n.x} y={n.y} width={Math.max(0, n.w)} height={Math.max(0, n.h)} fill={shade(color, 0.12 * depth)} stroke="#fff" strokeWidth={pad / 2} />);
        if (n.w > font * 2.5 && n.h > font * 1.4) {
          out.push(<text key={`${key}t`} x={n.x + 4 * scale} y={n.y + font * 1.2} fontSize={font * 0.9} fill="#fff">{n.name}</text>);
          if (n.h > font * 2.6) out.push(<text key={`${key}v`} x={n.x + 4 * scale} y={n.y + font * 2.3} fontSize={font * 0.85} fill="#fff" opacity={0.85}>{fmt(n.value)}</text>);
        }
      }
    }
  };
  draw(root.children, box, 0);
}

export function renderSunburst(chart: Chart, box: Rect, scale: number, font: number, out: React.ReactNode[]) {
  const s = chart.series.find((x) => x.values.length);
  if (!s) return;
  const root = buildTree(s);
  const depth = (n: TreeNode): number => (n.children.length ? 1 + Math.max(...n.children.map(depth)) : 0);
  const levels = Math.max(1, depth(root));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const R = Math.max(10, Math.min(box.w, box.h) / 2 - 4 * scale);
  const hole = R * 0.18;
  const ring = (R - hole) / levels;
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  const draw = (nodes: TreeNode[], a0: number, a1: number, d: number, total: number) => {
    let a = a0;
    for (const n of nodes) {
      const span = ((a1 - a0) * n.value) / (total || 1);
      const b = a + span;
      const r0 = hole + d * ring;
      const r1 = r0 + ring;
      const large = span > Math.PI ? 1 : 0;
      const dPath = span >= Math.PI * 2 - 1e-6
        ? `M${cx - r1},${cy}a${r1},${r1} 0 1,0 ${r1 * 2},0a${r1},${r1} 0 1,0 ${-r1 * 2},0M${cx - r0},${cy}a${r0},${r0} 0 1,1 ${r0 * 2},0a${r0},${r0} 0 1,1 ${-r0 * 2},0`
        : `M${p(r1, a)}A${r1},${r1} 0 ${large},1 ${p(r1, b)}L${p(r0, b)}A${r0},${r0} 0 ${large},0 ${p(r0, a)}Z`;
      out.push(<path key={`sb${d}-${n.branch}-${n.name}-${a.toFixed(3)}`} d={dPath} fill={shade(PALETTE[n.branch % PALETTE.length], 0.18 * d)} stroke="#fff" strokeWidth={1.2 * scale} fillRule="evenodd" />);
      // Label along the middle of the segment if it fits.
      const mid = (a + b) / 2;
      const rm = (r0 + r1) / 2;
      if (span * rm > n.name.length * font * 0.5 && ring > font * 1.1) {
        out.push(<text key={`sbt${d}-${n.branch}-${n.name}-${a.toFixed(3)}`} x={cx + rm * Math.cos(mid)} y={cy + rm * Math.sin(mid) + font / 3} textAnchor="middle" fontSize={font * 0.85} fill="#fff">{n.name}</text>);
      }
      if (n.children.length) draw(n.children, a, b, d + 1, n.value);
      a = b;
    }
  };
  draw(root.children, -Math.PI / 2, Math.PI * 1.5, 0, root.value);
}

/** Quartiles with Excel's default "exclusive" method (QUARTILE.EXC; median inclusive for tiny sets). */
export function boxStats(values: number[]) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return null;
  const q = (p: number) => {
    const pos = p * (n + 1) - 1;
    if (pos <= 0) return v[0];
    if (pos >= n - 1) return v[n - 1];
    const lo = Math.floor(pos);
    return v[lo] + (pos - lo) * (v[lo + 1] - v[lo]);
  };
  const q1 = q(0.25);
  const median = q(0.5);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return {
    q1,
    median,
    q3,
    mean: v.reduce((a, b) => a + b, 0) / n,
    lo: inside[0] ?? v[0],
    hi: inside[inside.length - 1] ?? v[n - 1],
    outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr),
  };
}

export function renderBoxWhisker(chart: Chart, box: Rect, scale: number, font: number, out: React.ReactNode[], niceScale: (a: number, b: number) => { lo: number; hi: number; step: number }) {
  const series = chart.series.filter((s) => s.values.length);
  if (!series.length) return;
  // Groups: categories of a single series, otherwise one box per series.
  const cats = series.length === 1 && series[0].categories.some((c) => c) ? [...new Set(series[0].categories)] : [""];
  const stats = cats.map((cat) =>
    series.map((s) => boxStats(s.values.filter((_, i) => !cat || s.categories[i] === cat).map((x) => x ?? NaN))),
  );
  const all = stats.flat().flatMap((st) => (st ? [st.lo, st.hi, ...st.outliers] : []));
  if (!all.length) return;
  const ys = niceScale(Math.min(...all), Math.max(...all));
  const axisW = Math.max(...[ys.lo, ys.hi].map((v) => fmt(v).length)) * font * 0.6 + 8 * scale;
  const plot = { x: box.x + axisW, y: box.y + font / 2, w: box.w - axisW, h: box.h - font * 2.2 };
  const Y = (v: number) => plot.y + plot.h - ((v - ys.lo) / (ys.hi - ys.lo || 1)) * plot.h;
  for (let v = ys.lo, i = 0; v <= ys.hi + ys.step / 2; v += ys.step, i++) {
    out.push(<line key={`bg${i}`} x1={plot.x} x2={plot.x + plot.w} y1={Y(v)} y2={Y(v)} stroke="#e6e6e6" />);
    out.push(<text key={`by${i}`} x={plot.x - 4 * scale} y={Y(v) + font / 3} textAnchor="end" fontSize={font * 0.9} fill="#595959">{fmt(Math.round(v * 1e9) / 1e9)}</text>);
  }
  const band = plot.w / cats.length;
  stats.forEach((group, gi) => {
    const bw = (band * 0.7) / series.length;
    if (cats[gi]) out.push(<text key={`bc${gi}`} x={plot.x + band * (gi + 0.5)} y={plot.y + plot.h + font * 1.3} textAnchor="middle" fontSize={font * 0.9} fill="#595959">{cats[gi]}</text>);
    group.forEach((st, si) => {
      if (!st) return;
      const color = series[si].color ?? PALETTE[si % PALETTE.length];
      const x = plot.x + band * gi + band * 0.15 + si * bw;
      const cx = x + bw / 2;
      const k = `bx${gi}-${si}`;
      out.push(<line key={`${k}w`} x1={cx} x2={cx} y1={Y(st.hi)} y2={Y(st.lo)} stroke="#595959" strokeWidth={scale} />);
      out.push(<line key={`${k}wh`} x1={cx - bw * 0.25} x2={cx + bw * 0.25} y1={Y(st.hi)} y2={Y(st.hi)} stroke="#595959" strokeWidth={scale} />);
      out.push(<line key={`${k}wl`} x1={cx - bw * 0.25} x2={cx + bw * 0.25} y1={Y(st.lo)} y2={Y(st.lo)} stroke="#595959" strokeWidth={scale} />);
      out.push(<rect key={`${k}b`} x={x + bw * 0.1} y={Y(st.q3)} width={bw * 0.8} height={Math.max(1, Y(st.q1) - Y(st.q3))} fill={color} stroke="#404040" strokeWidth={0.6 * scale} />);
      out.push(<line key={`${k}m`} x1={x + bw * 0.1} x2={x + bw * 0.9} y1={Y(st.median)} y2={Y(st.median)} stroke="#fff" strokeWidth={1.5 * scale} />);
      const my = Y(st.mean);
      const r = 3 * scale;
      out.push(<path key={`${k}x`} d={`M${cx - r},${my - r}L${cx + r},${my + r}M${cx - r},${my + r}L${cx + r},${my - r}`} stroke="#fff" strokeWidth={1.4 * scale} />);
      st.outliers.forEach((o, oi) => out.push(<circle key={`${k}o${oi}`} cx={cx} cy={Y(o)} r={2.5 * scale} fill="none" stroke={color} strokeWidth={scale} />));
    });
  });
}
