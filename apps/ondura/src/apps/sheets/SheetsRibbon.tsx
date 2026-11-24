import { useState } from "react";
import { RibbonCombo, parseSize, sizeText } from "../../shell/RibbonCombo";
import {
  Input,
  Dropdown,
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
} from "@fluentui/react-components";
import {
  AlignBottom20Regular,
  AlignCenterVertical20Regular,
  AlignTop20Regular,
  ArrowDown20Regular,
  ArrowRedo20Regular,
  ArrowRight20Regular,
  ArrowSync24Regular,
  ArrowRepeatAll24Regular,
  ArrowSwap24Regular,
  DataTrending24Regular,
  DataUsage24Regular,
  ShieldCheckmark24Regular,
  NoteAdd24Regular,
  ArrowStepInRight24Regular,
  ArrowStepOut24Regular,
  Eraser24Regular,
  MathFormula24Regular,
  ErrorCircle24Regular,
  Calculator24Regular,
  TextColumnTwo24Regular,
  Flash24Regular,
  DocumentMargins24Regular,
  Orientation24Regular,
  DocumentPageBreak24Regular,
  DocumentHeaderFooter24Regular,
  PageFit24Regular,
  Print24Regular,
  DocumentTable24Regular,
  DocumentOnePage24Regular,
  NoteEdit24Regular,
  CommentMultiple24Regular,
  ArrowPrevious24Regular,
  ArrowNext24Regular,
  LockClosed24Regular,
  ShieldLock24Regular,
  AccessibilityCheckmark24Regular,
  Code24Regular,
  Record24Regular,
  RecordStop24Regular,
  DocumentLock24Regular,
  Link24Regular,
  Group24Regular,
  GroupDismiss24Regular,
  EyeOff24Regular,
  Table24Regular,
  DataArea24Regular,
  DataBarHorizontal24Regular,
  DataBarVertical24Regular,
  DataLine24Regular,
  DataPie24Regular,
  DataScatter24Regular,
  Filter24Regular,
  FilterDismiss24Regular,
  Image24Regular,
  TableCellEdit24Regular,
  Tag24Regular,
  TagMultiple24Regular,
  TextT24Regular,
  ArrowUndo20Regular,
  BorderAll20Regular,
  BorderBottom20Regular,
  BorderBottomDouble20Regular,
  BorderBottomThick20Regular,
  BorderLeft20Regular,
  BorderNone20Regular,
  BorderOutside20Regular,
  BorderRight20Regular,
  BorderTop20Regular,
  CalendarLtr24Regular,
  ClipboardPaste24Regular,
  Clock24Regular,
  Copy20Regular,
  CurrencyDollarEuro20Regular,
  Cut20Regular,
  DarkTheme20Regular,
  DecimalArrowLeft20Regular,
  DecimalArrowRight20Regular,
  Delete24Regular,
  Eraser20Regular,
  FontDecrease20Regular,
  FontIncrease20Regular,
  Grid24Regular,
  Highlight20Regular,
  NumberSymbol20Regular,
  PaintBucket20Regular,
  Search20Regular,
  TableCellsMerge20Regular,
  TableDeleteColumn20Regular,
  TableDeleteRow20Regular,
  TableFreezeColumnAndRow24Regular,
  TableInsertColumn20Regular,
  TableInsertRow20Regular,
  TableStackBelow24Regular,
  TextAlignCenter20Regular,
  TextAlignLeft20Regular,
  TextAlignRight20Regular,
  TextBold20Regular,
  TextColor20Regular,
  TextIndentDecreaseLtr20Regular,
  TextIndentIncreaseLtr20Regular,
  TextItalic20Regular,
  TextPercent20Regular,
  TextSortAscending20Regular,
  TextSortAscending24Regular,
  TextSortDescending20Regular,
  TextSortDescending24Regular,
  TextStrikethrough20Regular,
  TextUnderline20Regular,
  TextWrap20Regular,
  ZoomIn20Regular,
  ZoomOut20Regular,
  TableSimple24Regular,
  DataWhisker24Regular,
  DataBarVerticalAdd24Regular,
  DataWaterfall24Regular,
  DataTreemap24Regular,
  FilterAdd24Regular,
  Timeline24Regular,
  CheckboxChecked24Regular,
  CommentAdd24Regular,
  Comment24Regular,
  ArrowDownload24Regular,
  ArrowClockwise24Regular,
  TableLightning24Regular,
  Eye24Regular,
  NumberSymbolSquare24Regular,
  Shapes24Regular,
  Textbox24Regular,
  TableSettings24Regular,
  DataSunburst24Regular,
  DataHistogram24Regular,
  DataFunnel24Regular,
  TableResizeColumn24Regular,
  TableDismiss24Regular,
  TableBottomRow24Regular,
  PaintBrush20Regular,
  ClipboardPaste20Regular,
  TextDirectionRotate90Left20Regular,
  ArrowUp20Regular,
  ArrowLeft20Regular,
  Icons24Regular,
  Screenshot24Regular,
  TextEffects24Regular,
  DocumentSignature24Regular,
  Symbols24Regular,
  TagSearch24Regular,
  CalculatorMultiple24Regular,
  TableSearch24Regular,
  TextGrammarCheckmark24Regular,
  DataLine24Regular as Forecast24Regular,
  ZoomFit24Regular,
  TextFont24Regular,
  ArrowUp24Regular,
  ArrowDown24Regular,
  Ruler24Regular,
  TableEdit24Regular,
  FilterSync24Regular,
  ArrowSortDownLines24Regular,
} from "@fluentui/react-icons";
import { CELL_STYLES, type PasteMode, type SpecialKind } from "./ribbonTools";
import { TableStyleGallery } from "./tableGallery";
import type { TableDef } from "./model";
import type { PageSetup } from "./model";
import { MARGIN_PRESETS, PAPERS } from "./pageLayout";
import type { PageTab } from "./pageDialog";
import { BigButton, ColorButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton } from "../../shell/office";
import { useThemeMode } from "../../shell/theme";
import { FONTS, SIZES } from "../text/TextRibbon";
import { FUNCTION_CATEGORIES, germanName } from "./formula";
import { NUMBER_FORMATS } from "./format";
import type { CellStyle } from "./model";
import { type Chart, type ChartKind, CHART_KINDS } from "../chart/ChartView";
import type { CondKind } from "./dialogs";
import { tl, tlc } from "../../lib/i18n";

const CHART_ICONS: Record<ChartKind, React.ReactElement> = {
  column: <DataBarVertical24Regular />,
  bar: <DataBarHorizontal24Regular />,
  line: <DataLine24Regular />,
  area: <DataArea24Regular />,
  pie: <DataPie24Regular />,
  doughnut: <DataPie24Regular />,
  scatter: <DataScatter24Regular />,
  combo: <DataBarVerticalAdd24Regular />,
  waterfall: <DataWaterfall24Regular />,
  histogram: <DataHistogram24Regular />,
  funnel: <DataFunnel24Regular />,
  treemap: <DataTreemap24Regular />,
  sunburst: <DataSunburst24Regular />,
  boxWhisker: <DataWhisker24Regular />,
};

export type CondAction = CondKind | "dataBar" | "colorScale" | "clearSelection" | "clearSheet" | "manage";

const BARS = [
  { label: tl("Blau"), color: "#638ec6" },
  { label: tl("Grün"), color: "#63be7b" },
  { label: tl("Rot"), color: "#ff555a" },
  { label: tl("Orange"), color: "#ffb628" },
  { label: tl("Hellblau"), color: "#008aef" },
  { label: tl("Lila"), color: "#d6007b" },
];
const SCALES = [
  { label: tl("Grün – Gelb – Rot"), colors: ["#63be7b", "#ffeb84", "#f8696b"] },
  { label: tl("Rot – Gelb – Grün"), colors: ["#f8696b", "#ffeb84", "#63be7b"] },
  { label: tl("Grün – Weiß"), colors: ["#ffffff", "#63be7b"] },
  { label: tl("Rot – Weiß"), colors: ["#ffffff", "#f8696b"] },
  { label: tl("Weiß – Blau"), colors: ["#ffffff", "#5a8ac6"] },
  { label: tl("Blau – Weiß – Rot"), colors: ["#5a8ac6", "#fcfcff", "#f8696b"] },
];

const Sigma = ({ size = 20 }: { size?: number }) => <span style={{ fontSize: size, fontWeight: 600, lineHeight: 1, fontFamily: "Cambria, Georgia, serif" }}>Σ</span>;
const Fx = ({ size = 22 }: { size?: number }) => <span style={{ fontSize: size * 0.8, fontStyle: "italic", fontWeight: 600, fontFamily: "Cambria, Georgia, serif" }}>{tl("fx")}</span>;

export type BorderPreset = "all" | "outside" | "none" | "top" | "bottom" | "left" | "right" | "bottomDouble" | "bottomThick";

