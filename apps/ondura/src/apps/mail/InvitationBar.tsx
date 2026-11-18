import { useEffect, useState } from "react";
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import { CalendarAdd20Regular, CalendarLtr20Regular } from "@fluentui/react-icons";
import type { Account, MessageDetail } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { pim } from "../../lib/pim";
import { useMailWindow } from "../../suite";

/** Short summary of the first VEVENT of an iCalendar text. */
function summarize(ics: string): { title: string; when: string; location: string } | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  if (!/BEGIN:VEVENT/i.test(unfolded)) return null;
  const get = (name: string) => unfolded.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, "mi"))?.[1]?.trim().replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ") ?? "";
  const parse = (v: string) => {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    if (!m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`;
    return { date: new Date(iso), allDay: false };
  };
  const start = parse(get("DTSTART"));
  const when = start
    ? start.date.toLocaleString("de-DE", start.allDay ? { dateStyle: "full" } : { dateStyle: "full", timeStyle: "short" })
    : "";
  return { title: get("SUMMARY") || "(Ohne Titel)", when, location: get("LOCATION") };
}

/**
 * Banner for meeting invitations (text/calendar attachments). Microsoft 365
 * and Exchange put invitations into the calendar themselves, so there the
 * banner only leads to the calendar; for other accounts the invitation can
 * be added to a calendar.
 */
export function InvitationBar({ detail, accounts, onNotify }: { detail: MessageDetail; accounts: Account[]; onNotify: (t: string, b?: string, i?: "success" | "error" | "info") => void }) {
  const mailWindow = useMailWindow();
  const att = detail.body.attachments.find((a) => /text\/calendar/i.test(a.contentType) || /\.ics$/i.test(a.name));
  const [ics, setIcs] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const account = accounts.find((a) => a.id === detail.summary.accountId);
  const native = account?.kind.type === "graph" || account?.kind.type === "ews";

  useEffect(() => {
    setIcs(null);
    setDone(false);
    if (!att) return;
    api.attachmentText(detail.summary.id, att.id).then(setIcs, () => setIcs(null));
  }, [detail.summary.id, att?.id]);

  if (!att || !ics) return null;
  const info = summarize(ics);
  if (!info) return null;
  const cancelled = /METHOD:CANCEL/i.test(ics);

  const add = async () => {
    try {
      const cols = (await pim.collections()).filter((c) => c.kind === "calendar" && !c.readOnly);
      const target = cols.find((c) => c.accountId === detail.summary.accountId) ?? cols.find((c) => c.isDefault) ?? cols[0];
      if (!target) throw new Error("Kein beschreibbarer Kalender vorhanden");
      await pim.importIcs(target.id, ics);
      setDone(true);
      onNotify("Termin übernommen", `${info.title} – ${target.name}`, "success");
    } catch (e) {
      onNotify("Termin konnte nicht übernommen werden", errorMessage(e), "error");
    }
  };

  return (
    <MessageBar intent={cancelled ? "warning" : "info"} layout="multiline" style={{ marginBottom: 12 }}>
      <MessageBarBody>
        <MessageBarTitle>{cancelled ? "Absage" : "Einladung"}: {info.title}</MessageBarTitle>
        {info.when}
        {info.location ? ` · ${info.location}` : ""}
      </MessageBarBody>
      <MessageBarActions>
        {native || done ? (
          <Button size="small" icon={<CalendarLtr20Regular />} onClick={() => mailWindow?.setModule("calendar")}>
            Im Kalender öffnen
          </Button>
        ) : (
          !cancelled && (
            <Button size="small" appearance="primary" icon={<CalendarAdd20Regular />} onClick={add}>
              In Kalender übernehmen
            </Button>
          )
        )}
      </MessageBarActions>
    </MessageBar>
  );
}
