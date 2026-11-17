import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dropdown,
  Input,
  Option,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Delete20Regular,
  Send20Filled,
  TextBold20Regular,
  TextBulletListLtr20Regular,
  TextItalic20Regular,
  TextNumberListLtr20Regular,
  TextUnderline20Regular,
  Link20Regular,
} from "@fluentui/react-icons";
import type { Account, Address, MessageDetail, OutgoingMessage } from "../../lib/types";
import { displayName, escapeHtml, formatAddress, longDate, parseAddresses } from "../../lib/format";
import { sanitizeHtml } from "../../lib/html";

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
  top: { display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 4px" },
  fields: { display: "flex", flexDirection: "column", padding: "0 16px" },
  field: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    minHeight: "40px",
  },
  label: { width: "44px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase300 },
  input: { flex: 1 },
  toolbar: { padding: "4px 12px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  editor: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    outline: "none",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground1,
    "& blockquote": { margin: "0 0 0 8px", paddingLeft: "10px", borderLeft: `2px solid ${tokens.colorNeutralStroke1}`, color: tokens.colorNeutralForeground2 },
  },
});

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export interface ComposeState {
  mode: ComposeMode;
  accountId: string;
  original?: MessageDetail;
}

function prefix(subject: string, p: string) {
  return subject.toLowerCase().startsWith(p.toLowerCase()) ? subject : `${p} ${subject}`;
}

