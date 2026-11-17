import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, Toaster } from "@fluentui/react-components";
import { MailApp } from "./apps/mail/MailApp";
import { ComingSoon, Launcher } from "./apps/launcher/Launcher";
import { ThemeModeContext, darkTheme, lightTheme, loadThemeMode, saveThemeMode, type ThemeMode } from "./shell/theme";
import { TOASTER_ID } from "./shell/notify";
import "./styles.css";

/** Reads the app id from the URL hash (`#/mail`), set by the Rust side. */
function useRoute(): string {
  // Desktop: the Rust side injects `__MIRRA_APP__` per window. Browser/dev: `#/mail`.
  const read = () =>
    window.location.hash.replace(/^#\/?/, "").split("/")[0] || (window as { __MIRRA_APP__?: string }).__MIRRA_APP__ || "home";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(loadThemeMode);
  const route = useRoute();
  const ctx = useMemo(
    () => ({
      mode,
      toggle: () =>
        setMode((m) => {
          const next = m === "dark" ? "light" : "dark";
          saveThemeMode(next);
          return next;
        }),
    }),
    [mode],
  );

  useEffect(() => {
    document.title = route === "mail" ? "Mirra Mail" : "Mirra Office";
    document.documentElement.style.colorScheme = mode;
  }, [route, mode]);

  let page;
  switch (route) {
    case "mail":
      page = <MailApp />;
      break;
    case "home":
      page = <Launcher />;
      break;
    default:
      page = <ComingSoon appId={route} />;
  }

  return (
    <ThemeModeContext.Provider value={ctx}>
      <FluentProvider theme={mode === "dark" ? darkTheme : lightTheme} style={{ height: "100%" }}>
        {page}
        <Toaster toasterId={TOASTER_ID} position="bottom-end" />
      </FluentProvider>
    </ThemeModeContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
