// "Seite einrichten" (Page Setup): margins, paper and layout of a section or
// the whole document, with the options of the Word dialog (gutter, facing
// pages, section start, odd/even and first-page headers, vertical alignment,
// line numbers) and "set as default" for new documents.

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, MessageBar, MessageBarBody, Option, Radio, RadioGroup, SpinButton, Tab, TabList, ToggleButton } from "@fluentui/react-components";
import { DocumentLandscapeRegular, DocumentRegular } from "@fluentui/react-icons";
import type { LineNumbers, PageSetup, SectionStart } from "./model";
import { LengthField, type LengthUnit, MARGIN_PRESETS, PAPER_SIZES, formatLength, lengthUnit, marginPresetOf, pageProblems, paperLabel, paperOf, saveLengthUnit } from "./dialogs";
import { AUTO_DISTANCE_MM } from "./lineNumbers";
import { type MultiplePages, facing, logicalSize, multiplePagesOf, pageMargins, withMultiplePages } from "./pageFrames";
import { tl } from "../../lib/i18n";

/** Options that belong to the whole document, edited in the same dialog. */
export interface DocumentPageOptions {
  mirrorMargins: boolean;
  twoOnOne: boolean;
  bookFold: boolean;
  /** Sheets per booklet (0 = all). */
  bookFoldSheets: number;
  gutterAtTop: boolean;
  differentFirst: boolean;
  differentOddEven: boolean;
}

/** Where the setup goes: the section of the cursor, the whole document, or
 *  from the cursor on (a new section starts there). */
export type ApplyScope = "section" | "all" | "forward";

export interface PageSetupResult {
  page: PageSetup;
  options: DocumentPageOptions;
  scope: ApplyScope;
  /** How the section starts (sections after the first). */
  start: SectionStart | null;
}

const DEFAULT_KEY = "ondura.text.defaultPage";

/** The page setup saved with "Als Standard festlegen", for new documents. */
export function defaultPageSetup(): PageSetup | null {
  try {
    const v = JSON.parse(localStorage.getItem(DEFAULT_KEY) ?? "null");
    return v && typeof v.widthMm === "number" ? (v as PageSetup) : null;
  } catch {
    return null;
  }
}

const START_LABEL: Record<string, string> = {
  nextPage: tl("Neue Seite"),
  continuous: tl("Fortlaufend"),
  evenPage: tl("Gerade Seite"),
  oddPage: tl("Ungerade Seite"),
};

const V_ALIGN_LABEL: Record<string, string> = {
  top: tl("Oben"),
  center: tl("Zentriert"),
  both: tl("Blocksatz"),
  bottom: tl("Unten"),
};

const RESTART_LABEL: Record<LineNumbers["restart"], string> = {
  newPage: tl("Jede Seite neu beginnen"),
  newSection: tl("Jeden Abschnitt neu beginnen"),
  continuous: tl("Fortlaufend"),
};

/** The page(s) with margins and gutter, to scale: one page, two facing
 *  pages, or a sheet with two pages (two per sheet, book fold). */
