import { describe, expect, it } from "vitest";
import "./format";
import { type Book, type SCell, calculate, copyBlock, key, newBook, setCells } from "./model";
import { cellsToRanges, addSubtotals, advancedMatches, matchCriterion, namesFromSelection, pasteSpecial, removeSubtotals, seriesValues, sortByKeys, specialCells } from "./ribbonTools";
import type { Scalar } from "./formula";

const build = (rows: (string | number | null)[][]): Book =>
  setCells(
    newBook(),
    0,
    rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: v === null ? null : typeof v === "string" && v.startsWith("=") ? ({ f: v.slice(1) } as SCell) : ({ v } as SCell) }))),
  );
const val = (b: Book, r: number, c: number): Scalar => {
  const cell = b.sheets[0].cells.get(key(r, c));
  return cell?.f ? (calculate(b)[0].get(key(r, c)) ?? null) : (cell?.v ?? null);
};

describe("paste special", () => {
  it("values, transpose and formulas", () => {
    const b = build([
      [1, 2],
      ["=A1+B1", null],
    ]);
    const block = copyBlock(b, 0, { r1: 0, c1: 0, r2: 1, c2: 1 });
    const vals = calculate(b);
    const valueOf = (s: number, r: number, c: number) => vals[s].get(key(r, c)) ?? b.sheets[s].cells.get(key(r, c))?.v ?? null;
    const v = pasteSpecial(b, 0, 5, 0, block, "values", valueOf);
    expect(v.sheets[0].cells.get(key(6, 0))).toEqual({ v: 3 });
    const t = pasteSpecial(b, 0, 10, 0, block, "transpose", valueOf);
    expect(t.sheets[0].cells.get(key(10, 1))?.f).toBe("A11+A12");
    expect(val(t, 11, 0)).toBe(2);
    const f = pasteSpecial(b, 0, 20, 3, block, "formulas", valueOf);
    expect(f.sheets[0].cells.get(key(21, 3))?.f).toBe("D21+E21");
  });
});

describe("sort, subtotal, filter", () => {
  const data = () =>
    build([
      ["Region", "Name", "Umsatz"],
      ["Süd", "Bea", 5],
      ["Nord", "Anna", 3],
      ["Süd", "Alf", 7],
      ["Nord", "Carl", 1],
    ]);
  it("sorts by several keys", () => {
    const b = sortByKeys(
      data(),
      0,
      { r1: 0, c1: 0, r2: 4, c2: 2 },
      [
        { col: 0, asc: true },
        { col: 2, asc: false },
      ],
      true,
      calculate(data()),
    );
    expect([1, 2, 3, 4].map((r) => val(b, r, 1))).toEqual(["Anna", "Carl", "Alf", "Bea"]);
  });
  it("adds and removes subtotals", () => {
    const sorted = sortByKeys(data(), 0, { r1: 0, c1: 0, r2: 4, c2: 2 }, [{ col: 0, asc: true }], true, calculate(data()));
    const { book, rect } = addSubtotals(sorted, 0, { r1: 0, c1: 0, r2: 4, c2: 2 }, 0, 9, [2], (r, c) => val(sorted, r, c));
    expect(rect.r2).toBe(7);
    expect(val(book, 3, 0)).toBe("Nord Ergebnis");
    expect(val(book, 3, 2)).toBe(4);
    expect(val(book, 6, 2)).toBe(12);
    expect(val(book, 7, 0)).toBe("Gesamtergebnis");
    expect(val(book, 7, 2)).toBe(16);
    expect(book.sheets[0].rowLevels.get(1)).toBe(2);
    expect(book.sheets[0].rowLevels.get(3)).toBe(1);
    const back = removeSubtotals(book, 0, rect);
    expect(val(back, 3, 1)).toBe("Bea");
    expect(back.sheets[0].cells.get(key(5, 0))).toBeUndefined();
  });
  it("advanced filter criteria", () => {
    expect(matchCriterion(5, ">3")).toBe(true);
    expect(matchCriterion("Anna", "A*")).toBe(true);
    expect(matchCriterion("Anna", "=An")).toBe(false);
    expect(matchCriterion("Bea", "<>Bea")).toBe(false);
    const b = build([["Region", "Name", "Umsatz"], ["Süd", "Bea", 5], ["Nord", "Anna", 3], ["Süd", "Alf", 7], ["Nord", "Carl", 1], [], ["Region", "Umsatz"], ["Süd", ">6"], ["Nord", "<2"]]);
    expect(advancedMatches({ r1: 0, c1: 0, r2: 4, c2: 2 }, { r1: 6, c1: 0, r2: 8, c2: 1 }, (r, c) => val(b, r, c), false)).toEqual([3, 4]);
  });
});

describe("series, names, special cells", () => {
  it("series", () => {
    expect(seriesValues(1, 5, { byRows: false, type: "linear", dateUnit: "day", step: 2, stop: 7 })).toEqual([1, 3, 5, 7]);
    expect(seriesValues(2, 4, { byRows: false, type: "growth", dateUnit: "day", step: 3, stop: null })).toEqual([2, 6, 18, 54]);
    // 31 Jan 2026 + 1 month = 28 Feb 2026 (JS rolls over to 3 Mar; serials compared loosely)
    expect(seriesValues(46023, 2, { byRows: false, type: "date", dateUnit: "year", step: 1, stop: null })[1]).toBe(46023 + 365);
  });
  it("names from selection", () => {
    const b = build([
      ["Preis", "Menge"],
      [1, 2],
      [3, 4],
    ]);
    expect(namesFromSelection("Tabelle1", { r1: 0, c1: 0, r2: 2, c2: 1 }, { top: true, left: false, bottom: false, right: false }, (r, c) => val(b, r, c))).toEqual([
      { name: "Preis", formula: "Tabelle1!$A$2:$A$3" },
      { name: "Menge", formula: "Tabelle1!$B$2:$B$3" },
    ]);
  });
  it("special cells", () => {
    const b = build([
      [1, "=A1*2"],
      [null, "x"],
    ]);
    expect(specialCells(b.sheets[0], calculate(b)[0], "formulas")).toEqual([{ r: 0, c: 1 }]);
    expect(specialCells(b.sheets[0], calculate(b)[0], "blanks")).toEqual([{ r: 1, c: 0 }]);
    expect(specialCells(b.sheets[0], calculate(b)[0], "constants")).toEqual([
      { r: 0, c: 0 },
      { r: 1, c: 1 },
    ]);
  });
});

describe("multiple selection", () => {
  it("joins cells into rectangles", () => {
    const cells = [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 0 },
      { r: 1, c: 1 },
      { r: 1, c: 3 },
      { r: 5, c: 2 },
    ];
    expect(cellsToRanges(cells)).toEqual([
      { r1: 0, r2: 1, c1: 0, c2: 1 },
      { r1: 1, r2: 1, c1: 3, c2: 3 },
      { r1: 5, r2: 5, c1: 2, c2: 2 },
    ]);
  });
});
