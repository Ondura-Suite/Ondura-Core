import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Combobox,
  Menu,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRedo20Regular,
  ArrowSwap20Regular,
  ArrowUndo20Regular,
  CalendarLtr24Regular,
  ClipboardPaste24Regular,
  Copy20Regular,
  Cut20Regular,
  DarkTheme20Regular,
  Delete20Regular,
  DocumentHeaderFooter24Regular,
  DocumentLandscape24Regular,
  DocumentMargins24Regular,
  DocumentOnePage24Regular,
  DocumentPageBreak24Regular,
  DocumentPageNumber24Regular,
  FontDecrease20Regular,
  FontIncrease20Regular,
  Highlight20Regular,
  Image24Regular,
  Link24Regular,
  PageFit24Regular,
  PaintBucket20Regular,
  Search20Regular,
  SlideSize24Regular,
  Symbols24Regular,
  Table24Regular,
  TableCellsMerge20Regular,
  TableCellsSplit20Regular,
  TableDeleteColumn20Regular,
  TableDeleteRow20Regular,
  TableDismiss20Regular,
  TableFreezeRow20Regular,
  TableInsertColumn20Regular,
  TableInsertRow20Regular,
  TextAlignCenter20Regular,
  TextAlignJustify20Regular,
  TextAlignLeft20Regular,
  TextAlignRight20Regular,
  TextBold20Regular,
  TextBulletListLtr20Regular,
  TextClearFormatting20Regular,
  TextColor20Regular,
  TextIndentDecreaseLtr20Regular,
  TextIndentIncreaseLtr20Regular,
  TextItalic20Regular,
  TextLineSpacing20Regular,
  TextNumberListLtr20Regular,
  TextParagraph24Regular,
  TextStrikethrough20Regular,
  TextSubscript20Regular,
  TextSuperscript20Regular,
  TextUnderline20Regular,
  ZoomIn20Regular,
  ZoomOut20Regular,
  ArrowNext20Regular,
  ArrowPrevious20Regular,
  ArrowSync20Regular,
  CheckmarkCircle24Regular,
  CommentAdd24Regular,
  CommentDismiss24Regular,
  DismissCircle24Regular,
  DocumentBulletList24Regular,
  DocumentEdit24Regular,
  Person20Regular,
  TextFootnote24Regular,
  TextProofingTools24Regular,
  AccessibilityCheckmark24Regular,
  Code24Regular,
  ImageAltText24Regular,
  LinkSquare24Regular,
  DocumentBulletListMultiple24Regular,
  TagAdd24Regular,
  BookOpen24Regular,
  BookAdd24Regular,
  Library24Regular,
  TextQuote24Regular,
  Braces24Regular,
  TextGrammarCheckmark24Regular,
  TextWordCount24Regular,
  LocalLanguage24Regular,
  PeopleList24Regular,
  PeopleEdit20Regular,
  ContactCardGroup24Regular,
  HandWave20Regular,
  Eye24Regular,
  Previous20Regular,
  Next20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  DocumentArrowRight24Regular,
  DocumentEdit20Regular,
  Print20Regular,
  DocumentPdf20Regular,
  CheckboxChecked20Regular,
  AppsListDetail20Regular,
  CalendarLtr20Regular,
  TextboxSettings20Regular,
  Form24Regular,
  TextEditStyle20Regular,
  Shapes24Regular,
  Textbox24Regular,
  MathFormula24Regular,
  TextColumnTwo24Regular,
  TextCaseUppercase24Regular,
  PaintBucket24Regular,
  DocumentBorder24Regular,
  DocumentText24Regular,
  DocumentSplitHint24Regular,
  ShieldLock24Regular,
  ReadAloud24Regular,
  Mic24Regular,
  Translate24Regular,
  TextGrammarWand24Regular,
  TextBulletListTree24Regular,
  ImmersiveReader24Regular,
  Mail24Regular,
  TagMultiple24Regular,
} from "@fluentui/react-icons";
import { isTracking } from "./review";
import { selectedControl } from "./controls";
import { BigButton, ColorButton, HIGHLIGHT_COLORS, OfficeRibbon, RibbonGroup, Row, Rows, SmallButton, type RibbonTab } from "../../shell/office";
import { useThemeMode } from "../../shell/theme";
import { MARGIN_PRESETS, PAPER_SIZES } from "./dialogs";
import type { PageSetup, ShapeKind } from "./model";
import { SHAPES } from "./textExtras";
import { readClipboardHtml, readClipboardText } from "../../shell/contextMenu";
import { tl, tlc, LOCALE } from "../../lib/i18n";

export const FONTS = [tl("Calibri"), tl("Aptos"), tl("Arial"), tl("Cambria"), tl("Candara"), tl("Consolas"), tl("Courier New"), tl("Garamond"), tl("Georgia"), tl("Segoe UI"), tl("Tahoma"), tl("Times New Roman"), tl("Trebuchet MS"), tl("Verdana")];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const SYMBOLS = ["©", "®", "™", "€", "£", "¥", "§", "¶", "°", "±", "×", "÷", "≈", "≠", "≤", "≥", "∞", "√", "µ", "½", "¼", "¾", "→", "←", "↑", "↓", "⇒", "•", "…", "–", "—", "„", "“", "‚", "‘", "»", "«", "✓", "✗", "★", "☐", "☑", "♥", "α", "β", "π", "Σ", "Ω"];

const STYLES: { id: string; label: string; css: React.CSSProperties }[] = [
  { id: "normal", label: tl("Standard"), css: { fontSize: 13 } },
  { id: "title", label: tl("Titel"), css: { fontSize: 20, lineHeight: "22px" } },
  { id: "subtitle", label: tl("Untertitel"), css: { fontSize: 14, color: "#595959" } },
  { id: "heading1", label: tl("Überschrift 1"), css: { fontSize: 15, color: "#1f3864", fontWeight: 700 } },
  { id: "heading2", label: tl("Überschrift 2"), css: { fontSize: 14, color: "#1f3864", fontWeight: 700 } },
  { id: "heading3", label: tl("Überschrift 3"), css: { fontSize: 13, color: "#1f3864", fontWeight: 700 } },
  { id: "quote", label: tl("Zitat"), css: { fontSize: 13, fontStyle: "italic", color: "#404040" } },
  { id: "code", label: tl("Code"), css: { fontSize: 12, fontFamily: "Consolas, monospace" } },
  { id: "caption", label: tl("Beschriftung"), css: { fontSize: 11, fontStyle: "italic", color: "#44546a" } },
];

