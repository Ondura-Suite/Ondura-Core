// Tools of Ondura Text: compare documents, grammar check (LanguageTool),
// translation, read aloud, dictation, templates and hand-off of new
// documents to a fresh window.

import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Block, Inline, Marks, Paragraph, Revision, TextDocument } from "./model";
import { emptyDocument } from "./model";
import { errorMessage, isTauri } from "../../lib/api";
import { officeInvoke, openDocumentWindow } from "../../lib/office";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  col: { display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  issues: { display: "flex", flexDirection: "column", gap: "8px", maxHeight: "52vh", overflowY: "auto" },
  issue: {
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  ctx: { fontSize: "12px", color: tokens.colorNeutralForeground2 },
  hit: { textDecoration: "underline wavy #1e88e5", color: tokens.colorNeutralForeground1, fontWeight: 600 },
  templates: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" },
  template: {
    height: "150px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: "4px",
    textAlign: "left",
    ":hover": { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
});

// -------------------------------------------------------------- hand-off

const HANDOFF = "ondura.text.handoff";

/** Opens `doc` as a new, unsaved document in its own window. */
export async function openInNewWindow(doc: TextDocument) {
  try {
    localStorage.setItem(HANDOFF, JSON.stringify(doc));
  } catch {
    /* too large; the new window starts empty */
  }
  await openDocumentWindow("text");
}

/** The document handed to this window by `openInNewWindow` (read once). */
export function takeHandoff(): TextDocument | null {
  const raw = localStorage.getItem(HANDOFF);
  if (!raw) return null;
  localStorage.removeItem(HANDOFF);
  try {
    return JSON.parse(raw) as TextDocument;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- services

export interface ServiceSettings {
  languageTool: string;
  translator: "libretranslate" | "deepl";
  translateServer: string;
  translateKey: string;
}

const SERVICES = "ondura.text.services";

export function serviceSettings(): ServiceSettings {
  const d: ServiceSettings = { languageTool: "https://api.languagetool.org", translator: "libretranslate", translateServer: "https://libretranslate.com", translateKey: "" };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(SERVICES) ?? "{}") };
  } catch {
    return d;
  }
}

function saveServiceSettings(s: ServiceSettings) {
  localStorage.setItem(SERVICES, JSON.stringify(s));
}

// ---------------------------------------------------------------- compare

const OBJ = "￼";

/** Text of a paragraph; every non-text inline counts as one character. */
function paraText(p: Paragraph): string {
  return p.content.map((i) => (i.type === "text" ? i.text : OBJ)).join("");
}

/** Inlines of `p` between two character offsets (as `paraText` counts them). */
function slice(p: Paragraph, from: number, to: number, extra?: Partial<Marks>): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const i of p.content) {
    const len = i.type === "text" ? i.text.length : 1;
    const a = Math.max(from, at);
    const b = Math.min(to, at + len);
    if (a < b) {
      if (i.type === "text") out.push({ type: "text", text: i.text.slice(a - at, b - at), marks: extra ? { ...i.marks, ...extra } : i.marks });
      else out.push(i);
    }
    at += len;
    if (at >= to) break;
  }
  return out;
}

/** Longest-common-subsequence edit script ("=", "-", "+") of two lists. */
function diff<T>(a: T[], b: T[]): ("=" | "-" | "+")[] {
  const n = a.length;
  const m = b.length;
  // Common prefix and suffix keep the table small.
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const A = a.slice(pre, n - suf);
  const B = b.slice(pre, m - suf);
  const out: ("=" | "-" | "+")[] = Array(pre).fill("=");
  if (A.length * B.length > 8_000_000) {
    // Too large for the table: everything in between counts as replaced.
    out.push(...Array(A.length).fill("-"), ...Array(B.length).fill("+"));
  } else {
    const w = B.length + 1;
    const t = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--) t[i * w + j] = A[i] === B[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) (out.push("="), i++, j++);
      else if (j < B.length && (i === A.length || t[i * w + j + 1] >= t[(i + 1) * w + j])) (out.push("+"), j++);
      else (out.push("-"), i++);
    }
  }
  out.push(...Array(suf).fill("="));
  return out;
}

const tokens_ = (s: string) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

