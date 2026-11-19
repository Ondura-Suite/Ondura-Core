// Dialogs of Ondura PDF: page numbers, watermark, password protection,
// splitting, the handwritten signature pad and the digital signature.

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Slider,
  SpinButton,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Certificate24Regular } from "@fluentui/react-icons";
import { api, errorMessage } from "../../lib/api";
import type { CertInfo } from "../../lib/types";
import { LOCALE, tl } from "../../lib/i18n";
import type { Corner, PageNumberOptions, Protection, WatermarkOptions } from "./ops";

const useStyles = makeStyles({
  col: { display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" },
  pad: {
    width: "100%",
    height: "180px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: "#ffffff",
    touchAction: "none",
    cursor: "crosshair",
  },
  typed: {
    height: "180px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: "#ffffff",
    color: "#1b2a5a",
    fontSize: "44px",
    overflow: "hidden",
  },
  cert: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
  },
  certOn: { border: `2px solid ${tokens.colorBrandStroke1}`, padding: "7px 9px", backgroundColor: tokens.colorBrandBackground2 },
  muted: { color: tokens.colorNeutralForeground3 },
});

const SCRIPT_FONT = '"Segoe Script", "Brush Script MT", "Lucida Handwriting", "Apple Chancery", cursive';

// --------------------------------------------------------- page numbers --

export function PageNumbersDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (o: PageNumberOptions) => void }) {
  const s = useStyles();
  const [position, setPosition] = useState<Corner>("bottom-center");
  const [format, setFormat] = useState(tl("Seite {n} von {total}"));
  const [size, setSize] = useState(10);
  const [from, setFrom] = useState(1);
  const positions: [Corner, string][] = [
    ["bottom-center", tl("Unten Mitte")],
    ["bottom-right", tl("Unten rechts")],
    ["bottom-left", tl("Unten links")],
    ["top-center", tl("Oben Mitte")],
    ["top-right", tl("Oben rechts")],
    ["top-left", tl("Oben links")],
  ];
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Seitenzahlen einfügen")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Position")}>
              <Dropdown value={positions.find((p) => p[0] === position)?.[1]} selectedOptions={[position]} onOptionSelect={(_, d) => setPosition(d.optionValue as Corner)}>
                {positions.map(([v, l]) => (
                  <Option key={v} value={v}>
                    {l}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={tl("Format")} hint={tl("{n} = Seitenzahl, {total} = Anzahl der Seiten")}>
              <Input value={format} onChange={(_, d) => setFormat(d.value)} />
            </Field>
            <div className={s.row}>
              <Field label={tl("Schriftgröße")}>
                <SpinButton value={size} min={6} max={36} onChange={(_, d) => setSize(d.value ?? Number(d.displayValue) ?? size)} />
              </Field>
              <Field label={tl("Ab Seite")}>
                <SpinButton value={from} min={1} onChange={(_, d) => setFrom(d.value ?? Number(d.displayValue) ?? from)} />
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => onApply({ position, format, size, from: Math.max(0, from - 1), startAt: 1 })}>
              {tl("Einfügen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ watermark --

export function WatermarkDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (o: WatermarkOptions) => void }) {
  const s = useStyles();
  const [text, setText] = useState(tl("ENTWURF"));
  const [size, setSize] = useState(72);
  const [opacity, setOpacity] = useState(20);
  const [color, setColor] = useState("#c4314b");
  const [diagonal, setDiagonal] = useState(true);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Wasserzeichen")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Text")}>
              <Input value={text} onChange={(_, d) => setText(d.value)} />
            </Field>
            <div className={s.row}>
              <Field label={tl("Schriftgröße")}>
                <SpinButton value={size} min={12} max={200} onChange={(_, d) => setSize(d.value ?? Number(d.displayValue) ?? size)} />
              </Field>
              <Field label={tl("Farbe")}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 48, height: 32, border: "none", background: "none" }} />
              </Field>
            </div>
            <Field label={tl("Deckkraft: {0} %", opacity)}>
              <Slider min={5} max={100} value={opacity} onChange={(_, d) => setOpacity(d.value)} />
            </Field>
            <Checkbox checked={diagonal} onChange={(_, d) => setDiagonal(!!d.checked)} label={tl("Diagonal")} />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!text.trim()} onClick={() => onApply({ text, size, opacity: opacity / 100, color, diagonal })}>
              {tl("Einfügen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------ protection --

export function ProtectDialog({ open, current, onClose, onApply }: { open: boolean; current: Protection | null; onClose: () => void; onApply: (p: Protection | null) => void }) {
  const s = useStyles();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [owner, setOwner] = useState("");
  const [printing, setPrinting] = useState(true);
  const [copying, setCopying] = useState(false);
  const [modifying, setModifying] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPw(current?.openPassword ?? "");
    setPw2(current?.openPassword ?? "");
    setOwner(current?.ownerPassword ?? "");
    setPrinting(current?.printing ?? true);
    setCopying(current?.copying ?? false);
    setModifying(current?.modifying ?? false);
  }, [open, current]);
  const mismatch = pw !== pw2;
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 500 }}>
        <DialogBody>
          <DialogTitle>{tl("Mit Kennwort schützen")}</DialogTitle>
          <DialogContent className={s.col}>
            <Text>{tl("Das PDF wird beim Speichern mit AES-256 verschlüsselt.")}</Text>
            <Field label={tl("Kennwort zum Öffnen")} hint={tl("Leer lassen, wenn jeder das PDF öffnen darf und nur die Rechte eingeschränkt werden sollen.")}>
              <Input type="password" value={pw} onChange={(_, d) => setPw(d.value)} />
            </Field>
            <Field label={tl("Kennwort bestätigen")} validationState={mismatch ? "error" : "none"} validationMessage={mismatch ? tl("Die Kennwörter stimmen nicht überein.") : undefined}>
              <Input type="password" value={pw2} onChange={(_, d) => setPw2(d.value)} />
            </Field>
            <Field label={tl("Kennwort für Berechtigungen")} hint={tl("Wer es kennt, darf alles. Ohne eigenes Kennwort gilt das Kennwort zum Öffnen.")}>
              <Input type="password" value={owner} onChange={(_, d) => setOwner(d.value)} />
            </Field>
            <Checkbox checked={printing} onChange={(_, d) => setPrinting(!!d.checked)} label={tl("Drucken erlauben")} />
            <Checkbox checked={copying} onChange={(_, d) => setCopying(!!d.checked)} label={tl("Kopieren von Text und Bildern erlauben")} />
            <Checkbox checked={modifying} onChange={(_, d) => setModifying(!!d.checked)} label={tl("Bearbeiten und Kommentieren erlauben")} />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={mismatch || (!pw && !owner)} onClick={() => onApply({ openPassword: pw, ownerPassword: owner || undefined, printing, copying, modifying })}>
              {tl("Schützen")}
            </Button>
            {current && <Button onClick={() => onApply(null)}>{tl("Schutz entfernen")}</Button>}
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------------ split --

