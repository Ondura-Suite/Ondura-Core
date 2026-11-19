// Dialogs of Ondura Text for formulas, shapes, page design, editing
// restrictions, envelopes and labels.

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
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  SpinButton,
  Switch,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Block, PageBorder, PageSetup, Protection, ShapeKind, TextDocument, Watermark } from "./model";
import { A4, emptyDocument } from "./model";
import { latexToMathml } from "./math";
import type { ShapeAttrs } from "./layout";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  col: { display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  preview: {
    minHeight: "64px",
    padding: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: "#fff",
    color: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    overflowX: "auto",
  },
  chips: { display: "flex", gap: "4px", flexWrap: "wrap" },
  swatches: { display: "grid", gridTemplateColumns: "repeat(10, 22px)", gap: "4px" },
  swatch: { width: "22px", height: "22px", borderRadius: "4px", border: `1px solid ${tokens.colorNeutralStroke1}`, cursor: "pointer", padding: 0 },
});

// ---------------------------------------------------------------- formula

const MATH_SNIPPETS: [string, string][] = [
  ["\\frac{a}{b}", "a/b"],
  ["x^{2}", "x²"],
  ["x_{i}", "xᵢ"],
  ["\\sqrt{x}", "√x"],
  ["\\sqrt[n]{x}", "ⁿ√x"],
  ["\\sum_{i=1}^{n} i", "∑"],
  ["\\int_{a}^{b} f(x) dx", "∫"],
  ["\\prod_{k=1}^{n} k", "∏"],
  ["\\left( x \\right)", "( )"],
  ["\\alpha \\beta \\gamma \\pi", "α β"],
  ["\\leq \\geq \\neq \\approx", "≤ ≠"],
  ["\\pm \\times \\cdot \\infty", "± ∞"],
];

export function MathDialog({
  open,
  initial,
  initialDisplay,
  onClose,
  onInsert,
}: {
  open: boolean;
  initial: string;
  initialDisplay: boolean;
  onClose: () => void;
  onInsert: (latex: string, display: boolean) => void;
}) {
  const s = useStyles();
  const [latex, setLatex] = useState(initial);
  const [display, setDisplay] = useState(initialDisplay);
  useEffect(() => {
    if (open) {
      setLatex(initial || "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
      setDisplay(initialDisplay);
    }
  }, [open, initial, initialDisplay]);
  const html = useMemo(() => {
    try {
      return latexToMathml(latex, display);
    } catch {
      return "";
    }
  }, [latex, display]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 620 }}>
        <DialogBody>
          <DialogTitle>{tl("Formel")}</DialogTitle>
          <DialogContent className={s.col}>
            <div className={s.chips}>
              {MATH_SNIPPETS.map(([code, label]) => (
                <Button key={code} size="small" onClick={() => setLatex((l) => (l.trim() ? `${l} ${code}` : code))}>
                  {label}
                </Button>
              ))}
            </div>
            <Field label={tl("Formel (LaTeX-Schreibweise)")} hint={tl("z. B. \\frac{a}{b}, x^{2}, \\sqrt{x}, \\sum_{i=1}^{n}, \\alpha")}>
              <Textarea value={latex} onChange={(_, d) => setLatex(d.value)} rows={3} style={{ fontFamily: "Consolas, monospace" }} />
            </Field>
            <div className={s.preview} dangerouslySetInnerHTML={{ __html: html }} />
            <Switch checked={display} onChange={(_, d) => setDisplay(d.checked)} label={tl("Als eigene Zeile (zentriert)")} />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!latex.trim()} onClick={() => (onInsert(latex.trim(), display), onClose())}>
              {tl("Einfügen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------------ shape

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "rect", label: tl("Rechteck") },
  { kind: "roundRect", label: tl("Abgerundetes Rechteck") },
  { kind: "ellipse", label: tl("Ellipse") },
  { kind: "triangle", label: tl("Dreieck") },
  { kind: "rightArrow", label: tl("Pfeil nach rechts") },
  { kind: "star5", label: tl("Stern") },
  { kind: "line", label: tl("Linie") },
  { kind: "textBox", label: tl("Textfeld") },
];

const PALETTE = ["#ffffff", "#f2f2f2", "#d9d9d9", "#808080", "#000000", "#dae3f3", "#4472c4", "#2f5597", "#fbe5d6", "#ed7d31", "#e2f0d9", "#70ad47", "#fff2cc", "#ffc000", "#fce4ec", "#c00000", "#ede7f6", "#7030a0", "#e0f7fa", "#00b0f0"];

