// Daten abrufen und transformieren (a small Power Query): load CSV, JSON,
// web data or another workbook, apply steps (columns, filters, types,
// duplicates, sorting) and load the result into a sheet. Queries are kept
// in the workbook and can be refreshed.

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Delete16Regular } from "@fluentui/react-icons";
import type { DataQuery, QueryStep, RustWorkbook } from "./model";
import { errorMessage, isTauri } from "../../lib/api";
import { officeInvoke, openProtected } from "../../lib/office";
import { tl, LOCALE } from "../../lib/i18n";

export type Table = (string | number | boolean | null)[][];

const useStyles = makeStyles({
  body: { display: "grid", gridTemplateColumns: "240px 1fr", gap: "16px", minHeight: "380px" },
  col: { display: "flex", flexDirection: "column", gap: "10px" },
  steps: { display: "flex", flexDirection: "column", gap: "4px" },
  step: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, fontSize: "12px" },
  preview: { overflow: "auto", maxHeight: "420px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  table: { borderCollapse: "collapse", fontSize: "12px", "& td, & th": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "2px 6px", whiteSpace: "nowrap" }, "& th": { backgroundColor: tokens.colorNeutralBackground3, position: "sticky", top: 0 } },
  row: { display: "flex", gap: "6px", alignItems: "flex-end", flexWrap: "wrap" },
});

// ---------------------------------------------------------------- parsing --

/** CSV with quotes; the delimiter is guessed when not given. */
export function parseDelimited(text: string, delimiter?: string): Table {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter || ([";", "\t", ",", "|"].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",");
  const rows: Table = [];
  let row: (string | null)[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"', i++);
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === d) (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** JSON: an array of objects (or of arrays), or an object holding one. */
export function parseJson(text: string): Table {
  let v: unknown = JSON.parse(text);
  if (v && !Array.isArray(v) && typeof v === "object") {
    const arr = Object.values(v as Record<string, unknown>).find(Array.isArray);
    v = arr ?? [v];
  }
  if (!Array.isArray(v)) throw new Error(tl("Die JSON-Daten enthalten keine Liste."));
  if (v.every(Array.isArray)) return (v as unknown[][]).map((r) => r.map(scalar));
  const cols: string[] = [];
  for (const o of v) if (o && typeof o === "object") for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
  return [cols, ...v.map((o) => cols.map((k) => scalar((o as Record<string, unknown>)?.[k])))];
}

const scalar = (x: unknown): string | number | boolean | null =>
  x === null || x === undefined ? null : typeof x === "number" || typeof x === "boolean" || typeof x === "string" ? x : JSON.stringify(x);

/** The first (largest) HTML table of a page. */
export function parseHtmlTable(html: string): Table {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = [...doc.querySelectorAll("table")].sort((a, b) => b.rows.length - a.rows.length);
  const t = tables[0];
  if (!t) throw new Error(tl("Auf der Seite wurde keine Tabelle gefunden."));
  return [...t.rows].map((r) => [...r.cells].map((c) => c.textContent?.replace(/\s+/g, " ").trim() ?? ""));
}

// ---------------------------------------------------------------- steps --

const num = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().replace(/\s/g, "");
  // 1.234,56 (German) or 1,234.56 (English).
  const n = /,\d{1,2}$/.test(s) || /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Date text → Excel serial number. */
const dateSerial = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(v.trim());
  let y: number, mo: number, d: number;
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim()))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  return (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
};

export function applySteps(data: Table, steps: QueryStep[]): Table {
  let t = data.map((r) => [...r]);
  const header = () => (t[0] ?? []).map((h) => String(h ?? ""));
  const idx = (col: string) => header().indexOf(col);
  for (const s of steps) {
    switch (s.op) {
      case "header":
        // Rows already have a header; the step names columns of headerless data.
        if (!t.length) break;
        t = [t[0].map((_, i) => tl("Spalte{0}", i + 1)), ...t];
        break;
      case "keep": {
        const ids = s.columns.map(idx).filter((i) => i >= 0);
        t = t.map((r) => ids.map((i) => r[i] ?? null));
        break;
      }
      case "rename": {
        const i = idx(s.column);
        if (i >= 0 && t[0]) t[0][i] = s.to;
        break;
      }
      case "type": {
        const i = idx(s.column);
        if (i < 0) break;
        for (let r = 1; r < t.length; r++) {
          const v = t[r][i];
          t[r][i] = s.to === "number" ? num(v) : s.to === "date" ? dateSerial(v) : v === null ? null : String(v);
        }
        break;
      }
      case "filter": {
        const i = idx(s.column);
        if (i < 0) break;
        const lower = s.value.toLowerCase();
        const pass = (v: unknown) => {
          const text = v === null || v === undefined ? "" : String(v).toLowerCase();
          const n = num(v);
          const target = num(s.value);
          switch (s.test) {
            case "eq":
              return text === lower;
            case "ne":
              return text !== lower;
            case "contains":
              return text.includes(lower);
            case "gt":
              return n !== null && target !== null && n > target;
            case "lt":
              return n !== null && target !== null && n < target;
            case "notEmpty":
              return text !== "";
          }
        };
        t = [t[0], ...t.slice(1).filter((r) => pass(r[i]))];
        break;
      }
      case "dedupe": {
        const seen = new Set<string>();
        t = [t[0], ...t.slice(1).filter((r) => {
          const k = JSON.stringify(r);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })];
        break;
      }
      case "sort": {
        const i = idx(s.column);
        if (i < 0) break;
        const body = t.slice(1).sort((a, b) => {
          const x = a[i];
          const y = b[i];
          const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), LOCALE, { numeric: true });
          return s.desc ? -r : r;
        });
        t = [t[0], ...body];
        break;
      }
      case "top":
        t = t.slice(0, Math.max(0, s.count) + 1);
        break;
    }
  }
  return t;
}

