import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowSync20Regular,
  CalendarLtr16Regular,
  CalendarLtr20Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  Delete20Regular,
  Dismiss20Regular,
  Home20Regular,
  Star20Filled,
  Star20Regular,
  TaskListLtrRegular,
} from "@fluentui/react-icons";
import { api, errorMessage } from "../../lib/api";
import { newTask, pim, type Task } from "../../lib/pim";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { AccountDialog } from "../mail/AccountDialog";
import { CollectionPane } from "../pim/CollectionPane";
import { usePimCollections, writable } from "../pim/usePim";
import { addDays, fromYmd, startOfDay, ymd } from "../calendar/dates";

const ACCENT = "#c239b3";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  panes: { flex: 1, display: "flex", minHeight: 0, minWidth: 0, padding: "8px", gap: "8px" },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusLarge, boxShadow: tokens.shadow2, overflow: "hidden", display: "flex", flexDirection: "column" },
  main: { flex: 1, minWidth: 0 },
  head: { padding: "20px 24px 8px", display: "flex", alignItems: "center", gap: "8px" },
  title: { fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightSemibold, color: ACCENT, flex: 1 },
  add: {
    margin: "8px 24px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 8px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  list: { flex: 1, overflowY: "auto", padding: "0 24px 24px" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "52px",
    padding: "2px 8px 2px 4px",
    marginBottom: "2px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  itemSel: { backgroundColor: tokens.colorNeutralBackground1Selected },
  itemText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "6px 0" },
  done: { textDecoration: "line-through", color: tokens.colorNeutralForeground3 },
  meta: { display: "flex", gap: "10px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, alignItems: "center" },
  overdue: { color: tokens.colorPaletteRedForeground1 },
  sectionBtn: { margin: "12px 0 6px" },
  smart: { padding: "4px 4px 0" },
  smartItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    minHeight: "34px",
    padding: "0 10px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  smartSel: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  count: { marginLeft: "auto", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  detail: { width: "340px", flexShrink: 0 },
  detailBody: { flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
  detailFoot: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  quick: { display: "flex", gap: "6px", flexWrap: "wrap" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "64px", color: tokens.colorNeutralForeground3 },
});

type Smart = "smart:important" | "smart:planned" | "smart:all";
const SMART: { id: Smart; name: string; icon: React.JSX.Element }[] = [
  { id: "smart:important", name: "Wichtig", icon: <Star20Regular /> },
  { id: "smart:planned", name: "Geplant", icon: <CalendarLtr20Regular /> },
  { id: "smart:all", name: "Alle", icon: <Home20Regular /> },
];
const LIST_KEY = "nexora-tasks.list";

function dueLabel(due: string): { text: string; overdue: boolean } {
  const d = fromYmd(due);
  const today = startOfDay(new Date());
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const text =
    diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  return { text: `Fällig: ${text}`, overdue: diff < 0 };
}

