// Slide show, presenter view and the audience window (second screen).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import { ClosedCaption20Regular } from "@fluentui/react-icons";
import { Captions, Coach, type CoachReport, slideTitle, useSpeech } from "./slidesExtras";
import { ArrowLeft24Regular, ArrowRight24Regular, Cursor20Regular, Delete20Regular, Dismiss24Regular, Eraser20Regular, Flashlight20Regular, Highlight20Regular, Open24Regular, Pen20Regular } from "@fluentui/react-icons";
import { isTauri } from "../../lib/api";
import { openDocumentWindow } from "../../lib/office";
import { type Presentation, type Shape, type Slide, type Transition, pathEnd } from "./model";
import { MediaSyncContext, type MorphFrom, PresContext, type ShapeAnim, SlideThumb, SlideView } from "./SlideView";
import { INK_COLORS, InkLayer, type InkTool, type Stroke } from "./ink";
import { tl, LOCALE } from "../../lib/i18n";

export const SHOW_PREFIX = "ondura-show:";

interface ShowMessage {
  pres?: Presentation;
  index: number;
  built?: number;
  black?: "black" | "white" | null;
  end?: boolean;
  /** Play/pause/seek of a video or audio clip in the presenter view. */
  media?: { shape: number; action: "play" | "pause" | "seek"; time: number };
}

async function setFullscreen(on: boolean) {
  try {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(on);
    } else if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* not allowed */
  }
}

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

/** Click steps of a slide's animations with start offsets (ms). */
export function animationSteps(slide: Slide | undefined) {
  const groups: { shape: number; anim: ShapeAnim }[][] = [];
  const anims = (slide?.animations ?? []).filter((a) => slide?.shapes.some((s) => s.id === a.shape));
  let prevStart = 0;
  let groupEnd = 0;
  for (const a of anims) {
    const dur = a.effect === "appear" ? 1 : a.duration;
    let start: number;
    if (a.trigger === "click" || !groups.length) {
      groups.push([]);
      start = 0;
      groupEnd = 0;
    } else start = a.trigger === "with" ? prevStart : groupEnd;
    const delay = start + (a.delay ?? 0);
    groups[groups.length - 1].push({ shape: a.shape, anim: { cls: a.class === "path" && !a.path ? "entr" : (a.class ?? "entr"), effect: a.effect, dir: a.dir, duration: a.duration, delay, path: a.path } });
    prevStart = start;
    groupEnd = Math.max(groupEnd, delay + dur);
  }
  // A first effect that is not started by a click plays with the slide.
  const auto = anims.length > 0 && anims[0].trigger !== "click";
  return { groups, auto };
}

/** Hidden shapes and running animations after `built` steps. */
function stepState(slide: Slide | undefined, built: number, animate: boolean) {
  const { groups } = animationSteps(slide);
  // Shapes whose first effect is an entrance start hidden.
  const hidden = new Set<number>();
  const seen = new Set<number>();
  for (const x of groups.flat()) {
    if (!seen.has(x.shape) && x.anim.cls === "entr") hidden.add(x.shape);
    seen.add(x.shape);
  }
  groups.slice(0, built).forEach((g, gi) =>
    g.forEach((x) => {
      if (x.anim.cls === "entr") hidden.delete(x.shape);
      // A running exit effect hides the shape itself when it ends.
      else if (x.anim.cls === "exit" && !(animate && gi === built - 1)) hidden.add(x.shape);
    }),
  );
  // Motion paths keep the shape where they end: offsets of finished steps
  // (fractions of the slide), and start offsets of the running ones.
  const offsets = new Map<number, [number, number]>();
  const add = (id: number, d: [number, number]) => {
    const o = offsets.get(id) ?? [0, 0];
    offsets.set(id, [o[0] + d[0], o[1] + d[1]]);
  };
  const running = animate && built > 0 ? built - 1 : -1;
  groups.slice(0, built).forEach((g, gi) => {
    if (gi !== running) for (const x of g) if (x.anim.path) add(x.shape, pathEnd(x.anim.path));
  });
  const anims = new Map<number, ShapeAnim[]>();
  if (running >= 0) {
    const within = new Map<number, [number, number]>();
    for (const x of [...groups[running]].sort((a, b) => a.anim.delay - b.anim.delay)) {
      let anim = x.anim;
      if (anim.path) {
        const st = within.get(x.shape) ?? [0, 0];
        anim = { ...anim, start: st };
        const e = pathEnd(anim.path!);
        within.set(x.shape, [st[0] + e[0], st[1] + e[1]]);
      }
      anims.set(x.shape, [...(anims.get(x.shape) ?? []), anim]);
    }
  }
  return { hidden, anims, offsets };
}

