import { Combobox, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Option, makeStyles, tokens } from "@fluentui/react-components";
import {
  AddCircle24Regular,
  ArrowRouting24Regular,
  Organization24Regular,
  ArrowEnter20Regular,
  ArrowExit20Regular,
  MusicNote224Regular,
  SparkleCircle24Regular,
  Video24Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  DataBarVertical24Regular,
  Eye24Regular,
  Sparkle24Regular,
  SlideTransition24Regular,
  Table24Regular,
  TableDeleteColumn20Regular,
  TableDeleteRow20Regular,
  TableInsertColumn20Regular,
  TableInsertRow20Regular,
  AlignBottom20Regular,
  AlignCenterHorizontal20Regular,
  AlignCenterVertical20Regular,
  AlignLeft20Regular,
  AlignRight20Regular,
  AlignTop20Regular,
  ArrowRedo20Regular,
  ArrowUndo20Regular,
  BorderOutside20Regular,
  ClipboardPaste24Regular,
  ColorBackground24Regular,
  Copy20Regular,
  CopyAdd24Regular,
  Cut20Regular,
  DarkTheme20Regular,
  Delete24Regular,
  FlipHorizontal20Regular,
  FlipVertical20Regular,
  FontDecrease20Regular,
  FontIncrease20Regular,
  Image24Regular,
  Notepad24Regular,
  PaintBucket20Regular,
  Play24Regular,
  PlayCircle24Regular,
  PositionBackward20Regular,
  PositionForward20Regular,
  PositionToBack20Regular,
  PositionToFront20Regular,
  Presenter24Regular,
  RotateRight20Regular,
  Shapes24Regular,
  SlideAdd24Regular,
  SlideHide24Regular,
  SlideLayout24Regular,
  SlideSize24Regular,
  TextAlignCenter20Regular,
  TextAlignJustify20Regular,
  TextAlignLeft20Regular,
  TextAlignRight20Regular,
  TextBold20Regular,
  TextBulletListLtr20Regular,
  TextColor20Regular,
  TextIndentDecreaseLtr20Regular,
  TextIndentIncreaseLtr20Regular,
  TextItalic20Regular,
  TextNumberListLtr20Regular,
  TextStrikethrough20Regular,
  TextUnderline20Regular,
  Textbox24Regular,
  ZoomFit20Regular,
  Connector24Regular,
  SlideSearch24Regular,
  Link24Regular,
  Timer24Regular,
  SlideRecord24Regular,
  VideoClip24Regular,
  SlideHide20Regular,
  AccessibilityCheckmark24Regular,
} from "@fluentui/react-icons";
import { BigButton, ColorButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton } from "../../shell/office";
import { useThemeMode } from "../../shell/theme";
import { FONTS, SIZES } from "../text/TextRibbon";
import { ANIM_CLASSES, type AnimClass, type AnimEffect, type Animation, EFFECTS, animLabel, LAYOUTS, type LayoutId, SHAPE_KINDS, THEMES, TRANSITIONS, type DesignTheme, type SmartArtLayout, type Table, type Transition, geometryPath } from "./model";
import { CHART_KINDS, type Chart, type ChartKind } from "../chart/ChartView";
import { TablePicker } from "./objects";
import { SMARTART_LAYOUTS } from "./smartart";
import { tl, tlc, LOCALE } from "../../lib/i18n";

export type TableAction = "header" | "banded" | "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol";

const DIRS: Record<string, { value: string; label: string }[]> = {
  transition: [
    { value: "l", label: tl("Von rechts") },
    { value: "r", label: tl("Von links") },
    { value: "u", label: tl("Von unten") },
    { value: "d", label: tl("Von oben") },
  ],
  anim: [
    { value: "b", label: tl("Von unten") },
    { value: "t", label: tl("Von oben") },
    { value: "l", label: tl("Von links") },
    { value: "r", label: tl("Von rechts") },
  ],
};

const DURATIONS = [250, 500, 750, 1000, 1500, 2000, 3000];

const useStyles = makeStyles({
  shapes: { display: "grid", gridTemplateColumns: "repeat(6, 34px)", gap: "4px", padding: "4px" },
  shapeBtn: {
    width: "34px",
    height: "34px",
    border: "1px solid transparent",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover, border: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  themes: { display: "flex", gap: "6px" },
  combo: { minWidth: "unset" },
  themeBtn: {
    width: "86px",
    height: "52px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    padding: "6px 8px",
    textAlign: "left",
    fontSize: "11px",
    position: "relative",
    overflow: "hidden",
    ":hover": { outline: `2px solid ${tokens.colorBrandStroke1}` },
  },
});

export interface TextState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  font: string;
  size: number;
  align: string;
  bullet: string | null;
}

