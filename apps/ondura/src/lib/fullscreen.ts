// Full screen for the window: the desktop window itself (Tauri), else the
// page (browser preview).

import { isTauri } from "./api";

export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(on);
    } else if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* not allowed (the view stays usable without full screen) */
  }
}
