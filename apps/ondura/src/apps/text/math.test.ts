import { describe, expect, it } from "vitest";
import { latexToMathml, latexToOmml, ommlToLatex } from "./math";

describe("formulas", () => {
  it("builds MathML", () => {
    const m = latexToMathml("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
    expect(m).toContain("<mfrac>");
    expect(m).toContain("<msqrt>");
    expect(m).toContain("<msup><mi>b</mi><mn>2</mn></msup>");
    expect(m).toContain("<mo>±</mo>");
  });

  it("round-trips through Office Math", () => {
    for (const f of ["\\frac{a}{b}", "x^{2}", "\\sum_{i=1}^{n} i", "\\sqrt[3]{x}", "a_{n}", "E = mc^2"]) {
      const omml = latexToOmml(f);
      expect(omml.startsWith("<m:oMath>")).toBe(true);
      const back = ommlToLatex(omml);
      expect(latexToOmml(back)).toBe(omml);
    }
  });

  it("reads Word formulas", () => {
    const omml = '<m:oMath><m:sSup><m:e><m:r><m:t>e</m:t></m:r></m:e><m:sup><m:r><m:t>iπ</m:t></m:r></m:sup></m:sSup><m:r><m:t>+1=0</m:t></m:r></m:oMath>';
    expect(ommlToLatex(omml)).toBe("e^{i\\pi}+1=0");
  });
});
