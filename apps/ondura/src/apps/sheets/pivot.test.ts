import { describe, expect, it } from "vitest";
import "./format";
import { buildPivot, type PivotOptions, type PivotAgg } from "./features";
import { calculate, key, newBook } from "./model";

function pivot(agg: PivotAgg, opts: PivotOptions = {}, withCols = false) {
  const b = newBook();
  const s = b.sheets[0];
  const rows: (string | number)[][] = [
    ["Region", "Produkt", "Umsatz", "Kosten"],
    ["Nord", "A", 10, 4],
    ["Nord", "B", 20, 5],
    ["Süd", "A", 30, 10],
    ["Süd", "A", 40, 12],
  ];
  rows.forEach((r, i) => r.forEach((v, c) => s.cells.set(key(i, c), { v })));
  const src = { r1: 0, c1: 0, r2: rows.length - 1, c2: 3 };
  const values0 = calculate(b);
  const { sheet, styles } = buildPivot(b, values0, 0, src, 0, withCols ? 1 : null, 2, agg, opts);
  b.styles = styles;
  b.sheets.push(sheet);
  const v = calculate(b)[1];
  return (r: number, c: number) => v.get(key(r, c));
}

describe("pivot tables", () => {
  it("summarises with the new functions", () => {
    const p = pivot("STDEV");
    expect(p(3, 1) as number).toBeCloseTo(7.0710678, 5);
    expect(pivot("DISTINCT")(4, 1)).toBe(2);
    expect(pivot("PRODUCT")(3, 1)).toBe(200);
  });
  it("shows values as a share of the total and running totals", () => {
    const p = pivot("SUM", { showAs: "percentTotal" });
    expect(p(3, 1) as number).toBeCloseTo(0.3, 6);
    expect(p(5, 1) as number).toBeCloseTo(1, 6);
    const run = pivot("SUM", { showAs: "running" });
    expect(run(4, 1)).toBe(100);
    const diff = pivot("SUM", { showAs: "diffPrev" });
    expect(diff(4, 1)).toBe(40);
  });
  it("computes calculated fields", () => {
    const p = pivot("SUM", { calc: { name: "Gewinn", formula: "=[Umsatz]-[Kosten]" } });
    expect(p(3, 1)).toBe(21);
    expect(p(4, 1)).toBe(48);
  });
  it("finds values with GETPIVOTDATA", () => {
    const b = newBook();
    const s = b.sheets[0];
    const rows: (string | number)[][] = [
      ["Region", "Umsatz"],
      ["Nord", 10],
      ["Süd", 30],
      ["Nord", 5],
    ];
    rows.forEach((r, i) => r.forEach((v, c) => s.cells.set(key(i, c), { v })));
    const { sheet, styles } = buildPivot(b, calculate(b), 0, { r1: 0, c1: 0, r2: 3, c2: 1 }, 0, null, 1, "SUM");
    b.styles = styles;
    sheet.name = "PT";
    b.sheets.push(sheet);
    s.cells.set(key(0, 5), { f: 'GETPIVOTDATA("Umsatz",PT!A3,"Region","Nord")' });
    s.cells.set(key(1, 5), { f: 'GETPIVOTDATA("Umsatz",PT!A3)' });
    const v = calculate(b)[0];
    expect(v.get(key(0, 5))).toBe(15);
    expect(v.get(key(1, 5))).toBe(45);
  });
});
