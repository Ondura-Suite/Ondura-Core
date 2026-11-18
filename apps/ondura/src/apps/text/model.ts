// The document model shared with the Rust side (crates/office/src/docx.rs)
// and its conversion to and from the ProseMirror document of the editor.

import type { JSONContent } from "@tiptap/react";

export interface PageSetup {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  headerMm: number;
  footerMm: number;
}

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  font?: string;
  size?: number;
  color?: string;
  highlight?: string;
  link?: string;
  comment?: number;
  ins?: Revision;
  del?: Revision;
}

export interface Revision {
  author: string;
  date: string;
}

export interface Comment {
  id: number;
  author: string;
  date: string;
  text: string;
}

export interface TocEntry {
  level: number;
  text: string;
  page: number;
}

export type Inline =
  | { type: "text"; text: string; marks?: Marks }
  | { type: "break" }
  | { type: "tab" }
  | { type: "image"; src: string; width: number; height: number; alt?: string }
  /** page, pages, date, author, title, filename, "seq <Label>", "ref <bookmark>", "merge <column>", "xe <term>", "cite <tag>". */
  | { type: "field"; field: "page" | "pages" | string; result?: string }
  | { type: "bookmark"; name: string; end?: boolean }
  /** Content control (form field). */
  | { type: "control"; kind: string; title?: string; value?: string; checked?: boolean; items?: string[]; format?: string; placeholder?: boolean; marks?: Marks }
  | { type: "footnote"; text: string; endnote?: boolean };

export interface Paragraph {
  type: "paragraph";
  style?: string;
  align?: string;
  list?: { ordered: boolean; level: number };
  indentMm?: number;
  firstLineMm?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  lineHeight?: number;
  content: Inline[];
}

export interface Cell {
  colSpan: number;
  rowSpan: number;
  background?: string;
  blocks: Block[];
}

export interface Table {
  type: "table";
  columnsMm: number[];
  rows: { header?: boolean; cells: Cell[] }[];
}

export type Block =
  | Paragraph
  | Table
  | { type: "pageBreak" }
  /** End of a section; `page` is the setup of the section that ends here. */
  | { type: "sectionBreak"; page: PageSetup }
  | { type: "toc"; title?: string | null; entries: TocEntry[]; caption?: string | null }
  | { type: "index"; entries: IndexEntry[] }
  | { type: "bibliography"; title?: string | null; entries: string[] };

export interface IndexEntry {
  term: string;
  pages: string;
}

/** A source for citations (Quellen verwalten). */
export interface Source {
  tag: string;
  /** book, article, web, report */
  kind: string;
  /** "Last, First; Last, First" */
  author: string;
  title: string;
  year: string;
  publisher?: string;
  city?: string;
  journal?: string;
  pages?: string;
  url?: string;
}

export interface TextDocument {
  page: PageSetup;
  blocks: Block[];
  header: Block[];
  footer: Block[];
  title: string;
  author: string;
  defaultFont?: string | null;
  defaultSize?: number | null;
  differentFirst?: boolean;
  headerFirst?: Block[];
  footerFirst?: Block[];
  comments?: Comment[];
  sources?: Source[];
  /** Built-in paragraph styles with a changed look. */
  styles?: StyleDef[];
}

/** Changed look of a built-in paragraph style (unset = default). */
export interface StyleDef {
  id: string;
  font?: string | null;
  size?: number | null;
  color?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  spaceBefore?: number | null;
  spaceAfter?: number | null;
  align?: string | null;
}

export const A4: PageSetup = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 25,
  marginBottomMm: 20,
  marginLeftMm: 25,
  marginRightMm: 20,
  headerMm: 12.5,
  footerMm: 12.5,
};

export const mmToPx = (mm: number) => (mm * 96) / 25.4;
export const pxToMm = (px: number) => (px * 25.4) / 96;

export function emptyDocument(): TextDocument {
  return { page: { ...A4 }, blocks: [{ type: "paragraph", content: [] }], header: [], footer: [], title: "", author: "" };
}

// ------------------------------------------------------------ model → PM --

