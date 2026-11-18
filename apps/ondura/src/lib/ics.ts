// Minimal iCalendar (RFC 5545) writer for invitations sent by e-mail (iMIP)
// from calendars without server-side scheduling.

import type { Address } from "./types";
import type { EventInput } from "./pim";
import { tl } from "./i18n";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const date = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

/** Fold lines longer than 75 octets (approximated by characters). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function cn(a: Address): string {
  return a.name ? `;CN="${a.name.replace(/"/g, "'")}"` : "";
}

export function invitationIcs(input: EventInput, organizer: Address, uid = `${crypto.randomUUID()}@ondura`): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MirraNET//Ondura//DE",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date().toISOString())}`,
    input.allDay ? `DTSTART;VALUE=DATE:${date(input.start)}` : `DTSTART:${utc(input.start)}`,
    input.allDay ? `DTEND;VALUE=DATE:${date(input.end)}` : `DTEND:${utc(input.end)}`,
    `SUMMARY:${esc(input.title || tl("(Ohne Titel)"))}`,
    input.location ? `LOCATION:${esc(input.location)}` : "",
    input.body ? `DESCRIPTION:${esc(input.body)}` : "",
    `ORGANIZER${cn(organizer)}:mailto:${organizer.email}`,
    ...input.attendees.map((a) => `ATTENDEE${cn(a)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}
