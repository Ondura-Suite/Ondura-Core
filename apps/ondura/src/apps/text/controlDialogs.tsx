// Properties of a content control: title, choices of a drop-down list and
// the format of a date picker.

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Option, Textarea } from "@fluentui/react-components";
import { type ControlAttrs, DATE_FORMATS, PLACEHOLDER, formatDate } from "./controls";
import { tl } from "../../lib/i18n";

export function ControlPropsDialog(p: { attrs: ControlAttrs | null; onClose: () => void; onApply: (a: Partial<ControlAttrs>) => void }) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState("");
  const [format, setFormat] = useState("dd.MM.yyyy");
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!p.attrs) return;
    setTitle(p.attrs.title);
    setItems(p.attrs.items.join("\n"));
    setFormat(p.attrs.format || "dd.MM.yyyy");
    setChecked(p.attrs.checked);
  }, [p.attrs]);
  if (!p.attrs) return null;
  const a = p.attrs;
  const apply = () => {
    const out: Partial<ControlAttrs> = { title: title.trim() };
    if (a.kind === "dropdown") out.items = items.split("\n").map((s) => s.trim()).filter(Boolean);
    if (a.kind === "checkbox") out.checked = checked;
    if (a.kind === "date") {
      out.format = format;
      // Re-format an entered date with the new pattern.
      const m = a.placeholder ? null : parseShown(a.value);
      if (m) out.value = formatDate(m, format);
    }
    p.onApply(out);
  };
  const kindName = { text: tl("Nur-Text"), checkbox: tl("Kontrollkästchen"), dropdown: tl("Dropdownliste"), date: tl("Datumsauswahl") }[a.kind];
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 440 }}>
        <DialogBody>
          <DialogTitle>{tl("Eigenschaften:")} {kindName}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label={tl("Titel")}>
              <Input value={title} autoFocus onChange={(_, d) => setTitle(d.value)} />
            </Field>
            {a.kind === "dropdown" && (
              <Field label={tl("Einträge (einer pro Zeile)")}>
                <Textarea rows={6} value={items} onChange={(_, d) => setItems(d.value)} />
              </Field>
            )}
            {a.kind === "date" && (
              <Field label={tl("Datumsformat")}>
                <Dropdown value={`${format} (${formatDate(new Date(), format)})`} selectedOptions={[format]} onOptionSelect={(_, d) => d.optionValue && setFormat(d.optionValue)}>
                  {DATE_FORMATS.map((f) => (
                    <Option key={f} value={f} text={f}>
                      {formatDate(new Date(), f)}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            )}
            {a.kind === "checkbox" && <Checkbox label={tl("Aktiviert")} checked={checked} onChange={(_, d) => setChecked(!!d.checked)} />}
            {a.kind !== "checkbox" && a.placeholder && <span style={{ fontSize: 12, opacity: 0.7 }}>{tl("Platzhalter: „")}{a.value || PLACEHOLDER[a.kind]}“</span>}
          </DialogContent>
          <DialogActions>
            <Button onClick={p.onClose}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" onClick={apply}>
              {tl("OK")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

/** Reads a date shown in one of the supported formats. */
export function parseShown(v: string): Date | null {
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  m = v.match(/(\d{1,2})\.\s*([A-Za-zäÄ]+)\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return new Date(+m[3], mi, +m[1]);
  }
  return null;
}
