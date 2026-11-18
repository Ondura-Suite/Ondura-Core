// Page layout: paper sizes, margin presets, header/footer codes and the
// page plan used when printing a sheet.

import { colName } from "./formula";
import { DEFAULT_PAGE, type PageSetup, type Rect, type SheetState, parseRange, usedRange } from "./model";

export const PAPERS: { id: string; label: string; w: number; h: number }[] = [
  { id: "A4", label: "A4 (21 × 29,7 cm)", w: 210, h: 297 },
  { id: "A3", label: "A3 (29,7 × 42 cm)", w: 297, h: 420 },
  { id: "A5", label: "A5 (14,8 × 21 cm)", w: 148, h: 210 },
  { id: "Letter", label: "Letter (21,59 × 27,94 cm)", w: 215.9, h: 279.4 },
  { id: "Legal", label: "Legal (21,59 × 35,56 cm)", w: 215.9, h: 355.6 },
];

export const MARGIN_PRESETS: { id: string; label: string; m: Pick<PageSetup, "marginTop" | "marginBottom" | "marginLeft" | "marginRight" | "marginHeader" | "marginFooter"> }[] = [
  { id: "normal", label: "Normal", m: { marginTop: 1.91, marginBottom: 1.91, marginLeft: 1.78, marginRight: 1.78, marginHeader: 0.76, marginFooter: 0.76 } },
  { id: "wide", label: "Breit", m: { marginTop: 2.54, marginBottom: 2.54, marginLeft: 2.54, marginRight: 2.54, marginHeader: 1.27, marginFooter: 1.27 } },
  { id: "narrow", label: "Schmal", m: { marginTop: 1.91, marginBottom: 1.91, marginLeft: 0.64, marginRight: 0.64, marginHeader: 0.76, marginFooter: 0.76 } },
];

export const pageOf = (s: SheetState): PageSetup => s.page ?? DEFAULT_PAGE;

/** Paper size in mm, oriented. */
export function paperMm(p: PageSetup): [number, number] {
  const paper = PAPERS.find((x) => x.id === p.paper) ?? PAPERS[0];
  return p.landscape ? [paper.h, paper.w] : [paper.w, paper.h];
}

// --------------------------------------------------------- header/footer --

/** Splits `&L…&C…&R…` into left, center, right (text without a section is centred). */
export function splitSections(code: string | undefined): [string, string, string] {
  const out: [string, string, string] = ["", "", ""];
  let cur = 1;
  const s = code ?? "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1]?.toUpperCase();
    if (ch === "&" && (next === "L" || next === "C" || next === "R")) {
      cur = next === "L" ? 0 : next === "C" ? 1 : 2;
      i++;
      continue;
    }
    out[cur] += ch;
  }
  return out;
}

export function joinSections([l, c, r]: [string, string, string]): string | undefined {
  const code = (l ? `&L${l}` : "") + (c ? `&C${c}` : "") + (r ? `&R${r}` : "");
  return code || undefined;
}

/** Codes with their meaning, for the insert buttons of the dialog. */
export const HF_FIELDS: { code: string; label: string }[] = [
  { code: "&P", label: "Seitenzahl" },
  { code: "&N", label: "Anzahl Seiten" },
  { code: "&D", label: "Datum" },
  { code: "&T", label: "Uhrzeit" },
  { code: "&F", label: "Dateiname" },
  { code: "&A", label: "Blattname" },
];

/** Ready-made headers/footers like Excel's drop-down. */
export const HF_PRESETS: { label: string; code: string }[] = [
  { label: "(keine)", code: "" },
  { label: "Seite 1", code: "&CSeite &P" },
  { label: "Seite 1 von ?", code: "&CSeite &P von &N" },
  { label: "Blattname", code: "&C&A" },
  { label: "Dateiname", code: "&C&F" },
  { label: "Blattname, Seite 1", code: "&L&A&RSeite &P" },
  { label: "Dateiname, Datum, Seite 1", code: "&L&F&C&D&RSeite &P" },
];

interface HfContext {
  sheet: string;
  file: string;
  now: Date;
}

/** One section as text with page fields resolved by a callback. */
function expand(text: string, ctx: HfContext, field: (code: "P" | "N") => string, literal: (s: string) => string): string {
  let out = "";
  let plain = "";
  const flush = () => {
    if (plain) out += literal(plain);
    plain = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "&") {
      plain += ch;
      continue;
    }
    const n = text[i + 1];
    i++;
    switch (n?.toUpperCase()) {
      case "P":
      case "N":
        flush();
        out += field(n.toUpperCase() as "P" | "N");
        break;
      case "D":
        plain += ctx.now.toLocaleDateString("de-DE");
        break;
      case "T":
        plain += ctx.now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
        break;
      case "F":
      case "Z":
        plain += ctx.file;
        break;
      case "A":
        plain += ctx.sheet;
        break;
      case "&":
        plain += "&";
        break;
      case '"': {
        // Font name: skip up to the closing quote.
        const end = text.indexOf('"', i + 1);
        i = end < 0 ? text.length : end;
        break;
      }
      default:
        // Font size (&12) and style codes (&B, &I, &U …) are not printed.
        while (/\d/.test(text[i + 1] ?? "")) i++;
    }
  }
  flush();
  return out;
}

/** CSS `content` value for an @page margin box. */
export function cssContent(text: string, ctx: HfContext): string {
  const css = expand(
    text,
    ctx,
    (c) => ` counter(${c === "P" ? "page" : "pages"}) `,
    (s) => ` "${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}" `,
  ).trim();
  return css || '""';
}

