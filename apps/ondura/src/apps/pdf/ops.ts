// Document operations of Ondura PDF on the file bytes (pdf-lib): pages,
// merging and splitting, page numbers, watermarks, covering, redaction,
// password protection and form flattening. Every function takes the current
// bytes and returns new ones; the viewer then shows the result.

import { tl } from "../../lib/i18n";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees, rgb, type PDFPage } from "@cantoo/pdf-lib";

/** A rectangle on a page in PDF units (origin bottom left). */
export interface PageRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
const save = (doc: PDFDocument) => doc.save({ useObjectStreams: false });

/**
 * Decrypts a password-protected PDF into a plain working copy (Ondura works
 * on plain bytes and encrypts again when saving). Leftover cross-reference
 * streams and the encryption dictionary of the old file are dropped, or the
 * copy would still claim to be encrypted.
 */
export async function decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFRawStream ? obj.dict : null;
    if (!dict) continue;
    const isXref = dict.get(PDFName.of("Type")) === PDFName.of("XRef");
    const isEncrypt = dict.get(PDFName.of("Filter")) === PDFName.of("Standard") && dict.has(PDFName.of("O")) && dict.has(PDFName.of("U"));
    if (isXref || isEncrypt) doc.context.delete(ref);
  }
  delete (doc.context.trailerInfo as { Encrypt?: unknown }).Encrypt;
  return save(doc);
}

export interface Protection {
  /** Needed to open the document (empty: anyone can open it). */
  openPassword: string;
  /** Needed to change permissions; defaults to the open password. */
  ownerPassword?: string;
  printing: boolean;
  copying: boolean;
  modifying: boolean;
}

/** Encrypts with AES-256. */
export async function encrypt(bytes: Uint8Array, p: Protection): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.encrypt({
    userPassword: p.openPassword,
    ownerPassword: p.ownerPassword || p.openPassword || crypto.randomUUID(),
    permissions: {
      printing: p.printing ? "highResolution" : false,
      copying: p.copying,
      modifying: p.modifying,
      annotating: p.modifying,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: p.modifying,
    },
  });
  return doc.save();
}

// ------------------------------------------------------------------ pages --

/** Turns pages by a multiple of 90°. */
export async function rotatePages(bytes: Uint8Array, pages: number[], by: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const i of pages) {
    const page = doc.getPage(i);
    page.setRotation(degrees((((page.getRotation().angle + by) % 360) + 360) % 360));
  }
  return save(doc);
}

export async function deletePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (pages.length >= doc.getPageCount()) throw new Error(tl("Ein PDF braucht mindestens eine Seite."));
  for (const i of [...pages].sort((a, b) => b - a)) doc.removePage(i);
  return save(doc);
}

/** New page order: `order[k]` is the old index of the page at position k. */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const doc = await load(bytes);
  const count = doc.getPageCount();
  const copies = await doc.copyPages(src, order);
  for (let i = count - 1; i >= 0; i--) doc.removePage(i);
  for (const p of copies) doc.addPage(p);
  return save(doc);
}

/** Moves the given pages so they stand before position `to` (old numbering). */
export function moveOrder(count: number, pages: number[], to: number): number[] {
  const moving = [...pages].sort((a, b) => a - b);
  const rest = [...Array(count).keys()].filter((i) => !moving.includes(i));
  const at = rest.filter((i) => i < to).length;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

export async function duplicatePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const sorted = [...pages].sort((a, b) => b - a);
  for (const i of sorted) {
    const [copy] = await doc.copyPages(doc, [i]);
    doc.insertPage(i + 1, copy);
  }
  return save(doc);
}

/** Empty page at `at`, the size of its neighbour (or A4). */
export async function insertBlank(bytes: Uint8Array, at: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  const near = doc.getPages()[Math.min(at, doc.getPageCount() - 1)];
  const { width, height } = near ? near.getSize() : { width: 595.28, height: 841.89 };
  doc.insertPage(at, [width, height]);
  return save(doc);
}

