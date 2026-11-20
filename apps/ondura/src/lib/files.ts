// Text files for apps with their own formats (Ondura Diagramme: .drawio,
// Ondura Formulare: .ondform): open and save dialogs on the desktop,
// file picker and download in the browser preview.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  /** Path on disk (desktop) or `null` (browser). */
  path: string | null;
  name: string;
  text: string;
}

/** Lets the user choose a file and reads it as text. */
export async function openTextFile(filters: FileFilter[]): Promise<OpenedFile | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, filters });
    if (typeof r !== "string") return null;
    return { path: r, name: r.split(/[\\/]/).pop() ?? r, text: await invoke<string>("read_text_file", { path: r }) };
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  return file ? { path: null, name: file.name, text: await file.text() } : null;
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Writes bytes to a path (desktop). */
export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("save_bytes", { path, data: toB64(bytes) });
}

/** Save dialog; returns the chosen path with the extension added if missing. */
export async function pickSaveFile(suggested: string, filter: FileFilter): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const ext = filter.extensions[0];
  const r = await save({ defaultPath: `${suggested}.${ext}`, filters: [filter] });
  if (!r) return null;
  return filter.extensions.some((e) => r.toLowerCase().endsWith(`.${e}`)) ? r : `${r}.${ext}`;
}

/** Offers a file for download (browser preview, exports). */
export function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Saves `data` either to `path`, to a newly chosen path (desktop) or as a
 * download (browser). Returns the path written, or `null` if cancelled.
 */
export async function saveFile(path: string | null, suggested: string, filter: FileFilter, data: Uint8Array | string, mime: string): Promise<string | null> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (!isTauri) {
    download(`${suggested}.${filter.extensions[0]}`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    return `${suggested}.${filter.extensions[0]}`;
  }
  const target = path ?? (await pickSaveFile(suggested, filter));
  if (!target) return null;
  await writeBytes(target, bytes);
  return target;
}
