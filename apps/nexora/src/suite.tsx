// The applications of Nexora. Every app runs in its own window of the
// same process (`nexora --app <id>`); the installer creates one start
// menu / desktop entry per app.

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

export const SUITE_APPS: SuiteApp[] = [
  { id: "mail", name: "Relay", short: "Relay", color: "#0f6cbd", icon: Mail24Filled, available: true, description: "E-Mail für Microsoft 365, Exchange und IMAP" },
  { id: "calendar", name: "Nexora Kalender", short: "Kalender", color: "#0e7a8a", icon: CalendarLtr24Filled, available: true, description: "Termine und Besprechungen" },
  { id: "contacts", name: "Nexora Kontakte", short: "Kontakte", color: "#6b4fbb", icon: PeopleTeam24Filled, available: true, description: "Adressbuch für alle Konten" },
  { id: "tasks", name: "Nexora Aufgaben", short: "Aufgaben", color: "#c239b3", icon: TaskListLtr24Filled, available: true, description: "To-dos und Erinnerungen" },
  { id: "text", name: "Nexora Text", short: "Text", color: "#2b579a", icon: DocumentText24Filled, available: false, description: "Textverarbeitung (.docx)" },
  { id: "sheets", name: "Nexora Tabellen", short: "Tabellen", color: "#107c41", icon: Table24Filled, available: false, description: "Tabellenkalkulation (.xlsx)" },
  { id: "slides", name: "Nexora Präsentation", short: "Präsentation", color: "#c43e1c", icon: SlideText24Filled, available: false, description: "Präsentationen (.pptx)" },
];

export function suiteApp(id: string): SuiteApp | undefined {
  return SUITE_APPS.find((a) => a.id === id);
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
