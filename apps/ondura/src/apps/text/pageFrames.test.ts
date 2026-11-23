import { describe, expect, it } from "vitest";
import { bookletSides, logicalSize, pageMargins, withMultiplePages, DEFAULT_LAYOUT } from "./pageFrames";
import { A4 } from "./model";

describe("page frames", () => {
  const page = { ...A4, marginLeftMm: 30, marginRightMm: 20, gutterMm: 10 };

  it("puts the gutter inside on facing pages", () => {
    const l = { ...DEFAULT_LAYOUT, mirrorMargins: true };
    expect(pageMargins(page, l, 1)).toMatchObject({ left: 40, right: 20 });
    expect(pageMargins(page, l, 2)).toMatchObject({ left: 20, right: 40 });
  });

  it("puts the gutter at the top when asked", () => {
    const m = pageMargins(page, { ...DEFAULT_LAYOUT, gutterAtTop: true }, 2);
    expect(m).toMatchObject({ left: 30, right: 20, top: page.marginTopMm + 10 });
  });

  it("halves the paper with two pages per sheet and book fold", () => {
    expect(logicalSize(A4, { twoOnOne: true, bookFold: false })).toEqual({ widthMm: 210, heightMm: 148.5 });
    expect(logicalSize({ ...A4, widthMm: 297, heightMm: 210 }, { twoOnOne: false, bookFold: true })).toEqual({ widthMm: 148.5, heightMm: 210 });
  });

  it("switches the multiple-pages mode", () => {
    const l = withMultiplePages({ ...DEFAULT_LAYOUT, gutterAtTop: true }, "bookFold");
    expect(l).toMatchObject({ bookFold: true, mirrorMargins: false, twoOnOne: false, gutterAtTop: false });
  });

  it("orders booklet pages for folding", () => {
    expect(bookletSides(8)).toEqual([
      [7, 0],
      [1, 6],
      [5, 2],
      [3, 4],
    ]);
    expect(bookletSides(3)).toEqual([
      [null, 0],
      [1, 2],
    ]);
  });
});
