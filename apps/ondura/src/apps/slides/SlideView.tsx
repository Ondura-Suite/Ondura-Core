// Static rendering of a slide at its native size (pixels); callers scale it.

import { createContext, memo, useContext, useEffect, useRef } from "react";
import { type Master, type Para, type Shape, type Slide, type Table, geometryPath, isConnector, isEmptyText, pathPoints, placeholderPrompt, tableCellFill } from "./model";
import { ChartView } from "../chart/ChartView";
import { tl } from "../../lib/i18n";

const PT = 96 / 72;

export function runCss(r: { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; size?: number; color?: string; font?: string }): React.CSSProperties {
  return {
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? "italic" : undefined,
    textDecoration: [r.underline && "underline", r.strike && "line-through"].filter(Boolean).join(" ") || undefined,
    fontSize: `${(r.size ?? 18) * PT}px`,
    color: r.color,
    fontFamily: r.font ? `"${r.font}", "Segoe UI", Calibri, Carlito, sans-serif` : undefined,
  };
}

/** Numbers of auto-numbered paragraphs (restart after other paragraphs). */
function numbering(paras: Para[]) {
  const out: (number | null)[] = [];
  const counters: number[] = [];
  for (const p of paras) {
    const lvl = p.level ?? 0;
    if (p.bullet === "#") {
      counters.length = lvl + 1;
      counters[lvl] = (counters[lvl] ?? 0) + 1;
      out.push(counters[lvl]);
    } else {
      if (!p.bullet) counters.length = 0;
      out.push(null);
    }
  }
  return out;
}

