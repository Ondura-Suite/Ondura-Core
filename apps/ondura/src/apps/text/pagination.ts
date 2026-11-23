// Page view: the document flows over A4 (or other) pages. After every
// layout the blocks are measured, and where a page ends a widget decoration
// draws the rest of the page (its footnotes and footer), the gap between the
// sheets and the next page's header.
//
// Like Word, a page ends between the lines of a paragraph (keeping at least
// two lines of a paragraph on each page: widow and orphan control), between
// the items of a list and between the rows of a table (repeating its heading
// rows); a heading stays with the text after it. Inside a paragraph the
// widget is a block element, which ends the line box before it; in a table
// it is a row. Blocks that cannot be split (images, columns, a row taller
// than a page) move to the next page as a whole.
//
// Every page has its own frame (size and margins from the page setup of its
// section, mirrored on even pages with facing pages). The editor spans the
// widest page; node decorations place each block in the text area of its
// page (`--nx-l` / `--nx-r`, see text.css) and move it down for vertical
// alignment (a transform, which does not change the layout that is measured).
//
// Footnotes are listed at the bottom of the page with their reference; the
// page holds less text by their height.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { PageFrame } from "./pageFrames";

export interface Note {
  n: number;
  text: string;
}

export interface PageBreakInfo {
  pos: number;
  /** Unused space at the bottom of the page. */
  remaining: number;
  /** Where the break is: between top-level blocks, inside a block (between
   *  lines or list items) or between table rows. */
  kind?: "block" | "inner" | "row";
  /** Footnotes shown at the bottom of the page. */
  notes?: Note[];
  /** Table rows: position of the table, its heading rows repeated on the
   *  next page and their height, and the number of columns. */
  table?: { pos: number; head: number; cols: number; headHeight: number; width: number };
  /** Inside a block: distance of the spacer's container from the left edge
   *  of the paper; the spacer is moved back by it to span the paper. */
  dx?: number;
}

/** Placement of a top-level block. */
interface BlockPlace {
  pos: number;
  left: number;
  right: number;
  dy: number;
}

export interface PageInfo {
  /** Section whose page setup the page has. */
  section: number;
}

export interface PagePlace {
  section: number;
  /** First page of its section. */
  first: boolean;
}

/** Section of page `page` (1-based) and whether it starts the section. */
export function pagePlace(pages: PageInfo[], page: number): PagePlace {
  const section = pages[page - 1]?.section ?? pages[pages.length - 1]?.section ?? 0;
  return { section, first: page === 1 || (pages[page - 2]?.section ?? -1) !== section };
}

export interface PaginationOptions {
  /** Frame of page `page` (1-based) with the page setup of section `section`. */
  frame: (page: number, section: number) => PageFrame;
  /** Width of the editor (the widest page). */
  paperWidth: () => number;
  gap: number;
  /** Header/footer content for a page (1-based), as DOM; `place` says the
   *  page's section and whether it is the first page of it. */
  renderHeader: (page: number, pages: number, frame: PageFrame, place: PagePlace) => HTMLElement | null;
  renderFooter: (page: number, pages: number, frame: PageFrame, place: PagePlace) => HTMLElement | null;
  /** Reports the pages and the editor height needed to fill the last page. */
  onLayout: (layout: { pages: PageInfo[]; minHeight: number; breaks: PageBreakInfo[] }) => void;
}

interface Layout {
  breaks: PageBreakInfo[];
  pages: PageInfo[];
  places: BlockPlace[];
  /** Footnotes of the last page and its free space (a widget at the end). */
  tail: { notes: Note[]; remaining: number } | null;
}

interface PaginationState extends Layout {
  version: number;
  deco: DecorationSet;
}

export const paginationKey = new PluginKey<PaginationState>("onduraPagination");

/** Class of the elements that end a page (not document content). */
export const SPACER = "nx-page-spacer";
const TAIL = "nx-page-tail";

/** Left edge of a page on the paper strip (pages are centred). */
const pageX = (o: PaginationOptions, f: PageFrame) => (o.paperWidth() - f.width) / 2;

