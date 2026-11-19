import { createContext, useContext } from "react";
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

/** The suite's own colour: a calm royal blue (Mail and the shell). */
export const SUITE_COLOR = "#3b5bdb";

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => {
  const x = hex(a);
  const y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const rgba = (c: string, alpha: number) => `rgba(${hex(c).join(", ")}, ${alpha})`;

/**
 * Fluent brand ramp from one colour (step 80). Darker steps lean towards a
 * deep ink rather than pure black, lighter ones towards white, so the ramp
 * stays clean for any app colour.
 */
export function brandFrom(base: string): BrandVariants {
  const ramp: Record<number, string> = {};
  for (let step = 10; step <= 160; step += 10) {
    ramp[step] = step < 80 ? mix(base, "#05070d", ((80 - step) / 80) * 0.95) : step > 80 ? mix(base, "#ffffff", ((step - 80) / 80) * 0.94) : base;
  }
  return ramp as BrandVariants;
}

export const onduraBrand: BrandVariants = brandFrom(SUITE_COLOR);

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
const glassLight = (brand: string): Partial<Theme> => ({
  colorNeutralBackground1: "rgba(255, 255, 255, 0.68)",
  colorNeutralBackground1Hover: "rgba(255, 255, 255, 0.84)",
  colorNeutralBackground1Pressed: "rgba(255, 255, 255, 0.92)",
  colorNeutralBackground1Selected: rgba(brand, 0.1),
  colorNeutralBackground2: "rgba(255, 255, 255, 0.42)",
  colorNeutralBackground2Hover: "rgba(255, 255, 255, 0.6)",
  colorNeutralBackground3: "transparent",
  colorNeutralBackground3Hover: "rgba(255, 255, 255, 0.5)",
  colorSubtleBackgroundHover: "rgba(15, 23, 42, 0.045)",
  colorSubtleBackgroundPressed: "rgba(15, 23, 42, 0.08)",
  colorSubtleBackgroundSelected: rgba(brand, 0.1),
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
});

const glassDark = (brand: string): Partial<Theme> => ({
  colorNeutralBackground1: "rgba(30, 32, 44, 0.58)",
  colorNeutralBackground1Hover: "rgba(44, 47, 64, 0.7)",
  colorNeutralBackground1Pressed: "rgba(52, 55, 74, 0.76)",
  colorNeutralBackground1Selected: rgba(mix(brand, "#ffffff", 0.35), 0.18),
  colorNeutralBackground2: "rgba(24, 26, 36, 0.46)",
  colorNeutralBackground2Hover: "rgba(36, 38, 52, 0.58)",
  colorNeutralBackground3: "transparent",
  colorNeutralBackground3Hover: "rgba(255, 255, 255, 0.06)",
  colorSubtleBackgroundHover: "rgba(255, 255, 255, 0.06)",
  colorSubtleBackgroundPressed: "rgba(255, 255, 255, 0.1)",
  colorSubtleBackgroundSelected: rgba(mix(brand, "#ffffff", 0.35), 0.16),
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
});

// Radii stay in the Windows 11 / Fluent 2 family, just a touch softer:
// controls 6px, panels 12px, floating sheets 16px.
const shape: Partial<Theme> = {
  borderRadiusSmall: "4px",
  borderRadiusMedium: "6px",
  borderRadiusLarge: "12px",
  borderRadiusXLarge: "16px",
  fontFamilyBase: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Noto Sans", sans-serif',
};

const cache = new Map<string, Theme>();

/** Fluent theme for an app colour (each office app uses its own, like Office). */
export function themeFor(color: string, mode: ThemeMode): Theme {
  const id = `${color}/${mode}`;
  let t = cache.get(id);
  if (!t) {
    const brand = brandFrom(color);
    t =
      mode === "dark"
        ? { ...createDarkTheme(brand), ...glassDark(color), ...shape, colorBrandForeground1: brand[110], colorBrandForeground2: brand[120], colorBrandForegroundLink: brand[110], colorCompoundBrandForeground1: brand[110], colorCompoundBrandStroke: brand[110] }
        : { ...createLightTheme(brand), ...glassLight(color), ...shape };
    cache.set(id, t);
  }
  return t;
}

export const lightTheme: Theme = themeFor(SUITE_COLOR, "light");
export const darkTheme: Theme = themeFor(SUITE_COLOR, "dark");

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