const textOf = (s: Shape) => s.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n").trim();

/** Morph: shapes of `to` matched with `from` (same id and kind, same name, or same kind and text). */
export function morphMatches(from: Slide | undefined, to: Slide | undefined, duration: number): { map: Map<number, MorphFrom>; matched: Set<number> } {
  const map = new Map<number, MorphFrom>();
  const matched = new Set<number>();
  if (!from || !to) return { map, matched };
  const free = [...from.shapes];
  const take = (pred: (a: Shape) => boolean) => {
    const i = free.findIndex(pred);
    return i >= 0 ? free.splice(i, 1)[0] : undefined;
  };
  for (const b of to.shapes) {
    // Shapes with different text are not morphed into each other (the text would be distorted).
    const sameText = (a: Shape) => textOf(a) === textOf(b);
    const a = (b.name ? take((a) => a.name === b.name) : undefined) ?? take((a) => a.id === b.id && a.kind === b.kind && sameText(a)) ?? (textOf(b) ? take((a) => a.kind === b.kind && sameText(a)) : undefined);
    if (!a) continue;
    matched.add(a.id);
    map.set(b.id, { x: a.x, y: a.y, w: a.w, h: a.h, rotation: a.rotation ?? 0, duration });
  }
  return { map, matched };
}

function transitionStyle(t: Transition | undefined, entering: boolean): React.CSSProperties | null {
  if (!t || t.kind === "cut" || t.kind === "none" || t.kind === "morph") return null;
  const dir = t.dir ?? "l";
  const name = (() => {
    switch (t.kind) {
      case "push":
        return entering ? `nx-tr-in-${dir}` : `nx-tr-out-${dir}`;
      case "cover":
        return entering ? `nx-tr-in-${dir}` : null;
      case "wipe":
        return entering ? `nx-tr-wipe-${dir}` : null;
      case "split":
        return entering ? "nx-tr-split" : null;
      case "zoom":
        return entering ? "nx-tr-zoom" : null;
      default:
        return entering ? "nx-tr-fade" : null;
    }
  })();
  if (!name) return null;
  return { animationName: name, animationDuration: `${t.duration}ms`, animationFillMode: "both", animationTimingFunction: "ease-in-out" };
}

