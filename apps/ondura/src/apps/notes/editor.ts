// Editor of Ondura Notizen: tiptap with OneNote-compatible HTML. Note tags
// ("Kategorien": To Do, Wichtig, Frage …) are `data-tag` attributes on
// paragraphs as in the OneNote API's page HTML; `data-one-id` keeps the OneNote
// element id of a block so changes can be written back block by block.

import { Extension, Node, type Editor } from "@tiptap/react";
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

const BLOCK_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "table", "image", "blockquote", "codeBlock", "oneEmbed"];

const EMBED_TAGS = new Set(["svg", "path", "span", "br"]);
const EMBED_ATTRS = new Set(["xmlns", "viewbox", "width", "height", "d", "fill", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin"]);

/**
 * Embed content comes from OneNote pages (generated SVG ink, escaped text)
 * but could also arrive through pasted HTML, so only the few elements and
 * attributes Ondura itself produces survive.
 */
export function cleanEmbed(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!EMBED_TAGS.has(child.localName)) {
        child.replaceWith(doc.createTextNode(child.textContent ?? ""));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const ok = EMBED_ATTRS.has(name) ? !/url\(|javascript:/i.test(attr.value) : name === "style" && /^mix-blend-mode:\s*multiply;?$/.test(attr.value.trim());
        if (!ok) child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * Read-only OneNote content (ink, attachments, videos, text outside
 * paragraphs): an atom that keeps its HTML and is never written back.
 */
const OneEmbed = Node.create({
  name: "oneEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: { default: "text", parseHTML: (el: HTMLElement) => el.getAttribute("data-one-embed") || "text", rendered: false },
      src: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-src"), rendered: false },
      name: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-name"), rendered: false },
      html: { default: "", parseHTML: (el: HTMLElement) => cleanEmbed(el.innerHTML), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-one-embed]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const dom = document.createElement("div");
    dom.setAttribute("data-one-embed", node.attrs.kind as string);
    for (const [k, v] of Object.entries(HTMLAttributes)) if (v != null) dom.setAttribute(k, String(v));
    if (node.attrs.src) dom.setAttribute("data-src", node.attrs.src as string);
    if (node.attrs.name) dom.setAttribute("data-name", node.attrs.name as string);
    dom.setAttribute("contenteditable", "false");
    dom.setAttribute("title", node.attrs.kind === "file" ? tl("Anhang speichern") : node.attrs.kind === "video" ? tl("Video öffnen") : tl("Nur in OneNote bearbeitbar"));
    dom.className = "nx-one-embed";
    dom.innerHTML = cleanEmbed(node.attrs.html as string);
    return { dom };
  },
});

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
    OneEmbed,
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
