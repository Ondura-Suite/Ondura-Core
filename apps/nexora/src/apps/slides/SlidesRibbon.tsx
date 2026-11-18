import { Combobox, Menu, MenuDivider, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Option, makeStyles, tokens } from "@fluentui/react-components";
import {
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
} from "@fluentui/react-icons";
import { BigButton, ColorButton, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton } from "../../shell/office";
import { useThemeMode } from "../../shell/theme";
import { FONTS, SIZES } from "../text/TextRibbon";
import { LAYOUTS, type LayoutId, SHAPE_KINDS, THEMES, type DesignTheme, geometryPath } from "./model";

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
        <span>{big ? <BigButton icon={<Shapes24Regular />} label="Formen" menu /> : <SmallButton icon={<Shapes24Regular style={{ fontSize: 20 }} />} label="Formen" text="Formen" menu />}</span>
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
          <BigButton icon={<SlideAdd24Regular />} label="Neue Folie" menu />
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
    <RibbonGroup label="Schriftart">
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
          <SmallButton icon={<FontIncrease20Regular />} label="Schriftgrad vergrößern" disabled={!p.hasSelection} onClick={() => p.onText({ grow: 1 })} />
          <SmallButton icon={<FontDecrease20Regular />} label="Schriftgrad verkleinern" disabled={!p.hasSelection} onClick={() => p.onText({ grow: -1 })} />
        </Row>
        <Row>
          <SmallButton icon={<TextBold20Regular />} label="Fett" shortcut="Strg+B" pressed={t.bold} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "bold" })} />
          <SmallButton icon={<TextItalic20Regular />} label="Kursiv" shortcut="Strg+I" pressed={t.italic} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "italic" })} />
          <SmallButton icon={<TextUnderline20Regular />} label="Unterstrichen" shortcut="Strg+U" pressed={t.underline} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "underline" })} />
          <SmallButton icon={<TextStrikethrough20Regular />} label="Durchgestrichen" pressed={t.strike} disabled={!p.hasSelection} onClick={() => p.onText({ toggle: "strike" })} />
          <ColorButton icon={<TextColor20Regular />} label="Schriftfarbe" value="#c00000" onPick={(c) => p.onText({ color: c })} />
        </Row>
      </Rows>
    </RibbonGroup>
  );

  const paragraphGroup = (
    <RibbonGroup label="Absatz">
      <Rows>
        <Row>
          <SmallButton icon={<TextBulletListLtr20Regular />} label="Aufzählungszeichen" pressed={t.bullet === "•"} disabled={!p.hasSelection} onClick={() => p.onText({ bullet: "•" })} />
          <SmallButton icon={<TextNumberListLtr20Regular />} label="Nummerierung" pressed={t.bullet === "#"} disabled={!p.hasSelection} onClick={() => p.onText({ bullet: "#" })} />
          <SmallButton icon={<TextIndentDecreaseLtr20Regular />} label="Listenebene verringern" disabled={!p.hasSelection} onClick={() => p.onText({ indent: -1 })} />
          <SmallButton icon={<TextIndentIncreaseLtr20Regular />} label="Listenebene erhöhen" disabled={!p.hasSelection} onClick={() => p.onText({ indent: 1 })} />
        </Row>
        <Row>
          <SmallButton icon={<TextAlignLeft20Regular />} label="Linksbündig" pressed={t.align === "left"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "left" })} />
          <SmallButton icon={<TextAlignCenter20Regular />} label="Zentriert" pressed={t.align === "center"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "center" })} />
          <SmallButton icon={<TextAlignRight20Regular />} label="Rechtsbündig" pressed={t.align === "right"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "right" })} />
          <SmallButton icon={<TextAlignJustify20Regular />} label="Blocksatz" pressed={t.align === "justify"} disabled={!p.hasSelection} onClick={() => p.onText({ align: "justify" })} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<AlignCenterVertical20Regular />} label="Text vertikal ausrichten" disabled={!p.hasSelection} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<AlignTop20Regular />} onClick={() => p.onAnchor("top")}>Oben</MenuItem>
                <MenuItem icon={<AlignCenterVertical20Regular />} onClick={() => p.onAnchor("middle")}>Mitte</MenuItem>
                <MenuItem icon={<AlignBottom20Regular />} onClick={() => p.onAnchor("bottom")}>Unten</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Row>
      </Rows>
    </RibbonGroup>
  );

  const drawGroup = (
    <RibbonGroup label="Zeichnen">
      <Rows>
        {shapeMenu(false)}
        <Row>
          <ColorButton icon={<PaintBucket20Regular />} label="Fülleffekt" value="#4472c4" noneLabel="Keine Füllung" onPick={p.onFill} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<BorderOutside20Regular />} label="Formkontur" disabled={!p.hasSelection} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={() => p.onLine(null)}>Keine Kontur</MenuItem>
                <MenuItem onClick={() => p.onLine("#000000", 1)}>Schwarz</MenuItem>
                <MenuItem onClick={() => p.onLine("#4472c4", 1)}>Blau</MenuItem>
                <MenuItem onClick={() => p.onLine("#c00000", 1)}>Rot</MenuItem>
                <MenuItem onClick={() => p.onLine("#7f7f7f", 1)}>Grau</MenuItem>
                <MenuDivider />
                {[0.75, 1.5, 3, 6].map((w) => (
                  <MenuItem key={w} onClick={() => p.onLine(undefined as unknown as string, w)}>
                    Stärke {String(w).replace(".", ",")} Pt
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<PositionToFront20Regular />} label="Anordnen" disabled={!p.hasSelection} menu />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<PositionToFront20Regular />} onClick={() => p.onArrange("front")}>In den Vordergrund</MenuItem>
                <MenuItem icon={<PositionForward20Regular />} onClick={() => p.onArrange("forward")}>Eine Ebene nach vorne</MenuItem>
                <MenuItem icon={<PositionBackward20Regular />} onClick={() => p.onArrange("backward")}>Eine Ebene nach hinten</MenuItem>
                <MenuItem icon={<PositionToBack20Regular />} onClick={() => p.onArrange("back")}>In den Hintergrund</MenuItem>
                <MenuDivider />
                <MenuItem icon={<AlignLeft20Regular />} onClick={() => p.onAlign("left")}>Linksbündig ausrichten</MenuItem>
                <MenuItem icon={<AlignCenterHorizontal20Regular />} onClick={() => p.onAlign("center")}>Horizontal zentrieren</MenuItem>
                <MenuItem icon={<AlignRight20Regular />} onClick={() => p.onAlign("right")}>Rechtsbündig ausrichten</MenuItem>
                <MenuItem icon={<AlignTop20Regular />} onClick={() => p.onAlign("top")}>Oben ausrichten</MenuItem>
                <MenuItem icon={<AlignCenterVertical20Regular />} onClick={() => p.onAlign("middle")}>Vertikal zentrieren</MenuItem>
                <MenuItem icon={<AlignBottom20Regular />} onClick={() => p.onAlign("bottom")}>Unten ausrichten</MenuItem>
                <MenuDivider />
                <MenuItem icon={<RotateRight20Regular />} onClick={() => p.onFlip("rotate")}>Um 90° drehen</MenuItem>
                <MenuItem icon={<FlipHorizontal20Regular />} onClick={() => p.onFlip("h")}>Horizontal kippen</MenuItem>
                <MenuItem icon={<FlipVertical20Regular />} onClick={() => p.onFlip("v")}>Vertikal kippen</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </Row>
      </Rows>
    </RibbonGroup>
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
      <RibbonGroup label="Folien">
        {newSlideMenu}
        <Rows>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<SlideLayout24Regular style={{ fontSize: 20 }} />} label="Layout" text="Layout" menu />
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
          <SmallButton icon={<CopyAdd24Regular style={{ fontSize: 20 }} />} label="Folie duplizieren" text="Duplizieren" onClick={p.onDuplicateSlide} />
        </Rows>
      </RibbonGroup>
      {fontGroup}
      {paragraphGroup}
      {drawGroup}
    </>
  );

  const insert = (
    <>
      <RibbonGroup label="Folien">{newSlideMenu}</RibbonGroup>
      <RibbonGroup label="Bilder">
        <BigButton icon={<Image24Regular />} label="Bild" onClick={p.onInsertImage} />
      </RibbonGroup>
      <RibbonGroup label="Illustrationen">{shapeMenu(true)}</RibbonGroup>
      <RibbonGroup label="Text">
        <BigButton icon={<Textbox24Regular />} label="Textfeld" onClick={p.onInsertText} />
      </RibbonGroup>
    </>
  );

  const design = (
    <>
      <RibbonGroup label="Designs">
        <div className={s.themes}>
          {THEMES.map((th) => (
            <button key={th.id} className={s.themeBtn} style={{ background: th.background, color: th.title, fontFamily: th.headingFont }} onClick={() => p.onTheme(th)} title={th.name}>
              <div style={{ fontSize: 15, lineHeight: "18px" }}>Aa</div>
              <div style={{ color: th.text, fontFamily: th.font }}>{th.name}</div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: th.accent }} />
            </button>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="Anpassen">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<SlideSize24Regular />} label="Foliengröße" menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList checkedValues={{ r: [p.ratio] }}>
              <MenuItemRadio name="r" value="16:9" onClick={() => p.onSize("16:9")}>
                Breitbild (16:9)
              </MenuItemRadio>
              <MenuItemRadio name="r" value="4:3" onClick={() => p.onSize("4:3")}>
                Standard (4:3)
              </MenuItemRadio>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<ColorBackground24Regular />} label="Hintergrund" menu />
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
              <MenuItem onClick={() => p.onBackground("__apply_all__", true)}>Auf alle Folien anwenden</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
    </>
  );

  const show = (
    <>
      <RibbonGroup label="Bildschirmpräsentation starten">
        <BigButton icon={<Play24Regular />} label="Von Beginn an" onClick={() => p.onShow("start")} />
        <BigButton icon={<PlayCircle24Regular />} label="Ab aktueller Folie" onClick={() => p.onShow("current")} />
        <BigButton icon={<Presenter24Regular />} label="Referenten­ansicht" onClick={() => p.onShow("presenter")} />
      </RibbonGroup>
      <RibbonGroup label="Einrichten">
        <BigButton icon={<SlideHide24Regular />} label={p.slideHidden ? "Folie einblenden" : "Folie ausblenden"} onClick={p.onHideSlide} />
      </RibbonGroup>
    </>
  );

  const view = (
    <>
      <RibbonGroup label="Anzeigen">
        <BigButton icon={<Notepad24Regular />} label={p.showNotes ? "Notizen aus" : "Notizen"} onClick={p.onToggleNotes} />
      </RibbonGroup>
      <RibbonGroup label="Zoom">
        <Rows>
          <SmallButton icon={<ZoomFit20Regular />} label="An Fenster anpassen" text="Anpassen" onClick={p.onFit} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Design">
        <Rows>
          <SmallButton icon={<DarkTheme20Regular />} label={mode === "dark" ? "Helles Design" : "Dunkles Design"} text={mode === "dark" ? "Helles Design" : "Dunkles Design"} onClick={toggle} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label="Folie">
        <BigButton icon={<Delete24Regular />} label="Folie löschen" onClick={p.onDeleteSlide} />
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
        { id: "design", label: "Entwurf", content: design },
        { id: "show", label: "Bildschirmpräsentation", content: show },
        { id: "view", label: "Ansicht", content: view },
      ]}
    />
  );
}
