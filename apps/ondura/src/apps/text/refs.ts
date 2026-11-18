// References (Referenzen): caption numbers, cross-references, index entries,
// citations and their generated lists (table of figures, index,
// bibliography), plus simple document fields and mail merge placeholders.

import { Extension, Node, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { IndexEntry, Source, TocEntry } from "./model";

export interface RefStorage {
  sources: Source[];
  /** For date/author/title/filename fields. */
  meta: { author: string; title: string; file: string };
  /** Mail merge preview: values of the current record (null = show «Feld»). */
  record: Record<string, string> | null;
}

declare module "@tiptap/core" {
  interface Storage {
    refs: RefStorage;
  }
}

const refsKey = new PluginKey("onduraRefs");

// ------------------------------------------------------------ formatting --

const lastNames = (author: string) =>
  author
    .split(";")
    .map((a) => a.split(",")[0].trim())
    .filter(Boolean);

/** In-text citation, APA style: (Linz & Muster, 2026). */
export function citationText(s: Source | undefined, tag: string): string {
  if (!s) return `(${tag})`;
  const names = lastNames(s.author);
  const who = names.length === 0 ? s.title : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
  return `(${who}${s.year ? `, ${s.year}` : ""})`;
}

/** Bibliography entry, APA style. */
export function bibliographyText(s: Source): string {
  const people = s.author
    .split(";")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      const [last, first] = a.split(",").map((x) => x.trim());
      const initials = (first ?? "")
        .split(/[\s-]+/)
        .filter(Boolean)
        .map((n) => `${n[0]}.`)
        .join(" ");
      return initials ? `${last}, ${initials}` : last;
    });
  const authors = people.length > 1 ? `${people.slice(0, -1).join(", ")}, & ${people[people.length - 1]}` : (people[0] ?? "");
  const year = s.year ? ` (${s.year}).` : " (o. J.).";
  const title = s.title ? ` ${s.title}.` : "";
  switch (s.kind) {
    case "article":
      return `${authors}${year}${title}${s.journal ? ` ${s.journal}` : ""}${s.pages ? `, ${s.pages}` : ""}.`;
    case "web":
      return `${authors}${year}${title}${s.url ? ` ${s.url}` : ""}`;
    default:
      return `${authors}${year}${title}${s.city ? ` ${s.city}` : ""}${s.city && s.publisher ? ":" : ""}${s.publisher ? ` ${s.publisher}` : ""}.`.replace(/\.\.$/, ".");
  }
}

// --------------------------------------------------------- field results --

/** Results of seq, ref and cite fields for the whole document. */
/** Field results by position; null = no result (merge field outside the preview). */
function computeResults(doc: PmNode, storage: RefStorage): Map<number, string | null> {
  const out = new Map<number, string | null>();
  const counters = new Map<string, number>();
  const seqAt = new Map<number, string>();
  // Pass 1: caption numbers.
  doc.descendants((n, pos) => {
    if (n.type.name !== "field") return;
    const f = String(n.attrs.field);
    if (f.startsWith("seq ")) {
      const label = f.slice(4);
      const v = (counters.get(label) ?? 0) + 1;
      counters.set(label, v);
      seqAt.set(pos, String(v));
      out.set(pos, String(v));
    }
  });
  // Pass 2: text of every bookmark (with caption numbers resolved).
  const marks = new Map<string, string>();
  const open = new Map<string, string>();
  doc.descendants((n, pos) => {
    if (n.type.name === "bookmark") {
      const name = String(n.attrs.name);
      if (n.attrs.end) {
        if (open.has(name)) marks.set(name, open.get(name)!.trim());
        open.delete(name);
      } else open.set(name, "");
      return;
    }
    if (!open.size) return;
    const piece = n.isText ? (n.text ?? "") : n.type.name === "field" ? (seqAt.get(pos) ?? String(n.attrs.result ?? "")) : "";
    if (piece) for (const k of open.keys()) open.set(k, open.get(k)! + piece);
  });
  const sources = new Map(storage.sources.map((s) => [s.tag, s]));
  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  doc.descendants((n, pos) => {
    if (n.type.name !== "field") return;
    const f = String(n.attrs.field);
    const [kind, ...rest] = f.split(" ");
    const arg = rest.join(" ");
    if (kind === "ref") out.set(pos, marks.get(arg) ?? "Fehler! Verweisquelle konnte nicht gefunden werden.");
    else if (kind === "cite") out.set(pos, citationText(sources.get(arg), arg));
    else if (kind === "date") out.set(pos, date);
    else if (kind === "author") out.set(pos, storage.meta.author);
    else if (kind === "title") out.set(pos, storage.meta.title);
    else if (kind === "filename") out.set(pos, storage.meta.file);
    else if (kind === "merge") out.set(pos, storage.record ? (storage.record[arg] ?? "") : null);
  });
  return out;
}

