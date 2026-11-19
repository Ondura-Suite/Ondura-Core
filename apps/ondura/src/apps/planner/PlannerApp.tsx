// Ondura Planer: plans with buckets and task cards, like Microsoft Planner.
// Plans live on this computer (JSON in the data directory) or in Microsoft
// Planner (work or school account, through Graph). Views: board, grid,
// schedule (calendar) and charts.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Avatar,
  Button,
  Dropdown,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Option,
  SearchBox,
  Spinner,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Board20Regular,
  CalendarLtr20Regular,
  ChartMultiple20Regular,
  CheckmarkCircle20Filled,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Circle20Regular,
  CircleHalfFill20Regular,
  CloudArrowUp20Regular,
  Delete20Regular,
  Desktop20Regular,
  Grid20Regular,
  MoreHorizontal20Regular,
  Rename20Regular,
  TaskListSquareLtr20Regular,
  ArrowClockwise20Regular,
} from "@fluentui/react-icons";
import { errorMessage, isTauri } from "../../lib/api";
import { LOCALE, tl, tlc } from "../../lib/i18n";
import { ConsentRequired, grantAccess, microsoftAccounts, newId, storeDelete, storeList, storeRead, storeWrite, type CloudAccountInfo, type StoredDoc } from "../../lib/graphApps";
import { setWindowTitle } from "../../lib/office";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { useNotify } from "../../shell/notify";
import { openContextMenu } from "../../shell/contextMenu";
import { splashDone } from "../../shell/splash";
import { LABEL_COLORS, PRIORITIES, PROGRESS, byOrder, emptyPlan, isLate, newTask, orderBetween, samplePlan, today, type Bucket, type Plan, type Progress, type Task } from "./model";
import * as ms from "./msplanner";
import { TaskDialog } from "./TaskDialog";
import { PlannerCharts } from "./PlannerCharts";

const COLOR = "#0b7a75";
const LAST = "ondura.planner.last";

type View = "board" | "grid" | "schedule" | "charts";
type GroupBy = "bucket" | "progress" | "priority" | "due" | "assignee" | "label";

interface PlanRef {
  source: string;
  id: string;
  name: string;
  groupId?: string;
}

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  main: { flex: 1, minHeight: 0, display: "flex", gap: "8px", margin: "0 8px 8px" },
  rail: { width: "240px", flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden" },
  railHead: { padding: "10px 12px 4px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, display: "flex", justifyContent: "space-between", alignItems: "center" },
  railList: { flex: 1, overflowY: "auto", padding: "0 6px 8px" },
  planItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    border: "none",
    background: "none",
    padding: "7px 8px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  planOn: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  planIcon: { width: "28px", height: "28px", borderRadius: "6px", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", flexShrink: 0 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  content: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4, overflow: "hidden" },
  top: { display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px 0", flexWrap: "wrap" },
  planTitle: { fontSize: "20px", fontWeight: tokens.fontWeightSemibold },
  tools: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 16px 8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, flexWrap: "wrap" },
  board: { flex: 1, minHeight: 0, display: "flex", gap: "12px", padding: "12px 16px", overflowX: "auto", alignItems: "flex-start" },
  column: { width: "290px", flexShrink: 0, display: "flex", flexDirection: "column", maxHeight: "100%", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground2, padding: "8px" },
  columnHead: { display: "flex", alignItems: "center", gap: "6px", padding: "2px 4px 8px", fontWeight: tokens.fontWeightSemibold },
  cards: { display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", minHeight: "40px", paddingBottom: "4px" },
  dropZone: { outline: `2px dashed ${COLOR}`, outlineOffset: "-2px", borderRadius: tokens.borderRadiusMedium },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow4,
    padding: "10px 12px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    border: `1px solid transparent`,
    ":hover": { boxShadow: tokens.shadow8, border: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  cardDone: { opacity: 0.7 },
  cardTitle: { display: "flex", alignItems: "flex-start", gap: "6px", wordBreak: "break-word" },
  labels: { display: "flex", flexWrap: "wrap", gap: "4px" },
  label: { fontSize: tokens.fontSizeBase100, color: "#fff", padding: "1px 8px", borderRadius: "10px", fontWeight: tokens.fontWeightSemibold, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { display: "flex", alignItems: "center", gap: "8px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, flexWrap: "wrap" },
  late: { color: "#c50f1f", fontWeight: tokens.fontWeightSemibold },
  check: { border: "none", background: "none", padding: 0, cursor: "pointer", color: COLOR, display: "flex", flexShrink: 0, marginTop: "1px" },
  checklist: { display: "flex", flexDirection: "column", gap: "2px", fontSize: tokens.fontSizeBase200 },
  people: { display: "flex", gap: "2px", marginLeft: "auto" },
  addInput: { marginBottom: "8px" },
  grid: { flex: 1, overflow: "auto", padding: "0 16px 16px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: tokens.fontSizeBase300, "& th": { textAlign: "left", fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground3, padding: "10px 8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, position: "sticky", top: 0, backgroundColor: tokens.colorNeutralBackground1, cursor: "pointer", whiteSpace: "nowrap" }, "& td": { padding: "8px", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }, "& tbody tr": { cursor: "pointer" }, "& tbody tr:hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  cal: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 16px 16px" },
  calGrid: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "1fr", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, overflow: "hidden" },
  calHead: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, padding: "4px 0" },
  calDay: { borderRight: `1px solid ${tokens.colorNeutralStroke3}`, borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, padding: "4px", overflow: "hidden", display: "flex", flexDirection: "column", gap: "3px", minHeight: 0 },
  calOther: { backgroundColor: tokens.colorNeutralBackground2 },
  calToday: { "& > span:first-child": { backgroundColor: COLOR, color: "#fff", borderRadius: "10px", padding: "0 6px" } },
  calTask: { fontSize: tokens.fontSizeBase200, padding: "2px 6px", borderRadius: "4px", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", border: "none", textAlign: "left", fontFamily: "inherit" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", color: tokens.colorNeutralForeground3 },
  muted: { color: tokens.colorNeutralForeground3 },
  bar: { margin: "8px 16px 0" },
});

