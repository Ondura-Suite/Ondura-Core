// "Dateien vergleichen": word-level differences between two PDFs, with the
// position of every changed word, plus pages whose graphics changed while
// their text stayed the same.

import { hunks, myers } from "./diff";
import { openDocument, type PDFDocumentProxy } from "./pdfjs";
import { groupLines, pageRuns } from "./textModel";

export interface Word {
  text: string;
  page: number;
  /** Box in PDF points, origin top left. */
  x: number;
  top: number;
  width: number;
  height: number;
}

export interface Change {
  kind: "insert" | "delete" | "replace" | "graphic";
  oldText: string;
  newText: string;
  oldWords: Word[];
  newWords: Word[];
  /** Page (1-based) in the old / new document where the change is. */
  oldPage: number;
  newPage: number;
}

export interface Comparison {
  changes: Change[];
  oldPages: number;
  newPages: number;
  oldWords: number;
  newWords: number;
}

/** Words with boxes, in reading order. */
export async function documentWords(doc: PDFDocumentProxy, onProgress?: (page: number) => void): Promise<Word[]> {
  const out: Word[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p);
    const page = await doc.getPage(p);
    const { runs, height } = await pageRuns(page);
    for (const line of groupLines(runs, height)) {
      for (const r of line.runs) {
        const chars = r.text.length || 1;
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(r.text))) {
          const x = r.x + (r.width * m.index) / chars;
          const w = (r.width * m[0].length) / chars;
          out.push({ text: m[0], page: p, x, top: height - r.y - r.size * 0.85, width: w, height: r.size * 1.1 });
        }
      }
    }
  }
  return out;
}

const norm = (w: Word) => w.text.normalize("NFC").replace(/[­​]/g, "");

/** Groups the words of one side into lines (for coarse comparison). */
function lineTokens(words: Word[]): Word[][] {
  const lines: Word[][] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last[0].page === w.page && Math.abs(last[0].top - w.top) < w.height * 0.5) last.push(w);
    else lines.push([w]);
  }
  return lines;
}

export function diffWords(a: Word[], b: Word[]): Change[] {
  const make = (del: Word[], ins: Word[]): Change => ({
    kind: del.length && ins.length ? "replace" : del.length ? "delete" : "insert",
    oldText: del.map((w) => w.text).join(" "),
    newText: ins.map((w) => w.text).join(" "),
    oldWords: del,
    newWords: ins,
    oldPage: del[0]?.page ?? 0,
    newPage: ins[0]?.page ?? 0,
  });
  const ta = a.map(norm);
  const tb = b.map(norm);
  const ops = myers(ta, tb);
  let changes: Change[];
  if (ops) {
    changes = hunks(ops).map((h) => make(h.deleted.map((i) => a[i]), h.inserted.map((i) => b[i])));
  } else {
    // Too different for a word diff in reasonable time: compare whole lines.
    const la = lineTokens(a);
    const lb = lineTokens(b);
    const key = (l: Word[]) => l.map(norm).join(" ");
    const lops = myers(la.map(key), lb.map(key), undefined, 20000) ?? [];
    changes = hunks(lops).map((h) => make(h.deleted.flatMap((i) => la[i]), h.inserted.flatMap((i) => lb[i])));
  }
  // Pages for changes on one side only: where the other side's neighbour is.
  for (const c of changes) {
    if (!c.oldPage) c.oldPage = nearestPage(a, b, c.newWords[0], "old");
    if (!c.newPage) c.newPage = nearestPage(a, b, c.oldWords[0], "new");
  }
  return changes;
}

function nearestPage(a: Word[], b: Word[], w: Word | undefined, side: "old" | "new"): number {
  if (!w) return 1;
  const src = side === "old" ? b : a;
  const dst = side === "old" ? a : b;
  const i = src.indexOf(w);
  const ratio = src.length ? i / src.length : 0;
  return dst[Math.min(dst.length - 1, Math.max(0, Math.round(ratio * dst.length)))]?.page ?? 1;
}

/** Bounding box (top-left origin, points) of pixels that differ between two renderings, or null. */
export async function graphicChange(oldDoc: PDFDocumentProxy, newDoc: PDFDocumentProxy, page: number): Promise<{ x: number; top: number; width: number; height: number } | null> {
  const render = async (doc: PDFDocumentProxy) => {
    const pg = await doc.getPage(page);
    const vp = pg.getViewport({ scale: 0.5 });
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    await pg.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };
  const [p, q] = await Promise.all([render(oldDoc), render(newDoc)]);
  if (p.w !== q.w || p.h !== q.h) return { x: 0, top: 0, width: p.w * 2, height: p.h * 2 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      const d = Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]);
      if (d > 90) {
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  // A handful of anti-aliasing pixels is no change.
  if (count < 25) return null;
  return { x: minX * 2, top: minY * 2, width: (maxX - minX + 1) * 2, height: (maxY - minY + 1) * 2 };
}

/** Compares two PDF files. */
export async function comparePdfs(oldBytes: Uint8Array, newBytes: Uint8Array, onProgress?: (text: string) => void): Promise<{ result: Comparison; oldDoc: PDFDocumentProxy; newDoc: PDFDocumentProxy }> {
  const [oldDoc, newDoc] = await Promise.all([openDocument(oldBytes), openDocument(newBytes)]);
  const a = await documentWords(oldDoc, (p) => onProgress?.(`${p}/${oldDoc.numPages}`));
  const b = await documentWords(newDoc, (p) => onProgress?.(`${p}/${newDoc.numPages}`));
  const changes = diffWords(a, b);
  // Graphics: pages present in both whose text did not change.
  const changedPages = new Set(changes.flatMap((c) => [...c.oldWords, ...c.newWords].map((w) => w.page)));
  const pages = Math.min(oldDoc.numPages, newDoc.numPages, 200);
  for (let p = 1; p <= pages; p++) {
    if (changedPages.has(p)) continue;
    const box = await graphicChange(oldDoc, newDoc, p).catch(() => null);
    if (box) {
      const w: Word = { text: "", page: p, ...box };
      changes.push({ kind: "graphic", oldText: "", newText: "", oldWords: [w], newWords: [{ ...w }], oldPage: p, newPage: p });
    }
  }
  changes.sort((x, y) => x.newPage - y.newPage || (x.newWords[0]?.top ?? 0) - (y.newWords[0]?.top ?? 0));
  return { result: { changes, oldPages: oldDoc.numPages, newPages: newDoc.numPages, oldWords: a.length, newWords: b.length }, oldDoc, newDoc };
}
