// Building blocks shared by the office apps (Text, Tabellen, Präsentation):
// the ribbon, the "Datei" backstage, colour pickers, the status
// bar and the unsaved-changes prompt.

import { PrintView, type PrintSupport } from "./printView";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  DocumentPdf24Regular,
  ArrowLeft24Regular,
  ChevronDown12Regular,
  Document24Regular,
  DocumentAdd24Regular,
  FolderOpen24Regular,
  Info24Regular,
  Print24Regular,
  Save24Regular,
  SaveEdit24Regular,
  Share24Regular,
  PersonCircle24Regular,
  Dismiss12Regular,
  Home24Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  ArrowRight16Regular,
} from "@fluentui/react-icons";
import { type OfficeApp, type RecentFile, recentFiles, removeRecent } from "../lib/office";
import { isCloudPath } from "../lib/cloud";
import { AccountPage, CloudPlaces, SharePage, VersionHistory } from "./cloud";
import { ProtectSection } from "./password";
import { CommandSearch, QuickAccessBar, commandOf, loadQuick, runRibbonCommand, saveQuick, type QuickCommand } from "./ribbonTools";
import { openContextMenu } from "./contextMenu";
import { tl, LOCALE } from "../lib/i18n";

const useStyles = makeStyles({
  ribbon: {
    flexShrink: 0,
    margin: "0 8px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  tabs: { display: "flex", alignItems: "stretch", gap: "2px", padding: "4px 6px 0", height: "34px", boxSizing: "border-box" },
  tab: {
    border: "none",
    background: "transparent",
    padding: "0 12px",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    position: "relative",
    borderRadius: tokens.borderRadiusMedium,
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover, color: tokens.colorNeutralForeground1 },
  },
  tabActive: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
    "::after": { content: '""', position: "absolute", left: "12px", right: "12px", bottom: "0", height: "3px", borderRadius: "2px", backgroundColor: tokens.colorBrandStroke1 },
  },
  fileTab: { color: "#fff", fontWeight: tokens.fontWeightSemibold, ":hover": { color: "#fff", filter: "brightness(1.08)" } },
  contextTab: { color: tokens.colorPaletteBerryForeground1 },
  bodyWrap: { position: "relative" },
  body: {
    display: "flex",
    alignItems: "stretch",
    padding: "6px 6px 4px",
    minHeight: "86px",
    boxSizing: "border-box",
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
    scrollBehavior: "smooth",
    "::-webkit-scrollbar": { display: "none" },
  },
  // When a tab does not fit the window, Office shows scroll arrows at the
  // ribbon edges; the content fades out underneath them.
  scrollBtn: {
    position: "absolute",
    top: "10px",
    bottom: "22px",
    width: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1Pressed,
    boxShadow: tokens.shadow4,
    backdropFilter: "blur(12px)",
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    zIndex: 1,
    ":hover": { color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  scrollLeft: { left: "4px" },
  scrollRight: { right: "4px" },
  group: {
    display: "flex",
    flexDirection: "column",
    padding: "0 6px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    ":last-child": { borderRight: "none" },
  },
  groupBody: { flex: 1, display: "flex", alignItems: "flex-start", gap: "2px" },
  groupLabel: { textAlign: "center", fontSize: "11px", color: tokens.colorNeutralForeground3, paddingTop: "2px", whiteSpace: "nowrap" },
  rows: { display: "flex", flexDirection: "column", gap: "2px" },
  rows3: { gap: "1px", "& button": { height: "20px" }, "& > span": { display: "flex" } },
  row: { display: "flex", alignItems: "center", gap: "2px" },
  big: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: "2px",
    minWidth: "52px",
    // Long labels wrap onto a second line instead of
    // stretching the button and pushing the ribbon out of the window.
    maxWidth: "92px",
    height: "66px",
    padding: "4px 6px 2px",
    fontSize: "12px",
    lineHeight: "14px",
    border: "1px solid transparent",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    cursor: "pointer",
    textAlign: "center",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":disabled": { color: tokens.colorNeutralForegroundDisabled, cursor: "default", backgroundColor: "transparent" },
  },
  bigIcon: { fontSize: "26px", height: "28px", display: "flex", alignItems: "center", color: tokens.colorBrandForeground1 },
  small: {
    minWidth: "28px",
    height: "28px",
    padding: "0 4px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    border: "1px solid transparent",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: "12px",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":disabled": { color: tokens.colorNeutralForegroundDisabled, cursor: "default", backgroundColor: "transparent" },
  },
  pressed: { backgroundColor: tokens.colorBrandBackground2, border: `1px solid ${tokens.colorBrandStroke2}`, ":hover": { backgroundColor: tokens.colorBrandBackground2Hover } },
  swatchBar: { position: "absolute", left: "5px", right: "5px", bottom: "3px", height: "4px", borderRadius: "1px" },
  colorBtn: { position: "relative", paddingBottom: "4px" },
  palette: { display: "grid", gridTemplateColumns: "repeat(10, 18px)", gap: "3px", padding: "4px" },
  swatch: { width: "18px", height: "18px", borderRadius: "3px", border: `1px solid ${tokens.colorNeutralStroke2}`, cursor: "pointer", padding: 0, ":hover": { outline: `2px solid ${tokens.colorBrandStroke1}` } },

  backstage: { position: "fixed", inset: "48px 0 0 0", zIndex: 100, display: "flex", backgroundColor: "var(--nx-solid-bg, #f6f6fa)", boxShadow: tokens.shadow16 },
  bsNav: { width: "220px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "2px", padding: "12px 8px", color: "#fff" },
  bsItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 14px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
    cursor: "pointer",
    ":hover": { backgroundColor: "rgba(255,255,255,0.14)" },
    ":disabled": { opacity: 0.5, cursor: "default" },
  },
  bsItemActive: { backgroundColor: "rgba(255,255,255,0.22)" },
  bsMain: { flex: 1, overflow: "auto", padding: "32px 48px", display: "flex", flexDirection: "column", minHeight: 0 },
  bsTitle: { fontSize: "28px", fontWeight: tokens.fontWeightSemibold, marginBottom: "20px", display: "block" },
  recent: { display: "flex", flexDirection: "column", gap: "2px", maxWidth: "760px" },
  recentItem: {
    display: "grid",
    gridTemplateColumns: "32px 1fr auto 28px",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  muted: { color: tokens.colorNeutralForeground3 },
  bsSection: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, display: "block", margin: "28px 0 10px" },
  tplRow: { display: "flex", flexWrap: "wrap", gap: "16px" },
  tpl: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "152px",
    padding: 0,
    border: "none",
    background: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
    cursor: "pointer",
    ":hover > div:first-child": { boxShadow: `0 0 0 2px ${tokens.colorBrandStroke1}, ${tokens.shadow8}` },
    ":focus-visible": { outline: "none" },
    ":focus-visible > div:first-child": { boxShadow: `0 0 0 2px ${tokens.colorStrokeFocus2}` },
  },
  tplThumb: {
    position: "relative",
    width: "152px",
    height: "196px",
    borderRadius: tokens.borderRadiusMedium,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    boxShadow: tokens.shadow4,
    transitionProperty: "box-shadow",
    transitionDuration: tokens.durationFaster,
  },
  tplWide: { width: "208px", height: "117px" },
  tplWideBtn: { width: "208px" },
  more: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    marginTop: "14px",
    padding: 0,
    border: "none",
    background: "transparent",
    color: tokens.colorBrandForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    cursor: "pointer",
    alignSelf: "flex-start",
    ":hover": { textDecoration: "underline" },
  },
  status: {
    height: "26px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "18px",
    padding: "0 14px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    userSelect: "none",
  },
});

