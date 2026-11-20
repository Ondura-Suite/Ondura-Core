// Dialogs for text to columns and step-by-step formula evaluation.

import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Option, Radio, RadioGroup, tokens } from "@fluentui/react-components";
import { type SplitOptions, guessBreaks, splitText } from "./dataTools";
import { toDisplayFormula } from "./formula";
import { tl } from "../../lib/i18n";

const DELIMS: [string, string][] = [
  ["\t", tl("Tabstopp")],
  [";", tl("Semikolon")],
  [",", tl("Komma")],
  [" ", tl("Leerzeichen")],
];

export function TextToColumnsDialog(p: { open: boolean; lines: string[]; destination: string; onClose: () => void; onApply: (o: SplitOptions, destination: string) => string | null }) {
  const [o, setO] = useState<SplitOptions>({ mode: "delimited", delimiters: [";"], merge: false, quote: '"', breaks: [] });
  const [other, setOther] = useState("");
  const [breaks, setBreaks] = useState("");
  const [dest, setDest] = useState(p.destination);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!p.open) return;
    setDest(p.destination);
    setError(null);
    // Guess the delimiter: the most frequent candidate.
    const sample = p.lines.slice(0, 20).join("\n");
    const best = ["\t", ";", ",", " "].map((d) => [d, sample.split(d).length - 1] as const).sort((a, b) => b[1] - a[1])[0];
    setO((x) => ({ ...x, delimiters: best && best[1] > 0 ? [best[0]] : [";"] }));
    setBreaks(guessBreaks(p.lines.slice(0, 20)).join(", "));
  }, [p.open, p.destination, p.lines]);
  const opts: SplitOptions = useMemo(
    () => ({
      ...o,
      delimiters: [...o.delimiters, ...other.split("")],
      breaks: breaks
        .split(/[,;\s]+/)
        .map(Number)
        .filter((n) => n > 0),
    }),
    [o, other, breaks],
  );
  if (!p.open) return null;
  const preview = p.lines.slice(0, 6).map((l) => splitText(l, opts));
  const cols = Math.max(1, ...preview.map((r) => r.length));
  const toggle = (d: string, on: boolean) => setO((x) => ({ ...x, delimiters: on ? [...x.delimiters, d] : x.delimiters.filter((y) => y !== d) }));
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 600, width: 600 }}>
        <DialogBody>
          <DialogTitle>{tl("Text in Spalten")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label={tl("Ursprünglicher Datentyp")}>
              <RadioGroup layout="horizontal" value={o.mode} onChange={(_, d) => setO((x) => ({ ...x, mode: d.value as SplitOptions["mode"] }))}>
                <Radio value="delimited" label={tl("Getrennt (Zeichen wie Komma oder Tabstopp)")} />
                <Radio value="fixed" label={tl("Feste Breite")} />
              </RadioGroup>
            </Field>
            {o.mode === "delimited" ? (
              <>
                <Field label={tl("Trennzeichen")}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                    {DELIMS.map(([d, label]) => (
                      <Checkbox key={label} label={label} checked={o.delimiters.includes(d)} onChange={(_, e) => toggle(d, !!e.checked)} />
                    ))}
                    <span>{tl("Andere:")}</span>
                    <Input value={other} maxLength={3} style={{ width: 60 }} onChange={(_, d) => setOther(d.value)} />
                  </div>
                </Field>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Checkbox label={tl("Aufeinanderfolgende Trennzeichen als ein Zeichen behandeln")} checked={o.merge} onChange={(_, d) => setO((x) => ({ ...x, merge: !!d.checked }))} />
                  <span>{tl("Textqualifizierer:")}</span>
                  <Dropdown style={{ minWidth: 80 }} value={o.quote || tl("{keine}")} selectedOptions={[o.quote]} onOptionSelect={(_, d) => setO((x) => ({ ...x, quote: (d.optionValue ?? "") as SplitOptions["quote"] }))}>
                    <Option value={'"'}>"</Option>
                    <Option value="'">'</Option>
                    <Option value="" text={tl("{keine}")}>
                      {tl("{keine}")}
                    </Option>
                  </Dropdown>
                </div>
              </>
            ) : (
              <Field label={tl("Spaltenumbrüche (Zeichenpositionen)")} hint={tl("Zum Beispiel 10, 25")}>
                <Input value={breaks} onChange={(_, d) => setBreaks(d.value)} />
              </Field>
            )}
            <Field label={tl("Datenvorschau")}>
              <div style={{ maxHeight: 150, overflow: "auto", border: `1px solid ${tokens.colorNeutralStroke1}`, fontFamily: "Consolas, monospace", fontSize: 12 }}>
                <table style={{ borderCollapse: "collapse" }}>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i}>
                        {Array.from({ length: cols }, (_, c) => (
                          <td key={c} style={{ borderRight: `1px solid ${tokens.colorNeutralStroke2}`, padding: "1px 6px", whiteSpace: "pre" }}>
                            {r[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Field>
            <Field label={tl("Ziel")} validationMessage={error ?? undefined}>
              <Input value={dest} onChange={(_, d) => setDest(d.value)} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={p.onClose}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" onClick={() => setError(p.onApply(opts, dest))}>
              {tl("Fertig stellen")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** "Formel auswerten": shows the formula, then each step of its evaluation. */
export function EvaluateDialog(p: { open: boolean; cell: string; formula: string; step: (expr: string) => { expr: string; done: boolean }; onClose: () => void }) {
  const [history, setHistory] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (p.open) (setHistory([p.formula]), setDone(false));
  }, [p.open, p.formula]);
  if (!p.open) return null;
  const cur = history[history.length - 1] ?? p.formula;
  const next = () => {
    const r = p.step(cur);
    setHistory((h) => [...h, r.expr]);
    setDone(r.done);
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Formel auswerten –")} {p.cell}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Field label={tl("Auswertung")}>
              <div style={{ border: `1px solid ${tokens.colorNeutralStroke1}`, padding: 8, minHeight: 90, maxHeight: 220, overflow: "auto", fontFamily: "Consolas, monospace", fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                {history.map((h, i) => (
                  <div key={i} style={{ color: i === history.length - 1 ? tokens.colorNeutralForeground1 : tokens.colorNeutralForeground3, fontWeight: i === history.length - 1 ? 600 : 400, wordBreak: "break-all" }}>
                    {i === 0 || !done || i < history.length - 1 ? "=" : "= "}
                    {toDisplayFormula(h)}
                  </div>
                ))}
              </div>
            </Field>
            <span style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>{tl("Mit „Auswerten“ wird zuerst jeder Zellbezug durch seinen Wert ersetzt, dann die innerste Funktion berechnet.")}</span>
          </DialogContent>
          <DialogActions>
            {done ? (
              <Button onClick={() => (setHistory([p.formula]), setDone(false))}>{tl("Neu starten")}</Button>
            ) : (
              <Button appearance="primary" onClick={next}>
                {tl("Auswerten")}
              </Button>
            )}
            <Button onClick={p.onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
