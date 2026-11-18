// Spell checker worker: Hunspell dictionaries via nspell, plus German
// compound words (nspell does not implement Hunspell's compounding).

import nspell from "nspell";
import deAff from "@dict/de/index.aff?url";
import deDic from "@dict/de/index.dic?url";
import enAff from "@dict/en/index.aff?url";
import enDic from "@dict/en/index.dic?url";

export type Lang = "de" | "en";

export type Request =
  | { id: number; kind: "check"; lang: Lang; words: string[] }
  | { id: number; kind: "suggest"; lang: Lang; word: string }
  | { id: number; kind: "add"; lang: Lang; words: string[] };

export type Response = { id: number; ok: boolean[] } | { id: number; suggestions: string[] } | { id: number; done: true } | { id: number; error: string };

const URLS: Record<Lang, [string, string]> = { de: [deAff, deDic], en: [enAff, enDic] };

type Speller = ReturnType<typeof nspell>;
interface Spellers {
  main: Speller;
  /** Forms that only occur inside compounds (German), as plain words. */
  parts: Speller | null;
}
const spellers = new Map<Lang, Promise<Spellers>>();

/** Flag letter of ONLYINCOMPOUND in the affix file. */
const onlyInCompound = (aff: string) => /^ONLYINCOMPOUND\s+(\S)/m.exec(aff)?.[1];

function speller(lang: Lang) {
  let s = spellers.get(lang);
  if (!s) {
    s = (async () => {
      const [aff, dic] = await Promise.all(URLS[lang].map((u) => fetch(u).then((r) => r.text())));
      const flag = onlyInCompound(aff);
      if (!flag) return { main: nspell(aff, dic), parts: null };
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
      return { main: nspell(aff, `${main.length}\n${main.join("\n")}`), parts: nspell(aff, `${parts.length}\n${parts.join("\n")}`) };
    })();
    spellers.set(lang, s);
  }
  return s;
}

const cap = (w: string) => w.charAt(0).toLocaleUpperCase("de") + w.slice(1);

/** German compounds: "Rechtschreibprüfung" = Recht + schreib + Prüfung. */
function compound(sp: Spellers, word: string, depth = 0): boolean {
  if (depth > 4 || word.length < 4) return false;
  const lower = word.toLocaleLowerCase("de");
  const part = (w: string) => !!sp.parts?.correct(w);
  const whole = (w: string) => sp.main.correct(cap(w)) || sp.main.correct(w);
  for (let i = 2; i <= lower.length - 2; i++) {
    const head = lower.slice(0, i);
    const tail = lower.slice(i);
    if (!(part(head) || (head.length >= 3 && whole(head)))) continue;
    if (part(tail) || (tail.length >= 3 && whole(tail)) || compound(sp, tail, depth + 1)) return true;
  }
  return false;
}

function correct(sp: Spellers, lang: Lang, w: string): boolean {
  if (sp.main.correct(w)) return true;
  // Sentence starts and ALL CAPS.
  const low = w.toLocaleLowerCase(lang);
  if (sp.main.correct(low) && (w === cap(low) || w === w.toLocaleUpperCase(lang))) return true;
  // Hyphenated words: every part must be right.
  if (w.includes("-")) return w.split("-").every((p) => !p || correct(sp, lang, p));
  return lang === "de" && compound(sp, w);
}

/** Suggestions; for German compounds the misspelled last part is corrected. */
function suggest(sp: Spellers, lang: Lang, word: string): string[] {
  const out = new Set(sp.main.suggest(word));
  if (lang === "de" && word.length >= 8) {
    for (let i = word.length - 3; i >= 3 && out.size < 8; i--) {
      const head = word.slice(0, i);
      if (!(correct(sp, lang, head) || sp.parts?.correct(head.toLocaleLowerCase("de")))) continue;
      const tail = word.slice(i);
      for (const t of sp.main.suggest(cap(tail))) {
        const joined = head + t.toLocaleLowerCase("de");
        if (correct(sp, lang, joined)) out.add(joined);
      }
      if (out.size) break;
    }
  }
  return [...out].slice(0, 8);
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data;
  try {
    const sp = await speller(m.lang);
    if (m.kind === "check") {
      (self as unknown as Worker).postMessage({ id: m.id, ok: m.words.map((w) => correct(sp, m.lang, w)) } satisfies Response);
    } else if (m.kind === "suggest") {
      (self as unknown as Worker).postMessage({ id: m.id, suggestions: suggest(sp, m.lang, m.word) } satisfies Response);
    } else {
      for (const w of m.words) sp.main.add(w);
      (self as unknown as Worker).postMessage({ id: m.id, done: true } satisfies Response);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String(err) } satisfies Response);
  }
};
