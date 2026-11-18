// Presentation model shared with crates/office/src/pptx.rs.

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number;
  color?: string;
  font?: string;
}

export interface Para {
  align?: string;
  level?: number;
  bullet?: string;
  runs: Run[];
  size?: number;
}

export interface Shape {
  id: number;
  kind: string;
  placeholder?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  fill?: string;
  line?: string;
  lineWidth?: number;
  src?: string;
  anchor?: string;
  paragraphs: Para[];
}

export interface Slide {
  background?: string;
  backgroundImage?: string;
  shapes: Shape[];
  notes: string;
  hidden?: boolean;
}

export interface Presentation {
  width: number;
  height: number;
  slides: Slide[];
  title: string;
  author: string;
}

export const nextId = (s: Slide) => Math.max(1, ...s.shapes.map((x) => x.id)) + 1;

export interface DesignTheme {
  id: string;
  name: string;
  background: string;
  title: string;
  text: string;
  accent: string;
  font: string;
  headingFont: string;
}

export const THEMES: DesignTheme[] = [
  { id: "office", name: "Office", background: "#ffffff", title: "#1f1f1f", text: "#262626", accent: "#4472c4", font: "Calibri", headingFont: "Calibri Light" },
  { id: "nexora", name: "Nexora", background: "#f4f4fb", title: "#3b2a9e", text: "#24243a", accent: "#4f54d4", font: "Segoe UI", headingFont: "Segoe UI Semibold" },
  { id: "night", name: "Nacht", background: "#16172b", title: "#ffffff", text: "#d6d7ee", accent: "#8b8ff0", font: "Segoe UI", headingFont: "Segoe UI Light" },
  { id: "forest", name: "Wald", background: "#f2f7f2", title: "#14532d", text: "#1f2b1f", accent: "#16a34a", font: "Georgia", headingFont: "Georgia" },
  { id: "sunset", name: "Abendrot", background: "#fff7ed", title: "#9a3412", text: "#3b2410", accent: "#ea580c", font: "Trebuchet MS", headingFont: "Trebuchet MS" },
  { id: "slate", name: "Schiefer", background: "#2b2f36", title: "#f5c542", text: "#e6e8eb", accent: "#f5c542", font: "Verdana", headingFont: "Verdana" },
];

export type LayoutId = "title" | "titleContent" | "titleOnly" | "twoContent" | "blank";

export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: "title", name: "Titelfolie" },
  { id: "titleContent", name: "Titel und Inhalt" },
  { id: "twoContent", name: "Zwei Inhalte" },
  { id: "titleOnly", name: "Nur Titel" },
  { id: "blank", name: "Leer" },
];

/** A new slide with placeholder-like text boxes. */
export function newSlide(w: number, h: number, layout: LayoutId, theme?: DesignTheme): Slide {
  const t = theme ?? THEMES[0];
  const sx = w / 1280;
  const sy = h / 720;
  const text = (id: number, ph: string, x: number, y: number, ww: number, hh: number, size: number, opts: Partial<Shape> = {}, bullet?: string): Shape => ({
    id,
    kind: "text",
    placeholder: ph,
    x: x * sx,
    y: y * sy,
    w: ww * sx,
    h: hh * sy,
    paragraphs: [{ bullet, align: opts.anchor === "middle" && ph !== "body" ? "center" : undefined, runs: [], size }],
    ...opts,
  });
  const fmt = (s: Shape, font: string, color: string): Shape => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, font, color })) })) });
  const shapes: Shape[] = [];
  switch (layout) {
    case "title":
      shapes.push(fmt(text(2, "ctrTitle", 160, 210, 960, 160, 54, { anchor: "bottom" }), t.headingFont, t.title));
      shapes[0].paragraphs[0].align = "center";
      shapes.push(fmt(text(3, "subTitle", 160, 390, 960, 110, 24, { anchor: "top" }), t.font, t.text));
      shapes[1].paragraphs[0].align = "center";
      break;
    case "titleContent":
      shapes.push(fmt(text(2, "title", 80, 40, 1120, 130, 40, { anchor: "middle" }), t.headingFont, t.title));
      shapes[0].paragraphs[0].align = undefined;
      shapes.push(fmt(text(3, "body", 80, 190, 1120, 460, 28, { anchor: "top" }, "•"), t.font, t.text));
      break;
    case "twoContent":
      shapes.push(fmt(text(2, "title", 80, 40, 1120, 130, 40, { anchor: "middle" }), t.headingFont, t.title));
      shapes[0].paragraphs[0].align = undefined;
      shapes.push(fmt(text(3, "body", 80, 190, 545, 460, 28, { anchor: "top" }, "•"), t.font, t.text));
      shapes.push(fmt(text(4, "body", 655, 190, 545, 460, 28, { anchor: "top" }, "•"), t.font, t.text));
      break;
    case "titleOnly":
      shapes.push(fmt(text(2, "title", 80, 40, 1120, 130, 40, { anchor: "middle" }), t.headingFont, t.title));
      shapes[0].paragraphs[0].align = undefined;
      break;
  }
  return { shapes, notes: "", background: t.background === "#ffffff" ? undefined : t.background };
}

export function emptyPresentation(): Presentation {
  return { width: 1280, height: 720, slides: [newSlide(1280, 720, "title")], title: "", author: "" };
}

/** Prompt text shown in empty placeholders while editing. */
export function placeholderPrompt(ph?: string) {
  switch (ph) {
    case "ctrTitle":
    case "title":
      return "Titel hinzufügen";
    case "subTitle":
      return "Untertitel hinzufügen";
    case "body":
    case "obj":
      return "Text hinzufügen";
    default:
      return "";
  }
}