// ------------------------------------------------------------- ribbon --

export interface RibbonTab {
  id: string;
  label: string;
  /** Contextual tabs (e.g. "Tabelle") are highlighted. */
  contextual?: boolean;
  content: ReactNode;
}

export function OfficeRibbon({ tabs, active, onTab, onFile, color }: { tabs: RibbonTab[]; active: string; onTab: (id: string) => void; onFile: () => void; color: string }) {
  const s = useStyles();
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const ref = useRef<HTMLDivElement>(null);
  const app = (window.location.hash.replace(/^#\/?/, "").split("/")[0] || "office") as string;
  const [quick, setQuick] = useState<QuickCommand[]>(() => loadQuick(app));
  const run = (cmd: QuickCommand) => runRibbonCommand(ref.current, cmd, onTab);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const b = bodyRef.current;
    if (!b) return;
    const left = b.scrollLeft > 1;
    const right = b.scrollLeft + b.clientWidth < b.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const b = bodyRef.current;
    if (!b) return;
    b.style.scrollBehavior = "auto";
    b.scrollLeft = 0;
    b.style.scrollBehavior = "";
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    return () => ro.disconnect();
  }, [measure, current.id]);
  const scrollBy = (dir: number) => {
    const b = bodyRef.current;
    if (b) b.scrollLeft += dir * b.clientWidth * 0.6;
  };
  const onMenu = (e: ReactMouseEvent) => {
    const cmd = commandOf(e.target as HTMLElement);
    if (!cmd) return;
    const has = quick.some((q) => q.tab === cmd.tab && q.label === cmd.label);
    openContextMenu(e, [
      has
        ? { label: tl("Aus der Symbolleiste für den Schnellzugriff entfernen"), onClick: () => setQuick(saveQuick(app, quick.filter((q) => !(q.tab === cmd.tab && q.label === cmd.label)))) }
        : { label: tl("Zur Symbolleiste für den Schnellzugriff hinzufügen"), onClick: () => setQuick(saveQuick(app, [...quick, cmd])) },
    ]);
  };
  return (
    <div className={s.ribbon} ref={ref}>
      <div className={s.tabs} role="tablist" onContextMenu={onMenu}>
        <button className={mergeClasses(s.tab, s.fileTab)} style={{ backgroundColor: color }} onClick={onFile}>
          {tl("Datei")}
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current.id}
            className={mergeClasses(s.tab, t.contextual && s.contextTab, t.id === current.id && s.tabActive)}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <QuickAccessBar items={quick} onRun={run} onRemove={(q) => setQuick(saveQuick(app, quick.filter((x) => x !== q)))} />
        <CommandSearch root={ref} onRun={run} />
      </div>
      <div className={s.bodyWrap}>
      {edges.left && (
        <button className={mergeClasses(s.scrollBtn, s.scrollLeft)} aria-label={tl("Nach links blättern")} onClick={() => scrollBy(-1)}>
          <ChevronLeft16Regular />
        </button>
      )}
      {edges.right && (
        <button className={mergeClasses(s.scrollBtn, s.scrollRight)} aria-label={tl("Nach rechts blättern")} onClick={() => scrollBy(1)}>
          <ChevronRight16Regular />
        </button>
      )}
      <div
        className={s.body}
        ref={bodyRef}
        onContextMenu={onMenu}
        onScroll={measure}
        onWheel={(e) => {
          // A plain mouse wheel scrolls the ribbon sideways.
          if (bodyRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) bodyRef.current.scrollLeft += e.deltaY;
        }}
      >
        {/* All tabs stay mounted (inactive ones hidden), so command search and
            the quick access toolbar can find every command. */}
        {tabs.map((t) => (
          <div key={t.id} data-ribbon-tab={t.id} data-ribbon-label={t.label} style={{ display: t.id === current.id ? "contents" : "none" }}>
            {t.content}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.group} role="group" aria-label={label}>
      <div className={s.groupBody}>{children}</div>
      <div className={s.groupLabel}>{label}</div>
    </div>
  );
}

/** Stacked small buttons; `three` fits three compact rows into the ribbon height. */
export function Rows({ children, three }: { children: ReactNode; three?: boolean }) {
  const s = useStyles();
  return <div className={mergeClasses(s.rows, three && s.rows3)}>{children}</div>;
}

export function Row({ children }: { children: ReactNode }) {
  return <div className={useStyles().row}>{children}</div>;
}

/** Label whose chevron stays with the last word when the label wraps. */
function MenuLabel({ label }: { label: string }) {
  const cut = label.lastIndexOf(" ");
  return (
    <>
      {cut > 0 ? `${label.slice(0, cut)} ` : ""}
      <span style={{ whiteSpace: "nowrap" }}>
        {label.slice(cut + 1)}
        <ChevronDown12Regular style={{ verticalAlign: "middle", marginLeft: 2 }} />
      </span>
    </>
  );
}

/**
 * Ribbon buttons don't take the focus: the editor keeps its
 * cursor and selection, and typing goes on where it was.
 */
function keepFocus(e: ReactMouseEvent) {
  e.preventDefault();
}

export function BigButton({ icon, label, onClick, disabled, menu, pressed }: { icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; menu?: boolean; pressed?: boolean }) {
  const s = useStyles();
  return (
    <button className={mergeClasses(s.big, pressed && s.pressed)} aria-pressed={pressed} onClick={onClick} disabled={disabled} onMouseDown={keepFocus}>
      <span className={s.bigIcon}>{icon}</span>
      <span>{menu ? <MenuLabel label={label} /> : label}</span>
    </button>
  );
}

export interface SmallButtonProps {
  icon?: ReactNode;
  label: string;
  /** Shown next to the icon. */
  text?: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  shortcut?: string;
  menu?: boolean;
}

export const SmallButton = ({ icon, label, text, onClick, pressed, disabled, shortcut, menu, ...rest }: SmallButtonProps & Record<string, unknown>) => {
  const s = useStyles();
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label} relationship="label" showDelay={500}>
      <button
        {...rest}
        className={mergeClasses(s.small, pressed && s.pressed)}
        aria-pressed={pressed}
        onClick={onClick}
        disabled={disabled}
        onMouseDown={(e) => {
          (rest.onMouseDown as ((e: ReactMouseEvent) => void) | undefined)?.(e);
          keepFocus(e);
        }}
      >
        {icon}
        {text && <span>{text}</span>}
        {menu && <ChevronDown12Regular />}
      </button>
    </Tooltip>
  );
};

