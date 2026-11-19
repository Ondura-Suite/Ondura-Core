// Fillable PDF of a form (AcroForm fields, filled in any PDF reader) and
// reading the answers back from returned PDFs.

import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { tl } from "../../lib/i18n";
import { rid, type Answer, type Form, type Response } from "./model";

const A4: [number, number] = [595.28, 841.89];
const M = 50;

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Characters the standard font cannot encode become "?". */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch === "\n" ? "\n" : "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safe(font, text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export const KEYWORD = (id: string) => `ondura-form:${id}`;

export async function formToPdf(form: Form): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(form.title);
  doc.setSubject(form.description);
  doc.setCreator("Ondura Formulare");
  doc.setKeywords([KEYWORD(form.id)]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pdfForm = doc.getForm();
  const accent = hex(form.color);
  const width = A4[0] - 2 * M;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const ensure = (h: number) => {
    if (y - h < M) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };
  const text = (t: string, size: number, f: PDFFont, color = rgb(0.13, 0.13, 0.13), indent = 0) => {
    for (const line of wrap(f, t, size, width - indent)) {
      ensure(size * 1.4);
      page.drawText(line, { x: M + indent, y: y - size, size, font: f, color });
      y -= size * 1.35;
    }
  };

  // Header band in the theme colour.
  page.drawRectangle({ x: 0, y: A4[1] - 14, width: A4[0], height: 14, color: accent });
  text(form.title, 22, bold);
  y -= 4;
  if (form.description) text(form.description, 10.5, font, rgb(0.35, 0.35, 0.35));
  y -= 10;

  let n = 0;
  for (const q of form.questions) {
    if (q.type === "section") {
      ensure(40);
      y -= 8;
      page.drawRectangle({ x: M, y: y - 2, width, height: 2, color: accent });
      y -= 10;
      text(q.title || tl("Abschnitt"), 14, bold, accent);
      if (q.description) text(q.description, 10, font, rgb(0.35, 0.35, 0.35));
      y -= 6;
      continue;
    }
    n++;
    ensure(60);
    text(`${n}. ${q.title || tl("Frage")}${q.required ? " *" : ""}`, 11.5, bold);
    if (q.description) text(q.description, 9.5, font, rgb(0.4, 0.4, 0.4));
    y -= 4;
    const name = `q_${q.id}`;
    const field = { borderColor: rgb(0.6, 0.6, 0.65), backgroundColor: rgb(0.97, 0.97, 0.99), font };
    if (q.type === "text" || q.type === "number" || q.type === "date") {
      ensure(30);
      const tf = pdfForm.createTextField(name);
      tf.addToPage(page, { x: M, y: y - 22, width: q.type === "text" ? width : 180, height: 20, ...field });
      tf.setFontSize(10.5);
      if (q.type === "date") page.drawText(tl("TT.MM.JJJJ"), { x: M + 190, y: y - 15, size: 8.5, font, color: rgb(0.5, 0.5, 0.5) });
      y -= 32;
    } else if (q.type === "longtext") {
      ensure(80);
      const tf = pdfForm.createTextField(name);
      tf.enableMultiline();
      tf.addToPage(page, { x: M, y: y - 70, width, height: 68, ...field });
      tf.setFontSize(10.5);
      y -= 80;
    } else if (q.type === "dropdown") {
      ensure(30);
      const dd = pdfForm.createDropdown(name);
      dd.addOptions((q.options ?? []).map((o) => safe(font, o)));
      dd.addToPage(page, { x: M, y: y - 22, width: Math.min(width, 260), height: 20, ...field });
      dd.setFontSize(10.5);
      y -= 32;
    } else if (q.type === "choice" || q.type === "rating" || q.type === "scale") {
      const opts = q.type === "choice" ? (q.options ?? []) : q.type === "rating" ? Array.from({ length: q.max ?? 5 }, (_, i) => String(i + 1)) : Array.from({ length: (q.max ?? 10) + 1 }, (_, i) => String(i));
      const rg = pdfForm.createRadioGroup(name);
      if (q.type === "choice") {
        opts.forEach((o, i) => {
          ensure(18);
          rg.addOptionToPage(String(i), page, { x: M + 4, y: y - 13, width: 11, height: 11, borderColor: rgb(0.45, 0.45, 0.5) });
          page.drawText(safe(font, o), { x: M + 22, y: y - 11.5, size: 10.5, font });
          y -= 18;
        });
      } else {
        // Ratings and scales side by side with their numbers.
        ensure(36);
        const step = Math.min(42, width / opts.length);
        opts.forEach((o, i) => {
          const x = M + 4 + i * step;
          rg.addOptionToPage(String(i), page, { x, y: y - 14, width: 12, height: 12, borderColor: rgb(0.45, 0.45, 0.5) });
          page.drawText(o, { x: x + 2, y: y - 26, size: 8.5, font, color: rgb(0.35, 0.35, 0.35) });
        });
        if (q.minLabel || q.maxLabel) {
          page.drawText(safe(font, q.minLabel ?? ""), { x: M + 4, y: y - 37, size: 7.5, font, color: rgb(0.5, 0.5, 0.5) });
          const right = safe(font, q.maxLabel ?? "");
          page.drawText(right, { x: M + 4 + (opts.length - 1) * step + 12 - font.widthOfTextAtSize(right, 7.5), y: y - 37, size: 7.5, font, color: rgb(0.5, 0.5, 0.5) });
        }
        y -= 44;
      }
      if (q.other && q.type === "choice") {
        ensure(26);
        rg.addOptionToPage("other", page, { x: M + 4, y: y - 13, width: 11, height: 11, borderColor: rgb(0.45, 0.45, 0.5) });
        page.drawText(tl("Sonstiges:"), { x: M + 22, y: y - 11.5, size: 10.5, font });
        const ot = pdfForm.createTextField(`${name}__other`);
        ot.addToPage(page, { x: M + 90, y: y - 17, width: 220, height: 18, ...field });
        ot.setFontSize(10);
        y -= 24;
      }
      y -= 6;
    } else if (q.type === "multi") {
      (q.options ?? []).forEach((o, i) => {
        ensure(18);
        pdfForm.createCheckBox(`${name}__${i}`).addToPage(page, { x: M + 4, y: y - 13, width: 11, height: 11, borderColor: rgb(0.45, 0.45, 0.5) });
        page.drawText(safe(font, o), { x: M + 22, y: y - 11.5, size: 10.5, font });
        y -= 18;
      });
      if (q.other) {
        ensure(24);
        pdfForm.createCheckBox(`${name}__other`).addToPage(page, { x: M + 4, y: y - 13, width: 11, height: 11, borderColor: rgb(0.45, 0.45, 0.5) });
        page.drawText(tl("Sonstiges:"), { x: M + 22, y: y - 11.5, size: 10.5, font });
        const ot = pdfForm.createTextField(`${name}__othertext`);
        ot.addToPage(page, { x: M + 90, y: y - 17, width: 220, height: 18, ...field });
        ot.setFontSize(10);
        y -= 24;
      }
      y -= 6;
    }
    y -= 6;
  }
  ensure(30);
  y -= 10;
  page.drawText(safe(font, tl("Bitte speichern Sie das ausgefüllte PDF und senden Sie es zurück.")), { x: M, y, size: 8.5, font, color: rgb(0.5, 0.5, 0.5) });
  pdfForm.updateFieldAppearances(font);
  return doc.save();
}

