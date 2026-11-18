// Date helpers for the calendar. Timed events are shown in local time;
// all-day events carry UTC midnights and are treated as plain dates.

import type { CalEvent } from "../../lib/pim";

export const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `YYYY-MM-DD` of a local date. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local date from `YYYY-MM-DD` (or the date part of an ISO string). */
export function fromYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local start/end of an event (all-day: local midnights of its dates). */
export function localRange(e: CalEvent): { start: Date; end: Date } {
  if (e.allDay) return { start: fromYmd(e.start), end: fromYmd(e.end) };
  return { start: new Date(e.start), end: new Date(e.end) };
}

/** Events that belong in the all-day row (all-day or spanning days). */
export function isAllDayRow(e: CalEvent): boolean {
  if (e.allDay) return true;
  const { start, end } = localRange(e);
  return end.getTime() - start.getTime() >= DAY_MS;
}

export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const longDay = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const month = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

export const fmtTime = (d: Date) => time.format(d);
export const fmtLongDay = (d: Date) => longDay.format(d);
export const fmtShortDay = (d: Date) => shortDay.format(d);
export const fmtMonth = (d: Date) => month.format(d);

/** "Mo, 17.11. 09:00 – 10:00" etc. */
export function fmtEventTime(e: CalEvent): string {
  const { start, end } = localRange(e);
  if (e.allDay) {
    const last = addDays(end, -1);
    return sameDay(start, last) ? `${fmtLongDay(start)} (ganztägig)` : `${fmtShortDay(start)} – ${fmtShortDay(last)} (ganztägig)`;
  }
  if (sameDay(start, end)) return `${fmtLongDay(start)}, ${fmtTime(start)} – ${fmtTime(end)}`;
  return `${fmtShortDay(start)} ${fmtTime(start)} – ${fmtShortDay(end)} ${fmtTime(end)}`;
}

/** Local date + "HH:MM" → ISO UTC. */
export function toIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = fromYmd(date);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** German week number (ISO 8601). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

const RECUR_DAYS: Record<string, string> = { MO: "Mo", TU: "Di", WE: "Mi", TH: "Do", FR: "Fr", SA: "Sa", SU: "So" };

/** Human-readable recurrence ("Jede Woche am Mo, Mi"). */
export function describeRecurrence(e: CalEvent): string | null {
  const r = e.recurrence;
  if (!r) return e.isRecurring ? "Teil einer Serie" : null;
  const every = (n: number, one: string, many: string) => (n > 1 ? `Alle ${n} ${many}` : one);
  let text =
    r.freq === "daily"
      ? every(r.interval, "Täglich", "Tage")
      : r.freq === "weekly"
        ? `${every(r.interval, "Wöchentlich", "Wochen")}${r.byDay.length ? " am " + r.byDay.map((d) => RECUR_DAYS[d] ?? d).join(", ") : ""}`
        : r.freq === "monthly"
          ? every(r.interval, "Monatlich", "Monate")
          : every(r.interval, "Jährlich", "Jahre");
  if (r.count) text += `, ${r.count}-mal`;
  else if (r.until) text += ` bis ${fromYmd(r.until).toLocaleDateString("de-DE")}`;
  return text;
}