/** Initials avatar colour per person. */
const personColor = (name: string) => {
  const colors = ["#0b7a75", "#7719aa", "#2b5bd7", "#c43e1c", "#107c41", "#c27c0e", "#4f52b2", "#b4009e"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
};

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit" });

export function ProgressIcon({ value, onClick }: { value: Progress; onClick?: (e: React.MouseEvent) => void }) {
  const s = useStyles();
  const icon = value === 100 ? <CheckmarkCircle20Filled /> : value === 50 ? <CircleHalfFill20Regular /> : <Circle20Regular />;
  return (
    <button className={s.check} onClick={onClick} aria-label={PROGRESS.find((p) => p.value === value)?.label()} title={tl("Als erledigt markieren")}>
      {icon}
    </button>
  );
}

export function PlannerApp() {
  const s = useStyles();
  const notify = useNotify();
  const [localList, setLocalList] = useState<StoredDoc[]>([]);
  const [accounts, setAccounts] = useState<CloudAccountInfo[]>([]);
  const [msPlans, setMsPlans] = useState<Record<string, ms.PlanRef[] | "loading" | "consent" | { error: string }>>({});
  const [ref, setRef] = useState<PlanRef | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("board");
  const [groupBy, setGroupBy] = useState<GroupBy>("bucket");
  const [filter, setFilter] = useState("");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [people, setPeople] = useState<Map<string, ms.Person>>(new Map());
  const [consent, setConsent] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: "due", asc: true });
  const saveTimer = useRef<number | null>(null);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;

  const isMs = !!ref && ref.source !== "local";

  // ------------------------------------------------------------ plans --

  const refreshLocal = useCallback(async () => {
    let list = await storeList("planner");
    if (!list.length) {
      const p = samplePlan();
      await storeWrite("planner", p.id, p);
      list = await storeList("planner");
    }
    setLocalList(list);
    return list;
  }, []);

  const loadMsPlans = useCallback(async (account: string) => {
    setMsPlans((m) => ({ ...m, [account]: "loading" }));
    try {
      const list = await ms.plans(account);
      setMsPlans((m) => ({ ...m, [account]: list }));
    } catch (e) {
      // Planner does not exist for personal Microsoft accounts: hide them.
      if (/MSA accounts/i.test(errorMessage(e))) {
        setAccounts((list) => list.filter((a) => a.key !== account));
        return;
      }
      setMsPlans((m) => ({ ...m, [account]: e instanceof ConsentRequired ? "consent" : { error: errorMessage(e) } }));
    }
  }, []);

  const openPlan = useCallback(
    async (r: PlanRef) => {
      setRef(r);
      setPlan(null);
      setOpenTask(null);
      setConsent(null);
      setLoading(true);
      try {
        localStorage.setItem(LAST, JSON.stringify(r));
      } catch {
        /* ignore */
      }
      try {
        if (r.source === "local") setPlan(await storeRead<Plan>("planner", r.id));
        else {
          const p = await ms.loadPlan(r.source, r.id);
          setPlan(p);
          const ids = [...new Set(p.tasks.flatMap((t) => t.assignees))];
          ms.resolvePeople(r.source, ids).then((m) => setPeople(new Map(m)), () => {});
        }
      } catch (e) {
        if (e instanceof ConsentRequired) setConsent(r.source);
        else notify(tl("Plan konnte nicht geladen werden"), errorMessage(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    void (async () => {
      setTimeout(splashDone, 50);
      const list = await refreshLocal();
      const accs = (await microsoftAccounts()).filter((a) => !a.personal);
      setAccounts(accs);
      accs.forEach((a) => void loadMsPlans(a.key));
      let last: PlanRef | null = null;
      try {
        last = JSON.parse(localStorage.getItem(LAST) ?? "null");
      } catch {
        last = null;
      }
      if (last && ((last.source === "local" && list.some((d) => d.id === last!.id)) || accs.some((a) => a.key === last!.source))) await openPlan(last);
      else await openPlan({ source: "local", id: list[0].id, name: list[0].name });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void setWindowTitle(ref ? `${plan?.name ?? ref.name} – ${tl("Ondura Planer")}` : tl("Ondura Planer"));
  }, [ref, plan?.name]);

  // --------------------------------------------------------- changing --

  /** Local plans: write after a short pause. */
  const persist = useCallback(
    (p: Plan) => {
      if (!ref || ref.source !== "local") return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void storeWrite("planner", p.id, p).then(
          () => setLocalList((l) => l.map((d) => (d.id === p.id ? { ...d, name: p.name, modified: Date.now() } : d))),
          (e) => notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error"),
        );
      }, 300);
    },
    [ref, notify],
  );

  const setAndPersist = useCallback(
    (fn: (p: Plan) => Plan) => {
      const cur = planRef.current;
      if (!cur) return;
      const next = fn(cur);
      planRef.current = next;
      setPlan(next);
      persist(next);
    },
    [persist],
  );

  const replaceTask = (t: Task) => setAndPersist((p) => ({ ...p, tasks: p.tasks.map((x) => (x.id === t.id ? t : x)) }));

  /** Applies a change to a task (optimistic; Microsoft: written to Planner, reverted on error). */
  const changeTask = useCallback(
    async (before: Task, after: Task) => {
      const done = after.progress === 100 && before.progress !== 100;
      const fixed: Task = { ...after, completed: done ? new Date().toISOString() : after.progress === 100 ? after.completed : null };
      replaceTask(fixed);
      if (!isMs || !ref) return;
      try {
        replaceTask(await ms.updateTask(ref.source, before, fixed));
      } catch (e) {
        replaceTask(before);
        notify(tl("Änderung nicht gespeichert"), errorMessage(e), "error");
        // The task may have been changed elsewhere: reload it.
        if (String(e).includes("412")) void openPlan(ref);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMs, ref, notify, openPlan],
  );

  const addTask = async (bucketId: string, title: string, extra: Partial<Task> = {}) => {
    if (!plan || !title.trim()) return;
    const first = plan.tasks.filter((t) => t.bucketId === bucketId).sort(byOrder)[0];
    const t: Task = { ...newTask(bucketId, title.trim(), orderBetween(undefined, first?.order)), ...extra };
    if (!isMs) return setAndPersist((p) => ({ ...p, tasks: [...p.tasks, t] }));
    try {
      const created = await ms.createTask(ref!.source, plan.id, t);
      setAndPersist((p) => ({ ...p, tasks: [...p.tasks, created] }));
    } catch (e) {
      notify(tl("Aufgabe konnte nicht erstellt werden"), errorMessage(e), "error");
    }
  };

  const deleteTask = async (t: Task) => {
    setOpenTask(null);
    setAndPersist((p) => ({ ...p, tasks: p.tasks.filter((x) => x.id !== t.id) }));
    if (!isMs) return;
    try {
      await ms.deleteTask(ref!.source, t);
    } catch (e) {
      setAndPersist((p) => ({ ...p, tasks: [...p.tasks, t] }));
      notify(tl("Löschen fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const addBucket = async () => {
    const name = prompt(tl("Name des Buckets"), tl("Neuer Bucket"));
    if (!name?.trim() || !plan) return;
    const last = [...plan.buckets].sort(byOrder).at(-1);
    if (!isMs) return setAndPersist((p) => ({ ...p, buckets: [...p.buckets, { id: newId("b"), name: name.trim(), order: orderBetween(last?.order, undefined) }] }));
    try {
      const b = await ms.createBucket(ref!.source, plan.id, name.trim());
      setAndPersist((p) => ({ ...p, buckets: [...p.buckets, b] }));
    } catch (e) {
      notify(tl("Bucket konnte nicht erstellt werden"), errorMessage(e), "error");
    }
  };

  const renameBucket = async (b: Bucket) => {
    const name = prompt(tl("Bucket umbenennen"), b.name);
    if (!name?.trim() || name === b.name) return;
    if (!isMs) return setAndPersist((p) => ({ ...p, buckets: p.buckets.map((x) => (x.id === b.id ? { ...x, name: name.trim() } : x)) }));
    try {
      const nb = await ms.renameBucket(ref!.source, b, name.trim());
      setAndPersist((p) => ({ ...p, buckets: p.buckets.map((x) => (x.id === b.id ? nb : x)) }));
    } catch (e) {
      notify(tl("Umbenennen fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const deleteBucket = async (b: Bucket) => {
    const n = plan?.tasks.filter((t) => t.bucketId === b.id).length ?? 0;
    if (!confirm(n ? tl("Bucket „{0}“ mit {1} Aufgaben löschen?", b.name, n) : tl("Bucket „{0}“ löschen?", b.name))) return;
    if (isMs) {
      try {
        await ms.deleteBucket(ref!.source, b);
      } catch (e) {
        return notify(tl("Löschen fehlgeschlagen"), errorMessage(e), "error");
      }
    }
    setAndPersist((p) => ({ ...p, buckets: p.buckets.filter((x) => x.id !== b.id), tasks: p.tasks.filter((t) => t.bucketId !== b.id) }));
  };

  const setLabelNames = async (labels: Record<string, string>) => {
    if (!plan) return;
    if (!isMs) return setAndPersist((p) => ({ ...p, labels }));
    try {
      const etag = await ms.setLabels(ref!.source, plan, labels);
      setAndPersist((p) => ({ ...p, labels, detailsEtag: etag }));
    } catch (e) {
      notify(tl("Bezeichnungen nicht gespeichert"), errorMessage(e), "error");
    }
  };

  const newPlan = async (source: string) => {
    if (source === "local") {
      const name = prompt(tl("Name des Plans"), tl("Neuer Plan"));
      if (!name?.trim()) return;
      const p = emptyPlan(name.trim());
      await storeWrite("planner", p.id, p);
      await refreshLocal();
      await openPlan({ source: "local", id: p.id, name: p.name });
      return;
    }
    // Planner plans belong to a Microsoft 365 group: offer the groups of existing plans.
    const plans = msPlans[source];
    const groups = Array.isArray(plans) ? [...new Map(plans.filter((p) => p.groupId).map((p) => [p.groupId!, p.name])).entries()] : [];
    if (!groups.length) return notify(tl("Keine Gruppe gefunden"), tl("Pläne in Microsoft Planner gehören zu einer Microsoft-365-Gruppe. Legen Sie den ersten Plan in Teams oder Planner an."), "info");
    const name = prompt(tl("Name des Plans"), tl("Neuer Plan"));
    if (!name?.trim()) return;
    try {
      const created = await ms.createPlan(source, ref?.groupId && groups.some(([g]) => g === ref.groupId) ? ref.groupId : groups[0][0], name.trim());
      await loadMsPlans(source);
      await openPlan({ source, id: created.id, name: created.name, groupId: created.groupId });
    } catch (e) {
      notify(tl("Plan konnte nicht erstellt werden"), errorMessage(e), "error");
    }
  };

  const renamePlan = () => {
    if (!plan || isMs) return;
    const name = prompt(tl("Plan umbenennen"), plan.name);
    if (name?.trim()) setAndPersist((p) => ({ ...p, name: name.trim() }));
  };

  const deletePlan = async () => {
    if (!ref || isMs || !plan) return;
    if (!confirm(tl("Plan „{0}“ von diesem Computer löschen?", plan.name))) return;
    await storeDelete("planner", ref.id);
    const list = await refreshLocal();
    await openPlan({ source: "local", id: list[0].id, name: list[0].name });
  };

  const grant = async (account: string) => {
    try {
      await grantAccess(account, "planner");
      setConsent(null);
      await loadMsPlans(account);
      if (ref?.source === account) await openPlan(ref);
    } catch (e) {
      notify(tl("Zugriff nicht erteilt"), errorMessage(e), "error");
    }
  };

  // -------------------------------------------------------- filtering --

  const nameOf = useCallback((id: string) => (isMs ? (people.get(id)?.name ?? "…") : id), [isMs, people]);

  const tasks = useMemo(() => {
    if (!plan) return [];
    const q = filter.trim().toLowerCase();
    return plan.tasks.filter((t) => !q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.assignees.some((a) => nameOf(a).toLowerCase().includes(q)) || t.labels.some((l) => (plan.labels[l] ?? "").toLowerCase().includes(q)));
  }, [plan, filter, nameOf]);

  /** Columns of the board for the grouping. */
  const columns = useMemo((): { id: string; name: string; tasks: Task[]; bucket?: Bucket; color?: string }[] => {
    if (!plan) return [];
    const sorted = [...tasks].sort(byOrder);
    switch (groupBy) {
      case "bucket":
        return [...plan.buckets].sort(byOrder).map((b) => ({ id: b.id, name: b.name, bucket: b, tasks: sorted.filter((t) => t.bucketId === b.id) }));
      case "progress":
        return PROGRESS.map((p) => ({ id: `p${p.value}`, name: p.label(), tasks: sorted.filter((t) => t.progress === p.value) }));
      case "priority":
        return PRIORITIES.map((p) => ({ id: `r${p.value}`, name: p.label(), color: p.color, tasks: sorted.filter((t) => t.priority === p.value) }));
      case "label": {
        const used = Object.keys(LABEL_COLORS).filter((l) => plan.labels[l] || tasks.some((t) => t.labels.includes(l)));
        return [
          ...used.map((l) => ({ id: `l:${l}`, name: plan.labels[l] || tl("Bezeichnung"), color: LABEL_COLORS[l], tasks: sorted.filter((t) => t.labels.includes(l)) })),
          { id: "l:", name: tl("Ohne Bezeichnung"), tasks: sorted.filter((t) => !t.labels.length) },
        ];
      }
      case "assignee": {
        const all = [...new Set(tasks.flatMap((t) => t.assignees))];
        return [...all.map((a) => ({ id: `a:${a}`, name: nameOf(a), tasks: sorted.filter((t) => t.assignees.includes(a)) })), { id: "a:", name: tl("Nicht zugewiesen"), tasks: sorted.filter((t) => !t.assignees.length) }];
      }
      case "due": {
        const t0 = today();
        const week = new Date();
        week.setDate(week.getDate() + 7);
        const w = week.toISOString().slice(0, 10);
        const open = sorted.filter((t) => t.progress !== 100);
        return [
          { id: "d:late", name: tl("Verspätet"), color: "#c50f1f", tasks: open.filter((t) => t.due && t.due < t0) },
          { id: "d:today", name: tl("Heute"), tasks: open.filter((t) => t.due === t0) },
          { id: "d:week", name: tl("Nächste 7 Tage"), tasks: open.filter((t) => t.due && t.due > t0 && t.due <= w) },
          { id: "d:later", name: tl("Später"), tasks: open.filter((t) => t.due && t.due > w) },
          { id: "d:none", name: tl("Kein Datum"), tasks: open.filter((t) => !t.due) },
          { id: "d:done", name: tl("Erledigt"), tasks: sorted.filter((t) => t.progress === 100) },
        ];
      }
    }
  }, [plan, tasks, groupBy, nameOf]);

  /** Dropping a card on a column (and before a card of it). */
  const drop = (colId: string, beforeId: string | null) => {
    const t = plan?.tasks.find((x) => x.id === dragId);
    setDragId(null);
    setDropCol(null);
    if (!t || !plan) return;
    let next: Task = { ...t };
    if (groupBy === "bucket") {
      const list = plan.tasks.filter((x) => x.bucketId === colId && x.id !== t.id).sort(byOrder);
      const i = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length;
      const prev = list[i - 1];
      const nextT = list[i];
      next = { ...next, bucketId: colId, order: isMs ? ms.hintBetween(prev?.order, nextT?.order) : orderBetween(prev?.order, nextT?.order) };
    } else if (groupBy === "progress") next.progress = Number(colId.slice(1)) as Progress;
    else if (groupBy === "priority") next.priority = Number(colId.slice(1)) as Task["priority"];
    else if (groupBy === "label" && colId.startsWith("l:")) next.labels = colId === "l:" ? [] : [...new Set([...t.labels, colId.slice(2)])];
    else return;
    if (JSON.stringify(next) !== JSON.stringify(t)) void changeTask(t, next);
  };

  const canDrop = groupBy === "bucket" || groupBy === "progress" || groupBy === "priority" || groupBy === "label";

  // --------------------------------------------------------------- UI --

  const personBadges = (ids: string[]) => (
    <div className={s.people}>
      {ids.slice(0, 3).map((id) => (
        <Tooltip key={id} content={nameOf(id)} relationship="label">
          <Avatar size={24} name={nameOf(id)} color="colorful" idForColor={id} style={{ backgroundColor: personColor(nameOf(id)) }} />
        </Tooltip>
      ))}
      {ids.length > 3 && <Avatar size={24} name={`+${ids.length - 3}`} initials={`+${ids.length - 3}`} />}
    </div>
  );

  const labelChips = (t: Task) =>
    t.labels.length > 0 && (
      <div className={s.labels}>
        {t.labels.map((l) => (
          <span key={l} className={s.label} style={{ backgroundColor: LABEL_COLORS[l] }}>
            {plan?.labels[l] || " "}
          </span>
        ))}
      </div>
    );

  const card = (t: Task, colId: string) => {
    const total = t.detailsLoaded ? t.checklist.length : (t.checklistCount ?? 0);
    const done = t.detailsLoaded ? t.checklist.filter((c) => c.done).length : (t.checklistDone ?? 0);
    const pr = PRIORITIES.find((p) => p.value === t.priority)!;
    return (
      <div
        key={t.id}
        className={mergeClasses(s.card, t.progress === 100 && s.cardDone)}
        draggable={canDrop}
        onDragStart={(e) => {
          setDragId(t.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => (setDragId(null), setDropCol(null))}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          e.stopPropagation();
          setDropCol(colId);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          drop(colId, t.id);
        }}
        onClick={() => setOpenTask(t.id)}
        onContextMenu={(e) =>
          openContextMenu(e, [
            { label: tl("Öffnen"), onClick: () => setOpenTask(t.id) },
            { label: t.progress === 100 ? tl("Als nicht erledigt markieren") : tl("Als erledigt markieren"), onClick: () => void changeTask(t, { ...t, progress: t.progress === 100 ? 0 : 100 }) },
            { label: tl("Fortschritt"), items: PROGRESS.map((p) => ({ label: p.label(), onClick: () => void changeTask(t, { ...t, progress: p.value }) })) },
            { label: tl("Priorität"), items: PRIORITIES.map((p) => ({ label: p.label(), onClick: () => void changeTask(t, { ...t, priority: p.value }) })) },
            "divider",
            { label: tl("Löschen"), icon: <Delete20Regular />, onClick: () => confirm(tl("Aufgabe „{0}“ löschen?", t.title)) && void deleteTask(t) },
          ])
        }
      >
        {labelChips(t)}
        <div className={s.cardTitle}>
          <ProgressIcon
            value={t.progress}
            onClick={(e) => {
              e.stopPropagation();
              void changeTask(t, { ...t, progress: t.progress === 100 ? 0 : 100 });
            }}
          />
          <Text style={{ textDecoration: t.progress === 100 ? "line-through" : undefined }}>{t.title}</Text>
        </div>
        {t.checklistOnCard && t.detailsLoaded && t.checklist.length > 0 && (
          <div className={s.checklist}>
            {t.checklist.slice(0, 5).map((c) => (
              <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={c.done} onChange={() => void changeTask(t, { ...t, checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                <span style={{ textDecoration: c.done ? "line-through" : undefined }}>{c.title}</span>
              </label>
            ))}
          </div>
        )}
        <div className={s.meta}>
          {t.priority !== 5 && (
            <span style={{ color: pr.color, fontWeight: 600 }} title={tl("Priorität")}>
              {t.priority === 1 ? "‼" : t.priority === 3 ? "!" : "↓"} {pr.label()}
            </span>
          )}
          {t.due && (
            <span className={isLate(t) ? s.late : undefined}>
              <CalendarLtr20Regular style={{ verticalAlign: "-5px", width: 16 }} /> {fmtDay(t.due)}
            </span>
          )}
          {total > 0 && (
            <span>
              <TaskListSquareLtr20Regular style={{ verticalAlign: "-5px", width: 16 }} /> {done}/{total}
            </span>
          )}
          {t.assignees.length > 0 && personBadges(t.assignees)}
        </div>
      </div>
    );
  };

  const boardView = (
    <div className={s.board}>
      {columns.map((col) => (
        <div
          key={col.id}
          className={mergeClasses(s.column, dropCol === col.id && !!dragId && s.dropZone)}
          onDragOver={(e) => {
            if (!dragId || !canDrop) return;
            e.preventDefault();
            setDropCol(col.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(col.id, null);
          }}
        >
          <div className={s.columnHead}>
            {col.color && <span style={{ width: 10, height: 10, borderRadius: 5, background: col.color }} />}
            <span className={s.ellipsis} style={{ flex: 1 }}>
              {col.name}
            </span>
            <Text size={200} className={s.muted}>
              {col.tasks.length}
            </Text>
            {col.bucket && (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button size="small" appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label={tl("Weitere Optionen")} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<Rename20Regular />} onClick={() => void renameBucket(col.bucket!)}>
                      {tl("Umbenennen")}
                    </MenuItem>
                    <MenuItem icon={<Delete20Regular />} onClick={() => void deleteBucket(col.bucket!)}>
                      {tl("Löschen")}
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}
          </div>
          {groupBy === "bucket" &&
            (adding === col.id ? (
              <Input
                autoFocus
                className={s.addInput}
                placeholder={tl("Aufgabenname eingeben")}
                value={newTitle}
                onChange={(_, d) => setNewTitle(d.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTitle.trim()) {
                    void addTask(col.id, newTitle);
                    setNewTitle("");
                  } else if (e.key === "Escape") setAdding(null);
                }}
                onBlur={() => {
                  if (newTitle.trim()) void addTask(col.id, newTitle);
                  setNewTitle("");
                  setAdding(null);
                }}
              />
            ) : (
              <Button className={s.addInput} appearance="secondary" icon={<Add20Regular />} onClick={() => setAdding(col.id)}>
                {tl("Aufgabe hinzufügen")}
              </Button>
            ))}
          <div className={s.cards}>{col.tasks.map((t) => card(t, col.id))}</div>
        </div>
      ))}
      {groupBy === "bucket" && (
        <Button appearance="subtle" icon={<Add20Regular />} onClick={() => void addBucket()} style={{ flexShrink: 0 }}>
          {tl("Neuen Bucket hinzufügen")}
        </Button>
      )}
    </div>
  );

  const gridRows = useMemo(() => {
    const val = (t: Task): string | number => {
      switch (sort.key) {
        case "title":
          return t.title.toLowerCase();
        case "bucket":
          return plan?.buckets.find((b) => b.id === t.bucketId)?.name ?? "";
        case "progress":
          return t.progress;
        case "priority":
          return t.priority;
        case "assigned":
          return t.assignees.map(nameOf).join(", ");
        default:
          return t.due ?? "9999";
      }
    };
    return [...tasks].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [tasks, sort, plan, nameOf]);

  const th = (key: string, label: string) => (
    <th onClick={() => setSort((x) => ({ key, asc: x.key === key ? !x.asc : true }))}>
      {label}
      {sort.key === key ? (sort.asc ? " ▲" : " ▼") : ""}
    </th>
  );

  const gridView = (
    <div className={s.grid}>
      <table className={s.table}>
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            {th("title", tl("Aufgabenname"))}
            {th("assigned", tl("Zugewiesen zu"))}
            {th("bucket", tl("Bucket"))}
            {th("progress", tl("Fortschritt"))}
            {th("priority", tl("Priorität"))}
            {th("due", tl("Fälligkeitsdatum"))}
            <th>{tl("Bezeichnungen")}</th>
          </tr>
        </thead>
        <tbody>
          {gridRows.map((t) => (
            <tr key={t.id} onClick={() => setOpenTask(t.id)}>
              <td onClick={(e) => e.stopPropagation()}>
                <ProgressIcon value={t.progress} onClick={() => void changeTask(t, { ...t, progress: t.progress === 100 ? 0 : 100 })} />
              </td>
              <td style={{ textDecoration: t.progress === 100 ? "line-through" : undefined }}>{t.title}</td>
              <td>{t.assignees.map(nameOf).join(", ")}</td>
              <td>{plan?.buckets.find((b) => b.id === t.bucketId)?.name}</td>
              <td>{PROGRESS.find((p) => p.value === t.progress)?.label()}</td>
              <td style={{ color: PRIORITIES.find((p) => p.value === t.priority)?.color }}>{PRIORITIES.find((p) => p.value === t.priority)?.label()}</td>
              <td className={isLate(t) ? s.late : undefined}>{t.due ? new Date(`${t.due}T12:00:00`).toLocaleDateString(LOCALE) : ""}</td>
              <td>{labelChips(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!gridRows.length && (
        <Text block className={s.muted} style={{ padding: 24, textAlign: "center" }}>
          {tl("Keine Aufgaben.")}
        </Text>
      )}
    </div>
  );

  const month = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const scheduleView = (() => {
    const first = new Date(month);
    // Weeks start on Monday.
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const t0 = today();
    const unscheduled = tasks.filter((t) => !t.due && t.progress !== 100);
    return (
      <div className={s.cal}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
          <Button appearance="subtle" icon={<ChevronLeft20Regular />} onClick={() => setMonthOffset((m) => m - 1)} aria-label={tl("Vorheriger Monat")} />
          <Button appearance="subtle" icon={<ChevronRight20Regular />} onClick={() => setMonthOffset((m) => m + 1)} aria-label={tl("Nächster Monat")} />
          <Button appearance="secondary" size="small" onClick={() => setMonthOffset(0)}>
            {tl("Heute")}
          </Button>
          <Text weight="semibold" size={400}>
            {month.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })}
          </Text>
          <div style={{ flex: 1 }} />
          {unscheduled.length > 0 && (
            <Text size={200} className={s.muted}>
              {unscheduled.length === 1 ? tl("1 Aufgabe ohne Fälligkeitsdatum") : tl("{0} Aufgaben ohne Fälligkeitsdatum", unscheduled.length)}
            </Text>
          )}
        </div>
        <div className={s.calHead}>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ paddingLeft: 6 }}>
              {days[i].toLocaleDateString(LOCALE, { weekday: "short" })}
            </span>
          ))}
        </div>
        <div className={s.calGrid}>
          {days.map((d) => {
            const k = key(d);
            const list = tasks.filter((t) => t.due === k);
            return (
              <div key={k} className={mergeClasses(s.calDay, d.getMonth() !== month.getMonth() && s.calOther, k === t0 && s.calToday)}>
                <span style={{ fontSize: 12, alignSelf: "flex-start" }}>{d.getDate()}</span>
                {list.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    className={s.calTask}
                    style={{ backgroundColor: t.progress === 100 ? "#8a8886" : isLate(t) ? "#c50f1f" : t.labels[0] ? LABEL_COLORS[t.labels[0]] : COLOR, textDecoration: t.progress === 100 ? "line-through" : undefined }}
                    onClick={() => setOpenTask(t.id)}
                    title={t.title}
                  >
                    {t.title}
                  </button>
                ))}
                {list.length > 4 && (
                  <Text size={100} className={s.muted}>
                    {tl("+{0} weitere", list.length - 4)}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  })();

  const planIcon = (name: string, color = COLOR) => (
    <span className={s.planIcon} style={{ backgroundColor: color }}>
      {name.trim().slice(0, 2).toUpperCase() || "P"}
    </span>
  );

  const rail = (
    <div className={s.rail}>
      <div className={s.railHead}>
        <span>{tl("Auf diesem Computer")}</span>
        <Tooltip content={tl("Neuer Plan")} relationship="label">
          <Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={() => void newPlan("local")} />
        </Tooltip>
      </div>
      <div style={{ padding: "0 6px" }}>
        {localList.map((d) => (
          <button
            key={d.id}
            className={mergeClasses(s.planItem, ref?.source === "local" && ref.id === d.id && s.planOn)}
            onClick={() => void openPlan({ source: "local", id: d.id, name: d.name })}
            onContextMenu={(e) => ref?.id === d.id && openContextMenu(e, [{ label: tl("Umbenennen"), onClick: renamePlan }, { label: tl("Plan löschen"), icon: <Delete20Regular />, onClick: () => void deletePlan(), disabled: localList.length < 2 }])}
          >
            {planIcon(d.name)}
            <span className={s.ellipsis}>{d.name}</span>
            <Desktop20Regular style={{ marginLeft: "auto", color: tokens.colorNeutralForeground4, flexShrink: 0 }} />
          </button>
        ))}
      </div>
      <div className={s.railList}>
        {accounts.map((a) => {
          const list = msPlans[a.key];
          return (
            <div key={a.key}>
              <div className={s.railHead}>
                <span className={s.ellipsis} title={a.email}>
                  {tl("Planner – {0}", a.email)}
                </span>
                <Tooltip content={tl("Neu laden")} relationship="label">
                  <Button size="small" appearance="subtle" icon={<ArrowClockwise20Regular />} onClick={() => void loadMsPlans(a.key)} />
                </Tooltip>
              </div>
              {list === "loading" || list === undefined ? (
                <Spinner size="extra-tiny" style={{ padding: 8 }} />
              ) : list === "consent" ? (
                <Button appearance="subtle" icon={<CloudArrowUp20Regular />} onClick={() => void grant(a.key)} style={{ margin: "2px 6px" }}>
                  {tl("Zugriff auf Planner erlauben")}
                </Button>
              ) : !Array.isArray(list) ? (
                <Text size={200} className={s.muted} block style={{ padding: "4px 12px" }}>
                  {list.error}
                </Text>
              ) : (
                <>
                  {list.map((p) => (
                    <button key={p.id} className={mergeClasses(s.planItem, ref?.source === a.key && ref.id === p.id && s.planOn)} onClick={() => void openPlan({ source: a.key, id: p.id, name: p.name, groupId: p.groupId })}>
                      {planIcon(p.name, "#4f52b2")}
                      <span className={s.ellipsis}>{p.name}</span>
                    </button>
                  ))}
                  {list.length === 0 && (
                    <Text size={200} className={s.muted} block style={{ padding: "4px 12px" }}>
                      {tl("Keine Pläne gefunden.")}
                    </Text>
                  )}
                  <Button appearance="subtle" size="small" icon={<Add20Regular />} onClick={() => void newPlan(a.key)} style={{ margin: "2px 6px" }}>
                    {tl("Neuer Plan in Planner")}
                  </Button>
                </>
              )}
            </div>
          );
        })}
        {isTauri && accounts.length === 0 && (
          <Text size={200} className={s.muted} block style={{ padding: "12px" }}>
            {tl("Microsoft Planner: Melden Sie ein Geschäfts- oder Schulkonto in Ondura Mail oder unter Datei › Konto an.")}
          </Text>
        )}
      </div>
    </div>
  );

  const groupLabels: Record<GroupBy, string> = {
    bucket: tl("Bucket"),
    progress: tl("Fortschritt"),
    priority: tl("Priorität"),
    due: tl("Fälligkeitsdatum"),
    assignee: tl("Zugewiesen zu"),
    label: tl("Bezeichnungen"),
  };

  const task = plan?.tasks.find((t) => t.id === openTask) ?? null;

  let body: ReactNode;
  if (consent)
    body = (
      <MessageBar intent="warning" className={s.bar}>
        <MessageBarBody>{tl("Für Microsoft Planner braucht Ondura Ihre Zustimmung ({0}).", accounts.find((a) => a.key === consent)?.email ?? "")}</MessageBarBody>
        <MessageBarActions>
          <Button appearance="primary" size="small" onClick={() => void grant(consent)}>
            {tl("Zugriff erlauben")}
          </Button>
        </MessageBarActions>
      </MessageBar>
    );
  else if (loading || !plan)
    body = (
      <div className={s.empty}>
        <Spinner label={tl("Plan wird geladen …")} />
      </div>
    );
  else body = view === "board" ? boardView : view === "grid" ? gridView : view === "schedule" ? scheduleView : <PlannerCharts plan={plan} tasks={tasks} nameOf={nameOf} />;

  return (
    <div className={s.root}>
      <SuiteHeader appName={tlc("app", "Planer")} logo="/planner.svg" center={plan ? `${plan.name}${isMs ? " – Microsoft Planner" : ""}` : undefined} />
      <div className={s.main}>
        {rail}
        <div className={s.content}>
          <div className={s.top}>
            {plan && planIcon(plan.name, isMs ? "#4f52b2" : COLOR)}
            <span className={s.planTitle} onDoubleClick={renamePlan} title={isMs ? undefined : tl("Doppelklick zum Umbenennen")}>
              {plan?.name ?? ref?.name ?? ""}
            </span>
            <TabList selectedValue={view} onTabSelect={(_, d) => setView(d.value as View)} size="small">
              <Tab value="board" icon={<Board20Regular />}>
                {tl("Board")}
              </Tab>
              <Tab value="grid" icon={<Grid20Regular />}>
                {tl("Raster")}
              </Tab>
              <Tab value="schedule" icon={<CalendarLtr20Regular />}>
                {tl("Zeitplan")}
              </Tab>
              <Tab value="charts" icon={<ChartMultiple20Regular />}>
                {tl("Diagramme")}
              </Tab>
            </TabList>
          </div>
          <div className={s.tools}>
            <SearchBox size="small" placeholder={tl("Aufgaben filtern")} value={filter} onChange={(_, d) => setFilter(d.value)} style={{ width: 240 }} />
            {view === "board" && (
              <>
                <Text size={200} className={s.muted}>
                  {tl("Gruppieren nach")}
                </Text>
                <Dropdown size="small" value={groupLabels[groupBy]} selectedOptions={[groupBy]} onOptionSelect={(_, d) => setGroupBy(d.optionValue as GroupBy)} style={{ minWidth: 160 }}>
                  {(Object.keys(groupLabels) as GroupBy[]).map((g) => (
                    <Option key={g} value={g}>
                      {groupLabels[g]}
                    </Option>
                  ))}
                </Dropdown>
              </>
            )}
            <div style={{ flex: 1 }} />
            {plan && (
              <Text size={200} className={s.muted}>
                {tl("{0} offen · {1} erledigt", plan.tasks.filter((t) => t.progress !== 100).length, plan.tasks.filter((t) => t.progress === 100).length)}
              </Text>
            )}
            {plan && (
              <Button size="small" appearance="primary" icon={<Add20Regular />} onClick={() => (view !== "board" || groupBy !== "bucket" ? (setView("board"), setGroupBy("bucket")) : null, setAdding([...plan.buckets].sort(byOrder)[0]?.id ?? null))}>
                {tl("Aufgabe hinzufügen")}
              </Button>
            )}
          </div>
          {body}
        </div>
      </div>
      {plan && task && (
        <TaskDialog
          key={task.id}
          plan={plan}
          task={task}
          account={isMs ? ref!.source : null}
          nameOf={nameOf}
          onPeople={(m) => setPeople(new Map(m))}
          onClose={() => setOpenTask(null)}
          onChange={(after) => void changeTask(task, after)}
          onDetails={(t) => replaceTask(t)}
          onDelete={() => void deleteTask(task)}
          onLabelNames={(labels) => void setLabelNames(labels)}
          onMembers={(members) => setAndPersist((p) => ({ ...p, members }))}
        />
      )}
    </div>
  );
}
