// S/MIME status of a received message: signature (valid, trusted, signer
// matches the sender) and encryption.

import { useState } from "react";
import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Certificate20Regular, LockClosed16Regular } from "@fluentui/react-icons";
import type { MessageDetail } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { longDate } from "../../lib/format";

const useStyles = makeStyles({
  bar: { marginBottom: "12px" },
  details: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: tokens.fontSizeBase200, maxWidth: "420px" },
  label: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, wordBreak: "break-all" },
});

export function SecurityBar({ detail, onNotify }: { detail: MessageDetail; onNotify: (title: string, body?: string, intent?: "success" | "error") => void }) {
  const s = useStyles();
  const [trusted, setTrusted] = useState<string | null>(null);
  const sec = detail.body.security;
  if (!sec) return null;
  const sig = sec.signature;
  const from = detail.summary.from?.email.toLowerCase();
  const matches = !!sig && !!from && sig.signerEmails.some((e) => e.toLowerCase() === from);
  const isTrusted = !!sig && (sig.trusted || trusted === sig.fingerprint);

  if (sec.decryptError) {
    return (
      <MessageBar intent="error" className={s.bar} icon={<LockClosed16Regular />}>
        <MessageBarBody>
          <MessageBarTitle>Verschlüsselte Nachricht</MessageBarTitle>
          {sec.decryptError}
        </MessageBarBody>
      </MessageBar>
    );
  }

  let intent: "success" | "warning" | "error" | "info" = "info";
  let title = "Verschlüsselt";
  let text = "Diese Nachricht wurde mit S/MIME verschlüsselt übertragen.";
  if (sig) {
    if (!sig.valid) {
      intent = "error";
      title = "Ungültige Signatur";
      text = sig.problem ?? "Die digitale Signatur ist ungültig.";
    } else if (!matches) {
      intent = "warning";
      title = "Signatur gehört nicht zum Absender";
      text = `Signiert von ${sig.signerName} (${sig.signerEmails.join(", ")}), nicht von ${from}.`;
    } else if (!isTrusted) {
      intent = "warning";
      title = "Signiert – Aussteller unbekannt";
      text = `Signiert von ${sig.signerName}. Das Zertifikat stammt von „${sig.issuer}“, einer Stelle, die Ondura nicht kennt.`;
    } else {
      intent = "success";
      title = sec.encrypted ? "Signiert und verschlüsselt" : "Digital signiert";
      text = `Signiert von ${sig.signerName} – das Zertifikat ist gültig.`;
    }
  }

  return (
    <MessageBar intent={intent} className={s.bar} icon={sec.encrypted && (!sig || intent === "success") ? <LockClosed16Regular /> : <Certificate20Regular />}>
      <MessageBarBody>
        <MessageBarTitle>{title}</MessageBarTitle>
        {text}
        {sig && sec.encrypted && intent !== "success" && " Die Nachricht ist verschlüsselt."}
      </MessageBarBody>
      {sig && (
        <MessageBarActions>
          <Popover withArrow>
            <PopoverTrigger disableButtonEnhancement>
              <Button size="small">Details</Button>
            </PopoverTrigger>
            <PopoverSurface>
              <div className={s.details}>
                <span className={s.label}>Signiert von</span>
                <span>{sig.signerName || "–"}</span>
                <span className={s.label}>E-Mail</span>
                <span>{sig.signerEmails.join(", ") || "–"}</span>
                <span className={s.label}>Aussteller</span>
                <span>{sig.issuer || "–"}</span>
                {sig.signingTime && (
                  <>
                    <span className={s.label}>Signiert am</span>
                    <span>{longDate(sig.signingTime)}</span>
                  </>
                )}
                {sig.notAfter && (
                  <>
                    <span className={s.label}>Gültig bis</span>
                    <span>{longDate(sig.notAfter)}</span>
                  </>
                )}
                {sig.fingerprint && (
                  <>
                    <span className={s.label}>SHA-256</span>
                    <span className={s.mono}>{sig.fingerprint.match(/.{2}/g)?.join(":")}</span>
                  </>
                )}
              </div>
            </PopoverSurface>
          </Popover>
          {sig.valid && matches && !isTrusted && sig.fingerprint && (
            <Button
              size="small"
              onClick={async () => {
                try {
                  await api.smimeTrust(sig.fingerprint!);
                  setTrusted(sig.fingerprint);
                  onNotify("Zertifikat vertraut", sig.signerName, "success");
                } catch (e) {
                  onNotify("Zertifikat", errorMessage(e), "error");
                }
              }}
            >
              Vertrauen
            </Button>
          )}
        </MessageBarActions>
      )}
    </MessageBar>
  );
}
