import { useEffect, useState } from "react";
import { Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { pim, type Availability, type CalEvent, type ShowAs } from "../../lib/pim";
import { fromYmd, localRange } from "./dates";

// Scheduling assistant: busy times of the attendees on the chosen day, as in
// Outlook's "Terminplanungs-Assistent".

const FROM_H = 7;
const TO_H = 20;

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "4px", padding: "8px 0" },
  row: { display: "grid", gridTemplateColumns: "150px 1fr", alignItems: "center", gap: "8px" },
  name: { fontSize: tokens.fontSizeBase200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  track: {
    position: "relative",
    height: "18px",
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3Hover,
    overflow: "hidden",
  },
  hours: { position: "relative", height: "14px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  hour: { position: "absolute", transform: "translateX(-50%)" },
  slot: { position: "absolute", top: 0, bottom: 0 },
  proposal: { position: "absolute", top: "-2px", bottom: "-2px", border: `2px solid ${tokens.colorBrandStroke1}`, borderRadius: tokens.borderRadiusSmall, pointerEvents: "none" },
  unknown: { position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: "6px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  legend: { display: "flex", gap: "12px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, marginTop: "2px" },
  swatch: { display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", marginRight: "4px", verticalAlign: "middle" },
});

const COLORS: Record<ShowAs, string> = { busy: "#4f54d4", tentative: "#979bf4", outOfOffice: "#8764b8", free: "transparent" };

export interface SchedulingProps {
  /** Day (YYYY-MM-DD) and proposed time range. */
  date: string;
  start: Date | null;
  end: Date | null;
  emails: string[];
}

export function Scheduling({ date, start, end, emails }: SchedulingProps) {
  const s = useStyles();
  const [data, setData] = useState<Availability[] | null>(null);
  const [mine, setMine] = useState<CalEvent[]>([]);
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
  const bar = (startD: Date, endD: Date, status: ShowAs, k: string) => (
    <span key={k} className={s.slot} style={{ left: `${pos(startD)}%`, width: `${Math.max(0.5, pos(endD) - pos(startD))}%`, background: COLORS[status] }} />
  );
  const proposal = start && end && <span className={s.proposal} style={{ left: `${pos(start)}%`, width: `${Math.max(0.5, pos(end) - pos(start))}%` }} />;

  return (
    <div className={s.root}>
      <div className={s.row}>
        <span />
        <div className={s.hours}>
          {Array.from({ length: TO_H - FROM_H + 1 }, (_, i) => FROM_H + i)
            .filter((h) => h % 2 === 0)
            .map((h) => (
              <span key={h} className={s.hour} style={{ left: `${((h - FROM_H) / (TO_H - FROM_H)) * 100}%` }}>
                {h}
              </span>
            ))}
        </div>
      </div>
      <div className={s.row}>
        <span className={s.name}>Ich</span>
        <div className={s.track}>
          {mine.map((e) => {
            const r = localRange(e);
            return bar(r.start, r.end, e.showAs, e.id);
          })}
          {proposal}
        </div>
      </div>
      {data === null ? (
        <Spinner size="tiny" label="Verfügbarkeit wird geladen …" />
      ) : (
        data.map((a) => (
          <div key={a.email} className={s.row}>
            <span className={s.name} title={a.email}>{a.email}</span>
            <div className={s.track}>
              {a.known ? a.slots.map((sl, i) => bar(new Date(sl.start), new Date(sl.end), sl.status, String(i))) : <span className={s.unknown}>Keine Informationen</span>}
              {proposal}
            </div>
          </div>
        ))
      )}
      <div className={s.legend}>
        <span><span className={s.swatch} style={{ background: COLORS.busy }} />Gebucht</span>
        <span><span className={s.swatch} style={{ background: COLORS.tentative }} />Mit Vorbehalt</span>
        <span><span className={s.swatch} style={{ background: COLORS.outOfOffice }} />Abwesend</span>
        <span><span className={s.swatch} style={{ border: `2px solid ${tokens.colorBrandStroke1}` }} />Ihr Termin</span>
      </div>
      {data?.some((a) => !a.known) && (
        <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
          Verfügbarkeit gibt es für Adressen aus Microsoft 365 und Exchange.
        </Text>
      )}
    </div>
  );
}
