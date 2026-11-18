// Editable SmartArt: a list of text items with levels, drawn by a layout.
// The drawn shapes are cached in the model (so files show them in other
// apps); editing the items or the layout draws them again.

import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Option, Textarea } from "@fluentui/react-components";
import type { Para, Shape, SmartArt, SmartArtLayout, SmartItem } from "./model";
import { tl } from "../../lib/i18n";

export const SMARTART_LAYOUTS: { id: SmartArtLayout; label: string }[] = [
  { id: "process", label: tl("Prozess") },
  { id: "list", label: tl("Liste") },
  { id: "cycle", label: tl("Zyklus") },
  { id: "hierarchy", label: tl("Hierarchie") },
  { id: "pyramid", label: tl("Pyramide") },
];

const SAMPLE: Record<SmartArtLayout, SmartItem[]> = {
  process: [{ text: tl("Planen") }, { text: tl("Umsetzen") }, { text: tl("Prüfen") }, { text: tl("Verbessern") }],
  list: [{ text: tl("Ziel") }, { text: tl("Erstes Teilziel"), level: 1 }, { text: tl("Maßnahmen") }, { text: tl("Schulung"), level: 1 }, { text: tl("Werkzeuge"), level: 1 }, { text: tl("Ergebnis") }],
  cycle: [{ text: tl("Planen") }, { text: tl("Umsetzen") }, { text: tl("Prüfen") }, { text: tl("Handeln") }],
  hierarchy: [{ text: tl("Leitung") }, { text: tl("Vertrieb"), level: 1 }, { text: tl("Nord"), level: 2 }, { text: tl("Süd"), level: 2 }, { text: tl("Technik"), level: 1 }, { text: tl("Entwicklung"), level: 2 }],
  pyramid: [{ text: tl("Vision") }, { text: tl("Strategie") }, { text: tl("Taktik") }, { text: tl("Betrieb") }],
};

/** A new SmartArt graphic with sample items. */
export function sampleSmartArt(layout: SmartArtLayout, w: number, h: number, color: string): SmartArt {
  return drawSmartArt({ layout, items: SAMPLE[layout], color, baseW: w, baseH: h, shapes: [] }, w, h);
}

function tint(hex: string, f: number) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * f));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Text paragraphs for a box: the item, then its children as smaller lines. */
function paras(lines: string[], size: number, color: string, align: string, head: boolean): Para[] {
  return lines.map((t, i) => {
    const sz = head && i ? Math.max(8, Math.round(size * 0.75)) : size;
    return { align, runs: t ? [{ text: t, size: sz, color, bold: head && i === 0 && lines.length > 1 }] : [], size: sz };
  });
}

/** Font size (pt) that fits `lines` into a box of w×h px. */
function fit(lines: string[], w: number, h: number) {
  const longest = Math.max(4, ...lines.map((l) => l.length));
  const byW = ((w - 28) / (longest * 0.62)) * 0.75;
  const byH = (h - 10) / (lines.length * 1.25) * 0.75;
  return Math.max(8, Math.min(28, Math.floor(Math.min(byW, byH))));
}

/** Tree of the items (level = depth). */
interface Node {
  text: string;
  kids: Node[];
}
function tree(items: SmartItem[]): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const it of items) {
    const n: Node = { text: it.text, kids: [] };
    const lv = Math.min(it.level ?? 0, stack.length);
    stack.length = lv;
    (lv ? stack[lv - 1].kids : roots).push(n);
    stack.push(n);
  }
  return roots;
}
const flat = (n: Node): string[] => n.kids.flatMap((k) => [k.text, ...flat(k)]);

