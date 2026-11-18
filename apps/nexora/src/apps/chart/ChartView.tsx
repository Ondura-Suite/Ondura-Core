// SVG rendering of the chart model shared by Tabellen and Präsentation
// (mirrors crates/office/src/chart.rs).

export type ChartKind = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";

export interface ChartSeries {
  name?: string;
  nameRef?: string;
  catRef?: string;
  valRef?: string;
  categories: string[];
  values: (number | null)[];
  color?: string;
}

export interface Chart {
  kind: ChartKind;
  title?: string;
  series: ChartSeries[];
  /** Legend position (r, b, t, l); undefined hides it. */
  legend?: string;
  stacked?: boolean;
  labels?: boolean;
}

export const PALETTE = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"];

export const CHART_KINDS: { kind: ChartKind; label: string }[] = [
  { kind: "column", label: "Säule" },
  { kind: "bar", label: "Balken" },
  { kind: "line", label: "Linie" },
  { kind: "area", label: "Fläche" },
  { kind: "pie", label: "Kreis" },
  { kind: "doughnut", label: "Ring" },
  { kind: "scatter", label: "Punkt (XY)" },
];

const fmt = (v: number) => (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1).replace(".", ",") : v.toLocaleString("de-DE", { maximumFractionDigits: 2 }));

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
  const entries = pie ? (series[0]?.values ?? []).map((_, i) => ({ label: cats[i] ?? `${i + 1}`, color: PALETTE[i % PALETTE.length] })) : series.map((s, i) => ({ label: s.name ?? `Reihe ${i + 1}`, color: seriesColor(chart, chart.series.indexOf(s)) }));
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
        Keine Daten
      </text>,
    );
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
