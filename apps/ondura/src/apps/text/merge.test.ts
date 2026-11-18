import { describe, expect, it } from "vitest";
import { activeRows, addressLines, contactData, fieldsInDoc, mergeAll, mergeRecord, mergeState, parseCsv, sheetData } from "./merge";
import type { RustWorkbook } from "../sheets/model";
import type { Contact } from "../../lib/pim";

const field = (col: string) => ({ type: "field", attrs: { field: `merge ${col}`, result: null } });

describe("mail merge", () => {
  it("parses CSV with a guessed delimiter, quotes and line breaks", () => {
    const d = parseCsv('﻿Vorname;Nachname;Notiz\r\nAnna;Muster;"Hallo; ""Welt"""\r\nBen;"Zwei\nZeilen";\r\n\r\n');
    expect(d.columns).toEqual(["Vorname", "Nachname", "Notiz"]);
    expect(d.rows).toEqual([
      ["Anna", "Muster", 'Hallo; "Welt"'],
      ["Ben", "Zwei\nZeilen", ""],
    ]);
    expect(parseCsv("a,b\n1,2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").columns).toEqual(["a", "b"]);
  });

  it("makes column names unique and fills empty ones", () => {
    expect(parseCsv("Name;;Name\n1;2;3").columns).toEqual(["Name", "Spalte 2", "Name 2"]);
  });

  it("reads a worksheet", () => {
    const wb = { sheets: [{ name: "Adressen", cells: { A1: { v: "Vorname" }, B1: { v: "PLZ" }, A2: { v: "Anna" }, B2: { v: 66440 }, A4: { v: "Ben" } } }] } as unknown as RustWorkbook;
    const d = sheetData(wb, 0, "liste.xlsx");
    expect(d.columns).toEqual(["Vorname", "PLZ"]);
    expect(d.rows).toEqual([
      ["Anna", "66440"],
      ["Ben", ""],
    ]);
  });

  it("maps contacts and finds the address block columns", () => {
    const c = { givenName: "Anna", familyName: "Muster", displayName: "Anna Muster", company: "", jobTitle: "", emails: [{ label: "", value: "a@x.de" }], phones: [], addresses: [{ label: "", street: "Hauptstr. 1", city: "Berlin", postalCode: "10115", country: "" }] } as unknown as Contact;
    const d = contactData([c]);
    expect(d.rows[0][d.columns.indexOf("Ort")]).toBe("Berlin");
    expect(addressLines(d.columns)).toEqual([["Firma"], ["Vorname", "Nachname"], ["Straße"], ["PLZ", "Ort"], ["Land"]]);
  });

  it("replaces merge fields and drops empty address lines", () => {
    const nodes = [
      { type: "paragraph", content: [field("Firma")] },
      { type: "paragraph", content: [field("Vorname"), { type: "text", text: " " }, { ...field("Nachname"), marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "Text" }] },
    ];
    const out = mergeRecord(nodes, { Firma: "", Vorname: "Anna", Nachname: "Muster" });
    expect(out).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Anna" }, { type: "text", text: " " }, { type: "text", text: "Muster", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "Text" }] },
    ]);
  });

  it("merges the selected rows in list order with page breaks", () => {
    const data = parseCsv("Name\nA\nB\nC");
    const m = mergeState(data);
    m.included[1] = false;
    m.order = [2, 1, 0];
    expect(activeRows(m)).toEqual([2, 0]);
    const doc = { type: "doc", content: [{ type: "paragraph", content: [field("Name")] }] };
    expect(fieldsInDoc(doc)).toEqual(["Name"]);
    const out = mergeAll(doc, data, activeRows(m));
    expect(out.map((n) => n.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(out[0].content?.[0].text).toBe("C");
    expect(out[2].content?.[0].text).toBe("A");
  });
});
