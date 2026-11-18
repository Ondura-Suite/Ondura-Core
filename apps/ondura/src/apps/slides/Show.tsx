// Slide show, presenter view and the audience window (second screen).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import { ArrowLeft24Regular, ArrowRight24Regular, Dismiss24Regular, Open24Regular } from "@fluentui/react-icons";
import { isTauri } from "../../lib/api";
import { openDocumentWindow } from "../../lib/office";
import { type Presentation, type Slide, type Transition, pathEnd } from "./model";
import { MediaSyncContext, type ShapeAnim, SlideThumb, SlideView } from "./SlideView";

export const SHOW_PREFIX = "nexora-show:";

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

function transitionStyle(t: Transition | undefined, entering: boolean): React.CSSProperties | null {
  if (!t || t.kind === "cut") return null;
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
function Fitted({ pres, index, w, h, black, built = 99, animate = false, live = false }: { pres: Presentation; index: number; w: number; h: number; black?: "black" | "white" | null; built?: number; animate?: boolean; live?: boolean }) {
  const scale = Math.min(w / pres.width, h / pres.height);
  const slide = pres.slides[index];
  const [prev, setPrev] = useState<{ index: number; built: number } | null>(null);
  const last = useRef({ index, built });
  useEffect(() => {
    const before = last.current;
    last.current = { index, built };
    if (before.index === index) return;
    const t = pres.slides[index]?.transition;
    if (!t || t.kind === "cut") return setPrev(null);
    setPrev(before);
    const timer = setTimeout(() => setPrev(null), t.duration + 50);
    return () => clearTimeout(timer);
  }, [index, built, pres]);
  const transition = prev ? slide?.transition : undefined;
  const now = stepState(slide, built, animate);
  const old = prev ? stepState(pres.slides[prev.index], prev.built, false) : null;
  const layer = (i: number, st: { hidden: Set<number>; anims: Map<number, ShapeAnim[]>; offsets?: Map<number, [number, number]> }, style: React.CSSProperties | null, key: string, live = false) => (
    <div key={key} className="nx-tr-layer" style={style ?? undefined}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: pres.width, height: pres.height }}>
        {pres.slides[i] && <SlideView slide={pres.slides[i]} width={pres.width} height={pres.height} hiddenShapes={st.hidden} anims={st.anims} offsets={st.offsets} live={live} />}
      </div>
    </div>
  );
  return (
    <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", position: "relative" }}>
      <div style={{ width: pres.width * scale, height: pres.height * scale, overflow: "hidden", position: "relative" }}>
        {prev && old && layer(prev.index, old, transitionStyle(transition, false), `old-${prev.index}`)}
        {layer(index, now, prev ? transitionStyle(transition, true) : null, `cur-${index}`, live)}
      </div>
      {black && <div style={{ position: "absolute", inset: 0, background: black }} />}
    </div>
  );
}

function visibleSlides(pres: Presentation) {
  return pres.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);
}

