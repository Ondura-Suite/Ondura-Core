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
  ToggleButton,
  Tooltip,
  MessageBar,
  MessageBarBody,
  Menu,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Avatar,
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
  Certificate20Regular,
  LockClosed20Regular,
  Important20Regular,
  ArrowDown20Regular,
  Settings20Regular,
} from "@fluentui/react-icons";
import { suggestPeople, type Suggestion } from "./RecipientInput";
import { VOTE_PRESETS, voteBlock } from "./MailExtras";
import type { Account, Address, Importance, MessageDetail, OutgoingAttachment, OutgoingMessage } from "../../lib/types";
import { DropOverlay, fileBase64, useFileDrop } from "../../shell/fileDrop";
import { RecipientInput } from "./RecipientInput";
import { SendLaterButton } from "./SendLater";
import { escapeHtml, formatAddress, longDate, parseAddresses } from "../../lib/format";
import { sanitizeHtml } from "../../lib/html";
import { api } from "../../lib/api";
import { tl } from "../../lib/i18n";

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
    "& .ondura-signature": { color: tokens.colorNeutralForeground2 },
    "& a.ondura-mention": { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold, textDecoration: "none" },
  },
  mentions: {
    position: "fixed",
    zIndex: 1000,
    minWidth: "280px",
    padding: "4px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
  },
  mention: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: tokens.borderRadiusSmall, cursor: "pointer" },
  mentionActive: { backgroundColor: tokens.colorNeutralBackground1Hover },
  mentionMail: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft" | "edit";

export interface ComposeState {
  mode: ComposeMode;
  accountId: string;
  /** Message replied to / forwarded / the draft being continued. */
  original?: MessageDetail;
  /** Pre-filled message (e.g. from the outbox). */
  preset?: OutgoingMessage;
  /** Recipients of a forward (quick steps). */
  forwardTo?: string;
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
  return account?.signature ? `<div class="ondura-signature"><br>${sanitizeHtml(account.signature)}</div>` : "";
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
    // A preset fills a new message, e.g. from a mailto: link (Bcc is not offered by the compose form and is dropped).
    const p = state.preset;
    return { to: p ? join(p.to) : "", cc: p ? join(p.cc) : "", subject: p?.subject ?? "", body: `${p?.bodyHtml || "<p><br></p>"}${sig}`, attachments: [] as AttachmentItem[], draftId: null };
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
    return { to: state.forwardTo ?? "", cc: "", subject: prefix(m.subject, "WG:"), body, attachments: messageAttachments(o), draftId: null };
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

const SIGN_KEY = "ondura-mail.smime.sign";

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
  // S/MIME: signing is on by default once a certificate exists; replies to
  // encrypted messages are encrypted again.
  const [canSign, setCanSign] = useState(false);
  const [sign, setSign] = useState(false);
  const [encrypt, setEncrypt] = useState(!!state.original?.body.security?.encrypted && state.mode !== "forward");
  const [missingCerts, setMissingCerts] = useState<string[]>([]);
  const editor = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [importance, setImportance] = useState<Importance>(state.preset?.importance ?? "normal");
  const [readReceipt, setReadReceipt] = useState(!!state.preset?.readReceipt);
  const [deliveryReceipt, setDeliveryReceipt] = useState(!!state.preset?.deliveryReceipt);
  const [sendAs, setSendAs] = useState(state.preset?.from ? formatAddress(state.preset.from) : "");
  const [showSendAs, setShowSendAs] = useState(!!state.preset?.from);
  const [voteOpen, setVoteOpen] = useState(false);
  const [voteText, setVoteText] = useState("");
  // @mentions in the body
  const [mention, setMention] = useState<{ query: string; x: number; y: number; items: Suggestion[]; active: number } | null>(null);
  const mentionRange = useRef<Range | null>(null);

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

  const fromEmail = accounts.find((a) => a.id === accountId)?.email ?? "";
  useEffect(() => {
    let off = false;
    api.smimeCanSign(fromEmail).then((ok) => {
      if (off) return;
      setCanSign(ok);
      setSign(ok && localStorage.getItem(SIGN_KEY) !== "off");
    }, () => setCanSign(false));
    return () => {
      off = true;
    };
  }, [fromEmail]);

  useEffect(() => {
    if (!encrypt) return setMissingCerts([]);
    const emails = [...parseAddresses(to), ...parseAddresses(cc)].map((a) => a.email);
    const t = setTimeout(() => api.smimeMissing(emails).then(setMissingCerts, () => setMissingCerts([])), 300);
    return () => clearTimeout(t);
  }, [encrypt, to, cc]);

