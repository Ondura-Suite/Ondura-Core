// The spell checking itself (Hunspell dictionaries via nspell, German
// compounds), without the worker around it so it can be tested.

import nspell from "nspell";

export type Lang = "de" | "en" | "fr";

type Speller = ReturnType<typeof nspell>;
export interface Spellers {
  main: Speller;
  /** Forms that only occur inside compounds (German), as plain words. */
  parts: Speller | null;
  /** Only the capitalized entries (German nouns), to tell "Zimmer" from "und". */
  nouns: Speller | null;
}

/** Flag letter of ONLYINCOMPOUND in the affix file. */
const onlyInCompound = (aff: string) => /^ONLYINCOMPOUND\s+(\S)/m.exec(aff)?.[1];

/** Adds words the dictionary lacks: nouns (also as compound ends) and compound heads. */
export function supplement(sp: Spellers, nouns: string[], heads: string[] = []) {
  for (const w of nouns) {
    sp.main.add(w);
    sp.nouns?.add(w);
  }
  for (const h of heads) sp.parts?.add(h);
}

/** Spellers for a Hunspell affix file and dictionary. */
export function createSpellers(aff: string, dic: string): Spellers {
  const flag = onlyInCompound(aff);
  if (!flag) return { main: nspell(aff, dic), parts: null, nouns: null };
  // nspell merges the flags of duplicate entries ("lesen/BDIV" and the
  // compound part "lesen/SJozm") and would then reject "lesen". Compound
  // parts therefore go into a separate speller without that flag.
  const main: string[] = [];
  const parts: string[] = [];
  for (const line of dic.split("\n").slice(1)) {
    const slash = line.indexOf("/");
    if (slash > 0 && line.slice(slash + 1).includes(flag)) parts.push(line.replace(new RegExp(`(/[^\\s]*?)${flag}`), "$1"));
    else main.push(line);
  }
  const nouns = main.filter((l) => /^\p{Lu}/u.test(l));
  return { main: nspell(aff, `${main.length}\n${main.join("\n")}`), parts: nspell(aff, `${parts.length}\n${parts.join("\n")}`), nouns: nspell(aff, `${nouns.length}\n${nouns.join("\n")}`) };
}

const cap = (w: string) => w.charAt(0).toLocaleUpperCase("de") + w.slice(1);

// ------------------------------------------------------------ compounds --
// nspell does not implement Hunspell's compounding, so German compounds are
// split here. The rules are strict on purpose: a typo must not pass as
// "word + und" ("Hausund") or "verb form + ich" ("Schreibtich").

/** Linking elements between the parts of a German compound (Fugen). */
const LINKS = ["s", "es", "n", "en", "er", "e"];

/** A noun of the dictionary (listed capitalized only), in lower case. */
const noun = (sp: Spellers, w: string) => w.length >= 3 && !!sp.nouns?.correct(cap(w));
/** A form that only occurs inside compounds ("schreib", "arbeits"). */
const part = (sp: Spellers, w: string) => w.length >= 2 && !!sp.parts?.correct(w);
/** An adjective stem ("groß", "rot", "schnell"): its inflected forms exist. */
const adjective = (sp: Spellers, w: string) => w.length >= 3 && sp.main.correct(w) && ["e", "en", "er"].every((x) => sp.main.correct(w + x));

/** A first (or middle) part: a compound form, a noun with or without a linking element, an adjective stem. */
function head(sp: Spellers, h: string): boolean {
  if (part(sp, h) || noun(sp, h) || adjective(sp, h)) return true;
  return LINKS.some((l) => h.endsWith(l) && h.length - l.length >= 3 && noun(sp, h.slice(0, -l.length)));
}

/**
 * German compounds: "Rechtschreibprüfung" = Recht + schreib + Prüfung.
 * A capitalized word (noun) must end in a noun; a lower-case one
 * ("benutzerfreundlich", "kostenlos") in a lower-case word.
 */
function compound(sp: Spellers, word: string, nounEnd = word.charAt(0) !== word.charAt(0).toLocaleLowerCase("de"), depth = 0): boolean {
  if (depth > 4 || word.length < 6) return false;
  const lower = word.toLocaleLowerCase("de");
  const last = (t: string) => (nounEnd ? noun(sp, t) : t.length >= 3 && sp.main.correct(t));
  for (let i = 2; i <= lower.length - 3; i++) {
    const h = lower.slice(0, i);
    if (!head(sp, h)) continue;
    const t = lower.slice(i);
    if (last(t) || compound(sp, t, nounEnd, depth + 1)) return true;
  }
  return false;
}

/** Words in capitals (DSGVO) and with capitals inside (iPhone, PowerPoint) are names or codes, as in Word. */
const ignorable = (w: string) => w.length >= 2 && (w === w.toLocaleUpperCase() || /\p{Ll}\p{Lu}/u.test(w));

