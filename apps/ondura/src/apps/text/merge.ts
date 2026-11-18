// Mail merge ("Sendungen"): recipient lists from CSV, spreadsheets or the
// contacts, merge fields («Feld») in the document, preview and the merged
// result (one copy of the document per recipient, separated by page breaks).
import type { JSONContent } from "@tiptap/core";
import type { Contact } from "../../lib/pim";
import type { RustWorkbook } from "../sheets/model";
import { parseA1 } from "../sheets/model";

export interface MergeData {
  /** Shown name of the source (file name, "Kontakte"). */
  source: string;
  columns: string[];
  rows: string[][];
}

/** Recipient list with the user's selection and sort order. */
export interface MergeState {
  data: MergeData;
  /** Included rows, by index into `data.rows`. */
  included: boolean[];
  /** Order of the rows (indices into `data.rows`). */
  order: number[];
}

export function mergeState(data: MergeData): MergeState {
  return { data, included: data.rows.map(() => true), order: data.rows.map((_, i) => i) };
}

/** Rows that take part in the merge, in list order. */
export function activeRows(m: MergeState): number[] {
  return m.order.filter((i) => m.included[i]);
}

export function recordOf(data: MergeData, row: number): Record<string, string> {
  const out: Record<string, string> = {};
  data.columns.forEach((c, i) => (out[c] = data.rows[row]?.[i] ?? ""));
  return out;
}

// ------------------------------------------------------------- sources --

/** Parses CSV; the delimiter (`;`, `,` or tab) is guessed from the header line. */
export function parseCsv(text: string, source = "Liste"): MergeData {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [";", "\t", ","].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ";");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return table(rows.filter((r) => r.some((c) => c.trim() !== "")), source);
}

/** First row = column names; empty or duplicate names are made unique. */
function table(rows: string[][], source: string): MergeData {
  const head = rows[0] ?? [];
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const columns: string[] = [];
  for (let i = 0; i < width; i++) {
    const base = (head[i] ?? "").trim() || `Spalte ${i + 1}`;
    let name = base;
    for (let n = 2; columns.includes(name); n++) name = `${base} ${n}`;
    columns.push(name);
  }
  const body = rows.slice(1).map((r) => columns.map((_, i) => (r[i] ?? "").trim()));
  return { source, columns, rows: body };
}

function cellText(v: number | string | boolean | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "WAHR" : "FALSCH";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("de-DE", { maximumFractionDigits: 10 });
  return v;
}

/** Table of a worksheet (first row = column names). */
export function sheetData(wb: RustWorkbook, sheet: number, source: string): MergeData {
  const s = wb.sheets[sheet];
  const grid: string[][] = [];
  for (const [ref, c] of Object.entries(s?.cells ?? {})) {
    const p = parseA1(ref);
    if (!p) continue;
    (grid[p.r] ??= [])[p.c] = cellText(c.v);
  }
  const rows = Array.from(grid, (r) => Array.from(r ?? [], (c) => c ?? "")).filter((r) => r.some((c) => c.trim() !== ""));
  return table(rows, source);
}

export const CONTACT_COLUMNS = ["Vorname", "Nachname", "Anzeigename", "Firma", "Position", "E-Mail", "Telefon", "Straße", "PLZ", "Ort", "Land"];

export function contactData(contacts: Contact[]): MergeData {
  const rows = contacts.map((c) => {
    const a = c.addresses[0];
    return [c.givenName, c.familyName, c.displayName, c.company, c.jobTitle, c.emails[0]?.value ?? "", c.phones[0]?.value ?? "", a?.street ?? "", a?.postalCode ?? "", a?.city ?? "", a?.country ?? ""];
  });
  return { source: "Kontakte", columns: [...CONTACT_COLUMNS], rows };
}

// ------------------------------------------------------- address block --

const ALIASES: Record<string, string[]> = {
  salutation: ["anrede", "salutation", "title"],
  first: ["vorname", "first name", "firstname", "given name"],
  last: ["nachname", "name", "last name", "lastname", "surname", "family name"],
  company: ["firma", "unternehmen", "company", "organisation", "organization"],
  street: ["straße", "strasse", "str.", "adresse", "address", "street"],
  zip: ["plz", "postleitzahl", "zip", "postal code"],
  city: ["ort", "stadt", "city", "wohnort"],
  country: ["land", "country"],
};

