// Drawing of the shapes of Ondura Diagramme (SVG) and the stencil groups
// of the shape panel.

import type { ReactNode } from "react";
import { tl } from "../../lib/i18n";
import { wrapText } from "./geometry";
import { isIcon, type Shape, type ShapeKind } from "./model";

export interface Stencil {
  kind: ShapeKind;
  label: () => string;
  text?: () => string;
}

export const STENCILS: { group: () => string; items: Stencil[] }[] = [
  {
    group: () => tl("Allgemein"),
    items: [
      { kind: "rect", label: () => tl("Rechteck") },
      { kind: "roundRect", label: () => tl("Abgerundet") },
      { kind: "ellipse", label: () => tl("Ellipse") },
      { kind: "diamond", label: () => tl("Raute") },
      { kind: "triangle", label: () => tl("Dreieck") },
      { kind: "hexagon", label: () => tl("Sechseck") },
      { kind: "parallelogram", label: () => tl("Parallelogramm") },
      { kind: "cloud", label: () => tl("Wolke") },
      { kind: "note", label: () => tl("Notiz"), text: () => tl("Notiz") },
      { kind: "text", label: () => tl("Text"), text: () => tl("Text") },
      { kind: "container", label: () => tl("Container"), text: () => tl("Gruppe") },
    ],
  },
  {
    group: () => tl("Flussdiagramm"),
    items: [
      { kind: "terminator", label: () => tl("Start/Ende"), text: () => tl("Start") },
      { kind: "rect", label: () => tl("Prozess"), text: () => tl("Prozess") },
      { kind: "diamond", label: () => tl("Entscheidung"), text: () => tl("Entscheidung?") },
      { kind: "parallelogram", label: () => tl("Daten"), text: () => tl("Daten") },
      { kind: "document", label: () => tl("Dokument"), text: () => tl("Dokument") },
      { kind: "predefined", label: () => tl("Unterprozess"), text: () => tl("Unterprozess") },
      { kind: "manualInput", label: () => tl("Manuelle Eingabe"), text: () => tl("Eingabe") },
      { kind: "delay", label: () => tl("Verzögerung"), text: () => tl("Warten") },
      { kind: "cylinder", label: () => tl("Datenbank"), text: () => tl("Datenbank") },
    ],
  },
  {
    group: () => tl("Netzwerk und IT"),
    items: [
      { kind: "server", label: () => tl("Server"), text: () => tl("Server") },
      { kind: "desktop", label: () => tl("Computer"), text: () => tl("PC") },
      { kind: "laptop", label: () => tl("Laptop"), text: () => tl("Laptop") },
      { kind: "phone", label: () => tl("Smartphone"), text: () => tl("Smartphone") },
      { kind: "router", label: () => tl("Router"), text: () => tl("Router") },
      { kind: "switch", label: () => tl("Switch"), text: () => tl("Switch") },
      { kind: "firewall", label: () => tl("Firewall"), text: () => tl("Firewall") },
      { kind: "database", label: () => tl("Datenbank"), text: () => tl("Datenbank") },
      { kind: "internet", label: () => tl("Internet"), text: () => tl("Internet") },
      { kind: "actor", label: () => tl("Person"), text: () => tl("Person") },
    ],
  },
];