export function SlideShow({ pres, start, presenter, onExit }: { pres: Presentation; start: number; presenter: boolean; onExit: () => void }) {
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

  useEffect(() => {
    void setFullscreen(true);
    return () => void setFullscreen(false);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Audience window (presenter view).
  const channelId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    if (!presenter) return;
    const ch = new BroadcastChannel(`nexora-show-${channelId.current}`);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Escape") return onExit();
      if (ended && ["ArrowRight", " ", "Enter", "PageDown", "n", "N"].includes(k)) return onExit();
      if (/^\d$/.test(k)) return setTyped((t) => t + k);
      if (k === "Enter" && typed) {
        const n = parseInt(typed, 10) - 1;
        setTyped("");
        const p = order.indexOf(n);
        if (p >= 0) enter(p);
        return;
      }
      if (["ArrowRight", "ArrowDown", " ", "Enter", "PageDown", "n", "N"].includes(k)) go(1);
      else if (["ArrowLeft", "ArrowUp", "Backspace", "PageUp", "p", "P"].includes(k)) go(-1);
      else if (k === "Home") enter(0);
      else if (k === "End") enter(order.length - 1, true);
      else if (k === "b" || k === "B" || k === ".") setBlack((b) => (b === "black" ? null : "black"));
      else if (k === "w" || k === "W" || k === ",") setBlack((b) => (b === "white" ? null : "white"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit, ended, typed, order, enter]);

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

  const elapsed = Math.floor((now - started) / 1000);
  const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (presenter) {
    const next = order[pos + 1];
    const mainW = view.w * 0.6;
    return (
      <div className="nx-show nx-presenter">
        <div className="nx-pres-top">
          <Text weight="semibold" style={{ color: "#fff" }}>
            Folie {pos + 1} von {order.length}
          </Text>
          <Text style={{ color: "#c8c8d8", fontVariantNumeric: "tabular-nums" }}>⏱ {clock(elapsed)}</Text>
          <Text style={{ color: "#c8c8d8" }}>{new Date(now).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</Text>
          <span style={{ flex: 1 }} />
          {isTauri && (
            <Button appearance="primary" icon={<Open24Regular />} onClick={() => void openDocumentWindow("slides", `${SHOW_PREFIX}${channelId.current}`)}>
              Publikumsansicht öffnen
            </Button>
          )}
          <Button appearance="subtle" icon={<Dismiss24Regular />} style={{ color: "#fff" }} onClick={onExit}>
            Beenden
          </Button>
        </div>
        <div className="nx-pres-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <MediaSyncContext.Provider value={{ muted: audience, onEvent: (shape, action, time) => channel.current?.postMessage({ index, media: { shape, action, time } } satisfies ShowMessage) }}>
              <Fitted pres={pres} index={index} w={mainW} h={mainW * (pres.height / pres.width)} black={black} built={built} animate={forward} live />
            </MediaSyncContext.Provider>
            <div style={{ display: "flex", gap: 8 }}>
              <Button icon={<ArrowLeft24Regular />} onClick={() => go(-1)} disabled={pos === 0}>
                Zurück
              </Button>
              <Button appearance="primary" icon={<ArrowRight24Regular />} iconPosition="after" onClick={() => go(1)}>
                {ended ? "Ende" : "Weiter"}
              </Button>
              <Button onClick={() => setBlack((b) => (b === "black" ? null : "black"))}>{black === "black" ? "Bild zeigen" : "Schwarz (B)"}</Button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, flex: 1 }}>
            <Text style={{ color: "#c8c8d8" }}>Nächste Folie</Text>
            {next !== undefined ? <SlideThumb slide={pres.slides[next]} width={view.w * 0.3} presWidth={pres.width} presHeight={pres.height} /> : <div className="nx-pres-end">Ende der Präsentation</div>}
            <Text style={{ color: "#c8c8d8", marginTop: 8 }}>Notizen</Text>
            <div className="nx-pres-notes">{pres.slides[index]?.notes || "Keine Notizen"}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nx-show" style={{ cursor: cursor ? "default" : "none" }} onClick={() => (ended ? onExit() : go(1))} onContextMenu={(e) => (e.preventDefault(), go(-1))}>
      {ended ? (
        <div className="nx-show-end">Ende der Bildschirmpräsentation. Zum Beenden klicken.</div>
      ) : (
        <Fitted pres={pres} index={index} w={view.w} h={view.h} black={black} built={built} animate={forward} live />
      )}
      {cursor && !ended && (
        <div className="nx-show-bar" onClick={(e) => e.stopPropagation()}>
          <Button size="small" appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => go(-1)} />
          <span>
            {pos + 1} / {order.length}
          </span>
          <Button size="small" appearance="subtle" icon={<ArrowRight24Regular />} onClick={() => go(1)} />
          <Button size="small" appearance="subtle" icon={<Dismiss24Regular />} onClick={onExit} />
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
    const ch = new BroadcastChannel(`nexora-show-${channelId}`);
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
      {state.pres ? <Fitted pres={state.pres} index={state.index} w={view.w} h={view.h} black={state.black} built={state.built} animate={state.forward} live /> : <div className="nx-show-end">Warte auf die Referentenansicht…</div>}
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
