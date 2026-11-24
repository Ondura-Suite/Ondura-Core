// Automatic hyphenation (Layout › Hyphenation).
//
// Where the webview hyphenates by itself (CSS `hyphens: auto` with a
// dictionary for the language) nothing else is needed. Otherwise the words
// get soft hyphens from TeX patterns (the "hyphen" package, loaded when
// needed): widget decorations with U+00AD between the syllables, so the
// browser can break there and shows a hyphen when it does. The document
// text itself is not changed.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

import { type Hyphenator, hasPatterns, hyphenator, loadedHyphenator } from "../../lib/hyphenate";

/** Whether the webview hyphenates `lang` by itself: a long word in a narrow
 *  box does not overflow when it can be broken. */
const native = new Map<string, boolean>();
export function nativeHyphenation(lang: string): boolean {
  if (native.has(lang)) return native.get(lang)!;
  const box = document.createElement("div");
  box.lang = lang;
  box.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;width:60px;font-size:16px;hyphens:auto;-webkit-hyphens:auto;overflow-wrap:normal;word-break:normal";
  box.textContent = { de: "Donaudampfschifffahrtsgesellschaft", fr: "anticonstitutionnellement", en: "incomprehensibilities" }[lang] ?? "incomprehensibilities";
  document.body.appendChild(box);
  const ok = box.scrollWidth <= box.clientWidth + 1;
  box.remove();
  native.set(lang, ok);
  return ok;
}

export const hyphenationKey = new PluginKey<DecorationSet>("onduraHyphenation");

/** Words this long or longer are hyphenated. */
const MIN_WORD = 6;
const WORD = /\p{L}{6,}/gu;

function softHyphen() {
  const s = document.createElement("span");
  s.className = "nx-shy";
  s.textContent = "­";
  return s;
}

/** Soft-hyphen decorations of the textblocks between `from` and `to`. */
function decorate(doc: PMNode, h: Hyphenator, from = 0, to = doc.content.size): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isTextblock) return true;
    node.forEach((child, offset) => {
      if (!child.isText || !child.text || child.text.length < MIN_WORD) return;
      const base = pos + 1 + offset;
      for (const m of child.text.matchAll(WORD)) {
        const parts = h(m[0]).split("­");
        let at = base + m.index!;
        for (let i = 0; i < parts.length - 1; i++) {
          at += parts[i].length;
          out.push(Decoration.widget(at, softHyphen, { side: -1, key: "shy", ignoreSelection: true, marks: [] }));
        }
      }
    });
    return false;
  });
  return out;
}

export interface HyphenationOptions {
  /** Hyphenation switched on for the document. */
  enabled: () => boolean;
  /** Language of the document ("de", "en", "fr"). */
  lang: () => string;
}

export const Hyphenation = Extension.create<HyphenationOptions>({
  name: "hyphenation",
  addOptions() {
    return { enabled: () => false, lang: () => "de" };
  },
  addProseMirrorPlugins() {
    const o = this.options;
    /** The hyphenator to use, or null (off, native, or still loading). */
    const current = (): Hyphenator | null => {
      if (!o.enabled()) return null;
      const lang = o.lang().slice(0, 2);
      if (nativeHyphenation(lang)) return null;
      return loadedHyphenator(lang);
    };
    return [
      new Plugin<DecorationSet>({
        key: hyphenationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, prev, _old, state) {
            if (tr.getMeta(hyphenationKey)) {
              const h = current();
              return h ? DecorationSet.create(state.doc, decorate(state.doc, h)) : DecorationSet.empty;
            }
            if (!tr.docChanged) return prev;
            const h = current();
            if (!h) return DecorationSet.empty;
            // Re-hyphenate the textblocks the change touched.
            let set = prev.map(tr.mapping, tr.doc);
            const ranges: [number, number][] = [];
            tr.mapping.maps.forEach((map, i) => {
              map.forEach((_a, _b, start, end) => {
                const rest = tr.mapping.slice(i + 1);
                ranges.push([rest.map(start, -1), rest.map(end, 1)]);
              });
            });
            for (const [a, b] of ranges) {
              const clamp = (p: number) => Math.max(0, Math.min(p, tr.doc.content.size));
              const $a = tr.doc.resolve(clamp(a));
              const $b = tr.doc.resolve(clamp(b));
              const from = $a.depth > 0 ? $a.before(1) : clamp(a);
              const to = $b.depth > 0 ? $b.after(1) : clamp(b);
              set = set.remove(set.find(from, to));
              set = set.add(tr.doc, decorate(tr.doc, h, from, to));
            }
            return set;
          },
        },
        props: { decorations: (state) => hyphenationKey.getState(state) },
        view(view) {
          let lang = "";
          let on = false;
          const sync = () => {
            const want = o.enabled();
            const l = o.lang().slice(0, 2);
            if (want === on && l === lang) return;
            on = want;
            lang = l;
            const refresh = () => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(hyphenationKey, true).setMeta("addToHistory", false));
            if (want && !nativeHyphenation(l) && !loadedHyphenator(l) && hasPatterns(l)) void hyphenator(l).then(refresh);
            else refresh();
          };
          sync();
          return { update: sync };
        },
      }),
    ];
  },
});
