//! One process, one window per suite app. `nexora --app mail` opens
//! Nexora Mail; launching a second shortcut while the suite is running
//! focuses or opens the window in the existing process (single instance).
//!
//! Calendar, contacts and tasks are modules of the Nexora Mail window (like in
//! Outlook): `--app calendar` opens Nexora Mail and switches it to the calendar.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// (id, window title) of every app in the suite. Keep in sync with
/// `src/suite.tsx` and the installer shortcuts.
pub const APPS: &[(&str, &str)] = &[
    ("home", "Nexora"),
    ("mail", "Nexora Mail"),
    ("text", "Nexora Text"),
    ("sheets", "Nexora Tabellen"),
    ("slides", "Nexora Präsentation"),
];

/// Whether an app was chosen in the Windows installer. The installer writes
/// `components.ini` next to the binary (`mail=0|1`, `office=0|1`); without
/// that file (Linux packages, development) every app is installed.
pub fn installed(app_id: &str) -> bool {
    use std::sync::OnceLock;
    static COMPONENTS: OnceLock<(bool, bool)> = OnceLock::new();
    let (mail, office) = *COMPONENTS.get_or_init(|| {
        let ini = std::env::current_exe().ok().and_then(|exe| std::fs::read_to_string(exe.with_file_name("components.ini")).ok());
        ini.map(|text| parse_components(&text)).unwrap_or((true, true))
    });
    match app_id {
        "mail" | "calendar" | "contacts" | "tasks" => mail,
        "text" | "sheets" | "slides" => office,
        _ => true,
    }
}

/// (mail, office) from the installer's components.ini.
pub fn parse_components(text: &str) -> (bool, bool) {
    let mut mail = true;
    let mut office = true;
    for line in text.lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        let on = v.trim() != "0";
        match k.trim().to_ascii_lowercase().as_str() {
            "mail" => mail = on,
            "office" => office = on,
            _ => {}
        }
    }
    // A broken file must not leave the user without any app.
    if !mail && !office { (true, true) } else { (mail, office) }
}

/// Ids of the installed apps (for the start page).
pub fn installed_apps() -> Vec<&'static str> {
    APPS.iter().map(|(id, _)| *id).filter(|id| installed(id)).collect()
}

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
        "docx" | "odt" => Some("text"),
        "xlsx" | "xlsm" | "ods" => Some("sheets"),
        "pptx" | "odp" => Some("slides"),
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
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id && installed(id)) else {
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

/// Modules shown inside the Nexora Mail window.
pub const MAIL_MODULES: &[&str] = &["calendar", "contacts", "tasks"];

pub fn open_app_window(app: &AppHandle, app_id: &str) -> tauri::Result<()> {
    let module = MAIL_MODULES.iter().find(|m| **m == app_id).copied();
    let app_id = if module.is_some() { "mail" } else { app_id };
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id && installed(id)) else {
        return open_app_window(app, "home");
    };
    if let Some(window) = app.get_webview_window(id) {
        if let Some(module) = module {
            let _ = app.emit_to(*id, "mail-module", module);
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
    fn parses_installer_components() {
        use super::parse_components;
        assert_eq!(parse_components("[Apps]\r\nmail=1\r\noffice=0\r\n"), (true, false));
        assert_eq!(parse_components("[Apps]\nmail=0\noffice=1\n"), (false, true));
        assert_eq!(parse_components("mail=0\noffice=0"), (true, true));
        assert_eq!(parse_components(""), (true, true));
    }

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
        assert_eq!(launch_from_args(&["nexora", "/home/n/brief.odt"]).app, "text");
        assert_eq!(launch_from_args(&["nexora", "/home/n/zahlen.ods"]).app, "sheets");
        assert_eq!(launch_from_args(&["nexora", "/home/n/vortrag.odp"]).app, "slides");
        assert_eq!(launch_from_args(&["nexora", "--app", "mail"]), Launch { app: "mail".into(), file: None });
    }
}
