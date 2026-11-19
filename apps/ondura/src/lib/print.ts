// Printing for the office apps without the browser's print dialog: the
// print view (shell/printView.tsx) renders a PDF preview of the print
// layout and prints it with explicit settings (printer, copies, pages …).

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { printToPdf } from "./office";

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

export interface PrinterSettings {
  /** Printer name; empty = default printer. */
  printer: string;
  copies: number;
  /** Page ranges such as `1-3,5`; empty = all pages. */
  pages: string;
  duplex: "none" | "long" | "short";
  collate: boolean;
  color: boolean;
  pagesPerSheet: number;
}

/**
 * What an app's print function does with its print layout: write a PDF
 * (preview or export), send it to a printer, or open the system dialog.
 */
export type PrintJob = { kind: "pdf"; path: string } | { kind: "printer"; settings: PrinterSettings } | { kind: "dialog" };

export const DEFAULT_SETTINGS: PrinterSettings = { printer: "", copies: 1, pages: "", duplex: "none", collate: true, color: true, pagesPerSheet: 1 };

/**
 * Margin boxes inside an `@page` rule that keep the browser from adding its
 * own header and footer (date, title, URL, page x/y). Chromium and WebKit
 * leave those out as soon as the page defines margin boxes. Put it first so
 * the app's own boxes override the empty ones.
 */
export const NO_BROWSER_HEADER = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"].map((b) => `@${b} { content: ""; }`).join(" ");

/** Run a print job once the print layout is in the DOM. Margins: top, right, bottom, left in mm. */
export async function runPrintJob(job: PrintJob, widthMm: number, heightMm: number, marginsMm: [number, number, number, number] = [0, 0, 0, 0]): Promise<void> {
  if (job.kind === "pdf") return printToPdf(job.path, widthMm, heightMm, marginsMm);
  if (job.kind === "printer" && isTauri) {
    await invoke("print_page", { settings: { ...job.settings, widthMm, heightMm, marginsMm } });
    return;
  }
  window.print();
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  if (!isTauri) return [];
  return invoke<PrinterInfo[]>("printers_list");
}

export async function tempFile(ext: string): Promise<string> {
  return invoke<string>("temp_file", { ext });
}

export async function removeTemp(path: string): Promise<void> {
  await invoke("temp_remove", { path }).catch(() => {});
}

/** Pages of a range expression (`1-3, 5`) within 1..count, sorted; `null` if it is invalid. */
export function parsePageRanges(text: string, count: number): number[] | null {
  const out = new Set<number>();
  const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === "" ? count : Number(m[2]);
    if (a < 1 || b < a) return null;
    for (let i = a; i <= Math.min(b, count); i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

const SETTINGS_KEY = "ondura.print.settings";

/** Last used printer and duplex/colour choice (copies and pages start fresh). */
export function loadPrintSettings(): PrinterSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<PrinterSettings>;
    return { ...DEFAULT_SETTINGS, printer: saved.printer ?? "", duplex: saved.duplex ?? "none", color: saved.color ?? true, collate: saved.collate ?? true };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function savePrintSettings(s: PrinterSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ printer: s.printer, duplex: s.duplex, color: s.color, collate: s.collate }));
  } catch {
    /* storage unavailable */
  }
}
