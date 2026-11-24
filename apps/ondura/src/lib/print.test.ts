import { describe, expect, it } from "vitest";
import { pageRectOnSheet, parsePageRanges, sheetLayout } from "./print";

describe("parsePageRanges", () => {
  it("parses single pages, ranges and open ends", () => {
    expect(parsePageRanges("1-3, 5", 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageRanges("8-", 10)).toEqual([8, 9, 10]);
    expect(parsePageRanges("3,1,3", 5)).toEqual([1, 3]);
  });
  it("clips to the page count and rejects garbage", () => {
    expect(parsePageRanges("4-9", 5)).toEqual([4, 5]);
    expect(parsePageRanges("a-b", 5)).toBeNull();
    expect(parsePageRanges("5-2", 5)).toBeNull();
    expect(parsePageRanges("", 5)).toBeNull();
  });
});

describe("pages per sheet", () => {
  const A4 = [595, 842] as const;
  it("turns the sheet for 2 and 6 pages like Chromium and CUPS", () => {
    expect(sheetLayout(2, ...A4)).toEqual({ width: 842, height: 595, cols: 2, rows: 1 });
    expect(sheetLayout(6, ...A4)).toEqual({ width: 842, height: 595, cols: 3, rows: 2 });
    expect(sheetLayout(4, ...A4)).toEqual({ width: 595, height: 842, cols: 2, rows: 2 });
    expect(sheetLayout(2, 842, 595)).toEqual({ width: 595, height: 842, cols: 1, rows: 2 });
  });
  it("centres each page in its cell, left to right, then top to bottom", () => {
    const l = sheetLayout(4, ...A4);
    expect(pageRectOnSheet(l, 0, ...A4)).toEqual({ x: 0, y: 0, scale: 0.5 });
    expect(pageRectOnSheet(l, 3, ...A4)).toEqual({ x: 297.5, y: 421, scale: 0.5 });
    const two = pageRectOnSheet(sheetLayout(2, ...A4), 1, ...A4);
    expect(two.x).toBeCloseTo(421 + (421 - 595 * two.scale) / 2);
    expect(two.scale).toBeCloseTo(595 / 842);
  });
});
