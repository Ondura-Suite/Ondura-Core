// Editor extensions of Nexora Text: Word-like paragraph formatting, page
// breaks, page number fields, table cell shading and find & replace.

import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Pagination } from "./pagination";
import { CommentMark, DeletionMark, Footnote, InsertionMark, Toc, TrackChanges } from "./review";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    nexoraText: {
      setPageBreak: () => ReturnType;
      insertField: (field: "page" | "pages") => ReturnType;
      indent: (delta: number) => ReturnType;
      setParagraphSpacing: (attrs: { spaceBefore?: number | null; spaceAfter?: number | null; indent?: number | null; firstLine?: number | null; lineHeight?: string | null }) => ReturnType;
      setDocStyle: (style: string) => ReturnType;
      setCellBackground: (color: string | null) => ReturnType;
    };
  }
}

const num = (v: string | null | undefined) => (v == null || v === "" ? null : Number(v));

/** Indents, spacing and the title/subtitle styles on paragraphs and headings. */
const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: null,
            parseHTML: (el) => num(el.getAttribute("data-indent")),
            renderHTML: (a) => (a.indent ? { "data-indent": a.indent, style: `margin-left:${a.indent}mm` } : {}),
          },
          firstLine: {
            default: null,
            parseHTML: (el) => num(el.getAttribute("data-first-line")),
            renderHTML: (a) => (a.firstLine ? { "data-first-line": a.firstLine, style: `text-indent:${a.firstLine}mm` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => num(el.getAttribute("data-space-before")),
            renderHTML: (a) => (a.spaceBefore != null ? { "data-space-before": a.spaceBefore, style: `margin-top:${a.spaceBefore}pt` } : {}),
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => num(el.getAttribute("data-space-after")),
            renderHTML: (a) => (a.spaceAfter != null ? { "data-space-after": a.spaceAfter, style: `margin-bottom:${a.spaceAfter}pt` } : {}),
          },
        },
      },
      {
        types: ["paragraph"],
        attributes: {
          docStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-style"),
            renderHTML: (a) => (a.docStyle ? { "data-style": a.docStyle } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      indent:
        (delta) =>
        ({ editor, chain, tr, state, dispatch }) => {
          if (editor.isActive("listItem")) return delta > 0 ? chain().sinkListItem("listItem").run() : chain().liftListItem("listItem").run();
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === "paragraph" || node.type.name === "heading") {
              const cur = Number(node.attrs.indent) || 0;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.max(0, Math.round((cur + delta * 12.5) * 10) / 10) || null });
              return false;
            }
            return true;
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      setParagraphSpacing:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === "paragraph" || node.type.name === "heading") {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
              return false;
            }
            return true;
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      setDocStyle:
        (style) =>
        ({ chain }) => {
          const c = chain().focus();
          if (style.startsWith("heading")) return c.setNode("heading", { level: Number(style.slice(7)) || 1 }).run();
          if (style === "quote") return c.setNode("paragraph", { docStyle: null }).toggleBlockquote().run();
          if (style === "code") return c.toggleCodeBlock().run();
          return c.setNode("paragraph", { docStyle: style === "normal" ? null : style }).run();
        },
    };
  },
});

/** Manual page break (Ctrl+Enter). */
const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "nx-page-break" }), ["span", "Seitenumbruch"]],
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: "pageBreak" }, { type: "paragraph" }]).run(),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  },
});

/** Page number / page count field. The real value is shown in header/footer. */
const Field = Node.create({
  name: "field",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ field: { default: "page" } }),
  parseHTML: () => [{ tag: "span[data-field]", getAttrs: (el) => ({ field: (el as HTMLElement).getAttribute("data-field") }) }],
  renderHTML: ({ node }) => ["span", { "data-field": node.attrs.field, class: "nx-field" }, node.attrs.field === "pages" ? "#" : "#"],
  addCommands() {
    return {
      insertField:
        (field) =>
        ({ chain }) =>
          chain().insertContent({ type: "field", attrs: { field } }).run(),
    };
  },
});

