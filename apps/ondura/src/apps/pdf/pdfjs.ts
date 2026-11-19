// pdf.js for Ondura PDF: library, worker and the viewer component. The
// legacy build runs in the older WebKit of macOS 11 and WebKitGTK as well.
// The viewer module expects the library as `globalThis.pdfjsLib`, so it is
// loaded after the library is in place.

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/legacy/web/pdf_viewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export type ViewerModule = typeof import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
let viewerModule: Promise<ViewerModule> | null = null;
export function loadViewer(): Promise<ViewerModule> {
  viewerModule ??= import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
  return viewerModule;
}

/** Opens a document from bytes (a copy: pdf.js hands the buffer to its worker). */
export function openDocument(bytes: Uint8Array) {
  return pdfjsLib.getDocument({
    data: bytes.slice(),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    enableXfa: true,
    // Font names and flags (bold, serif …) for converting and editing text.
    fontExtraProperties: true,
  }).promise;
}
