import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { CalEvent } from "../../lib/pim";
import { WEEKDAYS_SHORT, addDays, fmtTime, localRange, sameDay, startOfWeek } from "./dates";

const useStyles = makeStyles({
  root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  dows: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  dow: { padding: "6px 8px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  grid: { flex: 1, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "repeat(6, 1fr)", minHeight: 0 },
  cell: {
    borderRight: `1px solid ${tokens.colorNeutralStroke3}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    padding: "4px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minHeight: 0,
    overflow: "hidden",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  other: { backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground3 },
  num: { fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, padding: "2px 4px", alignSelf: "flex-start", borderRadius: tokens.borderRadiusCircular },
  today: { backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand },
  chip: {
    fontSize: tokens.fontSizeBase200,
    padding: "1px 4px",
    borderRadius: tokens.borderRadiusSmall,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    color: tokens.colorNeutralForeground1,
    ":hover": { filter: "brightness(0.95)" },
  },
  dot: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0 },
  more: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, paddingLeft: "4px" },
});

export interface MonthGridProps {
  month: Date;
  events: CalEvent[];
  colorOf: (e: CalEvent) => string;
  onDay: (d: Date) => void;
  onNew: (d: Date) => void;
  onEvent: (e: CalEvent, target: HTMLElement) => void;
}

export function MonthGrid({ month, events, colorOf, onDay, onNew, onEvent }: MonthGridProps) {
  const s = useStyles();
  const first = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = new Date();
  const tint = (c: string) => `color-mix(in srgb, ${c} 22%, ${tokens.colorNeutralBackground1})`;

  return (
    <div className={s.root}>
      <div className={s.dows}>
        {WEEKDAYS_SHORT.map((d) => (
          <span key={d} className={s.dow}>{d}</span>
        ))}
      </div>
      <div className={s.grid}>
        {days.map((d) => {
          const dayEvents = events
            .filter((e) => {
              const { start, end } = localRange(e);
              return end > d && start < addDays(d, 1);
            })
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
          const shown = dayEvents.slice(0, 3);
          return (
            <div key={d.toISOString()} className={mergeClasses(s.cell, d.getMonth() !== month.getMonth() && s.other)} onClick={() => onNew(d)}>
              <span
                className={mergeClasses(s.num, sameDay(d, today) && s.today)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDay(d);
                }}
              >
                {d.getDate() === 1 ? d.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : d.getDate()}
              </span>
              {shown.map((e) => {
                const color = colorOf(e);
                const multi = e.allDay || localRange(e).end.getTime() - localRange(e).start.getTime() >= 86_400_000;
                return (
                  <span
                    key={e.id}
                    className={s.chip}
                    style={multi ? { background: tint(color), borderLeft: `3px solid ${color}` } : undefined}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEvent(e, ev.currentTarget);
                    }}
                    title={e.title}
                  >
                    {!multi && <span className={s.dot} style={{ background: color }} />}
                    {!multi && <span style={{ color: tokens.colorNeutralForeground3 }}>{fmtTime(localRange(e).start)}</span>}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.title || "(Ohne Titel)"}</span>
                  </span>
                );
              })}
              {dayEvents.length > 3 && (
                <span
                  className={s.more}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onDay(d);
                  }}
                >
                  +{dayEvents.length - 3} weitere
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
