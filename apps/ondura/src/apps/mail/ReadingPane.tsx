import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowForward20Regular,
  ArrowReply20Regular,
  ArrowReplyAll20Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  Delete20Regular,
  Document20Regular,
  Flag20Filled,
  Image20Regular,
  MailRead48Regular,
} from "@fluentui/react-icons";
import type { MessageDetail, MessageSummary } from "../../lib/types";
import { displayName, formatSize, longDate } from "../../lib/format";
import { buildMailDocument, hasRemoteContent } from "../../lib/html";
import { api } from "../../lib/api";
import { CategoryChips } from "./Categories";
import { InvitationBar } from "./InvitationBar";
import { SecurityBar } from "./SecurityBar";
import type { Account } from "../../lib/types";

const useStyles = makeStyles({
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  scroll: { flex: 1, overflowY: "auto", padding: "20px 24px" },
  subject: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightBase500, marginBottom: "8px", display: "flex", gap: "8px", alignItems: "flex-start" },
  cats: { marginBottom: "12px" },
  head: { display: "flex", gap: "12px", alignItems: "flex-start", margin: "8px 0 12px" },
  meta: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  sender: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, overflow: "hidden", textOverflow: "ellipsis" },
  actions: { display: "flex", gap: "2px", flexShrink: 0 },
  attachments: { display: "flex", flexWrap: "wrap", gap: "8px", margin: "8px 0 16px" },
  attachment: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 12px 6px 8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground1,
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
    maxWidth: "260px",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  attName: { fontSize: tokens.fontSizeBase200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" },
  paper: { borderRadius: tokens.borderRadiusMedium, overflow: "hidden", background: "#fff", padding: "8px" },
  frame: { width: "100%", border: "none", display: "block", minHeight: "120px" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", color: tokens.colorNeutralForeground3 },
  threadHead: { margin: "24px 0 8px", fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground3 },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    marginBottom: "8px",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 12px",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  cardBody: { padding: "0 12px 12px" },
  cardText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

type ReplyMode = "reply" | "replyAll" | "forward";
type Notify = (title: string, body?: string, intent?: "success" | "error" | "info") => void;

export interface ReadingPaneProps {
  detail: MessageDetail | null;
  alwaysLoadRemote?: boolean;
  loading: boolean;
  onReply: (mode: ReplyMode) => void;
  onDelete: () => void;
  onNotify: Notify;
  /** Conversation of the message (incl. itself); the others are shown below it. */
  thread?: MessageSummary[];
  /** Reply to another message of the conversation. */
  onReplyTo?: (detail: MessageDetail, mode: ReplyMode) => void;
  accounts?: Account[];
}

/** Sandboxed, auto-sized mail body. */
function MailFrame({ detail, allowRemote }: { detail: MessageDetail; allowRemote: boolean }) {
  const s = useStyles();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  // Size the iframe to its content and open links in the system browser.
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const measure = () => setHeight(Math.max(120, doc.documentElement.scrollHeight + 4));
    measure();
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    doc.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) api.openExternal(href);
    });
  };
  return (
    <div className={s.paper}>
      <iframe
        ref={frame}
        className={s.frame}
        title="Nachrichtentext"
        // No scripts. allow-same-origin only lets the parent read the
        // (script-free) document for sizing and link handling.
        sandbox="allow-same-origin"
        srcDoc={buildMailDocument(detail.body, allowRemote)}
        style={{ height }}
        onLoad={onLoad}
      />
    </div>
  );
}

function Attachments({ detail, onNotify }: { detail: MessageDetail; onNotify: Notify }) {
  const s = useStyles();
  const attachments = detail.body.attachments.filter((a) => !a.isInline);
  if (!attachments.length) return null;
  const open = async (id: string, name: string) => {
    try {
      const path = await api.openAttachment(detail.summary.id, id, name);
      onNotify("Anhang gespeichert", path, "success");
    } catch (e) {
      onNotify("Anhang konnte nicht geöffnet werden", String(e), "error");
    }
  };
  return (
    <div className={s.attachments}>
      {attachments.map((a) => (
        <button key={a.id} className={s.attachment} onClick={() => open(a.id, a.name)} title={a.name}>
          <Document20Regular style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
          <span style={{ minWidth: 0 }}>
            <span className={s.attName}>{a.name}</span>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>{formatSize(a.size)}</Text>
          </span>
        </button>
      ))}
    </div>
  );
}

function ReplyButtons({ onReply, onDelete, size }: { onReply: (m: ReplyMode) => void; onDelete?: () => void; size?: "small" }) {
  return (
    <>
      <Tooltip content="Antworten" relationship="label">
        <Button size={size} appearance="subtle" icon={<ArrowReply20Regular />} onClick={() => onReply("reply")} />
      </Tooltip>
      <Tooltip content="Allen antworten" relationship="label">
        <Button size={size} appearance="subtle" icon={<ArrowReplyAll20Regular />} onClick={() => onReply("replyAll")} />
      </Tooltip>
      <Tooltip content="Weiterleiten" relationship="label">
        <Button size={size} appearance="subtle" icon={<ArrowForward20Regular />} onClick={() => onReply("forward")} />
      </Tooltip>
      {onDelete && (
        <Tooltip content="Löschen" relationship="label">
          <Button size={size} appearance="subtle" icon={<Delete20Regular />} onClick={onDelete} />
        </Tooltip>
      )}
    </>
  );
}