function initialValues(state: ComposeState, accounts: Account[]) {
  const o = state.original;
  if (!o || state.mode === "new") return { to: "", cc: "", subject: "", body: "<p><br></p>" };
  const me = accounts.find((a) => a.id === state.accountId)?.email.toLowerCase();
  const m = o.summary;
  const header = `<p><br></p><hr><p><b>Von:</b> ${escapeHtml(m.from ? formatAddress(m.from) : "")}<br>
<b>Gesendet:</b> ${escapeHtml(longDate(m.date))}<br>
<b>An:</b> ${escapeHtml(m.to.map(formatAddress).join("; "))}<br>
<b>Betreff:</b> ${escapeHtml(m.subject)}</p>`;
  const quoted = o.body.html ? sanitizeHtml(o.body.html) : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(o.body.text ?? "")}</pre>`;
  const body = `<p><br></p>${header}<blockquote>${quoted}</blockquote>`;

  if (state.mode === "forward") return { to: "", cc: "", subject: prefix(m.subject, "WG:"), body };
  const to: Address[] = m.from ? [m.from] : [];
  let cc: Address[] = [];
  if (state.mode === "replyAll") {
    const seen = new Set([me, ...to.map((a) => a.email.toLowerCase())]);
    cc = [...m.to, ...m.cc].filter((a) => !seen.has(a.email.toLowerCase()) && (seen.add(a.email.toLowerCase()), true));
  }
  return { to: to.map(formatAddress).join("; "), cc: cc.map(formatAddress).join("; "), subject: prefix(m.subject, "AW:"), body };
}

export interface ComposeProps {
  state: ComposeState;
  accounts: Account[];
  onSend: (accountId: string, message: OutgoingMessage) => Promise<void>;
  onDiscard: () => void;
}

export function Compose({ state, accounts, onSend, onDiscard }: ComposeProps) {
  const s = useStyles();
  const init = useRef(initialValues(state, accounts));
  const [accountId, setAccountId] = useState(state.accountId);
  const [to, setTo] = useState(init.current.to);
  const [cc, setCc] = useState(init.current.cc);
  const [showCc, setShowCc] = useState(!!init.current.cc);
  const [subject, setSubject] = useState(init.current.subject);
  const [sending, setSending] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");

  useEffect(() => {
    if (editor.current) {
      editor.current.innerHTML = init.current.body;
      if (state.mode !== "new") {
        editor.current.focus();
        const range = document.createRange();
        range.setStart(editor.current, 0);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  }, [state.mode]);

  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    // execCommand is deprecated but still the simplest way to get basic
    // rich-text editing in a contentEditable. A proper editor follows with Mirra Text.
    document.execCommand(cmd, false, value);
  };

  const send = async () => {
    const recipients = parseAddresses(to);
    if (recipients.length === 0) return;
    setSending(true);
    try {
      await onSend(accountId, {
        to: recipients,
        cc: parseAddresses(cc),
        bcc: [],
        subject,
        bodyHtml: editor.current?.innerHTML ?? "",
        inReplyTo: state.mode === "reply" || state.mode === "replyAll" ? state.original?.summary.internetMessageId : null,
      });
    } finally {
      setSending(false);
    }
  };

  const account = accounts.find((a) => a.id === accountId);

  return (
    <section
      className={s.root}
      aria-label="Nachricht verfassen"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
      }}
    >
      <div className={s.top}>
        <Button appearance="primary" icon={<Send20Filled />} disabled={sending || !to.trim()} onClick={send}>
          {sending ? "Wird gesendet…" : "Senden"}
        </Button>
        <Button appearance="subtle" icon={<Delete20Regular />} onClick={onDiscard}>Verwerfen</Button>
      </div>
      <div className={s.fields}>
        <div className={s.field}>
          <span className={s.label}>Von</span>
          <Dropdown
            appearance="underline"
            className={s.input}
            value={account ? `${displayName({ name: account.displayName, email: account.email })} <${account.email}>` : ""}
            selectedOptions={[accountId]}
            onOptionSelect={(_, d) => d.optionValue && setAccountId(d.optionValue)}
          >
            {accounts.map((a) => (
              <Option key={a.id} value={a.id} text={`${a.displayName} <${a.email}>`}>
                {a.displayName} &lt;{a.email}&gt;
              </Option>
            ))}
          </Dropdown>
        </div>
        <div className={s.field}>
          <span className={s.label}>An</span>
          <Input appearance="underline" className={s.input} value={to} onChange={(_, d) => setTo(d.value)} autoFocus={state.mode === "new" || state.mode === "forward"} />
          {!showCc && <Button appearance="transparent" size="small" onClick={() => setShowCc(true)}>Cc</Button>}
        </div>
        {showCc && (
          <div className={s.field}>
            <span className={s.label}>Cc</span>
            <Input appearance="underline" className={s.input} value={cc} onChange={(_, d) => setCc(d.value)} />
          </div>
        )}
        <div className={s.field}>
          <Input appearance="underline" className={s.input} placeholder="Betreff hinzufügen" value={subject} onChange={(_, d) => setSubject(d.value)} />
        </div>
      </div>
      <Toolbar size="small" className={s.toolbar}>
        <Tooltip content="Fett (Strg+B)" relationship="label"><ToolbarButton icon={<TextBold20Regular />} onClick={() => exec("bold")} /></Tooltip>
        <Tooltip content="Kursiv (Strg+I)" relationship="label"><ToolbarButton icon={<TextItalic20Regular />} onClick={() => exec("italic")} /></Tooltip>
        <Tooltip content="Unterstrichen (Strg+U)" relationship="label"><ToolbarButton icon={<TextUnderline20Regular />} onClick={() => exec("underline")} /></Tooltip>
        <ToolbarDivider />
        <Tooltip content="Aufzählung" relationship="label"><ToolbarButton icon={<TextBulletListLtr20Regular />} onClick={() => exec("insertUnorderedList")} /></Tooltip>
        <Tooltip content="Nummerierung" relationship="label"><ToolbarButton icon={<TextNumberListLtr20Regular />} onClick={() => exec("insertOrderedList")} /></Tooltip>
        <ToolbarDivider />
        <Popover open={linkOpen} onOpenChange={(_, d) => setLinkOpen(d.open)} trapFocus>
          <PopoverTrigger disableButtonEnhancement>
            <Tooltip content="Link einfügen" relationship="label">
              <ToolbarButton
                icon={<Link20Regular />}
                onMouseDown={() => {
                  // Remember the selection before focus moves to the popover.
                  const sel = window.getSelection();
                  savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
                }}
              />
            </Tooltip>
          </PopoverTrigger>
          <PopoverSurface>
            <form
              style={{ display: "flex", gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (/^(https?:|mailto:)/i.test(linkUrl)) {
                  editor.current?.focus();
                  if (savedRange.current) {
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(savedRange.current);
                  }
                  exec("createLink", linkUrl);
                }
                setLinkOpen(false);
              }}
            >
              <Input value={linkUrl} onChange={(_, d) => setLinkUrl(d.value)} style={{ width: 260 }} />
              <Button type="submit" appearance="primary">Einfügen</Button>
            </form>
          </PopoverSurface>
        </Popover>
      </Toolbar>
      <div ref={editor} className={s.editor} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="Nachrichtentext" />
    </section>
  );
}
