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
  SpinButton,
  Textarea,
} from "@fluentui/react-components";
import type { Block, PageSetup } from "./model";
import { hfFromText, hfToText } from "./model";

export const PAPER_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: "a4", label: "A4 (21 × 29,7 cm)", w: 210, h: 297 },
  { id: "a5", label: "A5 (14,8 × 21 cm)", w: 148, h: 210 },
  { id: "a3", label: "A3 (29,7 × 42 cm)", w: 297, h: 420 },
  { id: "letter", label: "Letter (21,59 × 27,94 cm)", w: 215.9, h: 279.4 },
  { id: "legal", label: "Legal (21,59 × 35,56 cm)", w: 215.9, h: 355.6 },
];

export const MARGIN_PRESETS: { id: string; label: string; t: number; b: number; l: number; r: number }[] = [
  { id: "normal", label: "Normal", t: 25, b: 20, l: 25, r: 20 },
  { id: "narrow", label: "Schmal", t: 12.7, b: 12.7, l: 12.7, r: 12.7 },
  { id: "moderate", label: "Mittel", t: 25.4, b: 25.4, l: 19.1, r: 19.1 },
  { id: "wide", label: "Breit", t: 25.4, b: 25.4, l: 50.8, r: 50.8 },
];

const cm = (mm: number) => Math.round(mm) / 10;

export function PageSetupDialog({ open, page, onClose, onApply }: { open: boolean; page: PageSetup; onClose: () => void; onApply: (p: PageSetup) => void }) {
  const [p, setP] = useState(page);
  useEffect(() => setP(page), [page, open]);
  const landscape = p.widthMm > p.heightMm;
  const size = PAPER_SIZES.find((s) => (Math.abs(s.w - Math.min(p.widthMm, p.heightMm)) < 1 && Math.abs(s.h - Math.max(p.widthMm, p.heightMm)) < 1));
  const num = (label: string, key: keyof PageSetup) => (
    <Field label={label}>
      <SpinButton
        value={cm(p[key] * 10)}
        step={0.1}
        min={0}
        max={20}
        displayValue={`${cm(p[key] * 10).toLocaleString("de-DE")} cm`}
        onChange={(_, d) => {
          const v = d.value ?? parseFloat(String(d.displayValue).replace(",", "."));
          if (v != null && !Number.isNaN(v)) setP({ ...p, [key]: Math.max(0, v * 10) });
        }}
      />
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>Seite einrichten</DialogTitle>
          <DialogContent style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Papierformat" style={{ gridColumn: "1 / -1" }}>
              <Dropdown
                value={size?.label ?? "Benutzerdefiniert"}
                selectedOptions={size ? [size.id] : []}
                onOptionSelect={(_, d) => {
                  const s = PAPER_SIZES.find((x) => x.id === d.optionValue)!;
                  setP({ ...p, widthMm: landscape ? s.h : s.w, heightMm: landscape ? s.w : s.h });
                }}
              >
                {PAPER_SIZES.map((s) => (
                  <Option key={s.id} value={s.id}>
                    {s.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Ausrichtung" style={{ gridColumn: "1 / -1" }}>
              <Dropdown
                value={landscape ? "Querformat" : "Hochformat"}
                selectedOptions={[landscape ? "l" : "p"]}
                onOptionSelect={(_, d) => {
                  const wantLandscape = d.optionValue === "l";
                  if (wantLandscape !== landscape) setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm });
                }}
              >
                <Option value="p">Hochformat</Option>
                <Option value="l">Querformat</Option>
              </Dropdown>
            </Field>
            {num("Rand oben", "marginTopMm")}
            {num("Rand unten", "marginBottomMm")}
            {num("Rand links", "marginLeftMm")}
            {num("Rand rechts", "marginRightMm")}
            {num("Kopfzeile vom Rand", "headerMm")}
            {num("Fußzeile vom Rand", "footerMm")}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(p), onClose())}>
              Übernehmen
            </Button>
            <Button onClick={onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const ALIGNS: Record<string, string> = { left: "Links", center: "Zentriert", right: "Rechts" };

export function HeaderFooterDialog({
  open,
  header,
  footer,
  onClose,
  onApply,
}: {
  open: boolean;
  header: Block[];
  footer: Block[];
  onClose: () => void;
  onApply: (header: Block[], footer: Block[]) => void;
}) {
  const [h, setH] = useState(hfToText(header));
  const [f, setF] = useState(hfToText(footer));
  useEffect(() => {
    if (open) {
      setH(hfToText(header));
      setF(hfToText(footer));
    }
  }, [open, header, footer]);
  const part = (label: string, v: { text: string; align: string }, set: (v: { text: string; align: string }) => void) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 8, alignItems: "end" }}>
      <Field label={label}>
        <Textarea value={v.text} rows={2} resize="vertical" onChange={(_, d) => set({ ...v, text: d.value })} />
      </Field>
      <Field label="Ausrichtung">
        <Dropdown value={ALIGNS[v.align] ?? "Links"} selectedOptions={[v.align]} onOptionSelect={(_, d) => set({ ...v, align: d.optionValue! })}>
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
          <DialogTitle>Kopf- und Fußzeile</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {part("Kopfzeile", h, setH)}
            {part("Fußzeile", f, setF)}
            <Checkbox
              checked={hasPage}
              label="Seitenzahl in der Fußzeile („Seite {Seite} von {Seiten}“)"
              onChange={(_, d) =>
                setF(d.checked ? { text: `${f.text.trim() ? f.text.trim() + "  ·  " : ""}Seite {Seite} von {Seiten}`, align: f.text.trim() ? f.align : "center" } : { ...f, text: f.text.replace(/\s*·?\s*Seite \{Seite\}( von \{Seiten\})?/, "").replace(/\{Seiten?\}/g, "") })
              }
            />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(hfFromText(h.text, h.align), hfFromText(f.text, f.align)), onClose())}>
              Übernehmen
            </Button>
            <Button onClick={onClose}>Abbrechen</Button>
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
          <DialogTitle>Link</DialogTitle>
          <DialogContent>
            <Field label="Adresse">
              <Input autoFocus value={href} placeholder="https://…" onChange={(_, d) => setHref(d.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={apply}>
              OK
            </Button>
            {initial && (
              <Button onClick={() => (onApply(null), onClose())}>
                Link entfernen
              </Button>
            )}
            <Button appearance="subtle" onClick={onClose}>
              Abbrechen
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
        displayValue={`${(Math.round((v[key] / scale) * 100) / 100).toLocaleString("de-DE")} ${unit}`}
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
          <DialogTitle>Absatz</DialogTitle>
          <DialogContent style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {spin("Einzug links", "indent", "cm", 0.1, 0, 20, 10)}
            {spin("Erste Zeile (negativ = hängend)", "firstLine", "cm", 0.1, -10, 10, 10)}
            {spin("Abstand vor", "spaceBefore", "pt", 1, 0, 200)}
            {spin("Abstand nach", "spaceAfter", "pt", 1, 0, 200)}
            {spin("Zeilenabstand", "lineHeight", "-fach", 0.05, 0.5, 5)}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(v), onClose())}>
              Übernehmen
            </Button>
            <Button onClick={onClose}>Abbrechen</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
