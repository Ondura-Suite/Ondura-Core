// Comments, tracked changes, footnotes and the table of contents.

import { Extension, Mark, Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction, type EditorState } from "@tiptap/pm/state";
import { Fragment } from "@tiptap/pm/model";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import type { TocEntry } from "./model";

export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "span[data-comment]", getAttrs: (el) => ({ id: Number((el as HTMLElement).getAttribute("data-comment")) }) }],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-comment": HTMLAttributes.id, class: "nx-comment" }, 0],
});

const revisionAttrs = () => ({ author: { default: "" }, date: { default: "" } });

export const InsertionMark = Mark.create({
  name: "insertion",
  inclusive: true,
  addAttributes: revisionAttrs,
  parseHTML: () => [{ tag: "ins" }],
  renderHTML: ({ HTMLAttributes }) => ["ins", { class: "nx-ins", title: `Eingefügt von ${HTMLAttributes.author || "unbekannt"}` }, 0],
});

export const DeletionMark = Mark.create({
  name: "deletion",
  inclusive: false,
  addAttributes: revisionAttrs,
  parseHTML: () => [{ tag: "del" }],
  renderHTML: ({ HTMLAttributes }) => ["del", { class: "nx-del", title: `Gelöscht von ${HTMLAttributes.author || "unbekannt"}` }, 0],
});

/** Footnote reference; numbered by CSS, the note text is an attribute. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ text: { default: "" }, endnote: { default: false } }),
  parseHTML: () => [{ tag: "sup[data-footnote]", getAttrs: (el) => ({ text: (el as HTMLElement).getAttribute("title") ?? "", endnote: (el as HTMLElement).hasAttribute("data-endnote") }) }],
  renderHTML: ({ node }) => ["sup", { "data-footnote": "", ...(node.attrs.endnote ? { "data-endnote": "" } : {}), class: node.attrs.endnote ? "nx-en" : "nx-fn", title: node.attrs.text }],
});

/** Table of contents, rendered from its entries attribute. */
export const Toc = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ title: { default: "Inhalt" }, entries: { default: [] }, caption: { default: null } }),
  parseHTML: () => [{ tag: "div[data-toc]" }],
  renderHTML: ({ node }) => {
    const entries = (node.attrs.entries as TocEntry[]) ?? [];
    return [
      "div",
      { "data-toc": "", class: "nx-toc" },
      ...(node.attrs.title ? [["div", { class: "nx-toc-title" }, node.attrs.title]] : []),
      ...(entries.length
        ? entries.map((e, i) => ["div", { class: `nx-toc-entry nx-toc-l${e.level}`, "data-index": String(i) }, ["span", { class: "nx-toc-text" }, e.text], ["span", { class: "nx-toc-dots" }], ["span", { class: "nx-toc-page" }, String(e.page || "")]])
        : [["div", { class: "nx-toc-empty" }, node.attrs.caption ? `Keine Beschriftungen „${node.attrs.caption}“ gefunden.` : "Keine Überschriften gefunden. Formatvorlagen „Überschrift 1–3“ verwenden."]]),
    ];
  },
});

// ---------------------------------------------------------- track changes --

export const trackKey = new PluginKey<{ enabled: boolean }>("nexoraTrack");

export interface TrackOptions {
  /** Name used for new changes. */
  author: () => string;
}

function rangesWith(doc: PMNode, from: number, to: number, mark: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline || !node.marks.some((m) => m.type.name === mark)) return;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    const last = out[out.length - 1];
    if (last && last.to === a) last.to = b;
    else out.push({ from: a, to: b });
  });
  return out;
}

/**
 * Turns the last edit into a tracked change: deleted text is put back with a
 * deletion mark (own, not yet accepted insertions are really removed) and
 * inserted text gets an insertion mark. Runs as appendTransaction, so it is
 * part of the same undo step and never races with fast typing.
 */
function trackEdit(tr: Transaction, oldState: EditorState, newState: EditorState, author: string): Transaction | null {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0] as ReplaceStep & { from: number; to: number; slice: import("@tiptap/pm/model").Slice };
  const { from, to, slice } = step;
  const schema = newState.schema;
  const rev = { author, date: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  const del = schema.marks.deletion.create(rev);
  const out = newState.tr.setMeta(trackKey, true);
  let restored = 0;
  if (to > from) {
    const $f = oldState.doc.resolve(from);
    const $t = oldState.doc.resolve(to);
    // Deletions across paragraphs are not tracked.
    if ($f.parent === $t.parent && $f.parent.isTextblock) {
      const nodes: PMNode[] = [];
      oldState.doc.nodesBetween(from, to, (n, pos) => {
        if (!n.isInline) return;
        if (n.marks.some((m) => m.type.name === "insertion")) return false;
        const piece = n.isText ? n.cut(Math.max(from, pos) - pos, Math.min(to, pos + n.nodeSize) - pos) : n;
        nodes.push(piece.mark(del.addToSet(piece.marks)));
        return false;
      });
      if (nodes.length) {
        const frag = Fragment.fromArray(nodes);
        out.insert(from, frag);
        restored = frag.size;
      }
    }
  }
  const start = from + restored;
  const end = start + slice.size;
  if (slice.size > 0) {
    out.removeMark(start, end, schema.marks.deletion);
    out.addMark(start, end, schema.marks.insertion.create(rev));
  }
  const forward = oldState.selection.empty && oldState.selection.from === from && slice.size === 0;
  const caret = slice.size > 0 ? end : forward ? from + restored : from;
  out.setSelection(TextSelection.create(out.doc, Math.min(caret, out.doc.content.size)));
  return out;
}

