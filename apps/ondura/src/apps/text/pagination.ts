// Page view: the document flows over A4 (or other) pages. After
// every layout the top-level blocks are measured; a block that would cross
// the bottom margin is pushed to the next page by a widget decoration that
// draws the rest of the page, its footer, the gap between the sheets and
// the next page's header. Blocks taller than a page are not split.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface PageGeometry {
  /** All in CSS pixels. */
  contentHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  gap: number;
}

export interface PageBreakInfo {
  pos: number;
  /** Unused space at the bottom of the page. */
  remaining: number;
}

export interface PaginationOptions {
  geometry: () => PageGeometry;
  /** Header/footer content for a page (1-based), as DOM. */
  renderHeader: (page: number, pages: number) => HTMLElement | null;
  renderFooter: (page: number, pages: number) => HTMLElement | null;
  /** Reports page count and the editor height needed to fill the last page. */
  onLayout: (layout: { pages: number; minHeight: number; breaks: PageBreakInfo[] }) => void;
}

interface PaginationState {
  breaks: PageBreakInfo[];
  version: number;
  deco: DecorationSet;
}

export const paginationKey = new PluginKey<PaginationState>("onduraPagination");

function spacer(o: PaginationOptions, page: number, pages: number, remaining: number) {
  const g = o.geometry();
  const el = document.createElement("div");
  el.className = "nx-page-spacer";
  el.contentEditable = "false";
  el.style.height = `${remaining + g.marginBottom + g.gap + g.marginTop}px`;
  const fill = document.createElement("div");
  fill.style.height = `${remaining}px`;
  const footer = document.createElement("div");
  footer.className = "nx-hf nx-hf-footer";
  footer.style.height = `${g.marginBottom}px`;
  const f = o.renderFooter(page, pages);
  if (f) footer.appendChild(f);
  const gap = document.createElement("div");
  gap.className = "nx-page-gap";
  gap.style.height = `${g.gap}px`;
  const header = document.createElement("div");
  header.className = "nx-hf nx-hf-header";
  header.style.height = `${g.marginTop}px`;
  const h = o.renderHeader(page + 1, pages);
  if (h) header.appendChild(h);
  el.append(fill, footer, gap, header);
  return el;
}

function build(o: PaginationOptions, doc: import("@tiptap/pm/model").Node, breaks: PageBreakInfo[], version: number) {
  const pages = breaks.length + 1;
  return DecorationSet.create(
    doc,
    breaks.map((b, i) =>
      Decoration.widget(b.pos, () => spacer(o, i + 1, pages, b.remaining), {
        side: -1,
        key: `pb-${version}-${i}-${pages}-${Math.round(b.remaining)}`,
        ignoreSelection: true,
      }),
    ),
  );
}

function measure(view: EditorView, o: PaginationOptions): { breaks: PageBreakInfo[]; minHeight: number } {
  const g = o.geometry();
  const root = view.dom as HTMLElement;
  const doc = view.state.doc;
  const breaks: PageBreakInfo[] = [];
  let spacers = 0;
  let pageStart = 0;
  let index = 0;
  let pos = 0;
  let lastSpacerBottom = 0;
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
    if (node.type.name === "pageBreak" || node.type.name === "sectionBreak") {
      breaks.push({ pos: pos, remaining: Math.max(0, pageStart + g.contentHeight - bottom) });
      pageStart = bottom;
      continue;
    }
    if (bottom - pageStart > g.contentHeight + 0.5 && top > pageStart + 0.5) {
      breaks.push({ pos: nodePos, remaining: Math.max(0, pageStart + g.contentHeight - top) });
      pageStart = top;
    }
    // A block taller than a page overflows into "virtual" pages.
    while (bottom - pageStart > g.contentHeight + 0.5 && top <= pageStart + 0.5 && bottom - top > g.contentHeight) {
      pageStart += g.contentHeight;
      if (bottom - pageStart <= g.contentHeight) break;
    }
  }
  return { breaks, minHeight: lastSpacerBottom + g.contentHeight };
}

const same = (a: PageBreakInfo[], b: PageBreakInfo[]) => a.length === b.length && a.every((x, i) => x.pos === b[i].pos && Math.abs(x.remaining - b[i].remaining) < 1);

export const Pagination = Extension.create<PaginationOptions>({
  name: "pagination",
  addOptions() {
    return {
      geometry: () => ({ contentHeight: 1000, marginTop: 96, marginBottom: 96, marginLeft: 96, marginRight: 96, gap: 24 }),
      renderHeader: () => null,
      renderFooter: () => null,
      onLayout: () => {},
    };
  },
  addProseMirrorPlugins() {
    const o = this.options;
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: (_, state) => ({ breaks: [], version: 0, deco: DecorationSet.create(state.doc, []) }),
          apply(tr, prev) {
            const meta = tr.getMeta(paginationKey) as { breaks?: PageBreakInfo[]; refresh?: boolean } | undefined;
            if (meta) {
              const breaks = meta.breaks ?? prev.breaks;
              const version = prev.version + (meta.refresh ? 1 : 0);
              return { breaks, version, deco: build(o, tr.doc, breaks, version) };
            }
            if (!tr.docChanged) return prev;
            const breaks = prev.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, -1) }));
            return { breaks, version: prev.version, deco: prev.deco.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.deco,
        },
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
            const { breaks, minHeight } = measure(view, o);
            const cur = paginationKey.getState(view.state)!;
            if (!same(breaks, cur.breaks)) {
              // Guard against oscillation between two layouts.
              if (++rounds > 8) return;
              view.dispatch(view.state.tr.setMeta(paginationKey, { breaks }).setMeta("addToHistory", false));
              return;
            }
            rounds = 0;
            const key = `${breaks.length}:${Math.round(minHeight)}`;
            if (key !== last) {
              last = key;
              o.onLayout({ pages: breaks.length + 1, minHeight, breaks });
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
