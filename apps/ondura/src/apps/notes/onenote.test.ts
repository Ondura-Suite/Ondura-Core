// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { diffBlocks, parsePage } from "./onenote";

const PAGE = `<html><head><title>Einkauf</title><meta name="created" content="2026-11-19T10:00:00.0000000" /></head>
<body data-absolute-enabled="true" style="font-family:Calibri">
<div id="div:{a}{2}" style="position:absolute;left:48px;top:300px">
  <p id="p:{a}{5}">Zweiter Block</p>
</div>
<div id="div:{a}{1}" style="position:absolute;left:48px;top:120px">
  <p id="p:{a}{3}" data-tag="to-do">Milch</p>
  <ul id="ul:{a}{4}"><li>Brot</li></ul>
</div>
</body></html>`;

describe("OneNote pages", () => {
  it("reads title, date and the blocks of all outlines top to bottom", () => {
    const p = parsePage(PAGE);
    expect(p.title).toBe("Einkauf");
    expect(p.created).toContain("2026-11-19");
    expect(p.blocks.map((b) => b.id)).toEqual(["p:{a}{3}", "ul:{a}{4}", "p:{a}{5}"]);
  });

  it("turns edits into PATCH commands", () => {
    const before = [
      { id: "p:1", html: "<p>A</p>" },
      { id: "p:2", html: "<p>B</p>" },
      { id: "p:3", html: "<p>C</p>" },
    ];
    const after = [
      { id: null, html: "<p>Neu oben</p>" },
      { id: "p:1", html: "<p>A</p>" },
      { id: "p:2", html: "<p>B geändert</p>" },
      { id: null, html: "<p>X</p>" },
      { id: null, html: "<p>Y</p>" },
    ];
    expect(diffBlocks(before, after, "T", "T2")).toEqual([
      { target: "title", action: "replace", content: "T2" },
      { target: "body", action: "append", position: "before", content: "<p>Neu oben</p>" },
      { target: "p:2", action: "replace", content: "<p>B geändert</p>" },
      { target: "p:2", action: "insert", position: "after", content: "<p>X</p><p>Y</p>" },
      { target: "p:3", action: "replace", content: "<p></p>" },
    ]);
  });

  it("sends nothing when nothing changed", () => {
    const b = [{ id: "p:1", html: "<p>A</p>" }];
    expect(diffBlocks(b, b, "T", "T")).toEqual([]);
  });
});