function Colors({ value, onChange, none }: { value: string | null; onChange: (c: string | null) => void; none?: string }) {
  const s = useStyles();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className={s.swatches}>
        {PALETTE.map((c) => (
          <button key={c} className={s.swatch} style={{ background: c, outline: value === c ? `2px solid ${tokens.colorBrandStroke1}` : undefined }} aria-label={c} onClick={() => onChange(c)} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" value={value ?? "#ffffff"} onChange={(e) => onChange(e.target.value)} aria-label={tl("Weitere Farben")} />
        {none && (
          <Button size="small" appearance={value === null ? "primary" : "secondary"} onClick={() => onChange(null)}>
            {none}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ShapeDialog({ open, initial, onClose, onApply }: { open: boolean; initial: ShapeAttrs | null; onClose: () => void; onApply: (a: ShapeAttrs) => void }) {
  const s = useStyles();
  const [a, setA] = useState<ShapeAttrs>(initial ?? { kind: "rect", widthMm: 40, heightMm: 25, fill: "#dae3f3", line: "#2f5597", text: "", wrap: "inline" });
  useEffect(() => {
    if (open && initial) setA(initial);
  }, [open, initial]);
  const set = (p: Partial<ShapeAttrs>) => setA((x) => ({ ...x, ...p }));
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{a.kind === "textBox" ? tl("Textfeld") : tl("Form formatieren")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Form")}>
              <Dropdown value={SHAPES.find((x) => x.kind === a.kind)?.label ?? ""} selectedOptions={[a.kind]} onOptionSelect={(_, d) => set({ kind: d.optionValue as ShapeKind })}>
                {SHAPES.map((x) => (
                  <Option key={x.kind} value={x.kind}>{x.label}</Option>
                ))}
              </Dropdown>
            </Field>
            <div className={s.row}>
              <Field label={tl("Breite (mm)")}>
                <SpinButton value={a.widthMm} min={2} max={400} onChange={(_, d) => set({ widthMm: Number(d.value ?? d.displayValue) || a.widthMm })} />
              </Field>
              <Field label={tl("Höhe (mm)")}>
                <SpinButton value={a.heightMm} min={1} max={400} onChange={(_, d) => set({ heightMm: Number(d.value ?? d.displayValue) || a.heightMm })} />
              </Field>
            </div>
            <Field label={tl("Text")}>
              <Textarea value={a.text} onChange={(_, d) => set({ text: d.value })} rows={2} />
            </Field>
            <Field label={tl("Füllung")}>
              <Colors value={a.fill} onChange={(fill) => set({ fill })} none={tl("Keine Füllung")} />
            </Field>
            <Field label={tl("Kontur")}>
              <Colors value={a.line} onChange={(line) => set({ line })} none={tl("Keine Kontur")} />
            </Field>
            <Field label={tl("Textumbruch")}>
              <RadioGroup layout="horizontal" value={a.wrap} onChange={(_, d) => set({ wrap: d.value as ShapeAttrs["wrap"] })}>
                <Radio value="inline" label={tl("Mit Text in Zeile")} />
                <Radio value="left" label={tl("Links, Text umfließt")} />
                <Radio value="right" label={tl("Rechts, Text umfließt")} />
              </RadioGroup>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(a), onClose())}>{tl("OK")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ page design

export interface PageDesign {
  pageColor: string | null;
  pageBorder: PageBorder | null;
  watermark: Watermark | null;
}

const WATERMARKS = [tl("ENTWURF"), tl("VERTRAULICH"), tl("MUSTER"), tl("DRINGEND"), tl("KOPIE")];

export function DesignDialog({ kind, value, onClose, onApply }: { kind: "color" | "border" | "watermark" | null; value: PageDesign; onClose: () => void; onApply: (v: PageDesign) => void }) {
  const s = useStyles();
  const [v, setV] = useState(value);
  useEffect(() => {
    if (kind) setV(value);
  }, [kind, value]);
  const border = v.pageBorder ?? { style: "single", color: "#000000", widthPt: 0.5 };
  const wm = v.watermark ?? { text: WATERMARKS[0], color: "#c0c0c0", diagonal: true };
  return (
    <Dialog open={!!kind} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{kind === "color" ? tl("Seitenfarbe") : kind === "border" ? tl("Seitenränder (Rahmen)") : tl("Wasserzeichen")}</DialogTitle>
          <DialogContent className={s.col}>
            {kind === "color" && <Colors value={v.pageColor} onChange={(pageColor) => setV({ ...v, pageColor })} none={tl("Keine Farbe")} />}
            {kind === "border" && (
              <>
                <Switch checked={!!v.pageBorder} onChange={(_, d) => setV({ ...v, pageBorder: d.checked ? border : null })} label={tl("Rahmen um jede Seite")} />
                {v.pageBorder && (
                  <>
                    <Field label={tl("Linie")}>
                      <Dropdown
                        value={{ single: tl("Einfach"), double: tl("Doppelt"), dotted: tl("Gepunktet"), dashed: tl("Gestrichelt"), thick: tl("Dick") }[border.style]}
                        selectedOptions={[border.style]}
                        onOptionSelect={(_, d) => setV({ ...v, pageBorder: { ...border, style: d.optionValue as PageBorder["style"] } })}
                      >
                        <Option value="single">{tl("Einfach")}</Option>
                        <Option value="double">{tl("Doppelt")}</Option>
                        <Option value="dotted">{tl("Gepunktet")}</Option>
                        <Option value="dashed">{tl("Gestrichelt")}</Option>
                        <Option value="thick">{tl("Dick")}</Option>
                      </Dropdown>
                    </Field>
                    <Field label={tl("Breite (pt)")}>
                      <SpinButton value={border.widthPt} min={0.25} max={6} step={0.25} onChange={(_, d) => setV({ ...v, pageBorder: { ...border, widthPt: Number(d.value ?? d.displayValue) || border.widthPt } })} />
                    </Field>
                    <Field label={tl("Farbe")}>
                      <Colors value={border.color} onChange={(c) => setV({ ...v, pageBorder: { ...border, color: c ?? "#000000" } })} />
                    </Field>
                  </>
                )}
              </>
            )}
            {kind === "watermark" && (
              <>
                <Switch checked={!!v.watermark} onChange={(_, d) => setV({ ...v, watermark: d.checked ? wm : null })} label={tl("Textwasserzeichen")} />
                {v.watermark && (
                  <>
                    <Field label={tl("Text")}>
                      <Input list="nx-watermarks" value={wm.text} onChange={(_, d) => setV({ ...v, watermark: { ...wm, text: d.value } })} />
                      <datalist id="nx-watermarks">
                        {WATERMARKS.map((w) => (
                          <option key={w} value={w} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label={tl("Farbe")}>
                      <Colors value={wm.color} onChange={(c) => setV({ ...v, watermark: { ...wm, color: c ?? "#c0c0c0" } })} />
                    </Field>
                    <Checkbox checked={wm.diagonal} onChange={(_, d) => setV({ ...v, watermark: { ...wm, diagonal: !!d.checked } })} label={tl("Diagonal")} />
                  </>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(v), onClose())}>{tl("OK")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Sheet background, border and watermark (for each page in the editor). */
export function sheetDecoration(d: PageDesign): { style: React.CSSProperties; watermark: React.ReactNode } {
  const style: React.CSSProperties = {};
  if (d.pageColor) style.background = d.pageColor;
  if (d.pageBorder) {
    const b = d.pageBorder;
    const css = { single: "solid", double: "double", dotted: "dotted", dashed: "dashed", thick: "solid" }[b.style];
    const w = b.style === "double" ? Math.max(3, b.widthPt * 3) : b.style === "thick" ? Math.max(2.5, b.widthPt * 2) : b.widthPt;
    style.outline = `${w}pt ${css} ${b.color}`;
    style.outlineOffset = "-24pt";
  }
  const watermark = d.watermark ? (
    <div className="nx-sheet-watermark">
      <span style={{ color: d.watermark.color, transform: d.watermark.diagonal ? "rotate(-45deg)" : undefined }}>{d.watermark.text}</span>
    </div>
  ) : null;
  return { style, watermark };
}

// ---------------------------------------------------------- restrictions

export const PROTECTION_LABEL: Record<Protection["edit"], string> = {
  readOnly: tl("Keine Änderungen (schreibgeschützt)"),
  comments: tl("Nur Kommentare"),
  trackedChanges: tl("Nur nachverfolgte Änderungen"),
  forms: tl("Nur Formulare ausfüllen"),
};

export function ProtectDialog({
  open,
  protection,
  onClose,
  onStart,
  onStop,
}: {
  open: boolean;
  protection: Protection | null;
  onClose: () => void;
  onStart: (p: Protection) => void;
  onStop: (password: string) => Promise<boolean>;
}) {
  const s = useStyles();
  const [edit, setEdit] = useState<Protection["edit"]>("readOnly");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPw("");
      setPw2("");
      setError(null);
      setEdit(protection?.edit ?? "readOnly");
    }
  }, [open, protection]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Bearbeitung einschränken")}</DialogTitle>
          <DialogContent className={s.col}>
            {protection ? (
              <>
                <Text>{tl("Das Dokument ist geschützt: {0}.", PROTECTION_LABEL[protection.edit])}</Text>
                {(protection.hash || protection.password) && (
                  <Field label={tl("Kennwort")}>
                    <Input type="password" value={pw} onChange={(_, d) => setPw(d.value)} autoFocus />
                  </Field>
                )}
              </>
            ) : (
              <>
                <Field label={tl("Erlaubt sind")}>
                  <RadioGroup value={edit} onChange={(_, d) => setEdit(d.value as Protection["edit"])}>
                    {(Object.keys(PROTECTION_LABEL) as Protection["edit"][]).map((k) => (
                      <Radio key={k} value={k} label={PROTECTION_LABEL[k]} />
                    ))}
                  </RadioGroup>
                </Field>
                <Field label={tl("Kennwort (optional)")}>
                  <Input type="password" value={pw} onChange={(_, d) => setPw(d.value)} />
                </Field>
                <Field label={tl("Kennwort bestätigen")} validationMessage={pw2 && pw !== pw2 ? tl("Die Kennwörter stimmen nicht überein.") : undefined}>
                  <Input type="password" value={pw2} onChange={(_, d) => setPw2(d.value)} />
                </Field>
              </>
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            {protection ? (
              <Button
                appearance="primary"
                onClick={async () => {
                  if (await onStop(pw)) onClose();
                  else setError(tl("Das Kennwort ist falsch."));
                }}
              >
                {tl("Schutz aufheben")}
              </Button>
            ) : (
              <Button appearance="primary" disabled={pw !== pw2} onClick={() => (onStart({ edit, password: pw || null }), onClose())}>
                {tl("Schutz aktivieren")}
              </Button>
            )}
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// -------------------------------------------------------------- envelopes

const ENVELOPES: { id: string; label: string; w: number; h: number }[] = [
  { id: "DL", label: tl("DL (220 × 110 mm)"), w: 220, h: 110 },
  { id: "C5", label: tl("C5 (229 × 162 mm)"), w: 229, h: 162 },
  { id: "C6", label: tl("C6 (162 × 114 mm)"), w: 162, h: 114 },
  { id: "C4", label: tl("C4 (324 × 229 mm)"), w: 324, h: 229 },
];

const para = (text: string, extra: Record<string, unknown> = {}): Block => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [], spaceAfterPt: 0, ...extra });

/** A document with one envelope page (sender top left, recipient in the window position). */
export function envelopeDocument(size: string, sender: string, recipient: string): TextDocument {
  const e = ENVELOPES.find((x) => x.id === size) ?? ENVELOPES[0];
  const page: PageSetup = { ...A4, widthMm: e.w, heightMm: e.h, marginTopMm: 12, marginLeftMm: 15, marginRightMm: 15, marginBottomMm: 10, headerMm: 5, footerMm: 5 };
  const doc = emptyDocument();
  doc.page = page;
  doc.title = tl("Umschlag");
  const top = sender.split("\n").map((l) => para(l, { content: l ? [{ type: "text", text: l, marks: { size: 9 } }] : [] }));
  const gap = Math.max(4, Math.round((e.h - 40) / 10));
  const spacer = Array.from({ length: gap }, () => para(""));
  const indent = Math.round(e.w * 0.45);
  const addr = recipient.split("\n").map((l) => para(l, { indentMm: indent, content: l ? [{ type: "text", text: l, marks: { size: 12 } }] : [] }));
  doc.blocks = [...top, ...spacer, ...addr];
  return doc;
}

export function EnvelopeDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (d: TextDocument) => void }) {
  const s = useStyles();
  const [size, setSize] = useState("DL");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Umschlag")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Empfänger")}>
              <Textarea value={recipient} onChange={(_, d) => setRecipient(d.value)} rows={4} placeholder={tl("Name\nStraße Nr.\nPLZ Ort")} />
            </Field>
            <Field label={tl("Absender")}>
              <Textarea value={sender} onChange={(_, d) => setSender(d.value)} rows={3} />
            </Field>
            <Field label={tl("Format")}>
              <Dropdown value={ENVELOPES.find((e) => e.id === size)?.label} selectedOptions={[size]} onOptionSelect={(_, d) => setSize(d.optionValue ?? "DL")}>
                {ENVELOPES.map((e) => (
                  <Option key={e.id} value={e.id}>{e.label}</Option>
                ))}
              </Dropdown>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!recipient.trim()} onClick={() => (onCreate(envelopeDocument(size, sender, recipient)), onClose())}>
              {tl("Umschlag erstellen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Common label sheets on A4 (Avery Zweckform and compatible). */
const LABELS: { id: string; label: string; cols: number; rows: number; w: number; h: number; top: number; left: number }[] = [
  { id: "3474", label: "Zweckform 3474 – 70 × 37 mm (24)", cols: 3, rows: 8, w: 70, h: 37, top: 0, left: 0 },
  { id: "3422", label: "Zweckform 3422 – 70 × 35 mm (24)", cols: 3, rows: 8, w: 70, h: 35, top: 8.5, left: 0 },
  { id: "3475", label: "Zweckform 3475 – 70 × 36 mm (24)", cols: 3, rows: 8, w: 70, h: 36, top: 4.5, left: 0 },
  { id: "3490", label: "Zweckform 3490 – 70 × 36 mm (24)", cols: 3, rows: 8, w: 70, h: 36, top: 4.5, left: 0 },
  { id: "3425", label: "Zweckform 3425 – 105 × 57 mm (10)", cols: 2, rows: 5, w: 105, h: 57, top: 6, left: 0 },
  { id: "L7163", label: "Avery L7163 – 99,1 × 38,1 mm (14)", cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.1, left: 4.65 },
  { id: "L7160", label: "Avery L7160 – 63,5 × 38,1 mm (21)", cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.1, left: 7.2 },
];

/** A page of identical labels as a table with fixed cell sizes. */
export function labelsDocument(id: string, text: string): TextDocument {
  const l = LABELS.find((x) => x.id === id) ?? LABELS[0];
  const doc = emptyDocument();
  doc.title = tl("Etiketten");
  doc.page = { ...A4, marginTopMm: Math.max(l.top, 0.1), marginBottomMm: 0.1, marginLeftMm: Math.max(l.left, 0.1), marginRightMm: 0.1, headerMm: 0, footerMm: 0 };
  const lines = text.split("\n");
  const cell = () => ({
    colSpan: 1,
    rowSpan: 1,
    blocks: lines.map((t) => para(t, { indentMm: 4, spaceBeforePt: 0 })),
  });
  doc.blocks = [
    {
      type: "table",
      columnsMm: Array.from({ length: l.cols }, () => l.w),
      rows: Array.from({ length: l.rows }, () => ({ cells: Array.from({ length: l.cols }, cell), heightMm: l.h })),
    } as Block,
  ];
  return doc;
}

export function LabelsDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (d: TextDocument) => void }) {
  const s = useStyles();
  const [id, setId] = useState(LABELS[0].id);
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Etiketten")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Text für jedes Etikett")}>
              <Textarea value={text} onChange={(_, d) => setText(d.value)} rows={4} />
            </Field>
            <Field label={tl("Etikettenbogen")}>
              <Dropdown value={LABELS.find((x) => x.id === id)?.label} selectedOptions={[id]} onOptionSelect={(_, d) => setId(d.optionValue ?? LABELS[0].id)}>
                {LABELS.map((x) => (
                  <Option key={x.id} value={x.id}>{x.label}</Option>
                ))}
              </Dropdown>
            </Field>
            <Text size={200}>{tl("Für verschiedene Adressen auf einem Bogen nutzen Sie den Seriendruck (Sendungen › Seriendruck starten).")}</Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!text.trim()} onClick={() => (onCreate(labelsDocument(id, text)), onClose())}>
              {tl("Etiketten erstellen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
