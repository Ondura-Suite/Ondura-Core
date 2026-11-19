// Microsoft Planner through Graph: plans of the user's groups, buckets,
// tasks and task details. Planner needs the current ETag for every change
// (If-Match) and answers changes with 204, so the task is read again to
// get its new ETag.

import { graph, graphAll, graphRaw } from "../../lib/graphApps";
import { priorityOf, progressOf, type Bucket, type ChecklistItem, type Plan, type Task } from "./model";

const A = "planner" as const;

interface RawTask {
  id: string;
  title: string;
  bucketId: string;
  percentComplete: number;
  priority?: number;
  startDateTime?: string | null;
  dueDateTime?: string | null;
  assignments?: Record<string, unknown>;
  appliedCategories?: Record<string, boolean>;
  createdDateTime: string;
  completedDateTime?: string | null;
  orderHint: string;
  checklistItemCount?: number;
  activeChecklistItemCount?: number;
  previewType?: string;
  "@odata.etag"?: string;
}

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : null);
/** Planner stores dates as UTC midnight… of the user's day; noon keeps the day in every zone. */
const toIso = (d?: string | null) => (d ? `${d}T12:00:00Z` : null);

function taskFrom(r: RawTask): Task {
  const total = r.checklistItemCount ?? 0;
  return {
    id: r.id,
    title: r.title,
    bucketId: r.bucketId,
    progress: progressOf(r.percentComplete),
    priority: priorityOf(r.priority ?? 5),
    start: day(r.startDateTime),
    due: day(r.dueDateTime),
    assignees: Object.keys(r.assignments ?? {}),
    labels: Object.entries(r.appliedCategories ?? {})
      .filter(([, on]) => on)
      .map(([k]) => k),
    notes: "",
    checklist: [],
    checklistOnCard: r.previewType === "checklist",
    checklistCount: total,
    checklistDone: total - (r.activeChecklistItemCount ?? 0),
    created: r.createdDateTime,
    completed: r.completedDateTime,
    order: r.orderHint,
    etag: r["@odata.etag"],
  };
}

export interface PlanRef {
  id: string;
  name: string;
  groupId?: string;
}

export async function plans(account: string): Promise<PlanRef[]> {
  const raw = await graphAll<{ id: string; title: string; container?: { containerId?: string; type?: string }; owner?: string }>(account, A, "/me/planner/plans");
  return raw.map((p) => ({ id: p.id, name: p.title, groupId: p.container?.type === "group" ? p.container.containerId : p.owner })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadPlan(account: string, id: string): Promise<Plan> {
  const enc = encodeURIComponent(id);
  const [plan, details, buckets, tasks] = await Promise.all([
    graph<{ id: string; title: string; createdDateTime: string; owner?: string; container?: { containerId?: string }; "@odata.etag": string }>(account, A, "GET", `/planner/plans/${enc}`),
    graph<{ categoryDescriptions?: Record<string, string | null>; "@odata.etag": string }>(account, A, "GET", `/planner/plans/${enc}/details`),
    graphAll<{ id: string; name: string; orderHint: string; "@odata.etag": string }>(account, A, `/planner/plans/${enc}/buckets`),
    graphAll<RawTask>(account, A, `/planner/plans/${enc}/tasks`),
  ]);
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(details.categoryDescriptions ?? {})) if (v) labels[k] = v;
  return {
    id: plan.id,
    name: plan.title,
    buckets: buckets.map((b): Bucket => ({ id: b.id, name: b.name, order: b.orderHint, etag: b["@odata.etag"] })),
    tasks: tasks.map(taskFrom),
    labels,
    members: [],
    created: plan.createdDateTime,
    etag: plan["@odata.etag"],
    detailsEtag: details["@odata.etag"],
    groupId: plan.container?.containerId ?? plan.owner,
  };
}

/** Description and checklist of a task. */
export async function loadDetails(account: string, task: Task): Promise<Task> {
  const d = await graph<{ description?: string; checklist?: Record<string, { title: string; isChecked: boolean; orderHint: string }>; previewType?: string; "@odata.etag": string }>(
    account,
    A,
    "GET",
    `/planner/tasks/${encodeURIComponent(task.id)}/details`,
  );
  const checklist: ChecklistItem[] = Object.entries(d.checklist ?? {})
    .map(([id, c]) => ({ id, title: c.title, done: c.isChecked, order: c.orderHint }))
    .sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1));
  return { ...task, notes: d.description ?? "", checklist, detailsLoaded: true, detailsEtag: d["@odata.etag"], checklistOnCard: d.previewType === "checklist" || task.checklistOnCard };
}

