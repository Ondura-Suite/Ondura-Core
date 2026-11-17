import { useEffect, useRef, useState } from "react";
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
  SpinButton,
  Switch,
  Tab,
  TabList,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import type { Account, AppSettings, Folder, MailRule } from "../../lib/types";
import { RulesEditor } from "./RulesEditor";
import { api, errorMessage } from "../../lib/api";
import { sanitizeHtml } from "../../lib/html";

const useStyles = makeStyles({
  surface: { maxWidth: "760px", width: "90vw" },
  body: { display: "flex", flexDirection: "column", gap: "14px", minHeight: "380px", paddingTop: "8px" },
  accounts: { display: "grid", gridTemplateColumns: "220px 1fr", gap: "16px", minHeight: "340px" },
  accountList: { display: "flex", flexDirection: "column", gap: "2px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, paddingRight: "8px" },
  accountItem: {
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  accountSelected: { backgroundColor: tokens.colorBrandBackground2, fontWeight: tokens.fontWeightSemibold },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  signature: {
    minHeight: "110px",
    maxHeight: "200px",
    overflowY: "auto",
    padding: "8px 10px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    outline: "none",
    fontSize: tokens.fontSizeBase300,
    ":focus": { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  row: { display: "flex", gap: "8px", flexWrap: "wrap" },
});

export interface SettingsDialogProps {
  open: boolean;
  accounts: Account[];
  initialAccountId?: string | null;
  onClose: () => void;
  onAccountsChanged: () => void;
  onRemoveAccount: (a: Account) => void;
  onReauth: (a: Account) => void;
  onSettingsChanged: (s: AppSettings) => void;
  folders: Folder[];
  initialTab?: "general" | "accounts" | "rules";
}

export function SettingsDialog(p: SettingsDialogProps) {
  const s = useStyles();
  const [tab, setTab] = useState<"general" | "accounts" | "rules">("general");
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const signature = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.open) return;
    setError(null);
    api.getSettings().then(setSettings).catch((e) => setError(errorMessage(e)));
    api.rules().then((r) => (setRules(r), setRuleId(r[0]?.id ?? null))).catch(() => setRules([]));
    if (p.initialTab) setTab(p.initialTab);
    if (p.initialAccountId) {
      setTab("accounts");
      setAccountId(p.initialAccountId);
    } else {
      setAccountId((id) => id ?? p.accounts[0]?.id ?? null);
    }
  }, [p.open, p.initialAccountId, p.accounts]);

  const account = p.accounts.find((a) => a.id === accountId) ?? null;

  useEffect(() => {
    setDisplayName(account?.displayName ?? "");
    if (signature.current) signature.current.innerHTML = account?.signature ? sanitizeHtml(account.signature) : "";
  }, [account, tab]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (settings) {
        await api.saveSettings(settings);
        p.onSettingsChanged(settings);
      }
      if (rules) await api.saveRules(rules);
      if (account) {
        const sig = signature.current?.innerHTML.trim() ?? "";
        const empty = !signature.current?.textContent?.trim() && !sig.includes("<img");
        await api.updateAccount(account.id, { displayName: displayName.trim() || account.email, signature: empty ? null : sig });
        p.onAccountsChanged();
      }
      p.onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setSettings((x) => (x ? { ...x, [k]: v } : x));

  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogContent>
            <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "general" | "accounts" | "rules")}>
              <Tab value="general">Allgemein</Tab>
              <Tab value="accounts">Konten</Tab>
              <Tab value="rules">Regeln</Tab>
            </TabList>
            <div className={s.body}>
              {tab === "general" && settings && (
                <>
                  <Field label="Alle Ordner synchronisieren alle (Minuten)" hint="Der Posteingang wird zusätzlich sofort (IMAP IDLE) bzw. jede Minute aktualisiert.">
                    <SpinButton
                      value={settings.syncIntervalMinutes}
                      min={1}
                      max={120}
                      onChange={(_, d) => set("syncIntervalMinutes", Math.max(1, Math.min(120, Number(d.value ?? d.displayValue) || 5)))}
                      style={{ width: 120 }}
                    />
                  </Field>
                  <Switch checked={settings.notifications} onChange={(_, d) => set("notifications", d.checked)} label="Benachrichtigung bei neuen E-Mails" />
                  <Switch
                    checked={settings.runInBackground}
                    onChange={(_, d) => set("runInBackground", d.checked)}
                    label="Nach dem Schließen im Infobereich weiterlaufen"
                  />
                  <Switch
                    checked={settings.loadRemoteImages}
                    onChange={(_, d) => set("loadRemoteImages", d.checked)}
                    label="Externe Bilder in E-Mails immer laden"
                  />
                  {!settings.keyringAvailable && (
                    <MessageBar intent="warning">
                      <MessageBarBody>
                        Kein Schlüsselbund des Betriebssystems gefunden. Passwörter werden in einer nur für Sie lesbaren Datei gespeichert.
                        Installieren Sie z. B. GNOME Keyring oder KWallet für mehr Sicherheit.
                      </MessageBarBody>
                    </MessageBar>
                  )}
                </>
              )}

              {tab === "accounts" && (
                <div className={s.accounts}>
                  <div className={s.accountList}>
                    {p.accounts.map((a) => (
                      <button
                        key={a.id}
                        className={mergeClasses(s.accountItem, a.id === accountId && s.accountSelected)}
                        onClick={() => setAccountId(a.id)}
                        title={a.email}
                      >
                        {a.email}
                      </button>
                    ))}
                  </div>
                  {account ? (
                    <div className={s.form}>
                      <Text weight="semibold">{account.email}</Text>
                      <Field label="Anzeigename" hint="Wird Empfängern als Absender angezeigt">
                        <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
                      </Field>
                      <Field label="Signatur" hint="Wird an neue Nachrichten und Antworten angehängt">
                        <div ref={signature} className={s.signature} contentEditable suppressContentEditableWarning role="textbox" aria-multiline />
                      </Field>
                      <div className={s.row}>
                        <Button onClick={() => p.onReauth(account)}>
                          {account.kind.type === "graph" ? "Erneut bei Microsoft anmelden" : "Passwort ändern"}
                        </Button>
                        <Button appearance="subtle" onClick={() => p.onRemoveAccount(account)}>Konto entfernen</Button>
                      </div>
                    </div>
                  ) : (
                    <Text>Kein Konto vorhanden.</Text>
                  )}
                </div>
              )}

              {tab === "rules" && rules && (
                <RulesEditor rules={rules} onChange={setRules} selectedId={ruleId} onSelect={setRuleId} accounts={p.accounts} folders={p.folders} />
              )}

              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={p.onClose}>Abbrechen</Button>
            <Button appearance="primary" disabled={saving} onClick={save}>Speichern</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
