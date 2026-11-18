// Dialogs of the references tab: captions, cross-references, index entries
// and the source manager for citations.

import { useEffect, useState } from "react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Listbox, Option, Radio, RadioGroup, tokens } from "@fluentui/react-components";
import type { Source } from "./model";
import { type CaptionTarget, bibliographyText } from "./refs";

function Frame({ title, width = 440, children, actions, onClose }: { title: string; width?: number; children: React.ReactNode; actions: React.ReactNode; onClose: () => void }) {
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

export const CAPTION_LABELS = ["Abbildung", "Tabelle", "Gleichung"];

export function CaptionDialog(p: { open: boolean; inTable: boolean; onClose: () => void; onInsert: (label: string, text: string, above: boolean) => void }) {
  const [label, setLabel] = useState("Abbildung");
  const [text, setText] = useState("");
  const [above, setAbove] = useState(false);
  useEffect(() => {
    if (p.open) (setText(""), setLabel(p.inTable ? "Tabelle" : "Abbildung"), setAbove(p.inTable));
  }, [p.open, p.inTable]);
  if (!p.open) return null;
  const ok = () => label.trim() && p.onInsert(label.trim(), text.trim(), above);
  return (
    <Frame
      title="Beschriftung"
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" disabled={!label.trim()} onClick={ok}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Beschriftung">
        <Input value={text} placeholder={`${label} 1: …`} autoFocus onChange={(_, d) => setText(d.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ok())} contentBefore={<span style={{ color: tokens.colorNeutralForeground3 }}>{label} #:</span>} />
      </Field>
      <Field label="Bezeichnung">
        <Combobox freeform value={label} selectedOptions={[label]} onOptionSelect={(_, d) => d.optionValue && setLabel(d.optionValue)} onChange={(e) => setLabel((e.target as HTMLInputElement).value)}>
          {CAPTION_LABELS.map((l) => (
            <Option key={l} value={l}>
              {l}
            </Option>
          ))}
        </Combobox>
      </Field>
      <Field label="Position">
        <RadioGroup layout="horizontal" value={above ? "above" : "below"} onChange={(_, d) => setAbove(d.value === "above")}>
          <Radio value="below" label="Unter dem ausgewählten Element" />
          <Radio value="above" label="Über dem ausgewählten Element" />
        </RadioGroup>
      </Field>
    </Frame>
  );
}

export function CrossRefDialog(p: { open: boolean; targets: CaptionTarget[]; onClose: () => void; onInsert: (t: CaptionTarget) => void }) {
  const labels = [...new Set(p.targets.map((t) => t.label))];
  const [label, setLabel] = useState(labels[0] ?? "");
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) (setLabel(labels[0] ?? ""), setPick(null));
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p.open) return null;
  const list = p.targets.filter((t) => t.label === label);
  const chosen = list.find((t) => t.name === pick) ?? null;
  return (
    <Frame
      title="Querverweis"
      width={480}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Schließen</Button>
          <Button appearance="primary" disabled={!chosen} onClick={() => chosen && p.onInsert(chosen)}>
            Einfügen
          </Button>
        </>
      }
    >
      {!p.targets.length ? (
        <div>Im Dokument gibt es noch keine Beschriftungen. Fügen Sie zuerst mit „Beschriftung einfügen“ eine ein.</div>
      ) : (
        <>
          <Field label="Verweistyp">
            <Dropdown value={label} selectedOptions={[label]} onOptionSelect={(_, d) => (setLabel(d.optionValue ?? label), setPick(null))}>
              {labels.map((l) => (
                <Option key={l} value={l}>
                  {l}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label={`Für welche ${label === "Tabelle" ? "Tabelle" : "Beschriftung"}`}>
            <Listbox selectedOptions={pick ? [pick] : []} onOptionSelect={(_, d) => setPick(d.optionValue ?? null)} style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke1}` }}>
              {list.map((t) => (
                <Option key={t.name} value={t.name} text={t.text} onDoubleClick={() => p.onInsert(t)}>
                  {t.text}
                </Option>
              ))}
            </Listbox>
          </Field>
          <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>Eingefügt wird „{chosen?.short ?? `${label} 1`}“. Die Nummer passt sich an, wenn Beschriftungen hinzukommen.</div>
        </>
      )}
    </Frame>
  );
}

export function MarkEntryDialog(p: { open: boolean; initial: string; onClose: () => void; onMark: (term: string) => void }) {
  const [term, setTerm] = useState(p.initial);
  useEffect(() => {
    if (p.open) setTerm(p.initial);
  }, [p.open, p.initial]);
  if (!p.open) return null;
  return (
    <Frame
      title="Indexeintrag festlegen"
      width={380}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Schließen</Button>
          <Button appearance="primary" disabled={!term.trim()} onClick={() => p.onMark(term.trim())}>
            Festlegen
          </Button>
        </>
      }
    >
      <Field label="Haupteintrag">
        <Input value={term} autoFocus onChange={(_, d) => setTerm(d.value)} onKeyDown={(e) => e.key === "Enter" && term.trim() && (e.preventDefault(), p.onMark(term.trim()))} />
      </Field>
      <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>Der Eintrag erscheint mit Seitenzahl im Index (Referenzen › Index einfügen).</div>
    </Frame>
  );
}

const KINDS: [string, string][] = [
  ["book", "Buch"],
  ["article", "Zeitschriftenartikel"],
  ["web", "Webseite"],
  ["report", "Bericht"],
];

const emptySource = (): Source => ({ tag: "", kind: "book", author: "", title: "", year: "" });

/** Tag like Word's: first author's last name (3 letters) + year. */
function makeTag(s: Source, existing: Source[]): string {
  const base = (s.author.split(",")[0] || s.title || "Quelle").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3) + (s.year.slice(-2) || "");
  let tag = base || "Q";
  for (let i = 1; existing.some((x) => x.tag === tag); i++) tag = `${base}${i}`;
  return tag;
}

/** Source manager ("Quellen verwalten") and the source editor. */
export function SourcesDialog(p: { open: boolean; sources: Source[]; cite?: boolean; onClose: () => void; onSave: (sources: Source[]) => void; onCite?: (tag: string) => void }) {
  const [list, setList] = useState(p.sources);
  const [edit, setEdit] = useState<Source | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) (setList(p.sources), setEdit(p.cite && !p.sources.length ? emptySource() : null), setOrig(null), setPick(null));
  }, [p.open, p.sources, p.cite]);
  if (!p.open) return null;
  const set = (patch: Partial<Source>) => setEdit((e) => (e ? { ...e, ...patch } : e));
  if (edit) {
    const save = () => {
      const s = { ...edit, tag: edit.tag || makeTag(edit, list.filter((x) => x.tag !== orig)) };
      const next = orig ? list.map((x) => (x.tag === orig ? s : x)) : [...list, s];
      setList(next);
      p.onSave(next);
      setEdit(null);
      if (p.cite && !orig) p.onCite?.(s.tag);
    };
    const f = (k: keyof Source, label: string, hint?: string) => (
      <Field label={label} hint={hint}>
        <Input value={(edit[k] as string) ?? ""} onChange={(_, d) => set({ [k]: d.value })} />
      </Field>
    );
    return (
      <Frame
        title={orig ? "Quelle bearbeiten" : "Neue Quelle"}
        width={520}
        onClose={() => setEdit(null)}
        actions={
          <>
            <Button onClick={() => (p.cite && !list.length ? p.onClose() : setEdit(null))}>Abbrechen</Button>
            <Button appearance="primary" disabled={!edit.title.trim() && !edit.author.trim()} onClick={save}>
              OK
            </Button>
          </>
        }
      >
        <Field label="Quellentyp">
          <Dropdown value={KINDS.find((k) => k[0] === edit.kind)?.[1] ?? "Buch"} selectedOptions={[edit.kind]} onOptionSelect={(_, d) => set({ kind: d.optionValue ?? "book" })}>
            {KINDS.map(([v, l]) => (
              <Option key={v} value={v}>
                {l}
              </Option>
            ))}
          </Dropdown>
        </Field>
        {f("author", "Autor", "Nachname, Vorname; weitere Autoren mit Semikolon trennen")}
        {f("title", "Titel")}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 110 }}>{f("year", "Jahr")}</div>
          <div style={{ flex: 1 }}>{edit.kind === "article" ? f("journal", "Zeitschrift") : edit.kind === "web" ? f("url", "URL") : f("publisher", "Verlag")}</div>
        </div>
        {edit.kind === "article" ? f("pages", "Seiten") : edit.kind !== "web" && f("city", "Ort")}
        {f("tag", "Tagname", "Kurzname der Quelle; leer = automatisch")}
        <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>Vorschau: {bibliographyText({ ...edit, tag: edit.tag || "x" })}</div>
      </Frame>
    );
  }
  const chosen = list.find((s) => s.tag === pick) ?? null;
  return (
    <Frame
      title={p.cite ? "Zitat einfügen" : "Quellen verwalten"}
      width={560}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={() => (setEdit(emptySource()), setOrig(null))}>Neue Quelle …</Button>
          <Button disabled={!chosen} onClick={() => chosen && (setEdit(chosen), setOrig(chosen.tag))}>
            Bearbeiten …
          </Button>
          {!p.cite && (
            <Button disabled={!chosen} onClick={() => chosen && (setList(list.filter((s) => s !== chosen)), p.onSave(list.filter((s) => s !== chosen)), setPick(null))}>
              Löschen
            </Button>
          )}
          {p.cite ? (
            <Button appearance="primary" disabled={!chosen} onClick={() => chosen && p.onCite?.(chosen.tag)}>
              Zitieren
            </Button>
          ) : (
            <Button appearance="primary" onClick={p.onClose}>
              Schließen
            </Button>
          )}
        </>
      }
    >
      {list.length ? (
        <Listbox selectedOptions={pick ? [pick] : []} onOptionSelect={(_, d) => setPick(d.optionValue ?? null)} style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke1}` }}>
          {list.map((s) => (
            <Option key={s.tag} value={s.tag} text={s.title} onDoubleClick={() => (p.cite ? p.onCite?.(s.tag) : (setEdit(s), setOrig(s.tag)))}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.title || "(ohne Titel)"}</div>
                <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>
                  {s.author || "ohne Autor"} · {s.year || "o. J."} · {s.tag}
                </div>
              </div>
            </Option>
          ))}
        </Listbox>
      ) : (
        <div>Noch keine Quellen. Legen Sie mit „Neue Quelle …“ eine an.</div>
      )}
    </Frame>
  );
}
