import { type Book, type CellStyle, type SCell, key, newSheet } from "./model";

/** Demo workbook for the browser preview. */
export function sampleBook(): Book {
  const styles: CellStyle[] = [
    {},
    { bold: true, color: "#ffffff", fill: "#107c41", hAlign: "center" },
    { numFmt: "#,##0.00 €" },
    { numFmt: "0.0%" },
    { bold: true, numFmt: "#,##0.00 €", borderTop: "thin", borderBottom: "double" },
    { bold: true, size10: 160, color: "#107c41" },
    { italic: true, color: "#595959" },
    { numFmt: "dd.mm.yyyy" },
  ];
  const s = newSheet("Umsatz 2026");
  const set = (r: number, c: number, cell: SCell) => s.cells.set(key(r, c), cell);
  set(0, 0, { v: "Umsatzübersicht MirraNET", s: 5 });
  set(1, 0, { v: "Alle Beträge netto", s: 6 });
  ["Monat", "Hosting", "Support", "Lizenzen", "Gesamt", "Anteil"].forEach((h, c) => set(3, c, { v: h, s: 1 }));
  const months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November"];
  const data = [
    [4200, 1250, 980], [4310, 1180, 1020], [4475, 1420, 990], [4520, 1510, 1110], [4610, 1390, 1280], [4790, 1620, 1150],
    [4805, 1480, 1300], [4900, 1550, 1210], [5120, 1700, 1420], [5240, 1610, 1380], [5375, 1820, 1505],
  ];
  months.forEach((m, i) => {
    const r = 4 + i;
    set(r, 0, { v: m });
    data[i].forEach((v, j) => set(r, j + 1, { v, s: 2 }));
    set(r, 4, { f: `SUM(B${r + 1}:D${r + 1})`, s: 2 });
    set(r, 5, { f: `E${r + 1}/$E$16`, s: 3 });
  });
  set(15, 0, { v: "Summe", s: 4 });
  for (let c = 1; c <= 4; c++) {
    const col = "ABCDE"[c];
    set(15, c, { f: `SUM(${col}5:${col}15)`, s: 4 });
  }
  set(17, 0, { v: "Durchschnitt Hosting" });
  set(17, 1, { f: "AVERAGE(B5:B15)", s: 2 });
  set(18, 0, { v: "Bester Monat" });
  set(18, 1, { f: 'INDEX(A5:A15,MATCH(MAX(E5:E15),E5:E15,0))' });
  set(19, 0, { v: "Stand" });
  set(19, 1, { v: 46344, s: 7 });
  s.cols.set(0, 150);
  for (let c = 1; c <= 4; c++) s.cols.set(c, 100);
  s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 5 });
  s.freezeRows = 4;
  const s2 = newSheet("Notizen");
  s2.cells.set(key(0, 0), { v: "Formeln wie =SUMME(A1:A3) werden auf Deutsch eingegeben." });
  return { sheets: [s, s2], styles, active: 0, title: "Umsatz", author: "Niklas Linz" };
}
