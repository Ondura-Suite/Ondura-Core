// Outlook-style extras of Ondura Mail: snooze, print, sweep, quick steps,
// voting buttons and the mailbox size.

import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  ProgressBar,
  Radio,
  RadioGroup,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, Delete20Regular } from "@fluentui/react-icons";
import type { Folder, MessageDetail, MessageSummary, Quota } from "../../lib/types";
import { api, type SweepAction } from "../../lib/api";
import { displayName, escapeHtml, folderLabel, longDate } from "../../lib/format";
import { buildMailDocument } from "../../lib/html";
import { LOCALE, tl } from "../../lib/i18n";
import type { MenuEntry } from "../../shell/contextMenu";

// ------------------------------------------------------------------ snooze

/** Snooze times like in Outlook: later today, tomorrow, weekend, next week. */
export function snoozeChoices(now = new Date()): { label: string; at: Date }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const out: { label: string; at: Date }[] = [];
  const later = new Date(now.getTime() + 3 * 3600_000);
  later.setMinutes(0, 0, 0);
  if (later.getDate() === now.getDate() && later.getHours() <= 21) out.push({ label: tl("Später heute"), at: later });
  out.push({ label: tl("Morgen"), at: at(1, 8) });
  const day = now.getDay();
  if (day >= 1 && day <= 4) out.push({ label: tl("Dieses Wochenende"), at: at(6 - day, 9) });
  out.push({ label: tl("Nächste Woche"), at: at(((8 - day) % 7) || 7, 8) });
  return out;
}

const fmt = (d: Date) => d.toLocaleString(LOCALE, { weekday: "short", hour: "2-digit", minute: "2-digit" });

export function snoozeMenu(onSnooze: (at: Date | null) => void, onCustom: () => void, snoozed?: boolean): MenuEntry[] {
  return [
    ...snoozeChoices().map((c): MenuEntry => ({ label: `${c.label}  ·  ${fmt(c.at)}`, onClick: () => onSnooze(c.at) })),
    "divider",
    { label: tl("Datum und Uhrzeit auswählen…"), onClick: onCustom },
    snoozed ? { label: tl("Zurückstellung aufheben"), onClick: () => onSnooze(null) } : false,
  ];
}

export function SnoozeDialog({ open, onClose, onSnooze }: { open: boolean; onClose: () => void; onSnooze: (at: Date) => void }) {
  const tomorrow = new Date(Date.now() + 86400_000);
  tomorrow.setHours(8, 0, 0, 0);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [value, setValue] = useState(local(tomorrow));
  useEffect(() => {
    if (open) setValue(local(tomorrow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const at = new Date(value);
  const valid = !Number.isNaN(at.getTime()) && at.getTime() > Date.now();
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 400 }}>
        <DialogBody>
          <DialogTitle>{tl("Zurückstellen bis")}</DialogTitle>
          <DialogContent>
            <Input type="datetime-local" value={value} onChange={(_, d) => setValue(d.value)} style={{ width: "100%" }} />
            <Text size={200} block style={{ marginTop: 8, color: tokens.colorNeutralForeground3 }}>
              {tl("Die Nachricht verschwindet bis dahin aus dem Ordner und kommt dann ungelesen zurück.")}
            </Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!valid} onClick={() => (onSnooze(at), onClose())}>{tl("Zurückstellen")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------------- print

/** Print a message with its header (sender, recipients, date) like Outlook. */
export function printMessage(detail: MessageDetail) {
  const m = detail.summary;
  const join = (list: { name: string | null; email: string }[]) => list.map((a) => escapeHtml(a.name ? `${a.name} <${a.email}>` : a.email)).join("; ");
  const row = (label: string, value: string) => (value ? `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>` : "");
  const attachments = detail.body.attachments.filter((a) => !a.isInline).map((a) => escapeHtml(a.name)).join(", ");
  const header = `<div class="ondura-print-head"><h1>${escapeHtml(m.subject || tl("(Kein Betreff)"))}</h1><table>
${row(tl("Von:"), m.from ? join([m.from]) : "")}
${row(tl("Gesendet:"), escapeHtml(longDate(m.date)))}
${row(tl("An:"), join(m.to))}
${row(tl("Cc:"), join(m.cc))}
${row(tl("Anlagen:"), attachments)}
</table></div>`;
  const doc = buildMailDocument(detail.body, true).replace(
    "<body>",
    `<body><style>.ondura-print-head{border-bottom:2px solid #242424;margin-bottom:12px;padding-bottom:8px;font-family:"Segoe UI",system-ui,sans-serif}
.ondura-print-head h1{font-size:18px;margin:0 0 6px}.ondura-print-head th{text-align:left;padding-right:12px;vertical-align:top;font-weight:600;white-space:nowrap}
.ondura-print-head td,.ondura-print-head th{font-size:12px}@page{margin:15mm}</style>${header}`,
  );
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        setTimeout(() => frame.remove(), 1000);
      }
    }, 100);
  };
  frame.srcdoc = doc;
}

