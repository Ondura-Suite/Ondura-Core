// Slide show, presenter view and the audience window (second screen).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import { ArrowLeft24Regular, ArrowRight24Regular, Dismiss24Regular, Open24Regular } from "@fluentui/react-icons";
import { isTauri } from "../../lib/api";
import { openDocumentWindow } from "../../lib/office";
import type { Presentation } from "./model";
import { SlideThumb, SlideView } from "./SlideView";

export const SHOW_PREFIX = "nexora-show:";

interface ShowMessage {
  pres?: Presentation;
  index: number;
  black?: "black" | "white" | null;
  end?: boolean;
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

/** A slide scaled to fit a box, with a fade between slides. */
function Fitted({ pres, index, w, h, black }: { pres: Presentation; index: number; w: number; h: number; black?: "black" | "white" | null }) {
  const scale = Math.min(w / pres.width, h / pres.height);
  const slide = pres.slides[index];
  return (
    <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", position: "relative" }}>
      <div key={index} className="nx-show-fade" style={{ width: pres.width * scale, height: pres.height * scale, overflow: "hidden" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: pres.width, height: pres.height }}>{slide && <SlideView slide={slide} width={pres.width} height={pres.height} />}</div>
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
  const [typed, setTyped] = useState("");
  const [started] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [cursor, setCursor] = useState(true);
  const view = useViewport();
  const channel = useRef<BroadcastChannel | null>(null);
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
      if (e.data === "hello") ch.postMessage({ pres, index, black } satisfies ShowMessage);
    };
    return () => {
      ch.postMessage({ index: 0, end: true } satisfies ShowMessage);
      ch.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter]);
  useEffect(() => {
    channel.current?.postMessage({ index, black } satisfies ShowMessage);
  }, [index, black]);

  const go = useCallback(
    (d: number) => {
      setBlack(null);
      setPos((p) => {
        const n = p + d;
        if (n >= order.length) {
          setEnded(true);
          return p;
        }
        setEnded(false);
        return Math.max(0, n);
      });
    },
    [order.length],
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
        if (p >= 0) (setPos(p), setEnded(false));
        return;
      }
      if (["ArrowRight", "ArrowDown", " ", "Enter", "PageDown", "n", "N"].includes(k)) go(1);
      else if (["ArrowLeft", "ArrowUp", "Backspace", "PageUp", "p", "P"].includes(k)) go(-1);
      else if (k === "Home") (setPos(0), setEnded(false));
      else if (k === "End") (setPos(order.length - 1), setEnded(false));
      else if (k === "b" || k === "B" || k === ".") setBlack((b) => (b === "black" ? null : "black"));
      else if (k === "w" || k === "W" || k === ",") setBlack((b) => (b === "white" ? null : "white"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit, ended, typed, order]);

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
            <Fitted pres={pres} index={index} w={mainW} h={mainW * (pres.height / pres.width)} black={black} />
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
        <Fitted pres={pres} index={index} w={view.w} h={view.h} black={black} />
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
  const [state, setState] = useState<{ pres: Presentation | null; index: number; black: "black" | "white" | null }>({ pres: null, index: 0, black: null });
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
      setState((s) => ({ pres: m.pres ?? s.pres, index: m.index, black: m.black ?? null }));
    };
    ch.postMessage("hello");
    return () => ch.close();
  }, [channelId]);
  return (
    <div className="nx-show" style={{ cursor: "none" }}>
      {state.pres ? <Fitted pres={state.pres} index={state.index} w={view.w} h={view.h} black={state.black} /> : <div className="nx-show-end">Warte auf die Referentenansicht…</div>}
    </div>
  );
}
