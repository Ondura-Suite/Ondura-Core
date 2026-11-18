import { describe, expect, it } from "vitest";
import "./format";
import { type Scalar, fromDisplayFormula, toDisplayFormula } from "./formula";
import { type Book, a1, calculate, key, newBook, parseA1, spillInfo } from "./model";

/** A one-sheet book from {A1: value or "=formula"}. */
function book(cells: Record<string, string | number | boolean>): Book {
  const b = newBook();
  const s = b.sheets[0];
  for (const [ref, v] of Object.entries(cells)) {
    const p = parseA1(ref)!;
    s.cells.set(key(p.r, p.c), typeof v === "string" && v.startsWith("=") ? { f: v.slice(1) } : { v });
  }
  return b;
}
function calc(cells: Record<string, string | number | boolean>) {
  const b = book(cells);
  const values = calculate(b);
  const get = (ref: string): Scalar => {
    const p = parseA1(ref)!;
    const c = b.sheets[0].cells.get(key(p.r, p.c));
    if (c && !c.f) return c.v ?? null;
    return values[0].get(key(p.r, p.c)) ?? null;
  };
  return { get, values, b };
}
const one = (f: string, cells: Record<string, string | number | boolean> = {}) => calc({ ...cells, Z1: "=" + f }).get("Z1");
const near = (f: string, v: number, digits = 9, cells: Record<string, string | number | boolean> = {}) => {
  const r = one(f, cells);
  expect(typeof r, `${f} → ${JSON.stringify(r)}`).toBe("number");
  expect(r as number).toBeCloseTo(v, digits);
};

describe("dynamic arrays", () => {
  it("spills SEQUENCE and blocks on occupied cells", () => {
    const { get, values } = calc({ A1: "=SEQUENCE(3,2)" });
    expect([get("A1"), get("B1"), get("A3"), get("B3")]).toEqual([1, 2, 5, 6]);
    expect(spillInfo(values)?.areas[0].get(key(0, 0))).toEqual({ rows: 3, cols: 2 });
    const blocked = calc({ A1: "=SEQUENCE(3)", A2: "x" });
    expect(blocked.get("A1")).toEqual({ error: "#SPILL!" });
  });
  it("broadcasts operators and lifts scalar functions", () => {
    const { get } = calc({ A1: 1, A2: 2, A3: 3, B1: "=A1:A3*10", C1: "=LEN(\"ab\"&A1:A3)", D1: "=SUM((A1:A3>1)*A1:A3)" });
    expect([get("B1"), get("B2"), get("B3")]).toEqual([10, 20, 30]);
    expect([get("C1"), get("C3")]).toEqual([3, 3]);
    expect(get("D1")).toBe(5);
  });
  it("reads spill ranges with A1# and forward references", () => {
    const { get } = calc({ C1: "=SUM(A1#)", A1: "=SEQUENCE(4)", D1: "=A4" });
    expect(get("C1")).toBe(10);
    expect(get("D1")).toBe(4);
  });
  it("supports array functions", () => {
    const { get } = calc({ A1: 3, A2: 1, A3: 2, B1: "a", B2: "b", B3: "c", D1: "=SORTBY(B1:B3,A1:A3)", E1: "=TAKE(A1:A3,-2)", F1: "=VSTACK(1,2)", G1: "=TEXTSPLIT(\"x,y;z,w\",\",\",\";\")" });
    expect([get("D1"), get("D2"), get("D3")]).toEqual(["b", "c", "a"]);
    expect([get("E1"), get("E2")]).toEqual([1, 2]);
    expect([get("F1"), get("F2")]).toEqual([1, 2]);
    expect([get("G1"), get("H1"), get("G2"), get("H2")]).toEqual(["x", "y", "z", "w"]);
  });
});

describe("LET and LAMBDA", () => {
  it("binds names and calls lambdas", () => {
    expect(one("LET(x,2,y,x*3,x+y)")).toBe(8);
    expect(one("LAMBDA(a,b,a*b)(3,4)")).toBe(12);
    expect(one("REDUCE(0,SEQUENCE(4),LAMBDA(acc,v,acc+v))")).toBe(10);
    expect(one("SUM(MAP(SEQUENCE(3),LAMBDA(v,v*v)))")).toBe(14);
    expect(one("SUM(BYROW(SEQUENCE(2,2),LAMBDA(r,SUM(r))))")).toBe(10);
    expect(one("LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(1)")).toBe(1);
    expect(one("LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(1,2)")).toBe(3);
    expect(one("LAMBDA(x,y,IF(ISOMITTED(y),x,x+y))(1)")).toBe(1);
    expect(one("LAMBDA(x,x)")).toEqual({ error: "#CALC!" });
  });
  it("calls lambdas stored in defined names", () => {
    const b = book({ A1: "=DOUBLE(21)" });
    b.names = [{ name: "DOUBLE", formula: "LAMBDA(n,n*2)" }];
    expect(calculate(b)[0].get(key(0, 0))).toBe(42);
  });
  it("shows German names", () => {
    expect(toDisplayFormula("LET(x,1,XMATCH(x,A1:A3))")).toBe("LET(x;1;XVERGLEICH(x;A1:A3))");
    expect(fromDisplayFormula("TEXTVOR(A1;\" \")")).toBe('TEXTBEFORE(A1," ")');
  });
});

