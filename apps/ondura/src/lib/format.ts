import type { Address, MessageSummary } from "./types";

const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const longFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Outlook-style short date for the message list. */
export function listDate(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) return timeFmt.format(d);
  if (today - day < 7 * 86400_000) return weekdayFmt.format(d);
  return dateFmt.format(d);
}

export function longDate(iso: string): string {
  return longFmt.format(new Date(iso));
}

/** Group header like Outlook ("Heute", "Gestern", ...). */
export function groupLabel(iso: string): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(iso));
  const diff = Math.round((today - day) / 86400_000);
  if (diff <= 0) return "Heute";
  if (diff === 1) return "Gestern";
  const weekday = (new Date().getDay() + 6) % 7; // Monday = 0
  if (diff <= weekday) return "Diese Woche";
  if (diff <= weekday + 7) return "Letzte Woche";
  if (diff < 31) return "Diesen Monat";
  return "Älter";
}

export function groupMessages(messages: MessageSummary[]): { label: string; items: MessageSummary[] }[] {
  const groups: { label: string; items: MessageSummary[] }[] = [];
  for (const m of messages) {
    const label = groupLabel(m.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
}

export function displayName(a: Address | null | undefined): string {
  if (!a) return "(Unbekannt)";
  return a.name && a.name.trim() ? a.name : a.email;
}

export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** Parses "Name <mail@x.de>; other@y.de" into addresses. */
export function parseAddresses(input: string): Address[] {
  return input
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*)<([^>]+)>$/);
      if (m) return { name: m[1].trim().replace(/^"|"$/g, "") || null, email: m[2].trim() };
      return { name: null, email: s };
    });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Same normalisation as `thread_key` in mail-core (for the demo backend). */
export function threadKeyOf(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const m = s.match(/^(re|aw|wg|fw|fwd|antw|sv|vs|tr|rif):\s*/i);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s.toLowerCase();
}

