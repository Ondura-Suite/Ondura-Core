// Content controls (Word "Inhaltssteuerelemente"): plain text, checkbox,
// drop-down list and date picker as inline form fields.
import { Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { LOCALE, tl } from "../../lib/i18n";

export type ControlKind = "text" | "checkbox" | "dropdown" | "date";

export interface ControlAttrs {
  kind: ControlKind;
  title: string;
  value: string;
  checked: boolean;
  items: string[];
  format: string;
  placeholder: boolean;
}

export const PLACEHOLDER: Record<ControlKind, string> = {
  text: tl("Klicken oder tippen Sie hier, um Text einzugeben."),
  checkbox: "",
  dropdown: tl("Wählen Sie ein Element aus."),
  date: tl("Klicken oder tippen Sie, um ein Datum einzugeben."),
};

export const DATE_FORMATS = ["dd.MM.yyyy", "d. MMMM yyyy", "dddd, d. MMMM yyyy", "dd.MM.yy", "yyyy-MM-dd"];

// Month and day names of the UI language.
const names = (n: number, f: (i: number) => Date, o: Intl.DateTimeFormatOptions) => Array.from({ length: n }, (_, i) => new Intl.DateTimeFormat(LOCALE, o).format(f(i)));
const MONTHS = names(12, (i) => new Date(2026, i, 15), { month: "long" });
const DAYS = names(7, (i) => new Date(2026, 1, i + 1), { weekday: "long" }); // 1 Feb 2026 is a Sunday

/** Formats a date with a Word date pattern (d, dd, ddd, dddd, M, MM, MMM, MMMM, yy, yyyy). */
export function formatDate(d: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return format.replace(/d{1,4}|M{1,4}|y{2,4}/g, (t) => {
    switch (t) {
      case "d":
        return String(d.getDate());
      case "dd":
        return pad(d.getDate());
      case "ddd":
        return DAYS[d.getDay()].slice(0, 2) + ".";
      case "dddd":
        return DAYS[d.getDay()];
      case "M":
        return String(d.getMonth() + 1);
      case "MM":
        return pad(d.getMonth() + 1);
      case "MMM":
        return MONTHS[d.getMonth()].slice(0, 3) + ".";
      case "MMMM":
        return MONTHS[d.getMonth()];
      case "yy":
        return pad(d.getFullYear() % 100);
      default:
        return String(d.getFullYear());
    }
  });
}

export function controlText(a: Pick<ControlAttrs, "kind" | "value" | "checked">): string {
  return a.kind === "checkbox" ? (a.checked ? "☒" : "☐") : a.value;
}

export function newControl(kind: ControlKind): ControlAttrs {
  return {
    kind,
    title: "",
    value: PLACEHOLDER[kind],
    checked: false,
    items: kind === "dropdown" ? [tl("Element 1"), tl("Element 2")] : [],
    format: kind === "date" ? "dd.MM.yyyy" : "",
    placeholder: kind !== "checkbox",
  };
}

function setAttrs(editor: Editor, getPos: () => number | undefined, node: PMNode, attrs: Partial<ControlAttrs>) {
  const pos = getPos();
  if (pos == null || !editor.isEditable) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

export const ContentControl = Node.create({
  name: "contentControl",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    kind: { default: "text" },
    title: { default: "" },
    value: { default: "" },
    checked: { default: false },
    items: { default: [] },
    format: { default: "" },
    placeholder: { default: false },
  }),
  parseHTML: () => [
    {
      tag: "span[data-control]",
      getAttrs: (el) => {
        try {
          return JSON.parse((el as HTMLElement).getAttribute("data-control") ?? "{}");
        } catch {
          return false;
        }
      },
    },
  ],
  renderHTML: ({ node }) => ["span", { "data-control": JSON.stringify(node.attrs), class: `nx-cc nx-cc-${node.attrs.kind}${node.attrs.placeholder ? " nx-cc-placeholder" : ""}` }, controlText(node.attrs as ControlAttrs)],
  addNodeView:
    () =>
    ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.contentEditable = "false";
      const render = () => {
        const a = current.attrs as ControlAttrs;
        dom.className = `nx-cc nx-cc-${a.kind}${a.placeholder ? " nx-cc-placeholder" : ""}`;
        dom.title = a.title || { text: tl("Nur-Text-Inhaltssteuerelement"), checkbox: tl("Kontrollkästchen"), dropdown: tl("Dropdownliste"), date: tl("Datumsauswahl") }[a.kind];
        dom.replaceChildren();
        if (a.kind === "dropdown") {
          const sel = document.createElement("select");
          sel.className = "nx-cc-select";
          if (a.placeholder) sel.append(new Option(a.value || PLACEHOLDER.dropdown, "", true, true));
          for (const i of a.items) sel.append(new Option(i, i, false, !a.placeholder && i === a.value));
          sel.onchange = () => setAttrs(editor, getPos, current, { value: sel.value, placeholder: false });
          sel.onmousedown = (e) => e.stopPropagation();
          dom.append(sel);
          return;
        }
        dom.textContent = controlText(a);
      };
      const editText = () => {
        const a = current.attrs as ControlAttrs;
        const input = document.createElement("input");
        input.className = "nx-cc-input";
        input.value = a.placeholder ? "" : a.value;
        input.placeholder = PLACEHOLDER.text;
        input.size = Math.max(8, input.value.length + 1);
        let done = false;
        const commit = (save: boolean) => {
          if (done) return;
          done = true;
          const v = input.value;
          if (save) setAttrs(editor, getPos, current, v ? { value: v, placeholder: false } : { value: PLACEHOLDER.text, placeholder: true });
          render();
          editor.commands.focus();
        };
        input.oninput = () => (input.size = Math.max(8, input.value.length + 1));
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.preventDefault(), commit(true));
          if (e.key === "Escape") commit(false);
        };
        input.onblur = () => commit(true);
        dom.replaceChildren(input);
        input.focus();
      };
      const pickDate = () => {
        const a = current.attrs as ControlAttrs;
        const input = document.createElement("input");
        input.type = "date";
        input.className = "nx-cc-date";
        dom.append(input);
        input.onchange = () => {
          if (input.value) {
            const [y, m, d] = input.value.split("-").map(Number);
            setAttrs(editor, getPos, current, { value: formatDate(new Date(y, m - 1, d), a.format || "dd.MM.yyyy"), placeholder: false });
          }
          input.remove();
        };
        input.onblur = () => setTimeout(() => input.remove(), 200);
        try {
          input.showPicker();
        } catch {
          input.focus();
        }
      };
      dom.onmousedown = (e) => {
        if (!editor.isEditable) return;
        const a = current.attrs as ControlAttrs;
        if (a.kind === "dropdown") return;
        e.preventDefault();
        if (a.kind === "checkbox") setAttrs(editor, getPos, current, { checked: !a.checked });
        else if (a.kind === "date") pickDate();
        else editText();
      };
      render();
      return {
        dom,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          render();
          return true;
        },
        stopEvent: (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement,
        ignoreMutation: () => true,
      };
    },
});

export function insertControl(editor: Editor, kind: ControlKind) {
  editor.chain().focus().insertContent({ type: "contentControl", attrs: newControl(kind) }).run();
}

/** The content control at (or right before) the selection. */
export function selectedControl(editor: Editor): { pos: number; attrs: ControlAttrs } | null {
  const { selection, doc } = editor.state;
  const at = (pos: number) => {
    const n = pos >= 0 ? doc.nodeAt(pos) : null;
    return n?.type.name === "contentControl" ? { pos, attrs: n.attrs as ControlAttrs } : null;
  };
  return at(selection.from) ?? at(selection.from - 1);
}

export function updateControl(editor: Editor, pos: number, attrs: Partial<ControlAttrs>) {
  const n = editor.state.doc.nodeAt(pos);
  if (!n) return;
  const next = { ...(n.attrs as ControlAttrs), ...attrs };
  // A drop-down value that is no longer a choice falls back to the placeholder.
  if (next.kind === "dropdown" && !next.placeholder && !next.items.includes(next.value)) Object.assign(next, { value: PLACEHOLDER.dropdown, placeholder: true });
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, next));
}
