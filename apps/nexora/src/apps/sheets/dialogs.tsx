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
import { COND_PRESETS, PIVOT_AGGS, type PivotAgg, type PivotGroup, type PivotOptions, describeRule } from "./features";
import { fromDisplayFormula, toDisplayFormula } from "./formula";
import type { CellStyle, CondFormat, CondRule, DefinedName, Validation } from "./model";
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

// -------------------------------------------------------- data validation --

const KINDS = [
  { value: "any", label: "Jeden Wert" },
  { value: "whole", label: "Ganze Zahl" },
  { value: "decimal", label: "Dezimal" },
  { value: "list", label: "Liste" },
  { value: "date", label: "Datum" },
  { value: "time", label: "Zeit" },
  { value: "textLength", label: "Textlänge" },
  { value: "custom", label: "Benutzerdefiniert" },
];
const OPERATORS = [
  { value: "between", label: "zwischen" },
  { value: "notBetween", label: "nicht zwischen" },
  { value: "equal", label: "gleich" },
  { value: "notEqual", label: "ungleich" },
  { value: "greaterThan", label: "größer als" },
  { value: "lessThan", label: "kleiner als" },
  { value: "greaterThanOrEqual", label: "größer oder gleich" },
  { value: "lessThanOrEqual", label: "kleiner oder gleich" },
];
const STYLES = [
  { value: "stop", label: "Stopp" },
  { value: "warning", label: "Warnung" },
  { value: "information", label: "Information" },
];

/** Stored operand → text in the dialog (numbers German, formulas with "="). */
function showOperand(f: string | undefined): string {
  if (f === undefined) return "";
  if (/^-?\d+(\.\d+)?$/.test(f)) return f.replace(".", ",");
  return `=${toDisplayFormula(f)}`;
}

