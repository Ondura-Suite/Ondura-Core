// Microsoft Graph for Ondura Notizen (OneNote) and Ondura Planer (Planner),
// through the backend bridge (`graph_request`): the backend adds the token
// of the chosen account for the area's permissions only. Local notebooks
// and plans are JSON documents in the data directory (`store_*`).

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { tl } from "./i18n";

export type GraphArea = "notes" | "planner";

/** Thrown when the account has not yet allowed the area's permissions. */
export class ConsentRequired extends Error {
  constructor() {
    super(tl("Ondura braucht dafür Ihre Zustimmung."));
  }
}

export class GraphError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RawResponse {
  status: number;
  etag: string | null;
  contentType: string | null;
  body: string;
  base64: boolean;
}

export interface GraphOptions {
  body?: unknown;
  /** Content type of a string body (default JSON). */
  contentType?: string;
  ifMatch?: string;
  binary?: boolean;
}

export async function graphRaw(account: string, area: GraphArea, method: string, path: string, o: GraphOptions = {}): Promise<RawResponse> {
  const body = o.body === undefined ? null : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  try {
    const r = await invoke<RawResponse>("graph_request", { account, area, method, path, body, contentType: o.contentType ?? null, ifMatch: o.ifMatch ?? null, binary: o.binary ?? false });
    if (r.status >= 400) {
      let msg = r.body;
      try {
        msg = (JSON.parse(r.body) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        /* not JSON */
      }
      if (r.status === 403 && /consent|scope|permission/i.test(msg)) throw new ConsentRequired();
      throw new GraphError(r.status, msg || `HTTP ${r.status}`);
    }
    return r;
  } catch (e) {
    if (String(e).includes("ONDURA_CONSENT_REQUIRED")) throw new ConsentRequired();
    throw e;
  }
}

/** JSON request; `null` for empty answers (204). */
export async function graph<T>(account: string, area: GraphArea, method: string, path: string, o: GraphOptions = {}): Promise<T> {
  const r = await graphRaw(account, area, method, path, o);
  return (r.body ? JSON.parse(r.body) : null) as T;
}

/** All pages of a collection (`@odata.nextLink`). */
export async function graphAll<T>(account: string, area: GraphArea, path: string, limit = 2000): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next && out.length < limit) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await graph(account, area, "GET", next);
    out.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Asks for the area's permissions in the browser. */
export async function grantAccess(account: string, area: GraphArea): Promise<void> {
  await invoke("graph_grant", { account, area });
}

export interface CloudAccountInfo {
  key: string;
  email: string;
  name: string;
  personal: boolean;
  fromMail: boolean;
}

export async function microsoftAccounts(): Promise<CloudAccountInfo[]> {
  if (!isTauri) return [];
  return invoke<CloudAccountInfo[]>("cloud_accounts").catch(() => []);
}

// --------------------------------------------------------- local store --

export interface StoredDoc {
  id: string;
  name: string;
  modified: number;
}

const LS = (kind: string) => `ondura.store.${kind}`;

/** Local documents; the browser preview keeps them in localStorage. */
export async function storeList(kind: GraphArea): Promise<StoredDoc[]> {
  if (isTauri) return invoke<StoredDoc[]>("store_list", { kind });
  const all = JSON.parse(localStorage.getItem(LS(kind)) ?? "{}") as Record<string, { name: string; modified: number }>;
  return Object.entries(all)
    .map(([id, v]) => ({ id, name: v.name, modified: v.modified }))
    .sort((a, b) => b.modified - a.modified);
}

export async function storeRead<T>(kind: GraphArea, id: string): Promise<T> {
  if (isTauri) return JSON.parse(await invoke<string>("store_read", { kind, id })) as T;
  const raw = localStorage.getItem(`${LS(kind)}.${id}`);
  if (!raw) throw new Error(tl("Nicht gefunden"));
  return JSON.parse(raw) as T;
}

export async function storeWrite(kind: GraphArea, id: string, doc: { name: string }): Promise<void> {
  const json = JSON.stringify(doc);
  if (isTauri) return invoke("store_write", { kind, id, json });
  localStorage.setItem(`${LS(kind)}.${id}`, json);
  const all = JSON.parse(localStorage.getItem(LS(kind)) ?? "{}") as Record<string, { name: string; modified: number }>;
  all[id] = { name: doc.name, modified: Date.now() };
  localStorage.setItem(LS(kind), JSON.stringify(all));
}

export async function storeDelete(kind: GraphArea, id: string): Promise<void> {
  if (isTauri) return invoke("store_delete", { kind, id });
  localStorage.removeItem(`${LS(kind)}.${id}`);
  const all = JSON.parse(localStorage.getItem(LS(kind)) ?? "{}") as Record<string, unknown>;
  delete all[id];
  localStorage.setItem(LS(kind), JSON.stringify(all));
}

/** Short random id for local documents and their parts. */
export function newId(prefix = ""): string {
  const r = crypto.getRandomValues(new Uint8Array(9));
  return prefix + Array.from(r, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
