// Pen, highlighter, eraser and laser pointer for the slide show. Strokes
// are kept per slide in slide coordinates and can be kept as a picture.

import { useEffect, useRef, useState } from "react";

export type InkTool = "none" | "laser" | "pen" | "highlighter" | "eraser";

export interface Stroke {
  tool: "pen" | "highlighter";
  color: string;
  /** Line width in slide pixels. */
  width: number;
  points: [number, number][];
}

export const INK_COLORS = ["#e81123", "#0078d4", "#107c10", "#ffb900", "#000000", "#ffffff"];

function draw(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.save();
    ctx.globalAlpha = s.tool === "highlighter" ? 0.4 : 1;
    ctx.globalCompositeOperation = s.tool === "highlighter" ? "multiply" : "source-over";
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * scale;
    ctx.lineCap = s.tool === "highlighter" ? "square" : "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] * scale + 0.1, s.points[0][1] * scale);
    ctx.stroke();
    ctx.restore();
  }
}

/** Distance of a point to a stroke (slide pixels). */
function near(s: Stroke, x: number, y: number, r: number) {
  return s.points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= (r + s.width) ** 2);
}

/** Drawing surface over a slide shown at `scale`. */
export function InkLayer({ width, height, scale, tool, color, strokes, onChange }: { width: number; height: number; scale: number; tool: InkTool; color: string; strokes: Stroke[]; onChange: (s: Stroke[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<Stroke | null>(null);
  const [laser, setLaser] = useState<[number, number] | null>(null);
  const dpr = window.devicePixelRatio || 1;
  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (c) draw(c, current.current ? [...strokes, current.current] : strokes, scale * dpr);
  }, [strokes, scale, dpr]);
  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };
  const active = tool !== "none";
  return (
    <>
      <canvas
        ref={canvas}
        className="nx-ink"
        width={Math.round(width * scale * dpr)}
        height={Math.round(height * scale * dpr)}
        style={{ width: width * scale, height: height * scale, pointerEvents: active ? "auto" : "none", cursor: tool === "laser" ? "none" : tool === "eraser" ? "cell" : active ? "crosshair" : undefined }}
        onClick={(e) => active && e.stopPropagation()}
        onContextMenu={(e) => active && (e.preventDefault(), e.stopPropagation())}
        onPointerDown={(e) => {
          if (!active || e.button !== 0) return;
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = at(e);
          if (tool === "pen" || tool === "highlighter") current.current = { tool, color, width: tool === "pen" ? 3 : 18, points: [p] };
          if (tool === "eraser") onChange(strokes.filter((s) => !near(s, p[0], p[1], 8)));
        }}
        onPointerMove={(e) => {
          const p = at(e);
          if (tool === "laser") setLaser(p);
          if (!(e.buttons & 1)) return;
          if (tool === "eraser") {
            const left = strokes.filter((s) => !near(s, p[0], p[1], 8));
            if (left.length !== strokes.length) onChange(left);
          } else if (current.current) {
            current.current.points.push(p);
            const c = canvas.current?.getContext("2d");
            if (c) draw(c, [...strokes, current.current], scale * dpr);
          }
        }}
        onPointerUp={() => {
          if (current.current) onChange([...strokes, current.current]);
          current.current = null;
        }}
        onPointerLeave={() => setLaser(null)}
      />
      {tool === "laser" && laser && <div className="nx-laser" style={{ left: laser[0] * scale, top: laser[1] * scale }} />}
    </>
  );
}

/** Strokes of a slide as a transparent PNG of the slide size. */
export function inkPicture(strokes: Stroke[], width: number, height: number): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx, strokes, 1);
  return c.toDataURL("image/png");
}