// ------------------------------------------------------- colour picker --

export const THEME_COLORS = [
  "#000000", "#ffffff", "#44546a", "#e7e6e6", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47",
  "#7f7f7f", "#f2f2f2", "#d6dce4", "#d0cece", "#d9e2f3", "#fbe5d5", "#ededed", "#fff2cc", "#deebf6", "#e2efd9",
  "#595959", "#d8d8d8", "#adb9ca", "#aeaaaa", "#b4c6e7", "#f7cbac", "#dbdbdb", "#fee599", "#bdd7ee", "#c5e0b3",
  "#3f3f3f", "#bfbfbf", "#8496b0", "#757070", "#8eaadb", "#f4b183", "#c9c9c9", "#ffd965", "#9cc3e5", "#a8d08d",
  "#262626", "#a5a5a5", "#323f4f", "#3a3838", "#2f5496", "#c55a11", "#7b7b7b", "#bf9000", "#2e75b5", "#538135",
  "#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0",
];

export const HIGHLIGHT_COLORS = ["#ffff00", "#00ff00", "#00ffff", "#ff00ff", "#0000ff", "#ff0000", "#000080", "#008080", "#008000", "#800080", "#800000", "#808000", "#808080", "#c0c0c0", "#000000"];

export function ColorButton({
  icon,
  label,
  value,
  onPick,
  colors = THEME_COLORS,
  noneLabel = tl("Automatisch"),
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  onPick: (c: string | null) => void;
  colors?: string[];
  noneLabel?: string;
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(value ?? colors[colors.length > 20 ? 50 : 0]);
  const custom = useRef<HTMLInputElement>(null);
  const pick = (c: string | null) => {
    if (c) setLast(c);
    onPick(c);
    setOpen(false);
  };
  return (
    <span style={{ display: "inline-flex" }}>
      <Tooltip content={label} relationship="label" showDelay={500}>
        <button className={mergeClasses(s.small, s.colorBtn)} onClick={() => onPick(last)}>
          {icon}
          <span className={s.swatchBar} style={{ backgroundColor: last }} />
        </button>
      </Tooltip>
      <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-start">
        <PopoverTrigger disableButtonEnhancement>
          <button className={s.small} style={{ minWidth: 14, padding: 0 }} aria-label={tl("{0}: Farbe wählen", label)}>
            <ChevronDown12Regular />
          </button>
        </PopoverTrigger>
        <PopoverSurface style={{ padding: 8 }}>
          <Button size="small" appearance="subtle" onClick={() => pick(null)} style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}>
            {noneLabel}
          </Button>
          <div className={s.palette} style={{ gridTemplateColumns: `repeat(${Math.min(10, colors.length)}, 18px)` }}>
            {colors.map((c) => (
              <button key={c} className={s.swatch} style={{ backgroundColor: c }} title={c} onClick={() => pick(c)} />
            ))}
          </div>
          <Button size="small" appearance="subtle" onClick={() => custom.current?.click()} style={{ width: "100%", justifyContent: "flex-start", marginTop: 4 }}>
            {tl("Weitere Farben…")}
          </Button>
          <input ref={custom} type="color" style={{ display: "none" }} onChange={(e) => pick(e.target.value)} />
        </PopoverSurface>
      </Popover>
    </span>
  );
}

