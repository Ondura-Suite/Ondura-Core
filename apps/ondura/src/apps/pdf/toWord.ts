// "In Word umwandeln": rebuilds an editable document from the positioned
// text of a PDF. Lines become paragraphs (joined where the text flows on),
// large text becomes headings, bullets and numbers become lists, aligned
// columns become tables and pictures are cut out of the rendered page.
// Complex layouts (several columns, text over images) come out simplified.

import type { Block, Inline, Marks, Paragraph, Table, TextDocument } from "../text/model";
import { openDocument, pdfjsLib, type PDFPageProxy } from "./pdfjs";
import { groupLines, pageRuns, segmentText, type TextLine, type TextRun } from "./textModel";

const PT_TO_MM = 25.4 / 72;
const PT_TO_PX = 96 / 72;

interface Placed {
  top: number;
  block: Block;
}

/** Most common value (rounded to half points). */
function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) {
    const k = Math.round(v * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = values[0] ?? 11;
  let n = 0;
  for (const [k, c] of counts) if (c > n) (best = k), (n = c);
  return best;
}

const FAMILY_FONT: Record<TextRun["family"], string> = { sans: "Arial", serif: "Times New Roman", mono: "Courier New" };

/** Inline runs of a line with bold/italic/size/font marks. */
function inlines(runs: TextRun[], body: number, withSize: boolean): Inline[] {
  const out: Inline[] = [];
  runs.forEach((r, i) => {
    let text = r.text;
    if (i > 0) {
      const prev = runs[i - 1];
      const gap = r.x - (prev.x + prev.width);
      if (gap > r.size * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(text)) text = " " + text;
    }
    const marks: Marks = {};
    if (r.bold) marks.bold = true;
    if (r.italic) marks.italic = true;
    if (withSize && Math.abs(r.size - body) > 0.6) marks.size = Math.round(r.size * 2) / 2;
    if (r.family !== "sans") marks.font = FAMILY_FONT[r.family];
    const last = out[out.length - 1];
    if (last?.type === "text" && JSON.stringify(last.marks ?? {}) === JSON.stringify(marks)) last.text += text;
    else out.push({ type: "text", text, marks: Object.keys(marks).length ? marks : undefined });
  });
  return out;
}

const BULLET = /^\s*([•●▪■◦○‣\-–—*·])\s+/;
const NUMBER = /^\s*(\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s+/i;

/** Tables: runs of at least two lines with two or more aligned segments. */
function findTables(lines: TextLine[]): { start: number; end: number; columns: number[] }[] {
  const out: { start: number; end: number; columns: number[] }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].segments.length < 2) {
      i++;
      continue;
    }
    const cols = lines[i].segments.map((s) => s[0].x);
    let j = i + 1;
    while (j < lines.length && lines[j].segments.length >= 2 && lines[j].top - lines[j - 1].top < lines[j - 1].size * 3) {
      const starts = lines[j].segments.map((s) => s[0].x);
      // Every segment must start near a known column (new columns are added).
      const tol = lines[j].size * 1.2;
      const fits = starts.every((x) => cols.some((c) => Math.abs(c - x) < tol) || !cols.some((c) => c > x - tol && c < x + tol));
      if (!fits) break;
      for (const x of starts) if (!cols.some((c) => Math.abs(c - x) < tol)) cols.push(x);
      j++;
    }
    if (j - i >= 2 && cols.length >= 2) {
      out.push({ start: i, end: j, columns: cols.sort((a, b) => a - b) });
      i = j;
    } else i++;
  }
  return out;
}

function tableBlock(lines: TextLine[], columns: number[], right: number, body: number): Table {
  const edges = [...columns, right];
  const columnsMm = columns.map((c, k) => Math.max(10, (edges[k + 1] - c) * PT_TO_MM));
  const rows = lines.map((line) => {
    const cells: string[][] = columns.map(() => []);
    const runsPer: TextRun[][] = columns.map(() => []);
    for (const seg of line.segments) {
      let k = 0;
      for (let c = 0; c < columns.length; c++) if (seg[0].x >= columns[c] - line.size * 1.2) k = c;
      cells[k].push(segmentText(seg));
      runsPer[k].push(...seg);
    }
    return {
      cells: runsPer.map((runs) => ({ colSpan: 1, rowSpan: 1, blocks: [{ type: "paragraph", content: runs.length ? inlines(runs, body, true) : [] } as Paragraph] })),
    };
  });
  return { type: "table", columnsMm, rows };
}

