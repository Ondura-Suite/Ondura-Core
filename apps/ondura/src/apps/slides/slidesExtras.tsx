// Präsentation: Designer, icons, freehand ink on slides, comments, live
// captions, Presenter Coach and handouts.

import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Dropdown,
  Option,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Checkmark16Regular,
  Delete16Regular,
  Dismiss16Regular,
  Person24Regular,
  People24Regular,
  PeopleTeam24Regular,
  PersonCircle24Regular,
  Building24Regular,
  BuildingFactory24Regular,
  Home24Regular,
  Briefcase24Regular,
  Money24Regular,
  Wallet24Regular,
  Savings24Regular,
  ChartMultiple24Regular,
  DataTrending24Regular,
  DataPie24Regular,
  Target24Regular,
  Trophy24Regular,
  Lightbulb24Regular,
  Rocket24Regular,
  Star24Regular,
  Heart24Regular,
  ThumbLike24Regular,
  Flag24Regular,
  Ribbon24Regular,
  Sparkle24Regular,
  Calendar24Regular,
  Clock24Regular,
  Timer24Regular,
  Hourglass24Regular,
  Alert24Regular,
  Warning24Regular,
  Info24Regular,
  Question24Regular,
  Checkmark24Regular,
  CheckmarkCircle24Regular,
  Dismiss24Regular,
  ErrorCircle24Regular,
  Shield24Regular,
  LockClosed24Regular,
  Key24Regular,
  Fingerprint24Regular,
  Mail24Regular,
  Chat24Regular,
  Phone24Regular,
  Call24Regular,
  Globe24Regular,
  Location24Regular,
  Map24Regular,
  Airplane24Regular,
  VehicleCar24Regular,
  VehicleTruck24Regular,
  Box24Regular,
  Cart24Regular,
  Gift24Regular,
  Tag24Regular,
  Receipt24Regular,
  Document24Regular,
  Folder24Regular,
  Book24Regular,
  HatGraduation24Regular,
  Beaker24Regular,
  Code24Regular,
  Bug24Regular,
  Laptop24Regular,
  Desktop24Regular,
  Server24Regular,
  Cloud24Regular,
  Database24Regular,
  Wifi124Regular,
  Settings24Regular,
  Wrench24Regular,
  Toolbox24Regular,
  Cube24Regular,
  LeafOne24Regular,
  Earth24Regular,
  WeatherSunny24Regular,
  WeatherMoon24Regular,
  Drop24Regular,
  Fire24Regular,
  Food24Regular,
  DrinkCoffee24Regular,
  MusicNote224Regular,
  Camera24Regular,
  Video24Regular,
  Image24Regular,
  PaintBrush24Regular,
  Pen24Regular,
  Megaphone24Regular,
  Handshake24Regular,
  ArrowRight24Regular,
  ArrowUp24Regular,
  ArrowTrending24Regular,
  ArrowSync24Regular,
  ArrowCircleRight24Regular,
  PuzzlePiece24Regular,
  Link24Regular,
  Share24Regular,
} from "@fluentui/react-icons";
import type { DesignTheme, Presentation, Shape, Slide, SlideComment } from "./model";
import { nextId } from "./model";
import { SlideThumb, SlideView } from "./SlideView";
import type { Stroke } from "./ink";
import { tl, LOCALE } from "../../lib/i18n";

const useStyles = makeStyles({
  col: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  pane: { width: "280px", borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", minHeight: 0, backgroundColor: tokens.colorNeutralBackground1 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  list: { overflowY: "auto", flex: 1, padding: "10px", display: "flex", flexDirection: "column", gap: "10px" },
  design: { border: `2px solid transparent`, borderRadius: tokens.borderRadiusMedium, padding: "2px", cursor: "pointer", background: "none", ":hover": { border: `2px solid ${tokens.colorBrandStroke1}` } },
  icons: { display: "grid", gridTemplateColumns: "repeat(8, 52px)", gap: "6px", maxHeight: "50vh", overflowY: "auto" },
  icon: { width: "52px", height: "52px", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground1, cursor: "pointer", fontSize: "32px", color: tokens.colorNeutralForeground1 },
  iconOn: { border: `2px solid ${tokens.colorBrandStroke1}`, background: tokens.colorBrandBackground2 },
  comment: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: "8px", display: "flex", flexDirection: "column", gap: "6px" },
  reply: { marginLeft: "14px", borderLeft: `2px solid ${tokens.colorNeutralStroke2}`, paddingLeft: "8px" },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
});

