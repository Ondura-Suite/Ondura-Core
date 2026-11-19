import { tl, LOCALE } from "../../lib/i18n";
import { renderBoxWhisker, renderSunburst, renderTreemap } from "./hierarchy";
// SVG rendering of the chart model shared by Tabellen and Präsentation
// (mirrors crates/office/src/chart.rs).

export type ChartKind = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "combo" | "waterfall" | "histogram" | "funnel" | "treemap" | "sunburst" | "boxWhisker";

export interface ChartSeries {
  name?: string;
  nameRef?: string;
  catRef?: string;
  valRef?: string;
  categories: string[];
  values: (number | null)[];
  color?: string;
  /** Type of the series in a combination chart. */
  kind?: "column" | "line" | "area";
  /** On the secondary value axis (right). */
  secondary?: boolean;
  /** Treemap and sunburst: category path of every point (outermost first). */
  levels?: string[][];
}

export interface Chart {
  kind: ChartKind;
  title?: string;
  series: ChartSeries[];
  /** Legend position (r, b, t, l); undefined hides it. */
  legend?: string;
  stacked?: boolean;
  labels?: boolean;
  /** Waterfall: indexes of the points that are totals. */
  subtotals?: number[];
  /** Histogram bins (automatic without both). */
  binCount?: number;
  binWidth?: number;
}

/** Bins of a histogram: labels and counts (Excel's automatic bin width: Scott's rule). */
export function histogramBins(values: number[], binCount?: number, binWidth?: number) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { labels: [] as string[], counts: [] as number[] };
  const min = v[0];
  const max = v[v.length - 1];
  let width = binWidth && binWidth > 0 ? binWidth : 0;
  if (!width && binCount && binCount > 0) width = (max - min) / binCount || 1;
  if (!width) {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
    width = (3.5 * sd) / Math.cbrt(v.length) || 1;
  }
  const n = Math.max(1, Math.min(1000, binCount && !binWidth ? binCount : Math.ceil((max - min) / width) || 1));
  const counts = new Array(n).fill(0);
  for (const x of v) counts[Math.min(n - 1, Math.max(0, Math.ceil((x - min) / width) - 1))]++;
  const r = (x: number) => fmt(Math.round(x * 1000) / 1000);
  const labels = counts.map((_, i) => `${i === 0 ? "[" : "("}${r(min + i * width)}; ${r(min + (i + 1) * width)}]`);
  return { labels, counts };
}

/** Floating bars of a waterfall chart. */
export function waterfallBars(values: (number | null)[], subtotals: number[] = []) {
  let run = 0;
  return values.map((v, i) => {
    const x = v ?? 0;
    if (subtotals.includes(i)) {
      run = x;
      return { from: 0, to: x, kind: "total" as const, value: x };
    }
    const from = run;
    run += x;
    return { from, to: run, kind: x >= 0 ? ("up" as const) : ("down" as const), value: x };
  });
}

const WATERFALL = { up: "#4472c4", down: "#ed7d31", total: "#a5a5a5" };

export const PALETTE = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"];

export const CHART_KINDS: { kind: ChartKind; label: string }[] = [
  { kind: "column", label: tl("Säule") },
  { kind: "bar", label: tl("Balken") },
  { kind: "line", label: tl("Linie") },
  { kind: "area", label: tl("Fläche") },
  { kind: "pie", label: tl("Kreis") },
  { kind: "doughnut", label: tl("Ring") },
  { kind: "scatter", label: tl("Punkt (XY)") },
  { kind: "combo", label: tl("Kombi") },
  { kind: "waterfall", label: tl("Wasserfall") },
  { kind: "histogram", label: tl("Histogramm") },
  { kind: "funnel", label: tl("Trichter") },
  { kind: "treemap", label: tl("Treemap") },
  { kind: "sunburst", label: tl("Sunburst") },
  { kind: "boxWhisker", label: tl("Kastengrafik") },
];

const fmt = (v: number) => (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1).replace(".", ",") : v.toLocaleString(LOCALE, { maximumFractionDigits: 2 }));

