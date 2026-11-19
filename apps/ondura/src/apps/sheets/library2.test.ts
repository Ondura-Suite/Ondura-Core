import { describe, expect, it } from "vitest";
import "./format";
import type { Scalar } from "./formula";
import { a1, calculate, key, newBook, parseA1 } from "./model";

function one(f: string, cells: Record<string, number | string> = {}): Scalar {
  const b = newBook();
  const s = b.sheets[0];
  for (const [ref, v] of Object.entries({ ...cells, Z1: "=" + f })) {
    const p = parseA1(ref)!;
    s.cells.set(key(p.r, p.c), typeof v === "string" && v.startsWith("=") ? { f: v.slice(1) } : { v });
  }
  return calculate(b)[0].get(key(0, 25)) ?? null;
}
const near = (f: string, v: number, digits = 5) => {
  const r = one(f);
  expect(typeof r, `${f} → ${JSON.stringify(r)}`).toBe("number");
  expect(r as number).toBeCloseTo(v, digits);
};
void a1;

describe("complex numbers", () => {
  it("formats and computes like Excel", () => {
    expect(one("COMPLEX(3,4)")).toBe("3+4i");
    expect(one('COMPLEX(0,-1,"j")')).toBe("-j");
    expect(one('IMSUM("3+4i","5-3i")')).toBe("8+i");
    expect(one('IMPRODUCT("3+4i","5-3i")')).toBe("27+11i");
    expect(one('IMDIV("-238+240i","10+24i")')).toBe("5+12i");
    expect(one('IMSUB("13+4i","5+3i")')).toBe("8+i");
    near('IMABS("5+12i")', 13, 9);
    near('IMREAL(IMSQRT("1+i"))', 1.09868411346781, 9);
    near('IMAGINARY(IMPOWER("2+3i",3))', 9, 9);
    near('IMARGUMENT("3+4i")', 0.92729522, 7);
  });
});

describe("Bessel", () => {
  it("matches the documented values", () => {
    near("BESSELJ(1.9,2)", 0.329925829, 6);
    near("BESSELY(2.5,1)", 0.145918138, 6);
    near("BESSELI(1.5,1)", 0.981666428, 7);
    near("BESSELK(1.5,1)", 0.277387804, 7);
  });
});

describe("securities", () => {
  it("coupons", () => {
    const a = "DATE(2007,1,25),DATE(2008,11,15),2,1";
    near(`COUPNUM(${a})`, 4, 9);
    near(`COUPDAYS(${a})`, 181, 9);
    near(`COUPDAYBS(${a})`, 71, 9);
    near(`COUPDAYSNC(${a})`, 110, 9);
    near(`COUPNCD(${a})`, 39217, 9);
    near(`COUPPCD(${a})`, 39036, 9);
  });
  it("price, yield and duration", () => {
    near("PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)", 94.63436, 4);
    near("YIELD(DATE(2008,2,15),DATE(2016,11,15),0.0575,95.04287,100,2,0)", 0.065, 5);
    near("DURATION(DATE(2018,7,1),DATE(2048,1,1),0.08,0.09,2,1)", 10.9191453, 5);
    near("MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1)", 5.73567, 4);
  });
  it("discounted securities and T-bills", () => {
    near("PRICEDISC(DATE(2008,2,16),DATE(2008,3,1),0.0525,100,2)", 99.79583, 4);
    near("INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,2)", 0.05768, 5);
    near("RECEIVED(DATE(2008,2,15),DATE(2008,5,15),1000000,0.0575,2)", 1014584.654, 2);
    near("YIELDDISC(DATE(2008,2,16),DATE(2008,3,1),99.795,100,2)", 0.052823, 5);
    near("PRICEMAT(DATE(2008,2,15),DATE(2008,4,13),DATE(2007,11,11),0.061,0.061,0)", 99.98449888, 5);
    near("YIELDMAT(DATE(2008,3,15),DATE(2008,11,3),DATE(2007,11,8),0.0625,100.0123,0)", 0.060954, 5);
    near("ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)", 20.54794521, 6);
    near("TBILLPRICE(DATE(2008,3,31),DATE(2008,6,1),0.09)", 98.45, 6);
    near("TBILLYIELD(DATE(2008,3,31),DATE(2008,6,1),98.45)", 0.091417, 5);
    near("TBILLEQ(DATE(2008,3,31),DATE(2008,6,1),0.0914)", 0.094151, 5);
  });
  it("French depreciation and euro conversion", () => {
    near("AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)", 360, 6);
    near("AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)", 776, 6);
    near('EUROCONVERT(1,"EUR","DEM")', 1.96, 9);
    near('EUROCONVERT(1,"DEM","EUR",TRUE)', 0.511291881, 8);
  });
});

