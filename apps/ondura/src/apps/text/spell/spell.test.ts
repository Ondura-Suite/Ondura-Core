import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { correct, createSpellers, suggest, supplement } from "./core";
import { DE_HEADS, DE_NOUNS } from "./supplement";
import { documentWords } from "./spell";

const de = createSpellers(readFileSync("node_modules/dictionary-de/index.aff", "utf8"), readFileSync("node_modules/dictionary-de/index.dic", "utf8"));
supplement(de, DE_NOUNS, DE_HEADS);
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("German spelling", () => {
  it("accepts compounds (with Fugen), abbreviations, codes, loanwords", () => {
    const good = words(`Rechtschreibprüfung Überarbeitungsmodus Wirtschaftlichkeitsberechnung Kundenzufriedenheit Krankenversicherungsbeitrag
      Datenschutzgrundverordnung Benutzeroberfläche Zwischenablage Inhaltsverzeichnis Geburtstagsfeier Bahnhofsvorplatz Großstadt Rotwein
      Lesebrille Schreibtisch Kinderzimmer Wohnzimmerlampe Zellenformatvorlagen Druckvorschau Seitenansicht Cloudspeicher Onlinebanking
      benutzerfreundlich arbeitsunfähig kostenlos umweltfreundlich DSGVO USB-Stick bzw ggf usw Nr iPhone PowerPoint Apps Homeoffice Know-how
      geht’s gibt's E-Mail-Adresse PDF-Export Zweite Seitenumbruch Mitarbeiterinnen Straße dass`);
    expect(good.filter((w) => !correct(de, "de", w))).toEqual([]);
  });

  it("rejects typos, also those that only look like compounds", () => {
    const bad = words(`Rechtschriebung Rechtschriebeng Rechtschriebund Hausund Tischeng Autouns Kaffeeund Schreibtich Fehller Hauss Komputer
      Grüsse Strasse wierd Gramatik Addresse Zwischenablgae Benutzeroberfäche Seitenanischt Druckvorchau Kalenderwohce Gebursttag Benutzerkonot`);
    expect(bad.filter((w) => correct(de, "de", w))).toEqual([]);
  });

  it("suggests the intended word first, and no made-up compounds", () => {
    const first = (w: string) => suggest(de, "de", w)[0];
    expect(first("Rechtschriebung")).toBe("Rechtschreibung");
    expect(first("Seitenanischt")).toBe("Seitenansicht");
    expect(first("Druckvorchau")).toBe("Druckvorschau");
    expect(first("Kalenderwohce")).toBe("Kalenderwoche");
    expect(first("Gebursttag")).toBe("Geburtstag");
    expect(first("Benutzerkonot")).toBe("Benutzerkonto");
    expect(first("Gramatik")).toBe("Grammatik");
    expect(suggest(de, "de", "Rechtschriebung")).not.toContain("Rechtschriebeng");
    expect(suggest(de, "de", "Rechtschriebung").some((s) => /\p{Ll}\p{Lu}/u.test(s))).toBe(false);
  });
});

describe("documentWords", () => {
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} }, marks: { bold: {}, code: {}, link: {}, deletion: {} } });
  const para = (...parts: [string, string?][]) =>
    schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        parts.map(([t, m]) => schema.text(t, m ? [schema.mark(m)] : [])),
      ),
    ]);

  it("keeps a partly formatted word together", () => {
    expect(documentWords(para(["Das "], ["W", "bold"], ["ort ist gut"])).map((w) => w.word)).toEqual(["Das", "Wort", "ist", "gut"]);
  });
  it("reads soft hyphens as part of the word, the range covers them", () => {
    const [w] = documentWords(para(["Sil­ben"]));
    expect(w).toEqual({ from: 1, to: 8, word: "Silben" });
  });
  it("skips code, links, deleted text, URLs and words glued to digits", () => {
    expect(documentWords(para(["Text "], ["Kode", "code"], [" siehe "], ["Linktext", "link"], [" "], ["alt", "deletion"], [" www.beispiel.de 3D H2O"])).map((w) => w.word)).toEqual(["Text", "siehe"]);
  });
});
