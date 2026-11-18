// Dialogs and pop-ups of Nexora Tabellen: auto filter menu, conditional
// formatting rules and the name manager.

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
  Option,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, Delete16Regular, TextSortAscending20Regular, TextSortDescending20Regular } from "@fluentui/react-icons";
import { COND_PRESETS, describeRule } from "./features";
import { fromDisplayFormula, toDisplayFormula } from "./formula";
import type { CellStyle, CondFormat, CondRule, DefinedName } from "./model";
import { rangeName } from "./model";

const useStyles = makeStyles({
  pop: {
    position: "fixed",
    zIndex: 60,
    width: "260px",
    padding: "8px",
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow28,
    backdropFilter: "blur(40px) saturate(1.6)",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  list: {
    maxHeight: "220px",
    overflowY: "auto",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "2px 0",
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "4px" },
  sortBtn: { justifyContent: "flex-start" },
  preview: { padding: "4px 10px", borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: "13px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end" },
});

// ------------------------------------------------------------ auto filter --

export function FilterMenu(p: {
  x: number;
  y: number;
  values: string[];
  /** Currently visible values; null = no filter on this column. */
  selected: string[] | null;
  onSort: (asc: boolean) => void;
  onApply: (values: string[] | null) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(p.selected ?? p.values));
  const shown = useMemo(() => p.values.filter((v) => (v || "(Leer)").toLowerCase().includes(query.toLowerCase())), [p.values, query]);
  const all = shown.every((v) => checked.has(v));

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-filter-pop]")) p.onClose();
    };
    const t = setTimeout(() => window.addEventListener("mousedown", close));
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
    };
  }, [p]);

  const apply = () => {
    const vals = p.values.filter((v) => checked.has(v));
    p.onApply(vals.length === p.values.length ? null : vals);
  };

  return (
    <div className={s.pop} data-filter-pop style={{ left: Math.min(p.x, window.innerWidth - 270), top: Math.min(p.y, window.innerHeight - 420) }} onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <Button appearance="subtle" className={s.sortBtn} icon={<TextSortAscending20Regular />} onClick={() => p.onSort(true)}>
        Von A bis Z sortieren
      </Button>
      <Button appearance="subtle" className={s.sortBtn} icon={<TextSortDescending20Regular />} onClick={() => p.onSort(false)}>
        Von Z bis A sortieren
      </Button>
      <Button appearance="subtle" className={s.sortBtn} disabled={p.selected === null} onClick={() => p.onApply(null)}>
        Filter löschen
      </Button>
      <Input size="small" placeholder="Suchen" value={query} onChange={(_, d) => setQuery(d.value)} autoFocus />
      <div className={s.list}>
        <Checkbox
          label="(Alles auswählen)"
          checked={all ? true : shown.some((v) => checked.has(v)) ? "mixed" : false}
          onChange={() =>
            setChecked((c) => {
              const n = new Set(c);
              for (const v of shown) {
                if (all) n.delete(v);
                else n.add(v);
              }
              return n;
            })
          }
        />
        {shown.map((v) => (
          <div key={v}>
            <Checkbox
              label={v || "(Leer)"}
              checked={checked.has(v)}
              onChange={() =>
                setChecked((c) => {
                  const n = new Set(c);
                  if (n.has(v)) n.delete(v);
                  else n.add(v);
                  return n;
                })
              }
            />
          </div>
        ))}
      </div>
      <div className={s.actions}>
        <Button appearance="primary" size="small" disabled={!p.values.some((v) => checked.has(v))} onClick={apply}>
          OK
        </Button>
        <Button size="small" onClick={p.onClose}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------- conditional formatting --

export type CondKind = "greaterThan" | "lessThan" | "between" | "equal" | "text" | "duplicate" | "top" | "bottom" | "topPercent" | "bottomPercent" | "above" | "below" | "formula";

const TITLES: Record<CondKind, [string, string]> = {
  greaterThan: ["Größer als", "Zellen formatieren, die GRÖSSER sind als:"],
  lessThan: ["Kleiner als", "Zellen formatieren, die KLEINER sind als:"],
  between: ["Zwischen", "Zellen formatieren, die ZWISCHEN folgenden Werten liegen:"],
  equal: ["Gleich", "Zellen formatieren, die GLEICH sind wie:"],
  text: ["Textinhalt", "Zellen formatieren, die folgenden Text enthalten:"],
  duplicate: ["Doppelte Werte", "Zellen formatieren, die folgende Werte enthalten:"],
  top: ["Obere 10 Elemente", "Die OBERSTEN Elemente formatieren:"],
  bottom: ["Untere 10 Elemente", "Die UNTERSTEN Elemente formatieren:"],
  topPercent: ["Obere 10 %", "Die OBERSTEN Prozent formatieren:"],
  bottomPercent: ["Untere 10 %", "Die UNTERSTEN Prozent formatieren:"],
  above: ["Über dem Durchschnitt", "Zellen formatieren, die ÜBER dem Durchschnitt liegen"],
  below: ["Unter dem Durchschnitt", "Zellen formatieren, die UNTER dem Durchschnitt liegen"],
  formula: ["Neue Formatierungsregel", "Werte formatieren, für die diese Formel wahr ist:"],
};

/** Typed value → stored formula operand (numbers, references or text). */
function operand(v: string): string {
  const t = v.trim();
  if (t.startsWith("=")) return fromDisplayFormula(t.slice(1));
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  if (t && Number.isFinite(n)) return String(n);
  return `"${t.replace(/"/g, '""')}"`;
}

export function CondDialog(p: { kind: CondKind | null; range: string; onClose: () => void; onApply: (rule: CondRule) => void }) {
  const s = useStyles();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [preset, setPreset] = useState(0);
  const [unique, setUnique] = useState(false);
  useEffect(() => {
    setA(p.kind && ["top", "bottom", "topPercent", "bottomPercent"].includes(p.kind) ? "10" : "");
    setB("");
    setPreset(0);
    setUnique(false);
  }, [p.kind]);
  if (!p.kind) return null;
  const kind = p.kind;
  const [title, label] = TITLES[kind];
  const style: CellStyle = COND_PRESETS[preset].style;
  const needsA = !["duplicate", "above", "below"].includes(kind);

  const build = (): CondRule => {
    switch (kind) {
      case "greaterThan":
      case "lessThan":
      case "equal":
        return { kind: "cellIs", operator: kind, formulas: [operand(a)], style };
      case "between":
        return { kind: "cellIs", operator: "between", formulas: [operand(a), operand(b)], style };
      case "text":
        return { kind: "containsText", operator: "containsText", text: a, style };
      case "duplicate":
        return { kind: unique ? "uniqueValues" : "duplicateValues", style };
      case "top":
      case "bottom":
      case "topPercent":
      case "bottomPercent":
        return { kind: "top10", rank: Math.max(1, Math.round(Number(a.replace(",", ".")) || 10)), bottom: kind.startsWith("bottom"), percent: kind.endsWith("Percent"), style };
      case "above":
      case "below":
        return { kind: "aboveAverage", below: kind === "below", style };
      case "formula":
        return { kind: "expression", formulas: [fromDisplayFormula(a.replace(/^=/, ""))], style };
    }
  };

  const apply = () => {
    if (needsA && !a.trim()) return;
    p.onApply(build());
    p.onClose();
  };

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text>{label}</Text>
            {kind === "duplicate" ? (
              <Dropdown value={unique ? "eindeutige" : "doppelte"} selectedOptions={[unique ? "u" : "d"]} onOptionSelect={(_, d) => setUnique(d.optionValue === "u")}>
                <Option value="d">doppelte</Option>
                <Option value="u">eindeutige</Option>
              </Dropdown>
            ) : needsA ? (
              <div className={s.row}>
                <Input autoFocus value={a} onChange={(_, d) => setA(d.value)} onKeyDown={(e) => e.key === "Enter" && apply()} style={{ flex: 1 }} placeholder={kind === "formula" ? "=$B2>100" : undefined} />
                {kind === "between" && (
                  <>
                    <Text>und</Text>
                    <Input value={b} onChange={(_, d) => setB(d.value)} onKeyDown={(e) => e.key === "Enter" && apply()} style={{ flex: 1 }} />
                  </>
                )}
              </div>
            ) : null}
            <Field label="Formatierung">
              <Dropdown value={COND_PRESETS[preset].label} selectedOptions={[String(preset)]} onOptionSelect={(_, d) => setPreset(Number(d.optionValue))}>
                {COND_PRESETS.map((x, i) => (
                  <Option key={i} value={String(i)}>
                    {x.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <div className={s.preview} style={{ background: style.fill, color: style.color, fontWeight: style.bold ? 700 : undefined }}>
              AaBbCcYyZz – {p.range}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={apply}>
              OK
            </Button>
            <Button onClick={p.onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function RulesDialog(p: { open: boolean; formats: CondFormat[]; onClose: () => void; onDelete: (cf: CondFormat, rule: CondRule) => void }) {
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>Regeln für bedingte Formatierung</DialogTitle>
          <DialogContent>
            {p.formats.length === 0 ? (
              <Text>Für dieses Blatt sind keine Regeln definiert.</Text>
            ) : (
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Regel</TableHeaderCell>
                    <TableHeaderCell>Format</TableHeaderCell>
                    <TableHeaderCell>Wird angewendet auf</TableHeaderCell>
                    <TableHeaderCell style={{ width: 44 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.formats.flatMap((cf, i) =>
                    cf.rules.map((r, j) => (
                      <TableRow key={`${i}-${j}`}>
                        <TableCell>{describeRule(r)}</TableCell>
                        <TableCell>
                          {r.kind === "colorScale" || r.kind === "dataBar" ? (
                            <span style={{ display: "inline-block", width: 60, height: 14, background: `linear-gradient(90deg, ${(r.colors?.length ? r.colors : ["#f8696b", "#63be7b"]).join(",")}${r.kind === "dataBar" ? ", transparent" : ""})` }} />
                          ) : (
                            <span style={{ padding: "1px 6px", background: r.style?.fill, color: r.style?.color, fontWeight: r.style?.bold ? 700 : undefined, border: "1px solid #ddd" }}>AaBbCc</span>
                          )}
                        </TableCell>
                        <TableCell>{cf.ranges.map(rangeName).join(" ")}</TableCell>
                        <TableCell>
                          <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label="Regel löschen" onClick={() => p.onDelete(cf, r)} />
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={p.onClose}>Schließen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ----------------------------------------------------------- name manager --

const NAME_RE = /^[A-Za-zÄÖÜäöüß_\\][\wÄÖÜäöüß.]*$/;

/** Whether a text can be used as a defined name (not a cell reference). */
export function validName(n: string): boolean {
  return NAME_RE.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^(R\d*C\d*|[RC])$/i.test(n) && !["TRUE", "FALSE", "WAHR", "FALSCH"].includes(n.toUpperCase());
}

export function NameDialog(p: {
  open: boolean;
  initial: DefinedName | null;
  defaultRef: string;
  sheets: string[];
  existing: DefinedName[];
  onClose: () => void;
  onSave: (n: DefinedName, previous: DefinedName | null) => void;
}) {
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [scope, setScope] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!p.open) return;
    setName(p.initial?.name ?? "");
    setRef(p.initial ? `=${toDisplayFormula(p.initial.formula)}` : `=${p.defaultRef}`);
    setScope(p.initial?.sheet);
  }, [p.open, p.initial, p.defaultRef]);
  const clash = p.existing.some((x) => x !== p.initial && x.name.toLowerCase() === name.trim().toLowerCase() && x.sheet === scope);
  const error = !name.trim() ? undefined : !validName(name.trim()) ? "Ungültiger Name (keine Leerzeichen, darf nicht wie ein Zellbezug aussehen)." : clash ? "Dieser Name existiert bereits." : undefined;
  const save = () => {
    if (!name.trim() || error || !ref.trim()) return;
    p.onSave({ name: name.trim(), formula: fromDisplayFormula(ref.trim().replace(/^=/, "")), sheet: scope }, p.initial);
    p.onClose();
  };
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{p.initial ? "Namen bearbeiten" : "Neuer Name"}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Name" validationMessage={error}>
              <Input autoFocus value={name} onChange={(_, d) => setName(d.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            </Field>
            <Field label="Bereich">
              <Dropdown value={scope === undefined ? "Arbeitsmappe" : p.sheets[scope]} selectedOptions={[scope === undefined ? "wb" : String(scope)]} onOptionSelect={(_, d) => setScope(d.optionValue === "wb" ? undefined : Number(d.optionValue))}>
                <Option value="wb">Arbeitsmappe</Option>
                {p.sheets.map((n, i) => (
                  <Option key={i} value={String(i)}>
                    {n}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Bezieht sich auf">
              <Input value={ref} onChange={(_, d) => setRef(d.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!name.trim() || !!error} onClick={save}>
              OK
            </Button>
            <Button onClick={p.onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function NameManager(p: { open: boolean; names: DefinedName[]; sheets: string[]; onClose: () => void; onNew: () => void; onEdit: (n: DefinedName) => void; onDelete: (n: DefinedName) => void; valueOf: (n: DefinedName) => string }) {
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 680 }}>
        <DialogBody>
          <DialogTitle>Namens-Manager</DialogTitle>
          <DialogContent>
            <Button icon={<Add16Regular />} onClick={p.onNew} style={{ marginBottom: 8 }}>
              Neu…
            </Button>
            {p.names.length === 0 ? (
              <Text block>Es sind noch keine Namen definiert. Namen machen Formeln lesbarer, z. B. =SUMME(Umsatz).</Text>
            ) : (
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Wert</TableHeaderCell>
                    <TableHeaderCell>Bezieht sich auf</TableHeaderCell>
                    <TableHeaderCell>Bereich</TableHeaderCell>
                    <TableHeaderCell style={{ width: 44 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.names.map((n, i) => (
                    <TableRow key={i} onDoubleClick={() => p.onEdit(n)} style={{ cursor: "pointer" }}>
                      <TableCell>{n.name}</TableCell>
                      <TableCell>{p.valueOf(n)}</TableCell>
                      <TableCell>={toDisplayFormula(n.formula)}</TableCell>
                      <TableCell>{n.sheet === undefined ? "Arbeitsmappe" : p.sheets[n.sheet]}</TableCell>
                      <TableCell>
                        <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label="Namen löschen" onClick={() => p.onDelete(n)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={p.onClose}>Schließen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
