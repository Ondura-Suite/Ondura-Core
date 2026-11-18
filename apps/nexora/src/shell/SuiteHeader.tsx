import { useEffect, useState, type ReactNode } from "react";
import { Avatar, Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, SearchBox, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowDownload20Regular, DarkTheme20Regular, QuestionCircle20Regular, Settings20Regular } from "@fluentui/react-icons";
import { api, isTauri } from "../lib/api";
import { UpdateDialog, checkForUpdates, openUpdateDialog, useAutoUpdateCheck, useUpdates } from "./updates";
import { useThemeMode } from "./theme";

// The window has no native decorations (see src-tauri/src/windows.rs): this
// header is the title bar, in the style of the new Outlook. Empty parts carry
// `data-tauri-drag-region`, so the window can be dragged and double-clicked
// to maximise there.

const useStyles = makeStyles({
  bar: {
    height: "48px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    userSelect: "none",
  },
  logoCell: { width: "56px", flexShrink: 0, display: "flex", justifyContent: "center", alignItems: "center", height: "100%" },
  logo: { width: "22px", height: "22px", display: "block", pointerEvents: "none" },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase500,
    color: tokens.colorBrandForeground1,
    paddingRight: "24px",
    whiteSpace: "nowrap",
    height: "100%",
    display: "flex",
    alignItems: "center",
  },
  search: {
    width: "min(360px, 30vw)",
    maxWidth: "unset",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  drag: { flex: 1, height: "100%", minWidth: "24px" },
  center: {
    maxWidth: "40vw",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    height: "100%",
    display: "flex",
    alignItems: "center",
  },
  icon: { minWidth: "32px", color: tokens.colorNeutralForeground2 },
  controls: { display: "flex", height: "100%", marginLeft: "8px" },
  control: {
    width: "46px",
    height: "100%",
    border: "none",
    background: "transparent",
    color: tokens.colorNeutralForeground1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "default",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":active": { backgroundColor: tokens.colorSubtleBackgroundPressed },
  },
  close: { ":hover": { backgroundColor: "#c42b1c", color: "#fff" }, ":active": { backgroundColor: "#b22a1b", color: "#fff" } },
});

export interface SuiteHeaderProps {
  appName: string;
  /** Logo in `public/` shown above the app rail. */
  logo?: string;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  userName?: string;
  extra?: ReactNode;
  onSettings?: () => void;
  /** Centred text, e.g. the document name in the office apps. */
  center?: ReactNode;
}

export function SuiteHeader({ appName, logo = "/orbit.svg", searchPlaceholder, onSearch, userName, extra, onSettings, center }: SuiteHeaderProps) {
  const s = useStyles();
  const { toggle, mode } = useThemeMode();
  const updates = useUpdates();
  useAutoUpdateCheck();
  const [version, setVersion] = useState(__NEXORA_VERSION__);
  useEffect(() => {
    if (isTauri) void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion));
  }, []);
  return (
    <header className={s.bar} data-tauri-drag-region>
      <span className={s.logoCell} data-tauri-drag-region>
        <img className={s.logo} src={logo} alt="" />
      </span>
      <span className={s.title} data-tauri-drag-region>
        {appName}
      </span>
      {onSearch && <SearchBox className={s.search} size="medium" placeholder={searchPlaceholder ?? "Suchen"} onChange={(_, d) => onSearch(d.value)} />}
      <div className={s.drag} data-tauri-drag-region />
      {center && (
        <div className={s.center} data-tauri-drag-region>
          {center}
        </div>
      )}
      {center && <div className={s.drag} data-tauri-drag-region />}
      {extra}
      <Tooltip content={mode === "dark" ? "Helles Design" : "Dunkles Design"} relationship="label">
        <Button appearance="subtle" className={s.icon} icon={<DarkTheme20Regular />} onClick={toggle} />
      </Tooltip>
      {onSettings && (
        <Tooltip content="Einstellungen" relationship="label">
          <Button appearance="subtle" className={s.icon} icon={<Settings20Regular />} onClick={onSettings} />
        </Tooltip>
      )}
      {updates.status === "available" && updates.info && (
        <Tooltip content={`Nexora ${updates.info.version} ist verfügbar`} relationship="label">
          <Button appearance="primary" size="small" icon={<ArrowDownload20Regular />} onClick={() => openUpdateDialog()} style={{ marginRight: 4 }}>
            Update
          </Button>
        </Tooltip>
      )}
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content="Hilfe" relationship="label">
            <Button appearance="subtle" className={s.icon} icon={<QuestionCircle20Regular />} />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => void api.openExternal("https://github.com/LinzN/Nexora")}>Hilfe und Projektseite</MenuItem>
            {isTauri && <MenuItem onClick={() => void checkForUpdates(true)}>Nach Updates suchen …</MenuItem>}
            <MenuItem disabled>Nexora {version}</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <UpdateDialog />
      {userName && <Avatar name={userName} size={28} color="colorful" style={{ marginLeft: 6 }} />}
      <WindowControls />
    </header>
  );
}

/** Minimise / maximise / close in the Windows 11 style. */
function WindowControls() {
  const s = useStyles();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const update = () => win.isMaximized().then(setMaximized, () => {});
      await update();
      const u = await win.onResized(update);
      if (disposed) u();
      else unlisten = u;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!isTauri) return <span style={{ width: 8 }} />;

  const run = (action: "minimize" | "toggleMaximize" | "close") =>
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow()[action]());

  return (
    <div className={s.controls}>
      <button className={s.control} aria-label="Minimieren" title="Minimieren" onClick={() => run("minimize")}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button className={s.control} aria-label={maximized ? "Wiederherstellen" : "Maximieren"} title={maximized ? "Wiederherstellen" : "Maximieren"} onClick={() => run("toggleMaximize")}>
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
            <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        )}
      </button>
      <button className={mergeClasses(s.control, s.close)} aria-label="Schließen" title="Schließen" onClick={() => run("close")}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
