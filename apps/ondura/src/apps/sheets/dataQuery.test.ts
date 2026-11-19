import { describe, expect, it } from "vitest";
import { applySteps, parseDelimited, parseJson } from "./dataQuery";

describe("data queries", () => {
  it("parses CSV with quotes and a guessed delimiter", () => {
    expect(parseDelimited('Name;Betrag\n"Müller; Anna";1.234,50\nBen;7\n')).toEqual([["Name", "Betrag"], ["Müller; Anna", "1.234,50"], ["Ben", "7"]]);
  });
  it("parses JSON lists of objects", () => {
    expect(parseJson('{"items":[{"a":1,"b":"x"},{"a":2}]}')).toEqual([["a", "b"], [1, "x"], [2, null]]);
  });
  it("applies steps", () => {
    const t = parseDelimited("Name,Ort,Betrag\nA,Berlin,10\nB,Köln,5\nC,Berlin,7\nC,Berlin,7\n");
    const r = applySteps(t, [
      { op: "type", column: "Betrag", to: "number" },
      { op: "filter", column: "Ort", test: "eq", value: "berlin" },
      { op: "dedupe" },
      { op: "sort", column: "Betrag", desc: true },
      { op: "keep", columns: ["Name", "Betrag"] },
      { op: "rename", column: "Betrag", to: "Summe" },
    ]);
    expect(r).toEqual([["Name", "Summe"], ["A", 10], ["C", 7]]);
  });
});