/** A slide scaled to fit a box, with the slide's transition and build steps. */
function Fitted({ pres, index, w, h, black, built = 99, animate = false, live = false, overlay }: { pres: Presentation; index: number; w: number; h: number; black?: "black" | "white" | null; built?: number; animate?: boolean; live?: boolean; overlay?: (scale: number) => React.ReactNode }) {
  const scale = Math.min(w / pres.width, h / pres.height);
  const slide = pres.slides[index];
  const [prev, setPrev] = useState<{ index: number; built: number } | null>(null);
  const last = useRef({ index, built });
  useEffect(() => {
    const before = last.current;
    last.current = { index, built };
    if (before.index === index) return;
    const t = pres.slides[index]?.transition;
    if (!t || t.kind === "cut" || t.kind === "none") return setPrev(null);
    setPrev(before);
    const timer = setTimeout(() => setPrev(null), t.duration + 50);
    return () => clearTimeout(timer);
  }, [index, built, pres]);
  const transition = prev ? slide?.transition : undefined;
  const now = stepState(slide, built, animate);
  const old = prev ? stepState(pres.slides[prev.index], prev.built, false) : null;
  const morph = prev && transition?.kind === "morph" ? morphMatches(pres.slides[prev.index], slide, transition.duration) : null;
  if (morph && old) for (const id of morph.matched) old.hidden.add(id);
  const layer = (i: number, st: { hidden: Set<number>; anims: Map<number, ShapeAnim[]>; offsets?: Map<number, [number, number]> }, style: React.CSSProperties | null, key: string, live = false, m?: Map<number, MorphFrom>) => (
    <div key={key} className="nx-tr-layer" style={style ?? undefined}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: pres.width, height: pres.height }}>
        {pres.slides[i] && <SlideView slide={pres.slides[i]} width={pres.width} height={pres.height} hiddenShapes={st.hidden} anims={st.anims} offsets={st.offsets} live={live} morph={m} fade={m ? transition?.duration : undefined} noBackground={key.startsWith("old") && !!morph} />}
      </div>
    </div>
  );
  const fadeOut = morph && transition ? { animation: `nx-tr-fadeout ${transition.duration}ms ease-in-out both` } : null;
  return (
    <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", position: "relative" }}>
      <div style={{ width: pres.width * scale, height: pres.height * scale, overflow: "hidden", position: "relative" }}>
        {prev && old && !morph && layer(prev.index, old, transitionStyle(transition, false), `old-${prev.index}`)}
        {layer(index, now, prev && !morph ? transitionStyle(transition, true) : null, `cur-${index}`, live, morph?.map)}
        {prev && old && morph && layer(prev.index, old, fadeOut, `old-${prev.index}`)}
        {overlay?.(scale)}
      </div>
      {black && <div style={{ position: "absolute", inset: 0, background: black }} />}
    </div>
  );
}

function visibleSlides(pres: Presentation) {
  return pres.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);
}

/** What a show leaves behind: ink per slide, rehearsed timings and recorded narration. */
export interface ShowResult {
  ink: Record<number, Stroke[]>;
  /** Rehearsal: time on each slide (ms), by slide index. */
  timings?: Record<number, number>;
  /** Recording: narration of each slide (data URL), by slide index. */
  audio?: Record<number, string>;
  /** Presenter Coach: feedback on the rehearsal. */
  coach?: CoachReport;
}

