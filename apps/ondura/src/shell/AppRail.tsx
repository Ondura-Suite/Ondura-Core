import { useState } from "react";
import { Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { MAIL_MODULES, isMailModule, useMailWindow, type SuiteApp } from "../suite";
import { api, errorMessage } from "../lib/api";
import { tl } from "../lib/i18n";
import { MESSAGE_DRAG, requestNewEvent } from "../lib/bus";
import { formatAddress } from "../lib/format";
import type { MessageDetail } from "../lib/types";
import { useNotify } from "./notify";

/** Plain text of a message for notes and descriptions. */
function messageText(d: MessageDetail): string {
  if (d.body.text?.trim()) return d.body.text.trim();
  if (d.body.html) {
    // Line breaks for <br> and block ends, which textContent drops.
    const html = d.body.html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "$&\n");
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }
  return d.summary.preview;
}

/** Modules that take messages dragged from the mail list. */
const TAKES_MAIL = new Set(["calendar", "tasks", "contacts"]);

const useStyles = makeStyles({
  rail: {
    width: "56px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingTop: "8px",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  item: {
    position: "relative",
    width: "48px",
    height: "48px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    ":hover": { backgroundColor: tokens.colorNeutralBackground3Hover, color: tokens.colorNeutralForeground2 },
    ":disabled": { cursor: "default", opacity: 0.45 },
  },
  dropTarget: {
    backgroundColor: tokens.colorBrandBackground2,
    outline: `2px dashed ${tokens.colorBrandStroke1}`,
    outlineOffset: "-2px",
  },
  active: {
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    "::before": {
      content: '""',
      position: "absolute",
      left: "-4px",
      top: "12px",
      bottom: "12px",
      width: "3px",
      borderRadius: "2px",
      backgroundColor: tokens.colorBrandBackground,
    },
  },
});

/**
 * Vertical app bar on the left. It switches the
 * Ondura Mail modules (mail, calendar, contacts, tasks) in the same window; the
 * office apps are separate programs and are not listed here.
 */
export function AppRail({ current }: { current: string }) {
  const s = useStyles();
  const mailWindow = useMailWindow();
  const notify = useNotify();
  const [dropOn, setDropOn] = useState<string | null>(null);

  /** Messages dropped on Calendar (appointment), Tasks (tasks) or Contacts (senders). */
  const takeMessages = async (appId: string, ids: string[]) => {
    try {
      const details = await Promise.all(ids.map((id) => api.getMessage(id)));
      if (appId === "calendar") {
        const d = details[0];
        if (!d) return;
        const people = [d.summary.from, ...d.summary.to, ...(d.summary.cc ?? [])].filter((a): a is NonNullable<typeof a> => !!a);
        // Without the user's own addresses.
        const own = new Set((await api.listAccounts().catch(() => [])).map((a) => a.email.toLowerCase()));
        const unique = [...new Map(people.filter((a) => !own.has(a.email.toLowerCase())).map((a) => [a.email.toLowerCase(), a])).values()];
        mailWindow?.setModule("calendar");
        requestNewEvent({ title: d.summary.subject, body: messageText(d), attendees: unique.map(formatAddress) });
      } else if (appId === "tasks") {
        const { taskFromMessage } = await import("../apps/mail/MailExtras");
        let list = "";
        for (const d of details) list = await taskFromMessage({ ...d.summary, preview: messageText(d) });
        notify(details.length > 1 ? tl("{0} Aufgaben angelegt", details.length) : tl("Aufgabe angelegt"), tl("In „{0}“", list), "success");
      } else if (appId === "contacts") {
        const { pim, newContact } = await import("../lib/pim");
        const books = (await pim.collections()).filter((c) => c.kind === "contacts" && !c.readOnly);
        const book = books.find((c) => c.isDefault) ?? books[0];
        if (!book) throw new Error(tl("Kein beschreibbares Adressbuch"));
        const known = new Set((await pim.contacts(null)).flatMap((c) => c.emails.map((e) => e.value.toLowerCase())));
        let added = 0;
        for (const d of details) {
          const from = d.summary.from;
          if (!from?.email || known.has(from.email.toLowerCase())) continue;
          const c = newContact(book.id);
          const [given, ...family] = (from.name ?? "").trim().split(/\s+/);
          c.displayName = from.name ?? from.email;
          c.givenName = family.length ? given : "";
          c.familyName = family.join(" ") || (from.name ?? "");
          c.emails = [{ label: "work", value: from.email }];
          await pim.saveContact(book.id, c);
          known.add(from.email.toLowerCase());
          added++;
        }
        notify(added ? tl("{0} Kontakt(e) angelegt", added) : tl("Die Absender sind schon in Ihren Kontakten"), book.name, added ? "success" : "info");
      }
    } catch (e) {
      notify(tl("Das hat nicht geklappt"), errorMessage(e), "error");
    }
  };

  const item = (app: SuiteApp) => {
    const Icon = app.icon;
    const active = app.id === current;
    const open = () => {
      if (active) return;
      if (mailWindow && isMailModule(app.id)) mailWindow.setModule(app.id);
      else void api.openApp(app.id);
    };
    return (
      <Tooltip key={app.id} content={app.available ? app.name : tl("{0} (in Entwicklung)", app.name)} relationship="label" positioning="after">
        <button
          className={mergeClasses(s.item, active && s.active, dropOn === app.id && s.dropTarget)}
          disabled={!app.available && !active}
          onClick={open}
          onDragOver={(e) => {
            if (!TAKES_MAIL.has(app.id) || !e.dataTransfer.types.includes(MESSAGE_DRAG)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (dropOn !== app.id) setDropOn(app.id);
          }}
          onDragLeave={() => setDropOn((d) => (d === app.id ? null : d))}
          onDrop={(e) => {
            setDropOn(null);
            const raw = e.dataTransfer.getData(MESSAGE_DRAG);
            if (!raw || !TAKES_MAIL.has(app.id)) return;
            e.preventDefault();
            void takeMessages(app.id, JSON.parse(raw) as string[]);
          }}
          aria-current={active ? "page" : undefined}
        >
          <Icon style={{ fontSize: 24, color: active || app.available ? app.color : undefined }} />
        </button>
      </Tooltip>
    );
  };

  return (
    <nav className={s.rail} aria-label={tl("Apps")}>
      {MAIL_MODULES.map(item)}
    </nav>
  );
}
