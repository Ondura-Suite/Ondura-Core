// mailto: links (RFC 6068), e.g. from a website when Ondura Mail is the
// default email app: `mailto:a@x.de,b@y.de?cc=c@z.de&subject=Hallo&body=…`.

import type { Address, OutgoingMessage } from "./types";
import { escapeHtml } from "./format";

function addresses(value: string): Address[] {
  return value
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((email) => ({ name: null, email }));
}

// "+" stays a plus (RFC 6068), unlike in HTML forms.
const decode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** A new message from a mailto: link, or null if it is none. */
export function parseMailto(link: string): OutgoingMessage | null {
  const m = /^mailto:([^?#]*)(?:\?([^#]*))?/i.exec(link.trim());
  if (!m) return null;
  const msg: OutgoingMessage = { to: addresses(decode(m[1])), cc: [], bcc: [], subject: "", bodyHtml: "" };
  for (const part of (m[2] ?? "").split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).toLowerCase();
    const value = decode(part.slice(eq + 1));
    if (key === "to") msg.to.push(...addresses(value));
    else if (key === "cc") msg.cc.push(...addresses(value));
    else if (key === "bcc") msg.bcc.push(...addresses(value));
    else if (key === "subject") msg.subject = value;
    else if (key === "body")
      msg.bodyHtml = value
        .split(/\r?\n/)
        .map((l) => `<p>${l ? escapeHtml(l) : "<br>"}</p>`)
        .join("");
  }
  return msg;
}