/** Rounded axis bounds and tick step. */
export function niceScale(min: number, max: number, ticks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, step: 0.2 };
  if (min === max) {
    if (min === 0) return { lo: 0, hi: 1, step: 0.2 };
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = max - min;
  const raw = span / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { lo, hi: hi === lo ? lo + step : hi, step };
}

const seriesColor = (c: Chart, i: number) => c.series[i]?.color ?? PALETTE[i % PALETTE.length];

export function ChartView({ chart, width, height, scale = 1 }: { chart: Chart; width: number; height: number; scale?: number }) {
  const font = 11 * scale;
  const pad = 10 * scale;
  const pie = chart.kind === "pie" || chart.kind === "doughnut";
  const series = chart.series.filter((s) => s.values.length);
  const cats = series.reduce<string[]>((a, s) => (s.categories.length > a.length ? s.categories : a), []);
  const nCat = Math.max(cats.length, ...series.map((s) => s.values.length), 0);

  let top = pad;
  const elements: React.ReactNode[] = [];
  if (chart.title) {
    elements.push(
      <text key="title" x={width / 2} y={top + 14 * scale} textAnchor="middle" fontSize={14 * scale} fill="#404040">
        {chart.title}
      </text>,
    );
    top += 24 * scale;
  }

  // Legend entries.
  const entries =
    chart.kind === "waterfall"
      ? [
          { label: tl("Zunahme"), color: WATERFALL.up },
          { label: tl("Abnahme"), color: WATERFALL.down },
          { label: tl("Summe"), color: WATERFALL.total },
        ]
      : chart.kind === "treemap" || chart.kind === "sunburst"
        ? [...new Set((series[0]?.levels ?? []).map((p) => p[0]).filter(Boolean))].map((label, i) => ({ label, color: PALETTE[i % PALETTE.length] }))
      : pie
        ? (series[0]?.values ?? []).map((_, i) => ({ label: cats[i] ?? `${i + 1}`, color: PALETTE[i % PALETTE.length] }))
        : (chart.kind === "histogram" || chart.kind === "funnel" ? series.slice(0, 1) : series).map((s, i) => ({ label: s.name ?? tl("Reihe {0}", i + 1), color: seriesColor(chart, chart.series.indexOf(s)) }));
  let left = pad;
  let right = width - pad;
  let bottom = height - pad;
  const legend = chart.legend;
  if (legend && entries.length) {
    const sw = 9 * scale;
    if (legend === "r" || legend === "l") {
      const lw = Math.min(width * 0.35, Math.max(...entries.map((e) => e.label.length)) * font * 0.6 + sw + 12 * scale);
      const x0 = legend === "r" ? right - lw : left;
      const y0 = (top + bottom) / 2 - (entries.length * font * 1.5) / 2;
      entries.forEach((e, i) => {
        const y = y0 + i * font * 1.5;
        elements.push(<rect key={`lg${i}`} x={x0} y={y} width={sw} height={sw} fill={e.color} />, <text key={`lt${i}`} x={x0 + sw + 4 * scale} y={y + sw - 1} fontSize={font} fill="#595959">{e.label}</text>);
      });
      if (legend === "r") right -= lw + 6 * scale;
      else left += lw + 6 * scale;
    } else {
      const widths = entries.map((e) => e.label.length * font * 0.6 + sw + 16 * scale);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = Math.max(left, width / 2 - total / 2);
      const y = legend === "t" ? top : bottom - font;
      entries.forEach((e, i) => {
        elements.push(<rect key={`lg${i}`} x={x} y={y + 1} width={sw} height={sw} fill={e.color} />, <text key={`lt${i}`} x={x + sw + 4 * scale} y={y + sw} fontSize={font} fill="#595959">{e.label}</text>);
        x += widths[i];
      });
      if (legend === "t") top += font * 1.8;
      else bottom -= font * 1.8;
    }
  }

  if (!series.length) {
    elements.push(
      <text key="empty" x={width / 2} y={height / 2} textAnchor="middle" fontSize={font} fill="#8a8a8a">
        {tl("Keine Daten")}
      </text>,
    );
  } else if (chart.kind === "treemap") {
    renderTreemap(chart, { x: left, y: top, w: right - left, h: bottom - top }, scale, font, elements);
  } else if (chart.kind === "sunburst") {
    renderSunburst(chart, { x: left, y: top, w: right - left, h: bottom - top }, scale, font, elements);
  } else if (chart.kind === "boxWhisker") {
    renderBoxWhisker(chart, { x: left, y: top, w: right - left, h: bottom - top }, scale, font, elements, (a, b) => niceScale(a, b));
  } else if (chart.kind === "funnel") {
    const s = series[0];
    const vals = s.values.map((v) => Math.max(0, v ?? 0));
    const max = Math.max(...vals, 1);
    const n = vals.length;
    const labelW = Math.min((right - left) * 0.3, Math.max(...cats.map((c) => c.length), 1) * font * 0.6 + 8 * scale);
    const x0 = left + labelW;
    const w = right - x0;
    const band = (bottom - top) / Math.max(1, n);
    vals.forEach((v, i) => {
      const bw = (v / max) * w;
      const y = top + i * band + band * 0.06;
      const h = band * 0.88;
      elements.push(<rect key={`f${i}`} x={x0 + (w - bw) / 2} y={y} width={bw} height={h} fill={seriesColor(chart, 0)} />);
      elements.push(<text key={`fc${i}`} x={x0 - 4 * scale} y={y + h / 2 + font / 3} textAnchor="end" fontSize={font * 0.9} fill="#595959">{cats[i] ?? i + 1}</text>);
      elements.push(<text key={`fv${i}`} x={x0 + w / 2} y={y + h / 2 + font / 3} textAnchor="middle" fontSize={font * 0.9} fill={bw > 30 * scale ? "#fff" : "#404040"}>{fmt(v)}</text>);
    });
  } else if (chart.kind === "combo" || chart.kind === "waterfall" || chart.kind === "histogram") {
    renderMixed(chart, series, cats, nCat, { left, right, top, bottom }, scale, font, elements);
  } else if (pie) {
    const vals = series[0].values.map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const r = Math.max(4, Math.min(right - left, bottom - top) / 2 - 4 * scale);
    const hole = chart.kind === "doughnut" ? r * 0.5 : 0;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      let d: string;
      if (v / total > 0.9999) d = `M${cx - r},${cy}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0` + (hole ? `M${cx - hole},${cy}a${hole},${hole} 0 1,1 ${hole * 2},0a${hole},${hole} 0 1,1 ${-hole * 2},0` : "");
      else if (hole) d = `M${p(r, a0)}A${r},${r} 0 ${large},1 ${p(r, a1)}L${p(hole, a1)}A${hole},${hole} 0 ${large},0 ${p(hole, a0)}Z`;
      else d = `M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${large},1 ${p(r, a1)}Z`;
      elements.push(<path key={`s${i}`} d={d} fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth={1.5 * scale} fillRule="evenodd" />);
      if (chart.labels && v > 0) {
        const mid = (a0 + a1) / 2;
        const lr = hole ? (r + hole) / 2 : r * 0.65;
        elements.push(
          <text key={`l${i}`} x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid) + font / 3} textAnchor="middle" fontSize={font} fill="#fff">
            {fmt(v)}
          </text>,
        );
      }
      a0 = a1;
    });
  } else {
    const horizontal = chart.kind === "bar";
    const scatter = chart.kind === "scatter";
    const stacked = !!chart.stacked && !scatter;
    // Value range.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < nCat; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        if (stacked) {
          if (v >= 0) pos += v;
          else neg += v;
        } else {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      if (stacked) {
        lo = Math.min(lo, neg);
        hi = Math.max(hi, pos);
      }
    }
    if (chart.kind !== "line" && !scatter) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    const ys = niceScale(lo, hi);
    let xs = { lo: 0, hi: 1, step: 1 };
    const xVals = scatter ? series.map((s) => s.values.map((_, i) => Number(String(s.categories[i] ?? i + 1).replace(",", ".")))) : [];
    if (scatter) {
      const all = xVals.flat().filter(Number.isFinite);
      xs = niceScale(Math.min(...all), Math.max(...all));
    }
    // Axis label space.
    const ticks: number[] = [];
    for (let v = ys.lo; v <= ys.hi + ys.step / 2; v += ys.step) ticks.push(Math.round(v * 1e9) / 1e9);
    const tickW = Math.max(...ticks.map((t) => fmt(t).length)) * font * 0.6 + 6 * scale;
    const catH = font * 1.6;
    const catW = horizontal ? Math.min((right - left) * 0.3, Math.max(...cats.map((c) => c.length), 1) * font * 0.6 + 6 * scale) : 0;
    const plot = horizontal ? { x: left + catW, y: top, w: right - left - catW, h: bottom - top - catH } : { x: left + tickW, y: top + font / 2, w: right - left - tickW, h: bottom - top - catH - font / 2 };
    if (plot.w < 10 || plot.h < 10) return <svg width={width} height={height} />;
    const valPos = (v: number) => (horizontal ? plot.x + ((v - ys.lo) / (ys.hi - ys.lo)) * plot.w : plot.y + plot.h - ((v - ys.lo) / (ys.hi - ys.lo)) * plot.h);
    // Gridlines and value labels.
    ticks.forEach((t, i) => {
      const p = valPos(t);
      if (horizontal) {
        elements.push(<line key={`g${i}`} x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} stroke="#e6e6e6" />);
        elements.push(<text key={`gt${i}`} x={p} y={plot.y + plot.h + font * 1.2} textAnchor="middle" fontSize={font * 0.9} fill="#595959">{fmt(t)}</text>);
      } else {
        elements.push(<line key={`g${i}`} x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} stroke="#e6e6e6" />);
        elements.push(<text key={`gt${i}`} x={plot.x - 4 * scale} y={p + font / 3} textAnchor="end" fontSize={font * 0.9} fill="#595959">{fmt(t)}</text>);
      }
    });
    const zero = valPos(Math.max(ys.lo, Math.min(0, ys.hi)));
    const band = (horizontal ? plot.h : plot.w) / Math.max(1, nCat);
    const catPos = (i: number) => (horizontal ? plot.y + band * (i + 0.5) : plot.x + band * (i + 0.5));
    // Category labels (thinned out if crowded).
    if (!scatter) {
      const every = Math.max(1, Math.ceil((Math.max(...cats.map((c) => c.length), 1) * font * 0.6) / (horizontal ? font * 1.5 : band)));
      for (let i = 0; i < nCat; i += horizontal ? Math.max(1, Math.ceil(font * 1.3 / band)) : every) {
        const label = cats[i] ?? String(i + 1);
        if (horizontal)
          elements.push(<text key={`c${i}`} x={plot.x - 4 * scale} y={catPos(i) + font / 3} textAnchor="end" fontSize={font * 0.9} fill="#595959">{label}</text>);
        else elements.push(<text key={`c${i}`} x={catPos(i)} y={plot.y + plot.h + font * 1.2} textAnchor="middle" fontSize={font * 0.9} fill="#595959">{label}</text>);
      }
    } else {
      for (let v = xs.lo, i = 0; v <= xs.hi + xs.step / 2; v += xs.step, i++) {
        const x = plot.x + ((v - xs.lo) / (xs.hi - xs.lo)) * plot.w;
        elements.push(<text key={`x${i}`} x={x} y={plot.y + plot.h + font * 1.2} textAnchor="middle" fontSize={font * 0.9} fill="#595959">{fmt(Math.round(v * 1e9) / 1e9)}</text>);
      }
    }
    // Axis line.
    elements.push(horizontal ? <line key="axis" x1={zero} x2={zero} y1={plot.y} y2={plot.y + plot.h} stroke="#bfbfbf" /> : <line key="axis" x1={plot.x} x2={plot.x + plot.w} y1={zero} y2={zero} stroke="#bfbfbf" />);

    const label = (k: string, x: number, y: number, v: number, anchor: "middle" | "start" = "middle") =>
      chart.labels && elements.push(<text key={k} x={x} y={y} textAnchor={anchor} fontSize={font * 0.9} fill="#404040">{fmt(v)}</text>);

    if (chart.kind === "column" || chart.kind === "bar") {
      const groups = stacked ? 1 : series.length;
      const barW = (band * 0.66) / groups;
      const base = { pos: new Array(nCat).fill(0), neg: new Array(nCat).fill(0) };
      series.forEach((s, si) => {
        const color = seriesColor(chart, chart.series.indexOf(s));
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const start = stacked ? (v >= 0 ? base.pos[i] : base.neg[i]) : 0;
          const end = start + v;
          if (stacked) {
            if (v >= 0) base.pos[i] = end;
            else base.neg[i] = end;
          }
          const p0 = valPos(start);
          const p1 = valPos(end);
          const off = catPos(i) - (barW * groups) / 2 + (stacked ? 0 : si * barW);
          if (horizontal) {
            elements.push(<rect key={`b${si}-${i}`} x={Math.min(p0, p1)} y={off} width={Math.abs(p1 - p0)} height={barW * 0.95} fill={color} />);
            label(`bl${si}-${i}`, Math.max(p0, p1) + 3 * scale, off + barW / 2 + font / 3, v, "start");
          } else {
            elements.push(<rect key={`b${si}-${i}`} x={off} y={Math.min(p0, p1)} width={barW * 0.95} height={Math.abs(p1 - p0)} fill={color} />);
            label(`bl${si}-${i}`, off + barW / 2, Math.min(p0, p1) - 3 * scale, v);
          }
        });
      });
    } else if (chart.kind === "line" || chart.kind === "area") {
      const acc = new Array(nCat).fill(0);
      const layers = series.map((s) =>
        s.values.map((v, i) => {
          if (v === null || v === undefined) return null;
          const b = stacked ? acc[i] : 0;
          const t = b + v;
          if (stacked) acc[i] = t;
          return { b, t };
        }),
      );
      series.forEach((s, si) => {
        const color = seriesColor(chart, chart.series.indexOf(s));
        const pts = layers[si];
        if (chart.kind === "area") {
          const valid = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
          if (!valid.length) return;
          const upper = valid.map((i) => `${catPos(i)},${valPos(pts[i]!.t)}`);
          const lower = [...valid].reverse().map((i) => `${catPos(i)},${valPos(pts[i]!.b)}`);
          elements.push(<polygon key={`a${si}`} points={[...upper, ...lower].join(" ")} fill={color} fillOpacity={stacked ? 0.9 : 0.6} stroke={color} />);
        } else {
          let d = "";
          let pen = false;
          pts.forEach((p, i) => {
            if (!p) {
              pen = false;
              return;
            }
            d += `${pen ? "L" : "M"}${catPos(i)},${valPos(p.t)}`;
            pen = true;
          });
          elements.push(<path key={`l${si}`} d={d} fill="none" stroke={color} strokeWidth={2.25 * scale} strokeLinejoin="round" strokeLinecap="round" />);
          pts.forEach((p, i) => p && nCat <= 40 && elements.push(<circle key={`m${si}-${i}`} cx={catPos(i)} cy={valPos(p.t)} r={2.5 * scale} fill={color} />));
        }
        pts.forEach((p, i) => p && label(`ll${si}-${i}`, catPos(i), valPos(p.t) - 5 * scale, s.values[i]!));
      });
    } else if (scatter) {
      series.forEach((s, si) => {
        const color = seriesColor(chart, chart.series.indexOf(s));
        s.values.forEach((v, i) => {
          const xv = xVals[si][i];
          if (v === null || v === undefined || !Number.isFinite(xv)) return;
          const x = plot.x + ((xv - xs.lo) / (xs.hi - xs.lo)) * plot.w;
          elements.push(<circle key={`p${si}-${i}`} cx={x} cy={valPos(v)} r={3.5 * scale} fill={color} />);
          label(`pl${si}-${i}`, x, valPos(v) - 6 * scale, v);
        });
      });
    }
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", fontFamily: "Calibri, Carlito, 'Segoe UI', sans-serif" }}>
      <rect x={0} y={0} width={width} height={height} fill="#fff" />
      {elements}
    </svg>
  );
}

