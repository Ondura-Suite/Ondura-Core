// "Formatvorlage ändern": font, size, colour, emphasis, spacing and
// alignment of a built-in paragraph style.

import { useEffect, useState } from "react";
import { Button, Checkbox, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Option, Radio, RadioGroup, SpinButton, makeStyles, tokens } from "@fluentui/react-components";
import type { StyleDef } from "./model";
import { STYLE_NAMES, effective } from "./styles";
import { FONTS } from "./TextRibbon";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  preview: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "12px 16px",
    backgroundColor: "#fff",
    color: "#000",
    minHeight: "64px",
    overflow: "hidden",
  },
});

export function StyleDialog(p: {
  open: boolean;
  styleId: string;
  defs: StyleDef[];
  /** Document default font and size (the look of "Standard"). */
  docFont: string;
  docSize: number;
  onClose: () => void;
  onApply: (d: StyleDef) => void;
  onReset: (id: string) => void;
}) {
  const s = useStyles();
  const [id, setId] = useState(p.styleId);
  const [v, setV] = useState(() => effective(p.defs, p.styleId));
  useEffect(() => {
    if (p.open) setId(p.styleId);
  }, [p.open, p.styleId]);
  useEffect(() => {
    const e = effective(p.defs, id);
    setV(id === "normal" ? { ...e, font: p.docFont, size: p.docSize } : e);
  }, [id, p.defs, p.docFont, p.docSize]);
  if (!p.open) return null;
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const label = STYLE_NAMES.find((x) => x.id === id)?.label ?? id;
  const font = v.font ?? p.docFont;
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Formatvorlage ändern")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label={tl("Formatvorlage")}>
              <Dropdown value={label} selectedOptions={[id]} onOptionSelect={(_, d) => d.optionValue && setId(d.optionValue)}>
                {STYLE_NAMES.map((x) => (
                  <Option key={x.id} value={x.id}>
                    {x.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <div className={s.grid}>
              <Field label={tl("Schriftart")}>
                <Combobox freeform value={font} selectedOptions={[font]} onOptionSelect={(_, d) => d.optionValue && set({ font: d.optionValue })} onChange={(e) => set({ font: (e.target as HTMLInputElement).value })}>
                  {FONTS.map((f) => (
                    <Option key={f} value={f} style={{ fontFamily: f }}>
                      {f}
                    </Option>
                  ))}
                </Combobox>
              </Field>
              <Field label={tl("Schriftgrad (pt)")}>
                <SpinButton value={v.size} min={4} max={96} step={0.5} onChange={(_, d) => set({ size: d.value ?? (Number(d.displayValue) || v.size) })} />
              </Field>
              <Field label={tl("Farbe")}>
                <input type="color" value={v.color} onChange={(e) => set({ color: e.target.value })} style={{ width: 64, height: 30, border: "none", background: "none" }} aria-label={tl("Farbe")} />
              </Field>
              <Field label={tl("Auszeichnung")}>
                <div style={{ display: "flex", gap: 12 }}>
                  <Checkbox label={tl("Fett")} checked={v.bold} onChange={(_, d) => set({ bold: !!d.checked })} />
                  <Checkbox label={tl("Kursiv")} checked={v.italic} onChange={(_, d) => set({ italic: !!d.checked })} />
                </div>
              </Field>
              <Field label={tl("Abstand vor (pt)")}>
                <SpinButton value={v.spaceBefore} min={0} max={200} onChange={(_, d) => set({ spaceBefore: d.value ?? (Number(d.displayValue) || 0) })} />
              </Field>
              <Field label={tl("Abstand nach (pt)")}>
                <SpinButton value={v.spaceAfter} min={0} max={200} onChange={(_, d) => set({ spaceAfter: d.value ?? (Number(d.displayValue) || 0) })} />
              </Field>
            </div>
            <Field label={tl("Ausrichtung")}>
              <RadioGroup layout="horizontal" value={v.align} onChange={(_, d) => set({ align: d.value })}>
                <Radio value="left" label={tl("Links")} />
                <Radio value="center" label={tl("Zentriert")} />
                <Radio value="right" label={tl("Rechts")} />
                <Radio value="justify" label={tl("Blocksatz")} />
              </RadioGroup>
            </Field>
            <div className={s.preview}>
              <div style={{ fontFamily: `"${font}", sans-serif`, fontSize: `${v.size}pt`, color: v.color, fontWeight: v.bold ? 700 : 400, fontStyle: v.italic ? "italic" : "normal", textAlign: v.align as React.CSSProperties["textAlign"], marginTop: Math.min(v.spaceBefore, 12) }}>
                {label} {tl("– Beispieltext")}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => p.onReset(id)}>{tl("Zurücksetzen")}</Button>
            <Button onClick={p.onClose}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" onClick={() => p.onApply({ id, ...v, font })}>
              {tl("OK")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
