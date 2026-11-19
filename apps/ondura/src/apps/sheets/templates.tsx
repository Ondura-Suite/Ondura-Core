// Built-in workbook templates for the start page ("Datei › Start" / "Neu"),
// with miniatures drawn from the workbooks themselves.

import type { OfficeTemplate } from "../../shell/office";
import { tl } from "../../lib/i18n";
import { type Book, type CellStyle, type SCell, key, newBook, newSheet } from "./model";
import { sampleBook } from "./sample";

const GREEN = "#107c41";

function budget(): Book {
  const styles: CellStyle[] = [
    {},
    { bold: true, size10: 180, color: GREEN },
    { italic: true, color: "#595959" },
    { bold: true, color: "#ffffff", fill: GREEN },
    { numFmt: "#,##0.00 €" },
    { bold: true, numFmt: "#,##0.00 €", borderTop: "thin", borderBottom: "double" },
    { bold: true, borderTop: "thin", borderBottom: "double" },
    { numFmt: "#,##0.00 €", fill: "#e2efda" },
  ];
  const s = newSheet(tl("Budget"));
  const set = (r: number, c: number, cell: SCell) => s.cells.set(key(r, c), cell);
  set(0, 0, { v: tl("Monatsbudget"), s: 1 });
  set(1, 0, { v: tl("Tragen Sie Ihre Beträge in die grünen Felder ein."), s: 2 });
  [tl("Kategorie"), tl("Geplant"), tl("Tatsächlich"), tl("Differenz")].forEach((h, c) => set(3, c, { v: h, s: 3 }));
  const rows: [string, number, number][] = [
    [tl("Miete"), 950, 950],
    [tl("Lebensmittel"), 420, 465],
    [tl("Strom und Internet"), 140, 132],
    [tl("Versicherungen"), 110, 110],
    [tl("Mobilität"), 180, 204],
    [tl("Freizeit"), 150, 118],
    [tl("Sparen"), 300, 300],
  ];
  rows.forEach(([label, plan, actual], i) => {
    const r = 4 + i;
    set(r, 0, { v: label });
    set(r, 1, { v: plan, s: 7 });
    set(r, 2, { v: actual, s: 7 });
    set(r, 3, { f: `B${r + 1}-C${r + 1}`, s: 4 });
  });
  const total = 4 + rows.length;
  set(total, 0, { v: tl("Summe"), s: 6 });
  for (let c = 1; c <= 3; c++) {
    const col = "ABCD"[c];
    set(total, c, { f: `SUM(${col}5:${col}${total})`, s: 5 });
  }
  s.cols.set(0, 170);
  for (let c = 1; c <= 3; c++) s.cols.set(c, 110);
  s.freezeRows = 4;
  s.condFormats.push({ ranges: [{ r1: 4, c1: 3, r2: total - 1, c2: 3 }], rules: [{ kind: "cellIs", operator: "lessThan", formulas: ["0"], style: { color: "#9c0006", fill: "#ffc7ce" } }] });
  return { sheets: [s], styles, active: 0, title: tl("Monatsbudget"), author: "", names: [] };
}

function tasks(): Book {
  const styles: CellStyle[] = [{}, { bold: true, size10: 180, color: GREEN }, { bold: true, color: "#ffffff", fill: GREEN }, { numFmt: "dd.mm.yyyy" }];
  const s = newSheet(tl("Aufgaben"));
  const set = (r: number, c: number, cell: SCell) => s.cells.set(key(r, c), cell);
  set(0, 0, { v: tl("Aufgabenliste"), s: 1 });
  [tl("Aufgabe"), tl("Verantwortlich"), tl("Fällig"), tl("Status"), tl("Priorität")].forEach((h, c) => set(2, c, { v: h, s: 2 }));
  const today = Math.floor(Date.now() / 86400000) + 25569;
  const rows: [string, string, number, string, string][] = [
    [tl("Angebot erstellen"), "Anna", today + 2, tl("In Arbeit"), tl("Hoch")],
    [tl("Kickoff vorbereiten"), "Ben", today + 5, tl("Offen"), tl("Mittel")],
    [tl("Protokoll versenden"), "Anna", today + 1, tl("Erledigt"), tl("Niedrig")],
    [tl("Budget freigeben"), "Chris", today + 9, tl("Offen"), tl("Hoch")],
  ];
  rows.forEach((row, i) => row.forEach((v, c) => set(3 + i, c, c === 2 ? { v, s: 3 } : { v })));
  s.cols.set(0, 200);
  for (let c = 1; c <= 4; c++) s.cols.set(c, 110);
  s.freezeRows = 3;
  s.autoFilter = { range: { r1: 2, c1: 0, r2: 2 + rows.length, c2: 4 }, columns: [] };
  s.validations.push({ ranges: [{ r1: 3, c1: 3, r2: 200, c2: 3 }], kind: "list", operator: "between", formulas: [`"${tl("Offen")},${tl("In Arbeit")},${tl("Erledigt")}"`] });
  s.condFormats.push({ ranges: [{ r1: 3, c1: 3, r2: 200, c2: 3 }], rules: [{ kind: "cellIs", operator: "equal", formulas: [`"${tl("Erledigt")}"`], style: { color: "#006100", fill: "#c6efce" } }] });
  return { sheets: [s], styles, active: 0, title: tl("Aufgabenliste"), author: "", names: [] };
}

