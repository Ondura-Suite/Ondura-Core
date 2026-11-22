import { A4, type TextDocument } from "./model";
import { tl, tlc } from "../../lib/i18n";

/** Demo content for the browser preview (no Tauri backend). */
export function sampleDocument(): TextDocument {
  const t = (text: string, marks?: Record<string, unknown>) => ({ type: "text" as const, text, marks });
  return {
    page: { ...A4 },
    title: tl("Projektbericht"),
    comments: [{ id: 1, author: "Niklas Linz", date: "2026-11-18T07:05:00Z", text: tl("LibreOffice (.odt, .ods, .odp) ist jetzt auch dabei.") }],
    author: "Niklas Linz",
    header: [{ type: "paragraph", align: "right", content: [t(tl("MirraNET · Projektbericht Ondura"))] }],
    footer: [{ type: "paragraph", align: "center", content: [t(tl("Seite ")), { type: "field", field: "page" }, t(tl(" von ")), { type: "field", field: "pages" }] }],
    blocks: [
      { type: "paragraph", style: "title", content: [t(tl("Ondura – Projektbericht"))] },
      { type: "paragraph", style: "subtitle", content: [t(tl("Stand November 2026"))] },
      { type: "toc", title: tl("Inhalt"), entries: [{ level: 1, text: tl("Zusammenfassung"), page: 1 }, { level: 2, text: tl("Meilensteine"), page: 1 }, { level: 2, text: tl("Übersicht"), page: 1 }] },
      { type: "paragraph", style: "heading1", content: [t(tl("Zusammenfassung"))] },
      {
        type: "paragraph",
        align: "justify",
        content: [
          t(tl("Ondura ist eine Office-Suite für Windows und Linux. Sie besteht aus ")),
          t("Ondura Mail", { bold: true }),
          t(tl(" für E-Mail, Kalender, Kontakte und Aufgaben sowie aus den Office-Apps ")),
          t(tlc("App", "Text"), { italic: true }),
          t(", "),
          t(tlc("App", "Tabellen"), { italic: true }),
          t(tl(" und ")),
          t(tlc("App", "Präsentation"), { italic: true }),
          t(tl(". Alle Apps lesen und schreiben die Formate von Microsoft Office und LibreOffice ")),
          t(tl("direkt"), { comment: 1 }),
          { type: "footnote", text: tl("Unterstützt werden .docx, .xlsx und .pptx (Office Open XML).") },
          t(" – "),
          t(tl("ganz "), { del: { author: "Niklas Linz", date: "2026-11-18T07:00:00Z" } }),
          t(tl("ohne Umwandlung"), { ins: { author: "Niklas Linz", date: "2026-11-18T07:00:00Z" } }),
          t("."),
        ],
      },
      { type: "paragraph", style: "heading2", content: [t(tl("Meilensteine"))] },
      { type: "paragraph", list: { ordered: true, level: 0 }, content: [t(tl("Ondura Mail mit Exchange, Microsoft 365 und IMAP"))] },
      { type: "paragraph", list: { ordered: true, level: 0 }, content: [t(tl("Ondura Text mit Seitenansicht und .docx"))] },
      { type: "paragraph", list: { ordered: false, level: 1 }, content: [t(tl("Tabellen, Bilder, Kopf- und Fußzeilen"))] },
      { type: "paragraph", list: { ordered: false, level: 1 }, content: [t(tl("Drucken und PDF-Export"))] },
      { type: "paragraph", list: { ordered: true, level: 0 }, content: [t(tl("Tabellen und Präsentation"))] },
      { type: "paragraph", style: "heading2", content: [t(tl("Übersicht"))] },
      {
        type: "table",
        columnsMm: [60, 45, 60],
        rows: [
          { header: true, cells: [cell(tl("App"), "#d9e2f3"), cell(tl("Format"), "#d9e2f3"), cell(tl("Status"), "#d9e2f3")] },
          { cells: [cell("Ondura Mail"), cell("–"), cell(tl("fertig"))] },
          { cells: [cell(tlc("App", "Text")), cell(".docx"), cell(tl("in Arbeit"))] },
          { cells: [cell(tlc("App", "Tabellen")), cell(".xlsx"), cell(tl("geplant"))] },
        ],
      },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [t(tl("Wichtig: "), { bold: true, color: "#c00000" }), t(tl("Dateien werden beim Speichern atomar ersetzt, ein Absturz zerstört nie das Original."), { highlight: "#ffff00" })] },
      { type: "paragraph", style: "quote", content: [t(tl("„Die beste Software ist die, die man nicht bemerkt.“")), { type: "footnote", text: tl("Frei nach einem bekannten Grundsatz guter Gestaltung."), endnote: true }] },
      { type: "sectionBreak", page: { widthMm: 210, heightMm: 297, marginTopMm: 25, marginBottomMm: 20, marginLeftMm: 25, marginRightMm: 20, headerMm: 12.5, footerMm: 12.5 } },
      { type: "paragraph", style: "heading2", content: [t(tl("Anhang"))] },
      { type: "paragraph", content: [t(tl("Dieser Abschnitt beginnt auf einer neuen Seite und kann ein eigenes Seitenformat haben."))] },
    ],
  };
}

function cell(text: string, background?: string) {
  return { colSpan: 1, rowSpan: 1, background, blocks: [{ type: "paragraph" as const, content: text ? [{ type: "text" as const, text }] : [] }] };
}
