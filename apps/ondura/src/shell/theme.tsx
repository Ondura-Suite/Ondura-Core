import { createContext, useContext } from "react";
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

// "Ondura Indigo": the suite's own brand colour, a blue-violet that stays
// close to the familiar Office blue but is clearly its own.
export const onduraBrand: BrandVariants = {
  10: "#0a0a26",
  20: "#121342",
  30: "#1a1c5e",
  40: "#232678",
  50: "#2c3090",
  60: "#363ba7",
  70: "#4146bd",
  80: "#4f54d4",
  90: "#5e63e3",
  100: "#7075ec",
  110: "#8388f1",
  120: "#979bf4",
  130: "#abaef7",
  140: "#bfc1f9",
  150: "#d3d5fb",
  160: "#e8e9fd",
};

// Glass look in the spirit of Apple's translucent materials: the window shows
// a soft colour backdrop (styles.css, `.ondura-backdrop`), surfaces are
// semi-transparent on top of it, and floating layers (menus, popovers,
// dialogs) blur what lies beneath. The layout stays the familiar Outlook one.
const glassLight: Partial<Theme> = {
  colorNeutralBackground1: "rgba(255, 255, 255, 0.72)",
  colorNeutralBackground1Hover: "rgba(255, 255, 255, 0.86)",
  colorNeutralBackground1Pressed: "rgba(255, 255, 255, 0.92)",
  colorNeutralBackground1Selected: "rgba(79, 84, 212, 0.12)",
  colorNeutralBackground2: "rgba(255, 255, 255, 0.45)",
  colorNeutralBackground2Hover: "rgba(255, 255, 255, 0.6)",
  colorNeutralBackground3: "transparent",
  colorNeutralBackground3Hover: "rgba(255, 255, 255, 0.45)",
  colorSubtleBackgroundHover: "rgba(255, 255, 255, 0.55)",
  colorSubtleBackgroundPressed: "rgba(255, 255, 255, 0.7)",
  colorSubtleBackgroundSelected: "rgba(79, 84, 212, 0.1)",
  colorNeutralStroke2: "rgba(60, 60, 110, 0.12)",
  colorNeutralStroke3: "rgba(60, 60, 110, 0.08)",
  shadow2: "0 0 0 1px rgba(255, 255, 255, 0.6) inset, 0 1px 2px rgba(30, 30, 80, 0.06), 0 8px 24px rgba(30, 30, 80, 0.06)",
  shadow16: "0 0 0 1px rgba(255, 255, 255, 0.5) inset, 0 12px 40px rgba(20, 20, 60, 0.18)",
  shadow28: "0 0 0 1px rgba(255, 255, 255, 0.5) inset, 0 20px 60px rgba(20, 20, 60, 0.25)",
};

const glassDark: Partial<Theme> = {
  colorNeutralBackground1: "rgba(32, 33, 48, 0.62)",
  colorNeutralBackground1Hover: "rgba(48, 50, 70, 0.72)",
  colorNeutralBackground1Pressed: "rgba(56, 58, 80, 0.78)",
  colorNeutralBackground1Selected: "rgba(131, 136, 241, 0.2)",
  colorNeutralBackground2: "rgba(28, 29, 42, 0.5)",
  colorNeutralBackground2Hover: "rgba(40, 42, 60, 0.6)",
  colorNeutralBackground3: "transparent",
  colorNeutralBackground3Hover: "rgba(255, 255, 255, 0.06)",
  colorSubtleBackgroundHover: "rgba(255, 255, 255, 0.08)",
  colorSubtleBackgroundPressed: "rgba(255, 255, 255, 0.12)",
  colorSubtleBackgroundSelected: "rgba(131, 136, 241, 0.18)",
  colorNeutralStroke2: "rgba(255, 255, 255, 0.1)",
  colorNeutralStroke3: "rgba(255, 255, 255, 0.06)",
  shadow2: "0 0 0 1px rgba(255, 255, 255, 0.07) inset, 0 8px 24px rgba(0, 0, 0, 0.25)",
  shadow16: "0 0 0 1px rgba(255, 255, 255, 0.08) inset, 0 12px 40px rgba(0, 0, 0, 0.45)",
  shadow28: "0 0 0 1px rgba(255, 255, 255, 0.08) inset, 0 20px 60px rgba(0, 0, 0, 0.55)",
};

const shape: Partial<Theme> = {
  borderRadiusMedium: "6px",
  borderRadiusLarge: "12px",
  borderRadiusXLarge: "16px",
  fontFamilyBase: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Noto Sans", sans-serif',
};

export const lightTheme: Theme = { ...createLightTheme(onduraBrand), ...glassLight, ...shape };
export const darkTheme: Theme = {
  ...createDarkTheme(onduraBrand),
  ...glassDark,
  ...shape,
  colorBrandForeground1: onduraBrand[110],
  colorBrandForeground2: onduraBrand[120],
};

export type ThemeMode = "light" | "dark";

export const ThemeModeContext = createContext<{ mode: ThemeMode; toggle: () => void }>({ mode: "light", toggle: () => {} });

export const useThemeMode = () => useContext(ThemeModeContext);

const KEY = "ondura.theme";

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
