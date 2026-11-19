import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { FORM_TEMPLATES, decodeResponses, encodeResponse, mergeResponses, missingRequired, newForm, newQuestion, responseRows, summarize, toCsv, type Response } from "./model";
import { formToPdf, responseFromPdf } from "./pdfForm";

const feedback = () => FORM_TEMPLATES.find((t) => t.id === "feedback")!.make();

describe("forms", () => {
  it("encodes responses for mails and finds them in quoted text", () => {
    const block = encodeResponse({ f: "f1", r: "r1", t: "2026-11-19T10:00:00Z", a: { q1: "Grüße – ✓", q2: ["a", "b"], q3: 7 } });
    const quoted = "Antwort:\n" + block.split("\n").map((l) => `> ${l}`).join("\n");
    expect(decodeResponses(`${block}\n\n${quoted}`)).toEqual([
      { f: "f1", r: "r1", t: "2026-11-19T10:00:00Z", a: { q1: "Grüße – ✓", q2: ["a", "b"], q3: 7 } },
      { f: "f1", r: "r1", t: "2026-11-19T10:00:00Z", a: { q1: "Grüße – ✓", q2: ["a", "b"], q3: 7 } },
    ]);
  });

  it("checks required answers, merges without duplicates and summarises", () => {
    const f = feedback();
    const [rating, scale, multi] = f.questions;
    expect(missingRequired(f, {})).toEqual([rating.id]);
    const rs: Response[] = [
      { id: "a", submitted: "2026-01-01", answers: { [rating.id]: 5, [scale.id]: 10, [multi.id]: ["Preis"] }, source: "app" },
      { id: "b", submitted: "2026-01-02", answers: { [rating.id]: 3, [scale.id]: 2, [multi.id]: ["Preis", "Qualität"] }, source: "web" },
    ];
    const { form, added } = mergeResponses(f, [...rs, rs[0]]);
    expect(added).toBe(2);
    expect(mergeResponses(form, rs).added).toBe(0);
    expect(summarize(rating, form.responses).average).toBe(4);
    expect(summarize(scale, form.responses).nps).toBe(0);
    expect(summarize(multi, form.responses).options?.find((o) => o.label === "Preis")?.count).toBe(2);
    const csv = toCsv(responseRows(form));
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("Preis; Qualität");
  });

  it("reads the answers back from a filled PDF form", async () => {
    const f = newForm("Test");
    const text = { ...newQuestion("text"), title: "Name" };
    const choice = { ...newQuestion("choice"), title: "Wahl", options: ["Ja", "Nein"], other: true };
    const multi = { ...newQuestion("multi"), title: "Mehr", options: ["A", "B", "C"] };
    const rating = { ...newQuestion("rating"), title: "Sterne" };
    f.questions = [text, choice, multi, rating];
    const bytes = await formToPdf(f);
    const doc = await PDFDocument.load(bytes);
    const pf = doc.getForm();
    pf.getTextField(`q_${text.id}`).setText("Anna Müller");
    pf.getRadioGroup(`q_${choice.id}`).select("other");
    pf.getTextField(`q_${choice.id}__other`).setText("Später");
    pf.getCheckBox(`q_${multi.id}__0`).check();
    pf.getCheckBox(`q_${multi.id}__2`).check();
    pf.getRadioGroup(`q_${rating.id}`).select("3");
    const filled = await doc.save();
    const r = await responseFromPdf(f, filled, "anna.pdf");
    expect(r?.answers).toEqual({ [text.id]: "Anna Müller", [choice.id]: "Später", [multi.id]: ["A", "C"], [rating.id]: 4 });
    // Another form's PDF is not taken.
    expect(await responseFromPdf(newForm("X"), filled, "x.pdf")).toBeNull();
  });
});
