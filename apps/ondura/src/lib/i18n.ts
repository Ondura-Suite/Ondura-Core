// User interface language. German is the source language: the German text
// is the key, the catalogs in src/locales map it to English and French
// (missing entries fall back to German). The language is fixed for the
// lifetime of a window: a change applies to windows opened afterwards and,
// after a reload, to the current one.
//
// Placeholders: tl("Seite {0} von {1}", page, total).

import en from "../locales/en.json";
import fr from "../locales/fr.json";

export type Lang = "de" | "en" | "fr";
export type LangChoice = Lang | "system";

export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: "de", name: "Deutsch" },
  { id: "en", name: "English" },
  { id: "fr", name: "Français" },
];

const STORAGE_KEY = "ondura.lang";
const CATALOGS: Record<Lang, Record<string, string> | null> = { de: null, en, fr };
const DEFAULT_LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-US", fr: "fr-FR" };

const isLang = (v: unknown): v is Lang => v === "de" || v === "en" || v === "fr";

function systemLanguages(): readonly string[] {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return [];
  }
}

/** The stored choice ("system" if none). */
export function languageChoice(): LangChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : "system";
  } catch {
    return "system";
  }
}

function detect(): { lang: Lang; locale: string } {
  // Tests run against the German source texts.
  if (import.meta.env?.VITEST) return { lang: "de", locale: DEFAULT_LOCALE.de };
  const choice = languageChoice();
  const system = systemLanguages();
  if (isLang(choice)) {
    // Keep the user's region (de-AT, en-GB, fr-CH …) when it matches.
    const regional = system.find((l) => l.toLowerCase().startsWith(choice + "-"));
    return { lang: choice, locale: regional ?? DEFAULT_LOCALE[choice] };
  }
  for (const l of system) {
    const base = l.slice(0, 2).toLowerCase();
    if (isLang(base)) return { lang: base, locale: l.includes("-") ? l : DEFAULT_LOCALE[base] };
  }
  return { lang: "en", locale: DEFAULT_LOCALE.en };
}

const detected = detect();
/** Active language of this window. */
export const LANG: Lang = detected.lang;
/** BCP 47 locale for dates and numbers (e.g. LOCALE). */
export const LOCALE: string = detected.locale;

const catalog = CATALOGS[LANG];

/** Translates a German UI text; `{0}`, `{1}` … are replaced by `args`. */
export function tl(text: string, ...args: unknown[]): string {
  const s = catalog?.[text] ?? text;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m)) : s;
}

/**
 * Translates a text with a context, for words with different meanings
 * (tlc("app", "Tabellen") is the app name "Sheets", tl("Tabellen") "Tables").
 * Catalog key: `<context>\u0004<text>`.
 */
export function tlc(context: string, text: string, ...args: unknown[]): string {
  const s = catalog?.[`${context}\u0004${text}`] ?? text;
  return args.length ? tl(s, ...args) : s;
}

/** Stores the language choice (applies to windows opened from now on). */
export function setLanguage(choice: LangChoice) {
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable */
  }
}

/** Language that `choice` resolves to on this system. */
export function resolveLanguage(choice: LangChoice): Lang {
  if (isLang(choice)) return choice;
  for (const l of systemLanguages()) {
    const base = l.slice(0, 2).toLowerCase();
    if (isLang(base)) return base;
  }
  return "en";
}

if (typeof document !== "undefined") document.documentElement.lang = LANG;

// Backend messages (errors, notifications, tray) in the same language.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_language", { lang: LANG })).catch(() => undefined);
}
