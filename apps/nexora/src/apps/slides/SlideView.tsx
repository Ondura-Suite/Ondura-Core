// Static rendering of a slide at its native size (pixels); callers scale it.

import { memo } from "react";
import { type Para, type Shape, type Slide, geometryPath, isEmptyText, placeholderPrompt } from "./model";

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

export const ShapeView = memo(function ShapeView({ shape: s, editing, showPrompts }: { shape: Shape; editing?: boolean; showPrompts?: boolean }) {
  const transform = [s.rotation ? `rotate(${s.rotation}deg)` : "", s.flipH ? "scaleX(-1)" : "", s.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ") || undefined;
  const lw = s.line ? Math.max(0.75, s.lineWidth ?? 0.75) * PT : 0;
  const path = geometryPath(s.kind, s.w, s.h);
  const box: React.CSSProperties = { position: "absolute", left: s.x, top: s.y, width: s.w, height: s.h, transform, boxSizing: "border-box" };
  let bg: React.ReactNode = null;
  if (s.kind === "image" && s.src) {
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
  const hasText = s.paragraphs.length > 0 && s.kind !== "image" && s.kind !== "line";
  const prompt = showPrompts && s.placeholder && isEmptyText(s) ? placeholderPrompt(s.placeholder) : undefined;
  return (
    <div style={box} data-shape={s.id}>
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
  );
});

export function SlideView({ slide, width, height, editingId, showPrompts }: { slide: Slide; width: number; height: number; editingId?: number | null; showPrompts?: boolean }) {
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
        <ShapeView key={s.id} shape={s} editing={editingId === s.id} showPrompts={showPrompts} />
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
