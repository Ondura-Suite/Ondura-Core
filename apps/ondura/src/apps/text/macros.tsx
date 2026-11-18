// Macros for Ondura Text: JavaScript scripts with a small document API.

import type { Editor } from "@tiptap/react";

export const TEXT_MACRO_TEMPLATE = `// Beispiel: Schreibweisen vereinheitlichen und das Ergebnis melden
const n = doc.replaceAll("E-mail", "E-Mail", { matchCase: true });
console.log(n + " Stellen ersetzt");
doc.paragraphs
  .filter((p) => p.text.startsWith("Hinweis:"))
  .forEach((p) => p.setBold());
`;

export const TEXT_MACRO_REFERENCE = (
  <>
    <code>doc.text</code>, <code>doc.paragraphs</code> (je <code>text</code>, <code>style</code>, <code>setStyle("heading1")</code>, <code>setBold()</code>,{" "}
    <code>setColor("#c00000")</code>, <code>remove()</code>), <code>doc.replaceAll(suche, ersatz, {"{ matchCase, wholeWord, regex }"})</code>,{" "}
    <code>doc.count(suche)</code>, <code>doc.insertText(text)</code> (an der Einfügemarke), <code>doc.appendParagraph(text, stil)</code>,{" "}
    <code>doc.selection.text</code>, <code>doc.selection.replace(text)</code> · <code>console.log(…)</code>. Stile: <code>normal</code>, <code>heading1</code>–
    <code>heading6</code>, <code>title</code>, <code>subtitle</code>, <code>quote</code> u. a.
  </>
);

interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

function pattern(search: string | RegExp, o: FindOptions = {}): RegExp {
  if (search instanceof RegExp) return new RegExp(search.source, search.flags.includes("g") ? search.flags : search.flags + "g");
  let src = o.regex ? search : search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `g${o.matchCase ? "" : "i"}u`);
}

export function runTextMacro(editor: Editor, code: string): { log: string[]; error?: string } {
  const log: string[] = [];
  const blocks = () => {
    const out: { pos: number; size: number; text: string; style: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        const style = node.type.name === "heading" ? `heading${node.attrs.level}` : (node.attrs.docStyle ?? "normal");
        out.push({ pos, size: node.nodeSize, text: node.textContent, style });
        return false;
      }
      return true;
    });
    return out;
  };
  const paragraph = (b: { pos: number; size: number; text: string; style: string }) => {
    // Positions move when the script edits; find the block again by position.
    const range = () => ({ from: b.pos + 1, to: b.pos + b.size - 1 });
    return {
      text: b.text,
      style: b.style,
      setStyle(style: string) {
        editor.chain().setTextSelection(b.pos + 1).setDocStyle(style).run();
      },
      setBold() {
        editor.chain().setTextSelection(range()).setBold().run();
      },
      setItalic() {
        editor.chain().setTextSelection(range()).setItalic().run();
      },
      setColor(color: string) {
        editor.chain().setTextSelection(range()).setColor(color).run();
      },
      remove() {
        editor.chain().deleteRange({ from: b.pos, to: b.pos + b.size }).run();
      },
    };
  };
  const replaceAll = (search: string | RegExp, replacement: string, o?: FindOptions) => {
    const re = pattern(search, o);
    const hits: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      for (const m of (node.text ?? "").matchAll(re)) {
        if (m[0]) hits.push({ from: pos + m.index!, to: pos + m.index! + m[0].length });
      }
      return false;
    });
    if (!hits.length) return 0;
    const tr = editor.state.tr;
    for (const h of hits.reverse()) {
      const marks = editor.state.doc.resolve(h.from + 1).marks();
      if (replacement) tr.replaceWith(h.from, h.to, editor.schema.text(replacement, marks));
      else tr.delete(h.from, h.to);
    }
    editor.view.dispatch(tr);
    return hits.length;
  };
  const doc = {
    get text() {
      return editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
    },
    get paragraphs() {
      return blocks().map(paragraph);
    },
    replaceAll,
    count(search: string | RegExp, o?: FindOptions) {
      return (doc.text.match(pattern(search, o)) ?? []).length;
    },
    insertText(text: string) {
      editor.chain().insertContent(text).run();
    },
    appendParagraph(text: string, style = "normal") {
      const end = editor.state.doc.content.size;
      editor.chain().insertContentAt(end, { type: "paragraph", content: text ? [{ type: "text", text }] : [] }).setTextSelection(end + 1).setDocStyle(style).run();
    },
    selection: {
      get text() {
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, "\n", " ");
      },
      replace(text: string) {
        editor.chain().insertContent(text).run();
      },
    },
  };
  const console = { log: (...a: unknown[]) => log.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")) };
  try {
    // User-written code from the macro list; it never comes from opened files.
    new Function("doc", "console", `"use strict";\n${code}`)(doc, console);
    return { log };
  } catch (e) {
    return { log, error: e instanceof Error ? e.message : String(e) };
  }
}
