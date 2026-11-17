import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner, Tab, TabList, Text, Toolbar, ToolbarDivider, makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowSync20Regular,
  CalendarAdd20Regular,
  CalendarToday20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import { errorMessage, api } from "../../lib/api";
import { COLLECTION_COLORS, pim, type CalEvent, type EditScope, type EventInput, type EventResponse } from "../../lib/pim";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { AccountDialog } from "../mail/AccountDialog";
import { CollectionPane } from "../pim/CollectionPane";
import { usePimCollections, writable } from "../pim/usePim";
import { useModuleActive } from "../../suite";
import { MiniMonth } from "./MiniMonth";
import { TimeGrid } from "./TimeGrid";
import { MonthGrid } from "./MonthGrid";
import { EventDetails } from "./EventDetails";
import { EventEditor, type EditorTarget } from "./EventEditor";
import { addDays, addMonths, fmtEventTime, fmtMonth, fromYmd, localRange, startOfDay, startOfWeek, ymd } from "./dates";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  panes: { flex: 1, display: "flex", minHeight: 0, minWidth: 0, padding: "8px", gap: "8px" },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    overflow: "hidden",
  },
  toolbar: { display: "flex", alignItems: "center", gap: "4px", padding: "6px 8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  range: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, marginLeft: "8px", whiteSpace: "nowrap" },
  spacer: { flex: 1 },
  newBtn: { margin: "8px 8px 4px" },
  results: { flex: 1, overflowY: "auto", padding: "8px 16px" },
  result: {
    display: "flex",
    gap: "12px",
    padding: "10px 8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  bar: { width: "4px", borderRadius: "2px", flexShrink: 0 },
});

type View = "day" | "workweek" | "week" | "month";
const VIEW_KEY = "nexora-calendar.view";

function loadView(): View {
  try {
    return (localStorage.getItem(VIEW_KEY) as View) || "week";
  } catch {
    return "week";
  }
}