/** A collapsed / expandable other message of the conversation. */
function ThreadCard({ summary, allowRemote, onReplyTo, onNotify }: { summary: MessageSummary; allowRemote: boolean; onReplyTo?: ReadingPaneProps["onReplyTo"]; onNotify: Notify }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try {
        setDetail(await api.getMessage(summary.id));
      } catch (e) {
        onNotify("Nachricht konnte nicht geladen werden", String(e), "error");
        setOpen(false);
      }
    }
  };
  return (
    <div className={s.card}>
      <div className={s.cardHead} onClick={toggle}>
        {open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
        <Avatar name={displayName(summary.from)} size={28} color="colorful" />
        <div className={s.cardText}>
          <span className={s.ellipsis}>
            <strong>{displayName(summary.from)}</strong>
          </span>
          {!open && <span className={mergeClasses(s.muted, s.ellipsis)}>{summary.preview}</span>}
        </div>
        <span className={s.muted} style={{ flexShrink: 0 }}>{longDate(summary.date)}</span>
      </div>
      {open && (
        <div className={s.cardBody}>
          {!detail ? (
            <Spinner size="tiny" />
          ) : (
            <>
              <div style={{ display: "flex", gap: 2, alignItems: "center", marginBottom: 8 }}>
                <span className={s.muted} style={{ flex: 1 }}>An: {detail.summary.to.map(displayName).join("; ")}</span>
                {onReplyTo && <ReplyButtons size="small" onReply={(mode) => onReplyTo(detail, mode)} />}
              </div>
              <Attachments detail={detail} onNotify={onNotify} />
              <MailFrame detail={detail} allowRemote={allowRemote} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ReadingPane({ detail, alwaysLoadRemote, loading, onReply, onDelete, onNotify, thread, onReplyTo, accounts }: ReadingPaneProps) {
  const s = useStyles();
  const [allowRemote, setAllowRemote] = useState(false);

  useEffect(() => setAllowRemote(!!alwaysLoadRemote), [detail?.summary.id, alwaysLoadRemote]);

  if (!detail) {
    return (
      <section className={s.root}>
        <div className={s.empty}>
          {loading ? (
            <Spinner label="Wird geladen…" />
          ) : (
            <>
              <MailRead48Regular style={{ fontSize: 64, color: tokens.colorBrandForeground2 }} />
              <Text weight="semibold" size={400}>Wählen Sie ein Element aus, um es zu lesen</Text>
              <Text>Nichts ausgewählt</Text>
            </>
          )}
        </div>
      </section>
    );
  }

  const m = detail.summary;
  const remote = !!detail.body.html && hasRemoteContent(detail.body.html);
  const others = (thread ?? []).filter((x) => x.id !== m.id).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className={s.root} aria-label="Lesebereich">
      <div className={s.scroll}>
        <div className={s.subject}>
          <span style={{ flex: 1 }}>{m.subject || "(Kein Betreff)"}</span>
          {m.isFlagged && <Flag20Filled style={{ color: tokens.colorPaletteRedForeground1, marginTop: 4 }} />}
        </div>
        {!!m.categories?.length && (
          <div className={s.cats}>
            <CategoryChips categories={m.categories} size="medium" />
          </div>
        )}
        <div className={s.head}>
          <Avatar name={displayName(m.from)} size={40} color="colorful" />
          <div className={s.meta}>
            <span>
              <span className={s.sender}>{displayName(m.from)}</span>{" "}
              {m.from?.name && <span className={s.muted}>&lt;{m.from.email}&gt;</span>}
            </span>
            {m.to.length > 0 && <span className={s.muted}>An: {m.to.map(displayName).join("; ")}</span>}
            {m.cc.length > 0 && <span className={s.muted}>Cc: {m.cc.map(displayName).join("; ")}</span>}
            <span className={s.muted}>{longDate(m.date)}</span>
          </div>
          <div className={s.actions}>
            <ReplyButtons onReply={onReply} onDelete={onDelete} />
          </div>
        </div>

        {remote && !allowRemote && (
          <MessageBar intent="info" style={{ marginBottom: 12 }}>
            <MessageBarBody>Externe Bilder wurden zum Schutz Ihrer Privatsphäre blockiert.</MessageBarBody>
            <MessageBarActions>
              <Button size="small" icon={<Image20Regular />} onClick={() => setAllowRemote(true)}>
                Bilder anzeigen
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}

        <SecurityBar detail={detail} onNotify={onNotify} />
        <InvitationBar detail={detail} accounts={accounts ?? []} onNotify={onNotify} />
        <Attachments detail={detail} onNotify={onNotify} />
        <MailFrame detail={detail} allowRemote={allowRemote} />
        {detail.body.html === null && detail.body.text === null && (
          <Text>
            Kein Inhalt. <Link onClick={() => onReply("reply")}>Antworten</Link>
          </Text>
        )}

        {others.length > 0 && (
          <>
            <div className={s.threadHead}>
              {others.length === 1 ? "1 weitere Nachricht" : `${others.length} weitere Nachrichten`} in dieser Unterhaltung
            </div>
            {others.map((o) => (
              <ThreadCard key={o.id} summary={o} allowRemote={allowRemote} onReplyTo={onReplyTo} onNotify={onNotify} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}
