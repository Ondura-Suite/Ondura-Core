import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

// Ondura PDF: pdf.js loads character maps, standard fonts, WebAssembly
// decoders and ICC profiles at run time from /pdfjs/<dir>/ (served in dev,
// copied into the build).
const PDFJS = fileURLToPath(new URL("./node_modules/pdfjs-dist", import.meta.url));
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
function pdfjsAssets(): Plugin {
  return {
    name: "ondura-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/pdfjs\/([a-z_]+)\/([^/?#]+)/.exec(req.url ?? "");
        const file = m && PDFJS_DIRS.includes(m[1]) ? join(PDFJS, m[1], decodeURIComponent(m[2])) : null;
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const name of readdirSync(join(PDFJS, dir))) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(PDFJS, dir, name)) });
        }
      }
    },
  };
}

// Ondura PDF text recognition (OCR): Tesseract worker, WebAssembly core
// and the German and English language data, all bundled so OCR works
// offline (served in dev, copied into the build).
const NM = fileURLToPath(new URL("./node_modules", import.meta.url));
const OCR_FILES: Record<string, string> = {
  "ocr/worker.min.js": "tesseract.js/dist/worker.min.js",
  ...Object.fromEntries(["lstm", "simd-lstm", "relaxedsimd-lstm"].map((v) => [`ocr/core/tesseract-core-${v}.wasm.js`, `tesseract.js-core/tesseract-core-${v}.wasm.js`])),
  ...Object.fromEntries(["deu", "eng"].map((l) => [`ocr/lang/${l}.traineddata.gz`, `@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`])),
};
function ocrAssets(): Plugin {
  return {
    name: "ondura-ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? "").replace(/^\//, "").replace(/[?#].*$/, "");
        const src = OCR_FILES[key];
        if (!src) return next();
        res.setHeader("Content-Type", key.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(join(NM, src)));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(OCR_FILES)) this.emitFile({ type: "asset", fileName, source: readFileSync(join(NM, src)) });
    },
  };
}

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig({
  plugins: [react(), pdfjsAssets(), ocrAssets()],
  // Hunspell dictionaries for the spell checker (the packages only export JS).
  resolve: {
    alias: {
      "@dict/de": fileURLToPath(new URL("./node_modules/dictionary-de", import.meta.url)),
      "@dict/en": fileURLToPath(new URL("./node_modules/dictionary-en", import.meta.url)),
      "@dict/fr": fileURLToPath(new URL("./node_modules/dictionary-fr", import.meta.url)),
    },
  },
  worker: { format: "es" },
  // Shown in the help menu of the browser preview (the app asks Tauri).
  define: { __ONDURA_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2022", "chrome110", "safari16"],
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
});
