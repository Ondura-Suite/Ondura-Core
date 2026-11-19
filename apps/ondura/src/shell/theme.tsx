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

// "Liquid glass" in the Fluent family (think Windows 11 Mica and Acrylic,
// with a bit more light): the window shows a calm, slightly tinted backdrop
// (styles.css), and surfaces are translucent sheets on top of it. Every sheet
// gets the same material recipe, expressed in its shadow token:
//   1. a specular top edge (inset 1px highlight) where light hits the glass,
//   2. a faint inner rim that keeps the edge crisp on any background,
//   3. a hairline outer outline, and
//   4. a soft, low, wide drop shadow that lifts it off the backdrop.
// Large panels deliberately avoid backdrop-filter (costly and pointless over a
// smooth gradient); floating layers (menus, popovers, dialogs) do blur.
const glassLight: Partial<Theme> = {
  colorNeutralBackground1: "rgba(255, 255, 255, 0.68)",
  colorNeutralBackground1Hover: "rgba(255, 255, 255, 0.84)",
  colorNeutralBackground1Pressed: "rgba(255, 255, 255, 0.92)",
  colorNeutralBackground1Selected: "rgba(79, 84, 212, 0.1)",
  colorNeutralBackground2: "rgba(255, 255, 255, 0.42)",
  colorNeutralBackground2Hover: "rgba(255, 255, 255, 0.6)",
  colorNeutralBackground3: "transparent",
  colorNeutralBackground3Hover: "rgba(255, 255, 255, 0.5)",
  colorSubtleBackgroundHover: "rgba(15, 23, 42, 0.045)",
  colorSubtleBackgroundPressed: "rgba(15, 23, 42, 0.08)",
  colorSubtleBackgroundSelected: "rgba(79, 84, 212, 0.1)",
  colorNeutralStroke1: "rgba(15, 23, 42, 0.18)",
  colorNeutralStroke2: "rgba(15, 23, 42, 0.09)",
  colorNeutralStroke3: "rgba(15, 23, 42, 0.06)",
  shadow2:
    "inset 0 1px 0 rgba(255, 255, 255, 0.85), inset 0 0 0 1px rgba(255, 255, 255, 0.4), 0 0 0 1px rgba(15, 23, 42, 0.05), 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -10px rgba(15, 23, 42, 0.12)",
  shadow4:
    "inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 0 0 1px rgba(255, 255, 255, 0.45), 0 0 0 1px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.05), 0 12px 32px -12px rgba(15, 23, 42, 0.16)",
  shadow8:
    "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(15, 23, 42, 0.06), 0 4px 8px -2px rgba(15, 23, 42, 0.08), 0 16px 32px -12px rgba(15, 23, 42, 0.18)",
  shadow16:
    "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(15, 23, 42, 0.07), 0 8px 16px -4px rgba(15, 23, 42, 0.1), 0 24px 48px -12px rgba(15, 23, 42, 0.22)",
  shadow28:
    "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(15, 23, 42, 0.08), 0 12px 24px -6px rgba(15, 23, 42, 0.12), 0 40px 80px -16px rgba(15, 23, 42, 0.3)",
};

const glassDark: Partial<Theme> = {
  colorNeutralBackground1: "rgba(30, 32, 44, 0.58)",
  colorNeutralBackground1Hover: "rgba(44, 47, 64, 0.7)",
  colorNeutralBackground1Pressed: "rgba(52, 55, 74, 0.76)",
  colorNeutralBackground1Selected: "rgba(131, 136, 241, 0.18)",
  colorNeutralBackground2: "rgba(24, 26, 36, 0.46)",
  colorNeutralBackground2Hover: "rgba(36, 38, 52, 0.58)",
  colorNeutralBackground3: "transparent",
  colorNeutralBackground3Hover: "rgba(255, 255, 255, 0.06)",
  colorSubtleBackgroundHover: "rgba(255, 255, 255, 0.06)",
  colorSubtleBackgroundPressed: "rgba(255, 255, 255, 0.1)",
  colorSubtleBackgroundSelected: "rgba(131, 136, 241, 0.16)",
  colorNeutralStroke1: "rgba(255, 255, 255, 0.16)",
  colorNeutralStroke2: "rgba(255, 255, 255, 0.08)",
  colorNeutralStroke3: "rgba(255, 255, 255, 0.05)",
  shadow2:
    "inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 0 1px rgba(255, 255, 255, 0.035), 0 0 0 1px rgba(0, 0, 0, 0.3), 0 10px 28px -10px rgba(0, 0, 0, 0.5)",
  shadow4:
    "inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.35), 0 14px 36px -12px rgba(0, 0, 0, 0.55)",
  shadow8:
    "inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.4), 0 16px 32px -12px rgba(0, 0, 0, 0.6)",
  shadow16:
    "inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 0 0 1px rgba(0, 0, 0, 0.45), 0 24px 48px -12px rgba(0, 0, 0, 0.65)",
  shadow28:
    "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.5), 0 40px 80px -16px rgba(0, 0, 0, 0.7)",
};

// Radii stay in the Windows 11 / Fluent 2 family, just a touch softer:
// controls 6px, panels 12px, floating sheets 16px.
const shape: Partial<Theme> = {
  borderRadiusSmall: "4px",
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
