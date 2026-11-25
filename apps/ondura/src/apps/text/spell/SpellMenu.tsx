// Right-click on an underlined word: suggestions, "Alle ignorieren",
// "Zum Wörterbuch hinzufügen". Shared by Text, Slides and Notes.

import { useState } from "react";
import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover } from "@fluentui/react-components";
import type { Editor } from "@tiptap/core";
import { tl } from "../../../lib/i18n";
import { misspelledAt, refreshSpelling, spell, type WordAt } from "./spell";

interface Target extends WordAt {
  x: number;
  y: number;
  suggestions: string[] | null;
}

/**
 * The spelling context menu of an editor. `open` takes a contextmenu event
 * and returns false when the click was not on an underlined word (so the
 * editor's usual menu can open).
 */
export function useSpellMenu(editor: Editor | null) {
  const [target, setTarget] = useState<Target | null>(null);
  const open = (event: { clientX: number; clientY: number; preventDefault: () => void }): boolean => {
    if (!editor || editor.isDestroyed) return false;
    const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    const w = at ? misspelledAt(editor, at.pos) : null;
    if (!w) return false;
    event.preventDefault();
    setTarget({ x: event.clientX, y: event.clientY, ...w, suggestions: null });
    void spell.suggest(w.word).then((s) => setTarget((t) => (t && t.from === w.from ? { ...t, suggestions: s } : t)));
    return true;
  };
  const menu = editor ? <SpellMenu editor={editor} target={target} onClose={() => setTarget(null)} /> : null;
  return { open, menu };
}

function SpellMenu({ editor, target, onClose }: { editor: Editor; target: Target | null; onClose: () => void }) {
  const at = target ? { x: target.x, y: target.y, left: target.x, top: target.y, right: target.x, bottom: target.y, width: 0, height: 0, toJSON: () => ({}) } : null;
  return (
    <Menu open={!!target} onOpenChange={(_, d) => !d.open && onClose()} positioning={{ target: at ? { getBoundingClientRect: () => at as DOMRect } : undefined, position: "below", align: "start" }}>
      <MenuPopover>
        <MenuList>
          {target?.suggestions === null && <MenuItem disabled>{tl("Vorschläge werden gesucht …")}</MenuItem>}
          {target?.suggestions?.length === 0 && <MenuItem disabled>{tl("(Keine Vorschläge)")}</MenuItem>}
          {target?.suggestions?.slice(0, 6).map((s) => (
            <MenuItem key={s} style={{ fontWeight: 600 }} onClick={() => editor.chain().focus().insertContentAt({ from: target.from, to: target.to }, s).run()}>
              {s}
            </MenuItem>
          ))}
          <MenuDivider />
          <MenuItem onClick={() => target && (spell.ignore(target.word), refreshSpelling(editor))}>{tl("Alle ignorieren")}</MenuItem>
          <MenuItem onClick={() => target && void spell.add(target.word).then(() => refreshSpelling(editor))}>{tl("Zum Wörterbuch hinzufügen")}</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
