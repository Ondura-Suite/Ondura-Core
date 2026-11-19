import { describe, expect, it } from "vitest";
import { orderBetween } from "./model";

describe("orderBetween", () => {
  it("always lies strictly between its neighbours", () => {
    const cases: [string | undefined, string | undefined][] = [
      [undefined, undefined],
      [undefined, "4"],
      ["4", "8"],
      ["4", "5"],
      ["4", "4i"],
      ["4z", "5"],
      ["4", undefined],
      ["zz", undefined],
    ];
    for (const [a, b] of cases) {
      const k = orderBetween(a, b);
      if (a !== undefined) expect(k > a).toBe(true);
      if (b !== undefined) expect(k < b).toBe(true);
    }
  });
  it("keeps working when inserting many times at the same place", () => {
    let lo = "4";
    const hi = "5";
    for (let i = 0; i < 50; i++) {
      const k = orderBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      lo = k;
    }
  });
});