/** Draws the shapes of a SmartArt graphic for a size of w×h px. */
export function drawSmartArt(sa: SmartArt, w: number, h: number): SmartArt {
  const color = sa.color ?? "#4472c4";
  const roots = tree(sa.items);
  const out: Shape[] = [];
  const box = (kind: string, x: number, y: number, bw: number, bh: number, lines: string[], fill = color, text = "#ffffff", align = "center") => {
    out.push({ id: out.length + 1, kind, x: r1(x), y: r1(y), w: r1(bw), h: r1(bh), fill, anchor: "middle", paragraphs: paras(lines, fit(lines, bw, bh), text, align, align === "center") });
  };
  const deco = (kind: string, x: number, y: number, bw: number, bh: number, fill?: string, line?: string) =>
    out.push({ id: out.length + 1, kind, x: r1(x), y: r1(y), w: r1(bw), h: r1(bh), fill, line, lineWidth: line ? 1.5 : undefined, paragraphs: [] });
  const n = Math.max(1, roots.length);
  switch (sa.layout) {
    case "process": {
      const arrow = Math.min(48, w / n / 4);
      const bw = (w - arrow * (n - 1) * 1.6) / n;
      const bh = Math.min(h, bw * 0.75);
      roots.forEach((r, i) => {
        const x = i * (bw + arrow * 1.6);
        box("roundRect", x, (h - bh) / 2, bw, bh, [r.text, ...flat(r)]);
        if (i < n - 1) deco("rightArrow", x + bw + arrow * 0.3, h / 2 - arrow / 2, arrow, arrow, tint(color, 0.45));
      });
      break;
    }
    case "list": {
      const gap = Math.min(12, h / n / 6);
      const bh = (h - gap * (n - 1)) / n;
      roots.forEach((r, i) => {
        const y = i * (bh + gap);
        const kids = flat(r);
        const lw = kids.length ? w * 0.32 : w;
        box("roundRect", 0, y, lw, bh, [r.text]);
        if (kids.length) box("rect", lw + 6, y, w - lw - 6, bh, kids.map((k) => "• " + k), tint(color, 0.82), "#262626", "left");
      });
      break;
    }
    case "cycle": {
      const d = Math.min(w, h) * (n > 5 ? 0.24 : 0.3);
      const R = Math.min(w, h) / 2 - d / 2;
      const [cx, cy] = [w / 2, h / 2];
      deco("ellipse", cx - R, cy - R, R * 2, R * 2, undefined, tint(color, 0.45));
      roots.forEach((r, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        box("ellipse", cx + R * Math.cos(a) - d / 2, cy + R * Math.sin(a) - d / 2, d, d, [r.text, ...flat(r)]);
      });
      break;
    }
    case "hierarchy": {
      const depth = (ns: Node[]): number => (ns.length ? 1 + Math.max(...ns.map((k) => depth(k.kids))) : 0);
      const leaves = (x: Node): number => (x.kids.length ? x.kids.reduce((s, k) => s + leaves(k), 0) : 1);
      const rows = Math.max(1, depth(roots));
      const rowH = h / rows;
      const bh = rowH * 0.6;
      const unit = w / Math.max(1, roots.reduce((s, r) => s + leaves(r), 0));
      const bw = Math.min(unit * 0.86, 260);
      const lines: Shape[] = [];
      const place = (x: Node, left: number, row: number): number => {
        const span = leaves(x) * unit;
        const cx = left + span / 2;
        const y = row * rowH + (rowH - bh) / 2;
        box("roundRect", cx - bw / 2, y, bw, bh, [x.text], row ? tint(color, row * 0.22) : color, row > 2 ? "#262626" : "#ffffff");
        let l = left;
        for (const k of x.kids) {
          const kcx = place(k, l, row + 1);
          l += leaves(k) * unit;
          const [y1, y2] = [y + bh, (row + 1) * rowH + (rowH - bh) / 2];
          lines.push({ id: 0, kind: "line", x: r1(Math.min(cx, kcx)), y: r1(y1), w: r1(Math.abs(kcx - cx)), h: r1(y2 - y1), flipH: kcx < cx, line: tint(color, 0.3), lineWidth: 1.5, paragraphs: [] });
        }
        return cx;
      };
      let left = 0;
      for (const r of roots) {
        place(r, left, 0);
        left += leaves(r) * unit;
      }
      out.unshift(...lines);
      out.forEach((s, i) => (s.id = i + 1));
      break;
    }
    case "pyramid": {
      // A stepped pyramid: a triangle on top, wider layers below.
      const lh = h / n;
      roots.forEach((r, i) => {
        const lw = w * (0.25 + (0.75 * (i + 1)) / n);
        box(i === 0 ? "triangle" : "rect", (w - lw) / 2, i * lh, lw, lh - 3, [r.text, ...flat(r)], tint(color, (i / n) * 0.5));
      });
      break;
    }
    default:
      break;
  }
  // One text size for all items (like PowerPoint), the smallest that fits.
  const first = (x: Shape) => x.paragraphs[0]?.runs[0]?.size ?? 0;
  const main = Math.min(...out.filter(first).map(first));
  if (Number.isFinite(main))
    for (const x of out) {
      const f = first(x) ? main / first(x) : 1;
      x.paragraphs = x.paragraphs.map((p) => {
        const size = Math.max(8, Math.round((p.size ?? main) * f));
        return { ...p, size, runs: p.runs.map((r) => ({ ...r, size })) };
      });
    }
  return { ...sa, color, baseW: w, baseH: h, shapes: out };
}

