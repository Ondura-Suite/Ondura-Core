import { useState, useEffect } from "react";
import { Button, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ChevronLeft16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import { WEEKDAYS_SHORT, addDays, addMonths, fmtMonth, sameDay, startOfWeek } from "./dates";

const useStyles = makeStyles({
  root: { padding: "4px 4px 8px" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 4px 8px", fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" },
  dow: { textAlign: "center", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, padding: "4px 0" },
  day: {
    height: "28px",
    border: "none",
    borderRadius: "50%",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  other: { color: tokens.colorNeutralForeground4 },
  inRange: { backgroundColor: tokens.colorBrandBackground2, borderRadius: tokens.borderRadiusSmall },
  today: { backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand, fontWeight: tokens.fontWeightSemibold, ":hover": { backgroundColor: tokens.colorBrandBackgroundHover } },
});

export function MiniMonth({ selected, rangeStart, rangeEnd, onSelect }: { selected: Date; rangeStart: Date; rangeEnd: Date; onSelect: (d: Date) => void }) {
  const s = useStyles();
  const [month, setMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));
  useEffect(() => setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1)), [selected]);
  const first = startOfWeek(month);
  const today = new Date();
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));

  return (
    <div className={s.root}>
      <div className={s.head}>
        <span>{fmtMonth(month)}</span>
        <span>
          <Button size="small" appearance="subtle" icon={<ChevronLeft16Regular />} aria-label="Vorheriger Monat" onClick={() => setMonth(addMonths(month, -1))} />
          <Button size="small" appearance="subtle" icon={<ChevronRight16Regular />} aria-label="Nächster Monat" onClick={() => setMonth(addMonths(month, 1))} />
        </span>
      </div>
      <div className={s.grid}>
        {WEEKDAYS_SHORT.map((d) => (
          <span key={d} className={s.dow}>{d}</span>
        ))}
        {days.map((d) => (
          <button
            key={d.toISOString()}
            className={mergeClasses(
              s.day,
              d.getMonth() !== month.getMonth() && s.other,
              d >= rangeStart && d < rangeEnd && !sameDay(d, today) && s.inRange,
              sameDay(d, today) && s.today,
            )}
            onClick={() => onSelect(d)}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}