// ---------------------------------------------------------- backstage --

export interface BackstageProps {
  app: OfficeApp;
  color: string;
  onClose: () => void;
  onNew: () => void;
  onOpen: (path?: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onPrint: () => void;
  /** The print view ("Drucken" page with preview); without it "Drucken" calls `onPrint`. */
  printSupport?: PrintSupport;
  /** Direct PDF export (desktop app). */
  onExportPdf?: () => void;
  printLabel?: string;
  info: ReactNode;
  initialPage?: BackstageStart;
  /** Templates for the start page and "Neu" (the first one is the empty document). */
  templates?: OfficeTemplate[];
  /** Start a document from a template. */
  onTemplate?: (id: string) => void;
  /** Open a template file of one's own (e.g. .dotx). */
  onOpenTemplateFile?: () => void;
  /** Landscape thumbnails (presentations). */
  wideThumbs?: boolean;
  /** Path of the open document (for "Speichern unter" and "Freigeben"). */
  path?: string | null;
  /** Name without extension, suggested by "Speichern unter". */
  suggestedName?: string;
  /** Save to a cloud path chosen in "Speichern unter". */
  onSaveToPath?: (path: string) => Promise<void>;
  /** Password protection of the document (Datei › Informationen). */
  protection?: { password: string | null; onChange: (password: string | null) => void };
}

export interface OfficeTemplate {
  id: string;
  label: string;
  /** Miniature of the template, drawn at thumbnail size. */
  preview: ReactNode;
}

export type BackstageStart = "home" | "new" | "open" | "info" | "print";

type BackstagePage = BackstageStart | "saveas" | "share" | "account";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? tl("Guten Abend") : h < 11 ? tl("Guten Morgen") : h < 18 ? tl("Guten Tag") : tl("Guten Abend");
}