function marksToPm(m?: Marks): JSONContent["marks"] {
  if (!m) return undefined;
  const out: NonNullable<JSONContent["marks"]> = [];
  if (m.bold) out.push({ type: "bold" });
  if (m.italic) out.push({ type: "italic" });
  if (m.underline) out.push({ type: "underline" });
  if (m.strike) out.push({ type: "strike" });
  if (m.superscript) out.push({ type: "superscript" });
  if (m.subscript) out.push({ type: "subscript" });
  if (m.link) out.push({ type: "link", attrs: { href: m.link } });
  if (m.comment != null) out.push({ type: "comment", attrs: { id: m.comment } });
  if (m.ins) out.push({ type: "insertion", attrs: { author: m.ins.author, date: m.ins.date } });
  if (m.del) out.push({ type: "deletion", attrs: { author: m.del.author, date: m.del.date } });
  if (m.highlight) out.push({ type: "highlight", attrs: { color: m.highlight } });
  if (m.font || m.size || m.color) {
    out.push({ type: "textStyle", attrs: { fontFamily: m.font ?? null, fontSize: m.size ? `${m.size}pt` : null, color: m.color ?? null } });
  }
  return out.length ? out : undefined;
}

function inlinesToPm(content: Inline[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const i of content) {
    switch (i.type) {
      case "text":
        if (i.text) out.push({ type: "text", text: i.text, marks: marksToPm(i.marks) });
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "tab":
        out.push({ type: "text", text: "\t" });
        break;
      case "image":
        out.push({ type: "image", attrs: { src: i.src, width: Math.round(i.width), height: Math.round(i.height), alt: i.alt ?? null } });
        break;
      case "field":
        out.push({ type: "field", attrs: { field: i.field, result: i.result ?? null } });
        break;
      case "control":
        out.push({
          type: "contentControl",
          attrs: { kind: i.kind, title: i.title ?? "", value: i.value ?? "", checked: !!i.checked, items: i.items ?? [], format: i.format ?? "", placeholder: !!i.placeholder },
          ...(marksToPm(i.marks) ? { marks: marksToPm(i.marks) } : {}),
        });
        break;
      case "bookmark":
        out.push({ type: "bookmark", attrs: { name: i.name, end: !!i.end } });
        break;
      case "footnote":
        out.push({ type: "footnote", attrs: { text: i.text, endnote: !!i.endnote } });
        break;
    }
  }
  return out;
}

function paragraphAttrs(p: Paragraph) {
  return {
    textAlign: p.align ?? null,
    indent: p.indentMm || null,
    firstLine: p.firstLineMm || null,
    spaceBefore: p.spaceBeforePt ?? null,
    spaceAfter: p.spaceAfterPt ?? null,
    lineHeight: p.lineHeight ? String(p.lineHeight) : null,
  };
}

function paragraphToPm(p: Paragraph): JSONContent {
  const content = inlinesToPm(p.content);
  const attrs = paragraphAttrs(p);
  const level = p.style?.startsWith("heading") ? Number(p.style.slice(7)) || 1 : 0;
  if (level) return { type: "heading", attrs: { ...attrs, level: Math.min(6, level) }, content: content.length ? content : undefined };
  const docStyle = p.style === "title" || p.style === "subtitle" || p.style === "caption" ? p.style : null;
  return { type: "paragraph", attrs: { ...attrs, docStyle }, content: content.length ? content : undefined };
}

function tableToPm(t: Table): JSONContent {
  const widths = t.columnsMm.map((w) => Math.round(mmToPx(w)));
  return {
    type: "table",
    content: t.rows.map((r) => {
      let col = 0;
      return {
        type: "tableRow",
        content: r.cells.map((c) => {
          const span = Math.max(1, c.colSpan);
          const colwidth = widths.length >= col + span ? widths.slice(col, col + span) : null;
          col += span;
          const blocks = blocksToPm(c.blocks);
          return {
            type: r.header ? "tableHeader" : "tableCell",
            attrs: { colspan: span, rowspan: Math.max(1, c.rowSpan), colwidth, background: c.background ?? null },
            content: blocks.length ? blocks : [{ type: "paragraph" }],
          };
        }),
      };
    }),
  };
}

