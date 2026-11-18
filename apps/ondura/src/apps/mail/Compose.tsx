import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
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
  Attach20Regular,
  Delete20Regular,
  Dismiss12Regular,
  Document20Regular,
  Link20Regular,
  Save20Regular,
  Send20Filled,
  TextBold20Regular,
  TextBulletListLtr20Regular,
  TextItalic20Regular,
  TextNumberListLtr20Regular,
  TextUnderline20Regular,
} from "@fluentui/react-icons";
import type { Account, Address, MessageDetail, OutgoingAttachment, OutgoingMessage } from "../../lib/types";
import { RecipientInput } from "./RecipientInput";
import { SendLaterButton } from "./SendLater";
import { escapeHtml, formatAddress, longDate, parseAddresses } from "../../lib/format";
import { sanitizeHtml } from "../../lib/html";
import { api } from "../../lib/api";

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
  top: { display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 4px", flexWrap: "wrap" },
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
  attachments: { display: "flex", flexWrap: "wrap", gap: "6px", padding: "8px 16px 0" },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 4px 4px 8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    maxWidth: "240px",
  },
  chipName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
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
    "& .nexora-signature": { color: tokens.colorNeutralForeground2 },
  },
});

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft" | "edit";

export interface ComposeState {
  mode: ComposeMode;
  accountId: string;
  /** Message replied to / forwarded / the draft being continued. */
  original?: MessageDetail;
  /** Pre-filled message (e.g. from the outbox). */
  preset?: OutgoingMessage;
}

interface AttachmentItem {
  key: string;
  name: string;
  attachment: OutgoingAttachment;
}

function prefix(subject: string, p: string) {
  return subject.toLowerCase().startsWith(p.toLowerCase()) ? subject : `${p} ${subject}`;
}

function signatureBlock(account?: Account) {
  return account?.signature ? `<div class="nexora-signature"><br>${sanitizeHtml(account.signature)}</div>` : "";
}

const basename = (path: string) => path.split(/[\\/]/).pop() || path;

function messageAttachments(d: MessageDetail): AttachmentItem[] {
  return d.body.attachments
    .filter((a) => !a.isInline)
    .map((a) => ({
      key: `${d.summary.id}:${a.id}`,
      name: a.name,
      attachment: { source: "message", messageId: d.summary.id, attachmentId: a.id, name: a.name, contentType: a.contentType },
    }));
}

function attachmentItems(list: OutgoingAttachment[] = []): AttachmentItem[] {
  return list.map((a, i) => ({ key: `preset-${i}`, name: a.source === "file" ? basename(a.path) : a.name, attachment: a }));
}

function initialValues(state: ComposeState, accounts: Account[]) {
  const account = accounts.find((a) => a.id === state.accountId);
  const sig = signatureBlock(account);
  const join = (list: Address[]) => list.map(formatAddress).join("; ");

  if (state.mode === "edit" && state.preset) {
    const p = state.preset;
    return { to: join(p.to), cc: join(p.cc), subject: p.subject, body: p.bodyHtml, attachments: attachmentItems(p.attachments), draftId: p.draftId ?? null };
  }
  const o = state.original;
  if (!o || state.mode === "new") {
    return { to: "", cc: "", subject: "", body: `<p><br></p>${sig}`, attachments: [] as AttachmentItem[], draftId: null };
  }
  const m = o.summary;
  const originalHtml = o.body.html ? sanitizeHtml(o.body.html) : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(o.body.text ?? "")}</pre>`;
  if (state.mode === "draft") {
    return { to: join(m.to), cc: join(m.cc), subject: m.subject, body: originalHtml, attachments: messageAttachments(o), draftId: m.id };
  }

  const header = `<hr><p><b>Von:</b> ${escapeHtml(m.from ? formatAddress(m.from) : "")}<br>