export function Backstage(p: BackstageProps) {
  const s = useStyles();
  const [page, setPage] = useState<BackstagePage>(p.initialPage ?? "open");
  // Strg+P while the backstage is open switches to the print view.
  useEffect(() => {
    if (p.initialPage) setPage(p.initialPage);
  }, [p.initialPage]);
  const [recent, setRecent] = useState<RecentFile[]>(() => recentFiles(p.app));
  const item = (icon: ReactNode, label: string, onClick: () => void, active = false) => (
    <button className={mergeClasses(s.bsItem, active && s.bsItemActive)} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
  const now = Date.now();
  const when = (t: number) => {
    const d = new Date(t);
    if (now - t < 86400000 && new Date(now).getDate() === d.getDate()) return tl("Heute, {0}", d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }));
    return d.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  const templateGrid = (list: OfficeTemplate[]) => (
    <div className={s.tplRow}>
      {list.map((t) => (
        <button key={t.id} className={mergeClasses(s.tpl, p.wideThumbs && s.tplWideBtn)} onClick={() => p.onTemplate?.(t.id)}>
          <div className={mergeClasses(s.tplThumb, p.wideThumbs && s.tplWide)} aria-hidden>
            {t.preview}
          </div>
          <Text truncate wrap={false} block>
            {t.label}
          </Text>
        </button>
      ))}
    </div>
  );
  const recentList = (limit?: number) =>
    recent.length === 0 ? (
      <Text className={s.muted}>{p.app === "text" ? tl("Noch keine Dokumente geöffnet.") : p.app === "sheets" ? tl("Noch keine Arbeitsmappen geöffnet.") : p.app === "pdf" ? tl("Noch keine PDF-Dokumente geöffnet.") : tl("Noch keine Präsentationen geöffnet.")}</Text>
    ) : (
      <div className={s.recent}>
        {(limit ? recent.slice(0, limit) : recent).map((r) => (
          <div key={r.path} className={s.recentItem} onClick={() => p.onOpen(r.path)} role="button" tabIndex={0}>
            <Document24Regular style={{ color: p.color }} />
            <div style={{ minWidth: 0 }}>
              <Text block truncate wrap={false} weight="semibold">
                {r.name}
              </Text>
              <Text block truncate wrap={false} size={200} className={s.muted}>
                {isCloudPath(r.path) ? tl("OneDrive") : r.path}
              </Text>
            </div>
            <Text size={200} className={s.muted}>
              {when(r.opened)}
            </Text>
            <Button
              size="small"
              appearance="subtle"
              icon={<Dismiss12Regular />}
              aria-label={tl("Aus der Liste entfernen")}
              onClick={(e) => {
                e.stopPropagation();
                removeRecent(p.app, r.path);
                setRecent(recentFiles(p.app));
              }}
            />
          </div>
        ))}
      </div>
    );
  const templates = p.templates ?? [];
  return (
    <div className={s.backstage}>
      <nav className={s.bsNav} style={{ backgroundColor: p.color }}>
        {item(<ArrowLeft24Regular />, tl("Zurück"), p.onClose)}
        <div style={{ height: 12 }} />
        {templates.length > 0 && item(<Home24Regular />, tl("Start"), () => setPage("home"), page === "home")}
        {item(<DocumentAdd24Regular />, tl("Neu"), templates.length > 0 ? () => setPage("new") : p.onNew, page === "new")}
        {item(<FolderOpen24Regular />, tl("Öffnen"), () => setPage("open"), page === "open")}
        {item(<Info24Regular />, tl("Informationen"), () => setPage("info"), page === "info")}
        {item(<Save24Regular />, tl("Speichern"), p.onSave)}
        {item(<SaveEdit24Regular />, tl("Speichern unter"), p.onSaveToPath ? () => setPage("saveas") : p.onSaveAs, page === "saveas")}
        {item(<Print24Regular />, p.printLabel ?? tl("Drucken"), p.printSupport ? () => setPage("print") : p.onPrint, page === "print")}
        {p.onExportPdf && item(<DocumentPdf24Regular />, tl("Als PDF exportieren"), p.onExportPdf)}
        {p.onSaveToPath && item(<Share24Regular />, tl("Freigeben"), () => setPage("share"), page === "share")}
        <div style={{ flex: 1 }} />
        {item(<PersonCircle24Regular />, tl("Konto"), () => setPage("account"), page === "account")}
      </nav>
      <main className={s.bsMain}>
        {page === "home" && templates.length > 0 ? (
          <>
            <Text className={s.bsTitle}>{greeting()}</Text>
            {templateGrid(templates.slice(0, p.wideThumbs ? 4 : 5))}
            <button className={s.more} onClick={() => setPage("new")}>
              {tl("Weitere Vorlagen")}
              <ArrowRight16Regular />
            </button>
            <Text className={s.bsSection}>{tl("Zuletzt verwendet")}</Text>
            {recentList(8)}
            {recent.length > 8 && (
              <button className={s.more} onClick={() => setPage("open")}>
                {tl("Weitere Dateien öffnen")}
                <ArrowRight16Regular />
              </button>
            )}
          </>
        ) : page === "new" && templates.length > 0 ? (
          <>
            <Text className={s.bsTitle}>{tl("Neu")}</Text>
            {templateGrid(templates)}
            {p.onOpenTemplateFile && (
              <button className={s.more} onClick={p.onOpenTemplateFile}>
                {tl("Eigene Vorlage öffnen …")}
                <ArrowRight16Regular />
              </button>
            )}
          </>
        ) : page === "open" ? (
          <>
            <Text className={s.bsTitle}>{tl("Öffnen")}</Text>
            <CloudPlaces
              key="open"
              app={p.app}
              color={p.color}
              mode="open"
              onBrowseLocal={() => p.onOpen()}
              onOpen={(path) => p.onOpen(path)}
              recent={recentList()}
            />
          </>
        ) : page === "saveas" && p.onSaveToPath ? (
          <>
            <Text className={s.bsTitle}>{tl("Speichern unter")}</Text>
            <CloudPlaces
              key="save"
              app={p.app}
              color={p.color}
              mode="save"
              onBrowseLocal={p.onSaveAs}
              onSave={p.onSaveToPath}
              suggestedName={p.suggestedName}
              currentExt={p.path ? p.path.split(".").pop()?.toLowerCase() : undefined}
            />
          </>
        ) : page === "share" ? (
          <>
            <Text className={s.bsTitle}>{tl("Freigeben")}</Text>
            <SharePage path={p.path ?? null} onSaveToCloud={() => setPage("saveas")} />
          </>
        ) : page === "print" && p.printSupport ? (
          <>
            <Text className={s.bsTitle}>{tl("Drucken")}</Text>
            <PrintView support={p.printSupport} documentName={p.suggestedName ?? ""} />
          </>
        ) : page === "account" ? (
          <>
            <Text className={s.bsTitle}>{tl("Konto")}</Text>
            <AccountPage />
          </>
        ) : (
          <>
            <Text className={s.bsTitle}>{tl("Informationen")}</Text>
            {p.protection && (
              <div style={{ marginBottom: 16 }}>
                <ProtectSection password={p.protection.password} onChange={p.protection.onChange} />
              </div>
            )}
            {p.info}
          </>
        )}
      </main>
    </div>
  );
}

