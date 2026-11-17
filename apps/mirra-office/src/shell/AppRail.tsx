import { Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { SUITE_APPS } from "../suite";
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
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
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
  divider: { width: "28px", height: "1px", margin: "6px 0", backgroundColor: tokens.colorNeutralStroke2 },
});

/** Vertical app bar on the left, like in the new Outlook. */
export function AppRail({ current }: { current: string }) {
  const s = useStyles();
  return (
    <nav className={s.rail} aria-label="Apps">
      {SUITE_APPS.map((app, i) => {
        const Icon = app.icon;
        const active = app.id === current;
        return (
          <div key={app.id} style={{ display: "contents" }}>
            {i === 4 && <div className={s.divider} />}
            <Tooltip content={app.available ? app.name : `${app.name} (in Entwicklung)`} relationship="label" positioning="after">
              <button
                className={mergeClasses(s.item, active && s.active)}
                disabled={!app.available && !active}
                onClick={() => !active && api.openApp(app.id)}
                aria-current={active ? "page" : undefined}
              >
                <Icon style={{ fontSize: 24, color: active || app.available ? app.color : undefined }} />
              </button>
            </Tooltip>
          </div>
        );
      })}
    </nav>
  );
}
