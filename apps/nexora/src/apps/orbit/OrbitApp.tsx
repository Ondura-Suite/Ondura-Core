import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/api";
import { ORBIT_MODULES, OrbitContext, isOrbitModule, type OrbitModule } from "../../suite";
import { MailApp } from "../mail/MailApp";
import { CalendarApp } from "../calendar/CalendarApp";
import { ContactsApp } from "../contacts/ContactsApp";
import { TasksApp } from "../tasks/TasksApp";

const VIEWS: Record<OrbitModule, () => ReactNode> = {
  mail: () => <MailApp />,
  calendar: () => <CalendarApp />,
  contacts: () => <ContactsApp />,
  tasks: () => <TasksApp />,
};

/**
 * The Orbit window: mail, calendar, contacts and tasks as modules of one
 * window, switched from the app rail like in Outlook. A module is mounted on
 * first use and then kept alive (hidden), so switching back is instant and
 * keeps its state (selected folder, open message, calendar position).
 */
export function OrbitApp({ initial }: { initial?: string }) {
  const [module, setModule] = useState<OrbitModule>(() => {
    if (initial && isOrbitModule(initial)) return initial;
    return "mail";
  });
  const [mounted, setMounted] = useState<Set<OrbitModule>>(() => new Set([module]));

  const select = (m: OrbitModule) => {
    setModule(m);
    setMounted((cur) => (cur.has(m) ? cur : new Set(cur).add(m)));
  };

  // Route changes (browser hash) switch the module, too.
  useEffect(() => {
    if (initial && isOrbitModule(initial)) select(initial);
  }, [initial]);

  // Tray menu / shortcuts (`nexora --app calendar`) switch the module of the open window.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string>("orbit-module", (e) => isOrbitModule(e.payload) && select(e.payload)).then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const name = ORBIT_MODULES.find((m) => m.id === module)?.name;
    document.title = module === "mail" ? "Orbit" : `${name} – Orbit`;
    if (!isTauri) {
      const hash = module === "mail" ? "#/mail" : `#/mail/${module}`;
      if (window.location.hash !== hash) history.replaceState(null, "", hash);
    }
  }, [module]);

  const ctx = useMemo(() => ({ module, setModule: select }), [module]);

  return (
    <OrbitContext.Provider value={ctx}>
      {ORBIT_MODULES.map(({ id }) => {
        const m = id as OrbitModule;
        if (!mounted.has(m)) return null;
        return (
          <div key={m} style={{ display: m === module ? "contents" : "none" }}>
            {VIEWS[m]()}
          </div>
        );
      })}
    </OrbitContext.Provider>
  );
}