/** A changed paragraph: words of both versions with insertions and deletions marked. */
function compareParagraph(orig: Paragraph, rev: Paragraph, r: Revision): Paragraph {
  const ta = tokens_(paraText(orig));
  const tb = tokens_(paraText(rev));
  const script = diff(ta, tb);
  // Hardly anything in common: the whole paragraph counts as replaced.
  const words = (t: string[]) => t.filter((x) => /\S/.test(x)).length;
  let same = 0;
  for (let x = 0, ia = 0; x < script.length; x++) {
    if (script[x] === "=" && /\S/.test(ta[ia])) same++;
    if (script[x] !== "+") ia++;
  }
  if (same * 3 < Math.max(words(ta), words(tb))) return { ...rev, content: [...marked(orig, "del", r).content, ...marked(rev, "ins", r).content] };
  const content: Inline[] = [];
  let ia = 0;
  let ib = 0;
  let pa = 0;
  let pb = 0;
  for (const op of script) {
    if (op === "=") {
      content.push(...slice(rev, pb, pb + tb[ib].length));
      pa += ta[ia++].length;
      pb += tb[ib++].length;
    } else if (op === "-") {
      content.push(...slice(orig, pa, pa + ta[ia].length, { del: r }));
      pa += ta[ia++].length;
    } else {
      content.push(...slice(rev, pb, pb + tb[ib].length, { ins: r }));
      pb += tb[ib++].length;
    }
  }
  // Neighbouring runs with the same marks become one.
  const merged: Inline[] = [];
  for (const i of content) {
    const last = merged[merged.length - 1];
    if (i.type === "text" && last?.type === "text" && JSON.stringify(last.marks ?? {}) === JSON.stringify(i.marks ?? {})) last.text += i.text;
    else merged.push(i.type === "text" ? { ...i } : i);
  }
  return { ...rev, content: merged };
}

function marked(p: Paragraph, mark: "ins" | "del", r: Revision): Paragraph {
  return { ...p, content: p.content.map((i) => (i.type === "text" ? { ...i, marks: { ...i.marks, [mark]: r } } : i)) };
}

const blockKey = (b: Block) => (b.type === "paragraph" ? `p:${b.style ?? ""}:${paraText(b)}` : JSON.stringify(b));
const textKey = (b: Block) => (b.type === "paragraph" ? paraText(b) : null);

/**
 * Compares two versions of a document (Word: Überprüfen › Vergleichen).
 * The result is the revised document with the differences as tracked
 * changes by `author`.
 */
export function compareDocuments(original: TextDocument, revised: TextDocument, author: string): TextDocument {
  const r: Revision = { author, date: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  const a = original.blocks;
  const b = revised.blocks;
  const script = diff(a.map(blockKey), b.map(blockKey));
  const out: Block[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < script.length) {
    if (script[k] === "=") {
      out.push(b[j++]);
      i++;
      k++;
      continue;
    }
    // A run of deletions and insertions: pair paragraphs up as changes.
    const dels: Block[] = [];
    const ins: Block[] = [];
    while (k < script.length && script[k] !== "=") {
      if (script[k] === "-") dels.push(a[i++]);
      else ins.push(b[j++]);
      k++;
    }
    const n = Math.max(dels.length, ins.length);
    for (let x = 0; x < n; x++) {
      const d = dels[x];
      const e = ins[x];
      if (d && e && d.type === "paragraph" && e.type === "paragraph") {
        out.push(textKey(d) === textKey(e) ? e : compareParagraph(d, e, r));
      } else {
        if (d) out.push(d.type === "paragraph" ? marked(d, "del", r) : d);
        if (e) out.push(e.type === "paragraph" ? marked(e, "ins", r) : e);
      }
    }
  }
  return { ...revised, blocks: out, title: tl("Vergleichsergebnis") };
}

// ---------------------------------------------------------------- grammar

interface TextMap {
  text: string;
  /** Start offset in `text` and document position of each text node. */
  segs: { at: number; pos: number; len: number }[];
}

function textMap(editor: Editor, from = 0, to = editor.state.doc.content.size): TextMap {
  let text = "";
  const segs: TextMap["segs"] = [];
  let lastBlock = -1;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (lastBlock >= 0) text += "\n\n";
      lastBlock = pos;
      return true;
    }
    if (node.isText && node.text) {
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.text.length);
      if (a < b) {
        segs.push({ at: text.length, pos: a, len: b - a });
        text += node.text.slice(a - pos, b - pos);
      }
    } else if (node.isLeaf && node.isInline) text += " ";
    return true;
  });
  return { text, segs };
}

function posAt(map: TextMap, offset: number, end = false): number | null {
  for (const s of map.segs) {
    if (offset >= s.at && (offset < s.at + s.len || (end && offset === s.at + s.len))) return s.pos + offset - s.at;
  }
  return null;
}

