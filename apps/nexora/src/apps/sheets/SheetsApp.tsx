import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, Slider, Spinner, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Add16Regular, ArrowDown16Regular, ArrowUp16Regular, Checkmark16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { Backstage, DocumentInfo, StatusBar, useUnsavedPrompt } from "../../shell/office";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { errorMessage, isTauri } from "../../lib/api";
import { addRecent, baseName, guardClose, initialFile, officeInvoke, openDocumentWindow, pickOpenPath, pickSavePath, setWindowTitle, withoutExt } from "../../lib/office";
import { Grid, type Editing, type GridHandle, type Selection, selRect } from "./Grid";
import { SheetsRibbon, type BorderPreset } from "./SheetsRibbon";
import { type Scalar, fromDisplayFormula, germanName, parse, toDisplayFormula } from "./formula";
import { changeDecimals, editText, formatValue, parseInput } from "./format";
import {
  type Book,
  type CellStyle,
  type ClipBlock,
  type Rect,
  type RustWorkbook,
  type SCell,
  MAX_COLS,
  MAX_ROWS,
  a1,
  calculate,
  clearRange,
  copyBlock,
  fillSeries,
  fromRust,
  internStyle,
  key,
  mergeAt,
  newBook,
  newSheet,
  parseRange,
  pasteBlock,
  rangeName,
  renameSheet,
  setCells,
  shiftAxis,
  sortRange,
  styleRange,
  toRust,
  unkey,
  usedRange,
  withSheet,
} from "./model";
import { sampleBook } from "./sample";
import "./sheets.css";

const COLOR = "#107c41";

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  work: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    margin: "0 8px",
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    position: "relative",
  },
  gridWrap: { flex: 1, minHeight: 0, display: "flex", position: "relative", borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  find: {
    position: "absolute",
    top: "48px",
    right: "24px",
    zIndex: 40,
    display: "flex",
    gap: "4px",
    alignItems: "center",
    padding: "8px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
  },
  loading: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, backgroundColor: "rgba(0,0,0,0.04)" },
  zoom: { display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" },
});

interface Loaded {
  workbook: RustWorkbook;
  warnings: string[];
}

interface History {
  past: Book[];
  future: Book[];
}

const one = (r: number, c: number): Selection => ({ anchor: { r, c }, focus: { r, c } });