export function blocksToPm(blocks: Block[]): JSONContent[] {
  const out: JSONContent[] = [];
  // Open lists: stack of (list node, level).
  let stack: { node: JSONContent; level: number; ordered: boolean }[] = [];
  let quote: JSONContent | null = null;
  let code: JSONContent | null = null;

  for (const b of blocks) {
    const p = b.type === "paragraph" ? b : null;
    if (!p?.list) stack = [];
    if (p?.style !== "quote") quote = null;
    if (p?.style !== "code") code = null;

    if (b.type === "pageBreak") {
      out.push({ type: "pageBreak" });
    } else if (b.type === "sectionBreak") {
      out.push({ type: "sectionBreak", attrs: { page: b.page } });
    } else if (b.type === "toc") {
      out.push({ type: "toc", attrs: { title: b.title ?? null, entries: b.entries, caption: b.caption ?? null } });
    } else if (b.type === "index") {
      out.push({ type: "docIndex", attrs: { entries: b.entries } });
    } else if (b.type === "bibliography") {
      out.push({ type: "bibliography", attrs: { title: b.title ?? null, entries: b.entries } });
    } else if (b.type === "table") {
      out.push(tableToPm(b));
    } else if (p!.list) {
      const { ordered, level } = p!.list;
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      const top = stack[stack.length - 1];
      if (top && top.level === level && top.ordered !== ordered) stack.pop();
      let list = stack[stack.length - 1];
      if (!list || list.level < level) {
        const node: JSONContent = { type: ordered ? "orderedList" : "bulletList", content: [] };
        if (!list) out.push(node);
        else {
          const items = list.node.content!;
          if (!items.length) items.push({ type: "listItem", content: [{ type: "paragraph" }] });
          items[items.length - 1].content!.push(node);
        }
        list = { node, level, ordered };
        stack.push(list);
      }
      list.node.content!.push({ type: "listItem", content: [paragraphToPm({ ...p!, list: undefined, indentMm: 0, firstLineMm: 0 })] });
    } else if (p!.style === "quote") {
      if (!quote) {
        quote = { type: "blockquote", content: [] };
        out.push(quote);
      }
      quote.content!.push(paragraphToPm({ ...p!, style: undefined }));
    } else if (p!.style === "code") {
      const text = p!.content.map((i) => (i.type === "text" ? i.text : i.type === "tab" ? "\t" : i.type === "break" ? "\n" : "")).join("");
      if (!code) {
        code = { type: "codeBlock", content: [] };
        out.push(code);
        if (text) code.content!.push({ type: "text", text });
      } else {
        const prev = code.content!.length ? (code.content![0].text ?? "") : "";
        code.content = [{ type: "text", text: `${prev}\n${text}` }];
      }
    } else {
      out.push(paragraphToPm(p!));
    }
  }
  return out;
}

