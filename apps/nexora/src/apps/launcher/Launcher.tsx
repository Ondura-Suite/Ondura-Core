import { Badge, Text, makeStyles, tokens } from "@fluentui/react-components";
import { AppTile, SUITE_APPS, suiteApp } from "../../suite";
import { api } from "../../lib/api";
import { SuiteHeader } from "../../shell/SuiteHeader";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground2 },
  main: { flex: 1, overflow: "auto", padding: "40px 48px" },
  hello: { fontSize: tokens.fontSizeHero800, fontWeight: tokens.fontWeightSemibold, marginBottom: "24px", display: "block" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px", maxWidth: "1100px" },
  card: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    ":hover": { boxShadow: tokens.shadow8 },
    ":disabled": { cursor: "default", opacity: 0.7, boxShadow: "none" },
  },
  name: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, display: "block" },
  desc: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    color: tokens.colorNeutralForeground2,
  },
});

/** Start page of the suite (shown when no `--app` is given). */
export function Launcher() {
  const s = useStyles();
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  return (
    <div className={s.root}>
      <SuiteHeader appName="Nexora" />
      <main className={s.main}>
        <Text className={s.hello}>{greeting}</Text>
        <div className={s.grid}>
          {SUITE_APPS.map((app) => (
            <button key={app.id} className={s.card} disabled={!app.available} onClick={() => api.openApp(app.id)}>
              <AppTile app={app} size={44} />
              <span>
                <span className={s.name}>{app.name}</span>
                <span className={s.desc}>{app.description}</span>
                {!app.available && (
                  <div style={{ marginTop: 6 }}>
                    <Badge appearance="tint" color="informative" size="small">In Entwicklung</Badge>
                  </div>
                )}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

/** Placeholder for suite apps that are not built yet. */
export function ComingSoon({ appId }: { appId: string }) {
  const s = useStyles();
  const app = suiteApp(appId) ?? SUITE_APPS[0];
  return (
    <div className={s.root}>
      <SuiteHeader appName={app.short} />
      <div className={s.center}>
        <AppTile app={app} size={72} />
        <Text size={600} weight="semibold">{app.name}</Text>
        <Text>Diese App ist noch in Entwicklung.</Text>
      </div>
    </div>
  );
}
