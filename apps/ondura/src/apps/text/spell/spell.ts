// Spell checking in the editor: the worker client, the personal dictionary
// and a ProseMirror plugin that underlines unknown words.

import { Extension, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Lang, Request, Response } from "./spell.worker";

// ---------------------------------------------------------------- client --

const DICT_KEY = "ondura.spell.words";
const LANG_KEY = "ondura.spell.lang";

type Pending = { resolve: (r: Response) => void };
type Req = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

class SpellClient {
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, boolean>();
  /** Ignored for this session ("Alle ignorieren"). */
  readonly ignored = new Set<string>();
  lang: Lang = (localStorage.getItem(LANG_KEY) as Lang) || "de";

  private call(req: Req): Promise<Response> {
    if (!this.worker) {
      this.worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<Response>) => {
        this.pending.get(e.data.id)?.resolve(e.data);
        this.pending.delete(e.data.id);
      };
      const own = personalWords();
      if (own.length) for (const lang of ["de", "en"] as Lang[]) void this.call({ kind: "add", lang, words: own });
    }
    const id = this.next++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.worker!.postMessage({ ...req, id } as Request);
    });
  }

  setLang(lang: Lang) {
    this.lang = lang;
    this.cache.clear();
    localStorage.setItem(LANG_KEY, lang);
  }

  known(word: string): boolean | undefined {
    if (this.ignored.has(word)) return true;
    return this.cache.get(word);
  }

  async check(words: string[]): Promise<void> {
    const todo = [...new Set(words)].filter((w) => !this.cache.has(w) && !this.ignored.has(w));
    for (let i = 0; i < todo.length; i += 2000) {
      const part = todo.slice(i, i + 2000);
      const r = await this.call({ kind: "check", lang: this.lang, words: part });
      if ("ok" in r) part.forEach((w, j) => this.cache.set(w, r.ok[j]));
    }
  }

  async suggest(word: string): Promise<string[]> {
    const r = await this.call({ kind: "suggest", lang: this.lang, word });
    return "suggestions" in r ? r.suggestions : [];
  }

  /** Adds a word to the personal dictionary (kept across sessions). */
  async add(word: string) {
    const own = new Set(personalWords());
    own.add(word);
    localStorage.setItem(DICT_KEY, JSON.stringify([...own]));
    this.cache.set(word, true);
    for (const lang of ["de", "en"] as Lang[]) await this.call({ kind: "add", lang, words: [word] });
  }

  ignore(word: string) {
    this.ignored.add(word);
  }
}

function personalWords(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DICT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export const spell = new SpellClient();

// ----------------------------------------------------------------- words --

export interface WordAt {
  from: number;
  to: number;
  word: string;
}

const WORD_RE = /[\p{L}][\p{L}\p{M}’'-]*[\p{L}\p{M}]|[\p{L}]/gu;

/** Words of the document with their positions (skips URLs, codes and numbers). */
export function documentWords(doc: PmNode): WordAt[] {
  const out: WordAt[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === "code" || m.type.name === "link" || m.type.name === "deletion")) return;
    const text = node.text;
    for (const m of text.matchAll(WORD_RE)) {
      let w = m[0].replace(/['’-]+$/, "");
      const start = m.index!;
      // Skip parts of URLs, e-mail addresses and words glued to digits.
      const before = text[start - 1] ?? "";
      const after = text[start + m[0].length] ?? "";
      if (/[@/\\\d_.]/.test(before)) continue;
      if (/[@/\\\d_]/.test(after) || (after === "." && /^[a-z]/.test(text[start + m[0].length + 1] ?? ""))) continue;
      w = w.replace(/^['’-]+/, "");
      if (w.length < 2) continue;
      out.push({ from: pos + start, to: pos + start + w.length, word: w });
    }
  });
  return out;
}

// ---------------------------------------------------------------- plugin --

export const spellKey = new PluginKey<DecorationSet>("spellcheck");

function decorate(doc: PmNode): DecorationSet {
  const decos = documentWords(doc)
    .filter((w) => spell.known(w.word) === false)
    .map((w) => Decoration.inline(w.from, w.to, { class: "nx-misspelled" }, { word: w.word }));
  return DecorationSet.create(doc, decos);
}

/** Misspelled words, in document order (for the spelling pane). */
export function misspelled(doc: PmNode): WordAt[] {
  return documentWords(doc).filter((w) => spell.known(w.word) === false);
}

declare module "@tiptap/core" {
  interface Storage {
    spellCheck: { enabled: boolean };
  }
}

export const SpellCheck = Extension.create({
  name: "spellCheck",
  addStorage() {
    return { enabled: localStorage.getItem("ondura.spell.auto") !== "0" };
  },
  addProseMirrorPlugins() {
    const ext = this;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (view: EditorView) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!ext.storage.enabled) {
          view.dispatch(view.state.tr.setMeta(spellKey, DecorationSet.empty).setMeta("addToHistory", false));
          return;
        }
        const doc = view.state.doc;
        await spell.check(documentWords(doc).map((w) => w.word));
        if (view.isDestroyed) return;
        view.dispatch(view.state.tr.setMeta(spellKey, decorate(view.state.doc)).setMeta("addToHistory", false));
      }, 350);
    };
    return [
      new Plugin<DecorationSet>({
        key: spellKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta = tr.getMeta(spellKey) as DecorationSet | undefined;
            if (meta) return meta;
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: { decorations: (state) => spellKey.getState(state) },
        view: (view) => {
          run(view);
          return { update: (v, prev) => (v.state.doc !== prev.doc || v.state.selection !== prev.selection ? v.state.doc !== prev.doc && run(v) : undefined), destroy: () => clearTimeout(timer) };
        },
      }),
    ];
  },
});

/** Re-checks the document (after a language change, adding a word …). */
export function refreshSpelling(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta("spellRefresh", true));
  // Rebuilding happens in the plugin view on the next doc change; force one now.
  void spell.check(documentWords(editor.state.doc).map((w) => w.word)).then(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(spellKey, editor.storage.spellCheck.enabled ? decorate(editor.state.doc) : DecorationSet.empty).setMeta("addToHistory", false));
  });
}

/** The misspelled word at a document position, if any. */
export function misspelledAt(editor: Editor, pos: number): WordAt | null {
  const set = spellKey.getState(editor.state);
  const d = set?.find(pos, pos)[0];
  if (!d) return null;
  return { from: d.from, to: d.to, word: (d.spec as { word: string }).word };
}