describe("statistics", () => {
  it("F.TEST and BINOM.DIST.RANGE", () => {
    near("F.TEST({6,7,9,15,21},{20,28,31,38,40})", 0.648318, 5);
    near("BINOM.DIST.RANGE(60,0.75,48)", 0.083974967, 7);
    near("BINOM.DIST.RANGE(60,0.75,45,50)", 0.523629793, 7);
  });
  it("FORECAST.ETS finds the season and continues it", () => {
    const vals = "{10,20,30,20,11,21,31,21,12,22,32,22,13,23,33,23}";
    const tl = "SEQUENCE(16)";
    expect(one(`FORECAST.ETS.SEASONALITY(${vals},${tl})`)).toBe(4);
    const f = one(`FORECAST.ETS(17,${vals},${tl})`) as number;
    expect(f).toBeGreaterThan(12);
    expect(f).toBeLessThan(16);
    const g = one(`FORECAST.ETS(19,${vals},${tl})`) as number;
    expect(g).toBeGreaterThan(32);
    expect(g).toBeLessThan(36);
  });
});

describe("arrays", () => {
  it("TRIMRANGE and PIVOTBY", () => {
    const b = newBook();
    const s = b.sheets[0];
    const put = (ref: string, v: number | string) => s.cells.set(key(parseA1(ref)!.r, parseA1(ref)!.c), typeof v === "string" && v.startsWith("=") ? { f: v.slice(1) } : { v });
    put("B2", 1);
    put("C3", 2);
    put("H1", "=ROWS(TRIMRANGE(A1:E6))*10+COLUMNS(TRIMRANGE(A1:E6))");
    for (const [i, [r, c, v]] of ([["Nord", "A", 1], ["Nord", "B", 2], ["Süd", "A", 3], ["Nord", "A", 4]] as const).entries()) {
      put(`J${i + 1}`, r);
      put(`K${i + 1}`, c);
      put(`L${i + 1}`, v);
    }
    put("N1", "=PIVOTBY(J1:J4,K1:K4,L1:L4,LAMBDA(x,SUM(x)))");
    put("N9", "=PIVOTBY(J1:J4,K1:K4,L1:L4,SUM)");
    const v = calculate(b)[0];
    const at = (ref: string) => v.get(key(parseA1(ref)!.r, parseA1(ref)!.c));
    expect(at("H1")).toBe(22);
    expect(at("O9")).toBe("A");
    // Header row: "", A, B, Gesamt; then Nord 5 2 7; Süd 3 "" 3; Gesamt 8 2 10.
    expect([at("O1"), at("P1"), at("Q1")]).toEqual(["A", "B", "Gesamt"]);
    expect([at("N2"), at("O2"), at("P2"), at("Q2")]).toEqual(["Nord", 5, 2, 7]);
    expect([at("N4"), at("O4"), at("P4"), at("Q4")]).toEqual(["Gesamt", 8, 2, 10]);
  });
});

describe("functions as values", () => {
  it("passes a bare function name as a lambda", () => {
    expect(one("REDUCE(0,{1,2,3},SUM)")).toBe(6);
    expect(one("SUM(BYROW({1,2;3,4},MAX))")).toBe(6);
  });
});
