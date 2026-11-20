import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/api";
import { onComposeSwitch } from "../../lib/bus";
import { MAIL_MODULES, MailWindowContext, isMailModule, type MailModule } from "../../suite";
import { MailApp } from "../mail/MailApp";
import { CalendarApp } from "../calendar/CalendarApp";
import { ContactsApp } from "../contacts/ContactsApp";
import { TasksApp } from "../tasks/TasksApp";
import { tl } from "../../lib/i18n";

const VIEWS: Record<MailModule, () => ReactNode> = {
  mail: () => <MailApp />,
  calendar: () => <CalendarApp />,
  contacts: () => <ContactsApp />,
  tasks: () => <TasksApp />,
};

/**
 * The Ondura Mail window: mail, calendar, contacts and tasks as modules of one
 * window, switched from the app rail. A module is mounted on
 * first use and then kept alive (hidden), so switching back is instant and
 * keeps its state (selected folder, open message, calendar position).
 */
export function MailWindow({ initial }: { initial?: string }) {
  const [module, setModule] = useState<MailModule>(() => {
    if (initial && isMailModule(initial)) return initial;
    return "mail";
  });
  const [mounted, setMounted] = useState<Set<MailModule>>(() => new Set([module]));

  const select = (m: MailModule) => {
    setModule(m);
    setMounted((cur) => (cur.has(m) ? cur : new Set(cur).add(m)));
  };

  // Route changes (browser hash) switch the module, too.
  useEffect(() => {
    select(initial && isMailModule(initial) ? initial : "mail");
  }, [initial]);

  useEffect(() => onComposeSwitch(() => select("mail")), []);

  // Tray menu / shortcuts (`ondura --app calendar`) switch the module of the open window.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string>("mail-module", (e) => isMailModule(e.payload) && select(e.payload)).then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const name = MAIL_MODULES.find((m) => m.id === module)?.name;
    document.title = module === "mail" ? tl("Ondura Mail") : tl("{0} – Ondura Mail", name);
    if (!isTauri) {
      const hash = module === "mail" ? "#/mail" : `#/mail/${module}`;
      if (window.location.hash !== hash) history.replaceState(null, "", hash);
    }
  }, [module]);

  const ctx = useMemo(() => ({ module, setModule: select }), [module]);

  return (
    <MailWindowContext.Provider value={ctx}>
      {MAIL_MODULES.map(({ id }) => {
        const m = id as MailModule;
        if (!mounted.has(m)) return null;
        return (
          <div key={m} style={{ display: m === module ? "contents" : "none" }}>
            {VIEWS[m]()}
          </div>
        );
      })}
    </MailWindowContext.Provider>
  );
}
