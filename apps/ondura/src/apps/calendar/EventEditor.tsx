import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogSurface,
  Dropdown,
  Input,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Switch,
  Tab,
  TabList,
  Text,
  Textarea,
  ToggleButton,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Alert20Regular,
  ArrowRepeatAll20Regular,
  Building20Regular,
  CalendarLtr20Regular,
  CheckmarkCircle16Filled,
  Clock20Regular,
  Copy20Regular,
  DismissCircle16Filled,
  Dismiss20Regular,
  Globe20Regular,
  Location20Regular,
  LockClosed20Regular,
  People20Regular,
  Poll20Regular,
  QuestionCircle16Regular,
  Save20Regular,
  Send20Regular,
  Tag20Regular,
  TextDescription20Regular,
  Video20Regular,
} from "@fluentui/react-icons";
import type { Account, Address } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { invitationIcs } from "../../lib/ics";
import { Scheduling } from "./Scheduling";
import { RoomFinder } from "./RoomFinder";
import { pim, type CalEvent, type Collection, type EditScope, type EventInput, type Freq, type Recurrence, type ShowAs } from "../../lib/pim";
import { addDays, fromYmd, hhmm, localRange, toIso, ymd } from "./dates";
import { tl, tlc, LOCALE } from "../../lib/i18n";
import { PollDialog, isoToZoned, localZone, timeZones, zonedToIso } from "./CalendarExtras";
import { RecipientInput } from "../mail/RecipientInput";
import { suggestSlots, type Busy } from "./suggest";
import { writeClipboardText } from "../../shell/contextMenu";

