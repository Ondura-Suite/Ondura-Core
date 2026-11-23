// Line numbers in the left margin, like Word's "Line Numbers" (Layout tab).
//
// The editor flows as one column of blocks, so the numbers are drawn on top
// of the page: after each layout the lines of every paragraph are measured
// (the boxes of its text) and numbered per section setting. Tables, text in
// headers/footers and paragraphs marked "suppress line numbers" are not
// counted, as in Word.

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { LineNumbers, PageSetup } from "./model";
import { mmToPx } from "./model";

/** Word's automatic distance from the text: 0.25 inch. */
export const AUTO_DISTANCE_MM = 6.35;

export interface NumberedLine {
  /** Position in the (unzoomed) paper. */
  top: number;
  height: number;
  /** Right edge of the number. */
  right: number;
  n: number;
}

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6";

/** The text lines of a paragraph as [top, bottom, left] in screen pixels. */
function lines(el: HTMLElement): [number, number, number][] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.height > 0).sort((a, b) => a.top - b.top || a.left - b.left);
  const out: [number, number, number][] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    const mid = (r.top + r.bottom) / 2;
    if (last && mid >= last[0] && mid <= last[1]) {
      last[0] = Math.min(last[0], r.top);
      last[1] = Math.max(last[1], r.bottom);
      last[2] = Math.min(last[2], r.left);
    } else out.push([r.top, r.bottom, r.left]);
  }
  if (!out.length) {
    // An empty paragraph is one line.
    const r = el.getBoundingClientRect();
    if (r.height > 0) out.push([r.top, r.bottom, r.left]);
  }
  return out;
}

/**
 * Numbers the lines of the editor. `sections` are the page setups of the
 * sections in order (the last one is the document's).
 */
export function numberLines(pm: HTMLElement, paper: HTMLElement, zoom: number, sections: PageSetup[], marginLeftPx: number): NumberedLine[] {
  if (!sections.some((s) => s.lineNumbers)) return [];
  const base = paper.getBoundingClientRect();
  const out: NumberedLine[] = [];
  let section = 0;
  let counter: number | null = null;
  let pageOfCounter = 0;
  let page = 0;
  const settings = (): LineNumbers | null | undefined => sections[Math.min(section, sections.length - 1)]?.lineNumbers;
  for (const child of Array.from(pm.children) as HTMLElement[]) {
    if (child.classList.contains("nx-page-spacer")) {
      page++;
      continue;
    }
    if (child.matches("[data-section-break]")) {
      section++;
      if (settings()?.restart !== "continuous") counter = null;
      continue;
    }
    if (child.matches("[data-page-break]")) continue;
    const ln = settings();
    if (!ln) continue;
    const blocks = child.matches(TEXTBLOCK) ? [child] : ([...child.querySelectorAll(TEXTBLOCK)] as HTMLElement[]);
    const inColumns = child.matches("[data-columns]");
    for (const p of blocks) {
      if (p.closest("table, .nx-footnotes, [data-toc]") || p.matches("[data-suppress-ln]")) continue;
      for (const [top, bottom, left] of lines(p)) {
        if (ln.restart === "newPage" && pageOfCounter !== page) counter = null;
        counter = counter == null ? Math.max(1, ln.start || 1) : counter + 1;
        pageOfCounter = page;
        const by = Math.max(1, ln.countBy || 1);
        if (counter % by !== 0) continue;
        const distance = mmToPx(ln.distanceMm ?? AUTO_DISTANCE_MM);
        // In columns each column gets its numbers; otherwise they sit in the left margin.
        const edge = inColumns ? (left - base.left) / zoom : marginLeftPx;
        out.push({ top: (top - base.top) / zoom, height: (bottom - top) / zoom, right: edge - distance, n: counter });
      }
    }
  }
  return out;
}

/** Page setups of the sections of the editor's document, in order. */
function sectionsOf(editor: Editor, main: PageSetup): PageSetup[] {
  const out: PageSetup[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "sectionBreak" && n.attrs.page) out.push(n.attrs.page as PageSetup);
  });
  return [...out, main];
}

/** The numbers, drawn over the paper; recalculated after edits and layout. */
export function LineNumberLayer({ editor, paper, zoom, page, marginLeftPx, layoutKey }: { editor: Editor; paper: React.RefObject<HTMLDivElement | null>; zoom: number; page: PageSetup; marginLeftPx: number; layoutKey: unknown }) {
  const [numbers, setNumbers] = useState<NumberedLine[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const el = paper.current;
        if (!el || editor.isDestroyed) return;
        const found = numberLines(editor.view.dom as HTMLElement, el, zoom, sectionsOf(editor, page), marginLeftPx);
        setNumbers((prev) => (!found.length && !prev.length ? prev : found));
      }, 120);
    };
    run();
    editor.on("update", run);
    window.addEventListener("resize", run);
    return () => {
      clearTimeout(timer);
      editor.off("update", run);
      window.removeEventListener("resize", run);
    };
  }, [editor, paper, zoom, page, marginLeftPx, layoutKey]);
  if (!numbers.length) return null;
  return (
    <div className="nx-line-numbers" aria-hidden>
      {numbers.map((l, i) => (
        <span key={i} style={{ top: l.top, height: l.height, lineHeight: `${l.height}px`, left: l.right - 48 }}>
          {l.n}
        </span>
      ))}
    </div>
  );
}
