// Sample document of the browser preview (the desktop app opens files).

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { tl } from "../../lib/i18n";

export async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(tl("Angebot Website-Relaunch"));
  doc.setAuthor("MirraNET");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.13, 0.18);
  const accent = rgb(0.77, 0.19, 0.29);
  const form = doc.getForm();

  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawRectangle({ x: 0, y: 781, width: 595.28, height: 61, color: accent });
  p1.drawText("MirraNET", { x: 56, y: 805, size: 20, font: bold, color: rgb(1, 1, 1) });
  p1.drawText(tl("Angebot Nr. 2026-117"), { x: 56, y: 730, size: 22, font: bold, color: ink });
  p1.drawText(tl("Website-Relaunch und Betreuung"), { x: 56, y: 704, size: 13, font, color: rgb(0.4, 0.4, 0.45) });
  const lines = [
    tl("Sehr geehrte Damen und Herren,"),
    "",
    tl("vielen Dank für Ihre Anfrage. Gern bieten wir Ihnen die Neugestaltung Ihrer"),
    tl("Website einschließlich Hosting und Wartung für zwölf Monate an. Die Leistungen"),
    tl("im Einzelnen finden Sie in der folgenden Aufstellung."),
  ];
  lines.forEach((l, i) => p1.drawText(l, { x: 56, y: 660 - i * 18, size: 11, font, color: ink }));
  const rows: [string, string][] = [
    [tl("Konzept und Design"), "2.400,00 €"],
    [tl("Umsetzung (CMS, 12 Seiten)"), "4.800,00 €"],
    [tl("Hosting und Wartung, 12 Monate"), "1.188,00 €"],
  ];
  let y = 540;
  p1.drawRectangle({ x: 56, y: y - 6, width: 483, height: 24, color: rgb(0.95, 0.95, 0.97) });
  p1.drawText(tl("Leistung"), { x: 64, y, size: 11, font: bold, color: ink });
  p1.drawText(tl("Betrag"), { x: 470, y, size: 11, font: bold, color: ink });
  for (const [a, b] of rows) {
    y -= 28;
    p1.drawText(a, { x: 64, y, size: 11, font, color: ink });
    p1.drawText(b, { x: 539 - font.widthOfTextAtSize(b, 11) - 8, y, size: 11, font, color: ink });
    p1.drawLine({ start: { x: 56, y: y - 9 }, end: { x: 539, y: y - 9 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
  }
  y -= 34;
  p1.drawText(tl("Gesamt (netto)"), { x: 64, y, size: 12, font: bold, color: ink });
  p1.drawText("8.388,00 €", { x: 539 - bold.widthOfTextAtSize("8.388,00 €", 12) - 8, y, size: 12, font: bold, color: accent });

  p1.drawText(tl("Auftragsbestätigung"), { x: 56, y: 300, size: 14, font: bold, color: ink });
  p1.drawText(tl("Name"), { x: 56, y: 268, size: 10, font, color: rgb(0.4, 0.4, 0.45) });
  const nameField = form.createTextField("name");
  nameField.addToPage(p1, { x: 56, y: 236, width: 230, height: 26, borderColor: rgb(0.7, 0.7, 0.75), borderWidth: 1 });
  p1.drawText(tl("Datum"), { x: 310, y: 268, size: 10, font, color: rgb(0.4, 0.4, 0.45) });
  const dateField = form.createTextField("datum");
  dateField.addToPage(p1, { x: 310, y: 236, width: 229, height: 26, borderColor: rgb(0.7, 0.7, 0.75), borderWidth: 1 });
  const agree = form.createCheckBox("agb");
  agree.addToPage(p1, { x: 56, y: 200, width: 14, height: 14, borderColor: rgb(0.5, 0.5, 0.55), borderWidth: 1 });
  p1.drawText(tl("Ich nehme das Angebot an und akzeptiere die AGB."), { x: 78, y: 203, size: 10, font, color: ink });
  p1.drawLine({ start: { x: 56, y: 120 }, end: { x: 286, y: 120 }, thickness: 0.8, color: rgb(0.5, 0.5, 0.55) });
  p1.drawText(tl("Unterschrift"), { x: 56, y: 106, size: 9, font, color: rgb(0.4, 0.4, 0.45) });

  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText(tl("Leistungsbeschreibung"), { x: 56, y: 770, size: 18, font: bold, color: ink });
  const text = tl(
    "Die neue Website wird responsiv umgesetzt und ist auf Smartphones, Tablets und Desktop-Rechnern gleichermaßen gut bedienbar. Inhalte pflegen Sie selbst im CMS. Das Hosting erfolgt in Deutschland, Sicherungen laufen täglich. Updates von System und Erweiterungen sind im Wartungsvertrag enthalten.",
  );
  const words = text.split(" ");
  let line = "";
  let ly = 735;
  for (const w of words) {
    if (font.widthOfTextAtSize(`${line} ${w}`, 11) > 483) {
      p2.drawText(line.trim(), { x: 56, y: ly, size: 11, font, color: ink });
      ly -= 17;
      line = "";
    }
    line += ` ${w}`;
  }
  p2.drawText(line.trim(), { x: 56, y: ly, size: 11, font, color: ink });
  return doc.save();
}
