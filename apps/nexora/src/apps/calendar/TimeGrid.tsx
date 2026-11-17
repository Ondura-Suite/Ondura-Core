import { useEffect, useMemo, useRef, useState } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowRepeatAll16Regular } from "@fluentui/react-icons";
import type { CalEvent } from "../../lib/pim";
import { DAY_MS, WEEKDAYS_SHORT, addDays, fmtTime, isAllDayRow, isoWeek, localRange, sameDay } from "./dates";

const HOUR = 48;

const useStyles = makeStyles({
  root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  header: { display: "grid", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  corner: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: "6px" },
  dayHead: { padding: "6px 8px", display: "flex", alignItems: "baseline", gap: "6px", borderLeft: `1px solid ${tokens.colorNeutralStroke3}`, cursor: "pointer" },
  dayNum: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
  dayName: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  todayNum: {
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: tokens.colorBrandBackground,
    borderRadius: "50%",
    width: "32px",
    height: "32px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: tokens.fontSizeBase400,
  },
  allDay: { display: "grid", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, maxHeight: "96px", overflowY: "auto", padding: "2px 0" },
  allDayLabel: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, textAlign: "center", paddingTop: "4px" },
  bar: {
    boxSizing: "border-box",
    margin: "1px 2px",
    padding: "1px 6px",
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
  },
  scroll: { flex: 1, overflowY: "auto", position: "relative" },
  body: { display: "grid", position: "relative" },
  hours: { position: "relative" },
  hourLabel: { position: "absolute", right: "6px", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, transform: "translateY(-50%)" },
  col: { position: "relative", borderLeft: `1px solid ${tokens.colorNeutralStroke3}` },
  slot: { height: `${HOUR / 2}px`, borderTop: `1px solid ${tokens.colorNeutralStroke3}`, cursor: "pointer", ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  halfSlot: { borderTop: `1px dotted ${tokens.colorNeutralStroke3}` },
  weekend: { backgroundColor: tokens.colorNeutralBackground2 },
  event: {
    position: "absolute",
    boxSizing: "border-box",
    borderRadius: tokens.borderRadiusMedium,
    padding: "2px 6px",
    fontSize: tokens.fontSizeBase200,
    lineHeight: "16px",
    overflow: "hidden",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    boxShadow: `0 0 0 1px ${tokens.colorNeutralBackground1}`,
  },
  eventTitle: { fontWeight: tokens.fontWeightSemibold, display: "flex", gap: "4px", alignItems: "center" },
  eventMeta: { color: tokens.colorNeutralForeground2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  now: { position: "absolute", left: 0, right: 0, height: "2px", backgroundColor: tokens.colorPaletteRedBackground3, zIndex: 2, pointerEvents: "none" },
  nowDot: { position: "absolute", left: "-5px", top: "-4px", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: tokens.colorPaletteRedBackground3 },
});

interface Placed {
  event: CalEvent;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Side-by-side layout for overlapping events of one day. */
function layoutDay(events: CalEvent[], day: Date): Placed[] {
  const dayStart = day.getTime();
  const items = events
    .map((e) => {
      const { start, end } = localRange(e);
      const s = Math.max(start.getTime(), dayStart);
      const en = Math.min(end.getTime(), dayStart + DAY_MS);
      return { e, s, en: Math.max(en, s + 15 * 60_000) };
    })
    .sort((a, b) => a.s - b.s || b.en - a.en);
  const placed: Placed[] = [];
  let cluster: typeof items = [];
  let clusterEnd = 0;
  const flush = () => {
    const colsEnd: number[] = [];
    const assigned = cluster.map((it) => {
      let c = colsEnd.findIndex((end) => end <= it.s);
      if (c < 0) {
        c = colsEnd.length;
        colsEnd.push(0);
      }
      colsEnd[c] = it.en;
      return { it, c };
    });
    for (const { it, c } of assigned) {
      placed.push({
        event: it.e,
        top: ((it.s - dayStart) / 3_600_000) * HOUR,
        height: Math.max(((it.en - it.s) / 3_600_000) * HOUR - 2, 18),
        col: c,
        cols: colsEnd.length,
      });
    }
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.en);
  }
  if (cluster.length) flush();
  return placed;
}

export interface TimeGridProps {
  days: Date[];
  events: CalEvent[];
  colorOf: (e: CalEvent) => string;
  onSlot: (start: Date) => void;
  onEvent: (e: CalEvent, target: HTMLElement) => void;
  onDay: (d: Date) => void;
}

export function TimeGrid({ days, events, colorOf, onSlot, onEvent, onDay }: TimeGridProps) {
  const s = useStyles();
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * HOUR;
  }, [days.length]);

  const columns = `56px repeat(${days.length}, 1fr)`;
  const rangeStart = days[0];
  const rangeEnd = addDays(days[days.length - 1], 1);
  const allDay = useMemo(() => events.filter(isAllDayRow), [events]);
  const timed = useMemo(() => events.filter((e) => !isAllDayRow(e)), [events]);

  const tint = (c: string) => `color-mix(in srgb, ${c} 22%, ${tokens.colorNeutralBackground1})`;

  return (
    <div className={s.root}>
      <div className={s.header} style={{ gridTemplateColumns: columns }}>
        <span className={s.corner}>KW {isoWeek(days[0])}</span>
        {days.map((d) => {
          const today = sameDay(d, now);
          return (
            <div key={d.toISOString()} className={s.dayHead} onClick={() => onDay(d)} title="Tagesansicht">
              <span className={mergeClasses(s.dayNum, today && s.todayNum)}>{d.getDate()}</span>
              <span className={s.dayName}>{WEEKDAYS_SHORT[(d.getDay() + 6) % 7]}</span>
            </div>
          );
        })}
      </div>
      {allDay.length > 0 && (
        <div className={s.allDay} style={{ gridTemplateColumns: columns }}>
          <span className={s.allDayLabel} style={{ gridRow: `1 / span ${allDay.length}` }}>Ganztägig</span>
          {allDay.map((e, i) => {
            const { start, end } = localRange(e);
            const from = Math.max(0, Math.floor((Math.max(start.getTime(), rangeStart.getTime()) - rangeStart.getTime()) / DAY_MS));
            const to = Math.min(days.length, Math.ceil((Math.min(end.getTime(), rangeEnd.getTime()) - rangeStart.getTime()) / DAY_MS));
            const color = colorOf(e);
            return (
              <div
                key={e.id}
                className={s.bar}
                style={{ gridColumn: `${from + 2} / ${Math.max(to, from + 1) + 2}`, gridRow: i + 1, background: tint(color), borderLeft: `3px solid ${color}` }}
                onClick={(ev) => onEvent(e, ev.currentTarget)}
                title={e.title}
              >
                {e.title || "(Ohne Titel)"}
              </div>
            );
          })}
        </div>
      )}
      <div className={s.scroll} ref={scroll}>
        <div className={s.body} style={{ gridTemplateColumns: columns, height: 24 * HOUR }}>
          <div className={s.hours}>
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className={s.hourLabel} style={{ top: (h + 1) * HOUR }}>
                {String(h + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = timed.filter((e) => {
              const { start, end } = localRange(e);
              return end > d && start < addDays(d, 1);
            });
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={d.toISOString()} className={mergeClasses(s.col, weekend && s.weekend)}>
                {Array.from({ length: 48 }, (_, i) => (
                  <div
                    key={i}
                    className={mergeClasses(s.slot, i % 2 === 1 && s.halfSlot)}
                    onClick={() => {
                      const start = new Date(d);
                      start.setHours(Math.floor(i / 2), (i % 2) * 30, 0, 0);
                      onSlot(start);
                    }}
                  />
                ))}
                {layoutDay(dayEvents, d).map((p) => {
                  const color = colorOf(p.event);
                  const { start, end } = localRange(p.event);
                  const tentative = p.event.showAs === "tentative" || p.event.showAs === "free";
                  return (
                    <div
                      key={p.event.id}
                      className={s.event}
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        background: tentative ? `repeating-linear-gradient(135deg, ${tint(color)} 0 6px, ${tokens.colorNeutralBackground1} 6px 9px)` : tint(color),
                        borderLeft: `3px solid ${color}`,
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEvent(p.event, ev.currentTarget);
                      }}
                      title={`${p.event.title}\n${fmtTime(start)} – ${fmtTime(end)}`}
                    >
                      <div className={s.eventTitle}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.event.title || "(Ohne Titel)"}</span>
                        {p.event.isRecurring && <ArrowRepeatAll16Regular style={{ flexShrink: 0, fontSize: 12 }} />}
                      </div>
                      {p.height > 34 && (
                        <div className={s.eventMeta}>
                          {fmtTime(start)} – {fmtTime(end)}
                          {p.event.location ? ` · ${p.event.location}` : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sameDay(d, now) && (
                  <div className={s.now} style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }}>
                    <span className={s.nowDot} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
