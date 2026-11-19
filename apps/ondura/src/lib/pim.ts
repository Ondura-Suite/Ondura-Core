// Calendars, contacts and tasks: types mirroring crates/pim-core/src/model.rs
// and the Tauri commands in src-tauri/src/pim_commands.rs (with a demo
// backend for the browser).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Address } from "./types";
import { isTauri } from "./api";
import { LOCALE, tl } from "./i18n";

export type CollectionKind = "calendar" | "contacts" | "tasks";

export interface Collection {
  id: string;
  accountId: string;
  remoteId: string;
  kind: CollectionKind;
  name: string;
  color: string | null;
  readOnly: boolean;
  visible: boolean;
  isDefault: boolean;
}

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: Freq;
  interval: number;
  byDay: string[];
  until: string | null; // YYYY-MM-DD
  count: number | null;
}

export type ShowAs = "free" | "tentative" | "busy" | "outOfOffice";

/** A meeting room from the organisation's room directory. */
export interface Room {
  name: string;
  email: string;
  capacity?: number;
  building?: string;
}

export interface Attendee {
  address: Address;
  response: string;
  required: boolean;
}

export interface CalEvent {
  id: string;
  collectionId: string;
  accountId: string;
  remoteId: string;
  resourceId: string;
  seriesId: string | null;
  title: string;
  location: string;
  body: string;
  start: string; // RFC 3339 UTC
  end: string;
  allDay: boolean;
  isRecurring: boolean;
  recurrence: Recurrence | null;
  rrule: string | null;
  reminderMinutes: number | null;
  showAs: ShowAs;
  organizer: Address | null;
  attendees: Attendee[];
  isCancelled: boolean;
  onlineMeetingUrl: string | null;
  /** Own answer to an invitation ("accepted", "tentative", "declined", "needsAction", "organizer"). */
  myResponse?: string | null;
  categories?: string[];
}

/** Someone's access to a shared calendar (Microsoft 365). */
export interface CalendarPermission {
  id: string;
  email: string;
  name?: string | null;
  role: string;
}

export interface DayWeather {
  date: string;
  code: number;
  max: number;
  min: number;
}

export interface Forecast {
  place: string;
  days: DayWeather[];
}

export type EventResponse = "accept" | "tentative" | "decline";

export interface BusySlot {
  start: string;
  end: string;
  status: ShowAs;
}

export interface Availability {
  email: string;
  known: boolean;
  slots: BusySlot[];
}

export interface EventInput {
  title: string;
  location: string;
  body: string | null;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: Recurrence | null;
  rrule: string | null;
  reminderMinutes: number | null;
  showAs: ShowAs;
  attendees: Address[];
  categories?: string[];
  /** Create a Teams meeting (Microsoft 365). */
  onlineMeeting?: boolean;
}

export type EditScope = "occurrence" | "series";

export interface Labeled {
  label: string;
  value: string;
}