export function SlideShow({ pres, start, presenter, onExit: exitShow, rehearse }: { pres: Presentation; start: number; presenter: boolean; onExit: (r: ShowResult) => void; rehearse?: "timings" | "record" | "coach" }) {
  const order = visibleSlides(pres);
  const [pos, setPos] = useState(() => Math.max(0, order.indexOf(start) >= 0 ? order.indexOf(start) : order.findIndex((i) => i > start)));
  const [black, setBlack] = useState<"black" | "white" | null>(null);
  const [ended, setEnded] = useState(false);
  // Animation steps shown on the current slide; `forward` animates the last one.
  const [built, setBuilt] = useState(() => (animationSteps(pres.slides[order[pos] ?? 0]).auto ? 1 : 0));
  const [forward, setForward] = useState(true);
  const [typed, setTyped] = useState("");
  const [started] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [cursor, setCursor] = useState(true);
  const view = useViewport();
  const channel = useRef<BroadcastChannel | null>(null);
  // An audience window plays the sound; the presenter's players are muted then.
  const [audience, setAudience] = useState(false);
  const index = order[pos] ?? 0;
  // Pen and laser pointer.
  const [tool, setTool] = useState<InkTool>("none");
  const [inkColor, setInkColor] = useState("#e81123");
  const [ink, setInk] = useState<Record<number, Stroke[]>>({});
  // Live captions and Presenter Coach (speech recognition).
  const [captions, setCaptions] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const coach = useRef<Coach | null>(rehearse === "coach" ? new Coach() : null);
  const indexRef = useRef(0);
  indexRef.current = index;
  const speech = useSpeech(captions || rehearse === "coach", LOCALE.startsWith("de") ? "de-DE" : LOCALE.startsWith("fr") ? "fr-FR" : "en-US", (t) => {
    setSaid((x) => [...x.slice(-4), t]);
    coach.current?.add(t, indexRef.current);
  });
  // Slide zooms return to the slide they were started from.
  const returnTo = useRef<number[]>([]);
  // Rehearsal and recording.
  const timings = useRef<Record<number, number>>({});
  const audio = useRef<Record<number, string>>({});
  const slideStart = useRef(Date.now());
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [recError, setRecError] = useState<string | null>(null);

  useEffect(() => {
    void setFullscreen(true);
    return () => void setFullscreen(false);
  }, []);

  /** Stops the recording of a slide; resolves when its audio is stored. */
  const stopSlideRecording = useCallback(
    (slide: number) =>
      new Promise<void>((resolve) => {
        const r = recorder.current;
        if (!r || r.state === "inactive") return resolve();
        const chunks: Blob[] = [];
        r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        r.onstop = () => {
          const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
          const fr = new FileReader();
          fr.onload = () => {
            if (blob.size > 0) audio.current[slide] = String(fr.result);
            resolve();
          };
          fr.readAsDataURL(blob);
        };
        r.stop();
      }),
    [],
  );

  const startSlideRecording = useCallback(() => {
    if (!stream.current) return;
    try {
      const r = new MediaRecorder(stream.current);
      r.start();
      recorder.current = r;
    } catch (e) {
      setRecError(String(e));
    }
  }, []);

  useEffect(() => {
    if (rehearse !== "record") return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        startSlideRecording();
      })
      .catch(() => setRecError(tl("Kein Mikrofon verfügbar – es werden nur die Zeiten aufgezeichnet.")));
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [rehearse, startSlideRecording]);

  // Time spent on each slide; the recording restarts with every slide.
  const lastIndex = useRef(index);
  useEffect(() => {
    const prev = lastIndex.current;
    if (prev === index) return;
    lastIndex.current = index;
    if (rehearse) {
      timings.current[prev] = (timings.current[prev] ?? 0) + (Date.now() - slideStart.current);
      if (rehearse === "record") void stopSlideRecording(prev).then(startSlideRecording);
    }
    slideStart.current = Date.now();
  }, [index, rehearse, stopSlideRecording, startSlideRecording]);

  const onExit = useCallback(async () => {
    if (coach.current) {
      const texts = pres.slides.map((sl) => [slideTitle(sl), ...sl.shapes.flatMap((x) => x.paragraphs.map((p) => p.runs.map((r) => r.text).join("")))].join(" "));
      exitShow({ ink: Object.fromEntries(Object.entries(ink).filter(([, v]) => v.length)), coach: coach.current.report(texts) });
      return;
    }
    if (rehearse) {
      timings.current[index] = (timings.current[index] ?? 0) + (Date.now() - slideStart.current);
      if (rehearse === "record") await stopSlideRecording(index);
    }
    const kept = Object.fromEntries(Object.entries(ink).filter(([, v]) => v.length));
    exitShow({ ink: kept, ...(rehearse ? { timings: timings.current } : {}), ...(rehearse === "record" ? { audio: audio.current } : {}) });
  }, [rehearse, index, ink, exitShow, stopSlideRecording, pres.slides]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Audience window (presenter view).
  const channelId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    if (!presenter) return;
    const ch = new BroadcastChannel(`ondura-show-${channelId.current}`);
    channel.current = ch;
    ch.onmessage = (e) => {
      if (e.data === "hello") {
        setAudience(true);
        ch.postMessage({ pres, index, black, built } satisfies ShowMessage);
      }
    };
    return () => {
      ch.postMessage({ index: 0, end: true } satisfies ShowMessage);
      ch.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter]);
  useEffect(() => {
    channel.current?.postMessage({ index, black, built } satisfies ShowMessage);
  }, [index, black, built]);

  const enter = useCallback(
    (p: number, end = false) => {
      const st = animationSteps(pres.slides[order[p] ?? 0]);
      setPos(p);
      setBuilt(end ? st.groups.length : st.auto ? 1 : 0);
      setForward(!end);
      setEnded(false);
    },
    [order, pres],
  );

  const go = useCallback(
    (d: number) => {
      setBlack(null);
      const steps = animationSteps(pres.slides[index]);
      if (d > 0) {
        if (ended) return;
        if (built < steps.groups.length) {
          setBuilt((b) => b + 1);
          setForward(true);
          return;
        }
        if (pos + 1 >= order.length) return setEnded(true);
        enter(pos + 1);
      } else {
        if (ended) return setEnded(false);
        if (built > (steps.auto ? 1 : 0)) {
          setBuilt((b) => b - 1);
          setForward(false);
          return;
        }
        if (pos > 0) enter(pos - 1, true);
      }
    },
    [pres, index, ended, built, pos, order.length, enter],
  );

  // Slide zoom: show the slide, then come back.
  const zoomTo = useCallback(
    (slide: number) => {
      const p = order.indexOf(slide);
      if (p < 0) return;
      returnTo.current.push(pos);
      enter(p);
    },
    [order, pos, enter],
  );
  const followLink = useCallback(
    (link: string) => {
      const m = link.match(/^slide:(\d+)$/);
      if (m) {
        const p = order.indexOf(Number(m[1]));
        if (p >= 0) enter(p);
      } else if (/^https?:|^mailto:/i.test(link)) void import("../../lib/api").then(({ api }) => api.openExternal(link));
    },
    [order, enter],
  );

  // Automatic advance (rehearsed or set timings); not while rehearsing.
  const advanceAfter = pres.slides[index]?.transition?.advanceAfter;
  useEffect(() => {
    if (!advanceAfter || rehearse || ended || tool !== "none") return;
    const t = setTimeout(() => {
      if (pos + 1 >= order.length) setEnded(true);
      else enter(pos + 1);
    }, advanceAfter);
    return () => clearTimeout(t);
  }, [advanceAfter, rehearse, ended, tool, pos, order.length, enter]);

  // Returning from a zoomed slide: the next step after its last build.
  const goOn = useCallback(
    (d: number) => {
      if (d > 0 && returnTo.current.length && built >= animationSteps(pres.slides[index]).groups.length) {
        const back = returnTo.current.pop()!;
        return enter(back, true);
      }
      go(d);
    },
    [built, pres, index, enter, go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && ["p", "P", "l", "L", "i", "I", "a", "A", "e", "E"].includes(k)) {
        e.preventDefault();
        const t: Record<string, InkTool> = { p: "pen", l: "laser", i: "highlighter", a: "none", e: "eraser" };
        return setTool(t[k.toLowerCase()]);
      }
      if (k === "Escape" && tool !== "none") return setTool("none");
      if ((k === "e" || k === "E") && !e.ctrlKey && !e.metaKey) return setInk((x) => ({ ...x, [index]: [] }));
      if (k === "Escape") return void onExit();
      if (ended && ["ArrowRight", " ", "Enter", "PageDown", "n", "N"].includes(k)) return void onExit();
      if (/^\d$/.test(k)) return setTyped((t) => t + k);
      if (k === "Enter" && typed) {
        const n = parseInt(typed, 10) - 1;
        setTyped("");
        const p = order.indexOf(n);
        if (p >= 0) enter(p);
        return;
      }
      if (["ArrowRight", "ArrowDown", " ", "Enter", "PageDown", "n", "N"].includes(k)) goOn(1);
      else if (["ArrowLeft", "ArrowUp", "Backspace", "PageUp", "p", "P"].includes(k)) go(-1);
      else if (k === "Home") enter(0);
      else if (k === "End") enter(order.length - 1, true);
      else if (k === "b" || k === "B" || k === ".") setBlack((b) => (b === "black" ? null : "black"));
      else if (k === "w" || k === "W" || k === ",") setBlack((b) => (b === "white" ? null : "white"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goOn, onExit, ended, typed, order, enter, tool, index]);

  // Hide the mouse pointer while it rests.
  useEffect(() => {
    if (presenter) return;
    let t = setTimeout(() => setCursor(false), 2000);
    const move = () => {
      setCursor(true);
      clearTimeout(t);
      t = setTimeout(() => setCursor(false), 2000);
    };
    window.addEventListener("mousemove", move);
    return () => (clearTimeout(t), window.removeEventListener("mousemove", move));
  }, [presenter]);

  const presInfo = { master: pres.master, slides: pres.slides, width: pres.width, height: pres.height, onZoom: zoomTo, onLink: followLink };
  const overlay = (scale: number) => <InkLayer width={pres.width} height={pres.height} scale={scale} tool={tool} color={inkColor} strokes={ink[index] ?? []} onChange={(st) => setInk((x) => ({ ...x, [index]: st }))} />;
  const tools = (
    <span className="nx-show-tools" onClick={(e) => e.stopPropagation()}>
      {(
        [
          ["none", <Cursor20Regular key="c" />, tl("Pfeil (Strg+A)")],
          ["laser", <Flashlight20Regular key="l" />, tl("Laserpointer (Strg+L)")],
          ["pen", <Pen20Regular key="p" />, tl("Stift (Strg+P)")],
          ["highlighter", <Highlight20Regular key="h" />, tl("Textmarker (Strg+I)")],
          ["eraser", <Eraser20Regular key="e" />, tl("Radierer (Strg+E)")],
        ] as const
      ).map(([t, icon, label]) => (
        <Button key={t} size="small" appearance={tool === t ? "primary" : "subtle"} icon={icon} title={label} aria-label={label} onClick={() => setTool(t)} />
      ))}
      {(tool === "pen" || tool === "highlighter") &&
        INK_COLORS.map((c) => <button key={c} title={c} aria-label={tl("Farbe {0}", c)} onClick={() => setInkColor(c)} style={{ width: 16, height: 16, borderRadius: 8, border: c === inkColor ? "2px solid #fff" : "1px solid #888", background: c, cursor: "pointer", padding: 0 }} />)}
      <Button size="small" appearance={captions ? "primary" : "subtle"} icon={<ClosedCaption20Regular />} title={tl("Live-Untertitel")} aria-label={tl("Live-Untertitel")} onClick={() => setCaptions((v) => !v)} />
      <Button size="small" appearance="subtle" icon={<Delete20Regular />} title={tl("Alle Freihandanmerkungen auf der Folie löschen (E)")} aria-label={tl("Freihandanmerkungen löschen")} onClick={() => setInk((x) => ({ ...x, [index]: [] }))} />
    </span>
  );
  const recBadge = rehearse && !ended && (
    <div className="nx-rec" onClick={(e) => e.stopPropagation()}>
      {rehearse === "record" && !recError && <span className="nx-rec-dot" />}
      <span>{rehearse === "record" ? (recError ?? tl("Aufzeichnung läuft")) : rehearse === "coach" ? (speech.error ?? tl("Referentencoach hört zu")) : tl("Probelauf")}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.floor((now - slideStart.current) / 1000)} s</span>
    </div>
  );

  const elapsed = Math.floor((now - started) / 1000);
  const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (presenter) {
    const next = order[pos + 1];
    const mainW = view.w * 0.6;
    return (
      <div className="nx-show nx-presenter">
        <div className="nx-pres-top">
          <Text weight="semibold" style={{ color: "#fff" }}>
            {tl("Folie")} {pos + 1} {tl("von")} {order.length}
          </Text>
          <Text style={{ color: "#c8c8d8", fontVariantNumeric: "tabular-nums" }}>⏱ {clock(elapsed)}</Text>
          <Text style={{ color: "#c8c8d8" }}>{new Date(now).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}</Text>
          <span style={{ flex: 1 }} />
          {isTauri && (
            <Button appearance="primary" icon={<Open24Regular />} onClick={() => void openDocumentWindow("slides", `${SHOW_PREFIX}${channelId.current}`)}>
              {tl("Publikumsansicht öffnen")}
            </Button>
          )}
          {tools}
          <Button appearance="subtle" icon={<Dismiss24Regular />} style={{ color: "#fff" }} onClick={() => void onExit()}>
            {tl("Beenden")}
          </Button>
        </div>
        <div className="nx-pres-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <MediaSyncContext.Provider value={{ muted: audience, onEvent: (shape, action, time) => channel.current?.postMessage({ index, media: { shape, action, time } } satisfies ShowMessage) }}>
              <PresContext.Provider value={presInfo}>
                <Fitted pres={pres} index={index} w={mainW} h={mainW * (pres.height / pres.width)} black={black} built={built} animate={forward} live overlay={overlay} />
              </PresContext.Provider>
            </MediaSyncContext.Provider>
            <div style={{ display: "flex", gap: 8 }}>
              <Button icon={<ArrowLeft24Regular />} onClick={() => go(-1)} disabled={pos === 0}>
                {tl("Zurück")}
              </Button>
              <Button appearance="primary" icon={<ArrowRight24Regular />} iconPosition="after" onClick={() => goOn(1)}>
                {ended ? tl("Ende") : tl("Weiter")}
              </Button>
              <Button onClick={() => setBlack((b) => (b === "black" ? null : "black"))}>{black === "black" ? tl("Bild zeigen") : tl("Schwarz (B)")}</Button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, flex: 1 }}>
            <Text style={{ color: "#c8c8d8" }}>{tl("Nächste Folie")}</Text>
            {next !== undefined ? (
              <PresContext.Provider value={presInfo}>
                <SlideThumb slide={pres.slides[next]} width={view.w * 0.3} presWidth={pres.width} presHeight={pres.height} />
              </PresContext.Provider>
            ) : (
              <div className="nx-pres-end">{tl("Ende der Präsentation")}</div>
            )}
            <Text style={{ color: "#c8c8d8", marginTop: 8 }}>{tl("Notizen")}</Text>
            <div className="nx-pres-notes">{pres.slides[index]?.notes || tl("Keine Notizen")}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nx-show" style={{ cursor: cursor || tool !== "none" ? "default" : "none" }} onClick={() => (ended ? void onExit() : goOn(1))} onContextMenu={(e) => (e.preventDefault(), go(-1))}>
      {recBadge}
      {ended ? (
        <div className="nx-show-end">{tl("Ende der Bildschirmpräsentation. Zum Beenden klicken.")}</div>
      ) : (
        <PresContext.Provider value={presInfo}>
          <Fitted pres={pres} index={index} w={view.w} h={view.h} black={black} built={built} animate={forward} live overlay={overlay} />
        </PresContext.Provider>
      )}
      {captions && !ended && <Captions lines={said} interim={speech.line} error={speech.error} />}
      {cursor && !ended && (
        <div className="nx-show-bar" onClick={(e) => e.stopPropagation()}>
          <Button size="small" appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => go(-1)} />
          <span>
            {pos + 1} / {order.length}
          </span>
          <Button size="small" appearance="subtle" icon={<ArrowRight24Regular />} onClick={() => goOn(1)} />
          {tools}
          <Button size="small" appearance="subtle" icon={<Dismiss24Regular />} onClick={() => void onExit()} />
        </div>
      )}
    </div>
  );
}