function PagePreview({ p, o }: { p: PageSetup; o: DocumentPageOptions }) {
  const box = 150;
  const mode = multiplePagesOf(o);
  const size = logicalSize(p, o);
  const split = mode === "twoOnOne" || mode === "bookFold";
  const sideBySide = mode === "mirror" || (split && p.widthMm >= p.heightMm);
  // Extent of everything drawn, in mm.
  const ew = sideBySide ? size.widthMm * 2 : size.widthMm;
  const eh = !sideBySide && split ? size.heightMm * 2 : size.heightMm;
  const k = box / Math.max(ew, eh);
  const w = size.widthMm * k;
  const h = size.heightMm * k;
  const g = (p.gutterMm ?? 0) * k;
  const ox = (box - ew * k) / 2;
  const oy = (box - eh * k) / 2;
  const page = (x: number, y: number, n: number) => {
    const m = pageMargins(p, o, n);
    const left = m.left * k;
    const right = m.right * k;
    const top = m.top * k;
    const bottom = m.bottom * k;
    const inside = facing(o) && n % 2 === 0 ? w - g : 0;
    const lines = Array.from({ length: 14 }, (_, i) => top + 3 + i * 5).filter((ly) => ly < h - bottom - 2);
    return (
      <g transform={`translate(${x} ${y})`} key={`${x}-${y}`}>
        <rect width={w} height={h} fill="#fff" stroke={split ? "#c8c8c8" : "#8a8a8a"} strokeDasharray={split ? "2 2" : undefined} />
        {g > 0 && (o.gutterAtTop && !facing(o) ? <rect width={w} height={g} fill="#d9dcef" /> : <rect x={inside} width={g} height={h} fill="#d9dcef" />)}
        <rect x={left} y={top} width={Math.max(0, w - left - right)} height={Math.max(0, h - top - bottom)} fill="none" stroke="#4f6bed" strokeDasharray="3 2" />
        {lines.map((ly) => (
          <line key={ly} x1={left + 2} x2={w - right - 2} y1={ly} y2={ly} stroke="#c8c8c8" strokeWidth={1.6} />
        ))}
      </g>
    );
  };
  const pages =
    mode === "normal"
      ? [page(ox, oy, 1)]
      : sideBySide
        ? [page(ox, oy, 2), page(ox + w, oy, mode === "twoOnOne" ? 1 : 3)]
        : [page(ox, oy, 1), page(ox, oy + h, 2)];
  return (
    <svg width={box + 8} height={box + 8} viewBox={`-4 -4 ${box + 8} ${box + 8}`} aria-label={tl("Vorschau")} role="img">
      {pages}
      {split && <rect x={ox} y={oy} width={ew * k} height={eh * k} fill="none" stroke="#8a8a8a" />}
    </svg>
  );
}

const MULTIPLE_LABEL: Record<MultiplePages, string> = {
  normal: tl("Normal"),
  mirror: tl("Gegenüberliegende Seiten"),
  twoOnOne: tl("2 Seiten pro Blatt"),
  bookFold: tl("Buchfalz"),
};

const MULTIPLE_HINT: Partial<Record<MultiplePages, string>> = {
  mirror: tl("Für doppelseitigen Druck: Innen ist bei geraden Seiten rechts."),
  twoOnOne: tl("Jede Seite ist ein halbes Blatt; zwei Seiten werden auf ein Blatt gedruckt."),
  bookFold: tl("Gedruckt als Broschüre: zwei Seiten pro Blattseite im Querformat, beidseitig drucken (kurze Kante) und in der Mitte falten."),
};

const grid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
  alignContent: "start",
} as const;
const heading = {
  fontWeight: 600,
  gridColumn: "1 / -1",
  marginTop: 4,
} as const;
const full = { gridColumn: "1 / -1" } as const;

