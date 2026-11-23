// Commands of the Präsentation ribbon that PowerPoint has and that need more
// than a one-liner: find/replace, header and footer, WordArt, the
// animation pane and the outline, slide sorter and notes page views.

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Radio, RadioGroup, Text } from "@fluentui/react-components";
import { ArrowDown16Regular, ArrowUp16Regular, Delete16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { type Animation, type LayoutId, type Presentation, type Shape, type Slide, animLabel, nextId } from "./model";
import { SlideThumb } from "./SlideView";
import { tl, LOCALE } from "../../lib/i18n";

export { caseText } from "../text/insertTools";

/** Layout a slide was most likely made from (for "Folie zurücksetzen"). */
export function guessLayout(s: Slide): LayoutId {
  const ph = s.shapes.map((x) => x.placeholder).filter(Boolean);
  if (ph.includes("ctrTitle") || ph.includes("subTitle")) return "title";
  const bodies = ph.filter((p) => p === "body" || p === "obj").length;
  if (bodies >= 2) return "twoContent";
  if (bodies === 1) return "titleContent";
  if (ph.includes("title")) return "titleOnly";
  return "blank";
}

// ---------------------------------------------------------- find, replace --

export interface TextHit {
  slide: number;
  shape: number;
}

/** Shapes (in slide order) whose text contains `q`. */
export function findText(p: Presentation, q: string, matchCase: boolean): TextHit[] {
  if (!q) return [];
  const norm = (t: string) => (matchCase ? t : t.toLowerCase());
  const needle = norm(q);
  const out: TextHit[] = [];
  p.slides.forEach((sl, i) =>
    sl.shapes.forEach((sh) => {
      const texts = [sh.paragraphs.map((x) => x.runs.map((r) => r.text).join("")).join("\n"), ...(sh.table?.rows.flatMap((r) => r.cells.map((c) => c.paragraphs.map((x) => x.runs.map((r) => r.text).join("")).join("\n"))) ?? [])];
      if (texts.some((t) => norm(t).includes(needle))) out.push({ slide: i, shape: sh.id });
    }),
  );
  return out;
}

type RunT = Shape["paragraphs"][number]["runs"][number];

/** Replaces every match in a paragraph, also across format boundaries: the
 *  replacement takes the format of the run where the match starts. Fields
 *  (slide number, date) are left alone. */
export function replaceInRuns(runs: RunT[], re: RegExp, to: string): RunT[] {
  const starts: number[] = [];
  let pos = 0;
  for (const r of runs) {
    starts.push(pos);
    pos += r.text.length;
  }
  const text = runs.map((r) => r.text).join("");
  const matches = [...text.matchAll(re)].filter((m) => m[0].length > 0);
  if (!matches.length) return runs;
  const out = runs.map((r) => ({ ...r }));
  for (const m of matches.reverse()) {
    const s = m.index;
    const e = s + m[0].length;
    const touched = runs.map((_, i) => i).filter((i) => starts[i] < e && starts[i] + runs[i].text.length > s);
    if (touched.some((i) => runs[i].field)) continue;
    for (const i of touched) {
      const ls = Math.max(s, starts[i]) - starts[i];
      const le = Math.min(e, starts[i] + runs[i].text.length) - starts[i];
      const t = out[i].text;
      out[i].text = t.slice(0, ls) + (s >= starts[i] ? to : "") + t.slice(le);
    }
  }
  const kept = out.filter((r) => r.text || r.field);
  return kept.length ? kept : [{ ...out[0], text: "" }];
}

/** Replaces text in a shape (and its table cells). */
export function replaceInShape(sh: Shape, q: string, to: string, matchCase: boolean): Shape {
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi");
  const fix = (paras: Shape["paragraphs"]) => paras.map((p) => ({ ...p, runs: replaceInRuns(p.runs, re, to) }));
  return { ...sh, paragraphs: fix(sh.paragraphs), table: sh.table ? { ...sh.table, rows: sh.table.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, paragraphs: fix(c.paragraphs) })) })) } : sh.table };
}

