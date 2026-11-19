// Calendar extras: options (holidays, weather, second time zone), sharing,
// other people's calendars, iCalendar export, proposing a new time and
// scheduling polls.

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Delete20Regular,
  WeatherCloudy20Regular,
  WeatherDrizzle20Regular,
  WeatherFog20Regular,
  WeatherPartlyCloudyDay20Regular,
  WeatherRain20Regular,
  WeatherSnow20Regular,
  WeatherSunny20Regular,
  WeatherThunderstorm20Regular,
} from "@fluentui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import { api, errorMessage, isTauri } from "../../lib/api";
import { pim, type CalEvent, type CalendarPermission, type Collection, type Forecast } from "../../lib/pim";
import type { Account, Address } from "../../lib/types";
import { LANG, LOCALE, tl } from "../../lib/i18n";
import { DE_STATES, HOLIDAY_COUNTRIES, holidaysBetween } from "./holidays";
import { RecipientInput } from "../mail/RecipientInput";
import { voteBlock } from "../mail/MailExtras";
import { parseAddresses } from "../../lib/format";

// ----------------------------------------------------------------- options

export interface CalendarOptions {
  /** Country code for holidays, "" = off. */
  holidays: string;
  /** German state for regional holidays. */
  region: string;
  /** Place for the weather forecast, "" = off. */
  weather: string;
  /** Second time zone (IANA), "" = off. */
  secondZone: string;
}

const OPTIONS_KEY = "ondura-calendar.options";

function defaultCountry(): string {
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
  if (HOLIDAY_COUNTRIES.some((c) => c.code === region)) return region;
  return LANG === "fr" ? "FR" : LANG === "en" ? "GB" : "DE";
}

export function loadCalendarOptions(): CalendarOptions {
  const base: CalendarOptions = { holidays: defaultCountry(), region: "", weather: "", secondZone: "" };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") };
  } catch {
    return base;
  }
}

export function saveCalendarOptions(o: CalendarOptions) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/** Collection id of the computed holiday calendar. */
export const HOLIDAYS_ID = "__holidays__";
export const HOLIDAY_COLOR = "#c239b3";

