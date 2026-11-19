import { describe, expect, it } from "vitest";
import { easter, holidays } from "./holidays";

const names = (y: number, c: string, r = "") => Object.fromEntries(holidays(y, c, r).map((h) => [h.name, h.date]));

describe("holidays", () => {
  it("computes Easter", () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easter(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
    expect(easter(2000).toISOString().slice(0, 10)).toBe("2000-04-23");
  });

  it("knows German national and state holidays", () => {
    const de = names(2026, "DE");
    expect(de["Karfreitag"]).toBe("2026-04-03");
    expect(de["Pfingstmontag"]).toBe("2026-05-25");
    expect(de["Fronleichnam"]).toBeUndefined();
    const sl = names(2026, "DE", "SL");
    expect(sl["Fronleichnam"]).toBe("2026-06-04");
    expect(sl["Mariä Himmelfahrt"]).toBe("2026-08-15");
    expect(names(2026, "DE", "SN")["Buß- und Bettag"]).toBe("2026-11-18");
    expect(names(2025, "DE", "SN")["Buß- und Bettag"]).toBe("2025-11-19");
  });

  it("moves UK bank holidays off the weekend and finds US weekdays", () => {
    const gb = names(2027, "GB");
    expect(gb["Christmas Day"]).toBe("2027-12-27");
    expect(gb["Boxing Day"]).toBe("2027-12-28");
    expect(names(2026, "US")["Thanksgiving Day"]).toBe("2026-11-26");
    expect(names(2026, "US")["Memorial Day"]).toBe("2026-05-25");
  });
});
