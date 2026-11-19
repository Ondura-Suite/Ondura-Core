// Update check, download and installation (see src-tauri/src/update.rs).
// The state is shared by all components of a window; the automatic check
// runs at most every 12 hours across windows. A found update is downloaded
// and verified in the background; installing it then only needs a restart
// (no installer UI, no admin prompt where the update helper is installed).

import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, ProgressBar, Text } from "@fluentui/react-components";
import { api, isTauri } from "../lib/api";
import { tl, LOCALE } from "../lib/i18n";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  sigUrl: string;
}

export interface UpdateInfo {
  version: string;
  current: string;
  notes: string;
  published: string;
  page: string;
  asset: UpdateAsset | null;
  manualReason: string | null;
}

type Status = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "installing" | "error";

interface UpdateState {
  status: Status;
  info: UpdateInfo | null;
  progress: { downloaded: number; total: number } | null;
  error: string | null;
  open: boolean;
  /** Verified download, ready to install. */
  file: string | null;
  /** Installed by itself when Ondura is quit or its last window closed (Windows). */
  auto: boolean;
}

let state: UpdateState = { status: "idle", info: null, progress: null, error: null, open: false, file: null, auto: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

const CHECKED_KEY = "ondura.update.checked";
const INFO_KEY = "ondura.update.info";
const INTERVAL = 12 * 60 * 60 * 1000;

/** Looks for a newer release; `manual` also opens the dialog with the result. */
export async function checkForUpdates(manual = false) {
  if (!isTauri || state.status === "checking" || state.status === "downloading" || state.status === "installing") return;
  if (state.status === "ready") {
    set({ open: manual || state.open });
    return;
  }
  set({ status: "checking", error: null, open: manual || state.open });
  try {
    const info = await invoke<UpdateInfo | null>("update_check");
    try {
      localStorage.setItem(CHECKED_KEY, String(Date.now()));
      localStorage.setItem(INFO_KEY, JSON.stringify(info));
    } catch {
      /* storage unavailable */
    }
    set({ status: info ? "available" : "none", info });
    if (info?.asset) void downloadUpdate();
  } catch (e) {
    set({ status: "error", error: String(e) });
  }
}

/** Downloads and verifies the update in the background. */
export async function downloadUpdate() {
  const asset = state.info?.asset;
  if (!asset || state.status === "downloading" || state.status === "installing") return;
  if (state.status === "ready" && state.file) return;
  set({ status: "downloading", progress: { downloaded: 0, total: asset.size }, error: null });
  const unlisten = await listen<{ downloaded: number; total: number }>("update-progress", (e) => set({ progress: e.payload }));
  try {
    const file = await invoke<string>("update_download", { asset });
    // Install without asking on the next quit (or when the last window closes).
    const auto = await invoke<boolean>("update_schedule", { path: file, version: state.info!.version }).catch(() => false);
    set({ status: "ready", file, auto });
  } catch (e) {
    // Background failures stay quiet; "Jetzt aktualisieren" retries.
    set({ status: state.open ? "error" : "available", error: String(e) });
  } finally {
    unlisten();
  }
}

/** Installs the update and restarts Ondura (downloads first if needed). */
export async function installUpdate() {
  const info = state.info;
  if (!info?.asset) return;
  if (state.status !== "ready" || !state.file) await downloadUpdate();
  if (state.status !== "ready" || !state.file) {
    set({ status: "error", open: true });
    return;
  }
  set({ status: "installing", error: null });
  try {
    await invoke("update_install", { path: state.file, version: info.version });
  } catch (e) {
    set({ status: "error", error: String(e), open: true, file: null });
  }
}

export function openUpdateDialog(open = true) {
  set({ open });
}

export function useUpdates(): UpdateState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

/** Automatic check: reuses a recent result of any window, else asks GitHub. */
export function useAutoUpdateCheck() {
  // macOS menu "Ondura › Nach Updates suchen …" (sent to all windows; the
  // focused one answers).
  useEffect(() => {
    if (!isTauri) return;
    const off = listen("check-updates", () => {
      if (document.hasFocus()) void checkForUpdates(true);
    });
    return () => void off.then((u) => u());
  }, []);

  useEffect(() => {
    if (!isTauri || state.status !== "idle") return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(CHECKED_KEY) ?? 0);
      const cached = JSON.parse(localStorage.getItem(INFO_KEY) ?? "null") as UpdateInfo | null;
      if (Date.now() - last < INTERVAL) {
        // Still newer than the running version? (it may have been installed)
        void import("@tauri-apps/api/app").then(async ({ getVersion }) => {
          const current = await getVersion();
          const still = cached && newer(cached.version, current) ? { ...cached, current } : null;
          set({ status: still ? "available" : "none", info: still });
          if (still?.asset) void downloadUpdate();
        });
        return;
      }
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => void checkForUpdates(), 5000);
    return () => clearTimeout(t);
  }, []);
}

