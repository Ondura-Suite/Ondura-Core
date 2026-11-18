import {
  Combobox,
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
} from "@fluentui/react-icons";
import { BigButton, ColorButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton } from "../../shell/office";
import { useThemeMode } from "../../shell/theme";
import { FONTS, SIZES } from "../text/TextRibbon";
import { FUNCTION_CATEGORIES, germanName } from "./formula";
import { NUMBER_FORMATS } from "./format";
import type { CellStyle } from "./model";

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
        {FUNCTION_CATEGORIES.map((cat) => (
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
      <RibbonGroup label="Datentools">
        <BigButton icon={<Highlight20Regular style={{ fontSize: 26 }} />} label="Duplikate entfernen" onClick={p.onDedupe} />
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

  return (
    <OfficeRibbon
      color={p.color}
      onFile={p.onFile}
      active={p.tab}
      onTab={p.onTab}
      tabs={[
        { id: "home", label: "Start", content: home },
        { id: "insert", label: "Einfügen", content: insert },
        { id: "formulas", label: "Formeln", content: formulas },
        { id: "data", label: "Daten", content: data },
        { id: "view", label: "Ansicht", content: view },
      ]}
    />
  );
}
