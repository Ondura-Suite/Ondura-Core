import { StrictMode, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, Toaster } from "@fluentui/react-components";
import { MailWindow } from "./apps/mailwindow/MailWindow";
import { isMailModule, suiteApp } from "./suite";
import { ComingSoon, Launcher } from "./apps/launcher/Launcher";
import { ThemeModeContext, darkTheme, lightTheme, loadThemeMode, saveThemeMode, type ThemeMode } from "./shell/theme";
import { TOASTER_ID } from "./shell/notify";
import "./styles.css";

// Office apps are loaded on demand so Ondura Mail starts fast.
const TextApp = lazy(() => import("./apps/text/TextApp").then((m) => ({ default: m.TextApp })));
const SlidesApp = lazy(() => import("./apps/slides/SlidesApp").then((m) => ({ default: m.SlidesApp })));
const SheetsApp = lazy(() => import("./apps/sheets/SheetsApp").then((m) => ({ default: m.SheetsApp })));

/**
 * App id and optional module: `#/mail/calendar` in the browser, or
 * `__ONDURA_APP__` / `__ONDURA_MODULE__` injected per window by the Rust side.
 */
function useRoute(): string[] {
  // Desktop: the Rust side injects `__ONDURA_APP__` per window. Browser/dev: `#/mail`.
  const read = () => {
    const w = window as { __ONDURA_APP__?: string; __ONDURA_MODULE__?: string };
    const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts.length) return parts;
    return [w.__ONDURA_APP__ || "home", w.__ONDURA_MODULE__ ?? ""].filter(Boolean);
  };
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
  const [route0, sub] = useRoute();
  // Calendar, contacts and tasks live inside Ondura Mail (old links: `#/calendar`).
  const route = isMailModule(route0) ? "mail" : route0;
  const module = isMailModule(route0) && route0 !== "mail" ? route0 : sub;
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
    if (route !== "mail" && route !== "text" && route !== "sheets" && route !== "slides") document.title = route === "home" ? "Ondura" : suiteApp(route)?.name ?? "Ondura";
    document.documentElement.style.colorScheme = mode;
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [route, mode]);

  let page;
  switch (route) {
    case "mail":
      page = <MailWindow initial={module} />;
      break;
    case "text":
      page = (
        <Suspense fallback={null}>
          <TextApp />
        </Suspense>
      );
      break;
    case "sheets":
      page = (
        <Suspense fallback={null}>
          <SheetsApp />
        </Suspense>
      );
      break;
    case "slides":
      page = (
        <Suspense fallback={null}>
          <SlidesApp />
        </Suspense>
      );
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
