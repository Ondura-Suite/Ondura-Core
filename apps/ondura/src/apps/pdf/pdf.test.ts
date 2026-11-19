import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFArray, PDFDict } from "@cantoo/pdf-lib";
import { decrypt, encrypt, deletePages, moveOrder, parseRange, reorderPages, rotatePages, insertDocuments, splitEvery, addPageNumbers, addWatermark } from "./ops";
import { embedSignature, findSignatures, pdfDate, prepareSignature } from "./sign";

async function sample(pages = 3) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300 + i, 400]).drawText(`Seite ${i + 1}`, { x: 20, y: 300 });
  return d.save();
}
const widths = async (b: Uint8Array) => (await PDFDocument.load(b)).getPages().map((p) => Math.round(p.getWidth()));

describe("page operations", () => {
  it("reorders, deletes and rotates", async () => {
    const b = await sample();
    expect(await widths(await reorderPages(b, [2, 0, 1]))).toEqual([302, 300, 301]);
    expect(await widths(await deletePages(b, [1]))).toEqual([300, 302]);
    const r = await PDFDocument.load(await rotatePages(b, [0], -90));
    expect(r.getPage(0).getRotation().angle).toBe(270);
    expect(moveOrder(4, [3], 1)).toEqual([0, 3, 1, 2]);
    expect(moveOrder(4, [0, 1], 4)).toEqual([2, 3, 0, 1]);
  });
  it("merges, splits and decorates", async () => {
    const b = await sample(2);
    expect((await widths(await insertDocuments(b, [await sample(1)], 1)))).toEqual([300, 300, 301]);
    expect((await splitEvery(await sample(5), 2)).length).toBe(3);
    const n = await addPageNumbers(b, { position: "bottom-center", format: "Seite {n} von {total}", size: 10, from: 0, startAt: 1 });
    expect((await PDFDocument.load(n)).getPageCount()).toBe(2);
    expect((await PDFDocument.load(await addWatermark(b, { text: "ENTWURF", size: 60, opacity: 0.2, color: "#c4314b", diagonal: true }))).getPageCount()).toBe(2);
  });
  it("parses page ranges", () => {
    expect(parseRange("1-3, 5", 6)).toEqual([0, 1, 2, 4]);
    expect(parseRange("4-", 6)).toEqual([3, 4, 5]);
    expect(parseRange("7", 6)).toBeNull();
  });
  it("encrypts and decrypts", async () => {
    const enc = await encrypt(await sample(), { openPassword: "geheim", printing: true, copying: false, modifying: false });
    await expect(PDFDocument.load(enc)).rejects.toThrow();
    const plain = await decrypt(enc, "geheim");
    expect((await PDFDocument.load(plain)).getPageCount()).toBe(3);
  });
});

describe("signatures", () => {
  it("prepares, embeds and finds a signature as incremental update", async () => {
    const base = await sample(1);
    const prep = await prepareSignature(base, { name: "Max Muster", reason: "Freigabe", dateText: "19.11.2026", appearance: { page: 0, x: 20, y: 20, width: 160, height: 50 } });
    // The original bytes stay in front (incremental update).
    expect([...prep.pdf.subarray(0, base.length)]).toEqual([...base]);
    const cms = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x05]);
    const signed = embedSignature(prep, cms);
    const [found] = findSignatures(signed);
    expect(found.name).toBe("Max Muster");
    expect(found.reason).toBe("Freigabe");
    expect([...found.cms]).toEqual([...cms]);
    expect(found.coversAll).toBe(true);
    expect([...found.signed]).toEqual([...prep.signed]);
    const doc = await PDFDocument.load(signed);
    const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    const form = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    expect(form.lookup(PDFName.of("Fields"), PDFArray).size()).toBe(1);
    // A second signature keeps the first one's signed bytes.
    const prep2 = await prepareSignature(signed, { name: "Erika", dateText: "x", appearance: null });
    const twice = findSignatures(embedSignature(prep2, cms));
    expect(twice.length).toBe(2);
    expect(twice[0].coversAll).toBe(false);
    expect([...twice[0].signed]).toEqual([...found.signed]);
  });
  it("reads PDF dates", () => {
    expect(pdfDate("D:20261119183012+01'00'")?.toISOString()).toBe("2026-11-19T17:30:12.000Z");
  });
});
