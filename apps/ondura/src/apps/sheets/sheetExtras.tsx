// Ondura Tabellen: shapes, slicers and timelines, consolidation, the number
// format dialog, find & replace, threaded comments and sheet views.

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Listbox,
  Option,
  Radio,
  RadioGroup,
  SpinButton,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, Checkmark16Regular, Delete16Regular, Dismiss16Regular, FilterDismiss16Regular } from "@fluentui/react-icons";
import type { Book, CommentThread, Rect, SheetObject, SheetView } from "./model";
import { parseRange, rangeName, unkey } from "./model";
import type { Scalar } from "./formula";
import type { CalcResult } from "./model";
import { cellValue, displayText } from "./features";
import { formatValue } from "./format";
import { tl, LOCALE } from "../../lib/i18n";

const useStyles = makeStyles({
  col: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  slicer: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#fff",
    border: "1px solid #c8c8c8",
    boxShadow: "0 1px 3px rgba(0,0,0,.15)",
    color: "#222",
    fontFamily: "Calibri, Carlito, 'Segoe UI', sans-serif",
    overflow: "hidden",
  },
  slicerHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 4px 8px", fontWeight: 600, borderBottom: "1px solid #e1e1e1", cursor: "move" },
  slicerItems: { flex: 1, minHeight: 0, overflowY: "auto", padding: "6px", display: "grid", gap: "4px", alignContent: "start", gridAutoRows: "24px" },
  item: { border: "1px solid #b8c6e3", backgroundColor: "#dde7f8", borderRadius: "2px", padding: "3px 6px", textAlign: "left", cursor: "pointer", fontSize: "12px", color: "#222", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  itemOff: { backgroundColor: "#fff", border: "1px solid #d6d6d6", color: "#777" },
  timeline: { display: "flex", overflowX: "auto", gap: "2px", padding: "6px", alignItems: "flex-end", flex: 1 },
  month: { minWidth: "38px", height: "26px", border: "1px solid #b8c6e3", backgroundColor: "#dde7f8", cursor: "pointer", fontSize: "11px", padding: 0 },
  monthOff: { backgroundColor: "#f4f4f4", border: "1px solid #e1e1e1", color: "#888" },
  pane: {
    width: "300px",
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  paneHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  threads: { overflowY: "auto", flex: 1, padding: "8px", display: "flex", flexDirection: "column", gap: "8px" },
  thread: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: "8px", display: "flex", flexDirection: "column", gap: "6px", cursor: "pointer" },
  threadActive: { border: `1px solid ${tokens.colorBrandStroke1}` },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  preview: { padding: "8px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, minHeight: "20px", fontFamily: "Calibri, Carlito, sans-serif" },
  fmtBody: { display: "grid", gridTemplateColumns: "170px 1fr", gap: "16px", minHeight: "300px" },
});

// ------------------------------------------------------------------ shapes --

const SHAPE_SVG: Record<string, string> = {
  triangle: '<polygon points="50,2 98,98 2,98"/>',
  rightArrow: '<polygon points="2,30 62,30 62,5 98,50 62,95 62,70 2,70"/>',
  star5: '<polygon points="50,3 61,38 98,38 68,60 79,96 50,74 21,96 32,60 2,38 39,38"/>',
  line: '<line x1="0" y1="50" x2="100" y2="50"/>',
};

export function ShapeBody({ shape, z }: { shape: NonNullable<SheetObject["shape"]>; z: number }) {
  const svg = SHAPE_SVG[shape.kind];
  const box: React.CSSProperties = { position: "absolute", inset: 0 };
  return (
    <div style={{ ...box, pointerEvents: "none" }}>
      {svg ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ ...box, overflow: "visible" }} dangerouslySetInnerHTML={{ __html: `<g fill="${shape.fill ?? "none"}" stroke="${shape.line ?? "none"}" stroke-width="1.5" vector-effect="non-scaling-stroke">${svg}</g>` }} />
      ) : (
        <div style={{ ...box, background: shape.fill ?? "transparent", border: shape.line ? `${Math.max(1, z)}px solid ${shape.line}` : "none", borderRadius: shape.kind === "ellipse" ? "50%" : shape.kind === "roundRect" ? "12%" : 0 }} />
      )}
      {shape.text && (
        <div
          style={{
            ...box,
            display: "flex",
            alignItems: shape.kind === "textBox" ? "flex-start" : "center",
            justifyContent: shape.kind === "textBox" ? "flex-start" : "center",
            padding: 6 * z,
            whiteSpace: "pre-wrap",
            textAlign: shape.kind === "textBox" ? "left" : "center",
            color: shape.kind === "textBox" || !shape.fill ? "#000" : "#fff",
            fontSize: 14.67 * z,
            fontFamily: "Calibri, Carlito, sans-serif",
            overflow: "hidden",
          }}
        >
          {shape.text}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------- slicers --

export interface SlicerSource {
  /** Table data rows (absolute) and the column (absolute). */
  r1: number;
  r2: number;
  c: number;
  /** Column offset inside the table. */
  col: number;
  /** Selected texts (empty = all). */
  selected: string[];
}

export function slicerSource(book: Book, si: number, sl: NonNullable<SheetObject["slicer"]>, values?: CalcResult): SlicerSource | null {
  const sh = book.sheets[si];
  if (!sl.table) {
    // The sheet's filter range (AutoFilter).
    const af = sh.autoFilter;
    if (!af || !values) return null;
    let col = -1;
    for (let c = af.range.c1; c <= af.range.c2; c++) if (displayText(book, values, si, af.range.r1, c) === sl.column) col = c - af.range.c1;
    if (col < 0) return null;
    return { r1: af.range.r1 + 1, r2: af.range.r2, c: af.range.c1 + col, col, selected: af.columns.find((f) => f.col === col)?.values ?? [] };
  }
  const t = sh.tables.find((x) => x.name === sl.table);
  if (!t) return null;
  const col = t.columns.findIndex((c) => c.name === sl.column);
  if (col < 0) return null;
  const r1 = t.range.r1 + (t.headerRow ? 1 : 0);
  const r2 = t.range.r2 - (t.totalsRow ? 1 : 0);
  return { r1, r2, c: t.range.c1 + col, col, selected: t.filterColumns?.find((f) => f.col === col)?.values ?? [] };
}

export function SlicerBody({
  book,
  values,
  si,
  slicer,
  onSelect,
}: {
  book: Book;
  values: CalcResult;
  si: number;
  slicer: NonNullable<SheetObject["slicer"]>;
  /** New visible texts (null = no filter). */
  onSelect: (texts: string[] | null) => void;
}) {
  const s = useStyles();
  const src = slicerSource(book, si, slicer, values);
  const [anchor, setAnchor] = useState<number | null>(null);
  if (!src) return <div className={s.slicer}>{slicer.table ? tl("Die Tabelle „{0}“ wurde nicht gefunden.", slicer.table) : tl("Der Filterbereich wurde nicht gefunden.")}</div>;
  const texts: string[] = [];
  const vals = new Map<string, Scalar>();
  for (let r = src.r1; r <= src.r2; r++) {
    const t = displayText(book, values, si, r, src.c);
    if (!vals.has(t)) {
      vals.set(t, cellValue(book, values, si, r, src.c));
      texts.push(t);
    }
  }
  const all = src.selected.length === 0;
  const head = (
    <div className={s.slicerHead}>
      <span>{slicer.caption || slicer.column}</span>
      <Button size="small" appearance="subtle" icon={<FilterDismiss16Regular />} disabled={all} aria-label={tl("Filter löschen")} onMouseDown={(e) => e.stopPropagation()} onClick={() => onSelect(null)} />
    </div>
  );

  if (slicer.timeline) {
    // Months between the first and the last date.
    const serials = [...vals.values()].filter((v): v is number => typeof v === "number");
    if (!serials.length) return <div className={s.slicer}>{head}<div style={{ padding: 8 }}>{tl("Keine Datumswerte")}</div></div>;
    const toMonth = (serial: number) => {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    };
    const lo = Math.min(...serials.map(toMonth));
    const hi = Math.max(...serials.map(toMonth));
    const months = Array.from({ length: Math.min(240, hi - lo + 1) }, (_, i) => lo + i);
    const selectedMonths = new Set<number>();
    if (!all) for (const [t, v] of vals) if (src.selected.includes(t) && typeof v === "number") selectedMonths.add(toMonth(v));
    const pick = (m: number, extend: boolean) => {
      let from = m;
      let to = m;
      if (extend && anchor !== null) [from, to] = [Math.min(anchor, m), Math.max(anchor, m)];
      else setAnchor(m);
      onSelect(texts.filter((t) => {
        const v = vals.get(t);
        return typeof v === "number" && toMonth(v) >= from && toMonth(v) <= to;
      }));
    };
    return (
      <div className={s.slicer}>
        {head}
        <div className={s.timeline} onMouseDown={(e) => e.stopPropagation()}>
          {months.map((m) => {
            const on = all || selectedMonths.has(m);
            const label = new Date(Date.UTC(Math.floor(m / 12), m % 12, 1)).toLocaleDateString(LOCALE, { month: "short", timeZone: "UTC" });
            return (
              <div key={m} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                {(m % 12 === 0 || m === lo) && <span style={{ fontSize: 10, color: "#666" }}>{Math.floor(m / 12)}</span>}
                <button className={mergeClasses(s.month, !on && s.monthOff)} title={`${label} ${Math.floor(m / 12)}`} onClick={(e) => pick(m, e.shiftKey)}>
                  {label}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const sorted = [...texts].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, LOCALE, { numeric: true })));
  const toggle = (t: string, multi: boolean) => {
    if (!multi) return onSelect(src.selected.length === 1 && src.selected[0] === t ? null : [t]);
    const cur = all ? [] : src.selected;
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    onSelect(next.length ? next : null);
  };
  return (
    <div className={s.slicer}>
      {head}
      <div className={s.slicerItems} style={{ gridTemplateColumns: `repeat(${slicer.columns ?? 1}, 1fr)` }} onMouseDown={(e) => e.stopPropagation()}>
        {sorted.map((t) => (
          <button key={t} className={mergeClasses(s.item, !(all || src.selected.includes(t)) && s.itemOff)} onClick={(e) => toggle(t, e.ctrlKey || e.metaKey)} title={t || tl("(Leer)")}>
            {t || tl("(Leer)")}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SlicerDialog({
  open,
  sources: tables,
  timeline,
  onClose,
  onInsert,
}: {
  open: boolean;
  /** Tables (and the filter range, name ""), with their column names. */
  sources: { name: string; label: string; columns: { name: string }[] }[];
  timeline: boolean;
  onClose: () => void;
  onInsert: (table: string, columns: string[]) => void;
}) {
  const s = useStyles();
  const [table, setTable] = useState("");
  const [cols, setCols] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setTable(tables[0]?.name ?? "");
      setCols([]);
    }
  }, [open, tables]);
  const t = tables.find((x) => x.name === table);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{timeline ? tl("Zeitachse einfügen") : tl("Datenschnitt einfügen")}</DialogTitle>
          <DialogContent className={s.col}>
            {!tables.length ? (
              <Text>{tl("Datenschnitte filtern Tabellen und Filterbereiche. Wandeln Sie Ihre Daten zuerst in eine Tabelle um (Einfügen › Tabelle) oder aktivieren Sie den Filter.")}</Text>
            ) : (
              <>
                <Field label={tl("Tabelle")}>
                  <Dropdown value={tables.find((x) => x.name === table)?.label ?? ""} selectedOptions={[table]} onOptionSelect={(_, d) => (setTable(d.optionValue ?? ""), setCols([]))}>
                    {tables.map((x) => (
                      <Option key={x.name} value={x.name}>{x.label}</Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label={timeline ? tl("Datumsspalte") : tl("Spalten")}>
                  <div className={s.col} style={{ gap: 2 }}>
                    {t?.columns.map((c) =>
                      timeline ? (
                        <Radio key={c.name} label={c.name} checked={cols[0] === c.name} onChange={() => setCols([c.name])} />
                      ) : (
                        <Checkbox key={c.name} label={c.name} checked={cols.includes(c.name)} onChange={(_, d) => setCols((x) => (d.checked ? [...x, c.name] : x.filter((y) => y !== c.name)))} />
                      ),
                    )}
                  </div>
                </Field>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!cols.length} onClick={() => (onInsert(table, cols), onClose())}>{tl("OK")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ consolidate --

export type ConsolidateFn = "SUM" | "AVERAGE" | "COUNT" | "MAX" | "MIN" | "PRODUCT";

/** Parses "Blatt!A1:C9" or "A1:C9" (current sheet). */
export function parseSourceRef(book: Book, si: number, ref: string): { sheet: number; rect: Rect } | null {
  const m = ref.trim().match(/^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?(.+)$/);
  if (!m) return null;
  const name = m[1]?.replace(/''/g, "'") ?? m[2];
  const sheet = name ? book.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()) : si;
  const rect = parseRange(m[3].replace(/\$/g, ""));
  return sheet >= 0 && rect ? { sheet, rect } : null;
}

/** Consolidation (Daten › Konsolidieren) by position or by labels. */
export function consolidate(book: Book, values: CalcResult, si: number, refs: string[], fn: ConsolidateFn, topRow: boolean, leftCol: boolean): (string | number | null)[][] | null {
  const sources = refs.map((r) => parseSourceRef(book, si, r));
  if (!sources.length || sources.some((x) => !x)) return null;
  const agg = (xs: number[]): number | null => {
    if (!xs.length) return fn === "COUNT" ? 0 : null;
    switch (fn) {
      case "SUM":
        return xs.reduce((a, b) => a + b, 0);
      case "AVERAGE":
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      case "COUNT":
        return xs.length;
      case "MAX":
        return Math.max(...xs);
      case "MIN":
        return Math.min(...xs);
      case "PRODUCT":
        return xs.reduce((a, b) => a * b, 1);
    }
  };
  const rowKeys: string[] = [];
  const colKeys: string[] = [];
  const cells = new Map<string, number[]>();
  for (const src of sources as { sheet: number; rect: Rect }[]) {
    const { rect, sheet } = src;
    for (let r = rect.r1 + (topRow ? 1 : 0); r <= rect.r2; r++) {
      const rk = leftCol ? displayText(book, values, sheet, r, rect.c1) : String(r - rect.r1 - (topRow ? 1 : 0));
      if (!rowKeys.includes(rk)) rowKeys.push(rk);
      for (let c = rect.c1 + (leftCol ? 1 : 0); c <= rect.c2; c++) {
        const ck = topRow ? displayText(book, values, sheet, rect.r1, c) : String(c - rect.c1 - (leftCol ? 1 : 0));
        if (!colKeys.includes(ck)) colKeys.push(ck);
        const v = cellValue(book, values, sheet, r, c);
        const k = `${rk}\u0000${ck}`;
        if (!cells.has(k)) cells.set(k, []);
        if (typeof v === "number") cells.get(k)!.push(v);
        else if (fn === "COUNT" && v !== null && v !== "") cells.get(k)!.push(0);
      }
    }
  }
  const out: (string | number | null)[][] = [];
  if (topRow) out.push([...(leftCol ? [""] : []), ...colKeys]);
  for (const rk of rowKeys) out.push([...(leftCol ? [rk] : []), ...colKeys.map((ck) => agg(cells.get(`${rk}\u0000${ck}`) ?? []))]);
  return out;
}

const FNS: [ConsolidateFn, string][] = [
  ["SUM", tl("Summe")],
  ["AVERAGE", tl("Mittelwert")],
  ["COUNT", tl("Anzahl")],
  ["MAX", tl("Maximum")],
  ["MIN", tl("Minimum")],
  ["PRODUCT", tl("Produkt")],
];

export function ConsolidateDialog({ open, selection, onClose, onRun }: { open: boolean; selection: string; onClose: () => void; onRun: (refs: string[], fn: ConsolidateFn, top: boolean, left: boolean) => boolean }) {
  const s = useStyles();
  const [fn, setFn] = useState<ConsolidateFn>("SUM");
  const [ref, setRef] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [top, setTop] = useState(true);
  const [left, setLeft] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (open) setRef(selection);
  }, [open, selection]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Konsolidieren")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Funktion")}>
              <Dropdown value={FNS.find((f) => f[0] === fn)?.[1]} selectedOptions={[fn]} onOptionSelect={(_, d) => setFn(d.optionValue as ConsolidateFn)}>
                {FNS.map(([k, l]) => (
                  <Option key={k} value={k}>{l}</Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={tl("Verweis")} hint={tl("z. B. Januar!A1:D20")}>
              <div className={s.row}>
                <Input style={{ flex: 1 }} value={ref} onChange={(_, d) => setRef(d.value)} />
                <Button icon={<Add16Regular />} disabled={!ref.trim()} onClick={() => (setRefs((x) => (x.includes(ref.trim()) ? x : [...x, ref.trim()])), setRef(""))}>
                  {tl("Hinzufügen")}
                </Button>
              </div>
            </Field>
            <Field label={tl("Vorhandene Verweise")}>
              <Listbox multiselect selectedOptions={picked} onOptionSelect={(_, d) => setPicked(d.selectedOptions)} style={{ minHeight: 90, border: `1px solid ${tokens.colorNeutralStroke2}` }}>
                {refs.map((r) => (
                  <Option key={r} value={r}>{r}</Option>
                ))}
              </Listbox>
            </Field>
            <Button icon={<Delete16Regular />} disabled={!picked.length} onClick={() => (setRefs((x) => x.filter((r) => !picked.includes(r))), setPicked([]))}>
              {tl("Löschen")}
            </Button>
            <Text weight="semibold">{tl("Beschriftung aus:")}</Text>
            <Checkbox checked={top} onChange={(_, d) => setTop(!!d.checked)} label={tl("Oberster Zeile")} />
            <Checkbox checked={left} onChange={(_, d) => setLeft(!!d.checked)} label={tl("Linker Spalte")} />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!refs.length && !ref.trim()} onClick={() => onRun(refs.length ? refs : [ref.trim()], fn, top, left) && onClose()}>
              {tl("OK")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------------------------------------------------------- number format --

const CATEGORIES = [
  ["general", tl("Standard")],
  ["number", tl("Zahl")],
  ["currency", tl("Währung")],
  ["accounting", tl("Buchhaltung")],
  ["date", tl("Datum")],
  ["time", tl("Uhrzeit")],
  ["percent", tl("Prozent")],
  ["fraction", tl("Bruch")],
  ["scientific", tl("Wissenschaft")],
  ["text", tl("Text")],
  ["special", tl("Sonderformat")],
  ["custom", tl("Benutzerdefiniert")],
] as const;
type Category = (typeof CATEGORIES)[number][0];

const DATE_CODES = ["dd.mm.yyyy", "d.m.yy", "dd.mm.yy", "d. mmmm yyyy", "dddd, d. mmmm yyyy", "mmmm yyyy", "mmm yy", "yyyy-mm-dd", "dd.mm.yyyy hh:mm"];
const TIME_CODES = ["hh:mm", "hh:mm:ss", "h:mm AM/PM", "[h]:mm:ss", "mm:ss,0"];
const FRACTION_CODES = ["# ?/?", "# ??/??", "# ???/???", "# ?/2", "# ?/4", "# ?/8", "# ??/16", "# ?/10", "# ??/100"];
const SPECIAL_CODES: [string, string][] = [
  ["00000", tl("Postleitzahl")],
  ['"D-"00000', tl("Postleitzahl (Deutschland)")],
  ["0000 000000", tl("Telefonnummer")],
  ["000-00-0000", tl("Sozialversicherungsnummer")],
];
const CURRENCIES = ["€", "$", "£", "CHF", "¥", ""];
const CUSTOM_SAMPLES = ["0", "0.00", "#,##0", "#,##0.00", "#,##0 €;[Rot]-#,##0 €", '0.0" kg"', '#,##0,"T"', "0%", "@", 'TT.MM.JJJJ', "[Blau]#,##0;[Rot]-#,##0;0"];

function categoryOf(code: string | null | undefined): Category {
  if (!code) return "general";
  if (code === "@") return "text";
  if (/^_-\* /.test(code)) return "accounting";
  if (DATE_CODES.includes(code)) return "date";
  if (TIME_CODES.includes(code)) return "time";
  if (FRACTION_CODES.includes(code)) return "fraction";
  if (/E\+0/.test(code)) return "scientific";
  if (/%$/.test(code)) return "percent";
  if (/^#,##0(\.0+)? (€|\$|£|CHF|¥)/.test(code) || /^(\$|£)#,##0/.test(code)) return "currency";
  if (/^(#,##)?0(\.0+)?(;.*)?$/.test(code)) return "number";
  return "custom";
}

export function NumberFormatDialog({ open, code, sample, onClose, onApply }: { open: boolean; code: string | null; sample: Scalar; onClose: () => void; onApply: (code: string | null) => void }) {
  const s = useStyles();
  const [cat, setCat] = useState<Category>("general");
  const [decimals, setDecimals] = useState(2);
  const [thousands, setThousands] = useState(true);
  const [negative, setNegative] = useState<"minus" | "red" | "redMinus">("minus");
  const [currency, setCurrency] = useState("€");
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  useEffect(() => {
    if (!open) return;
    const c = categoryOf(code);
    setCat(c);
    const dec = /\.(0+)/.exec(code ?? "")?.[1].length ?? (c === "percent" ? 0 : 2);
    setDecimals(code ? dec : 2);
    setThousands(!code || code.includes("#,##"));
    setNegative(/\[Rot\]-|\[Red\]-/.test(code ?? "") ? "redMinus" : /\[Rot\]|\[Red\]/.test(code ?? "") ? "red" : "minus");
    setCurrency(/(€|\$|£|CHF|¥)/.exec(code ?? "")?.[1] ?? "€");
    setPick(code ?? "");
    setCustom(code ?? "");
  }, [open, code]);

  const built = useMemo((): string | null => {
    const num = `${thousands || cat === "currency" ? "#,##0" : "0"}${decimals > 0 ? "." + "0".repeat(decimals) : ""}`;
    const neg = (pos: string) => (negative === "minus" ? pos : negative === "red" ? `${pos};[Rot]${pos}` : `${pos};[Rot]-${pos}`);
    switch (cat) {
      case "general":
        return null;
      case "number":
        return neg(num);
      case "currency":
        return neg(currency ? `${num} ${currency}` : num);
      case "accounting": {
        const d = decimals > 0 ? "." + "0".repeat(decimals) : "";
        const c = currency ? ` ${currency}` : "";
        return `_-* #,##0${d}${c}_-;-* #,##0${d}${c}_-;_-* "-"??${c}_-;_-@_-`;
      }
      case "percent":
        return `0${decimals > 0 ? "." + "0".repeat(decimals) : ""}%`;
      case "scientific":
        return `0${decimals > 0 ? "." + "0".repeat(decimals) : ""}E+00`;
      case "text":
        return "@";
      case "date":
      case "time":
      case "fraction":
      case "special":
        return pick || (cat === "date" ? DATE_CODES[0] : cat === "time" ? TIME_CODES[0] : cat === "fraction" ? FRACTION_CODES[0] : SPECIAL_CODES[0][0]);
      case "custom":
        return custom.trim() || null;
    }
  }, [cat, decimals, thousands, negative, currency, pick, custom]);

  const preview = (c: string | null) => {
    try {
      return formatValue(sample ?? (cat === "text" ? "Text" : 1234.5678), c).text;
    } catch {
      return "";
    }
  };
  const list = (codes: string[]) => (
    <Listbox selectedOptions={[pick]} onOptionSelect={(_, d) => setPick(d.optionValue ?? "")} style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}` }}>
      {codes.map((c) => (
        <Option key={c} value={c} text={c}>
          {formatValue(typeof sample === "number" ? sample : 45612.5, c).text}
        </Option>
      ))}
    </Listbox>
  );

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>{tl("Zellen formatieren – Zahlen")}</DialogTitle>
          <DialogContent className={s.fmtBody}>
            <Listbox selectedOptions={[cat]} onOptionSelect={(_, d) => (setCat(d.optionValue as Category), setPick(""))} style={{ border: `1px solid ${tokens.colorNeutralStroke2}` }}>
              {CATEGORIES.map(([id, label]) => (
                <Option key={id} value={id}>{label}</Option>
              ))}
            </Listbox>
            <div className={s.col}>
              <Field label={tl("Beispiel")}>
                <div className={s.preview}>{preview(built)}</div>
              </Field>
              {["number", "currency", "accounting", "percent", "scientific"].includes(cat) && (
                <Field label={tl("Dezimalstellen")}>
                  <SpinButton value={decimals} min={0} max={30} onChange={(_, d) => setDecimals(Math.max(0, Math.min(30, Number(d.value ?? d.displayValue) || 0)))} />
                </Field>
              )}
              {cat === "number" && <Checkbox checked={thousands} onChange={(_, d) => setThousands(!!d.checked)} label={tl("1000er-Trennzeichen verwenden (.)")} />}
              {(cat === "currency" || cat === "accounting") && (
                <Field label={tl("Symbol")}>
                  <Dropdown value={currency || tl("Ohne")} selectedOptions={[currency]} onOptionSelect={(_, d) => setCurrency(d.optionValue ?? "")}>
                    {CURRENCIES.map((c) => (
                      <Option key={c || "none"} value={c}>{c || tl("Ohne")}</Option>
                    ))}
                  </Dropdown>
                </Field>
              )}
              {(cat === "number" || cat === "currency") && (
                <Field label={tl("Negative Zahlen")}>
                  <RadioGroup value={negative} onChange={(_, d) => setNegative(d.value as typeof negative)}>
                    <Radio value="minus" label="-1.234,10" />
                    <Radio value="red" label={<span style={{ color: "#c00000" }}>1.234,10</span>} />
                    <Radio value="redMinus" label={<span style={{ color: "#c00000" }}>-1.234,10</span>} />
                  </RadioGroup>
                </Field>
              )}
              {cat === "date" && list(DATE_CODES)}
              {cat === "time" && list(TIME_CODES)}
              {cat === "fraction" && list(FRACTION_CODES)}
              {cat === "special" && (
                <Listbox selectedOptions={[pick]} onOptionSelect={(_, d) => setPick(d.optionValue ?? "")} style={{ border: `1px solid ${tokens.colorNeutralStroke2}` }}>
                  {SPECIAL_CODES.map(([c, l]) => (
                    <Option key={c} value={c} text={l}>{l}</Option>
                  ))}
                </Listbox>
              )}
              {cat === "custom" && (
                <>
                  <Field label={tl("Typ")}>
                    <Input value={custom} onChange={(_, d) => setCustom(d.value)} style={{ fontFamily: "Consolas, monospace" }} />
                  </Field>
                  <Listbox selectedOptions={[custom]} onOptionSelect={(_, d) => setCustom(d.optionValue ?? "")} style={{ maxHeight: 160, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}` }}>
                    {CUSTOM_SAMPLES.map((c) => (
                      <Option key={c} value={c} text={c}>
                        <span style={{ fontFamily: "Consolas, monospace" }}>{c}</span>
                      </Option>
                    ))}
                  </Listbox>
                </>
              )}
              {cat === "general" && <Text size={200}>{tl("Zellen im Standardformat haben kein bestimmtes Zahlenformat.")}</Text>}
              {cat === "text" && <Text size={200}>{tl("Zellen im Textformat werden genauso angezeigt, wie sie eingegeben werden – auch Zahlen.")}</Text>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(built), onClose())}>{tl("OK")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ find & replace --

export interface FindOptions {
  query: string;
  replace: string;
  matchCase: boolean;
  wholeCell: boolean;
  allSheets: boolean;
  inFormulas: boolean;
}

/** Cells matching the search, in reading order (sheet, row, column). */
export function findCells(book: Book, si: number, o: FindOptions, display: (sheet: number, r: number, c: number) => string, formulaText: (f: string) => string): { sheet: number; r: number; c: number }[] {
  if (!o.query) return [];
  const norm = (t: string) => (o.matchCase ? t : t.toLowerCase());
  const q = norm(o.query);
  const hit = (t: string) => (o.wholeCell ? norm(t) === q : norm(t).includes(q));
  const out: { sheet: number; r: number; c: number }[] = [];
  const sheets = o.allSheets ? book.sheets.map((_, i) => i) : [si];
  for (const s of sheets) {
    for (const [k, cell] of book.sheets[s].cells) {
      const { r, c } = unkey(k);
      const text = o.inFormulas && cell.f ? "=" + formulaText(cell.f) : display(s, r, c);
      if (hit(text)) out.push({ sheet: s, r, c });
    }
  }
  return out.sort((a, b) => a.sheet - b.sheet || a.r - b.r || a.c - b.c);
}

/** Replacement text of a cell's input (formula or value). */
export function replaceIn(text: string, o: FindOptions): string {
  if (o.wholeCell) return o.replace;
  const esc = o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(esc, o.matchCase ? "g" : "gi"), () => o.replace);
}

export function FindReplaceDialog({
  open,
  initialReplace,
  onClose,
  onFind,
  onReplace,
  onReplaceAll,
}: {
  open: boolean;
  initialReplace: boolean;
  onClose: () => void;
  onFind: (o: FindOptions, dir: 1 | -1) => void;
  onReplace: (o: FindOptions) => void;
  onReplaceAll: (o: FindOptions) => void;
}) {
  const s = useStyles();
  const [o, setO] = useState<FindOptions>({ query: "", replace: "", matchCase: false, wholeCell: false, allSheets: false, inFormulas: true });
  const [mode, setMode] = useState<"find" | "replace">("find");
  useEffect(() => {
    if (open) setMode(initialReplace ? "replace" : "find");
  }, [open, initialReplace]);
  return (
    <Dialog open={open} modalType="non-modal" onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Suchen und Ersetzen")}</DialogTitle>
          <DialogContent className={s.col}>
            <RadioGroup layout="horizontal" value={mode} onChange={(_, d) => setMode(d.value as "find" | "replace")}>
              <Radio value="find" label={tl("Suchen")} />
              <Radio value="replace" label={tl("Ersetzen")} />
            </RadioGroup>
            <Field label={tl("Suchen nach")}>
              <Input autoFocus value={o.query} onChange={(_, d) => setO({ ...o, query: d.value })} onKeyDown={(e) => e.key === "Enter" && onFind(o, e.shiftKey ? -1 : 1)} />
            </Field>
            {mode === "replace" && (
              <Field label={tl("Ersetzen durch")}>
                <Input value={o.replace} onChange={(_, d) => setO({ ...o, replace: d.value })} />
              </Field>
            )}
            <div className={s.row}>
              <Checkbox checked={o.matchCase} onChange={(_, d) => setO({ ...o, matchCase: !!d.checked })} label={tl("Groß-/Kleinschreibung beachten")} />
              <Checkbox checked={o.wholeCell} onChange={(_, d) => setO({ ...o, wholeCell: !!d.checked })} label={tl("Gesamten Zellinhalt vergleichen")} />
              <Checkbox checked={o.allSheets} onChange={(_, d) => setO({ ...o, allSheets: !!d.checked })} label={tl("In der ganzen Arbeitsmappe")} />
              <Checkbox checked={o.inFormulas} onChange={(_, d) => setO({ ...o, inFormulas: !!d.checked })} label={tl("In Formeln suchen")} />
            </div>
          </DialogContent>
          <DialogActions>
            {mode === "replace" && (
              <>
                <Button disabled={!o.query} onClick={() => onReplaceAll(o)}>{tl("Alle ersetzen")}</Button>
                <Button disabled={!o.query} onClick={() => onReplace(o)}>{tl("Ersetzen")}</Button>
              </>
            )}
            <Button disabled={!o.query} onClick={() => onFind(o, -1)}>{tl("Vorheriges")}</Button>
            <Button appearance="primary" disabled={!o.query} onClick={() => onFind(o, 1)}>{tl("Weitersuchen")}</Button>
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------------------------------------------------------- threaded comments --

export function CommentsPane({
  threads,
  active,
  author,
  cellName,
  onSelect,
  onChange,
  onClose,
}: {
  threads: CommentThread[];
  active: { r: number; c: number };
  author: string;
  cellName: (r: number, c: number) => string;
  onSelect: (t: CommentThread) => void;
  onChange: (threads: CommentThread[]) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const current = threads.find((t) => t.r === active.r && t.c === active.c);
  const now = () => new Date().toISOString();
  const sorted = [...threads].sort((a, b) => a.r - b.r || a.c - b.c);
  const post = (t: CommentThread | null) => {
    const k = t?.id ?? "new";
    const text = (draft[k] ?? "").trim();
    if (!text) return;
    if (t) onChange(threads.map((x) => (x.id === t.id ? { ...x, comments: [...x.comments, { author, date: now(), text }] } : x)));
    else onChange([...threads, { id: crypto.randomUUID(), r: active.r, c: active.c, comments: [{ author, date: now(), text }] }]);
    setDraft((d) => ({ ...d, [k]: "" }));
  };
  const box = (t: CommentThread | null) => (
    <div className={s.row} onClick={(e) => e.stopPropagation()}>
      <Textarea
        style={{ flex: 1 }}
        resize="vertical"
        placeholder={t ? tl("Antworten…") : tl("Unterhaltung beginnen…")}
        value={draft[t?.id ?? "new"] ?? ""}
        onChange={(_, d) => setDraft((x) => ({ ...x, [t?.id ?? "new"]: d.value }))}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && post(t)}
      />
      <Button appearance="primary" size="small" onClick={() => post(t)}>{tl("Senden")}</Button>
    </div>
  );
  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <Text weight="semibold">{tl("Kommentare")}</Text>
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      <div className={s.threads}>
        {!current && (
          <div className={mergeClasses(s.thread, s.threadActive)}>
            <Text size={200} weight="semibold">{cellName(active.r, active.c)}</Text>
            {box(null)}
          </div>
        )}
        {sorted.map((t) => (
          <div key={t.id} className={mergeClasses(s.thread, t === current && s.threadActive)} style={t.resolved ? { opacity: 0.6 } : undefined} onClick={() => onSelect(t)}>
            <div className={s.row} style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text size={200} weight="semibold">{cellName(t.r, t.c)}</Text>
              <span>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Checkmark16Regular />}
                  title={t.resolved ? tl("Erneut öffnen") : tl("Unterhaltung auflösen")}
                  onClick={(e) => (e.stopPropagation(), onChange(threads.map((x) => (x.id === t.id ? { ...x, resolved: !x.resolved } : x))))}
                />
                <Button size="small" appearance="subtle" icon={<Delete16Regular />} title={tl("Unterhaltung löschen")} onClick={(e) => (e.stopPropagation(), onChange(threads.filter((x) => x.id !== t.id)))} />
              </span>
            </div>
            {t.comments.map((c, i) => (
              <div key={i}>
                <div className={s.meta}>
                  {c.author} · {new Date(c.date).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" })}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>
              </div>
            ))}
            {t === current && !t.resolved && box(t)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- sheet views --

export function SheetViewsDialog({
  open,
  views,
  onClose,
  onSave,
  onActivate,
  onDelete,
}: {
  open: boolean;
  views: SheetView[];
  onClose: () => void;
  onSave: (name: string) => void;
  onActivate: (v: SheetView | null) => void;
  onDelete: (name: string) => void;
}) {
  const s = useStyles();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string>("");
  useEffect(() => {
    if (open) setName(tl("Ansicht{0}", views.length + 1));
  }, [open, views.length]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 440 }}>
        <DialogBody>
          <DialogTitle>{tl("Blattansichten")}</DialogTitle>
          <DialogContent className={s.col}>
            <Text size={200}>{tl("Eine Blattansicht speichert Filter, Sortierung sowie ausgeblendete Zeilen und Spalten, ohne die Daten zu ändern.")}</Text>
            <Listbox selectedOptions={picked ? [picked] : []} onOptionSelect={(_, d) => setPicked(d.optionValue ?? "")} style={{ minHeight: 100, border: `1px solid ${tokens.colorNeutralStroke2}` }}>
              {views.map((v) => (
                <Option key={v.name} value={v.name}>{v.name}</Option>
              ))}
            </Listbox>
            <div className={s.row}>
              <Button disabled={!picked} onClick={() => (onActivate(views.find((v) => v.name === picked) ?? null), onClose())}>{tl("Wechseln zu")}</Button>
              <Button disabled={!picked} icon={<Delete16Regular />} onClick={() => (onDelete(picked), setPicked(""))}>{tl("Löschen")}</Button>
              <Button onClick={() => (onActivate(null), onClose())}>{tl("Standard")}</Button>
            </div>
            <Field label={tl("Aktuelle Ansicht speichern als")}>
              <div className={s.row}>
                <Input style={{ flex: 1 }} value={name} onChange={(_, d) => setName(d.value)} />
                <Button appearance="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>{tl("Speichern")}</Button>
              </div>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Checkbox cells of a sheet contain (r, c). */
export const isCheckbox = (boxes: Rect[] | undefined, r: number, c: number) => !!boxes?.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);

export const rectList = (boxes: Rect[] | undefined) => (boxes ?? []).map(rangeName);
