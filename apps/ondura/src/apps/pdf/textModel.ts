// Positioned text of a PDF page, grouped into lines and segments. Used by
// "Vergleichen", "In Word umwandeln" and "Text bearbeiten".
//
// Coordinates are PDF user space (points, origin bottom left) of the
// unrotated page; `top` is measured from the top edge for convenience.

import type { PDFPageProxy } from "./pdfjs";

export interface TextRun {
  text: string;
  /** Left edge and baseline in PDF points. */
  x: number;
  y: number;
  width: number;
  /** Font size in points. */
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  /** Serif / monospace guess from the font name. */
  family: "sans" | "serif" | "mono";
}

export interface TextLine {
  runs: TextRun[];
  /** Runs split at wide gaps (table columns, tab stops). */
  segments: TextRun[][];
  x: number;
  right: number;
  y: number;
  /** Distance of the baseline from the top edge of the page. */
  top: number;
  size: number;
  text: string;
}

export interface PageText {
  width: number;
  height: number;
  lines: TextLine[];
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

/** Font facts from the font name (`ABCDEF+Arial-BoldItalicMT`). */
export function fontFacts(name: string): { bold: boolean; italic: boolean; family: TextRun["family"] } {
  const n = name.replace(/^[A-Z]{6}\+/, "").toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi|,b\b|-b\b/.test(n),
    italic: /italic|oblique|,i\b|-i\b/.test(n),
    family: /courier|mono|consol|code/.test(n) ? "mono" : /times|serif(?!.*sans)|roman|georgia|garamond|cambria|minion|book/.test(n) && !/sans/.test(n) ? "serif" : "sans",
  };
}

/** Text runs of a page with real font names (bold/italic). */
export async function pageRuns(page: PDFPageProxy): Promise<{ runs: TextRun[]; width: number; height: number }> {
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const content = await page.getTextContent();
  // Font objects (with their PostScript names) exist once the operator list is built.
  await page.getOperatorList().catch(() => null);
  type FontObj = { name?: string; bold?: boolean; black?: boolean; italic?: boolean; isSerifFont?: boolean; isMonospace?: boolean } | null;
  const facts = new Map<string, { font: string; bold: boolean; italic: boolean; family: TextRun["family"] }>();
  const factsOf = (id: string) => {
    if (!facts.has(id)) {
      let f: FontObj = null;
      try {
        f = page.commonObjs.has(id) ? (page.commonObjs.get(id) as FontObj) : null;
      } catch {
        f = null;
      }
      const font = f?.name || content.styles[id]?.fontFamily || id;
      const byName = fontFacts(font);
      facts.set(id, {
        font,
        bold: byName.bold || !!f?.bold || !!f?.black,
        italic: byName.italic || !!f?.italic,
        family: f?.isMonospace ? "mono" : f?.isSerifFont && byName.family === "sans" && !/sans/i.test(font) ? "serif" : byName.family,
      });
    }
    return facts.get(id)!;
  };
  const [x0, y0] = [vp.viewBox[0], vp.viewBox[1]];
  const runs: TextRun[] = [];
  for (const it of content.items as RawItem[]) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
    // Rotated text is skipped (rare in body text, and it breaks line grouping).
    if (Math.abs(b) > 0.01 * Math.abs(a) + 0.01) continue;
    runs.push({ text: it.str, x: e - x0, y: f - y0, width: it.width, size, ...factsOf(it.fontName) });
  }
  return { runs, width: vp.width, height: vp.height };
}

/** Groups runs into lines (top to bottom) and lines into segments. */
export function groupLines(runs: TextRun[], pageHeight: number): TextLine[] {
  const sorted = [...runs].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: TextRun[][] = [];
  for (const r of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - r.y) < Math.max(1.5, Math.min(l[0].size, r.size) * 0.45));
    if (line) line.push(r);
    else lines.push([r]);
  }
  return lines
    .map((l) => {
      l.sort((p, q) => p.x - q.x);
      const size = Math.max(...l.map((r) => r.size));
      const segments: TextRun[][] = [[l[0]]];
      let text = l[0].text;
      for (let i = 1; i < l.length; i++) {
        const prev = l[i - 1];
        const gap = l[i].x - (prev.x + prev.width);
        if (gap > size * 1.6) {
          segments.push([l[i]]);
          text += "\t";
        } else {
          segments[segments.length - 1].push(l[i]);
          if (gap > size * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(l[i].text)) text += " ";
        }
        text += l[i].text;
      }
      const last = l[l.length - 1];
      const y = l.reduce((m, r) => m + r.y, 0) / l.length;
      return { runs: l, segments, x: l[0].x, right: last.x + last.width, y, top: pageHeight - y, size, text: text.replace(/\s+$/, "") };
    })
    .sort((p, q) => p.top - q.top);
}

export async function pageText(page: PDFPageProxy): Promise<PageText> {
  const { runs, width, height } = await pageRuns(page);
  return { width, height, lines: groupLines(runs, height) };
}

/** Text of a segment with spaces between runs where the gap is visible. */
export function segmentText(seg: TextRun[]): string {
  let t = "";
  seg.forEach((r, i) => {
    if (i > 0) {
      const prev = seg[i - 1];
      const gap = r.x - (prev.x + prev.width);
      if (gap > r.size * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(r.text)) t += " ";
    }
    t += r.text;
  });
  return t;
}
