// "Seite einrichten": paper, margins, header/footer and sheet options.

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
  Option,
  Radio,
  RadioGroup,
  SpinButton,
  Tab,
  TabList,
  tokens,
} from "@fluentui/react-components";
import { DEFAULT_PAGE, type PageSetup } from "./model";
import { HF_FIELDS, HF_PRESETS, PAPERS, joinSections, previewText, splitSections } from "./pageLayout";
import { tl } from "../../lib/i18n";

export type PageTab = "page" | "margins" | "hf" | "sheet";

const num = (s: string) => Number(s.replace(",", "."));

export function PageSetupDialog(p: { open: boolean; tab: PageTab; initial: PageSetup | undefined; sheetName: string; fileName: string; onClose: () => void; onApply: (page: PageSetup) => void }) {
  const [tab, setTab] = useState<PageTab>(p.tab);
  const [pg, setPg] = useState<PageSetup>(p.initial ?? DEFAULT_PAGE);
  useEffect(() => {
    if (p.open) (setTab(p.tab), setPg(p.initial ?? DEFAULT_PAGE));
  }, [p.open, p.tab, p.initial]);
  if (!p.open) return null;
  const set = (patch: Partial<PageSetup>) => setPg((x) => ({ ...x, ...patch }));
  const fit = pg.fitWidth !== undefined || pg.fitHeight !== undefined;
  const ctx = { sheet: p.sheetName, file: p.fileName, now: new Date() };

  const margin = (k: keyof PageSetup, label: string) => (
    <Field label={label} style={{ width: 120 }}>
      <Input value={String(pg[k] ?? "").replace(".", ",")} contentAfter="cm" onChange={(_, d) => Number.isFinite(num(d.value)) && set({ [k]: Math.max(0, num(d.value)) } as Partial<PageSetup>)} />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface style={{ maxWidth: 560, width: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Seite einrichten")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 330 }}>
            <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as PageTab)}>
              <Tab value="page">{tl("Seite")}</Tab>
              <Tab value="margins">{tl("Seitenränder")}</Tab>
              <Tab value="hf">{tl("Kopfzeile/Fußzeile")}</Tab>
              <Tab value="sheet">{tl("Blatt")}</Tab>
            </TabList>
            {tab === "page" && (
              <>
                <Field label={tl("Ausrichtung")}>
                  <RadioGroup layout="horizontal" value={pg.landscape ? "l" : "p"} onChange={(_, d) => set({ landscape: d.value === "l" })}>
                    <Radio value="p" label={tl("Hochformat")} />
                    <Radio value="l" label={tl("Querformat")} />
                  </RadioGroup>
                </Field>
                <Field label={tl("Skalierung")}>
                  <RadioGroup value={fit ? "fit" : "scale"} onChange={(_, d) => set(d.value === "fit" ? { fitWidth: 1, fitHeight: 0 } : { fitWidth: undefined, fitHeight: undefined })}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Radio value="scale" label={tl("Verkleinern/Vergrößern:")} />
                      <SpinButton disabled={fit} value={pg.scale} min={10} max={400} step={5} style={{ width: 90 }} onChange={(_, d) => set({ scale: Math.min(400, Math.max(10, d.value ?? (Number(d.displayValue) || 100))) })} />
                      <span>{tl("% der normalen Größe")}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Radio value="fit" label={tl("Anpassen:")} />
                      <SpinButton disabled={!fit} value={pg.fitWidth ?? 1} min={0} max={99} style={{ width: 70 }} onChange={(_, d) => set({ fitWidth: Math.max(0, d.value ?? (Number(d.displayValue) || 0)) })} />
                      <span>{tl("Seite(n) breit und")}</span>
                      <SpinButton disabled={!fit} value={pg.fitHeight ?? 0} min={0} max={99} style={{ width: 70 }} onChange={(_, d) => set({ fitHeight: Math.max(0, d.value ?? (Number(d.displayValue) || 0)) })} />
                      <span>{tl("hoch")}</span>
                    </div>
                  </RadioGroup>
                  <span style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>{tl("0 = automatisch")}</span>
                </Field>
                <Field label={tl("Papierformat")}>
                  <Dropdown value={PAPERS.find((x) => x.id === pg.paper)?.label ?? pg.paper} selectedOptions={[pg.paper]} onOptionSelect={(_, d) => set({ paper: d.optionValue ?? "A4" })}>
                    {PAPERS.map((x) => (
                      <Option key={x.id} value={x.id}>
                        {x.label}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              </>
            )}
            {tab === "margins" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 120px)", gap: 12, justifyContent: "center" }}>
                  <span />
                  {margin("marginTop", tl("Oben"))}
                  {margin("marginHeader", tl("Kopfzeile"))}
                  {margin("marginLeft", tl("Links"))}
                  <div style={{ border: `1px solid ${tokens.colorNeutralStroke1}`, height: 90, alignSelf: "center", background: tokens.colorNeutralBackground1 }} />
                  {margin("marginRight", tl("Rechts"))}
                  <span />
                  {margin("marginBottom", tl("Unten"))}
                  {margin("marginFooter", tl("Fußzeile"))}
                </div>
                <Field label={tl("Auf der Seite zentrieren")}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Checkbox label={tl("Horizontal")} checked={pg.centerH} onChange={(_, d) => set({ centerH: !!d.checked })} />
                    <Checkbox label={tl("Vertikal")} checked={pg.centerV} onChange={(_, d) => set({ centerV: !!d.checked })} />
                  </div>
                </Field>
              </>
            )}
            {tab === "hf" && (
              <>
                <HfEditor label={tl("Kopfzeile")} code={pg.header} ctx={ctx} onChange={(header) => set({ header })} />
                <HfEditor label={tl("Fußzeile")} code={pg.footer} ctx={ctx} onChange={(footer) => set({ footer })} />
              </>
            )}
            {tab === "sheet" && (
              <>
                <Field label={tl("Druckbereich")}>
                  <Input value={pg.printArea ?? ""} placeholder="z. B. A1:F40" onChange={(_, d) => set({ printArea: d.value.replace(/\$/g, "").toUpperCase() || undefined })} />
                </Field>
                <Field label={tl("Drucktitel")}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Field label={tl("Wiederholungszeilen oben")} style={{ flex: 1 }}>
                      <Input value={pg.titleRows ?? ""} placeholder="z. B. 1:2" onChange={(_, d) => set({ titleRows: d.value.replace(/\$/g, "") || undefined })} />
                    </Field>
                    <Field label={tl("Wiederholungsspalten links")} style={{ flex: 1 }}>
                      <Input value={pg.titleCols ?? ""} placeholder="z. B. A:A" onChange={(_, d) => set({ titleCols: d.value.replace(/\$/g, "").toUpperCase() || undefined })} />
                    </Field>
                  </div>
                </Field>
                <Field label={tl("Drucken")}>
                  <Checkbox label={tl("Gitternetzlinien")} checked={pg.gridlines} onChange={(_, d) => set({ gridlines: !!d.checked })} />
                  <Checkbox label={tl("Zeilen- und Spaltenüberschriften")} checked={pg.headings} onChange={(_, d) => set({ headings: !!d.checked })} />
                </Field>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={p.onClose}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" onClick={() => p.onApply(pg)}>
              {tl("OK")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Three sections with field buttons and presets. */
function HfEditor(p: { label: string; code: string | undefined; ctx: { sheet: string; file: string; now: Date }; onChange: (code: string | undefined) => void }) {
  const sections = splitSections(p.code);
  const [focus, setFocus] = useState(1);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const setSection = (i: number, v: string) => {
    const next = [...sections] as [string, string, string];
    next[i] = v;
    p.onChange(joinSections(next));
  };
  const insert = (code: string) => {
    const el = refs[focus].current;
    const cur = sections[focus];
    const at = el?.selectionStart ?? cur.length;
    setSection(focus, cur.slice(0, at) + code + cur.slice(el?.selectionEnd ?? at));
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at + code.length, at + code.length);
    });
  };
  return (
    <Field label={p.label}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <Dropdown
          style={{ minWidth: 0 }}
          placeholder={tl("Vorlage wählen")}
          value={HF_PRESETS.find((x) => x.code === (p.code ?? ""))?.label ?? "(benutzerdefiniert)"}
          onOptionSelect={(_, d) => p.onChange(d.optionValue || undefined)}
        >
          {HF_PRESETS.map((x) => (
            <Option key={x.label} value={x.code} text={x.label}>
              {x.label}
            </Option>
          ))}
        </Dropdown>
        <div style={{ display: "flex", gap: 6 }}>
          {([tl("Links"), tl("Mitte"), tl("Rechts")] as const).map((l, i) => (
            <Input key={l} ref={refs[i]} aria-label={`${p.label} ${l}`} placeholder={l} value={sections[i]} style={{ flex: 1, minWidth: 0, width: 0 }} onFocus={() => setFocus(i)} onChange={(_, d) => setSection(i, d.value)} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {HF_FIELDS.map((f) => (
            <Button key={f.code} size="small" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f.code)}>
              {f.label}
            </Button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 8px", border: `1px dashed ${tokens.colorNeutralStroke1}`, minHeight: 18, color: tokens.colorNeutralForeground2 }}>
          {sections.map((t, i) => (
            <span key={i} style={{ flex: 1, textAlign: (["left", "center", "right"] as const)[i], whiteSpace: "pre" }}>
              {previewText(t, p.ctx)}
            </span>
          ))}
        </div>
      </div>
    </Field>
  );
}