interface Issue {
  id: number;
  from: number;
  to: number;
  original: string;
  message: string;
  replacements: string[];
  context: { text: string; offset: number; length: number };
}

const LT_LANG: Record<string, string> = { de: "de-DE", en: "en-US", fr: "fr" };

/** LanguageTool check of the whole document (or the selection). */
async function checkGrammar(editor: Editor, server: string, lang: string): Promise<Issue[]> {
  const { from, to, empty } = editor.state.selection;
  const map = empty ? textMap(editor) : textMap(editor, from, to);
  const issues: Issue[] = [];
  // The public server accepts about 20 KB per request.
  const LIMIT = 18_000;
  let start = 0;
  while (start < map.text.length) {
    let end = Math.min(map.text.length, start + LIMIT);
    if (end < map.text.length) {
      const cut = map.text.lastIndexOf("\n\n", end);
      if (cut > start) end = cut;
    }
    const chunk = map.text.slice(start, end);
    const matches = await officeInvoke<
      { message: string; offset: number; length: number; replacements: { value: string }[]; context: { text: string; offset: number; length: number } }[]
    >("grammar_check", { server, text: chunk, language: LT_LANG[lang] ?? "auto" });
    for (const m of matches) {
      const a = posAt(map, start + m.offset);
      const b = posAt(map, start + m.offset + m.length, true);
      if (a === null || b === null || b < a) continue;
      issues.push({
        id: issues.length,
        from: a,
        to: b,
        original: editor.state.doc.textBetween(a, b),
        message: m.message,
        replacements: m.replacements.slice(0, 4).map((r) => r.value),
        context: m.context,
      });
    }
    start = end;
  }
  return issues;
}

