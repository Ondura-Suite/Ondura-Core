// Handwriting in Ondura Notizen: drawing areas between the text blocks of a
// page. A drawing keeps its strokes (so they can be erased and extended
// later); OneNote pages receive it as a picture, since Microsoft Graph
// cannot add ink to an existing page.

import { Node, type Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { tl } from "../../lib/i18n";

/** One stroke in drawing coordinates (CSS px of the drawing's width `w`). */
export interface InkStroke {
  /** Colour. */
  c: string;
  /** Pen width. */
  w: number;
  /** Highlighter (drawn underneath, translucent). */
  hl?: boolean;
  /** Points as x0, y0, x1, y1 … */
  p: number[];
}

export interface Drawing {
  /** Coordinate width (width of the area when it was created). */
  w: number;
  h: number;
  s: InkStroke[];
}

export type DrawTool = "pen" | "highlighter" | "eraser";

export interface DrawState {
  /** Active tool; `null` while typing. */
  tool: DrawTool | null;
  color: string;
  width: number;
  highlighterColor: string;
}

/** Pen colours offered in the ribbon. */
export const PEN_COLORS = ["#000000", "#1f4fd8", "#e81224", "#16a34a", "#7719aa", "#f7630c"];
export const HIGHLIGHTER_COLORS = ["#fff100", "#7df9a0", "#7fd4ff", "#ff9de2"];
export const PEN_WIDTHS = [1.5, 3, 6];

const DEFAULT_HEIGHT = 240;
const GROW_MARGIN = 60;

const listeners = new Set<() => void>();
export const drawState: DrawState = { tool: null, color: PEN_COLORS[0], width: PEN_WIDTHS[1], highlighterColor: HIGHLIGHTER_COLORS[0] };

/** Changes the drawing tool or pen; every drawing area follows. */
export function setDrawState(patch: Partial<DrawState>) {
  Object.assign(drawState, patch);
  for (const l of listeners) l();
}

export function onDrawState(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** SVG path of a stroke, smoothed through the midpoints of its points. */
export function strokePath(p: number[]): string {
  if (p.length < 4) return p.length === 2 ? `M${r1(p[0])} ${r1(p[1])}l0 0` : "";
  let d = `M${r1(p[0])} ${r1(p[1])}`;
  if (p.length === 4) return `${d}L${r1(p[2])} ${r1(p[3])}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    d += `Q${r1(p[i])} ${r1(p[i + 1])} ${r1(mx)} ${r1(my)}`;
  }
  return `${d}L${r1(p[p.length - 2])} ${r1(p[p.length - 1])}`;
}

const isBlack = (c: string) => /^#(000|000000)(f|ff)?$/i.test(c);

function strokeSvg(s: InkStroke): string {
  const color = isBlack(s.c) ? "currentColor" : s.c;
  const extra = s.hl ? ' stroke-opacity="0.5" style="mix-blend-mode:multiply"' : "";
  return `<path d="${strokePath(s.p)}" stroke="${color}" stroke-width="${r1(s.w)}"${extra}/>`;
}

/** SVG of a drawing (highlighters first, so they lie underneath). */
export function drawingSvg(d: Drawing): string {
  const ordered = [...d.s.filter((s) => s.hl), ...d.s.filter((s) => !s.hl)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(d.w)} ${r1(d.h)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${ordered.map(strokeSvg).join("")}</svg>`;
}

export function parseDrawing(json: string | null): Drawing {
  try {
    const d = JSON.parse(json ?? "") as Partial<Drawing>;
    const s = Array.isArray(d.s) ? d.s.filter((x): x is InkStroke => !!x && Array.isArray(x.p) && x.p.every((n) => typeof n === "number") && typeof x.c === "string").map((x) => ({ c: /^#[0-9a-f]{3,8}$/i.test(x.c) ? x.c : "#000000", w: Number(x.w) || 3, hl: !!x.hl, p: x.p })) : [];
    return { w: Number(d.w) > 0 ? Number(d.w) : 640, h: Number(d.h) > 0 ? Number(d.h) : DEFAULT_HEIGHT, s };
  } catch {
    return { w: 640, h: DEFAULT_HEIGHT, s: [] };
  }
}

/** Distance from a point to a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the eraser at (x, y) with radius `r` touches a stroke. */
export function hits(s: InkStroke, x: number, y: number, r: number): boolean {
  const reach = r + s.w / 2;
  if (s.p.length === 2) return Math.hypot(s.p[0] - x, s.p[1] - y) <= reach;
  for (let i = 0; i + 3 < s.p.length; i += 2) if (segDist(x, y, s.p[i], s.p[i + 1], s.p[i + 2], s.p[i + 3]) <= reach) return true;
  return false;
}

/** Height a drawing needs so the lowest stroke keeps some room below. */
export function neededHeight(d: Drawing): number {
  let bottom = 0;
  for (const s of d.s) for (let i = 1; i < s.p.length; i += 2) bottom = Math.max(bottom, s.p[i] + s.w);
  return Math.max(d.h, bottom + GROW_MARGIN);
}

/** Renders a drawing to PNG (for OneNote pages). */
export async function drawingPng(d: Drawing, scale = 2): Promise<{ png: Uint8Array; width: number; height: number }> {
  // Crop to the strokes (plus a margin), keep the page width.
  const height = Math.ceil(Math.max(20, neededHeight({ ...d, h: 0 }) - GROW_MARGIN + 12));
  const width = Math.ceil(d.w);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(tl("Die Zeichnung konnte nicht umgewandelt werden"));
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of [...d.s.filter((x) => x.hl), ...d.s.filter((x) => !x.hl)]) {
    ctx.strokeStyle = s.c;
    ctx.globalAlpha = s.hl ? 0.5 : 1;
    ctx.globalCompositeOperation = s.hl ? "multiply" : "source-over";
    ctx.lineWidth = s.w;
    ctx.stroke(new Path2D(strokePath(s.p)));
  }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error(tl("Die Zeichnung konnte nicht umgewandelt werden"));
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** True for the HTML of a drawing block. */
export const isDrawing = (html: string) => /^<div\b[^>]*\sdata-ink=/.test(html);

/** Drawing area of a page; strokes live in the `drawing` attribute. */
export const InkDrawing = Node.create({
  name: "inkDrawing",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { drawing: { default: JSON.stringify({ w: 640, h: DEFAULT_HEIGHT, s: [] }), parseHTML: (el: HTMLElement) => JSON.stringify(parseDrawing(el.getAttribute("data-ink"))), rendered: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-ink]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const dom = document.createElement("div");
    dom.setAttribute("data-ink", node.attrs.drawing as string);
    for (const [k, v] of Object.entries(HTMLAttributes)) if (v != null) dom.setAttribute(k, String(v));
    dom.className = "nx-ink";
    // The picture is kept in the HTML for previews and other programs.
    dom.innerHTML = drawingSvg(parseDrawing(node.attrs.drawing as string));
    return { dom };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => new InkView(node, getPos as () => number | undefined, editor);
  },
});

/** Live drawing area: pointer input with the current tool. */
class InkView {
  dom: HTMLDivElement;
  private node: PMNode;
  private drawing: Drawing;
  private live: SVGPathElement | null = null;
  private current: InkStroke | null = null;
  private erased = false;
  private unsubscribe: () => void;

  constructor(
    node: PMNode,
    private getPos: () => number | undefined,
    private editor: Editor,
  ) {
    this.node = node;
    this.drawing = parseDrawing(node.attrs.drawing as string);
    this.dom = document.createElement("div");
    this.dom.className = "nx-ink";
    this.dom.contentEditable = "false";
    this.dom.setAttribute("role", "img");
    this.dom.setAttribute("aria-label", tl("Zeichnung"));
    this.dom.addEventListener("pointerdown", this.down);
    this.dom.addEventListener("pointermove", this.move);
    this.dom.addEventListener("pointerup", this.up);
    this.dom.addEventListener("pointercancel", this.up);
    this.unsubscribe = onDrawState(() => this.syncTool());
    this.render();
    this.syncTool();
  }

  private syncTool() {
    const t = drawState.tool;
    this.dom.dataset.tool = t ?? "";
    this.dom.classList.toggle("nx-ink-active", !!t && this.editor.isEditable);
  }

  private render() {
    this.dom.innerHTML = drawingSvg(this.drawing);
    this.dom.style.aspectRatio = `${this.drawing.w} / ${this.drawing.h}`;
  }

  /** Pointer position in drawing coordinates. */
  private point(e: PointerEvent): [number, number] {
    const r = this.dom.getBoundingClientRect();
    const k = this.drawing.w / (r.width || this.drawing.w);
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }

  private scale(): number {
    const r = this.dom.getBoundingClientRect();
    return this.drawing.w / (r.width || this.drawing.w);
  }

  private down = (e: PointerEvent) => {
    const tool = drawState.tool;
    if (!tool || !this.editor.isEditable || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    // Keep keyboard focus in the editor (Strg+Z undoes strokes).
    if (!this.editor.view.hasFocus()) this.editor.view.focus();
    this.dom.setPointerCapture(e.pointerId);
    const [x, y] = this.point(e);
    if (tool === "eraser") {
      this.erased = false;
      this.erase(x, y);
      return;
    }
    const hl = tool === "highlighter";
    this.current = { c: hl ? drawState.highlighterColor : drawState.color, w: (hl ? drawState.width * 4 + 8 : drawState.width) * this.scale(), hl, p: [r1(x), r1(y)] };
    const svg = this.dom.querySelector("svg");
    if (svg) {
      svg.insertAdjacentHTML("beforeend", strokeSvg(this.current));
      this.live = svg.lastElementChild as SVGPathElement;
    }
  };

  private move = (e: PointerEvent) => {
    const tool = drawState.tool;
    if (!tool || !this.dom.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    // Coalesced events give smooth strokes with fast pens.
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = this.point(ev);
      if (tool === "eraser") this.erase(x, y);
      else if (this.current) {
        const p = this.current.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 0.8 * this.scale()) continue;
        p.push(r1(x), r1(y));
      }
    }
    if (this.current && this.live) this.live.setAttribute("d", strokePath(this.current.p));
  };

  private up = (e: PointerEvent) => {
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    if (this.current) {
      const stroke = this.current;
      this.current = null;
      this.live = null;
      this.commit({ ...this.drawing, s: [...this.drawing.s, stroke] });
    } else if (this.erased) {
      this.erased = false;
      this.commit(this.drawing);
    }
  };

  private erase(x: number, y: number) {
    const r = 8 * this.scale();
    const kept = this.drawing.s.filter((s) => !hits(s, x, y, r));
    if (kept.length === this.drawing.s.length) return;
    this.drawing = { ...this.drawing, s: kept };
    this.erased = true;
    this.render();
  }

  /** Writes the drawing into the document (one undo step). */
  private commit(d: Drawing) {
    const next = { ...d, h: neededHeight(d) };
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    this.editor.view.dispatch(this.editor.state.tr.setNodeAttribute(pos, "drawing", JSON.stringify(next)));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.drawing = parseDrawing(node.attrs.drawing as string);
    if (!this.current) this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  /** While a tool is active the editor leaves pointer input to the drawing. */
  stopEvent(e: Event): boolean {
    return !!drawState.tool && (e.type.startsWith("pointer") || e.type.startsWith("mouse") || e.type.startsWith("touch") || e.type === "dragstart");
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.unsubscribe();
  }
}

/** Inserts an empty drawing area after the block at the cursor. */
export function insertDrawing(editor: Editor) {
  const width = Math.round(editor.view.dom.clientWidth || 640);
  const { $from } = editor.state.selection;
  const pos = $from.depth > 0 ? $from.after(1) : editor.state.selection.from;
  editor
    .chain()
    .insertContentAt(pos, { type: "inkDrawing", attrs: { drawing: JSON.stringify({ w: width, h: DEFAULT_HEIGHT, s: [] }) } })
    .run();
}

/** Whether the page has a drawing area. */
export function hasDrawing(editor: Editor): boolean {
  let found = false;
  editor.state.doc.forEach((n) => {
    if (n.type.name === "inkDrawing") found = true;
  });
  return found;
}