// ------------------------------------------------------------------- sweep

export function SweepDialog({
  message,
  folders,
  onClose,
  onDone,
}: {
  message: MessageSummary | null;
  folders: Folder[];
  onClose: () => void;
  onDone: (count: number, blocked: boolean) => void;
}) {
  const [kind, setKind] = useState<"delete" | "keepLatest" | "archive" | "move">("delete");
  const [target, setTarget] = useState<string>("");
  const [future, setFuture] = useState(false);
  const [busy, setBusy] = useState(false);
  const targets = folders.filter((f) => message && f.accountId === message.accountId && f.id !== message.folderId);
  useEffect(() => {
    setKind("delete");
    setFuture(false);
    setTarget(targets[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);
  if (!message) return null;
  const sender = displayName(message.from);
  const run = async () => {
    setBusy(true);
    try {
      const action: SweepAction = kind === "move" ? { type: "move", folderId: target } : { type: kind };
      const n = await api.sweep(message.id, action);
      if (future && message.from) {
        // Future mail: a rule with the same action.
        const rules = await api.rules();
        const junkOrTrash = kind === "move" ? target : folders.find((f) => f.accountId === message.accountId && f.role === (kind === "archive" ? "archive" : "trash"))?.id;
        rules.push({
          id: crypto.randomUUID(),
          name: tl("Aufräumen: {0}", message.from.email),
          enabled: true,
          accountId: message.accountId,
          fromContains: message.from.email,
          subjectContains: null,
          toContains: null,
          moveTo: junkOrTrash ?? null,
          markRead: false,
          flag: false,
          category: null,
          delete: kind === "delete" || kind === "keepLatest",
          stop: true,
        });
        await api.saveRules(rules);
      }
      onDone(n, future);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 480 }}>
        <DialogBody>
          <DialogTitle>{tl("Aufräumen")}</DialogTitle>
          <DialogContent>
            <Text block style={{ marginBottom: 8 }}>{tl("Alle Nachrichten von {0} in diesem Ordner:", sender)}</Text>
            <RadioGroup value={kind} onChange={(_, d) => setKind(d.value as typeof kind)}>
              <Radio value="delete" label={tl("Löschen")} />
              <Radio value="keepLatest" label={tl("Löschen, nur die neueste behalten")} />
              <Radio value="archive" label={tl("Archivieren")} />
              <Radio value="move" label={tl("In Ordner verschieben")} />
            </RadioGroup>
            {kind === "move" && (
              <Dropdown
                style={{ marginLeft: 28, minWidth: 240 }}
                value={folderLabel(targets.find((f) => f.id === target) ?? targets[0] ?? ({} as Folder)) ?? ""}
                selectedOptions={[target]}
                onOptionSelect={(_, d) => d.optionValue && setTarget(d.optionValue)}
              >
                {targets.map((f) => (
                  <Option key={f.id} value={f.id} text={folderLabel(f)}>{folderLabel(f)}</Option>
                ))}
              </Dropdown>
            )}
            <Checkbox
              style={{ marginTop: 8 }}
              checked={future}
              disabled={kind === "keepLatest"}
              onChange={(_, d) => setFuture(!!d.checked)}
              label={tl("Auch mit künftigen Nachrichten so verfahren")}
            />
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={busy || (kind === "move" && !target)} onClick={run}>{tl("OK")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------- quick steps

export type QuickAction =
  | { type: "move"; folderId: string }
  | { type: "archive" }
  | { type: "delete" }
  | { type: "markRead" }
  | { type: "markUnread" }
  | { type: "flag" }
  | { type: "unflag" }
  | { type: "category"; name: string }
  | { type: "reply" }
  | { type: "replyAll" }
  | { type: "forward"; to: string };

export interface QuickStep {
  id: string;
  name: string;
  actions: QuickAction[];
}

const QS_KEY = "ondura-mail.quickSteps";

export function loadQuickSteps(): QuickStep[] {
  try {
    const v = localStorage.getItem(QS_KEY);
    if (v) return JSON.parse(v);
  } catch {
    /* ignore */
  }
  // Defaults like Outlook's.
  return [
    { id: "done", name: tl("Erledigt"), actions: [{ type: "markRead" }, { type: "unflag" }, { type: "archive" }] },
    { id: "team", name: tl("Antworten und löschen"), actions: [{ type: "reply" }, { type: "delete" }] },
  ];
}

export function saveQuickSteps(list: QuickStep[]) {
  try {
    localStorage.setItem(QS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function actionLabel(a: QuickAction, folders: Folder[]): string {
  switch (a.type) {
    case "move":
      return tl("In Ordner verschieben: {0}", folderLabel(folders.find((f) => f.id === a.folderId) ?? ({ name: "?" } as Folder)));
    case "archive":
      return tl("Archivieren");
    case "delete":
      return tl("Löschen");
    case "markRead":
      return tl("Als gelesen markieren");
    case "markUnread":
      return tl("Als ungelesen markieren");
    case "flag":
      return tl("Kennzeichnen");
    case "unflag":
      return tl("Kennzeichnung entfernen");
    case "category":
      return tl("Kategorisieren: {0}", a.name);
    case "reply":
      return tl("Antworten");
    case "replyAll":
      return tl("Allen antworten");
    case "forward":
      return tl("Weiterleiten an {0}", a.to);
  }
}

const ACTION_TYPES: QuickAction["type"][] = ["move", "archive", "delete", "markRead", "markUnread", "flag", "unflag", "category", "reply", "replyAll", "forward"];

const useQsStyles = makeStyles({
  step: { display: "flex", flexDirection: "column", gap: "6px", padding: "10px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  row: { display: "flex", gap: "6px", alignItems: "center" },
  list: { display: "flex", flexDirection: "column", gap: "10px", maxHeight: "60vh", overflowY: "auto" },
});

export function QuickStepsDialog({ open, folders, onClose }: { open: boolean; folders: Folder[]; onClose: (steps: QuickStep[]) => void }) {
  const s = useQsStyles();
  const [steps, setSteps] = useState<QuickStep[]>([]);
  useEffect(() => {
    if (open) setSteps(loadQuickSteps());
  }, [open]);
  const mailFolders = folders.filter((f) => f.role !== "drafts");
  const update = (i: number, patch: Partial<QuickStep>) => setSteps((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const blank = (type: QuickAction["type"]): QuickAction =>
    type === "move" ? { type, folderId: mailFolders[0]?.id ?? "" } : type === "category" ? { type, name: "" } : type === "forward" ? { type, to: "" } : ({ type } as QuickAction);
  const typeLabel = (t: QuickAction["type"]) => actionLabel(blank(t), folders).replace(/:.*$/, "").replace(/ an .*$/, "");
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose(loadQuickSteps())}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>{tl("QuickSteps verwalten")}</DialogTitle>
          <DialogContent>
            <div className={s.list}>
              {steps.map((st, i) => (
                <div key={st.id} className={s.step}>
                  <div className={s.row}>
                    <Input value={st.name} onChange={(_, d) => update(i, { name: d.value })} style={{ flex: 1 }} aria-label={tl("Name")} />
                    <Button appearance="subtle" icon={<Delete20Regular />} aria-label={tl("Löschen")} onClick={() => setSteps((l) => l.filter((_, j) => j !== i))} />
                  </div>
                  {st.actions.map((a, k) => (
                    <div key={k} className={s.row}>
                      <Dropdown
                        value={typeLabel(a.type)}
                        selectedOptions={[a.type]}
                        onOptionSelect={(_, d) => update(i, { actions: st.actions.map((x, j) => (j === k ? blank(d.optionValue as QuickAction["type"]) : x)) })}
                        style={{ minWidth: 200 }}
                      >
                        {ACTION_TYPES.map((t) => (
                          <Option key={t} value={t} text={typeLabel(t)}>{typeLabel(t)}</Option>
                        ))}
                      </Dropdown>
                      {a.type === "move" && (
                        <Dropdown
                          value={folderLabel(mailFolders.find((f) => f.id === a.folderId) ?? ({ name: "" } as Folder))}
                          selectedOptions={[a.folderId]}
                          onOptionSelect={(_, d) => update(i, { actions: st.actions.map((x, j) => (j === k ? { type: "move", folderId: d.optionValue! } : x)) })}
                          style={{ flex: 1 }}
                        >
                          {mailFolders.map((f) => (
                            <Option key={f.id} value={f.id} text={folderLabel(f)}>{folderLabel(f)}</Option>
                          ))}
                        </Dropdown>
                      )}
                      {a.type === "category" && (
                        <Input value={a.name} placeholder={tl("Kategorie")} onChange={(_, d) => update(i, { actions: st.actions.map((x, j) => (j === k ? { type: "category", name: d.value } : x)) })} />
                      )}
                      {a.type === "forward" && (
                        <Input value={a.to} placeholder={tl("E-Mail-Adresse")} onChange={(_, d) => update(i, { actions: st.actions.map((x, j) => (j === k ? { type: "forward", to: d.value } : x)) })} />
                      )}
                      <Button appearance="subtle" icon={<Delete20Regular />} aria-label={tl("Aktion entfernen")} onClick={() => update(i, { actions: st.actions.filter((_, j) => j !== k) })} />
                    </div>
                  ))}
                  <Button appearance="subtle" size="small" icon={<Add20Regular />} style={{ alignSelf: "flex-start" }} onClick={() => update(i, { actions: [...st.actions, { type: "markRead" }] })}>
                    {tl("Aktion hinzufügen")}
                  </Button>
                </div>
              ))}
              <Button icon={<Add20Regular />} style={{ alignSelf: "flex-start" }} onClick={() => setSteps((l) => [...l, { id: crypto.randomUUID(), name: tl("Neuer QuickStep"), actions: [{ type: "markRead" }] }])}>
                {tl("Neuer QuickStep")}
              </Button>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (saveQuickSteps(steps), onClose(steps))}>{tl("Speichern")}</Button>
            <Button onClick={() => onClose(loadQuickSteps())}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------------------------------------------------------- voting buttons

export const VOTE_PRESETS: string[][] = [
  [tl("Genehmigen"), tl("Ablehnen")],
  [tl("Ja"), tl("Nein")],
  [tl("Ja"), tl("Nein"), tl("Vielleicht")],
];

/** HTML block with voting buttons; each button answers with "<choice>: <subject>". */
export function voteBlock(options: string[], replyTo: string, subject: string): string {
  const buttons = options
    .map(
      (o) =>
        `<a href="mailto:${encodeURIComponent(replyTo)}?subject=${encodeURIComponent(`${o}: ${subject}`)}" style="display:inline-block;margin:0 6px 6px 0;padding:6px 14px;border:1px solid #8a8886;border-radius:4px;color:#242424;text-decoration:none;font-weight:600">${escapeHtml(o)}</a>`,
    )
    .join("");
  return `<div data-ondura-vote="${escapeHtml(options.join(";"))}" style="margin:12px 0;padding:10px;border:1px solid #d1d1d1;border-radius:6px"><div style="margin-bottom:6px;color:#616161">${escapeHtml(tl("Bitte stimmen Sie ab:"))}</div>${buttons}</div>`;
}

/** Options of a voting block in a sent message, if any. */
export function voteOptions(html: string | null): string[] | null {
  const m = html?.match(/data-ondura-vote="([^"]*)"/);
  if (!m) return null;
  const txt = document.createElement("textarea");
  txt.innerHTML = m[1];
  return txt.value.split(";").filter(Boolean);
}

/** Count the replies of a conversation per choice. */
export function tallyVotes(options: string[], thread: MessageSummary[]): { option: string; voters: string[] }[] {
  return options.map((o) => ({
    option: o,
    voters: thread.filter((m) => m.subject.toLowerCase().startsWith(`${o.toLowerCase()}:`)).map((m) => displayName(m.from)),
  }));
}

// ------------------------------------------------------------ mail → task

/** Create a task (due today) from a message in the default task list. */
export async function taskFromMessage(m: MessageSummary): Promise<string> {
  const { pim, newTask } = await import("../../lib/pim");
  const lists = (await pim.collections()).filter((c) => c.kind === "tasks" && !c.readOnly);
  const target = lists.find((c) => c.isDefault) ?? lists[0];
  if (!target) throw new Error(tl("Keine beschreibbare Aufgabenliste"));
  const t = newTask(target.id, m.subject || tl("(Kein Betreff)"));
  t.notes = `${tl("E-Mail von {0} ({1}):", displayName(m.from), new Date(m.date).toLocaleString(LOCALE))}\n${m.preview}`;
  const d = new Date();
  t.due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await pim.saveTask(target.id, t);
  return target.name;
}

// ----------------------------------------------------------- mailbox size

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString(LOCALE, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

export function QuotaInfo({ accountId }: { accountId: string }) {
  const [quota, setQuota] = useState<Quota | null | undefined>(undefined);
  useEffect(() => {
    setQuota(undefined);
    api.quota(accountId).then(setQuota, () => setQuota(null));
  }, [accountId]);
  if (quota === undefined) return <Text size={200}>{tl("Postfachgröße wird ermittelt…")}</Text>;
  if (quota === null) return <Text size={200}>{tl("Der Server meldet keine Postfachgröße.")}</Text>;
  const share = quota.limit ? quota.used / quota.limit : null;
  return (
    <Field
      label={tl("Postfachgröße")}
      validationState={share !== null && share > 0.9 ? "warning" : "none"}
      validationMessage={
        quota.limit
          ? tl("{0} von {1} belegt ({2} %)", formatBytes(quota.used), formatBytes(quota.limit), Math.round((share ?? 0) * 100))
          : tl("{0} belegt", formatBytes(quota.used))
      }
    >
      {share !== null && <ProgressBar value={Math.min(1, share)} thickness="large" color={share > 0.9 ? "warning" : "brand"} />}
    </Field>
  );
}
