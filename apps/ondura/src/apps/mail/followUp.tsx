// Follow-up flags (Outlook: Zur Nachverfolgung): quick dates, labels and
// the dialog for custom dates.

import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input } from "@fluentui/react-components";
import type { FollowUp, MessageSummary } from "../../lib/types";
import type { MenuEntry } from "../../shell/contextMenu";
import { LOCALE, tl } from "../../lib/i18n";

export type FollowUpKind = "today" | "tomorrow" | "thisWeek" | "nextWeek" | "noDate";

/** A local day as YYYY-MM-DD. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * The dates Outlook uses for its quick flags: "Diese Woche" starts in two
 * days (at the latest on Friday) and is due on Friday, "Nächste Woche"
 * runs from Monday to Friday of the next week.
 */
export function followUpFor(kind: FollowUpKind, now = new Date()): FollowUp {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const range = (a: Date, b: Date): FollowUp => ({ start: isoDay(a), due: isoDay(b), done: false });
  const day = today.getDay(); // 0 = Sunday
  switch (kind) {
    case "today":
      return range(today, today);
    case "tomorrow":
      return range(addDays(today, 1), addDays(today, 1));
    case "thisWeek": {
      // From Friday on, "this week" is the day itself.
      const friday = day >= 1 && day <= 5 ? addDays(today, 5 - day) : today;
      const start = addDays(today, 2) > friday ? friday : addDays(today, 2);
      return range(start, friday);
    }
    case "nextWeek": {
      const monday = addDays(today, (8 - day) % 7 || 7);
      return range(monday, addDays(monday, 4));
    }
    case "noDate":
      return { start: null, due: null, done: false };
  }
}

/** "Fällig: heute", "Überfällig", "Erledigt", … for the reading pane. */
export function followUpLabel(m: Pick<MessageSummary, "isFlagged" | "followUp">, now = new Date()): string | null {
  const f = m.followUp;
  if (!m.isFlagged) return f?.done ? tl("Erledigt") : null;
  if (!f?.due) return tl("Zur Nachverfolgung");
  const today = isoDay(now);
  if (f.due < today) return tl("Überfällig seit {0}", dayText(f.due));
  if (f.due === today) return tl("Fällig: heute");
  if (f.due === isoDay(addDays(now, 1))) return tl("Fällig: morgen");
  return tl("Fällig: {0}", dayText(f.due));
}

/** Overdue flags are shown in red. */
export const isOverdue = (m: Pick<MessageSummary, "isFlagged" | "followUp">, now = new Date()) => !!(m.isFlagged && m.followUp?.due && m.followUp.due < isoDay(now));

const dayText = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "numeric" });

/** The Zur-Nachverfolgung menu for the ribbon and the context menu. */
export function followUpMenu(m: Pick<MessageSummary, "isFlagged" | "followUp"> | null, apply: (f: FollowUp | "clear") => void, custom: () => void): MenuEntry[] {
  const quick: [FollowUpKind, string][] = [
    ["today", tl("Heute")],
    ["tomorrow", tl("Morgen")],
    ["thisWeek", tl("Diese Woche")],
    ["nextWeek", tl("Nächste Woche")],
    ["noDate", tl("Kein Datum")],
  ];
  return [
    ...quick.map(([k, label]): MenuEntry => ({ label, onClick: () => apply(followUpFor(k)) })),
    { label: tl("Benutzerdefiniert…"), onClick: custom },
    "divider",
    { label: tl("Als erledigt markieren"), onClick: () => apply({ start: m?.followUp?.start ?? null, due: m?.followUp?.due ?? null, done: true }), disabled: !m?.isFlagged },
    { label: tl("Kennzeichnung löschen"), onClick: () => apply("clear"), disabled: !m?.isFlagged && !m?.followUp?.done },
  ];
}

/** Benutzerdefiniert: start and due date. */
export function FollowUpDialog({ open, initial, onClose, onApply }: { open: boolean; initial?: FollowUp | null; onClose: () => void; onApply: (f: FollowUp) => void }) {
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  useEffect(() => {
    if (!open) return;
    const today = isoDay(new Date());
    setStart(initial?.start ?? today);
    setDue(initial?.due ?? today);
  }, [open, initial]);
  const valid = !!start && !!due && start <= due;
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 380 }}>
        <DialogBody>
          <DialogTitle>{tl("Benutzerdefiniert")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label={tl("Beginnt am")}>
              <Input type="date" value={start} onChange={(_, d) => setStart(d.value)} />
            </Field>
            <Field label={tl("Fällig am")} validationMessage={start && due && start > due ? tl("Das Fälligkeitsdatum liegt vor dem Beginn.") : undefined}>
              <Input type="date" value={due} onChange={(_, d) => setDue(d.value)} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              {tl("Abbrechen")}
            </Button>
            <Button appearance="primary" disabled={!valid} onClick={() => onApply({ start, due, done: false })}>
              {tl("OK")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
