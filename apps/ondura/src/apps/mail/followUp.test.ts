import { describe, expect, it } from "vitest";
import { followUpFor, followUpLabel, isOverdue } from "./followUp";

// Wednesday, 2026-11-25
const wed = new Date(2026, 10, 25, 10, 0);

describe("followUpFor", () => {
  it("gives Outlook's quick dates", () => {
    expect(followUpFor("today", wed)).toEqual({ start: "2026-11-25", due: "2026-11-25", done: false });
    expect(followUpFor("tomorrow", wed)).toEqual({ start: "2026-11-26", due: "2026-11-26", done: false });
    expect(followUpFor("thisWeek", wed)).toEqual({ start: "2026-11-27", due: "2026-11-27", done: false });
    expect(followUpFor("thisWeek", new Date(2026, 10, 23))).toEqual({ start: "2026-11-25", due: "2026-11-27", done: false });
    expect(followUpFor("nextWeek", wed)).toEqual({ start: "2026-11-30", due: "2026-12-04", done: false });
    expect(followUpFor("nextWeek", new Date(2026, 10, 29))).toEqual({ start: "2026-11-30", due: "2026-12-04", done: false });
    expect(followUpFor("noDate", wed)).toEqual({ start: null, due: null, done: false });
  });

  it("labels due, overdue and completed flags", () => {
    expect(followUpLabel({ isFlagged: true, followUp: { start: null, due: "2026-11-25", done: false } }, wed)).toBe("Fällig: heute");
    expect(followUpLabel({ isFlagged: true, followUp: { start: null, due: "2026-11-26", done: false } }, wed)).toBe("Fällig: morgen");
    expect(followUpLabel({ isFlagged: true, followUp: { start: null, due: null, done: false } }, wed)).toBe("Zur Nachverfolgung");
    expect(followUpLabel({ isFlagged: false, followUp: { start: null, due: null, done: true } }, wed)).toBe("Erledigt");
    expect(followUpLabel({ isFlagged: false }, wed)).toBeNull();
    expect(isOverdue({ isFlagged: true, followUp: { start: null, due: "2026-11-24", done: false } }, wed)).toBe(true);
  });
});
