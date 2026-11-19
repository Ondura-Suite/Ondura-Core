// "Dateien vergleichen": both versions side by side with the changed words
// marked (red: removed, green: added, yellow: changed, blue: graphics) and
// a list of all changes; clicking a change scrolls both versions to it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Spinner, Text, ToggleButton, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowSwap24Regular, ChevronDown24Regular, ChevronUp24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { tl } from "../../lib/i18n";
import { errorMessage } from "../../lib/api";
import { comparePdfs, type Change, type Comparison, type Word } from "./compare";
import type { PDFDocumentProxy } from "./pdfjs";

const useStyles = makeStyles({
  root: { position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", backgroundColor: "var(--nx-solid-bg, #f6f6fa)", borderRadius: "inherit", overflow: "hidden" },
  bar: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 12px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  body: { flex: 1, minHeight: 0, display: "flex" },
  column: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  colHead: { padding: "6px 12px", fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  scroll: { flex: 1, overflow: "auto", padding: "12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" },
  page: { position: "relative", boxShadow: tokens.shadow8, backgroundColor: "#fff", flexShrink: 0 },
  mark: { position: "absolute", borderRadius: "2px", cursor: "pointer", mixBlendMode: "multiply" },
  del: { backgroundColor: "rgba(232, 72, 85, 0.35)", outline: "1px solid rgba(200, 40, 50, 0.6)" },
  ins: { backgroundColor: "rgba(48, 180, 90, 0.35)", outline: "1px solid rgba(20, 140, 60, 0.6)" },
  rep: { backgroundColor: "rgba(250, 200, 40, 0.45)", outline: "1px solid rgba(200, 150, 0, 0.7)" },
  gfx: { backgroundColor: "rgba(60, 120, 230, 0.15)", outline: "2px dashed rgba(40, 90, 200, 0.8)" },
  active: { outline: "2px solid #000 !important" },
  list: { width: "320px", flexShrink: 0, display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground1 },
  items: { flex: 1, overflowY: "auto", padding: "6px" },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  itemActive: { backgroundColor: tokens.colorNeutralBackground1Selected },
  old: { color: "#b3261e", textDecoration: "line-through", wordBreak: "break-word" },
  new: { color: "#0f7b3a", wordBreak: "break-word" },
  muted: { color: tokens.colorNeutralForeground3 },
  center: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" },
});

type Filter = "all" | "text" | "graphic";

function usePageImages(doc: PDFDocumentProxy | null, width: number) {
  const [pages, setPages] = useState<{ src: string; w: number; h: number; scale: number }[]>([]);
  useEffect(() => {
    if (!doc || width < 50) return;
    let cancelled = false;
    void (async () => {
      const out: { src: string; w: number; h: number; scale: number }[] = [];
      for (let i = 1; i <= doc.numPages && !cancelled; i++) {
        const pg = await doc.getPage(i);
        const base = pg.getViewport({ scale: 1, rotation: 0 });
        const scale = width / base.width;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const vp = pg.getViewport({ scale: scale * ratio, rotation: 0 });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        await pg.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
        out.push({ src: c.toDataURL("image/png"), w: base.width * scale, h: base.height * scale, scale });
        if (!cancelled && (i % 4 === 0 || i === doc.numPages)) setPages([...out]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, width]);
  return pages;
}

export function ComparePanel({ current, currentName, other, otherName, onClose }: { current: Uint8Array; currentName: string; other: Uint8Array; otherName: string; onClose: () => void }) {
  const s = useStyles();
  const [swapped, setSwapped] = useState(false);
  const [state, setState] = useState<{ result: Comparison; oldDoc: PDFDocumentProxy; newDoc: PDFDocumentProxy } | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const oldScroll = useRef<HTMLDivElement>(null);
  const newScroll = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(0);

  const [oldBytes, newBytes] = swapped ? [other, current] : [current, other];
  const [oldName, newName] = swapped ? [otherName, currentName] : [currentName, otherName];

  useEffect(() => {
    let cancelled = false;
    let docs: PDFDocumentProxy[] = [];
    setState(null);
    setError(null);
    setActive(null);
    comparePdfs(oldBytes, newBytes, (t) => !cancelled && setProgress(t))
      .then((r) => {
        docs = [r.oldDoc, r.newDoc];
        if (!cancelled) setState(r);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      docs.forEach((d) => void d.loadingTask.destroy());
    };
  }, [oldBytes, newBytes]);

  useEffect(() => {
    const el = oldScroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setColWidth(Math.max(0, el.clientWidth - 40)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  const oldPages = usePageImages(state?.oldDoc ?? null, colWidth);
  const newPages = usePageImages(state?.newDoc ?? null, colWidth);
  const changes = useMemo(() => (state?.result.changes ?? []).filter((c) => filter === "all" || (filter === "graphic" ? c.kind === "graphic" : c.kind !== "graphic")), [state, filter]);

  const markClass = (c: Change, side: "old" | "new") => (c.kind === "graphic" ? s.gfx : c.kind === "replace" ? s.rep : side === "old" ? s.del : s.ins);

  const go = (i: number) => {
    const c = changes[i];
    if (!c) return;
    setActive(i);
    const scrollTo = (el: HTMLDivElement | null, pages: typeof oldPages, page: number, w?: Word) => {
      if (!el) return;
      const pageEl = el.querySelector<HTMLElement>(`[data-page="${page}"]`);
      if (!pageEl) return;
      const top = pageEl.offsetTop + (w ? w.top * (pages[page - 1]?.scale ?? 1) : 0) - el.clientHeight / 3;
      el.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };
    scrollTo(oldScroll.current, oldPages, c.oldPage, c.oldWords[0]);
    scrollTo(newScroll.current, newPages, c.newPage, c.newWords[0]);
  };

  const renderPages = (pages: typeof oldPages, side: "old" | "new") =>
    pages.map((p, i) => (
      <div key={i} data-page={i + 1} className={s.page} style={{ width: p.w, height: p.h }}>
        <img src={p.src} alt="" width={p.w} height={p.h} style={{ display: "block" }} />
        {changes.map((c, ci) =>
          (side === "old" ? c.oldWords : c.newWords)
            .filter((w) => w.page === i + 1)
            .map((w, wi) => (
              <div
                key={`${ci}-${wi}`}
                className={mergeClasses(s.mark, markClass(c, side), active === ci && s.active)}
                style={{ left: w.x * p.scale - 1, top: w.top * p.scale - 1, width: w.width * p.scale + 2, height: w.height * p.scale + 2 }}
                onClick={() => go(ci)}
                title={c.kind === "graphic" ? tl("Grafik geändert") : side === "old" ? c.oldText : c.newText}
              />
            )),
        )}
      </div>
    ));

  const counts = state ? { text: state.result.changes.filter((c) => c.kind !== "graphic").length, gfx: state.result.changes.filter((c) => c.kind === "graphic").length } : null;

  return (
    <div className={s.root}>
      <div className={s.bar}>
        <Text weight="semibold">{tl("Dateien vergleichen")}</Text>
        {counts && (
          <>
            <ToggleButton size="small" appearance="subtle" checked={filter === "all"} onClick={() => setFilter("all")}>
              {tl("Alle ({0})", counts.text + counts.gfx)}
            </ToggleButton>
            <ToggleButton size="small" appearance="subtle" checked={filter === "text"} onClick={() => setFilter("text")}>
              {tl("Text ({0})", counts.text)}
            </ToggleButton>
            <ToggleButton size="small" appearance="subtle" checked={filter === "graphic"} onClick={() => setFilter("graphic")}>
              {tl("Grafiken ({0})", counts.gfx)}
            </ToggleButton>
          </>
        )}
        <div style={{ flex: 1 }} />
        <Badge appearance="tint" color="danger">{tl("Entfernt")}</Badge>
        <Badge appearance="tint" color="success">{tl("Hinzugefügt")}</Badge>
        <Badge appearance="tint" color="warning">{tl("Geändert")}</Badge>
        <Badge appearance="tint" color="brand">{tl("Grafik")}</Badge>
        <Tooltip content={tl("Vorherige Änderung")} relationship="label">
          <Button appearance="subtle" icon={<ChevronUp24Regular />} disabled={!changes.length} onClick={() => go(active == null ? changes.length - 1 : (active - 1 + changes.length) % changes.length)} />
        </Tooltip>
        <Tooltip content={tl("Nächste Änderung")} relationship="label">
          <Button appearance="subtle" icon={<ChevronDown24Regular />} disabled={!changes.length} onClick={() => go(active == null ? 0 : (active + 1) % changes.length)} />
        </Tooltip>
        <Tooltip content={tl("Alt und neu tauschen")} relationship="label">
          <Button appearance="subtle" icon={<ArrowSwap24Regular />} onClick={() => setSwapped((v) => !v)} />
        </Tooltip>
        <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      {error ? (
        <div className={s.center}>
          <Text>{tl("Der Vergleich ist fehlgeschlagen: {0}", error)}</Text>
          <Button onClick={onClose}>{tl("Schließen")}</Button>
        </div>
      ) : !state ? (
        <div className={s.center}>
          <Spinner label={progress ? tl("Seiten werden gelesen … {0}", progress) : tl("Dokumente werden verglichen …")} />
        </div>
      ) : (
        <div className={s.body}>
          <div className={s.column}>
            <div className={s.colHead} title={oldName}>
              {tl("Alt: {0}", oldName)}
            </div>
            <div className={s.scroll} ref={oldScroll}>
              {renderPages(oldPages, "old")}
            </div>
          </div>
          <div className={s.column}>
            <div className={s.colHead} title={newName}>
              {tl("Neu: {0}", newName)}
            </div>
            <div className={s.scroll} ref={newScroll}>
              {renderPages(newPages, "new")}
            </div>
          </div>
          <div className={s.list}>
            <div className={s.colHead}>{changes.length === 1 ? tl("1 Änderung") : tl("{0} Änderungen", changes.length)}</div>
            <div className={s.items}>
              {changes.length === 0 && (
                <Text className={s.muted} block style={{ padding: 12 }}>
                  {tl("Keine Unterschiede gefunden.")}
                </Text>
              )}
              {changes.map((c, i) => (
                <button key={i} className={mergeClasses(s.item, active === i && s.itemActive)} onClick={() => go(i)}>
                  <Text size={200} className={s.muted}>
                    {c.kind === "graphic" ? tl("Seite {0} · Grafik geändert", c.newPage) : c.kind === "insert" ? tl("Seite {0} · Hinzugefügt", c.newPage) : c.kind === "delete" ? tl("Seite {0} · Entfernt", c.oldPage) : tl("Seite {0} · Geändert", c.newPage)}
                  </Text>
                  {c.oldText && <Text className={s.old}>{c.oldText.length > 160 ? c.oldText.slice(0, 160) + " …" : c.oldText}</Text>}
                  {c.newText && <Text className={s.new}>{c.newText.length > 160 ? c.newText.slice(0, 160) + " …" : c.newText}</Text>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
