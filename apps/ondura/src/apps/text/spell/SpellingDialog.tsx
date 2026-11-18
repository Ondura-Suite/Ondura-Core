// "Rechtschreibung" (F7): walks through the unknown words of the document.

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Listbox, Option, Spinner, tokens } from "@fluentui/react-components";
import { type WordAt, documentWords, misspelled, refreshSpelling, spell } from "./spell";
import { tl } from "../../../lib/i18n";

export function SpellingDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: (done: boolean) => void }) {
  const [cur, setCur] = useState<WordAt | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [context, setContext] = useState("");

  /** The next unknown word after the cursor (wrapping around). */
  const findNext = useCallback(
    async (after: number) => {
      const doc = editor.state.doc;
      await spell.check(documentWords(doc).map((w) => w.word));
      const list = misspelled(doc);
      const w = list.find((x) => x.from >= after) ?? list[0] ?? null;
      setCur(w);
      setSuggestions(null);
      setPick(null);
      if (!w) return;
      editor.chain().setTextSelection({ from: w.from, to: w.to }).scrollIntoView().run();
      const $from = doc.resolve(w.from);
      const para = $from.parent.textContent;
      const start = $from.parentOffset;
      setContext(para.slice(Math.max(0, start - 50), start + (w.to - w.from) + 50));
      const s = await spell.suggest(w.word);
      setSuggestions(s);
      setPick(s[0] ?? null);
    },
    [editor],
  );

  useEffect(() => {
    if (open) void findNext(editor.state.selection.from);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const replace = (all: boolean) => {
    if (!cur || !pick) return;
    if (all) {
      // Every occurrence, from the end so positions stay valid.
      const hits = misspelled(editor.state.doc).filter((w) => w.word === cur.word).reverse();
      let tr = editor.state.tr;
      for (const h of hits) tr = tr.insertText(pick, h.from, h.to);
      editor.view.dispatch(tr);
    } else {
      editor.view.dispatch(editor.state.tr.insertText(pick, cur.from, cur.to));
    }
    void findNext(cur.from + pick.length);
  };
  const skip = (all: boolean) => {
    if (!cur) return;
    if (all) {
      spell.ignore(cur.word);
      refreshSpelling(editor);
    }
    void findNext(cur.to);
  };
  const add = async () => {
    if (!cur) return;
    await spell.add(cur.word);
    refreshSpelling(editor);
    void findNext(cur.to);
  };

  const word = cur?.word ?? "";
  const at = context.indexOf(word);
  return (
    <Dialog open modalType="non-modal" onOpenChange={(_, d) => !d.open && onClose(false)}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Rechtschreibung (")}{spell.lang === "de" ? tl("Deutsch") : tl("Englisch")})</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!cur ? (
              <div>{tl("Die Rechtschreibprüfung ist abgeschlossen.")}</div>
            ) : (
              <>
                <Field label={tl("Nicht im Wörterbuch")}>
                  <div style={{ border: `1px solid ${tokens.colorNeutralStroke1}`, padding: 8, borderRadius: 4, minHeight: 40 }}>
                    {at >= 0 ? (
                      <>
                        {context.slice(0, at)}
                        <span style={{ color: "#c50f1f", fontWeight: 600 }}>{word}</span>
                        {context.slice(at + word.length)}
                      </>
                    ) : (
                      word
                    )}
                  </div>
                </Field>
                <Field label={tl("Vorschläge")}>
                  {suggestions === null ? (
                    <Spinner size="tiny" />
                  ) : suggestions.length ? (
                    <Listbox selectedOptions={pick ? [pick] : []} onOptionSelect={(_, d) => setPick(d.optionValue ?? null)} style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke1}` }}>
                      {suggestions.map((s) => (
                        <Option key={s} value={s} onDoubleClick={() => (setPick(s), replace(false))}>
                          {s}
                        </Option>
                      ))}
                    </Listbox>
                  ) : (
                    <span>{tl("(Keine Vorschläge)")}</span>
                  )}
                </Field>
              </>
            )}
          </DialogContent>
          <DialogActions fluid style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
            {cur && (
              <>
                <Button onClick={() => skip(false)}>{tl("Einmal ignorieren")}</Button>
                <Button onClick={() => skip(true)}>{tl("Alle ignorieren")}</Button>
                <Button onClick={() => void add()}>{tl("Hinzufügen")}</Button>
                <Button disabled={!pick} onClick={() => replace(true)}>
                  {tl("Alle ändern")}
                </Button>
                <Button appearance="primary" disabled={!pick} onClick={() => replace(false)}>
                  {tl("Ändern")}
                </Button>
              </>
            )}
            <Button onClick={() => (editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.selection.to))), onClose(!cur))}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