/** The answers in a filled PDF; `null` if the PDF is not from this form. */
export async function responseFromPdf(form: Form, bytes: Uint8Array, fileName: string): Promise<Response | null> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const keywords = doc.getKeywords() ?? "";
  if (!keywords.includes(KEYWORD(form.id))) return null;
  const f = doc.getForm();
  // pdf-lib's field classes have private constructors, so the type is passed as a plain value.
  const get = <T>(name: string, type: unknown): T | null => {
    try {
      const field = f.getField(name);
      return field instanceof (type as new () => object) ? (field as T) : null;
    } catch {
      return null;
    }
  };
  const answers: Record<string, Answer> = {};
  for (const q of form.questions) {
    const name = `q_${q.id}`;
    let a: Answer = null;
    switch (q.type) {
      case "text":
      case "longtext":
      case "date":
        a = get<PDFTextField>(name, PDFTextField)?.getText()?.trim() || null;
        break;
      case "number": {
        const t = get<PDFTextField>(name, PDFTextField)?.getText()?.trim().replace(",", ".");
        a = t && !isNaN(Number(t)) ? Number(t) : t || null;
        break;
      }
      case "dropdown":
        a = get<PDFDropdown>(name, PDFDropdown)?.getSelected()[0] ?? null;
        break;
      case "choice": {
        const v = get<PDFRadioGroup>(name, PDFRadioGroup)?.getSelected();
        if (v === "other") a = get<PDFTextField>(`${name}__other`, PDFTextField)?.getText()?.trim() || tl("Sonstiges");
        else if (v !== undefined) a = q.options?.[Number(v)] ?? null;
        break;
      }
      case "rating":
      case "scale": {
        const v = get<PDFRadioGroup>(name, PDFRadioGroup)?.getSelected();
        if (v !== undefined) a = Number(v) + (q.type === "rating" ? 1 : 0);
        break;
      }
      case "multi": {
        const picked = (q.options ?? []).filter((_, i) => get<PDFCheckBox>(`${name}__${i}`, PDFCheckBox)?.isChecked());
        if (get<PDFCheckBox>(`${name}__other`, PDFCheckBox)?.isChecked()) picked.push(get<PDFTextField>(`${name}__othertext`, PDFTextField)?.getText()?.trim() || tl("Sonstiges"));
        a = picked.length ? picked : null;
        break;
      }
    }
    if (a !== null) answers[q.id] = a;
  }
  if (!Object.keys(answers).length) return null;
  // The same file imported twice gives the same id.
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  const id = "pdf-" + Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  return { id, submitted: new Date().toISOString(), answers, source: "pdf", respondent: fileName || rid() };
}
