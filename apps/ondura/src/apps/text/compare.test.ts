import { describe, expect, it } from "vitest";
import { compareDocuments } from "./textTools";
import { emptyDocument, type Block, type Paragraph } from "./model";

const doc = (...texts: string[]) => ({ ...emptyDocument(), blocks: texts.map((t): Block => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });

describe("compareDocuments", () => {
  it("marks changed words, added and removed paragraphs", () => {
    const r = compareDocuments(doc("Hallo Welt", "Bleibt gleich", "Fällt weg"), doc("Hallo schöne Welt", "Bleibt gleich", "Ganz neu"), "Ich");
    const [a, b, c] = r.blocks as Paragraph[];
    const ins = (p: Paragraph) => p.content.filter((i) => i.type === "text" && i.marks?.ins).map((i) => (i.type === "text" ? i.text : "")).join("");
    const del = (p: Paragraph) => p.content.filter((i) => i.type === "text" && i.marks?.del).map((i) => (i.type === "text" ? i.text : "")).join("");
    expect(ins(a)).toBe("schöne ");
    expect(del(a)).toBe("");
    expect(b.content).toEqual([{ type: "text", text: "Bleibt gleich" }]);
    expect(del(c)).toBe("Fällt weg");
    expect(ins(c)).toBe("Ganz neu");
  });
});