export function documentToPm(doc: TextDocument): JSONContent {
  const content = blocksToPm(doc.blocks);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ------------------------------------------------------------ PM → model --

function pmMarks(marks: JSONContent["marks"]): Marks | undefined {
  if (!marks?.length) return undefined;
  const m: Marks = {};
  for (const mk of marks) {
    const a = mk.attrs ?? {};
    switch (mk.type) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "superscript":
      case "subscript":
        m[mk.type] = true;
        break;
      case "link":
        if (a.href) m.link = a.href;
        break;
      case "comment":
        if (a.id != null) m.comment = Number(a.id);
        break;
      case "insertion":
        m.ins = { author: a.author ?? "", date: a.date ?? "" };
        break;
      case "deletion":
        m.del = { author: a.author ?? "", date: a.date ?? "" };
        break;
      case "highlight":
        m.highlight = a.color || "#ffff00";
        break;
      case "textStyle": {
        if (a.fontFamily) m.font = String(a.fontFamily).split(",")[0].replace(/["']/g, "").trim();
        if (a.fontSize) {
          const v = parseFloat(a.fontSize);
          if (v) m.size = String(a.fontSize).endsWith("px") ? Math.round(v * 0.75 * 2) / 2 : v;
        }
        if (a.color) m.color = normalizeColor(a.color);
        break;
      }
    }
  }
  return Object.keys(m).length ? m : undefined;
}

/** `rgb(1, 2, 3)` / `#abc` → `#rrggbb`. */
export function normalizeColor(c: string): string {
  const s = c.trim();
  const rgb = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return "#" + rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/i.test(s)) return "#" + s.slice(1).split("").map((x) => x + x).join("").toLowerCase();
  return s.toLowerCase();
}

function pmInlines(nodes: JSONContent[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      const marks = pmMarks(n.marks);
      // Tabs are stored as characters in the editor.
      (n.text ?? "").split("\t").forEach((part, i) => {
        if (i > 0) out.push({ type: "tab" });
        if (part) out.push(marks ? { type: "text", text: part, marks } : { type: "text", text: part });
      });
    } else if (n.type === "hardBreak") out.push({ type: "break" });
    else if (n.type === "image") {
      const a = n.attrs ?? {};
      out.push({ type: "image", src: a.src, width: Number(a.width) || 200, height: Number(a.height) || 150, alt: a.alt ?? "" });
    } else if (n.type === "field") out.push({ type: "field", field: n.attrs?.field ?? "page", ...(n.attrs?.result ? { result: String(n.attrs.result) } : {}) });
    else if (n.type === "contentControl") {
      const a = n.attrs ?? {};
      const marks = pmMarks(n.marks);
      out.push({
        type: "control",
        kind: a.kind ?? "text",
        ...(a.title ? { title: a.title } : {}),
        value: a.value ?? "",
        ...(a.checked ? { checked: true } : {}),
        ...(a.items?.length ? { items: a.items } : {}),
        ...(a.format ? { format: a.format } : {}),
        ...(a.placeholder ? { placeholder: true } : {}),
        ...(marks ? { marks } : {}),
      });
    } else if (n.type === "bookmark") out.push({ type: "bookmark", name: n.attrs?.name ?? "", ...(n.attrs?.end ? { end: true } : {}) });
    else if (n.type === "footnote") out.push({ type: "footnote", text: n.attrs?.text ?? "", ...(n.attrs?.endnote ? { endnote: true } : {}) });
  }
  return out;
}

function pmParagraph(n: JSONContent, extra: Partial<Paragraph> = {}): Paragraph {
  const a = n.attrs ?? {};
  const p: Paragraph = { type: "paragraph", content: pmInlines(n.content) };
  if (n.type === "heading") p.style = `heading${a.level ?? 1}`;
  else if (a.docStyle) p.style = a.docStyle;
  if (a.textAlign && a.textAlign !== "left") p.align = a.textAlign;
  if (a.indent) p.indentMm = Number(a.indent);
  if (a.firstLine) p.firstLineMm = Number(a.firstLine);
  if (a.spaceBefore != null) p.spaceBeforePt = Number(a.spaceBefore);
  if (a.spaceAfter != null) p.spaceAfterPt = Number(a.spaceAfter);
  if (a.lineHeight) p.lineHeight = parseFloat(a.lineHeight) || undefined;
  return { ...p, ...extra };
}

function pmList(n: JSONContent, level: number, out: Block[]) {
  const ordered = n.type === "orderedList";
  for (const item of n.content ?? []) {
    let first = true;
    for (const c of item.content ?? []) {
      if (c.type === "bulletList" || c.type === "orderedList") pmList(c, level + 1, out);
      else if (c.type === "paragraph" || c.type === "heading") {
        out.push(pmParagraph(c, first ? { list: { ordered, level: Math.min(8, level) } } : { indentMm: 6.35 * (level + 1) }));
        first = false;
      } else out.push(...pmBlocks([c]));
    }
  }
}

