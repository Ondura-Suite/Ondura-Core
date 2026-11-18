import { Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ORBIT_MODULES, isOrbitModule, useOrbit, type SuiteApp } from "../suite";
import { api } from "../lib/api";

const useStyles = makeStyles({
  rail: {
    width: "56px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingTop: "8px",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  item: {
    position: "relative",
    width: "48px",
    height: "48px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    ":hover": { backgroundColor: tokens.colorNeutralBackground3Hover, color: tokens.colorNeutralForeground2 },
    ":disabled": { cursor: "default", opacity: 0.45 },
  },
  active: {
    backgroundColor: tokens.colorNeutralBackground1,
    "::before": {
      content: '""',
      position: "absolute",
      left: "-4px",
      top: "12px",
      bottom: "12px",
      width: "3px",
      borderRadius: "2px",
      backgroundColor: tokens.colorBrandBackground,
    },
  },
});

/**
 * Vertical app bar on the left, like in the new Outlook. It switches the
 * Orbit modules (mail, calendar, contacts, tasks) in the same window; the
 * office apps are separate programs and are not listed here.
 */
export function AppRail({ current }: { current: string }) {
  const s = useStyles();
  const orbit = useOrbit();

  const item = (app: SuiteApp) => {
    const Icon = app.icon;
    const active = app.id === current;
    const open = () => {
      if (active) return;
      if (orbit && isOrbitModule(app.id)) orbit.setModule(app.id);
      else void api.openApp(app.id);
    };
    return (
      <Tooltip key={app.id} content={app.available ? app.name : `${app.name} (in Entwicklung)`} relationship="label" positioning="after">
        <button
          className={mergeClasses(s.item, active && s.active)}
          disabled={!app.available && !active}
          onClick={open}
          aria-current={active ? "page" : undefined}
        >
          <Icon style={{ fontSize: 24, color: active || app.available ? app.color : undefined }} />
        </button>
      </Tooltip>
    );
  };

  return (
    <nav className={s.rail} aria-label="Apps">
      {ORBIT_MODULES.map(item)}
    </nav>
  );
}