export const TrackChanges = Extension.create<TrackOptions>({
  name: "trackChanges",
  addOptions: () => ({ author: () => "Ich" }),
  addProseMirrorPlugins() {
    const opts = this.options;
    let view: EditorView | null = null;
    return [
      new Plugin<{ enabled: boolean }>({
        key: trackKey,
        state: {
          init: () => ({ enabled: false }),
          apply: (tr, prev) => {
            const m = tr.getMeta(trackKey);
            return typeof m === "object" && m && "enabled" in m ? { enabled: !!m.enabled } : prev;
          },
        },
        view(v) {
          view = v;
          return {};
        },
        appendTransaction(trs, oldState, newState) {
          if (!trackKey.getState(oldState)?.enabled || trs.length !== 1 || view?.composing) return null;
          const tr = trs[0];
          if (!tr.docChanged || tr.getMeta(trackKey) || tr.getMeta("history$")) return null;
          return trackEdit(tr, oldState, newState, opts.author());
        },
      }),
    ];
  },
});

export const isTracking = (editor: Editor) => !!trackKey.getState(editor.state)?.enabled;

export function setTracking(editor: Editor, enabled: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(trackKey, { enabled }).setMeta("addToHistory", false));
}

/** Accept or reject the changes in the selection (or all). */
export function resolveChanges(editor: Editor, accept: boolean, all: boolean) {
  const { state } = editor;
  const from = all ? 0 : state.selection.from;
  const to = all ? state.doc.content.size : state.selection.to;
  const tr = state.tr.setMeta(trackKey, true);
  const remove = accept ? "deletion" : "insertion";
  const keep = accept ? "insertion" : "deletion";
  // Changes touching a collapsed cursor count as selected.
  const a = from === to ? Math.max(0, from - 1) : from;
  const b = from === to ? Math.min(state.doc.content.size, to + 1) : to;
  // Whole contiguous changes that touch the selection.
  const spans = (name: string) => rangesWith(state.doc, 0, state.doc.content.size, name).filter((r) => r.to >= a && r.from <= b);
  const keepSpans = spans(keep);
  for (const r of keepSpans) tr.removeMark(r.from, r.to, state.schema.marks[keep]);
  for (const r of spans(remove).reverse()) tr.delete(r.from, r.to);
  editor.view.dispatch(tr);
}

/** Positions of all tracked changes, in document order. */
export function changeRanges(doc: PMNode) {
  const ins = rangesWith(doc, 0, doc.content.size, "insertion");
  const del = rangesWith(doc, 0, doc.content.size, "deletion");
  return [...ins, ...del].sort((x, y) => x.from - y.from);
}

export function gotoChange(editor: Editor, dir: 1 | -1) {
  const ranges = changeRanges(editor.state.doc);
  if (!ranges.length) return false;
  const cur = editor.state.selection.from;
  const r = dir > 0 ? ranges.find((x) => x.from > cur) ?? ranges[0] : [...ranges].reverse().find((x) => x.to < cur) ?? ranges[ranges.length - 1];
  editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).scrollIntoView().run();
  return true;
}

// ------------------------------------------------------------- comments --

export function commentRanges(doc: PMNode) {
  const map = new Map<number, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    const m = node.marks.find((x) => x.type.name === "comment");
    if (!m) return;
    const id = Number(m.attrs.id);
    const cur = map.get(id);
    if (cur) cur.to = pos + node.nodeSize;
    else map.set(id, { from: pos, to: pos + node.nodeSize });
  });
  return map;
}

export function removeComment(editor: Editor, id: number) {
  const tr = editor.state.tr.setMeta(trackKey, true);
  editor.state.doc.descendants((node, pos) => {
    const m = node.marks.find((x) => x.type.name === "comment" && Number(x.attrs.id) === id);
    if (m) tr.removeMark(pos, pos + node.nodeSize, m);
  });
  editor.view.dispatch(tr);
}

// ---------------------------------------------------------------- TOC --

/** Headings (levels 1–3) with their page numbers from the page view. */
export function tocEntries(editor: Editor): TocEntry[] {
  const view = editor.view;
  const spacers = Array.from(view.dom.querySelectorAll<HTMLElement>(":scope > .nx-page-spacer")).map((s) => s.offsetTop);
  const out: TocEntry[] = [];
  view.state.doc.forEach((node, offset) => {
    if (node.type.name !== "heading" || node.attrs.level > 3 || !node.textContent.trim()) return;
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    const top = dom?.offsetTop ?? 0;
    out.push({ level: node.attrs.level, text: node.textContent.trim(), page: 1 + spacers.filter((s) => s < top).length });
  });
  return out;
}

export function updateTocs(editor: Editor): boolean {
  const entries = tocEntries(editor);
  const tr = editor.state.tr.setMeta(trackKey, true);
  let changed = false;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "toc" && !node.attrs.caption && JSON.stringify(node.attrs.entries) !== JSON.stringify(entries)) {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, entries });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
  return changed;
}

/** Heading position for a clicked TOC entry. */
export function headingPosition(editor: Editor, index: number) {
  let n = 0;
  let found: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found !== null || node.type.name !== "heading" || node.attrs.level > 3 || !node.textContent.trim()) return;
    if (n++ === index) found = offset + 1;
  });
  return found;
}
