import { describe, expect, it } from "vitest";
import { applyHeaderFooter, replaceInRuns } from "./ribbonTools";
import { emptyPresentation } from "./model";

describe("replace across runs", () => {
  it("replaces a match spanning two formats", () => {
    const runs = [{ text: "Ondu", bold: true }, { text: "ra Suite" }];
    expect(replaceInRuns(runs, /ondura/gi, "Mirra")).toEqual([{ text: "Mirra", bold: true }, { text: " Suite" }]);
  });
  it("keeps fields and other matches", () => {
    const runs = [{ text: "Folie " }, { text: "3", field: "slidenum" as const }, { text: " von Folie" }];
    expect(replaceInRuns(runs, /folie/gi, "Seite")).toEqual([{ text: "Seite " }, { text: "3", field: "slidenum" }, { text: " von Seite" }]);
  });
});

describe("header and footer", () => {
  it("adds footer placeholders and replaces them", () => {
    const p = {
      ...emptyPresentation(),
      slides: [
        { shapes: [], notes: "" },
        { shapes: [], notes: "" },
      ],
    };
    const o = { date: "none" as const, fixedDate: "", number: true, footer: "MirraNET", skipTitle: true, all: true };
    const once = applyHeaderFooter(p, 0, o);
    const twice = applyHeaderFooter(once, 0, o);
    expect(twice.slides[1].shapes.map((s) => s.placeholder)).toEqual(["ftr", "sldNum"]);
    expect(twice.slides[1].shapes[1].paragraphs[0].runs[0]).toMatchObject({ text: "2", field: "slidenum" });
  });
});
