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
  MessageBar,
  MessageBarBody,
  Option,
  SpinButton,
  Textarea,
  ToggleButton,
} from "@fluentui/react-components";
import { DocumentLandscapeRegular, DocumentRegular } from "@fluentui/react-icons";
import type { Block, PageSetup } from "./model";
import { hfFromText, hfToText } from "./model";
import { tl, LOCALE } from "../../lib/i18n";

export interface PaperSize {
  id: string;
  name: string;
  /** Portrait width and height in millimetres. */
  w: number;
  h: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: "a4", name: "A4", w: 210, h: 297 },
  { id: "a5", name: "A5", w: 148, h: 210 },
  { id: "a3", name: "A3", w: 297, h: 420 },
  { id: "a6", name: "A6", w: 105, h: 148 },
  { id: "b5", name: "B5", w: 176, h: 250 },
  { id: "letter", name: "Letter", w: 215.9, h: 279.4 },
  { id: "legal", name: "Legal", w: 215.9, h: 355.6 },
  { id: "executive", name: "Executive", w: 184.2, h: 266.7 },
  { id: "tabloid", name: "Tabloid", w: 279.4, h: 431.8 },
  { id: "dl", name: tl("Umschlag DL"), w: 110, h: 220 },
  { id: "c5", name: tl("Umschlag C5"), w: 162, h: 229 },
];

export const MARGIN_PRESETS: { id: string; label: string; t: number; b: number; l: number; r: number }[] = [
  { id: "normal", label: tl("Normal"), t: 25, b: 20, l: 25, r: 20 },
  { id: "narrow", label: tl("Schmal"), t: 12.7, b: 12.7, l: 12.7, r: 12.7 },
  { id: "moderate", label: tl("Mittel"), t: 25.4, b: 25.4, l: 19.1, r: 19.1 },
  { id: "wide", label: tl("Breit"), t: 25.4, b: 25.4, l: 50.8, r: 50.8 },
];

/** Unit for page sizes and margins: centimetres, millimetres or inches. */
export type LengthUnit = "cm" | "mm" | "in";
const UNIT_MM: Record<LengthUnit, number> = { cm: 10, mm: 1, in: 25.4 };
const UNIT_KEY = "ondura.text.unit";

/** The unit last chosen, else inches for US English and centimetres otherwise. */
export function lengthUnit(): LengthUnit {
  try {
    const u = localStorage.getItem(UNIT_KEY);
    if (u === "cm" || u === "mm" || u === "in") return u;
  } catch {
    /* no storage */
  }
  return LOCALE === "en-US" ? "in" : "cm";
}

/** Millimetres in a unit, e.g. "2,5 cm" or "8.5 in". */
export function formatLength(mm: number, unit: LengthUnit = lengthUnit(), withUnit = true): string {
  const v = mm / UNIT_MM[unit];
  const text = v.toLocaleString(LOCALE, { maximumFractionDigits: unit === "mm" ? 0 : 2 });
  return withUnit ? `${text} ${unit}` : text;
}

/** "A4 (21 × 29,7 cm)" in the chosen unit. */
export function paperLabel(z: PaperSize, unit: LengthUnit = lengthUnit()): string {
  return `${z.name} (${formatLength(z.w, unit, false)} × ${formatLength(z.h, unit, false)} ${unit})`;
}

/** The paper size of a page (either orientation), if it is a known one. */
export function paperOf(p: PageSetup): PaperSize | undefined {
  const short = Math.min(p.widthMm, p.heightMm);
  const long = Math.max(p.widthMm, p.heightMm);
  return PAPER_SIZES.find((z) => Math.abs(z.w - short) < 1 && Math.abs(z.h - long) < 1);
}

/** Margin preset matching a page, if any. */
export function marginPresetOf(p: PageSetup) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.3;
  return MARGIN_PRESETS.find((m) => near(m.t, p.marginTopMm) && near(m.b, p.marginBottomMm) && near(m.l, p.marginLeftMm) && near(m.r, p.marginRightMm));
}

/** Smallest area left for the text, in millimetres. */
const MIN_TEXT_MM = 20;

