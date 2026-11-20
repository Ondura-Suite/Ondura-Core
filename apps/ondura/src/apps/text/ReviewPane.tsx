// Comment cards beside the page and the list of footnotes.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Button, Textarea, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Delete16Regular } from "@fluentui/react-icons";
import type { Comment } from "./model";
import { commentRanges } from "./review";
import { tl, LOCALE } from "../../lib/i18n";

const useStyles = makeStyles({
  pane: { position: "relative", width: "274px", marginLeft: "16px", flexShrink: 0, alignSelf: "stretch" },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: "#fff",
    color: "#222",
    boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
    borderLeft: "3px solid #e3a21a",
    transition: "top 0.15s ease",
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  },
  active: { boxShadow: "0 2px 10px rgba(43,91,215,0.35)", borderLeft: "3px solid #2b5bd7" },
  head: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" },
  avatar: { width: "26px", height: "26px", borderRadius: "50%", backgroundColor: "#2b5bd7", color: "#fff", fontSize: "11px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  who: { flex: 1, minWidth: 0, fontSize: "12px", lineHeight: "15px" },
  date: { color: "#777", fontSize: "11px" },
});

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function CommentsPane({
  editor,
  paper,
  zoom,
  comments,
  focus,
  onFocused,
  onChange,
  onDelete,
}: {
  editor: Editor;
  paper: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  comments: Comment[];
  focus: number | null;
  onFocused: () => void;
  onChange: (id: number, text: string) => void;
  onDelete: (id: number) => void;
}) {
  const s = useStyles();
  const activeId = useEditorState({ editor, selector: ({ editor: e }) => (e.isActive("comment") ? Number(e.getAttributes("comment").id) : null) });
  const version = useEditorState({ editor, selector: ({ editor: e }) => e.state.doc });
  const [tops, setTops] = useState<Record<number, number>>({});
  const cards = useRef<Record<number, HTMLDivElement | null>>({});

  // Each card next to its anchor, pushed down to avoid overlaps.
  useLayoutEffect(() => {
    const p = paper.current;
    if (!p) return;
    const base = p.getBoundingClientRect().top;
    const ranges = commentRanges(editor.state.doc);
    const anchors = comments
      .filter((c) => ranges.has(c.id))
      .map((c) => {
        let top = 0;
        try {
          top = (editor.view.coordsAtPos(ranges.get(c.id)!.from).top - base) / zoom;
        } catch {
          /* not rendered */
        }
        return { id: c.id, top };
      })
      .sort((a, b) => a.top - b.top);
    const next: Record<number, number> = {};
    let y = 0;
    for (const a of anchors) {
      const t = Math.max(a.top - 8, y);
      next[a.id] = t;
      y = t + (cards.current[a.id]?.offsetHeight ?? 90) + 10;
    }
    setTops((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  });

  useEffect(() => {
    if (focus === null) return;
    const el = cards.current[focus]?.querySelector("textarea");
    if (el) {
      el.focus();
      onFocused();
    }
  });

  void version;
  const ranges = commentRanges(editor.state.doc);
  const fmt = (d: string) => (d ? new Date(d).toLocaleString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  return (
    <div className={s.pane}>
      {comments
        .filter((c) => ranges.has(c.id))
        .map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              cards.current[c.id] = el;
            }}
            className={`${s.card} ${activeId === c.id ? s.active : ""}`}
            style={{ top: tops[c.id] ?? 0 }}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest("textarea, button")) return;
              const r = ranges.get(c.id);
              if (r) editor.chain().focus().setTextSelection(r).run();
            }}
          >
            <div className={s.head}>
              <span className={s.avatar}>{initials(c.author)}</span>
              <div className={s.who}>
                <div style={{ fontWeight: 600 }}>{c.author || tl("Unbekannt")}</div>
                <div className={s.date}>{fmt(c.date)}</div>
              </div>
              <Tooltip content={tl("Kommentar löschen")} relationship="label">
                <Button size="small" appearance="subtle" icon={<Delete16Regular />} onClick={() => onDelete(c.id)} />
              </Tooltip>
            </div>
            <Textarea
              value={c.text}
              placeholder={tl("Kommentar eingeben…")}
              resize="vertical"
              style={{ width: "100%" }}
              textarea={{ style: { minHeight: 40, fontSize: 13 } }}
              onChange={(_, d) => onChange(c.id, d.value)}
            />
          </div>
        ))}
    </div>
  );
}

/** Lower-case Roman numeral (default endnote numbering of .docx). */
export function roman(i: number): string {
  let n = i + 1;
  let out = "";
  for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as [number, string][])
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

/** Footnotes and endnotes in document order, shown after the text. */
export function FootnoteList({ editor }: { editor: Editor }) {
  const notes = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: { text: string; pos: number; endnote: boolean }[] = [];
      e.state.doc.descendants((n, pos) => {
        if (n.type.name === "footnote") out.push({ text: n.attrs.text ?? "", pos, endnote: !!n.attrs.endnote });
      });
      return out;
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  if (!notes?.length) return null;
  const foot = notes.filter((n) => !n.endnote);
  const end = notes.filter((n) => n.endnote);
  const list = (items: typeof notes, num: (i: number) => string) =>
    items.map((n, i) => (
      <div key={i} className="nx-footnote" onDoubleClick={() => editor.chain().focus().setNodeSelection(n.pos).scrollIntoView().run()}>
        <sup>{num(i)}</sup> {n.text}
      </div>
    ));
  return (
    <>
      {foot.length > 0 && (
        <div className="nx-footnotes" contentEditable={false}>
          {list(foot, (i) => String(i + 1))}
        </div>
      )}
      {end.length > 0 && (
        <div className="nx-footnotes" contentEditable={false}>
          <div className="nx-endnotes-title">{tl("Endnoten")}</div>
          {list(end, roman)}
        </div>
      )}
    </>
  );
}
