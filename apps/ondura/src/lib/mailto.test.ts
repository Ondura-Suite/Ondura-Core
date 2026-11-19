import { describe, expect, it } from "vitest";
import { parseMailto } from "./mailto";

describe("parseMailto", () => {
  it("reads recipients, subject and body", () => {
    const m = parseMailto("mailto:a@x.de,b@y.de?cc=c@z.de&subject=Hallo%20Welt&body=Zeile%201%0D%0AZeile%202")!;
    expect(m.to.map((a) => a.email)).toEqual(["a@x.de", "b@y.de"]);
    expect(m.cc.map((a) => a.email)).toEqual(["c@z.de"]);
    expect(m.subject).toBe("Hallo Welt");
    expect(m.bodyHtml).toBe("<p>Zeile 1</p><p>Zeile 2</p>");
  });
  it("keeps a literal plus and escapes HTML", () => {
    const m = parseMailto("MAILTO:max+news@x.de?body=%3Cb%3E")!;
    expect(m.to[0].email).toBe("max+news@x.de");
    expect(m.bodyHtml).toBe("<p>&lt;b&gt;</p>");
  });
  it("rejects other links", () => {
    expect(parseMailto("https://example.com")).toBeNull();
  });
});