<b>Gesendet:</b> ${escapeHtml(longDate(m.date))}<br>
<b>An:</b> ${escapeHtml(join(m.to))}<br>
${m.cc.length ? `<b>Cc:</b> ${escapeHtml(join(m.cc))}<br>` : ""}<b>Betreff:</b> ${escapeHtml(m.subject)}</p>`;
  const body = `<p><br></p>${sig}${header}<blockquote>${originalHtml}</blockquote>`;

  if (state.mode === "forward") {
    return { to: "", cc: "", subject: prefix(m.subject, "WG:"), body, attachments: messageAttachments(o), draftId: null };
  }
  const me = account?.email.toLowerCase();
  const to: Address[] = m.from && m.from.email.toLowerCase() !== me ? [m.from] : m.to;
  let cc: Address[] = [];
  if (state.mode === "replyAll") {
    const seen = new Set([me, ...to.map((a) => a.email.toLowerCase())]);
    cc = [...m.to, ...m.cc].filter((a) => {
      const k = a.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return { to: join(to), cc: join(cc), subject: prefix(m.subject, "AW:"), body, attachments: [] as AttachmentItem[], draftId: null };
}

export interface ComposeProps {
  state: ComposeState;
  accounts: Account[];
  onSend: (accountId: string, message: OutgoingMessage) => Promise<void>;
  onSaveDraft: (accountId: string, message: OutgoingMessage) => Promise<void>;
  onClose: () => void;
}

export function Compose({ state, accounts, onSend, onSaveDraft, onClose }: ComposeProps) {
  const s = useStyles();
  // Computed once per compose session; later account list updates must not reset the form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const init = useMemo(() => initialValues(state, accounts), [state]);
  const [accountId, setAccountId] = useState(state.accountId);
  const [to, setTo] = useState(init.to);
  const [cc, setCc] = useState(init.cc);
  const [showCc, setShowCc] = useState(!!init.cc);
  const [subject, setSubject] = useState(init.subject);
  const [attachments, setAttachments] = useState<AttachmentItem[]>(init.attachments);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(state.mode === "edit");
  const [confirmClose, setConfirmClose] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");

  useEffect(() => {
    if (!editor.current) return;
    editor.current.innerHTML = init.body;
    if (state.mode === "new" || state.mode === "forward") return; // focus stays in "To"
    editor.current.focus();
    const range = document.createRange();
    range.setStart(editor.current, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [init, state.mode]);

  // Swap the signature when the sending account changes.
  const changeAccount = (id: string) => {
    setAccountId(id);
    const html = signatureBlock(accounts.find((a) => a.id === id));
    const block = editor.current?.querySelector(".nexora-signature");
    if (block) {
      if (html) block.outerHTML = html;
      else block.remove();
    }
  };

  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    // execCommand is deprecated but still the simplest way to get basic
    // rich-text editing in a contentEditable; Nexora Text brings a real editor.
    document.execCommand(cmd, false, value);
    setDirty(true);
  };

  const message = (): OutgoingMessage => ({
    to: parseAddresses(to),
    cc: parseAddresses(cc),
    bcc: [],
    subject,
    bodyHtml: editor.current?.innerHTML ?? "",
    inReplyTo: state.mode === "reply" || state.mode === "replyAll" ? state.original?.summary.internetMessageId : null,
    attachments: attachments.map((a) => a.attachment),
    draftId: init.draftId,
  });

  const send = async (sendAt?: Date) => {
    if (parseAddresses(to).length === 0 || busy) return;
    setBusy(true);
    try {
      await onSend(accountId, { ...message(), sendAt: sendAt ? sendAt.toISOString() : null });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSaveDraft(accountId, message());
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    const paths = await api.pickFiles();
    if (paths.length === 0) return;
    setAttachments((list) => [...list, ...paths.map((p) => ({ key: p, name: basename(p), attachment: { source: "file", path: p } as const }))]);
    setDirty(true);
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());
  const account = accounts.find((x) => x.id === accountId);

  return (
    <section
      className={s.root}
      aria-label="Nachricht verfassen"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveDraft();
        }
      }}
    >
      <div className={s.top}>
        <SendLaterButton disabled={busy || !to.trim()} icon={<Send20Filled />} onSend={() => send()} onSendAt={(d) => send(d)} />
        <Button appearance="subtle" icon={<Attach20Regular />} onClick={attach}>Anfügen</Button>
        <Button appearance="subtle" icon={<Save20Regular />} disabled={busy} onClick={saveDraft}>Entwurf speichern</Button>
        <Button appearance="subtle" icon={<Delete20Regular />} onClick={requestClose}>Verwerfen</Button>
      </div>
      <div className={s.fields}>
        <div className={s.field}>
          <span className={s.label}>Von</span>
          <Dropdown
            appearance="underline"
            className={s.input}
            value={account ? `${account.displayName} <${account.email}>` : ""}
            selectedOptions={[accountId]}
            onOptionSelect={(_, d) => d.optionValue && changeAccount(d.optionValue)}
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
          <RecipientInput
            className={s.input}
            value={to}
            onChange={(v) => (setTo(v), setDirty(true))}
            autoFocus={state.mode === "new" || state.mode === "forward"}
          />
          {!showCc && <Button appearance="transparent" size="small" onClick={() => setShowCc(true)}>Cc</Button>}
        </div>
        {showCc && (
          <div className={s.field}>
            <span className={s.label}>Cc</span>
            <RecipientInput className={s.input} value={cc} onChange={(v) => (setCc(v), setDirty(true))} />
          </div>
        )}
        <div className={s.field}>
          <Input
            appearance="underline"
            className={s.input}
            placeholder="Betreff hinzufügen"
            value={subject}
            onChange={(_, d) => (setSubject(d.value), setDirty(true))}
          />
        </div>
      </div>
      {attachments.length > 0 && (
        <div className={s.attachments}>
          {attachments.map((a) => (
            <span key={a.key} className={s.chip} title={a.name}>
              <Document20Regular style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
              <span className={s.chipName}>{a.name}</span>
              <Button
                size="small"
                appearance="transparent"
                icon={<Dismiss12Regular />}
                aria-label={`${a.name} entfernen`}
                onClick={() => (setAttachments((l) => l.filter((x) => x.key !== a.key)), setDirty(true))}
              />
            </span>
          ))}
        </div>
      )}
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
        <ToolbarDivider />
        <Tooltip content="Datei anfügen" relationship="label"><ToolbarButton icon={<Attach20Regular />} onClick={attach} /></Tooltip>
      </Toolbar>
      <div
        ref={editor}
        className={s.editor}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Nachrichtentext"
        onInput={() => setDirty(true)}
      />

      <Dialog open={confirmClose} onOpenChange={(_, d) => setConfirmClose(d.open)}>
        <DialogSurface style={{ maxWidth: 440 }}>
          <DialogBody>
            <DialogTitle>Entwurf speichern?</DialogTitle>
            <DialogContent>Die Nachricht wurde noch nicht gesendet. Möchten Sie sie als Entwurf speichern?</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => (setConfirmClose(false), saveDraft())}>Speichern</Button>
              <Button onClick={() => (setConfirmClose(false), onClose())}>Verwerfen</Button>
              <Button appearance="subtle" onClick={() => setConfirmClose(false)}>Abbrechen</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