/** Space above the footnotes, with the rule that separates them from the text. */
const NOTES_GAP = 12;

function noteLine(n: Note): HTMLElement {
  const line = document.createElement("div");
  line.className = "nx-page-note";
  line.dataset.note = String(n.n);
  const sup = document.createElement("sup");
  sup.textContent = String(n.n);
  line.append(sup, ` ${n.text}`);
  return line;
}

/** The footnotes at the bottom of a page. */
function notesBox(notes: Note[], padLeft: number, padRight: number): HTMLElement {
  const box = document.createElement("div");
  box.className = "nx-page-notes";
  box.style.padding = `${NOTES_GAP}px ${padRight}px 0 ${padLeft}px`;
  const rule = document.createElement("div");
  rule.className = "nx-page-notes-rule";
  rule.style.left = `${padLeft}px`;
  box.appendChild(rule);
  for (const n of notes) box.appendChild(noteLine(n));
  return box;
}

function spacer(o: PaginationOptions, view: EditorView, page: number, info: Layout, b: PageBreakInfo) {
  const pages = info.pages.length;
  const here = o.frame(page, info.pages[page - 1]?.section ?? 0);
  const next = o.frame(page + 1, info.pages[page]?.section ?? info.pages[page - 1]?.section ?? 0);
  const w = o.paperWidth();
  const hx = pageX(o, here);
  const nx = pageX(o, next);
  const el = document.createElement("div");
  el.className = SPACER;
  el.contentEditable = "false";
  const fill = document.createElement("div");
  fill.style.height = `${b.remaining}px`;
  el.appendChild(fill);
  if (b.notes?.length) el.appendChild(notesBox(b.notes, hx + here.marginLeft, w - hx - here.width + here.marginRight));
  const footer = document.createElement("div");
  footer.className = "nx-hf nx-hf-footer";
  footer.style.height = `${here.marginBottom}px`;
  footer.style.padding = `0 ${w - hx - here.width + here.marginRight}px 0 ${hx + here.marginLeft}px`;
  const f = o.renderFooter(page, pages, here, pagePlace(info.pages, page));
  if (f) footer.appendChild(f);
  const gap = document.createElement("div");
  gap.className = "nx-page-gap";
  gap.style.height = `${o.gap}px`;
  const header = document.createElement("div");
  header.className = "nx-hf nx-hf-header";
  header.style.height = `${next.marginTop}px`;
  header.style.padding = `0 ${w - nx - next.width + next.marginRight}px 0 ${nx + next.marginLeft}px`;
  const h = o.renderHeader(page + 1, pages, next, pagePlace(info.pages, page + 1));
  if (h) header.appendChild(h);
  el.append(footer, gap, header);
  if (b.kind === "inner") el.classList.add("nx-page-spacer-inner");
  if (b.kind !== "block") {
    el.style.marginLeft = `${-(b.dx ?? 0)}px`;
    el.style.width = `${w}px`;
  }
  if (b.kind !== "row") return el;
  // Between table rows: a row of its own, with the heading rows of the table
  // repeated at the top of the next page.
  const tr = document.createElement("tr");
  tr.className = `${SPACER} nx-page-spacer-row`;
  tr.contentEditable = "false";
  const td = document.createElement("td");
  td.colSpan = Math.max(1, b.table?.cols ?? 1);
  el.className = "nx-page-spacer-cell";
  el.removeAttribute("contenteditable");
  td.appendChild(el);
  tr.appendChild(td);
  const t = b.table;
  if (t && t.head > 0) {
    const wrap = view.nodeDOM(t.pos) as HTMLElement | null;
    const table = wrap?.matches("table") ? wrap : wrap?.querySelector("table");
    if (table) {
      const copy = table.cloneNode(false) as HTMLTableElement;
      copy.classList.add("nx-repeat-head");
      copy.style.marginLeft = `${b.dx ?? 0}px`;
      copy.style.width = `${t.width}px`;
      const cols = table.querySelector("colgroup");
      if (cols) copy.appendChild(cols.cloneNode(true));
      const body = document.createElement("tbody");
      const rows = [...table.querySelectorAll(":scope > tbody > tr")].filter((r) => !r.classList.contains(SPACER)).slice(0, t.head);
      for (const r of rows) body.appendChild(r.cloneNode(true));
      copy.appendChild(body);
      el.appendChild(copy);
    }
  }
  return tr;
}