export function FindReplaceDialog({
  open,
  replace,
  pres,
  onClose,
  onGo,
  onReplaceShape,
  onReplaceAll,
}: {
  open: boolean;
  replace: boolean;
  pres: Presentation;
  onClose: () => void;
  onGo: (h: TextHit) => void;
  onReplaceShape: (h: TextHit, q: string, to: string, matchCase: boolean) => void;
  onReplaceAll: (q: string, to: string, matchCase: boolean) => number;
}) {
  const [q, setQ] = useState("");
  const [to, setTo] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [i, setI] = useState(-1);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (open) (setI(-1), setMsg(""));
  }, [open]);
  const hits = findText(pres, q, matchCase);
  const next = () => {
    if (!hits.length) return setMsg(tl("Der gesuchte Text wurde nicht gefunden."));
    const j = (i + 1) % hits.length;
    setI(j);
    setMsg(tl("Treffer {0} von {1}", j + 1, hits.length));
    onGo(hits[j]);
  };
  return (
    <Dialog open={open} modalType="non-modal" onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{replace ? tl("Ersetzen") : tl("Suchen")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Field label={tl("Suchen nach:")}>
              <Input value={q} autoFocus onChange={(_, d) => (setQ(d.value), setI(-1))} onKeyDown={(e) => e.key === "Enter" && next()} />
            </Field>
            {replace && (
              <Field label={tl("Ersetzen durch:")}>
                <Input value={to} onChange={(_, d) => setTo(d.value)} />
              </Field>
            )}
            <Checkbox checked={matchCase} label={tl("Groß-/Kleinschreibung beachten")} onChange={(_, d) => setMatchCase(!!d.checked)} />
            {msg && <Text size={200}>{msg}</Text>}
          </DialogContent>
          <DialogActions style={{ flexWrap: "wrap" }}>
            <Button appearance="primary" onClick={next}>
              {tl("Weitersuchen")}
            </Button>
            {replace && (
              <>
                <Button disabled={i < 0 || !hits[i]} onClick={() => (onReplaceShape(hits[i], q, to, matchCase), next())}>
                  {tl("Ersetzen")}
                </Button>
                <Button disabled={!q} onClick={() => setMsg(tl("{0} Formen geändert.", onReplaceAll(q, to, matchCase)))}>
                  {tl("Alle ersetzen")}
                </Button>
              </>
            )}
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------- header and footer --

export interface HeaderFooterOptions {
  date: "none" | "auto" | "fixed";
  fixedDate: string;
  number: boolean;
  footer: string;
  skipTitle: boolean;
  all: boolean;
}

/** Footer placeholders (as in PowerPoint): date, footer text, slide number. */
const HF_PLACEHOLDERS = ["dt", "ftr", "sldNum"];

/** Kopf- und Fußzeile: date, footer text and slide number boxes at the
 *  bottom of the slides (replacing earlier ones). */
export function applyHeaderFooter(p: Presentation, current: number, o: HeaderFooterOptions): Presentation {
  const W = p.width;
  const H = p.height;
  const y = H - H * 0.075;
  const h = H * 0.05;
  const size = Math.round((H / 720) * 12);
  const slides = p.slides.map((sl, i) => {
    if (!o.all && i !== current) return sl;
    let shapes = sl.shapes.filter((x) => !HF_PLACEHOLDERS.includes(x.placeholder ?? ""));
    const title = sl.shapes.some((x) => x.placeholder === "ctrTitle" || x.placeholder === "subTitle");
    if (!(o.skipTitle && title)) {
      const add = (placeholder: string, x: number, w: number, align: string, run: Shape["paragraphs"][number]["runs"][number]) => {
        const id = nextId({ ...sl, shapes });
        shapes = [...shapes, { id, kind: "text", placeholder, x, y, w, h, anchor: "middle", paragraphs: [{ align, runs: [{ size, color: "#7f7f7f", ...run }] }] }];
      };
      if (o.date !== "none") add("dt", W * 0.069, W * 0.23, "left", o.date === "auto" ? { text: new Date().toLocaleDateString(LOCALE), field: "datetime" } : { text: o.fixedDate });
      if (o.footer.trim()) add("ftr", W * 0.34, W * 0.32, "center", { text: o.footer.trim() });
      if (o.number) add("sldNum", W * 0.7, W * 0.23, "right", { text: String(i + 1), field: "slidenum" });
    }
    return { ...sl, shapes };
  });
  return { ...p, slides };
}

/** Header/footer settings as found on a slide (for the dialog). */
export function headerFooterOf(sl: Slide | undefined): HeaderFooterOptions {
  const ph = (t: string) => sl?.shapes.find((x) => x.placeholder === t);
  const text = (x: Shape | undefined) => x?.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n") ?? "";
  const dt = ph("dt");
  const auto = !!dt?.paragraphs.some((p) => p.runs.some((r) => r.field === "datetime"));
  return { date: !dt ? "none" : auto ? "auto" : "fixed", fixedDate: dt && !auto ? text(dt) : new Date().toLocaleDateString(LOCALE), number: sl ? !!ph("sldNum") || !sl.shapes.some((x) => x.placeholder === "dt" || x.placeholder === "ftr") : true, footer: text(ph("ftr")), skipTitle: true, all: true };
}

export function HeaderFooterSlidesDialog({ open, initial, onClose, onApply }: { open: boolean; initial: HeaderFooterOptions; onClose: () => void; onApply: (o: HeaderFooterOptions) => void }) {
  const [o, setO] = useState<HeaderFooterOptions>(initial);
  useEffect(() => {
    if (open) setO(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Kopf- und Fußzeile")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Checkbox checked={o.date !== "none"} label={tl("Datum und Uhrzeit")} onChange={(_, d) => setO({ ...o, date: d.checked ? "auto" : "none" })} />
            {o.date !== "none" && (
              <RadioGroup value={o.date} onChange={(_, d) => setO({ ...o, date: d.value as HeaderFooterOptions["date"] })} style={{ marginLeft: 24 }}>
                <Radio value="auto" label={tl("Automatisch aktualisieren")} />
                <Radio value="fixed" label={tl("Fest")} />
              </RadioGroup>
            )}
            {o.date === "fixed" && <Input style={{ marginLeft: 24 }} value={o.fixedDate} onChange={(_, d) => setO({ ...o, fixedDate: d.value })} />}
            <Checkbox checked={o.number} label={tl("Foliennummer")} onChange={(_, d) => setO({ ...o, number: !!d.checked })} />
            <Checkbox checked={!!o.footer || o.footer === " "} label={tl("Fußzeile")} onChange={(_, d) => setO({ ...o, footer: d.checked ? " " : "" })} />
            {o.footer !== "" && <Input style={{ marginLeft: 24 }} value={o.footer.trim()} onChange={(_, d) => setO({ ...o, footer: d.value || " " })} />}
            <Checkbox checked={o.skipTitle} label={tl("Auf Titelfolie nicht anzeigen")} onChange={(_, d) => setO({ ...o, skipTitle: !!d.checked })} />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply({ ...o, all: true }), onClose())}>
              {tl("Für alle übernehmen")}
            </Button>
            <Button onClick={() => (onApply({ ...o, all: false }), onClose())}>{tl("Übernehmen")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** WordArt: a text box with large bold text in an accent colour and a shadow. */
export function wordArtShape(slide: Slide, w: number, h: number, text: string, color: string): Shape {
  const size = 54;
  const bw = Math.min(w * 0.8, Math.max(200, text.length * size * 0.62));
  return { id: nextId(slide), kind: "text", x: Math.round((w - bw) / 2), y: Math.round(h / 2 - size), w: Math.round(bw), h: size * 2, anchor: "middle", shadow: true, paragraphs: [{ align: "center", runs: [{ text, size, bold: true, color }] }] };
}

// --------------------------------------------------------- animation pane --

export function AnimationPane({ slide, selected, onSelect, onMove, onDelete, onClose }: { slide: Slide; selected: number[]; onSelect: (shape: number) => void; onMove: (i: number, d: -1 | 1) => void; onDelete: (i: number) => void; onClose: () => void }) {
  const anims = slide.animations ?? [];
  const nameOf = (a: Animation) => {
    const sh = slide.shapes.find((x) => x.id === a.shape);
    const text = sh?.paragraphs
      .map((p) => p.runs.map((r) => r.text).join(""))
      .join(" ")
      .trim();
    return sh?.name ?? (text ? text.slice(0, 28) : `${sh?.kind ?? "?"} ${a.shape}`);
  };
  let step = 0;
  return (
    <div className="nx-side-pane nx-anim-pane">
      <div className="nx-side-head">
        <Text weight="semibold">{tl("Animationsbereich")}</Text>
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      {anims.length === 0 && <Text size={200}>{tl("Auf dieser Folie gibt es keine Animationen.")}</Text>}
      {anims.map((a, i) => {
        if (a.trigger === "click" || i === 0) step++;
        return (
          <div key={i} className={`nx-anim-row${selected.includes(a.shape) ? " nx-anim-row-sel" : ""}`} onClick={() => onSelect(a.shape)}>
            <span className="nx-anim-step">{a.trigger === "click" ? step : ""}</span>
            <span className="nx-anim-name" title={animLabel(a)}>
              {nameOf(a)}
              <small>{animLabel(a)}</small>
            </span>
            <Button size="small" appearance="subtle" icon={<ArrowUp16Regular />} aria-label={tl("Früher")} disabled={i === 0} onClick={(e) => (e.stopPropagation(), onMove(i, -1))} />
            <Button size="small" appearance="subtle" icon={<ArrowDown16Regular />} aria-label={tl("Später")} disabled={i === anims.length - 1} onClick={(e) => (e.stopPropagation(), onMove(i, 1))} />
            <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label={tl("Entfernen")} onClick={(e) => (e.stopPropagation(), onDelete(i))} />
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ views --

const textOf = (sh: Shape) => sh.paragraphs.map((p) => ({ level: p.level ?? 0, text: p.runs.map((r) => r.text).join("") })).filter((p) => p.text.trim());

/** Gliederungsansicht: titles and body text of every slide. */
export function OutlineView({ pres, index, onGo }: { pres: Presentation; index: number; onGo: (i: number) => void }) {
  return (
    <div className="nx-outline-view">
      {pres.slides.map((sl, i) => {
        const title = sl.shapes.find((x) => x.placeholder === "title" || x.placeholder === "ctrTitle");
        const rest = sl.shapes.filter((x) => x !== title && x.kind === "text");
        return (
          <div key={i} className={`nx-outline-slide${i === index ? " nx-outline-active" : ""}`} onClick={() => onGo(i)}>
            <span className="nx-outline-num">{i + 1}</span>
            <div>
              <div className="nx-outline-title">
                {title
                  ? textOf(title)
                      .map((x) => x.text)
                      .join(" ") || tl("(Ohne Titel)")
                  : tl("(Ohne Titel)")}
              </div>
              {rest.flatMap(textOf).map((p, j) => (
                <div key={j} style={{ paddingLeft: 16 + p.level * 16 }}>
                  {p.text}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Foliensortierung: all slides as thumbnails. */
export function SorterView({ pres, index, onGo, onOpen }: { pres: Presentation; index: number; onGo: (i: number) => void; onOpen: (i: number) => void }) {
  return (
    <div className="nx-sorter">
      {pres.slides.map((sl, i) => (
        <div key={i} className={`nx-sorter-item${i === index ? " nx-sorter-active" : ""}${sl.hidden ? " nx-sorter-hidden" : ""}`} onClick={() => onGo(i)} onDoubleClick={() => onOpen(i)}>
          <SlideThumb slide={sl} width={240} presWidth={pres.width} presHeight={pres.height} />
          <span>{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

/** Notizenseite: the slide and its notes on a page. */
export function NotesPageView({ pres, slide, onNotes }: { pres: Presentation; slide: Slide; onNotes: (v: string) => void }) {
  return (
    <div className="nx-notes-page-wrap">
      <div className="nx-notes-page">
        <SlideThumb slide={slide} width={520} presWidth={pres.width} presHeight={pres.height} />
        <textarea className="nx-notes-page-text" value={slide.notes} placeholder={tl("Klicken Sie, um Notizen hinzuzufügen")} onChange={(e) => onNotes(e.target.value)} />
      </div>
    </div>
  );
}
