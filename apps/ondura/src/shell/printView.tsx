// "Drucken" page of the backstage: settings on the left,
// a preview of the printed sheets on the right. The preview is the real
// print output (a PDF written by the webview), laid out with the chosen
// pages, pages per sheet and colour mode, so what you see is what comes
// out of the printer. Printing uses the chosen settings directly,
// without the browser's print dialog and its header/footer.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, Field, Input, Link, Option, Slider, Spinner, SpinButton, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ChevronLeft24Regular, ChevronRight24Regular, Print24Regular } from "@fluentui/react-icons";
import { isTauri } from "../lib/api";
import { tl } from "../lib/i18n";
import { DEFAULT_SETTINGS, listPrinters, loadPrintSettings, pageRectOnSheet, parsePageRanges, removeTemp, savePrintSettings, sheetLayout, tempFile, type PrintJob, type PrinterInfo, type PrinterSettings } from "../lib/print";
import { errorMessage } from "../lib/api";
import { useNotify } from "./notify";

/** What an app offers to the print view. */
export interface PrintSupport {
  /** Lay out the print view and run the job (PDF for the preview, printer or system dialog). */
  run: (job: PrintJob) => Promise<void>;
  /** App-specific settings (e.g. slides or handouts), shown below the common ones. */
  options?: ReactNode;
  /** Changes when `options` change the layout, so the preview is redrawn. */
  optionsKey?: string;
  /** Print an existing PDF on Linux/macOS (Ondura PDF prints its file as it is). */
  pdfBytes?: () => Promise<Uint8Array>;
}

const useStyles = makeStyles({
  root: { display: "flex", gap: "32px", flex: 1, minHeight: 0 },
  settings: { width: "300px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto", paddingRight: "4px" },
  printRow: { display: "flex", gap: "12px", alignItems: "flex-end" },
  printBtn: { width: "96px", height: "84px", flexDirection: "column", gap: "6px" },
  section: { fontWeight: tokens.fontWeightSemibold, marginTop: "6px" },
  preview: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusLarge,
    padding: "16px",
  },
  stage: { flex: 1, minHeight: 0, width: "100%", overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center" },
  canvas: { boxShadow: tokens.shadow16, backgroundColor: "#fff", display: "block" },
  nav: { display: "flex", alignItems: "center", gap: "8px", paddingTop: "10px", width: "100%" },
  muted: { color: tokens.colorNeutralForeground3 },
  hint: { color: tokens.colorNeutralForeground3, display: "block", maxWidth: "420px", textAlign: "center", marginTop: "40px" },
});

type PageChoice = "all" | "current" | "custom";

