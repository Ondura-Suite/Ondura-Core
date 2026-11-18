// In-place rich text editing of a shape (TipTap), converting between the
// slide model's paragraphs/runs and the editor document.

import { useEffect } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { Plugin } from "@tiptap/pm/state";
import type { Para, Run, Shape } from "./model";

const PT = 96 / 72;

/** Fonts missing on the system fall back like in the static view. */
const withFallback = (font: string) => `"${font}", "Segoe UI", Calibri, Carlito, sans-serif`;

const SlideParagraph = Extension.create({
  name: "slideParagraph",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          level: { default: 0, renderHTML: (a) => ({ "data-level": a.level, style: `padding-left:${(a.bullet ? 36 : 0) + (a.level ?? 0) * 48}px` }), parseHTML: (el) => Number(el.getAttribute("data-level")) || 0 },
          bullet: { default: null, renderHTML: (a) => (a.bullet ? { "data-bullet": a.bullet, style: "text-indent:-36px" } : {}), parseHTML: (el) => el.getAttribute("data-bullet") },
          size: { default: null, renderHTML: (a) => (a.size ? { style: `font-size:${a.size * PT}px` } : {}), parseHTML: () => null },
          tpl: { default: null, rendered: false },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    const shift = (d: number) => () => {
      const { state } = this.editor;
      const { from, to } = state.selection;
      const tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === "paragraph") tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: Math.max(0, Math.min(8, (node.attrs.level ?? 0) + d)) });
      });
      this.editor.view.dispatch(tr);
      return true;
    };
    return { Tab: shift(1), "Shift-Tab": shift(-1) };
  },
  addProseMirrorPlugins() {
    // Typing into an empty placeholder uses its template formatting.
    return [
      new Plugin({
        appendTransaction: (_trs, _old, state) => {
          const { $from, empty } = state.selection;
          const node = $from.parent;
          if (!empty || node.type.name !== "paragraph" || node.content.size > 0 || !node.attrs.tpl || state.storedMarks?.length) return null;
          const t = node.attrs.tpl as Run;
          const s = state.schema;
          const marks = [];
          if (t.bold) marks.push(s.marks.bold.create());
          if (t.italic) marks.push(s.marks.italic.create());
          if (t.underline) marks.push(s.marks.underline.create());
          marks.push(s.marks.textStyle.create({ fontSize: t.size ? `${t.size}pt` : null, color: t.color ?? null, fontFamily: t.font ? withFallback(t.font) : null }));
          return state.tr.setStoredMarks(marks);
        },
      }),
    ];
  },
});

export function parasToDoc(paras: Para[]): JSONContent {
  const content = (paras.length ? paras : [{ runs: [] }]).map((p) => {
    const runs = p.runs.filter((r) => r.text);
    const tpl = p.runs[0] ? { ...p.runs[0], text: "" } : null;
    const inline: JSONContent[] = [];
    for (const r of runs) {
      const marks: NonNullable<JSONContent["marks"]> = [];
      if (r.bold) marks.push({ type: "bold" });
      if (r.italic) marks.push({ type: "italic" });
      if (r.underline) marks.push({ type: "underline" });
      if (r.strike) marks.push({ type: "strike" });
      marks.push({ type: "textStyle", attrs: { fontSize: r.size ? `${r.size}pt` : null, color: r.color ?? null, fontFamily: r.font ? withFallback(r.font) : null } });
      r.text.split("\n").forEach((line, i) => {
        if (i > 0) inline.push({ type: "hardBreak" });
        if (line) inline.push({ type: "text", text: line, marks });
      });
    }
    return {
      type: "paragraph",
      attrs: { textAlign: p.align ?? null, level: p.level ?? 0, bullet: p.bullet ?? null, size: runs.length ? null : p.size ?? tpl?.size ?? null, tpl },
      content: inline.length ? inline : undefined,
    };
  });
  return { type: "doc", content };
}

export function docToParas(doc: JSONContent): Para[] {
  return (doc.content ?? []).map((n) => {
    const a = n.attrs ?? {};
    const runs: Run[] = [];
    for (const c of n.content ?? []) {
      if (c.type === "hardBreak") {
        if (runs.length) runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text + "\n" };
        else runs.push({ ...(a.tpl ?? {}), text: "\n" });
        continue;
      }
      if (c.type !== "text") continue;
      const r: Run = { text: c.text ?? "" };
      for (const m of c.marks ?? []) {
        if (m.type === "bold") r.bold = true;
        else if (m.type === "italic") r.italic = true;
        else if (m.type === "underline") r.underline = true;
        else if (m.type === "strike") r.strike = true;
        else if (m.type === "textStyle") {
          if (m.attrs?.fontSize) r.size = parseFloat(m.attrs.fontSize) * (String(m.attrs.fontSize).endsWith("px") ? 0.75 : 1);
          if (m.attrs?.color) r.color = m.attrs.color;
          if (m.attrs?.fontFamily) r.font = String(m.attrs.fontFamily).replace(/["']/g, "").split(",")[0].trim();
        }
      }
      // Merge with the previous run if formatting is the same.
      const prev = runs[runs.length - 1];
      if (prev && JSON.stringify({ ...prev, text: "" }) === JSON.stringify({ ...r, text: "" })) prev.text += r.text;
      else runs.push(r);
    }
    const p: Para = { runs: runs.length ? runs : a.tpl ? [{ ...a.tpl, text: "" }] : [] };
    if (a.textAlign && a.textAlign !== "left") p.align = a.textAlign;
    if (a.level) p.level = a.level;
    if (a.bullet) p.bullet = a.bullet;
    if (!runs.length && a.size) p.size = a.size;
    return p;
  });
}

export function useShapeEditor(shape: Shape | null) {
  return useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, link: false, trailingNode: false }),
        TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
        TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right", "justify"] }),
        SlideParagraph,
      ],
      content: shape ? parasToDoc(shape.paragraphs) : undefined,
      editorProps: { attributes: { class: "nx-slide-text", spellcheck: "true", lang: "de" } },
    },
    [shape?.id],
  );
}

/** Editable text inside a shape (absolutely positioned like ShapeView's text). */
export function ShapeTextEditor({ shape, editor }: { shape: Shape; editor: Editor | null }) {
  useEffect(() => {
    if (!editor) return;
    editor.commands.focus("end");
  }, [editor]);
  return (
    <div
      style={{
        position: "absolute",
        left: shape.x,
        top: shape.y,
        width: shape.w,
        height: shape.h,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
        padding: "4.8px 9.6px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: shape.anchor === "middle" ? "center" : shape.anchor === "bottom" ? "flex-end" : "flex-start",
        fontFamily: '"Calibri", "Carlito", "Segoe UI", sans-serif',
        color: "#000",
        zIndex: 5,
        cursor: "text",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
