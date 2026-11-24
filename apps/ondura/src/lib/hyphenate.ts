// Hyphenation patterns of the "hyphen" package (TeX patterns), loaded on
// demand and shared by the text hyphenation and the ribbon labels.

export type Hyphenator = (word: string) => string;

const loaders: Record<string, () => Promise<{ hyphenateSync: Hyphenator }>> = {
  de: () => import("hyphen/de") as Promise<{ hyphenateSync: Hyphenator }>,
  en: () => import("hyphen/en-us") as Promise<{ hyphenateSync: Hyphenator }>,
  fr: () => import("hyphen/fr") as Promise<{ hyphenateSync: Hyphenator }>,
};
const loaded = new Map<string, Hyphenator>();
const pending = new Map<string, Promise<Hyphenator | null>>();

export const hasPatterns = (lang: string) => lang in loaders;

/** The hyphenator for `lang` if it is loaded already. */
export const loadedHyphenator = (lang: string): Hyphenator | null => loaded.get(lang) ?? null;

/** Loads the patterns of `lang` (null: none for that language). */
export function hyphenator(lang: string): Promise<Hyphenator | null> {
  if (loaded.has(lang)) return Promise.resolve(loaded.get(lang)!);
  if (!loaders[lang]) return Promise.resolve(null);
  if (!pending.has(lang))
    pending.set(
      lang,
      loaders[lang]().then(
        (m) => (loaded.set(lang, m.hyphenateSync), m.hyphenateSync),
        () => null,
      ),
    );
  return pending.get(lang)!;
}