/** Inserts all pages of other PDFs at `at` (merging). */
export async function insertDocuments(bytes: Uint8Array, others: Uint8Array[], at: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  let pos = at;
  for (const other of others) {
    const src = await load(other);
    const pages = await doc.copyPages(src, src.getPageIndices());
    for (const p of pages) doc.insertPage(pos++, p);
  }
  return save(doc);
}

/** A new PDF with the given pages. */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const doc = await PDFDocument.create();
  for (const p of await doc.copyPages(src, [...pages].sort((a, b) => a - b))) doc.addPage(p);
  return save(doc);
}

/** Splits into parts of `every` pages. */
export async function splitEvery(bytes: Uint8Array, every: number): Promise<Uint8Array[]> {
  const src = await load(bytes);
  const out: Uint8Array[] = [];
  for (let start = 0; start < src.getPageCount(); start += every) {
    const pages = [...Array(Math.min(every, src.getPageCount() - start)).keys()].map((i) => start + i);
    out.push(await extractPages(bytes, pages));
  }
  return out;
}

/** Pages from a range text like "1-3, 5" (1-based) within `count` pages. */
export function parseRange(text: string, count: number): number[] | null {
  const out = new Set<number>();
  for (const part of text.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:[-–]\s*(\d*))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === "" ? count : Number(m[2]);
    if (a < 1 || b < a || b > count) return null;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

// ----------------------------------------------------------------- create --

export interface ImageInput {
  bytes: Uint8Array;
  type: "png" | "jpg";
}

/** One page per image (A4, image fitted with a margin); or appended to `bytes`. */
export async function imagesToPdf(images: ImageInput[], bytes?: Uint8Array): Promise<Uint8Array> {
  const doc = bytes ? await load(bytes) : await PDFDocument.create();
  for (const img of images) {
    const embedded = img.type === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const landscape = embedded.width > embedded.height;
    const [w, h] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    const page = doc.addPage([w, h]);
    const margin = 28;
    const scale = Math.min((w - 2 * margin) / embedded.width, (h - 2 * margin) / embedded.height, 1);
    const dw = embedded.width * scale;
    const dh = embedded.height * scale;
    page.drawImage(embedded, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  }
  return save(doc);
}

// --------------------------------------------------------- page decorations --

export type Corner = "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right" | "top-left";

export interface PageNumberOptions {
  position: Corner;
  /** `{n}` page number, `{total}` page count. */
  format: string;
  size: number;
  /** First page that gets a number (0-based). */
  from: number;
  startAt: number;
}

/** Visible box of a page (crop box), so text lands where the reader sees it. */
function box(page: PDFPage) {
  const b = page.getCropBox();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export async function addPageNumbers(bytes: Uint8Array, o: PageNumberOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length - o.from + o.startAt - 1;
  pages.forEach((page, i) => {
    if (i < o.from) return;
    const text = o.format.replace("{n}", String(i - o.from + o.startAt)).replace("{total}", String(total));
    const b = box(page);
    const tw = font.widthOfTextAtSize(text, o.size);
    const margin = 28;
    const x = o.position.endsWith("left") ? b.x + margin : o.position.endsWith("right") ? b.x + b.width - margin - tw : b.x + (b.width - tw) / 2;
    const y = o.position.startsWith("top") ? b.y + b.height - margin - o.size : b.y + margin;
    page.drawText(text, { x, y, size: o.size, font, color: rgb(0.25, 0.25, 0.25) });
  });
  return save(doc);
}

export interface WatermarkOptions {
  text: string;
  size: number;
  opacity: number;
  /** Hex colour. */
  color: string;
  diagonal: boolean;
}

export function hexColor(hex: string) {
  const v = hex.replace("#", "");
  return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
}

export async function addWatermark(bytes: Uint8Array, o: WatermarkOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const b = box(page);
    const tw = font.widthOfTextAtSize(o.text, o.size);
    const angle = o.diagonal ? (Math.atan2(b.height, b.width) * 180) / Math.PI : 0;
    const rad = (angle * Math.PI) / 180;
    // Centre of the text on the centre of the page.
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const x = cx - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * o.size) / 3;
    const y = cy - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * o.size) / 3;
    page.drawText(o.text, { x, y, size: o.size, font, color: hexColor(o.color), opacity: o.opacity, rotate: degrees(angle) });
  }
  return save(doc);
}

