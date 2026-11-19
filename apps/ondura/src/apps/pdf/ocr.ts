// Text recognition (OCR) for scanned PDFs: every page is rendered at
// 300 dpi, recognised with Tesseract (bundled, runs offline) and the words
// are written back as invisible text over the image, so the PDF can be
// searched, selected and copied while it looks exactly as before.

import { PDFDocument, StandardFonts, degrees, type PDFFont } from "@cantoo/pdf-lib";
import { openDocument } from "./pdfjs";
import { pageRuns } from "./textModel";
import { tl } from "../../lib/i18n";

export type OcrLanguage = "deu" | "eng";

export interface OcrOptions {
  languages: OcrLanguage[];
  /** `true`: only pages without text; `false`: every page (existing text stays). */
  onlyWithoutText: boolean;
  /** Called with a status text and the progress 0…1. */
  onProgress?: (status: string, progress: number) => void;
  signal?: AbortSignal;
}

export interface OcrResult {
  bytes: Uint8Array;
  pages: number;
  words: number;
}

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;

async function createOcrWorker(languages: OcrLanguage[]): Promise<TesseractWorker> {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker(languages, OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
  });
}

/** Characters the standard font can encode; others become "?". */
function encodable(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Lines of words of a Tesseract result (v5+ block tree). */
function linesOf(data: unknown): OcrWord[][] {
  const out: OcrWord[][] = [];
  const blocks = (data as { blocks?: { paragraphs?: { lines?: { words?: OcrWord[] }[] }[] }[] | null }).blocks ?? [];
  for (const b of blocks) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) if (l.words?.length) out.push(l.words);
  return out;
}

export async function ocrPdf(bytes: Uint8Array, opts: OcrOptions): Promise<OcrResult> {
  const report = (s: string, p: number) => opts.onProgress?.(s, p);
  report(tl("Texterkennung wird geladen …"), 0);
  const src = await openDocument(bytes);
  const out = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await out.embedFont(StandardFonts.Helvetica);
  const worker = await createOcrWorker(opts.languages);
  let pagesDone = 0;
  let words = 0;
  try {
    for (let i = 1; i <= src.numPages; i++) {
      if (opts.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      const page = await src.getPage(i);
      if (opts.onlyWithoutText) {
        const { runs } = await pageRuns(page);
        if (runs.reduce((n, r) => n + r.text.trim().length, 0) > 20) continue;
      }
      report(tl("Seite {0} von {1} wird erkannt …", i, src.numPages), (i - 1) / src.numPages);
      // 300 dpi, but at most 5000 px on the long side.
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(300 / 72, 5000 / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      canvas.width = canvas.height = 0;
      const target = out.getPage(i - 1);
      const rotation = page.rotate % 360;
      for (const line of linesOf(data)) {
        // One font size per line (the median of the sizes that fit each
        // word's width), so copied text does not jump between sizes.
        const items = line
          .map((w) => ({ w, text: encodable(font, w.text.trim()) }))
          .filter((it) => it.text && it.w.confidence >= 20)
          .map((it) => {
            const { x0, x1, y0, y1 } = it.w.bbox;
            const widthPt = (x1 - x0) / scale;
            const heightPt = (y1 - y0) / scale;
            const unit = font.widthOfTextAtSize(it.text, 1);
            return { ...it, fit: Math.max(1, Math.min(unit > 0 ? widthPt / unit : heightPt, heightPt * 1.6)) };
          });
        if (!items.length) continue;
        const sorted = items.map((it) => it.fit).sort((a, b) => a - b);
        const size = sorted[Math.floor(sorted.length / 2)];
        const baseline = Math.max(...items.map((it) => it.w.bbox.y1));
        for (const it of items) {
          // Baseline-left corner (display) in PDF points.
          const [px, py] = vp.convertToPdfPoint(it.w.bbox.x0, baseline);
          target.drawText(it.text, { x: px, y: py + size * 0.2, size, font, opacity: 0, rotate: degrees(rotation) });
          words++;
        }
      }
      pagesDone++;
    }
  } finally {
    await worker.terminate().catch(() => {});
    await src.loadingTask.destroy();
  }
  report(tl("Wird gespeichert …"), 1);
  return { bytes: await out.save({ useObjectStreams: false }), pages: pagesDone, words };
}
