// Dialogs of the what-if analysis: goal seek, data table, scenario
// manager and the solver.

import { useEffect, useState } from "react";
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
  Option,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Text,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, Delete16Regular } from "@fluentui/react-icons";
import type { Book, Scenario } from "./model";
import { a1, parseRange } from "./model";
import type { CellRef, Constraint, SolverProblem } from "./whatif";

/** "B3", "$B$3" or "Tabelle1!B3" → cell. */
export function parseCell(text: string, book: Book, si: number): CellRef | null {
  const r = parseRefs(text, book, si);
  return r && r.length === 1 ? r[0] : null;
}

/** Cells of references separated by ";" ("A1:A3;C1"). */
export function parseRefs(text: string, book: Book, si: number): CellRef[] | null {
  const out: CellRef[] = [];
  for (const part of text.split(/[;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.replace(/^=/, "").match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
    const sheet = m ? book.sheets.findIndex((x) => x.name.toLowerCase() === (m[1]?.replace(/''/g, "'") ?? m[2]).toLowerCase()) : si;
    const rect = parseRange((m ? m[3] : part.replace(/^=/, "")).replace(/\$/g, ""));
    if (!rect || sheet < 0) return null;
    for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) out.push({ sheet, r, c });
  }
  return out.length ? out : null;
}

export const refText = (book: Book, si: number, x: CellRef) => (x.sheet === si ? "" : `${book.sheets[x.sheet].name}!`) + "$" + a1(x.r, x.c).replace(/^([A-Z]+)/, "$1$");

const num = (s: string) => Number(s.trim().replace(/\./g, "").replace(",", "."));

function Frame({ title, width = 420, children, actions, onClose }: { title: string; width?: number; children: React.ReactNode; actions: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ goal seek --

export function GoalSeekDialog(p: { open: boolean; target: string; onClose: () => void; onRun: (target: string, value: number, changing: string) => string | null }) {
  const [target, setTarget] = useState(p.target);
  const [value, setValue] = useState("");
  const [changing, setChanging] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) (setTarget(p.target), setError(null));
  }, [p.open, p.target]);
  if (!p.open) return null;
  const run = () => {
    const v = num(value);
    if (!Number.isFinite(v)) return setError("Zielwert muss eine Zahl sein.");
    setError(p.onRun(target, v, changing));
  };
  return (
    <Frame
      title="Zielwertsuche"
      width={360}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" onClick={run}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Zielzelle">
        <Input value={target} onChange={(_, d) => setTarget(d.value)} />
      </Field>
      <Field label="Zielwert">
        <Input value={value} onChange={(_, d) => setValue(d.value)} autoFocus />
      </Field>
      <Field label="Veränderbare Zelle" validationMessage={error ?? undefined}>
        <Input value={changing} onChange={(_, d) => setChanging(d.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), run())} />
      </Field>
    </Frame>
  );
}

/** Result of goal seek or solver: keep the values or restore. */
export function ResultDialog(p: { open: boolean; title: string; message: string; details?: string[]; onKeep: () => void; onRestore: () => void }) {
  if (!p.open) return null;
  return (
    <Frame
      title={p.title}
      onClose={p.onRestore}
      actions={
        <>
          <Button appearance="primary" onClick={p.onKeep}>
            Lösung behalten
          </Button>
          <Button onClick={p.onRestore}>Ausgangswerte wiederherstellen</Button>
        </>
      }
    >
      <Text>{p.message}</Text>
      {p.details?.map((d, i) => (
        <Text key={i} size={200} style={{ color: tokens.colorNeutralForeground2 }}>
          {d}
        </Text>
      ))}
    </Frame>
  );
}

// ----------------------------------------------------------- data table --