const useStyles = makeStyles({
  combo: { minWidth: "unset" },
  styleGallery: { display: "grid", gridTemplateColumns: "repeat(5, 96px)", gap: "3px" },
  styleItem: {
    height: "29px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    background: "#fff",
    color: "#000",
    padding: "0 6px",
    textAlign: "left",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    cursor: "pointer",
    fontFamily: "Calibri, Carlito, 'Segoe UI', sans-serif",
    ":hover": { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  styleActive: { border: `2px solid ${tokens.colorBrandStroke1}`, padding: "0 5px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(10, 18px)", gap: "2px", padding: "4px" },
  gridCell: { width: "18px", height: "18px", border: `1px solid ${tokens.colorNeutralStroke1}`, background: "#fff", padding: 0, cursor: "pointer" },
  gridOn: { backgroundColor: tokens.colorBrandBackground2, border: `1px solid ${tokens.colorBrandStroke1}` },
  symbols: { display: "grid", gridTemplateColumns: "repeat(10, 28px)", gap: "2px" },
  symbol: { height: "28px", border: "none", borderRadius: "4px", background: "transparent", fontSize: "16px", cursor: "pointer", color: tokens.colorNeutralForeground1, ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover } },
});

export interface TextRibbonProps {
  editor: Editor;
  color: string;
  page: PageSetup;
  zoom: number;
  onFile: () => void;
  onLink: () => void;
  onImage: () => void;
  onPageSetup: () => void;
  onPageChange: (p: PageSetup) => void;
  onHeaderFooter: () => void;
  onParagraph: () => void;
  onFind: (replace: boolean) => void;
  onZoom: (z: number | "width" | "page") => void;
  onToc: (mode: "insert" | "update") => void;
  onFootnote: (endnote: boolean) => void;
  onSectionBreak: () => void;
  onComment: (action: "new" | "delete" | "next" | "prev") => void;
  onTrack: (action: "toggle" | "accept" | "acceptAll" | "reject" | "rejectAll" | "next" | "prev") => void;
  onUserName: () => void;
  hasComments: boolean;
  /** Proofing. */
  spellAuto: boolean;
  spellLang: "de" | "en" | "fr";
  onSpelling: () => void;
  onSpellAuto: () => void;
  onSpellLang: (l: "de" | "en" | "fr") => void;
  onWordCount: () => void;
  /** Accessibility checker pane. */
  a11yOpen: boolean;
  onMacros: () => void;
  onA11y: () => void;
  /** References. */
  onRefs: (a: "caption" | "crossref" | "figures" | "mark" | "index" | "cite" | "sources" | "bibliography" | "update") => void;
  onInsertField: (field: string) => void;
  /** Mail merge. */
  merge: MergeInfo | null;
  onMerge: (a: MergeAction) => void;
  /** Developer tab: content controls. */
  onControl: (a: "text" | "checkbox" | "dropdown" | "date" | "properties") => void;
  /** Styles: change one, or take the look of the selection. */
  onStyleEdit: (id: string, action: "modify" | "match") => void;
  /** CSS of the gallery items (changed styles). */
  styleCss?: Record<string, React.CSSProperties>;
  /** Layout, proofing and view tools. */
  onTool: (a: TextTool) => void;
  /** Reading aloud / reading mode. */
  speaking: boolean;
  readMode: boolean;
  dictating: boolean;
  outline: boolean;
  /** Editing restriction in force. */
  restricted: boolean;
}

export type TextTool =
  | "math"
  | "textBox"
  | "pageColor"
  | "pageBorder"
  | "watermark"
  | "compare"
  | "protect"
  | "readAloud"
  | "grammar"
  | "translate"
  | "outline"
  | "reading"
  | "dictate"
  | "envelope"
  | "labels";

export interface MergeInfo {
  columns: string[];
  preview: boolean;
  highlight: boolean;
  /** Current record (0-based) and number of selected records. */
  index: number;
  count: number;
}

export type MergeAction = "file" | "contacts" | "new" | "edit" | "address" | "greeting" | "highlight" | "preview" | "first" | "prev" | "next" | "last" | "finishEdit" | "finishPrint" | "finishPdf";

function current(editor: Editor) {
  const ts = editor.getAttributes("textStyle");
  const para = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  let style = "normal";
  if (editor.isActive("heading")) style = `heading${editor.getAttributes("heading").level}`;
  else if (editor.isActive("codeBlock")) style = "code";
  else if (editor.isActive("blockquote")) style = "quote";
  else if (para.docStyle) style = para.docStyle;
  return {
    control: !!selectedControl(editor),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    sub: editor.isActive("subscript"),
    sup: editor.isActive("superscript"),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    align: (para.textAlign as string) ?? "left",
    font: ((ts.fontFamily as string) ?? "").split(",")[0].replace(/["']/g, "") || "",
    size: ts.fontSize ? parseFloat(ts.fontSize) : null,
    color: (ts.color as string) ?? null,
    lineHeight: para.lineHeight ? parseFloat(para.lineHeight) : null,
    style,
    inTable: editor.isActive("table"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    canMerge: editor.can().mergeCells(),
    canSplit: editor.can().splitCell(),
    link: editor.isActive("link"),
    tracking: isTracking(editor),
    inComment: editor.isActive("comment"),
  };
}

export function TextRibbon(p: TextRibbonProps) {
  const s = useStyles();
  const { editor } = p;
  const st = useEditorState({ editor, selector: ({ editor: e }) => current(e) })!;
  const [tab, setTab] = useState("home");
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const { toggle, mode } = useThemeMode();
  const run = () => editor.chain().focus();

  const setSize = (v: number) => v > 0 && run().setFontSize(`${v}pt`).run();
  const stepSize = (dir: 1 | -1) => {
    const cur = st.size ?? 11;
    const next = dir > 0 ? SIZES.find((x) => x > cur) ?? cur + 4 : [...SIZES].reverse().find((x) => x < cur) ?? Math.max(1, cur - 1);
    setSize(next);
  };

  const home = (
    <>
      <RibbonGroup label={tl("Zwischenablage")}>
        <BigButton icon={<ClipboardPaste24Regular />} label={tlc("paste", "Einfügen")} onClick={() => void pasteInto(editor)} />
        <Rows>
          <SmallButton icon={<Cut20Regular />} label={tl("Ausschneiden")} shortcut="Strg+X" onClick={() => (editor.commands.focus(), document.execCommand("cut"))} />
          <SmallButton icon={<Copy20Regular />} label={tl("Kopieren")} shortcut="Strg+C" onClick={() => (editor.commands.focus(), document.execCommand("copy"))} />
        </Rows>
        <Rows>
          <SmallButton icon={<ArrowUndo20Regular />} label={tl("Rückgängig")} shortcut="Strg+Z" disabled={!st.canUndo} onClick={() => run().undo().run()} />
          <SmallButton icon={<ArrowRedo20Regular />} label={tl("Wiederholen")} shortcut="Strg+Y" disabled={!st.canRedo} onClick={() => run().redo().run()} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Schriftart")}>
        <Rows>
          <Row>
            <Combobox
              className={s.combo}
              style={{ width: 150 }}
              size="small"
              freeform
              value={st.font || tl("Calibri")}
              selectedOptions={st.font ? [st.font] : []}
              onOptionSelect={(_, d) => d.optionValue && run().setFontFamily(d.optionValue).run()}
              onKeyDown={(e) => {
                if (e.key === "Enter") run().setFontFamily((e.target as HTMLInputElement).value).run();
              }}
              listbox={{ style: { maxHeight: 320 } }}
            >
              {FONTS.map((f) => (
                <Option key={f} value={f} text={f}>
                  <span style={{ fontFamily: f }}>{f}</span>
                </Option>
              ))}
            </Combobox>
            <Combobox
              className={s.combo}
              style={{ width: 70 }}
              size="small"
              freeform
              value={String(st.size ?? 11).replace(".", ",")}
              selectedOptions={st.size ? [String(st.size)] : []}
              onOptionSelect={(_, d) => d.optionValue && setSize(Number(d.optionValue))}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSize(parseFloat((e.target as HTMLInputElement).value.replace(",", ".")));
              }}
              listbox={{ style: { maxHeight: 320 } }}
            >
              {SIZES.map((v) => (
                <Option key={v} value={String(v)} text={String(v).replace(".", ",")}>
                  {String(v).replace(".", ",")}
                </Option>
              ))}
            </Combobox>
            <SmallButton icon={<FontIncrease20Regular />} label={tl("Schriftgrad vergrößern")} shortcut="Strg+>" onClick={() => stepSize(1)} />
            <SmallButton icon={<FontDecrease20Regular />} label={tl("Schriftgrad verkleinern")} shortcut="Strg+<" onClick={() => stepSize(-1)} />
          </Row>
          <Row>
            <SmallButton icon={<TextBold20Regular />} label={tl("Fett")} shortcut="Strg+B" pressed={st.bold} onClick={() => run().toggleBold().run()} />
            <SmallButton icon={<TextItalic20Regular />} label={tl("Kursiv")} shortcut="Strg+I" pressed={st.italic} onClick={() => run().toggleItalic().run()} />
            <SmallButton icon={<TextUnderline20Regular />} label={tl("Unterstrichen")} shortcut="Strg+U" pressed={st.underline} onClick={() => run().toggleUnderline().run()} />
            <SmallButton icon={<TextStrikethrough20Regular />} label={tl("Durchgestrichen")} pressed={st.strike} onClick={() => run().toggleStrike().run()} />
            <SmallButton icon={<TextSubscript20Regular />} label={tl("Tiefgestellt")} shortcut="Strg+," pressed={st.sub} onClick={() => run().unsetSuperscript().toggleSubscript().run()} />
            <SmallButton icon={<TextSuperscript20Regular />} label={tl("Hochgestellt")} shortcut="Strg+." pressed={st.sup} onClick={() => run().unsetSubscript().toggleSuperscript().run()} />
            <ColorButton icon={<Highlight20Regular />} label={tl("Texthervorhebungsfarbe")} value="#ffff00" colors={HIGHLIGHT_COLORS} noneLabel={tl("Keine Farbe")} onPick={(c) => (c ? run().setHighlight({ color: c }).run() : run().unsetHighlight().run())} />
            <ColorButton icon={<TextColor20Regular />} label={tl("Schriftfarbe")} value="#c00000" onPick={(c) => (c ? run().setColor(c).run() : run().unsetColor().run())} />
            <SmallButton icon={<TextClearFormatting20Regular />} label={tl("Formatierung löschen")} onClick={() => run().unsetAllMarks().setParagraph().run()} />
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Absatz")}>
        <Rows>
          <Row>
            <SmallButton icon={<TextBulletListLtr20Regular />} label={tl("Aufzählungszeichen")} pressed={st.bullet} onClick={() => run().toggleBulletList().run()} />
            <SmallButton icon={<TextNumberListLtr20Regular />} label={tl("Nummerierung")} pressed={st.ordered} onClick={() => run().toggleOrderedList().run()} />
            <SmallButton icon={<TextIndentDecreaseLtr20Regular />} label={tl("Einzug verkleinern")} onClick={() => run().indent(-1).run()} />
            <SmallButton icon={<TextIndentIncreaseLtr20Regular />} label={tl("Einzug vergrößern")} onClick={() => run().indent(1).run()} />
          </Row>
          <Row>
            <SmallButton icon={<TextAlignLeft20Regular />} label={tl("Linksbündig")} shortcut="Strg+L" pressed={st.align === "left"} onClick={() => run().setTextAlign("left").run()} />
            <SmallButton icon={<TextAlignCenter20Regular />} label={tl("Zentriert")} shortcut="Strg+E" pressed={st.align === "center"} onClick={() => run().setTextAlign("center").run()} />
            <SmallButton icon={<TextAlignRight20Regular />} label={tl("Rechtsbündig")} shortcut="Strg+R" pressed={st.align === "right"} onClick={() => run().setTextAlign("right").run()} />
            <SmallButton icon={<TextAlignJustify20Regular />} label={tl("Blocksatz")} shortcut="Strg+J" pressed={st.align === "justify"} onClick={() => run().setTextAlign("justify").run()} />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <SmallButton icon={<TextLineSpacing20Regular />} label={tl("Zeilen- und Absatzabstand")} menu />
              </MenuTrigger>
              <MenuPopover>
                <MenuList checkedValues={{ lh: [String(st.lineHeight ?? 1.15)] }}>
                  {[1, 1.15, 1.5, 2, 2.5, 3].map((v) => (
                    <MenuItemRadio key={v} name="lh" value={String(v)} onClick={() => run().setParagraphSpacing({ lineHeight: v === 1.15 ? null : String(v) }).run()}>
                      {v.toLocaleString(LOCALE, { minimumFractionDigits: 1 })}
                    </MenuItemRadio>
                  ))}
                  <MenuItem onClick={() => run().setParagraphSpacing({ spaceBefore: 12 }).run()}>{tl("Abstand vor Absatz hinzufügen")}</MenuItem>
                  <MenuItem onClick={() => run().setParagraphSpacing({ spaceAfter: 0 }).run()}>{tl("Abstand nach Absatz entfernen")}</MenuItem>
                  <MenuItem onClick={p.onParagraph}>{tl("Absatzoptionen…")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Formatvorlagen")}>
        <div className={s.styleGallery}>
          {STYLES.map((x) => (
            <Menu key={x.id} openOnContext>
              <MenuTrigger disableButtonEnhancement>
                <button className={`${s.styleItem} ${st.style === x.id ? s.styleActive : ""}`} style={{ ...x.css, ...p.styleCss?.[x.id] }} onClick={() => editor.commands.setDocStyle(x.id)} title={tl("{0} (Rechtsklick zum Ändern)", x.label)}>
                  {x.label}
                </button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem disabled={x.id === "code"} onClick={() => p.onStyleEdit(x.id, "match")}>
                    „{x.label}{tl("“ aktualisieren, um der Auswahl zu entsprechen")}
                  </MenuItem>
                  <MenuItem disabled={x.id === "code"} onClick={() => p.onStyleEdit(x.id, "modify")}>
                    {tl("Ändern …")}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ))}
        </div>
        <Rows>
          <SmallButton icon={<TextEditStyle20Regular />} label={tl("Formatvorlage ändern")} onClick={() => p.onStyleEdit(st.style === "code" ? "normal" : st.style, "modify")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Bearbeiten")}>
        <Rows>
          <SmallButton icon={<Search20Regular />} label={tl("Suchen")} text={tl("Suchen")} shortcut="Strg+F" onClick={() => p.onFind(false)} />
          <SmallButton icon={<ArrowSwap20Regular />} label={tl("Ersetzen")} text={tl("Ersetzen")} shortcut="Strg+H" onClick={() => p.onFind(true)} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Diktat")}>
        <BigButton icon={<Mic24Regular style={p.dictating ? { color: "#c43e1c" } : undefined} />} label={tl("Diktieren")} pressed={p.dictating} onClick={() => p.onTool("dictate")} />
      </RibbonGroup>
    </>
  );

  const today = new Date().toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" });
  const insert = (
    <>
      <RibbonGroup label={tl("Seiten")}>
        <BigButton icon={<DocumentPageBreak24Regular />} label={tl("Seitenumbruch")} onClick={() => run().setPageBreak().run()} />
      </RibbonGroup>
      <RibbonGroup label={tl("Tabellen")}>
        <Popover positioning="below-start" onOpenChange={() => setHover([0, 0])}>
          <PopoverTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Table24Regular />} label={tl("Tabelle")} menu />
            </span>
          </PopoverTrigger>
          <PopoverSurface style={{ padding: 8 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>{hover[0] ? `Tabelle ${hover[1]}×${hover[0]}` : tl("Tabelle einfügen")}</div>
            <div className={s.grid} onMouseLeave={() => setHover([0, 0])}>
              {Array.from({ length: 80 }, (_, i) => {
                const r = Math.floor(i / 10) + 1;
                const c = (i % 10) + 1;
                return (
                  <button
                    key={i}
                    className={`${s.gridCell} ${r <= hover[0] && c <= hover[1] ? s.gridOn : ""}`}
                    onMouseEnter={() => setHover([r, c])}
                    onClick={() => run().insertTable({ rows: r, cols: c, withHeaderRow: false }).run()}
                  />
                );
              })}
            </div>
          </PopoverSurface>
        </Popover>
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
              {SHAPES.filter((x) => x.kind !== "textBox").map((x) => (
                <MenuItem key={x.kind} onClick={() => run().insertShape(shapeDefaults(x.kind)).run()}>
                  {x.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Links")}>
        <BigButton icon={<Link24Regular />} label={tl("Link")} onClick={p.onLink} />
      </RibbonGroup>
      <RibbonGroup label={tl("Kopf- und Fußzeile")}>
        <BigButton icon={<DocumentHeaderFooter24Regular />} label={tl("Kopf-/Fußzeile")} onClick={p.onHeaderFooter} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentPageNumber24Regular />} label={tl("Seitenzahl")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => run().insertField("page").run()}>{tl("Aktuelle Seitenzahl einfügen")}</MenuItem>
              <MenuItem onClick={() => run().insertField("pages").run()}>{tl("Seitenanzahl einfügen")}</MenuItem>
              <MenuItem onClick={p.onHeaderFooter}>{tl("In Fußzeile…")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Felder")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Braces24Regular />} label={tl("Feld")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onInsertField("date")}>{tl("Datum")}</MenuItem>
              <MenuItem onClick={() => p.onInsertField("author")}>{tl("Autor")}</MenuItem>
              <MenuItem onClick={() => p.onInsertField("title")}>{tl("Titel")}</MenuItem>
              <MenuItem onClick={() => p.onInsertField("filename")}>{tl("Dateiname")}</MenuItem>
              <MenuItem onClick={() => p.onInsertField("page")}>{tl("Seitenzahl")}</MenuItem>
              <MenuItem onClick={() => p.onInsertField("pages")}>{tl("Anzahl Seiten")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Text")}>
        <BigButton icon={<Textbox24Regular />} label={tl("Textfeld")} onClick={() => p.onTool("textBox")} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TextCaseUppercase24Regular />} label={tl("Initiale")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => run().setDropCap(null).run()}>{tl("Ohne")}</MenuItem>
              <MenuItem onClick={() => run().setDropCap(2).run()}>{tl("Im Text – 2 Zeilen")}</MenuItem>
              <MenuItem onClick={() => run().setDropCap(3).run()}>{tl("Im Text – 3 Zeilen")}</MenuItem>
              <MenuItem onClick={() => run().setDropCap(4).run()}>{tl("Im Text – 4 Zeilen")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<CalendarLtr24Regular />} label={tl("Datum")} onClick={() => run().insertContent(today).run()} />
        <Popover positioning="below-start">
          <PopoverTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<Symbols24Regular />} label={tl("Symbol")} menu />
            </span>
          </PopoverTrigger>
          <PopoverSurface style={{ padding: 6 }}>
            <div className={s.symbols}>
              {SYMBOLS.map((c) => (
                <button key={c} className={s.symbol} onClick={() => run().insertContent(c).run()}>
                  {c}
                </button>
              ))}
            </div>
          </PopoverSurface>
        </Popover>
        <BigButton icon={<MathFormula24Regular />} label={tl("Formel")} onClick={() => p.onTool("math")} />
      </RibbonGroup>
    </>
  );

  const landscape = p.page.widthMm > p.page.heightMm;
  const layout = (
    <>
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
                <MenuItem
                  key={m.id}
                  secondaryContent={`${m.t / 10} / ${m.b / 10} / ${m.l / 10} / ${m.r / 10} cm`.replace(/\./g, ",")}
                  onClick={() => p.onPageChange({ ...p.page, marginTopMm: m.t, marginBottomMm: m.b, marginLeftMm: m.l, marginRightMm: m.r })}
                >
                  {m.label}
                </MenuItem>
              ))}
              <MenuItem onClick={p.onPageSetup}>{tl("Benutzerdefinierte Seitenränder…")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentLandscape24Regular />} label={tl("Ausrichtung")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList checkedValues={{ o: [landscape ? "l" : "p"] }}>
              <MenuItemRadio name="o" value="p" onClick={() => landscape && p.onPageChange({ ...p.page, widthMm: p.page.heightMm, heightMm: p.page.widthMm })}>
                {tl("Hochformat")}
              </MenuItemRadio>
              <MenuItemRadio name="o" value="l" onClick={() => !landscape && p.onPageChange({ ...p.page, widthMm: p.page.heightMm, heightMm: p.page.widthMm })}>
                {tl("Querformat")}
              </MenuItemRadio>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<SlideSize24Regular />} label={tl("Format")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {PAPER_SIZES.map((z) => (
                <MenuItem key={z.id} onClick={() => p.onPageChange({ ...p.page, widthMm: landscape ? z.h : z.w, heightMm: landscape ? z.w : z.h })}>
                  {z.label}
                </MenuItem>
              ))}
              <MenuItem onClick={p.onPageSetup}>{tl("Seite einrichten…")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<TextColumnTwo24Regular />} label={tl("Spalten")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => run().setColumns(1).run()}>{tl("Eine")}</MenuItem>
              <MenuItem onClick={() => run().setColumns(2).run()}>{tl("Zwei")}</MenuItem>
              <MenuItem onClick={() => run().setColumns(3).run()}>{tl("Drei")}</MenuItem>
              <MenuItem onClick={() => run().setColumns(4).run()}>{tl("Vier")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <BigButton icon={<DocumentHeaderFooter24Regular />} label={tl("Kopf-/Fußzeile")} onClick={p.onHeaderFooter} />
      </RibbonGroup>
      <RibbonGroup label={tl("Seitenhintergrund")}>
        <BigButton icon={<DocumentText24Regular />} label={tl("Wasserzeichen")} onClick={() => p.onTool("watermark")} />
        <BigButton icon={<PaintBucket24Regular />} label={tl("Seitenfarbe")} onClick={() => p.onTool("pageColor")} />
        <BigButton icon={<DocumentBorder24Regular />} label={tl("Seitenrahmen")} onClick={() => p.onTool("pageBorder")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Absatz")}>
        <BigButton icon={<TextParagraph24Regular />} label="Einzug & Abstand" onClick={p.onParagraph} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentPageBreak24Regular />} label={tl("Umbrüche")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => run().setPageBreak().run()}>{tl("Seitenumbruch (Strg+Eingabe)")}</MenuItem>
              <MenuItem onClick={p.onSectionBreak}>{tl("Abschnittswechsel – nächste Seite")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
    </>
  );

  const view = (
    <>
      <RibbonGroup label={tl("Ansichten")}>
        <BigButton icon={<ImmersiveReader24Regular />} label={tl("Lesemodus")} pressed={p.readMode} onClick={() => p.onTool("reading")} />
        <BigButton icon={<TextBulletListTree24Regular />} label={tl("Gliederung")} pressed={p.outline} onClick={() => p.onTool("outline")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Zoom")}>
        <BigButton icon={<DocumentOnePage24Regular />} label="100 %" onClick={() => p.onZoom(1)} />
        <BigButton icon={<PageFit24Regular />} label={tl("Seitenbreite")} onClick={() => p.onZoom("width")} />
        <BigButton icon={<DocumentOnePage24Regular />} label={tl("Eine Seite")} onClick={() => p.onZoom("page")} />
        <Rows>
          <SmallButton icon={<ZoomIn20Regular />} label={tl("Vergrößern")} onClick={() => p.onZoom(Math.min(5, p.zoom + 0.1))} />
          <SmallButton icon={<ZoomOut20Regular />} label={tl("Verkleinern")} onClick={() => p.onZoom(Math.max(0.2, p.zoom - 0.1))} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Design")}>
        <Rows>
          <SmallButton icon={<DarkTheme20Regular />} label={mode === "dark" ? tl("Helles Design") : tl("Dunkles Design")} text={mode === "dark" ? tl("Helles Design") : tl("Dunkles Design")} onClick={toggle} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const table = (
    <>
      <RibbonGroup label={tl("Zeilen und Spalten")}>
        <Rows>
          <Row>
            <SmallButton icon={<TableInsertRow20Regular />} label={tl("Zeile oberhalb einfügen")} text={tl("Oberhalb")} onClick={() => run().addRowBefore().run()} />
            <SmallButton icon={<TableInsertRow20Regular />} label={tl("Zeile unterhalb einfügen")} text={tl("Unterhalb")} onClick={() => run().addRowAfter().run()} />
          </Row>
          <Row>
            <SmallButton icon={<TableInsertColumn20Regular />} label={tl("Spalte links einfügen")} text={tl("Links")} onClick={() => run().addColumnBefore().run()} />
            <SmallButton icon={<TableInsertColumn20Regular />} label={tl("Spalte rechts einfügen")} text={tl("Rechts")} onClick={() => run().addColumnAfter().run()} />
          </Row>
        </Rows>
        <Rows>
          <SmallButton icon={<TableDeleteRow20Regular />} label={tl("Zeile löschen")} text={tl("Zeile löschen")} onClick={() => run().deleteRow().run()} />
          <SmallButton icon={<TableDeleteColumn20Regular />} label={tl("Spalte löschen")} text={tl("Spalte löschen")} onClick={() => run().deleteColumn().run()} />
        </Rows>
        <BigButton icon={<TableDismiss20Regular style={{ fontSize: 26 }} />} label={tl("Tabelle löschen")} onClick={() => run().deleteTable().run()} />
      </RibbonGroup>
      <RibbonGroup label={tl("Zusammenführen")}>
        <Rows>
          <SmallButton icon={<TableCellsMerge20Regular />} label={tl("Zellen verbinden")} text={tl("Verbinden")} disabled={!st.canMerge} onClick={() => run().mergeCells().run()} />
          <SmallButton icon={<TableCellsSplit20Regular />} label={tl("Zellen teilen")} text={tl("Teilen")} disabled={!st.canSplit} onClick={() => run().splitCell().run()} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Formatierung")}>
        <Rows>
          <SmallButton icon={<TableFreezeRow20Regular />} label={tl("Kopfzeile ein/aus")} text={tl("Überschriftenzeile")} onClick={() => run().toggleHeaderRow().run()} />
          <Row>
            <ColorButton icon={<PaintBucket20Regular />} label={tl("Schattierung")} value="#d9e2f3" noneLabel={tl("Keine Farbe")} onPick={(c) => run().setCellBackground(c).run()} />
            <SmallButton icon={<Delete20Regular />} label={tl("Inhalt der Zellen löschen")} onClick={() => run().deleteSelection().run()} />
          </Row>
        </Rows>
      </RibbonGroup>
    </>
  );

  const references = (
    <>
      <RibbonGroup label={tl("Inhaltsverzeichnis")}>
        <BigButton icon={<DocumentBulletList24Regular />} label="Inhalts­verzeichnis" onClick={() => p.onToc("insert")} />
        <Rows>
          <SmallButton icon={<ArrowSync20Regular />} label={tl("Inhaltsverzeichnis aktualisieren")} text={tl("Aktualisieren")} onClick={() => p.onToc("update")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Fußnoten")}>
        <BigButton icon={<TextFootnote24Regular />} label={tl("Fußnote einfügen")} onClick={() => p.onFootnote(false)} />
        <BigButton icon={<TextFootnote24Regular />} label={tl("Endnote einfügen")} onClick={() => p.onFootnote(true)} />
      </RibbonGroup>
      <RibbonGroup label={tl("Zitate und Literaturverzeichnis")}>
        <BigButton icon={<TextQuote24Regular />} label={tl("Zitat einfügen")} onClick={() => p.onRefs("cite")} />
        <Rows>
          <SmallButton icon={<Library24Regular style={{ fontSize: 20 }} />} label={tl("Quellen verwalten")} text={tl("Quellen verwalten")} onClick={() => p.onRefs("sources")} />
          <SmallButton icon={<BookOpen24Regular style={{ fontSize: 20 }} />} label={tl("Literaturverzeichnis")} text={tl("Literaturverzeichnis")} onClick={() => p.onRefs("bibliography")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Beschriftungen")}>
        <BigButton icon={<ImageAltText24Regular />} label={tl("Beschriftung einfügen")} onClick={() => p.onRefs("caption")} />
        <Rows>
          <SmallButton icon={<DocumentBulletListMultiple24Regular style={{ fontSize: 20 }} />} label={tl("Abbildungsverzeichnis einfügen")} text={tl("Abbildungsverzeichnis")} onClick={() => p.onRefs("figures")} />
          <SmallButton icon={<LinkSquare24Regular style={{ fontSize: 20 }} />} label={tl("Querverweis")} text={tl("Querverweis")} onClick={() => p.onRefs("crossref")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Index")}>
        <BigButton icon={<TagAdd24Regular />} label={tl("Eintrag markieren")} onClick={() => p.onRefs("mark")} />
        <Rows>
          <SmallButton icon={<BookAdd24Regular style={{ fontSize: 20 }} />} label={tl("Index einfügen")} text={tl("Index einfügen")} onClick={() => p.onRefs("index")} />
          <SmallButton icon={<ArrowSync20Regular />} label={tl("Alle Verzeichnisse aktualisieren")} text={tl("Alles aktualisieren")} onClick={() => p.onRefs("update")} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const m = p.merge;
  const mailings = (
    <>
      <RibbonGroup label={tl("Erstellen")}>
        <BigButton icon={<Mail24Regular />} label={tl("Umschläge")} onClick={() => p.onTool("envelope")} />
        <BigButton icon={<TagMultiple24Regular />} label={tl("Etiketten")} onClick={() => p.onTool("labels")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Seriendruck starten")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<PeopleList24Regular />} label={tl("Empfänger auswählen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onMerge("new")}>{tl("Neue Liste eingeben …")}</MenuItem>
              <MenuItem onClick={() => p.onMerge("file")}>{tl("Vorhandene Liste verwenden …")}</MenuItem>
              <MenuItem onClick={() => p.onMerge("contacts")}>{tl("Aus Ondura-Kontakten auswählen")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Rows>
          <SmallButton icon={<PeopleEdit20Regular />} label={tl("Empfängerliste bearbeiten")} text={tl("Liste bearbeiten")} disabled={!m} onClick={() => p.onMerge("edit")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Felder schreiben und einfügen")}>
        <BigButton icon={<ContactCardGroup24Regular />} label={tl("Adressblock")} disabled={!m} onClick={() => p.onMerge("address")} />
        <Rows>
          <SmallButton icon={<HandWave20Regular />} label={tl("Grußzeile einfügen")} text={tl("Grußzeile")} disabled={!m} onClick={() => p.onMerge("greeting")} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <SmallButton icon={<Braces24Regular style={{ fontSize: 20 }} />} label={tl("Seriendruckfeld einfügen")} text={tl("Seriendruckfeld")} menu disabled={!m} />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {(m?.columns ?? []).map((c) => (
                  <MenuItem key={c} onClick={() => p.onInsertField(`merge ${c}`)}>
                    {c}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <SmallButton icon={<Highlight20Regular />} label={tl("Seriendruckfelder hervorheben")} text={tl("Felder hervorheben")} pressed={!!m?.highlight} onClick={() => p.onMerge("highlight")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Vorschau Ergebnisse")}>
        <BigButton icon={<Eye24Regular />} label={tl("Vorschau Ergebnisse")} pressed={!!m?.preview} disabled={!m?.count} onClick={() => p.onMerge("preview")} />
        <Rows>
          <Row>
            <SmallButton icon={<Previous20Regular />} label={tl("Erster Datensatz")} disabled={!m?.preview || m.index <= 0} onClick={() => p.onMerge("first")} />
            <SmallButton icon={<ChevronLeft20Regular />} label={tl("Vorheriger Datensatz")} disabled={!m?.preview || m.index <= 0} onClick={() => p.onMerge("prev")} />
            <SmallButton icon={<ChevronRight20Regular />} label={tl("Nächster Datensatz")} disabled={!m?.preview || m.index >= m.count - 1} onClick={() => p.onMerge("next")} />
            <SmallButton icon={<Next20Regular />} label={tl("Letzter Datensatz")} disabled={!m?.preview || m.index >= m.count - 1} onClick={() => p.onMerge("last")} />
          </Row>
          <span style={{ fontSize: 12, padding: "0 6px", color: tokens.colorNeutralForeground2 }}>{m?.count ? tl("Datensatz {0} von {1}", m.index + 1, m.count) : tl("Keine Empfänger")}</span>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Fertig stellen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DocumentArrowRight24Regular />} label={tl("Fertig stellen und zusammen­führen")} menu disabled={!m?.count} />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<DocumentEdit20Regular />} onClick={() => p.onMerge("finishEdit")}>
                {tl("Einzelne Dokumente bearbeiten …")}
              </MenuItem>
              <MenuItem icon={<Print20Regular />} onClick={() => p.onMerge("finishPrint")}>
                {tl("Dokumente drucken …")}
              </MenuItem>
              <MenuItem icon={<DocumentPdf20Regular />} onClick={() => p.onMerge("finishPdf")}>
                {tl("Als PDF exportieren …")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
    </>
  );

  const developer = (
    <>
      <RibbonGroup label={tl("Code")}>
        <BigButton icon={<Code24Regular />} label={tl("Makros")} onClick={p.onMacros} />
      </RibbonGroup>
      <RibbonGroup label={tl("Steuerelemente")}>
        <BigButton icon={<Form24Regular />} label={tl("Nur-Text")} onClick={() => p.onControl("text")} />
        <Rows three>
          <SmallButton icon={<CheckboxChecked20Regular />} label={tl("Kontrollkästchen einfügen")} text={tl("Kontrollkästchen")} onClick={() => p.onControl("checkbox")} />
          <SmallButton icon={<AppsListDetail20Regular />} label={tl("Dropdownliste einfügen")} text={tl("Dropdownliste")} onClick={() => p.onControl("dropdown")} />
          <SmallButton icon={<CalendarLtr20Regular />} label={tl("Datumsauswahl einfügen")} text={tl("Datumsauswahl")} onClick={() => p.onControl("date")} />
        </Rows>
        <Rows>
          <SmallButton icon={<TextboxSettings20Regular />} label={tl("Eigenschaften des Steuerelements")} text={tl("Eigenschaften")} disabled={!st.control} onClick={() => p.onControl("properties")} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const review = (
    <>
      <RibbonGroup label={tl("Dokumentprüfung")}>
        <BigButton icon={<TextProofingTools24Regular />} label={tl("Rechtschreibung")} onClick={p.onSpelling} />
        <Rows>
          <SmallButton icon={<TextGrammarCheckmark24Regular style={{ fontSize: 20 }} />} label={tl("Rechtschreibung während der Eingabe prüfen")} text={tl("Während Eingabe prüfen")} pressed={p.spellAuto} onClick={p.onSpellAuto} />
          <SmallButton icon={<TextWordCount24Regular style={{ fontSize: 20 }} />} label={tl("Wörter zählen")} text={tl("Wörter zählen")} onClick={p.onWordCount} />
        </Rows>
        <BigButton icon={<TextGrammarWand24Regular />} label={tl("Grammatik")} onClick={() => p.onTool("grammar")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Sprachausgabe")}>
        <BigButton icon={<ReadAloud24Regular />} label={tl("Laut vorlesen")} pressed={p.speaking} onClick={() => p.onTool("readAloud")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Barrierefreiheit")}>
        <BigButton icon={<AccessibilityCheckmark24Regular />} label={tl("Barrierefreiheit überprüfen")} pressed={p.a11yOpen} onClick={p.onA11y} />
      </RibbonGroup>
      <RibbonGroup label={tl("Sprache")}>
        <BigButton icon={<Translate24Regular />} label={tl("Übersetzen")} onClick={() => p.onTool("translate")} />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<LocalLanguage24Regular />} label={tl("Sprache")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onSpellLang("de")}>{tl("Deutsch (Deutschland)")}{p.spellLang === "de" ? " ✓" : ""}</MenuItem>
              <MenuItem onClick={() => p.onSpellLang("en")}>{tl("Englisch (USA)")}{p.spellLang === "en" ? " ✓" : ""}</MenuItem>
              <MenuItem onClick={() => p.onSpellLang("fr")}>{tl("Französisch (Frankreich)")}{p.spellLang === "fr" ? " ✓" : ""}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </RibbonGroup>
      <RibbonGroup label={tl("Kommentare")}>
        <BigButton icon={<CommentAdd24Regular />} label={tl("Neuer Kommentar")} onClick={() => p.onComment("new")} />
        <BigButton icon={<CommentDismiss24Regular />} label={tl("Löschen")} disabled={!st.inComment} onClick={() => p.onComment("delete")} />
        <Rows>
          <SmallButton icon={<ArrowPrevious20Regular />} label={tl("Vorheriger Kommentar")} text={tl("Vorheriger")} disabled={!p.hasComments} onClick={() => p.onComment("prev")} />
          <SmallButton icon={<ArrowNext20Regular />} label={tl("Nächster Kommentar")} text={tl("Nächster")} disabled={!p.hasComments} onClick={() => p.onComment("next")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Nachverfolgung")}>
        <BigButton icon={<DocumentEdit24Regular style={st.tracking ? { color: "#c43e1c" } : undefined} />} label={st.tracking ? tl("Nachverfolgung an") : tl("Änderungen nachverfolgen")} onClick={() => p.onTrack("toggle")} />
        <Rows>
          <SmallButton icon={<Person20Regular />} label={tl("Benutzername für Kommentare und Änderungen")} text={tl("Name")} onClick={p.onUserName} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Änderungen")}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<CheckmarkCircle24Regular />} label={tl("Annehmen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onTrack("accept")}>{tl("Diese Änderung annehmen")}</MenuItem>
              <MenuItem onClick={() => p.onTrack("acceptAll")}>{tl("Alle Änderungen annehmen")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <span>
              <BigButton icon={<DismissCircle24Regular />} label={tl("Ablehnen")} menu />
            </span>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => p.onTrack("reject")}>{tl("Diese Änderung ablehnen")}</MenuItem>
              <MenuItem onClick={() => p.onTrack("rejectAll")}>{tl("Alle Änderungen ablehnen")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Rows>
          <SmallButton icon={<ArrowPrevious20Regular />} label={tl("Vorherige Änderung")} text={tl("Vorherige")} onClick={() => p.onTrack("prev")} />
          <SmallButton icon={<ArrowNext20Regular />} label={tl("Nächste Änderung")} text={tl("Nächste")} onClick={() => p.onTrack("next")} />
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={tl("Vergleichen")}>
        <BigButton icon={<DocumentSplitHint24Regular />} label={tl("Vergleichen")} onClick={() => p.onTool("compare")} />
      </RibbonGroup>
      <RibbonGroup label={tl("Schützen")}>
        <BigButton icon={<ShieldLock24Regular style={p.restricted ? { color: "#c43e1c" } : undefined} />} label={tl("Bearbeitung einschränken")} pressed={p.restricted} onClick={() => p.onTool("protect")} />
      </RibbonGroup>
    </>
  );

  const tabs: RibbonTab[] = [
    { id: "home", label: tl("Start"), content: home },
    { id: "insert", label: tl("Einfügen"), content: insert },
    { id: "layout", label: tl("Layout"), content: layout },
    { id: "references", label: tl("Referenzen"), content: references },
    { id: "mailings", label: tl("Sendungen"), content: mailings },
    { id: "review", label: tl("Überprüfen"), content: review },
    { id: "view", label: tl("Ansicht"), content: view },
    { id: "developer", label: tl("Entwicklertools"), content: developer },
  ];
  if (st.inTable) tabs.push({ id: "table", label: tl("Tabelle"), contextual: true, content: table });
  return <OfficeRibbon tabs={tabs} active={tab === "table" && !st.inTable ? "home" : tab} onTab={setTab} onFile={p.onFile} color={p.color} />;
}

function shapeDefaults(kind: ShapeKind) {
  return kind === "line" ? { kind, widthMm: 50, heightMm: 2, fill: null, line: "#2f5597" } : { kind, widthMm: 40, heightMm: kind === "star5" || kind === "ellipse" ? 40 : 25 };
}

/** Paste from the clipboard (HTML if available) at the cursor. */
async function pasteInto(editor: Editor) {
  const html = await readClipboardHtml();
  editor.commands.focus();
  if (html) editor.view.pasteHTML(html);
  else {
    const text = await readClipboardText();
    if (text) editor.view.pasteText(text);
  }
}
