import { useEffect, useMemo, useState } from "react";
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
  Switch,
  Textarea,
  ToggleButton,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Account, Address } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { invitationIcs } from "../../lib/ics";
import { Scheduling } from "./Scheduling";
import { RoomFinder } from "./RoomFinder";
import { Building20Regular } from "@fluentui/react-icons";
import { pim, type CalEvent, type Collection, type EditScope, type EventInput, type Freq, type Recurrence, type ShowAs } from "../../lib/pim";
import { addDays, fromYmd, hhmm, localRange, toIso, ymd } from "./dates";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", marginTop: "4px" },
  full: { gridColumn: "1 / -1" },
  when: { display: "grid", gridTemplateColumns: "1fr 110px 1fr 110px", gap: "8px", alignItems: "end", gridColumn: "1 / -1" },
  days: { display: "flex", gap: "4px", flexWrap: "wrap" },
  dot: { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block", marginRight: "8px" },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, gridColumn: "1 / -1" },
});

type RepeatKind = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

const REPEAT_LABEL: Record<RepeatKind, string> = {
  none: "Nie",
  daily: "Täglich",
  weekdays: "Jeden Werktag (Mo–Fr)",
  weekly: "Wöchentlich",
  monthly: "Monatlich",
  yearly: "Jährlich",
  custom: "Benutzerdefiniert (unverändert)",
};

const REMINDERS: [string, number | null][] = [
  ["Keine", null],
  ["Zum Beginn", 0],
  ["5 Minuten vorher", 5],
  ["15 Minuten vorher", 15],
  ["30 Minuten vorher", 30],
  ["1 Stunde vorher", 60],
  ["2 Stunden vorher", 120],
  ["1 Tag vorher", 1440],
  ["1 Woche vorher", 10080],
];

const SHOW_AS: Record<ShowAs, string> = { free: "Frei", tentative: "Mit Vorbehalt", busy: "Gebucht", outOfOffice: "Abwesend" };
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const BYDAY_LABEL = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR"];

function repeatOf(r: Recurrence | null, rrule: string | null): RepeatKind {
  if (!r) return rrule ? "custom" : "none";
  if (r.interval !== 1) return "custom";
  if (r.freq === "weekly" && r.byDay.length === 5 && WEEKDAYS.every((d) => r.byDay.includes(d))) return "weekdays";
  return r.freq;
}

/** What the editor opens with. */
export type EditorTarget =
  | { mode: "new"; start: Date; end?: Date; allDay?: boolean; collectionId?: string }
  | { mode: "edit"; event: CalEvent; scope: EditScope };

export interface EventEditorProps {
  target: EditorTarget | null;
  calendars: Collection[];
  onClose: () => void;
  onSaved: () => void;
}

