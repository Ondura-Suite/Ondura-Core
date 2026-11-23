// Printing the pages as they are laid out on screen: every page is a window
// onto static copies of what the editor shows there (text, headers and
// footers, sheets with page colour and border, line numbers). So sections
// with their own page size, facing pages, vertical alignment and line
// numbers print as they look; the pages are then placed on the sheets of
// paper: one per sheet, two per sheet, or as a booklet (book fold).

import { NO_BROWSER_HEADER } from "../../lib/print";
import { bookletSides } from "./pageFrames";

/** A page on the paper strip, in CSS pixels (unzoomed). */
export interface ScreenPage {
  top: number;
  x: number;
  width: number;
  height: number;
  /** The paper it is printed on (mm): the page itself, or the sheet that
   *  holds two pages. */
  sheetMm: { width: number; height: number };
}

export type Imposition = "single" | "twoOnOne" | "bookFold";

interface Item {
  el: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Marks of editing that do not belong on paper. */
const EDIT_CLASSES = ["ProseMirror-selectednode", "selectedCell", "nx-find", "nx-find-current"];

/** What is drawn on the paper, with positions relative to it. */
function items(paper: HTMLElement, zoom: number): Item[] {
  const base = paper.getBoundingClientRect();
  const out: Item[] = [];
  const add = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    out.push({ el, left: (r.left - base.left) / zoom, top: (r.top - base.top) / zoom, width: r.width / zoom, height: r.height / zoom });
  };
  for (const child of Array.from(paper.children)) {
    if (child.classList.contains("tiptap-wrap")) {
      const pm = child.querySelector(".ProseMirror");
      for (const c of Array.from(pm?.children ?? [])) if (!c.classList.contains("ProseMirror-trailingBreak")) add(c);
    } else if (child.classList.contains("nx-line-numbers")) {
      for (const c of Array.from(child.children)) add(c);
    } else add(child);
  }
  return out;
}

/** A static copy of an item at its place on the paper. */
function copy(it: Item): HTMLElement {
  const c = it.el.cloneNode(true) as HTMLElement;
  c.removeAttribute("contenteditable");
  for (const cls of EDIT_CLASSES) {
    c.classList.remove(cls);
    c.querySelectorAll(`.${cls}`).forEach((e) => e.classList.remove(cls));
  }
  c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
  const st = c.style;
  st.setProperty("position", "absolute", "important");
  st.setProperty("left", `${it.left}px`, "important");
  st.setProperty("top", `${it.top}px`, "important");
  st.setProperty("width", `${it.width}px`, "important");
  st.setProperty("box-sizing", "border-box", "important");
  st.setProperty("margin", "0", "important");
  // Vertical alignment is already in the measured position.
  st.setProperty("transform", "none", "important");
  return c;
}

/** One page: a window of the page's size onto the copies that reach into it. */
function pageWindow(paper: HTMLElement, all: Item[], page: ScreenPage): HTMLElement {
  const win = document.createElement("div");
  win.className = "nx-print-window";
  win.style.cssText = `position:absolute;overflow:hidden;width:${page.width}px;height:${page.height}px`;
  const shell = paper.cloneNode(false) as HTMLElement;
  shell.style.position = "absolute";
  shell.style.left = `${-page.x}px`;
  shell.style.top = `${-page.top}px`;
  shell.style.padding = "0";
  shell.style.minHeight = "0";
  shell.style.height = `${page.top + page.height}px`;
  const wrap = document.createElement("div");
  wrap.className = "tiptap-wrap";
  wrap.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  wrap.appendChild(pm);
  const bottom = page.top + page.height;
  // Copies go into a container like their original's: the paper, the
  // editor, or an overlay such as the line numbers.
  const layers = new Map<HTMLElement, HTMLElement>();
  for (const it of all) {
    if (it.top >= bottom || it.top + it.height <= page.top) continue;
    const parent = it.el.parentElement;
    let into = shell;
    if (parent?.classList.contains("ProseMirror")) into = pm;
    else if (parent && parent !== paper) {
      if (!layers.has(parent)) {
        const layer = parent.cloneNode(false) as HTMLElement;
        layers.set(parent, layer);
        shell.appendChild(layer);
      }
      into = layers.get(parent)!;
    }
    into.appendChild(copy(it));
  }
  shell.appendChild(wrap);
  win.appendChild(shell);
  return win;
}

const pxToMm = (px: number) => (px * 25.4) / 96;

/**
 * The print layout: sheets of paper with the pages placed on them, and the
 * CSS for their sizes. `pages` are the pages on screen, in order.
 */
export function screenPrintLayout(paper: HTMLElement, zoom: number, pages: ScreenPage[], imposition: Imposition): { html: string; css: string; first: { width: number; height: number } } {
  const all = items(paper, zoom);
  const sizes = new Map<string, string>();
  const root = document.createElement("div");
  let first: { width: number; height: number } | null = null;
  const sheet = (mm: { width: number; height: number }, placed: [ScreenPage | null, number, number][]) => {
    const key = `${mm.width.toFixed(2)}x${mm.height.toFixed(2)}`;
    if (!sizes.has(key)) sizes.set(key, `nxp${sizes.size}`);
    first ??= mm;
    const el = document.createElement("div");
    el.className = "nx-print-sheet";
    // Containment keeps what reaches past a page inside its sheet when the
    // print layout is split into pages.
    el.style.cssText = `position:relative;overflow:hidden;contain:strict;width:${mm.width}mm;height:${mm.height}mm;page:${sizes.get(key)}`;
    for (const [p, xMm, yMm] of placed) {
      if (!p) continue;
      const w = pageWindow(paper, all, p);
      w.style.left = `${xMm}mm`;
      w.style.top = `${yMm}mm`;
      el.appendChild(w);
    }
    root.appendChild(el);
  };
  if (imposition === "single") {
    for (const p of pages) sheet({ width: pxToMm(p.width), height: pxToMm(p.height) }, [[p, 0, 0]]);
  } else {
    // Two pages on a sheet: side by side on a landscape sheet, one above the
    // other on a portrait one.
    const place = (mm: { width: number; height: number }, a: ScreenPage | null, b: ScreenPage | null) => {
      const side = mm.width >= mm.height;
      sheet(mm, [
        [a, 0, 0],
        [b, side ? mm.width / 2 : 0, side ? 0 : mm.height / 2],
      ]);
    };
    if (imposition === "twoOnOne") {
      for (let i = 0; i < pages.length; i += 2) place(pages[i].sheetMm, pages[i], pages[i + 1] ?? null);
    } else {
      for (const [l, r] of bookletSides(pages.length)) {
        const any = pages[l ?? r ?? 0];
        place(any.sheetMm, l == null ? null : pages[l], r == null ? null : pages[r]);
      }
    }
  }
  const css = [...sizes].map(([key, name]) => {
    const [w, h] = key.split("x");
    return `@page ${name} { size: ${w}mm ${h}mm; margin: 0; ${NO_BROWSER_HEADER} }`;
  });
  return { html: root.innerHTML, css: css.join(" "), first: first ?? { width: 210, height: 297 } };
}