export function SplitDialog({ open, pages, onClose, onApply }: { open: boolean; pages: number; onClose: () => void; onApply: (every: number) => void }) {
  const s = useStyles();
  const [every, setEvery] = useState(1);
  const parts = Math.ceil(pages / Math.max(1, every));
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{tl("PDF teilen")}</DialogTitle>
          <DialogContent className={s.col}>
            <Field label={tl("Seiten pro Datei")}>
              <SpinButton value={every} min={1} max={Math.max(1, pages)} onChange={(_, d) => setEvery(d.value ?? Number(d.displayValue) ?? every)} />
            </Field>
            <Text className={s.muted}>{tl("Ergibt {0} Dateien. Sie wählen gleich den Ordner und den Namen.", parts)}</Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => onApply(Math.max(1, every))}>
              {tl("Teilen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ----------------------------------------------------- handwritten signature --

const SIGNATURE_KEY = "ondura.pdf.signature";

export function savedSignature(): string | null {
  try {
    return localStorage.getItem(SIGNATURE_KEY);
  } catch {
    return null;
  }
}

/** Trims transparent margins of a canvas and returns a PNG data URL. */
function trimmed(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 2 * pad;
  out.height = y1 - y0 + 2 * pad;
  out.getContext("2d")!.drawImage(canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Signature pad: draw, type or load an image. Resolves a PNG data URL. */
export function SignaturePadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (png: string) => void }) {
  const s = useStyles();
  const [mode, setMode] = useState<"draw" | "type" | "saved">(savedSignature() ? "saved" : "draw");
  const [typed, setTyped] = useState("");
  const [keep, setKeep] = useState(true);
  const [empty, setEmpty] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const saved = savedSignature();

  useEffect(() => {
    if (!open) return;
    setMode(savedSignature() ? "saved" : "draw");
    setEmpty(true);
  }, [open]);

  const setup = (c: HTMLCanvasElement | null) => {
    canvas.current = c;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width * 2)) {
      c.width = Math.round(r.width * 2);
      c.height = Math.round(r.height * 2);
    }
  };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = point(e);
    ctx.strokeStyle = "#1b2a5a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setEmpty(false);
  };

  const finish = () => {
    let png: string | null = null;
    if (mode === "saved") png = saved;
    else if (mode === "draw" && canvas.current) png = trimmed(canvas.current);
    else if (mode === "type" && typed.trim()) {
      const c = document.createElement("canvas");
      c.width = 1200;
      c.height = 300;
      const ctx = c.getContext("2d")!;
      ctx.font = `150px ${SCRIPT_FONT}`;
      ctx.fillStyle = "#1b2a5a";
      ctx.textBaseline = "middle";
      ctx.fillText(typed.trim(), 20, 150, 1160);
      png = trimmed(c);
    }
    if (!png) return;
    if (keep && mode !== "saved") {
      try {
        localStorage.setItem(SIGNATURE_KEY, png);
      } catch {
        /* storage full */
      }
    }
    onDone(png);
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Unterschrift")}</DialogTitle>
          <DialogContent className={s.col}>
            <TabList selectedValue={mode} onTabSelect={(_, d) => setMode(d.value as typeof mode)}>
              {saved && <Tab value="saved">{tl("Gespeichert")}</Tab>}
              <Tab value="draw">{tl("Zeichnen")}</Tab>
              <Tab value="type">{tl("Eingeben")}</Tab>
            </TabList>
            {mode === "saved" && saved && (
              <div className={s.typed}>
                <img src={saved} alt={tl("Gespeicherte Unterschrift")} style={{ maxWidth: "90%", maxHeight: "80%" }} />
              </div>
            )}
            {mode === "draw" && (
              <>
                <canvas
                  ref={setup}
                  className={s.pad}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    last.current = point(e);
                  }}
                  onPointerMove={draw}
                  onPointerUp={() => (last.current = null)}
                />
                <div className={s.row}>
                  <Text className={s.muted}>{tl("Mit Maus, Stift oder Finger unterschreiben.")}</Text>
                  <Button
                    size="small"
                    onClick={() => {
                      const c = canvas.current;
                      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
                      setEmpty(true);
                    }}
                  >
                    {tl("Löschen")}
                  </Button>
                </div>
              </>
            )}
            {mode === "type" && (
              <>
                <Input value={typed} onChange={(_, d) => setTyped(d.value)} placeholder={tl("Ihr Name")} />
                <div className={s.typed} style={{ fontFamily: SCRIPT_FONT }}>
                  {typed || " "}
                </div>
              </>
            )}
            {mode !== "saved" && <Checkbox checked={keep} onChange={(_, d) => setKeep(!!d.checked)} label={tl("Unterschrift auf diesem Gerät merken")} />}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={(mode === "draw" && empty) || (mode === "type" && !typed.trim())} onClick={finish}>
              {tl("Einfügen")}
            </Button>
            {mode === "saved" && (
              <Button
                onClick={() => {
                  localStorage.removeItem(SIGNATURE_KEY);
                  setMode("draw");
                }}
              >
                {tl("Vergessen")}
              </Button>
            )}
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------ digital signature --