/** Shown text of a field node (merge fields without preview show «Feld»). */
export function fieldDisplay(field: string, result: string | null | undefined): string {
  const [kind, ...rest] = field.split(" ");
  const arg = rest.join(" ");
  if (kind === "page" || kind === "pages") return "#";
  if (kind === "xe") return "";
  if (kind === "merge") return result ?? `«${arg}»`;
  return result || (kind === "seq" ? "1" : kind === "cite" ? `(${arg})` : "");
}

// ----------------------------------------------------------------- nodes --

export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ name: { default: "" }, end: { default: false } }),
  parseHTML: () => [{ tag: "span[data-bookmark]", getAttrs: (el) => ({ name: (el as HTMLElement).getAttribute("data-bookmark"), end: (el as HTMLElement).hasAttribute("data-end") }) }],
  renderHTML: ({ node }) => ["span", { "data-bookmark": node.attrs.name, ...(node.attrs.end ? { "data-end": "" } : {}), class: "nx-bookmark" }],
});

const listNode = (name: string, cls: string, render: (attrs: Record<string, unknown>) => unknown[]) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    addAttributes: () => ({ title: { default: null }, entries: { default: [] } }),
    parseHTML: () => [{ tag: `div[data-${name}]` }],
    renderHTML: ({ node }) => ["div", { [`data-${name}`]: "", class: cls }, ...render(node.attrs)] as never,
  });

export const DocIndex = listNode("docIndex", "nx-index", (a) => {
  const entries = (a.entries as IndexEntry[]) ?? [];
  if (!entries.length) return [["div", { class: "nx-toc-empty" }, "Keine Indexeinträge. Begriffe mit „Eintrag markieren“ aufnehmen."]];
  const out: unknown[] = [];
  let letter = "";
  for (const e of entries) {
    const l = e.term.charAt(0).toLocaleUpperCase("de");
    if (l !== letter) {
      letter = l;
      out.push(["div", { class: "nx-index-letter" }, l]);
    }
    out.push(["div", { class: "nx-toc-entry" }, ["span", { class: "nx-toc-text" }, e.term], ["span", { class: "nx-toc-dots" }], ["span", { class: "nx-toc-page" }, e.pages]]);
  }
  return [["div", { class: "nx-index-cols" }, ...out]];
});

export const Bibliography = listNode("bibliography", "nx-bibliography", (a) => {
  const entries = (a.entries as string[]) ?? [];
  return [
    ["div", { class: "nx-toc-title" }, (a.title as string) || "Literaturverzeichnis"],
    ...(entries.length ? entries.map((e) => ["div", { class: "nx-bib-entry" }, e]) : [["div", { class: "nx-toc-empty" }, "Im Dokument sind keine Quellen zitiert."]]),
  ];
});

// ------------------------------------------------------------- extension --

export const References = Extension.create({
  name: "refs",
  addStorage: (): RefStorage => ({ sources: [], meta: { author: "", title: "", file: "" }, record: null }),
  addProseMirrorPlugins() {
    const storage = this.storage as RefStorage;
    return [
      new Plugin({
        key: refsKey,
        // Keeps field results current: caption numbers, cross-reference
        // texts, citations, simple fields and the mail merge preview.
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged || t.getMeta(refsKey))) return null;
          const results = computeResults(state.doc, storage);
          let tr = null as ReturnType<typeof state.tr.setNodeMarkup> | null;
          for (const [pos, value] of results) {
            const n = state.doc.nodeAt(pos);
            if (!n || n.type.name !== "field" || (value === null ? n.attrs.result == null : (n.attrs.result ?? "") === value)) continue;
            tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...n.attrs, result: value });
          }
          return tr ? tr.setMeta("addToHistory", false).setMeta("onduraTrack", true) : null;
        },
      }),
    ];
  },
});

/** Recomputes all fields (after changing sources, metadata or the merge record). */
export function refreshFields(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(refsKey, true).setMeta("addToHistory", false));
}

// -------------------------------------------------------------- commands --

const uid = () => `_Ref${Math.floor(Math.random() * 1e9)}`;

/** Inserts a caption ("Abbildung 1: …") below the current block. */
export function insertCaption(editor: Editor, label: string, text: string, above: boolean) {
  const { state } = editor;
  const $from = state.selection.$from;
  // Position after (or before) the top-level block that holds the cursor.
  const depth = Math.max(1, $from.depth > 0 ? 1 : 0);
  const at = above ? $from.before(depth) : $from.after(depth);
  const name = uid();
  editor
    .chain()
    .focus()
    .insertContentAt(at, {
      type: "paragraph",
      attrs: { docStyle: "caption" },
      content: [
        { type: "bookmark", attrs: { name, end: false } },
        { type: "text", text: `${label} ` },
        { type: "field", attrs: { field: `seq ${label}`, result: null } },
        { type: "bookmark", attrs: { name, end: true } },
        ...(text ? [{ type: "text", text: `: ${text}` }] : []),
      ],
    })
    .run();
}