/** What is wrong with a page setup: errors block it, warnings don't. */
export function pageProblems(p: PageSetup): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (p.widthMm < 25 || p.heightMm < 25 || p.widthMm > 1500 || p.heightMm > 1500) errors.push(tl("Breite und Höhe müssen zwischen 2,5 cm und 150 cm liegen."));
  else {
    if (p.widthMm - p.marginLeftMm - p.marginRightMm < MIN_TEXT_MM) errors.push(tl("Die Ränder links und rechts lassen zu wenig Platz für den Text."));
    if (p.heightMm - p.marginTopMm - p.marginBottomMm < MIN_TEXT_MM) errors.push(tl("Die Ränder oben und unten lassen zu wenig Platz für den Text."));
  }
  if (p.headerMm >= p.marginTopMm && p.marginTopMm > 0) warnings.push(tl("Die Kopfzeile reicht in den Text: Der Abstand vom Rand ist größer als der obere Rand."));
  if (p.footerMm >= p.marginBottomMm && p.marginBottomMm > 0) warnings.push(tl("Die Fußzeile reicht in den Text: Der Abstand vom Rand ist größer als der untere Rand."));
  return { errors, warnings };
}

/** Spin field for a length in the chosen unit (typing "2,5" or "2.5 cm" works). */
function LengthField({ label, mm, unit, max, onChange }: { label: string; mm: number; unit: LengthUnit; max: number; onChange: (mm: number) => void }) {
  const f = UNIT_MM[unit];
  const value = Math.round((mm / f) * 100) / 100;
  return (
    <Field label={label}>
      <SpinButton
        value={value}
        step={unit === "mm" ? 1 : 0.1}
        min={0}
        max={Math.round((max / f) * 100) / 100}
        displayValue={formatLength(mm, unit)}
        onChange={(_, d) => {
          const v = d.value ?? parseFloat(String(d.displayValue ?? "").replace(/[^\d,.-]/g, "").replace(",", "."));
          if (v != null && !Number.isNaN(v)) onChange(Math.max(0, Math.min(max, v * f)));
        }}
      />
    </Field>
  );
}

/** The page with its margins and header/footer lines, to scale. */
function PagePreview({ p }: { p: PageSetup }) {
  const box = 150;
  const k = box / Math.max(p.widthMm, p.heightMm);
  const w = p.widthMm * k;
  const h = p.heightMm * k;
  const lines = Array.from({ length: 14 }, (_, i) => p.marginTopMm * k + 4 + i * 6).filter((y) => y < h - p.marginBottomMm * k - 2);
  return (
    <svg width={box + 8} height={box + 8} viewBox={`-4 -4 ${box + 8} ${box + 8}`} aria-label={tl("Vorschau")} role="img">
      <g transform={`translate(${(box - w) / 2} ${(box - h) / 2})`}>
        <rect width={w} height={h} fill="#fff" stroke="#8a8a8a" />
        <rect x={p.marginLeftMm * k} y={p.marginTopMm * k} width={Math.max(0, w - (p.marginLeftMm + p.marginRightMm) * k)} height={Math.max(0, h - (p.marginTopMm + p.marginBottomMm) * k)} fill="none" stroke="#4f6bed" strokeDasharray="3 2" />
        {lines.map((y) => (
          <line key={y} x1={p.marginLeftMm * k + 3} x2={w - p.marginRightMm * k - 3} y1={y} y2={y} stroke="#c8c8c8" strokeWidth={2} />
        ))}
        <line x1={p.marginLeftMm * k} x2={w - p.marginRightMm * k} y1={p.headerMm * k} y2={p.headerMm * k} stroke="#b0b0b0" strokeDasharray="1 2" />
        <line x1={p.marginLeftMm * k} x2={w - p.marginRightMm * k} y1={h - p.footerMm * k} y2={h - p.footerMm * k} stroke="#b0b0b0" strokeDasharray="1 2" />
      </g>
    </svg>
  );
}

const sectionTitle = { fontWeight: 600, gridColumn: "1 / -1", marginTop: 4 } as const;