const cellBackground = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-background"),
    renderHTML: (a: Record<string, unknown>) => (a.background ? { "data-background": a.background, style: `background-color:${a.background}` } : {}),
  },
};

const ShadedCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });
const ShadedHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });

const CellCommands = Extension.create({
  name: "cellCommands",
  addCommands() {
    return {
      setCellBackground:
        (color) =>
        ({ commands }) =>
          commands.setCellAttribute("background", color),
    };
  },
});

// ------------------------------------------------------- find & replace --

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: { from: number; to: number }[];
  index: number;
}

export const searchKey = new PluginKey<SearchState>("nexoraSearch");

function findMatches(doc: import("@tiptap/pm/model").Node, query: string, caseSensitive: boolean) {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const q = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text of the block with positions; atoms count as one placeholder char.
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) {
          text += child.text![i];
          map.push(start + i);
        }
      } else {
        text += "￼";
        map.push(start);
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(q);
    while (i >= 0) {
      out.push({ from: map[i], to: map[i + q.length - 1] + 1 });
      i = hay.indexOf(q, i + Math.max(1, q.length));
    }
    return false;
  });
  return out;
}

const Search = Extension.create({
  name: "search",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: "", caseSensitive: false, matches: [], index: 0 }),
          apply(tr, prev) {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            const matches = findMatches(tr.doc, query, caseSensitive);
            const index = Math.min(meta?.index ?? prev.index, Math.max(0, matches.length - 1));
            return { query, caseSensitive, matches, index };
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "nx-find nx-find-current" : "nx-find" })),
            );
          },
        },
      }),
    ];
  },
});

export function setSearch(editor: Editor, query: string, caseSensitive: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, caseSensitive, index: 0 }));
  revealMatch(editor);
}

export function searchState(editor: Editor): SearchState | undefined {
  return searchKey.getState(editor.state);
}

function revealMatch(editor: Editor) {
  const s = searchState(editor);
  const m = s?.matches[s.index];
  if (!m) return;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView());
}

export function stepSearch(editor: Editor, dir: 1 | -1) {
  const s = searchState(editor);
  if (!s?.matches.length) return;
  const index = (s.index + dir + s.matches.length) % s.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { index }));
  revealMatch(editor);
}

export function replaceCurrent(editor: Editor, replacement: string) {
  const s = searchState(editor);
  const m = s?.matches[s.index];
  if (!m) return;
  editor.chain().insertContentAt({ from: m.from, to: m.to }, replacement).run();
  revealMatch(editor);
}

export function replaceAll(editor: Editor, replacement: string): number {
  const s = searchState(editor);
  if (!s?.matches.length) return 0;
  const tr = editor.state.tr;
  // Back to front so positions stay valid.
  for (const m of [...s.matches].reverse()) {
    if (replacement) tr.insertText(replacement, m.from, m.to);
    else tr.delete(m.from, m.to);
  }
  editor.view.dispatch(tr);
  return s.matches.length;
}

// ------------------------------------------------------------- assembly --

export interface TextExtensionOptions {
  pagination: Parameters<typeof Pagination.configure>[0];
  author: () => string;
}

export function textExtensions(o: TextExtensionOptions) {
  return [
    StarterKit.configure({
      horizontalRule: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    Table.configure({ resizable: true, cellMinWidth: 30 }),
    TableRow,
    ShadedHeader,
    ShadedCell,
    CellCommands,
    Image.configure({ inline: true, allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 16, minHeight: 16 } }),
    CharacterCount,
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? "Beginne zu schreiben…" : ""), showOnlyWhenEditable: true }),
    ParagraphFormat,
    PageBreak,
    Field,
    Search,
    CommentMark,
    InsertionMark,
    DeletionMark,
    Footnote,
    Toc,
    TrackChanges.configure({ author: o.author }),
    Pagination.configure(o.pagination),
  ];
}
