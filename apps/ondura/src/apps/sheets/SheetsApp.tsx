import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Slider, Spinner, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Add16Regular, ArrowDown16Regular, ArrowUp16Regular, Checkmark16Regular, Dismiss16Regular, RecordStop24Regular } from "@fluentui/react-icons";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { DocumentTitle, useCloudAutoSave } from "../../shell/cloud";
import { Backstage, DocumentInfo, StatusBar, useUnsavedPrompt } from "../../shell/office";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { api, errorMessage, isTauri } from "../../lib/api";
import { ERROR_TEXT } from "./formula";
import { addRecent, baseName, extOf, guardClose, initialFile, lossMessage, officeInvoke, openDocumentWindow, pickOpenPath, pickPdfPath, pickSavePath, printToPdf, setWindowTitle, withoutExt, openProtected } from "../../lib/office";
import { Grid, type Editing, type GridHandle, type Selection, selRect } from "./Grid";
import { AccessibilityPane, AltTextDialog } from "../../shell/a11y";
import { checkBook } from "./a11y";
import { MacroDialog, loadMacros, storeMacro } from "../../shell/macros";
import { SheetRecorder, formatDiff, runSheetMacro } from "./macros";
import { SHEET_MACRO_REFERENCE, SHEET_MACRO_TEMPLATE } from "./macroHelp";
import { SheetsRibbon, type BorderPreset } from "./SheetsRibbon";
import { type Scalar, colName, fromDisplayFormula, germanName, isError, parse, toDisplayFormula } from "./formula";
import { FormulaAssist, acceptSuggestion, assistCount, pickIndex } from "./assist";
import { TOTALS_FUNCTIONS, tableAt } from "./tables";
import { DataTableDialog, GoalSeekDialog, ResultDialog, ScenarioManager, type SolverForm, SolverDialog, parseCell, parseRefs, refText } from "./whatifDialogs";
import { type Constraint, goalSeek, solve } from "./whatif";
import { convertToRange, createTable, renameTable, resizeTable, setTableOption, setTotalsFunction, setTotalsRow, tableEdit } from "./tableOps";
import { changeDecimals, editText, formatValue, isDateFormat, parseInput } from "./format";
import {
  type Book,
  type CalcResult,
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
import { type CondFormat, type CondRule, type DefinedName, type Scenario, type SheetObject, evalContext, evaluatorWith, newObjectId, parsed, spillInfo } from "./model";
import { type PivotOptions, sheetFilters, applyFilter, buildPivot, chartFromRange, chartRange, condFormatting, currentRegion, displayText, filterValues, pivotItems, resolveChart, sparklineValues, validate, validationAt, validationList } from "./features";
import { CondDialog, type CondKind, FilterMenu, NameDialog, NameManager, PivotDialog, RulesDialog, SparklineDialog, TableDialog, ValidationDialog, validName } from "./dialogs";
import type { Validation } from "./model";
import type { CondAction } from "./SheetsRibbon";
import { type Chart, type ChartKind } from "../chart/ChartView";
import { TextDialog } from "../text/dialogs";
import { evaluate } from "./formula";
import { type Protection, parseA1 } from "./model";
import { PROTECTED_MESSAGE, checkPassword, formulaHidden, protectionFor, rangeLocked } from "./protect";
import { LinkDialog, type LinkForm, NoteDialog, ProtectDialog, UnprotectDialog, linkForm, linkTarget } from "./reviewDialogs";
import { DEFAULT_PAGE, type PageSetup, DEFAULT_COL, DEFAULT_ROW } from "./model";
import { pageCss, pageOf, paperMm, printPages } from "./pageLayout";
import { type PageTab, PageSetupDialog } from "./pageDialog";
import { type Arrow, ERROR_HELP, dependentArrows, evaluateStep, nextError, precedentArrows } from "./audit";
import { type SplitOptions, flashFill, splitText } from "./dataTools";
import { EvaluateDialog, TextToColumnsDialog } from "./toolDialogs";
import "./sheets.css";
import { RecoveryBar, useAutoRecover, type Snapshot } from "../../lib/recovery";
import { tl, tlc, LOCALE } from "../../lib/i18n";

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
  /** Password of a protected document (kept for saving). */
  const [password, setPassword] = useState<string | null>(null);
  const [savedBook, setSavedBook] = useState<Book>(book);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>(one(0, 0));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [caret, setCaret] = useState(0);
  const [assistIndex, setAssistIndex] = useState(0);
  const [assistOff, setAssistOff] = useState(false);
  const [fxFocused, setFxFocused] = useState(false);
  const [point, setPoint] = useState<null | { start: number; end: number; rect: Rect }>(null);
  const [tab, setTab] = useState("home");
  const [zoom, setZoom] = useState(1);
  const [backstage, setBackstage] = useState<null | "open" | "info">(null);
  const [loading, setLoading] = useState(false);
  const [clip, setClip] = useState<null | { block: ClipBlock; tsv: string; cut: boolean }>(null);
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);
  const [tabMenu, setTabMenu] = useState<null | { x: number; y: number; index: number }>(null);
  const [renaming, setRenaming] = useState<null | { index: number; name: string }>(null);
  const [notesShown, setNotesShown] = useState(false);
  const [pageDialog, setPageDialog] = useState<PageTab | null>(null);
  const [arrowState, setArrows] = useState<{ sheet: number; list: Arrow[] }>({ sheet: 0, list: [] });
  const [showFormulas, setShowFormulas] = useState(false);
  const [ttc, setTtc] = useState<null | { r1: number; r2: number; c: number }>(null);
  const [evalCell, setEvalCell] = useState<null | { r: number; c: number; f: string }>(null);
  const [noteDialog, setNoteDialog] = useState<null | { r: number; c: number }>(null);
  const [linkDialog, setLinkDialog] = useState<null | { r: number; c: number; form: LinkForm; editing: boolean }>(null);
  const [protectDialog, setProtectDialog] = useState<null | "protect" | "unprotect">(null);
  const [find, setFind] = useState<null | { query: string }>(null);
  const [recalc, setRecalc] = useState(0);
  const [printing, setPrinting] = useState(false);
  const grid = useRef<GridHandle>(null);
  const fxInput = useRef<HTMLTextAreaElement>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [filterPop, setFilterPop] = useState<null | { col: number; x: number; y: number; table?: string }>(null);
  const [condDialog, setCondDialog] = useState<CondKind | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [nameEdit, setNameEdit] = useState<null | { initial: DefinedName | null }>(null);
  const [chartText, setChartText] = useState<null | "title" | "data">(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [pivot, setPivot] = useState<null | { rect: Rect }>(null);
  const [sparkKind, setSparkKind] = useState<null | "line" | "column" | "stacked">(null);
  const [listPop, setListPop] = useState<null | { x: number; y: number; items: string[]; onPick?: (item: string) => void }>(null);
  const [macrosOpen, setMacrosOpen] = useState<null | { id: string | null }>(null);
  const recorder = useRef<{ name: string; rec: SheetRecorder } | null>(null);
  const [recording, setRecording] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [a11yTick, setA11yTick] = useState(0);
  const [altFor, setAltFor] = useState<null | { sheet: number; id: string; alt: string }>(null);
  const [whatIf, setWhatIf] = useState<null | "goal" | "table" | "scenario" | "solver">(null);
  const [whatIfResult, setWhatIfResult] = useState<null | { title: string; message: string; details?: string[]; restore: Book }>(null);
  const [tableDialog, setTableDialog] = useState<null | { mode: "create" | "resize"; style?: string; range: string }>(null);
  const [nameBox, setNameBox] = useState<string | null>(null);

  const si = book.active;
  const sheet = book.sheets[si];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const values = useMemo(() => calculate(book), [book, recalc]);
  const cond = useMemo(() => condFormatting(book, values, book.active), [book, values]);
  const sparks = useMemo(() => book.sheets[book.active].sparklines.map((sp) => ({ ...sp, values: sparklineValues(book, values, book.active, sp.source) })), [book, values]);
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
    void setWindowTitle(tl("{0}{1} – Ondura Tabellen", dirty ? "• " : "", withoutExt(name)));
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
    if (!cell || cell.f || (cell.v === undefined && !cell.e)) return values[si]?.get(key(r, c)) ?? null;
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
    if (blocked({ r1: active.r, c1: active.c, r2: active.r, c2: active.c })) return;
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
        notify(tl("Fehler in der Formel"), errorMessage(e), "error");
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
      const rule = validationAt(sheet, r, c);
      if (rule && rule.kind !== "none" && !validate(book, values, si, rule, (parsed.v ?? null) as Scalar, r, c)) {
        const msg = rule.error || tl("Der eingegebene Wert ist ungültig. Für diese Zelle sind Einschränkungen für die Dateneingabe festgelegt.");
        if (!rule.errorStyle || rule.errorStyle === "stop") {
          notify(rule.errorTitle || tl("Ungültiger Wert"), msg, "error");
          return;
        }
        notify(rule.errorTitle || (rule.errorStyle === "warning" ? tl("Warnung") : tl("Hinweis")), msg, "warning");
      }
      if (b !== book) {
        setBook(tableEdit(setCells(b, si, [{ r, c, cell: next }]), si, r, c));
        recorder.current?.rec.value(sheet.name, r, c, text);
        finishEdit(move);
        return;
      }
    }
    setBook((b) => tableEdit(setCells(b, si, [{ r, c, cell: next }]), si, r, c));
    recorder.current?.rec.value(sheet.name, r, c, text);
    finishEdit(move);
  };

  const finishEdit = (move: [number, number] | null) => {
    setEditing(null);
    setPoint(null);
    if (move) enterMove(move[0], move[1]);
    grid.current?.focus();
  };

  const cancel = () => {
    setEditing(null);
    setPoint(null);
    grid.current?.focus();
  };

  const editTextChange = (text: string, pos?: number) => {
    setEditing((e) => {
      if (e && e.text !== text) (setAssistIndex(0), setAssistOff(false));
      return e ? { ...e, text } : e;
    });
    if (pos !== undefined) setCaret(pos);
    // Typing anything after a picked reference ends the pick.
    if (point && pos !== undefined && pos !== point.end) setPoint(null);
  };

  // Formula AutoComplete: ↑/↓ choose, Tab inserts the function, Esc hides it.
  const assistOn = !!editing && editing.text.startsWith("=") && !assistOff;
  const acceptAssist = (en: string) => {
    if (!editing) return;
    const r = acceptSuggestion(editing.text, caret, en);
    setEditing({ ...editing, text: r.text });
    setCaret(r.caret);
    setAssistIndex(0);
  };
  const onAssistKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!assistOn || !editing) return false;
    const n = assistCount(editing.text, caret);
    if (!n) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAssistIndex((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      return true;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const en = pickIndex(editing.text, caret, assistIndex);
      if (en) acceptAssist(en);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setAssistOff(true);
      return true;
    }
    return false;
  };
  const assist = assistOn && editing ? <FormulaAssist text={editing.text} caret={caret} index={assistIndex} onPick={acceptAssist} /> : null;
  useEffect(() => {
    const el = fxInput.current;
    if (el && fxFocused && el.selectionStart === el.selectionEnd && el.selectionStart !== caret && editing) el.setSelectionRange(caret, caret);
  });

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

  // Excel: Enter after a run of Tabs goes to the next row below the cell
  // where the Tab run started.
  const tabStart = useRef<{ r: number; c: number } | null>(null);
  const enterMove = (dr: number, dc: number) => {
    const rect = selRect(selection);
    const single = rect.r1 === rect.r2 && rect.c1 === rect.c2;
    const at = selection.anchor;
    if (single && dc !== 0) {
      if (!tabStart.current || tabStart.current.r !== at.r) tabStart.current = { r: at.r, c: at.c };
    } else if (single && dr === 1 && tabStart.current && tabStart.current.r === at.r) {
      const c = tabStart.current.c;
      tabStart.current = null;
      setSelection(one(Math.min(MAX_ROWS - 1, at.r + 1), c));
      return;
    } else {
      tabStart.current = null;
    }
    moveActive(dr, dc, false, true);
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

  const applyStyle = (patch: (st: CellStyle) => CellStyle) => {
    if (blockedBy("formatCells")) return;
    if (recorder.current) {
      const before = book.styles[sheet.cells.get(key(sel.r1, sel.c1))?.s ?? 0] ?? {};
      recorder.current.rec.format(sheet.name, effective(sel), formatDiff(before, patch(before)));
    }
    setBook((b) => styleRange(b, b.active, effective(sel), patch));
  };

  const toggle = (k: "bold" | "italic" | "underline" | "strike" | "wrap") => {
    if (blockedBy("formatCells")) return;
    const on = !activeStyle[k];
    applyStyle((st) => ({ ...st, [k]: on || undefined }));
  };

  const setBorder = (b: BorderPreset) => {
    if (blockedBy("formatCells")) return;
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
    if (blockedBy("formatCells")) return;
    const cur = (activeStyle.size10 ?? 110) / 10;
    const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
    const next = d === 1 ? SIZES.find((x) => x > cur) ?? cur + 4 : d === -1 ? [...SIZES].reverse().find((x) => x < cur) ?? Math.max(1, cur - 1) : d;
    if (!next || next <= 0) return;
    applyStyle((st) => ({ ...st, size10: Math.round(next * 10) === 110 ? undefined : Math.round(next * 10) }));
  };

  const merge = (mode: "center" | "across" | "merge" | "unmerge") => {
    if (blocked()) return;
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
    if (what === "sheet" ? structureBlocked() : what === "rows" ? blockedBy("insertRows") : blocked()) return;
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
    if (what === "sheet" ? structureBlocked() : what === "rows" ? blockedBy("deleteRows") : blocked()) return;
    if (what === "sheet") {
      if (book.sheets.length <= 1) return notify(tl("Das letzte Blatt kann nicht gelöscht werden"), undefined, "warning");
      setBook((b) => ({ ...b, sheets: b.sheets.filter((_, i) => i !== b.active), active: Math.max(0, b.active - 1) }));
      return;
    }
    const r = sel;
    if (what === "rows") setBook((b) => shiftAxis(b, b.active, "row", r.r1, -Math.min(MAX_ROWS, r.r2 - r.r1 + 1)));
    else setBook((b) => shiftAxis(b, b.active, "col", r.c1, -Math.min(MAX_COLS, r.c2 - r.c1 + 1)));
    setSelection(one(r.r1, r.c1));
  };

  const autoSum = (fn: string) => {
    if (blocked(effective(sel))) return;
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
    if (blocked(effective(sel))) return;
    const r = effective(sel);
    if (dir === "down" && r.r2 > r.r1) setBook((b) => fillSeries(b, b.active, { ...r, r2: r.r1 }, { ...r, r1: r.r1 + 1 }, values));
    if (dir === "right" && r.c2 > r.c1) setBook((b) => fillSeries(b, b.active, { ...r, c2: r.c1 }, { ...r, c1: r.c1 + 1 }, values));
  };

  const sort = (asc: boolean) => {
    if (blockedBy("sort")) return;
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
    if (blocked()) return;
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
    if (!removed) return notify(tl("Keine Duplikate gefunden"));
    const updates: { r: number; c: number; cell: SCell | null }[] = [];
    for (let i = 0; i <= r.r2 - r.r1; i++) {
      for (let c = r.c1; c <= r.c2; c++) {
        const src = keep[i];
        updates.push({ r: r.r1 + i, c, cell: src !== undefined ? sheet.cells.get(key(src, c)) ?? null : null });
      }
    }
    setBook((b) => setCells(b, b.active, updates));
    notify(`${removed} doppelte ${removed === 1 ? tl("Zeile") : tl("Zeilen")} entfernt`);
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
      ctx.font = `${st.italic ? "italic " : ""}${st.bold ? "700 " : ""}${((st.size10 ?? 110) / 10) * (4 / 3)}px ${st.font ?? tl("Calibri")}, Carlito, sans-serif`;
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
    if (cut && blocked(effective(sel))) return e?.preventDefault();
    const r = effective(sel);
    if ((r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > 2_000_000) return notify(tl("Auswahl zu groß zum Kopieren"), undefined, "warning");
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
    if (blocked(effective(sel))) return e?.preventDefault();
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
    if (selectedObject && !editing) {
      if (k === "Delete" || k === "Backspace") {
        deleteObject();
        return true;
      }
      if (k === "Escape") {
        setSelectedObject(null);
        return true;
      }
      if (k.startsWith("Arrow") && selObject) {
        const step = e.shiftKey ? 10 : 1;
        patchObject(selObject.id, (o) => ({ ...o, anchor: { ...o.anchor, dx: o.anchor.dx + (k === "ArrowRight" ? step : k === "ArrowLeft" ? -step : 0), dy: o.anchor.dy + (k === "ArrowDown" ? step : k === "ArrowUp" ? -step : 0) } }));
        return true;
      }
    }
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
        enterMove(e.shiftKey ? -1 : 1, 0);
        return true;
      case "Tab":
        enterMove(0, e.shiftKey ? -1 : 1);
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
        !blocked(effective(sel)) && setBook((b) => clearRange(b, b.active, effective(sel), "contents"));
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
        const { loaded: r, password: pw } = await openProtected<Loaded>("sheets_open", p);
        setPassword(pw);
        const b = fromRust(r.workbook);
        setBookState(b);
        setSavedBook(b);
        setHistory({ past: [], future: [] });
        setSelection(one(0, 0));
        setPath(p);
        setWarnings(r.warnings);
        addRecent("sheets", p);
        if (r.warnings.length) notify(tl("Nicht alles konnte übernommen werden"), tl("Details unter Datei › Informationen."), "warning");
      } catch (e) {
        notify(tl("Öffnen fehlgeschlagen"), errorMessage(e), "error");
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
    async (target: string, quiet = false) => {
      const lost = await officeInvoke<string[]>("sheets_save", { path: target, password, workbook: toRust(book, values) });
      setPath(target);
      setSavedBook(book);
      addRecent("sheets", target);
      const warn = lossMessage(lost);
      if (warn) notify(tl("Gespeichert: {0}", baseName(target)), warn, "warning");
      else if (!quiet) notify(tl("Gespeichert"), baseName(target), "success");
    },
    [book, values, notify, password],
  );

  useAutoRecover("sheets", dirty, () => ({ name, path, data: toRust(book, values) }));
  const restore = (snap: Snapshot<Parameters<typeof fromRust>[0]>) => {
    const b = fromRust(snap.data);
    setBookState(b);
    setHistory({ past: [], future: [] });
    setSelection(one(0, 0));
    setPath(snap.path);
    notify(tl("Arbeitsmappe wiederhergestellt"), tl("Speichern Sie sie, um die Änderungen zu behalten."), "info");
  };

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (!isTauri) {
      notify(tl("Speichern"), tl("Im Browser-Vorschaumodus nicht verfügbar."));
      return false;
    }
    const target = await pickSavePath("sheets", withoutExt(name), path ? extOf(path) : undefined);
    if (!target) return false;
    try {
      await saveTo(target);
      return true;
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
      return false;
    }
  }, [name, notify, saveTo, path]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!path) return saveAs();
    try {
      await saveTo(path);
      return true;
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
      return false;
    }
  }, [path, saveAs, saveTo, notify]);
  // AutoSave for documents in OneDrive/SharePoint.
  const autoSave = useCloudAutoSave(
    path,
    dirty,
    useCallback(async () => {
      if (!path) return false;
      try {
        await saveTo(path, true);
        return true;
      } catch {
        return false;
      }
    }, [path, saveTo]),
  );

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

  /** Prints all sheets (A4, landscape for wide sheets) or exports them as PDF. */
  const print = (pdf?: string) => {
    setBackstage(null);
    // The active sheet with its page setup (Excel prints the active sheet).
    const pg = pageOf(sheet);
    const [pw, ph] = paperMm(pg);
    const style = document.createElement("style");
    style.textContent = pageCss(pg, { sheet: sheet.name, file: name, now: new Date() });
    document.head.appendChild(style);
    setPrinting(true);
    setTimeout(async () => {
      if (pdf) {
        try {
          await printToPdf(pdf, pw, ph, [pg.marginTop * 10, pg.marginRight * 10, pg.marginBottom * 10, pg.marginLeft * 10]);
          notify(tl("Als PDF exportiert"), baseName(pdf));
        } catch (e) {
          notify(tl("PDF-Export fehlgeschlagen"), errorMessage(e), "error");
        }
      } else window.print();
      style.remove();
      setPrinting(false);
    }, 150);
  };

  const exportPdf = async () => {
    const target = await pickPdfPath(withoutExt(name));
    if (target) print(target);
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
      } else if ((e.key === "#" || e.key === "`" || e.code === "Backslash" || e.code === "Backquote") && !editing) {
        e.preventDefault();
        setShowFormulas((x) => !x);
      } else if (k === "e" && !editing) {
        e.preventDefault();
        runFlashFill();
      } else if (k === "k" && !editing) {
        e.preventDefault();
        openLinkDialog();
      } else if ((k === "t" || k === "l") && !editing) {
        // Ctrl+T / Ctrl+L: create a table like Excel.
        e.preventDefault();
        openTableDialog();
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
    if (!hits.length) return notify(tl("„{0}“ wurde nicht gefunden", query));
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


  // ---------------------------------------------------- objects and charts --

  const selObject: SheetObject | undefined = sheet.objects.find((o) => o.id === selectedObject);
  useEffect(() => {
    if (selectedObject && !selObject) setSelectedObject(null);
  }, [selectedObject, selObject]);
  useEffect(() => {
    if (!selObject && tab === "object") setTab("home");
  }, [selObject, tab]);
  const hasTable = !!tableAt(sheet, active.r, active.c);
  useEffect(() => {
    if (!hasTable && tab === "table") setTab("home");
  }, [hasTable, tab]);

  const patchObject = (id: string, f: (o: SheetObject) => SheetObject) => !blocked() && setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, objects: sh.objects.map((o) => (o.id === id ? f(o) : o)) })));
  const deleteObject = () => {
    if (blocked()) return;
    if (!selectedObject) return;
    const id = selectedObject;
    setSelectedObject(null);
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, objects: sh.objects.filter((o) => o.id !== id) })));
    grid.current?.focus();
  };
  const patchChart = (patch: Partial<Chart>) => selObject?.chart && patchObject(selObject.id, (o) => ({ ...o, chart: { ...o.chart!, ...patch } }));

  /** Anchor next to a data range (or at the visible selection). */
  const placeBeside = (rect: Rect, w: number, h: number) => ({ col: Math.min(MAX_COLS - 10, rect.c2 + 2), row: rect.r1, dx: 0, dy: 0, w, h });

  const insertChart = (kind: ChartKind) => {
    const r0 = effective(sel);
    const auto = r0.r1 === r0.r2 && r0.c1 === r0.c2;
    const rect = auto ? currentRegion(sheet, r0.r1, r0.c1) : r0;
    if (auto) {
      // A detected region ends before a totals row ("Summe", "Gesamt", …),
      // which would otherwise be counted twice.
      for (let r = rect.r1 + 1; r <= rect.r2; r++) {
        const v = cellValue(r, rect.c1);
        if (typeof v === "string" && /^(summe|gesamt|total|ergebnis|insgesamt)\b/i.test(v.trim())) {
          rect.r2 = r - 1;
          break;
        }
      }
    }
    if (!sheet.cells.size || (rect.r1 === rect.r2 && rect.c1 === rect.c2 && !sheet.cells.get(key(rect.r1, rect.c1)))) return notify(tl("Diagramm einfügen"), tl("Markieren Sie zuerst die Daten für das Diagramm."), "warning");
    const chart = chartFromRange(book, values, si, rect, kind);
    const id = newObjectId();
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, objects: [...sh.objects, { id, type: "chart", anchor: placeBeside(rect, 480, 288), chart }] })));
    setSelectedObject(id);
    setTab("object");
  };

  const insertImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 480 / img.naturalWidth, 360 / img.naturalHeight);
          const id = newObjectId();
          const at = sel;
          setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, objects: [...sh.objects, { id, type: "image", name: file.name, src, anchor: { col: at.c1, row: at.r1, dx: 0, dy: 0, w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) } }] })));
          setSelectedObject(id);
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const swapChart = () => {
    const c = selObject?.chart;
    if (!c || c.kind === "scatter") return;
    const range = chartRange(c);
    const m = range.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
    const target = m ? book.sheets.findIndex((x) => x.name.toLowerCase() === (m[1]?.replace(/''/g, "'") ?? m[2]).toLowerCase()) : si;
    const rect = parseRange((m ? m[3] : range).replace(/\$/g, ""));
    if (!rect || target < 0) return;
    // A series spanning one column means the chart is currently by columns.
    const ref = c.series[0]?.valRef ?? "";
    const cols = ref.match(/\$([A-Z]+)\$\d+:\$([A-Z]+)\$\d+$/);
    const byColumn = !cols || cols[1] === cols[2];
    patchChart({ series: chartFromRange(book, values, target, rect, c.kind, !byColumn).series });
  };

  // ------------------------------------------------------------- filters --

  const toggleFilter = () => {
    if (sheet.autoFilter) {
      const range = sheet.autoFilter.range;
      setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, autoFilter: undefined, hiddenRows: new Set([...sh.hiddenRows].filter((r) => r <= range.r1 || r > range.r2)) })));
      return;
    }
    const r0 = effective(sel);
    const auto = r0.r1 === r0.r2 && r0.c1 === r0.c2;
    const rect = auto ? currentRegion(sheet, r0.r1, r0.c1) : r0;
    if (auto) {
      // A detected region ends before a totals row ("Summe", "Gesamt", …),
      // which would otherwise be counted twice.
      for (let r = rect.r1 + 1; r <= rect.r2; r++) {
        const v = cellValue(r, rect.c1);
        if (typeof v === "string" && /^(summe|gesamt|total|ergebnis|insgesamt)\b/i.test(v.trim())) {
          rect.r2 = r - 1;
          break;
        }
      }
    }
    if (rect.r1 === rect.r2 && !sheet.cells.get(key(rect.r1, rect.c1))) return notify(tl("Filtern"), tl("Markieren Sie eine Zelle im Datenbereich."), "warning");
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, autoFilter: { range: rect, columns: [] } })));
  };

  const setFilterColumn = (col: number, vals: string[] | null, table?: string) =>
    setBook((b) => {
      const next = withSheet(b, b.active, (sh) => {
        if (table) {
          return {
            ...sh,
            tables: sh.tables.map((t) => {
              if (t.name !== table) return t;
              const columns = (t.filterColumns ?? []).filter((x) => x.col !== col);
              if (vals) columns.push({ col, values: vals });
              return { ...t, filterColumns: columns };
            }),
          };
        }
        if (!sh.autoFilter) return sh;
        const columns = sh.autoFilter.columns.filter((x) => x.col !== col);
        if (vals) columns.push({ col, values: vals });
        return { ...sh, autoFilter: { ...sh.autoFilter, columns } };
      });
      return applyFilter(next, next.active, values);
    });

  const sortFilterColumn = (col: number, asc: boolean, table?: string) => {
    const af = sheetFilters(sheet).find((f) => f.table === table);
    if (!af) return;
    setBook((b) => applyFilter(sortRange(b, b.active, af.range, af.range.c1 + col, asc, values, true), b.active, values));
  };

  // ------------------------------------------------- conditional formats --

  const addRule = (rule: CondRule) => {
    const rect = effective(sel);
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, condFormats: [...sh.condFormats, { ranges: [rect], rules: [rule] }] })));
  };

  const condAction = (a: CondAction, colors?: string[]) => {
    const rect = effective(sel);
    if (a === "dataBar") return addRule({ kind: "dataBar", colors });
    if (a === "colorScale") return addRule({ kind: "colorScale", colors });
    if (a === "manage") return setRulesOpen(true);
    if (a === "clearSheet") return setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, condFormats: [] })));
    if (a === "clearSelection")
      return setBook((b) =>
        withSheet(b, b.active, (sh) => ({
          ...sh,
          condFormats: sh.condFormats.filter((cf) => !cf.ranges.some((r) => r.r1 <= rect.r2 && r.r2 >= rect.r1 && r.c1 <= rect.c2 && r.c2 >= rect.c1)),
        })),
      );
    setCondDialog(a);
  };

  const deleteRule = (cf: CondFormat, rule: CondRule) =>
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, condFormats: sh.condFormats.map((x) => (x === cf ? { ...x, rules: x.rules.filter((r) => r !== rule) } : x)).filter((x) => x.rules.length) })));

  // --------------------------------------------------------------- names --

  const quoteSheet = (n: string) => (/^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
  const selRef = () => {
    const r = effective(sel);
    const abs = (rr: number, cc: number) => a1(rr, cc).replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
    return `${quoteSheet(sheet.name)}!${abs(r.r1, r.c1)}${r.r1 === r.r2 && r.c1 === r.c2 ? "" : `:${abs(r.r2, r.c2)}`}`;
  };

  const nameValue = (n: DefinedName) => {
    const node = parsed(n.formula);
    if (node instanceof Error) return "#NAME?";
    const v = evaluate(node, evalContext(book, values, n.sheet ?? si, 0, 0));
    const first = Array.isArray(v) ? v[0]?.[0] ?? null : v;
    const text = formatValue(first, null).text;
    return Array.isArray(v) && (v.length > 1 || (v[0]?.length ?? 0) > 1) ? `{${text}; …}` : text;
  };

  const saveName = (n: DefinedName, prev: DefinedName | null) => setBook((b) => ({ ...b, names: prev ? b.names.map((x) => (x === prev ? n : x)) : [...b.names, n] }));


  // ------------------------------------------- validation, pivot, sparklines --

  const activeRule = validationAt(sheet, active.r, active.c);
  // ------------------------------------------------------------ tables --
  const activeTable = tableAt(sheet, active.r, active.c) ?? null;
  const inTotals = !!activeTable && activeTable.totalsRow && active.r === activeTable.range.r2;
  const openTableDialog = (style?: string) => {
    const r0 = effective(sel);
    const auto = r0.r1 === r0.r2 && r0.c1 === r0.c2;
    setTableDialog({ mode: "create", style, range: rangeName(auto ? currentRegion(sheet, r0.r1, r0.c1) : r0) });
  };
  const applyTableDialog = (text: string, header: boolean) => {
    const rect = parseRange(text.replace(/\$/g, "").replace(/^.*!/, ""));
    if (!rect || !tableDialog) return notify(tl("Ungültiger Bereich"), tl("Geben Sie einen Bereich wie A1:D20 an."), "error");
    if (tableDialog.mode === "resize") {
      if (!activeTable) return;
      const r = resizeTable(book, si, activeTable.name, rect);
      if (typeof r === "string") return notify(tl("Tabellengröße ändern"), r, "error");
      return setBook(r);
    }
    const r = createTable(book, si, rect, header, tableDialog.style ?? "TableStyleMedium2");
    if (typeof r === "string") return notify(tl("Tabelle erstellen"), r, "error");
    setBook(r.book);
    setSelection({ anchor: { r: r.table.range.r1 + 1, c: r.table.range.c1 }, focus: { r: r.table.range.r1 + 1, c: r.table.range.c1 } });
    setTab("table");
  };
  // ------------------------------------------------------------ what-if --
  const ref1 = (x: { sheet: number; r: number; c: number }) => refText(book, si, x);
  const runGoalSeek = (targetText: string, goal: number, changingText: string) => {
    const t = parseCell(targetText, book, si);
    const ch = parseCell(changingText, book, si);
    if (!t) return tl("Die Zielzelle muss ein Bezug auf eine einzelne Zelle sein.");
    if (!book.sheets[t.sheet].cells.get(key(t.r, t.c))?.f) return tl("Die Zielzelle muss eine Formel enthalten.");
    if (!ch) return tl("Die veränderbare Zelle muss ein Bezug auf eine einzelne Zelle sein.");
    const chCell = book.sheets[ch.sheet].cells.get(key(ch.r, ch.c));
    if (chCell?.f) return tl("Die veränderbare Zelle muss einen konstanten Wert enthalten.");
    const start = typeof chCell?.v === "number" ? chCell.v : 0;
    const r = goalSeek(book, t, goal, ch, start);
    const before = book;
    // Rounded to 12 significant digits (the search stops within its tolerance).
    const value = Number(r.value.toPrecision(12));
    setBook(setCells(book, ch.sheet, [{ r: ch.r, c: ch.c, cell: { ...(chCell ?? {}), v: value, f: undefined } }]));
    setWhatIf(null);
    setWhatIfResult({
      title: tl("Status der Zielwertsuche"),
      message: r.found ? tl("Zielwertsuche hat für die Zelle {0} eine Lösung gefunden.", ref1(t)) : tl("Zielwertsuche hat für die Zelle {0} keine Lösung gefunden.", ref1(t)),
      details: [tl("Zielwert: {0}", formatValue(goal, null).text), tl("Aktueller Wert: {0}", formatValue(Number(r.result.toPrecision(12)), null).text)],
      restore: before,
    });
    return null;
  };
  const applyDataTable = (rowText: string, colText: string) => {
    const r = effective(sel);
    if (r.r2 - r.r1 < 1 || r.c2 - r.c1 < 1) return tl("Markieren Sie zuerst den ganzen Datentabellenbereich (mindestens 2 × 2 Zellen).");
    const ri = rowText.trim() ? parseCell(rowText, book, si) : null;
    const ci = colText.trim() ? parseCell(colText, book, si) : null;
    if ((rowText.trim() && !ri) || (colText.trim() && !ci) || (!ri && !ci)) return tl("Geben Sie eine gültige Eingabezelle an.");
    if ((ri && ri.sheet !== si) || (ci && ci.sheet !== si)) return tl("Die Eingabezelle muss auf dem aktiven Blatt liegen.");
    const abs = (rr: number, cc: number) => `$${colName(cc)}$${rr + 1}`;
    const updates: { r: number; c: number; cell: SCell }[] = [];
    for (let rr = r.r1 + 1; rr <= r.r2; rr++)
      for (let cc = r.c1 + 1; cc <= r.c2; cc++) {
        let f: string;
        if (ri && ci) f = `MULTIPLE.OPERATIONS(${abs(r.r1, r.c1)},${abs(ri.r, ri.c)},${abs(r.r1, cc)},${abs(ci.r, ci.c)},${abs(rr, r.c1)})`;
        else if (ci) f = `MULTIPLE.OPERATIONS(${abs(r.r1, cc)},${abs(ci.r, ci.c)},${abs(rr, r.c1)})`;
        else f = `MULTIPLE.OPERATIONS(${abs(rr, r.c1)},${abs(ri!.r, ri!.c)},${abs(r.r1, cc)})`;
        updates.push({ r: rr, c: cc, cell: { ...(sheet.cells.get(key(rr, cc)) ?? {}), f, v: undefined } });
      }
    setBook((b) => setCells(b, si, updates));
    setWhatIf(null);
    return null;
  };
  const scenarioCells = (sc: Scenario) => sc.cells.map((c) => a1(c.r, c.c)).join(";");
  const saveScenario = (name: string, cellsText: string, vals: string[], comment: string, prev: Scenario | null) => {
    if (!name) return tl("Geben Sie einen Namen ein.");
    if (sheet.scenarios.some((x) => x !== prev && x.name.toLowerCase() === name.toLowerCase())) return tl("Ein Szenario mit diesem Namen ist bereits vorhanden.");
    const cells = parseRefs(cellsText, book, si);
    if (!cells || cells.some((c) => c.sheet !== si)) return tl("Die veränderbaren Zellen müssen Bezüge auf dem aktiven Blatt sein.");
    if (cells.length > 32) return tl("Ein Szenario kann höchstens 32 veränderbare Zellen haben.");
    if (cells.some((c) => sheet.cells.get(key(c.r, c.c))?.f)) return tl("Veränderbare Zellen dürfen keine Formeln enthalten.");
    const sc: Scenario = { name, comment: comment.trim() || undefined, cells: cells.map((c, i) => ({ r: c.r, c: c.c, v: vals[i] ?? editText(cellValue(c.r, c.c), null) })) };
    setBook((b) => withSheet(b, si, (sh) => ({ ...sh, scenarios: prev ? sh.scenarios.map((x) => (x === prev ? sc : x)) : [...sh.scenarios, sc] })));
    return null;
  };
  const showScenario = (sc: Scenario) =>
    setBook((b) =>
      setCells(
        b,
        si,
        sc.cells.map((c) => {
          const p = parseInput(c.v);
          return { r: c.r, c: c.c, cell: { ...(b.sheets[si].cells.get(key(c.r, c.c)) ?? {}), v: p.v ?? undefined, f: undefined } };
        }),
      ),
    );
  const scenarioSummary = (resultText: string) => {
    const results = resultText.trim() ? parseRefs(resultText, book, si) : [];
    if (!results) return tl("Ungültiger Bezug für die Ergebniszellen.");
    const all = sheet.scenarios;
    const changing = [...new Map(all.flatMap((sc) => sc.cells.map((c) => [key(c.r, c.c), c] as const))).values()];
    let title = tl("Szenariobericht");
    for (let i = 2; book.sheets.some((x) => x.name.toLowerCase() === title.toLowerCase()); i++) title = tl("Szenariobericht {0}", i);
    const out = newSheet(title);
    const put = (r: number, c: number, v: Scalar) => v !== null && !isError(v) && out.cells.set(key(r, c), { v: v as number | string | boolean });
    put(0, 0, tl("Szenariobericht"));
    put(2, 1, tl("Aktuelle Werte:"));
    all.forEach((sc, i) => put(2, 2 + i, sc.name));
    put(3, 0, tl("Veränderbare Zellen:"));
    changing.forEach((c, j) => {
      const cur = cellValue(c.r, c.c);
      out.cells.set(key(4 + j, 0), { v: `$${colName(c.c)}$${c.r + 1}` });
      put(4 + j, 1, cur);
      all.forEach((sc, i) => {
        const hit = sc.cells.find((x) => x.r === c.r && x.c === c.c);
        put(4 + j, 2 + i, hit ? parseInput(hit.v).v ?? hit.v : cur);
      });
    });
    const base = 5 + changing.length;
    if (results.length) {
      put(base, 0, tl("Ergebniszellen:"));
      results.forEach((rc, j) => {
        out.cells.set(key(base + 1 + j, 0), { v: refText(book, si, rc) });
        put(base + 1 + j, 1, rc.sheet === si ? cellValue(rc.r, rc.c) : values[rc.sheet]?.get(key(rc.r, rc.c)) ?? null);
        all.forEach((sc, i) => {
          const ov = new Map(sc.cells.map((x) => [`${si}:${key(x.r, x.c)}`, (parseInput(x.v).v ?? x.v) as Scalar]));
          put(base + 1 + j, 2 + i, evaluatorWith(book, ov)(rc.sheet, rc.r, rc.c));
        });
      });
    }
    setBook((b) => ({ ...b, sheets: [...b.sheets, { ...out, cols: new Map([[0, 160], [1, 110]]) }], active: b.sheets.length }));
    setWhatIf(null);
    return null;
  };
  // Solver model: kept in hidden sheet names like Excel (solver_opt, …).
  const solverForm = (): SolverForm => {
    const nm = (n: string) => book.names.find((x) => x.name.toLowerCase() === n && x.sheet === si)?.formula;
    const refOut = (f?: string) => (f ? f.replace(new RegExp(`^'?${sheet.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'?!`), "") : "");
    const num = Number(nm("solver_num") ?? 0);
    const rel: Record<string, SolverForm["constraints"][number]["op"]> = { "1": "<=", "2": "=", "3": ">=", "4": "int", "5": "bin" };
    return {
      target: refOut(nm("solver_opt")) || a1(active.r, active.c).replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2"),
      goal: nm("solver_typ") === "2" ? "min" : nm("solver_typ") === "3" ? "value" : "max",
      value: nm("solver_val") ?? "0",
      vars: refOut(nm("solver_adj")),
      constraints: Array.from({ length: num }, (_, i) => ({ cell: refOut(nm(`solver_lhs${i + 1}`)), op: rel[nm(`solver_rel${i + 1}`) ?? "1"] ?? "<=", rhs: refOut(nm(`solver_rhs${i + 1}`)) })).filter((c) => c.cell),
      nonNegative: nm("solver_neg") !== "2",
      method: nm("solver_eng") === "2" ? "simplex" : nm("solver_eng") === "1" ? "nonlinear" : "auto",
    };
  };
  const saveSolverForm = (f: SolverForm) => {
    const q = /^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(sheet.name) ? sheet.name : `'${sheet.name.replace(/'/g, "''")}'`;
    const refIn = (t: string) => t.trim().split(";").map((x) => (x.includes("!") || !/[A-Za-z]/.test(x) ? x.trim() : `${q}!${x.trim()}`)).join(",");
    const rel: Record<string, string> = { "<=": "1", "=": "2", ">=": "3", int: "4", bin: "5" };
    const names: DefinedName[] = [
      { name: "solver_opt", formula: refIn(f.target) },
      { name: "solver_typ", formula: f.goal === "max" ? "1" : f.goal === "min" ? "2" : "3" },
      { name: "solver_val", formula: String(Number(f.value.replace(",", ".")) || 0) },
      { name: "solver_adj", formula: refIn(f.vars) },
      { name: "solver_num", formula: String(f.constraints.length) },
      { name: "solver_neg", formula: f.nonNegative ? "1" : "2" },
      { name: "solver_eng", formula: f.method === "simplex" ? "2" : "1" },
      { name: "solver_ver", formula: "3" },
      ...f.constraints.flatMap((c, i) => [
        { name: `solver_lhs${i + 1}`, formula: refIn(c.cell) },
        { name: `solver_rel${i + 1}`, formula: rel[c.op] },
        { name: `solver_rhs${i + 1}`, formula: c.op === "int" ? "integer" : c.op === "bin" ? "binary" : /[A-Za-z]/.test(c.rhs) ? refIn(c.rhs) : String(Number(c.rhs.replace(",", ".")) || 0) },
      ]),
    ].map((n) => ({ ...n, sheet: si, hidden: true }));
    setBook((b) => ({ ...b, names: [...b.names.filter((n) => !(n.sheet === si && n.name.startsWith("solver_"))), ...names] }));
  };
  const runSolver = (f: SolverForm) => {
    saveSolverForm(f);
    const target = parseCell(f.target, book, si);
    const vars = parseRefs(f.vars, book, si);
    if (!target) return tl("„Ziel festlegen“ muss ein Bezug auf eine einzelne Zelle sein.");
    if (!vars) return tl("Geben Sie die Variablenzellen an (z. B. B2:B5).");
    if (vars.some((v) => book.sheets[v.sheet].cells.get(key(v.r, v.c))?.f)) return tl("Variablenzellen dürfen keine Formeln enthalten.");
    const constraints: Constraint[] = [];
    for (const c of f.constraints) {
      const cells = parseRefs(c.cell, book, si);
      if (!cells) return tl("Ungültiger Bezug in der Nebenbedingung „{0}“.", c.cell);
      const rhsRef = /[A-Za-z]/.test(c.rhs) ? parseCell(c.rhs, book, si) : null;
      const rhs = rhsRef ?? Number(c.rhs.replace(",", "."));
      if (c.op !== "int" && c.op !== "bin" && rhsRef === null && !Number.isFinite(rhs as number)) return tl("Ungültige Nebenbedingung „{0}“.", c.rhs);
      for (const cell of cells) constraints.push({ cell, op: c.op, rhs: c.op === "int" || c.op === "bin" ? undefined : rhs });
    }
    const start = vars.map((v) => {
      const x = values[v.sheet]?.get(key(v.r, v.c)) ?? book.sheets[v.sheet].cells.get(key(v.r, v.c))?.v;
      return typeof x === "number" ? x : 0;
    });
    const r = solve(book, { target, goal: f.goal, value: Number(f.value.replace(",", ".")) || 0, vars, constraints, nonNegative: f.nonNegative, method: f.method }, start);
    const before = book;
    let nb = book;
    vars.forEach((v, i) => {
      const x = Number(r.x[i].toPrecision(12));
      nb = setCells(nb, v.sheet, [{ r: v.r, c: v.c, cell: { ...(nb.sheets[v.sheet].cells.get(key(v.r, v.c)) ?? {}), v: x, f: undefined } }]);
    });
    setBook(nb);
    setWhatIf(null);
    setWhatIfResult({ title: tl("Solver-Ergebnisse"), message: r.message, details: [tl("Zielwert: {0}", formatValue(Number(r.objective.toPrecision(12)), null).text), r.linear ? tl("Lösungsmethode: Simplex-LP") : tl("Lösungsmethode: GRG-Nichtlinear (Nelder-Mead)")], restore: before });
    return null;
  };

  const tableOption = (patch: Parameters<typeof setTableOption>[3]) => {
    if (!activeTable) return;
    setBook((b) => {
      let nb = setTableOption(b, si, activeTable.name, patch);
      // Without filter buttons the filtered rows are shown again.
      if (patch.filter === false) nb = withSheet(nb, si, (sh) => ({ ...sh, hiddenRows: new Set([...sh.hiddenRows].filter((r) => r < activeTable.range.r1 || r > activeTable.range.r2)) }));
      return nb;
    });
  };
  const selValidation = sheet.validations.find((v) => v.ranges.some((x) => x.r1 <= sel.r2 && x.r2 >= sel.r1 && x.c1 <= sel.c2 && x.c2 >= sel.c1)) ?? null;

  const applyValidation = (v: Validation | null) => {
    const rect = effective(sel);
    setBook((b) =>
      withSheet(b, b.active, (sh) => {
        // The selection replaces the rules it overlaps.
        const rest = sh.validations
          .map((x) => ({ ...x, ranges: x.ranges.filter((r) => r.r2 < rect.r1 || r.r1 > rect.r2 || r.c2 < rect.c1 || r.c1 > rect.c2) }))
          .filter((x) => x.ranges.length);
        return { ...sh, validations: v ? [...rest, { ...v, ranges: [rect] }] : rest };
      }),
    );
  };

  const openPivot = () => {
    const r0 = effective(sel);
    const auto = r0.r1 === r0.r2 && r0.c1 === r0.c2;
    const rect = auto ? currentRegion(sheet, r0.r1, r0.c1) : r0;
    if (auto) {
      // A detected region ends before a totals row ("Summe", "Gesamt", …),
      // which would otherwise be counted twice.
      for (let r = rect.r1 + 1; r <= rect.r2; r++) {
        const v = cellValue(r, rect.c1);
        if (typeof v === "string" && /^(summe|gesamt|total|ergebnis|insgesamt)\b/i.test(v.trim())) {
          rect.r2 = r - 1;
          break;
        }
      }
    }
    if (rect.r2 <= rect.r1) return notify(tl("PivotTable"), tl("Markieren Sie einen Datenbereich mit Überschriften."), "warning");
    setPivot({ rect });
  };

  const createPivot = (rowCol: number, colCol: number | null, valCol: number, agg: Parameters<typeof buildPivot>[7], opts: PivotOptions) => {
    if (!pivot) return;
    const { rect } = pivot;
    const { sheet: out, styles } = buildPivot(book, values, si, rect, rect.c1 + rowCol, colCol === null ? null : rect.c1 + colCol, rect.c1 + valCol, agg, { ...opts, filterCol: opts.filterCol === undefined ? undefined : rect.c1 + opts.filterCol });
    let n = 1;
    while (book.sheets.some((x) => x.name.toLowerCase() === `pivottable${n}`)) n++;
    out.name = `PivotTable${n}`;
    setBook((b) => ({ ...b, styles, sheets: [...b.sheets, out], active: b.sheets.length }));
    setSelection(one(0, 0));
  };

  const sparkDefaults = () => {
    const r = effective(sel);
    const quote = (n: string) => (/^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    return { data: single ? "" : `${quote(sheet.name)}!${rangeName(r)}`, location: single ? a1(r.r1, r.c1) : rangeName({ r1: r.r1, c1: r.c2 + 1, r2: r.r2, c2: r.c2 + 1 }) };
  };

  const createSparklines = (data: string, location: string) => {
    const m = data.trim().replace(/^=/, "").match(/^(?:(.+)!)?(.+)$/);
    const src = m ? parseRange(m[2].replace(/\$/g, "")) : null;
    const loc = parseRange(location.trim().replace(/\$/g, ""));
    if (!src || !loc || !sparkKind) return notify(tl("Sparklines"), tl("Bitte gültige Bereiche angeben."), "warning");
    const prefix = m?.[1] ? `${m[1]}!` : `${sheet.name.match(/^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/) ? sheet.name : `'${sheet.name.replace(/'/g, "''")}'`}!`;
    const rows = src.r2 - src.r1 + 1;
    const cells: { r: number; c: number }[] = [];
    for (let r = loc.r1; r <= loc.r2; r++) for (let c = loc.c1; c <= loc.c2; c++) cells.push({ r, c });
    const byRow = cells.length === rows || src.r1 === src.r2;
    const added = cells.map((cell, i) => {
      const range = byRow ? { r1: src.r1 + Math.min(i, rows - 1), c1: src.c1, r2: src.r1 + Math.min(i, rows - 1), c2: src.c2 } : { r1: src.r1, c1: src.c1 + i, r2: src.r2, c2: src.c1 + i };
      return { ...cell, source: `${prefix}${rangeName(range)}`, kind: sparkKind, color: "#376092", negativeColor: "#d00000", markers: sparkKind === "line" };
    });
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, sparklines: [...sh.sparklines.filter((x) => !added.some((a) => a.r === x.r && a.c === x.c)), ...added] })));
  };

  const pickFromList = (text: string) => {
    setListPop(null);
    if (listPop?.onPick) return listPop.onPick(text);
    setBook((b) => {
      const cell = b.sheets[b.active].cells.get(key(active.r, active.c));
      const parsedInput = parseInput(text);
      return setCells(b, b.active, [{ r: active.r, c: active.c, cell: { ...(cell ?? {}), f: undefined, v: parsedInput.v ?? text } }]);
    });
    grid.current?.focus();
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

  // A spilled cell shows the formula of its dynamic array (greyed, like Excel).
  const spillAnchor = !editing && !sheet.cells.get(key(active.r, active.c)) ? spillInfo(values)?.owner[si]?.get(key(active.r, active.c)) : undefined;
  const fxText = editing ? editing.text : formulaHidden(book, sheet, active.r, active.c) ? "" : spillAnchor !== undefined ? cellEditText(unkey(spillAnchor).r, unkey(spillAnchor).c) : cellEditText(active.r, active.c);
  const nameText = nameBox ?? (sel.r1 === sel.r2 && sel.c1 === sel.c2 ? a1(active.r, active.c) : editing ? a1(active.r, active.c) : `${Math.min(sel.r2, MAX_ROWS - 1) - sel.r1 + 1}Z × ${Math.min(sel.c2, MAX_COLS - 1) - sel.c1 + 1}S`);

  const a11yIssues = useMemo(
    () =>
      a11yOpen
        ? checkBook(book, {
            select: (sheetIndex, r) => {
              if (sheetIndex !== book.active) setBook((b) => ({ ...b, active: sheetIndex }));
              setSelection({ anchor: { r: r.r1, c: r.c1 }, focus: { r: r.r2, c: r.c2 } });
            },
            selectObject: (sheetIndex, id) => {
              if (sheetIndex !== book.active) setBook((b) => ({ ...b, active: sheetIndex }));
              setSelectedObject(id);
            },
            editAlt: (sheetIndex, id, alt) => setAltFor({ sheet: sheetIndex, id, alt }),
            rename: (index) => setRenaming({ index, name: book.sheets[index].name }),
            headerRow: (sheetIndex, name) => setBook((b) => withSheet(b, sheetIndex, (sh) => ({ ...sh, tables: sh.tables.map((t) => (t.name === name ? { ...t, headerRow: true } : t)) }))),
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a11yOpen, book, a11yTick],
  );

  const startRecording = (name: string) => {
    recorder.current = { name, rec: new SheetRecorder() };
    setRecording(true);
    setMacrosOpen(null);
    notify(tl("Makro wird aufgezeichnet"), tl("Eingaben und Formatierungen werden als Skript aufgezeichnet."));
  };
  const stopRecording = () => {
    const r = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!r) return;
    const m = storeMacro("sheets", r.name, r.rec.script());
    setMacrosOpen({ id: m.id });
  };
  const runMacro = (code: string) => {
    if (blocked()) return { log: [], error: tl("Das Blatt ist geschützt.") };
    const res = runSheetMacro(code, book, sel);
    if (!res.error) {
      setBook(res.book);
      if (res.select) {
        const t = res.select;
        if (t.sheet !== res.book.active) setBook((b) => ({ ...b, active: t.sheet }));
        setSelection({ anchor: { r: t.rect.r1, c: t.rect.c1 }, focus: { r: t.rect.r2, c: t.rect.c2 } });
      }
    }
    return res;
  };

  const goTo = (text: string) => {
    const t = text.trim();
    const named = book.names.find((n) => n.name.toLowerCase() === t.toLowerCase() && (n.sheet === undefined || n.sheet === si));
    if (named) {
      const m = named.formula.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
      const target = m ? book.sheets.findIndex((x) => x.name.toLowerCase() === (m[1]?.replace(/''/g, "'") ?? m[2]).toLowerCase()) : si;
      const rr = parseRange((m ? m[3] : named.formula).replace(/\$/g, ""));
      if (rr && target >= 0) {
        if (target !== si) setBook((b) => ({ ...b, active: target }));
        setSelection({ anchor: { r: rr.r1, c: rr.c1 }, focus: { r: rr.r2, c: rr.c2 } });
        setNameBox(null);
        grid.current?.focus();
        return;
      }
    }
    if (!parseRange(t) && validName(t)) {
      // Typing a new name defines it for the selection, like in Excel.
      saveName({ name: t, formula: selRef() }, null);
      notify(tl("Name „{0}“ definiert", t));
      setNameBox(null);
      grid.current?.focus();
      return;
    }
    const r = parseRange(t);
    if (r) {
      setSelection({ anchor: { r: r.r1, c: r.c1 }, focus: { r: r.r2, c: r.c2 } });
      grid.current?.focus();
    } else notify(tl("Ungültiger Bezug"), t, "warning");
    setNameBox(null);
  };

  // ------------------------------------------------------ review / protection --

  /** On a protected sheet: is `rect` (default: any change) blocked? Tells the user. */
  function blocked(rect?: Rect): boolean {
    if (!sheet.protection || (rect && !rangeLocked(book, sheet, rect))) return false;
    notify(tl("Geschütztes Blatt"), PROTECTED_MESSAGE, "warning");
    return true;
  }
  /** Blocked unless the protection allows `what`. */
  function blockedBy(what: keyof Protection): boolean {
    return !!sheet.protection && !sheet.protection[what] && blocked();
  }
  function structureBlocked(): boolean {
    if (!book.protectStructure) return false;
    notify(tl("Arbeitsmappe geschützt"), tl("Die Struktur der Arbeitsmappe ist geschützt. Blätter können nicht eingefügt, gelöscht, verschoben oder umbenannt werden."), "warning");
    return true;
  }

  const noteAt = (r: number, c: number) => sheet.notes.find((n) => n.r === r && n.c === c);
  const patchNotes = (f: (notes: Book["sheets"][number]["notes"]) => Book["sheets"][number]["notes"]) => setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, notes: f(sh.notes) })));
  const onNote = (a: "new" | "edit" | "delete" | "prev" | "next" | "toggle" | "showAll") => {
    if (a === "showAll") return setNotesShown((x) => !x);
    if (a === "prev" || a === "next") {
      const sorted = [...sheet.notes].sort((x, y) => x.r - y.r || x.c - y.c);
      if (!sorted.length) return notify(tl("Keine Notizen auf diesem Blatt"));
      const after = (n: { r: number; c: number }) => n.r > active.r || (n.r === active.r && n.c > active.c);
      const target = a === "next" ? (sorted.find(after) ?? sorted[0]) : ([...sorted].reverse().find((n) => n.r < active.r || (n.r === active.r && n.c < active.c)) ?? sorted[sorted.length - 1]);
      setSelection(one(target.r, target.c));
      grid.current?.focus();
      return;
    }
    if (blocked()) return;
    if (a === "delete") return patchNotes((ns) => ns.filter((n) => !(n.r >= sel.r1 && n.r <= sel.r2 && n.c >= sel.c1 && n.c <= sel.c2)));
    if (a === "toggle") return patchNotes((ns) => ns.map((n) => (n.r === active.r && n.c === active.c ? { ...n, visible: !n.visible } : n)));
    setNoteDialog({ r: active.r, c: active.c });
  };
  const saveNote = (text: string) => {
    if (!noteDialog) return;
    const { r, c } = noteDialog;
    const old = noteAt(r, c);
    patchNotes((ns) => [...ns.filter((n) => !(n.r === r && n.c === c)), ...(text.trim() ? [{ ...old, r, c, text, author: old?.author ?? (book.author || undefined) }] : [])]);
    setNoteDialog(null);
    grid.current?.focus();
  };

  const linkAtCell = (r: number, c: number) => sheet.links.find((l) => l.r === r && l.c === c);
  const openLinkDialog = () => {
    if (blocked({ r1: active.r, c1: active.c, r2: active.r, c2: active.c })) return;
    const l = linkAtCell(active.r, active.c);
    const text = displayText(book, values, si, active.r, active.c);
    setLinkDialog({ r: active.r, c: active.c, form: linkForm(l?.target ?? "", text, l?.tooltip, book.sheets.map((x) => x.name)), editing: !!l });
  };
  const applyLink = (f: LinkForm) => {
    if (!linkDialog) return;
    const { r, c } = linkDialog;
    const target = linkTarget(f);
    const text = f.text || (f.kind === "place" ? `${f.sheet}!${f.cell}` : f.kind === "mail" ? f.target : target);
    setBook((b) => {
      const cell = b.sheets[b.active].cells.get(key(r, c));
      const shown = displayText(b, values, b.active, r, c);
      const withText = cell?.f || shown === text ? b : setCells(b, b.active, [{ r, c, cell: { ...cell, f: undefined, v: text } }]);
      return withSheet(withText, b.active, (sh) => ({ ...sh, links: [...sh.links.filter((l) => !(l.r === r && l.c === c)), { r, c, target, tooltip: f.tooltip || undefined }] }));
    });
    setLinkDialog(null);
    grid.current?.focus();
  };
  const removeLink = () => {
    if (!linkDialog) return;
    const { r, c } = linkDialog;
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, links: sh.links.filter((l) => !(l.r === r && l.c === c)) })));
    setLinkDialog(null);
  };
  const openLink = (l: { target: string }) => {
    if (l.target.startsWith("#")) {
      const m = /^#'?(.+?)'?!(.+)$/.exec(l.target);
      const si2 = m ? book.sheets.findIndex((x) => x.name === m[1]) : book.active;
      const at = parseA1((m?.[2] ?? l.target.slice(1)).replace(/\$/g, "").split(":")[0]);
      if (si2 < 0 || !at) return notify(tl("Bezug ist ungültig"), l.target, "warning");
      setBookState((b) => ({ ...b, active: si2 }));
      setSelection(one(at.r, at.c));
      return;
    }
    void api.openExternal(l.target).catch((e) => notify(tl("Link konnte nicht geöffnet werden"), errorMessage(e), "error"));
  };

  const protectSheet = async (password: string, allow: Partial<Protection>) => {
    const p = await protectionFor(password, allow);
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, protection: p })));
    setProtectDialog(null);
  };
  const unprotect = async (password: string) => {
    if (!sheet.protection || !(await checkPassword(sheet.protection, password))) return false;
    setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, protection: undefined })));
    setProtectDialog(null);
    return true;
  };
  const toggleProtect = () => {
    if (!sheet.protection) return setProtectDialog("protect");
    const hashed = sheet.protection.password || sheet.protection.hash || sheet.protection.odfKey;
    if (hashed) return setProtectDialog("unprotect");
    void unprotect("");
  };
  const toggleCellFlag = (k: "locked" | "hideFormula") => {
    if (sheet.protection) return;
    const on = k === "locked" ? activeStyle.locked !== false : !!activeStyle.hideFormula;
    setBook((b) => styleRange(b, b.active, effective(sel), (st) => ({ ...st, [k]: k === "locked" ? (on ? false : undefined) : on ? undefined : true })));
  };

  /** Group / ungroup the selected rows or columns (outline levels 1–7). */
  const group = (what: "rows" | "cols", on: boolean) => {
    if (blocked()) return;
    const [a, z] = what === "rows" ? [sel.r1, Math.min(sel.r2, MAX_ROWS - 1)] : [sel.c1, Math.min(sel.c2, MAX_COLS - 1)];
    if (z - a > 100_000) return;
    setBook((b) =>
      withSheet(b, b.active, (sh) => {
        const levels = new Map(what === "rows" ? sh.rowLevels : sh.colLevels);
        for (let i = a; i <= z; i++) {
          const l = (levels.get(i) ?? 0) + (on ? 1 : -1);
          if (l <= 0) levels.delete(i);
          else levels.set(i, Math.min(7, l));
        }
        return what === "rows" ? { ...sh, rowLevels: levels } : { ...sh, colLevels: levels };
      }),
    );
  };
  const outline = (axis: "row" | "col", indices: number[], hide: boolean) =>
    setBook((b) =>
      withSheet(b, b.active, (sh) => {
        const set = new Set(axis === "row" ? sh.hiddenRows : sh.hiddenCols);
        for (const i of indices) hide ? set.add(i) : set.delete(i);
        return axis === "row" ? { ...sh, hiddenRows: set } : { ...sh, hiddenCols: set };
      }),
    );

  const setSheetHidden = (index: number, hidden: boolean) => {
    if (structureBlocked()) return;
    if (hidden && book.sheets.filter((x) => !x.hidden).length <= 1) return notify(tl("Ausblenden nicht möglich"), tl("Eine Arbeitsmappe muss mindestens ein sichtbares Blatt enthalten."), "warning");
    setBook((b) => {
      const sheets = b.sheets.map((x, i) => (i === index ? { ...x, hidden } : x));
      const activeNow = hidden && b.active === index ? sheets.findIndex((x) => !x.hidden) : hidden ? b.active : index;
      return { ...b, sheets, active: activeNow };
    });
  };

  const patchPage = (patch: Partial<PageSetup>) => setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, page: { ...(sh.page ?? DEFAULT_PAGE), ...patch } })));
  const setPrintArea = (on: boolean) => patchPage({ printArea: on ? rangeName(effective(sel)) : undefined });
  const pageBreak = (a: "insert" | "remove" | "reset") => {
    const pg = pageOf(sheet);
    if (a === "reset") return patchPage({ rowBreaks: undefined, colBreaks: undefined });
    // Like Excel: a whole row/column selected breaks only that axis, a cell breaks both.
    const r = active.r;
    const c = active.c;
    const rowsOnly = sel.c1 === 0 && sel.c2 >= MAX_COLS - 1;
    const colsOnly = sel.r1 === 0 && sel.r2 >= MAX_ROWS - 1;
    const toggle = (list: number[] | undefined, i: number, on: boolean) => {
      const next = (list ?? []).filter((x) => x !== i);
      if (on && i > 0) next.push(i);
      next.sort((x, y) => x - y);
      return next.length ? next : undefined;
    };
    const on = a === "insert";
    patchPage({
      rowBreaks: colsOnly ? pg.rowBreaks : toggle(pg.rowBreaks, r, on),
      colBreaks: rowsOnly ? pg.colBreaks : toggle(pg.colBreaks, c, on),
    });
  };

  // ------------------------------------------------- auditing / data tools --

  const arrows = arrowState.sheet === si ? arrowState.list : [];
  const trace = (a: "pre" | "dep" | "clear") => {
    if (a === "clear") return setArrows({ sheet: si, list: [] });
    const has = (x: Arrow) => arrows.some((y) => y.to.r === x.to.r && y.to.c === x.to.c && y.from.r1 === x.from.r1 && y.from.c1 === x.from.c1 && y.from.r2 === x.from.r2 && y.from.c2 === x.from.c2 && !!y.external === !!x.external);
    // Repeated clicks go one level further, like Excel.
    let found: Arrow[];
    if (a === "pre") {
      const targets = [{ r: active.r, c: active.c }, ...arrows.filter((x) => !x.external && x.from.r1 === x.from.r2 && x.from.c1 === x.from.c2).map((x) => ({ r: x.from.r1, c: x.from.c1 }))];
      found = targets.flatMap((t) => precedentArrows(book, si, t.r, t.c)).filter((x) => !has(x));
      if (!sheet.cells.get(key(active.r, active.c))?.f) return notify(tl("Spur zum Vorgänger"), tl("Die aktive Zelle enthält keine Formel."), "warning");
    } else {
      const sources = [{ r: active.r, c: active.c }, ...arrows.filter((x) => !x.external).map((x) => x.to)];
      found = sources.flatMap((t) => dependentArrows(book, si, t.r, t.c)).filter((x) => !has(x));
      if (!found.length && !arrows.length) return notify(tl("Spur zum Nachfolger"), tl("Keine Formel verweist auf die aktive Zelle."), "warning");
    }
    const uniq = new Map([...arrows, ...found].map((x) => [JSON.stringify(x), x]));
    setArrows({ sheet: si, list: [...uniq.values()] });
  };

  const errorCheck = () => {
    const e = nextError(book, values, si, active.r, active.c);
    if (!e) return notify(tl("Fehlerüberprüfung"), tl("Die Fehlerüberprüfung für das gesamte Blatt ist abgeschlossen."), "success");
    setSelection(one(e.r, e.c));
    const code = ERROR_TEXT[e.code] ?? e.code;
    notify(tl("Fehler in {0}: {1}", a1(e.r, e.c), code), ERROR_HELP[e.code] ?? tl("Die Formel liefert einen Fehler."), "warning");
  };

  const openEvaluate = () => {
    const f = sheet.cells.get(key(active.r, active.c))?.f;
    if (!f) return notify(tl("Formel auswerten"), tl("Die aktive Zelle enthält keine Formel."), "warning");
    setEvalCell({ r: active.r, c: active.c, f });
  };

  const openTextToColumns = () => {
    if (sel.c1 !== sel.c2) return notify(tl("Text in Spalten"), tl("Es kann jeweils nur eine Spalte konvertiert werden. Markieren Sie Zellen in einer Spalte."), "warning");
    const u = usedRange(sheet);
    const r2 = Math.min(sel.r2, u?.r2 ?? sel.r1);
    setTtc({ r1: sel.r1, r2: Math.max(sel.r1, r2), c: sel.c1 });
  };
  const ttcLines = useMemo(() => (ttc ? Array.from({ length: ttc.r2 - ttc.r1 + 1 }, (_, i) => displayText(book, values, si, ttc.r1 + i, ttc.c)) : []), [ttc, book, values, si]);
  const applyTextToColumns = (o: SplitOptions, dest: string): string | null => {
    if (!ttc) return null;
    const at = parseA1(dest.replace(/\$/g, "").trim());
    if (!at) return tl("Ungültiger Zielbezug.");
    const rows = ttcLines.map((l) => splitText(l, o));
    const width = Math.max(1, ...rows.map((r) => r.length));
    if (blocked({ r1: at.r, c1: at.c, r2: at.r + rows.length - 1, c2: at.c + width - 1 })) return null;
    const updates = rows.flatMap((parts, i) =>
      Array.from({ length: width }, (_, j) => {
        const r = at.r + i;
        const c = at.c + j;
        const old = sheet.cells.get(key(r, c));
        const parsed = parseInput(parts[j] ?? "");
        return { r, c, cell: parsed.v === null && !old?.s ? null : { v: parsed.v ?? undefined, s: old?.s } };
      }),
    );
    setBook((b) => setCells(b, b.active, updates));
    setTtc(null);
    return null;
  };

  /** Ctrl+E: fill the active column from the pattern of the typed examples. */
  function runFlashFill() {
    const c = active.c;
    const region = currentRegion(sheet, active.r, Math.max(0, c - 1));
    const text = (r: number, cc: number) => displayText(book, values, si, r, cc);
    // Source columns: the filled ones of the region beside the target column.
    const srcCols: number[] = [];
    for (let cc = region.c1; cc <= region.c2; cc++) if (cc !== c) srcCols.push(cc);
    if (!srcCols.length) return notify(tl("Blitzvorschau"), tl("Neben der Spalte stehen keine Daten."), "warning");
    const examples: { src: string[]; out: string }[] = [];
    const todo: number[] = [];
    for (let r = region.r1; r <= region.r2; r++) {
      const src = srcCols.map((cc) => text(r, cc));
      if (src.every((x) => !x)) continue;
      const out = text(r, c);
      if (out) examples.push({ src, out });
      else todo.push(r);
    }
    if (!examples.length) return notify(tl("Blitzvorschau"), tl("Geben Sie zuerst ein oder zwei Beispiele für das gewünschte Ergebnis ein."), "warning");
    const rowsSrc = todo.map((r) => srcCols.map((cc) => text(r, cc)));
    // The first example may be a header row ("Name" → "Vorname"): retry without it.
    const result = flashFill(examples.slice(0, 5), rowsSrc) ?? (examples.length > 1 ? flashFill(examples.slice(1, 6), rowsSrc) : null);
    if (!result) return notify(tl("Blitzvorschau"), tl("Es wurde kein Muster erkannt. Geben Sie ein weiteres Beispiel ein."), "warning");
    if (blocked({ r1: Math.min(...todo), c1: c, r2: Math.max(...todo), c2: c })) return;
    setBook((b) => setCells(b, b.active, todo.map((r, i) => ({ r, c, cell: result[i] ? { v: result[i], s: sheet.cells.get(key(r, c))?.s } : null }))));
    notify(tl("Blitzvorschau: {0} {1} ausgefüllt", todo.length, todo.length === 1 ? "Zelle" : "Zellen"));
  }

  const virtualTarget = (x: number, y: number) => ({ getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect });

  return (
    <div className={s.root}>
      <SuiteHeader appName={tlc("app", "Tabellen")} logo="/sheets.svg" center={<DocumentTitle name={withoutExt(name)} dirty={dirty} path={path} autoSave={autoSave} />} />
      <RecoveryBar app="sheets" canRestore={!dirty && !path} onRestore={restore} />
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
          recording={recording}
          onMacros={() => setMacrosOpen({ id: null })}
          onRecord={() => (recording ? stopRecording() : startRecording(tl("Aufzeichnung{0}", loadMacros("sheets").length + 1)))}
          onDate={insertNow}
          onDedupe={dedupe}
          onChart={insertChart}
          onImage={insertImage}
          filterOn={!!sheet.autoFilter}
          onFilter={toggleFilter}
          onFilterClear={() => setBook((b) => applyFilter(withSheet(b, b.active, (sh) => (sh.autoFilter ? { ...sh, autoFilter: { ...sh.autoFilter, columns: [] } } : sh)), b.active, values))}
          onFilterReapply={() => setBook((b) => applyFilter(b, b.active, values))}
          onCond={condAction}
          onNames={() => setNamesOpen(true)}
          onDefineName={() => setNameEdit({ initial: null })}
          chart={selObject?.chart ?? null}
          objectSelected={!!selObject}
          onChartPatch={patchChart}
          onChartTitle={() => setChartText("title")}
          onChartData={() => setChartText("data")}
          onChartSwap={swapChart}
          onDeleteObject={deleteObject}
          onValidation={() => setValidationOpen(true)}
          onPivot={openPivot}
          onSparkline={setSparkKind}
          table={activeTable}
          onInsertTable={openTableDialog}
          onTableOption={tableOption}
          onTableTotals={(on) => activeTable && setBook((b) => setTotalsRow(b, si, activeTable.name, on))}
          onTableRename={(name) => {
            if (!activeTable) return;
            const r = renameTable(book, si, activeTable.name, name);
            if (typeof r === "string") notify(tl("Tabellenname"), r, "error");
            else setBook(r);
          }}
          onTableResize={() => activeTable && setTableDialog({ mode: "resize", range: rangeName(activeTable.range) })}
          onTableConvert={() => activeTable && setBook((b) => convertToRange(b, si, activeTable.name))}
          onWhatIf={setWhatIf}
          onSolver={() => setWhatIf("solver")}
          hasNote={!!noteAt(active.r, active.c)}
          notesShown={notesShown}
          onNote={onNote}
          sheetProtected={!!sheet.protection}
          bookProtected={!!book.protectStructure}
          cellLocked={activeStyle.locked !== false}
          formulaHidden={!!activeStyle.hideFormula}
          onProtectSheet={toggleProtect}
          onProtectBook={() => setBook((b) => ({ ...b, protectStructure: !b.protectStructure }))}
          a11yOpen={a11yOpen}
          onA11y={() => setA11yOpen((v) => !v)}
          onCellLock={toggleCellFlag}
          onLink={openLinkDialog}
          onGroup={group}
          page={pageOf(sheet)}
          onPage={patchPage}
          onPageDialog={setPageDialog}
          onPrintArea={setPrintArea}
          onPageBreak={pageBreak}
          showFormulas={showFormulas}
          hasArrows={arrows.length > 0}
          onTrace={trace}
          onShowFormulas={() => setShowFormulas((x) => !x)}
          onErrorCheck={errorCheck}
          onEvaluate={openEvaluate}
          onTextToColumns={openTextToColumns}
          onFlashFill={runFlashFill}
          onOutlineClear={() => !blocked() && setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, rowLevels: new Map(), colLevels: new Map() })))}
        />
      </div>
      <div className={s.work}>
        {a11yOpen && <AccessibilityPane issues={a11yIssues} onClose={() => setA11yOpen(false)} onRefresh={() => setA11yTick((n) => n + 1)} />}
        <AltTextDialog
          open={!!altFor}
          initial={altFor?.alt ?? ""}
          onClose={() => setAltFor(null)}
          onSave={(alt) => {
            const t = altFor;
            setAltFor(null);
            if (t) setBook((b) => withSheet(b, t.sheet, (sh) => ({ ...sh, objects: sh.objects.map((o) => (o.id === t.id ? { ...o, alt } : o)) })));
          }}
        />
        <div className="nx-fbar">
          <Input
            className="nx-namebox"
            size="small"
            value={nameText}
            onFocus={(e) => (setNameBox(e.target.value), e.target.select())}
            onChange={(_, d) => setNameBox(d.value)}
            onBlur={() => setNameBox(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goTo((e.target as HTMLInputElement).value);
              }
              if (e.key === "Escape") (setNameBox(null), grid.current?.focus());
            }}
          />
          <Tooltip content={tl("Abbrechen")} relationship="label">
            <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} disabled={!editing} onClick={cancel} />
          </Tooltip>
          <Tooltip content={tl("Eingeben")} relationship="label">
            <Button size="small" appearance="subtle" icon={<Checkmark16Regular />} disabled={!editing} onClick={() => commit(null)} />
          </Tooltip>
          <Text style={{ fontStyle: "italic", fontFamily: "Cambria, Georgia, serif", fontWeight: 600, padding: "0 4px", color: tokens.colorNeutralForeground3 }}>{tl("fx")}</Text>
          <textarea
            ref={fxInput}
            className="nx-fx-input"
            style={spillAnchor !== undefined ? { color: tokens.colorNeutralForeground4 } : undefined}
            rows={1}
            spellCheck={false}
            value={fxText}
            onFocus={() => {
              setFxFocused(true);
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
            onBlur={() => setFxFocused(false)}
            onKeyDown={(e) => {
              if (onAssistKey(e)) return;
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
          {fxFocused && assist && <div style={{ position: "absolute", left: fxInput.current?.offsetLeft ?? 0, top: "100%", zIndex: 30 }}>{assist}</div>}
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
            assist={fxFocused ? null : assist}
            onAssistKey={onAssistKey}
            caret={caret}
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
            cond={cond}
            selectedObject={selectedObject}
            onSelectObject={(id) => {
              setSelectedObject(id);
              if (id && sheet.objects.find((o) => o.id === id)?.type === "chart") setTab("object");
            }}
            onObjectAnchor={(id, anchor) => patchObject(id, (o) => ({ ...o, anchor }))}
            onObjectOpen={(id) => sheet.objects.find((o) => o.id === id)?.type === "chart" && setChartText("title")}
            chartData={(c) => resolveChart(book, values, si, c)}
            onFilterButton={(col, at, table) => setFilterPop({ col, x: at.left, y: at.bottom + 2, table })}
            sparks={sparks}
            listButton={inTotals || (!!activeRule && activeRule.kind === "list" && !activeRule.hideDropdown)}
            onListButton={(at) => {
              if (inTotals && activeTable) {
                const col = active.c - activeTable.range.c1;
                return setListPop({ x: at.left, y: at.bottom + 2, items: TOTALS_FUNCTIONS.map((f) => f.label), onPick: (label) => setBook((b) => setTotalsFunction(b, si, activeTable.name, col, TOTALS_FUNCTIONS.find((f) => f.label === label)?.id ?? "none")) });
              }
              if (activeRule) setListPop({ x: at.left, y: at.bottom + 2, items: validationList(book, values, si, activeRule) });
            }}
            prompt={activeRule?.prompt || activeRule?.promptTitle ? { title: activeRule.promptTitle, text: activeRule.prompt } : null}
            notesShown={notesShown}
            onOpenLink={openLink}
            onOutline={outline}
            arrows={arrows}
            showFormulas={showFormulas}
          />
          {loading && (
            <div className={s.loading}>
              <Spinner label={tl("Arbeitsmappe wird geöffnet…")} />
            </div>
          )}
        </div>
        <div className="nx-tabs" onDoubleClick={(e) => e.target === e.currentTarget && insertAxis("sheet")}>
          {book.sheets.map((sh, i) =>
            sh.hidden ? null :
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
          <Tooltip content={tl("Neues Blatt")} relationship="label">
            <Button size="small" appearance="subtle" icon={<Add16Regular />} onClick={() => insertAxis("sheet")} style={{ alignSelf: "center" }} />
          </Tooltip>
        </div>
        {find && (
          <div className={s.find}>
            <Input
              autoFocus
              size="small"
              placeholder={tl("Suchen")}
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
      <MacroDialog
        open={!!macrosOpen}
        app="sheets"
        initialId={macrosOpen?.id}
        template={SHEET_MACRO_TEMPLATE}
        reference={SHEET_MACRO_REFERENCE}
        onRun={runMacro}
        onRecord={startRecording}
        onClose={() => setMacrosOpen(null)}
      />
      <StatusBar>
        {recording && (
          <Button size="small" appearance="transparent" icon={<RecordStop24Regular style={{ color: tokens.colorPaletteRedForeground1, fontSize: 16 }} />} onClick={stopRecording} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
            {tl("Aufzeichnung läuft – beenden")}
          </Button>
        )}
        <span>{editing ? (pointMode ? tl("Zeigen") : editing.mode === "edit" ? tl("Bearbeiten") : tl("Eingeben")) : tl("Bereit")}</span>
        {warnings.length > 0 && (
          <Button size="small" appearance="transparent" onClick={() => setBackstage("info")} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
            {tl("⚠ Kompatibilitätshinweise")}
          </Button>
        )}
        <span className={s.zoom}>
          {stats && (
            <span style={{ marginRight: 16, display: "flex", gap: 16 }}>
              {stats.n > 0 && <span>{tl("Mittelwert:")} {fmtNum(stats.avg)}</span>}
              <span>{tl("Anzahl:")} {stats.count}</span>
              {stats.n > 0 && <span>{tl("Summe:")} {fmtNum(stats.sum)}</span>}
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
            <MenuItem onClick={() => copy(null, true)}>{tl("Ausschneiden")}</MenuItem>
            <MenuItem onClick={() => copy(null, false)}>{tl("Kopieren")}</MenuItem>
            <MenuItem onClick={() => paste(null)}>{tlc("paste", "Einfügen")}</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => insertAxis("rows")}>{tl("Zeilen einfügen")}</MenuItem>
            <MenuItem onClick={() => insertAxis("cols")}>{tl("Spalten einfügen")}</MenuItem>
            <MenuItem onClick={() => deleteAxis("rows")}>{tl("Zeilen löschen")}</MenuItem>
            <MenuItem onClick={() => deleteAxis("cols")}>{tl("Spalten löschen")}</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => !blocked(effective(sel)) && setBook((b) => clearRange(b, b.active, effective(sel), "contents"))}>{tl("Inhalte löschen")}</MenuItem>
            <MenuItem onClick={() => sort(true)}>{tl("Sortieren A bis Z")}</MenuItem>
            <MenuItem onClick={() => sort(false)}>{tl("Sortieren Z bis A")}</MenuItem>
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
              {tl("Ausblenden")}
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
              {tl("Einblenden")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu open={!!tabMenu} onOpenChange={(_, d) => !d.open && setTabMenu(null)} positioning={{ target: tabMenu ? virtualTarget(tabMenu.x, tabMenu.y) : undefined, position: "above", align: "start" }}>
        <MenuPopover>
          <MenuList>
            <MenuItem disabled={!!book.protectStructure} onClick={() => tabMenu && setRenaming({ index: tabMenu.index, name: book.sheets[tabMenu.index].name })}>{tl("Umbenennen")}</MenuItem>
            <MenuItem disabled={!!book.protectStructure} onClick={() => tabMenu && setSheetHidden(tabMenu.index, true)}>{tl("Ausblenden")}</MenuItem>
            {book.sheets.some((x) => x.hidden) && (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem disabled={!!book.protectStructure}>{tl("Einblenden")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {book.sheets.map((x, i) =>
                      x.hidden ? (
                        <MenuItem key={i} onClick={() => setSheetHidden(i, false)}>
                          {x.name}
                        </MenuItem>
                      ) : null,
                    )}
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}
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
              {tl("Duplizieren")}
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
              {tl("Nach links verschieben")}
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
              {tl("Nach rechts verschieben")}
            </MenuItem>
            <MenuDivider />
            <MenuItem
              disabled={book.sheets.length <= 1}
              onClick={() => tabMenu && setBook((b) => ({ ...b, sheets: b.sheets.filter((_, i) => i !== tabMenu.index), active: Math.max(0, Math.min(b.active, b.sheets.length - 2)) }))}
            >
              {tl("Löschen")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      {backstage && (
        <Backstage
          protection={{ password, onChange: (pw) => (setPassword(pw), setSavedBook((b) => ({ ...b }))) }}
          app="sheets"
          color={COLOR}
          initialPage={backstage}
          onClose={() => setBackstage(null)}
          onNew={() => (setBackstage(null), void openDocumentWindow("sheets"))}
          onOpen={(p) => void open(p)}
          onSave={() => (setBackstage(null), void save())}
          onSaveAs={() => (setBackstage(null), void saveAs())}
          path={path}
          suggestedName={withoutExt(name)}
          onSaveToPath={async (target) => {
            await saveTo(target);
            setBackstage(null);
          }}
          onPrint={() => print()}
          onExportPdf={isTauri ? () => void exportPdf() : undefined}
          info={
            <DocumentInfo
              path={path}
              title={book.title}
              author={book.author}
              onChange={(title, author) => setBook((b) => ({ ...b, title, author }))}
              warnings={warnings}
              stats={<Text>{book.sheets.length === 1 ? tl("1 Blatt") : tl("{0} Blätter", book.sheets.length)} · {book.sheets.reduce((n, x) => n + x.cells.size, 0).toLocaleString(LOCALE)} {tl("Zellen")}</Text>}
            />
          }
        />
      )}
      {unsaved.dialog}
      {filterPop && sheetFilters(sheet).some((f) => f.table === filterPop.table) && (
        <FilterMenu
          key={`${si}:${filterPop.col}`}
          x={filterPop.x}
          y={filterPop.y}
          values={filterValues(book, values, si, filterPop.col, filterPop.table)}
          selected={sheetFilters(sheet).find((f) => f.table === filterPop.table)?.columns.find((x) => x.col === filterPop.col)?.values ?? null}
          onSort={(asc) => (sortFilterColumn(filterPop.col, asc, filterPop.table), setFilterPop(null))}
          onApply={(v) => (setFilterColumn(filterPop.col, v, filterPop.table), setFilterPop(null), grid.current?.focus())}
          onClose={() => setFilterPop(null)}
        />
      )}
      <ValidationDialog open={validationOpen} initial={selValidation} range={rangeName(effective(sel))} onClose={() => setValidationOpen(false)} onApply={applyValidation} />
      <PivotDialog
        open={!!pivot}
        range={pivot ? rangeName(pivot.rect) : ""}
        headers={pivot ? Array.from({ length: pivot.rect.c2 - pivot.rect.c1 + 1 }, (_, i) => displayText(book, values, si, pivot.rect.r1, pivot.rect.c1 + i) || tl("Spalte {0}", i + 1)) : []}
        numeric={pivot ? Array.from({ length: pivot.rect.c2 - pivot.rect.c1 + 1 }, (_, i) => typeof cellValue(pivot.rect.r1 + 1, pivot.rect.c1 + i) === "number") : []}
        dates={pivot ? Array.from({ length: pivot.rect.c2 - pivot.rect.c1 + 1 }, (_, i) => typeof cellValue(pivot.rect.r1 + 1, pivot.rect.c1 + i) === "number" && isDateFormat(book.styles[sheet.cells.get(key(pivot.rect.r1 + 1, pivot.rect.c1 + i))?.s ?? 0]?.numFmt)) : []}
        itemsOf={(c, group) => (pivot ? pivotItems(book, values, si, pivot.rect, pivot.rect.c1 + c, group) : [])}
        onClose={() => setPivot(null)}
        onApply={createPivot}
      />
      <GoalSeekDialog open={whatIf === "goal"} target={a1(active.r, active.c)} onClose={() => setWhatIf(null)} onRun={runGoalSeek} />
      <DataTableDialog open={whatIf === "table"} onClose={() => setWhatIf(null)} onApply={applyDataTable} />
      <ScenarioManager open={whatIf === "scenario"} scenarios={sheet.scenarios} selectionRef={rangeName(effective(sel))} describe={scenarioCells} onClose={() => setWhatIf(null)} onSave={saveScenario} onDelete={(sc) => setBook((b) => withSheet(b, si, (sh) => ({ ...sh, scenarios: sh.scenarios.filter((x) => x !== sc) })))} onShow={showScenario} onSummary={scenarioSummary} />
      {whatIf === "solver" && <SolverDialog open initial={solverForm()} onClose={(f) => (saveSolverForm(f), setWhatIf(null))} onSolve={runSolver} />}
      <ResultDialog open={!!whatIfResult} title={whatIfResult?.title ?? ""} message={whatIfResult?.message ?? ""} details={whatIfResult?.details} onKeep={() => setWhatIfResult(null)} onRestore={() => (whatIfResult && setBook(whatIfResult.restore), setWhatIfResult(null))} />
      <TableDialog open={!!tableDialog} title={tableDialog?.mode === "resize" ? tl("Tabellengröße ändern") : tl("Tabelle erstellen")} resize={tableDialog?.mode === "resize"} range={tableDialog?.range ?? ""} onClose={() => setTableDialog(null)} onApply={applyTableDialog} />
      <SparklineDialog kind={sparkKind} {...sparkDefaults()} onClose={() => setSparkKind(null)} onApply={createSparklines} />
      {listPop && (
        <Menu open onOpenChange={(_, d) => !d.open && setListPop(null)} positioning={{ target: virtualTarget(listPop.x, listPop.y), position: "below", align: "start" }}>
          <MenuPopover>
            <MenuList style={{ maxHeight: 300, overflowY: "auto" }}>
              {listPop.items.length === 0 ? <MenuItem disabled>{tl("Keine Einträge")}</MenuItem> : listPop.items.map((it) => <MenuItem key={it} onClick={() => pickFromList(it)}>{it}</MenuItem>)}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
      <CondDialog kind={condDialog} range={rangeName(effective(sel))} onClose={() => setCondDialog(null)} onApply={addRule} />
      <RulesDialog open={rulesOpen} formats={sheet.condFormats} onClose={() => setRulesOpen(false)} onDelete={deleteRule} />
      <NameManager
        open={namesOpen && !nameEdit}
        names={book.names.filter((n) => !n.hidden)}
        sheets={book.sheets.map((x) => x.name)}
        onClose={() => setNamesOpen(false)}
        onNew={() => setNameEdit({ initial: null })}
        onEdit={(n) => setNameEdit({ initial: n })}
        onDelete={(n) => setBook((b) => ({ ...b, names: b.names.filter((x) => x !== n) }))}
        valueOf={nameValue}
      />
      <PageSetupDialog open={!!pageDialog} tab={pageDialog ?? "page"} initial={sheet.page} sheetName={sheet.name} fileName={name} onClose={() => setPageDialog(null)} onApply={(pg) => (setBook((b) => withSheet(b, b.active, (sh) => ({ ...sh, page: pg }))), setPageDialog(null))} />
      <TextToColumnsDialog open={!!ttc} lines={ttcLines} destination={ttc ? a1(ttc.r1, ttc.c) : "A1"} onClose={() => setTtc(null)} onApply={applyTextToColumns} />
      <EvaluateDialog open={!!evalCell} cell={evalCell ? a1(evalCell.r, evalCell.c) : ""} formula={evalCell?.f ?? ""} step={(expr) => (evalCell ? evaluateStep(book, values, si, evalCell.r, evalCell.c, expr) : { expr, done: true })} onClose={() => setEvalCell(null)} />
      <NoteDialog open={!!noteDialog} cell={noteDialog ? a1(noteDialog.r, noteDialog.c) : ""} text={noteDialog ? (noteAt(noteDialog.r, noteDialog.c)?.text ?? "") : ""} author={noteDialog ? (noteAt(noteDialog.r, noteDialog.c)?.author ?? book.author) : ""} onClose={() => setNoteDialog(null)} onSave={saveNote} />
      <LinkDialog open={!!linkDialog} initial={linkDialog?.form ?? linkForm("", "", undefined, [])} sheets={book.sheets.map((x) => x.name)} editing={!!linkDialog?.editing} onClose={() => setLinkDialog(null)} onApply={applyLink} onRemove={removeLink} />
      <ProtectDialog open={protectDialog === "protect"} onClose={() => setProtectDialog(null)} onProtect={(pw, allow) => void protectSheet(pw, allow)} />
      <UnprotectDialog open={protectDialog === "unprotect"} onClose={() => setProtectDialog(null)} onUnprotect={unprotect} />
      <NameDialog open={!!nameEdit} initial={nameEdit?.initial ?? null} defaultRef={selRef()} sheets={book.sheets.map((x) => x.name)} existing={book.names} onClose={() => setNameEdit(null)} onSave={saveName} />
      <TextDialog
        open={chartText !== null && !!selObject?.chart}
        title={chartText === "title" ? tl("Diagrammtitel") : tl("Diagrammdaten auswählen")}
        label={chartText === "title" ? tl("Titel (leer = kein Titel)") : tl("Diagrammdatenbereich")}
        initial={chartText === "title" ? selObject?.chart?.title ?? "" : selObject?.chart ? `=${chartRange(selObject.chart)}` : ""}
        onClose={() => setChartText(null)}
        onApply={(v) => {
          if (!selObject?.chart) return;
          if (chartText === "title") return patchChart({ title: v.trim() || undefined });
          const t = v.trim().replace(/^=/, "");
          const m = t.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
          const target = m ? book.sheets.findIndex((x) => x.name.toLowerCase() === (m[1]?.replace(/''/g, "'") ?? m[2]).toLowerCase()) : si;
          const rect = parseRange((m ? m[3] : t).replace(/\$/g, ""));
          if (!rect || target < 0) return notify(tl("Ungültiger Bereich"), v, "warning");
          const rebuilt = chartFromRange(book, values, target, rect, selObject.chart.kind);
          patchChart({ series: rebuilt.series });
        }}
      />
      {printing &&
        createPortal(
          <PrintSheet book={book} values={values} si={si} />,
          document.body,
        )}
    </div>
  );
}


/** Printed pages of a sheet: print area, titles, breaks, scaling, gridlines and headings. */
function PrintSheet({ book, values, si }: { book: Book; values: CalcResult; si: number }) {
  const sh = book.sheets[si];
  const pg = pageOf(sh);
  const colW = (c: number) => sh.cols.get(c) ?? DEFAULT_COL;
  const rowH = (r: number) => sh.rows.get(r) ?? DEFAULT_ROW;
  const { pages, scale, titleRows, titleCols } = printPages(sh, colW, rowH);
  const vals = values[si];
  const td = (r: number, c: number) => {
    const cell = sh.cells.get(key(r, c));
    const st = book.styles[cell?.s ?? 0] ?? {};
    const v = cell ? (cell.f ? (vals?.get(key(r, c)) ?? null) : cell.e ? { error: cell.e } : (cell.v ?? null)) : (vals?.get(key(r, c)) ?? null);
    const f = formatValue(v as Scalar, st.numFmt);
    return (
      <td
        key={c}
        style={{
          fontWeight: st.bold ? 700 : undefined,
          fontStyle: st.italic ? "italic" : undefined,
          textDecoration: st.underline ? "underline" : undefined,
          color: f.color ?? st.color,
          background: st.fill,
          textAlign: (st.hAlign as React.CSSProperties["textAlign"]) ?? (f.numeric ? "right" : "left"),
          width: colW(c) * 0.75 + "pt",
          maxWidth: colW(c) * 0.75 + "pt",
          height: rowH(r) * 0.75 + "pt",
          // Like on screen, text runs into empty neighbours.
          overflow: st.wrap || f.numeric ? "hidden" : "visible",
          borderTop: st.borderTop ? "1px solid #000" : undefined,
          borderBottom: st.borderBottom ? (st.borderBottom === "double" ? "3px double #000" : "1px solid #000") : undefined,
          borderLeft: st.borderLeft ? "1px solid #000" : undefined,
          borderRight: st.borderRight ? "1px solid #000" : undefined,
          whiteSpace: st.wrap ? "pre-wrap" : "nowrap",
        }}
      >
        {f.text}
      </td>
    );
  };
  return (
    <div className={`nx-print-root ${pg.gridlines ? "grid" : ""}`}>
      {pages.map((page, i) => {
        const rows = [...titleRows.filter((r) => r < page.rows[0]), ...page.rows];
        const cols = [...titleCols.filter((c) => c < page.cols[0]), ...page.cols];
        return (
          <div key={i} className="nx-print-page" style={{ zoom: scale, display: "flex", flexDirection: "column", alignItems: pg.centerH ? "center" : "flex-start", justifyContent: pg.centerV ? "center" : "flex-start" }}>
            <table style={{ tableLayout: "fixed" }}>
              <tbody>
                {pg.headings && (
                  <tr className="nx-print-head">
                    <td />
                    {cols.map((c) => (
                      <td key={c}>{colName(c)}</td>
                    ))}
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r}>
                    {pg.headings && <td className="nx-print-head">{r + 1}</td>}
                    {cols.map((c) => td(r, c))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
