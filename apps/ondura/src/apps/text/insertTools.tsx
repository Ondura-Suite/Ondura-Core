// Commands of the Text ribbon that Word has on Start, Einfügen and Entwurf:
// change case, sort paragraphs, format painter, cover page, blank page,
// date and time, signature line, WordArt, quick parts, screenshot, charts
// and icons as pictures, design presets.

import { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Editor } from "@tiptap/react";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Radio, RadioGroup } from "@fluentui/react-components";
import { ChartView } from "../chart/ChartView";
import type { Chart } from "../chart/ChartView";
import { tl, LOCALE } from "../../lib/i18n";

// ----------------------------------------------------------- change case --

export type CaseMode = "sentence" | "lower" | "upper" | "title" | "toggle";

const transform = (text: string, mode: CaseMode, atSentenceStart: boolean): string => {
  switch (mode) {
    case "lower":
      return text.toLocaleLowerCase(LOCALE);
    case "upper":
      return text.toLocaleUpperCase(LOCALE);
    case "title":
      return text.toLocaleLowerCase(LOCALE).replace(/(^|[\s\-–(„"'])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase(LOCALE));
    case "toggle":
      return [...text].map((c) => (c === c.toLocaleUpperCase(LOCALE) ? c.toLocaleLowerCase(LOCALE) : c.toLocaleUpperCase(LOCALE))).join("");
    case "sentence": {
      let start = atSentenceStart;
      return [...text.toLocaleLowerCase(LOCALE)]
        .map((c) => {
          if (start && /\p{L}/u.test(c)) {
            start = false;
            return c.toLocaleUpperCase(LOCALE);
          }
          if (/[.!?]/.test(c)) start = true;
          return c;
        })
        .join("");
    }
  }
};

/** Groß-/Kleinschreibung of the selection (the word at the cursor without one). */
/** Text in another case (Groß-/Kleinschreibung). */
export const caseText = (text: string, mode: CaseMode, atSentenceStart = true) => transform(text, mode, atSentenceStart);

export function changeCase(editor: Editor, mode: CaseMode) {
  const { state } = editor;
  let { from, to } = state.selection;
  if (from === to) {
    const $p = state.doc.resolve(from);
    const text = $p.parent.textContent;
    let a = $p.parentOffset;
    let b = a;
    while (a > 0 && /[\p{L}\p{N}]/u.test(text[a - 1])) a--;
    while (b < text.length && /[\p{L}\p{N}]/u.test(text[b])) b++;
    from -= $p.parentOffset - a;
    to = from + (b - a);
  }
  const tr = state.tr;
  let sentenceStart = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) sentenceStart = true;
    if (!node.isText || !node.text) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (a >= b) return false;
    const old = node.text.slice(a - pos, b - pos);
    const before = node.text.slice(0, a - pos);
    const start = mode === "sentence" ? sentenceStart && !/[\p{L}\p{N}]/u.test(before.replace(/[.!?]\s*$/, "").slice(-1) || "") : false;
    const next = transform(old, mode, start || /[.!?]\s*$/.test(before) || (sentenceStart && before.trim() === ""));
    if (next !== old) tr.replaceWith(tr.mapping.map(a), tr.mapping.map(b), state.schema.text(next, node.marks));
    sentenceStart = /[.!?]\s*$/.test(old);
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

// ----------------------------------------------------------------- sort --

/** Sorts the selected paragraphs (or the items of the list at the cursor). */
export function sortParagraphs(editor: Editor, descending: boolean) {
  const { state } = editor;
  const { $from, $to } = state.selection;
  const cmp = (a: PMNode, b: PMNode) => a.textContent.localeCompare(b.textContent, LOCALE, { numeric: true, sensitivity: "base" }) * (descending ? -1 : 1);
  // Inside a list: its items.
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "bulletList" || n.type.name === "orderedList") {
      const items: PMNode[] = [];
      n.forEach((c) => items.push(c));
      const sorted = n.type.create(n.attrs, [...items].sort(cmp));
      editor.view.dispatch(state.tr.replaceWith($from.before(d), $from.after(d), sorted));
      return;
    }
  }
  // Top-level blocks from the first to the last selected paragraph.
  const start = $from.depth > 0 ? $from.before(1) : $from.pos;
  const end = $to.depth > 0 ? $to.after(1) : $to.pos;
  const blocks: PMNode[] = [];
  state.doc.nodesBetween(start, end, (n, pos) => {
    if (pos >= start && pos < end && state.doc.resolve(pos).depth === 0) blocks.push(n);
    return false;
  });
  if (blocks.length < 2 || blocks.some((b) => !b.isTextblock)) return;
  editor.view.dispatch(state.tr.replaceWith(start, end, [...blocks].sort(cmp)));
}

// -------------------------------------------------------- format painter --

export interface CopiedFormat {
  marks: readonly Mark[];
  attrs: Record<string, unknown>;
  type: string;
}

/** Formatting at the cursor (marks of the text, attributes of the paragraph). */
export function copyFormat(editor: Editor): CopiedFormat {
  const { $from } = editor.state.selection;
  const marks = editor.state.storedMarks ?? $from.marks();
  return { marks, attrs: { ...$from.parent.attrs }, type: $from.parent.type.name };
}

/** Applies copied formatting to the selection. */
export function pasteFormat(editor: Editor, f: CopiedFormat) {
  const { state } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  if (from < to) {
    // Character formatting: replace the marks of the text (comments and
    // tracked changes stay).
    const keep = new Set(["comment", "insertion", "deletion", "link"]);
    state.doc.nodesBetween(from, to, (n, pos) => {
      if (!n.isText) return true;
      for (const m of n.marks) if (!keep.has(m.type.name)) tr.removeMark(Math.max(from, pos), Math.min(to, pos + n.nodeSize), m.type);
      return false;
    });
    for (const m of f.marks) if (!keep.has(m.type.name)) tr.addMark(from, to, m);
  }
  // Paragraph formatting of the paragraphs in the selection.
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.isTextblock && (n.type.name === "paragraph" || n.type.name === "heading")) {
      const type = state.schema.nodes[f.type] && (f.type === "paragraph" || f.type === "heading") ? state.schema.nodes[f.type] : n.type;
      tr.setNodeMarkup(pos, type, { ...f.attrs });
      return false;
    }
    return true;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

// --------------------------------------------------------- insert blocks --

const p = (text = "", attrs: Record<string, unknown> = {}, marks: { type: string; attrs?: Record<string, unknown> }[] = []) => ({ type: "paragraph", attrs, content: text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : [] });

/** Deckblatt: title, subtitle, author and date on a page of their own. */
export function insertCoverPage(editor: Editor, kind: "simple" | "band" | "centered", title: string, author: string) {
  const date = new Date().toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" });
  const big = [{ type: "textStyle", attrs: { fontSize: "36pt" } }];
  const color = kind === "band" ? [{ type: "textStyle", attrs: { fontSize: "36pt", color: "#1f3864" } }] : big;
  const align = kind === "centered" ? "center" : "left";
  const content = [
    ...Array.from({ length: kind === "centered" ? 8 : 4 }, () => p()),
    p(title || tl("Dokumenttitel"), { textAlign: align }, color),
    p(tl("Untertitel des Dokuments"), { textAlign: align, docStyle: "subtitle" }),
    ...Array.from({ length: 6 }, () => p()),
    p(author, { textAlign: align }),
    p(date, { textAlign: align }),
    { type: "pageBreak" },
  ];
  editor.chain().focus().insertContentAt(0, content, { updateSelection: false }).run();
}

/** Leere Seite: a page of its own at the cursor. */
export function insertBlankPage(editor: Editor) {
  editor.chain().focus().setPageBreak().setPageBreak().run();
}

/** Signature line: space, the line, name and title. */
export function insertSignatureLine(editor: Editor, name: string, title: string) {
  editor
    .chain()
    .focus()
    .insertContent([p(), p(), p("X ________________________________"), ...(name ? [p(name)] : []), ...(title ? [p(title)] : [])])
    .run();
}

/** WordArt: a centred line of large, bold, coloured text. */
export function insertWordArt(editor: Editor, text: string, style: number) {
  const fills = ["#2f5597", "#c00000", "#548235", "#7030a0", "#bf9000"];
  editor
    .chain()
    .focus()
    .insertContent([p(text, { textAlign: "center" }, [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "40pt", color: fills[style % fills.length] } }])])
    .run();
}