export function ParagraphsView({ paras, prompt }: { paras: Para[]; prompt?: string }) {
  const nums = numbering(paras);
  if (prompt && paras.every((p) => p.runs.every((r) => !r.text))) {
    const p = paras[0];
    return <div style={{ color: "#8a8a99", textAlign: (p?.align as React.CSSProperties["textAlign"]) ?? "left", fontSize: `${(p?.size ?? 24) * PT}px`, lineHeight: 1.2 }}>{prompt}</div>;
  }
  return (
    <>
      {paras.map((p, i) => {
        const first = p.runs[0];
        const size = (first?.size ?? p.size ?? 18) * PT;
        const indent = p.bullet ? 0.375 * 96 + (p.level ?? 0) * 0.5 * 96 : (p.level ?? 0) * 0.5 * 96;
        return (
          <div
            key={i}
            style={{
              textAlign: (p.align as React.CSSProperties["textAlign"]) ?? "left",
              paddingLeft: indent,
              textIndent: p.bullet ? -0.375 * 96 : undefined,
              marginTop: i > 0 && p.bullet ? size * 0.2 : 0,
              lineHeight: 1.2,
              minHeight: size * 1.2,
              fontSize: size,
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
            }}
          >
            {p.bullet && (
              <span style={{ ...runCss(first ?? {}), display: "inline-block", width: 0.375 * 96, textIndent: 0, fontWeight: 400, fontStyle: "normal", textDecoration: "none" }}>
                {p.bullet === "#" ? `${nums[i]}.` : p.bullet}
              </span>
            )}
            {p.runs.map((r, j) => (
              <span key={j} style={runCss(r)}>
                {r.text}
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Table of a slide; `editCell` hides the text of the cell being edited. */
export function TableView({ table: t, w, h, editCell }: { table: Table; w: number; h: number; editCell?: [number, number] | null }) {
  const total = t.cols.reduce((a, b) => a + b, 0) || 1;
  const styled = t.header || t.banded;
  const rowsH = t.rows.reduce((a, r) => a + r.h, 0) || 1;
  return (
    <table style={{ position: "absolute", left: 0, top: 0, width: w, minHeight: h, borderCollapse: "collapse", tableLayout: "fixed", fontFamily: '"Calibri", "Carlito", "Segoe UI", sans-serif' }}>
      <colgroup>
        {t.cols.map((c, i) => (
          <col key={i} style={{ width: (c / total) * w }} />
        ))}
      </colgroup>
      <tbody>
        {t.rows.map((row, ri) => (
          <tr key={ri} style={{ height: (row.h / rowsH) * Math.max(h, rowsH) }}>
            {row.cells.map((cell, ci) => {
              if (cell.merged) return null;
              const fill = tableCellFill(t, ri, cell);
              const head = t.header && ri === 0 && !cell.fill;
              const paras = head ? cell.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, bold: true, color: r.color ?? "#ffffff" })) })) : cell.paragraphs;
              return (
                <td
                  key={ci}
                  colSpan={cell.span}
                  rowSpan={cell.rowSpan}
                  data-cell={`${ri}:${ci}`}
                  style={{
                    background: fill,
                    border: `1px solid ${styled ? "#ffffff" : "#a6a6a6"}`,
                    padding: "4.8px 9.6px",
                    verticalAlign: cell.anchor === "middle" ? "middle" : cell.anchor === "bottom" ? "bottom" : "top",
                    overflow: "hidden",
                    color: "#000",
                  }}
                >
                  <div style={{ visibility: editCell && editCell[0] === ri && editCell[1] === ci ? "hidden" : undefined }}>
                    <ParagraphsView paras={paras} />
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Running animation of a shape in the slide show. */
export interface ShapeAnim {
  cls: "entr" | "emph" | "exit" | "path";
  /** Motion path (fractions of the slide) and where it starts (offset from earlier paths). */
  path?: string;
  start?: [number, number];
  effect: string;
  dir?: string;
  duration: number;
  delay: number;
}

/** CSS animation of a shape's effects (entrance keyframes run backwards for exits). */
function animationStyle(all: ShapeAnim[] | undefined): React.CSSProperties {
  const anims = all?.filter((a) => a.cls !== "path");
  if (!anims?.length) return {};
  const name = (a: ShapeAnim) => (a.cls === "emph" ? `nx-emph-${a.effect}` : `nx-anim-${a.effect === "fly" || a.effect === "wipe" ? `${a.effect}-${a.dir ?? "b"}` : a.effect}`);
  const join = (f: (a: ShapeAnim) => string) => anims.map(f).join(", ");
  return {
    animationName: join(name),
    animationDuration: join((a) => `${a.effect === "appear" ? 1 : a.duration}ms`),
    animationDelay: join((a) => `${a.delay}ms`),
    animationDirection: join((a) => (a.cls === "exit" ? "reverse" : "normal")),
    // Only entrances hold their start state before they begin, so a later
    // exit of the same shape does not show it early.
    animationFillMode: join((a) => (a.cls === "entr" ? "both" : "forwards")),
    animationTimingFunction: join((a) => (a.effect === "fly" ? "cubic-bezier(.2,.8,.2,1)" : a.cls === "emph" ? "ease-in-out" : "ease-out")),
  };
}

/**
 * Media playback in a slide show. The presenter view mutes its players while
 * an audience window is open and reports play/pause/seek, which the audience
 * window applies to its own players.
 */
export interface MediaSync {
  muted?: boolean;
  onEvent?: (shape: number, action: "play" | "pause" | "seek", time: number) => void;
}

export const MediaSyncContext = createContext<MediaSync>({});

/**
 * The presentation around a slide: master (background and shapes), all
 * slides (for slide zooms) and, in the show, what zooms and links do.
 */
export interface PresInfo {
  master?: Master | null;
  slides?: Slide[];
  width?: number;
  height?: number;
  onZoom?: (index: number) => void;
  onLink?: (link: string) => void;
}

export const PresContext = createContext<PresInfo>({});

/** Start geometry of a shape for the Morph transition. */
export interface MorphFrom {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  duration: number;
}

/** Video or audio of a media shape: poster in the editor, player in the show. */
function MediaView({ shape: s, live }: { shape: Shape; live?: boolean }) {
  const sync = useContext(MediaSyncContext);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const report = (action: "play" | "pause" | "seek") => (e: React.SyntheticEvent<HTMLMediaElement>) => sync.onEvent?.(s.id, action, e.currentTarget.currentTime);
  const media = { "data-media": s.id, muted: sync.muted, onPlay: report("play"), onPause: report("pause"), onSeeked: report("seek") };
  if (live && s.mediaKind === "video")
    return <video {...media} src={s.media} poster={s.src} autoPlay={s.autoplay} controls preload="metadata" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "#000", objectFit: "contain" }} onClick={stop} onMouseDown={stop} onPointerDown={stop} onContextMenu={stop} />;
  return (
    <>
      {s.src ? <img src={s.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }} /> : <div style={{ position: "absolute", inset: 0, background: "#222" }} />}
      {live ? (
        <audio {...media} src={s.media} autoPlay={s.autoplay} controls style={{ position: "absolute", left: "50%", top: "100%", transform: "translateX(-50%)", width: Math.max(260, s.w), marginTop: 6 }} onClick={stop} onMouseDown={stop} onPointerDown={stop} onContextMenu={stop} />
      ) : (
        s.mediaKind === "video" && (
        <svg viewBox="0 0 40 40" style={{ position: "absolute", left: "50%", top: "50%", width: Math.min(64, s.w / 2, s.h / 2), height: Math.min(64, s.w / 2, s.h / 2), transform: "translate(-50%, -50%)", opacity: 0.85 }}>
          <circle cx="20" cy="20" r="19" fill="rgba(0,0,0,.55)" />
          <path d="M16 12 L29 20 L16 28 Z" fill="#fff" />
        </svg>
        )
      )}
    </>
  );
}

/**
 * Motion paths run as Web Animations on a wrapper (translate along the
 * sampled path); `offset` is where earlier paths left the shape.
 */
function useMotion(anims: ShapeAnim[] | undefined, offset: [number, number] | undefined, size: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const paths = anims?.filter((a) => a.cls === "path" && a.path) ?? [];
  const key = JSON.stringify([paths.map((a) => [a.path, a.start, a.delay, a.duration]), offset, size.w, size.h]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !paths.length || typeof el.animate !== "function") return;
    const [ox, oy] = offset ?? [0, 0];
    const running = paths.map((a) => {
      const [sx, sy] = a.start ?? [0, 0];
      const frames = pathPoints(a.path!).map(([x, y]) => ({ transform: `translate(${(ox + sx + x) * size.w}px, ${(oy + sy + y) * size.h}px)` }));
      return el.animate(frames, { duration: Math.max(1, a.duration), delay: a.delay, fill: "forwards", easing: "ease-in-out" });
    });
    return () => running.forEach((r) => r.cancel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const base = offset ? `translate(${offset[0] * size.w}px, ${offset[1] * size.h}px)` : undefined;
  return { ref, base };
}

export const ShapeView = memo(function ShapeView({ shape: s, editing, showPrompts, hidden, anim, editCell, live, offset, slideSize, morph }: { shape: Shape; editing?: boolean; showPrompts?: boolean; hidden?: boolean; anim?: ShapeAnim[]; editCell?: [number, number] | null; live?: boolean; offset?: [number, number]; slideSize?: { w: number; h: number }; morph?: MorphFrom | null }) {
  const motion = useMotion(anim, offset, slideSize ?? { w: 1280, h: 720 });
  const pres = useContext(PresContext);
  const boxRef = useRef<HTMLDivElement>(null);
  // Morph: start at the previous slide's geometry and move to this one.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !morph || typeof el.animate !== "function") return;
    const sx = s.w ? morph.w / s.w : 1;
    const sy = s.h ? morph.h / s.h : 1;
    const rot = (morph.rotation - (s.rotation ?? 0)) || 0;
    const a = el.animate(
      [{ transform: `translate(${morph.x - s.x}px, ${morph.y - s.y}px) scale(${sx}, ${sy}) rotate(${rot}deg)` }, { transform: "none" }],
      { duration: morph.duration, easing: "ease-in-out" },
    );
    return () => a.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph]);
  const transform = [s.rotation ? `rotate(${s.rotation}deg)` : "", s.flipH ? "scaleX(-1)" : "", s.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ") || undefined;
  const lw = s.line ? Math.max(0.75, s.lineWidth ?? 0.75) * PT : 0;
  const path = geometryPath(s.kind, s.w, s.h);
  const box: React.CSSProperties = { position: "absolute", left: s.x, top: s.y, width: s.w, height: s.h, transform, boxSizing: "border-box" };
  let bg: React.ReactNode = null;
  if (s.kind === "table" && s.table) {
    bg = <TableView table={s.table} w={s.w} h={s.h} editCell={editCell} />;
  } else if (s.kind === "smartart" && s.smartart) {
    const sa = s.smartart;
    const [sx, sy] = [s.w / (sa.baseW || s.w || 1), s.h / (sa.baseH || s.h || 1)];
    bg = (
      <div style={{ position: "absolute", left: 0, top: 0, width: sa.baseW, height: sa.baseH, transform: `scale(${sx}, ${sy})`, transformOrigin: "0 0" }}>
        {sa.shapes.map((c) => (
          <ShapeView key={c.id} shape={c} />
        ))}
      </div>
    );
  } else if (s.kind === "chart" && s.chart) {
    bg = <ChartView chart={s.chart} width={Math.max(10, s.w)} height={Math.max(10, s.h)} scale={1.5} />;
  } else if (s.kind === "image" && s.media) {
    bg = <MediaView shape={s} live={live} />;
  } else if (s.kind === "image" && s.src) {
    bg = <img src={s.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", border: lw ? `${lw}px solid ${s.line}` : undefined, boxSizing: "border-box" }} />;
  } else if (s.kind === "zoom") {
    const target = s.zoom != null ? pres.slides?.[s.zoom] : undefined;
    const pw = pres.width ?? 1280;
    const ph = pres.height ?? 720;
    bg = (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#fff", border: `${Math.max(1, lw)}px solid ${s.line ?? "#7f7f7f"}`, boxSizing: "border-box" }}>
        {target ? (
          <div style={{ transform: `scale(${s.w / pw}, ${s.h / ph})`, transformOrigin: "0 0", width: pw, height: ph, pointerEvents: "none" }}>
            <SlideView slide={target} width={pw} height={ph} />
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#7f7f7f", fontSize: 18 }}>{tl("Folie")} {(s.zoom ?? 0) + 1}</div>
        )}
      </div>
    );
  } else if (isConnector(s)) {
    const [x1, y1] = [s.flipH ? s.w : 0, s.flipV ? s.h : 0];
    const [x2, y2] = [s.flipH ? 0 : s.w, s.flipV ? 0 : s.h];
    const d = s.kind === "elbowConnector" ? `M${x1} ${y1} H${(x1 + x2) / 2} V${y2} H${x2}` : `M${x1} ${y1} L${x2} ${y2}`;
    const color = s.line ?? "#404040";
    const w = Math.max(1, lw || 1.5 * PT);
    const mid = `nx-arrow-${s.id}`;
    bg = (
      <svg width={Math.max(1, s.w)} height={Math.max(1, s.h)} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 Z" fill={color} />
          </marker>
        </defs>
        <path d={d} fill="none" stroke={color} strokeWidth={w} markerEnd={`url(#${mid})`} />
      </svg>
    );
  } else if (s.kind === "line") {
    bg = (
      <svg width={Math.max(1, s.w)} height={Math.max(1, s.h)} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <line x1={0} y1={0} x2={s.w} y2={s.h} stroke={s.line ?? "#4472c4"} strokeWidth={Math.max(1, lw)} />
      </svg>
    );
  } else if (path) {
    bg = (
      <svg width={s.w} height={s.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <path d={path} fill={s.fill ?? "none"} stroke={s.line ?? "none"} strokeWidth={lw} />
      </svg>
    );
  } else if (s.kind !== "text" || s.fill || s.line) {
    bg = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: s.fill,
          border: lw ? `${lw}px solid ${s.line}` : undefined,
          borderRadius: s.kind === "ellipse" ? "50%" : s.kind === "roundRect" ? Math.min(s.w, s.h) * 0.166 : undefined,
          boxSizing: "border-box",
        }}
      />
    );
  }
  const hasText = s.paragraphs.length > 0 && !["image", "line", "table", "chart", "smartart", "zoom", "connector", "elbowConnector"].includes(s.kind);
  const action = live ? (s.kind === "zoom" && s.zoom != null ? () => pres.onZoom?.(s.zoom!) : s.link ? () => pres.onLink?.(s.link!) : null) : null;
  const prompt = showPrompts && s.placeholder && isEmptyText(s) ? placeholderPrompt(s.placeholder) : undefined;
  const animStyle = animationStyle(anim);
  return (
    <div ref={motion.ref} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transform: motion.base, visibility: hidden ? "hidden" : undefined }}>
    <div
      ref={boxRef}
      style={{ ...box, visibility: hidden ? "hidden" : undefined, cursor: action ? "pointer" : undefined, transformOrigin: morph ? "0 0" : undefined }}
      data-shape={s.id}
      onClick={
        action
          ? (e) => {
              e.stopPropagation();
              action();
            }
          : undefined
      }
    >
      <div style={{ position: "absolute", inset: 0, ...animStyle }}>
      {bg}
      {hasText && !editing && (!isEmptyText(s) || prompt) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: "4.8px 9.6px",
            display: "flex",
            flexDirection: "column",
            justifyContent: s.anchor === "middle" ? "center" : s.anchor === "bottom" ? "flex-end" : "flex-start",
            overflow: "visible",
            fontFamily: '"Calibri", "Carlito", "Segoe UI", sans-serif',
            color: "#000",
            // Text is not mirrored with the shape.
            transform: s.flipH || s.flipV ? `${s.flipH ? "scaleX(-1)" : ""} ${s.flipV ? "scaleY(-1)" : ""}` : undefined,
          }}
        >
          <ParagraphsView paras={s.paragraphs} prompt={prompt} />
        </div>
      )}
      </div>
    </div>
    </div>
  );
});

export function SlideView({
  slide,
  width,
  height,
  editingId,
  showPrompts,
  hiddenShapes,
  anims,
  editCell,
  live,
  offsets,
  morph,
  fade,
  noBackground,
}: {
  slide: Slide;
  width: number;
  height: number;
  editingId?: number | null;
  showPrompts?: boolean;
  /** Shapes not visible at the current build step. */
  hiddenShapes?: Set<number>;
  /** Animations playing now. */
  anims?: Map<number, ShapeAnim[]>;
  /** Slide show: audio and video can be played. */
  live?: boolean;
  /** Where motion paths of earlier steps left shapes (fractions of the slide). */
  offsets?: Map<number, [number, number]>;
  /** Table cell being edited: [shape, row, col]. */
  editCell?: [number, number, number] | null;
  /** Morph transition: start geometry of matched shapes. */
  morph?: Map<number, MorphFrom>;
  /** Morph transition: unmatched shapes fade in over this many ms. */
  fade?: number;
  /** Transparent background (outgoing slide of a Morph). */
  noBackground?: boolean;
}) {
  const pres = useContext(PresContext);
  const master = slide.hideMaster ? null : pres.master;
  const fadeStyle = (id: number): React.CSSProperties | undefined => (fade && !morph?.has(id) ? { animation: `nx-tr-fade ${fade}ms ease-in-out both` } : undefined);
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: noBackground ? "transparent" : (slide.background ?? pres.master?.background ?? "#fff"),
        backgroundImage: slide.backgroundImage && !noBackground ? `url("${slide.backgroundImage}")` : undefined,
        backgroundSize: "100% 100%",
        color: "#000",
      }}
    >
      {!noBackground && master?.shapes.map((s) => (
        <ShapeView key={`m${s.id}`} shape={s} slideSize={{ w: width, h: height }} />
      ))}
      {slide.shapes.map((s) => (
        <div key={s.id} style={fadeStyle(s.id)}>
          <ShapeView shape={s} editing={editingId === s.id} showPrompts={showPrompts} hidden={hiddenShapes?.has(s.id)} anim={anims?.get(s.id)} editCell={editCell && editCell[0] === s.id ? [editCell[1], editCell[2]] : null} live={live} offset={offsets?.get(s.id)} slideSize={{ w: width, h: height }} morph={morph?.get(s.id) ?? null} />
        </div>
      ))}
    </div>
  );
}

/** A slide scaled into a box of the given width. */
export function SlideThumb({ slide, width, presWidth, presHeight }: { slide: Slide; width: number; presWidth: number; presHeight: number }) {
  const scale = width / presWidth;
  return (
    <div style={{ width, height: presHeight * scale, overflow: "hidden", position: "relative" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: presWidth, height: presHeight, pointerEvents: "none" }}>
        <SlideView slide={slide} width={presWidth} height={presHeight} />
      </div>
    </div>
  );
}