/** End of the document: the rest of the last page and its footnotes. */
function tailWidget(o: PaginationOptions, info: Layout) {
  const el = document.createElement("div");
  el.className = TAIL;
  el.contentEditable = "false";
  const t = info.tail!;
  const n = info.pages.length;
  const f = o.frame(n, info.pages[n - 1]?.section ?? 0);
  const w = o.paperWidth();
  const x = pageX(o, f);
  const fill = document.createElement("div");
  fill.style.height = `${t.remaining}px`;
  el.append(fill, notesBox(t.notes, x + f.marginLeft, w - x - f.width + f.marginRight));
  return el;
}

const noteKey = (ns?: Note[]) => (ns ?? []).map((n) => `${n.n}:${n.text}`).join("|");

function build(o: PaginationOptions, view: EditorView, doc: import("@tiptap/pm/model").Node, info: Layout, version: number) {
  const pages = info.pages.length;
  const widgets = info.breaks.map((b, i) =>
    Decoration.widget(b.pos, () => spacer(o, view, i + 1, info, b), { side: -1, key: `pb-${version}-${i}-${pages}-${b.kind ?? "block"}-${Math.round(b.dx ?? 0)}-${Math.round(b.remaining)}-${noteKey(b.notes)}-${b.table?.head ?? 0}`, ignoreSelection: true, marks: [] }),
  );
  if (info.tail?.notes.length) {
    const t = info.tail;
    widgets.push(Decoration.widget(doc.content.size, () => tailWidget(o, info), { side: 1, key: `pt-${version}-${pages}-${Math.round(t.remaining)}-${noteKey(t.notes)}`, ignoreSelection: true }));
  }
  const nodes = info.places.flatMap((p) => {
    const node = doc.nodeAt(p.pos);
    if (!node) return [];
    const style = `--nx-l:${p.left.toFixed(1)}px;--nx-r:${p.right.toFixed(1)}px${p.dy ? `;transform:translateY(${p.dy.toFixed(1)}px)` : ""}`;
    return [Decoration.node(p.pos, p.pos + node.nodeSize, { style })];
  });
  return DecorationSet.create(doc, [...widgets, ...nodes]);
}

// ----------------------------------------------------------------- measure --

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6, pre";
const HEADING = /^H[1-6]$/;
const ATOM = "img, sup[data-footnote], .nx-math, .nx-shape, [data-resize-container]";

/** A line of text: its textblock, the line's index in it, screen position
 *  of its start and its extent in page coordinates. */
interface Line {
  tb: HTMLElement;
  index: number;
  count: number;
  x: number;
  y: number;
  top: number;
  bottom: number;
  /** Footnote numbers referenced in the line. */
  notes: number[];
}

/** Rectangles of the content of `el`, without what the pagination added. */
export function contentRects(el: HTMLElement): DOMRect[] {
  const out: DOMRect[] = [];
  const range = document.createRange();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (!(n instanceof HTMLElement)) return NodeFilter.FILTER_ACCEPT;
      if (n.classList.contains(SPACER) || n.classList.contains(TAIL)) return NodeFilter.FILTER_REJECT;
      if (n.matches(ATOM)) {
        const r = n.getBoundingClientRect();
        if (r.height > 0) out.push(r);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType !== Node.TEXT_NODE || !n.textContent) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.height > 0) out.push(r);
  }
  return out;
}

/** Groups rectangles into lines (top, bottom, left edge, middle). */
export function groupLines(rects: DOMRect[]) {
  const lines: { top: number; bottom: number; x: number }[] = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = lines[lines.length - 1];
    const mid = (r.top + r.bottom) / 2;
    if (last && mid >= last.top && mid <= last.bottom) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.x = Math.min(last.x, r.left);
    } else lines.push({ top: r.top, bottom: r.bottom, x: r.left });
  }
  return lines;
}

