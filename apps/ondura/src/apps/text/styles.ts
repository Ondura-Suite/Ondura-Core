// Changed paragraph styles ("Formatvorlage ändern"): CSS for the editor and
// print output, and a style taken from the current selection.
import type { Editor } from "@tiptap/core";
import type { StyleDef } from "./model";
import { tl, tlc } from "../../lib/i18n";

export const STYLE_NAMES: { id: string; label: string }[] = [
  { id: "normal", label: tlc("style", "Standard") },
  { id: "title", label: tl("Titel") },
  { id: "subtitle", label: tl("Untertitel") },
  { id: "heading1", label: tl("Überschrift 1") },
  { id: "heading2", label: tl("Überschrift 2") },
  { id: "heading3", label: tl("Überschrift 3") },
  { id: "heading4", label: tl("Überschrift 4") },
  { id: "heading5", label: tl("Überschrift 5") },
  { id: "heading6", label: tl("Überschrift 6") },
  { id: "quote", label: tl("Zitat") },
  { id: "caption", label: tl("Beschriftung") },
];

export interface StyleLook {
  font: string | null;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  spaceBefore: number;
  spaceAfter: number;
  align: string;
}

/** Default look (as in text.css), shown in the dialog. */
export const STYLE_DEFAULTS: Record<string, StyleLook> = {
  normal: { font: null, size: 11, color: "#000000", bold: false, italic: false, spaceBefore: 0, spaceAfter: 8, align: "left" },
  title: { font: null, size: 28, color: "#000000", bold: false, italic: false, spaceBefore: 0, spaceAfter: 4, align: "left" },
  subtitle: { font: null, size: 15, color: "#595959", bold: false, italic: false, spaceBefore: 0, spaceAfter: 8, align: "left" },
  heading1: { font: null, size: 20, color: "#1f3864", bold: true, italic: false, spaceBefore: 18, spaceAfter: 4, align: "left" },
  heading2: { font: null, size: 16, color: "#1f3864", bold: true, italic: false, spaceBefore: 8, spaceAfter: 4, align: "left" },
  heading3: { font: null, size: 14, color: "#1f3864", bold: true, italic: false, spaceBefore: 8, spaceAfter: 4, align: "left" },
  heading4: { font: null, size: 12, color: "#1f3864", bold: true, italic: false, spaceBefore: 4, spaceAfter: 4, align: "left" },
  heading5: { font: null, size: 11, color: "#1f3864", bold: true, italic: false, spaceBefore: 4, spaceAfter: 4, align: "left" },
  heading6: { font: null, size: 11, color: "#1f3864", bold: true, italic: false, spaceBefore: 4, spaceAfter: 4, align: "left" },
  quote: { font: null, size: 11, color: "#404040", bold: false, italic: true, spaceBefore: 8, spaceAfter: 8, align: "center" },
  caption: { font: null, size: 9, color: "#44546a", bold: false, italic: true, spaceBefore: 0, spaceAfter: 10, align: "left" },
};

function selector(id: string): string {
  const inner = (() => {
    if (id === "normal") return "p:not([data-style])";
    if (id.startsWith("heading")) return `h${id.slice(7)}`;
    if (id === "quote") return "blockquote";
    return `p[data-style="${id}"]`;
  })();
  return `.nx-paper .ProseMirror ${inner}, .nx-print-root ${inner}`;
}

/** CSS rules for the changed styles (placed after text.css, so they win). */
export function styleCss(defs: StyleDef[]): string {
  return defs
    .map((d) => {
      const r: string[] = [];
      if (d.font) r.push(`font-family: "${d.font.replace(/"/g, "")}", sans-serif`);
      if (d.size != null) r.push(`font-size: ${d.size}pt`);
      if (d.color) r.push(`color: ${d.color}`);
      if (d.bold != null) r.push(`font-weight: ${d.bold ? 700 : 400}`);
      if (d.italic != null) r.push(`font-style: ${d.italic ? "italic" : "normal"}`);
      if (d.spaceBefore != null) r.push(`margin-top: ${d.spaceBefore}pt`);
      if (d.spaceAfter != null) r.push(`margin-bottom: ${d.spaceAfter}pt`);
      if (d.align) r.push(`text-align: ${d.align}`);
      // Normal is the base of all styles: its font applies everywhere.
      const base = d.id === "normal" && d.font ? `.nx-paper .ProseMirror, .nx-print-root { font-family: "${d.font.replace(/"/g, "")}", sans-serif; }\n` : "";
      return r.length ? `${base}${selector(d.id)} { ${r.join("; ")}; }` : base;
    })
    .join("\n");
}

/** Only the fields that differ from the default. */
export function normalizeDef(d: StyleDef): StyleDef | null {
  const def = STYLE_DEFAULTS[d.id];
  if (!def) return null;
  const out: StyleDef = { id: d.id };
  if (d.font) out.font = d.font;
  if (d.size != null && d.size !== def.size) out.size = d.size;
  if (d.color && d.color.toLowerCase() !== def.color) out.color = d.color.toLowerCase();
  if (d.bold != null && d.bold !== def.bold) out.bold = d.bold;
  if (d.italic != null && d.italic !== def.italic) out.italic = d.italic;
  if (d.spaceBefore != null && d.spaceBefore !== def.spaceBefore) out.spaceBefore = d.spaceBefore;
  if (d.spaceAfter != null && d.spaceAfter !== def.spaceAfter) out.spaceAfter = d.spaceAfter;
  if (d.align && d.align !== def.align) out.align = d.align;
  return Object.keys(out).length > 1 ? out : null;
}

export function setStyleDef(defs: StyleDef[], d: StyleDef): StyleDef[] {
  const n = normalizeDef(d);
  const rest = defs.filter((x) => x.id !== d.id);
  return n ? [...rest, n] : rest;
}

/** Effective look of a style (defaults plus changes). */

export function effective(defs: StyleDef[], id: string): StyleLook {
  const d: StyleDef = defs.find((x) => x.id === id) ?? { id };
  const def = STYLE_DEFAULTS[id] ?? STYLE_DEFAULTS.normal;
  return {
    font: d.font ?? def.font,
    size: d.size ?? def.size,
    color: d.color ?? def.color,
    bold: d.bold ?? def.bold,
    italic: d.italic ?? def.italic,
    spaceBefore: d.spaceBefore ?? def.spaceBefore,
    spaceAfter: d.spaceAfter ?? def.spaceAfter,
    align: d.align ?? def.align,
  };
}

/** A style matching the formatting at the selection. */
export function styleFromSelection(editor: Editor, id: string, defs: StyleDef[]): StyleDef {
  const cur = effective(defs, id);
  const ts = editor.getAttributes("textStyle");
  const para = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  const font = ((ts.fontFamily as string) ?? "").split(",")[0].replace(/["']/g, "").trim();
  return {
    id,
    font: font || cur.font,
    size: ts.fontSize ? parseFloat(ts.fontSize) : cur.size,
    color: (ts.color as string) || cur.color,
    bold: editor.isActive("bold") || cur.bold,
    italic: editor.isActive("italic") || cur.italic,
    spaceBefore: cur.spaceBefore,
    spaceAfter: para.spaceAfter != null ? Number(para.spaceAfter) : cur.spaceAfter,
    align: (para.textAlign as string) || cur.align,
  };
}
