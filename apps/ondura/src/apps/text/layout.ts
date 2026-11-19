// Layout features of Ondura Text: columns, drop caps, formulas and shapes.

import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { ShapeKind } from "./model";
import { latexToMathml, latexToOmml } from "./math";
import { tl } from "../../lib/i18n";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    onduraLayout: {
      setColumns: (count: number) => ReturnType;
      setDropCap: (lines: number | null) => ReturnType;
      insertMath: (latex: string, display?: boolean) => ReturnType;
      insertShape: (attrs: Partial<ShapeAttrs>) => ReturnType;
    };
  }
}

export interface ShapeAttrs {
  kind: ShapeKind;
  widthMm: number;
  heightMm: number;
  fill: string | null;
  line: string | null;
  text: string;
  wrap: "inline" | "left" | "right";
}

/** Text in columns; a block of its own, like a continuous section in Word. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      count: { default: 2, parseHTML: (el) => Number(el.getAttribute("data-count")) || 2 },
      gap: { default: 12.5, parseHTML: (el) => Number(el.getAttribute("data-gap")) || 12.5 },
    };
  },
  parseHTML: () => [{ tag: "div[data-columns]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-columns": "",
      "data-count": node.attrs.count,
      "data-gap": node.attrs.gap,
      class: "nx-columns",
      style: `column-count:${node.attrs.count};column-gap:${node.attrs.gap}mm`,
    }),
    0,
  ],
  addCommands() {
    return {
      setColumns:
        (count) =>
        ({ state, tr, dispatch }) => {
          const { $from, $to } = state.selection;
          // Inside columns: change the count or remove them.
          for (let d = $from.depth; d > 0; d--) {
            const n = $from.node(d);
            if (n.type.name !== "columns") continue;
            const pos = $from.before(d);
            if (dispatch) {
              if (count <= 1) tr.replaceWith(pos, pos + n.nodeSize, n.content);
              else tr.setNodeMarkup(pos, undefined, { ...n.attrs, count });
            }
            return true;
          }
          if (count <= 1) return false;
          // Wrap the selected top-level blocks.
          const from = $from.before(1);
          const to = $to.after(1);
          const slice = state.doc.slice(from, to);
          const node = state.schema.nodes.columns.create({ count, gap: 12.5 }, slice.content);
          if (dispatch) tr.replaceWith(from, to, node);
          return true;
        },
    };
  },
});

/** Drop cap ("Initiale") on paragraphs. */
export const DropCap = Extension.create({
  name: "dropCap",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          dropCap: {
            default: null,
            parseHTML: (el) => Number(el.getAttribute("data-dropcap")) || null,
            renderHTML: (a) => (a.dropCap ? { "data-dropcap": a.dropCap, style: `--nx-dropcap:${a.dropCap}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setDropCap:
        (lines) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { dropCap: lines && lines > 1 ? lines : null }),
    };
  },
});

/** Formula, shown with MathML; double-click edits it. */
export const MathNode = Node.create({
  name: "math",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: "" },
      omml: { default: "" },
      display: { default: false },
    };
  },
  parseHTML: () => [{ tag: "span[data-math]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-latex") ?? "" }) }],
  renderHTML: ({ node }) => ["span", { "data-math": "", "data-latex": node.attrs.latex }, node.attrs.latex],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = node.attrs.display ? "nx-math nx-math-display" : "nx-math";
      dom.contentEditable = "false";
      dom.title = tl("Doppelklicken zum Bearbeiten");
      dom.innerHTML = latexToMathml(node.attrs.latex || "?", node.attrs.display);
      dom.addEventListener("dblclick", () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) editor.view.dom.dispatchEvent(new CustomEvent("ondura-edit-math", { bubbles: true, detail: { pos, latex: node.attrs.latex, display: node.attrs.display } }));
      });
      return { dom };
    };
  },
  addCommands() {
    return {
      insertMath:
        (latex, display = false) =>
        ({ state, tr, dispatch }) => {
          const node = state.schema.nodes.math.create({ latex, omml: latexToOmml(latex), display });
          if (dispatch) {
            const sel = state.selection;
            if (sel instanceof NodeSelection && sel.node.type.name === "math") tr.replaceWith(sel.from, sel.to, node);
            else tr.replaceSelectionWith(node);
          }
          return true;
        },
    };
  },
});

const SHAPE_SVG: Partial<Record<ShapeKind, string>> = {
  triangle: '<polygon points="50,2 98,98 2,98"/>',
  rightArrow: '<polygon points="2,30 62,30 62,5 98,50 62,95 62,70 2,70"/>',
  star5: '<polygon points="50,3 61,38 98,38 68,60 79,96 50,74 21,96 32,60 2,38 39,38"/>',
  line: '<line x1="0" y1="50" x2="100" y2="50"/>',
};

/** Shapes and text boxes. */
export const ShapeNode = Node.create({
  name: "shape",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: "rect" },
      widthMm: { default: 40 },
      heightMm: { default: 25 },
      fill: { default: "#dae3f3" },
      line: { default: "#2f5597" },
      text: { default: "" },
      wrap: { default: "inline" },
    };
  },
  parseHTML: () => [{ tag: "span[data-shape]" }],
  renderHTML: ({ node }) => ["span", { "data-shape": node.attrs.kind }, node.attrs.text],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const a = node.attrs as ShapeAttrs;
      const dom = document.createElement("span");
      dom.contentEditable = "false";
      dom.className = `nx-shape nx-shape-${a.wrap}`;
      dom.style.width = `${a.widthMm}mm`;
      dom.style.height = `${a.heightMm}mm`;
      const svg = SHAPE_SVG[a.kind];
      if (svg) {
        dom.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style="position:absolute;inset:0;overflow:visible"><g fill="${a.fill ?? "none"}" stroke="${a.line ?? "none"}" stroke-width="1.5" vector-effect="non-scaling-stroke">${svg}</g></svg>`;
      } else {
        dom.style.background = a.fill ?? "transparent";
        dom.style.border = a.line ? `1px solid ${a.line}` : "none";
        dom.style.borderRadius = a.kind === "ellipse" ? "50%" : a.kind === "roundRect" ? "12%" : "0";
      }
      if (a.text) {
        const t = document.createElement("span");
        t.className = a.kind === "textBox" ? "nx-shape-text nx-shape-textbox" : "nx-shape-text";
        t.textContent = a.text;
        dom.appendChild(t);
      }
      dom.addEventListener("dblclick", () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) editor.view.dom.dispatchEvent(new CustomEvent("ondura-edit-shape", { bubbles: true, detail: { pos, attrs: a } }));
      });
      return { dom };
    };
  },
  addCommands() {
    return {
      insertShape:
        (attrs) =>
        ({ state, tr, dispatch }) => {
          const node = state.schema.nodes.shape.create(attrs);
          if (dispatch) {
            const sel = state.selection;
            if (sel instanceof NodeSelection && sel.node.type.name === "shape") tr.replaceWith(sel.from, sel.to, node);
            else tr.replaceSelectionWith(node);
          }
          return true;
        },
    };
  },
});