/** Column that matches a role of the address block, if any. */
export function columnFor(columns: string[], role: keyof typeof ALIASES): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").trim();
  for (const alias of ALIASES[role]) {
    const hit = columns.find((c) => norm(c) === alias);
    if (hit) return hit;
  }
  return null;
}

/** Lines of the address block, each a list of column names (and literal spaces). */
export function addressLines(columns: string[]): string[][] {
  const c = (role: keyof typeof ALIASES) => columnFor(columns, role);
  const lines: (string | null)[][] = [[c("company")], [c("salutation")], [c("first"), c("last")], [c("street")], [c("zip"), c("city")], [c("country")]];
  return lines.map((l) => l.filter((x): x is string => !!x)).filter((l) => l.length);
}

/** Paragraphs of an address block made of merge fields. */
export function addressBlockContent(columns: string[]): JSONContent[] {
  return addressLines(columns).map((line) => ({
    type: "paragraph",
    attrs: { spaceAfter: 0 },
    content: line.flatMap((col, i) => [...(i ? [{ type: "text", text: " " }] : []), { type: "field", attrs: { field: `merge ${col}`, result: null } }]),
  }));
}

/** Greeting line ("Guten Tag «Vorname» «Nachname»,"). */
export function greetingContent(columns: string[]): JSONContent[] {
  const first = columnFor(columns, "first");
  const last = columnFor(columns, "last");
  const parts: JSONContent[] = [{ type: "text", text: "Guten Tag " }];
  for (const col of [first, last].filter((x): x is string => !!x)) {
    if (parts.length > 1) parts.push({ type: "text", text: " " });
    parts.push({ type: "field", attrs: { field: `merge ${col}`, result: null } });
  }
  parts.push({ type: "text", text: "," });
  return [{ type: "paragraph", content: parts }];
}

// --------------------------------------------------------------- merge --

const mergeColumn = (n: JSONContent) => {
  const f = String(n.attrs?.field ?? "");
  return n.type === "field" && f.startsWith("merge ") ? f.slice(6) : null;
};

/** Columns used by merge fields in a document. */
export function fieldsInDoc(doc: JSONContent): string[] {
  const out = new Set<string>();
  const walk = (n: JSONContent) => {
    const col = mergeColumn(n);
    if (col) out.add(col);
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...out];
}

/**
 * Content of the document for one record: merge fields become plain text;
 * paragraphs made only of merge fields that are all empty are left out
 * (empty lines of an address block).
 */
export function mergeRecord(nodes: JSONContent[], record: Record<string, string>): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    const col = mergeColumn(n);
    if (col !== null) {
      const text = record[col] ?? "";
      if (text) out.push({ type: "text", text, ...(n.marks?.length ? { marks: n.marks } : {}) });
      continue;
    }
    if (!n.content) {
      out.push(n);
      continue;
    }
    if (n.type === "paragraph" && onlyEmptyMergeFields(n, record)) continue;
    out.push({ ...n, content: mergeRecord(n.content, record) });
  }
  return out;
}

function onlyEmptyMergeFields(p: JSONContent, record: Record<string, string>): boolean {
  const items = p.content ?? [];
  let fields = 0;
  for (const n of items) {
    const col = mergeColumn(n);
    if (col !== null) {
      if (record[col]) return false;
      fields++;
    } else if (n.type !== "text" || (n.text ?? "").trim() !== "") return false;
  }
  return fields > 0;
}

/** The merged document: one copy per record, each starting on a new page. */
export function mergeAll(doc: JSONContent, data: MergeData, rows: number[]): JSONContent[] {
  const out: JSONContent[] = [];
  rows.forEach((r, i) => {
    if (i) out.push({ type: "pageBreak" });
    out.push(...mergeRecord(doc.content ?? [], recordOf(data, r)));
  });
  return out;
}
