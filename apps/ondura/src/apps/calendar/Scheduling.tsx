import { useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ChevronLeft20Regular, ChevronRight20Regular, Person20Regular, PersonAvailable20Regular } from "@fluentui/react-icons";
import { pim, type Availability, type CalEvent, type ShowAs } from "../../lib/pim";
import type { Address } from "../../lib/types";
import { fromYmd, localRange } from "./dates";
import { tl, LOCALE } from "../../lib/i18n";

// Scheduling assistant: busy times of the user and the attendees on one day.
// Clicking a free spot moves the meeting there.

const FROM_H = 7;
const TO_H = 20;
const SNAP_MIN = 30;

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "6px", padding: "8px 0" },
  nav: { display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px" },
  day: { fontWeight: tokens.fontWeightSemibold, minWidth: "220px" },
  row: { display: "grid", gridTemplateColumns: "200px 1fr", alignItems: "center", gap: "10px" },
  name: { display: "flex", alignItems: "center", gap: "6px", fontSize: tokens.fontSizeBase200, minWidth: 0 },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  role: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100, flexShrink: 0 },
  track: {
    position: "relative",
    height: "26px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    backgroundImage: `repeating-linear-gradient(to right, ${tokens.colorNeutralStroke2} 0 1px, transparent 1px calc(100% / ${TO_H - FROM_H}))`,
    overflow: "hidden",
    cursor: "pointer",
  },
  hours: { position: "relative", height: "16px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  hour: { position: "absolute", transform: "translateX(-50%)" },
  slot: { position: "absolute", top: "3px", bottom: "3px", borderRadius: tokens.borderRadiusSmall },
  proposal: {
    position: "absolute",
    top: 0,
    bottom: 0,
    border: `2px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: "rgba(0, 120, 212, 0.12)",
    borderRadius: tokens.borderRadiusMedium,
    pointerEvents: "none",
  },
  conflict: { border: `2px solid ${tokens.colorPaletteRedBorder2}`, backgroundColor: "rgba(209, 52, 56, 0.12)" },
  unknown: { position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: "8px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  legend: { display: "flex", gap: "14px", flexWrap: "wrap", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, marginTop: "4px" },
  swatch: { display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", marginRight: "4px", verticalAlign: "middle" },
});

const COLORS: Record<ShowAs, string> = { busy: "#4f54d4", tentative: "#979bf4", outOfOffice: "#8764b8", free: "transparent" };

export interface SchedulingAttendee {
  address: Address;
  required: boolean;
}

export interface SchedulingProps {
  /** Day (YYYY-MM-DD) and proposed time range. */
  date: string;
  start: Date | null;
  end: Date | null;
  attendees: SchedulingAttendee[];
  /** A free spot was clicked: new start (the duration stays). */
  onPick?: (start: Date) => void;
  /** Previous or next day. */
  onDay?: (delta: number) => void;
}

export function Scheduling({ date, start, end, attendees, onPick, onDay }: SchedulingProps) {
  const s = useStyles();
  const [data, setData] = useState<Availability[] | null>(null);
  const [mine, setMine] = useState<CalEvent[]>([]);
  const emails = useMemo(() => attendees.map((a) => a.address.email), [attendees]);
  const key = emails.join(",");

  useEffect(() => {
    if (!date) return;
    const from = fromYmd(date);
    const to = new Date(from.getTime() + 86_400_000);
    let cancelled = false;
    setData(null);
    Promise.all([
      emails.length ? pim.freeBusy(emails, from, to).catch(() => emails.map((email) => ({ email, known: false, slots: [] }))) : Promise.resolve([]),
      pim.events(from, to).catch(() => []),
    ]).then(([av, ev]) => {
      if (cancelled) return;
      setData(av);
      setMine(ev.filter((e) => !e.allDay && e.showAs !== "free"));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, key]);

  const day = date ? fromYmd(date) : new Date();
  const pos = (d: Date) => {
    const h = (d.getTime() - day.getTime()) / 3_600_000;
    return Math.max(0, Math.min(100, ((h - FROM_H) / (TO_H - FROM_H)) * 100));
  };
  const overlaps = (a: Date, b: Date) => !!start && !!end && a < end && b > start;
  const busyRanges = [
    ...mine.filter((e) => e.showAs !== "free").map((e) => localRange(e)),
    ...(data ?? []).flatMap((a) => a.slots.filter((x) => x.status !== "free").map((x) => ({ start: new Date(x.start), end: new Date(x.end) }))),
  ];
  const conflict = busyRanges.some((r) => overlaps(r.start, r.end));

  const bar = (startD: Date, endD: Date, status: ShowAs, k: string, title?: string) => (
    <span key={k} className={s.slot} title={title} style={{ left: `${pos(startD)}%`, width: `${Math.max(0.5, pos(endD) - pos(startD))}%`, background: COLORS[status] }} />
  );
  const proposal = start && end && (
    <span className={mergeClasses(s.proposal, conflict && s.conflict)} style={{ left: `${pos(start)}%`, width: `${Math.max(0.5, pos(end) - pos(start))}%` }} />
  );
  /** Click on a track: start at the clicked half hour. */
  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const minutes = FROM_H * 60 + ((e.clientX - r.left) / r.width) * (TO_H - FROM_H) * 60;
    const snapped = Math.max(FROM_H * 60, Math.min(TO_H * 60 - SNAP_MIN, Math.floor(minutes / SNAP_MIN) * SNAP_MIN));
    const d = new Date(day);
    d.setHours(0, snapped, 0, 0);
    onPick(d);
  };
  const time = (d: Date) => d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={s.root}>
      {onDay && (
        <div className={s.nav}>
          <Button size="small" appearance="subtle" icon={<ChevronLeft20Regular />} aria-label={tl("Vorheriger Tag")} onClick={() => onDay(-1)} />
          <Button size="small" appearance="subtle" icon={<ChevronRight20Regular />} aria-label={tl("Nächster Tag")} onClick={() => onDay(1)} />
          <Text className={s.day}>{day.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Text>
          {start && end && (
            <Text size={200} style={{ color: conflict ? tokens.colorPaletteRedForeground1 : tokens.colorPaletteGreenForeground1 }}>
              {conflict ? tl("Konflikt mit einem anderen Termin") : tl("Alle verfügbar")}
            </Text>
          )}
        </div>
      )}
      <div className={s.row}>
        <span />
        <div className={s.hours}>
          {Array.from({ length: TO_H - FROM_H + 1 }, (_, i) => FROM_H + i).map((h) => (
            <span key={h} className={s.hour} style={{ left: `${((h - FROM_H) / (TO_H - FROM_H)) * 100}%` }}>
              {h}
            </span>
          ))}
        </div>
      </div>
      <div className={s.row}>
        <span className={s.name}>
          <PersonAvailable20Regular />
          <span className={s.label}>{tl("Ich")}</span>
        </span>
        <div className={s.track} onClick={pick}>
          {mine.map((e) => {
            const r = localRange(e);
            return bar(r.start, r.end, e.showAs, e.id, `${time(r.start)}–${time(r.end)} ${e.title}`);
          })}
          {proposal}
        </div>
      </div>
      {data === null ? (
        <Spinner size="tiny" label={tl("Verfügbarkeit wird geladen …")} />
      ) : (
        attendees.map((att) => {
          const a = data.find((x) => x.email.toLowerCase() === att.address.email.toLowerCase());
          return (
            <div key={att.address.email} className={s.row}>
              <Tooltip content={att.address.email} relationship="description">
                <span className={s.name}>
                  <Person20Regular />
                  <span className={s.label}>{att.address.name || att.address.email}</span>
                  <span className={s.role}>{att.required ? tl("Erforderlich") : tl("Optional")}</span>
                </span>
              </Tooltip>
              <div className={s.track} onClick={pick}>
                {a?.known ? a.slots.map((sl, i) => bar(new Date(sl.start), new Date(sl.end), sl.status, String(i), `${time(new Date(sl.start))}–${time(new Date(sl.end))}`)) : <span className={s.unknown}>{tl("Keine Informationen")}</span>}
                {proposal}
              </div>
            </div>
          );
        })
      )}
      <div className={s.legend}>
        <span><span className={s.swatch} style={{ background: COLORS.busy }} />{tl("Gebucht")}</span>
        <span><span className={s.swatch} style={{ background: COLORS.tentative }} />{tl("Mit Vorbehalt")}</span>
        <span><span className={s.swatch} style={{ background: COLORS.outOfOffice }} />{tl("Abwesend")}</span>
        <span><span className={s.swatch} style={{ border: `2px solid ${tokens.colorBrandStroke1}` }} />{tl("Ihr Termin")}</span>
        {onPick && <span>{tl("Klicken Sie auf eine freie Stelle, um den Termin dorthin zu legen.")}</span>}
      </div>
      {data?.some((a) => !a.known) && (
        <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
          {tl("Verfügbarkeit gibt es für Adressen aus Microsoft 365 und Exchange.")}
        </Text>
      )}
    </div>
  );
}
