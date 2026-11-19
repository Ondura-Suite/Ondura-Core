// draw.io (diagrams.net) files: Ondura Diagramme saves its diagrams in
// this format and opens draw.io files, compressed or not. Shapes Ondura
// does not know are drawn as rectangles and keep their original style.

import { newEdge, newShape, uid, type Arrow, type Diagram, type Edge, type Page, type Shape, type ShapeKind } from "./model";

const KIND_STYLE: Record<ShapeKind, string> = {
  rect: "rounded=0;whiteSpace=wrap;html=1;",
  roundRect: "rounded=1;whiteSpace=wrap;html=1;",
  ellipse: "ellipse;whiteSpace=wrap;html=1;",
  diamond: "rhombus;whiteSpace=wrap;html=1;",
  triangle: "triangle;whiteSpace=wrap;html=1;direction=north;",
  parallelogram: "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;",
  hexagon: "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;",
  cylinder: "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;",
  cloud: "ellipse;shape=cloud;whiteSpace=wrap;html=1;",
  document: "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;",
  terminator: "rounded=1;whiteSpace=wrap;html=1;arcSize=50;",
  predefined: "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;",
  manualInput: "shape=manualInput;whiteSpace=wrap;html=1;",
  delay: "shape=delay;whiteSpace=wrap;html=1;",
  note: "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=15;align=left;verticalAlign=top;spacingLeft=6;",
  text: "text;html=1;whiteSpace=wrap;",
  container: "swimlane;whiteSpace=wrap;html=1;startSize=28;",
  actor: "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;",
  server: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.servers.fileserver;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  desktop: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.computers_and_peripherals.pc;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  laptop: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.computers_and_peripherals.laptop;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  phone: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.misc.cell_phone;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  router: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.routers.router;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  switch: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.switches.workgroup_switch;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  firewall: "sketch=0;outlineConnect=0;shape=mxgraph.cisco.security.firewall;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  database: "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;verticalLabelPosition=bottom;verticalAlign=top;",
  internet: "ellipse;shape=cloud;whiteSpace=wrap;html=1;",
};

const ARROW_OUT: Record<Arrow, string> = { none: "none", arrow: "classic", open: "open", diamond: "diamond", circle: "oval" };

function parseStyle(style: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of style.split(";")) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) m.set(part, "");
    else m.set(part.slice(0, i), part.slice(i + 1));
  }
  return m;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#xa;");

/** Text of a label: draw.io stores HTML when `html=1`. */
function labelText(value: string, html: boolean): string {
  if (!html || !/[<&]/.test(value)) return value;
  const withBreaks = value.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n");
  const doc = new DOMParser().parseFromString(`<body>${withBreaks}</body>`, "text/html");
  return (doc.body.textContent ?? "").replace(/\n+$/, "");
}

function kindOf(st: Map<string, string>): { kind: ShapeKind; known: boolean } {
  const own = st.get("ondura");
  if (own && own in KIND_STYLE) return { kind: own as ShapeKind, known: true };
  const shape = st.get("shape") ?? "";
  if (st.has("text")) return { kind: "text", known: true };
  if (st.has("swimlane")) return { kind: "container", known: true };
  if (st.has("rhombus") || shape === "rhombus") return { kind: "diamond", known: true };
  if (st.has("triangle") || shape === "triangle") return { kind: "triangle", known: true };
  if (shape === "cloud") return { kind: "cloud", known: true };
  if (st.has("ellipse") || shape === "ellipse") return { kind: "ellipse", known: true };
  const byShape: Record<string, ShapeKind> = {
    parallelogram: "parallelogram",
    hexagon: "hexagon",
    cylinder: "cylinder",
    cylinder3: "cylinder",
    document: "document",
    process: "predefined",
    manualInput: "manualInput",
    delay: "delay",
    note: "note",
    umlActor: "actor",
    "mxgraph.cisco.servers.fileserver": "server",
    "mxgraph.cisco.computers_and_peripherals.pc": "desktop",
    "mxgraph.cisco.computers_and_peripherals.laptop": "laptop",
    "mxgraph.cisco.routers.router": "router",
    "mxgraph.cisco.switches.workgroup_switch": "switch",
    "mxgraph.cisco.security.firewall": "firewall",
  };
  if (byShape[shape]) return { kind: byShape[shape], known: true };
  if (st.get("rounded") === "1") return { kind: st.get("arcSize") === "50" ? "terminator" : "roundRect", known: true };
  return { kind: "rect", known: !shape };
}

const arrowIn = (v: string | undefined, fill: string | undefined, def: Arrow): Arrow => {
  if (v === undefined) return def;
  if (v === "none" || v === "") return "none";
  if (v === "oval") return "circle";
  if (v === "diamond" || v === "diamondThin") return "diamond";
  if (v === "open" || fill === "0") return "open";
  return "arrow";
};

const color = (v: string | undefined, def: string) => (!v || v === "default" ? def : v === "none" ? "none" : v);