describe("statistics", () => {
  const data = { A1: 2, A2: 4, A3: 4, A4: 4, A5: 5, A6: 5, A7: 7, A8: 9 };
  it("computes descriptive statistics", () => {
    near("STDEV.P(A1:A8)", 2, 12, data);
    near("VAR.S(A1:A8)", 32 / 7, 12, data);
    near("PERCENTILE.INC(A1:A8,0.25)", 4, 12, data);
    near("QUARTILE.EXC(A1:A8,1)", 4, 12, data);
    near("GEOMEAN(A1:A8)", 4.60321559604674, 10, data);
    near("TRIMMEAN(A1:A8,0.25)", 4.8333333, 6, data);
    near("RANK.AVG(4,A1:A8)", 6, 12, data);
    near("KURT(A1:A8)", 0.940625, 6, data);
    near("SKEW(A1:A8)", 0.8184875, 6, data);
  });
  it("computes regressions", () => {
    const xy = { A1: 1, A2: 2, A3: 3, A4: 4, B1: 2, B2: 4.1, B3: 5.9, B4: 8.2 };
    near("SLOPE(B1:B4,A1:A4)", 2.04, 10, xy);
    near("INTERCEPT(B1:B4,A1:A4)", -0.05, 10, xy);
    near("CORREL(A1:A4,B1:B4)", 0.998992298023759, 10, xy);
    near("FORECAST.LINEAR(5,B1:B4,A1:A4)", 10.15, 10, xy);
    near("INDEX(LINEST(B1:B4,A1:A4),1,1)", 2.04, 10, xy);
    near("INDEX(TREND(B1:B4,A1:A4,{5}),1,1)", 10.15, 10, xy);
  });
  it("computes distributions", () => {
    near("NORM.S.DIST(1.96,TRUE)", 0.9750021048517795, 10);
    near("NORM.S.INV(0.975)", 1.959963984540054, 8);
    near("NORM.DIST(42,40,1.5,TRUE)", 0.908788780274132, 10);
    near("NORM.INV(0.908789,40,1.5)", 42.000002, 5);
    near("T.DIST(1.96,60,TRUE)", 0.972677535131735, 10);
    near("T.INV.2T(0.05,10)", 2.228138852, 7);
    near("CHISQ.DIST.RT(18.307,10)", 0.0500005890913981, 10);
    near("CHISQ.INV.RT(0.05,10)", 18.30703805, 6);
    near("F.DIST.RT(15.2069,6,4)", 0.00999995699723731, 10);
    near("BINOM.DIST(6,10,0.5,FALSE)", 0.205078125, 10);
    near("BINOM.DIST(6,10,0.5,TRUE)", 0.828125, 10);
    near("POISSON.DIST(2,5,TRUE)", 0.124652019, 8);
    near("EXPON.DIST(0.2,10,TRUE)", 0.864664717, 8);
    near("GAMMA.DIST(10.00001131,9,2,TRUE)", 0.0680940038697872, 10);
    near("BETA.DIST(2,8,10,TRUE,1,3)", 0.685470581054688, 10);
    near("CONFIDENCE.NORM(0.05,2.5,50)", 0.692951912, 8);
    near("GAMMA(5)", 24, 10);
    near("ERF(1)", 0.842700793, 8);
  });
});

describe("finance", () => {
  it("computes loans and returns", () => {
    near("NPER(0.12/12,-100,-1000,10000,1)", 59.6738657, 6);
    near("RATE(48,-200,8000)", 0.007701472, 8);
    near("IPMT(0.1/12,1,36,8000)", -66.66666667, 6);
    near("PPMT(0.1/12,1,24,2000)", -75.62318601, 6);
    near("CUMIPMT(0.09/12,30*12,125000,13,24,0)", -11135.23213, 4);
    near("NPV(0.1,-10000,3000,4200,6800)", 1188.443412, 5);
    near("IRR({-70000,12000,15000,18000,21000,26000})", 0.086630948, 8);
    near("XNPV(0.09,{-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})", 2086.647602, 4);
    near("XIRR({-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})", 0.373362535, 7);
    near("MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)", 0.126094, 6);
    near("EFFECT(0.0525,4)", 0.053542667, 8);
    near("DB(1000000,100000,6,1,7)", 186083.3333, 3);
    near("DDB(2400,300,10*365,1)", 1.315068493, 8);
    near("VDB(2400,300,10,0,1)", 480, 8);
    near("SYD(30000,7500,10,1)", 4090.909091, 5);
  });
});