const useStyles = makeStyles({
  surface: { width: "min(980px, 96vw)", maxWidth: "min(980px, 96vw)", padding: 0 },
  body: { display: "flex", flexDirection: "column", gap: 0, maxHeight: "min(860px, 92vh)" },
  top: { display: "flex", flexDirection: "column", padding: "8px 12px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, gap: "2px" },
  toolbar: { flexWrap: "wrap", padding: 0 },
  close: { marginLeft: "auto" },
  scroll: { overflowY: "auto", padding: "12px 20px 16px", minHeight: "min(520px, 60vh)" },
  row: { display: "grid", gridTemplateColumns: "28px 1fr", alignItems: "start", gap: "10px", padding: "6px 0" },
  icon: { color: tokens.colorNeutralForeground3, paddingTop: "6px", display: "flex" },
  cell: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  line: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  title: { fontSize: tokens.fontSizeBase500, width: "100%" },
  people: { display: "grid", gridTemplateColumns: "84px 1fr", alignItems: "center", gap: "6px 8px" },
  peopleLabel: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  date: { width: "150px" },
  time: { width: "150px", minWidth: "150px" },
  arrow: { color: tokens.colorNeutralForeground3 },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  warn: { color: tokens.colorPaletteRedForeground1, fontSize: tokens.fontSizeBase200 },
  chips: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" },
  days: { display: "flex", gap: "4px", flexWrap: "wrap" },
  dot: { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block", marginRight: "8px" },
  teams: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke2}`,
  },
  teamsText: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  link: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  response: { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: tokens.fontSizeBase200, padding: "2px 8px", borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorNeutralBackground3 },
  accepted: { color: tokens.colorPaletteGreenForeground1 },
  declined: { color: tokens.colorPaletteRedForeground1 },
  open: { color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "10px 20px", borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
});

type RepeatKind = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

const REPEAT_LABEL: Record<RepeatKind, string> = {
  none: tl("Nie"),
  daily: tl("Täglich"),
  weekdays: tl("Jeden Werktag (Mo–Fr)"),
  weekly: tl("Wöchentlich"),
  monthly: tl("Monatlich"),
  yearly: tl("Jährlich"),
  custom: tl("Benutzerdefiniert (unverändert)"),
};

const REMINDERS: [string, number | null][] = [
  [tl("Keine"), null],
  [tl("Zum Beginn"), 0],
  [tl("5 Minuten vorher"), 5],
  [tl("15 Minuten vorher"), 15],
  [tl("30 Minuten vorher"), 30],
  [tl("1 Stunde vorher"), 60],
  [tl("2 Stunden vorher"), 120],
  [tl("1 Tag vorher"), 1440],
  [tl("1 Woche vorher"), 10080],
];

const SHOW_AS: Record<ShowAs, string> = { free: tl("Frei"), tentative: tl("Mit Vorbehalt"), busy: tl("Gebucht"), outOfOffice: tl("Abwesend") };
const SHOW_AS_COLOR: Record<ShowAs, string> = { free: "#ffffff", tentative: "#979bf4", busy: "#4f54d4", outOfOffice: "#8764b8" };
const RESPONSE: Record<string, string> = { accepted: tl("Zugesagt"), tentative: tl("Mit Vorbehalt"), declined: tl("Abgesagt"), needsAction: tl("Keine Antwort") };
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const BYDAY_LABEL = [tl("Mo"), tl("Di"), tl("Mi"), tl("Do"), tl("Fr"), tl("Sa"), tl("So")];
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR"];

function repeatOf(r: Recurrence | null, rrule: string | null): RepeatKind {
  if (!r) return rrule ? "custom" : "none";
  if (r.interval !== 1) return "custom";
  if (r.freq === "weekly" && r.byDay.length === 5 && WEEKDAYS.every((d) => r.byDay.includes(d))) return "weekdays";
  return r.freq;
}

/** Times every half hour for the time pickers. */
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** "9", "930", "9:30", "9.30" or "21h" → "HH:MM". */
export function parseTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})(?:\s*[:.h]?\s*(\d{2}))?\s*(?:h|uhr)?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "30 Min.", "1 Std.", "1,5 Std." */
function durationLabel(minutes: number): string {
  if (minutes < 60) return tl("{0} Min.", minutes);
  const h = minutes / 60;
  return tl("{0} Std.", h.toLocaleString(LOCALE, { maximumFractionDigits: 2 }));
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Time field: pick a half hour or type any time; end times show the duration. */
function TimeField({ value, onChange, disabled, from, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; from?: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const label = (t: string) => (from && toMinutes(t) > toMinutes(from) ? `${t} (${durationLabel(toMinutes(t) - toMinutes(from))})` : t);
  const options = from ? TIMES.filter((t) => toMinutes(t) > toMinutes(from)) : TIMES;
  const commit = () => {
    const t = parseTime(text);
    if (t) onChange(t);
    else setText(value);
  };
  return (
    <Combobox
      className={className}
      freeform
      disabled={disabled}
      value={text}
      selectedOptions={[value]}
      aria-label={tl("Uhrzeit")}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      onOptionSelect={(_, d) => d.optionValue && onChange(d.optionValue)}
      listbox={{ style: { maxHeight: 260 } }}
    >
      {options.map((t) => (
        <Option key={t} value={t} text={t}>
          {label(t)}
        </Option>
      ))}
    </Combobox>
  );
}

const parseList = (text: string): Address[] =>
  text
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(.*?)\s*<([^>]+)>$/);
      return m ? { name: m[1].replace(/^"|"$/g, "").trim() || null, email: m[2].trim() } : { name: null, email: p };
    });

const formatList = (list: Address[]) => list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");

/** What the editor opens with. */
export type EditorTarget =
  | {
      mode: "new";
      start: Date;
      end?: Date;
      allDay?: boolean;
      collectionId?: string;
      title?: string;
      body?: string;
      attendees?: string;
      optionalAttendees?: string;
      /** Start as a Teams meeting. */
      teams?: boolean;
    }
  | { mode: "edit"; event: CalEvent; scope: EditScope };

export interface EventEditorProps {
  target: EditorTarget | null;
  calendars: Collection[];
  onClose: () => void;
  onSaved: () => void;
  onNotify?: (title: string, body?: string, intent?: "error" | "info" | "warning" | "success") => void;
  /** Also confirm appointments without attendees (outside the calendar view). */
  announce?: boolean;
}

export function EventEditor({ target, calendars, onClose, onSaved, onNotify, announce }: EventEditorProps) {
  const s = useStyles();
  const editing = target?.mode === "edit" ? target.event : null;
  const scope = target?.mode === "edit" ? target.scope : "series";

  const [tab, setTab] = useState<"event" | "scheduling">("event");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [body, setBody] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("09:30");
  const [repeat, setRepeat] = useState<RepeatKind>("none");
  const [byDay, setByDay] = useState<string[]>([]);
  const [until, setUntil] = useState("");
  const [reminder, setReminder] = useState<number | null>(15);
  const [showAs, setShowAs] = useState<ShowAs>("busy");
  const [attendees, setAttendees] = useState("");
  const [optional, setOptional] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [collectionId, setCollectionId] = useState("");
  const [mailAccounts, setMailAccounts] = useState<Account[]>([]);
  const [sendInvites, setSendInvites] = useState(true);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState("");
  const [teams, setTeams] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [zone, setZone] = useState(localZone());
  const [showZone, setShowZone] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Date[] | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  useEffect(() => {
    if (target) api.listAccounts().then(setMailAccounts, () => setMailAccounts([]));
  }, [target]);

  // (Re)initialise whenever the dialog opens for a new target.
  useEffect(() => {
    if (!target) return;
    setTab("event");
    setSendInvites(true);
    setError(null);
    setBusy(false);
    setZone(localZone());
    setShowZone(false);
    setSuggestions(null);
    setConflicts([]);
    if (target.mode === "new") {
      setCategories("");
      const start = target.start;
      const end = target.end ?? new Date(start.getTime() + 30 * 60_000);
      const day = !!target.allDay;
      setTitle(target.title ?? "");
      setLocation("");
      setBody(target.body ?? "");
      setAllDay(day);
      setStartDate(ymd(start));
      setStartTime(day ? "09:00" : hhmm(start));
      setEndDate(ymd(day ? start : end));
      setEndTime(day ? "09:30" : hhmm(end));
      setRepeat("none");
      setByDay([BYDAY[(start.getDay() + 6) % 7]]);
      setUntil("");
      setReminder(day ? null : 15);
      setShowAs(day ? "free" : "busy");
      setAttendees(target.attendees ?? "");
      setOptional(target.optionalAttendees ?? "");
      setShowOptional(!!target.optionalAttendees);
      setCollectionId(target.collectionId ?? calendars[0]?.id ?? "");
      setTeams(!!target.teams);
      setIsPrivate(false);
    } else {
      const e = target.event;
      const { start, end } = localRange(e);
      setTitle(e.title);
      setLocation(e.location);
      setBody(e.body);
      setAllDay(e.allDay);
      setStartDate(ymd(start));
      setStartTime(hhmm(start));
      // All-day ends are exclusive; the editor shows the last day.
      setEndDate(ymd(e.allDay ? addDays(end, -1) : end));
      setEndTime(hhmm(end));
      const kind = repeatOf(e.recurrence, e.rrule);
      setRepeat(kind);
      setByDay(e.recurrence?.byDay.length ? e.recurrence.byDay : [BYDAY[(start.getDay() + 6) % 7]]);
      setUntil(e.recurrence?.until ?? "");
      setReminder(e.reminderMinutes);
      setShowAs(e.showAs);
      setAttendees(formatList(e.attendees.filter((a) => a.required).map((a) => a.address)));
      const opt = e.attendees.filter((a) => !a.required).map((a) => a.address);
      setOptional(formatList(opt));
      setShowOptional(opt.length > 0);
      setCollectionId(e.collectionId);
      setCategories((e.categories ?? []).join(", "));
      setTeams(false);
      setIsPrivate(!!e.private);
    }
  }, [target, calendars]);

  const showRecurrence = !editing || scope === "series";
  const inviteByMail = !editing && calendars.find((c) => c.id === collectionId)?.accountId === "local" && mailAccounts.length > 0;
  const calendar = calendars.find((c) => c.id === collectionId);
  const required = useMemo(() => parseList(attendees), [attendees]);
  const optionalList = useMemo(() => parseList(optional), [optional]);
  const everyone = useMemo(() => [...required.map((address) => ({ address, required: true })), ...optionalList.map((address) => ({ address, required: false }))], [required, optionalList]);
  const hasAttendees = everyone.length > 0;

  const range = useMemo(() => {
    if (!startDate || !endDate) return null;
    if (allDay) {
      const s0 = `${startDate}T00:00:00Z`;
      const e0 = `${ymd(addDays(fromYmd(endDate), 1))}T00:00:00Z`;
      return { start: s0, end: e0, valid: fromYmd(endDate) >= fromYmd(startDate) };
    }
    const s0 = zone === localZone() ? toIso(startDate, startTime) : zonedToIso(startDate, startTime, zone);
    const e0 = zone === localZone() ? toIso(endDate, endTime) : zonedToIso(endDate, endTime, zone);
    return { start: s0, end: e0, valid: new Date(e0) > new Date(s0) };
  }, [allDay, startDate, startTime, endDate, endTime, zone]);
  const durationMin = range?.valid && !allDay ? Math.round((new Date(range.end).getTime() - new Date(range.start).getTime()) / 60_000) : 30;

  /** Show the same moment in another time zone. */
  const changeZone = (z: string) => {
    if (range?.valid && !allDay) {
      const a = isoToZoned(range.start, z);
      const b = isoToZoned(range.end, z);
      setStartDate(a.date);
      setStartTime(a.time);
      setEndDate(b.date);
      setEndTime(b.time);
    }
    setZone(z);
  };
  const account = mailAccounts.find((a) => a.id === calendar?.accountId);
  const isTeamsAccount = account?.kind.type === "graph";
  const meetingUrl = editing?.onlineMeetingUrl ?? null;

  // Moving the start keeps the duration.
  const changeStart = (date: string, time: string) => {
    if (range?.valid && date && !allDay) {
      const duration = new Date(range.end).getTime() - new Date(range.start).getTime();
      const ns = new Date(zonedToIso(date, time, zone));
      const ne = isoToZoned(new Date(ns.getTime() + duration).toISOString(), zone);
      setEndDate(ne.date);
      setEndTime(ne.time);
    } else if (allDay && date && range?.valid) {
      const days = Math.round((fromYmd(endDate).getTime() - fromYmd(startDate).getTime()) / 86_400_000);
      setEndDate(ymd(addDays(fromYmd(date), days)));
    }
    setStartDate(date);
    setStartTime(time);
  };
  /** Move the meeting to a local start time (suggestions, scheduling assistant). */
  const moveTo = (d: Date) => {
    const z = isoToZoned(d.toISOString(), zone);
    changeStart(z.date, z.time);
  };
  const shiftDay = (delta: number) => {
    if (startDate) changeStart(ymd(addDays(fromYmd(startDate), delta)), startTime);
  };

  // Free times of everyone and own conflicts, as in Outlook's suggestions.
  const emailKey = everyone.map((a) => a.address.email).join(",");
  useEffect(() => {
    if (!target || allDay || !range?.valid) {
      setSuggestions(null);
      setConflicts([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const start = new Date(range.start);
      const end = new Date(range.end);
      const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const now = new Date();
      const from = start > now ? dayStart : now;
      const to = addDays(dayStart, 9);
      const emails = everyone.map((a) => a.address.email);
      const [own, others] = await Promise.all([
        pim.events(from < dayStart ? from : dayStart, to).catch(() => [] as CalEvent[]),
        emails.length ? pim.freeBusy(emails, from < dayStart ? from : dayStart, to).catch(() => []) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const mine = own.filter((e) => !e.allDay && e.showAs !== "free" && e.id !== editing?.id && !e.isCancelled);
      setConflicts(
        mine
          .filter((e) => {
            const r = localRange(e);
            return r.start < end && r.end > start;
          })
          .map((e) => e.title || tl("(Ohne Titel)")),
      );
      if (!emails.length) {
        setSuggestions(null);
        return;
      }
      const blocked: Busy[] = [
        ...mine.map((e) => localRange(e)),
        ...others.flatMap((a) => a.slots.filter((x) => x.status !== "free").map((x) => ({ start: new Date(x.start), end: new Date(x.end) }))),
      ];
      setSuggestions(suggestSlots(blocked, { duration: durationMin, from: start > now ? dayStart : now, count: 4 }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, allDay, range?.start, range?.end, emailKey]);

  const recurrence = (): Recurrence | null => {
    const base = { interval: 1, until: until || null, count: null };
    switch (repeat) {
      case "none":
      case "custom":
        return null;
      case "weekdays":
        return { ...base, freq: "weekly", byDay: WEEKDAYS };
      case "weekly":
        return { ...base, freq: "weekly", byDay: byDay.length ? BYDAY.filter((d) => byDay.includes(d)) : [] };
      default:
        return { ...base, freq: repeat as Freq, byDay: [] };
    }
  };

  const save = async () => {
    if (!range?.valid || busy) return;
    setBusy(true);
    setError(null);
    const input: EventInput = {
      title: title.trim(),
      location: location.trim(),
      // Only send the description when it changed (keeps HTML from Exchange intact).
      body: editing && body === editing.body ? null : body,
      start: range.start,
      end: range.end,
      allDay,
      recurrence: showRecurrence ? recurrence() : null,
      rrule: showRecurrence && repeat === "custom" ? editing?.rrule ?? null : null,
      reminderMinutes: reminder,
      showAs,
      attendees: required,
      optionalAttendees: optionalList,
      categories: categories.split(/[,;]/).map((c) => c.trim()).filter(Boolean),
      onlineMeeting: teams && isTeamsAccount && !meetingUrl,
      private: editing && isPrivate === !!editing.private ? null : isPrivate,
    };
    try {
      if (editing) {
        await pim.updateEvent(editing.id, input, scope);
        if (collectionId && collectionId !== editing.collectionId) await pim.moveEvent(editing.id, collectionId);
      } else {
        await pim.createEvent(collectionId, input);
        // Calendars on this computer cannot invite by themselves: send an
        // iCalendar invitation (iMIP) with Ondura Mail instead.
        if (inviteByMail && sendInvites && hasAttendees) {
          const from = mailAccounts[0];
          const organizer = { name: from.displayName, email: from.email };
          const when = range.start ? new Date(range.start).toLocaleString(LOCALE, { dateStyle: "full", timeStyle: allDay ? undefined : "short" }) : "";
          await api.send(from.id, {
            to: input.attendees,
            cc: optionalList,
            bcc: [],
            subject: tl("Einladung: {0}", input.title || tl("(Ohne Titel)")),
            bodyHtml: `<p>${escapeHtml(tl("{0} lädt Sie ein:", organizer.name || organizer.email))}</p><p><b>${escapeHtml(input.title || tl("(Ohne Titel)"))}</b><br>${escapeHtml(when)}${input.location ? `<br>${escapeHtml(input.location)}` : ""}</p>${input.body ? `<p>${escapeHtml(input.body).replace(/\n/g, "<br>")}</p>` : ""}<p>${escapeHtml(tl("Die Einladung liegt als Kalenderdatei (.ics) bei."))}</p>`,
            attachments: [{ source: "text", name: tl("einladung.ics"), contentType: "text/calendar; method=REQUEST; charset=UTF-8", text: invitationIcs(input, organizer) }],
          });
        }
      }
      if (hasAttendees) onNotify?.(editing ? tl("Aktualisierung gesendet") : tl("Besprechungsanfrage gesendet"), input.title || tl("(Ohne Titel)"), "success");
      else if (announce) onNotify?.(tl("Termin gespeichert"), `${input.title || tl("(Ohne Titel)")} – ${calendar?.name ?? ""}`, "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const heading = !editing ? (hasAttendees ? tl("Neue Besprechung") : tl("Neuer Termin")) : editing.isRecurring ? (scope === "series" ? tl("Serie bearbeiten") : tl("Dieses Ereignis bearbeiten")) : tl("Termin bearbeiten");
  const isHtmlBody = !!editing && /<\w+[^>]*>/.test(editing.body);
  const primaryLabel = hasAttendees ? (editing ? tl("Update senden") : tl("Senden")) : tl("Speichern");
  const responses = editing?.attendees.filter((a) => a.address.email) ?? [];
  const slotLabel = (d: Date) => {
    const sameDay = startDate && ymd(d) === startDate;
    const t = d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
    return sameDay ? t : `${d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "numeric" })} ${t}`;
  };
  const reminderLabel = REMINDERS.find(([, v]) => v === reminder)?.[0] ?? tl("{0} Minuten vorher", reminder);
  const row = (icon: React.JSX.Element, children: React.ReactNode, label?: string) => (
    <div className={s.row}>
      <span className={s.icon} title={label} aria-hidden>
        {icon}
      </span>
      <div className={s.cell}>{children}</div>
    </div>
  );

  return (
    <>
      <Dialog open={!!target} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
        <DialogSurface className={s.surface} aria-label={heading}>
          <DialogBody className={s.body}>
            <div className={s.top}>
              <Toolbar size="small" className={s.toolbar} aria-label={heading}>
                <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : hasAttendees ? <Send20Regular /> : <Save20Regular />} disabled={busy || !range?.valid || !collectionId} onClick={save}>
                  {primaryLabel}
                </Button>
                <ToolbarDivider />
                {isTeamsAccount && !meetingUrl && (
                  <Tooltip content={tl("Fügt beim Senden einen Teams-Teilnahmelink hinzu")} relationship="description">
                    <ToggleButton appearance="subtle" icon={<Video20Regular />} checked={teams} onClick={() => setTeams((v) => !v)}>
                      {tl("Teams-Besprechung")}
                    </ToggleButton>
                  </Tooltip>
                )}
                <Menu checkedValues={{ showAs: [showAs] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && setShowAs(d.checkedItems[0] as ShowAs)}>
                  <MenuTrigger disableButtonEnhancement>
                    <ToolbarButton icon={<span className={s.dot} style={{ background: SHOW_AS_COLOR[showAs], margin: 0 }} />}>{SHOW_AS[showAs]}</ToolbarButton>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      {(Object.keys(SHOW_AS) as ShowAs[]).map((k) => (
                        <MenuItemRadio key={k} name="showAs" value={k}>
                          {SHOW_AS[k]}
                        </MenuItemRadio>
                      ))}
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <Menu checkedValues={{ reminder: [String(reminder)] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && setReminder(d.checkedItems[0] === "null" ? null : Number(d.checkedItems[0]))}>
                  <MenuTrigger disableButtonEnhancement>
                    <ToolbarButton icon={<Alert20Regular />}>{reminderLabel}</ToolbarButton>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      {REMINDERS.map(([label, v]) => (
                        <MenuItemRadio key={label} name="reminder" value={String(v)}>
                          {label}
                        </MenuItemRadio>
                      ))}
                    </MenuList>
                  </MenuPopover>
                </Menu>
                {showRecurrence && (
                  <Menu checkedValues={{ repeat: [repeat] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && setRepeat(d.checkedItems[0] as RepeatKind)}>
                    <MenuTrigger disableButtonEnhancement>
                      <ToolbarButton icon={<ArrowRepeatAll20Regular />}>{repeat === "none" ? tl("Wiederholen") : REPEAT_LABEL[repeat]}</ToolbarButton>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        {(Object.keys(REPEAT_LABEL) as RepeatKind[])
                          .filter((k) => k !== "custom" || repeat === "custom")
                          .map((k) => (
                            <MenuItemRadio key={k} name="repeat" value={k}>
                              {REPEAT_LABEL[k]}
                            </MenuItemRadio>
                          ))}
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                )}
                <ToggleButton appearance="subtle" icon={<LockClosed20Regular />} checked={isPrivate} onClick={() => setIsPrivate((v) => !v)}>
                  {tlc("Termin", "Privat")}
                </ToggleButton>
                <ToggleButton appearance="subtle" icon={<Globe20Regular />} checked={showZone} disabled={allDay} onClick={() => setShowZone((v) => !v)}>
                  {tl("Zeitzonen")}
                </ToggleButton>
                {!editing && hasAttendees && (
                  <ToolbarButton icon={<Poll20Regular />} disabled={busy} onClick={() => setPollOpen(true)}>
                    {tl("Terminumfrage…")}
                  </ToolbarButton>
                )}
                <Button className={s.close} appearance="subtle" icon={<Dismiss20Regular />} aria-label={tl("Schließen")} disabled={busy} onClick={onClose} />
              </Toolbar>
              <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "event" | "scheduling")}>
                <Tab value="event">{hasAttendees ? tl("Besprechung") : tl("Termin")}</Tab>
                <Tab value="scheduling">{tl("Terminplanungs-Assistent")}</Tab>
              </TabList>
            </div>

            <div className={s.scroll}>
              {tab === "event" ? (
                <>
                  {row(
                    <TextDescription20Regular />,
                    <Input
                      autoFocus
                      appearance="underline"
                      className={s.title}
                      value={title}
                      onChange={(_, d) => setTitle(d.value)}
                      placeholder={tl("Titel hinzufügen")}
                      aria-label={tl("Titel")}
                      onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && save()}
                    />,
                  )}
                  {row(
                    <People20Regular />,
                    <>
                      <div className={s.people}>
                        <span className={s.peopleLabel}>{tl("Erforderlich")}</span>
                        <RecipientInput appearance="outline" value={attendees} onChange={setAttendees} placeholder={tl("Teilnehmer einladen")} />
                        {showOptional && (
                          <>
                            <span className={s.peopleLabel}>{tl("Optional")}</span>
                            <RecipientInput appearance="outline" value={optional} onChange={setOptional} placeholder={tl("Optionale Teilnehmer")} />
                          </>
                        )}
                      </div>
                      {!showOptional && (
                        <Button size="small" appearance="transparent" style={{ alignSelf: "flex-start", padding: 0, minWidth: 0 }} onClick={() => setShowOptional(true)}>
                          {tl("+ Optionale Teilnehmer")}
                        </Button>
                      )}
                      {responses.length > 0 && (
                        <div className={s.chips} aria-label={tl("Antworten")}>
                          {responses.map((a) => (
                            <span key={a.address.email} className={s.response} title={a.address.email}>
                              {a.response === "accepted" ? (
                                <CheckmarkCircle16Filled className={s.accepted} />
                              ) : a.response === "declined" ? (
                                <DismissCircle16Filled className={s.declined} />
                              ) : (
                                <QuestionCircle16Regular className={s.open} />
                              )}
                              {a.address.name || a.address.email}
                              <span className={s.open}>· {RESPONSE[a.response] ?? RESPONSE.needsAction}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {inviteByMail && hasAttendees && (
                        <Switch checked={sendInvites} onChange={(_, d) => setSendInvites(d.checked)} label={tl("Einladungen per E-Mail senden (über {0})", mailAccounts[0]?.email)} />
                      )}
                    </>,
                    tl("Teilnehmer"),
                  )}
                  {row(
                    <Clock20Regular />,
                    <>
                      <div className={s.line}>
                        <Input className={s.date} type="date" value={startDate} aria-label={tl("Beginn")} onChange={(_, d) => changeStart(d.value, startTime)} />
                        {!allDay && <TimeField className={s.time} value={startTime} onChange={(t) => changeStart(startDate, t)} />}
                        <span className={s.arrow}>→</span>
                        <Input className={s.date} type="date" value={endDate} aria-label={tl("Ende")} onChange={(_, d) => setEndDate(d.value)} />
                        {!allDay && <TimeField className={s.time} value={endTime} from={endDate === startDate ? startTime : undefined} onChange={setEndTime} />}
                        <Switch checked={allDay} onChange={(_, d) => setAllDay(d.checked)} label={tl("Ganztägig")} />
                      </div>
                      {range && !range.valid && <span className={s.warn}>{tl("Das Ende liegt vor dem Beginn")}</span>}
                      {showZone && !allDay && (
                        <div className={s.line}>
                          <span className={s.hint}>{tl("Zeitzone")}</span>
                          <Dropdown value={zone} selectedOptions={[zone]} onOptionSelect={(_, d) => d.optionValue && changeZone(d.optionValue)} listbox={{ style: { maxHeight: 300 } }}>
                            {timeZones().map((z) => (
                              <Option key={z} value={z}>
                                {z}
                              </Option>
                            ))}
                          </Dropdown>
                        </div>
                      )}
                      {conflicts.length > 0 && <span className={s.warn}>{tl("Überschneidet sich mit: {0}", conflicts.slice(0, 3).join(", "))}</span>}
                      {suggestions && suggestions.length > 0 && (
                        <div className={s.chips}>
                          <span className={s.hint}>{tl("Alle verfügbar:")}</span>
                          {suggestions.map((d) => (
                            <Button key={d.toISOString()} size="small" shape="circular" onClick={() => moveTo(d)}>
                              {slotLabel(d)}
                            </Button>
                          ))}
                          <Button size="small" appearance="transparent" onClick={() => setTab("scheduling")}>
                            {tl("Terminplanungs-Assistent")}
                          </Button>
                        </div>
                      )}
                    </>,
                    tl("Zeit"),
                  )}
                  {showRecurrence && repeat !== "none" &&
                    row(
                      <ArrowRepeatAll20Regular />,
                      <>
                        <div className={s.line}>
                          <Dropdown value={REPEAT_LABEL[repeat]} selectedOptions={[repeat]} onOptionSelect={(_, d) => setRepeat(d.optionValue as RepeatKind)} aria-label={tl("Wiederholen")}>
                            {(Object.keys(REPEAT_LABEL) as RepeatKind[])
                              .filter((k) => k !== "custom" || repeat === "custom")
                              .map((k) => (
                                <Option key={k} value={k}>
                                  {REPEAT_LABEL[k]}
                                </Option>
                              ))}
                          </Dropdown>
                          <span className={s.hint}>{tl("Endet am")}</span>
                          <Input type="date" value={until} disabled={repeat === "custom"} onChange={(_, d) => setUntil(d.value)} aria-label={tl("Endet am")} />
                          {!until && <span className={s.hint}>{tl("Leer = ohne Ende")}</span>}
                        </div>
                        {repeat === "weekly" && (
                          <div className={s.days}>
                            {BYDAY.map((d, i) => (
                              <ToggleButton
                                key={d}
                                size="small"
                                shape="circular"
                                checked={byDay.includes(d)}
                                onClick={() => setByDay((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                              >
                                {BYDAY_LABEL[i]}
                              </ToggleButton>
                            ))}
                          </div>
                        )}
                      </>,
                      tl("Wiederholen"),
                    )}
                  {row(
                    <Location20Regular />,
                    <>
                      <Input
                        value={location}
                        onChange={(_, d) => setLocation(d.value)}
                        placeholder={tl("Ort oder Besprechungsraum hinzufügen")}
                        aria-label={tl("Ort")}
                        contentAfter={<Button size="small" appearance="transparent" icon={<Building20Regular />} title={tl("Raum suchen")} aria-label={tl("Raum suchen")} onClick={() => setRoomsOpen(true)} />}
                      />
                      {(meetingUrl || (teams && isTeamsAccount)) && (
                        <div className={s.teams}>
                          <Video20Regular />
                          <div className={s.teamsText}>
                            <Text weight="semibold">{tl("Teams-Besprechung")}</Text>
                            {meetingUrl ? <span className={s.link}>{meetingUrl}</span> : <span className={s.hint}>{tl("Der Teilnahmelink wird beim Senden hinzugefügt.")}</span>}
                          </div>
                          {meetingUrl ? (
                            <>
                              <Button size="small" icon={<Copy20Regular />} onClick={() => void writeClipboardText(meetingUrl).then(() => onNotify?.(tl("Link kopiert"), undefined, "success"), (e) => onNotify?.(tl("Link konnte nicht kopiert werden"), errorMessage(e), "error"))}>
                                {tl("Link kopieren")}
                              </Button>
                              <Button size="small" appearance="primary" onClick={() => void api.openExternal(meetingUrl)}>
                                {tl("Teilnehmen")}
                              </Button>
                            </>
                          ) : (
                            <Button size="small" appearance="subtle" icon={<Dismiss20Regular />} aria-label={tl("Teams-Besprechung entfernen")} onClick={() => setTeams(false)} />
                          )}
                        </div>
                      )}
                    </>,
                    tl("Ort"),
                  )}
                  {row(
                    <CalendarLtr20Regular />,
                    <Dropdown
                      value={calendar?.name ?? ""}
                      selectedOptions={[collectionId]}
                      disabled={!!editing && scope === "occurrence"}
                      onOptionSelect={(_, d) => setCollectionId(d.optionValue ?? "")}
                      aria-label={tl("Kalender")}
                      button={
                        <span>
                          <span className={s.dot} style={{ background: calendar?.color ?? tokens.colorBrandBackground }} />
                          {calendar?.name ?? tl("Kalender wählen")}
                        </span>
                      }
                    >
                      {calendars.map((c) => (
                        <Option key={c.id} value={c.id} text={c.name}>
                          <span className={s.dot} style={{ background: c.color ?? tokens.colorBrandBackground }} />
                          {c.name}
                        </Option>
                      ))}
                    </Dropdown>,
                    tl("Kalender"),
                  )}
                  {row(<Tag20Regular />, <Input value={categories} onChange={(_, d) => setCategories(d.value)} placeholder={tl("Kategorien, durch Komma getrennt")} aria-label={tl("Kategorien")} />, tl("Kategorien"))}
                  {row(
                    <TextDescription20Regular />,
                    <>
                      <Textarea
                        value={isHtmlBody && body === editing?.body ? htmlToText(body) : body}
                        onChange={(_, d) => setBody(d.value)}
                        resize="vertical"
                        rows={7}
                        placeholder={tl("Agenda, Notizen oder Nachricht an die Teilnehmer")}
                        aria-label={tl("Beschreibung")}
                      />
                      {isHtmlBody && body === editing?.body && <span className={s.hint}>{tl("Formatierte Beschreibung – wird nur bei Änderung als Text gespeichert")}</span>}
                    </>,
                    tl("Beschreibung"),
                  )}
                </>
              ) : (
                <>
                  <div className={s.line}>
                    <span className={s.hint}>{tl("Beginn")}</span>
                    <Input className={s.date} type="date" value={startDate} onChange={(_, d) => changeStart(d.value, startTime)} aria-label={tl("Beginn")} />
                    {!allDay && <TimeField className={s.time} value={startTime} onChange={(t) => changeStart(startDate, t)} />}
                    <span className={s.arrow}>→</span>
                    {!allDay && <TimeField className={s.time} value={endTime} from={endDate === startDate ? startTime : undefined} onChange={setEndTime} />}
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <RecipientInput appearance="outline" value={attendees} onChange={setAttendees} placeholder={tl("Teilnehmer hinzufügen")} />
                    </div>
                  </div>
                  <Scheduling
                    date={startDate}
                    start={range?.valid && !allDay ? new Date(range.start) : null}
                    end={range?.valid && !allDay ? new Date(range.end) : null}
                    attendees={everyone}
                    onPick={allDay ? undefined : moveTo}
                    onDay={shiftDay}
                  />
                  {suggestions && suggestions.length > 0 && (
                    <div className={mergeClasses(s.chips)}>
                      <span className={s.hint}>{tl("Vorschläge:")}</span>
                      {suggestions.map((d) => (
                        <Button key={d.toISOString()} size="small" shape="circular" onClick={() => moveTo(d)}>
                          {slotLabel(d)}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {error && (
                <MessageBar intent="error" style={{ marginTop: 12 }}>
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <PollDialog
        open={pollOpen}
        title={title}
        attendees={[...required, ...optionalList]}
        first={range?.valid && !allDay ? new Date(range.start) : null}
        durationMin={durationMin}
        onClose={() => setPollOpen(false)}
        onSent={() => (onNotify?.(tl("Terminumfrage gesendet"), title, "success"), onClose())}
      />
      <RoomFinder
        open={roomsOpen}
        start={range?.valid && !allDay ? new Date(range.start) : null}
        end={range?.valid && !allDay ? new Date(range.end) : null}
        onClose={() => setRoomsOpen(false)}
        onPick={(room) => {
          setRoomsOpen(false);
          setLocation((l) => (l.trim() && !l.includes(room.name) ? `${l.trim()}; ${room.name}` : room.name));
          setAttendees((a) => (a.toLowerCase().includes(room.email.toLowerCase()) ? a : [a.trim(), `${room.name} <${room.email}>`].filter(Boolean).join(", ")));
        }}
      />
    </>
  );
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