export function PageSetupDialog({
  open,
  page,
  options,
  start,
  sectionIndex,
  sections,
  onClose,
  onApply,
  onBorders,
  initialTab,
  initialScope = "all",
}: {
  open: boolean;
  /** Setup of the section with the cursor. */
  page: PageSetup;
  options: DocumentPageOptions;
  /** How that section starts (null for the first section). */
  start: SectionStart | null;
  /** 0-based index of that section and the number of sections. */
  sectionIndex: number;
  sections: number;
  onClose: () => void;
  onApply: (r: PageSetupResult) => void;
  /** "Rahmen…": page borders. */
  onBorders?: () => void;
  initialTab?: "margins" | "paper" | "layout";
  initialScope?: ApplyScope;
}) {
  const [tab, setTab] = useState<"margins" | "paper" | "layout">(initialTab ?? "margins");
  const [p, setP] = useState(page);
  const [o, setO] = useState(options);
  const [st, setSt] = useState<SectionStart | "nextPage">(start ?? "nextPage");
  const [scope, setScope] = useState<ApplyScope>(initialScope === "section" && sections < 2 ? "all" : initialScope);
  const [unit, setUnit] = useState<LengthUnit>(lengthUnit);
  const [savedDefault, setSavedDefault] = useState(false);
  useEffect(() => {
    if (!open) return;
    setP(page);
    setO(options);
    setSt(start ?? "nextPage");
    setScope(initialScope === "section" && sections < 2 ? "all" : initialScope);
    setUnit(lengthUnit());
    setSavedDefault(false);
    setTab(initialTab ?? "margins");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const landscape = p.widthMm > p.heightMm;
  const size = paperOf(p);
  const preset = marginPresetOf(p);
  // Checked on the page as it is laid out: half the paper with two pages
  // per sheet or book fold, margins with the gutter.
  const m1 = pageMargins(p, o, 1);
  const effective = { ...p, ...logicalSize(p, o), marginLeftMm: m1.left, marginRightMm: m1.right, marginTopMm: m1.top, marginBottomMm: m1.bottom };
  const problems = pageProblems(effective);
  const ln = p.lineNumbers ?? null;
  const len = (label: string, key: "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm" | "headerMm" | "footerMm" | "widthMm" | "heightMm" | "gutterMm", max = 200) => <LengthField label={label} mm={p[key] ?? 0} unit={unit} max={max} onChange={(v) => setP({ ...p, [key]: v })} />;
  const setLn = (patch: Partial<LineNumbers> | null) =>
    setP({
      ...p,
      lineNumbers:
        patch === null
          ? null
          : {
              countBy: 1,
              start: 1,
              distanceMm: null,
              restart: "newPage",
              ...(p.lineNumbers ?? {}),
              ...patch,
            },
    });
  const changeUnit = (u: LengthUnit) => (setUnit(u), saveLengthUnit(u));
  const result = (): PageSetupResult => ({
    page: p,
    options: o,
    scope,
    start: st === "nextPage" ? null : st,
  });

  const margins = (
    <div style={grid}>
      <span style={heading}>{tl("Seitenränder")}</span>
      <Field label={tl("Vorlage")} style={full}>
        <Dropdown
          value={preset?.label ?? tl("Benutzerdefiniert")}
          selectedOptions={[preset?.id ?? "custom"]}
          onOptionSelect={(_, d) => {
            const m = MARGIN_PRESETS.find((x) => x.id === d.optionValue);
            if (m)
              setP({
                ...p,
                marginTopMm: m.t,
                marginBottomMm: m.b,
                marginLeftMm: m.l,
                marginRightMm: m.r,
              });
          }}
        >
          {MARGIN_PRESETS.map((m) => (
            <Option key={m.id} value={m.id} text={m.label}>
              {`${m.label} – ${[m.t, m.b, m.l, m.r].map((v) => formatLength(v, unit, false)).join(" / ")} ${unit}`}
            </Option>
          ))}
          <Option value="custom" text={tl("Benutzerdefiniert")}>
            {tl("Benutzerdefiniert")}
          </Option>
        </Dropdown>
      </Field>
      {len(tl("Oben"), "marginTopMm")}
      {len(tl("Unten"), "marginBottomMm")}
      {len(facing(o) ? tl("Innen") : tl("Links"), "marginLeftMm")}
      {len(facing(o) ? tl("Außen") : tl("Rechts"), "marginRightMm")}
      {len(tl("Bundsteg"), "gutterMm", 100)}
      <Field label={tl("Bundstegposition")}>
        <Dropdown value={o.gutterAtTop ? tl("Oben") : tl("Links")} selectedOptions={[o.gutterAtTop ? "top" : "left"]} onOptionSelect={(_, d) => setO({ ...o, gutterAtTop: d.optionValue === "top" })} disabled={facing(o)}>
          <Option value="left">{tl("Links")}</Option>
          <Option value="top">{tl("Oben")}</Option>
        </Dropdown>
      </Field>
      <Field label={tl("Ausrichtung")} style={full}>
        <div style={{ display: "flex", gap: 8 }}>
          <ToggleButton checked={!landscape} icon={<DocumentRegular />} onClick={() => landscape && setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm })}>
            {tl("Hochformat")}
          </ToggleButton>
          <ToggleButton checked={landscape} icon={<DocumentLandscapeRegular />} onClick={() => !landscape && setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm })}>
            {tl("Querformat")}
          </ToggleButton>
        </div>
      </Field>
      <Field label={tl("Mehrere Seiten")} style={full} hint={MULTIPLE_HINT[multiplePagesOf(o)]}>
        <Dropdown
          value={MULTIPLE_LABEL[multiplePagesOf(o)]}
          selectedOptions={[multiplePagesOf(o)]}
          onOptionSelect={(_, d) => {
            const m = d.optionValue as MultiplePages;
            setO(withMultiplePages(o, m));
            // A booklet is printed on landscape sheets.
            if (m === "bookFold" && p.widthMm < p.heightMm) setP({ ...p, widthMm: p.heightMm, heightMm: p.widthMm });
          }}
        >
          {(Object.keys(MULTIPLE_LABEL) as MultiplePages[]).map((k) => (
            <Option key={k} value={k}>
              {MULTIPLE_LABEL[k]}
            </Option>
          ))}
        </Dropdown>
      </Field>
      {o.bookFold && (
        <Field label={tl("Blätter pro Broschüre")} style={full}>
          <Dropdown value={o.bookFoldSheets > 0 ? String(o.bookFoldSheets) : tl("Alle")} selectedOptions={[String(o.bookFoldSheets)]} onOptionSelect={(_, d) => setO({ ...o, bookFoldSheets: Number(d.optionValue) || 0 })}>
            {[0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20].map((n) => (
              <Option key={n} value={String(n)} text={n > 0 ? String(n) : tl("Alle")}>
                {n > 0 ? String(n) : tl("Alle")}
              </Option>
            ))}
          </Dropdown>
        </Field>
      )}
    </div>
  );

  const paper = (
    <div style={grid}>
      <span style={heading}>{tl("Papierformat")}</span>
      <Field label={tl("Format")} style={full}>
        <Dropdown
          value={size ? paperLabel(size, unit) : tl("Benutzerdefiniert")}
          selectedOptions={[size?.id ?? "custom"]}
          onOptionSelect={(_, d) => {
            const z = PAPER_SIZES.find((x) => x.id === d.optionValue);
            if (z)
              setP({
                ...p,
                widthMm: landscape ? z.h : z.w,
                heightMm: landscape ? z.w : z.h,
              });
          }}
          listbox={{ style: { maxHeight: 320 } }}
        >
          {PAPER_SIZES.map((z) => (
            <Option key={z.id} value={z.id} text={paperLabel(z, unit)}>
              {paperLabel(z, unit)}
            </Option>
          ))}
          <Option value="custom" text={tl("Benutzerdefiniert")}>
            {tl("Benutzerdefiniert")}
          </Option>
        </Dropdown>
      </Field>
      {len(tl("Breite"), "widthMm", 1500)}
      {len(tl("Höhe"), "heightMm", 1500)}
    </div>
  );

  const layout = (
    <div style={grid}>
      <span style={heading}>{tl("Abschnitt")}</span>
      <Field label={tl("Abschnittsbeginn")} style={full} hint={sectionIndex === 0 ? tl("Der erste Abschnitt beginnt mit dem Dokument.") : undefined}>
        <Dropdown value={START_LABEL[st]} selectedOptions={[st]} disabled={sectionIndex === 0} onOptionSelect={(_, d) => setSt(d.optionValue as SectionStart | "nextPage")}>
          {Object.entries(START_LABEL).map(([k, v]) => (
            <Option key={k} value={k}>
              {v}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <span style={heading}>{tl("Kopf- und Fußzeilen")}</span>
      <Checkbox style={full} checked={o.differentOddEven} label={tl("Gerade und ungerade anders")} onChange={(_, d) => setO({ ...o, differentOddEven: !!d.checked })} />
      <Checkbox style={full} checked={o.differentFirst} label={tl("Erste Seite anders")} onChange={(_, d) => setO({ ...o, differentFirst: !!d.checked })} />
      {len(tl("Kopfzeile vom Rand"), "headerMm")}
      {len(tl("Fußzeile vom Rand"), "footerMm")}
      <span style={heading}>{tl("Seite")}</span>
      <Field label={tl("Vertikale Ausrichtung")} style={full}>
        <Dropdown
          value={V_ALIGN_LABEL[p.vAlign ?? "top"]}
          selectedOptions={[p.vAlign ?? "top"]}
          onOptionSelect={(_, d) =>
            setP({
              ...p,
              vAlign: d.optionValue === "top" ? null : (d.optionValue as PageSetup["vAlign"]),
            })
          }
        >
          {Object.entries(V_ALIGN_LABEL).map(([k, v]) => (
            <Option key={k} value={k}>
              {v}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <span style={heading}>{tl("Zeilennummern")}</span>
      <Checkbox style={full} checked={!!ln} label={tl("Zeilennummern hinzufügen")} onChange={(_, d) => setLn(d.checked ? {} : null)} />
      {ln && (
        <>
          <Field label={tl("Beginnen bei")}>
            <SpinButton
              value={ln.start}
              min={1}
              max={32767}
              onChange={(_, d) =>
                setLn({
                  start: Math.max(1, Math.round(d.value ?? (Number(d.displayValue) || 1))),
                })
              }
            />
          </Field>
          <Field label={tl("Zählintervall")}>
            <SpinButton
              value={ln.countBy}
              min={1}
              max={100}
              onChange={(_, d) =>
                setLn({
                  countBy: Math.max(1, Math.round(d.value ?? (Number(d.displayValue) || 1))),
                })
              }
            />
          </Field>
          <Field label={tl("Abstand zum Text")}>
            <Dropdown
              value={ln.distanceMm == null ? tl("Automatisch") : tl("Fest")}
              selectedOptions={[ln.distanceMm == null ? "auto" : "fixed"]}
              onOptionSelect={(_, d) =>
                setLn({
                  distanceMm: d.optionValue === "auto" ? null : AUTO_DISTANCE_MM,
                })
              }
            >
              <Option value="auto">{tl("Automatisch")}</Option>
              <Option value="fixed">{tl("Fest")}</Option>
            </Dropdown>
          </Field>
          {ln.distanceMm != null ? <LengthField label={tl("Abstand")} mm={ln.distanceMm} unit={unit} max={50} onChange={(v) => setLn({ distanceMm: v })} /> : <span />}
          <Field label={tl("Nummerierung")} style={full}>
            <RadioGroup layout="horizontal" value={ln.restart} onChange={(_, d) => setLn({ restart: d.value as LineNumbers["restart"] })}>
              {(Object.keys(RESTART_LABEL) as LineNumbers["restart"][]).map((k) => (
                <Radio key={k} value={k} label={RESTART_LABEL[k]} />
              ))}
            </RadioGroup>
          </Field>
        </>
      )}
      {onBorders && (
        <Button style={{ ...full, justifySelf: "start" }} onClick={onBorders}>
          {tl("Rahmen…")}
        </Button>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle>{tl("Seite einrichten")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)}>
              <Tab value="margins">{tl("Seitenränder")}</Tab>
              <Tab value="paper">{tl("Papier")}</Tab>
              <Tab value="layout">{tl("Layout")}</Tab>
            </TabList>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px",
                gap: 16,
                minHeight: 420,
              }}
            >
              {tab === "margins" ? margins : tab === "paper" ? paper : layout}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <PagePreview p={p} o={o} />
                <Field label={tl("Übernehmen für")}>
                  <Dropdown
                    style={{ minWidth: 0, width: "100%" }}
                    value={
                      {
                        section: tl("Diesen Abschnitt"),
                        all: tl("Gesamtes Dokument"),
                        forward: tl("Dokument ab hier"),
                      }[scope]
                    }
                    selectedOptions={[scope]}
                    onOptionSelect={(_, d) => setScope(d.optionValue as ApplyScope)}
                  >
                    {sections > 1 && <Option value="section">{tl("Diesen Abschnitt")}</Option>}
                    <Option value="all">{tl("Gesamtes Dokument")}</Option>
                    <Option value="forward">{tl("Dokument ab hier")}</Option>
                  </Dropdown>
                </Field>
                <Field label={tl("Maßeinheit")}>
                  <Dropdown
                    style={{ minWidth: 0, width: "100%" }}
                    value={
                      {
                        cm: tl("Zentimeter"),
                        mm: tl("Millimeter"),
                        in: tl("Zoll"),
                      }[unit]
                    }
                    selectedOptions={[unit]}
                    onOptionSelect={(_, d) => changeUnit(d.optionValue as LengthUnit)}
                  >
                    <Option value="cm">{tl("Zentimeter")}</Option>
                    <Option value="mm">{tl("Millimeter")}</Option>
                    <Option value="in">{tl("Zoll")}</Option>
                  </Dropdown>
                </Field>
              </div>
            </div>
            {[...problems.errors, ...problems.warnings].length > 0 && (
              <MessageBar intent={problems.errors.length ? "error" : "warning"}>
                <MessageBarBody>{[...problems.errors, ...problems.warnings].join(" ")}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions fluid style={{ justifyContent: "space-between" }}>
            <Button
              disabled={problems.errors.length > 0}
              onClick={() => {
                try {
                  localStorage.setItem(DEFAULT_KEY, JSON.stringify({ ...p, start: null }));
                  setSavedDefault(true);
                } catch {
                  /* no storage */
                }
              }}
            >
              {savedDefault ? tl("Als Standard gespeichert") : tl("Als Standard festlegen")}
            </Button>
            <div style={{ display: "flex", gap: 8 }}>
              <Button appearance="primary" disabled={problems.errors.length > 0} onClick={() => (onApply(result()), onClose())}>
                {tl("Übernehmen")}
              </Button>
              <Button onClick={onClose}>{tl("Abbrechen")}</Button>
            </div>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** "Weitere Spalten…": number of columns, spacing and a line between them. */
export function ColumnsDialog({ open, initial, onClose, onApply }: { open: boolean; initial: { count: number; gap: number; line: boolean }; onClose: () => void; onApply: (v: { count: number; gap: number; line: boolean }) => void }) {
  const [v, setV] = useState(initial);
  const [unit] = useState<LengthUnit>(lengthUnit);
  useEffect(() => {
    if (open) setV(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const presets = [1, 2, 3];
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <DialogBody>
          <DialogTitle>{tl("Spalten")}</DialogTitle>
          <DialogContent style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ ...full, display: "flex", gap: 8 }}>
              {presets.map((n) => (
                <ToggleButton key={n} checked={v.count === n} onClick={() => setV({ ...v, count: n })}>
                  {[tl("Eine"), tl("Zwei"), tl("Drei")][n - 1]}
                </ToggleButton>
              ))}
            </div>
            <Field label={tl("Anzahl der Spalten")}>
              <SpinButton
                value={v.count}
                min={1}
                max={12}
                onChange={(_, d) =>
                  setV({
                    ...v,
                    count: Math.min(12, Math.max(1, Math.round(d.value ?? (Number(d.displayValue) || 1)))),
                  })
                }
              />
            </Field>
            <LengthField label={tl("Abstand")} mm={v.gap} unit={unit} max={100} onChange={(gap) => setV({ ...v, gap })} disabled={v.count < 2} />
            <Checkbox style={full} checked={v.line} disabled={v.count < 2} label={tl("Zwischenlinie")} onChange={(_, d) => setV({ ...v, line: !!d.checked })} />
            <div
              style={{
                ...full,
                display: "flex",
                gap: 4,
                height: 70,
                padding: 6,
                border: "1px solid #8a8a8a",
                background: "#fff",
              }}
              aria-hidden
            >
              {Array.from({ length: v.count }, (_, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    borderLeft: v.line && i > 0 ? "1px solid #444" : undefined,
                    paddingLeft: i > 0 ? Math.min(12, v.gap / 2) : 0,
                  }}
                >
                  {Array.from({ length: 7 }, (_, j) => (
                    <div key={j} style={{ height: 3, background: "#c8c8c8" }} />
                  ))}
                </div>
              ))}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (onApply(v), onClose())}>
              {tl("OK")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
