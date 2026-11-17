//! One process, one window per suite app. `nexora --app mail` opens
//! Relay; launching a second shortcut while the suite is running
//! focuses or opens the window in the existing process (single instance).
//!
//! Calendar, contacts and tasks are modules of the Relay window (like in
//! Outlook): `--app calendar` opens Relay and switches it to the calendar.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// (id, window title) of every app in the suite. Keep in sync with
/// `src/suite.tsx` and the installer shortcuts.
pub const APPS: &[(&str, &str)] = &[
    ("home", "Nexora"),
    ("mail", "Relay"),
    ("text", "Nexora Text"),
    ("sheets", "Nexora Tabellen"),
    ("slides", "Nexora Präsentation"),
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

/// Modules shown inside the Relay window.
pub const RELAY_MODULES: &[&str] = &["calendar", "contacts", "tasks"];

pub fn open_app_window(app: &AppHandle, app_id: &str) -> tauri::Result<()> {
    let module = RELAY_MODULES.iter().find(|m| **m == app_id).copied();
    let app_id = if module.is_some() { "mail" } else { app_id };
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id) else {
        return open_app_window(app, "home");
    };
    if let Some(window) = app.get_webview_window(id) {
        if let Some(module) = module {
            let _ = app.emit_to(*id, "relay-module", module);
        }
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus();
    }
    let mut script = format!("window.__NEXORA_APP__ = {};", serde_json::to_string(id).unwrap());
    if let Some(module) = module {
        script.push_str(&format!("window.__NEXORA_MODULE__ = {};", serde_json::to_string(module).unwrap()));
    }
    let (width, height) = if *id == "home" { (1100.0, 720.0) } else { (1440.0, 900.0) };
    WebviewWindowBuilder::new(app, *id, WebviewUrl::App("index.html".into()))
        // The frontend routes on this value (see `useRoute` in main.tsx).
        .initialization_script(script)
        .title(*title)
        .inner_size(width, height)
        .min_inner_size(900.0, 560.0)
        // The frontend draws its own title bar (src/shell/SuiteHeader.tsx).
        .decorations(false)
        .shadow(true)
        .center()
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::app_from_args;

    #[test]
    fn parses_app_argument() {
        assert_eq!(app_from_args(&["nexora", "--app", "mail"]), "mail");
        assert_eq!(app_from_args(&["nexora", "--app=calendar"]), "calendar");
        assert_eq!(app_from_args(&["nexora"]), "home");
    }
}
