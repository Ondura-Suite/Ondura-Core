// Files dragged in from the file manager. Tauri's own drop handler is off
// (it would swallow HTML drag and drop on Windows, see windows.rs), so the
// web view's drop events carry the files – their content, not their paths.

import { useEffect, useRef, useState, type DragEvent } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { toB64 } from "../lib/files";
import { isTauri } from "../lib/api";
import { tl } from "../lib/i18n";
import { useNotify } from "./notify";

const hasFiles = (e: DragEvent | globalThis.DragEvent) => !!e.dataTransfer?.types.includes("Files");

// Paths of dropped files from the Windows host (windows.rs,
// watch_dropped_files), by request id.
const waiting = new Map<string, (paths: string[]) => void>();
let listening: Promise<unknown> | null = null;
function listenForPaths() {
  listening ??= import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ id: string; paths: string[] }>("ondura-dropped-paths", (e) => {
      waiting.get(e.payload.id)?.(e.payload.paths);
      waiting.delete(e.payload.id);
    }),
  );
  return listening;
}

/**
 * Paths of the files of a drop (empty where the system does not tell):
 * `file://` URIs on Linux, the WebView2 host on Windows. Call it while the
 * drop event runs; the files are read synchronously.
 */
export function droppedPaths(e: DragEvent | globalThis.DragEvent): Promise<string[]> {
  const dt = e.dataTransfer;
  if (!dt || !isTauri) return Promise.resolve([]);
  const uris = dt
    .getData("text/uri-list")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("file://"));
  if (uris.length) return Promise.resolve(uris.map((u) => decodeURIComponent(new URL(u).pathname).replace(/^\/([A-Za-z]:)/, "$1")));
  const webview = (window as unknown as { chrome?: { webview?: { postMessageWithAdditionalObjects?: (msg: unknown, objects: FileList) => void } } }).chrome?.webview;
  const files = dt.files;
  if (!webview?.postMessageWithAdditionalObjects || !files.length) return Promise.resolve([]);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    setTimeout(() => waiting.get(id) && (waiting.delete(id), resolve([])), 4000);
    void listenForPaths().then(() => webview.postMessageWithAdditionalObjects!({ ondura: "drop", id }, files));
  });
}

/**
 * Opens dropped documents in their apps (Text, Sheets, PDF …). Returns the
 * names of files that could not be opened (no path, or no app for them).
 */
export async function openDroppedFiles(e: DragEvent | globalThis.DragEvent, files: File[]): Promise<string[]> {
  const paths = await droppedPaths(e);
  if (!paths.length) return files.map((f) => f.name);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("open_files", { paths });
}

/** Called when dropped files could not be opened (see DropReporter). */
let report: (names: string[]) => void = () => {};
/** Opens dropped documents and tells about those it cannot open. */
export function openDropped(e: DragEvent, files: File[]) {
  void openDroppedFiles(e, files).then((rest) => rest.length && report(rest));
}

/**
 * Files dropped where no drop area takes them open in their apps, as from
 * the file manager; without this the web view would navigate to the file.
 * Call once per window.
 */
export function guardFileDrops() {
  if (isTauri) void listenForPaths();
  // Runs after the drop areas (bubbling to the window): what they took is
  // already handled (default prevented).
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = isTauri ? "copy" : "none";
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!isTauri || !files.length) return;
    void openDroppedFiles(e, files).then((rest) => rest.length && report(rest));
  });
}

/** Tells about dropped files that could not be opened (once per window, inside the toaster). */
export function DropReporter() {
  const notify = useNotify();
  useEffect(() => {
    report = (names) => notify(tl("Nicht geöffnet"), tl("Ondura kann diese Dateien nicht öffnen: {0}", names.join(", ")), "warning");
  }, [notify]);
  return null;
}

/**
 * Props for an element that takes dropped files, and whether files are
 * over it. Capture phase: an editor inside does not get the files first.
 */
export function useFileDrop(onFiles: (files: File[], e: DragEvent) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const ok = (e: DragEvent) => enabled && hasFiles(e);
  return {
    over,
    props: {
      onDragEnterCapture: (e: DragEvent) => {
        if (!ok(e)) return;
        depth.current++;
        setOver(true);
      },
      onDragOverCapture: (e: DragEvent) => {
        if (!ok(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeaveCapture: (e: DragEvent) => {
        if (!ok(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDropCapture: (e: DragEvent) => {
        depth.current = 0;
        setOver(false);
        if (!ok(e) || !e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        onFiles([...e.dataTransfer.files], e);
      },
    },
  };
}

const useStyles = makeStyles({
  overlay: {
    position: "absolute",
    inset: "6px",
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    borderRadius: tokens.borderRadiusLarge,
    border: `2px dashed ${tokens.colorBrandStroke1}`,
    backgroundColor: "color-mix(in srgb, var(--colorBrandBackground2) 85%, transparent)",
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
});

/** Hint shown over a drop area while files are dragged over it (parent: position relative). */
export function DropOverlay({ label }: { label: string }) {
  const s = useStyles();
  return <div className={s.overlay}>{label}</div>;
}

/** File content as base64 (for attachments). */
export async function fileBase64(f: File): Promise<string> {
  return toB64(new Uint8Array(await f.arrayBuffer()));
}

// Dragging files out of a window (desktop, file manager, other programs).
let prepared: { key: string; path: Promise<string> } | null = null;

/**
 * Props that let an element be dragged out of the window as a file.
 * `prepare` writes the file and returns its path; it starts when the mouse
 * button goes down, so the file is usually ready when the drag begins, and
 * the system drag then takes over from the page's.
 */
export function dragOutProps(key: string, prepare: () => Promise<string>) {
  return {
    draggable: true,
    onPointerDown: (e: React.PointerEvent) => {
      if (!isTauri || e.button !== 0) return;
      const path = prepare();
      path.catch(() => {});
      prepared = { key, path };
    },
    onDragStart: (e: DragEvent) => {
      if (!isTauri) return;
      e.preventDefault();
      const path = prepared?.key === key ? prepared.path : prepare();
      prepared = null;
      void path.then(async (p) => (await import("@tauri-apps/api/core")).invoke("drag_out", { paths: [p] })).catch(() => {});
    },
  };
}
