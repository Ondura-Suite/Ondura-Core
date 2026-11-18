//! One process, one window per suite app. `nexora --app mail` opens
//! Orbit; launching a second shortcut while the suite is running
//! focuses or opens the window in the existing process (single instance).
//!
//! Calendar, contacts and tasks are modules of the Orbit window (like in
//! Outlook): `--app calendar` opens Orbit and switches it to the calendar.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// (id, window title) of every app in the suite. Keep in sync with
/// `src/suite.tsx` and the installer shortcuts.
pub const APPS: &[(&str, &str)] = &[
    ("home", "Nexora"),
    ("mail", "Orbit"),
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

/// App for an office document, by file extension.
pub fn app_for_file(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "docx" => Some("text"),
        "xlsx" | "xlsm" => Some("sheets"),
        "pptx" => Some("slides"),
        _ => None,
    }
}

/// What a launch (command line or second instance) asks for.
#[derive(Debug, PartialEq)]
pub struct Launch {
    pub app: String,
    pub file: Option<String>,
}

/// `--app <id>` and/or a document path (file associations pass the path).
pub fn launch_from_args<S: AsRef<str>>(args: &[S]) -> Launch {
    let file = args.iter().skip(1).map(AsRef::as_ref).find(|a| !a.starts_with("--") && app_for_file(a).is_some()).map(String::from);
    match file {
        Some(f) => Launch { app: app_for_file(&f).unwrap_or("home").to_string(), file: Some(f) },
        None => Launch { app: app_from_args(args), file: None },
    }
}

pub fn open_launch(app: &AppHandle, launch: &Launch) -> tauri::Result<()> {
    match &launch.file {
        Some(f) => open_document_window(app, &launch.app, Some(f)),
        None => open_app_window(app, &launch.app),
    }
}

/// Office apps open one window per document, like Word. The first window
/// of an app uses the app id as label, further ones `<app>-<n>`.
pub fn open_document_window(app: &AppHandle, app_id: &str, file: Option<&str>) -> tauri::Result<()> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(2);
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id) else {
        return open_app_window(app, "home");
    };
    let label = if app.get_webview_window(id).is_none() { id.to_string() } else { format!("{id}-{}", NEXT.fetch_add(1, Ordering::Relaxed)) };
    let mut script = format!("window.__NEXORA_APP__ = {};", serde_json::to_string(id).unwrap());
    if let Some(f) = file {
        script.push_str(&format!("window.__NEXORA_FILE__ = {};", serde_json::to_string(f).unwrap()));
    }
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .initialization_script(script)
        .title(*title)
        .inner_size(1440.0, 900.0)
        .min_inner_size(760.0, 520.0)
        .decorations(false)
        .shadow(true)
        .center()
        .build()?;
    Ok(())
}

/// Modules shown inside the Orbit window.
pub const ORBIT_MODULES: &[&str] = &["calendar", "contacts", "tasks"];

pub fn open_app_window(app: &AppHandle, app_id: &str) -> tauri::Result<()> {
    let module = ORBIT_MODULES.iter().find(|m| **m == app_id).copied();
    let app_id = if module.is_some() { "mail" } else { app_id };
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id) else {
        return open_app_window(app, "home");
    };
    if let Some(window) = app.get_webview_window(id) {
        if let Some(module) = module {
            let _ = app.emit_to(*id, "orbit-module", module);
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

    #[test]
    fn document_arguments_pick_the_app() {
        use super::{Launch, launch_from_args};
        assert_eq!(launch_from_args(&["nexora", r"C:\Docs\Brief.DOCX"]), Launch { app: "text".into(), file: Some(r"C:\Docs\Brief.DOCX".into()) });
        assert_eq!(launch_from_args(&["nexora", "/home/n/zahlen.xlsx"]).app, "sheets");
        assert_eq!(launch_from_args(&["nexora", "--app", "mail"]), Launch { app: "mail".into(), file: None });
    }
}