/** Characters after which a click inserts a reference into a formula. */
const REF_TRIGGER = /[=(;,+\-*/^&<>:]\s*$/;

export function SheetsApp() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();

  const [book, setBookState] = useState<Book>(() => (isTauri ? newBook() : sampleBook()));
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [path, setPath] = useState<string | null>(null);
  const [savedBook, setSavedBook] = useState<Book>(book);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>(one(0, 0));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [caret, setCaret] = useState(0);
  const [point, setPoint] = useState<null | { start: number; end: number; rect: Rect }>(null);
  const [tab, setTab] = useState("home");
  const [zoom, setZoom] = useState(1);
  const [backstage, setBackstage] = useState<null | "open" | "info">(null);
  const [loading, setLoading] = useState(false);
  const [clip, setClip] = useState<null | { block: ClipBlock; tsv: string; cut: boolean }>(null);
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);
  const [tabMenu, setTabMenu] = useState<null | { x: number; y: number; index: number }>(null);
  const [renaming, setRenaming] = useState<null | { index: number; name: string }>(null);
  const [find, setFind] = useState<null | { query: string }>(null);
  const [recalc, setRecalc] = useState(0);
  const [printing, setPrinting] = useState(false);
  const grid = useRef<GridHandle>(null);
  const fxInput = useRef<HTMLTextAreaElement>(null);
  const [nameBox, setNameBox] = useState<string | null>(null);

  const si = book.active;
  const sheet = book.sheets[si];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const values = useMemo(() => calculate(book), [book, recalc]);
  const dirty = book !== savedBook;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const sel = selRect(selection);
  const active = selection.anchor;

  const setBook = useCallback((next: Book | ((b: Book) => Book)) => {
    setBookState((cur) => {
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      setHistory((h) => ({ past: [...h.past.slice(-99), cur], future: [] }));
      return n;
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      setBookState((cur) => {
        setTimeout(() => setHistory((x) => ({ ...x, future: [cur, ...x.future] })));
        return prev;
      });
      return { ...h, past: h.past.slice(0, -1) };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      setBookState((cur) => {
        setTimeout(() => setHistory((x) => ({ ...x, past: [...x.past, cur] })));
        return next;
      });
      return { ...h, future: h.future.slice(1) };
    });
  }, []);

  const name = path ? baseName(path) : book.title || "Mappe1";
  useEffect(() => {
    void setWindowTitle(`${dirty ? "• " : ""}${withoutExt(name)} – Nexora Tabellen`);
  }, [name, dirty]);
  useEffect(() => splashDone(), []);

  // Range used for operations on whole rows/columns.
  const effective = useCallback(
    (r: Rect): Rect => {
      const used = usedRange(sheet) ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
      return { r1: r.r1, c1: r.c1, r2: r.r2 >= MAX_ROWS - 1 ? Math.max(r.r1, used.r2) : r.r2, c2: r.c2 >= MAX_COLS - 1 ? Math.max(r.c1, used.c2) : r.c2 };
    },
    [sheet],
  );

  const cellValue = (r: number, c: number): Scalar => {
    const cell = sheet.cells.get(key(r, c));
    if (!cell) return null;
    if (cell.f) return values[si]?.get(key(r, c)) ?? null;
    if (cell.e) return { error: cell.e };
    return cell.v ?? null;
  };
  const activeCell = sheet.cells.get(key(active.r, active.c));
  const activeStyle: CellStyle = book.styles[activeCell?.s ?? 0] ?? {};

  // --------------------------------------------------------------- editing --

  const cellEditText = (r: number, c: number) => {
    const cell = sheet.cells.get(key(r, c));
    if (!cell) return "";
    if (cell.f) return "=" + toDisplayFormula(cell.f);
    return editText(cell.e ? { error: cell.e } : cell.v ?? null, book.styles[cell.s ?? 0]?.numFmt);
  };

  const startEdit = (text: string | null, mode: "enter" | "edit") => {
    const m = mergeAt(sheet, active.r, active.c);
    const r = m?.r1 ?? active.r;
    const c = m?.c1 ?? active.c;
    const t = text ?? cellEditText(r, c);
    setEditing({ r, c, text: t, mode });
    setCaret(t.length);
    setPoint(null);
  };

  const pointMode = !!editing && editing.text.startsWith("=") && (point !== null || REF_TRIGGER.test(editing.text.slice(0, caret)));

  const commit = (move: [number, number] | null) => {
    if (!editing) return;
    const { r, c } = editing;
    let text = editing.text;
    const cell = sheet.cells.get(key(r, c));
    const style = book.styles[cell?.s ?? 0] ?? {};
    let next: SCell | null;
    if (text.startsWith("=") && text.length > 1) {
      // Close open parentheses like Excel.
      const open = (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
      if (open > 0) text += ")".repeat(open);
      const f = fromDisplayFormula(text.slice(1));
      try {
        parse(f, "en");
      } catch (e) {
        notify("Fehler in der Formel", errorMessage(e), "error");
        return;
      }
      next = { f, s: cell?.s };
    } else {
      const parsed = style.numFmt === "@" ? { v: text } : parseInput(text);
      let s = cell?.s;
      let b = book;
      if (parsed.numFmt && !style.numFmt) {
        const [styles, idx] = internStyle(book.styles, { ...style, numFmt: parsed.numFmt });
        b = { ...book, styles };
        s = idx;
      }
      if (text.includes("\n") && !style.wrap) {
        const [styles, idx] = internStyle(b.styles, { ...(b.styles[s ?? 0] ?? {}), wrap: true });
        b = { ...b, styles };
        s = idx;
      }
      next = parsed.v === null && !s ? null : { v: parsed.v ?? undefined, s };
      if (b !== book) {
        setBook(setCells(b, si, [{ r, c, cell: next }]));
        finishEdit(move);
        return;
      }
    }
    setBook((b) => setCells(b, si, [{ r, c, cell: next }]));
    finishEdit(move);
  };

  const finishEdit = (move: [number, number] | null) => {
    setEditing(null);
    setPoint(null);
    if (move) moveActive(move[0], move[1], false, true);
    grid.current?.focus();
  };

  const cancel = () => {
    setEditing(null);
    setPoint(null);
    grid.current?.focus();
  };

  const editTextChange = (text: string, pos?: number) => {
    setEditing((e) => (e ? { ...e, text } : e));
    if (pos !== undefined) setCaret(pos);
    // Typing anything after a picked reference ends the pick.
    if (point && pos !== undefined && pos !== point.end) setPoint(null);
  };

  const onPoint = (rect: Rect, extend: boolean) => {
    if (!editing) return;
    const ref = rect.r1 === rect.r2 && rect.c1 === rect.c2 ? a1(rect.r1, rect.c1) : rangeName(rect);
    const start = point && (extend || point.end === caret) ? point.start : caret;
    const end = point && (extend || point.end === caret) ? point.end : caret;
    const text = editing.text.slice(0, start) + ref + editing.text.slice(end);
    setEditing({ ...editing, text });
    setPoint({ start, end: start + ref.length, rect });
    setCaret(start + ref.length);
  };

  // ------------------------------------------------------------ navigation --

  const dataEdge = (r: number, c: number, dr: number, dc: number) => {
    const filled = (rr: number, cc: number) => {
      const cell = sheet.cells.get(key(rr, cc));
      return !!cell && (cell.v !== undefined || !!cell.f || !!cell.e);
    };
    const used = usedRange(sheet);
    const maxR = Math.max(used?.r2 ?? 0, r);
    const maxC = Math.max(used?.c2 ?? 0, c);
    let rr = r;
    let cc = c;
    const inside = (a: number, b: number) => a >= 0 && b >= 0 && a <= maxR + 1 && b <= maxC + 1;
    if (filled(rr, cc) && inside(rr + dr, cc + dc) && filled(rr + dr, cc + dc)) {
      while (inside(rr + dr, cc + dc) && filled(rr + dr, cc + dc)) {
        rr += dr;
        cc += dc;
      }
      return { r: rr, c: cc };
    }
    rr += dr;
    cc += dc;
    while (inside(rr, cc) && !filled(rr, cc)) {
      rr += dr;
      cc += dc;
    }
    if (!inside(rr, cc)) return { r: dr > 0 ? (dr ? maxR : r) : dr < 0 ? 0 : r, c: dc > 0 ? maxC : dc < 0 ? 0 : c };
    return { r: rr, c: cc };
  };

  const moveActive = (dr: number, dc: number, extend: boolean, withinSelection = false) => {
    setSelection((cur) => {
      const rect = selRect(cur);
      if (withinSelection && !extend && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2) && rect.r2 < MAX_ROWS - 1 && rect.c2 < MAX_COLS - 1) {
        // Enter/Tab cycle through the selected range.
        let { r, c } = cur.anchor;
        if (dr) {
          r += dr;
          if (r > rect.r2) (r = rect.r1), (c = c + 1 > rect.c2 ? rect.c1 : c + 1);
          if (r < rect.r1) (r = rect.r2), (c = c - 1 < rect.c1 ? rect.c2 : c - 1);
        } else {
          c += dc;
          if (c > rect.c2) (c = rect.c1), (r = r + 1 > rect.r2 ? rect.r1 : r + 1);
          if (c < rect.c1) (c = rect.c2), (r = r - 1 < rect.r1 ? rect.r2 : r - 1);
        }
        return { anchor: { r, c }, focus: cur.focus };
      }
      const from = extend ? cur.focus : cur.anchor;
      // Skip over merged areas and hidden rows/columns.
      let r = Math.max(0, Math.min(MAX_ROWS - 1, from.r + dr));
      let c = Math.max(0, Math.min(MAX_COLS - 1, from.c + dc));
      while (dr && sheet.hiddenRows.has(r) && r > 0 && r < MAX_ROWS - 1) r += dr;
      while (dc && sheet.hiddenCols.has(c) && c > 0 && c < MAX_COLS - 1) c += dc;
      const m = mergeAt(sheet, from.r, from.c);
      if (m && !extend) {
        if (dr > 0) r = m.r2 + 1;
        if (dc > 0) c = m.c2 + 1;
      }
      const target = mergeAt(sheet, r, c);
      if (target && !extend) return { anchor: { r: target.r1, c: target.c1 }, focus: { r: target.r2, c: target.c2 } };
      return extend ? { anchor: cur.anchor, focus: { r, c } } : one(r, c);
    });
  };

  // -------------------------------------------------------------- commands --

  const applyStyle = useCallback((patch: (st: CellStyle) => CellStyle) => setBook((b) => styleRange(b, b.active, effective(sel), patch)), [effective, sel, setBook]);

  const toggle = (k: "bold" | "italic" | "underline" | "strike" | "wrap") => {
    const on = !activeStyle[k];
    applyStyle((st) => ({ ...st, [k]: on || undefined }));
  };

  const setBorder = (b: BorderPreset) => {
    const r = effective(sel);
    setBook((bk) =>
      styleRange(bk, bk.active, r, (st) => st).sheets === bk.sheets && false
        ? bk
        : (() => {
            let x = bk;
            const edge = (rect: Rect, f: (st: CellStyle) => CellStyle) => (x = styleRange(x, x.active, rect, f));
            switch (b) {
              case "none":
                edge(r, (st) => ({ ...st, borderTop: undefined, borderBottom: undefined, borderLeft: undefined, borderRight: undefined }));
                break;
              case "all":
                edge(r, (st) => ({ ...st, borderTop: "thin", borderBottom: "thin", borderLeft: "thin", borderRight: "thin" }));
                break;
              case "outside":
                edge({ ...r, r2: r.r1 }, (st) => ({ ...st, borderTop: "thin" }));
                edge({ ...r, r1: r.r2 }, (st) => ({ ...st, borderBottom: "thin" }));
                edge({ ...r, c2: r.c1 }, (st) => ({ ...st, borderLeft: "thin" }));
                edge({ ...r, c1: r.c2 }, (st) => ({ ...st, borderRight: "thin" }));
                break;
              case "top":
                edge({ ...r, r2: r.r1 }, (st) => ({ ...st, borderTop: "thin" }));
                break;
              case "bottom":
              case "bottomDouble":
              case "bottomThick":
                edge({ ...r, r1: r.r2 }, (st) => ({ ...st, borderBottom: b === "bottom" ? "thin" : b === "bottomDouble" ? "double" : "thick" }));
                break;
              case "left":
                edge({ ...r, c2: r.c1 }, (st) => ({ ...st, borderLeft: "thin" }));
                break;
              case "right":
                edge({ ...r, c1: r.c2 }, (st) => ({ ...st, borderRight: "thin" }));
                break;
            }
            return x;
          })(),
    );
  };

  const fontSize = (d: 1 | -1 | number) => {
    const cur = (activeStyle.size10 ?? 110) / 10;
    const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
    const next = d === 1 ? SIZES.find((x) => x > cur) ?? cur + 4 : d === -1 ? [...SIZES].reverse().find((x) => x < cur) ?? Math.max(1, cur - 1) : d;
    if (!next || next <= 0) return;
    applyStyle((st) => ({ ...st, size10: Math.round(next * 10) === 110 ? undefined : Math.round(next * 10) }));
  };

  const merge = (mode: "center" | "across" | "merge" | "unmerge") => {
    const r = effective(sel);
    setBook((b) =>
      withSheet(b, b.active, (sh) => {
        const others = sh.merges.filter((m) => m.r2 < r.r1 || m.r1 > r.r2 || m.c2 < r.c1 || m.c1 > r.c2);
        if (mode === "unmerge") return { ...sh, merges: others };
        const add: Rect[] = mode === "across" ? Array.from({ length: r.r2 - r.r1 + 1 }, (_, i) => ({ r1: r.r1 + i, r2: r.r1 + i, c1: r.c1, c2: r.c2 })) : [r];
        return { ...sh, merges: [...others, ...add.filter((m) => m.r2 > m.r1 || m.c2 > m.c1)] };
      }),
    );
    if (mode === "center") applyStyle((st) => ({ ...st, hAlign: "center" }));
  };

  const insertAxis = (what: "rows" | "cols" | "sheet") => {
    if (what === "sheet") {
      setBook((b) => {
        let n = b.sheets.length + 1;
        while (b.sheets.some((x) => x.name.toLowerCase() === `tabelle${n}`)) n++;
        return { ...b, sheets: [...b.sheets, newSheet(`Tabelle${n}`)], active: b.sheets.length };
      });
      setSelection(one(0, 0));
      return;
    }
    const r = sel;
    if (what === "rows") setBook((b) => shiftAxis(b, b.active, "row", r.r1, Math.min(1000, r.r2 - r.r1 + 1)));
    else setBook((b) => shiftAxis(b, b.active, "col", r.c1, Math.min(200, r.c2 - r.c1 + 1)));
  };

  const deleteAxis = (what: "rows" | "cols" | "sheet") => {
    if (what === "sheet") {
      if (book.sheets.length <= 1) return notify("Das letzte Blatt kann nicht gelöscht werden", undefined, "warning");
      setBook((b) => ({ ...b, sheets: b.sheets.filter((_, i) => i !== b.active), active: Math.max(0, b.active - 1) }));
      return;
    }
    const r = sel;
    if (what === "rows") setBook((b) => shiftAxis(b, b.active, "row", r.r1, -Math.min(MAX_ROWS, r.r2 - r.r1 + 1)));
    else setBook((b) => shiftAxis(b, b.active, "col", r.c1, -Math.min(MAX_COLS, r.c2 - r.c1 + 1)));
    setSelection(one(r.r1, r.c1));
  };

  const autoSum = (fn: string) => {
    const r = effective(sel);
    const isNum = (rr: number, cc: number) => typeof cellValue(rr, cc) === "number";
    if (r.r1 === r.r2 && r.c1 === r.c2) {
      // Numbers directly above, otherwise to the left.
      let top = r.r1 - 1;
      while (top >= 0 && isNum(top, r.c1)) top--;
      let range: string | null = top + 1 < r.r1 ? rangeName({ r1: top + 1, c1: r.c1, r2: r.r1 - 1, c2: r.c1 }) : null;
      if (!range) {
        let left = r.c1 - 1;
        while (left >= 0 && isNum(r.r1, left)) left--;
        if (left + 1 < r.c1) range = rangeName({ r1: r.r1, c1: left + 1, r2: r.r1, c2: r.c1 - 1 });
      }
      const text = `=${germanName(fn)}(${range ?? ""}${range ? ")" : ""}`;
      setEditing({ r: r.r1, c: r.c1, text, mode: "edit" });
      setCaret(range ? text.length : text.length);
      return;
    }
    // A sum below each selected column.
    const updates: { r: number; c: number; cell: SCell }[] = [];
    for (let c = r.c1; c <= r.c2; c++) updates.push({ r: r.r2 + 1, c, cell: { f: `${fn}(${rangeName({ r1: r.r1, c1: c, r2: r.r2, c2: c })})` } as SCell });
    setBook((b) => setCells(b, b.active, updates));
  };

  const fill = (dir: "down" | "right") => {
    const r = effective(sel);
    if (dir === "down" && r.r2 > r.r1) setBook((b) => fillSeries(b, b.active, { ...r, r2: r.r1 }, { ...r, r1: r.r1 + 1 }, values));
    if (dir === "right" && r.c2 > r.c1) setBook((b) => fillSeries(b, b.active, { ...r, c2: r.c1 }, { ...r, c1: r.c1 + 1 }, values));
  };

  const sort = (asc: boolean) => {
    let r = effective(sel);
    // A single cell sorts the surrounding data region.
    if (r.r1 === r.r2 && r.c1 === r.c2) {
      const used = usedRange(sheet);
      if (!used) return;
      r = used;
    }
    const first = sheet.cells.get(key(r.r1, active.c));
    const header = typeof first?.v === "string" && r.r2 > r.r1 && typeof cellValue(r.r1 + 1, active.c) !== "string";
    setBook((b) => sortRange(b, b.active, r, active.c, asc, values, header));
  };

  const dedupe = () => {
    const r = effective(sel.r1 === sel.r2 ? usedRange(sheet) ?? sel : sel);
    const seen = new Set<string>();
    const keep: number[] = [];
    for (let row = r.r1; row <= r.r2; row++) {
      const k = JSON.stringify(Array.from({ length: r.c2 - r.c1 + 1 }, (_, i) => cellValue(row, r.c1 + i)));
      if (!seen.has(k)) {
        seen.add(k);
        keep.push(row);
      }
    }
    const removed = r.r2 - r.r1 + 1 - keep.length;
    if (!removed) return notify("Keine Duplikate gefunden");
    const updates: { r: number; c: number; cell: SCell | null }[] = [];
    for (let i = 0; i <= r.r2 - r.r1; i++) {
      for (let c = r.c1; c <= r.c2; c++) {
        const src = keep[i];
        updates.push({ r: r.r1 + i, c, cell: src !== undefined ? sheet.cells.get(key(src, c)) ?? null : null });
      }
    }
    setBook((b) => setCells(b, b.active, updates));
    notify(`${removed} doppelte ${removed === 1 ? "Zeile" : "Zeilen"} entfernt`);
  };

  const freeze = (mode: "selection" | "row" | "col" | "none") =>
    setBook((b) =>
      withSheet(b, b.active, (sh) => ({
        ...sh,
        freezeRows: mode === "row" ? 1 : mode === "col" || mode === "none" ? 0 : active.r,
        freezeCols: mode === "col" ? 1 : mode === "row" || mode === "none" ? 0 : active.c,
      })),
    );

  const insertFunction = (en: string) => {
    const t = `=${germanName(en)}(`;
    if (editing?.text.startsWith("=")) {
      const text = editing.text.slice(0, caret) + `${germanName(en)}(` + editing.text.slice(caret);
      setEditing({ ...editing, text });
      setCaret(caret + germanName(en).length + 1);
    } else {
      setEditing({ r: active.r, c: active.c, text: t, mode: "edit" });
      setCaret(t.length);
    }
  };

  const insertNow = (time: boolean) => {
    const n = new Date();
    const base = Date.UTC(1899, 11, 30);
    const day = (Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - base) / 86400000;
    const v = time ? (n.getHours() * 3600 + n.getMinutes() * 60) / 86400 : day;
    setBook((b) => {
      const st = b.styles[sheet.cells.get(key(active.r, active.c))?.s ?? 0] ?? {};
      const [styles, idx] = internStyle(b.styles, { ...st, numFmt: time ? "hh:mm" : "dd.mm.yyyy" });
      return setCells({ ...b, styles }, b.active, [{ r: active.r, c: active.c, cell: { v, s: idx } }]);
    });
  };

  const autoFit = (axis: "row" | "col", index: number) => {
    if (axis === "row") {
      setBook((b) => withSheet(b, b.active, (sh) => {
        const rows = new Map(sh.rows);
        rows.delete(index);
        return { ...sh, rows };
      }));
      return;
    }
    const ctx = document.createElement("canvas").getContext("2d")!;
    let w = 20;
    for (const [k, c] of sheet.cells) {
      const p = unkey(k);
      if (p.c !== index) continue;
      const st = book.styles[c.s ?? 0] ?? {};
      ctx.font = `${st.italic ? "italic " : ""}${st.bold ? "700 " : ""}${((st.size10 ?? 110) / 10) * (4 / 3)}px ${st.font ?? "Calibri"}, Carlito, sans-serif`;
      const text = formatValue(cellValue(p.r, p.c), st.numFmt).text;
      w = Math.max(w, ctx.measureText(text).width + 10);
    }
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, cols: new Map([...sh.cols, [index, Math.ceil(Math.min(800, w))]]) })));
  };

  // ------------------------------------------------------------- clipboard --

  const tsvOf = (r: Rect) => {
    const lines: string[] = [];
    for (let row = r.r1; row <= r.r2; row++) {
      const cells: string[] = [];
      for (let c = r.c1; c <= r.c2; c++) {
        const cell = sheet.cells.get(key(row, c));
        const t = cell ? formatValue(cellValue(row, c), book.styles[cell.s ?? 0]?.numFmt).text : "";
        cells.push(/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(cells.join("\t"));
    }
    return lines.join("\r\n") + "\r\n";
  };

  const htmlOf = (r: Rect) => {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let h = "<table>";
    for (let row = r.r1; row <= r.r2; row++) {
      h += "<tr>";
      for (let c = r.c1; c <= r.c2; c++) {
        const cell = sheet.cells.get(key(row, c));
        const st = book.styles[cell?.s ?? 0] ?? {};
        const t = cell ? formatValue(cellValue(row, c), st.numFmt).text : "";
        const css = [st.bold && "font-weight:bold", st.italic && "font-style:italic", st.color && `color:${st.color}`, st.fill && `background:${st.fill}`].filter(Boolean).join(";");
        h += `<td${css ? ` style="${css}"` : ""}>${esc(t)}</td>`;
      }
      h += "</tr>";
    }
    return h + "</table>";
  };

  const copy = (e: React.ClipboardEvent | null, cut: boolean) => {
    const r = effective(sel);
    if ((r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > 2_000_000) return notify("Auswahl zu groß zum Kopieren", undefined, "warning");
    const tsv = tsvOf(r);
    if (e) {
      e.preventDefault();
      e.clipboardData.setData("text/plain", tsv);
      e.clipboardData.setData("text/html", htmlOf(r));
    } else void navigator.clipboard?.writeText(tsv).catch(() => {});
    setClip({ block: copyBlock(book, si, r), tsv, cut });
  };

  const pasteText = (text: string) => {
    if (clip && text.replace(/\r/g, "") === clip.tsv.replace(/\r/g, "")) {
      const block = clip.block;
      setBook((b) => {
        let x = pasteBlock(b, b.active, sel.r1, sel.c1, block);
        if (clip.cut && block.source.sheet === b.active) {
          const src = block.source.rect;
          // Clear the source except where the paste landed.
          const updates: { r: number; c: number; cell: null }[] = [];
          for (let r = src.r1; r <= src.r2; r++)
            for (let c = src.c1; c <= src.c2; c++) {
              const inDest = r >= sel.r1 && r < sel.r1 + block.rows && c >= sel.c1 && c < sel.c1 + block.cols;
              if (!inDest) updates.push({ r, c, cell: null });
            }
          x = setCells(x, x.active, updates);
        }
        return x;
      });
      setSelection({ anchor: { r: sel.r1, c: sel.c1 }, focus: { r: sel.r1 + block.rows - 1, c: sel.c1 + block.cols - 1 } });
      if (clip.cut) setClip(null);
      return;
    }
    // Plain text: tab separated rows (quotes for embedded tabs/newlines).
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = "";
    let q = false;
    const t = text.replace(/\r\n/g, "\n");
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) {
        if (ch === '"' && t[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"' && cur === "") q = true;
      else if (ch === "\t") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else cur += ch;
    }
    if (cur || row.length) {
      row.push(cur);
      rows.push(row);
    }
    if (!rows.length) return;
    const updates: { r: number; c: number; cell: SCell | null }[] = [];
    let b = book;
    rows.forEach((cells, i) =>
      cells.forEach((v, j) => {
        const r = sel.r1 + i;
        const c = sel.c1 + j;
        const old = sheet.cells.get(key(r, c));
        if (v.startsWith("=")) {
          updates.push({ r, c, cell: { f: fromDisplayFormula(v.slice(1)), s: old?.s } });
          return;
        }
        const p = parseInput(v);
        let s = old?.s;
        if (p.numFmt && !b.styles[s ?? 0]?.numFmt) {
          const [styles, idx] = internStyle(b.styles, { ...(b.styles[s ?? 0] ?? {}), numFmt: p.numFmt });
          b = { ...b, styles };
          s = idx;
        }
        updates.push({ r, c, cell: p.v === null && !s ? null : { v: p.v ?? undefined, s } });
      }),
    );
    setBook(setCells(b, si, updates));
    setSelection({ anchor: { r: sel.r1, c: sel.c1 }, focus: { r: sel.r1 + rows.length - 1, c: sel.c1 + Math.max(...rows.map((r) => r.length)) - 1 } });
  };

  const paste = (e: React.ClipboardEvent | null) => {
    if (e) {
      e.preventDefault();
      pasteText(e.clipboardData.getData("text/plain"));
    } else if (navigator.clipboard?.readText) {
      navigator.clipboard.readText().then(pasteText, () => clip && pasteText(clip.tsv));
    } else if (clip) pasteText(clip.tsv);
  };

  // ------------------------------------------------------------------ keys --

  const onKey = (e: React.KeyboardEvent): boolean => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (editing && point !== null || (editing && pointMode && k.startsWith("Arrow"))) {
      // Arrow keys move the picked reference while typing a formula.
      const base = point?.rect ?? { r1: active.r, c1: active.c, r2: active.r, c2: active.c };
      const dr = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
      const dc = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0;
      if (!dr && !dc) return false;
      const r = Math.max(0, (e.shiftKey ? base.r2 : base.r1) + dr);
      const c = Math.max(0, (e.shiftKey ? base.c2 : base.c1) + dc);
      onPoint(e.shiftKey ? { r1: base.r1, c1: base.c1, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }, !!point);
      return true;
    }
    if (editing) return false;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) {
      const [dr, dc] = arrows[k];
      if (ctrl) {
        const from = e.shiftKey ? selection.focus : selection.anchor;
        const to = dataEdge(from.r, from.c, dr, dc);
        setSelection(e.shiftKey ? { anchor: selection.anchor, focus: to } : one(to.r, to.c));
      } else moveActive(dr, dc, e.shiftKey);
      return true;
    }
    switch (k) {
      case "Enter":
        moveActive(e.shiftKey ? -1 : 1, 0, false, true);
        return true;
      case "Tab":
        moveActive(0, e.shiftKey ? -1 : 1, false, true);
        return true;
      case "Home":
        setSelection(ctrl ? one(0, 0) : one(active.r, 0));
        return true;
      case "End":
        if (ctrl) {
          const u = usedRange(sheet);
          setSelection(one(u?.r2 ?? 0, u?.c2 ?? 0));
          return true;
        }
        return false;
      case "PageDown":
      case "PageUp": {
        const d = k === "PageDown" ? 25 : -25;
        moveActive(d, 0, e.shiftKey);
        return true;
      }
      case "Delete":
        setBook((b) => clearRange(b, b.active, effective(sel), "contents"));
        return true;
      case "Backspace":
        startEdit("", "enter");
        return true;
      case "F2":
        startEdit(null, "edit");
        return true;
      case "F9":
        setRecalc((x) => x + 1);
        return true;
      case "Escape":
        setClip(null);
        return true;
    }
    if (ctrl) {
      const lk = k.toLowerCase();
      if (lk === "z") return undo(), true;
      if (lk === "y") return redo(), true;
      if (lk === "b") return toggle("bold"), true;
      if (lk === "i") return toggle("italic"), true;
      if (lk === "u") return toggle("underline"), true;
      if (lk === "a") return setSelection({ anchor: { r: 0, c: 0 }, focus: { r: MAX_ROWS - 1, c: MAX_COLS - 1 } }), true;
      if (lk === "d") return fill("down"), true;
      if (lk === "r") return fill("right"), true;
      if (k === ";" || k === ",") return insertNow(false), true;
      if (k === ":" || (e.shiftKey && k === ".")) return insertNow(true), true;
      if (k === " ") return setSelection({ anchor: { r: 0, c: sel.c1 }, focus: { r: MAX_ROWS - 1, c: sel.c2 } }), true;
      if (k === "+") return insertAxis(sel.c1 === 0 && sel.c2 >= MAX_COLS - 1 ? "rows" : "cols"), true;
      if (k === "-") return deleteAxis(sel.c1 === 0 && sel.c2 >= MAX_COLS - 1 ? "rows" : "cols"), true;
    }
    if (e.shiftKey && k === " ") {
      setSelection({ anchor: { r: sel.r1, c: 0 }, focus: { r: sel.r2, c: MAX_COLS - 1 } });
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------ files --

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const r = await officeInvoke<Loaded>("sheets_open", { path: p });
        const b = fromRust(r.workbook);
        setBookState(b);
        setSavedBook(b);
        setHistory({ past: [], future: [] });
        setSelection(one(0, 0));
        setPath(p);
        setWarnings(r.warnings);
        addRecent("sheets", p);
        if (r.warnings.length) notify("Nicht alles konnte übernommen werden", "Details unter Datei › Informationen.", "warning");
      } catch (e) {
        notify("Öffnen fehlgeschlagen", errorMessage(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    const f = initialFile();
    if (f) void load(f);
  }, [load]);

  const saveTo = useCallback(
    async (target: string) => {
      await officeInvoke("sheets_save", { path: target, workbook: toRust(book, values) });
      setPath(target);
      setSavedBook(book);
      addRecent("sheets", target);
      notify("Gespeichert", baseName(target), "success");
    },
    [book, values, notify],
  );

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (!isTauri) {
      notify("Speichern", "Im Browser-Vorschaumodus nicht verfügbar.");
      return false;
    }
    const target = await pickSavePath("sheets", withoutExt(name));
    if (!target) return false;
    try {
      await saveTo(target);
      return true;
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      return false;
    }
  }, [name, notify, saveTo]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!path) return saveAs();
    try {
      await saveTo(path);
      return true;
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      return false;
    }
  }, [path, saveAs, saveTo, notify]);

  const open = useCallback(
    async (target?: string) => {
      const p = target ?? (await pickOpenPath("sheets"));
      if (!p) return;
      setBackstage(null);
      if (!path && !dirtyRef.current) await load(p);
      else await openDocumentWindow("sheets", p);
    },
    [load, path],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(withoutExt(name)), save), [name, save, unsaved]);

  const print = () => {
    setBackstage(null);
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  };

  useEffect(() => {
    const onKeyWin = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
      } else if (k === "o") {
        e.preventDefault();
        void open();
      } else if (k === "n") {
        e.preventDefault();
        void openDocumentWindow("sheets");
      } else if (k === "p") {
        e.preventDefault();
        print();
      } else if (k === "f" || k === "h") {
        e.preventDefault();
        setFind({ query: "" });
      }
    };
    window.addEventListener("keydown", onKeyWin);
    return () => window.removeEventListener("keydown", onKeyWin);
  });

  const findNext = (query: string, dir: 1 | -1 = 1) => {
    if (!query) return;
    const q = query.toLowerCase();
    const hits: number[] = [];
    for (const [k, c] of sheet.cells) {
      const p = unkey(k);
      const text = formatValue(cellValue(p.r, p.c), book.styles[c.s ?? 0]?.numFmt).text.toLowerCase();
      if (text.includes(q) || (c.f && toDisplayFormula(c.f).toLowerCase().includes(q))) hits.push(k);
    }
    if (!hits.length) return notify(`„${query}“ wurde nicht gefunden`);
    hits.sort((a, b) => {
      const A = unkey(a);
      const B = unkey(b);
      return A.r - B.r || A.c - B.c;
    });
    const cur = key(active.r, active.c);
    const next = dir > 0 ? hits.find((h) => h > cur) ?? hits[0] : [...hits].reverse().find((h) => h < cur) ?? hits[hits.length - 1];
    const p = unkey(next);
    setSelection(one(p.r, p.c));
  };

  // ------------------------------------------------------------ status bar --

  const stats = useMemo(() => {
    const r = effective(sel);
    if (r.r1 === r.r2 && r.c1 === r.c2) return null;
    let n = 0;
    let count = 0;
    let sum = 0;
    for (const [k, c] of sheet.cells) {
      const p = unkey(k);
      if (p.r < r.r1 || p.r > r.r2 || p.c < r.c1 || p.c > r.c2) continue;
      const v = c.f ? values[si]?.get(k) : c.v;
      if (v === null || v === undefined || v === "") continue;
      count++;
      if (typeof v === "number") {
        n++;
        sum += v;
      }
    }
    if (!count) return null;
    return { count, n, sum, avg: n ? sum / n : 0 };
  }, [sel, sheet, values, si, effective]);

  const fmtNum = (v: number) => formatValue(Math.round(v * 1e10) / 1e10, null).text;

  // -------------------------------------------------------------- render --

  const fxText = editing ? editing.text : cellEditText(active.r, active.c);
  const nameText = nameBox ?? (sel.r1 === sel.r2 && sel.c1 === sel.c2 ? a1(active.r, active.c) : editing ? a1(active.r, active.c) : `${Math.min(sel.r2, MAX_ROWS - 1) - sel.r1 + 1}Z × ${Math.min(sel.c2, MAX_COLS - 1) - sel.c1 + 1}S`);

  const goTo = (text: string) => {
    const t = text.trim();
    const r = parseRange(t);
    if (r) {
      setSelection({ anchor: { r: r.r1, c: r.c1 }, focus: { r: r.r2, c: r.c2 } });
      grid.current?.focus();
    } else notify("Ungültiger Bezug", t, "warning");
    setNameBox(null);
  };

  const virtualTarget = (x: number, y: number) => ({ getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect });

  return (
    <div className={s.root}>
      <SuiteHeader appName="Tabellen" logo="/sheets.svg" center={`${withoutExt(name)}${dirty ? " •" : ""}${path ? "" : " – nicht gespeichert"}`} />
      <div style={{ padding: "0 0 8px" }}>
        <SheetsRibbon
          color={COLOR}
          tab={tab}
          onTab={setTab}
          style={activeStyle}
          merged={!!mergeAt(sheet, active.r, active.c)}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          showGrid={sheet.showGrid}
          freeze={{ rows: sheet.freezeRows, cols: sheet.freezeCols }}
          zoom={zoom}
          onFile={() => setBackstage("open")}
          onUndo={undo}
          onRedo={redo}
          onClipboard={(a) => (a === "paste" ? paste(null) : copy(null, a === "cut"))}
          onStyle={(patch) => applyStyle((st) => ({ ...st, ...patch }))}
          onToggle={toggle}
          onFontSize={fontSize}
          onBorder={setBorder}
          onMerge={merge}
          onIndent={(d) => applyStyle((st) => ({ ...st, indent: Math.max(0, (st.indent ?? 0) + d) || undefined, hAlign: st.hAlign ?? "left" }))}
          onNumFmt={(code) => applyStyle((st) => ({ ...st, numFmt: code ?? undefined }))}
          onDecimals={(d) => {
            const sample = cellValue(active.r, active.c);
            applyStyle((st) => ({ ...st, numFmt: changeDecimals(st.numFmt, d, typeof sample === "number" ? sample : 0) }));
          }}
          onInsert={insertAxis}
          onDelete={deleteAxis}
          onAutoSum={autoSum}
          onFill={fill}
          onClear={(what) => setBook((b) => clearRange(b, b.active, effective(sel), what))}
          onSort={sort}
          onFind={() => setFind({ query: "" })}
          onFunction={insertFunction}
          onRecalc={() => setRecalc((x) => x + 1)}
          onFreeze={freeze}
          onGrid={() => setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, showGrid: !sh.showGrid })))}
          onZoom={(z) => setZoom(Math.round(z * 100) / 100)}
          onDate={insertNow}
          onDedupe={dedupe}
        />
      </div>
      <div className={s.work}>
        <div className="nx-fbar">
          <Input
            className="nx-namebox"
            size="small"
            value={nameText}
            onFocus={(e) => (setNameBox(e.target.value), e.target.select())}
            onChange={(_, d) => setNameBox(d.value)}
            onBlur={() => setNameBox(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goTo((e.target as HTMLInputElement).value);
              if (e.key === "Escape") (setNameBox(null), grid.current?.focus());
            }}
          />
          <Tooltip content="Abbrechen" relationship="label">
            <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} disabled={!editing} onClick={cancel} />
          </Tooltip>
          <Tooltip content="Eingeben" relationship="label">
            <Button size="small" appearance="subtle" icon={<Checkmark16Regular />} disabled={!editing} onClick={() => commit(null)} />
          </Tooltip>
          <Text style={{ fontStyle: "italic", fontFamily: "Cambria, Georgia, serif", fontWeight: 600, padding: "0 4px", color: tokens.colorNeutralForeground3 }}>fx</Text>
          <textarea
            ref={fxInput}
            className="nx-fx-input"
            rows={1}
            spellCheck={false}
            value={fxText}
            onFocus={() => {
              if (!editing) {
                const t = cellEditText(active.r, active.c);
                setEditing({ r: active.r, c: active.c, text: t, mode: "edit" });
                setCaret(t.length);
              }
            }}
            onChange={(e) => {
              if (!editing) setEditing({ r: active.r, c: active.c, text: e.target.value, mode: "edit" });
              else editTextChange(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.altKey) {
                e.preventDefault();
                commit([1, 0]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Tab") {
                e.preventDefault();
                commit([0, 1]);
              }
            }}
          />
        </div>
        <div className={s.gridWrap}>
          <Grid
            ref={grid}
            book={book}
            values={values}
            sheet={si}
            selection={selection}
            onSelection={(x) => {
              setSelection(x);
              setNameBox(null);
            }}
            editing={editing && document.activeElement !== fxInput.current ? editing : editing}
            onEditText={editTextChange}
            onStartEdit={startEdit}
            onCommit={commit}
            onCancel={cancel}
            pointMode={pointMode}
            onPoint={onPoint}
            onResize={(axis, index, size) =>
              setBook((b) =>
                withSheet(b, b.active, (sh) => {
                  const r = axis === "col" ? sel : sel;
                  const many = axis === "col" ? r.r1 === 0 && r.r2 >= MAX_ROWS - 1 && index >= r.c1 && index <= r.c2 : r.c1 === 0 && r.c2 >= MAX_COLS - 1 && index >= r.r1 && index <= r.r2;
                  const idx = many ? Array.from({ length: (axis === "col" ? r.c2 - r.c1 : r.r2 - r.r1) + 1 }, (_, i) => (axis === "col" ? r.c1 : r.r1) + i) : [index];
                  const map = new Map(axis === "col" ? sh.cols : sh.rows);
                  for (const i of idx) map.set(i, size);
                  return axis === "col" ? { ...sh, cols: map } : { ...sh, rows: map };
                }),
              )
            }
            onAutoFit={autoFit}
            onFill={(src, dest) => setBook((b) => fillSeries(b, b.active, src, dest, values))}
            onKey={onKey}
            onCopy={(e) => copy(e, false)}
            onCut={(e) => copy(e, true)}
            onPaste={paste}
            onContextMenu={(x, y) => setMenu({ x, y })}
            zoom={zoom}
            copyRect={clip && clip.block.source.sheet === si ? clip.block.source.rect : null}
          />
          {loading && (
            <div className={s.loading}>
              <Spinner label="Arbeitsmappe wird geöffnet…" />
            </div>
          )}
        </div>
        <div className="nx-tabs" onDoubleClick={(e) => e.target === e.currentTarget && insertAxis("sheet")}>
          {book.sheets.map((sh, i) =>
            renaming?.index === i ? (
              <input
                key={i}
                className="nx-tab-input"
                autoFocus
                value={renaming.name}
                onChange={(e) => setRenaming({ index: i, name: e.target.value })}
                onBlur={() => {
                  const n = renaming.name.trim().replace(/[\\/?*[\]:]/g, "").slice(0, 31);
                  if (n && n !== sh.name && !book.sheets.some((x, j) => j !== i && x.name.toLowerCase() === n.toLowerCase())) setBook((b) => renameSheet(b, i, n));
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                key={i}
                className={`nx-tab ${i === si ? "nx-tab-active" : ""}`}
                onClick={() => {
                  if (editing && pointMode) return;
                  if (editing) commit(null);
                  setBookState((b) => ({ ...b, active: i }));
                  setSelection(one(0, 0));
                }}
                onDoubleClick={() => setRenaming({ index: i, name: sh.name })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, index: i });
                }}
              >
                {sh.name}
              </button>
            ),
          )}
          <Tooltip content="Neues Blatt" relationship="label">
            <Button size="small" appearance="subtle" icon={<Add16Regular />} onClick={() => insertAxis("sheet")} style={{ alignSelf: "center" }} />
          </Tooltip>
        </div>
        {find && (
          <div className={s.find}>
            <Input
              autoFocus
              size="small"
              placeholder="Suchen"
              value={find.query}
              onChange={(_, d) => setFind({ query: d.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") findNext(find.query, e.shiftKey ? -1 : 1);
                if (e.key === "Escape") (setFind(null), grid.current?.focus());
              }}
            />
            <Button size="small" appearance="subtle" icon={<ArrowUp16Regular />} onClick={() => findNext(find.query, -1)} />
            <Button size="small" appearance="subtle" icon={<ArrowDown16Regular />} onClick={() => findNext(find.query, 1)} />
            <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} onClick={() => (setFind(null), grid.current?.focus())} />
          </div>
        )}
      </div>
      <StatusBar>
        <span>{editing ? (pointMode ? "Zeigen" : editing.mode === "edit" ? "Bearbeiten" : "Eingeben") : "Bereit"}</span>
        {warnings.length > 0 && (
          <Button size="small" appearance="transparent" onClick={() => setBackstage("info")} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
            ⚠ Kompatibilitätshinweise
          </Button>
        )}
        <span className={s.zoom}>
          {stats && (
            <span style={{ marginRight: 16, display: "flex", gap: 16 }}>
              {stats.n > 0 && <span>Mittelwert: {fmtNum(stats.avg)}</span>}
              <span>Anzahl: {stats.count}</span>
              {stats.n > 0 && <span>Summe: {fmtNum(stats.sum)}</span>}
            </span>
          )}
          <Slider size="small" min={30} max={300} value={Math.round(zoom * 100)} onChange={(_, d) => setZoom(d.value / 100)} style={{ width: 120, minWidth: 0 }} />
          <Button size="small" appearance="transparent" style={{ minWidth: 44, padding: 0, fontSize: 12 }} onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)} %
          </Button>
        </span>
      </StatusBar>

      <Menu open={!!menu} onOpenChange={(_, d) => !d.open && setMenu(null)} positioning={{ target: menu ? virtualTarget(menu.x, menu.y) : undefined, position: "below", align: "start" }}>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => copy(null, true)}>Ausschneiden</MenuItem>
            <MenuItem onClick={() => copy(null, false)}>Kopieren</MenuItem>
            <MenuItem onClick={() => paste(null)}>Einfügen</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => insertAxis("rows")}>Zeilen einfügen</MenuItem>
            <MenuItem onClick={() => insertAxis("cols")}>Spalten einfügen</MenuItem>
            <MenuItem onClick={() => deleteAxis("rows")}>Zeilen löschen</MenuItem>
            <MenuItem onClick={() => deleteAxis("cols")}>Spalten löschen</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => setBook((b) => clearRange(b, b.active, effective(sel), "contents"))}>Inhalte löschen</MenuItem>
            <MenuItem onClick={() => sort(true)}>Sortieren A bis Z</MenuItem>
            <MenuItem onClick={() => sort(false)}>Sortieren Z bis A</MenuItem>
            <MenuDivider />
            <MenuItem
              onClick={() =>
                setBook((b) =>
                  withSheet(b, b.active, (sh) =>
                    sel.r1 === 0 && sel.r2 >= MAX_ROWS - 1
                      ? { ...sh, hiddenCols: new Set([...sh.hiddenCols, ...Array.from({ length: sel.c2 - sel.c1 + 1 }, (_, i) => sel.c1 + i)]) }
                      : { ...sh, hiddenRows: new Set([...sh.hiddenRows, ...Array.from({ length: Math.min(10000, sel.r2 - sel.r1 + 1) }, (_, i) => sel.r1 + i)]) },
                  ),
                )
              }
            >
              Ausblenden
            </MenuItem>
            <MenuItem
              onClick={() =>
                setBook((b) =>
                  withSheet(b, b.active, (sh) => ({
                    ...sh,
                    hiddenRows: new Set([...sh.hiddenRows].filter((r) => r < sel.r1 - 1 || r > sel.r2 + 1)),
                    hiddenCols: new Set([...sh.hiddenCols].filter((c) => c < sel.c1 - 1 || c > sel.c2 + 1)),
                  })),
                )
              }
            >
              Einblenden
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu open={!!tabMenu} onOpenChange={(_, d) => !d.open && setTabMenu(null)} positioning={{ target: tabMenu ? virtualTarget(tabMenu.x, tabMenu.y) : undefined, position: "above", align: "start" }}>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => tabMenu && setRenaming({ index: tabMenu.index, name: book.sheets[tabMenu.index].name })}>Umbenennen</MenuItem>
            <MenuItem
              onClick={() =>
                tabMenu &&
                setBook((b) => {
                  const src = b.sheets[tabMenu.index];
                  let n = 2;
                  while (b.sheets.some((x) => x.name.toLowerCase() === `${src.name} (${n})`.toLowerCase())) n++;
                  const copySheet = { ...src, name: `${src.name} (${n})` };
                  const sheets = [...b.sheets];
                  sheets.splice(tabMenu.index + 1, 0, copySheet);
                  return { ...b, sheets, active: tabMenu.index + 1 };
                })
              }
            >
              Duplizieren
            </MenuItem>
            <MenuItem
              disabled={!tabMenu || tabMenu.index === 0}
              onClick={() =>
                tabMenu &&
                setBook((b) => {
                  const sheets = [...b.sheets];
                  const [x] = sheets.splice(tabMenu.index, 1);
                  sheets.splice(tabMenu.index - 1, 0, x);
                  return { ...b, sheets, active: tabMenu.index - 1 };
                })
              }
            >
              Nach links verschieben
            </MenuItem>
            <MenuItem
              disabled={!tabMenu || tabMenu.index >= book.sheets.length - 1}
              onClick={() =>
                tabMenu &&
                setBook((b) => {
                  const sheets = [...b.sheets];
                  const [x] = sheets.splice(tabMenu.index, 1);
                  sheets.splice(tabMenu.index + 1, 0, x);
                  return { ...b, sheets, active: tabMenu.index + 1 };
                })
              }
            >
              Nach rechts verschieben
            </MenuItem>
            <MenuDivider />
            <MenuItem
              disabled={book.sheets.length <= 1}
              onClick={() => tabMenu && setBook((b) => ({ ...b, sheets: b.sheets.filter((_, i) => i !== tabMenu.index), active: Math.max(0, Math.min(b.active, b.sheets.length - 2)) }))}
            >
              Löschen
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      {backstage && (
        <Backstage
          app="sheets"
          color={COLOR}
          initialPage={backstage}
          onClose={() => setBackstage(null)}
          onNew={() => (setBackstage(null), void openDocumentWindow("sheets"))}
          onOpen={(p) => void open(p)}
          onSave={() => (setBackstage(null), void save())}
          onSaveAs={() => (setBackstage(null), void saveAs())}
          onPrint={print}
          info={
            <DocumentInfo
              path={path}
              title={book.title}
              author={book.author}
              onChange={(title, author) => setBook((b) => ({ ...b, title, author }))}
              warnings={warnings}
              stats={<Text>{book.sheets.length} {book.sheets.length === 1 ? "Blatt" : "Blätter"} · {book.sheets.reduce((n, x) => n + x.cells.size, 0).toLocaleString("de-DE")} Zellen</Text>}
            />
          }
        />
      )}
      {unsaved.dialog}
      {printing &&
        createPortal(
          <div className={`nx-print-root ${sheet.showGrid ? "grid" : ""}`}>
            {book.sheets.map((sh, i) => {
              const u = usedRange(sh);
              if (!u) return null;
              const vals = values[i];
              return (
                <div key={i}>
                  {book.sheets.length > 1 && <h2>{sh.name}</h2>}
                  <table>
                    <tbody>
                      {Array.from({ length: u.r2 + 1 }, (_, r) =>
                        sh.hiddenRows.has(r) ? null : (
                          <tr key={r}>
                            {Array.from({ length: u.c2 + 1 }, (_, c) => {
                              if (sh.hiddenCols.has(c)) return null;
                              const cell = sh.cells.get(key(r, c));
                              const st = book.styles[cell?.s ?? 0] ?? {};
                              const v = cell ? (cell.f ? vals?.get(key(r, c)) ?? null : cell.e ? { error: cell.e } : cell.v ?? null) : null;
                              const f = formatValue(v as Scalar, st.numFmt);
                              return (
                                <td
                                  key={c}
                                  style={{
                                    fontWeight: st.bold ? 700 : undefined,
                                    fontStyle: st.italic ? "italic" : undefined,
                                    color: f.color ?? st.color,
                                    background: st.fill,
                                    textAlign: (st.hAlign as React.CSSProperties["textAlign"]) ?? (f.numeric ? "right" : "left"),
                                    minWidth: (sh.cols.get(c) ?? 64) * 0.75 + "pt",
                                    borderTop: st.borderTop ? "1px solid #000" : undefined,
                                    borderBottom: st.borderBottom ? (st.borderBottom === "double" ? "3px double #000" : "1px solid #000") : undefined,
                                    whiteSpace: st.wrap ? "pre-wrap" : "nowrap",
                                  }}
                                >
                                  {f.text}
                                </td>
                              );
                            })}
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

