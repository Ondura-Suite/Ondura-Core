// Plans of Ondura Planer: the same model for plans on this computer and
// Microsoft Planner (msplanner.ts maps Graph's resources onto it).

import { newId } from "../../lib/graphApps";
import { tl } from "../../lib/i18n";

export type Progress = 0 | 50 | 100;
/** Planner's priorities: 1 urgent, 3 important, 5 medium, 9 low. */
export type Priority = 1 | 3 | 5 | 9;

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  order?: string;
}

export interface Task {
  id: string;
  title: string;
  bucketId: string;
  progress: Progress;
  priority: Priority;
  /** ISO dates (yyyy-mm-dd). */
  start?: string | null;
  due?: string | null;
  /** User ids (Microsoft) or names (local plans). */
  assignees: string[];
  /** Label ids `category1` … `category25`. */
  labels: string[];
  notes: string;
  checklist: ChecklistItem[];
  /** Checklist loaded (Microsoft: details are fetched on demand). */
  detailsLoaded?: boolean;
  /** Shows the checklist on the card. */
  checklistOnCard?: boolean;
  /** Counts for cards before the details are loaded. */
  checklistCount?: number;
  checklistDone?: number;
  created: string;
  completed?: string | null;
  order: string;
  etag?: string;
  detailsEtag?: string;
}

export interface Bucket {
  id: string;
  name: string;
  order: string;
  etag?: string;
}

export interface Plan {
  id: string;
  name: string;
  buckets: Bucket[];
  tasks: Task[];
  /** Names of the labels that are in use (`category1` → "Marketing"). */
  labels: Record<string, string>;
  /** Local plans: the people tasks can be assigned to. */
  members: string[];
  created: string;
  etag?: string;
  detailsEtag?: string;
  /** Microsoft: the group the plan belongs to. */
  groupId?: string;
}

/** Planner's 25 label colours. */
export const LABEL_COLORS: Record<string, string> = {
  category1: "#e3008c",
  category2: "#d13438",
  category3: "#ffaa44",
  category4: "#13a10e",
  category5: "#0078d4",
  category6: "#8764b8",
  category7: "#ca5010",
  category8: "#8cbd18",
  category9: "#00b7c3",
  category10: "#69797e",
  category11: "#a0aeb2",
  category12: "#8e562e",
  category13: "#c50f1f",
  category14: "#f7630c",
  category15: "#ff8c00",
  category16: "#eaa300",
  category17: "#57a300",
  category18: "#0b6a0b",
  category19: "#038387",
  category20: "#3a96dd",
  category21: "#004e8c",
  category22: "#8378de",
  category23: "#881798",
  category24: "#bebbb8",
  category25: "#3b3a39",
};
export const LABEL_IDS = Object.keys(LABEL_COLORS);

export const PRIORITIES: { value: Priority; label: () => string; color: string }[] = [
  { value: 1, label: () => tl("Dringend"), color: "#c50f1f" },
  { value: 3, label: () => tl("Wichtig"), color: "#f7630c" },
  { value: 5, label: () => tl("Mittel"), color: "#0078d4" },
  { value: 9, label: () => tl("Niedrig"), color: "#69797e" },
];

export const PROGRESS: { value: Progress; label: () => string }[] = [
  { value: 0, label: () => tl("Nicht begonnen") },
  { value: 50, label: () => tl("In Arbeit") },
  { value: 100, label: () => tl("Erledigt") },
];

export const priorityOf = (n: number): Priority => (n <= 1 ? 1 : n <= 4 ? 3 : n <= 7 ? 5 : 9);
export const progressOf = (n: number): Progress => (n >= 100 ? 100 : n > 0 ? 50 : 0);

/** Local date (yyyy-mm-dd) of today. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const isLate = (t: Task) => t.progress !== 100 && !!t.due && t.due < today();

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A sort key between `a` and `b` (fractional indexing; `undefined` = open end). */
export function orderBetween(a: string | undefined, b: string | undefined): string {
  a = a ?? "";
  let hi = b ?? "";
  let out = "";
  for (let i = 0; i < 64; i++) {
    const ca = i < a.length ? Math.max(0, DIGITS.indexOf(a[i])) : 0;
    const cb = hi && i < hi.length ? Math.max(0, DIGITS.indexOf(hi[i])) : 36;
    if (ca === cb) {
      out += DIGITS[ca];
      continue;
    }
    const m = Math.floor((ca + cb) / 2);
    if (m > ca) return out + DIGITS[m];
    // Neighbouring digits: keep a's digit and go on with an open upper end.
    out += DIGITS[ca];
    hi = "";
  }
  return out + "i";
}

export const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

export function emptyPlan(name: string): Plan {
  const now = new Date().toISOString();
  return {
    id: newId("pl"),
    name,
    buckets: [tl("Zu erledigen"), tl("In Arbeit"), tl("Erledigt")].map((name, i) => ({ id: newId("b"), name, order: DIGITS[(i + 1) * 4] })),
    tasks: [],
    labels: {},
    members: [],
    created: now,
  };
}

export function newTask(bucketId: string, title: string, order: string): Task {
  return { id: newId("t"), title, bucketId, progress: 0, priority: 5, assignees: [], labels: [], notes: "", checklist: [], detailsLoaded: true, created: new Date().toISOString(), order };
}

/** Example plan for the first start. */
export function samplePlan(): Plan {
  const p = emptyPlan(tl("Mein erster Plan"));
  const [todo, doing, done] = p.buckets;
  const d = (days: number) => {
    const x = new Date();
    x.setDate(x.getDate() + days);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  p.members = [tl("Ich")];
  p.labels = { category5: tl("Planung"), category4: tl("Umsetzung") };
  const t = (bucket: string, title: string, extra: Partial<Task>, i: number): Task => ({ ...newTask(bucket, title, DIGITS[i * 4]), ...extra });
  p.tasks = [
    t(todo.id, tl("Ziele festlegen"), { labels: ["category5"], due: d(3), priority: 3, assignees: [tl("Ich")] }, 1),
    t(todo.id, tl("Aufgaben auf die Personen verteilen"), { labels: ["category5"], due: d(7), checklist: [{ id: newId("c"), title: tl("Team fragen"), done: false }, { id: newId("c"), title: tl("Zuständigkeiten notieren"), done: false }], checklistOnCard: true }, 2),
    t(doing.id, tl("Erste Version umsetzen"), { labels: ["category4"], progress: 50, start: d(-2), due: d(10), assignees: [tl("Ich")] }, 1),
    t(done.id, tl("Plan anlegen"), { progress: 100, completed: new Date().toISOString() }, 1),
  ];
  return p;
}