export interface SlidesRibbonProps {
  color: string;
  a11yOpen: boolean;
  onA11y: () => void;
  tab: string;
  onTab: (t: string) => void;
  text: TextState;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  slideHidden: boolean;
  showNotes: boolean;
  onFile: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClipboard: (a: "cut" | "copy" | "paste") => void;
  onNewSlide: (layout: LayoutId) => void;
  onDuplicateSlide: () => void;
  onDeleteSlide: () => void;
  onHideSlide: () => void;
  onLayout: (layout: LayoutId) => void;
  onText: (cmd: { toggle?: "bold" | "italic" | "underline" | "strike"; font?: string; size?: number; grow?: 1 | -1; color?: string | null; align?: string; bullet?: "•" | "#"; indent?: 1 | -1 }) => void;
  onAnchor: (a: "top" | "middle" | "bottom") => void;
  onInsertText: () => void;
  onInsertImage: () => void;
  onInsertShape: (kind: string) => void;
  onFill: (c: string | null) => void;
  onLine: (c: string | null, width?: number) => void;
  onArrange: (a: "front" | "back" | "forward" | "backward") => void;
  onAlign: (a: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  onFlip: (a: "h" | "v" | "rotate") => void;
  onTheme: (t: DesignTheme) => void;
  onBackground: (c: string | null, all: boolean) => void;
  onSize: (ratio: "16:9" | "4:3") => void;
  onShow: (mode: "start" | "current" | "presenter") => void;
  onToggleNotes: () => void;
  onFit: () => void;
  ratio: string;
  onInsertTable: (rows: number, cols: number) => void;
  onInsertChart: (kind: ChartKind) => void;
  onInsertSmartArt: (layout: SmartArtLayout) => void;
  /** Selected table or chart (contextual tab). */
  table: Table | null;
  chart: Chart | null;
  onTable: (a: TableAction) => void;
  onTableColor: (c: string) => void;
  onCellFill: (c: string | null) => void;
  onChartPatch: (patch: Partial<Chart>) => void;
  onChartData: () => void;
  onChartTitle: () => void;
  transition: Transition | undefined;
  onTransition: (t: Transition | null) => void;
  onTransitionAll: () => void;
  onPreview: () => void;
  /** Current animation of the (first) selected shape. */
  animation: Animation | undefined;
  /** All animations of the (first) selected shape and the current one's position. */
  shapeAnimations: Animation[];
  animIndex: number;
  onAnimPick: (i: number) => void;
  onAnimation: (patch: Partial<Animation> | null) => void;
  onAddAnimation: (cls: AnimClass, effect: AnimEffect) => void;
  onAnimMove: (d: -1 | 1) => void;
  onInsertMedia: (kind: "video" | "audio") => void;
  /** Titles of all slides (slide zoom menu). */
  slideTitles: string[];
  onInsertZoom: (index: number) => void;
  /** Two shapes are selected that can be connected. */
  canConnect: boolean;
  onConnect: (elbow: boolean) => void;
  onLink: () => void;
  onRehearse: (mode: "timings" | "record") => void;
  onExportVideo: () => void;
  onClearTimings: () => void;
  masterMode: boolean;
  onMaster: (on: boolean) => void;
  hideMaster: boolean;
  onHideMaster: () => void;
}

function ShapeIcon({ kind }: { kind: string }) {
  const path = geometryPath(kind, 22, 16);
  return (
    <svg width="24" height="18" viewBox="-1 -1 24 18">
      {kind === "line" ? (
        <line x1="0" y1="16" x2="22" y2="0" stroke="currentColor" strokeWidth="1.5" />
      ) : kind === "ellipse" ? (
        <ellipse cx="11" cy="8" rx="11" ry="8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : kind === "roundRect" ? (
        <rect x="0" y="0" width="22" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : path ? (
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : (
        <rect x="0" y="0" width="22" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
  );
}

export function SlidesRibbon(p: SlidesRibbonProps) {
  const s = useStyles();
  const { toggle, mode } = useThemeMode();
  const t = p.text;

  const shapeMenu = (big: boolean) => (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>{big ? <BigButton icon={<Shapes24Regular />} label={tl("Formen")} menu /> : <SmallButton icon={<Shapes24Regular style={{ fontSize: 20 }} />} label={tl("Formen")} text={tl("Formen")} menu />}</span>
      </MenuTrigger>
      <MenuPopover>
        <div className={s.shapes}>
          {SHAPE_KINDS.map((k) => (
            <button key={k.kind} className={s.shapeBtn} title={k.name} onClick={() => p.onInsertShape(k.kind)}>
              <ShapeIcon kind={k.kind} />
            </button>
          ))}
        </div>
      </MenuPopover>
    </Menu>
  );

  const newSlideMenu = (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <span>
          <BigButton icon={<SlideAdd24Regular />} label={tl("Neue Folie")} menu />
        </span>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {LAYOUTS.map((l) => (
            <MenuItem key={l.id} onClick={() => p.onNewSlide(l.id)}>
              {l.name}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  const fontGroup = (
    <RibbonGroup label={tl("Schriftart")}>
      <Rows>
        <Row>
          <Combobox
            style={{ width: 140, minWidth: 0 }}
            size="small"
            freeform
            disabled={!p.hasSelection}
            value={t.font}
            selectedOptions={[t.font]}
            onOptionSelect={(_, d) => d.optionValue && p.onText({ font: d.optionValue })}
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
            disabled={!p.hasSelection}
            value={String(t.size).replace(".", ",")}
            selectedOptions={[String(t.size)]}
            onOptionSelect={(_, d) => d.optionValue && p.onText({ size: Number(d.optionValue) })}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onText({ size: parseFloat((e.target as HTMLInputElement).value.replace(",", ".")) });
            }}
            listbox={{ style: { maxHeight: 320 } }}
          >
            {[...SIZES, 32, 40, 44, 54, 60, 66, 80, 96].sort((a, b) => a - b).filter((v, i, a) => a.indexOf(v) === i).map((v) => (
              <Option key={v} value={String(v)} text={String(v).replace(".", ",")}>
                {String(v).replace(".", ",")}
              </Option>
            ))}
          </Combobox>
          <SmallButton icon={<FontIncrease20Regular />} label={tl("Schriftgrad vergrößern")} disabled={!p.hasSelection} onClick={() => p.onText({ grow: 1 })} />
          <SmallButton icon={<FontDecrease20Regular />} label={tl("Schriftgrad verkleinern")} disabled={!p.hasSelection} onClick={() => p.onText({ grow: -1 })} />
        </Row>
        <Row>
          <SmallButton icon={<TextBold20Regular />} label={tl("Fett")} shortcut="Strg+B" pressed={t.bold} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "bold" })} />
          <SmallButton icon={<TextItalic20Regular />} label={tl("Kursiv")} shortcut="Strg+I" pressed={t.italic} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "italic" })} />
          <SmallButton icon={<TextUnderline20Regular />} label={tl("Unterstrichen")} shortcut="Strg+U" pressed={t.underline} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "underline" })} />
          <SmallButton icon={<TextStrikethrough20Regular />} label={tl("Durchgestrichen")} pressed={t.strike} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "strike" })} />
          <ColorButton icon={<TextColor20Regular />} label={tl("Schriftfarbe")} value="#c00000" onPick={(c) => p.onText({ color: c })} />
        </Row>
      </Rows>
    </RibbonGroup>
  );

  const paragraphGroup = (
    <RibbonGroup label={tl("Absatz")}>
      <Rows>
        <Row>
          <SmallButton icon={<TextBulletListLtr20Regular />} label={tl("Aufzählungszeichen")} pressed={t.bullet === "•"} disabled={!p.hasSelection} onClick={() => p.onText({ bullet: "•" })} />
          <SmallButton icon={<TextNumberListLtr20Regular />} label={tl("Nummerierung")} pressed={t.bullet === "#"} disabled={!p.hasSelection} onClick={() => p.onText({ bullet: "#" })} />
          <SmallButton icon={<TextIndentDecreaseLtr20Regular />} label={tl("Listenebene verringern")} disabled={!p.hasSelection} onClick={() => p.onText({ indent: -1 })} />
          <SmallButton icon={<TextIndentIncreaseLtr20Regular />} label={tl("Listenebene erhöhen")} disabled={!p.hasSelection} onClick={() => p.onText({ indent: 1 })} />
        </Row>
        <Row>
          <SmallButton icon={<TextAlignLeft20Regular />} label={tl("Linksbündig")} pressed={t.align === "left"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "left" })} />
          <SmallButton icon={<TextAlignCenter20Regular />} label={tl("Zentriert")} pressed={t.align === "center"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "center" })} />
          <SmallButton icon={<TextAlignRight20Regular />} label={tl("Rechtsbündig")} pressed={t.align === "right"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "right" })} />
          <SmallButton icon={<TextAlignJustify20Regular />} label={tl("Blocksatz")} pressed={t.align === "justify"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "justify" })} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<AlignCenterVertical20Regular />} label={tl("Text vertikal ausrichten")} disabled={!p.hasSelection} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<AlignTop20Regular />} onClick={() => p.onAnchor("top")}>{tl("Oben")}</MenuItem>
                <MenuItem icon={<AlignCenterVertical20Regular />} onClick={() => p.onAnchor("middle")}>{tl("Mitte")}</MenuItem>
                <MenuItem icon={<AlignBottom20Regular />} onClick={() => p.onAnchor("bottom")}>{tl("Unten")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Row>
      </Rows>
    </RibbonGroup>
  );

  const drawGroup = (
    <RibbonGroup label={tl("Zeichnen")}>
      <Rows>
        {shapeMenu(false)}
        <Row>
          <ColorButton icon={<PaintBucket20Regular />} label={tl("Fülleffekt")} value="#4472c4" noneLabel={tl("Keine Füllung")} onPick={p.onFill} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<BorderOutside20Regular />} label={tl("Formkontur")} disabled={!p.hasSelection} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={() => p.onLine(null)}>{tl("Keine Kontur")}</MenuItem>
                <MenuItem onClick={() => p.onLine("#000000", 1)}>{tl("Schwarz")}</MenuItem>
                <MenuItem onClick={() => p.onLine("#4472c4", 1)}>{tl("Blau")}</MenuItem>
                <MenuItem onClick={() => p.onLine("#c00000", 1)}>{tl("Rot")}</MenuItem>
                <MenuItem onClick={() => p.onLine("#7f7f7f", 1)}>{tl("Grau")}</MenuItem>
                <MenuDivider />
                {[0.75, 1.5, 3, 6].map((w) => (
                  <MenuItem key={w} onClick={() => p.onLine(undefined as unknown as string, w)}>
                    {tl("Stärke")} {String(w).replace(".", ",")} {tl("Pt")}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<PositionToFront20Regular />} label={tl("Anordnen")} disabled={!p.hasSelection} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<PositionToFront20Regular />} onClick={() => p.onArrange("front")}>{tl("In den Vordergrund")}</MenuItem>
                <MenuItem icon={<PositionForward20Regular />} onClick={() => p.onArrange("forward")}>{tl("Eine Ebene nach vorne")}</MenuItem>
                <MenuItem icon={<PositionBackward20Regular />} onClick={() => p.onArrange("backward")}>{tl("Eine Ebene nach hinten")}</MenuItem>
                <MenuItem icon={<PositionToBack20Regular />} onClick={() => p.onArrange("back")}>{tl("In den Hintergrund")}</MenuItem>
                <MenuDivider />
                <MenuItem icon={<AlignLeft20Regular />} onClick={() => p.onAlign("left")}>{tl("Linksbündig ausrichten")}</MenuItem>
                <MenuItem icon={<AlignCenterHorizontal20Regular />} onClick={() => p.onAlign("center")}>{tl("Horizontal zentrieren")}</MenuItem>
                <MenuItem icon={<AlignRight20Regular />} onClick={() => p.onAlign("right")}>{tl("Rechtsbündig ausrichten")}</MenuItem>
                <MenuItem icon={<AlignTop20Regular />} onClick={() => p.onAlign("top")}>{tl("Oben ausrichten")}</MenuItem>
                <MenuItem icon={<AlignCenterVertical20Regular />} onClick={() => p.onAlign("middle")}>{tl("Vertikal zentrieren")}</MenuItem>
                <MenuItem icon={<AlignBottom20Regular />} onClick={() => p.onAlign("bottom")}>{tl("Unten ausrichten")}</MenuItem>
                <MenuDivider />
                <MenuItem icon={<RotateRight20Regular />} onClick={() => p.onFlip("rotate")}>{tl("Um 90° drehen")}</MenuItem>
                <MenuItem icon={<FlipHorizontal20Regular />} onClick={() => p.onFlip("h")}>{tl("Horizontal kippen")}</MenuItem>
                <MenuItem icon={<FlipVertical20Regular />} onClick={() => p.onFlip("v")}>{tl("Vertikal kippen")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Row>
      </Rows>
    </RibbonGroup>
  );

  const home = (
    <>
      <RibbonGroup label={tl("Zwischenablage")}>
        <BigButton icon={<ClipboardPaste24Regular />} label={tlc("paste", "Einfügen")} onClick={() => p.onClipboard("paste")} />
        <Rows>
          <SmallButton icon={<Cut20Regular />} label={tl("Ausschneiden")} shortcut="Strg+X" onClick={() => p.onClipboard("cut")} />
          <SmallButton icon={<Copy20Regular />} label={tl("Kopieren")} shortcut="Strg+C" onClick={() => p.onClipboard("copy")} />
        </Rows>
        <Rows>
          <SmallButton icon={<ArrowUndo20Regular />} label={tl("Rückgängig")} shortcut="Strg+Z" disabled={!p.canUndo} onClick={p.onUndo} />
          <SmallButton icon={<ArrowRedo20Regular />} label={tl("Wiederholen")} shortcut="Strg+Y" disabled={!p.canRedo} onClick={p.onRedo} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Folien")}>
        {newSlideMenu}
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<SlideLayout24Regular style={{ fontSize: 20 }} />} label={tl("Layout")} text={tl("Layout")} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {LAYOUTS.map((l) => (
                  <MenuItem key={l.id} onClick={() => p.onLayout(l.id)}>
                    {l.name}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <SmallButton icon={<CopyAdd24Regular style={{ fontSize: 20 }} />} label={tl("Folie duplizieren")} text={tl("Duplizieren")} onClick={p.onDuplicateSlide} />
        </Rows>
      </RibbonGroup>
      {fontGroup}
      {paragraphGroup}
      {drawGroup}
    </>
  );

  const insert = (
    <>
      <RibbonGroup label={tl("Folien")}>{newSlideMenu}</RibbonGroup>
      <RibbonGroup label={tl("Tabellen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Table24Regular />} label={tl("Tabelle")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <TablePicker onPick={p.onInsertTable} />
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Bilder")}>
        <BigButton icon={<Image24Regular />} label={tl("Bild")} onClick={p.onInsertImage} />
      </RibbonGroup>
      <RibbonGroup label={tl("Links")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<SlideSearch24Regular />} label={tl("Zoom")} menu disabled={p.masterMode} />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {p.slideTitles.map((t, i) => (
                <MenuItem key={i} onClick={() => p.onInsertZoom(i)}>
                  {tl("Folie")} {i + 1}
                  {t ? `: ${t}` : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<Link24Regular />} label={tl("Link")} disabled={!p.hasSelection} onClick={p.onLink} />
      </RibbonGroup>
      <RibbonGroup label={tl("Medien")}>
        <BigButton icon={<Video24Regular />} label={tl("Video")} onClick={() => p.onInsertMedia("video")} />
        <BigButton icon={<MusicNote224Regular />} label={tl("Audio")} onClick={() => p.onInsertMedia("audio")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Diagramme")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataBarVertical24Regular />} label={tl("Diagramm")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {CHART_KINDS.filter((k) => !["waterfall", "histogram", "funnel"].includes(k.kind)).map((k) => (
                <MenuItem key={k.kind} onClick={() => p.onInsertChart(k.kind)}>
                  {k.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Illustrationen")}>
        {shapeMenu(true)}
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Connector24Regular />} label={tl("Verbinden")} menu disabled={!p.canConnect} />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onConnect(false)}>{tl("Gerade Verbindung")}</MenuItem>
              <MenuItem onClick={() => p.onConnect(true)}>{tl("Gewinkelte Verbindung")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Organization24Regular />} label={tl("SmartArt")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {SMARTART_LAYOUTS.map((l) => (
                <MenuItem key={l.id} onClick={() => p.onInsertSmartArt(l.id)}>
                  {l.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Text")}>
        <BigButton icon={<Textbox24Regular />} label={tl("Textfeld")} onClick={p.onInsertText} />
      </RibbonGroup>
    </>
  );

  const design = (
    <>
      <RibbonGroup label={tl("Designs")}>
        <div className={s.themes}>
          {THEMES.map((th) => (
            <button key={th.id} className={s.themeBtn} style={{ background: th.background, color: th.title, fontFamily: th.headingFont }} onClick={() => p.onTheme(th)} title={th.name}>
              <div style={{ fontSize: 15, lineHeight: "18px" }}>{tl("Aa")}</div>
              <div style={{ color: th.text, fontFamily: th.font }}>{th.name}</div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: th.accent }} />
            </button>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label={tl("Anpassen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<SlideSize24Regular />} label={tl("Foliengröße")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList checkedValues={{ r: [p.ratio] }}>
              <MenuItemRadio name="r" value="16:9" onClick={() => p.onSize("16:9")}>
                {tl("Breitbild (16:9)")}
              </MenuItemRadio>
              <MenuItemRadio name="r" value="4:3" onClick={() => p.onSize("4:3")}>
                {tl("Standard (4:3)")}
              </MenuItemRadio>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<ColorBackground24Regular />} label={tl("Hintergrund")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {["#ffffff", "#f4f4fb", "#fff7ed", "#f2f7f2", "#16172b", "#2b2f36", "#000000"].map((c) => (
                <MenuItem key={c} icon={<span style={{ width: 16, height: 16, borderRadius: 3, background: c, border: "1px solid #999", display: "inline-block" }} />} onClick={() => p.onBackground(c === "#ffffff" ? null : c, false)}>
                  {c}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem onClick={() => p.onBackground("__apply_all__", true)}>{tl("Auf alle Folien anwenden")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
    </>
  );

  const show = (
    <>
      <RibbonGroup label={tl("Bildschirmpräsentation starten")}>
        <BigButton icon={<Play24Regular />} label={tl("Von Beginn an")} onClick={() => p.onShow("start")} />
        <BigButton icon={<PlayCircle24Regular />} label={tl("Ab aktueller Folie")} onClick={() => p.onShow("current")} />
        <BigButton icon={<Presenter24Regular />} label="Referenten­ansicht" onClick={() => p.onShow("presenter")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Einrichten")}>
        <BigButton icon={<SlideHide24Regular />} label={p.slideHidden ? tl("Folie einblenden") : tl("Folie ausblenden")} onClick={p.onHideSlide} />
        <BigButton icon={<Timer24Regular />} label={tl("Neue Zeiten testen")} onClick={() => p.onRehearse("timings")} />
        <BigButton icon={<SlideRecord24Regular />} label={tl("Aufzeichnen")} onClick={() => p.onRehearse("record")} />
        <Rows>
          <SmallButton icon={<Timer24Regular style={{ fontSize: 20 }} />} label={tl("Zeiten aller Folien löschen")} text={tl("Zeiten löschen")} onClick={p.onClearTimings} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Exportieren")}>
        <BigButton icon={<VideoClip24Regular />} label={tl("Als Video exportieren")} onClick={p.onExportVideo} />
      </RibbonGroup>
    </>
  );

  const view = (
    <>
      <RibbonGroup label={tl("Anzeigen")}>
        <BigButton icon={<Notepad24Regular />} label={p.showNotes ? tl("Notizen aus") : tl("Notizen")} onClick={p.onToggleNotes} />
      </RibbonGroup>
      <RibbonGroup label={tl("Masteransichten")}>
        <BigButton icon={<SlideLayout24Regular />} label={p.masterMode ? tl("Masteransicht schließen") : tl("Folienmaster")} pressed={p.masterMode} onClick={() => p.onMaster(!p.masterMode)} />
        <Rows>
          <SmallButton icon={<SlideHide20Regular />} label={tl("Master-Elemente auf dieser Folie ausblenden")} text={tl("Hintergrundgrafiken ausblenden")} pressed={p.hideMaster} disabled={p.masterMode} onClick={p.onHideMaster} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Zoom")}>
        <Rows>
          <SmallButton icon={<ZoomFit20Regular />} label={tl("An Fenster anpassen")} text={tl("Anpassen")} onClick={p.onFit} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Design")}>
        <Rows>
          <SmallButton icon={<DarkTheme20Regular />} label={mode === "dark" ? tl("Helles Design") : tl("Dunkles Design")} text={mode === "dark" ? tl("Helles Design") : tl("Dunkles Design")} onClick={toggle} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Folie")}>
        <BigButton icon={<Delete24Regular />} label={tl("Folie löschen")} onClick={p.onDeleteSlide} />
      </RibbonGroup>
    </>
  );

  const tr = p.transition;
  const transitions = (
    <>
      <RibbonGroup label={tl("Übergang zu dieser Folie")}>
        {TRANSITIONS.map((x) => (
          <BigButton
            key={x.label}
            icon={<SlideTransition24Regular />}
            label={x.label}
            pressed={(tr && tr.kind !== "none" ? tr.kind : null) === x.kind}
            onClick={() =>
              p.onTransition(
                x.kind
                  ? { kind: x.kind, dir: tr?.dir, duration: tr && tr.kind !== "none" && tr.duration ? tr.duration : x.kind === "cut" ? 0 : x.kind === "morph" ? 1500 : 700, advanceAfter: tr?.advanceAfter }
                  : tr?.advanceAfter
                    ? { kind: "none", duration: 0, advanceAfter: tr.advanceAfter }
                    : null,
              )
            }
          />
        ))}
      </RibbonGroup>
      <RibbonGroup label={tl("Effektoptionen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<ArrowUp20Regular style={{ fontSize: 24 }} />} label={tl("Richtung")} menu disabled={!tr || !["push", "wipe", "cover"].includes(tr.kind)} />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {DIRS.transition.map((d) => (
                <MenuItem key={d.value} onClick={() => tr && p.onTransition({ ...tr, dir: d.value })}>
                  {d.label}
                  {(tr?.dir ?? "l") === d.value ? " ✓" : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Anzeigedauer")}>
        <Rows>
          <Combobox
            size="small"
            className={s.combo}
            style={{ width: 110 }}
            input={{ style: { minWidth: 0, width: "100%" } }}
            disabled={!tr || tr.kind === "cut" || tr.kind === "none"}
            value={tr ? `${(tr.duration / 1000).toLocaleString(LOCALE)} s` : ""}
            selectedOptions={tr ? [String(tr.duration)] : []}
            onOptionSelect={(_, d) => tr && d.optionValue && p.onTransition({ ...tr, duration: Number(d.optionValue) })}
            aria-label={tl("Dauer")}
          >
            {DURATIONS.map((d) => (
              <Option key={d} value={String(d)}>{`${(d / 1000).toLocaleString(LOCALE)} s`}</Option>
            ))}
          </Combobox>
          <SmallButton icon={<SlideTransition24Regular style={{ fontSize: 20 }} />} label={tl("Für alle übernehmen")} text={tl("Für alle übernehmen")} onClick={p.onTransitionAll} />
        </Rows>
        <Rows>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            {tl("Weiter nach")}
            <input
              type="number"
              min={0}
              step={0.5}
              aria-label={tl("Automatisch weiter nach Sekunden")}
              value={tr?.advanceAfter ? tr.advanceAfter / 1000 : ""}
              placeholder="–"
              style={{ width: 52 }}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                const ms = Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
                p.onTransition(ms || tr ? { ...(tr ?? { kind: "none", duration: 0 }), advanceAfter: ms } : null);
              }}
            />
            s
          </label>
        </Rows>
        <BigButton icon={<Eye24Regular />} label={tl("Vorschau")} disabled={!tr} onClick={p.onPreview} />
      </RibbonGroup>
    </>
  );

  const a = p.animation;
  const animations = (
    <>
      <RibbonGroup label={tl("Animation")}>
        <BigButton icon={<Sparkle24Regular />} label={tl("Keine")} pressed={!a && p.hasSelection} disabled={!p.hasSelection} onClick={() => p.onAnimation(null)} />
        {ANIM_CLASSES.map(({ cls, label }) => (
          <Menu key={cls}>
            <MenuTrigger disableButtonEnhancement>
              <span>
                <BigButton
                  icon={cls === "entr" ? <ArrowEnter20Regular style={{ fontSize: 24 }} /> : cls === "exit" ? <ArrowExit20Regular style={{ fontSize: 24 }} /> : cls === "path" ? <ArrowRouting24Regular /> : <SparkleCircle24Regular />}
                  label={label}
                  menu
                  pressed={!!a && (a.class ?? "entr") === cls}
                  disabled={!p.hasSelection}
                />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {EFFECTS[cls].map((x) => (
                  <MenuItem key={x.effect} onClick={() => (a ? p.onAnimation({ class: cls, effect: x.effect }) : p.onAddAnimation(cls, x.effect))}>
                    {x.label}
                    {a && (a.class ?? "entr") === cls && a.effect === x.effect ? " ✓" : ""}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        ))}
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<AddCircle24Regular />} label={tl("Animation hinzufügen")} menu disabled={!p.hasSelection} />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {ANIM_CLASSES.map(({ cls, label }, i) => (
                <MenuGroup key={cls}>
                  {i > 0 && <MenuDivider />}
                  <MenuGroupHeader>{label}</MenuGroupHeader>
                  {EFFECTS[cls].map((x) => (
                    <MenuItem key={x.effect} onClick={() => p.onAddAnimation(cls, x.effect)}>
                      {x.label}
                    </MenuItem>
                  ))}
                </MenuGroup>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Effektoptionen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<ArrowUp20Regular style={{ fontSize: 24 }} />} label={tl("Richtung")} menu disabled={!a || !["fly", "wipe"].includes(a.effect)} />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {DIRS.anim.map((d) => (
                <MenuItem key={d.value} onClick={() => p.onAnimation({ dir: d.value })}>
                  {a?.class === "exit" ? d.label.replace("Von", "Nach") : d.label}
                  {(a?.dir ?? "b") === d.value ? " ✓" : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<Eye24Regular />} label={tl("Vorschau")} disabled={!p.animation} onClick={p.onPreview} />
        {p.shapeAnimations.length > 1 && (
          <Rows>
            <Combobox
              size="small"
              className={s.combo}
              style={{ width: 220 }}
              input={{ style: { minWidth: 0, width: "100%" } }}
              value={a ? `${p.animIndex + 1}. ${animLabel(a)}` : ""}
              selectedOptions={[String(p.animIndex)]}
              onOptionSelect={(_, d) => d.optionValue && p.onAnimPick(Number(d.optionValue))}
              aria-label={tl("Animation der Form")}
            >
              {p.shapeAnimations.map((x, i) => (
                <Option key={i} value={String(i)}>{`${i + 1}. ${animLabel(x)}`}</Option>
              ))}
            </Combobox>
          </Rows>
        )}
      </RibbonGroup>
      <RibbonGroup label={tl("Anzeigedauer")}>
        <Rows>
          <Combobox
            size="small"
            className={s.combo}
            style={{ width: 170 }}
            input={{ style: { minWidth: 0, width: "100%" } }}
            disabled={!a}
            value={a ? (a.trigger === "with" ? tl("Mit Vorheriger") : a.trigger === "after" ? tl("Nach Vorheriger") : tl("Bei Klick")) : ""}
            selectedOptions={a ? [a.trigger] : []}
            onOptionSelect={(_, d) => d.optionValue && p.onAnimation({ trigger: d.optionValue as Animation["trigger"] })}
            aria-label={tl("Start")}
          >
            <Option value="click">{tl("Bei Klick")}</Option>
            <Option value="with">{tl("Mit Vorheriger")}</Option>
            <Option value="after">{tl("Nach Vorheriger")}</Option>
          </Combobox>
          <Combobox
            size="small"
            className={s.combo}
            style={{ width: 170 }}
            input={{ style: { minWidth: 0, width: "100%" } }}
            disabled={!a || a.effect === "appear"}
            value={a ? `Dauer: ${(a.duration / 1000).toLocaleString(LOCALE)} s` : ""}
            selectedOptions={a ? [String(a.duration)] : []}
            onOptionSelect={(_, d) => d.optionValue && p.onAnimation({ duration: Number(d.optionValue) })}
            aria-label={tl("Dauer")}
          >
            {DURATIONS.map((d) => (
              <Option key={d} value={String(d)}>{`${(d / 1000).toLocaleString(LOCALE)} s`}</Option>
            ))}
          </Combobox>
          <Combobox
            size="small"
            className={s.combo}
            style={{ width: 170 }}
            input={{ style: { minWidth: 0, width: "100%" } }}
            disabled={!a}
            value={a ? tl("Verzögerung: {0} s", ((a.delay ?? 0) / 1000).toLocaleString(LOCALE)) : ""}
            selectedOptions={a ? [String(a.delay ?? 0)] : []}
            onOptionSelect={(_, d) => d.optionValue && p.onAnimation({ delay: Number(d.optionValue) })}
            aria-label={tl("Verzögerung")}
          >
            {[0, 250, 500, 1000, 2000, 3000].map((d) => (
              <Option key={d} value={String(d)}>{`${(d / 1000).toLocaleString(LOCALE)} s`}</Option>
            ))}
          </Combobox>
        </Rows>
        <Rows>
          <SmallButton icon={<ArrowUp20Regular />} label={tl("Früher")} text={tl("Früher")} disabled={!a} onClick={() => p.onAnimMove(-1)} />
          <SmallButton icon={<ArrowDown20Regular />} label={tl("Später")} text={tl("Später")} disabled={!a} onClick={() => p.onAnimMove(1)} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const tb = p.table;
  const tableTab = tb ? (
    <>
      <RibbonGroup label={tl("Tabellenformatoptionen")}>
        <Rows>
          <SmallButton icon={<Table24Regular style={{ fontSize: 20 }} />} label={tl("Kopfzeile")} text={tl("Kopfzeile")} pressed={!!tb.header} onClick={() => p.onTable("header")} />
          <SmallButton icon={<Table24Regular style={{ fontSize: 20 }} />} label={tl("Gebänderte Zeilen")} text={tl("Gebänderte Zeilen")} pressed={!!tb.banded} onClick={() => p.onTable("banded")} />
        </Rows>
        <Rows>
          <ColorButton icon={<PaintBucket20Regular />} label={tl("Tabellenfarbe")} value={tb.color ?? "#4472c4"} onPick={(c) => c && p.onTableColor(c)} />
          <ColorButton icon={<PaintBucket20Regular />} label={tl("Zellenfarbe")} value="#ffeb9c" noneLabel={tl("Keine Füllung")} onPick={p.onCellFill} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Zeilen und Spalten")}>
        <Rows>
          <SmallButton icon={<TableInsertRow20Regular />} label={tl("Oberhalb einfügen")} text={tl("Oberhalb einfügen")} onClick={() => p.onTable("rowAbove")} />
          <SmallButton icon={<TableInsertRow20Regular />} label={tl("Unterhalb einfügen")} text={tl("Unterhalb einfügen")} onClick={() => p.onTable("rowBelow")} />
        </Rows>
        <Rows>
          <SmallButton icon={<TableInsertColumn20Regular />} label={tl("Links einfügen")} text={tl("Links einfügen")} onClick={() => p.onTable("colLeft")} />
          <SmallButton icon={<TableInsertColumn20Regular />} label={tl("Rechts einfügen")} text={tl("Rechts einfügen")} onClick={() => p.onTable("colRight")} />
        </Rows>
        <Rows>
          <SmallButton icon={<TableDeleteRow20Regular />} label={tl("Zeile löschen")} text={tl("Zeile löschen")} disabled={tb.rows.length <= 1} onClick={() => p.onTable("delRow")} />
          <SmallButton icon={<TableDeleteColumn20Regular />} label={tl("Spalte löschen")} text={tl("Spalte löschen")} disabled={tb.cols.length <= 1} onClick={() => p.onTable("delCol")} />
        </Rows>
      </RibbonGroup>
    </>
  ) : null;

  const ch = p.chart;
  const chartTab = ch ? (
    <>
      <RibbonGroup label={tl("Typ")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataBarVertical24Regular />} label={tl("Diagrammtyp ändern")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {CHART_KINDS.filter((k) => !["waterfall", "histogram", "funnel"].includes(k.kind)).map((k) => (
                <MenuItem key={k.kind} onClick={() => p.onChartPatch({ kind: k.kind })}>
                  {k.label}
                  {ch.kind === k.kind ? " ✓" : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Daten")}>
        <BigButton icon={<Table24Regular />} label={tl("Daten bearbeiten")} onClick={p.onChartData} />
      </RibbonGroup>
      <RibbonGroup label={tl("Diagrammelemente")}>
        <BigButton icon={<Textbox24Regular />} label={tl("Diagrammtitel")} onClick={p.onChartTitle} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DataBarVertical24Regular />} label={tl("Legende")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {(
                [
                  [undefined, tl("Keine")],
                  ["r", tl("Rechts")],
                  ["b", tl("Unten")],
                  ["t", tl("Oben")],
                  ["l", tl("Links")],
                ] as [string | undefined, string][]
              ).map(([v, label]) => (
                <MenuItem key={label} onClick={() => p.onChartPatch({ legend: v })}>
                  {label}
                  {ch.legend === v ? " ✓" : ""}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <Rows>
          <SmallButton icon={<DataBarVertical24Regular style={{ fontSize: 20 }} />} label={tl("Datenbeschriftungen")} text={tl("Datenbeschriftungen")} pressed={!!ch.labels} onClick={() => p.onChartPatch({ labels: !ch.labels })} />
          <SmallButton icon={<DataBarVertical24Regular style={{ fontSize: 20 }} />} label={tl("Gestapelt")} text={tl("Gestapelt")} pressed={!!ch.stacked} disabled={!["column", "bar", "line", "area"].includes(ch.kind)} onClick={() => p.onChartPatch({ stacked: !ch.stacked })} />
        </Rows>
      </RibbonGroup>
    </>
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
        { id: "design", label: tl("Entwurf"), content: design },
        { id: "transitions", label: tl("Übergänge"), content: transitions },
        { id: "animations", label: tl("Animationen"), content: animations },
        { id: "show", label: tl("Bildschirmpräsentation"), content: show },
        {
          id: "review",
          label: tl("Überprüfen"),
          content: (
            <RibbonGroup label={tl("Barrierefreiheit")}>
              <BigButton icon={<AccessibilityCheckmark24Regular />} label={tl("Barrierefreiheit überprüfen")} pressed={p.a11yOpen} onClick={p.onA11y} />
            </RibbonGroup>
          ),
        },
        { id: "view", label: tl("Ansicht"), content: view },
        ...(tableTab ? [{ id: "table", label: tl("Tabellenentwurf"), contextual: true, content: tableTab }] : []),
        ...(chartTab ? [{ id: "chart", label: tl("Diagrammentwurf"), contextual: true, content: chartTab }] : []),
      ]}
    />
  );
}