/** Title/author fields and import warnings for the "Informationen" page. */
export function DocumentInfo({
  path,
  title,
  author,
  onChange,
  warnings,
  stats,
  app,
  dirty,
}: {
  path: string | null;
  title: string;
  author: string;
  onChange: (title: string, author: string) => void;
  warnings: string[];
  stats?: ReactNode;
  /** For the version history of cloud documents. */
  app?: OfficeApp;
  dirty?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
      <Text>{path ?? tl("Noch nicht gespeichert")}</Text>
      <Field label={tl("Titel")}>
        <Input value={title} onChange={(_, d) => onChange(d.value, author)} />
      </Field>
      <Field label={tl("Autor")}>
        <Input value={author} onChange={(_, d) => onChange(title, d.value)} />
      </Field>
      {stats}
      {app && path && isCloudPath(path) && <VersionHistory path={path} app={app} dirty={!!dirty} />}
      {warnings.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <b>{tl("Kompatibilität:")}</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}

// --------------------------------------------------------- status bar --

export function StatusBar({ children }: { children: ReactNode }) {
  return <footer className={useStyles().status}>{children}</footer>;
}

// --------------------------------------------------- unsaved changes --

export type UnsavedChoice = "save" | "discard" | "cancel";

/** A three-way "save changes?" dialog driven by a promise. */
export function useUnsavedPrompt() {
  const [state, setState] = useState<{ name: string; resolve: (c: UnsavedChoice) => void } | null>(null);
  const ask = useCallback((name: string) => new Promise<UnsavedChoice>((resolve) => setState({ name, resolve })), []);
  const done = (c: UnsavedChoice) => {
    state?.resolve(c);
    setState(null);
  };
  const dialog = (
    <Dialog open={!!state} onOpenChange={(_, d) => !d.open && done("cancel")}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Änderungen speichern?")}</DialogTitle>
          <DialogContent>{tl("Möchtest du die Änderungen an „")}{state?.name}{tl("“ speichern?")}</DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => done("save")}>
              {tl("Speichern")}
            </Button>
            <Button onClick={() => done("discard")}>{tl("Nicht speichern")}</Button>
            <Button appearance="subtle" onClick={() => done("cancel")}>
              {tl("Abbrechen")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
  return { dialog, ask };
}