export function PrintView({ support, documentName }: { support: PrintSupport; documentName: string }) {
  const s = useStyles();
  const notify = useNotify();
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null);
  const [settings, setSettings] = useState<PrinterSettings>(loadPrintSettings);
  const [choice, setChoice] = useState<PageChoice>("all");
  const [range, setRange] = useState("");
  const [preview, setPreview] = useState<{ pages: number; doc: import("../apps/pdf/pdfjs").PDFDocumentProxy } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Shown sheet, 0-based. */
  const [sheet, setSheet] = useState(0);
  /** The page "Aktuelle Seite drucken" prints (the first one of the sheet shown when it was chosen). */
  const [pinned, setPinned] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const runRef = useRef(support.run);
  runRef.current = support.run;
  // Jobs run one after another: the apps have a single print layout.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback((job: PrintJob) => {
    const next = queue.current.catch(() => {}).then(() => runRef.current(job));
    queue.current = next;
    return next;
  }, []);

  useEffect(() => {
    listPrinters()
      .then((list) => {
        setPrinters(list);
        // The saved printer may be gone; fall back to the default one.
        setSettings((st) => (list.some((p) => p.name === st.printer) ? st : { ...st, printer: list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? "" }));
      })
      .catch(() => setPrinters([]));
  }, []);

  // The preview: the print layout written into a temporary PDF.
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let file: string | null = null;
    let doc: import("../apps/pdf/pdfjs").PDFDocumentProxy | null = null;
    setPreview(null);
    setPreviewError(null);
    void (async () => {
      try {
        file = await tempFile("pdf");
        await run({ kind: "pdf", path: file });
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_bytes", { path: file }));
        const { openDocument } = await import("../apps/pdf/pdfjs");
        doc = await openDocument(bytes);
        if (cancelled) return;
        setPreview({ pages: doc.numPages, doc });
      } catch (e) {
        if (!cancelled) setPreviewError(errorMessage(e));
      } finally {
        if (file) void removeTemp(file);
      }
    })();
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [support.optionsKey, run]);

  const pageCount = preview?.pages ?? 0;
  const perSheet = settings.pagesPerSheet;
  /** The pages that get printed, in order. */
  const printed = useMemo(() => {
    if (!pageCount) return [];
    if (choice === "current") return [Math.min(pinned, pageCount)];
    if (choice === "custom") return parsePageRanges(range, pageCount) ?? [];
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }, [pageCount, choice, pinned, range]);
  const sheets = useMemo(() => Array.from({ length: Math.ceil(printed.length / perSheet) }, (_, i) => printed.slice(i * perSheet, (i + 1) * perSheet)), [printed, perSheet]);
  const shown = Math.min(sheet, Math.max(0, sheets.length - 1));

  // Draws the shown sheet (its pages in their cells) to fit the stage at the chosen zoom.
  useEffect(() => {
    const c = canvas.current;
    const box = stage.current;
    const pagesOnSheet = sheets[shown];
    if (!preview || !c || !box || !pagesOnSheet) return;
    let cancelled = false;
    const tasks: { cancel: () => void }[] = [];
    void (async () => {
      const pages = await Promise.all(pagesOnSheet.map((n) => preview.doc.getPage(n)));
      if (cancelled) return;
      // The sheet follows the first page, as the printer does.
      const first = pages[0].getViewport({ scale: 1 });
      const layout = sheetLayout(perSheet, first.width, first.height);
      const fit = Math.min((box.clientWidth - 24) / layout.width, (box.clientHeight - 24) / layout.height);
      const scale = Math.max(0.1, fit * (zoom / 100));
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.ceil(layout.width * scale * ratio);
      c.height = Math.ceil(layout.height * scale * ratio);
      c.style.width = `${Math.round(layout.width * scale)}px`;
      c.style.height = `${Math.round(layout.height * scale)}px`;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < pages.length; i++) {
        const base = pages[i].getViewport({ scale: 1 });
        const at = pageRectOnSheet(layout, i, base.width, base.height);
        // pdf.js fills its whole canvas, so each page gets its own and is copied onto the sheet.
        const vp = pages[i].getViewport({ scale: at.scale * scale * ratio });
        const own = document.createElement("canvas");
        own.width = Math.ceil(vp.width);
        own.height = Math.ceil(vp.height);
        const t = pages[i].render({ canvas: own, canvasContext: own.getContext("2d")!, viewport: vp });
        tasks.push(t);
        try {
          await t.promise;
        } catch {
          return;
        }
        if (cancelled) return;
        ctx.drawImage(own, Math.round(at.x * scale * ratio), Math.round(at.y * scale * ratio));
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
    };
  }, [preview, sheets, shown, perSheet, zoom]);

  const set = (patch: Partial<PrinterSettings>) => setSettings((st) => ({ ...st, ...patch }));
  const pages = choice === "current" ? String(pinned) : choice === "custom" ? range : "";
  const rangeInvalid = choice === "custom" && (!range.trim() || (pageCount > 0 && !parsePageRanges(range, pageCount)?.length));

  const print = useCallback(async () => {
    const job: PrintJob = isTauri ? { kind: "printer", settings: { ...settings, pages } } : { kind: "dialog" };
    savePrintSettings(settings);
    setBusy(tl("Wird gedruckt …"));
    try {
      await run(job);
      if (isTauri) notify(tl("An den Drucker gesendet"), `${documentName} → ${settings.printer || tl("Standarddrucker")}`);
    } catch (e) {
      notify(tl("Drucken fehlgeschlagen"), errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }, [settings, pages, run, notify, documentName]);

  const systemDialog = () => void run({ kind: "dialog" }).catch((e) => notify(tl("Drucken fehlgeschlagen"), errorMessage(e), "error"));

  const duplexLabel = { none: tl("Einseitig drucken"), long: tl("Beidseitig, an langer Kante spiegeln"), short: tl("Beidseitig, an kurzer Kante spiegeln") };
  const pageLabel = { all: tl("Alle Seiten drucken"), current: tl("Aktuelle Seite drucken"), custom: tl("Benutzerdefinierter Druck") };

  return (
    <div className={s.root}>
      <div className={s.settings}>
        <div className={s.printRow}>
          <Button appearance="primary" className={s.printBtn} icon={<Print24Regular />} onClick={() => void print()} disabled={!!busy || rangeInvalid || (isTauri && printers !== null && printers.length === 0)}>
            {tl("Drucken")}
          </Button>
          <Field label={tl("Exemplare")} style={{ width: 110 }}>
            <SpinButton min={1} max={999} value={settings.copies} onChange={(_, d) => set({ copies: Math.max(1, Math.min(999, Number(d.value ?? d.displayValue) || 1)) })} />
          </Field>
        </div>
        {busy && <Spinner size="tiny" label={busy} labelPosition="after" />}

        <Text className={s.section}>{tl("Drucker")}</Text>
        {isTauri ? (
          printers === null ? (
            <Spinner size="tiny" label={tl("Drucker werden gesucht …")} labelPosition="after" />
          ) : printers.length === 0 ? (
            <Text className={s.muted}>{tl("Es wurde kein Drucker gefunden.")}</Text>
          ) : (
            <Dropdown value={settings.printer} selectedOptions={[settings.printer]} onOptionSelect={(_, d) => set({ printer: d.optionValue ?? "" })}>
              {printers.map((p) => (
                <Option key={p.name} value={p.name} text={p.name}>
                  {p.isDefault ? tl("{0} (Standard)", p.name) : p.name}
                </Option>
              ))}
            </Dropdown>
          )
        ) : (
          <Text className={s.muted}>{tl("Im Browser wird der Druckdialog des Browsers verwendet.")}</Text>
        )}

        <Text className={s.section}>{tl("Einstellungen")}</Text>
        <Dropdown value={pageLabel[choice]} selectedOptions={[choice]} onOptionSelect={(_, d) => {
            const next = (d.optionValue as PageChoice) ?? "all";
            if (next === "current") setPinned(sheets[shown]?.[0] ?? 1);
            setChoice(next);
            setSheet(0);
          }}
        >
          <Option value="all">{pageLabel.all}</Option>
          <Option value="current">{pageLabel.current}</Option>
          <Option value="custom">{pageLabel.custom}</Option>
        </Dropdown>
        <Field label={tl("Seiten")} validationState={rangeInvalid && range ? "error" : "none"} validationMessage={rangeInvalid && range ? tl("Ungültiger Seitenbereich") : undefined} hint={tl("z. B. 1-3, 5, 8-")}>
          <Input value={pages} placeholder={pageCount ? `1-${pageCount}` : ""} onChange={(_, d) => (setChoice("custom"), setRange(d.value))} />
        </Field>
        <Dropdown value={duplexLabel[settings.duplex]} selectedOptions={[settings.duplex]} onOptionSelect={(_, d) => set({ duplex: (d.optionValue as PrinterSettings["duplex"]) ?? "none" })}>
          <Option value="none">{duplexLabel.none}</Option>
          <Option value="long">{duplexLabel.long}</Option>
          <Option value="short">{duplexLabel.short}</Option>
        </Dropdown>
        <Dropdown value={settings.collate ? tl("Sortiert 1,2,3 1,2,3") : tl("Nicht sortiert 1,1 2,2 3,3")} selectedOptions={[String(settings.collate)]} onOptionSelect={(_, d) => set({ collate: d.optionValue === "true" })}>
          <Option value="true">{tl("Sortiert 1,2,3 1,2,3")}</Option>
          <Option value="false">{tl("Nicht sortiert 1,1 2,2 3,3")}</Option>
        </Dropdown>
        <Dropdown value={settings.color ? tl("Farbe") : tl("Graustufen")} selectedOptions={[String(settings.color)]} onOptionSelect={(_, d) => set({ color: d.optionValue === "true" })}>
          <Option value="true">{tl("Farbe")}</Option>
          <Option value="false">{tl("Graustufen")}</Option>
        </Dropdown>
        <Dropdown
          value={settings.pagesPerSheet === 1 ? tl("1 Seite pro Blatt") : tl("{0} Seiten pro Blatt", settings.pagesPerSheet)}
          selectedOptions={[String(settings.pagesPerSheet)]}
          onOptionSelect={(_, d) => set({ pagesPerSheet: Number(d.optionValue) || 1 })}
        >
          {[1, 2, 4, 6, 9, 16].map((n) => (
            <Option key={n} value={String(n)}>
              {n === 1 ? tl("1 Seite pro Blatt") : tl("{0} Seiten pro Blatt", n)}
            </Option>
          ))}
        </Dropdown>
        {support.options}
        <Link onClick={() => (setSettings({ ...DEFAULT_SETTINGS, printer: settings.printer }), setChoice("all"), setRange(""))}>{tl("Einstellungen zurücksetzen")}</Link>
        <Link onClick={systemDialog}>{tl("Über das Systemdialogfeld drucken …")}</Link>
      </div>

      <div className={s.preview}>
        <div className={s.stage} ref={stage}>
          {!isTauri ? (
            <Text className={s.hint}>{tl("Die Druckvorschau gibt es in der Desktop-App. Im Browser öffnet „Drucken“ den Druckdialog des Browsers.")}</Text>
          ) : previewError ? (
            <Text className={s.hint}>{tl("Die Vorschau konnte nicht erstellt werden: {0}", previewError)}</Text>
          ) : !preview ? (
            <Spinner label={tl("Vorschau wird erstellt …")} style={{ marginTop: 60 }} />
          ) : (
            <canvas ref={canvas} className={s.canvas} style={settings.color ? undefined : { filter: "grayscale(1)" }} />
          )}
        </div>
        <div className={s.nav}>
          <Button appearance="subtle" icon={<ChevronLeft24Regular />} aria-label={tl("Vorherige Seite")} disabled={shown <= 0} onClick={() => setSheet(shown - 1)} />
          <Text>{sheets.length ? (perSheet > 1 ? tl("Blatt {0} von {1}", shown + 1, sheets.length) : tl("{0} von {1}", shown + 1, sheets.length)) : "–"}</Text>
          <Button appearance="subtle" icon={<ChevronRight24Regular />} aria-label={tl("Nächste Seite")} disabled={shown >= sheets.length - 1} onClick={() => setSheet(shown + 1)} />
          <div style={{ flex: 1 }} />
          <Text size={200} className={s.muted}>
            {zoom} %
          </Text>
          <Slider min={50} max={300} step={10} value={zoom} onChange={(_, d) => setZoom(d.value)} style={{ width: 140 }} aria-label={tl("Zoom")} />
        </div>
      </div>
    </div>
  );
}