export function ValidationDialog(p: { open: boolean; initial: Validation | null; range: string; onClose: () => void; onApply: (v: Validation | null) => void }) {
  const [kind, setKind] = useState("any");
  const [op, setOp] = useState("between");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [blank, setBlank] = useState(true);
  const [dropdown, setDropdown] = useState(true);
  const [promptTitle, setPromptTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [errStyle, setErrStyle] = useState("stop");
  const [errTitle, setErrTitle] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!p.open) return;
    const v = p.initial;
    setKind(v?.kind ?? "any");
    setOp(v?.operator ?? "between");
    const list = v?.kind === "list" && v.formulas?.[0]?.startsWith('"');
    setA(list ? v!.formulas![0].slice(1, -1).replace(/,/g, "; ") : showOperand(v?.formulas?.[0]));
    setB(showOperand(v?.formulas?.[1]));
    setBlank(v?.allowBlank ?? true);
    setDropdown(!v?.hideDropdown);
    setPromptTitle(v?.promptTitle ?? "");
    setPrompt(v?.prompt ?? "");
    setErrStyle(v?.errorStyle ?? "stop");
    setErrTitle(v?.errorTitle ?? "");
    setErr(v?.error ?? "");
  }, [p.open, p.initial]);
  const needsOp = ["whole", "decimal", "date", "time", "textLength"].includes(kind);
  const two = needsOp && (op === "between" || op === "notBetween");
  const apply = () => {
    if (kind === "any" && !prompt.trim()) {
      p.onApply(null);
      return p.onClose();
    }
    const formulas: string[] = [];
    if (kind === "list") {
      const t = a.trim();
      formulas.push(t.startsWith("=") ? fromDisplayFormula(t.slice(1)) : `"${t.split(/[;,]/).map((x) => x.trim()).filter(Boolean).join(",")}"`);
    } else if (kind === "custom") formulas.push(fromDisplayFormula(a.replace(/^=/, "")));
    else if (needsOp) {
      formulas.push(operand(a).replace(/^"(.*)"$/, "$1"));
      if (two) formulas.push(operand(b).replace(/^"(.*)"$/, "$1"));
    }
    p.onApply({
      ranges: [],
      kind: kind === "any" ? "none" : kind,
      operator: needsOp ? op : undefined,
      formulas,
      allowBlank: blank,
      hideDropdown: kind === "list" && !dropdown ? true : undefined,
      errorStyle: errStyle === "stop" ? undefined : errStyle,
      errorTitle: errTitle.trim() || undefined,
      error: err.trim() || undefined,
      promptTitle: promptTitle.trim() || undefined,
      prompt: prompt.trim() || undefined,
    });
    p.onClose();
  };
  const pick = (list: { value: string; label: string }[], value: string, set: (v: string) => void) => (
    <Dropdown value={list.find((x) => x.value === value)?.label ?? ""} selectedOptions={[value]} onOptionSelect={(_, d) => d.optionValue && set(d.optionValue)}>
      {list.map((x) => (
        <Option key={x.value} value={x.value}>
          {x.label}
        </Option>
      ))}
    </Dropdown>
  );
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>Datenüberprüfung – {p.range}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Zulassen">{pick(KINDS, kind, setKind)}</Field>
            {needsOp && <Field label="Daten">{pick(OPERATORS, op, setOp)}</Field>}
            {kind === "list" && (
              <Field label="Quelle" hint="Einträge mit Semikolon getrennt, oder ein Bereich wie =$E$2:$E$9">
                <Input value={a} onChange={(_, d) => setA(d.value)} placeholder="Offen; In Arbeit; Erledigt" />
              </Field>
            )}
            {kind === "custom" && (
              <Field label="Formel">
                <Input value={a} onChange={(_, d) => setA(d.value)} placeholder="=LÄNGE(A2)<=10" />
              </Field>
            )}
            {needsOp && (
              <div style={{ display: "flex", gap: 8 }}>
                <Field label={two ? "Minimum" : "Wert"} style={{ flex: 1 }}>
                  <Input value={a} onChange={(_, d) => setA(d.value)} />
                </Field>
                {two && (
                  <Field label="Maximum" style={{ flex: 1 }}>
                    <Input value={b} onChange={(_, d) => setB(d.value)} />
                  </Field>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 16 }}>
              <Checkbox label="Leere Zellen zulassen" checked={blank} onChange={(_, d) => setBlank(!!d.checked)} />
              {kind === "list" && <Checkbox label="Zellendropdown" checked={dropdown} onChange={(_, d) => setDropdown(!!d.checked)} />}
            </div>
            <Text weight="semibold">Eingabemeldung</Text>
            <div style={{ display: "flex", gap: 8 }}>
              <Input placeholder="Titel" value={promptTitle} onChange={(_, d) => setPromptTitle(d.value)} style={{ flex: 1 }} />
              <Input placeholder="Meldung" value={prompt} onChange={(_, d) => setPrompt(d.value)} style={{ flex: 2 }} />
            </div>
            <Text weight="semibold">Fehlermeldung</Text>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 140 }}>{pick(STYLES, errStyle, setErrStyle)}</div>
              <Input placeholder="Titel" value={errTitle} onChange={(_, d) => setErrTitle(d.value)} style={{ flex: 1 }} />
              <Input placeholder="Meldung" value={err} onChange={(_, d) => setErr(d.value)} style={{ flex: 2 }} />
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={apply}>
              OK
            </Button>
            <Button onClick={() => (p.onApply(null), p.onClose())}>Alle löschen</Button>
            <Button onClick={p.onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ pivot table --

export function PivotDialog(p: {
  open: boolean;
  range: string;
  headers: string[];
  numeric?: boolean[];
  /** Columns with dates (offer grouping). */
  dates?: boolean[];
  /** Row items of a field (with the grouping applied). */
  itemsOf?: (col: number, group?: PivotGroup) => { label: string | number; key: string; text: string }[];
  onClose: () => void;
  onApply: (rowCol: number, colCol: number | null, valCol: number, agg: PivotAgg, opts: PivotOptions) => void;
}) {
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(-1);
  const [val, setVal] = useState(1);
  const [agg, setAgg] = useState<PivotAgg>("SUM");
  const [group, setGroup] = useState<PivotGroup | "">("");
  const [filterCol, setFilterCol] = useState(-1);
  const [filterValue, setFilterValue] = useState("(Alle)");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!p.open) return;
    setRow(0);
    setCol(-1);
    // Values: the first numeric column after the row field, else the last column.
    const firstNumeric = p.numeric?.findIndex((n, i) => n && i > 0) ?? -1;
    setVal(firstNumeric > 0 ? firstNumeric : Math.max(0, p.headers.length - 1));
    setAgg("SUM");
    setGroup("");
    setFilterCol(-1);
    setFilterValue("(Alle)");
    setHidden(new Set());
  }, [p.open, p.headers.length, p.numeric]);
  const isDate = !!p.dates?.[row];
  const effGroup = isDate && group ? group : undefined;
  const items = useMemo(() => (p.open && p.itemsOf ? p.itemsOf(row, effGroup) : []), [p, row, effGroup]);
  const filterItems = useMemo(() => (p.open && p.itemsOf && filterCol >= 0 ? p.itemsOf(filterCol) : []), [p, filterCol]);
  const field = (value: number, set: (n: number) => void, none?: boolean) => (
    <Dropdown value={value < 0 ? "(keine)" : p.headers[value] ?? ""} selectedOptions={[String(value)]} onOptionSelect={(_, d) => set(Number(d.optionValue))}>
      {none && <Option value="-1">(keine)</Option>}
      {p.headers.map((h, i) => (
        <Option key={i} value={String(i)}>
          {h}
        </Option>
      ))}
    </Dropdown>
  );
  const toggle = (k: string, on: boolean) =>
    setHidden((h) => {
      const n = new Set(h);
      if (on) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>PivotTable erstellen</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Text>Quelle: {p.range} (erste Zeile = Überschriften). Die PivotTable wird auf einem neuen Blatt mit Formeln angelegt und rechnet bei Änderungen mit.</Text>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Zeilen">{field(row, (n) => (setRow(n), setHidden(new Set()), setGroup("")))}</Field>
              <Field label="Gruppieren" hint={isDate ? undefined : "Nur für Datumsspalten"}>
                <Dropdown
                  disabled={!isDate}
                  value={{ "": "Nicht gruppieren", month: "Monate", quarter: "Quartale", year: "Jahre" }[group]}
                  selectedOptions={[group]}
                  onOptionSelect={(_, d) => (setGroup((d.optionValue ?? "") as PivotGroup | ""), setHidden(new Set()))}
                >
                  <Option value="">Nicht gruppieren</Option>
                  <Option value="month">Monate</Option>
                  <Option value="quarter">Quartale</Option>
                  <Option value="year">Jahre</Option>
                </Dropdown>
              </Field>
              <Field label="Spalten">{field(col, setCol, true)}</Field>
              <Field label="Werte">{field(val, setVal)}</Field>
              <Field label="Zusammenfassen mit">
                <Dropdown value={PIVOT_AGGS.find((x) => x.fn === agg)!.label} selectedOptions={[agg]} onOptionSelect={(_, d) => setAgg(d.optionValue as PivotAgg)}>
                  {PIVOT_AGGS.map((x) => (
                    <Option key={x.fn} value={x.fn}>
                      {x.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <div />
              <Field label="Filter">{field(filterCol, (n) => (setFilterCol(n), setFilterValue("(Alle)")), true)}</Field>
              <Field label="Filterwert">
                <Dropdown disabled={filterCol < 0} value={filterValue} selectedOptions={[filterValue]} onOptionSelect={(_, d) => setFilterValue(d.optionValue ?? "(Alle)")}>
                  <Option value="(Alle)">(Alle)</Option>
                  {filterItems.map((it) => (
                    <Option key={it.key} value={String(it.label)} text={it.text}>
                      {it.text}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            </div>
            {/* Not a Field: it would tie its label to the first checkbox. */}
            <div>
              <Text weight="semibold" size={300}>{`Angezeigte Zeilen (${items.length - items.filter((i) => hidden.has(i.key)).length} von ${items.length})`}</Text>
              <div style={{ maxHeight: 150, overflow: "auto", border: "1px solid var(--colorNeutralStroke2)", borderRadius: 4, padding: "2px 6px" }}>
                <Checkbox label="(Alle)" checked={hidden.size === 0 ? true : hidden.size === items.length ? false : "mixed"} onChange={(_, d) => setHidden(d.checked ? new Set() : new Set(items.map((i) => i.key)))} />
                {items.map((it) => (
                  <div key={it.key}>
                    <Checkbox label={it.text} checked={!hidden.has(it.key)} onChange={(_, d) => toggle(it.key, !!d.checked)} />
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={!p.headers.length || (items.length > 0 && hidden.size === items.length)}
              onClick={() => (
                p.onApply(row, col < 0 ? null : col, val, agg, {
                  group: effGroup,
                  filterCol: filterCol >= 0 ? filterCol : undefined,
                  filterValue: filterCol >= 0 ? filterValue : undefined,
                  hidden: [...hidden],
                }),
                p.onClose()
              )}
            >
              OK
            </Button>
            <Button onClick={p.onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// -------------------------------------------------------------- sparklines --

export function SparklineDialog(p: { kind: string | null; data: string; location: string; onClose: () => void; onApply: (data: string, location: string) => void }) {
  const [data, setData] = useState(p.data);
  const [loc, setLoc] = useState(p.location);
  useEffect(() => {
    setData(p.data);
    setLoc(p.location);
  }, [p.kind, p.data, p.location]);
  if (!p.kind) return null;
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 440 }}>
        <DialogBody>
          <DialogTitle>Sparklines erstellen ({p.kind === "line" ? "Linie" : p.kind === "column" ? "Säule" : "Gewinn/Verlust"})</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Datenbereich" hint="Eine Sparkline je Zeile des Bereichs">
              <Input value={data} onChange={(_, d) => setData(d.value)} />
            </Field>
            <Field label="Positionsbereich" hint="Eine Spalte mit so vielen Zellen wie der Datenbereich Zeilen hat">
              <Input value={loc} onChange={(_, d) => setLoc(d.value)} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (p.onApply(data, loc), p.onClose())}>
              OK
            </Button>
            <Button onClick={p.onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