export interface PostalAddress {
  label: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface Contact {
  id: string;
  collectionId: string;
  accountId: string;
  remoteId: string;
  displayName: string;
  givenName: string;
  familyName: string;
  company: string;
  jobTitle: string;
  emails: Labeled[];
  phones: Labeled[];
  addresses: PostalAddress[];
  birthday: string | null;
  notes: string;
  /** Contact groups. */
  groups?: string[];
  /** Photo as data URI. */
  photo?: string | null;
}

export type TaskImportance = "low" | "normal" | "high";

export interface Task {
  id: string;
  collectionId: string;
  accountId: string;
  remoteId: string;
  title: string;
  notes: string;
  due: string | null; // YYYY-MM-DD
  completed: boolean;
  completedAt: string | null;
  importance: TaskImportance;
  created: string;
  steps?: TaskStep[];
  recurrence?: Recurrence | null;
  /** Reminder time (RFC 3339). */
  reminder?: string | null;
  /** People the task is assigned to (Microsoft Planner). */
  assignees?: Address[];
}

export interface TaskStep {
  title: string;
  done: boolean;
}

export type PimEvent =
  | { type: "changed"; kind: CollectionKind; accountId: string }
  | { type: "collectionsChanged"; accountId: string }
  | { type: "reminder"; eventId: string; title: string; start: string; location: string; allDay: boolean }
  | { type: "error"; accountId: string; message: string };

export function contactName(c: Contact): string {
  const n = c.displayName.trim() || `${c.givenName} ${c.familyName}`.trim() || c.company || c.emails[0]?.value || "";
  return n || tl("(Ohne Namen)");
}

// ------------------------------------------------------------------ demo data

const day = (offset: number, h = 0, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};
const allDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00Z`;
};
const monday = (() => {
  const d = new Date();
  return -((d.getDay() + 6) % 7);
})();

const mockCollections: Collection[] = [
  { id: "cal-local", accountId: "local", remoteId: "c1", kind: "calendar", name: tl("Kalender"), color: "#3b5bdb", readOnly: false, visible: true, isDefault: true },
  { id: "cal-work", accountId: "acc-m365", remoteId: "c2", kind: "calendar", name: tl("Arbeit"), color: "#107c41", readOnly: false, visible: true, isDefault: false },
  { id: "cal-holidays", accountId: "acc-m365", remoteId: "c3", kind: "calendar", name: tl("Feiertage"), color: "#c239b3", readOnly: true, visible: true, isDefault: false },
  { id: "ab-local", accountId: "local", remoteId: "a1", kind: "contacts", name: tl("Kontakte"), color: null, readOnly: false, visible: true, isDefault: true },
  { id: "ab-work", accountId: "acc-m365", remoteId: "a2", kind: "contacts", name: tl("Firmenkontakte"), color: null, readOnly: false, visible: true, isDefault: false },
  { id: "tl-local", accountId: "local", remoteId: "t1", kind: "tasks", name: tl("Aufgaben"), color: null, readOnly: false, visible: true, isDefault: true },
  { id: "tl-work", accountId: "acc-m365", remoteId: "t2", kind: "tasks", name: tl("Projekt Ondura"), color: null, readOnly: false, visible: true, isDefault: false },
];

let seq = 0;
const ev = (collectionId: string, title: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: `e${++seq}`,
  collectionId,
  accountId: "local",
  remoteId: `r${seq}`,
  resourceId: `r${seq}`,
  seriesId: null,
  title,
  location: "",
  body: "",
  start,
  end,
  allDay: false,
  isRecurring: false,
  recurrence: null,
  rrule: null,
  reminderMinutes: 15,
  showAs: "busy",
  organizer: null,
  attendees: [],
  isCancelled: false,
  onlineMeetingUrl: null,
  ...extra,
});

const mockEvents: CalEvent[] = [
  ...[0, 1, 2, 3, 4].map((i) =>
    ev("cal-work", "Daily Stand-up", day(monday + i, 9, 0), day(monday + i, 9, 15), {
      isRecurring: true,
      seriesId: "daily",
      recurrence: { freq: "weekly", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"], until: null, count: null },
      onlineMeetingUrl: "https://teams.example/join",
    }),
  ),
  ev("cal-work", "Projektabstimmung", day(monday + 1, 10, 30), day(monday + 1, 12, 0), { location: "Besprechungsraum 2", organizer: { name: "Sophie Berger", email: "sophie.berger@example.com" }, myResponse: "needsAction", attendees: [{ address: { name: "Sophie Berger", email: "sophie.berger@example.com" }, response: "accepted", required: true }, { address: { name: "Demo Benutzer", email: "demo@mirranet.de" }, response: "needsAction", required: true }] }),
  ev("cal-work", "Kundentermin", day(monday + 1, 11, 0), day(monday + 1, 12, 30), { location: "Saarbrücken" }),
  ev("cal-local", "Zahnarzt", day(monday + 2, 15, 0), day(monday + 2, 16, 0), { showAs: "outOfOffice" }),
  ev("cal-work", "Release Ondura 0.2", day(monday + 3, 14, 0), day(monday + 3, 15, 30), { body: tl("Changelog durchgehen, Installer prüfen.") }),
  ev("cal-local", "Sport", day(monday + 3, 18, 30), day(monday + 3, 20, 0), { showAs: "free" }),
  ev("cal-local", "Grillen am See", day(monday + 5, 16, 0), day(monday + 5, 21, 0), { location: "Würzbacher Weiher" }),
  ev("cal-local", "Urlaub", allDay(monday + 9), allDay(monday + 14), { allDay: true, showAs: "outOfOffice" }),
  ev("cal-holidays", "Tag der offenen Tür", allDay(monday + 4), allDay(monday + 5), { allDay: true, showAs: "free", accountId: "acc-m365" }),
  ev("cal-work", "Quartalsplanung", day(monday + 8, 9, 0), day(monday + 8, 12, 0)),
  ev("cal-local", "Geburtstag Anna", allDay(monday + 17), allDay(monday + 18), { allDay: true, showAs: "free", recurrence: { freq: "yearly", interval: 1, byDay: [], until: null, count: null }, isRecurring: true }),
];

const contact = (collectionId: string, given: string, family: string, extra: Partial<Contact> = {}): Contact => ({
  id: `k${++seq}`,
  collectionId,
  accountId: "local",
  remoteId: `k${seq}`,
  displayName: `${given} ${family}`,
  givenName: given,
  familyName: family,
  company: "",
  jobTitle: "",
  emails: [{ label: "work", value: `${given.toLowerCase()}.${family.toLowerCase()}@example.com` }],
  phones: [],
  addresses: [],
  birthday: null,
  notes: "",
  ...extra,
});

const mockContacts: Contact[] = [
  contact("ab-local", "Anna", "Schmitt", { groups: [tl("Familie")], phones: [{ label: "mobile", value: "+49 170 1234567" }], birthday: "1992-12-04", notes: tl("Kennt sich mit Fotografie aus.") }),
  contact("ab-work", "Max", "Becker", { company: "Becker Serverbau GmbH", jobTitle: "Vertrieb", phones: [{ label: "work", value: "+49 681 987654" }], addresses: [{ label: "work", street: tl("Hauptstraße 12"), city: tl("Saarbrücken"), postalCode: "66111", country: tl("Deutschland") }] }),
  contact("ab-work", "Sophie", "Berger", { company: "Berger Design", jobTitle: "Projektleitung" }),
  contact("ab-local", "Lukas", "Wagner", { groups: [tl("Freunde"), tl("Beta-Tester")], phones: [{ label: "mobile", value: "+49 151 555000" }] }),
  contact("ab-local", "Julia", "Hoffmann", { groups: [tl("Beta-Tester")] }),
  contact("ab-local", "Tom", "Richter", { groups: [tl("Freunde")] }),
  contact("ab-work", "Laura", "Klein", { company: "Klein & Partner", jobTitle: "Steuerberaterin" }),
  contact("ab-local", "David", "Zimmermann"),
];

const task = (collectionId: string, title: string, extra: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  collectionId,
  accountId: "local",
  remoteId: `t${seq}`,
  title,
  notes: "",
  due: null,
  completed: false,
  completedAt: null,
  importance: "normal",
  created: new Date().toISOString(),
  ...extra,
});
const dateOnly = (offset: number) => allDay(offset).slice(0, 10);

const mockTasks: Task[] = [
  task("tl-local", "Angebot Serverschrank prüfen", { due: dateOnly(1), importance: "high" }),
  task("tl-local", "Steuerunterlagen sortieren", { due: dateOnly(-2) }),
  task("tl-local", "Geschenk für Anna", { due: dateOnly(14), notes: tl("Fotobuch?") }),
  task("tl-local", "Fahrrad zur Inspektion"),
  task("tl-local", "Rechnung Hosting bezahlen", { completed: true, completedAt: day(-1, 10) }),
  task("tl-work", "Kalender-Ansicht testen", { importance: "high" }),
  task("tl-work", "Installer für Windows signieren", { due: dateOnly(5) }),
  task("tl-work", "README aktualisieren", { completed: true }),
];

const mockShared = new Set<string>();
const mockPermissions = new Map<string, CalendarPermission[]>([["cal-work", [{ id: "p0", email: "anna.becker@mirranet.de", name: "Anna Becker", role: "read" }]]]);

const listeners = new Set<(e: PimEvent) => void>();
const emit = (e: PimEvent) => listeners.forEach((l) => l(e));
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function expandMock(input: EventInput, collectionId: string, id?: string): CalEvent {
  return { ...ev(collectionId, input.title, input.start, input.end), ...input, attendees: input.attendees.map((address) => ({ address, response: "needsAction", required: true })), body: input.body ?? "", id: id ?? `e${++seq}`, isRecurring: !!input.recurrence };
}

// ------------------------------------------------------------------ api

export const pim = {
  /** Open another person's calendar by address. */
  async openSharedCalendar(accountId: string, email: string): Promise<Collection> {
    if (!isTauri) {
      await delay(400);
      const c: Collection = { id: `shared-${email}`, accountId, remoteId: `user:${email}`, kind: "calendar", name: email, color: "#ca5010", readOnly: true, visible: true, isDefault: false };
      mockCollections.push(c);
      mockShared.add(c.id);
      emit({ type: "collectionsChanged", accountId } as PimEvent);
      return c;
    }
    return invoke("pim_open_shared_calendar", { accountId, email });
  },

  async closeSharedCalendar(collectionId: string): Promise<void> {
    if (!isTauri) {
      const i = mockCollections.findIndex((c) => c.id === collectionId);
      if (i >= 0) mockCollections.splice(i, 1);
      mockShared.delete(collectionId);
      return;
    }
    return invoke("pim_close_shared_calendar", { collectionId });
  },

  async isSharedCalendar(collectionId: string): Promise<boolean> {
    if (!isTauri) return mockShared.has(collectionId);
    return invoke("pim_is_shared_calendar", { collectionId });
  },

  async calendarPermissions(collectionId: string): Promise<CalendarPermission[]> {
    if (!isTauri) return mockPermissions.get(collectionId) ?? [];
    return invoke("pim_calendar_permissions", { collectionId });
  },

  async shareCalendar(collectionId: string, email: string, role: string): Promise<void> {
    if (!isTauri) {
      const list = mockPermissions.get(collectionId) ?? [];
      const existing = list.find((p) => p.email === email);
      if (existing) existing.role = role;
      else list.push({ id: `p${++seq}`, email, role });
      mockPermissions.set(collectionId, list);
      return;
    }
    return invoke("pim_share_calendar", { collectionId, email, role });
  },

  async unshareCalendar(collectionId: string, permissionId: string): Promise<void> {
    if (!isTauri) {
      mockPermissions.set(collectionId, (mockPermissions.get(collectionId) ?? []).filter((p) => p.id !== permissionId));
      return;
    }
    return invoke("pim_unshare_calendar", { collectionId, permissionId });
  },

  /** Propose a new time; `false` when the server cannot (then send a COUNTER mail). */
  async proposeTime(eventId: string, start: string, end: string, comment: string): Promise<boolean> {
    if (!isTauri) return true;
    return invoke("pim_propose_time", { eventId, start, end, comment });
  },

  async weather(place: string, lang: string): Promise<Forecast> {
    if (!isTauri) {
      const days = [...Array(7)].map((_, i) => {
        const d = new Date(Date.now() + i * 86400_000);
        return { date: d.toISOString().slice(0, 10), code: [0, 2, 3, 61, 1, 45, 71][i], max: 8 + i, min: 1 + (i % 3) };
      });
      return { place: place || "Saarbrücken, Deutschland", days };
    }
    return invoke("weather_forecast", { place, lang });
  },

  async collections(): Promise<Collection[]> {
    if (!isTauri) return mockCollections.map((c) => ({ ...c }));
    return invoke("pim_collections");
  },
  async setVisible(collectionId: string, visible: boolean): Promise<void> {
    if (!isTauri) {
      mockCollections.find((c) => c.id === collectionId)!.visible = visible;
      return;
    }
    return invoke("pim_set_visible", { collectionId, visible });
  },
  async setColor(collectionId: string, color: string): Promise<void> {
    if (!isTauri) {
      mockCollections.find((c) => c.id === collectionId)!.color = color;
      return;
    }
    return invoke("pim_set_color", { collectionId, color });
  },
  async createCollection(kind: CollectionKind, name: string, color: string | null): Promise<Collection> {
    if (!isTauri) {
      const c: Collection = { id: `c${++seq}`, accountId: "local", remoteId: "", kind, name, color, readOnly: false, visible: true, isDefault: false };
      mockCollections.push(c);
      return c;
    }
    return invoke("pim_create_collection", { kind, name, color });
  },
  async deleteCollection(collectionId: string): Promise<void> {
    if (!isTauri) {
      mockCollections.splice(mockCollections.findIndex((c) => c.id === collectionId), 1);
      return;
    }
    return invoke("pim_delete_collection", { collectionId });
  },
  async sync(): Promise<void> {
    if (!isTauri) return;
    return invoke("pim_sync");
  },

  async events(from: Date, to: Date): Promise<CalEvent[]> {
    if (!isTauri) {
      const visible = new Set(mockCollections.filter((c) => c.visible).map((c) => c.id));
      return mockEvents.filter((e) => visible.has(e.collectionId) && new Date(e.end) > from && new Date(e.start) < to).map((e) => ({ ...e }));
    }
    return invoke("pim_events", { from: from.toISOString(), to: to.toISOString() });
  },
  async searchEvents(query: string): Promise<CalEvent[]> {
    if (!isTauri) return mockEvents.filter((e) => e.title.toLowerCase().includes(query.toLowerCase()));
    return invoke("pim_search_events", { query });
  },
  async createEvent(collectionId: string, input: EventInput): Promise<void> {
    if (!isTauri) {
      await delay();
      mockEvents.push(expandMock(input, collectionId));
      emit({ type: "changed", kind: "calendar", accountId: "local" });
      return;
    }
    return invoke("pim_create_event", { collectionId, input });
  },
  async updateEvent(eventId: string, input: EventInput, scope: EditScope): Promise<void> {
    if (!isTauri) {
      await delay();
      const i = mockEvents.findIndex((e) => e.id === eventId);
      mockEvents[i] = { ...mockEvents[i], ...expandMock(input, mockEvents[i].collectionId, eventId), body: input.body ?? mockEvents[i].body };
      void scope;
      emit({ type: "changed", kind: "calendar", accountId: "local" });
      return;
    }
    return invoke("pim_update_event", { eventId, input, scope });
  },
  async moveEvent(eventId: string, collectionId: string): Promise<void> {
    if (!isTauri) {
      mockEvents.find((e) => e.id === eventId)!.collectionId = collectionId;
      emit({ type: "changed", kind: "calendar", accountId: "local" });
      return;
    }
    return invoke("pim_move_event", { eventId, collectionId });
  },
  async respondEvent(eventId: string, response: EventResponse): Promise<void> {
    if (!isTauri) {
      const e = mockEvents.find((x) => x.id === eventId);
      if (e) e.myResponse = response === "accept" ? "accepted" : response === "decline" ? "declined" : "tentative";
      emit({ type: "changed", kind: "calendar", accountId: "local" });
      return;
    }
    return invoke("pim_respond_event", { eventId, response });
  },
  async freeBusy(emails: string[], from: Date, to: Date): Promise<Availability[]> {
    if (!isTauri) {
      await delay(300);
      // Demo: everyone is busy 10–11:30 and 14–15, unknown addresses at example.org.
      const day = new Date(from);
      const at = (h: number, m = 0) => {
        const d = new Date(day);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      return emails.map((email, i) => ({
        email,
        known: !email.endsWith("example.org"),
        slots: [
          { start: at(10 + i, 0), end: at(11 + i, 30), status: "busy" as ShowAs },
          { start: at(14, 0), end: at(15, 0), status: (i % 2 ? "tentative" : "outOfOffice") as ShowAs },
        ],
      }));
    }
    return invoke("pim_free_busy", { emails, from: from.toISOString(), to: to.toISOString() });
  },
  async rooms(): Promise<Room[]> {
    if (!isTauri) {
      await delay(200);
      return [
        { name: tl("Besprechungsraum Rhein"), email: "rhein@mirranet.de", capacity: 8, building: "Hauptgebäude" },
        { name: tl("Besprechungsraum Saar"), email: "saar@mirranet.de", capacity: 12, building: "Hauptgebäude" },
        { name: tl("Konferenzsaal"), email: "konferenz@mirranet.de", capacity: 40, building: "Hauptgebäude" },
        { name: tl("Fokusraum 2"), email: "fokus2@mirranet.de", capacity: 2, building: "Werkstatt" },
      ];
    }
    return invoke("pim_rooms");
  },
  async importIcs(collectionId: string, ics: string): Promise<void> {
    if (!isTauri) {
      const title = ics.match(/SUMMARY:(.*)/)?.[1]?.trim() ?? tl("Einladung");
      mockEvents.push(ev(collectionId, title, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString()));
      emit({ type: "changed", kind: "calendar", accountId: "local" });
      return;
    }
    return invoke("pim_import_ics", { collectionId, ics });
  },
  async deleteEvent(eventId: string, scope: EditScope): Promise<void> {
    if (!isTauri) {
      const e = mockEvents.find((x) => x.id === eventId);
      for (let i = mockEvents.length - 1; i >= 0; i--) {
        const x = mockEvents[i];
        if (x.id === eventId || (scope === "series" && e?.seriesId && x.seriesId === e.seriesId)) mockEvents.splice(i, 1);
      }
      emit({ type: "changed", kind: "calendar", accountId: "local" });
      return;
    }
    return invoke("pim_delete_event", { eventId, scope });
  },

  async contacts(collectionId?: string | null, query?: string): Promise<Contact[]> {
    if (!isTauri) {
      const q = (query ?? "").toLowerCase();
      return mockContacts
        .filter((c) => (!collectionId || c.collectionId === collectionId) && (!q || JSON.stringify(c).toLowerCase().includes(q)))
        .sort((a, b) => contactName(a).localeCompare(contactName(b), LOCALE));
    }
    return invoke("pim_contacts", { collectionId: collectionId ?? null, query: query ?? null });
  },
  async saveContact(collectionId: string, contact: Contact): Promise<void> {
    if (!isTauri) {
      await delay();
      const i = mockContacts.findIndex((c) => c.id === contact.id);
      if (i >= 0) mockContacts[i] = { ...contact, collectionId };
      else mockContacts.push({ ...contact, id: `k${++seq}`, collectionId });
      emit({ type: "changed", kind: "contacts", accountId: "local" });
      return;
    }
    return invoke("pim_save_contact", { collectionId, contact });
  },
  async deleteContact(contactId: string): Promise<void> {
    if (!isTauri) {
      mockContacts.splice(mockContacts.findIndex((c) => c.id === contactId), 1);
      emit({ type: "changed", kind: "contacts", accountId: "local" });
      return;
    }
    return invoke("pim_delete_contact", { contactId });
  },
  /** Save contacts as a .vcf file chosen by the user; returns the path. */
  async exportContacts(contactIds: string[], suggestedName = "Kontakte.vcf"): Promise<string | null> {
    if (!isTauri) return null;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ title: tl("Kontakte exportieren"), defaultPath: suggestedName, filters: [{ name: "vCard", extensions: ["vcf"] }] });
    if (!path) return null;
    await invoke("pim_export_contacts", { contactIds, path });
    return path;
  },
  async importContacts(collectionId: string): Promise<number> {
    if (!isTauri) return 0;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, title: tl("vCard-Datei importieren"), filters: [{ name: "vCard", extensions: ["vcf", "vcard"] }] });
    if (!path || Array.isArray(path)) return 0;
    return invoke("pim_import_contacts", { collectionId, path });
  },
  async suggest(query: string): Promise<{ name: string; email: string }[]> {
    if (!isTauri) {
      const q = query.toLowerCase();
      if (q.length < 2) return [];
      return mockContacts
        .flatMap((c) => c.emails.map((e) => ({ name: contactName(c), email: e.value })))
        .filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
        .slice(0, 8);
    }
    return invoke("pim_suggest", { query });
  },

  async tasks(collectionId?: string | null): Promise<Task[]> {
    if (!isTauri) return mockTasks.filter((t) => !collectionId || t.collectionId === collectionId).map((t) => ({ ...t }));
    return invoke("pim_tasks", { collectionId: collectionId ?? null });
  },
  async saveTask(collectionId: string, task: Task): Promise<void> {
    if (!isTauri) {
      const i = mockTasks.findIndex((t) => t.id === task.id);
      if (i >= 0) mockTasks[i] = { ...task, collectionId, completedAt: task.completed ? task.completedAt ?? new Date().toISOString() : null };
      else mockTasks.unshift({ ...task, id: `t${++seq}`, collectionId, created: new Date().toISOString() });
      emit({ type: "changed", kind: "tasks", accountId: "local" });
      return;
    }
    return invoke("pim_save_task", { collectionId, task });
  },
  async deleteTask(taskId: string): Promise<void> {
    if (!isTauri) {
      mockTasks.splice(mockTasks.findIndex((t) => t.id === taskId), 1);
      emit({ type: "changed", kind: "tasks", accountId: "local" });
      return;
    }
    return invoke("pim_delete_task", { taskId });
  },

  async onEvent(handler: (e: PimEvent) => void): Promise<UnlistenFn> {
    if (!isTauri) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }
    return listen<PimEvent>("pim-sync", (e) => handler(e.payload));
  },
};

export const COLLECTION_COLORS = ["#3b5bdb", "#107c41", "#c239b3", "#ca5010", "#0e7a8a", "#6b4fbb", "#d13438", "#8e562e"];

export function newContact(collectionId: string): Contact {
  return {
    id: "",
    collectionId,
    accountId: "",
    remoteId: "",
    displayName: "",
    givenName: "",
    familyName: "",
    company: "",
    jobTitle: "",
    emails: [{ label: "work", value: "" }],
    phones: [{ label: "mobile", value: "" }],
    addresses: [],
    birthday: null,
    notes: "",
    groups: [],
    photo: null,
  };
}

export function newTask(collectionId: string, title: string): Task {
  return {
    id: "",
    collectionId,
    accountId: "",
    remoteId: "",
    title,
    notes: "",
    due: null,
    completed: false,
    completedAt: null,
    importance: "normal",
    created: new Date().toISOString(),
  };
}