export function GrammarDialog({ open, editor, lang, onClose }: { open: boolean; editor: Editor; lang: string; onClose: () => void }) {
  const s = useStyles();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(serviceSettings);
  const [showSettings, setShowSettings] = useState(false);

  const run = async () => {
    setIssues(null);
    setError(null);
    if (!isTauri) return setError(tl("Im Browser-Vorschaumodus nicht verfügbar."));
    try {
      setIssues(await checkGrammar(editor, settings.languageTool, lang));
    } catch (e) {
      setError(errorMessage(e));
      setIssues([]);
    }
  };
  useEffect(() => {
    if (open) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = (i: Issue) => editor.chain().focus().setTextSelection({ from: i.from, to: i.to }).scrollIntoView().run();
  const fix = (i: Issue, rep: string) => {
    const st = editor.state;
    if (st.doc.textBetween(i.from, i.to) !== i.original) return setIssues((l) => l?.filter((x) => x.id !== i.id) ?? null);
    const tr = st.tr.insertText(rep, i.from, i.to);
    editor.view.dispatch(tr);
    setIssues((l) => l?.filter((x) => x.id !== i.id).map((x) => ({ ...x, from: tr.mapping.map(x.from), to: tr.mapping.map(x.to, -1) })) ?? null);
  };

  return (
    <Dialog open={open} modalType="non-modal" onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Grammatik und Stil")}</DialogTitle>
          <DialogContent className={s.col}>
            {showSettings && (
              <Field label={tl("LanguageTool-Server")} hint={tl("Der Text wird zur Prüfung an diesen Server gesendet.")}>
                <Input value={settings.languageTool} onChange={(_, d) => setSettings({ ...settings, languageTool: d.value })} onBlur={() => saveServiceSettings(settings)} />
              </Field>
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            {issues === null ? (
              <Spinner label={tl("Text wird geprüft…")} />
            ) : issues.length === 0 && !error ? (
              <Text>{tl("Keine Grammatik- oder Stilprobleme gefunden.")}</Text>
            ) : (
              <div className={s.issues}>
                {issues.map((i) => (
                  <div key={i.id} className={s.issue} onClick={() => select(i)}>
                    <Text weight="semibold">{i.message}</Text>
                    <span className={s.ctx}>
                      {i.context.text.slice(0, i.context.offset)}
                      <span className={s.hit}>{i.context.text.slice(i.context.offset, i.context.offset + i.context.length)}</span>
                      {i.context.text.slice(i.context.offset + i.context.length)}
                    </span>
                    <div className={s.row}>
                      {i.replacements.map((r) => (
                        <Button key={r} size="small" appearance="primary" onClick={(e) => (e.stopPropagation(), fix(i, r))}>
                          {r || tl("(entfernen)")}
                        </Button>
                      ))}
                      <Button size="small" onClick={(e) => (e.stopPropagation(), setIssues((l) => l?.filter((x) => x.id !== i.id) ?? null))}>
                        {tl("Ignorieren")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowSettings((v) => !v)}>{tl("Server…")}</Button>
            <Button onClick={() => void run()}>{tl("Erneut prüfen")}</Button>
            <Button appearance="primary" onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// -------------------------------------------------------------- translate

const LANGUAGES: [string, string][] = [
  ["de", tl("Deutsch")],
  ["en", tl("Englisch")],
  ["fr", tl("Französisch")],
  ["es", tl("Spanisch")],
  ["it", tl("Italienisch")],
  ["nl", tl("Niederländisch")],
  ["pl", tl("Polnisch")],
  ["pt", tl("Portugiesisch")],
  ["tr", tl("Türkisch")],
  ["uk", tl("Ukrainisch")],
  ["ru", tl("Russisch")],
  ["zh", tl("Chinesisch")],
  ["ja", tl("Japanisch")],
];

export function TranslateDialog({ open, editor, onClose }: { open: boolean; editor: Editor; onClose: () => void }) {
  const s = useStyles();
  const [settings, setSettings] = useState(serviceSettings);
  const [target, setTarget] = useState(() => localStorage.getItem("ondura.text.translateTo") ?? "en");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);

  const source = useMemo(() => {
    if (!open) return "";
    const { from, to, empty } = editor.state.selection;
    return empty ? textMap(editor).text : textMap(editor, from, to).text;
  }, [open, editor]);
  useEffect(() => {
    if (!open) return;
    const { from, to, empty } = editor.state.selection;
    setRange(empty ? null : { from, to });
    setResult("");
    setError(null);
  }, [open, editor]);

  const run = async () => {
    setBusy(true);
    setError(null);
    localStorage.setItem("ondura.text.translateTo", target);
    saveServiceSettings(settings);
    try {
      if (!isTauri) throw new Error(tl("Im Browser-Vorschaumodus nicht verfügbar."));
      const parts = source.split("\n\n");
      const out: string[] = [];
      // Paragraph by paragraph in batches, to keep requests small.
      let batch: string[] = [];
      const flush = async () => {
        if (!batch.length) return;
        const r = await officeInvoke<string>("translate_text", {
          service: settings.translator,
          server: settings.translateServer,
          key: settings.translateKey,
          text: batch.join("\n\n"),
          source: "auto",
          target,
        });
        out.push(r);
        batch = [];
      };
      for (const p of parts) {
        if (batch.join("\n\n").length + p.length > 4000) await flush();
        batch.push(p);
      }
      await flush();
      setResult(out.join("\n\n"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const replace = () => {
    if (!range) return;
    editor.chain().focus().insertContentAt(range, result.split("\n\n").map((t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }))).run();
    onClose();
  };
  const asDocument = () => {
    const doc = emptyDocument();
    doc.title = tl("Übersetzung");
    doc.blocks = result.split("\n\n").map((t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }));
    void openInNewWindow(doc);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 620 }}>
        <DialogBody>
          <DialogTitle>{range ? tl("Auswahl übersetzen") : tl("Dokument übersetzen")}</DialogTitle>
          <DialogContent className={s.col}>
            <div className={s.row}>
              <Field label={tl("In")}>
                <Dropdown value={LANGUAGES.find((l) => l[0] === target)?.[1]} selectedOptions={[target]} onOptionSelect={(_, d) => setTarget(d.optionValue ?? "en")}>
                  {LANGUAGES.map(([c, l]) => (
                    <Option key={c} value={c}>{l}</Option>
                  ))}
                </Dropdown>
              </Field>
              <Button appearance="primary" disabled={busy || !source.trim()} onClick={() => void run()}>
                {busy ? <Spinner size="tiny" /> : tl("Übersetzen")}
              </Button>
              <Button appearance="subtle" onClick={() => setShowSettings((v) => !v)}>{tl("Dienst…")}</Button>
            </div>
            {showSettings && (
              <>
                <Field label={tl("Übersetzungsdienst")} hint={tl("Der Text wird zur Übersetzung an diesen Dienst gesendet.")}>
                  <Dropdown
                    value={settings.translator === "deepl" ? "DeepL" : "LibreTranslate"}
                    selectedOptions={[settings.translator]}
                    onOptionSelect={(_, d) => setSettings({ ...settings, translator: d.optionValue as ServiceSettings["translator"] })}
                  >
                    <Option value="libretranslate">LibreTranslate</Option>
                    <Option value="deepl">DeepL</Option>
                  </Dropdown>
                </Field>
                {settings.translator === "libretranslate" && (
                  <Field label={tl("Server")}>
                    <Input value={settings.translateServer} onChange={(_, d) => setSettings({ ...settings, translateServer: d.value })} />
                  </Field>
                )}
                <Field label={tl("API-Schlüssel")}>
                  <Input type="password" value={settings.translateKey} onChange={(_, d) => setSettings({ ...settings, translateKey: d.value })} />
                </Field>
              </>
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={tl("Übersetzung")}>
              <Textarea value={result} onChange={(_, d) => setResult(d.value)} rows={8} />
            </Field>
          </DialogContent>
          <DialogActions>
            {range && (
              <Button appearance="primary" disabled={!result} onClick={replace}>
                {tl("Auswahl ersetzen")}
              </Button>
            )}
            <Button disabled={!result} onClick={asDocument}>{tl("Als neues Dokument")}</Button>
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ------------------------------------------------------------- read aloud

const SPEECH_LANG: Record<string, string> = { de: "de-DE", en: "en-US", fr: "fr-FR" };

/** Text to read: the selection, otherwise from the cursor to the end. */
export function textToRead(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  return (empty ? textMap(editor, from) : textMap(editor, from, to)).text;
}

/**
 * Reads `text` aloud — with the web speech API where the webview has
 * voices, otherwise with the speech engine of the system. Resolves when
 * done or stopped.
 */
export async function readAloud(text: string, lang: string): Promise<void> {
  const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
  const voices = synth?.getVoices() ?? [];
  if (synth && (voices.length || !isTauri)) {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang] ?? lang;
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(lang));
    if (v) u.voice = v;
    return new Promise((resolve) => {
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
  }
  await officeInvoke("speak", { text, lang: SPEECH_LANG[lang] ?? lang });
  // The system engine runs on its own; wait until it stops.
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    if (!(await officeInvoke<boolean>("speaking", {}))) return;
  }
}

export function stopReading() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  if (isTauri) void officeInvoke("speak_stop", {}).catch(() => {});
}

// --------------------------------------------------------------- dictation

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

/**
 * Starts dictation. On Windows this opens the system dictation (Win+H),
 * which types into the editor; elsewhere the web speech recognition is
 * used where the webview offers it. Returns a stop function, `"system"`
 * when the system took over, or `null` if dictation is not available.
 */
export async function startDictation(editor: Editor, lang: string, onEnd: () => void): Promise<(() => void) | "system" | null> {
  if (isTauri) {
    editor.commands.focus();
    if (await officeInvoke<boolean>("start_dictation", {}).catch(() => false)) return "system";
  }
  const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = SPEECH_LANG[lang] ?? lang;
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal) continue;
      const t = r[0].transcript.trim();
      if (!t) continue;
      const before = editor.state.doc.textBetween(Math.max(0, editor.state.selection.from - 1), editor.state.selection.from);
      editor.chain().focus().insertContent(before && !/\s/.test(before) ? ` ${t}` : t).run();
    }
  };
  rec.onend = onEnd;
  rec.onerror = () => onEnd();
  try {
    rec.start();
  } catch {
    return null;
  }
  return () => rec.stop();
}

// --------------------------------------------------------------- templates

const p = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [], ...extra });
const bold = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({ type: "paragraph", content: [{ type: "text", text, marks: { bold: true } }], ...extra });

/** Built-in templates (Datei › Neu). */
export const TEMPLATES: { id: string; label: string; build: () => TextDocument }[] = [
  { id: "blank", label: tl("Leeres Dokument"), build: () => emptyDocument() },
  {
    id: "letter",
    label: tl("Brief (DIN 5008)"),
    build: () => {
      const d = emptyDocument();
      d.title = tl("Brief");
      d.page = { ...d.page, marginTopMm: 27, marginLeftMm: 25, marginRightMm: 20, marginBottomMm: 20 };
      const date = new Date().toLocaleDateString();
      d.blocks = [
        p(tl("Absender · Straße Nr. · PLZ Ort"), { content: [{ type: "text", text: tl("Absender · Straße Nr. · PLZ Ort"), marks: { size: 8, underline: true } }], spaceAfterPt: 0 }),
        p(tl("Empfänger"), { spaceAfterPt: 0 }),
        p(tl("Straße Nr."), { spaceAfterPt: 0 }),
        p(tl("PLZ Ort"), { spaceAfterPt: 0 }),
        p(""),
        p(""),
        p(date, { align: "right" }),
        p(""),
        bold(tl("Betreff")),
        p(""),
        p(tl("Sehr geehrte Damen und Herren,")),
        p(tl("hier steht Ihr Text.")),
        p(tl("Mit freundlichen Grüßen")),
        p(""),
        p(""),
        p(tl("Name")),
      ];
      return d;
    },
  },
  {
    id: "report",
    label: tl("Bericht"),
    build: () => {
      const d = emptyDocument();
      d.title = tl("Bericht");
      d.blocks = [
        p(tl("Titel des Berichts"), { style: "title" }),
        p(tl("Untertitel · Datum"), { style: "subtitle" }),
        { type: "toc", title: tl("Inhalt"), entries: [] },
        { type: "pageBreak" },
        p(tl("Einleitung"), { style: "heading1" }),
        p(tl("Beschreiben Sie Anlass und Ziel des Berichts.")),
        p(tl("Ergebnisse"), { style: "heading1" }),
        p(tl("Details"), { style: "heading2" }),
        p(tl("Fassen Sie die wichtigsten Ergebnisse zusammen.")),
        p(tl("Fazit"), { style: "heading1" }),
        p(tl("Ihre Schlussfolgerungen und nächsten Schritte.")),
      ];
      return d;
    },
  },
  {
    id: "minutes",
    label: tl("Besprechungsprotokoll"),
    build: () => {
      const d = emptyDocument();
      d.title = tl("Protokoll");
      const cell = (t: string, b = false) => ({ colSpan: 1, rowSpan: 1, blocks: [b ? bold(t, { spaceAfterPt: 0 }) : p(t, { spaceAfterPt: 0 })] });
      d.blocks = [
        p(tl("Besprechungsprotokoll"), { style: "title" }),
        {
          type: "table",
          columnsMm: [45, 120],
          rows: [
            { cells: [cell(tl("Datum"), true), cell(new Date().toLocaleDateString())] },
            { cells: [cell(tl("Ort"), true), cell("")] },
            { cells: [cell(tl("Teilnehmende"), true), cell("")] },
            { cells: [cell(tl("Protokoll"), true), cell("")] },
          ],
        },
        p(tl("Tagesordnung"), { style: "heading1" }),
        p(tl("Thema"), { list: { ordered: true, level: 0 } }),
        p(tl("Ergebnisse und Beschlüsse"), { style: "heading1" }),
        p(""),
        p(tl("Aufgaben"), { style: "heading1" }),
        p(tl("Aufgabe – verantwortlich – bis"), { list: { ordered: false, level: 0 } }),
      ];
      return d;
    },
  },
  {
    id: "cv",
    label: tl("Lebenslauf"),
    build: () => {
      const d = emptyDocument();
      d.title = tl("Lebenslauf");
      d.blocks = [
        p(tl("Vorname Nachname"), { style: "title" }),
        p(tl("Straße Nr. · PLZ Ort · Telefon · E-Mail"), { style: "subtitle" }),
        p(tl("Berufserfahrung"), { style: "heading1" }),
        bold(tl("Seit 2020 · Position, Unternehmen"), { spaceAfterPt: 0 }),
        p(tl("Aufgaben und Erfolge")),
        p(tl("Ausbildung"), { style: "heading1" }),
        bold(tl("2015 – 2019 · Abschluss, Hochschule"), { spaceAfterPt: 0 }),
        p(tl("Schwerpunkte")),
        p(tl("Kenntnisse"), { style: "heading1" }),
        p(tl("Sprachen, Software, Zertifikate"), { list: { ordered: false, level: 0 } }),
      ];
      return d;
    },
  },
];

export function TemplatesDialog({ open, onClose, onPick, onOpenTemplate }: { open: boolean; onClose: () => void; onPick: (d: TextDocument) => void; onOpenTemplate: () => void }) {
  const s = useStyles();
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>{tl("Neu aus Vorlage")}</DialogTitle>
          <DialogContent className={s.col}>
            <div className={s.templates}>
              {TEMPLATES.map((t) => (
                <button key={t.id} className={s.template} onClick={() => (onPick(t.build()), onClose())}>
                  <Text weight="semibold">{t.label}</Text>
                </button>
              ))}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => (onOpenTemplate(), onClose())}>{tl("Eigene Vorlage öffnen (.dotx)…")}</Button>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
