// Templates of Ondura Diagramme's start page.

import { tl } from "../../lib/i18n";
import { newEdge, newPage, newShape, type Diagram, type Shape, type ShapeKind } from "./model";

const at = (kind: ShapeKind, x: number, y: number, text: string, patch: Partial<Shape> = {}): Shape => ({ ...newShape(kind, x, y, text), ...patch });

function link(d: Diagram, a: Shape, b: Shape, text = "") {
  const e = newEdge(a.id, b.id);
  e.text = text;
  d.pages[0].edges.push(e);
}

export function blankDiagram(): Diagram {
  return { pages: [newPage(tl("Seite-1"))] };
}

export function flowchartTemplate(): Diagram {
  const d = blankDiagram();
  const start = at("terminator", 240, 40, tl("Start"));
  const input = at("parallelogram", 240, 140, tl("Anfrage erhalten"));
  const check = at("diamond", 245, 240, tl("Vollständig?"));
  const fix = at("rect", 460, 250, tl("Rückfrage stellen"), { fill: "#f8cecc", stroke: "#b85450" });
  const work = at("rect", 240, 370, tl("Anfrage bearbeiten"));
  const end = at("terminator", 240, 470, tl("Ende"));
  d.pages[0].shapes.push(start, input, check, fix, work, end);
  link(d, start, input);
  link(d, input, check);
  link(d, check, work, tl("Ja"));
  link(d, check, fix, tl("Nein"));
  const back = newEdge(fix.id, input.id);
  back.sourcePort = { x: 0.5, y: 0 };
  back.targetPort = { x: 1, y: 0.5 };
  d.pages[0].edges.push(back);
  link(d, work, end);
  return d;
}

export function orgTemplate(): Diagram {
  const d = blankDiagram();
  const box = (x: number, y: number, name: string, role: string) => at("roundRect", x, y, `${name}\n${role}`, { w: 150, h: 60, fill: "#e1d5e7", stroke: "#9673a6" });
  const ceo = box(325, 40, tl("Name"), tl("Geschäftsführung"));
  const a = box(110, 170, tl("Name"), tl("Vertrieb"));
  const b = box(325, 170, tl("Name"), tl("Entwicklung"));
  const c = box(540, 170, tl("Name"), tl("Verwaltung"));
  const b1 = box(230, 300, tl("Name"), tl("Team A"));
  const b2 = box(420, 300, tl("Name"), tl("Team B"));
  d.pages[0].shapes.push(ceo, a, b, c, b1, b2);
  for (const [x, y] of [
    [ceo, a],
    [ceo, b],
    [ceo, c],
    [b, b1],
    [b, b2],
  ] as const) {
    const e = newEdge(x.id, y.id);
    e.endArrow = "none";
    e.sourcePort = { x: 0.5, y: 1 };
    e.targetPort = { x: 0.5, y: 0 };
    d.pages[0].edges.push(e);
  }
  return d;
}

export function networkTemplate(): Diagram {
  const d = blankDiagram();
  const net = at("internet", 330, 20, tl("Internet"));
  const fw = at("firewall", 360, 150, tl("Firewall"));
  const router = at("router", 360, 270, tl("Router"));
  const sw = at("switch", 360, 390, tl("Switch"));
  const srv = at("server", 140, 510, tl("Server"));
  const pc = at("desktop", 360, 510, tl("PC"));
  const lap = at("laptop", 580, 510, tl("Laptop"));
  const zone = at("container", 100, 360, tl("Büro-Netz"), { w: 600, h: 260, fill: "none", stroke: "#82b366", dashed: true, fontColor: "#2d7600" });
  d.pages[0].shapes.push(zone, net, fw, router, sw, srv, pc, lap);
  for (const [a, b] of [
    [net, fw],
    [fw, router],
    [router, sw],
    [sw, srv],
    [sw, pc],
    [sw, lap],
  ] as const) {
    const e = newEdge(a.id, b.id);
    e.endArrow = "none";
    d.pages[0].edges.push(e);
  }
  return d;
}

export const TEMPLATES = [
  { id: "blank", label: () => tl("Leeres Diagramm"), make: blankDiagram },
  { id: "flow", label: () => tl("Flussdiagramm"), make: flowchartTemplate },
  { id: "org", label: () => tl("Organigramm"), make: orgTemplate },
  { id: "network", label: () => tl("Netzwerkplan"), make: networkTemplate },
];
