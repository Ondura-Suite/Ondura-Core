// Dialogs of the presentation app: shape links, video export and keeping
// the ink of a slide show.

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Option, ProgressBar, Radio, RadioGroup, SpinButton } from "@fluentui/react-components";
import type { VideoOptions } from "./video";
import { tl } from "../../lib/i18n";

function Frame({ title, children, actions, onClose, width = 440 }: { title: string; children: React.ReactNode; actions: React.ReactNode; onClose: () => void; width?: number }) {
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Click action of a shape: a web address or a slide of the presentation. */
export function LinkDialog(p: { open: boolean; link: string | undefined; slideTitles: string[]; onClose: () => void; onApply: (link: string | null) => void }) {
  const [mode, setMode] = useState<"url" | "slide">("url");
  const [url, setUrl] = useState("");
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (!p.open) return;
    const m = p.link?.match(/^slide:(\d+)$/);
    setMode(m ? "slide" : "url");
    setUrl(m ? "" : (p.link ?? ""));
    setSlide(m ? Number(m[1]) : 0);
  }, [p.open, p.link]);
  if (!p.open) return null;
  const value = mode === "slide" ? `slide:${slide}` : url.trim() && !/^[a-z]+:/i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
  const label = (i: number) => tl("Folie {0}{1}", i + 1, p.slideTitles[i] ? `: ${p.slideTitles[i]}` : "");
  return (
    <Frame
      title={tl("Link einfügen")}
      onClose={p.onClose}
      actions={
        <>
          {p.link && <Button onClick={() => p.onApply(null)}>{tl("Link entfernen")}</Button>}
          <Button onClick={p.onClose}>{tl("Abbrechen")}</Button>
          <Button appearance="primary" disabled={!value} onClick={() => p.onApply(value)}>
            {tl("OK")}
          </Button>
        </>
      }
    >
      <RadioGroup layout="horizontal" value={mode} onChange={(_, d) => setMode(d.value as "url" | "slide")}>
        <Radio value="url" label={tl("Webseite oder Adresse")} />
        <Radio value="slide" label={tl("Folie in dieser Präsentation")} />
      </RadioGroup>
      {mode === "url" ? (
        <Field label={tl("Adresse")}>
          <Input value={url} placeholder="https://…" autoFocus onChange={(_, d) => setUrl(d.value)} />
        </Field>
      ) : (
        <Field label={tl("Folie")}>
          <Dropdown value={label(slide)} selectedOptions={[String(slide)]} onOptionSelect={(_, d) => setSlide(Number(d.optionValue))}>
            {p.slideTitles.map((_, i) => (
              <Option key={i} value={String(i)}>
                {label(i)}
              </Option>
            ))}
          </Dropdown>
        </Field>
      )}
    </Frame>
  );
}

const SIZES = [
  { h: 1080, label: tl("Full HD (1080p)") },
  { h: 720, label: tl("HD (720p)") },
  { h: 480, label: tl("Standard (480p)") },
];

/** Options and progress of the video export. */
export function VideoDialog(p: { open: boolean; hasTimings: boolean; progress: number | null; onClose: () => void; onStart: (o: VideoOptions) => void }) {
  const [height, setHeight] = useState(720);
  const [seconds, setSeconds] = useState(5);
  const [useTimings, setUseTimings] = useState(true);
  if (!p.open) return null;
  const busy = p.progress !== null;
  return (
    <Frame
      title={tl("Als Video exportieren")}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>{busy ? tl("Abbrechen") : tl("Schließen")}</Button>
          <Button appearance="primary" disabled={busy} onClick={() => p.onStart({ height, seconds, useTimings: useTimings && p.hasTimings, fps: 30 })}>
            {tl("Exportieren")}
          </Button>
        </>
      }
    >
      <Field label={tl("Auflösung")}>
        <Dropdown disabled={busy} value={SIZES.find((x) => x.h === height)?.label} selectedOptions={[String(height)]} onOptionSelect={(_, d) => setHeight(Number(d.optionValue))}>
          {SIZES.map((x) => (
            <Option key={x.h} value={String(x.h)}>
              {x.label}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <Field label={tl("Sekunden pro Folie")}>
        <SpinButton disabled={busy} value={seconds} min={1} max={120} step={0.5} onChange={(_, d) => setSeconds(d.value ?? (Number(d.displayValue) || seconds))} />
      </Field>
      <Checkbox disabled={busy || !p.hasTimings} checked={useTimings && p.hasTimings} label={tl("Aufgezeichnete Zeiten und Kommentare verwenden")} onChange={(_, d) => setUseTimings(!!d.checked)} />
      {busy && (
        <Field label={tl("Video wird aufgezeichnet … (dauert so lange wie die Präsentation)")} validationState="none">
          <ProgressBar value={p.progress ?? 0} />
        </Field>
      )}
    </Frame>
  );
}

/** After a show with ink: keep it on the slides? */
export function KeepInkDialog(p: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  if (!p.open) return null;
  return (
    <Frame
      title={tl("Freihandanmerkungen")}
      onClose={p.onDiscard}
      actions={
        <>
          <Button onClick={p.onDiscard}>{tl("Verwerfen")}</Button>
          <Button appearance="primary" onClick={p.onKeep}>
            {tl("Beibehalten")}
          </Button>
        </>
      }
    >
      {tl("Möchten Sie Ihre Freihandanmerkungen beibehalten?")}
    </Frame>
  );
}
