// The applications of Nexora. Every app runs in its own window of the same
// process (`nexora --app <id>`); the installer creates one start menu /
// desktop entry per app. Calendar, contacts and tasks are not apps of their
// own: like in Outlook they are modules inside the Nexora Mail window.

import { createContext, useContext } from "react";
import type { FluentIcon } from "@fluentui/react-icons";
import {
  CalendarLtr24Filled,
  DocumentText24Filled,
  Mail24Filled,
  PeopleTeam24Filled,
  SlideText24Filled,
  Table24Filled,
  TaskListLtr24Filled,
} from "@fluentui/react-icons";

export interface SuiteApp {
  id: string;
  name: string;
  short: string;
  color: string;
  icon: FluentIcon;
  available: boolean;
  description: string;
  /** Full-colour app icon in `public/` (used instead of the glyph tile). */
  logo?: string;
}

/** Separate applications (own window, own shortcut). */
export const SUITE_APPS: SuiteApp[] = [
  { id: "mail", name: "Nexora Mail", short: "Mail", color: "#4f54d4", icon: Mail24Filled, available: true, description: "E-Mail, Kalender, Kontakte und Aufgaben", logo: "/mail.svg" },
  { id: "text", name: "Nexora Text", short: "Text", color: "#2b5bd7", icon: DocumentText24Filled, available: true, description: "Textverarbeitung mit Seitenansicht (.docx)", logo: "/text.svg" },
  { id: "sheets", name: "Nexora Tabellen", short: "Tabellen", color: "#107c41", icon: Table24Filled, available: true, description: "Tabellenkalkulation (.xlsx)", logo: "/sheets.svg" },
  { id: "slides", name: "Nexora Präsentation", short: "Präsentation", color: "#c43e1c", icon: SlideText24Filled, available: true, description: "Präsentationen (.pptx)", logo: "/slides.svg" },
];

export type MailModule = "mail" | "calendar" | "contacts" | "tasks";

/** Modules inside the Nexora Mail window, switched from the app rail. */
export const MAIL_MODULES: SuiteApp[] = [
  { id: "mail", name: "E-Mail", short: "E-Mail", color: "#4f54d4", icon: Mail24Filled, available: true, description: "E-Mail für Microsoft 365, Exchange und IMAP" },
  { id: "calendar", name: "Kalender", short: "Kalender", color: "#0e7a8a", icon: CalendarLtr24Filled, available: true, description: "Termine und Besprechungen" },
  { id: "contacts", name: "Kontakte", short: "Kontakte", color: "#6b4fbb", icon: PeopleTeam24Filled, available: true, description: "Adressbuch für alle Konten" },
  { id: "tasks", name: "Aufgaben", short: "Aufgaben", color: "#c239b3", icon: TaskListLtr24Filled, available: true, description: "To-dos und Erinnerungen" },
];

export function isMailModule(id: string): id is MailModule {
  return MAIL_MODULES.some((m) => m.id === id);
}

export function suiteApp(id: string): SuiteApp | undefined {
  return SUITE_APPS.find((a) => a.id === id) ?? (isMailModule(id) ? SUITE_APPS[0] : undefined);
}

export interface MailWindowContextValue {
  module: MailModule;
  setModule: (m: MailModule) => void;
}

/** Set by the Nexora Mail window; lets the app rail switch modules in place. */
export const MailWindowContext = createContext<MailWindowContextValue | null>(null);

export function useMailWindow(): MailWindowContextValue | null {
  return useContext(MailWindowContext);
}

/** `true` while the given module is the visible one (hidden modules stay mounted). */
export function useModuleActive(module: MailModule): boolean {
  const ctx = useContext(MailWindowContext);
  return !ctx || ctx.module === module;
}

/** Office-style app tile: white glyph on a coloured rounded square. */
export function AppTile({ app, size = 32 }: { app: SuiteApp; size?: number }) {
  if (app.logo) return <img src={app.logo} alt="" width={size} height={size} style={{ flexShrink: 0, display: "block" }} />;
  const Icon = app.icon;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        // Same glass treatment as the Nexora and mail icons: top sheen over a diagonal gradient.
        background: `linear-gradient(180deg, rgba(255,255,255,.3), rgba(255,255,255,0) 55%), linear-gradient(135deg, ${app.color}aa, ${app.color})`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        flexShrink: 0,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.35), 0 4px 12px rgba(30,30,80,.18)",
      }}
    >
      <Icon style={{ fontSize: size * 0.62 }} />
    </span>
  );
}