// ------------------------------------------------------------ quick parts --

const PARTS_KEY = "ondura.text.quickParts";

export interface QuickPart {
  name: string;
  content: unknown;
}

export function quickParts(): QuickPart[] {
  try {
    const v = JSON.parse(localStorage.getItem(PARTS_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Saves the selection as a quick part (replacing one of the same name). */
export function saveQuickPart(editor: Editor, name: string) {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const content = editor.state.doc.slice(from, to).content.toJSON();
  const list = quickParts().filter((x) => x.name !== name);
  list.push({ name, content });
  try {
    localStorage.setItem(PARTS_KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  return true;
}

export function removeQuickPart(name: string) {
  try {
    localStorage.setItem(PARTS_KEY, JSON.stringify(quickParts().filter((x) => x.name !== name)));
  } catch {
    /* no storage */
  }
}

// ------------------------------------------------------------- pictures --

/** SVG markup as a PNG data URL of `w`×`h` (twice the resolution). */
export async function svgToPng(svg: string, w: number, h: number): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w * 2;
  c.height = h * 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

/** A chart as a picture. */
export async function chartPng(chart: Chart, w = 520, h = 320): Promise<string> {
  let svg = renderToStaticMarkup(<ChartView chart={chart} width={w} height={h} />);
  if (!svg.includes("xmlns=")) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return svgToPng(svg, w, h);
}

/** Screenshot: a picture of a window or screen the user picks. */
export async function captureScreen(): Promise<{ src: string; width: number; height: number } | null> {
  const media = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: unknown) => Promise<MediaStream> };
  if (!media?.getDisplayMedia) return null;
  const stream = await media.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0);
    return { src: c.toDataURL("image/png"), width: c.width, height: c.height };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// --------------------------------------------------------- date and time --

/** The formats of Word's "Datum und Uhrzeit" for now. */
export function dateFormats(d = new Date()): string[] {
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString(LOCALE, o);
  const set = new Set([
    f({ day: "2-digit", month: "2-digit", year: "numeric" }),
    f({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    f({ day: "numeric", month: "long", year: "numeric" }),
    f({ day: "2-digit", month: "2-digit", year: "2-digit" }),
    d.toISOString().slice(0, 10),
    f({ day: "numeric", month: "short", year: "numeric" }),
    f({ month: "long", year: "numeric" }),
    f({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    f({ hour: "2-digit", minute: "2-digit" }),
    f({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  ]);
  return [...set];
}

export function DateTimeDialog({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (text: string) => void }) {
  const [list, setList] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  useEffect(() => {
    if (!open) return;
    const l = dateFormats();
    setList(l);
    setPick(l[0]);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{tl("Datum und Uhrzeit")}</DialogTitle>
          <DialogContent>
            <RadioGroup value={pick} onChange={(_, d) => setPick(d.value)}>
              {list.map((x) => (
                <Radio key={x} value={x} label={x} />
              ))}
            </RadioGroup>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onInsert(pick), onClose())}>
              {tl("OK")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** A small dialog with one or two text fields. */
export function FieldsDialog({ open, title, fields, onClose, onApply }: { open: boolean; title: string; fields: { label: string; initial?: string }[]; onClose: () => void; onApply: (values: string[]) => void }) {
  const [v, setV] = useState<string[]>([]);
  useEffect(() => {
    if (open) setV(fields.map((f) => f.initial ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {fields.map((f, i) => (
              <Field key={i} label={f.label}>
                <Input value={v[i] ?? ""} onChange={(_, d) => setV((x) => x.map((y, j) => (j === i ? d.value : y)))} />
              </Field>
            ))}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(v), onClose())}>
              {tl("OK")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------------------------------------------------------------- design --

/** Design presets (Entwurf): theme fonts, colours and paragraph spacing. */
export const THEME_FONTS: { name: string; body: string; heading: string }[] = [
  { name: "Office", body: "Aptos", heading: "Aptos Display" },
  { name: "Office 2013–2022", body: "Calibri", heading: "Calibri Light" },
  { name: "Arial", body: "Arial", heading: "Arial" },
  { name: "Cambria", body: "Cambria", heading: "Cambria" },
  { name: "Georgia", body: "Georgia", heading: "Georgia" },
  { name: "Garamond", body: "Garamond", heading: "Garamond" },
  { name: "Times New Roman", body: "Times New Roman", heading: "Times New Roman" },
  { name: "Segoe UI", body: "Segoe UI", heading: "Segoe UI Semibold" },
  { name: "Trebuchet", body: "Trebuchet MS", heading: "Trebuchet MS" },
];

export const THEME_COLORS: { name: string; heading: string; accent: string }[] = [
  { name: "Office", heading: "#1f3864", accent: "#2f5496" },
  { name: tl("Blau"), heading: "#17406d", accent: "#0f6fc6" },
  { name: tl("Grün"), heading: "#3c5a1e", accent: "#549e39" },
  { name: tl("Rot"), heading: "#7b1c1c", accent: "#c00000" },
  { name: tl("Violett"), heading: "#4b2873", accent: "#7030a0" },
  { name: tl("Orange"), heading: "#843c0c", accent: "#c55a11" },
  { name: tl("Graustufen"), heading: "#262626", accent: "#595959" },
];

export const THEME_SPACING: { name: string; before: number; after: number; line: number }[] = [
  { name: tl("Kein Absatzabstand"), before: 0, after: 0, line: 1 },
  { name: tl("Kompakt"), before: 0, after: 4, line: 1 },
  { name: tl("Eng"), before: 0, after: 6, line: 1.15 },
  { name: tl("Standard"), before: 0, after: 8, line: 1.15 },
  { name: tl("Offen"), before: 0, after: 10, line: 1.25 },
  { name: tl("Entspannt"), before: 0, after: 6, line: 1.5 },
  { name: tl("Doppelt"), before: 0, after: 8, line: 2 },
];
