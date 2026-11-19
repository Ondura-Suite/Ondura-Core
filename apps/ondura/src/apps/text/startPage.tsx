// Start page ("Datei › Start" / "Neu") of the text app: template gallery with
// miniatures drawn from the template documents themselves.

import type { CSSProperties, ReactNode } from "react";
import type { OfficeTemplate } from "../../shell/office";
import type { Block, Paragraph, TextDocument } from "./model";
import { TEMPLATES } from "./textTools";

const INK = "#3a3a3a";
const BODY = "#cfcfd4";
const ACCENT = "#2f5597";
const CHARS_PER_LINE = 30;

function plain(p: Paragraph) {
  return p.content.map((i) => ("text" in i && typeof i.text === "string" ? i.text : "")).join("");
}

function isBold(p: Paragraph) {
  return p.content.some((i) => "marks" in i && (i as { marks?: { bold?: boolean } }).marks?.bold);
}

/** A bar standing in for one line of text. */
const bar = (width: number, height: number, color: string, extra: CSSProperties = {}, key?: number) => (
  <div key={key} style={{ width: `${Math.max(8, Math.min(100, width))}%`, height, borderRadius: 1, backgroundColor: color, ...extra }} />
);

function paragraph(p: Paragraph, key: number): ReactNode {
  const text = plain(p);
  const right = p.align === "right" ? { marginLeft: "auto" } : p.align === "center" ? { margin: "0 auto" } : {};
  if (!text) return <div key={key} style={{ height: 4 }} />;
  switch (p.style) {
    case "title":
      return <div key={key} style={{ marginBottom: 3 }}>{bar(text.length * 4.2, 8, INK, right)}</div>;
    case "subtitle":
      return <div key={key} style={{ marginBottom: 5 }}>{bar(text.length * 2.6, 4, "#9a9aa2", right)}</div>;
    case "heading1":
      return <div key={key} style={{ margin: "7px 0 4px" }}>{bar(text.length * 4, 5, ACCENT, right)}</div>;
    case "heading2":
      return <div key={key} style={{ margin: "3px 0 2px" }}>{bar(text.length * 3.4, 4, ACCENT, right)}</div>;
  }
  const lines = Math.ceil(text.length / CHARS_PER_LINE);
  const color = isBold(p) ? "#8d8d96" : BODY;
  const indent = p.list ? { marginLeft: 6 } : {};
  return (
    <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: p.spaceAfterPt === 0 ? 2 : 5, ...indent }}>
      {Array.from({ length: lines }, (_, i) => bar(i < lines - 1 ? 100 : ((text.length % CHARS_PER_LINE) / CHARS_PER_LINE) * 100 || 100, 3, color, right, i))}
    </div>
  );
}

function block(b: Block, key: number): ReactNode {
  switch (b.type) {
    case "paragraph":
      return paragraph(b, key);
    case "table":
      return (
        <div key={key} style={{ display: "grid", gridTemplateColumns: b.columnsMm.map((w) => `${w}fr`).join(" "), border: "1px solid #d9d9de", margin: "2px 0 4px" }}>
          {b.rows.flatMap((r, ri) => r.cells.map((_, ci) => <div key={`${ri}-${ci}`} style={{ height: 9, borderRight: "1px solid #e4e4e8", borderBottom: "1px solid #e4e4e8", background: ci === 0 ? "#f1f1f4" : undefined }} />))}
        </div>
      );
    case "toc":
      return (
        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2, margin: "3px 0" }}>
          {bar(30, 3, ACCENT)}
          {[70, 60, 66, 54].map((w, i) => bar(w, 2, BODY, {}, i))}
        </div>
      );
    default:
      return null;
  }
}

/** Miniature of the start of a document. */
export function PagePreview({ doc }: { doc: TextDocument }) {
  // Page breaks are ignored so short title pages still show their content.
  const first = doc.blocks.filter((b: Block) => b.type !== "pageBreak" && b.type !== "sectionBreak");
  return (
    <div style={{ position: "absolute", inset: 0, padding: "16px 14px", display: "flex", flexDirection: "column", overflow: "hidden", background: doc.pageColor ?? "#fff" }}>
      {first.slice(0, 26).map(block)}
    </div>
  );
}

export function textTemplates(): OfficeTemplate[] {
  return TEMPLATES.map((t) => ({ id: t.id, label: t.label, preview: <PagePreview doc={t.build()} /> }));
}

export function buildTextTemplate(id: string): TextDocument | null {
  return TEMPLATES.find((t) => t.id === id)?.build() ?? null;
}
