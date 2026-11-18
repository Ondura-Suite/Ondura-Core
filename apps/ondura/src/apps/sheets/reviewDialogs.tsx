// Dialogs of the review tab and links: notes, hyperlinks and sheet protection.

import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Option, Textarea } from "@fluentui/react-components";
import type { Protection } from "./model";

function Frame({ title, width = 420, children, actions, onClose }: { title: string; width?: number; children: React.ReactNode; actions: React.ReactNode; onClose: () => void }) {
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

// ---------------------------------------------------------------- notes --

export function NoteDialog(p: { open: boolean; cell: string; text: string; author: string; onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(p.text);
  useEffect(() => {
    if (p.open) setText(p.text);
  }, [p.open, p.text]);
  if (!p.open) return null;
  return (
    <Frame
      title={`Notiz – ${p.cell}`}
      width={380}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" onClick={() => p.onSave(text)}>
            OK
          </Button>
        </>
      }
    >
      <Field label={p.author ? `${p.author}:` : "Text"}>
        <Textarea value={text} resize="vertical" rows={5} autoFocus onChange={(_, d) => setText(d.value)} />
      </Field>
    </Frame>
  );
}

// ---------------------------------------------------------------- links --

export interface LinkForm {
  kind: "web" | "place" | "mail";
  target: string;
  /** Text shown in the cell. */
  text: string;
  tooltip: string;
  /** Sheet and cell for links into the workbook. */
  sheet: string;
  cell: string;
  subject: string;
}

/** Splits a stored target into the dialog's fields. */
export function linkForm(target: string, text: string, tooltip: string | undefined, sheets: string[]): LinkForm {
  const base: LinkForm = { kind: "web", target: "", text, tooltip: tooltip ?? "", sheet: sheets[0] ?? "", cell: "A1", subject: "" };
  if (target.startsWith("#")) {
    const m = /^#'?(.+?)'?!(.+)$/.exec(target);
    return { ...base, kind: "place", sheet: m?.[1] ?? base.sheet, cell: m?.[2] ?? target.slice(1) };
  }
  if (target.startsWith("mailto:")) {
    const [addr, q] = target.slice(7).split("?");
    const subject = new URLSearchParams(q ?? "").get("subject") ?? "";
    return { ...base, kind: "mail", target: decodeURIComponent(addr), subject };
  }
  return { ...base, target };
}

/** The stored link target of the dialog's fields. */
export function linkTarget(f: LinkForm): string {
  if (f.kind === "place") return `#${/[^A-Za-z0-9_äöüÄÖÜß]/.test(f.sheet) ? `'${f.sheet}'` : f.sheet}!${f.cell.trim() || "A1"}`;
  if (f.kind === "mail") return `mailto:${f.target.trim()}${f.subject ? `?subject=${encodeURIComponent(f.subject)}` : ""}`;
  const t = f.target.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("\\\\") ? t : `https://${t}`;
}

export function LinkDialog(p: { open: boolean; initial: LinkForm; sheets: string[]; editing: boolean; onClose: () => void; onApply: (f: LinkForm) => void; onRemove: () => void }) {
  const [f, setF] = useState(p.initial);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p.open) setF(p.initial);
  }, [p.open, p.initial]);
  // The dialog focuses its first control; the address is what one types first.
  useEffect(() => {
    if (!p.open) return;
    const t = setTimeout(() => first.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [p.open, f.kind]);
  if (!p.open) return null;
  const set = (patch: Partial<LinkForm>) => setF((x) => ({ ...x, ...patch }));
  const ok = f.kind === "place" ? !!f.sheet : !!f.target.trim();
  const apply = () => ok && p.onApply(f);
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && (e.preventDefault(), apply());
  return (
    <Frame
      title={p.editing ? "Link bearbeiten" : "Link einfügen"}
      width={460}
      onClose={p.onClose}
      actions={
        <>
          {p.editing && <Button onClick={p.onRemove}>Link entfernen</Button>}
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Link zu">
        <Dropdown value={{ web: "Webseite oder Datei", place: "Aktuelles Dokument", mail: "E-Mail-Adresse" }[f.kind]} selectedOptions={[f.kind]} onOptionSelect={(_, d) => set({ kind: d.optionValue as LinkForm["kind"] })}>
          <Option value="web">Webseite oder Datei</Option>
          <Option value="place">Aktuelles Dokument</Option>
          <Option value="mail">E-Mail-Adresse</Option>
        </Dropdown>
      </Field>
      <Field label="Anzuzeigender Text">
        <Input value={f.text} onChange={(_, d) => set({ text: d.value })} onKeyDown={enter} />
      </Field>
      {f.kind === "web" && (
        <Field label="Adresse">
          <Input ref={first} value={f.target} placeholder="https://" onChange={(_, d) => set({ target: d.value })} onKeyDown={enter} />
        </Field>
      )}
      {f.kind === "mail" && (
        <>
          <Field label="E-Mail-Adresse">
            <Input ref={first} value={f.target} onChange={(_, d) => set({ target: d.value })} onKeyDown={enter} />
          </Field>
          <Field label="Betreff">
            <Input value={f.subject} onChange={(_, d) => set({ subject: d.value })} onKeyDown={enter} />
          </Field>
        </>
      )}
      {f.kind === "place" && (
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="Blatt" style={{ flex: 1 }}>
            <Dropdown value={f.sheet} selectedOptions={[f.sheet]} onOptionSelect={(_, d) => set({ sheet: d.optionValue ?? f.sheet })}>
              {p.sheets.map((s) => (
                <Option key={s} value={s}>
                  {s}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Zellbezug" style={{ width: 110 }}>
            <Input ref={first} value={f.cell} onChange={(_, d) => set({ cell: d.value })} onKeyDown={enter} />
          </Field>
        </div>
      )}
      <Field label="QuickInfo">
        <Input value={f.tooltip} onChange={(_, d) => set({ tooltip: d.value })} onKeyDown={enter} />
      </Field>
    </Frame>
  );
}

// ----------------------------------------------------------- protection --

const ALLOW: [keyof Protection, string][] = [
  ["selectLocked", "Gesperrte Zellen auswählen"],
  ["formatCells", "Zellen formatieren"],
  ["insertRows", "Zeilen einfügen"],
  ["deleteRows", "Zeilen löschen"],
  ["sort", "Sortieren"],
  ["autoFilter", "AutoFilter verwenden"],
];

export function ProtectDialog(p: { open: boolean; onClose: () => void; onProtect: (password: string, allow: Partial<Protection>) => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [allow, setAllow] = useState<Partial<Protection>>({ selectLocked: true });
  const [step, setStep] = useState<1 | 2>(1);
  useEffect(() => {
    if (p.open) (setPw(""), setPw2(""), setStep(1), setAllow({ selectLocked: true }));
  }, [p.open]);
  if (!p.open) return null;
  const ok = () => {
    if (pw && step === 1) return setStep(2);
    if (pw && pw !== pw2) return;
    p.onProtect(pw, allow);
  };
  return (
    <Frame
      title={step === 1 ? "Blatt schützen" : "Kennwort bestätigen"}
      width={380}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" disabled={step === 2 && pw !== pw2} onClick={ok}>
            OK
          </Button>
        </>
      }
    >
      {step === 1 ? (
        <>
          <Field label="Kennwort zum Aufheben des Blattschutzes (optional)">
            <Input type="password" value={pw} autoFocus onChange={(_, d) => setPw(d.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ok())} />
          </Field>
          <Field label="Alle Benutzer dieses Arbeitsblatts dürfen:">
            {ALLOW.map(([k, label]) => (
              <Checkbox key={k} label={label} checked={!!allow[k]} onChange={(_, d) => setAllow((a) => ({ ...a, [k]: !!d.checked }))} />
            ))}
          </Field>
        </>
      ) : (
        <Field label="Kennwort erneut eingeben" validationMessage={pw2 && pw !== pw2 ? "Die Kennwörter stimmen nicht überein." : undefined}>
          <Input type="password" value={pw2} autoFocus onChange={(_, d) => setPw2(d.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ok())} />
        </Field>
      )}
      <div style={{ fontSize: 12, opacity: 0.75 }}>Hinweis: Der Blattschutz verhindert versehentliche Änderungen, ist aber keine Verschlüsselung.</div>
    </Frame>
  );
}

export function UnprotectDialog(p: { open: boolean; onClose: () => void; onUnprotect: (password: string) => Promise<boolean> }) {
  const [pw, setPw] = useState("");
  const [wrong, setWrong] = useState(false);
  useEffect(() => {
    if (p.open) (setPw(""), setWrong(false));
  }, [p.open]);
  if (!p.open) return null;
  const ok = async () => setWrong(!(await p.onUnprotect(pw)));
  return (
    <Frame
      title="Blattschutz aufheben"
      width={340}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" onClick={ok}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Kennwort" validationMessage={wrong ? "Das Kennwort ist falsch." : undefined}>
        <Input type="password" value={pw} autoFocus onChange={(_, d) => (setPw(d.value), setWrong(false))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void ok())} />
      </Field>
    </Frame>
  );
}