export interface CaptionTarget {
  /** Bookmark name. */
  name: string;
  label: string;
  /** Whole caption text, for the list. */
  text: string;
  /** "Abbildung 1" */
  short: string;
}

/** Captions with a bookmark (cross-reference targets) and headings. */
export function captionTargets(editor: Editor): CaptionTarget[] {
  const out: CaptionTarget[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name !== "paragraph" || n.attrs.docStyle !== "caption") return;
    let name = "";
    let label = "";
    n.forEach((c) => {
      if (c.type.name === "bookmark" && !c.attrs.end && !name) name = String(c.attrs.name);
      if (c.type.name === "field" && String(c.attrs.field).startsWith("seq ") && !label) label = String(c.attrs.field).slice(4);
    });
    if (!name) return false;
    let text = "";
    let short = "";
    let inMark = false;
    n.forEach((c) => {
      const piece = c.isText ? (c.text ?? "") : c.type.name === "field" ? String(c.attrs.result ?? "") : "";
      if (c.type.name === "bookmark" && String(c.attrs.name) === name) inMark = !c.attrs.end;
      text += piece;
      if (inMark) short += piece;
    });
    out.push({ name, label, text: text.trim(), short: short.trim() });
    return false;
  });
  return out;
}

export function insertField(editor: Editor, field: string) {
  editor.chain().focus().insertContent({ type: "field", attrs: { field, result: null } }).run();
}

// ----------------------------------------------------- generated lists --

/** Page of each top-level block, from the pagination spacers. */
function pageOf(editor: Editor): (pos: number) => number {
  const view = editor.view;
  const spacers = Array.from(view.dom.querySelectorAll<HTMLElement>(":scope > .nx-page-spacer")).map((s) => s.offsetTop);
  return (pos: number) => {
    let top = 0;
    try {
      const dom = view.domAtPos(pos).node as HTMLElement;
      top = (dom.nodeType === 1 ? dom : dom.parentElement)?.offsetTop ?? 0;
      // offsetTop is relative to the editor only for top-level blocks.
      let el: HTMLElement | null = dom.nodeType === 1 ? dom : dom.parentElement;
      while (el && el.parentElement !== view.dom) el = el.parentElement;
      top = el?.offsetTop ?? top;
    } catch {
      /* position not rendered */
    }
    return 1 + spacers.filter((s) => s < top).length;
  };
}

export function figureEntries(editor: Editor, label: string): TocEntry[] {
  const page = pageOf(editor);
  const out: TocEntry[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name !== "paragraph" || n.attrs.docStyle !== "caption") return;
    let has = false;
    n.forEach((c) => {
      if (c.type.name === "field" && c.attrs.field === `seq ${label}`) has = true;
    });
    if (has) out.push({ level: 1, text: textOf(n), page: page(pos + 1) });
    return false;
  });
  return out;
}

function textOf(n: PmNode): string {
  let t = "";
  n.descendants((c) => {
    if (c.isText) t += c.text ?? "";
    else if (c.type.name === "field") t += fieldDisplay(String(c.attrs.field), c.attrs.result);
  });
  return t.trim();
}

export function indexEntries(editor: Editor): IndexEntry[] {
  const page = pageOf(editor);
  const pages = new Map<string, Set<number>>();
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name !== "field" || !String(n.attrs.field).startsWith("xe ")) return;
    const term = String(n.attrs.field).slice(3).trim();
    if (!term) return;
    if (!pages.has(term)) pages.set(term, new Set());
    pages.get(term)!.add(page(pos));
  });
  return [...pages.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "de", { sensitivity: "base" }))
    .map(([term, ps]) => ({ term, pages: [...ps].sort((a, b) => a - b).join(", ") }));
}

export function bibliographyEntries(editor: Editor, sources: Source[]): string[] {
  const cited = new Set<string>();
  editor.state.doc.descendants((n) => {
    if (n.type.name === "field" && String(n.attrs.field).startsWith("cite ")) cited.add(String(n.attrs.field).slice(5));
  });
  return sources
    .filter((s) => cited.has(s.tag))
    .sort((a, b) => lastNames(a.author)[0]?.localeCompare(lastNames(b.author)[0] ?? "", "de") ?? 0)
    .map(bibliographyText);
}

/** Updates tables of figures, indexes and bibliographies; true if something changed. */
export function updateLists(editor: Editor): boolean {
  const sources = (editor.storage as unknown as { refs?: RefStorage }).refs?.sources ?? [];
  const tr = editor.state.tr.setMeta("onduraTrack", true);
  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    let entries: unknown = null;
    if (node.type.name === "toc" && node.attrs.caption) entries = figureEntries(editor, node.attrs.caption);
    else if (node.type.name === "docIndex") entries = indexEntries(editor);
    else if (node.type.name === "bibliography") entries = bibliographyEntries(editor, sources);
    else return;
    if (JSON.stringify(entries) !== JSON.stringify(node.attrs.entries)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, entries });
      changed = true;
    }
    return false;
  });
  if (changed) editor.view.dispatch(tr);
  return changed;
}
