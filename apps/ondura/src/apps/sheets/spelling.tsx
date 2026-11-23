// Rechtschreibung for the Tabellen app: checks the text constants of the
// active sheet with the spell checker of the Text app, cell by cell.

import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Text } from "@fluentui/react-components";
import { spell } from "../text/spell/spell";
import { colName } from "./formula";
import { tl } from "../../lib/i18n";

export interface SpellHit {
  r: number;
  c: number;
  word: string;
}

const WORD = /[\p{L}][\p{L}'’-]*[\p{L}]|[\p{L}]/gu;

/** Misspelled words of text cells (row by row). */
export async function misspelledCells(cells: { r: number; c: number; text: string }[]): Promise<SpellHit[]> {
  const words = cells.flatMap((x) => x.text.match(WORD) ?? []);
  await spell.check(words);
  const out: SpellHit[] = [];
  for (const x of cells) for (const w of x.text.match(WORD) ?? []) if (w.length > 1 && spell.known(w) === false) out.push({ r: x.r, c: x.c, word: w });
  return out;
}

export function SheetSpellingDialog({ open, cells, onGo, onReplace, onClose }: { open: boolean; cells: () => { r: number; c: number; text: string }[]; onGo: (r: number, c: number) => void; onReplace: (r: number, c: number, from: string, to: string, all: boolean) => void; onClose: () => void }) {
  const [hits, setHits] = useState<SpellHit[] | null>(null);
  const [i, setI] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setHits(null);
    setI(0);
    void misspelledCells(cells()).then(setHits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cur = hits?.[i];
  useEffect(() => {
    if (!cur) return;
    onGo(cur.r, cur.c);
    setSuggestions([]);
    setPick(null);
    void spell.suggest(cur.word).then((s) => (setSuggestions(s), setPick(s[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.r, cur?.c, cur?.word]);
  const next = (skipWord?: string) => {
    if (!hits) return;
    let j = i + 1;
    while (skipWord && j < hits.length && hits[j].word === skipWord) j++;
    setI(j);
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Rechtschreibung")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!hits && <Spinner size="small" label={tl("Rechtschreibung wird geprüft…")} />}
            {hits && !cur && <Text>{tl("Die Rechtschreibprüfung ist abgeschlossen.")}</Text>}
            {cur && (
              <>
                <Text>{tl("Nicht im Wörterbuch ({0}):", `${colName(cur.c)}${cur.r + 1}`)}</Text>
                <Text weight="semibold" style={{ color: "#c50f1f" }}>
                  {cur.word}
                </Text>
                <Text>{tl("Vorschläge:")}</Text>
                <div style={{ border: "1px solid #ddd", borderRadius: 4, minHeight: 90, maxHeight: 160, overflow: "auto" }}>
                  {suggestions.length === 0 && <Text style={{ padding: 6, color: "#888" }}>{tl("(Keine Vorschläge)")}</Text>}
                  {suggestions.map((s) => (
                    <div key={s} style={{ padding: "2px 8px", cursor: "pointer", background: pick === s ? "#e5f1fb" : undefined }} onClick={() => setPick(s)}>
                      {s}
                    </div>
                  ))}
                </div>
              </>
            )}
          </DialogContent>
          <DialogActions style={{ flexWrap: "wrap" }}>
            {cur && (
              <>
                <Button onClick={() => next()}>{tl("Einmal ignorieren")}</Button>
                <Button onClick={() => (spell.ignore(cur.word), next(cur.word))}>{tl("Alle ignorieren")}</Button>
                <Button onClick={() => void spell.add(cur.word).then(() => next(cur.word))}>{tl("Zum Wörterbuch hinzufügen")}</Button>
                <Button appearance="primary" disabled={!pick} onClick={() => pick && (onReplace(cur.r, cur.c, cur.word, pick, false), next())}>
                  {tl("Ändern")}
                </Button>
                <Button disabled={!pick} onClick={() => pick && (onReplace(cur.r, cur.c, cur.word, pick, true), next(cur.word))}>
                  {tl("Alle ändern")}
                </Button>
              </>
            )}
            <Button onClick={onClose}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** WordArt and signature lines as pictures (sheets have no rich text boxes). */
export function textPicture(lines: { text: string; size: number; color: string; bold?: boolean; italic?: boolean; font?: string }[], opts: { padding?: number; underlineFirst?: boolean } = {}): { src: string; w: number; h: number } {
  const pad = opts.padding ?? 8;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = (l: (typeof lines)[number]) => `${l.italic ? "italic " : ""}${l.bold ? "700 " : ""}${l.size}px ${l.font ?? "Calibri, Carlito, sans-serif"}`;
  let w = 0;
  let h = pad;
  for (const l of lines) {
    g.font = font(l);
    w = Math.max(w, g.measureText(l.text).width);
    h += l.size * 1.3;
  }
  w = Math.ceil(w + pad * 2);
  h = Math.ceil(h + pad);
  c.width = w * 2;
  c.height = h * 2;
  g.scale(2, 2);
  let y = pad;
  lines.forEach((l, i) => {
    g.font = font(l);
    g.fillStyle = l.color;
    g.textBaseline = "top";
    g.fillText(l.text, pad, y);
    if (i === 0 && opts.underlineFirst) {
      g.strokeStyle = "#000";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(pad, y + l.size * 1.15);
      g.lineTo(w - pad, y + l.size * 1.15);
      g.stroke();
    }
    y += l.size * 1.3;
  });
  return { src: c.toDataURL("image/png"), w, h };
}
