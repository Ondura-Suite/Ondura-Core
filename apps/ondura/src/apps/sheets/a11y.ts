// Accessibility checks for Ondura Tabellen (following Excel's checker).

import { contrastTooLow, type A11yIssue } from "../../shell/a11y";
import { colName } from "./formula";
import { MAX_COLS, type Book, type Rect } from "./model";
import { tl } from "../../lib/i18n";

export interface SheetCheckActions {
  select: (sheet: number, rect: Rect) => void;
  selectObject: (sheet: number, id: string) => void;
  editAlt: (sheet: number, id: string, current: string) => void;
  rename: (sheet: number) => void;
  headerRow: (sheet: number, table: string) => void;
}

const ref = (r: number, c: number) => `${colName(c)}${r + 1}`;

export function checkBook(book: Book, a: SheetCheckActions): A11yIssue[] {
  const issues: A11yIssue[] = [];
  let seq = 0;
  const id = () => `s${seq++}`;
  book.sheets.forEach((sh, si) => {
    if (sh.hidden) return;
    const where = (text: string) => `${sh.name}: ${text}`;
    if (/^(Tabelle|Sheet|Blatt)\d+$/i.test(sh.name) && (sh.cells.size > 0 || book.sheets.length > 1)) {
      issues.push({
        id: id(),
        severity: "tip",
        rule: tl("Standardname des Tabellenblatts"),
        where: sh.name,
        help: tl("Aussagekräftige Blattnamen („Umsatz 2026“ statt „Tabelle1“) helfen beim Navigieren mit dem Bildschirmleser."),
        select: () => a.select(si, { r1: 0, c1: 0, r2: 0, c2: 0 }),
        fix: { label: tl("Umbenennen"), run: () => a.rename(si) },
      });
    }
    sh.objects.forEach((o, i) => {
      if (o.type === "image" && !o.alt?.trim()) {
        issues.push({
          id: id(),
          severity: "error",
          rule: tl("Fehlender Alternativtext"),
          where: where(o.name || tl("Bild {0}", i + 1)),
          help: tl("Ohne Alternativtext erfahren Personen mit Bildschirmleser nicht, was das Bild zeigt."),
          select: () => a.selectObject(si, o.id),
          fix: { label: tl("Alternativtext hinzufügen"), run: () => a.editAlt(si, o.id, "") },
        });
      }
    });
    for (const t of sh.tables) {
      if (!t.headerRow) {
        issues.push({
          id: id(),
          severity: "warning",
          rule: tl("Keine Kopfzeile in der Tabelle"),
          where: where(t.name),
          help: tl("Mit einer Kopfzeile sagt der Bildschirmleser zu jeder Zelle, zu welcher Spalte sie gehört."),
          select: () => a.select(si, t.range),
          fix: { label: tl("Kopfzeile einschalten"), run: () => a.headerRow(si, t.name) },
        });
      }
    }
    for (const m of sh.merges) {
      issues.push({
        id: id(),
        severity: "warning",
        rule: tl("Verbundene Zellen"),
        where: where(`${ref(m.r1, m.c1)}:${ref(m.r2, m.c2)}`),
        help: tl("Bildschirmleser zählen Zeilen und Spalten; verbundene Zellen bringen diese Zählung durcheinander. Verwenden Sie „Über Auswahl zentrieren“ oder getrennte Zellen."),
        select: () => a.select(si, m),
      });
    }
    let lowContrast = 0;
    for (const [k, cell] of sh.cells) {
      if (cell.s === undefined || cell.v === undefined || cell.v === "") continue;
      const st = book.styles[cell.s];
      if (!st?.color && !st?.fill) continue;
      const pt = (st.size10 ?? 110) / 10;
      if (contrastTooLow(st.color ?? "#000000", st.fill ?? "#ffffff", pt, !!st.bold)) {
        const r = Math.floor(k / MAX_COLS);
        const c = k % MAX_COLS;
        if (++lowContrast <= 20) {
          issues.push({
            id: id(),
            severity: "warning",
            rule: tl("Schwer lesbarer Textkontrast"),
            where: where(ref(r, c)),
            help: tl("Der Kontrast zwischen Schrift- und Füllfarbe ist kleiner als 4,5:1 (WCAG 2.1)."),
            select: () => a.select(si, { r1: r, c1: c, r2: r, c2: c }),
          });
        }
      }
    }
  });
  return issues;
}