export const isEmptyText = (s: Shape) => s.paragraphs.every((p) => p.runs.every((r) => !r.text.trim()));

/** SVG path of a preset geometry in a w×h box. */
export function geometryPath(kind: string, w: number, h: number): string | null {
  const p = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${x},${y}`).join("L") + "Z";
  const star = (n: number, inner: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI / n) * i - Math.PI / 2;
      const r = i % 2 ? inner : 1;
      pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]);
    }
    return p(pts);
  };
  const a = Math.min(w, h);
  switch (kind) {
    case "triangle":
      return p([[w / 2, 0], [w, h], [0, h]]);
    case "rtTriangle":
      return p([[0, 0], [w, h], [0, h]]);
    case "diamond":
      return p([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case "pentagon":
      return p([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]);
    case "hexagon":
      return p([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]);
    case "octagon": {
      const c = a * 0.29;
      return p([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]);
    }
    case "parallelogram":
      return p([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]);
    case "trapezoid":
      return p([[w * 0.25, 0], [w * 0.75, 0], [w, h], [0, h]]);
    case "star5":
      return star(5, 0.38);
    case "star6":
      return star(6, 0.58);
    case "rightArrow":
      return p([[0, h * 0.25], [w - h / 2, h * 0.25], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [w - h / 2, h * 0.75], [0, h * 0.75]]);
    case "leftArrow":
      return p([[w, h * 0.25], [h / 2, h * 0.25], [h / 2, 0], [0, h / 2], [h / 2, h], [h / 2, h * 0.75], [w, h * 0.75]]);
    case "upArrow":
      return p([[w * 0.25, h], [w * 0.25, w / 2], [0, w / 2], [w / 2, 0], [w, w / 2], [w * 0.75, w / 2], [w * 0.75, h]]);
    case "downArrow":
      return p([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - w / 2], [w, h - w / 2], [w / 2, h], [0, h - w / 2], [w * 0.25, h - w / 2]]);
    case "leftRightArrow":
      return p([[0, h / 2], [h / 2, 0], [h / 2, h * 0.25], [w - h / 2, h * 0.25], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [w - h / 2, h * 0.75], [h / 2, h * 0.75], [h / 2, h]]);
    case "chevron":
      return p([[0, 0], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [0, h], [h / 2, h / 2]]);
    case "homePlate":
      return p([[0, 0], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [0, h]]);
    case "plus": {
      const t = a / 3;
      return p([[(w - t) / 2, 0], [(w + t) / 2, 0], [(w + t) / 2, (h - t) / 2], [w, (h - t) / 2], [w, (h + t) / 2], [(w + t) / 2, (h + t) / 2], [(w + t) / 2, h], [(w - t) / 2, h], [(w - t) / 2, (h + t) / 2], [0, (h + t) / 2], [0, (h - t) / 2], [(w - t) / 2, (h - t) / 2]]);
    }
    case "heart":
      return `M${w / 2},${h * 0.3}C${w / 2},${h * 0.05} ${w * 0.05},${-h * 0.05} 0,${h * 0.3}C0,${h * 0.6} ${w / 2},${h * 0.8} ${w / 2},${h}C${w / 2},${h * 0.8} ${w},${h * 0.6} ${w},${h * 0.3}C${w * 0.95},${-h * 0.05} ${w / 2},${h * 0.05} ${w / 2},${h * 0.3}Z`;
    case "cloud":
      return `M${w * 0.25},${h * 0.85}C${-w * 0.05},${h * 0.85} ${-w * 0.02},${h * 0.45} ${w * 0.18},${h * 0.45}C${w * 0.12},${h * 0.15} ${w * 0.45},${h * 0.05} ${w * 0.52},${h * 0.25}C${w * 0.62},${h * 0.02} ${w * 0.92},${h * 0.12} ${w * 0.84},${h * 0.42}C${w * 1.05},${h * 0.48} ${w * 1.02},${h * 0.88} ${w * 0.75},${h * 0.85}Z`;
    default:
      return null;
  }
}

export const SHAPE_KINDS: { kind: string; name: string }[] = [
  { kind: "rect", name: "Rechteck" },
  { kind: "roundRect", name: "Abgerundetes Rechteck" },
  { kind: "ellipse", name: "Ellipse" },
  { kind: "triangle", name: "Dreieck" },
  { kind: "rtTriangle", name: "Rechtwinkliges Dreieck" },
  { kind: "diamond", name: "Raute" },
  { kind: "pentagon", name: "Fünfeck" },
  { kind: "hexagon", name: "Sechseck" },
  { kind: "octagon", name: "Achteck" },
  { kind: "parallelogram", name: "Parallelogramm" },
  { kind: "trapezoid", name: "Trapez" },
  { kind: "star5", name: "Stern" },
  { kind: "rightArrow", name: "Pfeil rechts" },
  { kind: "leftArrow", name: "Pfeil links" },
  { kind: "upArrow", name: "Pfeil oben" },
  { kind: "downArrow", name: "Pfeil unten" },
  { kind: "leftRightArrow", name: "Doppelpfeil" },
  { kind: "chevron", name: "Chevron" },
  { kind: "homePlate", name: "Richtungspfeil" },
  { kind: "plus", name: "Plus" },
  { kind: "heart", name: "Herz" },
  { kind: "cloud", name: "Wolke" },
  { kind: "line", name: "Linie" },
];