export function TasksApp() {
  const s = useStyles();
  const notify = useNotify();
  const { collections, accountName, reload, revision, bump, sync, syncing } = usePimCollections("tasks");
  const [listId, setListId] = useState<string>(() => {
    try {
      return localStorage.getItem(LIST_KEY) || "smart:all";
    } catch {
      return "smart:all";
    }
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState("");
  const [accountDialog, setAccountDialog] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LIST_KEY, listId);
    } catch {
      /* ignore */
    }
  }, [listId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await pim.tasks(null));
    } catch (e) {
      notify("Aufgaben konnten nicht geladen werden", errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  // Fall back to "Alle" when the selected list disappeared (account removed).
  useEffect(() => {
    if (!listId.startsWith("smart:") && collections.length && !collections.some((c) => c.id === listId)) setListId("smart:all");
  }, [collections, listId]);

  const lists = writable(collections);
  const currentList = collections.find((c) => c.id === listId);
  const smart = SMART.find((x) => x.id === listId);

  const inView = useCallback(
    (t: Task) => {
      if (query && !`${t.title}\n${t.notes}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (listId === "smart:important") return t.importance === "high";
      if (listId === "smart:planned") return !!t.due;
      if (listId === "smart:all") return true;
      return t.collectionId === listId;
    },
    [listId, query],
  );

  const visible = useMemo(() => {
    const v = tasks.filter(inView);
    const open = v
      .filter((t) => !t.completed)
      .sort((a, b) => {
        if (listId === "smart:planned") return (a.due ?? "").localeCompare(b.due ?? "");
        return Number(b.importance === "high") - Number(a.importance === "high") || b.created.localeCompare(a.created);
      });
    const done = v.filter((t) => t.completed).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return { open, done };
  }, [tasks, inView, listId]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tasks) {
      if (t.completed) continue;
      m[t.collectionId] = (m[t.collectionId] ?? 0) + 1;
      if (t.importance === "high") m["smart:important"] = (m["smart:important"] ?? 0) + 1;
      if (t.due) m["smart:planned"] = (m["smart:planned"] ?? 0) + 1;
      m["smart:all"] = (m["smart:all"] ?? 0) + 1;
    }
    return m;
  }, [tasks]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  /** Optimistic save; the list reloads from the store on success. */
  const save = async (task: Task) => {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
    try {
      await pim.saveTask(task.collectionId, task);
      bump();
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      bump();
    }
  };

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const target = currentList && !currentList.readOnly ? currentList : lists[0];
    if (!target) {
      notify("Keine beschreibbare Aufgabenliste", undefined, "warning");
      return;
    }
    const t = newTask(target.id, title);
    if (listId === "smart:important") t.importance = "high";
    if (listId === "smart:planned") t.due = ymd(new Date());
    setNewTitle("");
    try {
      await pim.saveTask(target.id, t);
      bump();
    } catch (e) {
      notify("Aufgabe konnte nicht angelegt werden", errorMessage(e), "error");
    }
  };

  const remove = async (t: Task) => {
    if (!(await api.confirm(`Aufgabe „${t.title}“ löschen?`, "Aufgabe löschen"))) return;
    setSelectedId(null);
    try {
      await pim.deleteTask(t.id);
      bump();
    } catch (e) {
      notify("Löschen fehlgeschlagen", errorMessage(e), "error");
    }
  };

  const toggle = (t: Task) => save({ ...t, completed: !t.completed, completedAt: t.completed ? null : new Date().toISOString() });
  const star = (t: Task) => save({ ...t, importance: t.importance === "high" ? "normal" : "high" });

  const listName = (id: string) => collections.find((c) => c.id === id)?.name ?? "";

  const row = (t: Task) => {
    const due = t.due ? dueLabel(t.due) : null;
    return (
      <div key={t.id} className={mergeClasses(s.item, t.id === selectedId && s.itemSel)} onClick={() => setSelectedId(t.id)}>
        <Checkbox shape="circular" checked={t.completed} onClick={(e) => e.stopPropagation()} onChange={() => toggle(t)} aria-label="Erledigt" />
        <div className={s.itemText}>
          <span className={t.completed ? s.done : undefined}>{t.title || "(Ohne Titel)"}</span>
          <span className={s.meta}>
            {(listId.startsWith("smart:") || !currentList) && <span>{listName(t.collectionId)}</span>}
            {due && !t.completed && (
              <span className={due.overdue ? s.overdue : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <CalendarLtr16Regular /> {due.text}
              </span>
            )}
            {t.notes && <span>Notiz</span>}
          </span>
        </div>
        <Button
          appearance="subtle"
          icon={t.importance === "high" ? <Star20Filled color={ACCENT} /> : <Star20Regular />}
          aria-label={t.importance === "high" ? "Wichtig entfernen" : "Als wichtig markieren"}
          onClick={(e) => {
            e.stopPropagation();
            void star(t);
          }}
        />
      </div>
    );
  };

  return (
    <div className={s.root}>
      <SuiteHeader appName="Orbit" searchPlaceholder="Aufgaben suchen" onSearch={setQuery} />
      <div className={s.body}>
        <AppRail current="tasks" />
        <div className={s.panes}>
          <CollectionPane
            top={
              <div className={s.smart}>
                {SMART.map((x) => (
                  <button key={x.id} className={mergeClasses(s.smartItem, listId === x.id && s.smartSel)} onClick={() => setListId(x.id)}>
                    {x.icon}
                    {x.name}
                    {counts[x.id] ? <span className={s.count}>{counts[x.id]}</span> : null}
                  </button>
                ))}
              </div>
            }
            collections={collections}
            accountName={accountName}
            mode="select"
            selectedId={listId}
            onSelect={setListId}
            counts={counts}
            newLabel="Neue Liste"
            onCreate={async (name) => {
              try {
                const c = await pim.createCollection("tasks", name, null);
                await reload();
                setListId(c.id);
              } catch (e) {
                notify("Liste konnte nicht erstellt werden", errorMessage(e), "error");
              }
            }}
            onDelete={async (c) => {
              if (!(await api.confirm(`Liste „${c.name}“ mit allen Aufgaben löschen?`, "Liste löschen"))) return;
              await pim.deleteCollection(c.id).catch((e) => notify("Löschen fehlgeschlagen", errorMessage(e), "error"));
              setListId("smart:all");
              await reload();
            }}
            onAddAccount={() => setAccountDialog(true)}
          />

          <main className={mergeClasses(s.card, s.main)}>
            <div className={s.head}>
              <span className={s.title}>{smart?.name ?? currentList?.name ?? "Aufgaben"}</span>
              {loading && <Spinner size="extra-tiny" />}
              <Button appearance="subtle" icon={syncing ? <Spinner size="extra-tiny" /> : <ArrowSync20Regular />} disabled={syncing} onClick={sync} aria-label="Synchronisieren" title="Synchronisieren" />
            </div>
            {!(currentList?.readOnly) && (
              <div className={s.add}>
                <Add20Regular color={ACCENT} />
                <Input
                  appearance="underline"
                  style={{ flex: 1 }}
                  value={newTitle}
                  placeholder="Aufgabe hinzufügen"
                  onChange={(_, d) => setNewTitle(d.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                />
                <Button appearance="subtle" disabled={!newTitle.trim()} onClick={add}>
                  Hinzufügen
                </Button>
              </div>
            )}
            <div className={s.list}>
              {visible.open.map(row)}
              {visible.open.length === 0 && visible.done.length === 0 && !loading && (
                <div className={s.empty}>
                  <TaskListLtrRegular style={{ fontSize: 48 }} />
                  <Text>{query ? "Keine passenden Aufgaben." : "Keine offenen Aufgaben – gut gemacht!"}</Text>
                </div>
              )}
              {visible.done.length > 0 && (
                <>
                  <Button appearance="subtle" size="small" className={s.sectionBtn} icon={showDone ? <ChevronDown16Regular /> : <ChevronRight16Regular />} onClick={() => setShowDone(!showDone)}>
                    Erledigt ({visible.done.length})
                  </Button>
                  {showDone && visible.done.map(row)}
                </>
              )}
            </div>
          </main>

          {selected && (
            <TaskDetail
              key={selected.id}
              task={selected}
              listName={listName(selected.collectionId)}
              readOnly={!!collections.find((c) => c.id === selected.collectionId)?.readOnly}
              onSave={save}
              onToggle={() => toggle(selected)}
              onStar={() => star(selected)}
              onDelete={() => remove(selected)}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>
      <AccountDialog pim open={accountDialog} onClose={() => setAccountDialog(false)} onAdded={() => void reload()} />
    </div>
  );
}

function TaskDetail({
  task,
  listName,
  readOnly,
  onSave,
  onToggle,
  onStar,
  onDelete,
  onClose,
}: {
  task: Task;
  listName: string;
  readOnly: boolean;
  onSave: (t: Task) => void;
  onToggle: () => void;
  onStar: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const commit = (patch: Partial<Task>) => onSave({ ...task, ...patch });
  const today = startOfDay(new Date());
  const nextMonday = addDays(today, ((8 - today.getDay()) % 7) || 7);

  return (
    <aside className={mergeClasses(s.card, s.detail)}>
      <div className={s.detailBody}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Checkbox shape="circular" checked={task.completed} onChange={onToggle} disabled={readOnly} />
          <Input
            appearance="underline"
            style={{ flex: 1, fontWeight: 600 }}
            value={title}
            disabled={readOnly}
            onChange={(_, d) => setTitle(d.value)}
            onBlur={() => title.trim() && title !== task.title && commit({ title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <Button appearance="subtle" disabled={readOnly} icon={task.importance === "high" ? <Star20Filled color={ACCENT} /> : <Star20Regular />} onClick={onStar} aria-label="Wichtig" />
        </div>
        <Field label="Fälligkeitsdatum">
          <Input type="date" value={task.due ?? ""} disabled={readOnly} onChange={(_, d) => commit({ due: d.value || null })} />
        </Field>
        {!readOnly && (
          <div className={s.quick}>
            <Button size="small" onClick={() => commit({ due: ymd(today) })}>
              Heute
            </Button>
            <Button size="small" onClick={() => commit({ due: ymd(addDays(today, 1)) })}>
              Morgen
            </Button>
            <Button size="small" onClick={() => commit({ due: ymd(nextMonday) })}>
              Nächste Woche
            </Button>
            {task.due && (
              <Button size="small" appearance="subtle" icon={<Dismiss20Regular />} onClick={() => commit({ due: null })}>
                Entfernen
              </Button>
            )}
          </div>
        )}
        <Field label="Notiz">
          <Textarea value={notes} disabled={readOnly} rows={8} resize="vertical" onChange={(_, d) => setNotes(d.value)} onBlur={() => notes !== task.notes && commit({ notes })} />
        </Field>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Liste: {listName}
        </Text>
      </div>
      <div className={s.detailFoot}>
        <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={onClose} aria-label="Schließen" />
        <span>
          {task.completed && task.completedAt
            ? `Erledigt am ${new Date(task.completedAt).toLocaleDateString("de-DE")}`
            : `Erstellt am ${new Date(task.created).toLocaleDateString("de-DE")}`}
        </span>
        <Button appearance="subtle" disabled={readOnly} icon={<Delete20Regular />} onClick={onDelete} aria-label="Löschen" />
      </div>
    </aside>
  );
}
