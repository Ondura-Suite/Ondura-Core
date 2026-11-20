// Editor of Ondura Notizen: tiptap with OneNote-compatible HTML. Note tags
// ("Kategorien": To Do, Wichtig, Frage …) are `data-tag` attributes on
// paragraphs as in the OneNote API's page HTML; `data-one-id` keeps the OneNote
// element id of a block so changes can be written back block by block.

import { Extension, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { getHTMLFromFragment } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { tl } from "../../lib/i18n";

/** Note tags (OneNote's `data-tag` values). */
export const TAGS = [
  { id: "to-do", label: () => tl("Aufgabe"), icon: "☐" },
  { id: "important", label: () => tl("Wichtig"), icon: "★" },
  { id: "question", label: () => tl("Frage"), icon: "?" },
  { id: "remember-for-later", label: () => tl("Für später merken"), icon: "◆" },
  { id: "idea", label: () => tl("Idee"), icon: "💡" },
  { id: "critical", label: () => tl("Kritisch"), icon: "!" },
] as const;

const BLOCK_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "table", "image", "blockquote", "codeBlock"];

/** `data-tag` on paragraphs and headings, `data-one-id` on every block. */
const NoteAttributes = Extension.create({
  name: "noteAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          tag: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-tag"),
            renderHTML: (a: { tag?: string | null }) => (a.tag ? { "data-tag": a.tag } : {}),
          },
        },
      },
      {
        types: BLOCK_TYPES,
        attributes: {
          oneId: {
            default: null,
            // OneNote's generated ids look like "p:{guid}{12}".
            parseHTML: (el: HTMLElement) => el.getAttribute("data-one-id") || (/^[a-z0-9]+:\{/i.test(el.id) ? el.id : null),
            renderHTML: (a: { oneId?: string | null }) => (a.oneId ? { "data-one-id": a.oneId } : {}),
          },
        },
      },
    ];
  },
});

export function noteExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    Highlight.configure({ multicolor: true }),
    Image.configure({ allowBase64: true, inline: false }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyleKit,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder: () => tl("Hier tippen, um Notizen zu schreiben …") }),
    NoteAttributes,
  ];
}

/** Sets, toggles or clears the tag of the paragraphs in the selection. */
export function setTag(editor: Editor, tag: string | null) {
  const { from, to } = editor.state.selection;
  const tr = editor.state.tr;
  let current: string | null | undefined;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") current ??= node.attrs.tag as string | null;
  });
  const next = tag && current?.replace(/:completed$/, "") === tag ? null : tag;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") tr.setNodeMarkup(pos, undefined, { ...node.attrs, tag: next });
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

/** Toggles a to-do tag between open and done (click on its box). */
export function toggleDone(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const tag = node.attrs.tag as string | null;
  if (!tag?.startsWith("to-do")) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tag: tag === "to-do" ? "to-do:completed" : "to-do" }));
}

/** Top-level blocks as HTML with their OneNote ids (ids stripped from the HTML). */
export function editorBlocks(editor: Editor): { id: string | null; html: string }[] {
  const out: { id: string | null; html: string }[] = [];
  editor.state.doc.forEach((node) => {
    const id = (node.attrs.oneId as string | null) ?? null;
    const html = getHTMLFromFragment(Fragment.from(node), editor.schema).replace(/ data-one-id="[^"]*"/g, "");
    out.push({ id, html: forOneNote(html) });
  });
  return out;
}

/** Adjusts editor HTML to what OneNote's input HTML accepts. */
export function forOneNote(html: string): string {
  return (
    html
      // Checked/unchecked to-dos keep their tag; OneNote has no <mark>, it uses spans.
      .replace(/<mark data-color="([^"]+)"[^>]*>/g, '<span style="background-color:$1">')
      .replace(/<mark[^>]*>/g, '<span style="background-color:yellow">')
      .replace(/<\/mark>/g, "</span>")
      .replace(/<colgroup>.*?<\/colgroup>/g, "")
  );
}

/** Plain text of HTML (search, page previews). */
export function htmlText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
