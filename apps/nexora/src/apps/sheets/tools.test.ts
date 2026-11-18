import { describe, expect, it } from "vitest";
import "./format";
import { flashFill, guessBreaks, splitText } from "./dataTools";
import { evaluateStep, nextError, precedentArrows } from "./audit";
import { calculate, key, newBook, parseA1 } from "./model";

describe("text to columns", () => {
  const o = { mode: "delimited" as const, delimiters: [";"], merge: false, quote: '"' as const, breaks: [] };
  it("splits with qualifier and merge", () => {
    expect(splitText('a;"b;c";d', o)).toEqual(["a", "b;c", "d"]);
    expect(splitText("a  b", { ...o, delimiters: [" "], merge: true })).toEqual(["a", "b"]);
    expect(splitText("ABC123", { ...o, mode: "fixed", breaks: [3] })).toEqual(["ABC", "123"]);
    expect(guessBreaks(["ab  12", "cd  34"])).toEqual([4]);
  });
});

describe("flash fill", () => {
  it("first names", () => {
    expect(flashFill([{ src: ["Niklas Linz"], out: "Niklas" }], [["Anna Schmidt"], ["Max Mustermann"]])).toEqual(["Anna", "Max"]);
  });
  it("last name, first name", () => {
    expect(flashFill([{ src: ["Niklas Linz"], out: "Linz, Niklas" }], [["Anna Schmidt"]])).toEqual(["Schmidt, Anna"]);
  });
  it("initials and e-mail", () => {
    expect(flashFill([{ src: ["Niklas Linz"], out: "N.L." }], [["Anna Schmidt"]])).toEqual(["A.S."]);
    expect(flashFill([{ src: ["Niklas", "Linz"], out: "niklas.linz@mirranet.de" }], [["Anna", "Schmidt"]])).toEqual(["anna.schmidt@mirranet.de"]);
  });
  it("needs a second example when ambiguous", () => {
    expect(flashFill([{ src: ["2026-11-18"], out: "18" }, { src: ["2025-01-07"], out: "07" }], [["2024-03-30"]])).toEqual(["30"]);
  });
});

describe("formula auditing", () => {
  const b = newBook();
  const s = b.sheets[0];
  const set = (ref: string, v: string | number) => {
    const p = parseA1(ref)!;
    s.cells.set(key(p.r, p.c), typeof v === "string" && v.startsWith("=") ? { f: v.slice(1) } : { v });
  };
  set("A1", 2);
  set("A2", 3);
  set("B1", "=SUM(A1:A2)*A1+1");
  set("C1", "=1/0");
  const values = calculate(b);
  it("precedents", () => {
    expect(precedentArrows(b, 0, 0, 1).map((a) => a.from)).toEqual([
      { r1: 0, c1: 0, r2: 1, c2: 0 },
      { r1: 0, c1: 0, r2: 0, c2: 0 },
    ]);
  });
  it("evaluates step by step", () => {
    let e = "SUM(A1:A2)*A1+1";
    const steps = [];
    for (let i = 0; i < 6; i++) {
      const r = evaluateStep(b, values, 0, 0, 1, e);
      steps.push(r.expr);
      e = r.expr;
      if (r.done) break;
    }
    expect(steps).toEqual(["SUM(A1:A2)*2+1", "5*2+1", "11"]);
  });
  it("finds errors", () => {
    expect(nextError(b, values, 0, 0, 0)).toMatchObject({ r: 0, c: 2, code: "#DIV/0!" });
  });
});
