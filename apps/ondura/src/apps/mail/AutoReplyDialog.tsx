// Automatic replies (out of office) per account, stored on the server:
// Microsoft 365 (mailboxSettings), Exchange (OOF settings) or IMAP servers
// with ManageSieve (Sieve vacation).

import { useEffect, useState } from "react";
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
  Spinner,
  Switch,
  Tab,
  TabList,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { api, errorMessage } from "../../lib/api";
import type { Account, AutoReply } from "../../lib/types";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  period: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" },
  disabled: { opacity: 0.5, pointerEvents: "none" },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

/** Plain text of an HTML reply (paragraphs and line breaks kept). */
export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** HTML for a plain-text reply. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** `datetime-local` value of an ISO time. */
function localInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultPeriod(): [string, string] {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return [start.toISOString(), end.toISOString()];
}

export interface AutoReplyDialogProps {
  open: boolean;
  accounts: Account[];
  initialAccountId?: string | null;
  onClose: () => void;
  /** Called after saving with the new state. */
  onSaved: (accountId: string, reply: AutoReply) => void;
}

export function AutoReplyDialog({ open, accounts, initialAccountId, onClose, onSaved }: AutoReplyDialogProps) {
  const s = useStyles();
  const mailAccounts = accounts.filter((a) => a.kind.type !== "dav");
  const [accountId, setAccountId] = useState<string>("");
  const [reply, setReply] = useState<AutoReply | null>(null);
  const [internal, setInternal] = useState("");
  const [external, setExternal] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [tab, setTab] = useState<"internal" | "external">("internal");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = mailAccounts.find((a) => a.id === accountId);
  // IMAP (Sieve) has no inside/outside distinction.
  const twoReplies = account?.kind.type === "graph" || account?.kind.type === "ews";

  useEffect(() => {
    if (open) setAccountId(initialAccountId && mailAccounts.some((a) => a.id === initialAccountId) ? initialAccountId : mailAccounts[0]?.id ?? "");
  }, [open]);

  useEffect(() => {
    if (!open || !accountId) return;
    setLoading(true);
    setError(null);
    setReply(null);
    setTab("internal");
    api
      .getAutoReply(accountId)
      .then((r) => {
        setReply(r);
        setInternal(htmlToText(r.internal));
        setExternal(htmlToText(r.external));
        const has = !!(r.start && r.end);
        setScheduled(has);
        const [ds, de] = defaultPeriod();
        setStart(localInput(r.start ?? ds));
        setEnd(localInput(r.end ?? de));
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [open, accountId]);

  const invalidPeriod = scheduled && (!start || !end || new Date(end) <= new Date(start));

  const save = async () => {
    if (!reply || !accountId) return;
    const next: AutoReply = {
      ...reply,
      start: scheduled ? new Date(start).toISOString() : null,
      end: scheduled ? new Date(end).toISOString() : null,
      internal: textToHtml(internal),
      external: textToHtml(twoReplies ? external : internal),
    };
    setSaving(true);
    setError(null);
    try {
      await api.setAutoReply(accountId, next);
      onSaved(accountId, next);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !saving && onClose()}>
      <DialogSurface style={{ maxWidth: 600 }}>
        <DialogBody>
          <DialogTitle>{tl("Automatische Antworten")}</DialogTitle>
          <DialogContent>
            <div className={s.form}>
              {mailAccounts.length > 1 && (
                <Field label={tl("Konto")}>
                  <Dropdown
                    value={account ? `${account.displayName} (${account.email})` : ""}
                    selectedOptions={[accountId]}
                    onOptionSelect={(_, d) => d.optionValue && setAccountId(d.optionValue)}
                  >
                    {mailAccounts.map((a) => (
                      <Option key={a.id} value={a.id} text={`${a.displayName} (${a.email})`}>
                        {a.displayName} ({a.email})
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              {loading ? (
                <Spinner size="small" label={tl("Einstellungen werden vom Server geladen…")} />
              ) : reply ? (
                <>
                  <Switch
                    checked={reply.enabled}
                    onChange={(_, d) => setReply({ ...reply, enabled: d.checked })}
                    label={tl("Automatische Antworten senden")}
                  />
                  <div className={reply.enabled ? undefined : s.disabled} aria-disabled={!reply.enabled}>
                    <div className={s.form}>
                      <Checkbox checked={scheduled} onChange={(_, d) => setScheduled(!!d.checked)} label={tl("Nur in diesem Zeitraum senden")} />
                      {scheduled && (
                        <div className={s.period}>
                          <Field label={tl("Beginn")}>
                            <Input type="datetime-local" value={start} onChange={(_, d) => setStart(d.value)} />
                          </Field>
                          <Field label={tl("Ende")} validationMessage={invalidPeriod ? tl("Das Ende muss nach dem Beginn liegen") : undefined}>
                            <Input type="datetime-local" value={end} onChange={(_, d) => setEnd(d.value)} />
                          </Field>
                        </div>
                      )}
                      {twoReplies && (
                        <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "internal" | "external")}>
                          <Tab value="internal">{tl("Innerhalb meiner Organisation")}</Tab>
                          <Tab value="external">{tl("Außerhalb meiner Organisation")}</Tab>
                        </TabList>
                      )}
                      {tab === "internal" || !twoReplies ? (
                        <Field label={twoReplies ? tl("Antwort an Personen in meiner Organisation") : tl("Antworttext")}>
                          <Textarea rows={7} value={internal} onChange={(_, d) => setInternal(d.value)} placeholder={tl("Vielen Dank für Ihre Nachricht. Ich bin bis … nicht im Büro.")} />
                        </Field>
                      ) : (
                        <>
                          <RadioGroup
                            value={reply.externalAudience}
                            onChange={(_, d) => setReply({ ...reply, externalAudience: d.value as AutoReply["externalAudience"] })}
                          >
                            <Radio value="none" label={tl("Keine Antwort an externe Absender")} />
                            <Radio value="known" label={tl("Nur an meine Kontakte")} />
                            <Radio value="all" label={tl("An alle externen Absender")} />
                          </RadioGroup>
                          <Field label={tl("Antwort an Personen außerhalb meiner Organisation")}>
                            <Textarea
                              rows={6}
                              value={external}
                              disabled={reply.externalAudience === "none"}
                              onChange={(_, d) => setExternal(d.value)}
                            />
                          </Field>
                          {reply.externalAudience !== "none" && !external.trim() && internal.trim() && (
                            <Button size="small" appearance="transparent" style={{ alignSelf: "flex-start", padding: 0 }} onClick={() => setExternal(internal)}>
                              {tl("Interne Antwort übernehmen")}
                            </Button>
                          )}
                        </>
                      )}
                      {account?.kind.type === "imap" && (
                        <span className={s.hint}>
                          {tl("Die Antwort wird als Sieve-Regel auf dem Mailserver gespeichert (ManageSieve, Port 4190) und höchstens einmal pro Tag und Absender gesendet.")}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={saving}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" disabled={!reply || saving || (reply.enabled && invalidPeriod)} onClick={save}>
              {saving ? <Spinner size="tiny" /> : tl("Speichern")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