/** Outline path of a shape kind in a w×h box at the origin. */
export function outline(kind: ShapeKind, w: number, h: number): string {
  switch (kind) {
    case "roundRect": {
      const r = Math.min(12, w / 4, h / 4);
      return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`;
    }
    case "terminator": {
      const r = Math.min(h / 2, w / 2);
      return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 ${r},0 Z`;
    }
    case "ellipse":
      return `M0,${h / 2} A${w / 2},${h / 2} 0 1 1 ${w},${h / 2} A${w / 2},${h / 2} 0 1 1 0,${h / 2} Z`;
    case "diamond":
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
    case "triangle":
      return `M${w / 2},0 L${w},${h} L0,${h} Z`;
    case "hexagon": {
      const k = Math.min(w / 4, h / 2);
      return `M${k},0 H${w - k} L${w},${h / 2} L${w - k},${h} H${k} L0,${h / 2} Z`;
    }
    case "parallelogram": {
      const k = Math.min(w / 5, 24);
      return `M${k},0 H${w} L${w - k},${h} H0 Z`;
    }
    case "manualInput":
      return `M0,${h * 0.25} L${w},0 V${h} H0 Z`;
    case "delay":
      return `M0,0 H${w - h / 2} A${h / 2},${h / 2} 0 0 1 ${w - h / 2},${h} H0 Z`;
    case "document": {
      const wave = h * 0.12;
      return `M0,0 H${w} V${h - wave} C${w * 0.75},${h - wave * 3} ${w * 0.5},${h + wave} 0,${h - wave * 1.2} Z`;
    }
    case "note": {
      const f = Math.min(16, w / 5, h / 5);
      return `M0,0 H${w - f} L${w},${f} V${h} H0 Z`;
    }
    case "cloud":
    case "internet":
      return `M${w * 0.25},${h * 0.85} C${w * 0.02},${h * 0.85} ${w * 0.02},${h * 0.45} ${w * 0.22},${h * 0.45} C${w * 0.2},${h * 0.12} ${w * 0.55},${h * 0.05} ${w * 0.6},${h * 0.3} C${w * 0.7},${h * 0.12} ${w * 0.95},${h * 0.2} ${w * 0.86},${h * 0.48} C${w * 1.02},${h * 0.52} ${w * 1.0},${h * 0.85} ${w * 0.78},${h * 0.85} Z`;
    default:
      return `M0,0 H${w} V${h} H0 Z`;
  }
}

/** Extra lines inside some shapes (database lid, subprocess bars, note fold, container header). */
function details(s: Shape, stroke: string): ReactNode {
  const { w, h } = s;
  switch (s.kind) {
    case "predefined":
      return <path d={`M${w * 0.1},0 V${h} M${w * 0.9},0 V${h}`} stroke={stroke} strokeWidth={s.strokeWidth} fill="none" />;
    case "note": {
      const f = Math.min(16, w / 5, h / 5);
      return <path d={`M${w - f},0 V${f} H${w}`} stroke={stroke} strokeWidth={s.strokeWidth} fill="none" />;
    }
    case "container":
      return <path d={`M0,28 H${w}`} stroke={stroke} strokeWidth={s.strokeWidth} />;
    default:
      return null;
  }
}

function cylinder(s: Shape, fill: string, stroke: string) {
  const { w, h } = s;
  const ry = Math.min(h * 0.15, 14);
  return (
    <>
      <path d={`M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z`} fill={fill} stroke={stroke} strokeWidth={s.strokeWidth} strokeDasharray={s.dashed ? "6 4" : undefined} />
      <path d={`M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry}`} fill="none" stroke={stroke} strokeWidth={s.strokeWidth} />
    </>
  );
}

/** Line icons for the IT shapes, drawn in a 48×48 box. */
const ICONS: Partial<Record<ShapeKind, string>> = {
  server: "M10 4h28v12H10zM10 18h28v12H10zM10 32h28v12H10zM15 10h2M15 24h2M15 38h2M30 10h4M30 24h4M30 38h4",
  desktop: "M6 8h36v24H6zM18 40h12M24 32v8",
  laptop: "M10 10h28v20H10zM4 36h40l-3 4H7z",
  phone: "M16 4h16a2 2 0 0 1 2 2v36a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 39h4",
  router: "M6 26h36v12H6zM12 32h2M18 32h2M14 26l-4-12M34 26l4-12M24 26V12M19 17l5-5 5 5",
  switch: "M4 18h40v12H4zM10 24h3M16 24h3M22 24h3M28 24h3M34 24h3",
  firewall: "M6 8h36v32H6zM6 18h36M6 30h36M18 8v10M30 18v12M18 30v10",
  actor: "M24 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM24 16v16M12 22h24M24 32l-9 14M24 32l9 14",
};