// ----------------------------------------------------------------- icons --

/** Icon gallery (Fluent icons), grouped loosely by topic. */
type IconComp = React.ComponentType<{ style?: React.CSSProperties }>;
const ICONS: Record<string, IconComp> = {
  Person: Person24Regular,
  People: People24Regular,
  PeopleTeam: PeopleTeam24Regular,
  PersonCircle: PersonCircle24Regular,
  Building: Building24Regular,
  BuildingFactory: BuildingFactory24Regular,
  Home: Home24Regular,
  Briefcase: Briefcase24Regular,
  Money: Money24Regular,
  Wallet: Wallet24Regular,
  Savings: Savings24Regular,
  ChartMultiple: ChartMultiple24Regular,
  DataTrending: DataTrending24Regular,
  DataPie: DataPie24Regular,
  Target: Target24Regular,
  Trophy: Trophy24Regular,
  Lightbulb: Lightbulb24Regular,
  Rocket: Rocket24Regular,
  Star: Star24Regular,
  Heart: Heart24Regular,
  ThumbLike: ThumbLike24Regular,
  Flag: Flag24Regular,
  Ribbon: Ribbon24Regular,
  Sparkle: Sparkle24Regular,
  Calendar: Calendar24Regular,
  Clock: Clock24Regular,
  Timer: Timer24Regular,
  Hourglass: Hourglass24Regular,
  Alert: Alert24Regular,
  Warning: Warning24Regular,
  Info: Info24Regular,
  Question: Question24Regular,
  Checkmark: Checkmark24Regular,
  CheckmarkCircle: CheckmarkCircle24Regular,
  Dismiss: Dismiss24Regular,
  ErrorCircle: ErrorCircle24Regular,
  Shield: Shield24Regular,
  LockClosed: LockClosed24Regular,
  Key: Key24Regular,
  Fingerprint: Fingerprint24Regular,
  Mail: Mail24Regular,
  Chat: Chat24Regular,
  Phone: Phone24Regular,
  Call: Call24Regular,
  Globe: Globe24Regular,
  Location: Location24Regular,
  Map: Map24Regular,
  Airplane: Airplane24Regular,
  VehicleCar: VehicleCar24Regular,
  VehicleTruck: VehicleTruck24Regular,
  Box: Box24Regular,
  Cart: Cart24Regular,
  Gift: Gift24Regular,
  Tag: Tag24Regular,
  Receipt: Receipt24Regular,
  Document: Document24Regular,
  Folder: Folder24Regular,
  Book: Book24Regular,
  HatGraduation: HatGraduation24Regular,
  Beaker: Beaker24Regular,
  Code: Code24Regular,
  Bug: Bug24Regular,
  Laptop: Laptop24Regular,
  Desktop: Desktop24Regular,
  Server: Server24Regular,
  Cloud: Cloud24Regular,
  Database: Database24Regular,
  Wifi1: Wifi124Regular,
  Settings: Settings24Regular,
  Wrench: Wrench24Regular,
  Toolbox: Toolbox24Regular,
  Cube: Cube24Regular,
  LeafOne: LeafOne24Regular,
  Earth: Earth24Regular,
  WeatherSunny: WeatherSunny24Regular,
  WeatherMoon: WeatherMoon24Regular,
  Drop: Drop24Regular,
  Fire: Fire24Regular,
  Food: Food24Regular,
  DrinkCoffee: DrinkCoffee24Regular,
  MusicNote2: MusicNote224Regular,
  Camera: Camera24Regular,
  Video: Video24Regular,
  Image: Image24Regular,
  PaintBrush: PaintBrush24Regular,
  Pen: Pen24Regular,
  Megaphone: Megaphone24Regular,
  Handshake: Handshake24Regular,
  ArrowRight: ArrowRight24Regular,
  ArrowUp: ArrowUp24Regular,
  ArrowTrending: ArrowTrending24Regular,
  ArrowSync: ArrowSync24Regular,
  ArrowCircleRight: ArrowCircleRight24Regular,
  PuzzlePiece: PuzzlePiece24Regular,
  Link: Link24Regular,
  Share: Share24Regular,
};
const ICON_NAMES = Object.keys(ICONS);

