// OneDrive and SharePoint for the office apps (see src-tauri/src/cloud.rs).
// Cloud documents have paths `onedrive://<account>/<drive>/<item>/<name>`
// and are opened and saved through the normal office commands.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { tl, LOCALE } from "./i18n";

export interface CloudAccount {
  key: string;
  email: string;
  name: string;
  personal: boolean;
  /** A Microsoft 365 mail account (own OneDrive only). */
  fromMail: boolean;
}

export interface DriveInfo {
  id: string;
  name: string;
  site?: string | null;
  webUrl?: string | null;
}

export interface CloudEntry {
  id: string;
  driveId: string;
  name: string;
  folder: boolean;
  size: number;
  modified?: string | null;
  modifiedBy?: string | null;
  webUrl?: string | null;
  childCount?: number | null;
  /** Path to open (files only). */
  path?: string | null;
}

export const CLOUD_SCHEME = "onedrive://";

export const isCloudPath = (path: string | null | undefined): path is string => !!path && path.startsWith(CLOUD_SCHEME);

/** Account key of a cloud path. */
export function cloudAccountOf(path: string): string | null {
  if (!isCloudPath(path)) return null;
  return path.slice(CLOUD_SCHEME.length).split("/")[0].replace(/%2F/g, "/").replace(/%25/g, "%");
}

// ---------------------------------------------------- browser demo data --

const demoAccount: CloudAccount = { key: "o-demo", email: "demo@mirranet.de", name: tl("Demo Benutzer"), personal: false, fromMail: false };
let demoSignedIn = false;
const now = Date.now();
const iso = (days: number) => new Date(now - days * 86400_000).toISOString();
const demoFiles: Record<string, CloudEntry[]> = {
  root: [
    { id: "f-projekte", driveId: "d1", name: tl("Projekte"), folder: true, size: 0, childCount: 3, modified: iso(1) },
    { id: "f-vorlagen", driveId: "d1", name: tl("Vorlagen"), folder: true, size: 0, childCount: 2, modified: iso(9) },
    { id: "i-bericht", driveId: "d1", name: "Projektbericht.docx", folder: false, size: 48_210, modified: iso(0), modifiedBy: "Demo Benutzer" },
    { id: "i-umsatz", driveId: "d1", name: "Umsatz 2026.xlsx", folder: false, size: 22_400, modified: iso(2), modifiedBy: "Sophie Berger" },
    { id: "i-pitch", driveId: "d1", name: "Ondura 2027.pptx", folder: false, size: 1_204_000, modified: iso(5), modifiedBy: "Demo Benutzer" },
  ],
  "f-projekte": [
    { id: "i-plan", driveId: "d1", name: "Zeitplan.xlsx", folder: false, size: 18_000, modified: iso(3) },
    { id: "i-konzept", driveId: "d1", name: "Konzept.docx", folder: false, size: 31_000, modified: iso(4) },
    { id: "i-kickoff", driveId: "d1", name: "Kickoff.pptx", folder: false, size: 840_000, modified: iso(6) },
  ],
  "f-vorlagen": [
    { id: "i-brief", driveId: "d1", name: "Briefvorlage.docx", folder: false, size: 12_000, modified: iso(30) },
    { id: "i-rechnung", driveId: "d1", name: "Rechnung.xlsx", folder: false, size: 9_000, modified: iso(40) },
  ],
};
const withPaths = (list: CloudEntry[]) => list.map((e) => ({ ...e, path: e.folder ? null : `${CLOUD_SCHEME}o-demo/d1/${e.id}/${e.name}` }));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ API --

export const cloud = {
  async accounts(): Promise<CloudAccount[]> {
    if (!isTauri) return demoSignedIn ? [demoAccount] : [];
    return invoke("cloud_accounts");
  },
  /** Sign in in the browser; `personal` = Outlook.com/Hotmail account. */
  async signIn(personal: boolean, tenant?: string): Promise<CloudAccount> {
    if (!isTauri) {
      await delay(500);
      demoSignedIn = true;
      return demoAccount;
    }
    return invoke("cloud_sign_in", { personal, tenant: tenant || null });
  },
  async signOut(key: string): Promise<void> {
    if (!isTauri) {
      demoSignedIn = false;
      return;
    }
    return invoke("cloud_sign_out", { key });
  },
  async locations(key: string): Promise<DriveInfo[]> {
    if (!isTauri) return [{ id: "d1", name: tl("OneDrive") }, { id: "d2", name: tl("Dokumente"), site: tl("Team MirraNET") }];
    return invoke("cloud_locations", { key });
  },
  async list(key: string, driveId: string, folderId?: string | null): Promise<CloudEntry[]> {
    if (!isTauri) {
      await delay(200);
      return withPaths(driveId === "d2" ? demoFiles["f-projekte"] : (demoFiles[folderId ?? "root"] ?? []));
    }
    return invoke("cloud_list", { key, driveId, folderId: folderId ?? null });
  },
  async recent(key: string): Promise<CloudEntry[]> {
    if (!isTauri) return withPaths(demoFiles.root.filter((f) => !f.folder));
    return invoke("cloud_recent", { key });
  },
  async shared(key: string): Promise<CloudEntry[]> {
    if (!isTauri) return withPaths([{ id: "i-shared", driveId: "d3", name: "Budget Team.xlsx", folder: false, size: 30_000, modified: iso(1), modifiedBy: "Max Becker" }]);
    return invoke("cloud_shared", { key });
  },
  async search(key: string, query: string): Promise<CloudEntry[]> {
    if (!isTauri) return withPaths(Object.values(demoFiles).flat().filter((f) => f.name.toLowerCase().includes(query.toLowerCase())));
    return invoke("cloud_search", { key, query });
  },
  async createFolder(key: string, driveId: string, parentId: string | null, name: string): Promise<CloudEntry> {
    if (!isTauri) {
      const f: CloudEntry = { id: `f-${Date.now()}`, driveId, name, folder: true, size: 0, childCount: 0, modified: new Date().toISOString() };
      (demoFiles[parentId ?? "root"] ??= []).unshift(f);
      return f;
    }
    return invoke("cloud_create_folder", { key, driveId, parentId, name });
  },
  /** Create the target of "Speichern unter"; throws "exists" if the name is taken (unless `replace`). */
  async reserve(key: string, driveId: string, folderId: string | null, name: string, replace = false): Promise<string> {
    if (!isTauri) throw new Error(tl("Speichern ist im Browser-Vorschaumodus nicht verfügbar."));
    return invoke("cloud_reserve", { key, driveId, folderId, name, replace });
  },
  async info(path: string): Promise<CloudEntry> {
    if (!isTauri) return { id: "x", driveId: "d1", name: path.split("/").pop() ?? "", folder: false, size: 0, webUrl: "https://onedrive.live.com" };
    return invoke("cloud_info", { path });
  },
  /** Sharing link (copied by the caller). */
  async share(path: string, edit: boolean, organization: boolean): Promise<string> {
    if (!isTauri) return "https://1drv.ms/w/s!demo-link";
    return invoke("cloud_share", { path, edit, organization });
  },
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`;
}