export function EventEditor({ target, calendars, onClose, onSaved }: EventEditorProps) {
  const s = useStyles();
  const editing = target?.mode === "edit" ? target.event : null;
  const scope = target?.mode === "edit" ? target.scope : "series";

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
  const [collectionId, setCollectionId] = useState("");
  const [mailAccounts, setMailAccounts] = useState<Account[]>([]);
  const [sendInvites, setSendInvites] = useState(true);
  const [showScheduling, setShowScheduling] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) api.listAccounts().then(setMailAccounts, () => setMailAccounts([]));
  }, [target]);

  // (Re)initialise whenever the dialog opens for a new target.
  useEffect(() => {
    if (!target) return;
    setShowScheduling(false);
    setSendInvites(true);
    setError(null);
    setBusy(false);
    if (target.mode === "new") {
      const start = target.start;
      const end = target.end ?? new Date(start.getTime() + 30 * 60_000);
      const day = !!target.allDay;
      setTitle("");
      setLocation("");
      setBody("");
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
      setAttendees("");
      setCollectionId(target.collectionId ?? calendars[0]?.id ?? "");
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
      setAttendees(e.attendees.map((a) => (a.address.name ? `${a.address.name} <${a.address.email}>` : a.address.email)).join(", "));
      setCollectionId(e.collectionId);
    }
  }, [target, calendars]);

  const showRecurrence = !editing || scope === "series";
  const inviteByMail = !editing && calendars.find((c) => c.id === collectionId)?.accountId === "local" && mailAccounts.length > 0;
  const calendar = calendars.find((c) => c.id === collectionId);

  const range = useMemo(() => {
    if (!startDate || !endDate) return null;
    if (allDay) {
      const s0 = `${startDate}T00:00:00Z`;
      const e0 = `${ymd(addDays(fromYmd(endDate), 1))}T00:00:00Z`;
      return { start: s0, end: e0, valid: fromYmd(endDate) >= fromYmd(startDate) };
    }
    const s0 = toIso(startDate, startTime);
    const e0 = toIso(endDate, endTime);
    return { start: s0, end: e0, valid: new Date(e0) > new Date(s0) };
  }, [allDay, startDate, startTime, endDate, endTime]);

  // Moving the start keeps the duration, like Outlook.
  const changeStart = (date: string, time: string) => {
    if (range?.valid && date && !allDay) {
      const duration = new Date(range.end).getTime() - new Date(range.start).getTime();
      const ns = new Date(toIso(date, time));
      const ne = new Date(ns.getTime() + duration);
      setEndDate(ymd(ne));
      setEndTime(hhmm(ne));
    } else if (allDay && date && range?.valid) {
      const days = Math.round((fromYmd(endDate).getTime() - fromYmd(startDate).getTime()) / 86_400_000);
      setEndDate(ymd(addDays(fromYmd(date), days)));
    }
    setStartDate(date);
    setStartTime(time);
  };

  const parseAttendees = (): Address[] =>
    attendees
      .split(/[,;\n]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const m = p.match(/^(.*?)\s*<([^>]+)>$/);
        return m ? { name: m[1].replace(/^"|"$/g, "").trim() || null, email: m[2].trim() } : { name: null, email: p };
      });

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
    if (!range?.valid) return;
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
      attendees: parseAttendees(),
    };
    try {
      if (editing) {
        await pim.updateEvent(editing.id, input, scope);
        if (collectionId && collectionId !== editing.collectionId) await pim.moveEvent(editing.id, collectionId);
      } else {
        await pim.createEvent(collectionId, input);
        // Calendars on this computer cannot invite by themselves: send an
        // iCalendar invitation (iMIP) with Ondura Mail instead.
        if (inviteByMail && sendInvites) {
          const from = mailAccounts[0];
          const organizer = { name: from.displayName, email: from.email };
          const when = range.start ? new Date(range.start).toLocaleString("de-DE", { dateStyle: "full", timeStyle: allDay ? undefined : "short" }) : "";
          await api.send(from.id, {
            to: input.attendees,
            cc: [],
            bcc: [],
            subject: `Einladung: ${input.title || "(Ohne Titel)"}`,
            bodyHtml: `<p>${organizer.name || organizer.email} lädt Sie ein:</p><p><b>${escapeHtml(input.title || "(Ohne Titel)")}</b><br>${escapeHtml(when)}${input.location ? `<br>${escapeHtml(input.location)}` : ""}</p>${input.body ? `<p>${escapeHtml(input.body).replace(/\n/g, "<br>")}</p>` : ""}<p>Die Einladung liegt als Kalenderdatei (.ics) bei.</p>`,
            attachments: [{ source: "text", name: "einladung.ics", contentType: "text/calendar; method=REQUEST; charset=UTF-8", text: invitationIcs(input, organizer) }],
          });
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const heading = !editing ? "Neuer Termin" : editing.isRecurring ? (scope === "series" ? "Serie bearbeiten" : "Dieses Ereignis bearbeiten") : "Termin bearbeiten";
  const isHtmlBody = !!editing && /<\w+[^>]*>/.test(editing.body);

  return (
    <>
    <Dialog open={!!target} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>{heading}</DialogTitle>
          <DialogContent>
            <div className={s.grid}>
              <Field label="Titel" className={s.full}>
                <Input autoFocus value={title} onChange={(_, d) => setTitle(d.value)} placeholder="Titel hinzufügen" onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && save()} />
              </Field>
              <Field label="Kalender">
                <Dropdown
                  value={calendar?.name ?? ""}
                  selectedOptions={[collectionId]}
                  disabled={!!editing && scope === "occurrence"}
                  onOptionSelect={(_, d) => setCollectionId(d.optionValue ?? "")}
                  button={
                    <span>
                      <span className={s.dot} style={{ background: calendar?.color ?? tokens.colorBrandBackground }} />
                      {calendar?.name ?? "Kalender wählen"}
                    </span>
                  }
                >
                  {calendars.map((c) => (
                    <Option key={c.id} value={c.id} text={c.name}>
                      <span className={s.dot} style={{ background: c.color ?? tokens.colorBrandBackground }} />
                      {c.name}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Ort">
                <Input
                  value={location}
                  onChange={(_, d) => setLocation(d.value)}
                  placeholder="Ort oder Besprechungslink"
                  contentAfter={<Button size="small" appearance="transparent" icon={<Building20Regular />} title="Raum suchen" aria-label="Raum suchen" onClick={() => setRoomsOpen(true)} />}
                />
              </Field>

              <div className={s.when}>
                <Field label="Beginn">
                  <Input type="date" value={startDate} onChange={(_, d) => changeStart(d.value, startTime)} />
                </Field>
                <Field label=" ">
                  <Input type="time" value={startTime} disabled={allDay} onChange={(_, d) => changeStart(startDate, d.value)} />
                </Field>
                <Field label="Ende" validationMessage={range && !range.valid ? "Das Ende liegt vor dem Beginn" : undefined}>
                  <Input type="date" value={endDate} onChange={(_, d) => setEndDate(d.value)} />
                </Field>
                <Field label=" ">
                  <Input type="time" value={endTime} disabled={allDay} onChange={(_, d) => setEndTime(d.value)} />
                </Field>
              </div>
              <Switch className={s.full} checked={allDay} onChange={(_, d) => setAllDay(d.checked)} label="Ganztägig" />

              {showRecurrence && (
                <>
                  <Field label="Wiederholen">
                    <Dropdown value={REPEAT_LABEL[repeat]} selectedOptions={[repeat]} onOptionSelect={(_, d) => setRepeat(d.optionValue as RepeatKind)}>
                      {(Object.keys(REPEAT_LABEL) as RepeatKind[])
                        .filter((k) => k !== "custom" || repeat === "custom")
                        .map((k) => (
                          <Option key={k} value={k}>
                            {REPEAT_LABEL[k]}
                          </Option>
                        ))}
                    </Dropdown>
                  </Field>
                  <Field label="Endet am" hint={repeat === "none" ? undefined : "Leer = ohne Ende"}>
                    <Input type="date" value={until} disabled={repeat === "none" || repeat === "custom"} onChange={(_, d) => setUntil(d.value)} />
                  </Field>
                  {repeat === "weekly" && (
                    <div className={s.full}>
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
                    </div>
                  )}
                </>
              )}

              <Field label="Erinnerung">
                <Dropdown
                  value={REMINDERS.find(([, v]) => v === reminder)?.[0] ?? `${reminder} Minuten vorher`}
                  selectedOptions={[String(reminder)]}
                  onOptionSelect={(_, d) => setReminder(d.optionValue === "null" ? null : Number(d.optionValue))}
                >
                  {REMINDERS.map(([label, v]) => (
                    <Option key={label} value={String(v)}>
                      {label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Anzeigen als">
                <Dropdown value={SHOW_AS[showAs]} selectedOptions={[showAs]} onOptionSelect={(_, d) => setShowAs(d.optionValue as ShowAs)}>
                  {(Object.keys(SHOW_AS) as ShowAs[]).map((k) => (
                    <Option key={k} value={k}>
                      {SHOW_AS[k]}
                    </Option>
                  ))}
                </Dropdown>
              </Field>

              <Field label="Teilnehmer" className={s.full} hint="E-Mail-Adressen, durch Komma getrennt">
                <Input value={attendees} onChange={(_, d) => setAttendees(d.value)} placeholder="name@example.com, …" />
              </Field>
              {parseAttendees().length > 0 && (
                <div className={s.full}>
                  <Button size="small" appearance="transparent" onClick={() => setShowScheduling((v) => !v)} style={{ padding: 0 }}>
                    {showScheduling ? "Terminplanungs-Assistent ausblenden" : "Terminplanungs-Assistent: Verfügbarkeit anzeigen"}
                  </Button>
                  {showScheduling && (
                    <Scheduling
                      date={startDate}
                      start={range?.valid && !allDay ? new Date(range.start) : null}
                      end={range?.valid && !allDay ? new Date(range.end) : null}
                      emails={parseAttendees().map((a) => a.email)}
                    />
                  )}
                  {inviteByMail && (
                    <Switch
                      checked={sendInvites}
                      onChange={(_, d) => setSendInvites(d.checked)}
                      label={`Einladungen per E-Mail senden (über ${mailAccounts[0]?.email})`}
                    />
                  )}
                </div>
              )}
              <Field label="Beschreibung" className={s.full} hint={isHtmlBody && body === editing?.body ? "Formatierte Beschreibung – wird nur bei Änderung als Text gespeichert" : undefined}>
                <Textarea value={isHtmlBody && body === editing?.body ? htmlToText(body) : body} onChange={(_, d) => setBody(d.value)} resize="vertical" rows={4} />
              </Field>
            </div>
            {error && (
              <MessageBar intent="error" style={{ marginTop: 12 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={busy} onClick={onClose}>
              Abbrechen
            </Button>
            <Button appearance="primary" disabled={busy || !range?.valid || !collectionId} onClick={save} icon={busy ? <Spinner size="tiny" /> : undefined}>
              Speichern
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
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