export function measure(view: EditorView, o: PaginationOptions): Layout & { minHeight: number } {
  const root = view.dom as HTMLElement;
  const doc = view.state.doc;
  const W = o.paperWidth();
  // Vertical alignment moves blocks with transforms; measure without them.
  const holder = root.parentElement;
  holder?.classList.add("nx-measuring");
  const rootRect = root.getBoundingClientRect();
  const zoom = root.offsetHeight > 0 ? rootRect.height / root.offsetHeight || 1 : 1;
  const added = [...root.querySelectorAll<HTMLElement>(`.${SPACER}, .${TAIL}`)].map((el) => ({ el, bottom: el.getBoundingClientRect().bottom, height: el.offsetHeight }));
  const bottoms = added.map((a) => a.bottom);
  let sum = 0;
  const cumulative = added.map((a) => (sum += a.height));
  /** Page coordinate (unzoomed, without what the pagination added) of a screen y. */
  const logical = (y: number) => {
    let lo = 0;
    let hi = bottoms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bottoms[mid] <= y + 0.5) lo = mid + 1;
      else hi = mid;
    }
    return (y - rootRect.top) / zoom - (lo ? cumulative[lo - 1] : 0);
  };
  /** Extent of a small box (a line, a row) in page coordinates, placed by
   *  its middle: text boxes may reach a pixel above their line box. */
  const span = (top: number, bottom: number): [number, number] => {
    const m = logical((top + bottom) / 2);
    const h = (bottom - top) / zoom / 2;
    return [m - h, m + h];
  };

  // Footnotes: references in document order, their texts and heights.
  const refs = [...root.querySelectorAll<HTMLElement>("sup.nx-fn")].filter((r) => !r.closest(`.${SPACER}, .${TAIL}`));
  const notes = refs.map((r, i) => {
    const b = r.getBoundingClientRect();
    return { n: i + 1, text: r.getAttribute("title") ?? "", y: logical((b.top + b.bottom) / 2) };
  });
  const heightCache = new Map<string, number>();
  let probe: HTMLElement | null = null;
  const noteHeight = (n: Note, width: number) => {
    const key = `${Math.round(width)}|${n.n}|${n.text}`;
    if (!heightCache.has(key)) {
      if (!probe) {
        probe = document.createElement("div");
        probe.className = "nx-page-notes";
        probe.style.cssText = "position:absolute;visibility:hidden;left:-99999px;top:0;padding:0";
        holder?.appendChild(probe);
      }
      probe.style.width = `${width}px`;
      probe.replaceChildren(noteLine(n));
      heightCache.set(key, probe.offsetHeight);
    }
    return heightCache.get(key)!;
  };

  const breaks: PageBreakInfo[] = [];
  const pages: PageInfo[] = [{ section: 0 }];
  // Blocks of the page; `before` is where the block before it ends (with its
  // bottom margin), which is where a page end before this block begins.
  let onPage: { pos: number; section: number; top: number; before: number; heading: boolean; split: boolean }[] = [];
  let pageNotes: Note[] = [];
  const places: BlockPlace[] = [];
  let section = 0;
  let pageStart = 0;
  let lastBottom = 0;
  /** End of the last block with its bottom margin. */
  let lastEnd = 0;
  let pos = 0;
  let index = 0;
  const frame = () => o.frame(pages.length, pages[pages.length - 1].section);
  const textWidth = () => {
    const f = frame();
    return f.width - f.marginLeft - f.marginRight;
  };
  const contentHeight = () => {
    const f = frame();
    return f.height - f.marginTop - f.marginBottom;
  };
  /** Height of the footnotes of the page with `extra` added. */
  const notesHeight = (extra: Note[] = []) => {
    const all = [...pageNotes, ...extra.filter((n) => !pageNotes.some((m) => m.n === n.n))];
    return all.length ? NOTES_GAP + all.reduce((h, n) => h + noteHeight(n, textWidth()), 0) : 0;
  };
  /** Bottom of the text area with these footnotes on the page. */
  const limit = (extra: Note[] = []) => pageStart + contentHeight() - notesHeight(extra);
  const addNotes = (ns: Note[]) => {
    for (const n of ns) if (!pageNotes.some((m) => m.n === n.n)) pageNotes.push(n);
  };
  const notesIn = (a: number, b: number): Note[] => notes.filter((n) => n.y >= a - 0.5 && n.y < b + 0.5).map(({ n, text }) => ({ n, text }));

  /** Places the blocks of the finished page; `remaining` is its free space. */
  const finish = (remaining: number) => {
    const n = pages.length;
    const pf = frame();
    const x = (W - pf.width) / 2;
    const free = Math.max(0, remaining);
    const shift = pf.vAlign === "center" ? free / 2 : pf.vAlign === "bottom" ? free : 0;
    const whole = onPage.filter((b) => !b.split && b.pos >= 0);
    const step = pf.vAlign === "both" && whole.length > 1 ? free / (whole.length - 1) : 0;
    let i = 0;
    for (const b of onPage) {
      if (b.pos < 0) continue;
      const bf = b.section === pages[n - 1].section ? pf : o.frame(n, b.section);
      // A block continued from or onto another page is not moved.
      places.push({ pos: b.pos, left: x + bf.marginLeft, right: W - x - pf.width + bf.marginRight, dy: b.split ? 0 : shift + step * i++ });
    }
    onPage = [];
  };
  const endPage = (b: Omit<PageBreakInfo, "notes" | "remaining">, used: number) => {
    const remaining = Math.max(0, limit() - used);
    breaks.push({ ...b, remaining, ...(pageNotes.length ? { notes: pageNotes } : {}) });
    finish(remaining);
    pageNotes = [];
  };
  const newPage = (s: number) => pages.push({ section: s });

  /** Lines of the textblocks in `el` (not those in tables or columns in it). */
  const linesOf = (el: HTMLElement): Line[] => {
    const tbs = el.matches(TEXTBLOCK)
      ? [el]
      : [...el.querySelectorAll<HTMLElement>(TEXTBLOCK)].filter((t) => {
          const c = t.closest(`table, [data-columns], .${SPACER}, .${TAIL}`);
          return !c || !el.contains(c);
        });
    const out: Line[] = [];
    for (const tb of tbs) {
      const lines = groupLines(contentRects(tb));
      if (!lines.length) {
        const r = tb.getBoundingClientRect();
        if (r.height > 0) lines.push({ top: r.top, bottom: r.bottom, x: r.left });
      }
      const sups = [...tb.querySelectorAll<HTMLElement>("sup.nx-fn")].map((s) => {
        const r = s.getBoundingClientRect();
        return { n: refs.indexOf(s) + 1, y: (r.top + r.bottom) / 2 };
      });
      lines.forEach((l, i) => out.push({ tb, index: i, count: lines.length, x: l.x, y: (l.top + l.bottom) / 2, top: span(l.top, l.bottom)[0], bottom: span(l.top, l.bottom)[1], notes: sups.filter((s) => s.n > 0 && s.y >= l.top - 1 && s.y <= l.bottom + 1).map((s) => s.n) }));
    }
    return out;
  };
  const notesOf = (ns: number[]): Note[] => ns.map((n) => ({ n, text: notes[n - 1]?.text ?? "" }));

  /** Position before a textblock, or before the list item it starts. */
  const posBefore = (tb: HTMLElement): number | null => {
    let inside: number;
    try {
      inside = view.posAtDOM(tb, 0);
    } catch {
      return null;
    }
    const $p = doc.resolve(inside);
    let depth = $p.depth;
    while (depth > 2 && $p.node(depth - 1).type.name === "listItem" && $p.index(depth - 1) === 0) depth--;
    return depth >= 2 ? $p.before(depth) : null;
  };

  type Split = { pos: number; kind: "inner" | "row"; used: number; nextTop: number; notes: Note[]; dx: number; table?: PageBreakInfo["table"] };
  /** Left edge of the content box of `el` from the paper's edge. */
  const contentLeft = (el: Element | null) => {
    if (!el) return 0;
    const cs = getComputedStyle(el);
    return (el.getBoundingClientRect().left - rootRect.left) / zoom + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
  };
  /** Where a block crossing the end of the page is split, or null to move it whole. */
  const splitBlock = (child: HTMLElement, nodePos: number, nodeName: string): Split | null => {
    if (nodeName === "table") {
      const table = child.matches("table") ? child : child.querySelector("table");
      if (!table) return null;
      const rows = [...table.querySelectorAll<HTMLElement>(":scope > tbody > tr")].filter((r) => !r.classList.contains(SPACER));
      const firstBody = rows.findIndex((r) => [...r.children].some((c) => c.tagName !== "TH"));
      const heads = firstBody < 0 ? 0 : firstBody;
      let acc: Note[] = [];
      let onThis = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        const [top, bottom] = span(r.top, r.bottom);
        if (top < pageStart - 0.5) continue;
        const rowNotes = notesIn(top, bottom);
        if (bottom > limit([...acc, ...rowNotes]) + 0.5) {
          if (onThis === 0 || i < heads || (i === heads && onThis <= heads)) return null;
          let p: number;
          try {
            p = view.posAtDOM(rows[i], 0) - 1;
          } catch {
            return null;
          }
          const headHeight = heads ? rows.slice(0, heads).reduce((h, x) => h + x.offsetHeight, 0) : 0;
          const cols = Math.max(1, ...rows.map((x) => [...x.children].reduce((n, c) => n + ((c as HTMLTableCellElement).colSpan || 1), 0)));
          return {
            pos: p,
            kind: "row",
            dx: (table.getBoundingClientRect().left - rootRect.left) / zoom,
            used: span(rows[i - 1].getBoundingClientRect().top, rows[i - 1].getBoundingClientRect().bottom)[1],
            nextTop: top - headHeight,
            notes: acc,
            table: { pos: nodePos, head: heads, cols, headHeight, width: table.offsetWidth },
          };
        }
        acc = [...acc, ...rowNotes];
        onThis++;
      }
      return null;
    }
    if (child.matches("[data-columns], hr, img, [data-toc]")) return null;
    const lines = linesOf(child).filter((l) => l.top >= pageStart - 0.5);
    if (lines.length < 2) return null;
    let acc: Note[] = [];
    let k = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = notesOf(lines[i].notes);
      if (lines[i].bottom > limit([...acc, ...ln]) + 0.5) {
        k = i;
        break;
      }
      acc = [...acc, ...ln];
    }
    if (k <= 0) return null;
    // Widow and orphan control within the paragraph of the split line.
    const line = lines[k];
    let idx = line.index;
    if (line.count >= 2 && line.count - idx < 2) idx = line.count - 2;
    if (idx === 1) idx = 0;
    k -= line.index - idx;
    if (k <= 0) return null;
    const at = lines[k];
    let p: number | null;
    let dx = contentLeft(at.tb);
    if (idx === 0) {
      p = posBefore(at.tb);
      // Before the textblock or its list item: in their container.
      const li = at.tb.parentElement?.tagName === "LI" && at.tb.parentElement.firstElementChild === at.tb ? at.tb.parentElement : null;
      dx = contentLeft((li ?? at.tb).parentElement);
    } else {
      p = view.posAtCoords({ left: at.x + 1, top: at.y })?.pos ?? null;
      try {
        const start = view.posAtDOM(at.tb, 0);
        const size = doc.resolve(start).parent.content.size;
        if (p == null || p <= start || p >= start + size) p = null;
      } catch {
        p = null;
      }
    }
    if (p == null || p <= nodePos) return null;
    return { pos: p, kind: "inner", dx, used: lines[k - 1].bottom, nextTop: at.top, notes: lines.slice(0, k).flatMap((l) => notesOf(l.notes)) };
  };

  for (const child of Array.from(root.children) as HTMLElement[]) {
    if (child.classList.contains(SPACER) || child.classList.contains(TAIL)) continue;
    if (index >= doc.childCount || child.classList.contains("ProseMirror-trailingBreak")) continue;
    const node = doc.child(index);
    const nodePos = pos;
    pos += node.nodeSize;
    index++;
    const rect = child.getBoundingClientRect();
    const top = logical(rect.top);
    const bottom = logical(rect.bottom);
    const isSection = node.type.name === "sectionBreak";
    const next = isSection ? node.attrs.next : null;
    const end = bottom + (parseFloat(getComputedStyle(child).marginBottom) || 0);
    if (node.type.name === "pageBreak" || (isSection && next !== "continuous" && next !== "nextColumn")) {
      onPage.push({ pos: nodePos, section, top, before: lastEnd, heading: false, split: false });
      lastBottom = bottom;
      lastEnd = end;
      endPage({ pos, kind: "block" }, end);
      if (isSection) section++;
      newPage(section);
      // A section on an even (odd) page: an empty page in between when the
      // next page would be odd (even).
      const nextPage = pages.length;
      if ((next === "evenPage" && nextPage % 2 === 1) || (next === "oddPage" && nextPage % 2 === 0)) {
        endPage({ pos, kind: "block" }, bottom);
        newPage(section);
      }
      pageStart = bottom;
      continue;
    }
    let placed = false;
    for (let guard = 0; guard < 1000; guard++) {
      const rest = notesIn(Math.max(top, pageStart), bottom);
      if (bottom <= limit(rest) + 0.5) break;
      const split = splitBlock(child, nodePos, node.type.name);
      if (split) {
        if (!placed) onPage.push({ pos: nodePos, section, top, before: lastEnd, heading: false, split: true });
        placed = true;
        addNotes(split.notes);
        endPage({ pos: split.pos, kind: split.kind, dx: split.dx, ...(split.table ? { table: split.table } : {}) }, split.used);
        newPage(section);
        onPage.push({ pos: -1, section, top, before: lastEnd, heading: false, split: true });
        pageStart = split.nextTop;
        continue;
      }
      if (!placed && top > pageStart + 0.5) {
        // Keep a heading with the block after it.
        const prev = onPage[onPage.length - 1];
        if (prev?.heading && onPage.length > 1 && prev.top > pageStart + 0.5) {
          onPage.pop();
          const moved = pageNotes.filter((n) => (notes[n.n - 1]?.y ?? 0) >= prev.top);
          pageNotes = pageNotes.filter((n) => (notes[n.n - 1]?.y ?? 0) < prev.top);
          endPage({ pos: prev.pos, kind: "block" }, prev.before);
          newPage(section);
          pageStart = prev.top;
          onPage.push(prev);
          addNotes(moved);
          continue;
        }
        endPage({ pos: nodePos, kind: "block" }, lastEnd);
        newPage(section);
        pageStart = top;
        continue;
      }
      // A block taller than a page that cannot be split overflows.
      pageStart += contentHeight();
      if (bottom - pageStart <= contentHeight()) break;
    }
    if (!placed) onPage.push({ pos: nodePos, section, top, before: lastEnd, heading: HEADING.test(child.tagName), split: false });
    addNotes(notesIn(Math.max(top, pageStart), bottom));
    lastBottom = bottom;
    lastEnd = end;
    // A continuous section break: the blocks after it belong to the next
    // section, on the same page.
    if (isSection) section++;
  }
  const lastRemaining = Math.max(0, limit() - lastBottom);
  const tail = pageNotes.length ? { notes: pageNotes, remaining: lastRemaining } : null;
  finish(lastRemaining);
  probe && (probe as HTMLElement).remove();
  holder?.classList.remove("nx-measuring");
  const lastSpacer = added.filter((a) => a.el.classList.contains(SPACER)).pop();
  const lastSpacerBottom = lastSpacer ? (lastSpacer.bottom - rootRect.top) / zoom : 0;
  return { breaks, pages, places, tail, minHeight: lastSpacerBottom + contentHeight() };
}

