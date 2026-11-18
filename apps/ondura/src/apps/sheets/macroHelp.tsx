// Template and API reference for Tabellen macros.

export const SHEET_MACRO_TEMPLATE = `// Beispiel: Kopfzeile formatieren und eine Summe eintragen
const sheet = workbook.activeSheet;
sheet.range("A1:D1").setFormat({ bold: true, fill: "#dbe8f5" });
const werte = sheet.range("B2:B13").values.flat().filter((v) => typeof v === "number");
console.log("Summe:", werte.reduce((a, b) => a + b, 0));
`;

export const SHEET_MACRO_REFERENCE = (
  <>
    <code>workbook</code>: <code>activeSheet</code>, <code>sheets</code>, <code>sheet(name)</code>, <code>addSheet(name)</code>, <code>selection</code> ·{" "}
    <code>sheet.range("A1:C3")</code>, <code>sheet.cells(zeile, spalte, zeilen, spalten)</code>, <code>sheet.usedRange()</code> · Bereich:{" "}
    <code>values</code>, <code>value</code>, <code>formulas</code>, <code>setValue(v)</code>, <code>setValues([[…]])</code>, <code>setFormula("=SUMME(A1:A3)")</code>,{" "}
    <code>setFormat({"{ bold, italic, color, fill, numberFormat, align, fontSize, wrap }"})</code>, <code>clear()</code>, <code>select()</code> ·{" "}
    <code>console.log(…)</code>. Ein Makro wird mit einem Schritt rückgängig gemacht.
  </>
);
