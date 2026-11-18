// File handling shared by the office apps: open/save dialogs, recent
// files, document windows and the unsaved-changes guard.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";

export type OfficeApp = "text" | "sheets" | "slides";

export const FORMATS: Record<OfficeApp, { ext: string; name: string; label: string }> = {
  text: { ext: "docx", name: "Word-Dokument", label: "Dokument" },
  sheets: { ext: "xlsx", name: "Excel-Arbeitsmappe", label: "Arbeitsmappe" },
  slides: { ext: "pptx", name: "PowerPoint-Präsentation", label: "Präsentation" },
};

export interface RecentFile {
  path: string;
  name: string;
  opened: number;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function withoutExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

const recentKey = (app: OfficeApp) => `nexora.recent.${app}`;

export function recentFiles(app: OfficeApp): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey(app)) ?? "[]");
  } catch {
    return [];
  }
}

export function addRecent(app: OfficeApp, path: string) {
  const list = recentFiles(app).filter((r) => r.path !== path);
  list.unshift({ path, name: baseName(path), opened: Date.now() });
  try {
    localStorage.setItem(recentKey(app), JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage full or unavailable */
  }
}

export function removeRecent(app: OfficeApp, path: string) {
  try {
    localStorage.setItem(recentKey(app), JSON.stringify(recentFiles(app).filter((r) => r.path !== path)));
  } catch {
    /* ignore */
  }
}

export async function pickOpenPath(app: OfficeApp): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const f = FORMATS[app];
  const r = await open({ multiple: false, filters: [{ name: f.name, extensions: app === "sheets" ? ["xlsx", "xlsm"] : [f.ext] }] });
  return typeof r === "string" ? r : null;
}

export async function pickSavePath(app: OfficeApp, suggested: string): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const f = FORMATS[app];
  const name = suggested.toLowerCase().endsWith(`.${f.ext}`) ? suggested : `${suggested || f.label}.${f.ext}`;
  const r = await save({ defaultPath: name, filters: [{ name: f.name, extensions: [f.ext] }] });
  if (!r) return null;
  return r.toLowerCase().endsWith(`.${f.ext}`) ? r : `${r}.${f.ext}`;
}

/** New window with a document (or an empty one). */
export async function openDocumentWindow(app: OfficeApp, path?: string) {
  if (!isTauri) {
    window.open(`${location.pathname}#/${app}`, "_blank");
    return;
  }
  await invoke("open_document", { appId: app, path: path ?? null });
}

/** The file passed to this window (file association or "Öffnen"). */
export function initialFile(): string | null {
  return (window as { __NEXORA_FILE__?: string }).__NEXORA_FILE__ ?? null;
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title).catch(() => {});
}

/**
 * Ask before closing a window with unsaved changes. `confirm` decides
 * (save / discard / cancel); `save` returns false if saving was cancelled.
 */
export function guardClose(isDirty: () => boolean, confirm: () => Promise<"save" | "discard" | "cancel">, save: () => Promise<boolean>): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDirty()) e.preventDefault();
  };
  if (!isTauri) {
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const u = await win.onCloseRequested(async (event) => {
      if (!isDirty()) return;
      event.preventDefault();
      const choice = await confirm();
      if (choice === "cancel") return;
      if (choice === "save" && !(await save().catch(() => false))) return;
      await win.destroy();
    });
    if (disposed) u();
    else unlisten = u;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function officeInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}