/**
 * Covers areas with a filled rectangle. The content underneath stays in the
 * file (it can be selected and copied) – for removing it, see `redact`.
 */
export async function coverAreas(bytes: Uint8Array, rects: PageRect[], color = "#ffffff"): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const r of rects) doc.getPage(r.page).drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: hexColor(color) });
  return save(doc);
}

/**
 * Redaction: the given pages are replaced by images of themselves with the
 * areas painted black, so the text, images and annotations underneath are
 * really gone (the page is no longer searchable). `images` are PNGs of the
 * pages already blacked out, rendered by the viewer.
 */
export async function replaceWithImages(bytes: Uint8Array, images: Map<number, Uint8Array>): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const [i, png] of images) {
    const old = doc.getPage(i);
    const b = box(old);
    const rotation = old.getRotation().angle;
    const img = await doc.embedPng(png);
    // The rendered image is upright; keep the page upright, too.
    const [w, h] = rotation % 180 ? [b.height, b.width] : [b.width, b.height];
    const page = doc.insertPage(i, [w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    doc.removePage(i + 1);
  }
  return save(doc);
}

/** Turns form fields into plain page content (no longer editable). */
export async function flattenForm(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.getForm().flatten();
  return save(doc);
}

export interface Metadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export async function readMetadata(bytes: Uint8Array): Promise<Metadata> {
  const doc = await load(bytes);
  return { title: doc.getTitle() ?? "", author: doc.getAuthor() ?? "", subject: doc.getSubject() ?? "", keywords: doc.getKeywords() ?? "" };
}

export async function writeMetadata(bytes: Uint8Array, m: Metadata): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.setTitle(m.title);
  doc.setAuthor(m.author);
  doc.setSubject(m.subject);
  doc.setKeywords(m.keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean));
  doc.setModificationDate(new Date());
  return save(doc);
}

/** Whether the bytes are an encrypted PDF. */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  return (await load(bytes)).isEncrypted;
}

/** A line of existing text replaced by "Text bearbeiten". */
export interface TextReplacement {
  page: number;
  /** Area of the old text (covered with `background`). */
  rect: { x: number; y: number; width: number; height: number };
  /** Baseline start of the new text. */
  x: number;
  y: number;
  text: string;
  size: number;
  family: "sans" | "serif" | "mono";
  bold: boolean;
  italic: boolean;
  color: string;
  background: string;
}

const STANDARD: Record<TextReplacement["family"], [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

/**
 * Replaces text on a page: the old text is covered with its background
 * colour and the new text is written in the closest standard font. The old
 * text stays in the file under the cover (use redaction to remove it).
 */
export async function replaceText(bytes: Uint8Array, edits: TextReplacement[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const e of edits) {
    const page = doc.getPage(e.page);
    const variants = STANDARD[e.family];
    const font = await doc.embedFont(variants[(e.bold ? 1 : 0) + (e.italic ? 2 : 0)]);
    page.drawRectangle({ ...e.rect, color: hexColor(e.background) });
    // Characters outside the standard font's encoding cannot be written.
    let text = "";
    for (const ch of e.text) {
      try {
        font.encodeText(ch);
        text += ch;
      } catch {
        text += "?";
      }
    }
    if (text.trim()) page.drawText(text, { x: e.x, y: e.y, size: e.size, font, color: hexColor(e.color) });
  }
  return save(doc);
}
