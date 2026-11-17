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
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Building24Regular, CalendarPerson24Regular, Cloud24Regular, Server24Regular } from "@fluentui/react-icons";
import type { Account, Security } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";

const useStyles = makeStyles({
  choices: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" },
  choice: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "14px 16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover, border: `1px solid ${tokens.colorBrandStroke1}` },
    ":disabled": { cursor: "default", opacity: 0.55 },
  },
  choiceIcon: { color: tokens.colorBrandForeground1, flexShrink: 0 },
  choiceTitle: { fontWeight: tokens.fontWeightSemibold, display: "block" },
  choiceDesc: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  form: { display: "grid", gridTemplateColumns: "1fr 110px 140px", gap: "10px 12px", marginTop: "8px" },
  full: { gridColumn: "1 / -1" },
  section: { gridColumn: "1 / -1", marginTop: "8px", fontWeight: tokens.fontWeightSemibold },
});

type Step = "choose" | "imap" | "graph" | "ews" | "dav";

export interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (account: Account) => void;
  /** Opened from calendar/contacts/tasks: hides plain IMAP, offers CalDAV first. */
  pim?: boolean;
}

const SECURITY_LABEL: Record<Security, string> = { tls: "SSL/TLS", startTls: "STARTTLS" };

export function AccountDialog({ open, onClose, onAdded, pim }: AccountDialogProps) {
  const s = useStyles();
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // IMAP form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSec, setImapSec] = useState<Security>("tls");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSec, setSmtpSec] = useState<Security>("startTls");
  const [touchedHosts, setTouchedHosts] = useState(false);

  // EWS form
  const [ewsUrl, setEwsUrl] = useState("");
  const [davUrl, setDavUrl] = useState("");
  const [touchedUrl, setTouchedUrl] = useState(false);

  // Graph form
  const [clientId, setClientId] = useState("");
  const [personal, setPersonal] = useState(false);
  const [orgTenant, setOrgTenant] = useState("");
  const [bakedClientId, setBakedClientId] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (open) {
      setStep("choose");
      setError(null);
      setAdvanced(false);
      api.defaultGraphClientId().then((id) => {
        setBakedClientId(!!id);
        if (id) setClientId(id);
      });
    }
  }, [open]);

  // Suggest mail.<domain> for both servers until the user edits them.
  useEffect(() => {
    if (touchedHosts) return;
    const domain = email.split("@")[1];
    if (domain) {
      setImapHost(`mail.${domain}`);
      setSmtpHost(`mail.${domain}`);
    }
  }, [email, touchedHosts]);

  useEffect(() => {
    const domain = email.split("@")[1];
    if (!touchedUrl && domain) setEwsUrl(`https://mail.${domain}/EWS/Exchange.asmx`);
  }, [email, touchedUrl]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const account =
        step === "dav"
          ? await api.addDavAccount({ displayName: name || email, email, password, url: davUrl.trim(), username: username.trim() })
          : step === "ews"
          ? await api.addEwsAccount({ displayName: name || email, email, password, config: { url: ewsUrl.trim(), username: username.trim() || email } })
          : step === "imap"
          ? await api.addImapAccount({
              displayName: name || email,
              email,
              password,
              config: {
                imapHost,
                imapPort: Number(imapPort),
                imapSecurity: imapSec,
                smtpHost,
                smtpPort: Number(smtpPort),
                smtpSecurity: smtpSec,
                username: username || email,
              },
            })
          : await api.addGraphAccount({ clientId: clientId.trim(), tenant: graphTenant() });
      onAdded(account);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Personal accounts sign in through the "consumers" endpoint; "common"
  // accepts both kinds but occasionally fails for personal accounts. An
  // explicit organisation (domain or tenant id) wins over both.
  const graphTenant = () => orgTenant.trim() || (personal ? "consumers" : "common");

  const securityDropdown = (value: Security, set: (v: Security) => void, setPort: (p: string) => void, ports: Record<Security, string>) => (
    <Dropdown
      value={SECURITY_LABEL[value]}
      selectedOptions={[value]}
      onOptionSelect={(_, d) => {
        const v = d.optionValue as Security;
        set(v);
        setPort(ports[v]);
      }}
    >
      <Option value="tls">SSL/TLS</Option>
      <Option value="startTls">STARTTLS</Option>
    </Dropdown>
  );

  const canSubmit =
    step === "imap"
      ? !!email && !!password && !!imapHost && !!smtpHost
      : step === "dav"
        ? !!email && !!password && /^https?:\/\//.test(davUrl.trim())
      : step === "ews"
        ? !!email && !!password && /^https?:\/\//.test(ewsUrl.trim())
        : step === "graph"
          ? !!clientId.trim()
          : false;

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 620 }}>
        <DialogBody>
          <DialogTitle>Konto hinzufügen</DialogTitle>
          <DialogContent>
            {step === "choose" && (
              <div className={s.choices}>
                <button className={s.choice} onClick={() => setStep("graph")}>
                  <Cloud24Regular className={s.choiceIcon} />
                  <span>
                    <span className={s.choiceTitle}>Microsoft 365 / Outlook.com</span>
                    <span className={s.choiceDesc}>Geschäfts-, Schul- und Outlook.com-Konten über Microsoft Graph</span>
                  </span>
                </button>
                <button className={s.choice} onClick={() => setStep("ews")}>
                  <Building24Regular className={s.choiceIcon} />
                  <span>
                    <span className={s.choiceTitle}>Exchange Server (lokal)</span>
                    <span className={s.choiceDesc}>Exchange 2013 oder neuer im eigenen Netzwerk (Exchange Web Services, NTLM)</span>
                  </span>
                </button>
                {!pim && (
                <button className={s.choice} onClick={() => setStep("imap")}>
                  <Server24Regular className={s.choiceIcon} />
                  <span>
                    <span className={s.choiceTitle}>IMAP / SMTP</span>
                    <span className={s.choiceDesc}>Eigener Mailserver, GMX, Web.de, Gmail und andere</span>
                  </span>
                </button>
                )}
                <button className={s.choice} onClick={() => setStep("dav")}>
                  <CalendarPerson24Regular className={s.choiceIcon} />
                  <span>
                    <span className={s.choiceTitle}>CalDAV / CardDAV</span>
                    <span className={s.choiceDesc}>Nur Kalender, Kontakte und Aufgaben – Nextcloud, Radicale, mailbox.org, iCloud und andere</span>
                  </span>
                </button>
              </div>
            )}

            {step === "imap" && (
              <div className={s.form}>
                <Field label="Name" className={s.full}>
                  <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="Wird Empfängern angezeigt" />
                </Field>
                <Field label="E-Mail-Adresse" className={s.full} required>
                  <Input type="email" value={email} onChange={(_, d) => setEmail(d.value)} />
                </Field>
                <Field label="Benutzername" style={{ gridColumn: "1 / 2" }} hint="Leer = E-Mail-Adresse">
                  <Input value={username} onChange={(_, d) => setUsername(d.value)} />
                </Field>
                <Field label="Passwort" style={{ gridColumn: "2 / -1" }} required>
                  <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} />
                </Field>

                <Text className={s.section}>Posteingangsserver (IMAP)</Text>
                <Field label="Server">
                  <Input value={imapHost} onChange={(_, d) => (setTouchedHosts(true), setImapHost(d.value))} />
                </Field>
                <Field label="Port">
                  <Input value={imapPort} onChange={(_, d) => setImapPort(d.value)} />
                </Field>
                <Field label="Sicherheit">{securityDropdown(imapSec, setImapSec, setImapPort, { tls: "993", startTls: "143" })}</Field>

                <Text className={s.section}>Postausgangsserver (SMTP)</Text>
                <Field label="Server">
                  <Input value={smtpHost} onChange={(_, d) => (setTouchedHosts(true), setSmtpHost(d.value))} />
                </Field>
                <Field label="Port">
                  <Input value={smtpPort} onChange={(_, d) => setSmtpPort(d.value)} />
                </Field>
                <Field label="Sicherheit">{securityDropdown(smtpSec, setSmtpSec, setSmtpPort, { tls: "465", startTls: "587" })}</Field>
              </div>
            )}

            {step === "ews" && (
              <div className={s.form}>
                <Field label="Name" className={s.full}>
                  <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="Wird Empfängern angezeigt" />
                </Field>
                <Field label="E-Mail-Adresse" className={s.full} required>
                  <Input type="email" value={email} onChange={(_, d) => setEmail(d.value)} />
                </Field>
                <Field label="Benutzername" style={{ gridColumn: "1 / 2" }} hint="DOMÄNE\benutzer oder benutzer@domäne">
                  <Input value={username} onChange={(_, d) => setUsername(d.value)} placeholder={email} />
                </Field>
                <Field label="Passwort" style={{ gridColumn: "2 / -1" }} required>
                  <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} />
                </Field>
                <Field label="EWS-Adresse" className={s.full} hint="Meist https://mail.ihre-domain.de/EWS/Exchange.asmx" required>
                  <Input value={ewsUrl} onChange={(_, d) => (setTouchedUrl(true), setEwsUrl(d.value))} />
                </Field>
              </div>
            )}

            {step === "dav" && (
              <div className={s.form}>
                <Field label="Name" className={s.full}>
                  <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="Wird als Organisator angezeigt" />
                </Field>
                <Field label="E-Mail-Adresse" className={s.full} required>
                  <Input type="email" value={email} onChange={(_, d) => setEmail(d.value)} />
                </Field>
                <Field label="Benutzername" style={{ gridColumn: "1 / 2" }} hint="Leer = E-Mail-Adresse">
                  <Input value={username} onChange={(_, d) => setUsername(d.value)} />
                </Field>
                <Field label="Passwort" style={{ gridColumn: "2 / -1" }} required hint="Bei Nextcloud am besten ein App-Passwort">
                  <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} />
                </Field>
                <Field label="Server-Adresse" className={s.full} hint="z. B. https://cloud.example.de/remote.php/dav – Kalender und Adressbücher werden automatisch gefunden" required>
                  <Input value={davUrl} onChange={(_, d) => setDavUrl(d.value)} placeholder="https://" />
                </Field>
              </div>
            )}

            {step === "graph" && (
              <div className={s.form}>
                <Text className={s.full}>
                  Sie werden im Browser bei Microsoft angemeldet. Orbit erhält Zugriff auf E-Mail, Kalender, Kontakte und Aufgaben.
                </Text>
                <Checkbox
                  className={s.full}
                  checked={personal}
                  disabled={!!orgTenant.trim()}
                  onChange={(_, d) => setPersonal(!!d.checked)}
                  label={
                    <span>
                      Privates Microsoft-Konto
                      <br />
                      <span className={s.choiceDesc}>Outlook.com, Hotmail, Live oder MSN – nicht für Firmen- und Schulkonten</span>
                    </span>
                  }
                />
                {(!bakedClientId || advanced) && (
                  <Field label="Anwendungs-ID (Client-ID)" className={s.full} hint="Aus der App-Registrierung in Microsoft Entra ID" required>
                    <Input value={clientId} onChange={(_, d) => setClientId(d.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                  </Field>
                )}
                {advanced ? (
                  <Field label="Nur Konten dieser Organisation (optional)" className={s.full} hint="Domäne oder Mandanten-ID, z. B. firma.de – nur nötig, wenn Ihre IT das verlangt">
                    <Input value={orgTenant} onChange={(_, d) => setOrgTenant(d.value)} placeholder="firma.de" />
                  </Field>
                ) : (
                  <Button appearance="transparent" size="small" className={s.full} style={{ justifySelf: "start", padding: 0 }} onClick={() => setAdvanced(true)}>
                    Erweiterte Einstellungen
                  </Button>
                )}
              </div>
            )}

            {error && (
              <MessageBar intent="error" style={{ marginTop: 12 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions style={{ whiteSpace: "nowrap" }}>
            {step !== "choose" && (
              <Button appearance="secondary" disabled={busy} onClick={() => setStep("choose")} style={{ marginRight: "auto" }}>
                Zurück
              </Button>
            )}
            <Button appearance="secondary" disabled={busy} onClick={onClose}>Abbrechen</Button>
            {step !== "choose" && (
              <Button appearance="primary" disabled={busy || !canSubmit} onClick={submit} icon={busy ? <Spinner size="tiny" /> : undefined}>
                {busy ? (step === "graph" ? "Warte auf Anmeldung…" : "Verbinde…") : step === "graph" ? "Mit Microsoft anmelden" : "Verbinden"}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
