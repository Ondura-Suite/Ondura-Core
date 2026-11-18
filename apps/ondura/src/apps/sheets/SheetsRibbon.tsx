import { useState } from "react";
import {
  Combobox,
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
  DataHistogram24Regular,
  DataFunnel24Regular,
  TableResizeColumn24Regular,
  TableDismiss24Regular,
  TableBottomRow24Regular,
} from "@fluentui/react-icons";
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
};

export type CondAction = CondKind | "dataBar" | "colorScale" | "clearSelection" | "clearSheet" | "manage";

const BARS = [
  { label: "Blau", color: "#638ec6" },
  { label: "Grün", color: "#63be7b" },
  { label: "Rot", color: "#ff555a" },
  { label: "Orange", color: "#ffb628" },
  { label: "Hellblau", color: "#008aef" },
  { label: "Lila", color: "#d6007b" },
];
const SCALES = [
  { label: "Grün – Gelb – Rot", colors: ["#63be7b", "#ffeb84", "#f8696b"] },
  { label: "Rot – Gelb – Grün", colors: ["#f8696b", "#ffeb84", "#63be7b"] },
  { label: "Grün – Weiß", colors: ["#ffffff", "#63be7b"] },
  { label: "Rot – Weiß", colors: ["#ffffff", "#f8696b"] },
  { label: "Weiß – Blau", colors: ["#ffffff", "#5a8ac6"] },
  { label: "Blau – Weiß – Rot", colors: ["#5a8ac6", "#fcfcff", "#f8696b"] },
];

const Sigma = ({ size = 20 }: { size?: number }) => <span style={{ fontSize: size, fontWeight: 600, lineHeight: 1, fontFamily: "Cambria, Georgia, serif" }}>Σ</span>;
const Fx = ({ size = 22 }: { size?: number }) => <span style={{ fontSize: size * 0.8, fontStyle: "italic", fontWeight: 600, fontFamily: "Cambria, Georgia, serif" }}>fx</span>;

export type BorderPreset = "all" | "outside" | "none" | "top" | "bottom" | "left" | "right" | "bottomDouble" | "bottomThick";

export interface SheetsRibbonProps {
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
  const fmt = NUMBER_FORMATS.find((f) => (f.code ?? null) === (st.numFmt ?? null)) ?? (st.numFmt ? { id: "custom", label: "Benutzerdefiniert", code: st.numFmt } : NUMBER_FORMATS[0]);