describe("text, dates, lookup, engineering, database", () => {
  it("handles text", () => {
    expect(one('TEXTBEFORE("Max Mustermann"," ")')).toBe("Max");
    expect(one('TEXTAFTER("a-b-c","-",-1)')).toBe("c");
    expect(one('REGEXEXTRACT("Tel 0681-123","[0-9]+-[0-9]+")')).toBe("0681-123");
    expect(one('REGEXREPLACE("a1b22","[0-9]+","#")')).toBe("a#b#");
    expect(one("UNICHAR(9731)")).toBe("☃");
    expect(one('ARRAYTOTEXT({1,"a";2,"b"},1)')).toBe('{1,"a";2,"b"}');
  });
  it("handles dates", () => {
    expect(one('DATEVALUE("24.12.2026")')).toBe(46380);
    near('TIMEVALUE("18:30")', 0.770833333, 8);
    near("YEARFRAC(DATE(2012,1,1),DATE(2012,7,30),0)", 0.580555556, 8);
    expect(one("DAYS360(DATE(2011,1,30),DATE(2011,12,31))")).toBe(330);
    expect(one('NETWORKDAYS.INTL(DATE(2026,11,2),DATE(2026,11,13),"0000011")')).toBe(10);
    expect(one("WORKDAY.INTL(DATE(2026,11,13),1,1)")).toBe(46342);
  });
  it("handles lookups and references", () => {
    const cells = { A1: "x", A2: "y", A3: "z", B1: 10, B2: 20, B3: 30 };
    expect(one('XMATCH("z",A1:A3)', cells)).toBe(3);
    expect(one("XMATCH(25,B1:B3,1)", cells)).toBe(3);
    expect(one("LOOKUP(25,B1:B3,A1:A3)", cells)).toBe("y");
    expect(one("SUM(OFFSET(A1,0,1,3,1))", cells)).toBe(60);
    expect(one('INDIRECT("B"&2)', cells)).toBe(20);
    expect(one('ADDRESS(2,3,1,TRUE,"Daten")')).toBe("Daten!$C$2");
    expect(one('SWITCH(2,1,"a",2,"b","c")')).toBe("b");
    expect(one("FORMULATEXT(C1)", { C1: "=1+1" })).toBe("=1+1");
  });
  it("handles engineering and units", () => {
    expect(one("DEC2BIN(9,8)")).toBe("00001001");
    expect(one('HEX2DEC("FF")')).toBe(255);
    expect(one("DEC2HEX(-1)")).toBe("FFFFFFFFFF");
    expect(one("BITXOR(5,3)")).toBe(6);
    near('CONVERT(1,"mi","km")', 1.609344, 10);
    near('CONVERT(100,"C","F")', 212, 10);
    near('CONVERT(1,"kWh","J")', 3.6e6, 4);
  });
  it("handles database functions", () => {
    const db = { A1: "Region", B1: "Umsatz", A2: "Nord", B2: 100, A3: "Süd", B3: 50, A4: "Nord", B4: 30, D1: "Region", D2: "Nord" };
    expect(one("DSUM(A1:B4,\"Umsatz\",D1:D2)", db)).toBe(130);
    expect(one("DCOUNT(A1:B4,2,D1:D2)", db)).toBe(2);
    expect(one("DGET(A1:B4,2,D1:D2)", db)).toEqual({ error: "#NUM!" });
  });
  it("addresses are A1", () => expect(a1(2, 27)).toBe("AB3"));
});

describe("Excel tables", () => {
  it("evaluates structured references", () => {
    const b = book({ A1: "Artikel", B1: "Menge", C1: "Preis", D1: "Summe", A2: "Kabel", B2: 3, C2: 2.5, D2: "=[@Menge]*[@Preis]", A3: "Stecker", B3: 10, C3: 0.4, D3: "=[@Menge]*[@Preis]", A4: "Ergebnis", D4: "=SUBTOTAL(109,Tabelle1[Summe])", F1: "=SUM(Tabelle1[Menge])", F2: "=ROWS(Tabelle1)", F3: "=COUNTA(Tabelle1[[#Headers],[Artikel]:[Preis]])", F4: "=Tabelle1[[#Totals],[Summe]]" });
    b.sheets[0].tables = [{ name: "Tabelle1", range: { r1: 0, c1: 0, r2: 3, c2: 3 }, headerRow: true, totalsRow: true, style: "TableStyleMedium2", bandedRows: true, bandedCols: false, firstCol: false, lastCol: false, filter: true, columns: ["Artikel", "Menge", "Preis", "Summe"].map((name) => ({ name })) }];
    const v = calculate(b)[0];
    const at = (ref: string) => v.get(key(parseA1(ref)!.r, parseA1(ref)!.c));
    expect([at("D2"), at("D3"), at("D4"), at("F1"), at("F2"), at("F3"), at("F4")]).toEqual([7.5, 4, 11.5, 13, 2, 3, 11.5]);
    expect(toDisplayFormula("SUBTOTAL(109,Tabelle1[[#Headers],[Menge]])")).toBe("TEILERGEBNIS(109;Tabelle1[[#Kopfzeilen];[Menge]])");
    expect(fromDisplayFormula("SUMME(Tabelle1[[#Daten];[Menge]])")).toBe("SUM(Tabelle1[[#Data],[Menge]])");
  });
});