function pmTable(n: JSONContent): Table {
  const rows = (n.content ?? []).map((r) => ({
    header: (r.content ?? []).length > 0 && (r.content ?? []).every((c) => c.type === "tableHeader"),
    cells: (r.content ?? []).map((c) => ({
      colSpan: Number(c.attrs?.colspan) || 1,
      rowSpan: Number(c.attrs?.rowspan) || 1,
      background: c.attrs?.background || undefined,
      blocks: pmBlocks(c.content ?? []),
    })),
  }));
  const columnsMm: number[] = [];
  // Column widths from the first row that defines all of them.
  for (const r of n.content ?? []) {
    const ws: number[] = [];
    for (const c of r.content ?? []) {
      const cw = c.attrs?.colwidth as number[] | null;
      const span = Number(c.attrs?.colspan) || 1;
      if (!cw || cw.length !== span) {
        ws.length = 0;
        break;
      }
      ws.push(...cw);
    }
    if (ws.length) {
      columnsMm.push(...ws.map((w) => Math.round(pxToMm(w) * 10) / 10));
      break;
    }
  }
  return { type: "table", columnsMm, rows };
}

export function pmBlocks(nodes: JSONContent[]): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph":
      case "heading":
        out.push(pmParagraph(n));
        break;
      case "bulletList":
      case "orderedList":
        pmList(n, 0, out);
        break;
      case "blockquote":
        for (const c of n.content ?? []) {
          if (c.type === "paragraph" || c.type === "heading") out.push(pmParagraph(c, { style: "quote" }));
          else out.push(...pmBlocks([c]));
        }
        break;
      case "codeBlock": {
        const text = (n.content ?? []).map((c) => c.text ?? "").join("");
        for (const line of text.split("\n")) out.push({ type: "paragraph", style: "code", content: line ? [{ type: "text", text: line }] : [] });
        break;
      }
      case "table":
        out.push(pmTable(n));
        break;
      case "pageBreak":
        out.push({ type: "pageBreak" });
        break;
      case "sectionBreak":
        out.push({ type: "sectionBreak", page: n.attrs?.page });
        break;
      case "toc":
        out.push({ type: "toc", title: n.attrs?.title ?? null, entries: n.attrs?.entries ?? [], ...(n.attrs?.caption ? { caption: n.attrs.caption } : {}) });
        break;
      case "docIndex":
        out.push({ type: "index", entries: n.attrs?.entries ?? [] });
        break;
      case "bibliography":
        out.push({ type: "bibliography", title: n.attrs?.title ?? null, entries: n.attrs?.entries ?? [] });
        break;
    }
  }
  return out;
}

/** Text of header/footer blocks for display; fields become placeholders. */
export function blocksText(blocks: Block[], page?: number, pages?: number): string {
  return blocks
    .map((b) =>
      b.type === "paragraph"
        ? b.content
            .map((i) => (i.type === "text" ? i.text : i.type === "tab" ? "\t" : i.type === "field" ? String(i.field === "pages" ? pages ?? "#" : page ?? "#") : ""))
            .join("")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** Text with `{Seite}` / `{Seiten}` tokens ⇄ header/footer paragraph. */
export function hfFromText(text: string, align: string | undefined): Block[] {
  if (!text.trim()) return [];
  return text.split("\n").map((line) => {
    const content: Inline[] = [];
    for (const part of line.split(/(\{Seiten?\})/)) {
      if (part === "{Seite}") content.push({ type: "field", field: "page" });
      else if (part === "{Seiten}") content.push({ type: "field", field: "pages" });
      else if (part) content.push({ type: "text", text: part });
    }
    return { type: "paragraph", align: align === "left" ? undefined : align, content } as Paragraph;
  });
}

export function hfToText(blocks: Block[]): { text: string; align: string } {
  const text = blocks
    .map((b) => (b.type === "paragraph" ? b.content.map((i) => (i.type === "text" ? i.text : i.type === "field" ? (i.field === "pages" ? "{Seiten}" : "{Seite}") : i.type === "tab" ? " " : "")).join("") : ""))
    .join("\n");
  const first = blocks.find((b) => b.type === "paragraph") as Paragraph | undefined;
  return { text, align: first?.align ?? "left" };
}
