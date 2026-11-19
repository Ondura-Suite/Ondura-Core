import { describe, expect, it } from "vitest";
import { docToParas, parasToDoc } from "./TextEditor";

describe("slide text round trip", () => {
  it("keeps the placeholder size for text typed without own formatting", () => {
    // An empty placeholder paragraph (size from the layout) …
    const doc = parasToDoc([{ runs: [], size: 24 }]);
    // … into which plain text was typed.
    doc.content![0].content = [{ type: "text", text: "Hallo" }];
    const paras = docToParas(doc);
    expect(paras[0].runs[0]).toMatchObject({ text: "Hallo", size: 24 });
    // Editing it again does not change the size.
    expect(docToParas(parasToDoc(paras))[0].runs[0].size).toBe(24);
  });
  it("keeps explicit sizes", () => {
    const paras = [{ runs: [{ text: "Titel", size: 44, bold: true }] }];
    expect(docToParas(parasToDoc(paras))).toEqual(paras);
  });
});
