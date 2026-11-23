import { describe, expect, it } from "vitest";
import { combineDocuments, compareDocuments } from "./textTools";
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

describe("combineDocuments", () => {
  const rev = { author: "Anna", date: "2026-11-01T10:00:00Z" };
  it("keeps the current document's changes and adds the other's as tracked changes", () => {
    const cur = doc("Hallo Welt", "Bleibt gleich");
    (cur.blocks[0] as Paragraph).content = [{ type: "text", text: "Hallo " }, { type: "text", text: "alte ", marks: { del: rev } }, { type: "text", text: "Welt" }];
    const other = { ...doc("Hallo schöne Welt", "Bleibt gleich", "Neu von Ben"), comments: [{ id: 1, author: "Ben", date: "", text: "Gut" }] };
    (other.blocks[1] as Paragraph).content = [{ type: "text", text: "Bleibt gleich", marks: { comment: 1 } }];
    const r = combineDocuments({ ...cur, comments: [{ id: 4, author: "Ich", date: "", text: "x" }] }, other, "Ben");
    const [a, b, c] = r.blocks as Paragraph[];
    const runs = (p: Paragraph, k: "ins" | "del") => p.content.filter((i) => i.type === "text" && i.marks?.[k]).map((i) => (i.type === "text" ? `${i.text}|${i.marks?.[k]?.author}` : ""));
    expect(runs(a, "del")).toEqual(["alte |Anna"]);
    expect(runs(a, "ins")).toEqual(["schöne |Ben"]);
    expect(b.content).toEqual([{ type: "text", text: "Bleibt gleich", marks: { comment: 5 } }]);
    expect(runs(c, "ins")).toEqual(["Neu von Ben|Ben"]);
    expect(r.comments.map((x) => x.id)).toEqual([4, 5]);
  });
  it("marks text the other version removed as deleted", () => {
    const r = combineDocuments(doc("Eins zwei drei", "Weg"), doc("Eins drei"), "Ben");
    const [a, b] = r.blocks as Paragraph[];
    expect(a.content.filter((i) => i.type === "text" && i.marks?.del).map((i) => (i.type === "text" ? i.text : ""))).toEqual(["zwei "]);
    expect(b.content.every((i) => i.type === "text" && i.marks?.del?.author === "Ben")).toBe(true);
  });
});
