// Free times for a meeting: the earliest slots in working hours where nobody
// with known availability is busy.

export interface Busy {
  start: Date;
  end: Date;
}

export interface SuggestOptions {
  /** Meeting length in minutes. */
  duration: number;
  /** Earliest start. */
  from: Date;
  /** Number of days to look at, starting with the day of `from`. */
  days?: number;
  /** Working hours (local time). */
  dayStart?: number;
  dayEnd?: number;
  /** Grid of possible starts in minutes. */
  step?: number;
  count?: number;
  /** Skip Saturdays and Sundays. */
  weekdaysOnly?: boolean;
}

export function suggestSlots(busy: Busy[], o: SuggestOptions): Date[] {
  const { duration, from, days = 5, dayStart = 8, dayEnd = 18, step = 30, count = 4, weekdaysOnly = true } = o;
  const out: Date[] = [];
  const ms = duration * 60_000;
  for (let d = 0; d < days + 7 && out.length < count; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    if (weekdaysOnly && (day.getDay() === 0 || day.getDay() === 6)) continue;
    if (d >= days && out.length) break;
    const close = new Date(day).setHours(dayEnd, 0, 0, 0);
    for (let t = new Date(day).setHours(dayStart, 0, 0, 0); t + ms <= close && out.length < count; t += step * 60_000) {
      if (t < from.getTime()) continue;
      const end = t + ms;
      if (busy.every((b) => b.end.getTime() <= t || b.start.getTime() >= end)) out.push(new Date(t));
    }
  }
  return out;
}

/** First start at or after `d` on the step grid (e.g. the next half hour). */
export function nextSlot(d: Date, step = 30): Date {
  const r = new Date(d);
  r.setSeconds(0, 0);
  const m = r.getMinutes();
  const up = Math.ceil(m / step) * step;
  r.setMinutes(up === m ? m : up);
  return r;
}
