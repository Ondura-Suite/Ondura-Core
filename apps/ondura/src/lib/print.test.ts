import { describe, expect, it } from "vitest";
import { parsePageRanges } from "./print";

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