export function CalendarApp() {
  const s = useStyles();
  const notify = useNotify();
  const active = useModuleActive("calendar");
  const { collections, setCollections, accountName, reload, revision, bump, sync, syncing } = usePimCollections("calendar");
  const [view, setView] = useState<View>(loadView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<{ event: CalEvent; el: HTMLElement } | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalEvent[] | null>(null);
  const [accountDialog, setAccountDialog] = useState(false);

  const { from, to, days } = useMemo(() => {
    if (view === "month") {
      const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      return { from: first, to: addDays(first, 42), days: [] as Date[] };
    }
    const start = view === "day" ? anchor : startOfWeek(anchor);
    const n = view === "day" ? 1 : view === "workweek" ? 5 : 7;
    const list = Array.from({ length: n }, (_, i) => addDays(start, i));
    return { from: start, to: addDays(start, n), days: list };
  }, [view, anchor]);

  const colors = useMemo(() => new Map(collections.map((c) => [c.id, c.color ?? COLLECTION_COLORS[0]])), [collections]);
  const colorOf = useCallback((e: CalEvent) => colors.get(e.collectionId) ?? COLLECTION_COLORS[0], [colors]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await pim.events(from, to));
    } catch (e) {
      notify("Termine konnten nicht geladen werden", errorMessage(e), "error");
    } finally {
      setLoading(false);
      splashDone();
    }
  }, [from, to, notify]);

  useEffect(() => {
    void load();
  }, [load, revision, collections]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  // Search across all calendars (debounced).
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      pim.searchEvents(query.trim()).then(setResults, (e) => notify("Suche fehlgeschlagen", errorMessage(e), "error"));
    }, 250);
    return () => clearTimeout(t);
  }, [query, notify, revision]);

  // Keyboard: t = today, arrows = navigate, n = new.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (!active || editor || el.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      if (e.key === "t") setAnchor(startOfDay(new Date()));
      else if (e.key === "ArrowLeft" && e.altKey) step(-1);
      else if (e.key === "ArrowRight" && e.altKey) step(1);
      else if (e.key === "n") newEvent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const step = (dir: number) => {
    if (view === "month") setAnchor(addMonths(anchor, dir));
    else setAnchor(addDays(anchor, dir * (view === "day" ? 1 : 7)));
  };

  const calendars = writable(collections);

  const newEvent = (start?: Date, allDay = false) => {
    if (!calendars.length) {
      notify("Kein beschreibbarer Kalender", "Legen Sie zuerst einen Kalender an.", "warning");
      return;
    }
    const base = start ?? (() => {
      const d = new Date();
      d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
      return sameDayOr(anchor, d);
    })();
    setEditor({ mode: "new", start: base, allDay });
  };

  const canEdit = (e: CalEvent) => !collections.find((c) => c.id === e.collectionId)?.readOnly;

  /** Drag & drop: new times for an event (recurring: only this occurrence). */
  const reschedule = async (e: CalEvent, start: string, end: string) => {
    const input: EventInput = {
      title: e.title,
      location: e.location,
      body: null,
      start,
      end,
      allDay: e.allDay,
      recurrence: e.isRecurring ? null : e.recurrence,
      rrule: e.isRecurring ? null : e.rrule,
      reminderMinutes: e.reminderMinutes,
      showAs: e.showAs,
      attendees: e.attendees.map((a) => a.address),
    };
    // Show the new position at once; the store catches up after the sync.
    setEvents((list) => list.map((x) => (x.id === e.id ? { ...x, start, end } : x)));
    try {
      await pim.updateEvent(e.id, input, e.isRecurring ? "occurrence" : "series");
      bump();
    } catch (err) {
      notify("Termin konnte nicht verschoben werden", errorMessage(err), "error");
      bump();
    }
  };

  const shiftDays = (e: CalEvent, days: number) => {
    if (e.allDay) {
      const s0 = `${ymd(addDays(fromYmd(e.start), days))}T00:00:00Z`;
      const e0 = `${ymd(addDays(fromYmd(e.end), days))}T00:00:00Z`;
      return reschedule(e, s0, e0);
    }
    const { start, end } = localRange(e);
    return reschedule(e, addDays(start, days).toISOString(), addDays(end, days).toISOString());
  };

  const respond = async (e: CalEvent, response: EventResponse) => {
    setDetails(null);
    try {
      await pim.respondEvent(e.id, response);
      notify(response === "accept" ? "Zugesagt" : response === "decline" ? "Abgesagt" : "Mit Vorbehalt zugesagt", e.title, "success");
      bump();
    } catch (err) {
      notify("Antwort konnte nicht gesendet werden", errorMessage(err), "error");
    }
  };

  const remove = async (e: CalEvent, scope: EditScope) => {
    setDetails(null);
    const what = e.isRecurring && scope === "series" ? `die gesamte Serie „${e.title}“` : `„${e.title || "(Ohne Titel)"}“`;
    if (!(await api.confirm(`Möchten Sie ${what} wirklich löschen?`, "Termin löschen"))) return;
    try {
      await pim.deleteEvent(e.id, scope);
      bump();
    } catch (err) {
      notify("Löschen fehlgeschlagen", errorMessage(err), "error");
    }
  };

  const rangeLabel = (() => {
    if (view === "month") return fmtMonth(anchor);
    if (view === "day") return anchor.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const last = days[days.length - 1];
    const sameMonth = days[0].getMonth() === last.getMonth();
    return sameMonth
      ? `${days[0].getDate()}. – ${last.getDate()}. ${fmtMonth(last)}`
      : `${days[0].toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}`;
  })();

  const openEvent = (e: CalEvent, el: HTMLElement) => setDetails({ event: e, el });

  return (
    <div className={s.root}>
      <SuiteHeader appName="Orbit" searchPlaceholder="Termine suchen" onSearch={setQuery} />
      <div className={s.body}>
        <AppRail current="calendar" />
        <div className={s.panes}>
          <CollectionPane
            top={
              <>
                <Button appearance="primary" icon={<CalendarAdd20Regular />} className={s.newBtn} onClick={() => newEvent()}>
                  Neuer Termin
                </Button>
                <MiniMonth
                  selected={anchor}
                  rangeStart={from}
                  rangeEnd={to}
                  onSelect={(d) => {
                    setAnchor(d);
                    setQuery("");
                  }}
                />
              </>
            }
            collections={collections}
            accountName={accountName}
            mode="visibility"
            newLabel="Neuer Kalender"
            onToggle={async (c, visible) => {
              setCollections((cs) => cs.map((x) => (x.id === c.id ? { ...x, visible } : x)));
              await pim.setVisible(c.id, visible).catch((e) => notify("Fehler", errorMessage(e), "error"));
              bump();
            }}
            onColor={async (c, color) => {
              setCollections((cs) => cs.map((x) => (x.id === c.id ? { ...x, color } : x)));
              await pim.setColor(c.id, color).catch((e) => notify("Fehler", errorMessage(e), "error"));
            }}
            onCreate={async (name, color) => {
              try {
                await pim.createCollection("calendar", name, color);
                await reload();
              } catch (e) {
                notify("Kalender konnte nicht erstellt werden", errorMessage(e), "error");
              }
            }}
            onDelete={async (c) => {
              if (!(await api.confirm(`Kalender „${c.name}“ mit allen Terminen löschen?`, "Kalender löschen"))) return;
              try {
                await pim.deleteCollection(c.id);
                await reload();
              } catch (e) {
                notify("Löschen fehlgeschlagen", errorMessage(e), "error");
              }
            }}
            onAddAccount={() => setAccountDialog(true)}
          />
          <main className={s.main}>
            <Toolbar className={s.toolbar} size="small">
              <Button appearance="subtle" icon={<CalendarToday20Regular />} onClick={() => setAnchor(startOfDay(new Date()))}>
                Heute
              </Button>
              <Button appearance="subtle" icon={<ChevronLeft20Regular />} onClick={() => step(-1)} aria-label="Zurück" />
              <Button appearance="subtle" icon={<ChevronRight20Regular />} onClick={() => step(1)} aria-label="Weiter" />
              <span className={s.range}>{results ? `Suchergebnisse für „${query}“` : rangeLabel}</span>
              {loading && <Spinner size="extra-tiny" style={{ marginLeft: 8 }} />}
              <span className={s.spacer} />
              <TabList size="small" selectedValue={view} onTabSelect={(_, d) => (setView(d.value as View), setQuery(""))}>
                <Tab value="day">Tag</Tab>
                <Tab value="workweek">Arbeitswoche</Tab>
                <Tab value="week">Woche</Tab>
                <Tab value="month">Monat</Tab>
              </TabList>
              <ToolbarDivider />
              <Button appearance="subtle" icon={syncing ? <Spinner size="extra-tiny" /> : <ArrowSync20Regular />} onClick={sync} disabled={syncing} aria-label="Synchronisieren" title="Synchronisieren" />
            </Toolbar>
            {results ? (
              <div className={s.results}>
                {results.length === 0 && <Text>Keine Termine gefunden.</Text>}
                {results
                  .slice()
                  .sort((a, b) => b.start.localeCompare(a.start))
                  .map((e) => (
                    <div
                      key={e.id}
                      className={s.result}
                      onClick={(ev) => {
                        const target = ev.currentTarget;
                        setAnchor(startOfDay(localRange(e).start));
                        openEvent(e, target);
                      }}
                    >
                      <span className={s.bar} style={{ background: colorOf(e) }} />
                      <span>
                        <Text weight="semibold">{e.title || "(Ohne Titel)"}</Text>
                        <br />
                        <Text size={200}>
                          {fmtEventTime(e)}
                          {e.location ? ` · ${e.location}` : ""}
                        </Text>
                      </span>
                    </div>
                  ))}
              </div>
            ) : view === "month" ? (
              <MonthGrid
                month={anchor}
                events={events}
                colorOf={colorOf}
                onDay={(d) => (setAnchor(d), setView("day"))}
                onNew={(d) => newEvent(d, true)}
                onEvent={openEvent}
                canEdit={canEdit}
                onMoveDays={shiftDays}
              />
            ) : (
              <TimeGrid
                days={days}
                events={events}
                colorOf={colorOf}
                onSlot={(d) => newEvent(d)}
                onEvent={openEvent}
                onDay={(d) => (setAnchor(d), setView("day"))}
                canEdit={canEdit}
                onChange={(e, start, end) => reschedule(e, start.toISOString(), end.toISOString())}
              />
            )}
          </main>
        </div>
      </div>

      <EventDetails
        event={details?.event ?? null}
        anchor={details?.el ?? null}
        calendar={collections.find((c) => c.id === details?.event.collectionId)}
        onClose={() => setDetails(null)}
        onEdit={(e, scope) => {
          setDetails(null);
          setEditor({ mode: "edit", event: e, scope });
        }}
        onDelete={remove}
        onRespond={respond}
      />
      <EventEditor target={editor} calendars={calendars} onClose={() => setEditor(null)} onSaved={bump} />
      <AccountDialog pim open={accountDialog} onClose={() => setAccountDialog(false)} onAdded={() => void reload()} />
    </div>
  );
}

/** `time` on the day of `day` (used for "Neuer Termin" while browsing other weeks). */
function sameDayOr(day: Date, time: Date): Date {
  const d = new Date(day);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}
