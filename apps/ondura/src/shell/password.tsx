// Password prompts for protected Office files: asking when opening, and
// setting or removing the password of the open document.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import { LockClosed24Regular } from "@fluentui/react-icons";
import { tl } from "../lib/i18n";

interface Ask {
  name: string;
  wrong: boolean;
  resolve: (password: string | null) => void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const set = (a: Ask | null) => {
  current = a;
  listeners.forEach((l) => l());
};

/** Ask for the password of a protected file; `null` = cancelled. */
export function askPassword(name: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => set({ name, wrong, resolve }));
}

export function PasswordPromptHost() {
  const ask = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [ask]);
  if (!ask) return null;
  const done = (v: string | null) => {
    set(null);
    ask.resolve(v);
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && done(null)}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value) done(value);
          }}
        >
          <DialogBody>
            <DialogTitle>{tl("Kennwort")}</DialogTitle>
            <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text>{tl("„{0}“ ist durch ein Kennwort geschützt.", ask.name)}</Text>
              {ask.wrong && (
                <MessageBar intent="error">
                  <MessageBarBody>{tl("Das Kennwort ist falsch.")}</MessageBarBody>
                </MessageBar>
              )}
              <Field label={tl("Kennwort eingeben, um die Datei zu öffnen")}>
                <Input type="password" autoFocus value={value} onChange={(_, d) => setValue(d.value)} contentBefore={<LockClosed24Regular />} />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button type="submit" appearance="primary" disabled={!value}>
                {tl("OK")}
              </Button>
              <Button onClick={() => done(null)}>{tl("Abbrechen")}</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

/** "Mit Kennwort verschlüsseln" in Datei › Informationen. */
export function ProtectSection({ password, onChange }: { password: string | null; onChange: (password: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  useEffect(() => {
    setA("");
    setB("");
  }, [open]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: "1px solid var(--colorNeutralStroke2)", borderRadius: 6, maxWidth: 560 }}>
      <LockClosed24Regular />
      <div style={{ flex: 1 }}>
        <Text weight="semibold" block>
          {tl("Dokument schützen")}
        </Text>
        <Text size={200}>{password ? tl("Zum Öffnen ist ein Kennwort erforderlich.") : tl("Jeder kann die Datei öffnen.")}</Text>
      </div>
      {password ? (
        <Button onClick={() => onChange(null)}>{tl("Kennwort entfernen")}</Button>
      ) : (
        <Button onClick={() => setOpen(true)}>{tl("Mit Kennwort verschlüsseln…")}</Button>
      )}
      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
        <DialogSurface style={{ maxWidth: 420 }}>
          <DialogBody>
            <DialogTitle>{tl("Mit Kennwort verschlüsseln")}</DialogTitle>
            <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text size={200}>{tl("Achtung: Ein vergessenes Kennwort kann nicht wiederhergestellt werden. Die Datei wird beim nächsten Speichern verschlüsselt (AES-256, kompatibel mit Microsoft Office).")}</Text>
              <Field label={tl("Kennwort")}>
                <Input type="password" autoFocus value={a} onChange={(_, d) => setA(d.value)} />
              </Field>
              <Field label={tl("Kennwort bestätigen")} validationMessage={b && a !== b ? tl("Die Kennwörter stimmen nicht überein.") : undefined}>
                <Input type="password" value={b} onChange={(_, d) => setB(d.value)} />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={!a || a !== b} onClick={() => (onChange(a), setOpen(false))}>
                {tl("OK")}
              </Button>
              <Button onClick={() => setOpen(false)}>{tl("Abbrechen")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
