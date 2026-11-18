// Tables and charts on slides: insert pickers and the chart data editor.

import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, makeStyles, tokens } from "@fluentui/react-components";
import { Add16Regular, Delete16Regular } from "@fluentui/react-icons";
import type { Chart, ChartKind } from "../chart/ChartView";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  picker: { padding: "8px", display: "flex", flexDirection: "column", gap: "6px" },
  grid: { display: "grid", gap: "2px" },
  cell: { width: "16px", height: "16px", border: `1px solid ${tokens.colorNeutralStroke1}`, boxSizing: "border-box", cursor: "pointer" },
  on: { backgroundColor: "#f4c7b8", border: "1px solid #c43e1c" },
  label: { fontSize: "12px", color: tokens.colorNeutralForeground2 },
  data: { borderCollapse: "collapse", fontSize: "13px" },
  input: {
    width: "96px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: "4px 6px",
    font: "inherit",
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxSizing: "border-box",
  },
  head: { fontWeight: 600 },
  tools: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" },
});

/** Grid to pick the size of a new table (like PowerPoint's insert table menu). */
export function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const s = useStyles();
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const R = 8;
  const C = 10;
  return (
    <div className={s.picker} onMouseLeave={() => setHover({ r: 0, c: 0 })}>
      <span className={s.label}>{hover.r ? `Tabelle ${hover.c}×${hover.r}` : tl("Tabelle einfügen")}</span>
      <div className={s.grid} style={{ gridTemplateColumns: `repeat(${C}, 16px)` }}>
        {Array.from({ length: R * C }, (_, i) => {
          const r = Math.floor(i / C) + 1;
          const c = (i % C) + 1;
          return <div key={i} className={`${s.cell} ${r <= hover.r && c <= hover.c ? s.on : ""}`} onMouseEnter={() => setHover({ r, c })} onClick={() => onPick(r, c)} />;
        })}
      </div>
    </div>
  );
}

/** Sample data for a new chart. */
export function sampleChart(kind: ChartKind): Chart {
  const cats = [tl("Kategorie 1"), tl("Kategorie 2"), tl("Kategorie 3"), tl("Kategorie 4")];
  const data = [
    [4.3, 2.5, 3.5, 4.5],
    [2.4, 4.4, 1.8, 2.8],
    [2, 2, 3, 5],
  ];
  const pie = kind === "pie" || kind === "doughnut";
  const series = (pie ? data.slice(0, 1) : data).map((values, i) => ({ name: pie ? tl("Umsatz") : tl("Reihe {0}", i + 1), categories: kind === "scatter" ? ["1", "2", "3", "4"] : cats, values }));
  return { kind, series, legend: pie ? "r" : "b", title: pie ? tl("Umsatz") : tl("Diagrammtitel") };
}

const num = (s: string) => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

/** Spreadsheet-like editor for the data of a chart on a slide. */
export function ChartDataDialog({ chart, onClose, onApply }: { chart: Chart | null; onClose: () => void; onApply: (c: Chart) => void }) {
  const s = useStyles();
  const [names, setNames] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [vals, setVals] = useState<string[][]>([]);
  useEffect(() => {
    if (!chart) return;
    const n = Math.max(1, ...chart.series.map((x) => Math.max(x.values.length, x.categories.length)));
    const c = chart.series.find((x) => x.categories.length)?.categories ?? [];
    setNames(chart.series.map((x, i) => x.name ?? tl("Reihe {0}", i + 1)));
    setCats(Array.from({ length: n }, (_, i) => c[i] ?? ""));
    setVals(chart.series.map((x) => Array.from({ length: n }, (_, i) => fmt(x.values[i]))));
  }, [chart]);
  if (!chart) return null;
  const pie = chart.kind === "pie" || chart.kind === "doughnut";
  const apply = () => {
    onApply({ ...chart, series: names.map((name, j) => ({ ...(chart.series[j] ?? {}), name, nameRef: undefined, catRef: undefined, valRef: undefined, categories: cats, values: (vals[j] ?? []).map(num) })) });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 760 }}>
        <DialogBody>
          <DialogTitle>{tl("Diagrammdaten bearbeiten")}</DialogTitle>
          <DialogContent>
            <div style={{ overflow: "auto", maxHeight: 420 }}>
              <table className={s.data}>
                <thead>
                  <tr>
                    <th />
                    {names.map((n, j) => (
                      <th key={j}>
                        <input className={`${s.input} ${s.head}`} value={n} onChange={(e) => setNames(names.map((x, k) => (k === j ? e.target.value : x)))} aria-label={tl("Name der Reihe {0}", j + 1)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c, i) => (
                    <tr key={i}>
                      <td>
                        <input className={`${s.input} ${s.head}`} value={c} onChange={(e) => setCats(cats.map((x, k) => (k === i ? e.target.value : x)))} aria-label={tl("Kategorie {0}", i + 1)} />
                      </td>
                      {names.map((_, j) => (
                        <td key={j}>
                          <input
                            className={s.input}
                            style={{ textAlign: "right" }}
                            value={vals[j]?.[i] ?? ""}
                            onChange={(e) => setVals(vals.map((row, k) => (k === j ? row.map((x, m) => (m === i ? e.target.value : x)) : row)))}
                            aria-label={tl("Wert {0} von {1}", i + 1, names[j])}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={s.tools}>
              <Button size="small" icon={<Add16Regular />} onClick={() => (setCats([...cats, tl("Kategorie {0}", cats.length + 1)]), setVals(vals.map((r) => [...r, ""])))}>
                {tl("Kategorie")}
              </Button>
              <Button size="small" icon={<Delete16Regular />} disabled={cats.length <= 1} onClick={() => (setCats(cats.slice(0, -1)), setVals(vals.map((r) => r.slice(0, -1))))}>
                {tl("Letzte Kategorie")}
              </Button>
              {!pie && (
                <>
                  <Button size="small" icon={<Add16Regular />} onClick={() => (setNames([...names, tl("Reihe {0}", names.length + 1)]), setVals([...vals, cats.map(() => "")]))}>
                    {tl("Reihe")}
                  </Button>
                  <Button size="small" icon={<Delete16Regular />} disabled={names.length <= 1} onClick={() => (setNames(names.slice(0, -1)), setVals(vals.slice(0, -1)))}>
                    {tl("Letzte Reihe")}
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={apply}>
              {tl("OK")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
