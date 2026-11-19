// Digital signatures in PDF documents (ISO 32000 / PAdES baseline style):
// a signature dictionary with SubFilter adbe.pkcs7.detached whose /Contents
// holds a CMS SignedData over all bytes of the file except /Contents itself
// (/ByteRange). The signature is added as an incremental update, so earlier
// signatures stay valid. The CMS is made by the backend (pdf_sign) with an
// S/MIME identity of the user.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts, rgb } from "@cantoo/pdf-lib";

/** Space reserved for the CMS (bytes); certificate chains fit comfortably. */
export const SIGNATURE_SIZE = 12288;
/** Placeholder written into /ByteRange, replaced once offsets are known. */
const PLACEHOLDER = 9999999999;

export interface SignatureAppearance {
  page: number;
  /** PDF units, origin bottom left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Handwritten signature (PNG), drawn on the left. */
  image?: Uint8Array;
}

export interface SignOptions {
  /** Signer's name, from the certificate. */
  name: string;
  reason?: string;
  location?: string;
  /** Invisible signature without appearance. */
  appearance?: SignatureAppearance | null;
  /** Formatted signing time for the appearance. */
  dateText: string;
  date?: Date;
}

export interface PreparedSignature {
  /** The file with an empty /Contents. */
  pdf: Uint8Array;
  /** Offsets of the hex string `<…>` of /Contents. */
  contentsStart: number;
  contentsEnd: number;
  /** The bytes the signature covers. */
  signed: Uint8Array;
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Adds the signature field and dictionary; the CMS comes later. */
export async function prepareSignature(bytes: Uint8Array, o: SignOptions): Promise<PreparedSignature> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const ctx = doc.context;
  const date = o.date ?? new Date();

  const sig = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: [0, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER],
    Contents: PDFHexString.of("0".repeat(SIGNATURE_SIZE * 2)),
    M: PDFString.fromDate(date),
    Name: PDFString.of(o.name),
  });
  if (o.reason) sig.set(PDFName.of("Reason"), PDFString.of(o.reason));
  if (o.location) sig.set(PDFName.of("Location"), PDFString.of(o.location));
  const sigRef = ctx.register(sig);

  const a = o.appearance;
  const page = doc.getPage(a?.page ?? 0);
  if (a) {
    // Visible signature: a framed box with the image and the signer's data,
    // drawn into the page; the widget covers it.
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawRectangle({ x: a.x, y: a.y, width: a.width, height: a.height, borderColor: rgb(0.55, 0.55, 0.6), borderWidth: 0.6, color: rgb(1, 1, 1), opacity: 0.0, borderOpacity: 1 });
    let textX = a.x + 6;
    if (a.image) {
      const img = await doc.embedPng(a.image);
      const ih = a.height - 8;
      const iw = Math.min((img.width / img.height) * ih, a.width * 0.45);
      const h = (img.height / img.width) * iw;
      page.drawImage(img, { x: a.x + 4, y: a.y + (a.height - h) / 2, width: iw, height: h });
      textX = a.x + iw + 10;
    }
    const lines = [o.name, ...(o.reason ? [o.reason] : []), o.dateText, ...(o.location ? [o.location] : [])];
    const size = Math.max(5, Math.min(10, (a.height - 8) / (lines.length * 1.35)));
    let y = a.y + a.height - 4 - size;
    lines.forEach((line, i) => {
      const f = i === 0 ? bold : font;
      let text = line;
      const room = a.x + a.width - 4 - textX;
      while (text.length > 1 && f.widthOfTextAtSize(text, size) > room) text = text.slice(0, -2) + "…";
      page.drawText(text, { x: textX, y, size, font: f, color: rgb(0.15, 0.15, 0.2) });
      y -= size * 1.35;
    });
  }

  const fieldCount = (doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.lookupMaybe(PDFName.of("Fields"), PDFArray)?.size() ?? 0) + 1;
  const widget = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: a ? [a.x, a.y, a.x + a.width, a.y + a.height] : [0, 0, 0, 0],
    V: sigRef,
    T: PDFString.of(`Signatur${fieldCount}`),
    F: 132, // print + locked
    P: page.ref,
  });
  const widgetRef = ctx.register(widget);

  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widgetRef);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));

  let form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!form) {
    form = ctx.obj({ Fields: [] });
    doc.catalog.set(PDFName.of("AcroForm"), ctx.register(form));
  }
  const fields = form.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (fields) fields.push(widgetRef);
  else form.set(PDFName.of("Fields"), ctx.obj([widgetRef]));
  form.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  // The AcroForm may be a direct object of the catalog or its own object.
  const formRef = doc.catalog.get(PDFName.of("AcroForm"));
  const snapshot = (doc as unknown as { snapshot?: { markRefForSave(r: unknown): void } }).snapshot;
  if (snapshot) {
    snapshot.markRefForSave(doc.context.trailerInfo.Root);
    snapshot.markRefForSave(page.ref);
    if (formRef && "objectNumber" in (formRef as object)) snapshot.markRefForSave(formRef);
  }

  const pdf = await doc.commit({ useObjectStreams: false });
  return locate(pdf);
}