/** One shape at its position. */
export function ShapeSvg({ s, selected = false }: { s: Shape; selected?: boolean }) {
  const fill = s.fill === "none" ? "transparent" : s.fill;
  const stroke = s.stroke === "none" ? "transparent" : s.stroke;
  const dash = s.dashed ? `${s.strokeWidth * 4} ${s.strokeWidth * 3}` : undefined;
  let body: ReactNode;
  let textBox = { x: 4, y: 2, w: s.w - 8, h: s.h - 4 };
  if (s.kind === "cylinder" || s.kind === "database") {
    body = cylinder(s, fill, stroke);
    if (isIcon(s.kind)) textBox = { x: -30, y: s.h + 2, w: s.w + 60, h: 40 };
  } else if (ICONS[s.kind]) {
    const k = Math.min(s.w, s.h) / 48;
    body = (
      <>
        <rect width={s.w} height={s.h} fill="transparent" />
        <g transform={`translate(${(s.w - 48 * k) / 2},${(s.h - 48 * k) / 2}) scale(${k})`}>
          <path d={ICONS[s.kind]} fill={s.kind === "actor" ? "none" : fill} stroke={stroke} strokeWidth={Math.max(1.2, s.strokeWidth) / k} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </>
    );
    textBox = { x: -30, y: s.h + 2, w: s.w + 60, h: 40 };
  } else {
    body = (
      <>
        <path d={outline(s.kind, s.w, s.h)} fill={fill} stroke={stroke} strokeWidth={s.strokeWidth} strokeDasharray={dash} />
        {details(s, stroke)}
      </>
    );
    if (s.kind === "internet") textBox = { x: 4, y: 4, w: s.w - 8, h: s.h - 8 };
    if (s.kind === "container") textBox = { x: 8, y: 2, w: s.w - 16, h: 26 };
    if (s.kind === "diamond") textBox = { x: s.w * 0.18, y: s.h * 0.15, w: s.w * 0.64, h: s.h * 0.7 };
  }
  return (
    <g transform={`translate(${s.x},${s.y})`} data-shape={s.id}>
      {body}
      <ShapeText s={s} box={textBox} top={s.kind === "container" || s.kind === "note"} />
      {selected && <rect x={-3} y={-3} width={s.w + 6} height={s.h + 6} fill="none" stroke="#4f52b2" strokeDasharray="4 3" pointerEvents="none" />}
    </g>
  );
}

/** Wrapped, aligned text inside a box (plain SVG text, so exports work everywhere). */
export function ShapeText({ s, box, top = false }: { s: Pick<Shape, "text" | "fontSize" | "fontColor" | "bold" | "italic" | "align">; box: { x: number; y: number; w: number; h: number }; top?: boolean }) {
  if (!s.text) return null;
  const lines = wrapText(s.text, Math.max(10, box.w), s.fontSize, s.bold, s.italic);
  const lh = s.fontSize * 1.25;
  const total = lines.length * lh;
  const y0 = top ? box.y + s.fontSize + 2 : box.y + (box.h - total) / 2 + s.fontSize * 0.95;
  const x = s.align === "left" ? box.x + 4 : s.align === "right" ? box.x + box.w - 4 : box.x + box.w / 2;
  return (
    <text x={x} y={y0} fontSize={s.fontSize} fill={s.fontColor} fontWeight={s.bold ? 700 : 400} fontStyle={s.italic ? "italic" : "normal"} textAnchor={s.align === "left" ? "start" : s.align === "right" ? "end" : "middle"} fontFamily={'"Segoe UI", Inter, Arial, sans-serif'} pointerEvents="none">
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lh}>
          {l || " "}
        </tspan>
      ))}
    </text>
  );
}

/** Small preview of a stencil for the shape panel. */
export function StencilIcon({ kind }: { kind: ShapeKind }) {
  const s: Shape = { id: "", kind, x: 4, y: 6, w: 40, h: 28, text: "", fill: "#eef0fb", stroke: "#4f52b2", strokeWidth: 1.4, dashed: false, fontSize: 10, fontColor: "#000", bold: false, italic: false, align: "center" };
  if (isIcon(kind) && kind !== "internet") Object.assign(s, { x: 8, y: 4, w: 32, h: 32, fill: "#ffffff" });
  if (kind === "text") return <svg width={48} height={40} viewBox="0 0 48 40"><text x={24} y={25} textAnchor="middle" fontSize={14} fill="currentColor">Aa</text></svg>;
  return (
    <svg width={48} height={40} viewBox="0 0 48 40">
      <ShapeSvg s={s} />
    </svg>
  );
}
