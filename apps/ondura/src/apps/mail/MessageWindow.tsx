// A single message in its own window (double-click in the message list), as
// in Outlook: the message with its own toolbar; replies are written in the
// same window. Changes are announced to the main Ondura Mail window, which
// refreshes its list.

import { useCallback, useEffect, useState } from "react";
import { Toolbar, ToolbarButton, ToolbarDivider, makeStyles, tokens } from "@fluentui/react-components";
import {
  Archive20Regular,
  ArrowForward20Regular,
  ArrowReply20Regular,
  ArrowReplyAll20Regular,
  Delete20Regular,
  Flag20Filled,
  Flag20Regular,
  MailRead20Regular,
  MailUnread20Regular,
  Print20Regular,
} from "@fluentui/react-icons";
import type { Account, AppSettings, MessageDetail, OutgoingMessage } from "../../lib/types";
import { api, errorMessage, isTauri } from "../../lib/api";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { ReadingPane } from "./ReadingPane";
import { Compose, type ComposeState } from "./Compose";
import { printMessage } from "./MailExtras";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", minHeight: 0 },
  bar: {
    flexShrink: 0,
    margin: "0 8px",
    padding: "2px 6px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    flexWrap: "wrap",
  },
  body: { flex: 1, minHeight: 0, display: "flex", padding: "8px", gap: "8px" },
});

async function closeWindow() {
  if (!isTauri) return window.close();
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

async function setTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title).catch(() => {});
}

export function MessageWindow({ messageId }: { messageId: string }) {
  const s = useStyles();
  const notify = useNotify();
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);

  useEffect(() => {
    api.listAccounts().then(setAccounts, () => {});
    api.getSettings().then(setSettings, () => {});
    api
      .getMessage(messageId)
      .then(async (d) => {
        setDetail(d);
        void setTitle(d.summary.subject || tl("(Kein Betreff)"));
        // Opening a message reads it, as in the reading pane.
        if (!d.summary.isRead) {
          await api.setRead(d.summary.id, true).catch(() => {});
          setDetail({ ...d, summary: { ...d.summary, isRead: true } });
          void api.announceMailChange(d.summary.accountId);
        }
      })
      .catch((e) => notify(tl("Nachricht konnte nicht geladen werden"), errorMessage(e), "error"))
      .finally(() => {
        setLoading(false);
        splashDone();
      });
  }, [messageId, notify]);

  const m = detail?.summary ?? null;

  /** Runs an action on the message; `close` ends the window afterwards (it is gone from the folder). */
  const act = useCallback(
    async (failure: string, fn: () => Promise<unknown>, close = false) => {
      if (!m) return;
      try {
        await fn();
        void api.announceMailChange(m.accountId);
        if (close) void closeWindow();
      } catch (e) {
        notify(failure, errorMessage(e), "error");
      }
    },
    [m, notify],
  );

  const reply = (mode: "reply" | "replyAll" | "forward") => detail && setCompose({ mode, accountId: detail.summary.accountId, original: detail });

  const send = async (accountId: string, message: OutgoingMessage) => {
    try {
      await api.send(accountId, message);
      notify(tl("Wird gesendet…"), message.subject || undefined, "info");
      setCompose(null);
      void api.announceMailChange(accountId);
    } catch (e) {
      notify(tl("Senden fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const saveDraft = async (accountId: string, message: OutgoingMessage) => {
    try {
      await api.saveDraft(accountId, message);
      notify(tl("Entwurf gespeichert"), message.subject || undefined, "success");
      setCompose(null);
      void api.announceMailChange(accountId);
    } catch (e) {
      notify(tl("Entwurf konnte nicht gespeichert werden"), errorMessage(e), "error");
    }
  };

  // Keyboard shortcuts as in the main window; Esc closes the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (compose || target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName) || document.querySelector("[role=dialog]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") void closeWindow();
      else if (e.key === "Delete" && m) void act(tl("Löschen fehlgeschlagen"), () => api.deleteMessage(m.id), true);
      else if (ctrl && e.shiftKey && k === "r") (e.preventDefault(), reply("replyAll"));
      else if (ctrl && k === "r") (e.preventDefault(), reply("reply"));
      else if (ctrl && k === "f") (e.preventDefault(), reply("forward"));
      else if (ctrl && k === "p" && detail) (e.preventDefault(), printMessage(detail));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={s.root}>
      <SuiteHeader appName={tl("Ondura Mail")} logo="/mail.svg" center={m ? m.subject || tl("(Kein Betreff)") : undefined} />
      {!compose && (
        <Toolbar className={s.bar} aria-label={tl("Nachricht")} size="small">
          <ToolbarButton icon={<ArrowReply20Regular />} disabled={!m} onClick={() => reply("reply")}>
            {tl("Antworten")}
          </ToolbarButton>
          <ToolbarButton icon={<ArrowReplyAll20Regular />} disabled={!m} onClick={() => reply("replyAll")}>
            {tl("Allen antworten")}
          </ToolbarButton>
          <ToolbarButton icon={<ArrowForward20Regular />} disabled={!m} onClick={() => reply("forward")}>
            {tl("Weiterleiten")}
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<Delete20Regular />} disabled={!m} onClick={() => m && void act(tl("Löschen fehlgeschlagen"), () => api.deleteMessage(m.id), true)}>
            {tl("Löschen")}
          </ToolbarButton>
          <ToolbarButton icon={<Archive20Regular />} disabled={!m} onClick={() => m && void act(tl("Archivieren fehlgeschlagen"), () => api.archiveMessage(m.id), true)}>
            {tl("Archiv")}
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            icon={m?.isRead === false ? <MailRead20Regular /> : <MailUnread20Regular />}
            disabled={!m}
            onClick={() =>
              m &&
              void act(tl("Status konnte nicht geändert werden"), async () => {
                await api.setRead(m.id, !m.isRead);
                setDetail((d) => d && { ...d, summary: { ...d.summary, isRead: !m.isRead } });
              })
            }
          >
            {m?.isRead === false ? tl("Gelesen") : tl("Ungelesen")}
          </ToolbarButton>
          <ToolbarButton
            icon={m?.isFlagged ? <Flag20Filled /> : <Flag20Regular />}
            disabled={!m}
            onClick={() =>
              m &&
              void act(tl("Kennzeichnung fehlgeschlagen"), async () => {
                await api.setFlagged(m.id, !m.isFlagged);
                setDetail((d) => d && { ...d, summary: { ...d.summary, isFlagged: !m.isFlagged } });
              })
            }
          >
            {tl("Kennzeichnen")}
          </ToolbarButton>
          <ToolbarButton icon={<Print20Regular />} disabled={!detail} onClick={() => detail && printMessage(detail)}>
            {tl("Drucken")}
          </ToolbarButton>
        </Toolbar>
      )}
      <div className={s.body}>
        {compose ? (
          <Compose key={compose.mode} state={compose} accounts={accounts} onSend={send} onSaveDraft={saveDraft} onClose={() => setCompose(null)} />
        ) : (
          <ReadingPane
            detail={detail}
            alwaysLoadRemote={settings?.loadRemoteImages}
            loading={loading}
            onReply={reply}
            onDelete={() => m && void act(tl("Löschen fehlgeschlagen"), () => api.deleteMessage(m.id), true)}
            onNotify={notify}
            accounts={accounts}
            onReplyTo={(d, mode) => setCompose({ mode, accountId: d.summary.accountId, original: d })}
            onPrint={() => detail && printMessage(detail)}
          />
        )}
      </div>
    </div>
  );
}
