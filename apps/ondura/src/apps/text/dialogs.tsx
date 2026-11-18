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
import { tl, LOCALE } from "../../lib/i18n";

export const PAPER_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: "a4", label: tl("A4 (21 × 29,7 cm)"), w: 210, h: 297 },
  { id: "a5", label: tl("A5 (14,8 × 21 cm)"), w: 148, h: 210 },
  { id: "a3", label: tl("A3 (29,7 × 42 cm)"), w: 297, h: 420 },
  { id: "letter", label: tl("Letter (21,59 × 27,94 cm)"), w: 215.9, h: 279.4 },
  { id: "legal", label: tl("Legal (21,59 × 35,56 cm)"), w: 215.9, h: 355.6 },
];

export const MARGIN_PRESETS: { id: string; label: string; t: number; b: number; l: number; r: number }[] = [
  { id: "normal", label: tl("Normal"), t: 25, b: 20, l: 25, r: 20 },
  { id: "narrow", label: tl("Schmal"), t: 12.7, b: 12.7, l: 12.7, r: 12.7 },
  { id: "moderate", label: tl("Mittel"), t: 25.4, b: 25.4, l: 19.1, r: 19.1 },
  { id: "wide", label: tl("Breit"), t: 25.4, b: 25.4, l: 50.8, r: 50.8 },
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
        displayValue={`${cm(p[key] * 10).toLocaleString(LOCALE)} cm`}
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
          <DialogTitle>{tl("Seite einrichten")}</DialogTitle>
          <DialogContent style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={tl("Papierformat")} style={{ gridColumn: "1 / -1" }}>
              <Dropdown
                value={size?.label ?? tl("Benutzerdefiniert")}
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
            <Field label={tl("Ausrichtung")} style={{ gridColumn: "1 / -1" }}>
              <Dropdown
                value={landscape ? tl("Querformat") : tl("Hochformat")}
                selectedOptions={[landscape ? "l" : "p"]}
                onOptionSelect={(_, d) => {
                  const wantLandscape = d.optionValue === "l";
                  if (wantLandscape !== landscape) setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm });
                }}
              >
                <Option value="p">{tl("Hochformat")}</Option>
                <Option value="l">{tl("Querformat")}</Option>
              </Dropdown>
            </Field>
            {num(tl("Rand oben"), "marginTopMm")}
            {num(tl("Rand unten"), "marginBottomMm")}
            {num(tl("Rand links"), "marginLeftMm")}
            {num(tl("Rand rechts"), "marginRightMm")}
            {num(tl("Kopfzeile vom Rand"), "headerMm")}
            {num(tl("Fußzeile vom Rand"), "footerMm")}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(p), onClose())}>
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
                // Enter confirms (like Word's note pane); Shift+Enter adds a line.
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
