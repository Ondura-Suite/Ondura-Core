// Add a shared mailbox (team or function mailbox) using the rights of an
// existing Microsoft 365 or Exchange account.

import { useEffect, useState } from "react";
import {
  Button,
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
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { api, errorMessage } from "../../lib/api";
import type { Account } from "../../lib/types";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

export interface SharedMailboxDialogProps {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
  onAdded: (account: Account) => void;
}

export function SharedMailboxDialog({ open, accounts, onClose, onAdded }: SharedMailboxDialogProps) {
  const s = useStyles();
  // Only own mailboxes can open others.
  const parents = accounts.filter((a) => (a.kind.type === "graph" || a.kind.type === "ews") && !a.kind.mailbox);
  const [parentId, setParentId] = useState("");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setParentId(parents[0]?.id ?? "");
    setAddress("");
    setName("");
    setError(null);
  }, [open]);

  const parent = parents.find((a) => a.id === parentId);
  const valid = !!parent && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.trim());

  const add = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api.addSharedMailbox(parentId, address.trim(), name.trim());
      onAdded(a);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>Freigegebenes Postfach hinzufügen</DialogTitle>
          <DialogContent>
            <div className={s.form}>
              {parents.length === 0 ? (
                <MessageBar intent="info">
                  <MessageBarBody>Freigegebene Postfächer lassen sich über ein Microsoft-365- oder Exchange-Konto öffnen. Bitte fügen Sie zuerst ein solches Konto hinzu.</MessageBarBody>
                </MessageBar>
              ) : (
                <>
                  <Field label="Mit den Rechten von">
                    <Dropdown
                      value={parent ? `${parent.displayName} (${parent.email})` : ""}
                      selectedOptions={[parentId]}
                      onOptionSelect={(_, d) => d.optionValue && setParentId(d.optionValue)}
                    >
                      {parents.map((a) => (
                        <Option key={a.id} value={a.id} text={`${a.displayName} (${a.email})`}>
                          {a.displayName} ({a.email})
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label="E-Mail-Adresse des Postfachs" required>
                    <Input type="email" value={address} onChange={(_, d) => setAddress(d.value)} placeholder="info@example.com" />
                  </Field>
                  <Field label="Anzeigename">
                    <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="z. B. Support-Team" />
                  </Field>
                  <span className={s.hint}>
                    Sie brauchen Vollzugriff auf das Postfach (und „Senden als“, um aus ihm zu senden). Das Postfach erscheint als eigenes Konto mit Ordnern, Kalender und Kontakten.
                  </span>
                </>
              )}
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={busy}>Abbrechen</Button>
            <Button appearance="primary" disabled={!valid || busy} onClick={add}>
              {busy ? <Spinner size="tiny" /> : "Hinzufügen"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