export function DataTableDialog(p: { open: boolean; onClose: () => void; onApply: (rowInput: string, colInput: string) => string | null }) {
  const [row, setRow] = useState("");
  const [col, setCol] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) setError(null);
  }, [p.open]);
  if (!p.open) return null;
  return (
    <Frame
      title="Datentabelle"
      width={360}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" onClick={() => setError(p.onApply(row, col))}>
            OK
          </Button>
        </>
      }
    >
      <Text size={200}>Markieren Sie vorher den Bereich: Formeln in der ersten Zeile (oder Spalte), Eingabewerte in der ersten Spalte (oder Zeile).</Text>
      <Field label="Werte aus Zeile (Zeileneingabezelle)">
        <Input value={row} onChange={(_, d) => setRow(d.value)} autoFocus />
      </Field>
      <Field label="Werte aus Spalte (Spalteneingabezelle)" validationMessage={error ?? undefined}>
        <Input value={col} onChange={(_, d) => setCol(d.value)} />
      </Field>
    </Frame>
  );
}

// ------------------------------------------------------ scenario manager --

export function ScenarioManager(p: {
  open: boolean;
  scenarios: Scenario[];
  selectionRef: string;
  describe: (s: Scenario) => string;
  onClose: () => void;
  onSave: (name: string, cells: string, values: string[], comment: string, prev: Scenario | null) => string | null;
  onDelete: (s: Scenario) => void;
  onShow: (s: Scenario) => void;
  onSummary: (resultCells: string) => string | null;
}) {
  const [sel, setSel] = useState(0);
  const [edit, setEdit] = useState<null | { prev: Scenario | null; name: string; cells: string; values: string[]; comment: string; stage: "cells" | "values" }>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!p.open) return null;
  const cur = p.scenarios[Math.min(sel, p.scenarios.length - 1)];
  if (summary !== null)
    return (
      <Frame
        title="Szenariobericht"
        width={380}
        onClose={() => setSummary(null)}
        actions={
          <>
            <Button onClick={() => setSummary(null)}>Abbrechen</Button>
            <Button appearance="primary" onClick={() => {
              const e = p.onSummary(summary);
              if (e) setError(e);
              else setSummary(null);
            }}>
              OK
            </Button>
          </>
        }
      >
        <Field label="Ergebniszellen" validationMessage={error ?? undefined}>
          <Input value={summary} onChange={(_, d) => setSummary(d.value)} autoFocus />
        </Field>
      </Frame>
    );
  if (edit)
    return (
      <Frame
        title={edit.stage === "cells" ? (edit.prev ? "Szenario bearbeiten" : "Szenario hinzufügen") : "Szenariowerte"}
        onClose={() => setEdit(null)}
        actions={
          <>
            <Button onClick={() => setEdit(null)}>Abbrechen</Button>
            {edit.stage === "cells" ? (
              <Button appearance="primary" disabled={!edit.name.trim() || !edit.cells.trim()} onClick={() => setEdit({ ...edit, stage: "values" })}>
                Weiter
              </Button>
            ) : (
              <Button
                appearance="primary"
                onClick={() => {
                  const e = p.onSave(edit.name.trim(), edit.cells, edit.values, edit.comment, edit.prev);
                  if (e) setError(e);
                  else setEdit(null);
                }}
              >
                OK
              </Button>
            )}
          </>
        }
      >
        {edit.stage === "cells" ? (
          <>
            <Field label="Szenarioname">
              <Input value={edit.name} onChange={(_, d) => setEdit({ ...edit, name: d.value })} autoFocus />
            </Field>
            <Field label="Veränderbare Zellen" hint="Mehrere Bereiche mit „;“ trennen.">
              <Input value={edit.cells} onChange={(_, d) => setEdit({ ...edit, cells: d.value, values: [] })} />
            </Field>
            <Field label="Kommentar">
              <Textarea value={edit.comment} onChange={(_, d) => setEdit({ ...edit, comment: d.value })} />
            </Field>
          </>
        ) : (
          <ScenarioValues cells={edit.cells} values={edit.values} onChange={(values) => setEdit({ ...edit, values })} error={error} />
        )}
      </Frame>
    );
  return (
    <Frame
      title="Szenario-Manager"
      width={520}
      onClose={p.onClose}
      actions={<Button onClick={p.onClose}>Schließen</Button>}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1, minHeight: 160, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 4, overflow: "auto" }}>
          {p.scenarios.length === 0 ? (
            <Text size={200} style={{ padding: 8, display: "block", color: tokens.colorNeutralForeground3 }}>
              Keine Szenarien definiert. Wählen Sie „Hinzufügen“, um Szenarien hinzuzufügen.
            </Text>
          ) : (
            <Table size="extra-small">
              <TableBody>
                {p.scenarios.map((s, i) => (
                  <TableRow key={s.name} onClick={() => setSel(i)} onDoubleClick={() => p.onShow(s)} style={{ background: s === cur ? tokens.colorNeutralBackground1Selected : undefined, cursor: "default" }}>
                    <TableCell>{s.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 140 }}>
          <Button icon={<Add16Regular />} onClick={() => (setError(null), setEdit({ prev: null, name: "", cells: p.selectionRef, values: [], comment: "", stage: "cells" }))}>
            Hinzufügen…
          </Button>
          <Button icon={<Delete16Regular />} disabled={!cur} onClick={() => cur && p.onDelete(cur)}>
            Löschen
          </Button>
          <Button disabled={!cur} onClick={() => cur && (setError(null), setEdit({ prev: cur, name: cur.name, cells: p.describe(cur), values: cur.cells.map((c) => c.v), comment: cur.comment ?? "", stage: "cells" }))}>
            Bearbeiten…
          </Button>
          <Button disabled={!p.scenarios.length} onClick={() => (setError(null), setSummary(""))}>
            Zusammenfassung…
          </Button>
          <Button appearance="primary" disabled={!cur} onClick={() => cur && p.onShow(cur)}>
            Anzeigen
          </Button>
        </div>
      </div>
      {cur && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
          Veränderbare Zellen: {p.describe(cur)}
          {cur.comment ? ` · ${cur.comment}` : ""}
        </Text>
      )}
    </Frame>
  );
}

function ScenarioValues({ cells, values, onChange, error }: { cells: string; values: string[]; onChange: (v: string[]) => void; error: string | null }) {
  // One input per changing cell (the parent resolves the references).
  const names = cells.split(";").flatMap((part) => {
    const t = part.trim().replace(/\$/g, "");
    const r = parseRange(t.replace(/^.*!/, ""));
    if (!r) return [t];
    const out: string[] = [];
    for (let y = r.r1; y <= r.r2; y++) for (let x = r.c1; x <= r.c2; x++) out.push(a1(y, x));
    return out;
  });
  return (
    <>
      <Text size={200}>Geben Sie Werte für jede veränderbare Zelle ein.</Text>
      {names.slice(0, 32).map((n, i) => (
        <Field key={n + i} label={n} orientation="horizontal">
          <Input value={values[i] ?? ""} onChange={(_, d) => onChange(names.map((_, j) => (j === i ? d.value : values[j] ?? "")))} />
        </Field>
      ))}
      {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}
    </>
  );
}

// --------------------------------------------------------------- solver --

const OPS: { id: Constraint["op"]; label: string }[] = [
  { id: "<=", label: "<=" },
  { id: "=", label: "=" },
  { id: ">=", label: ">=" },
  { id: "int", label: "int" },
  { id: "bin", label: "bin" },
];

export interface SolverForm {
  target: string;
  goal: SolverProblem["goal"];
  value: string;
  vars: string;
  constraints: { cell: string; op: Constraint["op"]; rhs: string }[];
  nonNegative: boolean;
  method: SolverProblem["method"];
}

export function SolverDialog(p: { open: boolean; initial: SolverForm; onClose: (form: SolverForm) => void; onSolve: (form: SolverForm) => string | null }) {
  const [f, setF] = useState(p.initial);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState<{ cell: string; op: Constraint["op"]; rhs: string } | null>(null);
  useEffect(() => {
    if (p.open) (setF(p.initial), setError(null), setAdd(null));
  }, [p.open, p.initial]);
  if (!p.open) return null;
  return (
    <Frame
      title="Solver-Parameter"
      width={560}
      onClose={() => p.onClose(f)}
      actions={
        <>
          <Button onClick={() => p.onClose(f)}>Schließen</Button>
          <Button appearance="primary" onClick={() => setError(p.onSolve(f))}>
            Lösen
          </Button>
        </>
      }
    >
      <Field label="Ziel festlegen">
        <Input value={f.target} onChange={(_, d) => setF({ ...f, target: d.value })} />
      </Field>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text>Bis:</Text>
        <RadioGroup layout="horizontal" value={f.goal} onChange={(_, d) => setF({ ...f, goal: d.value as SolverForm["goal"] })}>
          <Radio value="max" label="Max." />
          <Radio value="min" label="Min." />
          <Radio value="value" label="Wert:" />
        </RadioGroup>
        <Input size="small" style={{ width: 90 }} value={f.value} disabled={f.goal !== "value"} onChange={(_, d) => setF({ ...f, value: d.value })} />
      </div>
      <Field label="Durch Ändern von Variablenzellen">
        <Input value={f.vars} onChange={(_, d) => setF({ ...f, vars: d.value })} />
      </Field>
      <Field label="Unterliegt den Nebenbedingungen">
        <div style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 4, minHeight: 80, maxHeight: 160, overflow: "auto", padding: 4 }}>
          {f.constraints.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Text style={{ flex: 1, fontFamily: "monospace" }}>
                {c.cell} {c.op} {c.op === "int" || c.op === "bin" ? "" : c.rhs}
              </Text>
              <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label="Löschen" onClick={() => setF({ ...f, constraints: f.constraints.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {add ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <Input size="small" style={{ width: 110 }} placeholder="Zellbezug" value={add.cell} onChange={(_, d) => setAdd({ ...add, cell: d.value })} autoFocus />
              <Dropdown size="small" style={{ minWidth: 70 }} value={add.op} selectedOptions={[add.op]} onOptionSelect={(_, d) => setAdd({ ...add, op: d.optionValue as Constraint["op"] })}>
                {OPS.map((o) => (
                  <Option key={o.id} value={o.id}>
                    {o.label}
                  </Option>
                ))}
              </Dropdown>
              <Input size="small" style={{ width: 110 }} placeholder="Nebenbedingung" value={add.rhs} disabled={add.op === "int" || add.op === "bin"} onChange={(_, d) => setAdd({ ...add, rhs: d.value })} />
              <Button size="small" appearance="primary" disabled={!add.cell.trim() || (!add.rhs.trim() && add.op !== "int" && add.op !== "bin")} onClick={() => (setF({ ...f, constraints: [...f.constraints, add] }), setAdd(null))}>
                OK
              </Button>
              <Button size="small" onClick={() => setAdd(null)}>
                Abbrechen
              </Button>
            </div>
          ) : (
            <Button size="small" appearance="subtle" icon={<Add16Regular />} onClick={() => setAdd({ cell: "", op: "<=", rhs: "" })}>
              Hinzufügen
            </Button>
          )}
        </div>
      </Field>
      <Checkbox label="Nicht eingeschränkte Variablen als nicht-negativ festlegen" checked={f.nonNegative} onChange={(_, d) => setF({ ...f, nonNegative: !!d.checked })} />
      <Field label="Lösungsmethode" validationMessage={error ?? undefined}>
        <Dropdown value={f.method === "simplex" ? "Simplex-LP" : f.method === "nonlinear" ? "GRG-Nichtlinear" : "Automatisch"} selectedOptions={[f.method]} onOptionSelect={(_, d) => setF({ ...f, method: d.optionValue as SolverForm["method"] })}>
          <Option value="auto">Automatisch</Option>
          <Option value="simplex">Simplex-LP</Option>
          <Option value="nonlinear">GRG-Nichtlinear</Option>
        </Dropdown>
      </Field>
    </Frame>
  );
}
