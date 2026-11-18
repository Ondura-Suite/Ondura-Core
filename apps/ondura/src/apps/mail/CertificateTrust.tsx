import { useEffect, useState } from "react";
import { Button, Checkbox, MessageBar, MessageBarBody, MessageBarTitle, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ShieldErrorRegular, ShieldCheckmarkRegular } from "@fluentui/react-icons";
import { api, errorMessage } from "../../lib/api";
import type { CertTarget, CertificateInfo } from "../../lib/certs";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "10px" },
  item: {
    display: "grid",
    gridTemplateColumns: "20px 1fr",
    gap: "4px 10px",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  fp: { fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: tokens.fontSizeBase100, wordBreak: "break-all", color: tokens.colorNeutralForeground2 },
  bad: { color: tokens.colorPaletteRedForeground1 },
  good: { color: tokens.colorPaletteGreenForeground1 },
});

interface Probed {
  target: CertTarget;
  info?: CertificateInfo;
  error?: string;
}

/**
 * Shows the certificates of an account's servers and lets the user trust
 * certificates that are self-signed or issued by a private CA.
 * `onTrusted` fires after at least one certificate was newly trusted.
 */
export function CertificateTrust({ targets, compact, onTrusted }: { targets: CertTarget[]; compact?: boolean; onTrusted?: () => void }) {
  const s = useStyles();
  const [probed, setProbed] = useState<Probed[] | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = targets.map((t) => `${t.mode}:${t.host}:${t.port}`).join("|");

  const load = () => {
    setProbed(null);
    Promise.all(
      targets.map((target) =>
        api.probeCertificate(target.host, target.port, target.mode).then(
          (info) => ({ target, info }),
          (e) => ({ target, error: errorMessage(e) }),
        ),
      ),
    ).then(setProbed);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [key]);

  if (!probed) return <Spinner size="tiny" label="Zertifikate werden geprüft…" labelPosition="after" />;

  const untrusted = probed.filter((p) => p.info?.problem && !p.info.trusted);
  const visible = compact ? probed.filter((p) => p.info?.problem || p.error) : probed;

  const trust = async () => {
    setBusy(true);
    try {
      for (const p of untrusted) await api.setCertificateTrust(p.info!.fingerprint, true);
      setAccept(false);
      load();
      onTrusted?.();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (fp: string) => {
    await api.setCertificateTrust(fp, false);
    load();
  };

  return (
    <div className={s.list}>
      {visible.map((p) => (
        <div key={`${p.target.label}${p.target.host}${p.target.port}`} className={s.item}>
          {p.info && !p.info.problem ? <ShieldCheckmarkRegular className={s.good} /> : <ShieldErrorRegular className={p.info?.trusted ? s.good : s.bad} />}
          <Text weight="semibold">
            {p.target.label} · {p.target.host}:{p.target.port}
          </Text>
          <span />
          <div>
            {p.error ? (
              <Text size={200}>{p.error}</Text>
            ) : p.info!.problem ? (
              <Text size={200}>
                {p.info!.trusted ? "Von dir als vertrauenswürdig markiert. " : "Nicht vertrauenswürdig: "}
                {!p.info!.trusted && describe(p.info!.problem)}
                {p.info!.trusted && (
                  <Button appearance="transparent" size="small" style={{ padding: 0, minWidth: 0 }} onClick={() => revoke(p.info!.fingerprint)}>
                    Vertrauen entziehen
                  </Button>
                )}
              </Text>
            ) : (
              <Text size={200}>Gültiges, öffentlich vertrauenswürdiges Zertifikat.</Text>
            )}
            {p.info && <div className={s.fp}>SHA-256 {p.info.fingerprint}</div>}
          </div>
        </div>
      ))}
      {untrusted.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Zertifikat manuell vertrauen?</MessageBarTitle>
            Vergleiche den Fingerabdruck mit dem auf deinem Server (z. B. <code>openssl x509 -noout -fingerprint -sha256</code>). Vertraue nur, wenn er übereinstimmt.
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <Checkbox checked={accept} onChange={(_, d) => setAccept(!!d.checked)} label="Fingerabdruck geprüft" />
              <Button size="small" appearance="primary" disabled={!accept || busy} onClick={trust}>
                Vertrauen{onTrusted ? " und erneut verbinden" : ""}
              </Button>
            </div>
          </MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}

function describe(problem: string): string {
  const p = problem.toLowerCase();
  if (p.includes("unknownissuer")) return "selbstsigniert oder von einer unbekannten Zertifizierungsstelle ausgestellt.";
  if (p.includes("expired")) return "abgelaufen.";
  if (p.includes("notvalidforname") || p.includes("name")) return "gilt nicht für diesen Servernamen.";
  return problem;
}