  // Swap the signature when the sending account changes.
  const changeAccount = (id: string) => {
    setAccountId(id);
    const html = signatureBlock(accounts.find((a) => a.id === id));
    const block = editor.current?.querySelector(".ondura-signature");
    if (block) {
      if (html) block.outerHTML = html;
      else block.remove();
    }
  };

  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    // execCommand is deprecated but still the simplest way to get basic
    // rich-text editing in a contentEditable; Ondura Text brings a real editor.
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
    sign: sign && canSign,
    encrypt,
    importance,
    readReceipt,
    deliveryReceipt,
    from: showSendAs ? parseAddresses(sendAs)[0] ?? null : null,
  });

  /** Look for "@name" right before the caret and offer people for it. */
  const checkMention = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return setMention(null);
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !editor.current?.contains(node)) return setMention(null);
    const before = (node.textContent ?? "").slice(0, sel.anchorOffset);
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}._-]{1,40})$/u);
    if (!m) return setMention(null);
    const range = document.createRange();
    range.setStart(node, sel.anchorOffset - m[1].length - 1);
    range.setEnd(node, sel.anchorOffset);
    mentionRange.current = range;
    const rect = range.getBoundingClientRect();
    const query = m[1];
    setMention((cur) => ({ query, x: rect.left, y: rect.bottom + 4, items: cur?.query === query ? cur.items : cur?.items ?? [], active: 0 }));
    void suggestPeople(query, 6).then((items) => setMention((cur) => (cur && cur.query === query ? { ...cur, items } : cur)));
  };

  const pickMention = (p: Suggestion) => {
    const range = mentionRange.current;
    setMention(null);
    if (!range) return;
    const a = document.createElement("a");
    a.href = `mailto:${p.email}`;
    a.className = "ondura-mention";
    a.textContent = `@${p.name}`;
    range.deleteContents();
    range.insertNode(a);
    const space = document.createTextNode("\u00a0");
    a.after(space);
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStartAfter(space);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    // Mentioned people are added to "To".
    if (!parseAddresses(to).some((x) => x.email.toLowerCase() === p.email.toLowerCase())) {
      const addr = formatAddress({ name: p.name, email: p.email });
      setTo((v) => (v.trim() ? `${v.trim().replace(/[,;]$/, "")}; ${addr}` : addr));
    }
    setDirty(true);
  };

  const insertVote = (options: string[]) => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return;
    editor.current?.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.current?.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(editor.current!);
      r.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    const replyTo = (showSendAs && parseAddresses(sendAs)[0]?.email) || fromEmail;
    exec("insertHTML", voteBlock(opts, replyTo, subject));
  };

  const send = async (sendAt?: Date) => {
    if (parseAddresses(to).length === 0 || busy || (encrypt && missingCerts.length > 0)) return;
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

  // Files dropped onto the message become attachments.
  const drop = useFileDrop(async (files) => {
    const items = await Promise.all(
      files.map(async (f, i) => ({
        key: `drop-${Date.now()}-${i}`,
        name: f.name,
        attachment: { source: "data", name: f.name, contentType: f.type, data: await fileBase64(f) } as const,
      })),
    );
    setAttachments((list) => [...list, ...items]);
    setDirty(true);
  });

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
      style={{ position: "relative" }}
      {...drop.props}
      aria-label={tl("Nachricht verfassen")}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveDraft();
        }
      }}
    >
      {drop.over && <DropOverlay label={tl("Dateien hier ablegen, um sie anzufügen")} />}
      <div className={s.top}>
        <SendLaterButton disabled={busy || !to.trim() || (encrypt && missingCerts.length > 0)} icon={<Send20Filled />} onSend={() => send()} onSendAt={(d) => send(d)} />
        <Button appearance="subtle" icon={<Attach20Regular />} onClick={attach}>{tl("Anfügen")}</Button>
        <Button appearance="subtle" icon={<Save20Regular />} disabled={busy} onClick={saveDraft}>{tl("Entwurf speichern")}</Button>
        <Button appearance="subtle" icon={<Delete20Regular />} onClick={requestClose}>{tl("Verwerfen")}</Button>
        <Tooltip content={canSign ? tl("Mit Ihrem S/MIME-Zertifikat digital signieren") : tl("Kein S/MIME-Zertifikat für dieses Konto (Einstellungen › S/MIME)")} relationship="description">
          <ToggleButton
            appearance="subtle"
            icon={<Certificate20Regular />}
            checked={sign && canSign}
            disabled={!canSign}
            onClick={() =>
              setSign((v) => {
                try {
                  localStorage.setItem(SIGN_KEY, v ? "off" : "on");
                } catch {
                  /* ignore */
                }
                return !v;
              })
            }
          >
            {tl("Signieren")}
          </ToggleButton>
        </Tooltip>
        <Tooltip content={tl("Mit S/MIME verschlüsseln – nur die Empfänger können die Nachricht lesen")} relationship="description">
          <ToggleButton appearance="subtle" icon={<LockClosed20Regular />} checked={encrypt} onClick={() => setEncrypt((v) => !v)}>
            {tl("Verschlüsseln")}
          </ToggleButton>
        </Tooltip>
        {importance === "high" && <Important20Regular style={{ color: tokens.colorPaletteRedForeground1 }} aria-label={tl("Wichtigkeit: hoch")} />}
        {importance === "low" && <ArrowDown20Regular style={{ color: tokens.colorBrandForeground1 }} aria-label={tl("Wichtigkeit: niedrig")} />}
        <Menu
          checkedValues={{ opts: [readReceipt && "read", deliveryReceipt && "delivery", showSendAs && "from"].filter(Boolean) as string[], imp: [importance] }}
          onCheckedValueChange={(_, d) => {
            if (d.name === "imp") setImportance((d.checkedItems.find((x) => x !== importance) ?? "normal") as Importance);
            else {
              setReadReceipt(d.checkedItems.includes("read"));
              setDeliveryReceipt(d.checkedItems.includes("delivery"));
              setShowSendAs(d.checkedItems.includes("from"));
            }
            setDirty(true);
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="subtle" icon={<Settings20Regular />}>{tl("Optionen")}</Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItemCheckbox name="imp" value="high" icon={<Important20Regular />}>
                {tl("Wichtigkeit: hoch")}
              </MenuItemCheckbox>
              <MenuItemCheckbox name="imp" value="low" icon={<ArrowDown20Regular />}>
                {tl("Wichtigkeit: niedrig")}
              </MenuItemCheckbox>
              <MenuItemCheckbox name="opts" value="read">{tl("Lesebestätigung anfordern")}</MenuItemCheckbox>
              <MenuItemCheckbox name="opts" value="delivery">{tl("Übermittlungsbestätigung anfordern")}</MenuItemCheckbox>
              <MenuItemCheckbox name="opts" value="from">{tl("Von anderer Adresse senden (Stellvertretung)")}</MenuItemCheckbox>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{tl("Abstimmungsschaltflächen")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {VOTE_PRESETS.map((p) => (
                      <MenuItem key={p.join(";")} onClick={() => insertVote(p)}>{p.join("; ")}</MenuItem>
                    ))}
                    <MenuItem onClick={() => setVoteOpen(true)}>{tl("Benutzerdefiniert…")}</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      {encrypt && missingCerts.length > 0 && (
        <MessageBar intent="warning" style={{ margin: "0 16px" }}>
          <MessageBarBody>
            {tl("Kein Zertifikat für")} {missingCerts.join(", ")}{tl(". Zertifikate werden bekannt, sobald Ihnen die Person eine signierte Nachricht schickt.")}
          </MessageBarBody>
        </MessageBar>
      )}
      <div className={s.fields}>
        <div className={s.field}>
          <span className={s.label}>{tl("Von")}</span>
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
        {showSendAs && (
          <div className={s.field}>
            <span className={s.label}>{tl("Als")}</span>
            <RecipientInput className={s.input} value={sendAs} onChange={(v) => (setSendAs(v), setDirty(true))} />
          </div>
        )}
        <div className={s.field}>
          <span className={s.label}>{tl("An")}</span>
          <RecipientInput
            className={s.input}
            value={to}
            onChange={(v) => (setTo(v), setDirty(true))}
            autoFocus={state.mode === "new" || state.mode === "forward"}
          />
          {!showCc && <Button appearance="transparent" size="small" onClick={() => setShowCc(true)}>{tl("Cc")}</Button>}
        </div>
        {showCc && (
          <div className={s.field}>
            <span className={s.label}>{tl("Cc")}</span>
            <RecipientInput className={s.input} value={cc} onChange={(v) => (setCc(v), setDirty(true))} />
          </div>
        )}
        <div className={s.field}>
          <Input
            appearance="underline"
            className={s.input}
            placeholder={tl("Betreff hinzufügen")}
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
                aria-label={tl("{0} entfernen", a.name)}
                onClick={() => (setAttachments((l) => l.filter((x) => x.key !== a.key)), setDirty(true))}
              />
            </span>
          ))}
        </div>
      )}
      <Toolbar size="small" className={s.toolbar}>
        <Tooltip content={tl("Fett (Strg+B)")} relationship="label"><ToolbarButton icon={<TextBold20Regular />} onClick={() => exec("bold")} /></Tooltip>
        <Tooltip content={tl("Kursiv (Strg+I)")} relationship="label"><ToolbarButton icon={<TextItalic20Regular />} onClick={() => exec("italic")} /></Tooltip>
        <Tooltip content={tl("Unterstrichen (Strg+U)")} relationship="label"><ToolbarButton icon={<TextUnderline20Regular />} onClick={() => exec("underline")} /></Tooltip>
        <ToolbarDivider />
        <Tooltip content={tl("Aufzählung")} relationship="label"><ToolbarButton icon={<TextBulletListLtr20Regular />} onClick={() => exec("insertUnorderedList")} /></Tooltip>
        <Tooltip content={tl("Nummerierung")} relationship="label"><ToolbarButton icon={<TextNumberListLtr20Regular />} onClick={() => exec("insertOrderedList")} /></Tooltip>
        <ToolbarDivider />
        <Popover open={linkOpen} onOpenChange={(_, d) => setLinkOpen(d.open)} trapFocus>
          <PopoverTrigger disableButtonEnhancement>
            <Tooltip content={tl("Link einfügen")} relationship="label">
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
              <Button type="submit" appearance="primary">{tl("Einfügen")}</Button>
            </form>
          </PopoverSurface>
        </Popover>
        <ToolbarDivider />
        <Tooltip content={tl("Datei anfügen")} relationship="label"><ToolbarButton icon={<Attach20Regular />} onClick={attach} /></Tooltip>
      </Toolbar>
      <div
        ref={editor}
        className={s.editor}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label={tl("Nachrichtentext")}
        onInput={() => (setDirty(true), checkMention())}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        onKeyDown={(e) => {
          if (!mention?.items.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setMention({ ...mention, active: (mention.active + 1) % mention.items.length }));
          else if (e.key === "ArrowUp") (e.preventDefault(), setMention({ ...mention, active: (mention.active - 1 + mention.items.length) % mention.items.length }));
          else if (e.key === "Enter" || e.key === "Tab") (e.preventDefault(), pickMention(mention.items[mention.active]));
          else if (e.key === "Escape") setMention(null);
        }}
      />
      {mention && mention.items.length > 0 && (
        <div className={s.mentions} style={{ left: mention.x, top: mention.y }} role="listbox" aria-label={tl("Personen erwähnen")}>
          {mention.items.map((it, i) => (
            <div
              key={it.email}
              role="option"
              aria-selected={i === mention.active}
              className={`${s.mention} ${i === mention.active ? s.mentionActive : ""}`}
              onMouseDown={(e) => (e.preventDefault(), pickMention(it))}
            >
              <Avatar name={it.name} size={24} color="colorful" />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>{it.name}</span>
                <span className={s.mentionMail}>{it.email}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <Dialog open={voteOpen} onOpenChange={(_, d) => setVoteOpen(d.open)}>
        <DialogSurface style={{ maxWidth: 420 }}>
          <DialogBody>
            <DialogTitle>{tl("Abstimmungsschaltflächen")}</DialogTitle>
            <DialogContent>
              <Input style={{ width: "100%" }} value={voteText} placeholder={tl("Optionen, durch Semikolon getrennt")} onChange={(_, d) => setVoteText(d.value)} />
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={voteText.split(";").filter((x) => x.trim()).length < 2} onClick={() => (setVoteOpen(false), insertVote(voteText.split(";")))}>
                {tl("Einfügen")}
              </Button>
              <Button onClick={() => setVoteOpen(false)}>{tl("Abbrechen")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={confirmClose} onOpenChange={(_, d) => setConfirmClose(d.open)}>
        <DialogSurface style={{ maxWidth: 440 }}>
          <DialogBody>
            <DialogTitle>{tl("Entwurf speichern?")}</DialogTitle>
            <DialogContent>{tl("Die Nachricht wurde noch nicht gesendet. Möchten Sie sie als Entwurf speichern?")}</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => (setConfirmClose(false), saveDraft())}>{tl("Speichern")}</Button>
              <Button onClick={() => (setConfirmClose(false), onClose())}>{tl("Verwerfen")}</Button>
              <Button appearance="subtle" onClick={() => setConfirmClose(false)}>{tl("Abbrechen")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
