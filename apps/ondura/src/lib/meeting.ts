// Turning a mail into a meeting: subject, text and the people involved.

import { api } from "./api";
import { formatAddress } from "./format";
import type { Address, MessageDetail } from "./types";

/** Plain text of a message for notes and descriptions. */
export function messageText(d: MessageDetail): string {
  if (d.body.text?.trim()) return d.body.text.trim();
  if (d.body.html) {
    // Line breaks for <br> and block ends, which textContent drops.
    const html = d.body.html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "$&\n");
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }
  return d.summary.preview;
}

/** Sender and recipients without the user's own addresses, each once. */
export function meetingPeople(d: MessageDetail, own: Iterable<string>): Address[] {
  const mine = new Set([...own].map((e) => e.toLowerCase()));
  const people = [d.summary.from, ...d.summary.to, ...(d.summary.cc ?? [])].filter((a): a is Address => !!a?.email);
  return [...new Map(people.filter((a) => !mine.has(a.email.toLowerCase())).map((a) => [a.email.toLowerCase(), a])).values()];
}

/** Details for "Antworten mit Besprechung". */
export async function meetingFromMessage(d: MessageDetail): Promise<{ title: string; body: string; attendees: string[] }> {
  const own = (await api.listAccounts().catch(() => [])).map((a) => a.email);
  return { title: d.summary.subject, body: messageText(d), attendees: meetingPeople(d, own).map(formatAddress) };
}
