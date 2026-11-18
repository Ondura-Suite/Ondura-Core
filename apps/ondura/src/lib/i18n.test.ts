// Catalog checks: every tl()/tlc() text of the sources has an English and a
// French translation (or is listed in locales/same.json), and placeholders
// survive the translation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import fr from "../locales/fr.json";
import same from "../locales/same.json";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of sourceFiles(SRC)) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/\btl\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
    for (const m of text.matchAll(/\btlc\(\s*"([^"]+)",\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(`${m[1]}\u0004${JSON.parse(`"${m[2]}"`)}`);
  }
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();

describe("translations", () => {
  const keys = usedKeys();
  const sameSet = new Set<string>(same);
  for (const [lang, catalog] of [["en", en], ["fr", fr]] as const) {
    it(`${lang}: every UI text is translated`, () => {
      const missing = [...keys].filter((k) => !(k in catalog) && !sameSet.has(k));
      expect(missing).toEqual([]);
    });
    it(`${lang}: placeholders match`, () => {
      const wrong = Object.entries(catalog as Record<string, string>).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
      expect(wrong).toEqual([]);
    });
  }
});