const iconOf = (name: string): IconComp | null => ICONS[name] ?? null;

/** An icon as a PNG data URL (rasterised, so every app shows it). */
export async function iconPng(name: string, color: string, size = 256): Promise<string | null> {
  const C = iconOf(name);
  if (!C) return null;
  let svg = renderToStaticMarkup(<C style={{ color }} />);
  svg = svg
    .replace(/fill="currentColor"/g, `fill="${color}"`)
    .replace(/<svg([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height|xmlns|class|style|color)="[^"]*"/g, "")} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  c.getContext("2d")?.drawImage(img, 0, 0, size, size);
  return c.toDataURL("image/png");
}

export function IconsDialog({ open, color, onClose, onInsert }: { open: boolean; color: string; onClose: () => void; onInsert: (names: string[], color: string) => void }) {
  const s = useStyles();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [c, setC] = useState(color);
  useEffect(() => {
    if (open) (setPicked([]), setQ(""), setC(color));
  }, [open, color]);
  const names = useMemo(() => ICON_NAMES.filter((n) => iconOf(n) && n.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{tl("Piktogramme einfügen")}</DialogTitle>
          <DialogContent className={s.col}>
            <div className={s.row}>
              <Input style={{ flex: 1 }} placeholder={tl("Suchen (englisch, z. B. people, money)")} value={q} onChange={(_, d) => setQ(d.value)} />
              <input type="color" value={c} onChange={(e) => setC(e.target.value)} aria-label={tl("Farbe")} />
            </div>
            <div className={s.icons}>
              {names.map((n) => {
                const C = iconOf(n)!;
                return (
                  <button key={n} className={mergeClasses(s.icon, picked.includes(n) && s.iconOn)} title={n} onClick={() => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))}>
                    <C style={{ color: c }} />
                  </button>
                );
              })}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!picked.length} onClick={() => (onInsert(picked, c), onClose())}>
              {picked.length > 1 ? tl("{0} einfügen", picked.length) : tl("Einfügen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// -------------------------------------------------------------- designer --

const isTitle = (s: Shape) => s.placeholder === "title" || s.placeholder === "ctrTitle";
const hasText = (s: Shape) => s.paragraphs.some((p) => p.runs.some((r) => r.text.trim()));

/** Layout ideas for a slide (Designer): its title, text and pictures arranged anew. */
export function designIdeas(slide: Slide, w: number, h: number, theme: DesignTheme): { name: string; slide: Slide }[] {
  const title = slide.shapes.find(isTitle);
  const pics = slide.shapes.filter((s) => s.kind === "image" && !s.media);
  const texts = slide.shapes.filter((s) => s !== title && (s.kind === "text" || s.placeholder) && hasText(s));
  const rest = slide.shapes.filter((s) => s !== title && !pics.includes(s) && !texts.includes(s));
  const body = texts[0];
  if (!title && !body && !pics.length) return [];
  const m = Math.round(w * 0.06);
  const recolor = (s: Shape, color: string): Shape => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, color })) })) });
  const align = (s: Shape, a: string): Shape => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, align: a })) });
  const box = (s: Shape | undefined, x: number, y: number, ww: number, hh: number): Shape[] => (s ? [{ ...s, x: Math.round(x), y: Math.round(y), w: Math.round(ww), h: Math.round(hh), rotation: undefined }] : []);
  const out: { name: string; slide: Slide }[] = [];
  const make = (name: string, shapes: Shape[], extra: Partial<Slide> = {}) => {
    let id = 1;
    const fixed = shapes.map((s) => ({ ...s, id: s.id ?? id++ }));
    const animations = (slide.animations ?? []).filter((a) => fixed.some((s) => s.id === a.shape));
    out.push({ name, slide: { ...slide, ...extra, shapes: [...fixed, ...rest], animations } });
  };
  const deco = (sh: Partial<Shape>): Shape => ({ id: nextId({ ...slide, shapes: [...slide.shapes, ...out.flatMap((o) => o.slide.shapes)] }) + out.length * 10 + Math.floor(Math.random() * 1000), kind: "rect", x: 0, y: 0, w: 0, h: 0, paragraphs: [], ...sh });
  const pic = pics[0];
  if (pic) {
    const ratio = pic.w / Math.max(1, pic.h);
    // Picture on the right half, cropped to the full height.
    const pw = w * 0.45;
    make(tl("Bild rechts"), [...box(pic, w - pw, 0, pw, h), ...box(title, m, m, w - pw - 2 * m, h * 0.22), ...box(body, m, m + h * 0.26, w - pw - 2 * m, h - h * 0.26 - 2 * m)]);
    make(tl("Bild links"), [...box(pic, 0, 0, pw, h), ...box(title, pw + m, m, w - pw - 2 * m, h * 0.22), ...box(body, pw + m, m + h * 0.26, w - pw - 2 * m, h - h * 0.26 - 2 * m)]);
    // Full-bleed picture with a dark band for the text.
    const shade = deco({ x: 0, y: h * 0.55, w, h: h * 0.45, fill: "#000000a6", line: undefined, name: tl("Designer-Fläche") });
    make(tl("Bild als Hintergrund"), [...box(pic, 0, 0, w, h), shade, ...box(title && recolor(title, "#ffffff"), m, h * 0.6, w - 2 * m, h * 0.16), ...box(body && recolor(body, "#ffffff"), m, h * 0.76, w - 2 * m, h * 0.2)]);
    if (ratio < 1.2) make(tl("Bild oben"), [...box(title, m, m * 0.6, w - 2 * m, h * 0.16), ...box(pic, w / 2 - (h * 0.5 * ratio) / 2, h * 0.2, h * 0.5 * ratio, h * 0.5), ...box(body && align(body, "ctr"), m, h * 0.74, w - 2 * m, h * 0.22)]);
    for (const extra of pics.slice(1)) for (const o of out) o.slide.shapes.push(extra);
  }
  // Accent bar on the left, large title.
  const bar = deco({ x: 0, y: 0, w: w * 0.025, h, fill: theme.accent, name: tl("Designer-Akzent") });
  make(tl("Akzentleiste"), [bar, ...box(title, m * 1.4, m, w - 2.4 * m, h * 0.2), ...box(body, m * 1.4, m + h * 0.25, w - 2.4 * m - (pic ? w * 0.3 : 0), h - h * 0.25 - 2 * m), ...(pic ? box(pic, w * 0.68, h * 0.3, w * 0.27, (w * 0.27) / Math.max(0.2, pic.w / Math.max(1, pic.h))) : [])]);
  // Title band in the accent colour.
  const band = deco({ x: 0, y: 0, w, h: h * 0.24, fill: theme.accent, name: tl("Designer-Band") });
  make(tl("Titelband"), [band, ...box(title && recolor(title, "#ffffff"), m, h * 0.04, w - 2 * m, h * 0.16), ...box(body, m, h * 0.3, w - 2 * m - (pic ? w * 0.32 : 0), h * 0.64), ...(pic ? box(pic, w * 0.66, h * 0.32, w * 0.3, (w * 0.3) / Math.max(0.2, pic.w / Math.max(1, pic.h))) : [])]);
  if (!pic && body) {
    // Centred statement.
    make(tl("Zentriert"), [...box(title && align(title, "ctr"), m, h * 0.18, w - 2 * m, h * 0.24), deco({ x: w / 2 - w * 0.05, y: h * 0.45, w: w * 0.1, h: 4, fill: theme.accent, name: tl("Designer-Linie") }), ...box(align(body, "ctr"), m * 2, h * 0.5, w - 4 * m, h * 0.42)]);
    // Two columns for longer lists.
    if (body.paragraphs.length >= 6) {
      const half = Math.ceil(body.paragraphs.length / 2);
      const second: Shape = { ...body, id: (body.id ?? 0) + 5000, paragraphs: body.paragraphs.slice(half), name: undefined, placeholder: undefined };
      make(tl("Zwei Spalten"), [...box(title, m, m, w - 2 * m, h * 0.18), ...box({ ...body, paragraphs: body.paragraphs.slice(0, half) }, m, h * 0.24, (w - 3 * m) / 2, h * 0.7), ...box(second, m * 2 + (w - 3 * m) / 2, h * 0.24, (w - 3 * m) / 2, h * 0.7)]);
    }
  }
  return out;
}

