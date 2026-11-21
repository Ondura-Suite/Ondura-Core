import { describe, expect, it } from "vitest";
import { nextSlot, suggestSlots } from "./suggest";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const hm = (d: Date) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("suggestSlots", () => {
  it("skips busy times and the past", () => {
    // Monday 23 Nov 2026, 9:10; busy 9:30–11:00 and 11:30–12:00.
    const busy = [
      { start: at(23, 9, 30), end: at(23, 11) },
      { start: at(23, 11, 30), end: at(23, 12) },
    ];
    const slots = suggestSlots(busy, { duration: 30, from: at(23, 9, 10), count: 3 });
    expect(slots.map(hm)).toEqual(["23 11:00", "23 12:00", "23 12:30"]);
  });

  it("moves to the next working day", () => {
    // Friday 27 Nov, fully booked from 17:00: next is Monday 8:00.
    const slots = suggestSlots([{ start: at(27, 17), end: at(27, 18) }], { duration: 60, from: at(27, 16, 30), count: 1 });
    expect(slots.map(hm)).toEqual(["30 8:00"]);
  });

  it("needs room for the whole meeting", () => {
    const busy = [{ start: at(23, 9), end: at(23, 17, 30) }];
    const slots = suggestSlots(busy, { duration: 60, from: at(23, 8), count: 1, days: 1 });
    expect(slots.map(hm)).toEqual(["23 8:00"]);
    expect(suggestSlots(busy, { duration: 90, from: at(23, 8), count: 1, days: 1 }).map(hm)).toEqual(["24 8:00"]);
  });
});

describe("nextSlot", () => {
  it("rounds up to the grid", () => {
    expect(hm(nextSlot(at(23, 9, 10)))).toBe("23 9:30");
    expect(hm(nextSlot(at(23, 9, 30)))).toBe("23 9:30");
    expect(hm(nextSlot(at(23, 9, 45)))).toBe("23 10:00");
  });
});
