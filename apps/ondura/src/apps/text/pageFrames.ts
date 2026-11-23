// Page geometry of the text editor: the size and margins of every page, from
// the page setup of its section and the document's page options (facing
// pages, gutter, two pages per sheet, book fold).

import type { PageSetup } from "./model";
import { mmToPx } from "./model";

/** Page options that belong to the whole document. */
export interface DocLayout {
  mirrorMargins: boolean;
  gutterAtTop: boolean;
  hyphenation: boolean;
  /** Two pages per sheet: every page is half of the paper. */
  twoOnOne: boolean;
  /** Book fold: a booklet, two pages per side of a landscape sheet. */
  bookFold: boolean;
  /** Sheets per booklet with book fold; 0 = one booklet of all pages. */
  bookFoldSheets: number;
}

export const DEFAULT_LAYOUT: DocLayout = { mirrorMargins: false, gutterAtTop: false, hyphenation: false, twoOnOne: false, bookFold: false, bookFoldSheets: 0 };

/** Word's "Multiple pages" setting. */
export type MultiplePages = "normal" | "mirror" | "twoOnOne" | "bookFold";

export const multiplePagesOf = (l: Pick<DocLayout, "mirrorMargins" | "twoOnOne" | "bookFold">): MultiplePages => (l.bookFold ? "bookFold" : l.twoOnOne ? "twoOnOne" : l.mirrorMargins ? "mirror" : "normal");

export function withMultiplePages<T extends Pick<DocLayout, "mirrorMargins" | "twoOnOne" | "bookFold" | "gutterAtTop">>(l: T, m: MultiplePages): T {
  return { ...l, mirrorMargins: m === "mirror", twoOnOne: m === "twoOnOne", bookFold: m === "bookFold", gutterAtTop: m === "normal" || m === "twoOnOne" ? l.gutterAtTop : false };
}

/** Facing pages: inside and outside margins, the gutter inside. */
export const facing = (l: Pick<DocLayout, "mirrorMargins" | "bookFold">) => l.mirrorMargins || l.bookFold;

/** Size of one page in mm: the paper, or half of it (the longer side split)
 *  with two pages per sheet or book fold. */
export function logicalSize(p: PageSetup, l: Pick<DocLayout, "twoOnOne" | "bookFold">): { widthMm: number; heightMm: number } {
  if (!l.twoOnOne && !l.bookFold) return { widthMm: p.widthMm, heightMm: p.heightMm };
  return p.widthMm >= p.heightMm ? { widthMm: p.widthMm / 2, heightMm: p.heightMm } : { widthMm: p.widthMm, heightMm: p.heightMm / 2 };
}

/** Margins of page `pageNumber` (1-based) in mm, with the gutter; on facing
 *  pages the even (left) pages have the inside margin on the right. */
export function pageMargins(p: PageSetup, l: Pick<DocLayout, "mirrorMargins" | "bookFold" | "gutterAtTop">, pageNumber = 1) {
  const g = p.gutterMm ?? 0;
  const mirror = facing(l);
  const top = p.marginTopMm + (l.gutterAtTop && !mirror ? g : 0);
  const bottom = p.marginBottomMm;
  if (mirror && pageNumber % 2 === 0) return { top, bottom, left: p.marginRightMm, right: p.marginLeftMm + g };
  return { top, bottom, left: p.marginLeftMm + (l.gutterAtTop && !mirror ? 0 : g), right: p.marginRightMm };
}

/** One page on screen, in CSS pixels. */
export interface PageFrame {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** Distance of the header (footer) from the top (bottom) edge. */
  headerDist: number;
  footerDist: number;
  vAlign: "top" | "center" | "both" | "bottom";
}

export function frameOf(p: PageSetup, l: DocLayout, pageNumber: number): PageFrame {
  const s = logicalSize(p, l);
  const m = pageMargins(p, l, pageNumber);
  return {
    width: mmToPx(s.widthMm),
    height: mmToPx(s.heightMm),
    marginTop: mmToPx(m.top),
    marginBottom: mmToPx(m.bottom),
    marginLeft: mmToPx(m.left),
    marginRight: mmToPx(m.right),
    headerDist: mmToPx(p.headerMm),
    footerDist: mmToPx(p.footerMm),
    vAlign: p.vAlign === "center" || p.vAlign === "both" || p.vAlign === "bottom" ? p.vAlign : "top",
  };
}

/** Width of the paper strip on screen: the widest page of any section. */
export function paperWidth(setups: PageSetup[], l: DocLayout): number {
  return Math.max(...setups.map((p) => mmToPx(logicalSize(p, l).widthMm)), 1);
}

/** Order of the pages on the sides of the sheets of a booklet (0-based page
 *  indexes, `null` = blank): for each side [left, right]. Sides alternate
 *  front and back, so printing double-sided (short edge) and folding the
 *  stack gives the pages in order. With `sheets` per booklet the pages are
 *  split into several booklets of 4 × `sheets` pages, printed one after the
 *  other (0 = one booklet). */
export function bookletSides(pages: number, sheets = 0): [number | null, number | null][] {
  const per = sheets > 0 ? sheets * 4 : Math.max(4, Math.ceil(pages / 4) * 4);
  const out: [number | null, number | null][] = [];
  for (let base = 0; base < Math.max(pages, 1); base += per) {
    // The last booklet only needs as many sheets as its pages fill.
    const n = Math.min(per, Math.max(4, Math.ceil((pages - base) / 4) * 4));
    const at = (i: number) => (base + i < pages ? base + i : null);
    for (let s = 0; s < n / 4; s++) {
      out.push([at(n - 1 - 2 * s), at(2 * s)]);
      out.push([at(2 * s + 1), at(n - 2 - 2 * s)]);
    }
  }
  return out;
}
