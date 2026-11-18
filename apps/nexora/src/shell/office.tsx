// Building blocks shared by the office apps (Text, Tabellen, Präsentation):
// the Office-style ribbon, the "Datei" backstage, colour pickers, the status
// bar and the unsaved-changes prompt.

import { useCallback, useRef, useState, type ReactNode } from "react";
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
  Dismiss12Regular,
} from "@fluentui/react-icons";
import { FORMATS, type OfficeApp, type RecentFile, recentFiles, removeRecent } from "../lib/office";

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
  body: { display: "flex", alignItems: "stretch", padding: "6px 6px 4px", minHeight: "86px", boxSizing: "border-box", overflowX: "auto", overflowY: "hidden" },
  group: {
    display: "flex",
    flexDirection: "column",
    padding: "0 8px",
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
    height: "62px",
    padding: "4px 4px 2px",
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
  bsMain: { flex: 1, overflow: "auto", padding: "32px 48px" },
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
  return (
    <div className={s.ribbon}>
      <div className={s.tabs} role="tablist">
        <button className={mergeClasses(s.tab, s.fileTab)} style={{ backgroundColor: color }} onClick={onFile}>
          Datei
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
      </div>
      <div className={s.body}>{current.content}</div>
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

export function BigButton({ icon, label, onClick, disabled, menu, pressed }: { icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; menu?: boolean; pressed?: boolean }) {
  const s = useStyles();
  return (
    <button className={mergeClasses(s.big, pressed && s.pressed)} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      <span className={s.bigIcon}>{icon}</span>
      <span>
        {label}
        {menu && <ChevronDown12Regular style={{ verticalAlign: "middle", marginLeft: 2 }} />}
      </span>
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
      <button {...rest} className={mergeClasses(s.small, pressed && s.pressed)} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
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
  noneLabel = "Automatisch",
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
          <button className={s.small} style={{ minWidth: 14, padding: 0 }} aria-label={`${label}: Farbe wählen`}>
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
            Weitere Farben…
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
  /** Direct PDF export (desktop app). */
  onExportPdf?: () => void;
  printLabel?: string;
  info: ReactNode;
  initialPage?: "open" | "info";
}

export function Backstage(p: BackstageProps) {
  const s = useStyles();
  const [page, setPage] = useState<"open" | "info">(p.initialPage ?? "open");
  const [recent, setRecent] = useState<RecentFile[]>(() => recentFiles(p.app));
  const fmt = FORMATS[p.app];
  const item = (icon: ReactNode, label: string, onClick: () => void, active = false) => (
    <button className={mergeClasses(s.bsItem, active && s.bsItemActive)} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
  const now = Date.now();
  const when = (t: number) => {
    const d = new Date(t);
    if (now - t < 86400000 && new Date(now).getDate() === d.getDate()) return `Heute, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  return (
    <div className={s.backstage}>
      <nav className={s.bsNav} style={{ background: `linear-gradient(180deg, ${p.color}, color-mix(in srgb, ${p.color} 70%, #000))` }}>
        {item(<ArrowLeft24Regular />, "Zurück", p.onClose)}
        <div style={{ height: 12 }} />
        {item(<DocumentAdd24Regular />, "Neu", p.onNew)}
        {item(<FolderOpen24Regular />, "Öffnen", () => setPage("open"), page === "open")}
        {item(<Info24Regular />, "Informationen", () => setPage("info"), page === "info")}
        {item(<Save24Regular />, "Speichern", p.onSave)}
        {item(<SaveEdit24Regular />, "Speichern unter", p.onSaveAs)}
        {item(<Print24Regular />, p.printLabel ?? "Drucken", p.onPrint)}
        {p.onExportPdf && item(<DocumentPdf24Regular />, "Als PDF exportieren", p.onExportPdf)}
      </nav>
      <main className={s.bsMain}>
        {page === "open" ? (
          <>
            <Text className={s.bsTitle}>Öffnen</Text>
            <Button appearance="primary" icon={<FolderOpen24Regular />} onClick={() => p.onOpen()} style={{ marginBottom: 24 }}>
              Durchsuchen…
            </Button>
            <Text weight="semibold" block style={{ marginBottom: 8 }}>
              Zuletzt verwendet
            </Text>
            {recent.length === 0 ? (
              <Text className={s.muted}>Noch keine {fmt.label === "Dokument" ? "Dokumente" : fmt.label === "Arbeitsmappe" ? "Arbeitsmappen" : "Präsentationen"} geöffnet.</Text>
            ) : (
              <div className={s.recent}>
                {recent.map((r) => (
                  <div key={r.path} className={s.recentItem} onClick={() => p.onOpen(r.path)} role="button" tabIndex={0}>
                    <Document24Regular style={{ color: p.color }} />
                    <div style={{ minWidth: 0 }}>
                      <Text block truncate wrap={false} weight="semibold">
                        {r.name}
                      </Text>
                      <Text block truncate wrap={false} size={200} className={s.muted}>
                        {r.path}
                      </Text>
                    </div>
                    <Text size={200} className={s.muted}>
                      {when(r.opened)}
                    </Text>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<Dismiss12Regular />}
                      aria-label="Aus der Liste entfernen"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(p.app, r.path);
                        setRecent(recentFiles(p.app));
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <Text className={s.bsTitle}>Informationen</Text>
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
}: {
  path: string | null;
  title: string;
  author: string;
  onChange: (title: string, author: string) => void;
  warnings: string[];
  stats?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
      <Text>{path ?? "Noch nicht gespeichert"}</Text>
      <Field label="Titel">
        <Input value={title} onChange={(_, d) => onChange(d.value, author)} />
      </Field>
      <Field label="Autor">
        <Input value={author} onChange={(_, d) => onChange(title, d.value)} />
      </Field>
      {stats}
      {warnings.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <b>Kompatibilität:</b>
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
          <DialogTitle>Änderungen speichern?</DialogTitle>
          <DialogContent>Möchtest du die Änderungen an „{state?.name}“ speichern?</DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => done("save")}>
              Speichern
            </Button>
            <Button onClick={() => done("discard")}>Nicht speichern</Button>
            <Button appearance="subtle" onClick={() => done("cancel")}>
              Abbrechen
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
  return { dialog, ask };
}
