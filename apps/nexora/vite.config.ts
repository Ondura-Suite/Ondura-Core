import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig({
  plugins: [react()],
  // Shown in the help menu of the browser preview (the app asks Tauri).
  define: { __NEXORA_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2022", "chrome110", "safari16"],
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
});
