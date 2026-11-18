import { A4, type TextDocument } from "./model";

/** Demo content for the browser preview (no Tauri backend). */
export function sampleDocument(): TextDocument {
  const t = (text: string, marks?: Record<string, unknown>) => ({ type: "text" as const, text, marks });
  return {
    page: { ...A4 },
    title: "Projektbericht",
    comments: [{ id: 1, author: "Niklas Linz", date: "2026-11-18T07:05:00Z", text: "LibreOffice (.odt, .ods, .odp) ist jetzt auch dabei." }],
    author: "Niklas Linz",
    header: [{ type: "paragraph", align: "right", content: [t("MirraNET · Projektbericht Nexora")] }],
    footer: [{ type: "paragraph", align: "center", content: [t("Seite "), { type: "field", field: "page" }, t(" von "), { type: "field", field: "pages" }] }],
    blocks: [
      { type: "paragraph", style: "title", content: [t("Nexora – Projektbericht")] },
      { type: "paragraph", style: "subtitle", content: [t("Stand November 2026")] },
      { type: "toc", title: "Inhalt", entries: [{ level: 1, text: "Zusammenfassung", page: 1 }, { level: 2, text: "Meilensteine", page: 1 }, { level: 2, text: "Übersicht", page: 1 }] },
      { type: "paragraph", style: "heading1", content: [t("Zusammenfassung")] },
      {
        type: "paragraph",
        align: "justify",
        content: [
          t("Nexora ist eine Office-Suite für Windows und Linux. Sie besteht aus "),
          t("Orbit", { bold: true }),
          t(" für E-Mail, Kalender, Kontakte und Aufgaben sowie aus den Office-Apps "),
          t("Text", { italic: true }),
          t(", "),
          t("Tabellen", { italic: true }),
          t(" und "),
          t("Präsentation", { italic: true }),
          t(". Alle Apps lesen und schreiben die Formate von Microsoft Office und LibreOffice "),
          t("direkt", { comment: 1 }),
          { type: "footnote", text: "Unterstützt werden .docx, .xlsx und .pptx (Office Open XML)." },
          t(" – "),
          t("ganz ", { del: { author: "Niklas Linz", date: "2026-11-18T07:00:00Z" } }),
          t("ohne Umwandlung", { ins: { author: "Niklas Linz", date: "2026-11-18T07:00:00Z" } }),
          t("."),
        ],
      },
      { type: "paragraph", style: "heading2", content: [t("Meilensteine")] },
      { type: "paragraph", list: { ordered: true, level: 0 }, content: [t("Orbit mit Exchange, Microsoft 365 und IMAP")] },
      { type: "paragraph", list: { ordered: true, level: 0 }, content: [t("Nexora Text mit Seitenansicht und .docx")] },
      { type: "paragraph", list: { ordered: false, level: 1 }, content: [t("Tabellen, Bilder, Kopf- und Fußzeilen")] },
      { type: "paragraph", list: { ordered: false, level: 1 }, content: [t("Drucken und PDF-Export")] },
      { type: "paragraph", list: { ordered: true, level: 0 }, content: [t("Tabellen und Präsentation")] },
      { type: "paragraph", style: "heading2", content: [t("Übersicht")] },
      {
        type: "table",
        columnsMm: [60, 45, 60],
        rows: [
          { header: true, cells: [cell("App", "#d9e2f3"), cell("Format", "#d9e2f3"), cell("Status", "#d9e2f3")] },
          { cells: [cell("Orbit"), cell("–"), cell("fertig")] },
          { cells: [cell("Text"), cell(".docx"), cell("in Arbeit")] },
          { cells: [cell("Tabellen"), cell(".xlsx"), cell("geplant")] },
        ],
      },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [t("Wichtig: ", { bold: true, color: "#c00000" }), t("Dateien werden beim Speichern atomar ersetzt, ein Absturz zerstört nie das Original.", { highlight: "#ffff00" })] },
      { type: "paragraph", style: "quote", content: [t("„Die beste Software ist die, die man nicht bemerkt.“"), { type: "footnote", text: "Frei nach einem bekannten Grundsatz guter Gestaltung.", endnote: true }] },
      { type: "sectionBreak", page: { widthMm: 210, heightMm: 297, marginTopMm: 25, marginBottomMm: 20, marginLeftMm: 25, marginRightMm: 20, headerMm: 12.5, footerMm: 12.5 } },
      { type: "paragraph", style: "heading2", content: [t("Anhang")] },
      { type: "paragraph", content: [t("Dieser Abschnitt beginnt auf einer neuen Seite und kann ein eigenes Seitenformat haben.")] },
    ],
  };
}

function cell(text: string, background?: string) {
  return { colSpan: 1, rowSpan: 1, background, blocks: [{ type: "paragraph" as const, content: text ? [{ type: "text" as const, text }] : [] }] };
}