/** Fills in /ByteRange of the newest signature and returns what to sign. */
function locate(pdf: Uint8Array): PreparedSignature {
  const text = latin1(pdf);
  const at = text.lastIndexOf(`/ByteRange [ 0 ${PLACEHOLDER} ${PLACEHOLDER} ${PLACEHOLDER} ]`);
  if (at < 0) throw new Error("ByteRange placeholder not found");
  const contentsKey = text.indexOf("/Contents <", at > 2000 ? at - 2000 - SIGNATURE_SIZE * 2 : 0);
  const contentsStart = text.indexOf("<", contentsKey);
  const contentsEnd = text.indexOf(">", contentsStart) + 1;
  if (contentsKey < 0 || contentsEnd - contentsStart !== SIGNATURE_SIZE * 2 + 2) throw new Error("Contents placeholder not found");
  const range = [0, contentsStart, contentsEnd, pdf.length - contentsEnd];
  const placeholder = `[ 0 ${PLACEHOLDER} ${PLACEHOLDER} ${PLACEHOLDER} ]`;
  const value = `[ ${range.join(" ")} ]`.padEnd(placeholder.length, " ");
  const out = pdf.slice();
  const pos = at + "/ByteRange ".length;
  for (let i = 0; i < value.length; i++) out[pos + i] = value.charCodeAt(i);
  return { pdf: out, contentsStart, contentsEnd, signed: concat([out.subarray(0, contentsStart), out.subarray(contentsEnd)]) };
}

/** Puts the CMS (DER) into /Contents. */
export function embedSignature(p: PreparedSignature, cms: Uint8Array): Uint8Array {
  if (cms.length > SIGNATURE_SIZE) throw new Error("Signature too large");
  const hex = [...cms].map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(SIGNATURE_SIZE * 2, "0");
  const out = p.pdf.slice();
  for (let i = 0; i < hex.length; i++) out[p.contentsStart + 1 + i] = hex.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------- checking --

export interface FoundSignature {
  /** Field name, signer name, reason, time as written in the file. */
  name: string | null;
  reason: string | null;
  time: string | null;
  cms: Uint8Array;
  signed: Uint8Array;
  /** The signature covers the file up to its end (no later changes). */
  coversAll: boolean;
}

/** Length of a DER element at the start (CMS padded with zeros). */
function derLength(b: Uint8Array): number {
  if (b[0] !== 0x30) return b.length;
  const first = b[1];
  if (first < 0x80) return 2 + first;
  const n = first & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + b[2 + i];
  return Math.min(b.length, 2 + n + len);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Text value `(…)` of a key in a dictionary snippet. */
function str(dict: string, key: string): string | null {
  const m = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(dict);
  if (!m) return null;
  return m[1].replace(/\\([()\\])/g, "$1");
}

/** All signatures in a file, found by their /ByteRange. */
export function findSignatures(pdf: Uint8Array): FoundSignature[] {
  const text = latin1(pdf);
  const out: FoundSignature[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if (b <= a || c < b || c + d > pdf.length || text[b] !== "<" || text[c - 1] !== ">") continue;
    const raw = hexToBytes(text.slice(b + 1, c - 1));
    const cms = raw.subarray(0, derLength(raw));
    // The dictionary around the match, for the descriptive entries.
    const start = text.lastIndexOf("<<", m.index);
    const dict = text.slice(Math.max(0, start), Math.min(text.length, text.indexOf(">>", c) + 2));
    out.push({
      name: str(dict, "Name"),
      reason: str(dict, "Reason"),
      time: str(dict, "M"),
      cms,
      signed: concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]),
      coversAll: c + d === pdf.length || /^\s*$/.test(text.slice(c + d)),
    });
  }
  return out;
}

/** "D:20261119183012+01'00'" → Date. */
export function pdfDate(s: string | null): Date | null {
  const m = s && /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s);
  if (!m) return null;
  const [y, mo = "01", d = "01", h = "00", mi = "00", se = "00"] = m.slice(1, 7);
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}${m[7] && m[7] !== "Z" && m[7] !== "z" ? `${m[7]}${m[8] ?? "00"}:${m[9] ?? "00"}` : "Z"}`;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t;
}