/** Raw data of a query's source. */
export async function loadSource(q: Pick<DataQuery, "kind" | "source" | "option">): Promise<Table> {
  if (!isTauri) throw new Error(tl("Im Browser-Vorschaumodus nicht verfügbar."));
  if (q.kind === "workbook") {
    const { loaded } = await openProtected<{ workbook: RustWorkbook }>("sheets_open", q.source);
    const s = loaded.workbook.sheets.find((x) => x.name === q.option) ?? loaded.workbook.sheets[0];
    if (!s) return [];
    let maxR = -1;
    let maxC = -1;
    const at = new Map<string, string | number | boolean | null>();
    for (const [ref, c] of Object.entries(s.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = Number(m[2]) - 1;
      maxR = Math.max(maxR, row);
      maxC = Math.max(maxC, col);
      at.set(`${row}:${col}`, c.v ?? null);
    }
    return Array.from({ length: maxR + 1 }, (_, r) => Array.from({ length: maxC + 1 }, (_, c) => at.get(`${r}:${c}`) ?? null));
  }
  const text = q.kind === "web" ? await officeInvoke<string>("fetch_text", { url: q.source }) : await officeInvoke<string>("read_text_file", { path: q.source });
  const trimmed = text.trimStart();
  if (q.kind === "json" || (q.kind === "web" && (trimmed.startsWith("{") || trimmed.startsWith("[")))) return parseJson(text);
  if (q.kind === "web" && /^<(!doctype|html|table)/i.test(trimmed)) return parseHtmlTable(text);
  return parseDelimited(text, q.option || undefined);
}

export async function runQuery(q: DataQuery): Promise<Table> {
  return applySteps(await loadSource(q), q.steps);
}

// ---------------------------------------------------------------- dialog --

const STEP_LABEL = (s: QueryStep): string => {
  switch (s.op) {
    case "header":
      return tl("Spaltennamen hinzufügen");
    case "keep":
      return tl("Spalten behalten: {0}", s.columns.join(", "));
    case "rename":
      return tl("„{0}“ umbenennen in „{1}“", s.column, s.to);
    case "type":
      return tl("„{0}“ als {1}", s.column, s.to === "number" ? tl("Zahl") : s.to === "date" ? tl("Datum") : tl("Text"));
    case "filter":
      return tl("Filter: {0} {1} {2}", s.column, { eq: "=", ne: "≠", contains: tl("enthält"), gt: ">", lt: "<", notEmpty: tl("nicht leer") }[s.test], s.test === "notEmpty" ? "" : s.value);
    case "dedupe":
      return tl("Duplikate entfernen");
    case "sort":
      return tl("Sortieren nach {0}{1}", s.column, s.desc ? " ↓" : " ↑");
    case "top":
      return tl("Erste {0} Zeilen", s.count);
  }
};

export function QueryDialog({
  open,
  initial,
  onClose,
  onLoad,
  pickFile,
}: {
  open: boolean;
  initial: DataQuery | null;
  onClose: () => void;
  onLoad: (q: DataQuery, data: Table) => void;
  pickFile: (kind: "csv" | "json" | "workbook") => Promise<string | null>;
}) {
  const s = useStyles();
  const [q, setQ] = useState<DataQuery>({ name: "", kind: "csv", source: "", steps: [] });
  const [raw, setRaw] = useState<Table | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepKind, setStepKind] = useState<QueryStep["op"]>("filter");
  const [col, setCol] = useState("");
  const [arg, setArg] = useState("");
  const [test, setTest] = useState<"eq" | "ne" | "contains" | "gt" | "lt" | "notEmpty">("eq");

  useEffect(() => {
    if (!open) return;
    setQ(initial ?? { name: tl("Abfrage{0}", 1), kind: "csv", source: "", steps: [] });
    setRaw(null);
    setError(null);
  }, [open, initial]);

  const load = async (next = q) => {
    if (!next.source) return;
    setBusy(true);
    setError(null);
    try {
      setRaw(await loadSource(next));
    } catch (e) {
      setError(errorMessage(e));
      setRaw(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open && initial) void load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const result = useMemo(() => (raw ? applySteps(raw, q.steps) : null), [raw, q.steps]);
  const columns = (result?.[0] ?? []).map((h) => String(h ?? ""));
  useEffect(() => {
    if (columns.length && !columns.includes(col)) setCol(columns[0]);
  }, [columns, col]);

  const addStep = () => {
    let step: QueryStep | null = null;
    switch (stepKind) {
      case "filter":
        step = { op: "filter", column: col, test, value: arg };
        break;
      case "keep":
        step = { op: "keep", columns: arg.split(/[;,]/).map((x) => x.trim()).filter((x) => columns.includes(x)) };
        break;
      case "type":
        step = { op: "type", column: col, to: (arg as "number" | "text" | "date") || "number" };
        break;
      case "sort":
        step = { op: "sort", column: col, desc: arg === "desc" };
        break;
      case "rename":
        step = arg.trim() ? { op: "rename", column: col, to: arg.trim() } : null;
        break;
      case "top":
        step = { op: "top", count: Math.max(1, Number(arg) || 100) };
        break;
      case "dedupe":
        step = { op: "dedupe" };
        break;
      case "header":
        step = { op: "header" };
        break;
    }
    if (step) setQ({ ...q, steps: [...q.steps, step] });
    setArg("");
  };

  const SOURCES: [DataQuery["kind"], string][] = [
    ["csv", tl("Text/CSV")],
    ["json", tl("JSON")],
    ["web", tl("Web")],
    ["workbook", tl("Excel-Arbeitsmappe")],
  ];

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 1000, width: "92vw" }}>
        <DialogBody>
          <DialogTitle>{tl("Daten abrufen und transformieren")}</DialogTitle>
          <DialogContent className={s.body}>
            <div className={s.col}>
              <Field label={tl("Name der Abfrage")}>
                <Input value={q.name} onChange={(_, d) => setQ({ ...q, name: d.value })} />
              </Field>
              <Field label={tl("Quelle")}>
                <Dropdown value={SOURCES.find((x) => x[0] === q.kind)?.[1]} selectedOptions={[q.kind]} onOptionSelect={(_, d) => setQ({ ...q, kind: d.optionValue as DataQuery["kind"], source: "", option: undefined })}>
                  {SOURCES.map(([k, l]) => (
                    <Option key={k} value={k}>{l}</Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={q.kind === "web" ? tl("URL") : tl("Datei")}>
                <div className={s.row}>
                  <Input style={{ flex: 1 }} value={q.source} onChange={(_, d) => setQ({ ...q, source: d.value })} placeholder={q.kind === "web" ? "https://…" : ""} />
                  {q.kind !== "web" && (
                    <Button
                      onClick={async () => {
                        const p = await pickFile(q.kind === "workbook" ? "workbook" : q.kind === "json" ? "json" : "csv");
                        if (p) {
                          const next = { ...q, source: p };
                          setQ(next);
                          void load(next);
                        }
                      }}
                    >
                      …
                    </Button>
                  )}
                </div>
              </Field>
              {(q.kind === "csv" || q.kind === "workbook") && (
                <Field label={q.kind === "csv" ? tl("Trennzeichen (leer = automatisch)") : tl("Blatt (leer = erstes)")}>
                  <Input value={q.option ?? ""} onChange={(_, d) => setQ({ ...q, option: d.value || undefined })} />
                </Field>
              )}
              <Button appearance="primary" disabled={!q.source || busy} onClick={() => void load()}>
                {busy ? <Spinner size="tiny" /> : tl("Daten laden")}
              </Button>
              <Text weight="semibold">{tl("Angewendete Schritte")}</Text>
              <div className={s.steps}>
                <div className={s.step}>{tl("Quelle")}</div>
                {q.steps.map((st, i) => (
                  <div key={i} className={s.step}>
                    <span>{STEP_LABEL(st)}</span>
                    <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label={tl("Schritt entfernen")} onClick={() => setQ({ ...q, steps: q.steps.filter((_, j) => j !== i) })} />
                  </div>
                ))}
              </div>
            </div>
            <div className={s.col}>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              {result && (
                <>
                  <div className={s.row}>
                    <Field label={tl("Schritt")}>
                      <Dropdown
                        value={{ filter: tl("Zeilen filtern"), keep: tl("Spalten auswählen"), type: tl("Datentyp ändern"), sort: tl("Sortieren"), rename: tl("Spalte umbenennen"), top: tl("Erste Zeilen behalten"), dedupe: tl("Duplikate entfernen"), header: tl("Spaltennamen hinzufügen") }[stepKind]}
                        selectedOptions={[stepKind]}
                        onOptionSelect={(_, d) => (setStepKind(d.optionValue as QueryStep["op"]), setArg(""))}
                      >
                        <Option value="filter">{tl("Zeilen filtern")}</Option>
                        <Option value="keep">{tl("Spalten auswählen")}</Option>
                        <Option value="type">{tl("Datentyp ändern")}</Option>
                        <Option value="sort">{tl("Sortieren")}</Option>
                        <Option value="rename">{tl("Spalte umbenennen")}</Option>
                        <Option value="top">{tl("Erste Zeilen behalten")}</Option>
                        <Option value="dedupe">{tl("Duplikate entfernen")}</Option>
                        <Option value="header">{tl("Spaltennamen hinzufügen")}</Option>
                      </Dropdown>
                    </Field>
                    {["filter", "type", "sort", "rename"].includes(stepKind) && (
                      <Field label={tl("Spalte")}>
                        <Dropdown value={col} selectedOptions={[col]} onOptionSelect={(_, d) => setCol(d.optionValue ?? "")}>
                          {columns.map((c) => (
                            <Option key={c} value={c}>{c || " "}</Option>
                          ))}
                        </Dropdown>
                      </Field>
                    )}
                    {stepKind === "filter" && (
                      <Field label={tl("Bedingung")}>
                        <Dropdown value={{ eq: "=", ne: "≠", contains: tl("enthält"), gt: ">", lt: "<", notEmpty: tl("nicht leer") }[test]} selectedOptions={[test]} onOptionSelect={(_, d) => setTest(d.optionValue as typeof test)}>
                          <Option value="eq">=</Option>
                          <Option value="ne">≠</Option>
                          <Option value="contains">{tl("enthält")}</Option>
                          <Option value="gt">&gt;</Option>
                          <Option value="lt">&lt;</Option>
                          <Option value="notEmpty">{tl("nicht leer")}</Option>
                        </Dropdown>
                      </Field>
                    )}
                    {stepKind === "type" ? (
                      <Field label={tl("Typ")}>
                        <Dropdown value={{ number: tl("Zahl"), text: tl("Text"), date: tl("Datum") }[(arg || "number") as "number"]} selectedOptions={[arg || "number"]} onOptionSelect={(_, d) => setArg(d.optionValue ?? "number")}>
                          <Option value="number">{tl("Zahl")}</Option>
                          <Option value="text">{tl("Text")}</Option>
                          <Option value="date">{tl("Datum")}</Option>
                        </Dropdown>
                      </Field>
                    ) : stepKind === "sort" ? (
                      <Field label={tl("Reihenfolge")}>
                        <Dropdown value={arg === "desc" ? tl("Absteigend") : tl("Aufsteigend")} selectedOptions={[arg || "asc"]} onOptionSelect={(_, d) => setArg(d.optionValue ?? "asc")}>
                          <Option value="asc">{tl("Aufsteigend")}</Option>
                          <Option value="desc">{tl("Absteigend")}</Option>
                        </Dropdown>
                      </Field>
                    ) : ["filter", "keep", "rename", "top"].includes(stepKind) && !(stepKind === "filter" && test === "notEmpty") ? (
                      <Field label={stepKind === "keep" ? tl("Spalten (durch ; getrennt)") : stepKind === "top" ? tl("Anzahl") : stepKind === "rename" ? tl("Neuer Name") : tl("Wert")}>
                        <Input value={arg} onChange={(_, d) => setArg(d.value)} />
                      </Field>
                    ) : null}
                    <Button onClick={addStep}>{tl("Hinzufügen")}</Button>
                  </div>
                  <Text size={200}>{tl("{0} Zeilen, {1} Spalten", Math.max(0, result.length - 1), columns.length)}</Text>
                  <div className={s.preview}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          {columns.map((c, i) => (
                            <th key={i}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.slice(1, 101).map((r, i) => (
                          <tr key={i}>
                            {r.map((v, j) => (
                              <td key={j} style={{ textAlign: typeof v === "number" ? "right" : "left" }}>{v === null ? "" : typeof v === "number" ? v.toLocaleString(LOCALE) : String(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!result || !q.name.trim()} onClick={() => result && (onLoad({ ...q, name: q.name.trim() }, result), onClose())}>
              {tl("Schließen & laden")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