/** `a` newer than `b` (semantic versions, pre-release suffix ignored). */
function newer(a: string, b: string) {
  const p = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map((x) => Number(x) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`;

export function UpdateDialog() {
  const u = useUpdates();
  const info = u.info;
  const busy = u.status === "installing";
  return (
    <Dialog open={u.open} onOpenChange={(_, d) => !d.open && !busy && openUpdateDialog(false)}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{info ? tl("Ondura {0} ist verfügbar", info.version) : tl("Nach Updates suchen")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {u.status === "checking" && <ProgressBar />}
            {u.status === "none" && <Text>{tl("Ondura ist auf dem neuesten Stand.")}</Text>}
            {info && (
              <>
                <Text>
                  {tl("Installiert:")} {info.current} {tl("· Neu:")} {info.version}
                  {info.published ? tl(" (veröffentlicht am {0})", new Date(info.published).toLocaleDateString(LOCALE)) : ""}
                  {info.asset ? ` · ${mb(info.asset.size)}` : ""}
                </Text>
                {info.notes && <div style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 13, padding: "8px 10px", borderRadius: 6, background: "var(--colorNeutralBackground3)" }}>{info.notes}</div>}
                {info.manualReason && (
                  <MessageBar intent="info">
                    <MessageBarBody>{info.manualReason} {tl("Laden Sie die neue Version von der Release-Seite.")}</MessageBarBody>
                  </MessageBar>
                )}
              </>
            )}
            {u.status === "downloading" && u.progress && (
              <div>
                <Text size={200}>
                  {tl("Wird im Hintergrund geladen …")} {mb(u.progress.downloaded)} {tl("von")} {mb(u.progress.total)}
                </Text>
                <ProgressBar value={u.progress.total ? u.progress.downloaded / u.progress.total : undefined} />
              </div>
            )}
            {u.status === "ready" && (
              <Text>
                {u.auto
                  ? tl("Das Update ist geladen und die Signatur geprüft. Es wird automatisch installiert, sobald Sie Ondura beenden oder alle Fenster schließen – oder jetzt mit einem kurzen Neustart.")
                  : tl("Das Update ist geladen und die Signatur geprüft. Ondura wird zum Aktualisieren kurz neu gestartet.")}
              </Text>
            )}
            {u.status === "installing" && (
              <div>
                <Text>{tl("Das Update wird im Hintergrund installiert – Ondura startet gleich neu.")}</Text>
                <ProgressBar />
              </div>
            )}
            {u.status === "error" && (
              <MessageBar intent="error">
                <MessageBarBody>{u.error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            {info?.asset && (
              <Button appearance="primary" disabled={busy || u.status === "downloading"} onClick={() => void installUpdate()}>
                {u.status === "ready" ? tl("Neu starten und aktualisieren") : tl("Jetzt aktualisieren")}
              </Button>
            )}
            {info && !info.asset && (
              <Button appearance="primary" onClick={() => void api.openExternal(info.page)}>
                {tl("Release-Seite öffnen")}
              </Button>
            )}
            {!info && u.status !== "checking" && <Button onClick={() => void checkForUpdates(true)}>{tl("Erneut prüfen")}</Button>}
            <Button disabled={busy} onClick={() => openUpdateDialog(false)}>
              {info ? tl("Später") : tl("Schließen")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
