// Model of Ondura Diagramme: pages with shapes and connectors. Saved as
// draw.io files (drawio.ts), so diagrams open in diagrams.net as well.

export type ShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "parallelogram"
  | "hexagon"
  | "cylinder"
  | "cloud"
  | "document"
  | "terminator"
  | "predefined"
  | "manualInput"
  | "delay"
  | "note"
  | "text"
  | "container"
  | "actor"
  | "server"
  | "desktop"
  | "laptop"
  | "router"
  | "switch"
  | "firewall"
  | "phone"
  | "database"
  | "internet";

export type Align = "left" | "center" | "right";
export type Arrow = "none" | "arrow" | "open" | "diamond" | "circle";
export type EdgeStyle = "orthogonal" | "straight" | "curved";

export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  align: Align;
  /** Style keys of an imported draw.io shape Ondura does not know (kept on save). */
  extra?: string;
}

/** A connection point relative to a shape (0…1 on both axes). */
export interface Port {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Edge {
  id: string;
  source?: string | null;
  target?: string | null;
  sourcePort?: Port | null;
  targetPort?: Port | null;
  /** Free ends (not attached to a shape). */
  from?: Point | null;
  to?: Point | null;
  /** Fixed bends (imported or dragged). */
  points: Point[];
  style: EdgeStyle;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  startArrow: Arrow;
  endArrow: Arrow;
  text: string;
  fontSize: number;
}

export interface Page {
  id: string;
  name: string;
  shapes: Shape[];
  edges: Edge[];
  background?: string | null;
}

export interface Diagram {
  pages: Page[];
}

let seq = 0;
export const uid = (p = "c") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const DEFAULT_FILL = "#ffffff";
export const DEFAULT_STROKE = "#4f52b2";

/** Default size and look of new shapes. */
export function newShape(kind: ShapeKind, x: number, y: number, text = ""): Shape {
  const base: Shape = { id: uid("s"), kind, x, y, w: 120, h: 60, text, fill: "#dae8fc", stroke: "#6c8ebf", strokeWidth: 1.5, dashed: false, fontSize: 13, fontColor: "#1f1f1f", bold: false, italic: false, align: "center" };
  switch (kind) {
    case "ellipse":
      return { ...base, w: 100, h: 70 };
    case "diamond":
      return { ...base, w: 110, h: 80, fill: "#fff2cc", stroke: "#d6b656" };
    case "terminator":
      return { ...base, h: 50, fill: "#d5e8d4", stroke: "#82b366" };
    case "triangle":
    case "hexagon":
      return { ...base, w: 100, h: 80 };
    case "cylinder":
    case "database":
      return { ...base, w: 80, h: 90, fill: "#f5f5f5", stroke: "#666666" };
    case "cloud":
    case "internet":
      return { ...base, w: 130, h: 80, fill: "#ffffff", stroke: "#6c8ebf" };
    case "note":
      return { ...base, w: 140, h: 100, fill: "#fff2cc", stroke: "#d6b656", align: "left" };
    case "text":
      return { ...base, w: 140, h: 40, fill: "none", stroke: "none", strokeWidth: 0 };
    case "container":
      return { ...base, w: 320, h: 220, fill: "#ffffff", stroke: "#4f52b2", bold: true };
    case "actor":
      return { ...base, w: 40, h: 80, fill: "#ffffff", stroke: "#333333" };
    case "server":
    case "desktop":
    case "laptop":
    case "router":
    case "switch":
    case "firewall":
    case "phone":
      return { ...base, w: 70, h: 70, fill: "#ffffff", stroke: "#4f52b2" };
    default:
      return base;
  }
}

export function newEdge(source: string | null, target: string | null): Edge {
  return { id: uid("e"), source, target, points: [], style: "orthogonal", stroke: "#333333", strokeWidth: 1.5, dashed: false, startArrow: "none", endArrow: "arrow", text: "", fontSize: 12 };
}

export function newPage(name: string): Page {
  return { id: uid("p"), name, shapes: [], edges: [] };
}

/** Icon shapes put their label under the picture. */
export const ICON_KINDS: ShapeKind[] = ["actor", "server", "desktop", "laptop", "router", "switch", "firewall", "phone", "database", "internet"];
export const isIcon = (k: ShapeKind) => ICON_KINDS.includes(k);

/** Bounding box of shapes and edges of a page. */
export function pageBounds(page: Page): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of page.shapes) {
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + s.w);
    y1 = Math.max(y1, s.y + s.h + (isIcon(s.kind) && s.text ? s.fontSize * 2.4 : 0));
  }
  for (const e of page.edges) for (const p of [...e.points, e.from, e.to]) if (p) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
  if (!isFinite(x0)) return { x: 0, y: 0, w: 800, h: 600 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
