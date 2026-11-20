// "Diagramme" of Ondura Planer: status of all tasks (donut), tasks per
// bucket, per priority and per person (stacked by status).

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { tl } from "../../lib/i18n";
import { PRIORITIES, byOrder, isLate, type Plan, type Task } from "./model";

const STATUS = [
  { key: "open", label: () => tl("Nicht begonnen"), color: "#a0aeb2" },
  { key: "doing", label: () => tl("In Arbeit"), color: "#0078d4" },
  { key: "late", label: () => tl("Verspätet"), color: "#c50f1f" },
  { key: "done", label: () => tl("Erledigt"), color: "#13a10e" },
] as const;
type StatusKey = (typeof STATUS)[number]["key"];

const statusOf = (t: Task): StatusKey => (t.progress === 100 ? "done" : isLate(t) ? "late" : t.progress === 50 ? "doing" : "open");

const useStyles = makeStyles({
  root: { flex: 1, overflow: "auto", padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px", alignContent: "start" },
  card: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusLarge, padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" },
  title: { fontWeight: tokens.fontWeightSemibold },
  legend: { display: "flex", flexWrap: "wrap", gap: "12px", fontSize: tokens.fontSizeBase200 },
  dot: { width: "10px", height: "10px", borderRadius: "3px", display: "inline-block", marginRight: "5px" },
  bars: { display: "flex", flexDirection: "column", gap: "8px" },
  barRow: { display: "grid", gridTemplateColumns: "130px 1fr 34px", alignItems: "center", gap: "8px", fontSize: tokens.fontSizeBase200 },
  bar: { display: "flex", height: "18px", borderRadius: "4px", overflow: "hidden", backgroundColor: tokens.colorNeutralBackground3 },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

function Donut({ counts }: { counts: Record<StatusKey, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 160 160" width={160} height={160} style={{ flexShrink: 0 }} role="img" aria-label={tl("Status")}>
      <circle cx={80} cy={80} r={r} fill="none" stroke="#edebe9" strokeWidth={22} />
      {total > 0 &&
        STATUS.map((st) => {
          const len = (counts[st.key] / total) * c;
          const el = len > 0 && <circle key={st.key} cx={80} cy={80} r={r} fill="none" stroke={st.color} strokeWidth={22} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />;
          offset += len;
          return el;
        })}
      <text x={80} y={76} textAnchor="middle" fontSize={28} fontWeight={600} fill="currentColor">
        {counts.open + counts.doing + counts.late}
      </text>
      <text x={80} y={98} textAnchor="middle" fontSize={12} fill="currentColor" opacity={0.7}>
        {tl("verbleibend")}
      </text>
    </svg>
  );
}

export function PlannerCharts({ plan, tasks, nameOf }: { plan: Plan; tasks: Task[]; nameOf: (id: string) => string }) {
  const s = useStyles();
  const count = (list: Task[]) => {
    const c: Record<StatusKey, number> = { open: 0, doing: 0, late: 0, done: 0 };
    for (const t of list) c[statusOf(t)]++;
    return c;
  };
  const all = count(tasks);
  const legend = (
    <div className={s.legend}>
      {STATUS.map((st) => (
        <span key={st.key}>
          <span className={s.dot} style={{ backgroundColor: st.color }} />
          {st.label()} {all[st.key]}
        </span>
      ))}
    </div>
  );
  const stacked = (rows: { name: string; tasks: Task[] }[]) => {
    const max = Math.max(1, ...rows.map((r) => r.tasks.length));
    return (
      <div className={s.bars}>
        {rows.map((r) => {
          const c = count(r.tasks);
          return (
            <div key={r.name} className={s.barRow}>
              <span className={s.name} title={r.name}>
                {r.name}
              </span>
              <div className={s.bar} style={{ width: `${(r.tasks.length / max) * 100}%`, minWidth: r.tasks.length ? 6 : 0 }}>
                {STATUS.map((st) => c[st.key] > 0 && <span key={st.key} title={`${st.label()}: ${c[st.key]}`} style={{ flex: c[st.key], backgroundColor: st.color }} />)}
              </div>
              <span className={s.muted}>{r.tasks.length}</span>
            </div>
          );
        })}
        {!rows.length && <Text className={s.muted}>{tl("Keine Aufgaben.")}</Text>}
      </div>
    );
  };
  const people = [...new Set(tasks.flatMap((t) => t.assignees))];
  return (
    <div className={s.root}>
      <div className={s.card}>
        <Text className={s.title}>{tl("Status")}</Text>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Donut counts={all} />
          {legend}
        </div>
      </div>
      <div className={s.card}>
        <Text className={s.title}>{tl("Bucket")}</Text>
        {stacked([...plan.buckets].sort(byOrder).map((b) => ({ name: b.name, tasks: tasks.filter((t) => t.bucketId === b.id) })))}
      </div>
      <div className={s.card}>
        <Text className={s.title}>{tl("Priorität")}</Text>
        {stacked(PRIORITIES.map((p) => ({ name: p.label(), tasks: tasks.filter((t) => t.priority === p.value) })))}
      </div>
      <div className={s.card}>
        <Text className={s.title}>{tl("Mitglieder")}</Text>
        {stacked([...people.map((id) => ({ name: nameOf(id), tasks: tasks.filter((t) => t.assignees.includes(id)) })), { name: tl("Nicht zugewiesen"), tasks: tasks.filter((t) => !t.assignees.length) }].filter((r) => r.tasks.length))}
      </div>
    </div>
  );
}
