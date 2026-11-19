// Forms of Ondura Formulare: questions, responses and their evaluation.
// A form and its responses are one file (.ondform, JSON).

import { tl } from "../../lib/i18n";

export type QuestionType = "text" | "longtext" | "choice" | "multi" | "dropdown" | "number" | "date" | "rating" | "scale" | "section";

export interface Question {
  id: string;
  type: QuestionType;
  title: string;
  description?: string;
  required: boolean;
  /** Choice, multiple choice and dropdown. */
  options?: string[];
  /** An "other" answer with a text field (choice, multiple choice). */
  other?: boolean;
  /** Rating: number of stars; scale: 0…10 (net promoter) or 1…max. */
  max?: number;
  /** Labels of the ends of a scale. */
  minLabel?: string;
  maxLabel?: string;
}

export type Answer = string | string[] | number | null;

export interface Response {
  id: string;
  /** ISO time. */
  submitted: string;
  answers: Record<string, Answer>;
  /** Where the response came from. */
  source: "app" | "pdf" | "web" | "mail" | "import";
  respondent?: string;
}

export interface Form {
  id: string;
  title: string;
  description: string;
  color: string;
  questions: Question[];
  responses: Response[];
  /** Text after submitting. */
  thanks: string;
  /** Web form: responses are mailed to this address. */
  replyTo: string;
  /** No longer accepts responses. */
  closed?: boolean;
  created: string;
}

export const THEME_COLORS = ["#c27c0e", "#038387", "#0078d4", "#7719aa", "#107c41", "#c43e1c", "#4f52b2", "#e3008c", "#5c2e91", "#3b3a39"];

export const TYPE_LABEL: Record<QuestionType, () => string> = {
  choice: () => tl("Auswahl"),
  multi: () => tl("Mehrfachauswahl"),
  dropdown: () => tl("Dropdown"),
  text: () => tl("Text"),
  longtext: () => tl("Langer Text"),
  number: () => tl("Zahl"),
  date: () => tl("Datum"),
  rating: () => tl("Bewertung"),
  scale: () => tl("Skala (0–10)"),
  section: () => tl("Abschnitt"),
};

export const rid = (p = "") => p + crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), "").slice(0, 12);

export function newQuestion(type: QuestionType): Question {
  const q: Question = { id: rid("q"), type, title: "", required: false };
  if (type === "choice" || type === "multi" || type === "dropdown") q.options = [tl("Option 1"), tl("Option 2")];
  if (type === "rating") q.max = 5;
  if (type === "scale") Object.assign(q, { max: 10, minLabel: tl("Sehr unwahrscheinlich"), maxLabel: tl("Sehr wahrscheinlich") });
  return q;
}

export function newForm(title = tl("Unbenanntes Formular")): Form {
  return { id: rid("f"), title, description: "", color: THEME_COLORS[0], questions: [], responses: [], thanks: tl("Vielen Dank! Ihre Antwort wurde gespeichert."), replyTo: "", created: new Date().toISOString() };
}

/** Templates of the start page. */
export const FORM_TEMPLATES: { id: string; label: () => string; make: () => Form }[] = [
  { id: "blank", label: () => tl("Leeres Formular"), make: () => newForm() },
  {
    id: "feedback",
    label: () => tl("Kundenzufriedenheit"),
    make: () => {
      const f = newForm(tl("Wie zufrieden sind Sie?"));
      f.description = tl("Ihre Meinung hilft uns, besser zu werden. Die Umfrage dauert etwa zwei Minuten.");
      f.color = THEME_COLORS[1];
      f.questions = [
        { ...newQuestion("rating"), title: tl("Wie zufrieden sind Sie insgesamt?"), required: true },
        { ...newQuestion("scale"), title: tl("Wie wahrscheinlich ist es, dass Sie uns weiterempfehlen?") },
        { ...newQuestion("multi"), title: tl("Was hat Ihnen gefallen?"), options: [tl("Beratung"), tl("Preis"), tl("Qualität"), tl("Lieferzeit")], other: true },
        { ...newQuestion("longtext"), title: tl("Was können wir besser machen?") },
      ];
      return f;
    },
  },
  {
    id: "event",
    label: () => tl("Anmeldung zur Veranstaltung"),
    make: () => {
      const f = newForm(tl("Anmeldung"));
      f.description = tl("Bitte melden Sie sich bis eine Woche vor der Veranstaltung an.");
      f.color = THEME_COLORS[2];
      f.questions = [
        { ...newQuestion("text"), title: tl("Name"), required: true },
        { ...newQuestion("text"), title: tl("E-Mail-Adresse"), required: true },
        { ...newQuestion("choice"), title: tl("Nehmen Sie teil?"), options: [tl("Ja"), tl("Nein"), tl("Vielleicht")], required: true },
        { ...newQuestion("number"), title: tl("Anzahl der Begleitpersonen") },
        { ...newQuestion("dropdown"), title: tl("Essenswunsch"), options: [tl("Keine Vorgabe"), tl("Vegetarisch"), tl("Vegan")] },
      ];
      return f;
    },
  },
  {
    id: "quiz",
    label: () => tl("Terminabstimmung"),
    make: () => {
      const f = newForm(tl("Wann passt es Ihnen?"));
      f.color = THEME_COLORS[4];
      f.questions = [
        { ...newQuestion("text"), title: tl("Name"), required: true },
        { ...newQuestion("multi"), title: tl("Mögliche Termine"), options: [tl("Montag, 10 Uhr"), tl("Dienstag, 14 Uhr"), tl("Donnerstag, 9 Uhr")], required: true },
        { ...newQuestion("longtext"), title: tl("Anmerkungen") },
      ];
      return f;
    },
  },
];