/** Items as text: one line per item, two spaces per level. */
export const itemsToText = (items: SmartItem[]) => items.map((i) => "  ".repeat(i.level ?? 0) + i.text).join("\n");
export function textToItems(text: string): SmartItem[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const lead = l.match(/^[\t ]*/)![0].replace(/\t/g, "  ").length;
      const level = Math.min(8, Math.floor(lead / 2));
      return level ? { text: l.trim(), level } : { text: l.trim() };
    });
}

export function SmartArtDialog({ smartart, onClose, onApply }: { smartart: SmartArt | null; onClose: () => void; onApply: (sa: SmartArt) => void }) {
  const [layout, setLayout] = useState<SmartArtLayout>("list");
  const [text, setText] = useState("");
  const [color, setColor] = useState("#4472c4");
  useEffect(() => {
    if (!smartart) return;
    setLayout((SMARTART_LAYOUTS.some((l) => l.id === smartart.layout) ? smartart.layout : "list") as SmartArtLayout);
    setText(itemsToText(smartart.items));
    setColor(smartart.color ?? "#4472c4");
  }, [smartart]);
  if (!smartart) return null;
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: at, selectionEnd: end } = ta;
    const start = text.lastIndexOf("\n", at - 1) + 1;
    const line = text.slice(start);
    let next = text;
    let pos = at;
    if (e.key === "Enter") {
      // A new item at the level of the current one.
      const indent = line.match(/^ */)![0];
      next = text.slice(0, at) + "\n" + indent + text.slice(end);
      pos = at + 1 + indent.length;
    } else if (e.key === "Tab") {
      // Tab / Shift+Tab change the level of the current line.
      if (e.shiftKey) {
        if (line.startsWith("  ")) (next = text.slice(0, start) + line.slice(2)), (pos = Math.max(start, at - 2));
      } else (next = text.slice(0, start) + "  " + line), (pos = at + 2);
    } else return;
    e.preventDefault();
    if (next === text) return;
    // Set the value now so fast typing continues at the right place.
    ta.value = next;
    ta.setSelectionRange(pos, pos);
    setText(next);
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{tl("SmartArt bearbeiten")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "end" }}>
              <Field label={tl("Layout")} style={{ flex: 1 }}>
                <Dropdown value={SMARTART_LAYOUTS.find((l) => l.id === layout)?.label} selectedOptions={[layout]} onOptionSelect={(_, d) => d.optionValue && setLayout(d.optionValue as SmartArtLayout)}>
                  {SMARTART_LAYOUTS.map((l) => (
                    <Option key={l.id} value={l.id}>
                      {l.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={tl("Farbe")}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={tl("Farbe")} style={{ width: 48, height: 32, border: "none", background: "none", padding: 0 }} />
              </Field>
            </div>
            <Field label={tl("Elemente")} hint={tl("Eine Zeile pro Element. Tab rückt ein (Unterpunkt), Umschalt+Tab rückt aus.")}>
              <Textarea value={text} onChange={(_, d) => setText(d.value)} onKeyDown={onKeyDown} rows={10} textarea={{ style: { fontFamily: "inherit", whiteSpace: "pre" } }} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
            <Button
              appearance="primary"
              onClick={() => {
                onApply({ ...smartart, layout, color, items: textToItems(text) });
                onClose();
              }}
            >
              {tl("OK")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
