import { describe, expect, it } from "vitest";
import { hunks, myers } from "./diff";
import { fontFacts, groupLines, type TextRun } from "./textModel";

const apply = (a: string[], b: string[]) => {
  const ops = myers(a, b)!;
  // Replaying the script must turn a into b.
  const out: string[] = [];
  for (const op of ops) if (op.kind !== "delete") out.push(op.kind === "equal" ? a[op.a] : b[op.b]);
  return { ops, out };
};

describe("myers", () => {
  it("finds the minimal edit script", () => {
    const a = "the quick brown fox jumps".split(" ");
    const b = "the slow brown fox jumps high".split(" ");
    const { ops, out } = apply(a, b);
    expect(out).toEqual(b);
    expect(ops.filter((o) => o.kind !== "equal")).toHaveLength(3);
    expect(hunks(ops)).toEqual([
      { deleted: [1], inserted: [1] },
      { deleted: [], inserted: [5] },
    ]);
  });
  it("handles empty and identical inputs", () => {
    expect(apply([], ["x"]).out).toEqual(["x"]);
    expect(apply(["x"], []).out).toEqual([]);
    expect(hunks(myers(["a", "b"], ["a", "b"])!)).toEqual([]);
  });
  it("gives up beyond the edit limit", () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    expect(myers(a, b, undefined, 10)).toBeNull();
    expect(myers(a, b)).not.toBeNull();
  });
});

describe("text model", () => {
  const run = (text: string, x: number, y: number, size = 10): TextRun => ({ text, x, y, width: text.length * size * 0.5, size, font: "Helvetica", bold: false, italic: false, family: "sans" });
  it("groups runs into lines and splits columns", () => {
    const lines = groupLines([run("Hallo", 72, 700), run("Welt", 102, 700.4), run("Name", 72, 680), run("Wert", 300, 680)], 842);
    expect(lines.map((l) => l.text)).toEqual(["Hallo Welt", "Name\tWert"]);
    expect(lines[1].segments).toHaveLength(2);
  });
  it("reads bold, italic and families from font names", () => {
    expect(fontFacts("ABCDEF+Arial-BoldItalicMT")).toEqual({ bold: true, italic: true, family: "sans" });
    expect(fontFacts("TimesNewRomanPSMT").family).toBe("serif");
    expect(fontFacts("Courier").family).toBe("mono");
  });
});
