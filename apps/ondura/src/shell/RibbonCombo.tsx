// Font name / size box of the ribbons: shows the current value, keeps what
// is typed while it has the focus and applies it with Enter (or by picking
// an entry). A controlled Combobox without its own text would throw every
// keystroke away.

import { useState, type CSSProperties, type ReactNode } from "react";
import { Combobox, Option } from "@fluentui/react-components";

export interface ComboEntry {
  value: string;
  text: string;
  node?: ReactNode;
}

export function RibbonCombo(p: { value: string; selected?: string; entries: ComboEntry[]; onCommit: (text: string) => void; disabled?: boolean; style?: CSSProperties; className?: string; "aria-label"?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Combobox
      className={p.className}
      style={p.style}
      size="small"
      freeform
      disabled={p.disabled}
      aria-label={p["aria-label"]}
      value={draft ?? p.value}
      selectedOptions={p.selected ? [p.selected] : []}
      onChange={(e) => setDraft(e.target.value)}
      onOptionSelect={(_, d) => {
        // Typing clears Fluent's selection (an event without a value): keep the typed text then.
        if (!d.optionValue) return;
        setDraft(null);
        p.onCommit(d.optionValue);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft !== null) {
          const text = draft.trim();
          setDraft(null);
          if (text) p.onCommit(text);
        } else if (e.key === "Escape") setDraft(null);
      }}
      onBlur={() => setDraft(null)}
      listbox={{ style: { maxHeight: 320 } }}
    >
      {p.entries.map((x) => (
        <Option key={x.value} value={x.value} text={x.text}>
          {x.node ?? x.text}
        </Option>
      ))}
    </Combobox>
  );
}

/** Font size text in the UI's notation ("10,5") and back. */
export const sizeText = (v: number) => String(v).replace(".", ",");
export const parseSize = (t: string) => parseFloat(t.replace(",", "."));
