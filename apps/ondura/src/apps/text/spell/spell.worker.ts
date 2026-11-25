// Spell checker worker: Hunspell dictionaries via nspell, plus German
// compound words (nspell does not implement Hunspell's compounding).

import { createSpellers, correct, suggest, supplement, type Lang, type Spellers } from "./core";
import { DE_HEADS, DE_NOUNS } from "./supplement";
import deAff from "@dict/de/index.aff?url";
import deDic from "@dict/de/index.dic?url";
import enAff from "@dict/en/index.aff?url";
import enDic from "@dict/en/index.dic?url";
import frAff from "@dict/fr/index.aff?url";
import frDic from "@dict/fr/index.dic?url";

export type { Lang };

export type Request =
  | { id: number; kind: "check"; lang: Lang; words: string[] }
  | { id: number; kind: "suggest"; lang: Lang; word: string }
  | { id: number; kind: "add"; lang: Lang; words: string[] };

export type Response = { id: number; ok: boolean[] } | { id: number; suggestions: string[] } | { id: number; done: true } | { id: number; error: string };

const URLS: Record<Lang, [string, string]> = { de: [deAff, deDic], en: [enAff, enDic], fr: [frAff, frDic] };

const spellers = new Map<Lang, Promise<Spellers>>();

function speller(lang: Lang) {
  let s = spellers.get(lang);
  if (!s) {
    s = Promise.all(URLS[lang].map((u) => fetch(u).then((r) => r.text()))).then(([aff, dic]) => {
      const sp = createSpellers(aff, dic);
      if (lang === "de") supplement(sp, DE_NOUNS, DE_HEADS);
      return sp;
    });
    spellers.set(lang, s);
  }
  return s;
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
