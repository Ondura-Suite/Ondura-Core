// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildNotebooks, diffBlocks, parsePage } from "./onenote";

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

describe("OneNote notebooks", () => {
  it("joins flat sections and nested section groups into notebooks", () => {
    const nbs = buildNotebooks(
      [{ id: "n1", displayName: "Work" }, { id: "n2", displayName: "Home" }],
      [
        { id: "g1", displayName: "Projects", parentNotebook: { id: "n1" }, parentSectionGroup: null },
        { id: "g2", displayName: "2026", parentNotebook: null, parentSectionGroup: { id: "g1" } },
      ],
      [
        { id: "s3", displayName: "Ondura", parentNotebook: null, parentSectionGroup: { id: "g2" } },
        { id: "s1", displayName: "Inbox", parentNotebook: { id: "n1" }, parentSectionGroup: null },
        { id: "s2", displayName: "Ideas", parentNotebook: null, parentSectionGroup: { id: "g1" } },
        { id: "s4", displayName: "Garden", parentNotebook: { id: "n2" } },
      ],
    );
    expect(nbs[0].sections).toEqual([
      { id: "s1", name: "Inbox" },
      { id: "s2", name: "Ideas", group: "Projects" },
      { id: "s3", name: "Ondura", group: "Projects / 2026" },
    ]);
    expect(nbs[1].sections).toEqual([{ id: "s4", name: "Garden" }]);
  });
});
