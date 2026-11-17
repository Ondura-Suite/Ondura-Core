//! One process, one window per suite app. `mirra-office --app mail` opens
//! Mirra Mail; launching a second shortcut while the suite is running
//! focuses or opens the window in the existing process (single instance).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// (id, window title) of every app in the suite. Keep in sync with
/// `src/suite.tsx` and the installer shortcuts.
pub const APPS: &[(&str, &str)] = &[
    ("home", "Mirra Office"),
    ("mail", "Mirra Mail"),
    ("calendar", "Mirra Kalender"),
    ("contacts", "Mirra Kontakte"),
    ("tasks", "Mirra Aufgaben"),
    ("text", "Mirra Text"),
    ("sheets", "Mirra Tabellen"),
    ("slides", "Mirra Präsentation"),
];

/// Extract the app id from command line arguments (`--app mail` or `--app=mail`).
pub fn app_from_args<S: AsRef<str>>(args: &[S]) -> String {
    let mut it = args.iter().map(AsRef::as_ref);
    while let Some(a) = it.next() {
        if a == "--app" {
            if let Some(v) = it.next() {
                return v.to_string();
            }
        } else if let Some(v) = a.strip_prefix("--app=") {
            return v.to_string();
        }
    }
    "home".into()
}

pub fn open_app_window(app: &AppHandle, app_id: &str) -> tauri::Result<()> {
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id) else {
        return open_app_window(app, "home");
    };
    if let Some(window) = app.get_webview_window(id) {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus();
    }
    let (width, height) = if *id == "home" { (1100.0, 720.0) } else { (1440.0, 900.0) };
    WebviewWindowBuilder::new(app, *id, WebviewUrl::App("index.html".into()))
        // The frontend routes on this value (see `useRoute` in main.tsx).
        .initialization_script(format!("window.__MIRRA_APP__ = {};", serde_json::to_string(id).unwrap()))
        .title(*title)
        .inner_size(width, height)
        .min_inner_size(900.0, 560.0)
        .center()
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::app_from_args;

    #[test]
    fn parses_app_argument() {
        assert_eq!(app_from_args(&["mirra-office", "--app", "mail"]), "mail");
        assert_eq!(app_from_args(&["mirra-office", "--app=calendar"]), "calendar");
        assert_eq!(app_from_args(&["mirra-office"]), "home");
    }
}