/** Second window showing the slides driven by the presenter view. */
export function AudienceWindow({ channelId }: { channelId: string }) {
  const [state, setState] = useState<{ pres: Presentation | null; index: number; black: "black" | "white" | null; built: number; forward: boolean }>({ pres: null, index: 0, black: null, built: 0, forward: true });
  const view = useViewport();
  useEffect(() => {
    void setFullscreen(true);
    const ch = new BroadcastChannel(`ondura-show-${channelId}`);
    ch.onmessage = async (e) => {
      const m = e.data as ShowMessage;
      if (m.end) {
        if (isTauri) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().destroy();
        } else window.close();
        return;
      }
      if (m.media) {
        const { shape, action, time } = m.media;
        document.querySelectorAll<HTMLMediaElement>(`[data-media="${shape}"]`).forEach((el) => {
          if (Math.abs(el.currentTime - time) > 0.3) el.currentTime = time;
          if (action === "play") void el.play().catch(() => {});
          else if (action === "pause") el.pause();
        });
        return;
      }
      setState((s) => ({ pres: m.pres ?? s.pres, index: m.index, black: m.black ?? null, built: m.built ?? 99, forward: m.index !== s.index || (m.built ?? 0) >= s.built }));
    };
    ch.postMessage("hello");
    return () => ch.close();
  }, [channelId]);
  return (
    <div className="nx-show" style={{ cursor: "none" }}>
      {state.pres ? (
        <PresContext.Provider value={{ master: state.pres.master, slides: state.pres.slides, width: state.pres.width, height: state.pres.height }}>
          <Fitted pres={state.pres} index={state.index} w={view.w} h={view.h} black={state.black} built={state.built} animate={state.forward} live />
        </PresContext.Provider>
      ) : (
        <div className="nx-show-end">{tl("Warte auf die Referentenansicht…")}</div>
      )}
    </div>
  );
}

