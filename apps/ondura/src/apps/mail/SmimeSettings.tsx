// Settings › S/MIME: own certificates (imported from .p12/.pfx) used to
// sign and to read encrypted messages.

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Certificate24Regular, Delete20Regular, ArrowImport20Regular } from "@fluentui/react-icons";
import { api, errorMessage } from "../../lib/api";
import type { CertInfo } from "../../lib/types";
import { longDate } from "../../lib/format";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  cert: {
    display: "grid",
    gridTemplateColumns: "32px 1fr auto",
    gap: "12px",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  name: { fontWeight: tokens.fontWeightSemibold, display: "flex", gap: "8px", alignItems: "center" },
  meta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  import: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
});

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function SmimeSettings() {
  const s = useStyles();
  const [certs, setCerts] = useState<CertInfo[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => api.smimeIdentities().then(setCerts, (e) => (setCerts([]), setError(errorMessage(e))));
  useEffect(() => {
    load();
  }, []);

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const c = await api.smimeImport(base64(await file.arrayBuffer()), password);
      setDone(tl("Zertifikat für {0} importiert.", c.emails.join(", ")));
      setFile(null);
      setPassword("");
      if (input.current) input.current.value = "";
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  return (
    <div className={s.root}>
      <Text>
        {tl("Mit einem S/MIME-Zertifikat signieren Sie Nachrichten digital und können verschlüsselte Nachrichten lesen. Zertifikate anderer Personen lernt Ondura aus deren signierten Nachrichten.")}
      </Text>
      {certs === null ? (
        <Spinner size="small" />
      ) : certs.length === 0 ? (
        <Text className={s.meta}>{tl("Noch kein eigenes Zertifikat importiert.")}</Text>
      ) : (
        <div className={s.list}>
          {certs.map((c) => {
            const expired = new Date(c.notAfter).getTime() < now;
            return (
              <div key={c.fingerprint} className={s.cert}>
                <Certificate24Regular />
                <div>
                  <div className={s.name}>
                    {c.subject}
                    {expired ? (
                      <Badge appearance="tint" color="danger">{tl("Abgelaufen")}</Badge>
                    ) : c.trusted === false ? (
                      <Badge appearance="tint" color="warning">{tl("Aussteller unbekannt")}</Badge>
                    ) : (
                      <Badge appearance="tint" color="success">{tl("Gültig")}</Badge>
                    )}
                  </div>
                  <div className={s.meta}>{c.emails.join(", ")}</div>
                  <div className={s.meta}>
                    {tl("Ausgestellt von")} {c.issuer} {tl("· gültig bis")} {longDate(c.notAfter)}
                  </div>
                </div>
                <Button
                  appearance="subtle"
                  icon={<Delete20Regular />}
                  aria-label={tl("Zertifikat {0} entfernen", c.subject)}
                  onClick={async () => {
                    await api.smimeRemove(c.fingerprint);
                    load();
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className={s.import}>
        <input
          ref={input}
          type="file"
          accept=".p12,.pfx,application/x-pkcs12"
          style={{ display: "none" }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Field label={tl("Zertifikatsdatei (.p12, .pfx)")}>
          <Button icon={<ArrowImport20Regular />} onClick={() => input.current?.click()}>
            {file ? file.name : tl("Datei auswählen …")}
          </Button>
        </Field>
        <Field label={tl("Passwort der Datei")}>
          <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} />
        </Field>
        <Button appearance="primary" disabled={!file || busy} onClick={doImport}>
          {busy ? <Spinner size="tiny" /> : tl("Importieren")}
        </Button>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {done && (
        <MessageBar intent="success">
          <MessageBarBody>{done}</MessageBarBody>
        </MessageBar>
      )}
      <Text className={s.meta}>{tl("Der private Schlüssel wird im Schlüsselbund des Betriebssystems gespeichert und verlässt diesen Computer nicht.")}</Text>
    </div>
  );
}