/** Preview text (page 1 of 1). */
export function previewText(text: string, ctx: HfContext): string {
  return expand(text, ctx, (c) => (c === "P" ? "1" : "1"), (s) => s);
}

/** The @page rule of a page setup: paper, margins and header/footer boxes. */
export function pageCss(p: PageSetup, ctx: HfContext): string {
  const [w, h] = paperMm(p);
  const boxes: string[] = [];
  const pos = ["left", "center", "right"];
  splitSections(p.header).forEach((t, i) => t && boxes.push(`@top-${pos[i]} { content: ${cssContent(t, ctx)}; font: 10pt Calibri, Carlito, sans-serif; white-space: pre; vertical-align: top; padding-top: ${p.marginHeader}cm; }`));
  splitSections(p.footer).forEach((t, i) => t && boxes.push(`@bottom-${pos[i]} { content: ${cssContent(t, ctx)}; font: 10pt Calibri, Carlito, sans-serif; white-space: pre; vertical-align: bottom; padding-bottom: ${p.marginFooter}cm; }`));
  return `@page { size: ${w}mm ${h}mm; margin: ${p.marginTop}cm ${p.marginRight}cm ${p.marginBottom}cm ${p.marginLeft}cm; ${boxes.join(" ")} }`;
}

// ------------------------------------------------------------ page plan --

/** `1:2` → rows 0..1; `A:B` → columns 0..1. */
export function parseSpan(s: string | undefined, axis: "row" | "col"): [number, number] | null {
  if (!s) return null;
  const m = s.replace(/\$/g, "").trim().match(axis === "row" ? /^(\d+)(?::(\d+))?$/ : /^([A-Za-z]+)(?::([A-Za-z]+))?$/);
  if (!m) return null;
  const idx = (t: string) => (axis === "row" ? Number(t) - 1 : t.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1);
  const a = idx(m[1]);
  const b = idx(m[2] ?? m[1]);
  return a < 0 || b < 0 ? null : [Math.min(a, b), Math.max(a, b)];
}

export const spanText = (a: number, b: number, axis: "row" | "col") => (axis === "row" ? `${a + 1}:${b + 1}` : `${colName(a)}:${colName(b)}`);

export interface PrintPage {
  rows: number[];
  cols: number[];
}

/**
 * Pages of a sheet: the print area (or used range) split at manual breaks
 * and, automatically, where the printable width/height is full. Pages run
 * down first, then across (Excel's default order).
 */
export function printPages(s: SheetState, colWidth: (c: number) => number, rowHeight: (r: number) => number): { pages: PrintPage[]; scale: number; titleRows: number[]; titleCols: number[] } {
  const p = pageOf(s);
  const area: Rect | null = (p.printArea && parseRange(p.printArea)) || usedRange(s);
  if (!area) return { pages: [], scale: 1, titleRows: [], titleCols: [] };
  const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const tr = parseSpan(p.titleRows, "row");
  const tc = parseSpan(p.titleCols, "col");
  const titleRows = tr ? span(tr[0], tr[1]).filter((r) => !s.hiddenRows.has(r)) : [];
  const titleCols = tc ? span(tc[0], tc[1]).filter((c) => !s.hiddenCols.has(c)) : [];
  const rows = span(area.r1, area.r2).filter((r) => !s.hiddenRows.has(r));
  const cols = span(area.c1, area.c2).filter((c) => !s.hiddenCols.has(c));
  // Printable size in CSS px (96 dpi).
  const [w, h] = paperMm(p);
  const px = (cm: number) => (cm * 96) / 2.54;
  const availW = px(w / 10 - p.marginLeft - p.marginRight) - (p.headings ? 40 : 0);
  const availH = px(h / 10 - p.marginTop - p.marginBottom) - (p.headings ? 20 : 0);
  const widthOf = (cs: number[]) => cs.reduce((n, c) => n + colWidth(c), 0);
  const heightOf = (rs: number[]) => rs.reduce((n, r) => n + rowHeight(r), 0);
  let scale = Math.min(4, Math.max(0.1, p.scale / 100));
  if (p.fitWidth !== undefined || p.fitHeight !== undefined) {
    const fw = p.fitWidth ? (p.fitWidth * availW) / (widthOf(cols) + widthOf(titleCols) * p.fitWidth) : Infinity;
    const fh = p.fitHeight ? (p.fitHeight * availH) / (heightOf(rows) + heightOf(titleRows) * p.fitHeight) : Infinity;
    scale = Math.max(0.1, Math.min(1, fw, fh));
  }
  const split = (items: number[], size: (i: number) => number, avail: number, manual: number[]) => {
    const chunks: number[][] = [];
    let cur: number[] = [];
    let used = 0;
    for (const i of items) {
      const sz = size(i) * scale;
      if (cur.length && (manual.includes(i) || used + sz > avail)) {
        chunks.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += sz;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  };
  const rowChunks = split(rows, rowHeight, availH - heightOf(titleRows) * scale, p.rowBreaks ?? []);
  const colChunks = split(cols, colWidth, availW - widthOf(titleCols) * scale, p.colBreaks ?? []);
  const pages: PrintPage[] = [];
  for (const cs of colChunks) for (const rs of rowChunks) pages.push({ rows: rs, cols: cs });
  return { pages, scale, titleRows, titleCols };
}