async function reread(account: string, id: string): Promise<Task> {
  return taskFrom(await graph<RawTask>(account, A, "GET", `/planner/tasks/${encodeURIComponent(id)}`));
}

/** Changes of the task itself (not its details) as a Graph patch. */
function taskPatch(before: Task, after: Task): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (after.title !== before.title) p.title = after.title;
  if (after.bucketId !== before.bucketId) p.bucketId = after.bucketId;
  if (after.progress !== before.progress) p.percentComplete = after.progress;
  if (after.priority !== before.priority) p.priority = after.priority;
  if ((after.start ?? null) !== (before.start ?? null)) p.startDateTime = toIso(after.start);
  if ((after.due ?? null) !== (before.due ?? null)) p.dueDateTime = toIso(after.due);
  if (after.order !== before.order) p.orderHint = after.order;
  const addAssign = after.assignees.filter((a) => !before.assignees.includes(a));
  const delAssign = before.assignees.filter((a) => !after.assignees.includes(a));
  if (addAssign.length || delAssign.length) {
    p.assignments = Object.fromEntries([...addAssign.map((u) => [u, { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" }]), ...delAssign.map((u) => [u, null])]);
  }
  const labelsChanged = after.labels.length !== before.labels.length || after.labels.some((l) => !before.labels.includes(l));
  if (labelsChanged) {
    const all = new Set([...after.labels, ...before.labels]);
    p.appliedCategories = Object.fromEntries([...all].map((l) => [l, after.labels.includes(l)]));
  }
  return p;
}

function detailsPatch(before: Task, after: Task): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (after.notes !== before.notes) p.description = after.notes;
  if (!!after.checklistOnCard !== !!before.checklistOnCard) p.previewType = after.checklistOnCard ? "checklist" : "automatic";
  const list: Record<string, unknown> = {};
  const old = new Map(before.checklist.map((c) => [c.id, c]));
  for (const c of after.checklist) {
    const o = old.get(c.id);
    if (!o) list[c.id] = { "@odata.type": "#microsoft.graph.plannerChecklistItem", title: c.title, isChecked: c.done, orderHint: " !" };
    else if (o.title !== c.title || o.done !== c.done) list[c.id] = { "@odata.type": "#microsoft.graph.plannerChecklistItem", title: c.title, isChecked: c.done };
  }
  for (const c of before.checklist) if (!after.checklist.some((x) => x.id === c.id)) list[c.id] = null;
  if (Object.keys(list).length) p.checklist = list;
  return p;
}

export async function updateTask(account: string, before: Task, after: Task): Promise<Task> {
  let out = after;
  const tp = taskPatch(before, after);
  if (Object.keys(tp).length) {
    await graphRaw(account, A, "PATCH", `/planner/tasks/${encodeURIComponent(after.id)}`, { body: tp, ifMatch: before.etag });
    const fresh = await reread(account, after.id);
    out = { ...after, etag: fresh.etag, order: fresh.order, completed: fresh.completed, checklistCount: fresh.checklistCount, checklistDone: fresh.checklistDone };
  }
  if (after.detailsLoaded) {
    const dp = detailsPatch(before, after);
    if (Object.keys(dp).length) {
      await graphRaw(account, A, "PATCH", `/planner/tasks/${encodeURIComponent(after.id)}/details`, { body: dp, ifMatch: before.detailsEtag });
      const d = await loadDetails(account, out);
      out = { ...out, detailsEtag: d.detailsEtag, checklist: d.checklist, checklistCount: d.checklist.length, checklistDone: d.checklist.filter((c) => c.done).length };
    }
  }
  return out;
}

export async function createTask(account: string, planId: string, t: Task): Promise<Task> {
  const body: Record<string, unknown> = { planId, bucketId: t.bucketId, title: t.title, orderHint: " !" };
  if (t.due) body.dueDateTime = toIso(t.due);
  if (t.assignees.length) body.assignments = Object.fromEntries(t.assignees.map((u) => [u, { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" }]));
  if (t.labels.length) body.appliedCategories = Object.fromEntries(t.labels.map((l) => [l, true]));
  return taskFrom(await graph<RawTask>(account, A, "POST", "/planner/tasks", { body }));
}

export async function deleteTask(account: string, t: Task): Promise<void> {
  await graphRaw(account, A, "DELETE", `/planner/tasks/${encodeURIComponent(t.id)}`, { ifMatch: t.etag });
}

export async function createBucket(account: string, planId: string, name: string): Promise<Bucket> {
  const b = await graph<{ id: string; name: string; orderHint: string; "@odata.etag": string }>(account, A, "POST", "/planner/buckets", { body: { name, planId, orderHint: " !" } });
  return { id: b.id, name: b.name, order: b.orderHint, etag: b["@odata.etag"] };
}

export async function renameBucket(account: string, b: Bucket, name: string): Promise<Bucket> {
  await graphRaw(account, A, "PATCH", `/planner/buckets/${encodeURIComponent(b.id)}`, { body: { name }, ifMatch: b.etag });
  const fresh = await graph<{ "@odata.etag": string }>(account, A, "GET", `/planner/buckets/${encodeURIComponent(b.id)}`);
  return { ...b, name, etag: fresh["@odata.etag"] };
}

export async function deleteBucket(account: string, b: Bucket): Promise<void> {
  await graphRaw(account, A, "DELETE", `/planner/buckets/${encodeURIComponent(b.id)}`, { ifMatch: b.etag });
}

export async function setLabels(account: string, plan: Plan, labels: Record<string, string>): Promise<string | undefined> {
  const body = { categoryDescriptions: Object.fromEntries(Object.keys({ ...plan.labels, ...labels }).map((k) => [k, labels[k] ?? null])) };
  await graphRaw(account, A, "PATCH", `/planner/plans/${encodeURIComponent(plan.id)}/details`, { body, ifMatch: plan.detailsEtag });
  const d = await graph<{ "@odata.etag": string }>(account, A, "GET", `/planner/plans/${encodeURIComponent(plan.id)}/details`);
  return d["@odata.etag"];
}

export async function createPlan(account: string, groupId: string, name: string): Promise<PlanRef> {
  const p = await graph<{ id: string; title: string }>(account, A, "POST", "/planner/plans", { body: { title: name, container: { url: `https://graph.microsoft.com/v1.0/groups/${groupId}` } } });
  return { id: p.id, name: p.title, groupId };
}

export interface Person {
  id: string;
  name: string;
  mail?: string;
}

const people = new Map<string, Person>();

/** Names of user ids (cached). */
export async function resolvePeople(account: string, ids: string[]): Promise<Map<string, Person>> {
  const missing = [...new Set(ids)].filter((id) => !people.has(id));
  await Promise.all(
    missing.map(async (id) => {
      try {
        const u = await graph<{ id: string; displayName: string; mail?: string }>(account, A, "GET", `/users/${encodeURIComponent(id)}?$select=id,displayName,mail`);
        people.set(id, { id, name: u.displayName, mail: u.mail });
      } catch {
        people.set(id, { id, name: id.slice(0, 8) });
      }
    }),
  );
  return people;
}

/** People of the directory for "Zuweisen". */
export async function searchPeople(account: string, q: string): Promise<Person[]> {
  const term = q.replace(/"/g, "");
  const r = await graph<{ value: { id: string; displayName: string; mail?: string }[] }>(account, A, "GET", `/users?$search="displayName:${encodeURIComponent(term)}" OR "mail:${encodeURIComponent(term)}"&$select=id,displayName,mail&$top=10`);
  return r.value.map((u) => {
    const p = { id: u.id, name: u.displayName, mail: u.mail };
    people.set(u.id, p);
    return p;
  });
}

/** Id of the signed-in user (for "Mir zuweisen"). */
export async function me(account: string): Promise<Person> {
  const u = await graph<{ id: string; displayName: string; mail?: string }>(account, A, "GET", "/me?$select=id,displayName,mail");
  const p = { id: u.id, name: u.displayName, mail: u.mail };
  people.set(u.id, p);
  return p;
}

/** orderHint that puts a task between two others (Planner computes the real value). */
export const hintBetween = (prev?: string, next?: string) => `${prev ?? ""} ${next ?? ""}!`;