/** Decompresses a compressed draw.io page (base64 → raw deflate → URI encoded XML). */
async function inflate(data: string): Promise<string> {
  const bytes = Uint8Array.from(atob(data.trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(stream).text();
  return decodeURIComponent(text);
}

function readModel(model: Element, name: string): Page {
  const page: Page = { id: uid("p"), name, shapes: [], edges: [] };
  const bg = model.getAttribute("background");
  if (bg && bg !== "none") page.background = bg;
  const cells = Array.from(model.querySelectorAll("mxCell"));
  const byId = new Map(cells.map((c) => [c.getAttribute("id") ?? "", c]));
  // Absolute position of a cell (children of groups are relative).
  const offset = (id: string | null, depth = 0): { x: number; y: number } => {
    if (!id || depth > 20) return { x: 0, y: 0 };
    const c = byId.get(id);
    if (!c || c.getAttribute("vertex") !== "1") return { x: 0, y: 0 };
    const g = c.querySelector(":scope > mxGeometry");
    const p = offset(c.getAttribute("parent"), depth + 1);
    return { x: p.x + Number(g?.getAttribute("x") ?? 0), y: p.y + Number(g?.getAttribute("y") ?? 0) };
  };
  for (const c of cells) {
    const style = parseStyle(c.getAttribute("style") ?? "");
    const value = c.getAttribute("value") ?? "";
    const html = style.get("html") === "1";
    const g = c.querySelector(":scope > mxGeometry");
    if (c.getAttribute("vertex") === "1" && g) {
      if (style.has("group") && !value) continue;
      const { kind, known } = kindOf(style);
      const pos = offset(c.getAttribute("parent"));
      const s: Shape = newShape(kind, pos.x + Number(g.getAttribute("x") ?? 0), pos.y + Number(g.getAttribute("y") ?? 0));
      s.id = c.getAttribute("id") || uid("s");
      s.w = Number(g.getAttribute("width") ?? s.w);
      s.h = Number(g.getAttribute("height") ?? s.h);
      s.text = labelText(value, html);
      s.fill = color(style.get("fillColor"), kind === "text" ? "none" : "#ffffff");
      s.stroke = color(style.get("strokeColor"), kind === "text" ? "none" : "#000000");
      s.strokeWidth = Number(style.get("strokeWidth") ?? 1);
      s.dashed = style.get("dashed") === "1";
      s.fontSize = Number(style.get("fontSize") ?? 12);
      s.fontColor = color(style.get("fontColor"), "#000000");
      const fs = Number(style.get("fontStyle") ?? 0);
      s.bold = (fs & 1) === 1;
      s.italic = (fs & 2) === 2;
      const al = style.get("align");
      s.align = al === "left" || al === "right" ? al : "center";
      if (!known) s.extra = c.getAttribute("style") ?? "";
      page.shapes.push(s);
    } else if (c.getAttribute("edge") === "1") {
      const e: Edge = newEdge(c.getAttribute("source") || null, c.getAttribute("target") || null);
      e.id = c.getAttribute("id") || uid("e");
      const es = style.get("edgeStyle");
      e.style = style.get("curved") === "1" ? "curved" : es && es !== "none" ? "orthogonal" : "straight";
      e.stroke = color(style.get("strokeColor"), "#000000");
      e.strokeWidth = Number(style.get("strokeWidth") ?? 1);
      e.dashed = style.get("dashed") === "1";
      e.endArrow = arrowIn(style.get("endArrow"), style.get("endFill"), "arrow");
      e.startArrow = arrowIn(style.get("startArrow"), style.get("startFill"), "none");
      e.text = labelText(value, html);
      e.fontSize = Number(style.get("fontSize") ?? 11);
      if (style.has("exitX")) e.sourcePort = { x: Number(style.get("exitX")), y: Number(style.get("exitY") ?? 0.5) };
      if (style.has("entryX")) e.targetPort = { x: Number(style.get("entryX")), y: Number(style.get("entryY") ?? 0.5) };
      if (g) {
        const off = offset(c.getAttribute("parent"));
        const pt = (el: Element | null) => (el ? { x: off.x + Number(el.getAttribute("x") ?? 0), y: off.y + Number(el.getAttribute("y") ?? 0) } : null);
        e.from = pt(g.querySelector(':scope > mxPoint[as="sourcePoint"]'));
        e.to = pt(g.querySelector(':scope > mxPoint[as="targetPoint"]'));
        e.points = Array.from(g.querySelectorAll(':scope > Array[as="points"] > mxPoint')).map((p) => pt(p)!);
      }
      page.edges.push(e);
    }
  }
  // Labels of edges stored as child cells ("edgeLabel") become the edge text.
  for (const c of cells) {
    const st = parseStyle(c.getAttribute("style") ?? "");
    const parent = c.getAttribute("parent");
    if (st.has("edgeLabel") && parent) {
      const e = page.edges.find((x) => x.id === parent);
      if (e && !e.text) e.text = labelText(c.getAttribute("value") ?? "", st.get("html") === "1");
      page.shapes = page.shapes.filter((s) => s.id !== c.getAttribute("id"));
    }
  }
  return page;
}

/** Reads a draw.io file (also plain mxGraphModel XML). */
export async function parseDrawio(xml: string): Promise<Diagram> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Keine gültige draw.io-Datei");
  const pages: Page[] = [];
  const diagrams = Array.from(doc.querySelectorAll("diagram"));
  if (!diagrams.length) {
    const model = doc.querySelector("mxGraphModel");
    if (!model) throw new Error("Keine gültige draw.io-Datei");
    pages.push(readModel(model, "Seite-1"));
  }
  for (const [i, d] of diagrams.entries()) {
    const name = d.getAttribute("name") || `Seite-${i + 1}`;
    let model = d.querySelector("mxGraphModel");
    if (!model && d.textContent?.trim()) {
      const inner = new DOMParser().parseFromString(await inflate(d.textContent), "text/xml");
      model = inner.querySelector("mxGraphModel");
    }
    if (model) pages.push(readModel(model, name));
  }
  if (!pages.length) throw new Error("Die Datei enthält keine Seiten");
  return { pages };
}

function shapeStyle(s: Shape): string {
  let st = s.extra ?? KIND_STYLE[s.kind];
  // Ondura's own kind survives a round trip through diagrams.net.
  if (!s.extra) st += `ondura=${s.kind};`;
  const strip = (k: string) => (st = st.replace(new RegExp(`(^|;)${k}=[^;]*`, "g"), "$1"));
  ["fillColor", "strokeColor", "strokeWidth", "dashed", "fontSize", "fontColor", "fontStyle", "align"].forEach(strip);
  st = st.replace(/;;+/g, ";");
  if (!st.endsWith(";")) st += ";";
  st += `fillColor=${s.fill};strokeColor=${s.stroke};strokeWidth=${s.strokeWidth};fontSize=${s.fontSize};fontColor=${s.fontColor};`;
  if (s.dashed) st += "dashed=1;";
  const fs = (s.bold ? 1 : 0) | (s.italic ? 2 : 0);
  if (fs) st += `fontStyle=${fs};`;
  if (s.align !== "center") st += `align=${s.align};`;
  return st;
}

function edgeStyle(e: Edge): string {
  let st = e.style === "orthogonal" ? "edgeStyle=orthogonalEdgeStyle;rounded=0;" : e.style === "curved" ? "curved=1;" : "";
  st += `html=1;strokeColor=${e.stroke};strokeWidth=${e.strokeWidth};fontSize=${e.fontSize};`;
  st += `endArrow=${ARROW_OUT[e.endArrow]};${e.endArrow === "open" ? "endFill=0;" : ""}startArrow=${ARROW_OUT[e.startArrow]};${e.startArrow === "open" ? "startFill=0;" : ""}`;
  if (e.dashed) st += "dashed=1;";
  if (e.sourcePort) st += `exitX=${e.sourcePort.x};exitY=${e.sourcePort.y};exitDx=0;exitDy=0;`;
  if (e.targetPort) st += `entryX=${e.targetPort.x};entryY=${e.targetPort.y};entryDx=0;entryDy=0;`;
  return st;
}

/** Writes a diagram as an (uncompressed) draw.io file. */
export function toDrawio(d: Diagram): string {
  const pages = d.pages.map((p) => {
    const cells = [`<mxCell id="0" />`, `<mxCell id="1" parent="0" />`];
    for (const s of p.shapes) {
      cells.push(`<mxCell id="${esc(s.id)}" value="${esc(s.text)}" style="${esc(shapeStyle(s))}" vertex="1" parent="1"><mxGeometry x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" as="geometry" /></mxCell>`);
    }
    for (const e of p.edges) {
      const pts = e.points.length ? `<Array as="points">${e.points.map((q) => `<mxPoint x="${q.x}" y="${q.y}" />`).join("")}</Array>` : "";
      const ends = `${e.from ? `<mxPoint x="${e.from.x}" y="${e.from.y}" as="sourcePoint" />` : ""}${e.to ? `<mxPoint x="${e.to.x}" y="${e.to.y}" as="targetPoint" />` : ""}`;
      const link = `${e.source ? ` source="${esc(e.source)}"` : ""}${e.target ? ` target="${esc(e.target)}"` : ""}`;
      cells.push(`<mxCell id="${esc(e.id)}" value="${esc(e.text)}" style="${esc(edgeStyle(e))}" edge="1" parent="1"${link}><mxGeometry relative="1" as="geometry">${ends}${pts}</mxGeometry></mxCell>`);
    }
    const bg = p.background ? ` background="${esc(p.background)}"` : "";
    return `  <diagram id="${esc(p.id)}" name="${esc(p.name)}">\n    <mxGraphModel dx="1000" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"${bg}>\n      <root>\n        ${cells.join("\n        ")}\n      </root>\n    </mxGraphModel>\n  </diagram>`;
  });
  return `<mxfile host="Ondura" agent="Ondura Diagramme" version="24.0.0">\n${pages.join("\n")}\n</mxfile>\n`;
}
