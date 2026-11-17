// The applications of Nexora. Every app runs in its own window of the same
// process (`nexora --app <id>`); the installer creates one start menu /
// desktop entry per app. Calendar, contacts and tasks are not apps of their
// own: like in Outlook they are modules inside the Relay window.

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
}

/** Separate applications (own window, own shortcut). */
export const SUITE_APPS: SuiteApp[] = [
  { id: "mail", name: "Relay", short: "Relay", color: "#0f6cbd", icon: Mail24Filled, available: true, description: "E-Mail, Kalender, Kontakte und Aufgaben" },
  { id: "text", name: "Nexora Text", short: "Text", color: "#2b579a", icon: DocumentText24Filled, available: false, description: "Textverarbeitung (.docx)" },
  { id: "sheets", name: "Nexora Tabellen", short: "Tabellen", color: "#107c41", icon: Table24Filled, available: false, description: "Tabellenkalkulation (.xlsx)" },
  { id: "slides", name: "Nexora Präsentation", short: "Präsentation", color: "#c43e1c", icon: SlideText24Filled, available: false, description: "Präsentationen (.pptx)" },
];

export type RelayModule = "mail" | "calendar" | "contacts" | "tasks";

/** Modules inside the Relay window, switched from the app rail. */
export const RELAY_MODULES: SuiteApp[] = [
  { id: "mail", name: "E-Mail", short: "E-Mail", color: "#0f6cbd", icon: Mail24Filled, available: true, description: "E-Mail für Microsoft 365, Exchange und IMAP" },
  { id: "calendar", name: "Kalender", short: "Kalender", color: "#0e7a8a", icon: CalendarLtr24Filled, available: true, description: "Termine und Besprechungen" },
  { id: "contacts", name: "Kontakte", short: "Kontakte", color: "#6b4fbb", icon: PeopleTeam24Filled, available: true, description: "Adressbuch für alle Konten" },
  { id: "tasks", name: "Aufgaben", short: "Aufgaben", color: "#c239b3", icon: TaskListLtr24Filled, available: true, description: "To-dos und Erinnerungen" },
];

export function isRelayModule(id: string): id is RelayModule {
  return RELAY_MODULES.some((m) => m.id === id);
}

export function suiteApp(id: string): SuiteApp | undefined {
  return SUITE_APPS.find((a) => a.id === id) ?? (isRelayModule(id) ? SUITE_APPS[0] : undefined);
}

export interface RelayContextValue {
  module: RelayModule;
  setModule: (m: RelayModule) => void;
}

/** Set by the Relay window; lets the app rail switch modules in place. */
export const RelayContext = createContext<RelayContextValue | null>(null);

export function useRelay(): RelayContextValue | null {
  return useContext(RelayContext);
}

/** `true` while the given module is the visible one (hidden modules stay mounted). */
export function useModuleActive(module: RelayModule): boolean {
  const ctx = useContext(RelayContext);
  return !ctx || ctx.module === module;
}

/** Office-style app tile: white glyph on a coloured rounded square. */
export function AppTile({ app, size = 32 }: { app: SuiteApp; size?: number }) {
  const Icon = app.icon;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: `linear-gradient(135deg, ${app.color}cc, ${app.color})`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        flexShrink: 0,
        boxShadow: "0 1px 2px rgba(0,0,0,.18)",
      }}
    >
      <Icon style={{ fontSize: size * 0.62 }} />
    </span>
  );
}