const same = (a: Layout, b: Layout) =>
  a.breaks.length === b.breaks.length &&
  a.breaks.every(
    (x, i) => x.pos === b.breaks[i].pos && x.kind === b.breaks[i].kind && Math.abs((x.dx ?? 0) - (b.breaks[i].dx ?? 0)) < 0.5 && Math.abs(x.remaining - b.breaks[i].remaining) < 1 && noteKey(x.notes) === noteKey(b.breaks[i].notes) && (x.table?.head ?? 0) === (b.breaks[i].table?.head ?? 0),
  ) &&
  a.pages.length === b.pages.length &&
  a.pages.every((x, i) => x.section === b.pages[i].section) &&
  a.places.length === b.places.length &&
  a.places.every((x, i) => x.pos === b.places[i].pos && Math.abs(x.left - b.places[i].left) < 0.5 && Math.abs(x.right - b.places[i].right) < 0.5 && Math.abs(x.dy - b.places[i].dy) < 1) &&
  !a.tail === !b.tail &&
  (!a.tail || (Math.abs(a.tail.remaining - b.tail!.remaining) < 1 && noteKey(a.tail.notes) === noteKey(b.tail!.notes)));

export const Pagination = Extension.create<PaginationOptions>({
  name: "pagination",
  addOptions() {
    const frame: PageFrame = { width: 794, height: 1123, marginTop: 96, marginBottom: 96, marginLeft: 96, marginRight: 96, headerDist: 48, footerDist: 48, vAlign: "top" };
    return { frame: () => frame, paperWidth: () => frame.width, gap: 24, renderHeader: () => null, renderFooter: () => null, onLayout: () => {} };
  },
  addProseMirrorPlugins() {
    const o = this.options;
    let viewRef: EditorView | null = null;
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: (_, state) => ({ breaks: [], pages: [{ section: 0 }], places: [], tail: null, version: 0, deco: DecorationSet.create(state.doc, []) }),
          apply(tr, prev) {
            const meta = tr.getMeta(paginationKey) as { layout?: Layout; refresh?: boolean } | undefined;
            if (meta && viewRef) {
              const layout = meta.layout ?? prev;
              const version = prev.version + (meta.refresh ? 1 : 0);
              const next = { breaks: layout.breaks, pages: layout.pages, places: layout.places, tail: layout.tail };
              return { ...next, version, deco: build(o, viewRef, tr.doc, next, version) };
            }
            if (!tr.docChanged) return prev;
            const breaks = prev.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, -1), ...(b.table ? { table: { ...b.table, pos: tr.mapping.map(b.table.pos) } } : {}) }));
            const places = prev.places.map((p) => ({ ...p, pos: tr.mapping.map(p.pos) }));
            return { ...prev, breaks, places, deco: prev.deco.map(tr.mapping, tr.doc) };
          },
        },
        props: { decorations: (state) => paginationKey.getState(state)?.deco },
        view(view) {
          viewRef = view;
          let frame = 0;
          let rounds = 0;
          let last = "";
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(run);
          };
          const run = () => {
            if (!view.dom.isConnected) return;
            const { minHeight, ...layout } = measure(view, o);
            const cur = paginationKey.getState(view.state)!;
            if (!same(layout, cur)) {
              // Guard against oscillation between two layouts.
              if (++rounds > 8) return;
              view.dispatch(view.state.tr.setMeta(paginationKey, { layout }).setMeta("addToHistory", false));
              return;
            }
            rounds = 0;
            const key = `${layout.pages.map((p) => p.section).join(",")}:${Math.round(minHeight)}`;
            if (key !== last) {
              last = key;
              o.onLayout({ pages: layout.pages, minHeight, breaks: layout.breaks });
            }
          };
          const ro = new ResizeObserver(schedule);
          ro.observe(view.dom);
          schedule();
          return {
            update(v, prevState) {
              if (v.state.doc !== prevState.doc || paginationKey.getState(v.state) !== paginationKey.getState(prevState)) {
                if (v.state.doc !== prevState.doc) rounds = 0;
                schedule();
              }
            },
            destroy() {
              cancelAnimationFrame(frame);
              ro.disconnect();
              viewRef = null;
            },
          };
        },
      }),
    ];
  },
});

/** Re-render headers/footers or re-measure after the page setup changed. */
export function refreshPagination(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(paginationKey, { refresh: true }).setMeta("addToHistory", false));
}
