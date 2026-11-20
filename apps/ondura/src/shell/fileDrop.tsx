// Files dragged in from the file manager. Tauri's own drop handler is off
// (it would swallow HTML drag and drop on Windows, see windows.rs), so the
// web view's drop events carry the files – their content, not their paths.

import { useRef, useState, type DragEvent } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { toB64 } from "../lib/files";

const hasFiles = (e: DragEvent | globalThis.DragEvent) => !!e.dataTransfer?.types.includes("Files");

/**
 * Keeps a file dropped where nothing takes it from replacing the page
 * (the web view would navigate to the file). Call once per window.
 */
export function guardFileDrops() {
  // Runs after the drop areas (bubbling to the window): what they took
  // is already handled (default prevented); elsewhere files are refused.
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "none";
  });
  window.addEventListener("drop", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
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
