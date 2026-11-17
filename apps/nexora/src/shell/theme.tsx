import { createContext, useContext } from "react";
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

// Brand ramp around Fluent "communication blue" (#0f6cbd), as used by Outlook.
export const nexoraBrand: BrandVariants = {
  10: "#061724",
  20: "#082338",
  30: "#0a2e4a",
  40: "#0c3b5e",
  50: "#0e4775",
  60: "#0f548c",
  70: "#115ea3",
  80: "#0f6cbd",
  90: "#2886de",
  100: "#479ef5",
  110: "#62abf5",
  120: "#77b7f7",
  130: "#96c6fa",
  140: "#b4d6fa",
  150: "#cfe4fa",
  160: "#ebf3fc",
};

export const lightTheme: Theme = createLightTheme(nexoraBrand);
export const darkTheme: Theme = { ...createDarkTheme(nexoraBrand), colorBrandForeground1: nexoraBrand[110], colorBrandForeground2: nexoraBrand[120] };

export type ThemeMode = "light" | "dark";

export const ThemeModeContext = createContext<{ mode: ThemeMode; toggle: () => void }>({ mode: "light", toggle: () => {} });

export const useThemeMode = () => useContext(ThemeModeContext);

const KEY = "nexora.theme";

export function loadThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable */
  }
}
