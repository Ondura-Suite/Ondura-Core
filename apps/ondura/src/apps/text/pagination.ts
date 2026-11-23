// Page view: the document flows over A4 (or other) pages. After
// every layout the top-level blocks are measured; a block that would cross
// the bottom margin is pushed to the next page by a widget decoration that
// draws the rest of the page, its footer, the gap between the sheets and
// the next page's header. Blocks taller than a page are not split.
//
// Every page has its own frame (size and margins from the page setup of its
// section, mirrored on even pages with facing pages). The editor spans the
// widest page; node decorations place each block in the text area of its
// page (`--nx-l` / `--nx-r`, see text.css) and move it down for vertical
// alignment (a transform, which does not change the layout that is measured).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { PageFrame } from "./pageFrames";

export interface PageBreakInfo {
  pos: number;
  /** Unused space at the bottom of the page. */
  remaining: number;
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
}

interface PaginationState extends Layout {
  version: number;
  deco: DecorationSet;
}

export const paginationKey = new PluginKey<PaginationState>("onduraPagination");

/** Left edge of a page on the paper strip (pages are centred). */
const pageX = (o: PaginationOptions, f: PageFrame) => (o.paperWidth() - f.width) / 2;

function spacer(o: PaginationOptions, page: number, info: Layout, remaining: number) {
  const pages = info.pages.length;
  const here = o.frame(page, info.pages[page - 1]?.section ?? 0);
  const next = o.frame(page + 1, info.pages[page]?.section ?? info.pages[page - 1]?.section ?? 0);
  const w = o.paperWidth();
  const el = document.createElement("div");
  el.className = "nx-page-spacer";
  el.contentEditable = "false";
  el.style.height = `${remaining + here.marginBottom + o.gap + next.marginTop}px`;
  const fill = document.createElement("div");
  fill.style.height = `${remaining}px`;
  const footer = document.createElement("div");
  footer.className = "nx-hf nx-hf-footer";
  footer.style.height = `${here.marginBottom}px`;
  const hx = pageX(o, here);
  footer.style.padding = `0 ${w - hx - here.width + here.marginRight}px 0 ${hx + here.marginLeft}px`;
  const f = o.renderFooter(page, pages, here, pagePlace(info.pages, page));
  if (f) footer.appendChild(f);
  const gap = document.createElement("div");
  gap.className = "nx-page-gap";
  gap.style.height = `${o.gap}px`;
  const header = document.createElement("div");
  header.className = "nx-hf nx-hf-header";
  header.style.height = `${next.marginTop}px`;
  const nx = pageX(o, next);
  header.style.padding = `0 ${w - nx - next.width + next.marginRight}px 0 ${nx + next.marginLeft}px`;
  const h = o.renderHeader(page + 1, pages, next, pagePlace(info.pages, page + 1));
  if (h) header.appendChild(h);
  el.append(fill, footer, gap, header);
  return el;
}

function build(o: PaginationOptions, doc: import("@tiptap/pm/model").Node, info: Layout, version: number) {
  const pages = info.pages.length;
  const widgets = info.breaks.map((b, i) => Decoration.widget(b.pos, () => spacer(o, i + 1, info, b.remaining), { side: -1, key: `pb-${version}-${i}-${pages}-${Math.round(b.remaining)}`, ignoreSelection: true }));
  const nodes = info.places.flatMap((p) => {
    const node = doc.nodeAt(p.pos);
    if (!node) return [];
    const style = `--nx-l:${p.left.toFixed(1)}px;--nx-r:${p.right.toFixed(1)}px${p.dy ? `;transform:translateY(${p.dy.toFixed(1)}px)` : ""}`;
    return [Decoration.node(p.pos, p.pos + node.nodeSize, { style })];
  });
  return DecorationSet.create(doc, [...widgets, ...nodes]);
}