/** Whether a word is right; names and codes in capitals pass (as in Word). */
export function correct(sp: Spellers, lang: Lang, w: string): boolean {
  return ignorable(w) || known(sp, lang, w);
}

/** A word of the language (no exceptions for names; used for suggestions). */
function known(sp: Spellers, lang: Lang, w: string): boolean {
  if (sp.main.correct(w)) return true;
  // Sentence starts and ALL CAPS.
  const low = w.toLocaleLowerCase(lang);
  if (sp.main.correct(low) && w === cap(low)) return true;
  // Abbreviations are listed with their period ("bzw.", "Nr.").
  if (sp.main.correct(w + ".")) return true;
  // Hyphenated words: every part must be right.
  if (w.includes("-")) return w.split("-").every((p) => !p || correct(sp, lang, p));
  // "geht’s", "gibt's": the word before the apostrophe.
  const apo = /^(.+)['’]s$/u.exec(w);
  if (apo) return known(sp, lang, apo[1]);
  return lang === "de" && compound(sp, w);
}

/** Suggestions; for German compounds the misspelled last part is corrected. */
export function suggest(sp: Spellers, lang: Lang, word: string): string[] {
  // nspell's own suggestions, kept only if they pass the checks here.
  const found = new Set(sp.main.suggest(word).filter((x) => known(sp, lang, x)));
  if (lang === "de" && word.length >= 7) {
    // Compounds: keep a correct first part, correct the rest (at every split).
    const lower = word.toLocaleLowerCase("de");
    for (let i = 3; i <= word.length - 3; i++) {
      if (!head(sp, lower.slice(0, i)) && !known(sp, lang, word.slice(0, i))) continue;
      const rest = word.slice(i);
      for (const t of sp.main.suggest(cap(rest))) {
        const joined = word.slice(0, i) + t.toLocaleLowerCase("de");
        if (joined !== word && known(sp, lang, joined)) found.add(joined);
      }
    }
  }
  // German compounds are rarely in nspell's reach: also every word one slip away.
  if (lang === "de" && word.length >= 6 && word.length <= 30) for (const e of edits(sp, lang, word)) found.add(e);
  // Closest first; on a tie the one made of fewer parts ("Seitenansicht" before "Seitenanisacht").
  const rank = (x: string) => distance(word.toLocaleLowerCase(lang), x.toLocaleLowerCase(lang)) * 10 + (sp.main.correct(x) ? 0 : parts(sp, x));
  return [...found].sort((x, y) => rank(x) - rank(y)).slice(0, 8);
}

/** Number of parts of a compound (1 for a dictionary word). */
export function parts(sp: Spellers, w: string): number {
  const lower = w.toLocaleLowerCase("de");
  let best = 9;
  for (let i = 2; i <= lower.length - 3; i++) {
    if (!head(sp, lower.slice(0, i))) continue;
    const t = lower.slice(i);
    best = Math.min(best, noun(sp, t) || sp.main.correct(t) ? 2 : 1 + parts(sp, t));
    if (best === 2) break;
  }
  return best;
}

// QWERTZ rows: neighbouring keys are the usual slips.
const ROWS = ["1234567890ß", "qwertzuiopü", "asdfghjklöä", "yxcvbnm"];
const KEY = new Map<string, [number, number]>();
ROWS.forEach((r, y) => [...r].forEach((ch, x) => KEY.set(ch, [x + y * 0.3, y])));
const near = (a: string, b: string) => {
  const p = KEY.get(a);
  const q = KEY.get(b);
  return !!p && !!q && Math.abs(p[0] - q[0]) <= 1.3 && Math.abs(p[1] - q[1]) <= 1;
};

/**
 * Typing distance: a missing, extra or swapped letter or a neighbouring
 * key costs 1, any other replaced letter 1.5.
 */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : near(a[i - 1], b[j - 1]) ? 1 : 1.5;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const LETTERS = "abcdefghijklmnopqrstuvwxyzäöüß";

/** Words one slip away (swap, missing, extra or wrong letter) that pass the check. */
function edits(sp: Spellers, lang: Lang, word: string): string[] {
  const out = new Set<string>();
  const ok = (w: string) => w !== word && w.length > 1 && known(sp, lang, w) && out.add(w);
  for (let i = 0; i < word.length; i++) {
    if (i < word.length - 1) ok(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    ok(word.slice(0, i) + word.slice(i + 1));
  }
  // Wrong or missing letters: a tried letter keeps the case of the word there.
  for (let i = 0; i <= word.length; i++)
    for (const l of LETTERS) {
      const ch = i === 0 && word.charAt(0) !== word.charAt(0).toLocaleLowerCase(lang) ? l.toLocaleUpperCase(lang) : l;
      ok(word.slice(0, i) + ch + word.slice(i));
      if (i < word.length && word[i].toLocaleLowerCase(lang) !== l) ok(word.slice(0, i) + ch + word.slice(i + 1));
    }
  return [...out];
}
