// Static rendering of a slide at its native size (pixels); callers scale it.

import { memo } from "react";
import { type Para, type Shape, type Slide, type Table, geometryPath, isEmptyText, placeholderPrompt, tableCellFill } from "./model";
import { ChartView } from "../chart/ChartView";

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

/** Entrance animation of a shape in the slide show. */
export interface ShapeAnim {
  effect: string;
  dir?: string;
  duration: number;
  delay: number;
}

export const ShapeView = memo(function ShapeView({ shape: s, editing, showPrompts, hidden, anim, editCell }: { shape: Shape; editing?: boolean; showPrompts?: boolean; hidden?: boolean; anim?: ShapeAnim; editCell?: [number, number] | null }) {
  const transform = [s.rotation ? `rotate(${s.rotation}deg)` : "", s.flipH ? "scaleX(-1)" : "", s.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ") || undefined;
  const lw = s.line ? Math.max(0.75, s.lineWidth ?? 0.75) * PT : 0;
  const path = geometryPath(s.kind, s.w, s.h);
  const box: React.CSSProperties = { position: "absolute", left: s.x, top: s.y, width: s.w, height: s.h, transform, boxSizing: "border-box" };
  let bg: React.ReactNode = null;
  if (s.kind === "table" && s.table) {
    bg = <TableView table={s.table} w={s.w} h={s.h} editCell={editCell} />;
  } else if (s.kind === "chart" && s.chart) {
    bg = <ChartView chart={s.chart} width={Math.max(10, s.w)} height={Math.max(10, s.h)} scale={1.5} />;
  } else if (s.kind === "image" && s.src) {
    bg = <img src={s.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", border: lw ? `${lw}px solid ${s.line}` : undefined, boxSizing: "border-box" }} />;
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
  const hasText = s.paragraphs.length > 0 && !["image", "line", "table", "chart"].includes(s.kind);
  const prompt = showPrompts && s.placeholder && isEmptyText(s) ? placeholderPrompt(s.placeholder) : undefined;
  const animStyle: React.CSSProperties = anim
    ? {
        animationName: `nx-anim-${anim.effect === "fly" || anim.effect === "wipe" ? `${anim.effect}-${anim.dir ?? "b"}` : anim.effect}`,
        animationDuration: `${anim.effect === "appear" ? 1 : anim.duration}ms`,
        animationDelay: `${anim.delay}ms`,
        animationFillMode: "both",
        animationTimingFunction: anim.effect === "fly" ? "cubic-bezier(.2,.8,.2,1)" : "ease-out",
      }
    : {};
  return (
    <div style={{ ...box, visibility: hidden ? "hidden" : undefined }} data-shape={s.id}>
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
}: {
  slide: Slide;
  width: number;
  height: number;
  editingId?: number | null;
  showPrompts?: boolean;
  /** Shapes whose entrance animation has not played yet. */
  hiddenShapes?: Set<number>;
  /** Animations playing now. */
  anims?: Map<number, ShapeAnim>;
  /** Table cell being edited: [shape, row, col]. */
  editCell?: [number, number, number] | null;
}) {
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: slide.background ?? "#fff",
        backgroundImage: slide.backgroundImage ? `url("${slide.backgroundImage}")` : undefined,
        backgroundSize: "100% 100%",
        color: "#000",
      }}
    >
      {slide.shapes.map((s) => (
        <ShapeView key={s.id} shape={s} editing={editingId === s.id} showPrompts={showPrompts} hidden={hiddenShapes?.has(s.id)} anim={anims?.get(s.id)} editCell={editCell && editCell[0] === s.id ? [editCell[1], editCell[2]] : null} />
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
