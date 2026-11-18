import { A4, type TextDocument } from "./model";

/** Demo content for the browser preview (no Tauri backend). */
export function sampleDocument(): TextDocument {
  const t = (text: string, marks?: Record<string, unknown>) => ({ type: "text" as const, text, marks });
  return {
    page: { ...A4 },
    title: "Projektbericht",
    author: "Niklas Linz",
    header: [{ type: "paragraph", align: "right", content: [t("MirraNET · Projektbericht Nexora")] }],
    footer: [{ type: "paragraph", align: "center", content: [t("Seite "), { type: "field", field: "page" }, t(" von "), { type: "field", field: "pages" }] }],
    blocks: [
      { type: "paragraph", style: "title", content: [t("Nexora – Projektbericht")] },
      { type: "paragraph", style: "subtitle", content: [t("Stand November 2026")] },
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
          t(". Alle Apps lesen und schreiben die Formate von Microsoft Office direkt – ohne Umwandlung."),
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
      { type: "paragraph", style: "quote", content: [t("„Die beste Software ist die, die man nicht bemerkt.“")] },
    ],
  };
}

function cell(text: string, background?: string) {
  return { colSpan: 1, rowSpan: 1, background, blocks: [{ type: "paragraph" as const, content: text ? [{ type: "text" as const, text }] : [] }] };
}
