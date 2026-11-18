// Video export: every slide is drawn to a canvas (as SVG with the slide's
// HTML) and recorded in real time with MediaRecorder, including recorded
// narration. Slides change with a short cross-fade.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Presentation } from "./model";
import { PresContext, SlideView } from "./SlideView";
import { tl } from "../../lib/i18n";

export interface VideoOptions {
  /** Output height (width follows the slide ratio). */
  height: number;
  /** Seconds per slide without its own timing. */
  seconds: number;
  /** Use the slides' rehearsed timings. */
  useTimings: boolean;
  fps: number;
}

/** A container the browser can record, with its file extension. */
export function videoFormat(audio = false): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [
    ...(audio ? ([["video/mp4;codecs=avc1,mp4a.40.2", "mp4"]] as const) : ([["video/mp4;codecs=avc1", "mp4"]] as const)),
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ] as const)
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

/** Renders a slide to an image of the given size. */
async function slideImage(pres: Presentation, index: number, w: number, h: number): Promise<HTMLImageElement> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${pres.width}px;height:${pres.height}px;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(createElement(PresContext.Provider, { value: { master: pres.master, slides: pres.slides, width: pres.width, height: pres.height } }, createElement(SlideView, { slide: pres.slides[index], width: pres.width, height: pres.height }))),
    );
    await Promise.all(Array.from(host.querySelectorAll("img")).map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r))))));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const node = host.firstElementChild as HTMLElement;
    // Videos show their poster picture.
    node.querySelectorAll("video, audio").forEach((m) => m.remove());
    const html = new XMLSerializer().serializeToString(node);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${pres.width} ${pres.height}"><foreignObject x="0" y="0" width="${pres.width}" height="${pres.height}">${html}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    return img;
  } finally {
    root.unmount();
    host.remove();
  }
}

async function decodeAudio(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    return await ctx.decodeAudioData(buf);
  } catch {
    return null;
  }
}

/**
 * Records the presentation; `onProgress` gets 0…1. Rejects when the browser
 * cannot record (no MediaRecorder, or the canvas may not be captured).
 */
export async function exportVideo(pres: Presentation, opt: VideoOptions, onProgress: (f: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; ext: string }> {
  if (!videoFormat()) throw new Error(tl("Dieses System kann keine Videos aufzeichnen."));
  const h = Math.round(opt.height / 2) * 2;
  const w = Math.round((h * pres.width) / pres.height / 2) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const slides = pres.slides.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
  if (!slides.length) throw new Error(tl("Keine sichtbaren Folien."));

  onProgress(0);
  // Rasterised once: drawing the SVG pictures each frame would be too slow.
  const images: HTMLCanvasElement[] = [];
  for (const { i } of slides) {
    const img = await slideImage(pres, i, w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    images.push(c);
  }
  g.drawImage(images[0], 0, 0, w, h);
  try {
    images[0].toDataURL();
    canvas.toDataURL();
  } catch {
    throw new Error(tl("Die Folien können auf diesem System nicht als Video aufgezeichnet werden."));
  }

  // Narration: autoplaying audio of each slide.
  const audio = new AudioContext();
  const dest = audio.createMediaStreamDestination();
  const narration = await Promise.all(
    slides.map(async ({ s }) => {
      const a = s.shapes.find((x) => x.autoplay && x.media && x.mediaKind === "audio");
      return a?.media ? decodeAudio(audio, a.media) : null;
    }),
  );
  const durations = slides.map(({ s }, k) => {
    const own = opt.useTimings && s.transition?.advanceAfter ? s.transition.advanceAfter / 1000 : opt.seconds;
    return Math.max(own, (narration[k]?.duration ?? 0) + 0.3);
  });
  const total = durations.reduce((a, b) => a + b, 0);

  // Frames are pushed explicitly: an unchanged canvas would not produce any.
  const format = videoFormat(narration.some(Boolean))!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  // An audio track only with narration (a silent one disturbs some encoders).
  if (narration.some(Boolean)) dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: Math.round(w * h * opt.fps * 0.12) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  rec.start(1000);

  const fade = 0.5;
  const start = performance.now();
  let k = 0;
  let slideStart = 0;
  let playing = -1;
  let tick = 0;
  await new Promise<void>((resolve) => {
    const frame = () => {
      if (signal?.aborted) return resolve();
      const t = (performance.now() - start) / 1000;
      while (k < slides.length - 1 && t >= slideStart + durations[k]) slideStart += durations[k++];
      if (playing !== k) {
        playing = k;
        const buf = narration[k];
        if (buf) {
          const src = audio.createBufferSource();
          src.buffer = buf;
          src.connect(dest);
          src.start();
        }
      }
      const into = t - slideStart;
      g.globalAlpha = 1;
      if (k > 0 && into < fade) {
        g.drawImage(images[k - 1], 0, 0, w, h);
        g.globalAlpha = into / fade;
      }
      g.drawImage(images[k], 0, 0, w, h);
      // An invisible change, so every frame is encoded (unchanged canvases are skipped).
      g.globalAlpha = 1;
      g.fillStyle = (tick++ & 1) ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.02)";
      g.fillRect(w - 1, h - 1, 1, 1);
      track.requestFrame?.();
      // Progress at most a few times a second (it re-renders the app).
      if (tick % 8 === 0) onProgress(Math.min(1, t / total));
      if (t >= total) return resolve();
      setTimeout(frame, 1000 / opt.fps);
    };
    frame();
  });
  rec.stop();
  await done;
  void audio.close();
  if (signal?.aborted) throw new Error(tl("Abgebrochen"));
  return { blob: new Blob(chunks, { type: format.mime.split(";")[0] }), ext: format.ext };
}
