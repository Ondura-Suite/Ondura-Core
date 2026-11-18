import type { AccountKind, Security } from "./types";

export type ProbeMode = "direct" | "imapStartTls" | "smtpStartTls";

export interface CertTarget {
  label: string;
  host: string;
  port: number;
  mode: ProbeMode;
}

export interface CertificateInfo {
  host: string;
  port: number;
  fingerprint: string;
  /** `null` if the certificate is publicly valid. */
  problem: string | null;
  trusted: boolean;
}

function urlTarget(label: string, url: string): CertTarget | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return { label, host: u.hostname, port: Number(u.port || 443), mode: "direct" };
  } catch {
    return null;
  }
}

export function imapTargets(c: { imapHost: string; imapPort: number; imapSecurity: Security; smtpHost: string; smtpPort: number; smtpSecurity: Security }): CertTarget[] {
  const t: CertTarget[] = [];
  if (c.imapHost) t.push({ label: "IMAP", host: c.imapHost, port: c.imapPort, mode: c.imapSecurity === "tls" ? "direct" : "imapStartTls" });
  if (c.smtpHost) t.push({ label: "SMTP", host: c.smtpHost, port: c.smtpPort, mode: c.smtpSecurity === "tls" ? "direct" : "smtpStartTls" });
  return t;
}

/** Servers whose certificates an account depends on. */
export function certTargets(kind: AccountKind, dav?: { url: string } | null): CertTarget[] {
  const t: CertTarget[] = [];
  if (kind.type === "imap") t.push(...imapTargets(kind));
  if (kind.type === "ews") {
    const x = urlTarget("Exchange", kind.url);
    if (x) t.push(x);
  }
  if (kind.type === "dav") {
    const x = urlTarget("CalDAV/CardDAV", kind.url);
    if (x) t.push(x);
  }
  if (dav) {
    const x = urlTarget("CalDAV/CardDAV", dav.url);
    if (x) t.push(x);
  }
  return t;
}

export function isCertificateError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("certificate") || m.includes("unknownissuer") || m.includes("zertifikat");
}