/** Missing answers to required questions (ids). */
export function missingRequired(form: Form, answers: Record<string, Answer>): string[] {
  return form.questions
    .filter((q) => q.required && q.type !== "section")
    .filter((q) => {
      const a = answers[q.id];
      return a === null || a === undefined || a === "" || (Array.isArray(a) && !a.length);
    })
    .map((q) => q.id);
}

/** An answer as text (tables, mails). */
export function answerText(a: Answer | undefined): string {
  if (a === null || a === undefined) return "";
  if (Array.isArray(a)) return a.join("; ");
  return String(a);
}

export interface Summary {
  count: number;
  /** Choice questions: count per option (in option order, then "other" answers). */
  options?: { label: string; count: number }[];
  /** Number, rating and scale. */
  average?: number;
  distribution?: { label: string; count: number }[];
  /** Net promoter score for 0–10 scales. */
  nps?: number;
  /** Text answers, newest first. */
  texts?: string[];
}

export function summarize(q: Question, responses: Response[]): Summary {
  const answers = responses.map((r) => r.answers[q.id]).filter((a) => a !== null && a !== undefined && a !== "" && !(Array.isArray(a) && !a.length));
  const s: Summary = { count: answers.length };
  if (q.type === "choice" || q.type === "multi" || q.type === "dropdown") {
    const counts = new Map<string, number>((q.options ?? []).map((o) => [o, 0]));
    for (const a of answers) for (const v of Array.isArray(a) ? a : [String(a)]) counts.set(v, (counts.get(v) ?? 0) + 1);
    s.options = [...counts].map(([label, count]) => ({ label, count }));
  } else if (q.type === "number" || q.type === "rating" || q.type === "scale") {
    const nums = answers.map(Number).filter((n) => !isNaN(n));
    s.average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
    if (q.type !== "number") {
      const lo = q.type === "scale" ? 0 : 1;
      const hi = q.max ?? (q.type === "scale" ? 10 : 5);
      s.distribution = Array.from({ length: hi - lo + 1 }, (_, i) => ({ label: String(lo + i), count: nums.filter((n) => n === lo + i).length }));
      if (q.type === "scale" && hi === 10 && nums.length) {
        const promoters = nums.filter((n) => n >= 9).length;
        const detractors = nums.filter((n) => n <= 6).length;
        s.nps = Math.round(((promoters - detractors) / nums.length) * 100);
      }
    }
  } else {
    s.texts = responses
      .slice()
      .sort((a, b) => b.submitted.localeCompare(a.submitted))
      .map((r) => answerText(r.answers[q.id]))
      .filter(Boolean);
  }
  return s;
}

/** Responses as rows (header first) for CSV and Excel. */
export function responseRows(form: Form): (string | number)[][] {
  const qs = form.questions.filter((q) => q.type !== "section");
  const header = [tl("Nr."), tl("Eingegangen"), tl("Quelle"), ...qs.map((q) => q.title || tl("Frage"))];
  const rows = form.responses.map((r, i) => [i + 1, new Date(r.submitted).toLocaleString(), r.source, ...qs.map((q) => {
    const a = r.answers[q.id];
    return typeof a === "number" ? a : answerText(a);
  })]);
  return [header, ...rows];
}

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const t = String(v);
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  // Semicolons: what Excel expects with German settings.
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

// ------------------------------------------------- response transport --

const BEGIN = "----- ONDURA-FORMULAR-ANTWORT -----";
const END = "----- ENDE -----";

export interface Envelope {
  f: string;
  r: string;
  t: string;
  a: Record<string, Answer>;
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));

/** Machine-readable block of a response (web form mails, response files). */
export function encodeResponse(e: Envelope): string {
  return `${BEGIN}\n${b64(JSON.stringify(e)).replace(/(.{76})/g, "$1\n")}\n${END}`;
}

/** All response blocks in a text (a mail may quote several). */
export function decodeResponses(text: string): Envelope[] {
  const out: Envelope[] = [];
  const re = new RegExp(`${BEGIN.replace(/[-]/g, "\\-")}([\\s\\S]*?)${END.replace(/[-]/g, "\\-")}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      const e = JSON.parse(unb64(m[1].replace(/^>\s?/gm, ""))) as Envelope;
      if (e && typeof e.f === "string" && e.a) out.push(e);
    } catch {
      /* damaged block */
    }
  }
  return out;
}

/** Subject of response mails; the form id finds them in the mailbox. */
export const mailSubject = (form: Pick<Form, "id" | "title">) => `[Ondura-Formular ${form.id}] ${form.title}`;

/** Adds responses that are not there yet (by id); returns how many were new. */
export function mergeResponses(form: Form, incoming: Response[]): { form: Form; added: number } {
  const known = new Set(form.responses.map((r) => r.id));
  const fresh = incoming.filter((r) => !known.has(r.id) && (known.add(r.id), true));
  return { form: { ...form, responses: [...form.responses, ...fresh].sort((a, b) => a.submitted.localeCompare(b.submitted)) }, added: fresh.length };
}
