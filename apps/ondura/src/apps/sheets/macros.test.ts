import { describe, expect, it } from "vitest";
import { SheetRecorder, formatDiff, runSheetMacro } from "./macros";
import { calculate, key, newBook } from "./model";

describe("sheet macros", () => {
  it("writes values, formulas and formats in one step", () => {
    const book = newBook();
    const res = runSheetMacro(
      `const s = workbook.activeSheet;
       s.range("A1:A3").setValues([[1], [2], ["3,5"]]);
       s.range("A4").setFormula("=SUMME(A1:A3)");
       s.range("A1:A4").setFormat({ bold: true, numberFormat: "0.00" });
       console.log(s.range("A4").value, s.range("A4").formulas[0][0]);
       workbook.addSheet("Bericht").range("B2").setValue("fertig").select();`,
      book,
      { r1: 0, c1: 0, r2: 0, c2: 0 },
    );
    expect(res.error).toBeUndefined();
    expect(res.log).toEqual(["6.5 =SUMME(A1:A3)"]);
    const sh = res.book.sheets[0];
    expect(calculate(res.book)[0].get(key(3, 0))).toBe(6.5);
    expect(res.book.styles[sh.cells.get(key(0, 0))!.s!].bold).toBe(true);
    expect(res.book.sheets[1].name).toBe("Bericht");
    expect(res.select).toEqual({ sheet: 1, rect: { r1: 1, c1: 1, r2: 1, c2: 1 } });
    expect(book.sheets[0].cells.size).toBe(0);
  });

  it("reports errors without changing the workbook", () => {
    const book = newBook();
    const res = runSheetMacro(`workbook.activeSheet.range("A1").setValue(1); workbook.sheet("Fehlt");`, book, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(res.error).toContain("Fehlt");
    expect(res.book).toBe(book);
  });

  it("records entries and formatting as a script that replays", () => {
    const rec = new SheetRecorder();
    rec.value("Tabelle1", 0, 0, "Umsatz");
    rec.value("Tabelle1", 1, 0, "1.234,50");
    rec.format("Tabelle1", { r1: 0, c1: 0, r2: 0, c2: 1 }, formatDiff({}, { bold: true, fill: "#ffff00" }));
    const script = rec.script();
    expect(script).toContain(`sheet.range("A1:B1").setFormat({"bold":true,"fill":"#ffff00"});`);
    const res = runSheetMacro(script, newBook(), { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(res.error).toBeUndefined();
    expect(res.book.sheets[0].cells.get(key(1, 0))?.v).toBe(1234.5);
  });
});