export function PageSetupDialog({
  open,
  page,
  onClose,
  onApply,
  sections = 0,
}: {
  open: boolean;
  page: PageSetup;
  onClose: () => void;
  /** `all`: also for the sections after section breaks. */
  onApply: (p: PageSetup, all: boolean) => void;
  /** Section breaks with their own page setup in the document. */
  sections?: number;
}) {
  const [p, setP] = useState(page);
  const [unit, setUnit] = useState<LengthUnit>(lengthUnit);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (open) (setP(page), setUnit(lengthUnit()), setAll(false));
  }, [page, open]);
  const landscape = p.widthMm > p.heightMm;
  const size = paperOf(p);
  const preset = marginPresetOf(p);
  const problems = pageProblems(p);
  const changeUnit = (u: LengthUnit) => {
    setUnit(u);
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      /* no storage */
    }
  };
  const len = (label: string, key: keyof PageSetup, max = 200) => <LengthField label={label} mm={p[key]} unit={unit} max={max} onChange={(v) => setP({ ...p, [key]: v })} />;
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 680 }}>
        <DialogBody>
          <DialogTitle>{tl("Seite einrichten")}</DialogTitle>
          <DialogContent style={{ display: "grid", gridTemplateColumns: "1fr 170px", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignContent: "start" }}>
              <span style={sectionTitle}>{tl("Papier")}</span>
              <Field label={tl("Papierformat")} style={{ gridColumn: "1 / -1" }}>
                <Dropdown
                  value={size ? paperLabel(size, unit) : tl("Benutzerdefiniert")}
                  selectedOptions={[size?.id ?? "custom"]}
                  onOptionSelect={(_, d) => {
                    const z = PAPER_SIZES.find((x) => x.id === d.optionValue);
                    if (z) setP({ ...p, widthMm: landscape ? z.h : z.w, heightMm: landscape ? z.w : z.h });
                  }}
                  listbox={{ style: { maxHeight: 320 } }}
                >
                  {PAPER_SIZES.map((z) => (
                    <Option key={z.id} value={z.id} text={paperLabel(z, unit)}>
                      {paperLabel(z, unit)}
                    </Option>
                  ))}
                  <Option value="custom" text={tl("Benutzerdefiniert")}>
                    {tl("Benutzerdefiniert")}
                  </Option>
                </Dropdown>
              </Field>
              {len(tl("Breite"), "widthMm", 1500)}
              {len(tl("Höhe"), "heightMm", 1500)}
              <Field label={tl("Ausrichtung")} style={{ gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <ToggleButton checked={!landscape} icon={<DocumentRegular />} onClick={() => landscape && setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm })}>
                    {tl("Hochformat")}
                  </ToggleButton>
                  <ToggleButton checked={landscape} icon={<DocumentLandscapeRegular />} onClick={() => !landscape && setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm })}>
                    {tl("Querformat")}
                  </ToggleButton>
                </div>
              </Field>
              <span style={sectionTitle}>{tl("Seitenränder")}</span>
              <Field label={tl("Vorlage")} style={{ gridColumn: "1 / -1" }}>
                <Dropdown
                  value={preset?.label ?? tl("Benutzerdefiniert")}
                  selectedOptions={[preset?.id ?? "custom"]}
                  onOptionSelect={(_, d) => {
                    const m = MARGIN_PRESETS.find((x) => x.id === d.optionValue);
                    if (m) setP({ ...p, marginTopMm: m.t, marginBottomMm: m.b, marginLeftMm: m.l, marginRightMm: m.r });
                  }}
                >
                  {MARGIN_PRESETS.map((m) => (
                    <Option key={m.id} value={m.id} text={m.label}>
                      {`${m.label} – ${formatLength(m.t, unit, false)} / ${formatLength(m.b, unit, false)} / ${formatLength(m.l, unit, false)} / ${formatLength(m.r, unit, false)} ${unit}`}
                    </Option>
                  ))}
                  <Option value="custom" text={tl("Benutzerdefiniert")}>
                    {tl("Benutzerdefiniert")}
                  </Option>
                </Dropdown>
              </Field>
              {len(tl("Oben"), "marginTopMm")}
              {len(tl("Unten"), "marginBottomMm")}
              {len(tl("Links"), "marginLeftMm")}
              {len(tl("Rechts"), "marginRightMm")}
              <span style={sectionTitle}>{tl("Kopf- und Fußzeile")}</span>
              {len(tl("Kopfzeile vom Rand"), "headerMm")}
              {len(tl("Fußzeile vom Rand"), "footerMm")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch" }}>
              <PagePreview p={p} />
              <Field label={tl("Maßeinheit")}>
                <Dropdown style={{ minWidth: 0, width: "100%" }} value={{ cm: tl("Zentimeter"), mm: tl("Millimeter"), in: tl("Zoll") }[unit]} selectedOptions={[unit]} onOptionSelect={(_, d) => changeUnit(d.optionValue as LengthUnit)}>
                  <Option value="cm">{tl("Zentimeter")}</Option>
                  <Option value="mm">{tl("Millimeter")}</Option>
                  <Option value="in">{tl("Zoll")}</Option>
                </Dropdown>
              </Field>
              {sections > 0 && (
                <Checkbox checked={all} onChange={(_, d) => setAll(!!d.checked)} label={tl("Für das ganze Dokument (auch nach Abschnittswechseln)")} />
              )}
            </div>
            {[...problems.errors, ...problems.warnings].length > 0 && (
              <MessageBar intent={problems.errors.length ? "error" : "warning"} style={{ gridColumn: "1 / -1" }}>
                <MessageBarBody>{[...problems.errors, ...problems.warnings].join(" ")}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={problems.errors.length > 0} onClick={() => (onApply(p, all), onClose())}>
              {tl("Übernehmen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const ALIGNS: Record<string, string> = { left: tl("Links"), center: tl("Zentriert"), right: tl("Rechts") };

export interface HeaderFooterValue {
  header: Block[];
  footer: Block[];
  differentFirst: boolean;
  headerFirst: Block[];
  footerFirst: Block[];
}

export function HeaderFooterDialog({ open, value, onClose, onApply }: { open: boolean; value: HeaderFooterValue; onClose: () => void; onApply: (v: HeaderFooterValue) => void }) {
  const [h, setH] = useState(hfToText(value.header));
  const [f, setF] = useState(hfToText(value.footer));
  const [diff, setDiff] = useState(value.differentFirst);
  const [h1, setH1] = useState(hfToText(value.headerFirst));
  const [f1, setF1] = useState(hfToText(value.footerFirst));
  useEffect(() => {
    if (open) {
      setH(hfToText(value.header));
      setF(hfToText(value.footer));
      setDiff(value.differentFirst);
      setH1(hfToText(value.headerFirst));
      setF1(hfToText(value.footerFirst));
    }
  }, [open, value]);
  const part = (label: string, v: { text: string; align: string }, set: (v: { text: string; align: string }) => void) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 8, alignItems: "end" }}>
      <Field label={label}>
        <Textarea value={v.text} rows={2} resize="vertical" onChange={(_, d) => set({ ...v, text: d.value })} />
      </Field>
      <Field label={tl("Ausrichtung")}>
        <Dropdown value={ALIGNS[v.align] ?? tl("Links")} selectedOptions={[v.align]} onOptionSelect={(_, d) => set({ ...v, align: d.optionValue! })}>
          {Object.entries(ALIGNS).map(([k, l]) => (
            <Option key={k} value={k}>
              {l}
            </Option>
          ))}
        </Dropdown>
      </Field>
    </div>
  );
  const hasPage = f.text.includes("{Seite}");
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Kopf- und Fußzeile")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {part(tl("Kopfzeile"), h, setH)}
            {part(tl("Fußzeile"), f, setF)}
            <Checkbox checked={diff} label={tl("Erste Seite anders (z. B. Titelblatt)")} onChange={(_, d) => setDiff(!!d.checked)} />
            {diff && part(tl("Kopfzeile der ersten Seite"), h1, setH1)}
            {diff && part(tl("Fußzeile der ersten Seite"), f1, setF1)}
            <Checkbox
              checked={hasPage}
              label={tl("Seitenzahl in der Fußzeile („Seite {Seite} von {Seiten}“)")}
              onChange={(_, d) =>
                setF(d.checked ? { text: `${f.text.trim() ? f.text.trim() + "  ·  " : ""}Seite {Seite} von {Seiten}`, align: f.text.trim() ? f.align : "center" } : { ...f, text: f.text.replace(/\s*·?\s*Seite \{Seite\}( von \{Seiten\})?/, "").replace(/\{Seiten?\}/g, "") })
              }
            />
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={() => (
                onApply({ header: hfFromText(h.text, h.align), footer: hfFromText(f.text, f.align), differentFirst: diff, headerFirst: diff ? hfFromText(h1.text, h1.align) : [], footerFirst: diff ? hfFromText(f1.text, f1.align) : [] }),
                onClose()
              )}
            >
              {tl("Übernehmen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function LinkDialog({ open, initial, onClose, onApply }: { open: boolean; initial: string; onClose: () => void; onApply: (href: string | null) => void }) {
  const [href, setHref] = useState(initial);
  useEffect(() => setHref(initial), [initial, open]);
  const apply = () => {
    const v = href.trim();
    onApply(v ? (/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(v) ? v : v.includes("@") && !v.includes("/") ? `mailto:${v}` : `https://${v}`) : null);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Link")}</DialogTitle>
          <DialogContent>
            <Field label={tl("Adresse")}>
              <Input autoFocus value={href} placeholder="https://…" onChange={(_, d) => setHref(d.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={apply}>
              {tl("OK")}
            </Button>
            {initial && (
              <Button onClick={() => (onApply(null), onClose())}>
                {tl("Link entfernen")}
              </Button>
            )}
            <Button appearance="subtle" onClick={onClose}>
              {tl("Abbrechen")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export interface ParagraphValues {
  indent: number;
  firstLine: number;
  spaceBefore: number;
  spaceAfter: number;
  lineHeight: number;
}

export function ParagraphDialog({ open, initial, onClose, onApply }: { open: boolean; initial: ParagraphValues; onClose: () => void; onApply: (v: ParagraphValues) => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial, open]);
  const spin = (label: string, key: keyof ParagraphValues, unit: string, step: number, min: number, max: number, scale = 1) => (
    <Field label={label}>
      <SpinButton
        value={Math.round((v[key] / scale) * 100) / 100}
        step={step}
        min={min}
        max={max}
        displayValue={`${(Math.round((v[key] / scale) * 100) / 100).toLocaleString(LOCALE)} ${unit}`}
        onChange={(_, d) => {
          const x = d.value ?? parseFloat(String(d.displayValue).replace(",", "."));
          if (x != null && !Number.isNaN(x)) setV({ ...v, [key]: x * scale });
        }}
      />
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Absatz")}</DialogTitle>
          <DialogContent style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {spin(tl("Einzug links"), "indent", "cm", 0.1, 0, 20, 10)}
            {spin(tl("Erste Zeile (negativ = hängend)"), "firstLine", "cm", 0.1, -10, 10, 10)}
            {spin(tl("Abstand vor"), "spaceBefore", "pt", 1, 0, 200)}
            {spin(tl("Abstand nach"), "spaceAfter", "pt", 1, 0, 200)}
            {spin(tl("Zeilenabstand"), "lineHeight", "-fach", 0.05, 0.5, 5)}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(v), onClose())}>
              {tl("Übernehmen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Single text field dialog (footnote text, user name). */
export function TextDialog({ open, title, label, initial, multiline, onClose, onApply }: { open: boolean; title: string; label: string; initial: string; multiline?: boolean; onClose: () => void; onApply: (v: string) => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial, open]);
  const apply = () => (onApply(v), onClose());
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <Field label={label} hint={multiline ? tl("Eingabe übernimmt, Umschalt+Eingabe beginnt eine neue Zeile.") : undefined}>
              {multiline ? (
                // Enter confirms; Shift+Enter adds a line.
                <Textarea
                  autoFocus
                  value={v}
                  rows={4}
                  resize="vertical"
                  onChange={(_, d) => setV(d.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      apply();
                    }
                  }}
                />
              ) : (
                <Input autoFocus value={v} onChange={(_, d) => setV(d.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
              )}
            </Field>
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