function measure(view: EditorView, o: PaginationOptions): Layout & { minHeight: number } {
  const root = view.dom as HTMLElement;
  const doc = view.state.doc;
  const W = o.paperWidth();
  const breaks: PageBreakInfo[] = [];
  const pages: PageInfo[] = [{ section: 0 }];
  // Blocks of the current page: position, section, top and bottom.
  let onPage: { pos: number; section: number }[] = [];
  const places: BlockPlace[] = [];
  let section = 0;
  let spacers = 0;
  let pageStart = 0;
  let lastBottom = 0;
  let index = 0;
  let pos = 0;
  let lastSpacerBottom = 0;
  const frame = () => o.frame(pages.length, pages[pages.length - 1].section);
  const contentHeight = () => {
    const f = frame();
    return f.height - f.marginTop - f.marginBottom;
  };
  /** Places the blocks of the finished page; `remaining` is its free space. */
  const finish = (remaining: number) => {
    const n = pages.length;
    const pf = frame();
    const x = (W - pf.width) / 2;
    const free = Math.max(0, remaining);
    const shift = pf.vAlign === "center" ? free / 2 : pf.vAlign === "bottom" ? free : 0;
    const step = pf.vAlign === "both" && onPage.length > 1 ? free / (onPage.length - 1) : 0;
    onPage.forEach((b, i) => {
      const bf = b.section === pages[n - 1].section ? pf : o.frame(n, b.section);
      places.push({ pos: b.pos, left: x + bf.marginLeft, right: W - x - pf.width + bf.marginRight, dy: shift + step * i });
    });
    onPage = [];
  };
  const newPage = (s: number) => pages.push({ section: s });
  for (const child of Array.from(root.children) as HTMLElement[]) {
    if (child.classList.contains("nx-page-spacer")) {
      spacers += child.offsetHeight;
      lastSpacerBottom = child.offsetTop + child.offsetHeight;
      continue;
    }
    if (index >= doc.childCount || child.classList.contains("ProseMirror-trailingBreak")) continue;
    const node = doc.child(index);
    const nodePos = pos;
    pos += node.nodeSize;
    index++;
    const top = child.offsetTop - spacers;
    const bottom = top + child.offsetHeight;
    const isSection = node.type.name === "sectionBreak";
    const next = isSection ? node.attrs.next : null;
    if (node.type.name === "pageBreak" || (isSection && next !== "continuous" && next !== "nextColumn")) {
      onPage.push({ pos: nodePos, section });
      lastBottom = bottom;
      const remaining = pageStart + contentHeight() - bottom;
      breaks.push({ pos, remaining: Math.max(0, remaining) });
      finish(remaining);
      if (isSection) section++;
      newPage(section);
      // A section on an even (odd) page: an empty page in between when the
      // next page would be odd (even).
      const nextPage = pages.length;
      if ((next === "evenPage" && nextPage % 2 === 1) || (next === "oddPage" && nextPage % 2 === 0)) {
        breaks.push({ pos, remaining: contentHeight() });
        newPage(section);
      }
      pageStart = bottom;
      continue;
    }
    if (bottom - pageStart > contentHeight() + 0.5 && top > pageStart + 0.5) {
      const remaining = pageStart + contentHeight() - lastBottom;
      breaks.push({ pos: nodePos, remaining: Math.max(0, pageStart + contentHeight() - top) });
      finish(remaining);
      newPage(section);
      pageStart = top;
    }
    onPage.push({ pos: nodePos, section });
    lastBottom = bottom;
    // A continuous section break: the blocks after it belong to the next
    // section, on the same page.
    if (isSection) section++;
    // A block taller than a page overflows into "virtual" pages.
    while (bottom - pageStart > contentHeight() + 0.5 && top <= pageStart + 0.5 && bottom - top > contentHeight()) {
      pageStart += contentHeight();
      if (bottom - pageStart <= contentHeight()) break;
    }
  }
  finish(pageStart + contentHeight() - lastBottom);
  return { breaks, pages, places, minHeight: lastSpacerBottom + contentHeight() };
}

const same = (a: Layout, b: Layout) =>
  a.breaks.length === b.breaks.length &&
  a.breaks.every((x, i) => x.pos === b.breaks[i].pos && Math.abs(x.remaining - b.breaks[i].remaining) < 1) &&
  a.pages.length === b.pages.length &&
  a.pages.every((x, i) => x.section === b.pages[i].section) &&
  a.places.length === b.places.length &&
  a.places.every((x, i) => x.pos === b.places[i].pos && Math.abs(x.left - b.places[i].left) < 0.5 && Math.abs(x.right - b.places[i].right) < 0.5 && Math.abs(x.dy - b.places[i].dy) < 1);

export const Pagination = Extension.create<PaginationOptions>({
  name: "pagination",
  addOptions() {
    const frame: PageFrame = { width: 794, height: 1123, marginTop: 96, marginBottom: 96, marginLeft: 96, marginRight: 96, headerDist: 48, footerDist: 48, vAlign: "top" };
    return { frame: () => frame, paperWidth: () => frame.width, gap: 24, renderHeader: () => null, renderFooter: () => null, onLayout: () => {} };
  },
  addProseMirrorPlugins() {
    const o = this.options;
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: (_, state) => ({ breaks: [], pages: [{ section: 0 }], places: [], version: 0, deco: DecorationSet.create(state.doc, []) }),
          apply(tr, prev) {
            const meta = tr.getMeta(paginationKey) as { layout?: Layout; refresh?: boolean } | undefined;
            if (meta) {
              const layout = meta.layout ?? prev;
              const version = prev.version + (meta.refresh ? 1 : 0);
              const next = { breaks: layout.breaks, pages: layout.pages, places: layout.places };
              return { ...next, version, deco: build(o, tr.doc, next, version) };
            }
            if (!tr.docChanged) return prev;
            const breaks = prev.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, -1) }));
            const places = prev.places.map((p) => ({ ...p, pos: tr.mapping.map(p.pos) }));
            return { ...prev, breaks, places, deco: prev.deco.map(tr.mapping, tr.doc) };
          },
        },
        props: { decorations: (state) => paginationKey.getState(state)?.deco },
        view(view) {
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
