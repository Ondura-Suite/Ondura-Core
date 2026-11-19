// Ondura Formulare: surveys, registrations and quizzes like Microsoft
// Forms, without a server: the form is filled in here, as a fillable PDF
// or as a web form (HTML file) whose answers come back by e-mail; Ondura
// collects them from the mailbox or from the returned files and evaluates
// them with charts.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Dropdown,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Spinner,
  Switch,
  Tab,
  TabList,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowDownload20Regular,
  ArrowUp20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Copy20Regular,
  Delete20Regular,
  DocumentPdf20Regular,
  Eye20Regular,
  FolderOpen20Regular,
  Globe20Regular,
  MailInbox20Regular,
  Save20Regular,
  Star24Filled,
  Star24Regular,
  Table20Regular,
  ArrowUpload20Regular,
  DocumentAdd20Regular,
  Dismiss20Regular,
} from "@fluentui/react-icons";
import { api, errorMessage, isTauri } from "../../lib/api";
import { LOCALE, tl, tlc } from "../../lib/i18n";
import { guardClose, initialFile, setWindowTitle } from "../../lib/office";
import { download, openTextFile, pickSaveFile, readTextFile, saveFile, writeBytes, type FileFilter } from "../../lib/files";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { useUnsavedPrompt } from "../../shell/office";
import {
  FORM_TEMPLATES,
  THEME_COLORS,
  TYPE_LABEL,
  answerText,
  decodeResponses,
  mailSubject,
  mergeResponses,
  missingRequired,
  newQuestion,
  responseRows,
  rid,
  summarize,
  toCsv,
  type Answer,
  type Form,
  type Question,
  type QuestionType,
  type Response,
} from "./model";
import { formToPdf, responseFromPdf } from "./pdfForm";
import { formToHtml } from "./htmlForm";

const COLOR = "#c27c0e";
const FILTER: FileFilter = { name: tl("Ondura-Formular"), extensions: ["ondform"] };