/** Plays the slide's transition or all of its animations once (ribbon preview). */
export function PreviewOverlay({ pres, index, mode, onDone }: { pres: Presentation; index: number; mode: "transition" | "animations"; onDone: () => void }) {
  const slide = pres.slides[index];
  const { groups } = animationSteps(slide);
  // Animations: every click group starts when the previous one has ended.
  const anims = new Map<number, ShapeAnim[]>();
  let offset = 0;
  if (mode === "animations")
    for (const g of groups) {
      let end = offset;
      for (const x of g) {
        const prev = anims.get(x.shape) ?? [];
        // Consecutive motion paths continue where the previous one ended.
        const start = prev.filter((p) => p.path).reduce<[number, number]>((acc, p) => {
          const e = pathEnd(p.path!);
          return [acc[0] + e[0], acc[1] + e[1]];
        }, [0, 0]);
        anims.set(x.shape, [...prev, { ...x.anim, delay: offset + x.anim.delay, start: x.anim.path ? start : undefined }]);
        end = Math.max(end, offset + x.anim.delay + (x.anim.effect === "appear" ? 1 : x.anim.duration));
      }
      offset = end + 300;
    }
  const total = mode === "transition" ? (slide?.transition?.duration ?? 0) + 200 : offset + 200;
  useEffect(() => {
    const t = setTimeout(onDone, total);
    return () => clearTimeout(t);
  }, [onDone, total]);
  if (!slide) return null;
  const prev = index > 0 ? pres.slides[index - 1] : null;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, overflow: "hidden", background: "#000" }}>
      {mode === "transition" && (
        <div className="nx-tr-layer" style={transitionStyle(slide.transition, false) ?? undefined}>
          {prev ? <SlideView slide={prev} width={pres.width} height={pres.height} /> : <div style={{ width: pres.width, height: pres.height, background: "#000" }} />}
        </div>
      )}
      <div className="nx-tr-layer" style={mode === "transition" ? transitionStyle(slide.transition, true) ?? undefined : undefined}>
        <SlideView slide={slide} width={pres.width} height={pres.height} anims={anims} />
      </div>
    </div>
  );
}
