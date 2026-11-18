import { describe, expect, it } from "vitest";
import { contrast, contrastTooLow, vagueLinkText } from "./a11y";

describe("accessibility helpers", () => {
  it("computes WCAG contrast ratios", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrast("rgb(255, 255, 255)", "#ffffff")).toBe(1);
    expect(contrast("auto", "#fff")).toBeNull();
  });
  it("uses the lower threshold for large text", () => {
    expect(contrastTooLow("#777777", "#ffffff", 11)).toBe(true);
    expect(contrastTooLow("#777777", "#ffffff", 18)).toBe(false);
    expect(contrastTooLow("#767676", "#ffffff", 11)).toBe(false);
  });
  it("recognises vague link texts", () => {
    expect(vagueLinkText("Hier klicken")).toBe(true);
    expect(vagueLinkText("https://example.com")).toBe(true);
    expect(vagueLinkText("Preisliste 2027")).toBe(false);
  });
});