function invoice(): Book {
  const styles: CellStyle[] = [
    {},
    { bold: true, size10: 220, color: GREEN },
    { color: "#595959" },
    { bold: true, borderBottom: "thin" },
    { numFmt: "#,##0.00 €" },
    { bold: true, numFmt: "#,##0.00 €", borderTop: "thin", borderBottom: "double" },
    { bold: true },
  ];
  const s = newSheet(tl("Rechnung"));
  const set = (r: number, c: number, cell: SCell) => s.cells.set(key(r, c), cell);
  set(0, 0, { v: tl("Rechnung"), s: 1 });
  set(1, 0, { v: tl("Ihr Unternehmen · Straße Nr. · PLZ Ort"), s: 2 });
  set(3, 0, { v: tl("Rechnung an"), s: 6 });
  set(4, 0, { v: tl("Kunde") });
  set(5, 0, { v: tl("Straße Nr.") });
  set(6, 0, { v: tl("PLZ Ort") });
  set(3, 3, { v: tl("Rechnungsnr."), s: 6 });
  set(3, 4, { v: "2026-001" });
  [tl("Beschreibung"), tl("Menge"), tl("Einzelpreis"), tl("Betrag")].forEach((h, i) => set(8, i === 0 ? 0 : i + 1, { v: h, s: 3 }));
  set(8, 1, { v: "", s: 3 });
  const items: [string, number, number][] = [
    [tl("Beratung (Stunden)"), 6, 95],
    [tl("Einrichtung"), 1, 240],
  ];
  items.forEach(([d, q, p], i) => {
    const r = 9 + i;
    set(r, 0, { v: d });
    set(r, 2, { v: q });
    set(r, 3, { v: p, s: 4 });
    set(r, 4, { f: `C${r + 1}*D${r + 1}`, s: 4 });
  });
  set(13, 3, { v: tl("Netto") });
  set(13, 4, { f: "SUM(E10:E13)", s: 4 });
  set(14, 3, { v: tl("USt. 19 %") });
  set(14, 4, { f: "E14*0.19", s: 4 });
  set(15, 3, { v: tl("Gesamt"), s: 6 });
  set(15, 4, { f: "E14+E15", s: 5 });
  s.cols.set(0, 220);
  s.cols.set(1, 30);
  for (let c = 2; c <= 4; c++) s.cols.set(c, 100);
  s.showGrid = false;
  return { sheets: [s], styles, active: 0, title: tl("Rechnung"), author: "", names: [] };
}

export const SHEET_TEMPLATES: { id: string; label: string; build: () => Book }[] = [
  { id: "blank", label: tl("Leere Arbeitsmappe"), build: newBook },
  { id: "budget", label: tl("Monatsbudget"), build: budget },
  { id: "tasks", label: tl("Aufgabenliste"), build: tasks },
  { id: "invoice", label: tl("Rechnung"), build: invoice },
  { id: "sales", label: tl("Umsatzübersicht (Beispiel)"), build: sampleBook },
];

const COLS = 6;
const ROWS = 17;

/** Miniature of the top-left corner of the first sheet. */
export function SheetPreview({ book }: { book: Book }) {
  const sh = book.sheets[book.active] ?? book.sheets[0];
  const widths = Array.from({ length: COLS }, (_, c) => Math.min(3, (sh.cols.get(c) ?? 64) / 64));
  const grid = sh.showGrid !== false;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", display: "grid", gridTemplateColumns: widths.map((w) => `${w}fr`).join(" "), gridAutoRows: "11px", alignContent: "start" }}>
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const cell = sh.cells.get(key(r, c));
        const st = cell ? (book.styles[cell.s ?? 0] ?? {}) : {};
        const filled = cell && (cell.f || (cell.v !== undefined && cell.v !== ""));
        const big = (st.size10 ?? 110) > 140;
        return (
          <div
            key={i}
            style={{
              borderRight: grid ? "1px solid #ececef" : undefined,
              borderBottom: st.borderBottom ? "1px solid #8a8a8a" : grid ? "1px solid #ececef" : undefined,
              background: st.fill,
              display: "flex",
              alignItems: "center",
              padding: "0 3px",
              overflow: "visible",
            }}
          >
            {filled && <div style={{ height: big ? 5 : 2, width: big ? 64 : "70%", flexShrink: 0, borderRadius: 1, background: st.fill ? "rgba(255,255,255,0.85)" : big ? (st.color ?? "#333") : st.bold ? "#8d8d96" : "#cfcfd4" }} />}
          </div>
        );
      })}
    </div>
  );
}

export function sheetTemplates(): OfficeTemplate[] {
  return SHEET_TEMPLATES.map((t) => ({ id: t.id, label: t.label, preview: <SheetPreview book={t.build()} /> }));
}

export function buildSheetTemplate(id: string): Book | null {
  return SHEET_TEMPLATES.find((t) => t.id === id)?.build() ?? null;
}
