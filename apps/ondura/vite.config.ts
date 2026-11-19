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

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig({
  plugins: [react(), pdfjsAssets()],
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