/** Pictures on a page: boxes (PDF points, top-left origin) of painted images. */
async function imageBoxes(page: PDFPageProxy): Promise<{ x: number; top: number; width: number; height: number }[]> {
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const [vx, vy] = [vp.viewBox[0], vp.viewBox[1]];
  type M = [number, number, number, number, number, number];
  const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const boxes: { x: number; top: number; width: number; height: number }[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as M);
    else if (fn === OPS.paintFormXObjectBegin && Array.isArray(args?.[0])) {
      stack.push(ctm);
      ctm = mul(ctm, args[0] as M);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4] - vx, ctm[1] * u + ctm[3] * v + ctm[5] - vy]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x = Math.max(0, Math.min(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const width = Math.min(vp.width, Math.max(...xs)) - x;
      const height = Math.min(vp.height, Math.max(...ys)) - y0;
      if (width > 12 && height > 12) boxes.push({ x, top: vp.height - y0 - height, width, height });
    }
  }
  return boxes;
}

/** Converts a PDF into a text document. */
export async function pdfToDocument(bytes: Uint8Array, onProgress?: (page: number, pages: number) => void): Promise<{ doc: TextDocument; scanned: boolean }> {
  const pdf = await openDocument(bytes);
  try {
    const first = (await pdf.getPage(1)).getViewport({ scale: 1, rotation: 0 });
    // All runs first: the body size and the margins are document-wide.
    const pages: { lines: TextLine[]; width: number; height: number; page: PDFPageProxy }[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const { runs, width, height } = await pageRuns(page);
      pages.push({ lines: groupLines(runs, height), width, height, page });
    }
    // Running headers and footers (and page numbers) are left out: lines near
    // the top or bottom edge that repeat on most pages, digits ignored.
    if (pages.length > 1) {
      const key = (l: TextLine) => l.text.replace(/\d+/g, "#").trim();
      const edge = (l: TextLine, h: number) => l.top < h * 0.09 || l.top > h * 0.91;
      const seen = new Map<string, number>();
      for (const p of pages) for (const k of new Set(p.lines.filter((l) => edge(l, p.height)).map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
      for (const p of pages) p.lines = p.lines.filter((l) => !(edge(l, p.height) && ((seen.get(key(l)) ?? 0) >= Math.max(2, pages.length * 0.5) || /^[-–\s]*(seite\s*)?#(\s*(von|of|\/)\s*#)?[-–\s]*$/i.test(key(l)))));
    }
    const allLines = pages.flatMap((p) => p.lines);
    const body = mode(allLines.flatMap((l) => l.runs.map((r) => r.size)));
    const left = allLines.length ? Math.min(...allLines.map((l) => l.x)) : 72;
    const right = allLines.length ? Math.max(...allLines.map((l) => l.right)) : first.width - 72;
    const sizes = [...new Set(allLines.map((l) => Math.round(l.size)).filter((s) => s >= body * 1.2))].sort((a, b) => b - a);
    const headingLevel = (size: number) => {
      if (size < body * 1.2) return 0;
      const i = sizes.indexOf(Math.round(size));
      return Math.min(3, (i < 0 ? sizes.length : i) + 1);
    };

    const blocks: Block[] = [];
    let words = 0;
    // The pages flow into each other like in a word processor.
    for (const pg of pages) {
      const placed: Placed[] = [];
      const lines = pg.lines;
      const tables = findTables(lines);
      const inTable = new Set<number>();
      for (const t of tables) {
        for (let k = t.start; k < t.end; k++) inTable.add(k);
        placed.push({ top: lines[t.start].top, block: tableBlock(lines.slice(t.start, t.end), t.columns, right, body) });
      }
      // Paragraphs: consecutive lines that continue each other.
      let para: { lines: TextLine[]; list?: { ordered: boolean } } | null = null;
      const flush = () => {
        if (!para) return;
        const ls = para.lines;
        const size = Math.max(...ls.map((l) => l.size));
        const level = para.list ? 0 : headingLevel(size);
        const content: Inline[] = [];
        ls.forEach((l, k) => {
          let runs = l.runs;
          if (k === 0 && para!.list) {
            // Drop the bullet or number: the list draws its own.
            const m = (para!.list.ordered ? NUMBER : BULLET).exec(l.text);
            if (m) {
              let cut = m[0].length;
              runs = runs
                .map((r) => {
                  if (cut <= 0) return r;
                  const take = Math.min(cut, r.text.length);
                  cut -= take;
                  return { ...r, text: r.text.slice(take) };
                })
                .filter((r) => r.text.length);
            }
          }
          const part = inlines(runs, body, level === 0);
          // Hyphenated line ends are joined, other line ends become spaces.
          const prev = content[content.length - 1];
          if (k > 0 && prev?.type === "text") {
            if (/[a-zäöüß]-$/i.test(prev.text) && part[0]?.type === "text" && /^[a-zäöüß]/.test(part[0].text)) prev.text = prev.text.slice(0, -1);
            else if (!/\s$/.test(prev.text)) prev.text += " ";
          }
          for (const it of part) {
            const last = content[content.length - 1];
            if (it.type === "text" && last?.type === "text" && JSON.stringify(last.marks ?? {}) === JSON.stringify(it.marks ?? {})) last.text += it.text;
            else content.push(it);
          }
        });
        words += ls.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
        const firstLine = ls[0];
        const mid = (firstLine.x + firstLine.right) / 2;
        const centered = ls.length <= 3 && Math.abs(mid - (left + right) / 2) < body * 2 && firstLine.x - left > body * 3;
        const rightAligned = !centered && ls.every((l) => Math.abs(l.right - right) < body) && firstLine.x - left > (right - left) * 0.4;
        const indentMm = !centered && !rightAligned && firstLine.x - left > body * 1.5 && !para.list ? Math.round((Math.min(...ls.map((l) => l.x)) - left) * PT_TO_MM) : undefined;
        const p: Paragraph = { type: "paragraph", content };
        if (level) p.style = `heading${level}`;
        if (centered) p.align = "center";
        else if (rightAligned) p.align = "right";
        if (indentMm) p.indentMm = indentMm;
        if (para.list) p.list = { ordered: para.list.ordered, level: 0 };
        placed.push({ top: firstLine.top, block: p });
        para = null;
      };
      lines.forEach((line, k) => {
        if (inTable.has(k)) return flush();
        const list = BULLET.test(line.text) ? { ordered: false } : NUMBER.test(line.text) && line.text.length > 4 ? { ordered: true } : undefined;
        const prev = para?.lines[para.lines.length - 1];
        const continues =
          !!prev &&
          !list &&
          line.top - prev.top < Math.max(prev.size, line.size) * 1.75 &&
          Math.abs(line.size - prev.size) < 1 &&
          headingLevel(line.size) === headingLevel(prev.size) &&
          // A short previous line ends its paragraph (unless it is a list item continuing).
          (prev.right > right - body * 6 || !!para?.list) &&
          line.x >= (para!.lines[0].x - body * 0.5) - (para?.list ? 0 : body * 4);
        if (continues) para!.lines.push(line);
        else {
          flush();
          para = { lines: [line], list };
        }
      });
      flush();

      // Pictures, cut out of the rendered page.
      const boxes = (await imageBoxes(pg.page).catch(() => [])).filter((b) => b.width * b.height < pg.width * pg.height * 0.85);
      if (boxes.length) {
        const scale = 2;
        const vp = pg.page.getViewport({ scale, rotation: 0 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await pg.page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        for (const b of boxes) {
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(b.width * scale));
          c.height = Math.max(1, Math.round(b.height * scale));
          c.getContext("2d")!.drawImage(canvas, b.x * scale, b.top * scale, c.width, c.height, 0, 0, c.width, c.height);
          const maxW = (right - left) * PT_TO_PX;
          const k = Math.min(1, maxW / (b.width * PT_TO_PX));
          placed.push({
            top: b.top,
            block: { type: "paragraph", content: [{ type: "image", src: c.toDataURL("image/png"), width: Math.round(b.width * PT_TO_PX * k), height: Math.round(b.height * PT_TO_PX * k) }] },
          });
        }
        canvas.width = canvas.height = 0;
      }
      placed.sort((a, b) => a.top - b.top);
      blocks.push(...placed.map((p) => p.block));
    }
    if (!blocks.length) blocks.push({ type: "paragraph", content: [] });

    const marginL = Math.max(10, Math.min(40, left * PT_TO_MM));
    const marginR = Math.max(10, Math.min(40, (first.width - right) * PT_TO_MM));
    const doc: TextDocument = {
      page: {
        widthMm: Math.round(first.width * PT_TO_MM * 10) / 10,
        heightMm: Math.round(first.height * PT_TO_MM * 10) / 10,
        marginTopMm: 20,
        marginBottomMm: 20,
        marginLeftMm: Math.round(marginL),
        marginRightMm: Math.round(marginR),
        headerMm: 12.5,
        footerMm: 12.5,
      },
      blocks,
      header: [],
      footer: [],
      title: "",
      author: "",
      defaultFont: body ? FAMILY_FONT[allLines[0]?.runs[0]?.family ?? "sans"] : null,
      defaultSize: Math.round(body * 2) / 2 || 11,
    };
    return { doc, scanned: words < pdf.numPages * 5 };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
