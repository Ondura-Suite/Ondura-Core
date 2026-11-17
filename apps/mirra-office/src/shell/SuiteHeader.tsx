import type { ReactNode } from "react";
import {
  Avatar,
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  SearchBox,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DarkTheme24Regular, Grid24Regular, QuestionCircle24Regular, Settings24Regular } from "@fluentui/react-icons";
import { AppTile, SUITE_APPS } from "../suite";
import { api } from "../lib/api";
import { useThemeMode } from "./theme";

const useStyles = makeStyles({
  bar: {
    height: "48px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "0 8px 0 0",
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  waffle: {
    width: "48px",
    height: "48px",
    minWidth: "48px",
    borderRadius: 0,
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": { backgroundColor: tokens.colorBrandBackgroundHover, color: tokens.colorNeutralForegroundOnBrand },
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    paddingRight: "16px",
    whiteSpace: "nowrap",
  },
  searchWrap: { flex: 1, display: "flex", justifyContent: "center" },
  search: {
    width: "min(560px, 100%)",
    maxWidth: "unset",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  icon: {
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": { backgroundColor: tokens.colorBrandBackgroundHover, color: tokens.colorNeutralForegroundOnBrand },
  },
  launcher: { padding: "16px", width: "340px" },
  launcherGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginTop: "12px" },
  launcherItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    padding: "12px 4px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase200,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":disabled": { cursor: "default", opacity: 0.55 },
  },
});

export interface SuiteHeaderProps {
  appName: string;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  userName?: string;
  extra?: ReactNode;
}

export function SuiteHeader({ appName, searchPlaceholder, onSearch, userName, extra }: SuiteHeaderProps) {
  const s = useStyles();
  const { toggle, mode } = useThemeMode();
  return (
    <header className={s.bar}>
      <Popover positioning="below-start" withArrow>
        <PopoverTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={s.waffle} icon={<Grid24Regular />} aria-label="App-Startfeld" />
        </PopoverTrigger>
        <PopoverSurface className={s.launcher}>
          <Text weight="semibold" size={400}>Mirra Office</Text>
          <div className={s.launcherGrid}>
            {SUITE_APPS.map((app) => (
              <button
                key={app.id}
                className={s.launcherItem}
                disabled={!app.available}
                title={app.available ? app.description : `${app.description} – in Entwicklung`}
                onClick={() => api.openApp(app.id)}
              >
                <AppTile app={app} size={36} />
                {app.short}
              </button>
            ))}
          </div>
        </PopoverSurface>
      </Popover>
      <span className={s.title}>{appName}</span>
      <div className={s.searchWrap}>
        {onSearch && (
          <SearchBox
            className={s.search}
            size="medium"
            placeholder={searchPlaceholder ?? "Suchen"}
            onChange={(_, d) => onSearch(d.value)}
          />
        )}
      </div>
      {extra}
      <Tooltip content={mode === "dark" ? "Helles Design" : "Dunkles Design"} relationship="label">
        <Button appearance="subtle" className={s.icon} icon={<DarkTheme24Regular />} onClick={toggle} />
      </Tooltip>
      <Tooltip content="Einstellungen" relationship="label">
        <Button appearance="subtle" className={s.icon} icon={<Settings24Regular />} />
      </Tooltip>
      <Tooltip content="Hilfe" relationship="label">
        <Button
          appearance="subtle"
          className={s.icon}
          icon={<QuestionCircle24Regular />}
          onClick={() => api.openExternal("https://github.com/LinzN/MirraOffice")}
        />
      </Tooltip>
      <Avatar name={userName} size={32} color="colorful" style={{ marginLeft: 4 }} />
    </header>
  );
}