  const functionMenu = (big: boolean) => (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>{big ? <BigButton icon={<Fx />} label="Funktion" menu /> : <SmallButton icon={<Fx size={18} />} label="Funktion einfügen" menu />}</span>
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
        <span>{big ? <BigButton icon={<Sigma size={24} />} label="AutoSumme" menu /> : <SmallButton icon={<Sigma />} label="AutoSumme" text="AutoSumme" menu />}</span>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem onClick={() => p.onAutoSum("SUM")}>Summe</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("AVERAGE")}>Mittelwert</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("COUNT")}>Anzahl</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("MAX")}>Max</MenuItem>
          <MenuItem onClick={() => p.onAutoSum("MIN")}>Min</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  const home = (
    <>
      <RibbonGroup label="Zwischenablage">
        <BigButton icon={<ClipboardPaste24Regular />} label="Einfügen" onClick={() => p.onClipboard("paste")} />
        <Rows>
          <SmallButton icon={<Cut20Regular />} label="Ausschneiden" shortcut="Strg+X" onClick={() => p.onClipboard("cut")} />
          <SmallButton icon={<Copy20Regular />} label="Kopieren" shortcut="Strg+C" onClick={() => p.onClipboard("copy")} />
        </Rows>
        <Rows>
          <SmallButton icon={<ArrowUndo20Regular />} label="Rückgängig" shortcut="Strg+Z" disabled={!p.canUndo} onClick={p.onUndo} />
          <SmallButton icon={<ArrowRedo20Regular />} label="Wiederholen" shortcut="Strg+Y" disabled={!p.canRedo} onClick={p.onRedo} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Schriftart">
        <Rows>
          <Row>
            <Combobox
              style={{ width: 140, minWidth: 0 }}
              size="small"
              freeform
              value={st.font ?? "Calibri"}
              selectedOptions={[st.font ?? "Calibri"]}
              onOptionSelect={(_, d) => d.optionValue && p.onStyle({ font: d.optionValue === "Calibri" ? undefined : d.optionValue })}
              listbox={{ style: { maxHeight: 320 } }}
            >
              {FONTS.map((f) => (
                <Option key={f} value={f} text={f}>
                  <span style={{ fontFamily: f }}>{f}</span>
                </Option>
              ))}
            </Combobox>
            <Combobox
              style={{ width: 64, minWidth: 0 }}
              size="small"
              freeform
              value={String(size).replace(".", ",")}
              selectedOptions={[String(size)]}
              onOptionSelect={(_, d) => d.optionValue && p.onFontSize(Number(d.optionValue))}
              onKeyDown={(e) => {
                if (e.key === "Enter") p.onFontSize(parseFloat((e.target as HTMLInputElement).value.replace(",", ".")));
              }}
              listbox={{ style: { maxHeight: 320 } }}
            >
              {SIZES.map((v) => (
                <Option key={v} value={String(v)} text={String(v).replace(".", ",")}>
                  {String(v).replace(".", ",")}
                </Option>
              ))}
            </Combobox>
            <SmallButton icon={<FontIncrease20Regular />} label="Schriftgrad vergrößern" onClick={() => p.onFontSize(1)} />
            <SmallButton icon={<FontDecrease20Regular />} label="Schriftgrad verkleinern" onClick={() => p.onFontSize(-1)} />
          </Row>
          <Row>
            <SmallButton icon={<TextBold20Regular />} label="Fett" shortcut="Strg+B" pressed={!!st.bold} onClick={() => p.onToggle("bold")} />
            <SmallButton icon={<TextItalic20Regular />} label="Kursiv" shortcut="Strg+I" pressed={!!st.italic} onClick={() => p.onToggle("italic")} />
            <SmallButton icon={<TextUnderline20Regular />} label="Unterstrichen" shortcut="Strg+U" pressed={!!st.underline} onClick={() => p.onToggle("underline")} />
            <SmallButton icon={<TextStrikethrough20Regular />} label="Durchgestrichen" pressed={!!st.strike} onClick={() => p.onToggle("strike")} />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<BorderBottom20Regular />} label="Rahmenlinien" menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<BorderBottom20Regular />} onClick={() => p.onBorder("bottom")}>Rahmenlinie unten</MenuItem>
                  <MenuItem icon={<BorderTop20Regular />} onClick={() => p.onBorder("top")}>Rahmenlinie oben</MenuItem>
                  <MenuItem icon={<BorderLeft20Regular />} onClick={() => p.onBorder("left")}>Rahmenlinie links</MenuItem>
                  <MenuItem icon={<BorderRight20Regular />} onClick={() => p.onBorder("right")}>Rahmenlinie rechts</MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<BorderNone20Regular />} onClick={() => p.onBorder("none")}>Kein Rahmen</MenuItem>
                  <MenuItem icon={<BorderAll20Regular />} onClick={() => p.onBorder("all")}>Alle Rahmenlinien</MenuItem>
                  <MenuItem icon={<BorderOutside20Regular />} onClick={() => p.onBorder("outside")}>Rahmenlinien außen</MenuItem>
                  <MenuItem icon={<BorderBottomDouble20Regular />} onClick={() => p.onBorder("bottomDouble")}>Doppelte Rahmenlinie unten</MenuItem>
                  <MenuItem icon={<BorderBottomThick20Regular />} onClick={() => p.onBorder("bottomThick")}>Dicke Rahmenlinie unten</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <ColorButton icon={<PaintBucket20Regular />} label="Füllfarbe" value="#ffff00" noneLabel="Keine Füllung" onPick={(c) => p.onStyle({ fill: c ?? undefined })} />
            <ColorButton icon={<TextColor20Regular />} label="Schriftfarbe" value="#c00000" onPick={(c) => p.onStyle({ color: c ?? undefined })} />
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Ausrichtung">
        <Rows>
          <Row>
            <SmallButton icon={<AlignTop20Regular />} label="Oben ausrichten" pressed={st.vAlign === "top"} onClick={() => p.onStyle({ vAlign: "top" })} />
            <SmallButton icon={<AlignCenterVertical20Regular />} label="Zentriert ausrichten" pressed={st.vAlign === "middle"} onClick={() => p.onStyle({ vAlign: "middle" })} />
            <SmallButton icon={<AlignBottom20Regular />} label="Unten ausrichten" pressed={!st.vAlign || st.vAlign === "bottom"} onClick={() => p.onStyle({ vAlign: undefined })} />
            <SmallButton icon={<TextWrap20Regular />} label="Textumbruch" text="Umbruch" pressed={!!st.wrap} onClick={() => p.onToggle("wrap")} />
          </Row>
          <Row>
            <SmallButton icon={<TextAlignLeft20Regular />} label="Linksbündig" pressed={st.hAlign === "left"} onClick={() => p.onStyle({ hAlign: st.hAlign === "left" ? undefined : "left" })} />
            <SmallButton icon={<TextAlignCenter20Regular />} label="Zentriert" pressed={st.hAlign === "center"} onClick={() => p.onStyle({ hAlign: st.hAlign === "center" ? undefined : "center" })} />
            <SmallButton icon={<TextAlignRight20Regular />} label="Rechtsbündig" pressed={st.hAlign === "right"} onClick={() => p.onStyle({ hAlign: st.hAlign === "right" ? undefined : "right" })} />
            <SmallButton icon={<TextIndentDecreaseLtr20Regular />} label="Einzug verkleinern" onClick={() => p.onIndent(-1)} />
            <SmallButton icon={<TextIndentIncreaseLtr20Regular />} label="Einzug vergrößern" onClick={() => p.onIndent(1)} />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<TableCellsMerge20Regular />} label="Verbinden und zentrieren" pressed={p.merged} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => p.onMerge("center")}>Verbinden und zentrieren</MenuItem>
                  <MenuItem onClick={() => p.onMerge("across")}>Verbinden über</MenuItem>
                  <MenuItem onClick={() => p.onMerge("merge")}>Zellen verbinden</MenuItem>
                  <MenuItem onClick={() => p.onMerge("unmerge")}>Zellverbund aufheben</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Zahl">
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
            <SmallButton icon={<CurrencyDollarEuro20Regular />} label="Währung (€)" onClick={() => p.onNumFmt("#,##0.00 €")} />
            <SmallButton icon={<TextPercent20Regular />} label="Prozent" onClick={() => p.onNumFmt("0%")} />
            <SmallButton icon={<NumberSymbol20Regular />} label="1.000er-Trennzeichen" onClick={() => p.onNumFmt("#,##0.00")} />
            <SmallButton icon={<DecimalArrowRight20Regular />} label="Dezimalstelle hinzufügen" onClick={() => p.onDecimals(1)} />
            <SmallButton icon={<DecimalArrowLeft20Regular />} label="Dezimalstelle löschen" onClick={() => p.onDecimals(-1)} />
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Formatvorlagen">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableSimple24Regular />} label="Als Tabelle formatieren" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <TableStyleGallery current={p.table?.style} onPick={(st) => (p.table ? p.onTableOption({ style: st }) : p.onInsertTable(st))} />
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableCellEdit24Regular />} label="Bedingte Formatierung" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Regeln zum Hervorheben von Zellen</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onCond("greaterThan")}>Größer als…</MenuItem>
                    <MenuItem onClick={() => p.onCond("lessThan")}>Kleiner als…</MenuItem>
                    <MenuItem onClick={() => p.onCond("between")}>Zwischen…</MenuItem>
                    <MenuItem onClick={() => p.onCond("equal")}>Gleich…</MenuItem>
                    <MenuItem onClick={() => p.onCond("text")}>Textinhalt…</MenuItem>
                    <MenuItem onClick={() => p.onCond("duplicate")}>Doppelte Werte…</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Obere/untere Regeln</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onCond("top")}>Obere 10 Elemente…</MenuItem>
                    <MenuItem onClick={() => p.onCond("topPercent")}>Obere 10 %…</MenuItem>
                    <MenuItem onClick={() => p.onCond("bottom")}>Untere 10 Elemente…</MenuItem>
                    <MenuItem onClick={() => p.onCond("bottomPercent")}>Untere 10 %…</MenuItem>
                    <MenuItem onClick={() => p.onCond("above")}>Über dem Durchschnitt…</MenuItem>
                    <MenuItem onClick={() => p.onCond("below")}>Unter dem Durchschnitt…</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Datenbalken</MenuItem>
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
                  <MenuItem>Farbskalen</MenuItem>
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
              <MenuItem onClick={() => p.onCond("formula")}>Neue Regel mit Formel…</MenuItem>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Regeln löschen</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onCond("clearSelection")}>Regeln in ausgewählten Zellen löschen</MenuItem>
                    <MenuItem onClick={() => p.onCond("clearSheet")}>Regeln im gesamten Blatt löschen</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <MenuItem onClick={() => p.onCond("manage")}>Regeln verwalten…</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label="Zellen">
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TableInsertRow20Regular />} label="Einfügen" text="Einfügen" menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TableInsertRow20Regular />} onClick={() => p.onInsert("rows")}>Zeilen einfügen</MenuItem>
                <MenuItem icon={<TableInsertColumn20Regular />} onClick={() => p.onInsert("cols")}>Spalten einfügen</MenuItem>
                <MenuItem icon={<TableStackBelow24Regular />} onClick={() => p.onInsert("sheet")}>Blatt einfügen</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TableDeleteRow20Regular />} label="Löschen" text="Löschen" menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TableDeleteRow20Regular />} onClick={() => p.onDelete("rows")}>Zeilen löschen</MenuItem>
                <MenuItem icon={<TableDeleteColumn20Regular />} onClick={() => p.onDelete("cols")}>Spalten löschen</MenuItem>
                <MenuItem icon={<Delete24Regular />} onClick={() => p.onDelete("sheet")}>Blatt löschen</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Bearbeiten">
        <Rows>
          {autoSum(false)}
          <Row>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<ArrowDown20Regular />} label="Ausfüllen" menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<ArrowDown20Regular />} onClick={() => p.onFill("down")}>Unten (Strg+U)</MenuItem>
                  <MenuItem icon={<ArrowRight20Regular />} onClick={() => p.onFill("right")}>Rechts (Strg+R)</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<Eraser20Regular />} label="Löschen" menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => p.onClear("all")}>Alle löschen</MenuItem>
                  <MenuItem onClick={() => p.onClear("formats")}>Formate löschen</MenuItem>
                  <MenuItem onClick={() => p.onClear("contents")}>Inhalte löschen</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </Row>
        </Rows>
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<TextSortAscending20Regular />} label="Sortieren" text="Sortieren" menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TextSortAscending20Regular />} onClick={() => p.onSort(true)}>Von A bis Z sortieren</MenuItem>
                <MenuItem icon={<TextSortDescending20Regular />} onClick={() => p.onSort(false)}>Von Z bis A sortieren</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <SmallButton icon={<Search20Regular />} label="Suchen" text="Suchen" shortcut="Strg+F" onClick={p.onFind} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const insert = (
    <>
      <RibbonGroup label="Zellen">
        <BigButton icon={<TableInsertRow20Regular style={{ fontSize: 26 }} />} label="Zeilen" onClick={() => p.onInsert("rows")} />
        <BigButton icon={<TableInsertColumn20Regular style={{ fontSize: 26 }} />} label="Spalten" onClick={() => p.onInsert("cols")} />
        <BigButton icon={<TableStackBelow24Regular />} label="Blatt" onClick={() => p.onInsert("sheet")} />
      </RibbonGroup>
      <RibbonGroup label="Tabellen">
        <BigButton icon={<Table24Regular />} label="PivotTable" onClick={p.onPivot} />
        <BigButton icon={<TableSimple24Regular />} label="Tabelle" onClick={() => p.onInsertTable()} />
      </RibbonGroup>
      <RibbonGroup label="Illustrationen">
        <BigButton icon={<Image24Regular />} label="Bild" onClick={p.onImage} />
      </RibbonGroup>
      <RibbonGroup label="Diagramme">
        {CHART_KINDS.slice(0, 5).map((k) => (
          <BigButton key={k.kind} icon={CHART_ICONS[k.kind]} label={k.label} onClick={() => p.onChart(k.kind)} />
        ))}
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataScatter24Regular />} label="Weitere" menu />
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
      <RibbonGroup label="Sparklines">
        <BigButton icon={<DataTrending24Regular />} label="Linie" onClick={() => p.onSparkline("line")} />
        <BigButton icon={<DataBarVertical24Regular />} label="Säule" onClick={() => p.onSparkline("column")} />
        <BigButton icon={<DataUsage24Regular />} label="Gewinn/Verlust" onClick={() => p.onSparkline("stacked")} />
      </RibbonGroup>
      <RibbonGroup label="Links">
        <BigButton icon={<Link24Regular />} label="Link" onClick={p.onLink} />
      </RibbonGroup>
      <RibbonGroup label="Funktionen">
        {functionMenu(true)}
        {autoSum(true)}
      </RibbonGroup>
      <RibbonGroup label="Datum und Uhrzeit">
        <BigButton icon={<CalendarLtr24Regular />} label="Heute" onClick={() => p.onDate(false)} />
        <BigButton icon={<Clock24Regular />} label="Jetzt" onClick={() => p.onDate(true)} />
      </RibbonGroup>
    </>
  );

  const formulas = (
    <>
      <RibbonGroup label="Funktionsbibliothek">
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
              <BigButton icon={<Fx />} label="Weitere Funktionen" menu />
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
      <RibbonGroup label="Definierte Namen">
        <BigButton icon={<TagMultiple24Regular />} label="Namens-Manager" onClick={p.onNames} />
        <BigButton icon={<Tag24Regular />} label="Namen definieren" onClick={p.onDefineName} />
      </RibbonGroup>
      <RibbonGroup label="Formelüberwachung">
        <Rows three>
          <SmallButton icon={<ArrowStepInRight24Regular style={{ fontSize: 20 }} />} label="Spur zum Vorgänger" text="Spur zum Vorgänger" onClick={() => p.onTrace("pre")} />
          <SmallButton icon={<ArrowStepOut24Regular style={{ fontSize: 20 }} />} label="Spur zum Nachfolger" text="Spur zum Nachfolger" onClick={() => p.onTrace("dep")} />
          <SmallButton icon={<Eraser24Regular style={{ fontSize: 20 }} />} label="Pfeile entfernen" text="Pfeile entfernen" disabled={!p.hasArrows} onClick={() => p.onTrace("clear")} />
        </Rows>
        <Rows three>
          <SmallButton icon={<MathFormula24Regular style={{ fontSize: 20 }} />} label="Formeln anzeigen" text="Formeln anzeigen" shortcut="Strg+#" pressed={p.showFormulas} onClick={p.onShowFormulas} />
          <SmallButton icon={<ErrorCircle24Regular style={{ fontSize: 20 }} />} label="Fehlerüberprüfung" text="Fehlerüberprüfung" onClick={p.onErrorCheck} />
          <SmallButton icon={<Calculator24Regular style={{ fontSize: 20 }} />} label="Formel auswerten" text="Formel auswerten" onClick={p.onEvaluate} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Berechnung">
        <BigButton icon={<ArrowSync24Regular />} label="Neu berechnen" onClick={p.onRecalc} />
      </RibbonGroup>
    </>
  );

  const data = (
    <>
      <RibbonGroup label="Sortieren">
        <BigButton icon={<TextSortAscending24Regular />} label="A bis Z" onClick={() => p.onSort(true)} />
        <BigButton icon={<TextSortDescending24Regular />} label="Z bis A" onClick={() => p.onSort(false)} />
      </RibbonGroup>
      <RibbonGroup label="Sortieren und Filtern">
        <BigButton icon={<Filter24Regular />} label="Filtern" pressed={p.filterOn} onClick={p.onFilter} />
        <Rows>
          <SmallButton icon={<FilterDismiss24Regular style={{ fontSize: 20 }} />} label="Löschen" text="Löschen" disabled={!p.filterOn} onClick={p.onFilterClear} />
          <SmallButton icon={<ArrowRepeatAll24Regular style={{ fontSize: 20 }} />} label="Erneut anwenden" text="Erneut anwenden" disabled={!p.filterOn} onClick={p.onFilterReapply} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Prognose">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataWhisker24Regular />} label="Was-wäre-wenn-Analyse" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onWhatIf("scenario")}>Szenario-Manager…</MenuItem>
              <MenuItem onClick={() => p.onWhatIf("goal")}>Zielwertsuche…</MenuItem>
              <MenuItem onClick={() => p.onWhatIf("table")}>Datentabelle…</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label="Analyse">
        <BigButton icon={<DataUsage24Regular />} label="Solver" onClick={p.onSolver} />
      </RibbonGroup>
      <RibbonGroup label="Datentools">
        <BigButton icon={<TextColumnTwo24Regular />} label="Text in Spalten" onClick={p.onTextToColumns} />
        <BigButton icon={<Flash24Regular />} label="Blitzvorschau" onClick={p.onFlashFill} />
        <BigButton icon={<Highlight20Regular style={{ fontSize: 26 }} />} label="Duplikate entfernen" onClick={p.onDedupe} />
        <BigButton icon={<ShieldCheckmark24Regular />} label="Datenüberprüfung" onClick={p.onValidation} />
      </RibbonGroup>
      <RibbonGroup label="Gliederung">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Group24Regular />} label="Gruppieren" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onGroup("rows", true)}>Zeilen gruppieren</MenuItem>
              <MenuItem onClick={() => p.onGroup("cols", true)}>Spalten gruppieren</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<GroupDismiss24Regular />} label="Gruppierung aufheben" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onGroup("rows", false)}>Zeilengruppierung aufheben</MenuItem>
              <MenuItem onClick={() => p.onGroup("cols", false)}>Spaltengruppierung aufheben</MenuItem>
              <MenuDivider />
              <MenuItem onClick={p.onOutlineClear}>Gliederung entfernen</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
    </>
  );

  const pg = p.page;
  const fitMenu = (k: "fitWidth" | "fitHeight", label: string) => (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>
          <SmallButton icon={<PageFit24Regular style={{ fontSize: 20 }} />} label={label} text={`${label}: ${pg[k] ? `${pg[k]} Seite${pg[k] === 1 ? "" : "n"}` : "Automatisch"}`} menu />
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
              {n ? `${n} Seite${n === 1 ? "" : "n"}` : "Automatisch"}
              {(pg[k] ?? 0) === n && (pg.fitWidth !== undefined || pg.fitHeight !== undefined || !n) ? " ✓" : ""}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  const layout = (
    <>
      <RibbonGroup label="Seite einrichten">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentMargins24Regular />} label="Seitenränder" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {MARGIN_PRESETS.map((m) => (
                <MenuItem key={m.id} onClick={() => p.onPage(m.m)}>
                  {m.label} – oben {String(m.m.marginTop).replace(".", ",")} cm, links {String(m.m.marginLeft).replace(".", ",")} cm
                  {pg.marginTop === m.m.marginTop && pg.marginLeft === m.m.marginLeft ? " ✓" : ""}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem onClick={() => p.onPageDialog("margins")}>Benutzerdefinierte Seitenränder…</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Orientation24Regular />} label="Ausrichtung" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onPage({ landscape: false })}>Hochformat{!pg.landscape ? " ✓" : ""}</MenuItem>
              <MenuItem onClick={() => p.onPage({ landscape: true })}>Querformat{pg.landscape ? " ✓" : ""}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentOnePage24Regular />} label="Format" menu />
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
              <BigButton icon={<Print24Regular />} label="Druckbereich" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onPrintArea(true)}>Druckbereich festlegen</MenuItem>
              <MenuItem disabled={!pg.printArea} onClick={() => p.onPrintArea(false)}>
                Druckbereich aufheben
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentPageBreak24Regular />} label="Umbrüche" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onPageBreak("insert")}>Seitenumbruch einfügen</MenuItem>
              <MenuItem onClick={() => p.onPageBreak("remove")}>Seitenumbruch entfernen</MenuItem>
              <MenuItem disabled={!pg.rowBreaks?.length && !pg.colBreaks?.length} onClick={() => p.onPageBreak("reset")}>
                Alle Seitenumbrüche zurücksetzen
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<DocumentTable24Regular />} label="Drucktitel" onClick={() => p.onPageDialog("sheet")} />
      </RibbonGroup>
      <RibbonGroup label="An Format anpassen">
        <Rows three>
          {fitMenu("fitWidth", "Breite")}
          {fitMenu("fitHeight", "Höhe")}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <SmallButton icon={<ZoomIn20Regular />} label="Skalierung" text={`Skalierung: ${pg.fitWidth !== undefined || pg.fitHeight !== undefined ? "angepasst" : `${pg.scale} %`}`} menu />
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
                <MenuItem onClick={() => p.onPageDialog("page")}>Benutzerdefiniert…</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Blattoptionen">
        <Rows>
          <SmallButton icon={<Grid24Regular style={{ fontSize: 20 }} />} label="Gitternetzlinien drucken" text="Gitternetzlinien drucken" pressed={pg.gridlines} onClick={() => p.onPage({ gridlines: !pg.gridlines })} />
          <SmallButton icon={<TableStackBelow24Regular style={{ fontSize: 20 }} />} label="Überschriften drucken" text="Überschriften drucken" pressed={pg.headings} onClick={() => p.onPage({ headings: !pg.headings })} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Kopf- und Fußzeile">
        <BigButton icon={<DocumentHeaderFooter24Regular />} label="Kopf- und Fußzeile" onClick={() => p.onPageDialog("hf")} />
        <BigButton icon={<DocumentMargins24Regular />} label="Seite einrichten" onClick={() => p.onPageDialog("page")} />
      </RibbonGroup>
    </>
  );

  const review = (
    <>
      <RibbonGroup label="Notizen">
        <BigButton icon={p.hasNote ? <NoteEdit24Regular /> : <NoteAdd24Regular />} label={p.hasNote ? "Notiz bearbeiten" : "Neue Notiz"} onClick={() => p.onNote(p.hasNote ? "edit" : "new")} />
        <Rows three>
          <SmallButton icon={<Delete24Regular style={{ fontSize: 20 }} />} label="Löschen" text="Löschen" disabled={!p.hasNote} onClick={() => p.onNote("delete")} />
          <SmallButton icon={<ArrowPrevious24Regular style={{ fontSize: 20 }} />} label="Vorherige" text="Vorherige" onClick={() => p.onNote("prev")} />
          <SmallButton icon={<ArrowNext24Regular style={{ fontSize: 20 }} />} label="Nächste" text="Nächste" onClick={() => p.onNote("next")} />
        </Rows>
        <Rows>
          <SmallButton icon={<NoteEdit24Regular style={{ fontSize: 20 }} />} label="Notiz ein-/ausblenden" text="Ein-/ausblenden" disabled={!p.hasNote} onClick={() => p.onNote("toggle")} />
          <SmallButton icon={<CommentMultiple24Regular style={{ fontSize: 20 }} />} label="Alle Notizen anzeigen" text="Alle anzeigen" pressed={p.notesShown} onClick={() => p.onNote("showAll")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Barrierefreiheit">
        <BigButton icon={<AccessibilityCheckmark24Regular />} label="Barrierefreiheit überprüfen" pressed={p.a11yOpen} onClick={p.onA11y} />
      </RibbonGroup>
      <RibbonGroup label="Schützen">
        <BigButton icon={<ShieldLock24Regular />} label={p.sheetProtected ? "Blattschutz aufheben" : "Blatt schützen"} pressed={p.sheetProtected} onClick={p.onProtectSheet} />
        <BigButton icon={<DocumentLock24Regular />} label="Arbeitsmappe schützen" pressed={p.bookProtected} onClick={p.onProtectBook} />
        <Rows>
          <SmallButton icon={<LockClosed24Regular style={{ fontSize: 20 }} />} label="Zelle sperren" text="Zelle sperren" pressed={p.cellLocked} disabled={p.sheetProtected} onClick={() => p.onCellLock("locked")} />
          <SmallButton icon={<EyeOff24Regular style={{ fontSize: 20 }} />} label="Formel ausblenden" text="Formel ausblenden" pressed={p.formulaHidden} disabled={p.sheetProtected} onClick={() => p.onCellLock("hideFormula")} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const view = (
    <>
      <RibbonGroup label="Fenster">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableFreezeColumnAndRow24Regular />} label="Fixieren" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {p.freeze.rows || p.freeze.cols ? <MenuItem onClick={() => p.onFreeze("none")}>Fixierung aufheben</MenuItem> : <MenuItem onClick={() => p.onFreeze("selection")}>Fenster fixieren</MenuItem>}
              <MenuItem onClick={() => p.onFreeze("row")}>Oberste Zeile fixieren</MenuItem>
              <MenuItem onClick={() => p.onFreeze("col")}>Erste Spalte fixieren</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label="Anzeigen">
        <Menu checkedValues={{ v: p.showGrid ? ["grid"] : [] }}>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Grid24Regular />} label="Gitternetz" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList checkedValues={{ v: p.showGrid ? ["grid"] : [] }}>
              <MenuItemCheckbox name="v" value="grid" onClick={p.onGrid}>
                Gitternetzlinien
              </MenuItemCheckbox>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label="Zoom">
        <BigButton icon={<span style={{ fontSize: 15, fontWeight: 600 }}>100</span>} label="100 %" onClick={() => p.onZoom(1)} />
        <Rows>
          <SmallButton icon={<ZoomIn20Regular />} label="Vergrößern" onClick={() => p.onZoom(Math.min(4, p.zoom + 0.1))} />
          <SmallButton icon={<ZoomOut20Regular />} label="Verkleinern" onClick={() => p.onZoom(Math.max(0.3, p.zoom - 0.1))} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Design">
        <Rows>
          <SmallButton icon={<DarkTheme20Regular />} label={mode === "dark" ? "Helles Design" : "Dunkles Design"} text={mode === "dark" ? "Helles Design" : "Dunkles Design"} onClick={toggle} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const t = p.table;
  const tableTab = t ? (
    <>
      <RibbonGroup label="Eigenschaften">
        <Rows>
          <span style={{ fontSize: 12 }}>Tabellenname:</span>
          <TableNameInput key={t.name} name={t.name} onRename={p.onTableRename} />
          <SmallButton icon={<TableResizeColumn24Regular style={{ fontSize: 20 }} />} label="Tabellengröße ändern" text="Tabellengröße ändern" onClick={p.onTableResize} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Tools">
        <BigButton icon={<Table24Regular />} label="Mit PivotTable zusammenfassen" onClick={p.onPivot} />
        <BigButton icon={<TableDismiss24Regular />} label="In Bereich konvertieren" onClick={p.onTableConvert} />
      </RibbonGroup>
      <RibbonGroup label="Optionen für Tabellenformat">
        <Rows>
          <SmallButton icon={<TableBottomRow24Regular style={{ fontSize: 20 }} />} label="Ergebniszeile" text="Ergebniszeile" pressed={t.totalsRow} onClick={() => p.onTableTotals(!t.totalsRow)} />
          <SmallButton icon={<Filter24Regular style={{ fontSize: 20 }} />} label="Schaltfläche „Filter“" text="Schaltfläche „Filter“" pressed={t.filter} onClick={() => p.onTableOption({ filter: !t.filter })} />
        </Rows>
        <Rows>
          <SmallButton label="Gebänderte Zeilen" text="Gebänderte Zeilen" pressed={t.bandedRows} onClick={() => p.onTableOption({ bandedRows: !t.bandedRows })} />
          <SmallButton label="Gebänderte Spalten" text="Gebänderte Spalten" pressed={t.bandedCols} onClick={() => p.onTableOption({ bandedCols: !t.bandedCols })} />
        </Rows>
        <Rows>
          <SmallButton label="Erste Spalte" text="Erste Spalte" pressed={t.firstCol} onClick={() => p.onTableOption({ firstCol: !t.firstCol })} />
          <SmallButton label="Letzte Spalte" text="Letzte Spalte" pressed={t.lastCol} onClick={() => p.onTableOption({ lastCol: !t.lastCol })} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Tabellenformatvorlagen">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TableSimple24Regular />} label="Formatvorlagen" menu />
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
      <RibbonGroup label="Typ">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={CHART_ICONS[c.kind]} label="Diagrammtyp ändern" menu />
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
        <RibbonGroup label="Kombi">
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<DataBarVerticalAdd24Regular />} label="Datenreihen" menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {c.series.map((sr, i) => (
                  <Menu key={i}>
                    <MenuTrigger disableButtonEnhancement>
                      <MenuItem>{sr.name ?? `Reihe ${i + 1}`}</MenuItem>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        {([["column", "Gruppierte Säulen"], ["line", "Linie"], ["area", "Fläche"]] as const).map(([k, label]) => (
                          <MenuItem key={k} onClick={() => p.onChartPatch({ series: c.series.map((x, j) => (j === i ? { ...x, kind: k } : { ...x, kind: x.kind ?? (j === 0 ? "column" : "line") })) })}>
                            {label}
                            {(sr.kind ?? (i === 0 ? "column" : "line")) === k ? " ✓" : ""}
                          </MenuItem>
                        ))}
                        <MenuDivider />
                        <MenuItem onClick={() => p.onChartPatch({ series: c.series.map((x, j) => (j === i ? { ...x, secondary: !x.secondary } : x)) })}>
                          Sekundärachse{sr.secondary ? " ✓" : ""}
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
        <RibbonGroup label="Histogramm">
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<DataHistogram24Regular />} label="Klassen" menu />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {[undefined, 5, 10, 15, 20, 30].map((n) => (
                  <MenuItem key={n ?? 0} onClick={() => p.onChartPatch({ binCount: n, binWidth: undefined })}>
                    {n ? `${n} Klassen` : "Automatisch"}
                    {c.binCount === n && !c.binWidth ? " ✓" : ""}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </RibbonGroup>
      )}
      {c.kind === "waterfall" && (
        <RibbonGroup label="Wasserfall">
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton icon={<DataWaterfall24Regular />} label="Als Summe festlegen" menu />
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
      <RibbonGroup label="Daten">
        <BigButton icon={<ArrowSwap24Regular />} label="Zeile/Spalte wechseln" onClick={p.onChartSwap} />
        <BigButton icon={<TableCellEdit24Regular />} label="Daten auswählen" onClick={p.onChartData} />
      </RibbonGroup>
      <RibbonGroup label="Diagrammelemente">
        <BigButton icon={<TextT24Regular />} label="Diagrammtitel" onClick={p.onChartTitle} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TagMultiple24Regular />} label="Legende" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {[
                [undefined, "Keine"],
                ["r", "Rechts"],
                ["b", "Unten"],
                ["t", "Oben"],
                ["l", "Links"],
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
          <SmallButton icon={<NumberSymbol20Regular />} label="Datenbeschriftungen" text="Datenbeschriftungen" pressed={!!c.labels} onClick={() => p.onChartPatch({ labels: !c.labels })} />
          <SmallButton icon={<TableStackBelow24Regular style={{ fontSize: 20 }} />} label="Gestapelt" text="Gestapelt" pressed={!!c.stacked} disabled={!["column", "bar", "line", "area"].includes(c.kind)} onClick={() => p.onChartPatch({ stacked: !c.stacked })} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Anordnen">
        <BigButton icon={<Delete24Regular />} label="Löschen" onClick={p.onDeleteObject} />
      </RibbonGroup>
    </>
  ) : p.objectSelected ? (
    <RibbonGroup label="Anordnen">
      <BigButton icon={<Delete24Regular />} label="Löschen" onClick={p.onDeleteObject} />
    </RibbonGroup>
  ) : null;

  return (
    <OfficeRibbon
      color={p.color}
      onFile={p.onFile}
      active={p.tab}
      onTab={p.onTab}
      tabs={[
        { id: "home", label: "Start", content: home },
        { id: "insert", label: "Einfügen", content: insert },
        { id: "layout", label: "Seitenlayout", content: layout },
        { id: "formulas", label: "Formeln", content: formulas },
        { id: "data", label: "Daten", content: data },
        { id: "review", label: "Überprüfen", content: review },
        { id: "view", label: "Ansicht", content: view },
        ...(chartTab ? [{ id: "object", label: c ? "Diagrammentwurf" : "Bildformat", contextual: true, content: chartTab }] : []),
        ...(tableTab && !chartTab ? [{ id: "table", label: "Tabellenentwurf", contextual: true, content: tableTab }] : []),
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
      aria-label="Tabellenname"
      onChange={(_, d) => setV(d.value)}
      onBlur={() => v !== name && onRename(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") setV(name);
      }}
    />
  );
}