export function DesignerPane({ slide, width, height, theme, onApply, onClose }: { slide: Slide; width: number; height: number; theme: DesignTheme; onApply: (s: Slide) => void; onClose: () => void }) {
  const s = useStyles();
  const ideas = useMemo(() => designIdeas(slide, width, height, theme), [slide, width, height, theme]);
  return (
    <div className={s.pane}>
      <div className={s.head}>
        <Text weight="semibold">{tl("Designer")}</Text>
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      <div className={s.list}>
        {!ideas.length && <Text size={200}>{tl("Fügen Sie einen Titel, Text oder ein Bild hinzu, um Designideen zu erhalten.")}</Text>}
        {ideas.map((d) => (
          <button key={d.name} className={s.design} title={d.name} onClick={() => onApply(d.slide)}>
            <SlideThumb slide={d.slide} width={244} presWidth={width} presHeight={height} />
            <Text size={200} style={{ display: "block", marginTop: 2 }}>{d.name}</Text>
          </button>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- ink --

/** Strokes as a picture cropped to their bounds. */
export function inkShape(strokes: Stroke[], id: number): Shape | null {
  const pts = strokes.flatMap((s) => s.points.map(([x, y]) => [x, y, s.width] as const));
  if (!pts.length) return null;
  const pad = Math.max(...pts.map((p) => p[2])) / 2 + 2;
  const x0 = Math.floor(Math.min(...pts.map((p) => p[0])) - pad);
  const y0 = Math.floor(Math.min(...pts.map((p) => p[1])) - pad);
  const x1 = Math.ceil(Math.max(...pts.map((p) => p[0])) + pad);
  const y1 = Math.ceil(Math.max(...pts.map((p) => p[1])) + pad);
  const c = document.createElement("canvas");
  const scale = 2;
  c.width = Math.max(1, (x1 - x0) * scale);
  c.height = Math.max(1, (y1 - y0) * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  for (const s of strokes) {
    ctx.save();
    ctx.globalAlpha = s.tool === "highlighter" ? 0.4 : 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * scale;
    ctx.lineCap = s.tool === "highlighter" ? "square" : "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo((x - x0) * scale, (y - y0) * scale) : ctx.moveTo((x - x0) * scale, (y - y0) * scale)));
    if (s.points.length === 1) ctx.lineTo((s.points[0][0] - x0) * scale + 0.1, (s.points[0][1] - y0) * scale);
    ctx.stroke();
    ctx.restore();
  }
  return { id, kind: "image", name: tl("Freihand"), x: x0, y: y0, w: x1 - x0, h: y1 - y0, src: c.toDataURL("image/png"), paragraphs: [], alt: tl("Freihandzeichnung") };
}

// ------------------------------------------------------------- comments --

export function SlideCommentsPane({ comments, author, onChange, onClose }: { comments: SlideComment[]; author: string; onChange: (c: SlideComment[]) => void; onClose: () => void }) {
  const s = useStyles();
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<Record<number, string>>({});
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const roots = comments.map((c, i) => [c, i] as const).filter(([c]) => c.parent == null);
  const repliesOf = (i: number) => comments.map((c, j) => [c, j] as const).filter(([c]) => c.parent === i);
  const remove = (i: number) => {
    // Removes the comment and its replies; later indexes shift.
    const gone = new Set([i, ...comments.map((c, j) => (c.parent === i ? j : -1)).filter((j) => j >= 0)]);
    const keep = comments.map((_, j) => j).filter((j) => !gone.has(j));
    onChange(keep.map((j) => ({ ...comments[j], parent: comments[j].parent == null ? null : keep.indexOf(comments[j].parent!) })));
  };
  const entry = (c: SlideComment, i: number) => (
    <div key={i}>
      <div className={s.meta}>
        {c.author || tl("Unbekannt")} · {c.date ? new Date(c.date).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }) : ""}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>
    </div>
  );
  return (
    <div className={s.pane}>
      <div className={s.head}>
        <Text weight="semibold">{tl("Kommentare")}</Text>
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      <div className={s.list}>
        <div className={s.col}>
          <Textarea placeholder={tl("Neuer Kommentar zu dieser Folie…")} value={draft} onChange={(_, d) => setDraft(d.value)} />
          <Button
            appearance="primary"
            disabled={!draft.trim()}
            onClick={() => (onChange([...comments, { author, date: now(), text: draft.trim(), x: 20 + roots.length * 24, y: 20, parent: null }]), setDraft(""))}
          >
            {tl("Kommentar hinzufügen")}
          </Button>
        </div>
        {roots.map(([c, i]) => (
          <div key={i} className={s.comment}>
            <div className={s.row} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              {entry(c, i)}
              <Button size="small" appearance="subtle" icon={<Delete16Regular />} title={tl("Unterhaltung löschen")} onClick={() => remove(i)} />
            </div>
            {repliesOf(i).map(([r, j]) => (
              <div key={j} className={s.reply}>
                {entry(r, j)}
              </div>
            ))}
            <div className={s.row}>
              <Input style={{ flex: 1 }} size="small" placeholder={tl("Antworten…")} value={reply[i] ?? ""} onChange={(_, d) => setReply((x) => ({ ...x, [i]: d.value }))} />
              <Button
                size="small"
                icon={<Checkmark16Regular />}
                disabled={!(reply[i] ?? "").trim()}
                aria-label={tl("Senden")}
                onClick={() => (onChange([...comments, { author, date: now(), text: (reply[i] ?? "").trim(), x: c.x, y: c.y, parent: i }]), setReply((x) => ({ ...x, [i]: "" })))}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------- captions and coach --

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

export const speechSupported = () => typeof window !== "undefined" && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

/** Continuous speech recognition: the interim line and every final phrase. */
export function useSpeech(enabled: boolean, lang: string, onFinal?: (text: string) => void) {
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  useEffect(() => {
    if (!enabled) return;
    const Ctor = ((window as unknown as { SpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition) as (new () => Recognition) | undefined;
    if (!Ctor) {
      setError(tl("Die Spracherkennung ist in dieser Umgebung nicht verfügbar."));
      return;
    }
    let stopped = false;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current?.(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      setLine(interim);
    };
    rec.onerror = (e) => e.error !== "no-speech" && e.error !== "aborted" && setError(tl("Spracherkennung: {0}", e.error));
    // Recognition stops after silence; keep it running.
    rec.onend = () => {
      if (!stopped)
        try {
          rec.start();
        } catch {
          /* already running */
        }
    };
    try {
      rec.start();
    } catch {
      setError(tl("Die Spracherkennung konnte nicht gestartet werden."));
    }
    return () => {
      stopped = true;
      rec.stop();
    };
  }, [enabled, lang]);
  return { line, error };
}

export function Captions({ lines, interim, error }: { lines: string[]; interim: string; error: string | null }) {
  const text = error ?? [...lines.slice(-1), interim].filter(Boolean).join(" ");
  if (!text) return null;
  return (
    <div className="nx-captions" onClick={(e) => e.stopPropagation()}>
      {text}
    </div>
  );
}

const FILLERS = ["äh", "ähm", "öhm", "hm", "halt", "sozusagen", "quasi", "irgendwie", "eigentlich", "um", "uh", "uhm", "like", "basically", "you know", "euh", "bah", "genre"];

export interface CoachReport {
  seconds: number;
  words: number;
  fillers: Record<string, number>;
  /** Slides read out word for word (1-based). */
  readSlides: number[];
  repeated: string[];
}

/** Collects what was said during a coached rehearsal. */
export class Coach {
  private start = Date.now();
  private words: string[] = [];
  private perSlide = new Map<number, string[]>();
  add(text: string, slide: number) {
    const w = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    this.words.push(...w);
    this.perSlide.set(slide, [...(this.perSlide.get(slide) ?? []), ...w]);
  }
  report(slideTexts: string[]): CoachReport {
    const fillers: Record<string, number> = {};
    const joined = ` ${this.words.join(" ")} `;
    for (const f of FILLERS) {
      const n = joined.split(` ${f} `).length - 1;
      if (n) fillers[f] = n;
    }
    // A slide counts as read out when most of its text was spoken in order.
    const readSlides: number[] = [];
    for (const [i, spoken] of this.perSlide) {
      const own = (slideTexts[i] ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
      if (own.length < 12) continue;
      const sp = ` ${spoken.join(" ")} `;
      let hit = 0;
      for (let k = 0; k + 3 <= own.length; k++) if (sp.includes(` ${own.slice(k, k + 3).join(" ")} `)) hit++;
      if (hit / Math.max(1, own.length - 2) > 0.6) readSlides.push(i + 1);
    }
    const counts = new Map<string, number>();
    for (const w of this.words) if (w.length > 5) counts.set(w, (counts.get(w) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n >= 6).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
    return { seconds: (Date.now() - this.start) / 1000, words: this.words.length, fillers, readSlides: readSlides.sort((a, b) => a - b), repeated };
  }
}

export function CoachDialog({ report, onClose }: { report: CoachReport | null; onClose: () => void }) {
  const s = useStyles();
  if (!report) return null;
  const wpm = report.seconds > 5 ? Math.round(report.words / (report.seconds / 60)) : 0;
  const fillers = Object.entries(report.fillers).sort((a, b) => b[1] - a[1]);
  const pace = !report.words ? tl("Es wurde keine Sprache erkannt.") : wpm < 100 ? tl("Etwas langsam – das Publikum könnte abschweifen.") : wpm > 165 ? tl("Ziemlich schnell – planen Sie Pausen ein.") : tl("Gutes Tempo – leicht zu folgen.");
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{tl("Bericht des Referentencoachs")}</DialogTitle>
          <DialogContent className={s.col}>
            <Text>{tl("Dauer: {0} min {1} s · {2} Wörter", Math.floor(report.seconds / 60), Math.round(report.seconds % 60), report.words)}</Text>
            <div>
              <Text weight="semibold">{tl("Tempo: {0} Wörter pro Minute", wpm)}</Text>
              <br />
              <Text size={200}>{pace} {tl("Empfohlen sind 100 bis 165 Wörter pro Minute.")}</Text>
            </div>
            <div>
              <Text weight="semibold">{tl("Füllwörter")}</Text>
              <br />
              <Text size={200}>{fillers.length ? fillers.map(([w, n]) => `„${w}“ ×${n}`).join(", ") : tl("Keine Füllwörter erkannt – sehr gut!")}</Text>
            </div>
            <div>
              <Text weight="semibold">{tl("Vom Blatt gelesen")}</Text>
              <br />
              <Text size={200}>{report.readSlides.length ? tl("Folie {0}: Sie haben den Folientext weitgehend vorgelesen. Erzählen Sie lieber frei.", report.readSlides.join(", ")) : tl("Sie haben frei gesprochen.")}</Text>
            </div>
            {report.repeated.length > 0 && (
              <div>
                <Text weight="semibold">{tl("Häufige Wörter")}</Text>
                <br />
                <Text size={200}>{tl("Variieren Sie: {0}", report.repeated.join(", "))}</Text>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// --------------------------------------------------------------- handouts --

export type PrintLayout = "slides" | "notes" | "outline" | 1 | 2 | 3 | 4 | 6 | 9;

/** Layout choice of the print view (full slides, notes, outline or handouts). */
export function PrintLayoutPicker({ value, onChange }: { value: PrintLayout; onChange: (v: PrintLayout) => void }) {
  const options: [string, string][] = [
    ["slides", tl("Ganzseitige Folien")],
    ["notes", tl("Notizenseiten (Folie mit Notizen)")],
    ["outline", tl("Gliederung")],
    ["1", tl("Handzettel: 1 Folie pro Seite")],
    ["2", tl("Handzettel: 2 Folien pro Seite")],
    ["3", tl("Handzettel: 3 Folien mit Linien für Notizen")],
    ["4", tl("Handzettel: 4 Folien pro Seite")],
    ["6", tl("Handzettel: 6 Folien pro Seite")],
    ["9", tl("Handzettel: 9 Folien pro Seite")],
  ];
  const v = String(value);
  return (
    <Field label={tl("Drucklayout")}>
      <Dropdown value={options.find((o) => o[0] === v)?.[1] ?? ""} selectedOptions={[v]} onOptionSelect={(_, d) => d.optionValue && onChange((/^\d$/.test(d.optionValue) ? Number(d.optionValue) : d.optionValue) as PrintLayout)}>
        {options.map(([k, label]) => (
          <Option key={k} value={k}>
            {label}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}

const plainText = (sl: Slide) => sl.shapes.filter((x) => !isTitle(x)).flatMap((x) => x.paragraphs.map((p) => p.runs.map((r) => r.text).join(""))).filter((t) => t.trim());
export const slideTitle = (sl: Slide) => sl.shapes.find(isTitle)?.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim() ?? "";

/** Pages of a handout or notes printout (A4 portrait, CSS pixels at 96 dpi). */
export function PrintPages({ pres, layout }: { pres: Presentation; layout: PrintLayout }) {
  const slides = pres.slides.map((sl, i) => [sl, i] as const).filter(([sl]) => !sl.hidden);
  const pageW = 794;
  const pageH = 1123;
  const pad = 48;
  const slideAt = (sl: Slide, width: number) => (
    <div style={{ border: "1px solid #999", width, height: (width * pres.height) / pres.width, overflow: "hidden" }}>
      <div style={{ transform: `scale(${width / pres.width})`, transformOrigin: "0 0", width: pres.width, height: pres.height }}>
        <SlideView slide={sl} width={pres.width} height={pres.height} />
      </div>
    </div>
  );
  const page = (key: string | number, children: React.ReactNode, n: number) => (
    <div key={key} className="nx-print-page-a4" style={{ width: pageW, height: pageH, padding: pad, boxSizing: "border-box", position: "relative", fontFamily: "Calibri, Carlito, sans-serif", color: "#000" }}>
      {children}
      <div style={{ position: "absolute", bottom: 24, right: pad, fontSize: 11, color: "#555" }}>{n}</div>
    </div>
  );
  if (layout === "outline") {
    return page(
      "outline",
      <div style={{ fontSize: 14 }}>
        <h2 style={{ marginTop: 0 }}>{pres.title || tl("Präsentation")}</h2>
        {slides.map(([sl, i]) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <b>{i + 1}. {slideTitle(sl) || tl("Folie {0}", i + 1)}</b>
            <ul style={{ margin: "2px 0 0 0" }}>
              {plainText(sl).map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>,
      1,
    );
  }
  if (layout === "notes") {
    return (
      <>
        {slides.map(([sl, i], k) =>
          page(
            i,
            <>
              {slideAt(sl, pageW - 2 * pad)}
              <div style={{ marginTop: 24, fontSize: 14, whiteSpace: "pre-wrap" }}>{sl.notes}</div>
            </>,
            k + 1,
          ),
        )}
      </>
    );
  }
  const per = layout === "slides" ? 1 : layout;
  const groups: (typeof slides)[] = [];
  for (let i = 0; i < slides.length; i += per) groups.push(slides.slice(i, i + per));
  const cols = per >= 4 ? (per === 9 ? 3 : 2) : 1;
  const usableW = pageW - 2 * pad;
  const w = per === 3 ? usableW * 0.48 : cols === 1 ? (per === 2 ? usableW * 0.72 : usableW) : (usableW - (cols - 1) * 16) / cols;
  return (
    <>
      {groups.map((g, gi) =>
        page(
          gi,
          per === 3 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {g.map(([sl, i]) => (
                <div key={i} style={{ display: "flex", gap: 20 }}>
                  {slideAt(sl, w)}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly" }}>
                    {Array.from({ length: 6 }, (_, k) => (
                      <div key={k} style={{ borderBottom: "1px solid #aaa", height: 1 }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${w}px)`, gap: 16, justifyContent: "center", alignContent: per === 1 ? "center" : "start", height: "100%" }}>
              {g.map(([sl, i]) => (
                <div key={i}>{slideAt(sl, w)}</div>
              ))}
            </div>
          ),
          gi + 1,
        ),
      )}
    </>
  );
}