export type SheetExtra =
  | "painter"
  | "rowHeight"
  | "colWidth"
  | "autofitRows"
  | "autofitCols"
  | "defaultWidth"
  | "hideRows"
  | "hideCols"
  | "unhideRows"
  | "unhideCols"
  | "hideSheet"
  | "renameSheet"
  | "moveCopySheet"
  | "goTo"
  | "customSort"
  | "clearLinks"
  | "clearNotes"
  | "fillUp"
  | "fillLeft"
  | "fillSeries"
  | "icons"
  | "screenshot"
  | "wordart"
  | "signature"
  | "createNames"
  | "watch"
  | "calcManual"
  | "calcAuto"
  | "calcSheet"
  | "advancedFilter"
  | "subtotal"
  | "forecastSheet"
  | "stats"
  | "spelling"
  | "headings"
  | "formulaBar"
  | "zoomSelection"
  | "bringForward"
  | "sendBackward"
  | { view: "normal" | "breaks" | "layout" }
  | { cellStyle: number }
  | { paste: PasteMode }
  | { rotate: number }
  | { tabColor: string | null }
  | { unhideSheet: number }
  | { special: SpecialKind }
  | { symbol: string }
  | { useName: string }
  | { themeFont: string }
  | "find"
  | "replace"
  | "numberFormat"
  | "textBox"
  | "slicer"
  | "timeline"
  | "pivotChart"
  | "checkbox"
  | "getData"
  | "refreshAll"
  | "consolidate"
  | "newComment"
  | "comments"
  | "views"
  | "formatObject"
  | { shape: string }
  | { query: string };

const SHAPE_KINDS: [string, string][] = [
  ["rect", tl("Rechteck")],
  ["roundRect", tl("Abgerundetes Rechteck")],
  ["ellipse", tl("Ellipse")],
  ["triangle", tl("Dreieck")],
  ["rightArrow", tl("Pfeil nach rechts")],
  ["star5", tl("Stern")],
  ["line", tl("Linie")],
];

/** State of the Excel-parity commands shown in the ribbon. */
export interface SheetExtrasState {
  painter: boolean;
  view: "normal" | "breaks" | "layout";
  headings: boolean;
  formulaBar: boolean;
  calcManual: boolean;
  watch: boolean;
  names: string[];
  hiddenSheets: { index: number; name: string }[];
  rotation: number;
}

const SYMBOLS = ["€", "£", "$", "¥", "©", "®", "™", "±", "≠", "≤", "≥", "÷", "×", "∞", "µ", "α", "β", "π", "Σ", "Ω", "°", "‰", "√", "∑", "←", "→", "↑", "↓", "✓", "✗", "•", "…", "§", "¶", "½", "¼", "¾", "²", "³"];

export interface SheetsRibbonProps {
  onExtra: (a: SheetExtra) => void;
  extras: SheetExtrasState;
  commentsOpen: boolean;
  queries: string[];
  /** Kind of the selected object other than a chart. */
  objectKind?: string;
  color: string;
  tab: string;
  onTab: (t: string) => void;
  style: CellStyle;
  merged: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  freeze: { rows: number; cols: number };
  zoom: number;
  onFile: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClipboard: (a: "cut" | "copy" | "paste") => void;
  onStyle: (patch: Partial<CellStyle>) => void;
  onToggle: (k: "bold" | "italic" | "underline" | "strike" | "wrap") => void;
  onFontSize: (dir: 1 | -1 | number) => void;
  onBorder: (b: BorderPreset) => void;
  onMerge: (mode: "center" | "across" | "merge" | "unmerge") => void;
  onIndent: (d: number) => void;
  onNumFmt: (code: string | null) => void;
  onDecimals: (d: number) => void;
  onInsert: (what: "rows" | "cols" | "sheet") => void;
  onDelete: (what: "rows" | "cols" | "sheet") => void;
  onAutoSum: (fn: string) => void;
  onFill: (dir: "down" | "right") => void;
  onClear: (what: "all" | "formats" | "contents") => void;
  onSort: (asc: boolean) => void;
  onFind: () => void;
  onFunction: (en: string) => void;
  onRecalc: () => void;
  onFreeze: (mode: "selection" | "row" | "col" | "none") => void;
  onGrid: () => void;
  onZoom: (z: number) => void;
  recording: boolean;
  onMacros: () => void;
  onRecord: () => void;
  onDate: (time: boolean) => void;
  onDedupe: () => void;
  onChart: (kind: ChartKind) => void;
  onImage: () => void;
  filterOn: boolean;
  onFilter: () => void;
  onFilterClear: () => void;
  onFilterReapply: () => void;
  onCond: (a: CondAction, colors?: string[]) => void;
  onNames: () => void;
  onDefineName: () => void;
  /** Selected chart (shows the chart tools tab). */
  chart: Chart | null;
  objectSelected: boolean;
  onChartPatch: (patch: Partial<Chart>) => void;
  onChartTitle: () => void;
  onChartData: () => void;
  onChartSwap: () => void;
  onDeleteObject: () => void;
  onValidation: () => void;
  onPivot: () => void;
  onSparkline: (kind: "line" | "column" | "stacked") => void;
  /** Table of the active cell (shows the table design tab). */
  table: TableDef | null;
  onInsertTable: (style?: string) => void;
  onTableOption: (patch: Partial<Pick<TableDef, "bandedRows" | "bandedCols" | "firstCol" | "lastCol" | "filter" | "style">>) => void;
  onTableTotals: (on: boolean) => void;
  onTableRename: (name: string) => void;
  onTableResize: () => void;
  onTableConvert: () => void;
  onWhatIf: (kind: "goal" | "table" | "scenario") => void;
  onSolver: () => void;
  /** Review tab. */
  hasNote: boolean;
  notesShown: boolean;
  onNote: (a: "new" | "edit" | "delete" | "prev" | "next" | "toggle" | "showAll") => void;
  sheetProtected: boolean;
  bookProtected: boolean;
  cellLocked: boolean;
  formulaHidden: boolean;
  onProtectSheet: () => void;
  onProtectBook: () => void;
  a11yOpen: boolean;
  onA11y: () => void;
  onCellLock: (k: "locked" | "hideFormula") => void;
  onLink: () => void;
  onGroup: (what: "rows" | "cols", group: boolean) => void;
  onOutlineClear: () => void;
  /** Page layout tab. */
  page: PageSetup;
  onPage: (patch: Partial<PageSetup>) => void;
  onPageDialog: (tab: PageTab) => void;
  onPrintArea: (set: boolean) => void;
  onPageBreak: (a: "insert" | "remove" | "reset") => void;
  /** Formula auditing and data tools. */
  showFormulas: boolean;
  hasArrows: boolean;
  onTrace: (a: "pre" | "dep" | "clear") => void;
  onShowFormulas: () => void;
  onErrorCheck: () => void;
  onEvaluate: () => void;
  onTextToColumns: () => void;
  onFlashFill: () => void;
}

