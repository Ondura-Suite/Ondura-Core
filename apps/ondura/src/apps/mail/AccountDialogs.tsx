// Small dialogs around account state: re-authentication and the outbox.

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Account, OutboxItem, OutgoingMessage } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { displayName } from "../../lib/format";
import { tl, LOCALE } from "../../lib/i18n";

const useStyles = makeStyles({
  item: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  itemText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: tokens.fontSizeBase200 },
});

/** Password prompt (IMAP) or Microsoft sign-in (Graph) for a broken account. */
export function ReauthDialog({ account, onClose, onDone }: { account: Account | null; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword("");
    setError(null);
  }, [account]);

  const submit = async () => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      if (account.kind.type === "graph") await api.reauthGraph(account.id);
      else await api.updatePassword(account.id, password);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const graph = account?.kind.type === "graph";
  return (
    <Dialog open={!!account} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{graph ? tl("Erneut anmelden") : tl("Passwort eingeben")}</DialogTitle>
          <DialogContent>
            <Text block style={{ marginBottom: 12 }}>
              {graph
                ? tl("Die Anmeldung für {0} ist abgelaufen. Melden Sie sich im Browser erneut bei Microsoft an.", account?.email)
                : tl("Der Server hat das Passwort für {0} abgelehnt.", account?.email)}
            </Text>
            {!graph && (
              <Field label={tl("Passwort")}>
                <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
              </Field>
            )}
            {error && (
              <MessageBar intent="error" style={{ marginTop: 12 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onClose}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" disabled={busy || (!graph && !password)} onClick={submit} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {graph ? tl("Mit Microsoft anmelden") : tl("Speichern")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Messages waiting to be sent (offline, or refused by the server). */
export function OutboxDialog({
  account,
  onClose,
  onEdit,
}: {
  account: Account | null;
  onClose: () => void;
  onEdit: (accountId: string, message: OutgoingMessage) => void;
}) {
  const s = useStyles();
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => account && api.outbox(account.id).then(setItems).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const discard = async (item: OutboxItem) => {
    if (!account) return;
    await api.discardPending(account.id, item.opId);
    load();
  };

  return (
    <Dialog open={!!account} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 620 }}>
        <DialogBody>
          <DialogTitle>{tl("Postausgang –")} {account?.email}</DialogTitle>
          <DialogContent>
            {items === null ? (
              <Spinner />
            ) : items.length === 0 ? (
              <Text>{tl("Der Postausgang ist leer.")}</Text>
            ) : (
              items.map((item) => (
                <div key={item.opId} className={s.item}>
                  <div className={s.itemText}>
                    <Text weight="semibold" className={s.ellipsis}>{item.message.subject || tl("(Kein Betreff)")}</Text>
                    <Text size={200} className={s.ellipsis}>{tl("An:")} {item.message.to.map(displayName).join("; ")}</Text>
                    {item.sendAt && !item.error && (
                      <Text size={200} style={{ color: tokens.colorBrandForeground1 }}>
                        {tl("Wird gesendet am")} {new Date(item.sendAt * 1000).toLocaleString(LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    )}
                    {item.error && <span className={s.error}>{item.error}</span>}
                  </div>
                  <Button size="small" onClick={() => (onEdit(account!.id, item.message), discard(item), onClose())}>{tl("Bearbeiten")}</Button>
                  <Button size="small" appearance="subtle" onClick={() => discard(item)}>{tl("Verwerfen")}</Button>
                </div>
              ))
            )}
            {error && (
              <MessageBar intent="error" style={{ marginTop: 12 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            {items && items.length > 0 && (
              <Button appearance="primary" onClick={() => account && api.retryPending(account.id).then(onClose)}>{tl("Erneut senden")}</Button>
            )}
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