/**
 * Combination charts (columns, lines and areas, optional secondary axis),
 * waterfall and histogram charts.
 */
function renderMixed(chart: Chart, series0: ChartSeries[], cats0: string[], nCat0: number, box: { left: number; right: number; top: number; bottom: number }, scale: number, font: number, out: React.ReactNode[]) {
  type Bar = { i: number; from: number; to: number; color: string; value: number };
  let cats = cats0;
  let nCat = nCat0;
  const bars: { series: number; secondary: boolean; items: Bar[] }[] = [];
  const lines: { series: number; secondary: boolean; area: boolean; pts: (number | null)[]; color: string }[] = [];
  let gap = 0.34;
  if (chart.kind === "waterfall") {
    const wf = waterfallBars(series0[0]?.values ?? [], chart.subtotals);
    bars.push({ series: 0, secondary: false, items: wf.map((b, i) => ({ i, from: b.from, to: b.to, color: WATERFALL[b.kind], value: b.value })) });
  } else if (chart.kind === "histogram") {
    const h = histogramBins((series0[0]?.values ?? []).filter((v): v is number => v !== null), chart.binCount, chart.binWidth);
    cats = h.labels;
    nCat = h.labels.length;
    gap = 0.02;
    bars.push({ series: 0, secondary: false, items: h.counts.map((c, i) => ({ i, from: 0, to: c, color: seriesColor(chart, 0), value: c })) });
  } else {
    series0.forEach((s, si0) => {
      const si = chart.series.indexOf(s);
      const kind = s.kind ?? (si0 === 0 ? "column" : "line");
      const color = seriesColor(chart, si);
      if (kind === "column") bars.push({ series: si, secondary: !!s.secondary, items: s.values.flatMap((v, i) => (v === null || v === undefined ? [] : [{ i, from: 0, to: v, color, value: v }])) });
      else lines.push({ series: si, secondary: !!s.secondary, area: kind === "area", pts: s.values, color });
    });
  }
  const range = (secondary: boolean) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of bars.filter((b) => b.secondary === secondary)) for (const b of g.items) (lo = Math.min(lo, b.from, b.to)), (hi = Math.max(hi, b.from, b.to));
    for (const l of lines.filter((x) => x.secondary === secondary)) for (const v of l.pts) if (v !== null && v !== undefined) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    if (!Number.isFinite(lo)) return null;
    if (bars.some((b) => b.secondary === secondary) || lines.some((l) => l.secondary === secondary && l.area)) (lo = Math.min(lo, 0)), (hi = Math.max(hi, 0));
    return niceScale(lo, hi);
  };
  const ys = range(false) ?? range(true) ?? { lo: 0, hi: 1, step: 0.2 };
  const ys2 = lines.some((l) => l.secondary) || bars.some((b) => b.secondary) ? range(true) : null;
  const ticksOf = (sc: { lo: number; hi: number; step: number }) => {
    const t: number[] = [];
    for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) t.push(Math.round(v * 1e9) / 1e9);
    return t;
  };
  const ticks = ticksOf(ys);
  const ticks2 = ys2 ? ticksOf(ys2) : [];
  const tickW = Math.max(...ticks.map((t) => fmt(t).length)) * font * 0.6 + 6 * scale;
  const tickW2 = ys2 ? Math.max(...ticks2.map((t) => fmt(t).length)) * font * 0.6 + 6 * scale : 0;
  const catH = font * 1.6;
  const plot = { x: box.left + tickW, y: box.top + font / 2, w: box.right - box.left - tickW - tickW2, h: box.bottom - box.top - catH - font / 2 };
  if (plot.w < 10 || plot.h < 10) return;
  const pos = (v: number, sc: { lo: number; hi: number }) => plot.y + plot.h - ((v - sc.lo) / (sc.hi - sc.lo || 1)) * plot.h;
  ticks.forEach((t, i) => {
    const p = pos(t, ys);
    out.push(<line key={`mg${i}`} x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} stroke="#e6e6e6" />);
    out.push(<text key={`mt${i}`} x={plot.x - 4 * scale} y={p + font / 3} textAnchor="end" fontSize={font * 0.9} fill="#595959">{fmt(t)}</text>);
  });
  if (ys2)
    ticksOf(ys2).forEach((t, i) => {
      // Secondary ticks at the same heights as the primary gridlines.
      const p = pos(t, ys2);
      out.push(<text key={`mt2${i}`} x={plot.x + plot.w + 4 * scale} y={p + font / 3} textAnchor="start" fontSize={font * 0.9} fill="#595959">{fmt(t)}</text>);
    });
  const band = plot.w / Math.max(1, nCat);
  const cx = (i: number) => plot.x + band * (i + 0.5);
  const every = Math.max(1, Math.ceil((Math.max(...cats.map((c) => c.length), 1) * font * 0.6) / band));
  for (let i = 0; i < nCat; i += every) out.push(<text key={`mc${i}`} x={cx(i)} y={plot.y + plot.h + font * 1.2} textAnchor="middle" fontSize={font * 0.9} fill="#595959">{cats[i] ?? i + 1}</text>);
  const zero = pos(Math.max(ys.lo, Math.min(0, ys.hi)), ys);
  out.push(<line key="maxis" x1={plot.x} x2={plot.x + plot.w} y1={zero} y2={zero} stroke="#bfbfbf" />);
  const groups = Math.max(1, bars.length);
  const barW = (band * (1 - gap)) / groups;
  bars.forEach((g, gi) => {
    const sc = g.secondary && ys2 ? ys2 : ys;
    g.items.forEach((b, k) => {
      const x = cx(b.i) - (barW * groups) / 2 + gi * barW;
      const y0 = pos(b.from, sc);
      const y1 = pos(b.to, sc);
      out.push(<rect key={`mb${gi}-${k}`} x={x} y={Math.min(y0, y1)} width={barW * (chart.kind === "histogram" ? 1 : 0.95)} height={Math.max(0.5, Math.abs(y1 - y0))} fill={b.color} stroke={chart.kind === "histogram" ? "#fff" : undefined} strokeWidth={0.5 * scale} />);
      if (chart.labels || chart.kind === "waterfall")
        out.push(<text key={`ml${gi}-${k}`} x={x + barW / 2} y={Math.min(y0, y1) - 3 * scale} textAnchor="middle" fontSize={font * 0.85} fill="#404040">{fmt(b.value)}</text>);
      // Waterfall connectors from one bar's end to the next bar.
      if (chart.kind === "waterfall" && k + 1 < g.items.length) {
        const y = pos(b.to, sc);
        out.push(<line key={`mw${k}`} x1={x + barW * 0.95} x2={cx(b.i + 1) - barW / 2} y1={y} y2={y} stroke="#a6a6a6" strokeWidth={0.75 * scale} />);
      }
    });
  });
  lines.forEach((l, li) => {
    const sc = l.secondary && ys2 ? ys2 : ys;
    const valid = l.pts.map((v, i) => (v === null || v === undefined ? -1 : i)).filter((i) => i >= 0);
    if (!valid.length) return;
    if (l.area) {
      const upper = valid.map((i) => `${cx(i)},${pos(l.pts[i]!, sc)}`);
      out.push(<polygon key={`ma${li}`} points={[...upper, `${cx(valid[valid.length - 1])},${pos(0, sc)}`, `${cx(valid[0])},${pos(0, sc)}`].join(" ")} fill={l.color} fillOpacity={0.55} stroke={l.color} />);
    } else {
      const d = valid.map((i, k) => `${k ? "L" : "M"}${cx(i)},${pos(l.pts[i]!, sc)}`).join("");
      out.push(<path key={`mp${li}`} d={d} fill="none" stroke={l.color} strokeWidth={2.25 * scale} strokeLinejoin="round" strokeLinecap="round" />);
      valid.forEach((i) => out.push(<circle key={`mm${li}-${i}`} cx={cx(i)} cy={pos(l.pts[i]!, sc)} r={2.5 * scale} fill={l.color} />));
    }
    if (chart.labels) valid.forEach((i) => out.push(<text key={`mlv${li}-${i}`} x={cx(i)} y={pos(l.pts[i]!, sc) - 6 * scale} textAnchor="middle" fontSize={font * 0.85} fill="#404040">{fmt(l.pts[i]!)}</text>));
  });
}
