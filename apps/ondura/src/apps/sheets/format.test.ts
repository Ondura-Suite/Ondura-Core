import { describe, expect, it } from "vitest";
import { fitGeneral } from "./format";

// One character = one unit of room.
const room = (n: number) => (t: string) => t.length <= n;

describe("fitGeneral", () => {
  it("drops decimals to fit, as Excel does for the General format", () => {
    expect(fitGeneral(21.508473156250313, room(20))).toBe("21,5084731562503");
    expect(fitGeneral(21.508473156250313, room(8))).toBe("21,50847");
    expect(fitGeneral(21.508473156250313, room(2))).toBe("22");
    expect(fitGeneral(1 / 3, room(6))).toBe("0,3333");
  });
  it("goes scientific when the integer part does not fit, ### (null) at last", () => {
    expect(fitGeneral(123456789012, room(9))).toBe("1,235E+11");
    expect(fitGeneral(123456789, room(5))).toBe("1E+08");
    expect(fitGeneral(123456789, room(3))).toBeNull();
  });
});