/** Holidays of the range as read-only all-day events. */
export function holidayEvents(o: CalendarOptions, from: Date, to: Date): CalEvent[] {
  if (!o.holidays) return [];
  return holidaysBetween(from, to, o.holidays, o.holidays === "DE" ? o.region : "").map((h) => {
    const next = new Date(`${h.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      id: `holiday-${h.date}-${h.name}`,
      collectionId: HOLIDAYS_ID,
      accountId: "local",
      remoteId: h.date,
      resourceId: h.date,
      seriesId: null,
      title: h.name,
      location: "",
      body: "",
      start: `${h.date}T00:00:00Z`,
      end: next.toISOString().replace(".000Z", "Z"),
      allDay: true,
      isRecurring: false,
      recurrence: null,
      rrule: null,
      reminderMinutes: null,
      showAs: "free",
      organizer: null,
      attendees: [],
      isCancelled: false,
      onlineMeetingUrl: null,
    };
  });
}

export function holidayCollection(o: CalendarOptions): Collection {
  const country = HOLIDAY_COUNTRIES.find((c) => c.code === o.holidays)?.name ?? o.holidays;
  return { id: HOLIDAYS_ID, accountId: "local", remoteId: HOLIDAYS_ID, kind: "calendar", name: tl("Feiertage ({0})", country), color: HOLIDAY_COLOR, readOnly: true, visible: true, isDefault: false };
}

/** Time zones offered for the second clock and the event editor. */
export function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list;
  } catch {
    /* older engines */
  }
  return ["UTC", "Europe/Berlin", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Australia/Sydney"];
}

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Wall time `date` + `time` in `zone` as a UTC ISO string. */
export function zonedToIso(date: string, time: string, zone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Correct by the zone's offset at that moment (twice for DST edges).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    t += guess - shown;
  }
  return new Date(t).toISOString();
}

/** UTC ISO string as wall date and time in `zone`. */
export function isoToZoned(iso: string, zone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}

export function CalendarOptionsDialog({ open, value, onClose }: { open: boolean; value: CalendarOptions; onClose: (o: CalendarOptions | null) => void }) {
  const [o, setO] = useState(value);
  const [check, setCheck] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setO(value);
      setCheck(null);
    }
  }, [open, value]);
  const zones = timeZones();
  const testWeather = async () => {
    setCheck("…");
    try {
      const f = await pim.weather(o.weather, LANG);
      setCheck(f.place);
    } catch (e) {
      setCheck(errorMessage(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose(null)}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Kalenderoptionen")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label={tl("Feiertage anzeigen")}>
              <Dropdown
                value={o.holidays ? HOLIDAY_COUNTRIES.find((c) => c.code === o.holidays)?.name ?? o.holidays : tl("Keine")}
                selectedOptions={[o.holidays]}
                onOptionSelect={(_, d) => setO({ ...o, holidays: d.optionValue ?? "" })}
              >
                <Option value="">{tl("Keine")}</Option>
                {HOLIDAY_COUNTRIES.map((c) => (
                  <Option key={c.code} value={c.code}>{c.name}</Option>
                ))}
              </Dropdown>
            </Field>
            {o.holidays === "DE" && (
              <Field label={tl("Bundesland (für regionale Feiertage)")}>
                <Dropdown
                  value={DE_STATES.find((s) => s.code === o.region)?.name ?? tl("Nur bundesweite Feiertage")}
                  selectedOptions={[o.region]}
                  onOptionSelect={(_, d) => setO({ ...o, region: d.optionValue ?? "" })}
                >
                  <Option value="">{tl("Nur bundesweite Feiertage")}</Option>
                  {DE_STATES.map((s) => (
                    <Option key={s.code} value={s.code}>{s.name}</Option>
                  ))}
                </Dropdown>
              </Field>
            )}
            <Field label={tl("Wetter für diesen Ort anzeigen")} hint={check ?? tl("Leer lassen, um kein Wetter anzuzeigen. Daten: Open-Meteo.")}>
              <div style={{ display: "flex", gap: 8 }}>
                <Input style={{ flex: 1 }} value={o.weather} placeholder={tl("z. B. Saarbrücken")} onChange={(_, d) => setO({ ...o, weather: d.value })} />
                <Button disabled={!o.weather.trim()} onClick={testWeather}>{tl("Prüfen")}</Button>
              </div>
            </Field>
            <Field label={tl("Zweite Zeitzone")}>
              <Dropdown
                value={o.secondZone || tl("Keine")}
                selectedOptions={[o.secondZone]}
                onOptionSelect={(_, d) => setO({ ...o, secondZone: d.optionValue ?? "" })}
                listbox={{ style: { maxHeight: 300 } }}
              >
                <Option value="">{tl("Keine")}</Option>
                {zones.map((z) => (
                  <Option key={z} value={z}>{z}</Option>
                ))}
              </Dropdown>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (saveCalendarOptions(o), onClose(o))}>{tl("Speichern")}</Button>
            <Button onClick={() => onClose(null)}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ----------------------------------------------------------------- weather

const WEATHER_CACHE = "ondura-calendar.weather";

/** Forecast for the place, cached for three hours. */
export function useForecast(place: string): Forecast | null {
  const [f, setF] = useState<Forecast | null>(null);
  useEffect(() => {
    if (!place.trim()) return setF(null);
    try {
      const c = JSON.parse(localStorage.getItem(WEATHER_CACHE) ?? "null");
      if (c && c.place === place && Date.now() - c.at < 3 * 3600_000) return setF(c.forecast);
    } catch {
      /* ignore */
    }
    let off = false;
    pim.weather(place, LANG).then(
      (forecast) => {
        if (off) return;
        setF(forecast);
        try {
          localStorage.setItem(WEATHER_CACHE, JSON.stringify({ place, at: Date.now(), forecast }));
        } catch {
          /* ignore */
        }
      },
      () => !off && setF(null),
    );
    return () => {
      off = true;
    };
  }, [place]);
  return f;
}

function weatherIcon(code: number) {
  if (code === 0) return [WeatherSunny20Regular, tl("Sonnig")] as const;
  if (code <= 2) return [WeatherPartlyCloudyDay20Regular, tl("Teilweise bewölkt")] as const;
  if (code === 3) return [WeatherCloudy20Regular, tl("Bewölkt")] as const;
  if (code <= 48) return [WeatherFog20Regular, tl("Nebel")] as const;
  if (code <= 57) return [WeatherDrizzle20Regular, tl("Nieselregen")] as const;
  if (code <= 67 || (code >= 80 && code <= 82)) return [WeatherRain20Regular, tl("Regen")] as const;
  if (code <= 77 || code === 85 || code === 86) return [WeatherSnow20Regular, tl("Schnee")] as const;
  return [WeatherThunderstorm20Regular, tl("Gewitter")] as const;
}

const useWeatherStyles = makeStyles({
  badge: { display: "inline-flex", alignItems: "center", gap: "2px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, marginLeft: "auto" },
});

export function WeatherBadge({ forecast, day }: { forecast: Forecast | null; day: Date }) {
  const s = useWeatherStyles();
  if (!forecast) return null;
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const w = forecast.days.find((d) => d.date === key);
  if (!w) return null;
  const [Icon, label] = weatherIcon(w.code);
  return (
    <span className={s.badge} title={`${forecast.place}: ${label}, ${Math.round(w.min)}° / ${Math.round(w.max)}°`}>
      <Icon />
      {Math.round(w.max)}°
    </span>
  );
}

// ----------------------------------------------------------------- sharing

const ROLES: [string, string][] = [
  ["freeBusyRead", tl("Kann sehen, wann ich beschäftigt bin")],
  ["limitedRead", tl("Kann Titel und Orte sehen")],
  ["read", tl("Kann alle Details sehen")],
  ["write", tl("Kann bearbeiten")],
  ["delegateWithoutPrivateEventAccess", tl("Stellvertretung")],
];

export function ShareCalendarDialog({ calendar, onClose }: { calendar: Collection | null; onClose: () => void }) {
  const [list, setList] = useState<CalendarPermission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("read");
  const [busy, setBusy] = useState(false);
  const load = () => {
    if (!calendar) return;
    setList(null);
    pim.calendarPermissions(calendar.id).then(setList, (e) => (setList([]), setError(errorMessage(e))));
  };
  useEffect(() => {
    setError(null);
    setEmail("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar?.id]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const roleLabel = (r: string) => ROLES.find(([k]) => k === r)?.[1] ?? r;
  return (
    <Dialog open={!!calendar} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("„{0}“ freigeben", calendar?.name ?? "")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Field label={tl("Person")} style={{ flex: 1 }}>
                <RecipientInput appearance="outline" value={email} onChange={setEmail} />
              </Field>
              <Dropdown value={roleLabel(role)} selectedOptions={[role]} onOptionSelect={(_, d) => d.optionValue && setRole(d.optionValue)} style={{ minWidth: 200 }}>
                {ROLES.map(([k, l]) => (
                  <Option key={k} value={k}>{l}</Option>
                ))}
              </Dropdown>
              <Button
                appearance="primary"
                icon={<Add20Regular />}
                disabled={busy || !parseAddresses(email).length}
                onClick={() => run(async () => (await pim.shareCalendar(calendar!.id, parseAddresses(email)[0].email, role), setEmail("")))}
              >
                {tl("Freigeben")}
              </Button>
            </div>
            {list === null ? (
              <Spinner size="small" />
            ) : list.length === 0 ? (
              <Text>{tl("Dieser Kalender ist noch nicht freigegeben.")}</Text>
            ) : (
              list.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text weight="semibold">{p.name || p.email}</Text>
                    <br />
                    <Text size={200}>{p.email}</Text>
                  </span>
                  <Dropdown value={roleLabel(p.role)} selectedOptions={[p.role]} onOptionSelect={(_, d) => d.optionValue && run(() => pim.shareCalendar(calendar!.id, p.email, d.optionValue!))} style={{ minWidth: 200 }}>
                    {ROLES.map(([k, l]) => (
                      <Option key={k} value={k}>{l}</Option>
                    ))}
                  </Dropdown>
                  <Button appearance="subtle" icon={<Delete20Regular />} aria-label={tl("Freigabe entfernen")} disabled={busy} onClick={() => run(() => pim.unshareCalendar(calendar!.id, p.id))} />
                </div>
              ))
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {tl("Die Person erhält von Microsoft 365 eine Einladung und sieht den Kalender danach in Outlook oder Ondura.")}
            </Text>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function OpenSharedCalendarDialog({ open, accounts, onClose, onOpened }: { open: boolean; accounts: Account[]; onClose: () => void; onOpened: (c: Collection) => void }) {
  const usable = accounts.filter((a) => a.kind.type === "graph" || a.kind.type === "ews");
  const [accountId, setAccountId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setAccountId(usable[0]?.id ?? "");
      setEmail("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const go = async () => {
    const addr = parseAddresses(email)[0];
    if (!addr || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await pim.openSharedCalendar(accountId, addr.email));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Kalender einer anderen Person öffnen")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {usable.length === 0 ? (
              <MessageBar intent="info">
                <MessageBarBody>{tl("Dafür wird ein Microsoft-365- oder Exchange-Konto benötigt.")}</MessageBarBody>
              </MessageBar>
            ) : (
              <>
                {usable.length > 1 && (
                  <Field label={tl("Über Konto")}>
                    <Dropdown value={usable.find((a) => a.id === accountId)?.email ?? ""} selectedOptions={[accountId]} onOptionSelect={(_, d) => setAccountId(d.optionValue ?? "")}>
                      {usable.map((a) => (
                        <Option key={a.id} value={a.id}>{a.email}</Option>
                      ))}
                    </Dropdown>
                  </Field>
                )}
                <Field label={tl("Person")} hint={tl("Die Person muss Ihnen ihren Kalender freigegeben haben.")}>
                  <RecipientInput appearance="outline" value={email} onChange={setEmail} autoFocus />
                </Field>
              </>
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={busy || !usable.length || !parseAddresses(email).length} onClick={go} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {tl("Öffnen")}
            </Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------- iCalendar

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

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

/** A calendar's events as an iCalendar file (one VEVENT per occurrence). */
export function calendarIcs(name: string, events: CalEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MirraNET//Ondura//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEsc(name)}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@ondura`,
      `DTSTAMP:${icsUtc(new Date().toISOString())}`,
      e.allDay ? `DTSTART;VALUE=DATE:${icsDate(e.start)}` : `DTSTART:${icsUtc(e.start)}`,
      e.allDay ? `DTEND;VALUE=DATE:${icsDate(e.end)}` : `DTEND:${icsUtc(e.end)}`,
      `SUMMARY:${icsEsc(e.title)}`,
    );
    if (e.location) lines.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.body && !/<\w+[^>]*>/.test(e.body)) lines.push(`DESCRIPTION:${icsEsc(e.body)}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(icsEsc).join(",")}`);
    lines.push(`TRANSP:${e.showAs === "free" ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Save a calendar (one year back, two ahead) as .ics. Returns the path. */
export async function exportCalendar(c: Collection): Promise<string | null> {
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  const to = new Date();
  to.setFullYear(to.getFullYear() + 2);
  const events = (await pim.events(from, to)).filter((e) => e.collectionId === c.id);
  const ics = calendarIcs(c.name, events);
  if (!isTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `${c.name}.ics`;
    a.click();
    return `${c.name}.ics`;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ title: tl("Kalender exportieren"), defaultPath: `${c.name}.ics`, filters: [{ name: "iCalendar", extensions: ["ics"] }] });
  if (!path) return null;
  const bytes = new TextEncoder().encode(ics);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  await invoke("save_bytes", { path, data: btoa(bin) });
  return path;
}

// ------------------------------------------------------- propose new time

const localInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Mail account to answer from: the event's own account, else the first one. */
async function senderFor(accountId: string): Promise<Account | null> {
  const accounts = await api.listAccounts();
  return accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
}

export function ProposeTimeDialog({ event, onClose, onDone }: { event: CalEvent | null; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!event) return;
    setStart(localInput(event.start));
    setEnd(localInput(event.end));
    setComment("");
    setError(null);
  }, [event]);
  const s0 = new Date(start);
  const e0 = new Date(end);
  const valid = !Number.isNaN(s0.getTime()) && e0 > s0;
  const send = async () => {
    if (!event || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const done = await pim.proposeTime(event.id, s0.toISOString(), e0.toISOString(), comment);
      if (!done) {
        // Server without proposals: iCalendar COUNTER to the organizer by mail.
        const from = await senderFor(event.accountId);
        if (!from || !event.organizer) throw new Error(tl("Kein Konto zum Senden des Vorschlags gefunden."));
        let ics: string = isTauri ? await invoke("pim_invitation_ics", { eventId: event.id }) : "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        ics = ics
          .replace(/^METHOD:.*$/m, "METHOD:COUNTER")
          .replace(/^DTSTART[^:\r\n]*:.*$/m, `DTSTART:${icsUtc(s0.toISOString())}`)
          .replace(/^DTEND[^:\r\n]*:.*$/m, `DTEND:${icsUtc(e0.toISOString())}`)
          .replace(/^DURATION:.*\r?\n/m, "")
          .replace(/^ATTENDEE([^:\r\n]*)PARTSTAT=[A-Z-]+([^:\r\n]*):mailto:(.*)$/gim, (line, a, b, mail) =>
            mail.trim().toLowerCase() === from.email.toLowerCase() ? `ATTENDEE${a}PARTSTAT=TENTATIVE${b}:mailto:${mail}` : line,
          );
        if (comment.trim()) ics = ics.replace(/END:VEVENT/, `COMMENT:${icsEsc(comment.trim())}\r\nEND:VEVENT`);
        const when = `${s0.toLocaleString(LOCALE, { dateStyle: "full", timeStyle: "short" })} – ${e0.toLocaleTimeString(LOCALE, { timeStyle: "short" })}`;
        await api.send(from.id, {
          to: [event.organizer as Address],
          cc: [],
          bcc: [],
          subject: tl("Neuer Zeitvorschlag: {0}", event.title),
          bodyHtml: `<p>${tl("Ich schlage eine neue Zeit vor:")}</p><p><b>${when}</b></p>${comment.trim() ? `<p>${comment.trim().replace(/[<>&]/g, "")}</p>` : ""}`,
          attachments: [{ source: "text", name: "vorschlag.ics", contentType: "text/calendar; method=COUNTER; charset=UTF-8", text: ics }],
        });
      }
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!event} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Neue Zeit vorschlagen")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text>{event?.title}</Text>
            <Field label={tl("Beginn")}>
              <Input type="datetime-local" value={start} onChange={(_, d) => setStart(d.value)} />
            </Field>
            <Field label={tl("Ende")} validationMessage={start && end && !valid ? tl("Das Ende liegt vor dem Beginn") : undefined}>
              <Input type="datetime-local" value={end} onChange={(_, d) => setEnd(d.value)} />
            </Field>
            <Field label={tl("Nachricht an den Organisator")}>
              <Textarea value={comment} onChange={(_, d) => setComment(d.value)} rows={3} />
            </Field>
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={busy || !valid} onClick={send} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {tl("Vorschlag senden")}
            </Button>
            <Button onClick={onClose} disabled={busy}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------------------------------------------------------- scheduling poll

export function PollDialog({
  open,
  title,
  attendees,
  first,
  durationMin,
  onClose,
  onSent,
}: {
  open: boolean;
  title: string;
  attendees: Address[];
  first: Date | null;
  durationMin: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const [slots, setSlots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const base = first ?? new Date();
    // Same time on the next three working days as a start.
    const list: string[] = [];
    const d = new Date(base);
    while (list.length < 3) {
      if (d.getDay() !== 0 && d.getDay() !== 6) list.push(localInput(d.toISOString()));
      d.setDate(d.getDate() + 1);
    }
    setSlots(list);
    setError(null);
  }, [open, first]);
  const label = (v: string) => {
    const s = new Date(v);
    const e = new Date(s.getTime() + durationMin * 60000);
    return `${s.toLocaleString(LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`;
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const accounts = await api.listAccounts();
      const from = accounts[0];
      if (!from) throw new Error(tl("Kein E-Mail-Konto vorhanden."));
      const subject = tl("Terminumfrage: {0}", title || tl("(Ohne Titel)"));
      const options = slots.filter(Boolean).map(label);
      await api.send(from.id, {
        to: attendees,
        cc: [],
        bcc: [],
        subject,
        bodyHtml: `<p>${tl("Welche Zeit passt Ihnen für „{0}“?", title || tl("(Ohne Titel)"))}</p>${voteBlock(options, from.email, subject)}<p>${tl("Die Antworten werden in Ondura Mail bei der gesendeten Nachricht gezählt.")}</p>`,
      });
      onSent();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Terminumfrage")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Text>{tl("Die Teilnehmer erhalten eine E-Mail mit Schaltflächen für jede Zeit.")}</Text>
            {slots.map((v, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <Input type="datetime-local" style={{ flex: 1 }} value={v} onChange={(_, d) => setSlots((l) => l.map((x, j) => (j === i ? d.value : x)))} />
                <Button appearance="subtle" icon={<Delete20Regular />} aria-label={tl("Entfernen")} disabled={slots.length <= 2} onClick={() => setSlots((l) => l.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button appearance="subtle" icon={<Add20Regular />} style={{ alignSelf: "flex-start" }} onClick={() => setSlots((l) => [...l, l[l.length - 1] ?? localInput(new Date().toISOString())])}>
              {tl("Zeit hinzufügen")}
            </Button>
            <Text size={200}>{tl("An: {0}", attendees.map((a) => a.name || a.email).join(", "))}</Text>
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={busy || slots.filter(Boolean).length < 2 || !attendees.length} onClick={send}>
              {tl("Umfrage senden")}
            </Button>
            <Button onClick={onClose} disabled={busy}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