type View = "questions" | "responses" | "share" | "fill";

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  bar: { display: "flex", alignItems: "center", gap: "10px", padding: "4px 16px 8px", flexWrap: "wrap" },
  body: { flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 16px 48px" },
  col: { maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusXLarge, boxShadow: tokens.shadow4, padding: "18px 22px", display: "flex", flexDirection: "column", gap: "10px" },
  head: { overflow: "hidden", padding: 0 },
  band: { height: "10px" },
  headInner: { padding: "16px 22px 20px", display: "flex", flexDirection: "column", gap: "8px" },
  title: { fontSize: "24px", fontWeight: tokens.fontWeightSemibold },
  qHead: { display: "flex", gap: "8px", alignItems: "flex-start" },
  num: { fontWeight: tokens.fontWeightSemibold, paddingTop: "6px", minWidth: "22px" },
  opts: { display: "flex", flexDirection: "column", gap: "4px", paddingLeft: "30px" },
  opt: { display: "flex", gap: "6px", alignItems: "center" },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  swatch: { width: "26px", height: "26px", borderRadius: "50%", border: "none", cursor: "pointer" },
  swatchOn: { outline: `3px solid ${tokens.colorNeutralForeground1}`, outlineOffset: "2px" },
  bars: { display: "flex", flexDirection: "column", gap: "6px" },
  barRow: { display: "grid", gridTemplateColumns: "minmax(80px, 200px) 1fr 70px", gap: "10px", alignItems: "center", fontSize: tokens.fontSizeBase300 },
  barTrack: { height: "18px", borderRadius: "4px", backgroundColor: tokens.colorNeutralBackground3, overflow: "hidden" },
  big: { fontSize: "32px", fontWeight: tokens.fontWeightSemibold, lineHeight: 1.1 },
  texts: { display: "flex", flexDirection: "column", gap: "4px", maxHeight: "240px", overflowY: "auto" },
  textItem: { padding: "6px 10px", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground2 },
  fillQ: { display: "flex", flexDirection: "column", gap: "8px" },
  err: { boxShadow: `0 0 0 2px ${tokens.colorPaletteRedBorder2}` },
  starBtn: { border: "none", background: "none", cursor: "pointer", padding: 0, color: "#c8c8c8" },
  scaleBtn: { minWidth: "38px" },
  start: { position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", backgroundColor: "var(--nx-solid-bg, #f6f6fa)", padding: "24px" },
  tpls: { display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" },
  tpl: { width: "170px", height: "120px", borderRadius: tokens.borderRadiusLarge, border: "2px solid transparent", backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow8, cursor: "pointer", display: "flex", flexDirection: "column", overflow: "hidden", padding: 0, fontFamily: "inherit", color: tokens.colorNeutralForeground1, ":hover": { border: `2px solid ${COLOR}` } },
  shareGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "12px" },
});

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------- fill --

function FillView({ form, onSubmit, preview }: { form: Form; onSubmit?: (r: Response) => void; preview?: boolean }) {
  const s = useStyles();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [other, setOther] = useState<Record<string, string>>({});
  const set = (id: string, a: Answer) => setAnswers((x) => ({ ...x, [id]: a }));
  const submit = () => {
    const missing = missingRequired(form, answers);
    setErrors(missing);
    if (missing.length) return document.getElementById(`fill-${missing[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    onSubmit?.({ id: rid("r"), submitted: new Date().toISOString(), answers, source: "app" });
    setDone(true);
  };
  if (done)
    return (
      <div className={s.col}>
        <div className={mergeClasses(s.card, s.head)}>
          <div className={s.band} style={{ backgroundColor: form.color }} />
          <div className={s.headInner} style={{ alignItems: "center", textAlign: "center", padding: 32 }}>
            <Text className={s.title}>{form.thanks}</Text>
            {preview && <Text className={s.muted}>{tl("Vorschau – die Antwort wurde nicht gespeichert.")}</Text>}
            <Button appearance="primary" onClick={() => (setAnswers({}), setOther({}), setDone(false))} style={{ backgroundColor: form.color }}>
              {tl("Weitere Antwort senden")}
            </Button>
          </div>
        </div>
      </div>
    );
  let n = 0;
  return (
    <div className={s.col}>
      <div className={mergeClasses(s.card, s.head)}>
        <div className={s.band} style={{ backgroundColor: form.color }} />
        <div className={s.headInner}>
          <Text className={s.title}>{form.title}</Text>
          {form.description && <Text style={{ whiteSpace: "pre-wrap" }}>{form.description}</Text>}
        </div>
      </div>
      {form.questions.map((q) => {
        if (q.type === "section")
          return (
            <div key={q.id} style={{ padding: "12px 4px 0" }}>
              <Text size={500} weight="semibold" style={{ color: form.color }}>
                {q.title}
              </Text>
              {q.description && <Text block className={s.muted}>{q.description}</Text>}
            </div>
          );
        n++;
        const a = answers[q.id];
        let input: ReactNode;
        switch (q.type) {
          case "text":
            input = <Input value={String(a ?? "")} onChange={(_, d) => set(q.id, d.value)} />;
            break;
          case "longtext":
            input = <Textarea resize="vertical" rows={4} value={String(a ?? "")} onChange={(_, d) => set(q.id, d.value)} />;
            break;
          case "number":
            input = <Input type="number" value={a === null || a === undefined ? "" : String(a)} onChange={(_, d) => set(q.id, d.value === "" ? null : Number(d.value))} style={{ maxWidth: 220 }} />;
            break;
          case "date":
            input = <Input type="date" value={String(a ?? "")} onChange={(_, d) => set(q.id, d.value || null)} style={{ maxWidth: 220 }} />;
            break;
          case "dropdown":
            input = (
              <Dropdown placeholder={tl("Bitte auswählen")} value={String(a ?? "")} selectedOptions={a ? [String(a)] : []} onOptionSelect={(_, d) => set(q.id, d.optionValue ?? null)} style={{ maxWidth: 320 }}>
                {(q.options ?? []).map((o) => (
                  <Option key={o} value={o}>
                    {o}
                  </Option>
                ))}
              </Dropdown>
            );
            break;
          case "choice":
          case "multi": {
            const multi = q.type === "multi";
            const picked = multi ? ((a as string[] | undefined) ?? []) : a ? [String(a)] : [];
            const otherOn = picked.some((p) => !(q.options ?? []).includes(p));
            const toggle = (o: string, on: boolean) => {
              if (multi) set(q.id, on ? [...picked.filter((p) => p !== o), o] : picked.filter((p) => p !== o));
              else set(q.id, on ? o : null);
            };
            input = (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(q.options ?? []).map((o) =>
                  multi ? (
                    <Checkbox key={o} label={o} checked={picked.includes(o)} onChange={(_, d) => toggle(o, !!d.checked)} />
                  ) : (
                    <label key={o} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", cursor: "pointer" }}>
                      <input type="radio" name={`fill-${q.id}`} checked={picked.includes(o)} onChange={() => toggle(o, true)} style={{ accentColor: form.color }} />
                      {o}
                    </label>
                  ),
                )}
                {q.other && (
                  <div className={s.row} style={{ paddingTop: 4 }}>
                    <Checkbox
                      shape={multi ? "square" : "circular"}
                      label={tl("Sonstiges:")}
                      checked={otherOn}
                      onChange={(_, d) => {
                        const v = other[q.id] || tl("Sonstiges");
                        if (multi) set(q.id, d.checked ? [...picked.filter((p) => (q.options ?? []).includes(p)), v] : picked.filter((p) => (q.options ?? []).includes(p)));
                        else set(q.id, d.checked ? v : null);
                      }}
                    />
                    <Input
                      size="small"
                      value={other[q.id] ?? ""}
                      onChange={(_, d) => {
                        setOther((x) => ({ ...x, [q.id]: d.value }));
                        const base = picked.filter((p) => (q.options ?? []).includes(p));
                        set(q.id, multi ? [...base, d.value || tl("Sonstiges")] : d.value || tl("Sonstiges"));
                      }}
                    />
                  </div>
                )}
              </div>
            );
            break;
          }
          case "rating":
            input = (
              <div className={s.row}>
                {Array.from({ length: q.max ?? 5 }, (_, i) => (
                  <button key={i} className={s.starBtn} onClick={() => set(q.id, i + 1)} aria-label={String(i + 1)} style={{ color: Number(a) > i ? "#f7b500" : undefined }}>
                    {Number(a) > i ? <Star24Filled style={{ width: 30, height: 30 }} /> : <Star24Regular style={{ width: 30, height: 30 }} />}
                  </button>
                ))}
              </div>
            );
            break;
          case "scale":
            input = (
              <div>
                <div className={s.row}>
                  {Array.from({ length: (q.max ?? 10) + 1 }, (_, i) => (
                    <Button key={i} className={s.scaleBtn} appearance={a === i ? "primary" : "outline"} onClick={() => set(q.id, i)} style={a === i ? { backgroundColor: form.color } : undefined}>
                      {i}
                    </Button>
                  ))}
                </div>
                <div className={s.row} style={{ justifyContent: "space-between" }}>
                  <Text size={200} className={s.muted}>
                    {q.minLabel}
                  </Text>
                  <Text size={200} className={s.muted}>
                    {q.maxLabel}
                  </Text>
                </div>
              </div>
            );
            break;
        }
        return (
          <div key={q.id} id={`fill-${q.id}`} className={mergeClasses(s.card, s.fillQ, errors.includes(q.id) && s.err)}>
            <Text weight="semibold" size={400}>
              {n}. {q.title}
              {q.required && <span style={{ color: "#c50f1f" }}> *</span>}
            </Text>
            {q.description && <Text className={s.muted}>{q.description}</Text>}
            {input}
            {errors.includes(q.id) && <Text style={{ color: "#c50f1f" }}>{tl("Bitte beantworten Sie diese Frage.")}</Text>}
          </div>
        );
      })}
      <div>
        <Button appearance="primary" size="large" onClick={submit} disabled={form.closed && !preview} style={{ backgroundColor: form.color }}>
          {tl("Absenden")}
        </Button>
        {form.closed && !preview && (
          <Text className={s.muted} style={{ marginLeft: 12 }}>
            {tl("Dieses Formular nimmt keine Antworten mehr an.")}
          </Text>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ designer --

function QuestionEditor({ q, index, color, onChange, onMove, onDuplicate, onDelete, last }: { q: Question; index: number; color: string; onChange: (q: Question) => void; onMove: (d: number) => void; onDuplicate: () => void; onDelete: () => void; last: boolean }) {
  const s = useStyles();
  const hasOptions = q.type === "choice" || q.type === "multi" || q.type === "dropdown";
  const setOpt = (i: number, v: string) => onChange({ ...q, options: (q.options ?? []).map((o, j) => (j === i ? v : o)) });
  return (
    <div className={s.card} style={{ borderLeft: `4px solid ${color}` }}>
      <div className={s.qHead}>
        {q.type !== "section" && <span className={s.num}>{index}.</span>}
        <Input appearance="underline" style={{ flex: 1 }} placeholder={q.type === "section" ? tl("Abschnittstitel") : tl("Frage")} value={q.title} onChange={(_, d) => onChange({ ...q, title: d.value })} />
        <Dropdown
          size="small"
          style={{ minWidth: 150 }}
          value={TYPE_LABEL[q.type]()}
          selectedOptions={[q.type]}
          onOptionSelect={(_, d) => {
            const t = d.optionValue as QuestionType;
            const fresh = newQuestion(t);
            onChange({ ...fresh, id: q.id, title: q.title, description: q.description, required: q.required, options: (t === "choice" || t === "multi" || t === "dropdown") && q.options?.length ? q.options : fresh.options });
          }}
        >
          {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
            <Option key={t} value={t}>
              {TYPE_LABEL[t]()}
            </Option>
          ))}
        </Dropdown>
      </div>
      <Input size="small" appearance="underline" placeholder={tl("Beschreibung (optional)")} value={q.description ?? ""} onChange={(_, d) => onChange({ ...q, description: d.value || undefined })} />
      {hasOptions && (
        <div className={s.opts}>
          {(q.options ?? []).map((o, i) => (
            <div key={i} className={s.opt}>
              <span style={{ width: 16, color: tokens.colorNeutralForeground3 }}>{q.type === "multi" ? "☐" : q.type === "choice" ? "○" : `${i + 1}.`}</span>
              <Input size="small" style={{ flex: 1 }} value={o} onChange={(_, d) => setOpt(i, d.value)} onKeyDown={(e) => e.key === "Enter" && onChange({ ...q, options: [...(q.options ?? []).slice(0, i + 1), "", ...(q.options ?? []).slice(i + 1)] })} />
              <Button size="small" appearance="subtle" icon={<Dismiss20Regular />} aria-label={tl("Option entfernen")} onClick={() => onChange({ ...q, options: (q.options ?? []).filter((_, j) => j !== i) })} disabled={(q.options ?? []).length < 2} />
            </div>
          ))}
          <div className={s.row}>
            <Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={() => onChange({ ...q, options: [...(q.options ?? []), tl("Option {0}", (q.options?.length ?? 0) + 1)] })}>
              {tl("Option hinzufügen")}
            </Button>
            {q.type !== "dropdown" && <Checkbox label={tl("„Sonstiges“ erlauben")} checked={!!q.other} onChange={(_, d) => onChange({ ...q, other: !!d.checked })} />}
          </div>
        </div>
      )}
      {q.type === "rating" && (
        <div className={s.row}>
          <Text size={200}>{tl("Anzahl der Sterne")}</Text>
          <Dropdown size="small" style={{ minWidth: 80 }} value={String(q.max ?? 5)} selectedOptions={[String(q.max ?? 5)]} onOptionSelect={(_, d) => onChange({ ...q, max: Number(d.optionValue) })}>
            {[3, 4, 5, 7, 10].map((n) => (
              <Option key={n} value={String(n)}>
                {String(n)}
              </Option>
            ))}
          </Dropdown>
        </div>
      )}
      {q.type === "scale" && (
        <div className={s.row}>
          <Input size="small" placeholder={tl("Beschriftung 0")} value={q.minLabel ?? ""} onChange={(_, d) => onChange({ ...q, minLabel: d.value })} />
          <Input size="small" placeholder={tl("Beschriftung 10")} value={q.maxLabel ?? ""} onChange={(_, d) => onChange({ ...q, maxLabel: d.value })} />
        </div>
      )}
      <div className={s.row} style={{ justifyContent: "flex-end" }}>
        {q.type !== "section" && <Switch label={tl("Erforderlich")} checked={q.required} onChange={(_, d) => onChange({ ...q, required: d.checked })} />}
        <Tooltip content={tl("Nach oben")} relationship="label">
          <Button size="small" appearance="subtle" icon={<ArrowUp20Regular />} onClick={() => onMove(-1)} disabled={index === 1 && q.type !== "section"} />
        </Tooltip>
        <Tooltip content={tl("Nach unten")} relationship="label">
          <Button size="small" appearance="subtle" icon={<ArrowDown20Regular />} onClick={() => onMove(1)} disabled={last} />
        </Tooltip>
        <Tooltip content={tl("Duplizieren")} relationship="label">
          <Button size="small" appearance="subtle" icon={<Copy20Regular />} onClick={onDuplicate} />
        </Tooltip>
        <Tooltip content={tl("Löschen")} relationship="label">
          <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={onDelete} />
        </Tooltip>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- summaries --

function QuestionSummary({ q, index, form }: { q: Question; index: number; form: Form }) {
  const s = useStyles();
  const sum = summarize(q, form.responses);
  const total = form.responses.length;
  const bar = (label: string, count: number, base: number) => (
    <div key={label} className={s.barRow}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>
        {label}
      </span>
      <div className={s.barTrack}>
        <div style={{ width: `${base ? (count / base) * 100 : 0}%`, height: "100%", backgroundColor: form.color }} />
      </div>
      <span className={s.muted}>
        {count} ({base ? Math.round((count / base) * 100) : 0} %)
      </span>
    </div>
  );
  return (
    <div className={s.card}>
      <Text weight="semibold" size={400}>
        {index}. {q.title || tl("Frage")}
      </Text>
      <Text size={200} className={s.muted}>
        {tl("{0} von {1} Antworten", sum.count, total)}
      </Text>
      {sum.options && <div className={s.bars}>{sum.options.map((o) => bar(o.label, o.count, q.type === "multi" ? sum.count : sum.count))}</div>}
      {sum.average !== undefined && (
        <div className={s.row} style={{ gap: 24 }}>
          <div>
            <div className={s.big}>{sum.average.toLocaleString(LOCALE, { maximumFractionDigits: 2 })}</div>
            <Text size={200} className={s.muted}>
              {q.type === "rating" ? tl("Durchschnitt (von {0} Sternen)", q.max ?? 5) : tl("Durchschnitt")}
            </Text>
          </div>
          {sum.nps !== undefined && (
            <div>
              <div className={s.big}>{sum.nps}</div>
              <Text size={200} className={s.muted}>
                {tl("Net Promoter Score")}
              </Text>
            </div>
          )}
        </div>
      )}
      {sum.distribution && <div className={s.bars}>{sum.distribution.map((d) => bar(d.label, d.count, sum.count))}</div>}
      {sum.texts && (
        <div className={s.texts}>
          {sum.texts.map((t, i) => (
            <div key={i} className={s.textItem}>
              {t}
            </div>
          ))}
          {!sum.texts.length && <Text className={s.muted}>{tl("Noch keine Antworten.")}</Text>}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- app --

export function FormsApp() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();
  const [form, setForm] = useState<Form>(() => FORM_TEMPLATES[0].make());
  const [view, setView] = useState<View>("questions");
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [startOpen, setStartOpen] = useState(() => !initialFile());
  const [preview, setPreview] = useState(false);
  const [one, setOne] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const update = useCallback((fn: (f: Form) => Form) => {
    setForm((f) => fn(f));
    setDirty(true);
  }, []);

  // ---------------------------------------------------------- file --

  const load = useCallback(
    (text: string, file: string | null) => {
      try {
        const f = JSON.parse(text) as Form;
        if (!f.id || !Array.isArray(f.questions)) throw new Error(tl("Keine gültige Formulardatei"));
        setForm({ ...f, responses: f.responses ?? [] });
        setPath(file);
        setDirty(false);
        setStartOpen(false);
        setView(f.responses?.length ? "responses" : "questions");
      } catch (e) {
        notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error");
      }
    },
    [notify],
  );

  useEffect(() => {
    setTimeout(splashDone, 50);
    const f = initialFile();
    if (f) void readTextFile(f).then((t) => load(t, f), (e) => notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error"));
    const tpl = localStorage.getItem("ondura.forms.template");
    if (tpl && !f) {
      localStorage.removeItem("ondura.forms.template");
      setForm((FORM_TEMPLATES.find((t) => t.id === tpl) ?? FORM_TEMPLATES[0]).make());
      setStartOpen(false);
    }
  }, [load, notify]);

  useEffect(() => {
    void setWindowTitle(`${form.title}${dirty ? " •" : ""} – ${tl("Ondura Formulare")}`);
  }, [form.title, dirty]);

  const fileName = (form.title || tl("Formular")).replace(/[\\/:*?"<>|]+/g, " ").trim();

  const save = useCallback(
    async (as = false): Promise<boolean> => {
      try {
        const target = await saveFile(as ? null : path, fileName, FILTER, JSON.stringify(formRef.current, null, 1), "application/json");
        if (!target) return false;
        if (isTauri) setPath(target);
        setDirty(false);
        notify(tl("Gespeichert"), target.split(/[\\/]/).pop());
        return true;
      } catch (e) {
        notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
        return false;
      }
    },
    [path, fileName, notify],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(formRef.current.title), () => save()), [save, unsaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save(e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const openFile = async () => {
    const f = await openTextFile([FILTER]);
    if (!f) return;
    if ((dirtyRef.current || path) && isTauri && f.path) {
      const { invoke } = await import("@tauri-apps/api/core");
      return void invoke("open_document", { appId: "forms", path: f.path });
    }
    load(f.text, f.path);
  };

  const newFrom = async (id: string) => {
    if ((dirtyRef.current || path) && isTauri) {
      localStorage.setItem("ondura.forms.template", id);
      const { invoke } = await import("@tauri-apps/api/core");
      return void invoke("open_document", { appId: "forms", path: null });
    }
    setForm((FORM_TEMPLATES.find((t) => t.id === id) ?? FORM_TEMPLATES[0]).make());
    setPath(null);
    setDirty(false);
    setStartOpen(false);
    setView("questions");
  };

  // ----------------------------------------------------- questions --

  const setQ = (q: Question) => update((f) => ({ ...f, questions: f.questions.map((x) => (x.id === q.id ? q : x)) }));
  const addQ = (type: QuestionType) => {
    update((f) => ({ ...f, questions: [...f.questions, newQuestion(type)] }));
    setTimeout(() => document.getElementById("forms-end")?.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const moveQ = (id: string, d: number) =>
    update((f) => {
      const i = f.questions.findIndex((q) => q.id === id);
      const j = i + d;
      if (j < 0 || j >= f.questions.length) return f;
      const list = [...f.questions];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...f, questions: list };
    });

  // ----------------------------------------------------- responses --

  const addResponses = (incoming: Response[], from: string) => {
    const { form: next, added } = mergeResponses(formRef.current, incoming);
    if (added) {
      setForm(next);
      setDirty(true);
    }
    notify(added ? (added === 1 ? tl("1 neue Antwort") : tl("{0} neue Antworten", added)) : tl("Keine neuen Antworten"), from, added ? "success" : "info");
  };

  /** Responses of the web form, collected from the mailboxes of Ondura Mail. */
  const fetchFromMail = async () => {
    setFetching(true);
    try {
      const hits = await api.search(`Ondura-Formular ${form.id}`);
      const found: Response[] = [];
      for (const h of hits) {
        if (!h.subject?.includes(form.id)) continue;
        const m = await api.getMessage(h.id).catch(() => null);
        const text = m ? (m.body.text ?? m.body.html?.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "") ?? "") : "";
        for (const e of decodeResponses(text)) if (e.f === form.id) found.push({ id: e.r, submitted: e.t, answers: e.a, source: "mail", respondent: h.from?.name || h.from?.email });
      }
      addResponses(found, tl("aus Ondura Mail"));
    } catch (e) {
      notify(tl("Antworten konnten nicht abgerufen werden"), errorMessage(e), "error");
    } finally {
      setFetching(false);
    }
  };

  /** Returned PDF forms and response files (.ondresponse, saved mails). */
  const importFiles = async () => {
    const files = await new Promise<File[]>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = ".pdf,.ondresponse,.txt,.eml";
      input.onchange = () => resolve(Array.from(input.files ?? []));
      input.oncancel = () => resolve([]);
      input.click();
    });
    if (!files.length) return;
    const found: Response[] = [];
    let foreign = 0;
    for (const f of files) {
      try {
        if (f.name.toLowerCase().endsWith(".pdf")) {
          const r = await responseFromPdf(form, new Uint8Array(await f.arrayBuffer()), f.name);
          if (r) found.push(r);
          else foreign++;
        } else {
          const list = decodeResponses(await f.text()).filter((e) => e.f === form.id);
          if (!list.length) foreign++;
          for (const e of list) found.push({ id: e.r, submitted: e.t, answers: e.a, source: "import", respondent: f.name });
        }
      } catch {
        foreign++;
      }
    }
    addResponses(found, foreign === 1 ? tl("1 Datei gehört nicht zu diesem Formular.") : foreign ? tl("{0} Dateien gehören nicht zu diesem Formular.", foreign) : files.length === 1 ? tl("aus 1 Datei") : tl("aus {0} Dateien", files.length));
  };

  const exportResponses = async (kind: "csv" | "xlsx") => {
    const rows = responseRows(form);
    if (kind === "csv" || !isTauri) {
      const target = await saveFile(null, `${fileName} – ${tl("Antworten")}`, { name: "CSV", extensions: ["csv"] }, toCsv(rows), "text/csv");
      if (target) notify(tl("Exportiert"), target.split(/[\\/]/).pop());
      return;
    }
    const target = await pickSaveFile(`${fileName} – ${tl("Antworten")}`, { name: tl("Excel-Arbeitsmappe"), extensions: ["xlsx"] });
    if (!target) return;
    const col = (i: number) => {
      let s2 = "";
      for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s2 = String.fromCharCode(65 + ((n - 1) % 26)) + s2;
      return s2;
    };
    const cells: Record<string, { v?: string | number; s?: number }> = {};
    rows.forEach((r, ri) => r.forEach((v, ci) => v !== "" && (cells[`${col(ci)}${ri + 1}`] = ri === 0 ? { v, s: 1 } : { v })));
    const workbook = {
      title: form.title,
      author: "",
      active: 0,
      styles: [{}, { bold: true, fill: "#f3f2f1" }],
      names: [],
      sheets: [{ name: tl("Antworten"), cells, cols: Object.fromEntries(rows[0].map((_, i) => [String(i), i === 0 ? 48 : i < 3 ? 140 : 220])), rows: {}, hiddenCols: [], hiddenRows: [], merges: [], freezeRows: 1, freezeCols: 0, showGrid: true }],
    };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("sheets_save", { path: target, password: null, workbook });
      await invoke("open_document", { appId: "sheets", path: target });
    } catch (e) {
      notify(tl("Export fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  // --------------------------------------------------------- share --

  const savePdf = async () => {
    try {
      const bytes = await formToPdf(form);
      const target = await saveFile(null, fileName, { name: tl("PDF-Dokument"), extensions: ["pdf"] }, bytes, "application/pdf");
      if (target) notify(tl("PDF-Formular gespeichert"), tl("Verschicken Sie die Datei. Ausgefüllte PDFs importieren Sie unter „Antworten“."));
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const saveHtml = async () => {
    try {
      const html = formToHtml(form);
      if (isTauri) {
        const target = await pickSaveFile(fileName, { name: tl("Web-Formular"), extensions: ["html"] });
        if (!target) return;
        await writeBytes(target, new TextEncoder().encode(html));
      } else download(`${fileName}.html`, new Blob([html], { type: "text/html" }));
      notify(tl("Web-Formular gespeichert"), form.replyTo ? tl("Antworten kommen per E-Mail an {0}.", form.replyTo) : tl("Ohne E-Mail-Adresse speichern die Teilnehmer ihre Antwort als Datei."));
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  // ----------------------------------------------------------- view --

  const answerable = form.questions.filter((q) => q.type !== "section");
  let qn = 0;
  const questionsView = (
    <div className={s.col}>
      <div className={mergeClasses(s.card, s.head)}>
        <div className={s.band} style={{ backgroundColor: form.color }} />
        <div className={s.headInner}>
          <Input appearance="underline" className={s.title} value={form.title} onChange={(_, d) => update((f) => ({ ...f, title: d.value }))} input={{ style: { fontSize: 24, fontWeight: 600 } }} />
          <Textarea resize="vertical" placeholder={tl("Beschreibung des Formulars")} value={form.description} onChange={(_, d) => update((f) => ({ ...f, description: d.value }))} />
          <div className={s.row}>
            <Text size={200} className={s.muted}>
              {tl("Design")}
            </Text>
            {THEME_COLORS.map((c) => (
              <button key={c} className={mergeClasses(s.swatch, form.color === c && s.swatchOn)} style={{ backgroundColor: c }} onClick={() => update((f) => ({ ...f, color: c }))} aria-label={c} />
            ))}
          </div>
        </div>
      </div>
      {form.questions.map((q, i) => {
        if (q.type !== "section") qn++;
        return (
          <QuestionEditor
            key={q.id}
            q={q}
            index={qn}
            color={form.color}
            last={i === form.questions.length - 1}
            onChange={setQ}
            onMove={(d) => moveQ(q.id, d)}
            onDuplicate={() => update((f) => ({ ...f, questions: [...f.questions.slice(0, i + 1), { ...clone(q), id: rid("q") }, ...f.questions.slice(i + 1)] }))}
            onDelete={() => update((f) => ({ ...f, questions: f.questions.filter((x) => x.id !== q.id) }))}
          />
        );
      })}
      <div id="forms-end" className={s.row}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="primary" icon={<Add20Regular />} style={{ backgroundColor: form.color }}>
              {tl("Neue Frage")}
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                <MenuItem key={t} onClick={() => addQ(t)}>
                  {TYPE_LABEL[t]()}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        {(["choice", "text", "rating", "date"] as QuestionType[]).map((t) => (
          <Button key={t} appearance="subtle" onClick={() => addQ(t)}>
            {TYPE_LABEL[t]()}
          </Button>
        ))}
      </div>
      <div className={s.card}>
        <Field label={tl("Text nach dem Absenden")}>
          <Input value={form.thanks} onChange={(_, d) => update((f) => ({ ...f, thanks: d.value }))} />
        </Field>
      </div>
    </div>
  );

  const responsesView = (
    <div className={s.col}>
      <div className={s.card}>
        <div className={s.row} style={{ justifyContent: "space-between" }}>
          <div>
            <div className={s.big}>{form.responses.length}</div>
            <Text className={s.muted}>{tl("Antworten")}</Text>
          </div>
          {form.responses.length > 0 && (
            <div>
              <Text block>{tl("Letzte Antwort")}</Text>
              <Text className={s.muted}>{new Date(form.responses[form.responses.length - 1].submitted).toLocaleString(LOCALE)}</Text>
            </div>
          )}
        </div>
        <div className={s.row}>
          {isTauri && (
            <Button icon={fetching ? <Spinner size="extra-tiny" /> : <MailInbox20Regular />} onClick={() => void fetchFromMail()} disabled={fetching}>
              {tl("Antworten aus Ondura Mail abrufen")}
            </Button>
          )}
          <Button icon={<ArrowUpload20Regular />} onClick={() => void importFiles()}>
            {tl("Antwortdateien importieren")}
          </Button>
          <Button icon={<Table20Regular />} onClick={() => void exportResponses("xlsx")} disabled={!form.responses.length}>
            {isTauri ? tl("In Excel öffnen") : tl("Als CSV exportieren")}
          </Button>
          {isTauri && (
            <Button appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => void exportResponses("csv")} disabled={!form.responses.length}>
              {tl("CSV")}
            </Button>
          )}
          <Button appearance="subtle" icon={<Eye20Regular />} onClick={() => setOne(one === null ? 0 : null)} disabled={!form.responses.length}>
            {one === null ? tl("Einzelne Antworten") : tl("Zusammenfassung")}
          </Button>
        </div>
      </div>
      {one !== null && form.responses[one] ? (
        <div className={s.card}>
          <div className={s.row} style={{ justifyContent: "space-between" }}>
            <div className={s.row}>
              <Button appearance="subtle" icon={<ChevronLeft20Regular />} disabled={one === 0} onClick={() => setOne(one - 1)} />
              <Text weight="semibold">{tl("Antwort {0} von {1}", one + 1, form.responses.length)}</Text>
              <Button appearance="subtle" icon={<ChevronRight20Regular />} disabled={one >= form.responses.length - 1} onClick={() => setOne(one + 1)} />
            </div>
            <Button
              appearance="subtle"
              icon={<Delete20Regular />}
              onClick={() => {
                if (!confirm(tl("Diese Antwort löschen?"))) return;
                update((f) => ({ ...f, responses: f.responses.filter((_, i) => i !== one) }));
                setOne(Math.max(0, one - 1));
              }}
            >
              {tl("Löschen")}
            </Button>
          </div>
          <Text size={200} className={s.muted}>
            {new Date(form.responses[one].submitted).toLocaleString(LOCALE)} · {form.responses[one].respondent ?? form.responses[one].source}
          </Text>
          {answerable.map((q, i) => (
            <div key={q.id}>
              <Text weight="semibold" block>
                {i + 1}. {q.title}
              </Text>
              <Text block style={{ whiteSpace: "pre-wrap" }}>
                {answerText(form.responses[one].answers[q.id]) || <span className={s.muted}>–</span>}
              </Text>
            </div>
          ))}
        </div>
      ) : (
        answerable.map((q, i) => <QuestionSummary key={q.id} q={q} index={i + 1} form={form} />)
      )}
      {!form.responses.length && (
        <Text className={s.muted} style={{ textAlign: "center", padding: 24 }}>
          {tl("Noch keine Antworten. Verteilen Sie das Formular unter „Verteilen“.")}
        </Text>
      )}
    </div>
  );

  const shareView = (
    <div className={s.col}>
      <div className={s.shareGrid}>
        <div className={s.card}>
          <Text weight="semibold" size={400}>
            {tl("Hier ausfüllen")}
          </Text>
          <Text className={s.muted}>{tl("Teilnehmende füllen das Formular an diesem Computer aus, z. B. am Empfang oder auf einem Messestand. Jede Antwort wird sofort gespeichert.")}</Text>
          <Button appearance="primary" icon={<DocumentAdd20Regular />} onClick={() => (setPreview(false), setView("fill"))} style={{ backgroundColor: form.color, alignSelf: "flex-start" }}>
            {tl("Ausfüllen starten")}
          </Button>
        </div>
        <div className={s.card}>
          <Text weight="semibold" size={400}>
            {tl("Web-Formular")}
          </Text>
          <Text className={s.muted}>{tl("Eine HTML-Datei, die in jedem Browser läuft – verschicken Sie sie per E-Mail oder legen Sie sie auf Ihre Website. Die Antworten kommen per E-Mail zurück; Ondura holt sie aus Ihrem Postfach.")}</Text>
          <Field label={tl("Antworten per E-Mail an")}>
            <Input type="email" placeholder="name@example.com" value={form.replyTo} onChange={(_, d) => update((f) => ({ ...f, replyTo: d.value.trim() }))} />
          </Field>
          <Button icon={<Globe20Regular />} onClick={() => void saveHtml()} style={{ alignSelf: "flex-start" }}>
            {tl("Web-Formular speichern")}
          </Button>
          <Text size={200} className={s.muted}>
            {tl("Betreff der Antworten: {0}", mailSubject(form))}
          </Text>
        </div>
        <div className={s.card}>
          <Text weight="semibold" size={400}>
            {tl("PDF-Formular")}
          </Text>
          <Text className={s.muted}>{tl("Ein ausfüllbares PDF für Acrobat, Ondura PDF, den Browser oder das Smartphone. Zurückgeschickte PDFs importieren Sie unter „Antworten“.")}</Text>
          <Button icon={<DocumentPdf20Regular />} onClick={() => void savePdf()} style={{ alignSelf: "flex-start" }}>
            {tl("PDF-Formular speichern")}
          </Button>
        </div>
        <div className={s.card}>
          <Text weight="semibold" size={400}>
            {tl("Antworten annehmen")}
          </Text>
          <Switch checked={!form.closed} label={form.closed ? tl("Geschlossen – keine neuen Antworten") : tl("Nimmt Antworten an")} onChange={(_, d) => update((f) => ({ ...f, closed: !d.checked }))} />
        </div>
      </div>
    </div>
  );

  let body: ReactNode;
  if (view === "fill") body = <FillView key={preview ? "p" : "f"} form={form} preview={preview} onSubmit={preview ? undefined : (r) => update((f) => ({ ...f, responses: [...f.responses, r] }))} />;
  else if (view === "responses") body = responsesView;
  else if (view === "share") body = shareView;
  else body = questionsView;

  return (
    <div className={s.root} style={{ position: "relative" }}>
      <SuiteHeader appName={tlc("app", "Formulare")} logo="/forms.svg" center={`${form.title}${dirty ? " •" : ""}${!path ? tl(" – nicht gespeichert") : ""}`} />
      <div className={s.bar}>
        <TabList selectedValue={view === "fill" ? (preview ? "preview" : "fill") : view} onTabSelect={(_, d) => (d.value === "preview" ? (setPreview(true), setView("fill")) : setView(d.value as View))}>
          <Tab value="questions">{tl("Fragen")}</Tab>
          <Tab value="responses">{tl("Antworten ({0})", form.responses.length)}</Tab>
          <Tab value="share">{tl("Verteilen")}</Tab>
          <Tab value="preview" icon={<Eye20Regular />}>
            {tl("Vorschau")}
          </Tab>
          {view === "fill" && !preview && <Tab value="fill">{tl("Ausfüllen")}</Tab>}
        </TabList>
        <div style={{ flex: 1 }} />
        <Button appearance="subtle" icon={<DocumentAdd20Regular />} onClick={() => setStartOpen(true)}>
          {tl("Neu")}
        </Button>
        <Button appearance="subtle" icon={<FolderOpen20Regular />} onClick={() => void openFile()}>
          {tl("Öffnen")}
        </Button>
        <Button appearance="primary" icon={<Save20Regular />} onClick={() => void save()} style={{ backgroundColor: COLOR }}>
          {tl("Speichern")}
        </Button>
      </div>
      <div className={s.body} style={{ background: `color-mix(in srgb, ${form.color} 7%, transparent)` }}>
        {body}
      </div>
      {startOpen && (
        <div className={s.start}>
          <Text size={600} weight="semibold">
            {tl("Neues Formular")}
          </Text>
          <div className={s.tpls}>
            {FORM_TEMPLATES.map((t) => {
              const f = t.make();
              return (
                <button key={t.id} className={s.tpl} onClick={() => void newFrom(t.id)}>
                  <div style={{ height: 34, backgroundColor: f.color, flexShrink: 0 }} />
                  <div style={{ padding: "10px 12px", textAlign: "left", display: "flex", flexDirection: "column", gap: 4 }}>
                    <Text weight="semibold">{t.label()}</Text>
                    <Text size={200} className={s.muted}>
                      {f.questions.length ? tl("{0} Fragen", f.questions.length) : tl("Ohne Fragen")}
                    </Text>
                  </div>
                </button>
              );
            })}
          </div>
          <div className={s.row}>
            <Button icon={<FolderOpen20Regular />} onClick={() => void openFile()}>
              {tl("Öffnen …")}
            </Button>
            {(form.questions.length > 0 || path) && (
              <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={() => setStartOpen(false)}>
                {tl("Zurück zum Formular")}
              </Button>
            )}
          </div>
        </div>
      )}
      {unsaved.dialog}
    </div>
  );
}