export function SheetsRibbon(p: SheetsRibbonProps) {
  const { toggle, mode } = useThemeMode();
  const st = p.style;
  const size = (st.size10 ?? 110) / 10;
  const fmt = NUMBER_FORMATS.find((f) => (f.code ?? null) === (st.numFmt ?? null)) ?? (st.numFmt ? { id: "custom", label: tl("Benutzerdefiniert"), code: st.numFmt } : NUMBER_FORMATS[0]);

  const functionMenu = (big: boolean) => (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>{big ? <BigButton icon={<Fx />} label={tl("Funktion")} menu /> : <SmallButton icon={<Fx size={18} />} label={tl("Funktion einfügen")} menu />}</span>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {FUNCTION_CATEGORIES.map((cat) => (
            <Menu key={cat.name}>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem>{cat.name}</MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <MenuList style={{ maxHeight: 420, overflowY: "auto" }}>
                  {cat.fns.map((f) => (
                    <MenuItem key={f} onClick={() => p.onFunction(f)}>
                      {germanName(f)}
                    </MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  const autoSum = (big: boolean) => (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>{big ? <BigButton icon={<Sigma size={24} />} label={tl("AutoSumme")} menu /> : <SmallButton icon={<Sigma />} label={tl("AutoSumme")} text={tl("AutoSumme")} menu />}</span>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem onClick={() => p.onAutoSum("SUM")}>{tl("Summe")}</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("AVERAGE")}>{tl("Mittelwert")}</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("COUNT")}>{tl("Anzahl")}</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("MAX")}>{tl("Max")}</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("MIN")}>{tl("Min")}</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  const home = (
    <>
      <RibbonGroup label={tl("Zwischenablage")}>
        <BigButton icon={<ClipboardPaste24Regular />} label={tlc("paste", "Einfügen")} onClick={() => p.onClipboard("paste")} />
        <Rows>
          <SmallButton icon={<Cut20Regular />} label={tl("Ausschneiden")} shortcut="Strg+X" onClick={() => p.onClipboard("cut")} />
          <SmallButton icon={<Copy20Regular />} label={tl("Kopieren")} shortcut="Strg+C" onClick={() => p.onClipboard("copy")} />
          <SmallButton icon={<PaintBrush20Regular />} label={tl("Format übertragen")} pressed={p.extras.painter} onClick={() => p.onExtra("painter")} />
        </Rows>
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<ClipboardPaste20Regular />} label={tl("Inhalte einfügen")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {(
                  [
                    ["values", tl("Werte")],
                    ["valuesFormats", tl("Werte und Quellformatierung")],
                    ["formulas", tl("Formeln")],
                    ["formats", tl("Formatierung")],
                    ["noBorders", tl("Ohne Rahmen")],
                    ["transpose", tl("Transponieren")],
                    ["columnWidths", tl("Spaltenbreiten der Quelle")],
                    ["link", tl("Verknüpfung einfügen")],
                  ] as [PasteMode, string][]
                ).map(([m, l]) => (
                  <MenuItem key={m} onClick={() => p.onExtra({ paste: m })}>
                    {l}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
        <Rows>
          <SmallButton icon={<ArrowUndo20Regular />} label={tl("Rückgängig")} shortcut="Strg+Z" disabled={!p.canUndo} onClick={p.onUndo} />
          <SmallButton icon={<ArrowRedo20Regular />} label={tl("Wiederholen")} shortcut="Strg+Y" disabled={!p.canRedo} onClick={p.onRedo} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Schriftart")}>
        <Rows>
          <Row>
            <RibbonCombo
              style={{ width: 140, minWidth: 0 }}
              aria-label={tl("Schriftart")}
              value={st.font ?? tl("Calibri")}
              selected={st.font ?? "Calibri"}
              entries={FONTS.map((f) => ({ value: f, text: f, node: <span style={{ fontFamily: f }}>{f}</span> }))}
              onCommit={(f) => p.onStyle({ font: f === "Calibri" ? undefined : f })}
            />
            <RibbonCombo
              style={{ width: 64, minWidth: 0 }}
              aria-label={tl("Schriftgrad")}
              value={sizeText(size)}
              selected={String(size)}
              entries={SIZES.map((v) => ({ value: String(v), text: sizeText(v) }))}
              onCommit={(t) => {
                const v = parseSize(t);
                if (v > 0) p.onFontSize(v);
              }}
            />
            <SmallButton icon={<FontIncrease20Regular />} label={tl("Schriftgrad vergrößern")} onClick={() => p.onFontSize(1)} />
            <SmallButton icon={<FontDecrease20Regular />} label={tl("Schriftgrad verkleinern")} onClick={() => p.onFontSize(-1)} />
          </Row>
          <Row>
            <SmallButton icon={<TextBold20Regular />} label={tl("Fett")} shortcut="Strg+B" pressed={!!st.bold} onClick={() => p.onToggle("bold")} />
            <SmallButton icon={<TextItalic20Regular />} label={tl("Kursiv")} shortcut="Strg+I" pressed={!!st.italic} onClick={() => p.onToggle("italic")} />
            <SmallButton icon={<TextUnderline20Regular />} label={tl("Unterstrichen")} shortcut="Strg+U" pressed={!!st.underline} onClick={() => p.onToggle("underline")} />
            <SmallButton icon={<TextStrikethrough20Regular />} label={tl("Durchgestrichen")} pressed={!!st.strike} onClick={() => p.onToggle("strike")} />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<BorderBottom20Regular />} label={tl("Rahmenlinien")} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<BorderBottom20Regular />} onClick={() => p.onBorder("bottom")}>{tl("Rahmenlinie unten")}</MenuItem>
                  <MenuItem icon={<BorderTop20Regular />} onClick={() => p.onBorder("top")}>{tl("Rahmenlinie oben")}</MenuItem>
                  <MenuItem icon={<BorderLeft20Regular />} onClick={() => p.onBorder("left")}>{tl("Rahmenlinie links")}</MenuItem>
                  <MenuItem icon={<BorderRight20Regular />} onClick={() => p.onBorder("right")}>{tl("Rahmenlinie rechts")}</MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<BorderNone20Regular />} onClick={() => p.onBorder("none")}>{tl("Kein Rahmen")}</MenuItem>
                  <MenuItem icon={<BorderAll20Regular />} onClick={() => p.onBorder("all")}>{tl("Alle Rahmenlinien")}</MenuItem>
                  <MenuItem icon={<BorderOutside20Regular />} onClick={() => p.onBorder("outside")}>{tl("Rahmenlinien außen")}</MenuItem>
                  <MenuItem icon={<BorderBottomDouble20Regular />} onClick={() => p.onBorder("bottomDouble")}>{tl("Doppelte Rahmenlinie unten")}</MenuItem>
                  <MenuItem icon={<BorderBottomThick20Regular />} onClick={() => p.onBorder("bottomThick")}>{tl("Dicke Rahmenlinie unten")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <ColorButton icon={<PaintBucket20Regular />} label={tl("Füllfarbe")} value="#ffff00" noneLabel={tl("Keine Füllung")} onPick={(c) => p.onStyle({ fill: c ?? undefined })} />
            <ColorButton icon={<TextColor20Regular />} label={tl("Schriftfarbe")} value="#c00000" onPick={(c) => p.onStyle({ color: c ?? undefined })} />
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Ausrichtung")}>
        <Rows>
          <Row>
            <SmallButton icon={<AlignTop20Regular />} label={tl("Oben ausrichten")} pressed={st.vAlign === "top"} onClick={() => p.onStyle({ vAlign: "top" })} />
            <SmallButton icon={<AlignCenterVertical20Regular />} label={tl("Zentriert ausrichten")} pressed={st.vAlign === "middle"} onClick={() => p.onStyle({ vAlign: "middle" })} />
            <SmallButton icon={<AlignBottom20Regular />} label={tl("Unten ausrichten")} pressed={!st.vAlign || st.vAlign === "bottom"} onClick={() => p.onStyle({ vAlign: undefined })} />
            <SmallButton icon={<TextWrap20Regular />} label={tl("Textumbruch")} text={tl("Umbruch")} pressed={!!st.wrap} onClick={() => p.onToggle("wrap")} />
          </Row>
          <Row>
            <SmallButton icon={<TextAlignLeft20Regular />} label={tl("Linksbündig")} pressed={st.hAlign === "left"} onClick={() => p.onStyle({ hAlign: st.hAlign === "left" ? undefined : "left" })} />
            <SmallButton icon={<TextAlignCenter20Regular />} label={tl("Zentriert")} pressed={st.hAlign === "center"} onClick={() => p.onStyle({ hAlign: st.hAlign === "center" ? undefined : "center" })} />
            <SmallButton icon={<TextAlignRight20Regular />} label={tl("Rechtsbündig")} pressed={st.hAlign === "right"} onClick={() => p.onStyle({ hAlign: st.hAlign === "right" ? undefined : "right" })} />
            <SmallButton icon={<TextIndentDecreaseLtr20Regular />} label={tl("Einzug verkleinern")} onClick={() => p.onIndent(-1)} />
            <SmallButton icon={<TextIndentIncreaseLtr20Regular />} label={tl("Einzug vergrößern")} onClick={() => p.onIndent(1)} />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<TableCellsMerge20Regular />} label={tl("Verbinden und zentrieren")} pressed={p.merged} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => p.onMerge("center")}>{tl("Verbinden und zentrieren")}</MenuItem>
                  <MenuItem onClick={() => p.onMerge("across")}>{tl("Verbinden über")}</MenuItem>
                  <MenuItem onClick={() => p.onMerge("merge")}>{tl("Zellen verbinden")}</MenuItem>
                  <MenuItem onClick={() => p.onMerge("unmerge")}>{tl("Zellverbund aufheben")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<TextDirectionRotate90Left20Regular />} label={tl("Ausrichtung")} pressed={!!p.extras.rotation} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {(
                    [
                      [45, tl("Gegen den Uhrzeigersinn drehen")],
                      [135, tl("Im Uhrzeigersinn drehen")],
                      [255, tl("Vertikaler Text")],
                      [90, tl("Text nach oben drehen")],
                      [180, tl("Text nach unten drehen")],
                      [0, tl("Keine Drehung")],
                    ] as [number, string][]
                  ).map(([r, l]) => (
                    <MenuItem key={r} onClick={() => p.onExtra({ rotate: r })}>
                      {l}
                      {(p.extras.rotation || 0) === r ? " ✓" : ""}
                    </MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Zahl")}>
        <Rows>
          <Dropdown
            size="small"
            style={{ width: 160, minWidth: 0 }}
            value={fmt.label}
            selectedOptions={[fmt.id]}
            onOptionSelect={(_, d) => {
              const f = NUMBER_FORMATS.find((x) => x.id === d.optionValue);
              if (f) p.onNumFmt(f.code);
            }}
          >
            {NUMBER_FORMATS.map((f) => (
              <Option key={f.id} value={f.id}>
                {f.label}
              </Option>
            ))}
          </Dropdown>
          <Row>
            <SmallButton icon={<CurrencyDollarEuro20Regular />} label={tl("Währung (€)")} onClick={() => p.onNumFmt("#,##0.00 €")} />
            <SmallButton icon={<TextPercent20Regular />} label={tl("Prozent")} onClick={() => p.onNumFmt("0%")} />
            <SmallButton icon={<NumberSymbol20Regular />} label="1.000er-Trennzeichen" onClick={() => p.onNumFmt("#,##0.00")} />
            <SmallButton icon={<DecimalArrowRight20Regular />} label={tl("Dezimalstelle hinzufügen")} onClick={() => p.onDecimals(1)} />
            <SmallButton icon={<DecimalArrowLeft20Regular />} label={tl("Dezimalstelle löschen")} onClick={() => p.onDecimals(-1)} />
            <SmallButton icon={<NumberSymbolSquare24Regular style={{ fontSize: 20 }} />} label={tl("Zahlenformat… (Strg+1)")} onClick={() => p.onExtra("numberFormat")} />
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Formatvorlagen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableSimple24Regular />} label={tl("Als Tabelle formatieren")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <TableStyleGallery current={p.table?.style} onPick={(st) => (p.table ? p.onTableOption({ style: st }) : p.onInsertTable(st))} />
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableCellEdit24Regular />} label={tl("Bedingte Formatierung")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{tl("Regeln zum Hervorheben von Zellen")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onCond("greaterThan")}>{tl("Größer als…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("lessThan")}>{tl("Kleiner als…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("between")}>{tl("Zwischen…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("equal")}>{tl("Gleich…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("text")}>{tl("Textinhalt…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("duplicate")}>{tl("Doppelte Werte…")}</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{tl("Obere/untere Regeln")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onCond("top")}>{tl("Obere 10 Elemente…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("topPercent")}>{tl("Obere 10 %…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("bottom")}>{tl("Untere 10 Elemente…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("bottomPercent")}>{tl("Untere 10 %…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("above")}>{tl("Über dem Durchschnitt…")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("below")}>{tl("Unter dem Durchschnitt…")}</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{tl("Datenbalken")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {BARS.map((b) => (
                      <MenuItem key={b.label} icon={<span style={{ display: "inline-block", width: 16, height: 12, background: `linear-gradient(90deg, ${b.color}, ${b.color}33)`, border: `1px solid ${b.color}` }} />} onClick={() => p.onCond("dataBar", [b.color])}>
                        {b.label}
                      </MenuItem>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{tl("Farbskalen")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {SCALES.map((x) => (
                      <MenuItem key={x.label} icon={<span style={{ display: "inline-block", width: 16, height: 12, background: `linear-gradient(90deg, ${x.colors.join(",")})`, border: "1px solid #ccc" }} />} onClick={() => p.onCond("colorScale", x.colors)}>
                        {x.label}
                      </MenuItem>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
              <MenuDivider />
              <MenuItem onClick={() => p.onCond("formula")}>{tl("Neue Regel mit Formel…")}</MenuItem>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{tl("Regeln löschen")}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onCond("clearSelection")}>{tl("Regeln in ausgewählten Zellen löschen")}</MenuItem>
                    <MenuItem onClick={() => p.onCond("clearSheet")}>{tl("Regeln im gesamten Blatt löschen")}</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <MenuItem onClick={() => p.onCond("manage")}>{tl("Regeln verwalten…")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Zellenformatvorlagen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableEdit24Regular />} label={tl("Zellenformatvorlagen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList style={{ maxHeight: 480, overflowY: "auto" }}>
              {CELL_STYLES.map((c, i) => (
                <span key={i}>
                  {(i === 0 || CELL_STYLES[i - 1].group !== c.group) && <div className="nx-menu-heading">{c.group}</div>}
                  <MenuItem onClick={() => p.onExtra({ cellStyle: i })}>
                    <span style={{ padding: "0 6px", background: c.style.fill ? (c.style.fill.length === 9 ? `${c.style.fill.slice(0, 7)}40` : c.style.fill) : undefined, color: c.style.color, fontWeight: c.style.bold ? 700 : undefined, fontStyle: c.style.italic ? "italic" : undefined, borderBottom: c.style.borderBottom ? "2px solid currentColor" : undefined }}>{c.name}</span>
                  </MenuItem>
                </span>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Zellen")}>
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TableInsertRow20Regular />} label={tl("Einfügen")} text={tl("Einfügen")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TableInsertRow20Regular />} onClick={() => p.onInsert("rows")}>{tl("Zeilen einfügen")}</MenuItem>
                <MenuItem icon={<TableInsertColumn20Regular />} onClick={() => p.onInsert("cols")}>{tl("Spalten einfügen")}</MenuItem>
                <MenuItem icon={<TableStackBelow24Regular />} onClick={() => p.onInsert("sheet")}>{tl("Blatt einfügen")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TableDeleteRow20Regular />} label={tl("Löschen")} text={tl("Löschen")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TableDeleteRow20Regular />} onClick={() => p.onDelete("rows")}>{tl("Zeilen löschen")}</MenuItem>
                <MenuItem icon={<TableDeleteColumn20Regular />} onClick={() => p.onDelete("cols")}>{tl("Spalten löschen")}</MenuItem>
                <MenuItem icon={<Delete24Regular />} onClick={() => p.onDelete("sheet")}>{tl("Blatt löschen")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TableCellEdit24Regular style={{ fontSize: 20 }} />} label={tl("Format")} text={tl("Format")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <div className="nx-menu-heading">{tl("Zellengröße")}</div>
                <MenuItem onClick={() => p.onExtra("rowHeight")}>{tl("Zeilenhöhe…")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("autofitRows")}>{tl("Zeilenhöhe automatisch anpassen")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("colWidth")}>{tl("Spaltenbreite…")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("autofitCols")}>{tl("Spaltenbreite automatisch anpassen")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("defaultWidth")}>{tl("Standardbreite")}</MenuItem>
                <div className="nx-menu-heading">{tl("Sichtbarkeit")}</div>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem>{tl("Ausblenden und Einblenden")}</MenuItem>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem onClick={() => p.onExtra("hideRows")}>{tl("Zeilen ausblenden")}</MenuItem>
                      <MenuItem onClick={() => p.onExtra("hideCols")}>{tl("Spalten ausblenden")}</MenuItem>
                      <MenuItem onClick={() => p.onExtra("hideSheet")}>{tl("Blatt ausblenden")}</MenuItem>
                      <MenuDivider />
                      <MenuItem onClick={() => p.onExtra("unhideRows")}>{tl("Zeilen einblenden")}</MenuItem>
                      <MenuItem onClick={() => p.onExtra("unhideCols")}>{tl("Spalten einblenden")}</MenuItem>
                      {p.extras.hiddenSheets.map((h) => (
                        <MenuItem key={h.index} onClick={() => p.onExtra({ unhideSheet: h.index })}>
                          {tl("Blatt einblenden: {0}", h.name)}
                        </MenuItem>
                      ))}
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <div className="nx-menu-heading">{tl("Blätter organisieren")}</div>
                <MenuItem onClick={() => p.onExtra("renameSheet")}>{tl("Blatt umbenennen")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("moveCopySheet")}>{tl("Blatt verschieben/kopieren…")}</MenuItem>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem>{tl("Registerfarbe")}</MenuItem>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      {["#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0"].map((c) => (
                        <MenuItem key={c} icon={<span style={{ display: "inline-block", width: 14, height: 14, background: c, borderRadius: 2 }} />} onClick={() => p.onExtra({ tabColor: c })}>
                          {c.toUpperCase()}
                        </MenuItem>
                      ))}
                      <MenuItem onClick={() => p.onExtra({ tabColor: null })}>{tl("Keine Farbe")}</MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <div className="nx-menu-heading">{tl("Schutz")}</div>
                <MenuItem onClick={p.onProtectSheet}>{p.sheetProtected ? tl("Blattschutz aufheben…") : tl("Blatt schützen…")}</MenuItem>
                <MenuItem disabled={p.sheetProtected} onClick={() => p.onCellLock("locked")}>
                  {tl("Zelle sperren")}
                  {p.cellLocked ? " ✓" : ""}
                </MenuItem>
                <MenuItem onClick={() => p.onExtra("numberFormat")}>{tl("Zellen formatieren…")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Bearbeiten")}>
        <Rows>
          {autoSum(false)}
          <Row>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<ArrowDown20Regular />} label={tl("Ausfüllen")} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<ArrowDown20Regular />} onClick={() => p.onFill("down")}>{tl("Unten (Strg+U)")}</MenuItem>
                  <MenuItem icon={<ArrowRight20Regular />} onClick={() => p.onFill("right")}>{tl("Rechts (Strg+R)")}</MenuItem>
                  <MenuItem icon={<ArrowUp20Regular />} onClick={() => p.onExtra("fillUp")}>{tl("Oben")}</MenuItem>
                  <MenuItem icon={<ArrowLeft20Regular />} onClick={() => p.onExtra("fillLeft")}>{tl("Links")}</MenuItem>
                  <MenuItem onClick={() => p.onExtra("fillSeries")}>{tl("Reihe…")}</MenuItem>
                  <MenuItem onClick={p.onFlashFill}>{tl("Blitzvorschau")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<Eraser20Regular />} label={tl("Löschen")} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => p.onClear("all")}>{tl("Alle löschen")}</MenuItem>
                  <MenuItem onClick={() => p.onClear("formats")}>{tl("Formate löschen")}</MenuItem>
                  <MenuItem onClick={() => p.onClear("contents")}>{tl("Inhalte löschen")}</MenuItem>
                  <MenuItem onClick={() => p.onExtra("clearNotes")}>{tl("Notizen löschen")}</MenuItem>
                  <MenuItem onClick={() => p.onExtra("clearLinks")}>{tl("Links löschen")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </Row>
        </Rows>
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TextSortAscending20Regular />} label={tl("Sortieren")} text={tl("Sortieren")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TextSortAscending20Regular />} onClick={() => p.onSort(true)}>{tl("Von A bis Z sortieren")}</MenuItem>
                <MenuItem icon={<TextSortDescending20Regular />} onClick={() => p.onSort(false)}>{tl("Von Z bis A sortieren")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("customSort")}>{tl("Benutzerdefiniertes Sortieren…")}</MenuItem>
                <MenuDivider />
                <MenuItem onClick={p.onFilter}>{tl("Filtern")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<Search20Regular />} label={tl("Suchen und Auswählen")} text={tl("Suchen")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem secondaryContent="Strg+F" onClick={p.onFind}>{tl("Schnellsuche")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("find")}>{tl("Suchen…")}</MenuItem>
                <MenuItem secondaryContent="Strg+H" onClick={() => p.onExtra("replace")}>{tl("Ersetzen…")}</MenuItem>
                <MenuItem secondaryContent="Strg+G" onClick={() => p.onExtra("goTo")}>{tl("Gehe zu…")}</MenuItem>
                <MenuDivider />
                <MenuItem onClick={() => p.onExtra({ special: "formulas" })}>{tl("Formeln")}</MenuItem>
                <MenuItem onClick={() => p.onExtra({ special: "notes" })}>{tl("Notizen")}</MenuItem>
                <MenuItem onClick={() => p.onExtra({ special: "conditional" })}>{tl("Bedingte Formatierung")}</MenuItem>
                <MenuItem onClick={() => p.onExtra({ special: "constants" })}>{tl("Konstanten")}</MenuItem>
                <MenuItem onClick={() => p.onExtra({ special: "validation" })}>{tl("Datenüberprüfung")}</MenuItem>
                <MenuItem onClick={() => p.onExtra("goTo")}>{tl("Inhalte auswählen…")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
      </RibbonGroup>
    </>
  );

  const insert = (
    <>
      <RibbonGroup label={tl("Zellen")}>
        <BigButton icon={<TableInsertRow20Regular style={{ fontSize: 26 }} />} label={tl("Zeilen")} onClick={() => p.onInsert("rows")} />
        <BigButton icon={<TableInsertColumn20Regular style={{ fontSize: 26 }} />} label={tl("Spalten")} onClick={() => p.onInsert("cols")} />
        <BigButton icon={<TableStackBelow24Regular />} label={tl("Blatt")} onClick={() => p.onInsert("sheet")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Tabellen")}>
        <BigButton icon={<Table24Regular />} label={tl("PivotTable")} onClick={p.onPivot} />
        <BigButton icon={<DataBarVerticalAdd24Regular />} label={tl("PivotChart")} onClick={() => p.onExtra("pivotChart")} />
        <BigButton icon={<TableSimple24Regular />} label={tl("Tabelle")} onClick={() => p.onInsertTable()} />
      </RibbonGroup>
      <RibbonGroup label={tl("Illustrationen")}>
        <BigButton icon={<Image24Regular />} label={tl("Bild")} onClick={p.onImage} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Shapes24Regular />} label={tl("Formen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {SHAPE_KINDS.map(([k, l]) => (
                <MenuItem key={k} onClick={() => p.onExtra({ shape: k })}>{l}</MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<Icons24Regular />} label={tl("Piktogramme")} onClick={() => p.onExtra("icons")} />
        <BigButton icon={<Screenshot24Regular />} label={tl("Screenshot")} onClick={() => p.onExtra("screenshot")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Text")}>
        <BigButton icon={<Textbox24Regular />} label={tl("Textfeld")} onClick={() => p.onExtra("textBox")} />
        <BigButton icon={<TextEffects24Regular />} label={tl("WordArt")} onClick={() => p.onExtra("wordart")} />
        <BigButton icon={<DocumentSignature24Regular />} label={tl("Signaturzeile")} onClick={() => p.onExtra("signature")} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Symbols24Regular />} label={tl("Symbol")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 30px)", gap: 2, padding: 4 }}>
              {SYMBOLS.map((c) => (
                <button key={c} className="nx-symbol-btn" onClick={() => p.onExtra({ symbol: c })}>
                  {c}
                </button>
              ))}
            </div>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Filter")}>
        <BigButton icon={<FilterAdd24Regular />} label={tl("Datenschnitt")} onClick={() => p.onExtra("slicer")} />
        <BigButton icon={<Timeline24Regular />} label={tl("Zeitachse")} onClick={() => p.onExtra("timeline")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Steuerelemente")}>
        <BigButton icon={<CheckboxChecked24Regular />} label={tl("Kontrollkästchen")} onClick={() => p.onExtra("checkbox")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Diagramme")}>
        {CHART_KINDS.slice(0, 5).map((k) => (
          <BigButton key={k.kind} icon={CHART_ICONS[k.kind]} label={k.label} onClick={() => p.onChart(k.kind)} />
        ))}
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataScatter24Regular />} label={tl("Weitere")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {CHART_KINDS.slice(5).map((k) => (
                <MenuItem key={k.kind} icon={CHART_ICONS[k.kind]} onClick={() => p.onChart(k.kind)}>
                  {k.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Sparklines")}>
        <BigButton icon={<DataTrending24Regular />} label={tl("Linie")} onClick={() => p.onSparkline("line")} />
        <BigButton icon={<DataBarVertical24Regular />} label={tl("Säule")} onClick={() => p.onSparkline("column")} />
        <BigButton icon={<DataUsage24Regular />} label="Gewinn/Verlust" onClick={() => p.onSparkline("stacked")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Links")}>
        <BigButton icon={<Link24Regular />} label={tl("Link")} onClick={p.onLink} />
      </RibbonGroup>
      <RibbonGroup label={tl("Funktionen")}>
        {functionMenu(true)}
        {autoSum(true)}
      </RibbonGroup>
      <RibbonGroup label={tl("Datum und Uhrzeit")}>
        <BigButton icon={<CalendarLtr24Regular />} label={tl("Heute")} onClick={() => p.onDate(false)} />
        <BigButton icon={<Clock24Regular />} label={tl("Jetzt")} onClick={() => p.onDate(true)} />
      </RibbonGroup>
    </>
  );

  const formulas = (
    <>
      <RibbonGroup label={tl("Funktionsbibliothek")}>
        {autoSum(true)}
        {FUNCTION_CATEGORIES.slice(0, 6).map((cat) => (
          <Menu key={cat.name}>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<Fx />} label={cat.name} menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList style={{ maxHeight: 420, overflowY: "auto" }}>
                {cat.fns.map((f) => (
                  <MenuItem key={f} onClick={() => p.onFunction(f)}>
                    {germanName(f)}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        ))}
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Fx />} label={tl("Weitere Funktionen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {FUNCTION_CATEGORIES.slice(6).map((cat) => (
                <Menu key={cat.name}>
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem>{cat.name}</MenuItem>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList style={{ maxHeight: 420, overflowY: "auto" }}>
                      {cat.fns.map((f) => (
                        <MenuItem key={f} onClick={() => p.onFunction(f)}>
                          {germanName(f)}
                        </MenuItem>
                      ))}
                    </MenuList>
                  </MenuPopover>
                </Menu>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Definierte Namen")}>
        <BigButton icon={<TagMultiple24Regular />} label={tl("Namens-Manager")} onClick={p.onNames} />
        <Rows three>
          <SmallButton icon={<Tag24Regular style={{ fontSize: 20 }} />} label={tl("Namen definieren")} text={tl("Namen definieren")} onClick={p.onDefineName} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TagSearch24Regular style={{ fontSize: 20 }} />} label={tl("In Formel verwenden")} text={tl("In Formel verwenden")} disabled={!p.extras.names.length} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {p.extras.names.map((n) => (
                  <MenuItem key={n} onClick={() => p.onExtra({ useName: n })}>
                    {n}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <SmallButton icon={<TableSearch24Regular style={{ fontSize: 20 }} />} label={tl("Aus Auswahl erstellen")} text={tl("Aus Auswahl erstellen")} onClick={() => p.onExtra("createNames")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Formelüberwachung")}>
        <Rows three>
          <SmallButton icon={<ArrowStepInRight24Regular style={{ fontSize: 20 }} />} label={tl("Spur zum Vorgänger")} text={tl("Spur zum Vorgänger")} onClick={() => p.onTrace("pre")} />
          <SmallButton icon={<ArrowStepOut24Regular style={{ fontSize: 20 }} />} label={tl("Spur zum Nachfolger")} text={tl("Spur zum Nachfolger")} onClick={() => p.onTrace("dep")} />
          <SmallButton icon={<Eraser24Regular style={{ fontSize: 20 }} />} label={tl("Pfeile entfernen")} text={tl("Pfeile entfernen")} disabled={!p.hasArrows} onClick={() => p.onTrace("clear")} />
        </Rows>
        <Rows three>
          <SmallButton icon={<MathFormula24Regular style={{ fontSize: 20 }} />} label={tl("Formeln anzeigen")} text={tl("Formeln anzeigen")} shortcut="Strg+#" pressed={p.showFormulas} onClick={p.onShowFormulas} />
          <SmallButton icon={<ErrorCircle24Regular style={{ fontSize: 20 }} />} label={tl("Fehlerüberprüfung")} text={tl("Fehlerüberprüfung")} onClick={p.onErrorCheck} />
          <SmallButton icon={<Calculator24Regular style={{ fontSize: 20 }} />} label={tl("Formel auswerten")} text={tl("Formel auswerten")} onClick={p.onEvaluate} />
        </Rows>
        <BigButton icon={<Eye24Regular />} label={tl("Überwachungsfenster")} pressed={p.extras.watch} onClick={() => p.onExtra("watch")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Berechnung")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<CalculatorMultiple24Regular />} label={tl("Berechnungsoptionen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onExtra("calcAuto")}>
                {tl("Automatisch")}
                {!p.extras.calcManual ? " ✓" : ""}
              </MenuItem>
              <MenuItem onClick={() => p.onExtra("calcManual")}>
                {tl("Manuell")}
                {p.extras.calcManual ? " ✓" : ""}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Rows>
          <SmallButton icon={<ArrowSync24Regular style={{ fontSize: 20 }} />} label={tl("Neu berechnen")} text={tl("Neu berechnen")} shortcut="F9" onClick={p.onRecalc} />
          <SmallButton icon={<ArrowSync24Regular style={{ fontSize: 20 }} />} label={tl("Blatt berechnen")} text={tl("Blatt berechnen")} shortcut="Umschalt+F9" onClick={() => p.onExtra("calcSheet")} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const data = (
    <>
      <RibbonGroup label={tl("Daten abrufen und transformieren")}>
        <BigButton icon={<ArrowDownload24Regular />} label={tl("Daten abrufen")} onClick={() => p.onExtra("getData")} />
        <Rows>
          <SmallButton icon={<ArrowClockwise24Regular style={{ fontSize: 20 }} />} label={tl("Alle aktualisieren")} text={tl("Alle aktualisieren")} disabled={!p.queries.length} onClick={() => p.onExtra("refreshAll")} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TableLightning24Regular style={{ fontSize: 20 }} />} label={tl("Abfragen bearbeiten")} text={tl("Abfragen")} disabled={!p.queries.length} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {p.queries.map((q) => (
                  <MenuItem key={q} onClick={() => p.onExtra({ query: q })}>{q}</MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Sortieren")}>
        <BigButton icon={<TextSortAscending24Regular />} label={tl("A bis Z")} onClick={() => p.onSort(true)} />
        <BigButton icon={<TextSortDescending24Regular />} label={tl("Z bis A")} onClick={() => p.onSort(false)} />
        <BigButton icon={<ArrowSortDownLines24Regular />} label={tl("Sortieren")} onClick={() => p.onExtra("customSort")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Sortieren und Filtern")}>
        <BigButton icon={<Filter24Regular />} label={tl("Filtern")} pressed={p.filterOn} onClick={p.onFilter} />
        <Rows>
          <SmallButton icon={<FilterDismiss24Regular style={{ fontSize: 20 }} />} label={tl("Löschen")} text={tl("Löschen")} disabled={!p.filterOn} onClick={p.onFilterClear} />
          <SmallButton icon={<ArrowRepeatAll24Regular style={{ fontSize: 20 }} />} label={tl("Erneut anwenden")} text={tl("Erneut anwenden")} disabled={!p.filterOn} onClick={p.onFilterReapply} />
          <SmallButton icon={<FilterSync24Regular style={{ fontSize: 20 }} />} label={tl("Erweitert (Spezialfilter)")} text={tl("Erweitert")} onClick={() => p.onExtra("advancedFilter")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Prognose")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataWhisker24Regular />} label={tl("Was-wäre-wenn-Analyse")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onWhatIf("scenario")}>{tl("Szenario-Manager…")}</MenuItem>
              <MenuItem onClick={() => p.onWhatIf("goal")}>{tl("Zielwertsuche…")}</MenuItem>
              <MenuItem onClick={() => p.onWhatIf("table")}>{tl("Datentabelle…")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<Forecast24Regular />} label={tl("Prognoseblatt")} onClick={() => p.onExtra("forecastSheet")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Analyse")}>
        <BigButton icon={<DataUsage24Regular />} label={tl("Solver")} onClick={p.onSolver} />
      </RibbonGroup>
      <RibbonGroup label={tl("Datentools")}>
        <BigButton icon={<TableSettings24Regular />} label={tl("Konsolidieren")} onClick={() => p.onExtra("consolidate")} />
        <BigButton icon={<TextColumnTwo24Regular />} label={tl("Text in Spalten")} onClick={p.onTextToColumns} />
        <BigButton icon={<Flash24Regular />} label={tl("Blitzvorschau")} onClick={p.onFlashFill} />
        <BigButton icon={<Highlight20Regular style={{ fontSize: 26 }} />} label={tl("Duplikate entfernen")} onClick={p.onDedupe} />
        <BigButton icon={<ShieldCheckmark24Regular />} label={tl("Datenüberprüfung")} onClick={p.onValidation} />
      </RibbonGroup>
      <RibbonGroup label={tl("Gliederung")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Group24Regular />} label={tl("Gruppieren")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onGroup("rows", true)}>{tl("Zeilen gruppieren")}</MenuItem>
              <MenuItem onClick={() => p.onGroup("cols", true)}>{tl("Spalten gruppieren")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<GroupDismiss24Regular />} label={tl("Gruppierung aufheben")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onGroup("rows", false)}>{tl("Zeilengruppierung aufheben")}</MenuItem>
              <MenuItem onClick={() => p.onGroup("cols", false)}>{tl("Spaltengruppierung aufheben")}</MenuItem>
              <MenuDivider />
              <MenuItem onClick={p.onOutlineClear}>{tl("Gliederung entfernen")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<TableSettings24Regular />} label={tl("Teilergebnis")} onClick={() => p.onExtra("subtotal")} />
      </RibbonGroup>
    </>
  );

  const pg = p.page;
  const fitMenu = (k: "fitWidth" | "fitHeight", label: string) => (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>
          <SmallButton icon={<PageFit24Regular style={{ fontSize: 20 }} />} label={label} text={`${label}: ${pg[k] ? (pg[k] === 1 ? tl("1 Seite") : tl("{0} Seiten", pg[k])) : tl("Automatisch")}`} menu />
        </span>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <MenuItem
              key={n}
              onClick={() => {
                const other = k === "fitWidth" ? "fitHeight" : "fitWidth";
                const next = { ...pg, [k]: n } as PageSetup;
                // Both automatic: back to plain scaling.
                p.onPage(!next[k] && !next[other] ? { fitWidth: undefined, fitHeight: undefined } : { [k]: n, [other]: next[other] ?? 0 });
              }}
            >
              {n ? (n === 1 ? tl("1 Seite") : tl("{0} Seiten", n)) : tl("Automatisch")}
              {(pg[k] ?? 0) === n && (pg.fitWidth !== undefined || pg.fitHeight !== undefined || !n) ? " ✓" : ""}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  const layout = (
    <>
      <RibbonGroup label={tl("Designs")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TextFont24Regular />} label={tl("Schriftarten")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {["Aptos Narrow", "Calibri", "Arial", "Cambria", "Georgia", "Segoe UI", "Times New Roman", "Trebuchet MS", "Verdana"].map((f) => (
                <MenuItem key={f} onClick={() => p.onExtra({ themeFont: f })}>
                  <span style={{ fontFamily: f }}>{f}</span>
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Seite einrichten")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentMargins24Regular />} label={tl("Seitenränder")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {MARGIN_PRESETS.map((m) => (
                <MenuItem key={m.id} onClick={() => p.onPage(m.m)}>
                  {m.label} {tl("– oben")} {String(m.m.marginTop).replace(".", ",")} {tl("cm, links")} {String(m.m.marginLeft).replace(".", ",")} {tl("cm")}
                  {pg.marginTop === m.m.marginTop && pg.marginLeft === m.m.marginLeft ? " ✓" : ""}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem onClick={() => p.onPageDialog("margins")}>{tl("Benutzerdefinierte Seitenränder…")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Orientation24Regular />} label={tl("Ausrichtung")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onPage({ landscape: false })}>{tl("Hochformat")}{!pg.landscape ? " ✓" : ""}</MenuItem>
              <MenuItem onClick={() => p.onPage({ landscape: true })}>{tl("Querformat")}{pg.landscape ? " ✓" : ""}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentOnePage24Regular />} label={tl("Format")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {PAPERS.map((x) => (
                <MenuItem key={x.id} onClick={() => p.onPage({ paper: x.id })}>
                  {x.label}
                  {pg.paper === x.id ? " ✓" : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Print24Regular />} label={tl("Druckbereich")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onPrintArea(true)}>{tl("Druckbereich festlegen")}</MenuItem>
              <MenuItem disabled={!pg.printArea} onClick={() => p.onPrintArea(false)}>
                {tl("Druckbereich aufheben")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentPageBreak24Regular />} label={tl("Umbrüche")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onPageBreak("insert")}>{tl("Seitenumbruch einfügen")}</MenuItem>
              <MenuItem onClick={() => p.onPageBreak("remove")}>{tl("Seitenumbruch entfernen")}</MenuItem>
              <MenuItem disabled={!pg.rowBreaks?.length && !pg.colBreaks?.length} onClick={() => p.onPageBreak("reset")}>
                {tl("Alle Seitenumbrüche zurücksetzen")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<DocumentTable24Regular />} label={tl("Drucktitel")} onClick={() => p.onPageDialog("sheet")} />
      </RibbonGroup>
      <RibbonGroup label={tl("An Format anpassen")}>
        <Rows three>
          {fitMenu("fitWidth", tl("Breite"))}
          {fitMenu("fitHeight", tl("Höhe"))}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <SmallButton icon={<ZoomIn20Regular />} label={tl("Skalierung")} text={tl("Skalierung: {0}", pg.fitWidth !== undefined || pg.fitHeight !== undefined ? "angepasst" : `${pg.scale} %`)} menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {[50, 75, 85, 100, 115, 125, 150, 200].map((n) => (
                  <MenuItem key={n} onClick={() => p.onPage({ scale: n, fitWidth: undefined, fitHeight: undefined })}>
                    {n} %{pg.scale === n && pg.fitWidth === undefined && pg.fitHeight === undefined ? " ✓" : ""}
                  </MenuItem>
                ))}
                <MenuDivider />
                <MenuItem onClick={() => p.onPageDialog("page")}>{tl("Benutzerdefiniert…")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Blattoptionen")}>
        <Rows>
          <SmallButton icon={<Grid24Regular style={{ fontSize: 20 }} />} label={tl("Gitternetzlinien drucken")} text={tl("Gitternetzlinien drucken")} pressed={pg.gridlines} onClick={() => p.onPage({ gridlines: !pg.gridlines })} />
          <SmallButton icon={<TableStackBelow24Regular style={{ fontSize: 20 }} />} label={tl("Überschriften drucken")} text={tl("Überschriften drucken")} pressed={pg.headings} onClick={() => p.onPage({ headings: !pg.headings })} />
        </Rows>
        <Rows>
          <SmallButton icon={<Grid24Regular style={{ fontSize: 20 }} />} label={tl("Gitternetzlinien anzeigen")} text={tl("Gitternetzlinien anzeigen")} pressed={p.showGrid} onClick={p.onGrid} />
          <SmallButton icon={<TableStackBelow24Regular style={{ fontSize: 20 }} />} label={tl("Überschriften anzeigen")} text={tl("Überschriften anzeigen")} pressed={p.extras.headings} onClick={() => p.onExtra("headings")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Kopf- und Fußzeile")}>
        <BigButton icon={<DocumentHeaderFooter24Regular />} label={tl("Kopf- und Fußzeile")} onClick={() => p.onPageDialog("hf")} />
        <BigButton icon={<DocumentMargins24Regular />} label={tl("Seite einrichten")} onClick={() => p.onPageDialog("page")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Anordnen")}>
        <Rows>
          <SmallButton icon={<ArrowUp24Regular style={{ fontSize: 20 }} />} label={tl("Ebene nach vorne")} text={tl("Ebene nach vorne")} disabled={!p.objectSelected} onClick={() => p.onExtra("bringForward")} />
          <SmallButton icon={<ArrowDown24Regular style={{ fontSize: 20 }} />} label={tl("Ebene nach hinten")} text={tl("Ebene nach hinten")} disabled={!p.objectSelected} onClick={() => p.onExtra("sendBackward")} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const review = (
    <>
      <RibbonGroup label={tl("Dokumentprüfung")}>
        <BigButton icon={<TextGrammarCheckmark24Regular />} label={tl("Rechtschreibung")} onClick={() => p.onExtra("spelling")} />
        <BigButton icon={<DocumentTable24Regular />} label={tl("Arbeitsmappenstatistik")} onClick={() => p.onExtra("stats")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Kommentare")}>
        <BigButton icon={<CommentAdd24Regular />} label={tl("Neuer Kommentar")} onClick={() => p.onExtra("newComment")} />
        <BigButton icon={<Comment24Regular />} label={tl("Kommentare anzeigen")} pressed={p.commentsOpen} onClick={() => p.onExtra("comments")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Notizen")}>
        <BigButton icon={p.hasNote ? <NoteEdit24Regular /> : <NoteAdd24Regular />} label={p.hasNote ? tl("Notiz bearbeiten") : tl("Neue Notiz")} onClick={() => p.onNote(p.hasNote ? "edit" : "new")} />
        <Rows three>
          <SmallButton icon={<Delete24Regular style={{ fontSize: 20 }} />} label={tl("Löschen")} text={tl("Löschen")} disabled={!p.hasNote} onClick={() => p.onNote("delete")} />
          <SmallButton icon={<ArrowPrevious24Regular style={{ fontSize: 20 }} />} label={tl("Vorherige")} text={tl("Vorherige")} onClick={() => p.onNote("prev")} />
          <SmallButton icon={<ArrowNext24Regular style={{ fontSize: 20 }} />} label={tl("Nächste")} text={tl("Nächste")} onClick={() => p.onNote("next")} />
        </Rows>
        <Rows>
          <SmallButton icon={<NoteEdit24Regular style={{ fontSize: 20 }} />} label={tl("Notiz ein-/ausblenden")} text="Ein-/ausblenden" disabled={!p.hasNote} onClick={() => p.onNote("toggle")} />
          <SmallButton icon={<CommentMultiple24Regular style={{ fontSize: 20 }} />} label={tl("Alle Notizen anzeigen")} text={tl("Alle anzeigen")} pressed={p.notesShown} onClick={() => p.onNote("showAll")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Barrierefreiheit")}>
        <BigButton icon={<AccessibilityCheckmark24Regular />} label={tl("Barrierefreiheit überprüfen")} pressed={p.a11yOpen} onClick={p.onA11y} />
      </RibbonGroup>
      <RibbonGroup label={tl("Schützen")}>
        <BigButton icon={<ShieldLock24Regular />} label={p.sheetProtected ? tl("Blattschutz aufheben") : tl("Blatt schützen")} pressed={p.sheetProtected} onClick={p.onProtectSheet} />
        <BigButton icon={<DocumentLock24Regular />} label={tl("Arbeitsmappe schützen")} pressed={p.bookProtected} onClick={p.onProtectBook} />
        <Rows>
          <SmallButton icon={<LockClosed24Regular style={{ fontSize: 20 }} />} label={tl("Zelle sperren")} text={tl("Zelle sperren")} pressed={p.cellLocked} disabled={p.sheetProtected} onClick={() => p.onCellLock("locked")} />
          <SmallButton icon={<EyeOff24Regular style={{ fontSize: 20 }} />} label={tl("Formel ausblenden")} text={tl("Formel ausblenden")} pressed={p.formulaHidden} disabled={p.sheetProtected} onClick={() => p.onCellLock("hideFormula")} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const view = (
    <>
      <RibbonGroup label={tl("Arbeitsmappenansichten")}>
        <BigButton icon={<Table24Regular />} label={tl("Normal")} pressed={p.extras.view === "normal"} onClick={() => p.onExtra({ view: "normal" })} />
        <BigButton icon={<DocumentPageBreak24Regular />} label={tl("Umbruchvorschau")} pressed={p.extras.view === "breaks"} onClick={() => p.onExtra({ view: "breaks" })} />
        <BigButton icon={<DocumentOnePage24Regular />} label={tl("Seitenlayout")} pressed={p.extras.view === "layout"} onClick={() => p.onExtra({ view: "layout" })} />
      </RibbonGroup>
      <RibbonGroup label={tl("Blattansicht")}>
        <BigButton icon={<Eye24Regular />} label={tl("Ansichten")} onClick={() => p.onExtra("views")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Fenster")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableFreezeColumnAndRow24Regular />} label={tl("Fixieren")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {p.freeze.rows || p.freeze.cols ? <MenuItem onClick={() => p.onFreeze("none")}>{tl("Fixierung aufheben")}</MenuItem> : <MenuItem onClick={() => p.onFreeze("selection")}>{tl("Fenster fixieren")}</MenuItem>}
              <MenuItem onClick={() => p.onFreeze("row")}>{tl("Oberste Zeile fixieren")}</MenuItem>
              <MenuItem onClick={() => p.onFreeze("col")}>{tl("Erste Spalte fixieren")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Anzeigen")}>
        <Menu checkedValues={{ v: p.showGrid ? ["grid"] : [] }}>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Grid24Regular />} label={tl("Gitternetz")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList checkedValues={{ v: p.showGrid ? ["grid"] : [] }}>
              <MenuItemCheckbox name="v" value="grid" onClick={p.onGrid}>
                {tl("Gitternetzlinien")}
              </MenuItemCheckbox>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Rows>
          <SmallButton icon={<Ruler24Regular style={{ fontSize: 20 }} />} label={tl("Bearbeitungsleiste")} text={tl("Bearbeitungsleiste")} pressed={p.extras.formulaBar} onClick={() => p.onExtra("formulaBar")} />
          <SmallButton icon={<TableStackBelow24Regular style={{ fontSize: 20 }} />} label={tl("Überschriften")} text={tl("Überschriften")} pressed={p.extras.headings} onClick={() => p.onExtra("headings")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Zoom")}>
        <BigButton icon={<span style={{ fontSize: 15, fontWeight: 600 }}>100</span>} label="100 %" onClick={() => p.onZoom(1)} />
        <Rows>
          <SmallButton icon={<ZoomIn20Regular />} label={tl("Vergrößern")} onClick={() => p.onZoom(Math.min(4, p.zoom + 0.1))} />
          <SmallButton icon={<ZoomOut20Regular />} label={tl("Verkleinern")} onClick={() => p.onZoom(Math.max(0.3, p.zoom - 0.1))} />
        </Rows>
        <BigButton icon={<ZoomFit24Regular />} label={tl("Auswahl vergrößern")} onClick={() => p.onExtra("zoomSelection")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Makros")}>
        <BigButton icon={<Code24Regular />} label={tl("Makros")} onClick={p.onMacros} />
        <BigButton icon={p.recording ? <RecordStop24Regular /> : <Record24Regular />} label={p.recording ? tl("Aufzeichnung beenden") : tl("Makro aufzeichnen")} pressed={p.recording} onClick={p.onRecord} />
      </RibbonGroup>
      <RibbonGroup label={tl("Design")}>
        <Rows>
          <SmallButton icon={<DarkTheme20Regular />} label={mode === "dark" ? tl("Helles Design") : tl("Dunkles Design")} text={mode === "dark" ? tl("Helles Design") : tl("Dunkles Design")} onClick={toggle} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const t = p.table;
  const tableTab = t ? (
    <>
      <RibbonGroup label={tl("Eigenschaften")}>
        <Rows>
          <span style={{ fontSize: 12 }}>{tl("Tabellenname:")}</span>
          <TableNameInput key={t.name} name={t.name} onRename={p.onTableRename} />
          <SmallButton icon={<TableResizeColumn24Regular style={{ fontSize: 20 }} />} label={tl("Tabellengröße ändern")} text={tl("Tabellengröße ändern")} onClick={p.onTableResize} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Tools")}>
        <BigButton icon={<Table24Regular />} label={tl("Mit PivotTable zusammenfassen")} onClick={p.onPivot} />
        <BigButton icon={<TableDismiss24Regular />} label={tl("In Bereich konvertieren")} onClick={p.onTableConvert} />
      </RibbonGroup>
      <RibbonGroup label={tl("Optionen für Tabellenformat")}>
        <Rows>
          <SmallButton icon={<TableBottomRow24Regular style={{ fontSize: 20 }} />} label={tl("Ergebniszeile")} text={tl("Ergebniszeile")} pressed={t.totalsRow} onClick={() => p.onTableTotals(!t.totalsRow)} />
          <SmallButton icon={<Filter24Regular style={{ fontSize: 20 }} />} label={tl("Schaltfläche „Filter“")} text={tl("Schaltfläche „Filter“")} pressed={t.filter} onClick={() => p.onTableOption({ filter: !t.filter })} />
        </Rows>
        <Rows>
          <SmallButton label={tl("Gebänderte Zeilen")} text={tl("Gebänderte Zeilen")} pressed={t.bandedRows} onClick={() => p.onTableOption({ bandedRows: !t.bandedRows })} />
          <SmallButton label={tl("Gebänderte Spalten")} text={tl("Gebänderte Spalten")} pressed={t.bandedCols} onClick={() => p.onTableOption({ bandedCols: !t.bandedCols })} />
        </Rows>
        <Rows>
          <SmallButton label={tl("Erste Spalte")} text={tl("Erste Spalte")} pressed={t.firstCol} onClick={() => p.onTableOption({ firstCol: !t.firstCol })} />
          <SmallButton label={tl("Letzte Spalte")} text={tl("Letzte Spalte")} pressed={t.lastCol} onClick={() => p.onTableOption({ lastCol: !t.lastCol })} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Tabellenformatvorlagen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableSimple24Regular />} label={tl("Formatvorlagen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <TableStyleGallery current={t.style} onPick={(st) => p.onTableOption({ style: st })} />
          </MenuPopover>
        </Menu>
      </RibbonGroup>
    </>
  ) : null;

  const c = p.chart;
  const chartTab = c ? (
    <>
      <RibbonGroup label={tl("Typ")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={CHART_ICONS[c.kind]} label={tl("Diagrammtyp ändern")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {CHART_KINDS.map((k) => (
                <MenuItem key={k.kind} icon={CHART_ICONS[k.kind]} onClick={() => p.onChartPatch({ kind: k.kind })}>
                  {k.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      {c.kind === "combo" && (
        <RibbonGroup label={tl("Kombi")}>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<DataBarVerticalAdd24Regular />} label={tl("Datenreihen")} menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {c.series.map((sr, i) => (
                  <Menu key={i}>
                    <MenuTrigger disableButtonEnhancement>
                      <MenuItem>{sr.name ?? tl("Reihe {0}", i + 1)}</MenuItem>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        {([["column", tl("Gruppierte Säulen")], ["line", tl("Linie")], ["area", tl("Fläche")]] as const).map(([k, label]) => (
                          <MenuItem key={k} onClick={() => p.onChartPatch({ series: c.series.map((x, j) => (j === i ? { ...x, kind: k } : { ...x, kind: x.kind ?? (j === 0 ? "column" : "line") })) })}>
                            {label}
                            {(sr.kind ?? (i === 0 ? "column" : "line")) === k ? " ✓" : ""}
                          </MenuItem>
                        ))}
                        <MenuDivider />
                        <MenuItem onClick={() => p.onChartPatch({ series: c.series.map((x, j) => (j === i ? { ...x, secondary: !x.secondary } : x)) })}>
                          {tl("Sekundärachse")}{sr.secondary ? " ✓" : ""}
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </RibbonGroup>
      )}
      {c.kind === "histogram" && (
        <RibbonGroup label={tl("Histogramm")}>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<DataHistogram24Regular />} label={tl("Klassen")} menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {[undefined, 5, 10, 15, 20, 30].map((n) => (
                  <MenuItem key={n ?? 0} onClick={() => p.onChartPatch({ binCount: n, binWidth: undefined })}>
                    {n ? `${n} Klassen` : tl("Automatisch")}
                    {c.binCount === n && !c.binWidth ? " ✓" : ""}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </RibbonGroup>
      )}
      {c.kind === "waterfall" && (
        <RibbonGroup label={tl("Wasserfall")}>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<DataWaterfall24Regular />} label={tl("Als Summe festlegen")} menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList style={{ maxHeight: 320, overflowY: "auto" }}>
                {(c.series[0]?.categories.length ? c.series[0].categories : (c.series[0]?.values ?? []).map((_, i) => String(i + 1))).map((cat, i) => (
                  <MenuItem key={i} onClick={() => p.onChartPatch({ subtotals: (c.subtotals ?? []).includes(i) ? (c.subtotals ?? []).filter((x) => x !== i) : [...(c.subtotals ?? []), i].sort((a, b) => a - b) })}>
                    {cat}
                    {(c.subtotals ?? []).includes(i) ? " ✓" : ""}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </RibbonGroup>
      )}
      <RibbonGroup label={tl("Daten")}>
        <BigButton icon={<ArrowSwap24Regular />} label={tl("Zeile/Spalte wechseln")} onClick={p.onChartSwap} />
        <BigButton icon={<TableCellEdit24Regular />} label={tl("Daten auswählen")} onClick={p.onChartData} />
      </RibbonGroup>
      <RibbonGroup label={tl("Diagrammelemente")}>
        <BigButton icon={<TextT24Regular />} label={tl("Diagrammtitel")} onClick={p.onChartTitle} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TagMultiple24Regular />} label={tl("Legende")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {[
                [undefined, tl("Keine")],
                ["r", tl("Rechts")],
                ["b", tl("Unten")],
                ["t", tl("Oben")],
                ["l", tl("Links")],
              ].map(([v, label]) => (
                <MenuItem key={label} onClick={() => p.onChartPatch({ legend: v })}>
                  {label}
                  {(c.legend ?? undefined) === v ? " ✓" : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <Rows>
          <SmallButton icon={<NumberSymbol20Regular />} label={tl("Datenbeschriftungen")} text={tl("Datenbeschriftungen")} pressed={!!c.labels} onClick={() => p.onChartPatch({ labels: !c.labels })} />
          <SmallButton icon={<TableStackBelow24Regular style={{ fontSize: 20 }} />} label={tl("Gestapelt")} text={tl("Gestapelt")} pressed={!!c.stacked} disabled={!["column", "bar", "line", "area"].includes(c.kind)} onClick={() => p.onChartPatch({ stacked: !c.stacked })} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Anordnen")}>
        <BigButton icon={<Delete24Regular />} label={tl("Löschen")} onClick={p.onDeleteObject} />
      </RibbonGroup>
    </>
  ) : p.objectSelected ? (
    <RibbonGroup label={tl("Anordnen")}>
      {(p.objectKind === "shape" || p.objectKind === "slicer") && <BigButton icon={<Shapes24Regular />} label={tl("Formatieren")} onClick={() => p.onExtra("formatObject")} />}
      <BigButton icon={<Delete24Regular />} label={tl("Löschen")} onClick={p.onDeleteObject} />
    </RibbonGroup>
  ) : null;

  return (
    <OfficeRibbon
      color={p.color}
      onFile={p.onFile}
      active={p.tab}
      onTab={p.onTab}
      tabs={[
        { id: "home", label: tl("Start"), content: home },
        { id: "insert", label: tl("Einfügen"), content: insert },
        { id: "layout", label: tl("Seitenlayout"), content: layout },
        { id: "formulas", label: tl("Formeln"), content: formulas },
        { id: "data", label: tl("Daten"), content: data },
        { id: "review", label: tl("Überprüfen"), content: review },
        { id: "view", label: tl("Ansicht"), content: view },
        ...(chartTab ? [{ id: "object", label: c ? tl("Diagrammentwurf") : p.objectKind === "slicer" ? tl("Datenschnitt") : p.objectKind === "shape" ? tl("Formformat") : tl("Bildformat"), contextual: true, content: chartTab }] : []),
        ...(tableTab && !chartTab ? [{ id: "table", label: tl("Tabellenentwurf"), contextual: true, content: tableTab }] : []),
      ]}
    />
  );
}

function TableNameInput({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [v, setV] = useState(name);
  return (
    <Input
      size="small"
      value={v}
      style={{ width: 130 }}
      aria-label={tl("Tabellenname")}
      onChange={(_, d) => setV(d.value)}
      onBlur={() => v !== name && onRename(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") setV(name);
      }}
    />
  );
}