export interface DigitalSignRequest {
  cert: CertInfo;
  reason: string;
  location: string;
  visible: boolean;
  withImage: boolean;
}

const certName = (c: CertInfo) => /CN=([^,]+)/.exec(c.subject)?.[1] ?? c.subject;
export { certName };

export function DigitalSignDialog({ open, onClose, onSign }: { open: boolean; onClose: () => void; onSign: (r: DigitalSignRequest) => void }) {
  const s = useStyles();
  const [certs, setCerts] = useState<CertInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [visible, setVisible] = useState(true);
  const [withImage, setWithImage] = useState(!!savedSignature());
  const [importing, setImporting] = useState<{ data: string; name: string } | null>(null);
  const [importPw, setImportPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = () =>
    api.smimeIdentities().then((list) => {
      setCerts(list);
      setSelected((cur) => cur ?? list.find((c) => new Date(c.notAfter) > new Date())?.fingerprint ?? list[0]?.fingerprint ?? null);
    }, () => setCerts([]));
  useEffect(() => {
    if (open) {
      setError(null);
      void load();
    }
  }, [open]);

  const doImport = async () => {
    if (!importing) return;
    try {
      const c = await api.smimeImport(importing.data, importPw, true);
      setImporting(null);
      setImportPw("");
      setSelected(c.fingerprint);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const cert = certs?.find((c) => c.fingerprint === selected) ?? null;
  const expired = cert ? new Date(cert.notAfter) < new Date() : false;

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Digital signieren")}</DialogTitle>
          <DialogContent className={s.col}>
            <Text>{tl("Eine digitale Signatur belegt, wer das PDF signiert hat und dass es danach nicht verändert wurde. Sie brauchen dafür ein Zertifikat (.p12/.pfx).")}</Text>
            {certs?.length === 0 && !importing && (
              <MessageBar intent="info">
                <MessageBarBody>{tl("Noch kein Zertifikat vorhanden. Importieren Sie eines – es steht dann auch für signierte E-Mails bereit.")}</MessageBarBody>
              </MessageBar>
            )}
            {certs && certs.length > 0 && (
              <RadioGroup value={selected ?? ""} onChange={(_, d) => setSelected(d.value)}>
                {certs.map((c) => (
                  <label key={c.fingerprint} className={`${s.cert} ${selected === c.fingerprint ? s.certOn : ""}`}>
                    <Radio value={c.fingerprint} />
                    <Certificate24Regular />
                    <span>
                      <Text weight="semibold" block>
                        {certName(c)}
                      </Text>
                      <Text size={200} className={s.muted} block>
                        {tl("Ausgestellt von {0} · gültig bis {1}", /CN=([^,]+)/.exec(c.issuer)?.[1] ?? c.issuer, new Date(c.notAfter).toLocaleDateString(LOCALE))}
                        {c.trusted === false ? ` · ${tl("nicht vertrauenswürdig")}` : ""}
                      </Text>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            )}
            {importing ? (
              <div className={s.row}>
                <Field label={tl("Kennwort für {0}", importing.name)} style={{ flex: 1 }}>
                  <Input type="password" value={importPw} onChange={(_, d) => setImportPw(d.value)} onKeyDown={(e) => e.key === "Enter" && void doImport()} />
                </Field>
                <Button appearance="primary" onClick={() => void doImport()}>
                  {tl("Importieren")}
                </Button>
                <Button onClick={() => setImporting(null)}>{tl("Abbrechen")}</Button>
              </div>
            ) : (
              <Button style={{ alignSelf: "flex-start" }} onClick={() => file.current?.click()}>
                {tl("Zertifikat importieren …")}
              </Button>
            )}
            <input
              ref={file}
              type="file"
              accept=".p12,.pfx"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const b = new Uint8Array(await f.arrayBuffer());
                let bin = "";
                for (const x of b) bin += String.fromCharCode(x);
                setImporting({ data: btoa(bin), name: f.name });
              }}
            />
            <div className={s.row}>
              <Field label={tl("Grund (optional)")} style={{ flex: 1 }}>
                <Input value={reason} onChange={(_, d) => setReason(d.value)} placeholder={tl("z. B. Freigabe")} />
              </Field>
              <Field label={tl("Ort (optional)")} style={{ flex: 1 }}>
                <Input value={location} onChange={(_, d) => setLocation(d.value)} />
              </Field>
            </div>
            <Checkbox checked={visible} onChange={(_, d) => setVisible(!!d.checked)} label={tl("Sichtbare Signatur – Sie ziehen danach ein Feld auf der Seite auf")} />
            {visible && <Checkbox checked={withImage} disabled={!savedSignature()} onChange={(_, d) => setWithImage(!!d.checked)} label={savedSignature() ? tl("Gespeicherte Unterschrift im Feld zeigen") : tl("Unterschrift im Feld zeigen (zuerst unter „Unterschreiben“ anlegen)")} />}
            {expired && (
              <MessageBar intent="warning">
                <MessageBarBody>{tl("Dieses Zertifikat ist abgelaufen.")}</MessageBarBody>
              </MessageBar>
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <Text size={200} className={s.muted}>
              {tl("Das signierte PDF wird sofort gespeichert. Spätere Änderungen an den Seiten machen die Signatur ungültig; Kommentare und Formulareingaben werden als Nachtrag angehängt.")}
            </Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!cert} onClick={() => cert && onSign({ cert, reason, location, visible, withImage: visible && withImage && !!savedSignature() })}>
              {tl("Signieren")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ----------------------------------------------------------------- OCR --

export interface OcrChoice {
  languages: ("deu" | "eng")[];
  onlyWithoutText: boolean;
}

/** Options of "Text erkennen" (OCR). */
export function OcrDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (c: OcrChoice) => void }) {
  const s = useStyles();
  const [deu, setDeu] = useState(true);
  const [eng, setEng] = useState(true);
  const [all, setAll] = useState(false);
  const languages = [...(deu ? ["deu" as const] : []), ...(eng ? ["eng" as const] : [])];
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Text erkennen")}</DialogTitle>
          <DialogContent className={s.col}>
            <Text>{tl("Gescannte Seiten werden durchsuchbar: Der erkannte Text wird unsichtbar über das Bild gelegt, das Aussehen bleibt gleich.")}</Text>
            <Field label={tl("Sprache des Dokuments")}>
              <Checkbox checked={deu} onChange={(_, d) => setDeu(!!d.checked)} label={tl("Deutsch")} />
              <Checkbox checked={eng} onChange={(_, d) => setEng(!!d.checked)} label={tl("Englisch")} />
            </Field>
            <Checkbox checked={all} onChange={(_, d) => setAll(!!d.checked)} label={tl("Auch Seiten erkennen, die schon Text enthalten")} />
            <Text className={s.muted}>{tl("Die Erkennung läuft auf diesem Computer, nichts wird hochgeladen. Pro Seite dauert sie einige Sekunden.")}</Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!languages.length} onClick={() => onApply({ languages, onlyWithoutText: !all })}>
              {tl("Erkennen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
