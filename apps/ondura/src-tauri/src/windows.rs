//! One process, one window per suite app. `ondura --app mail` opens
//! Ondura Mail; launching a second shortcut while the suite is running
//! focuses or opens the window in the existing process (single instance).
//!
//! Calendar, contacts and tasks are modules of the Ondura Mail window (like in
//! Outlook): `--app calendar` opens Ondura Mail and switches it to the calendar.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// (id, window title) of every app in the suite. Keep in sync with
/// `src/suite.tsx` and the installer shortcuts.
pub const APPS: &[(&str, &str)] = &[
    ("home", "Ondura"),
    ("mail", "Ondura Mail"),
    ("text", "Ondura Text"),
    ("sheets", "Ondura Tabellen"),
    ("slides", "Ondura Präsentation"),
    ("pdf", "Ondura PDF"),
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
        "text" | "sheets" | "slides" | "pdf" => office,
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
        "pdf" => Some("pdf"),
        _ => None,
    }
}

/// What a launch (command line or second instance) asks for.
#[derive(Debug, PartialEq)]
pub struct Launch {
    pub app: String,
    pub file: Option<String>,
    /// `mailto:` link (Ondura Mail as default email app): a new message.
    pub mailto: Option<String>,
}

/// `--app <id>` and/or a document path (file associations pass the path).
pub fn launch_from_args<S: AsRef<str>>(args: &[S]) -> Launch {
    // Registered as `--mailto "%1"`; a bare `mailto:` argument works too.
    let mailto = args.iter().skip(1).map(AsRef::as_ref).find(|a| a.len() > 7 && a[..7].eq_ignore_ascii_case("mailto:")).map(String::from);
    if mailto.is_some() {
        return Launch { app: "mail".into(), file: None, mailto };
    }
    let file = args.iter().skip(1).map(AsRef::as_ref).find(|a| !a.starts_with("--") && app_for_file(a).is_some()).map(String::from);
    match file {
        Some(f) => Launch { app: app_for_file(&f).unwrap_or("home").to_string(), file: Some(f), mailto: None },
        None => Launch { app: app_from_args(args), file: None, mailto: None },
    }
}

pub fn open_launch(app: &AppHandle, launch: &Launch) -> tauri::Result<()> {
    if let Some(link) = &launch.mailto {
        return open_mailto(app, link);
    }
    match &launch.file {
        Some(f) => open_document_window(app, &launch.app, Some(f)),
        None => open_app_window(app, &launch.app),
    }
}

/// A new message from a `mailto:` link in the Ondura Mail window: handed to
/// the open window as an event, or to a new one at start-up.
fn open_mailto(app: &AppHandle, link: &str) -> tauri::Result<()> {
    if app.get_webview_window("mail").is_some() {
        let _ = app.emit_to("mail", "mail-module", "mail");
        let _ = app.emit_to("mail", "mailto", link);
        return open_app_window(app, "mail");
    }
    let extra = format!("window.__ONDURA_MAILTO__ = {};", serde_json::to_string(link).unwrap());
    open_app_window_with(app, "mail", &extra)
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
    let mut script = format!("window.__ONDURA_APP__ = {};", serde_json::to_string(id).unwrap());
    if let Some(f) = file {
        script.push_str(&format!("window.__ONDURA_FILE__ = {};", serde_json::to_string(f).unwrap()));
    }
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .initialization_script(script)
        .title(ondura_i18n::translate(title))
        .inner_size(1440.0, 900.0)
        .min_inner_size(760.0, 520.0);
    let window = chrome(window).center().build()?;
    set_app_identity(&window, id, title);
    Ok(())
}

/// A mail message in its own window (double-click in the list), like in
/// Outlook. Several can be open at once; they belong to Ondura Mail in the
/// taskbar.
pub fn open_message_window(app: &AppHandle, message_id: &str, title: &str) -> tauri::Result<()> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("message-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let script = format!(
        "window.__ONDURA_APP__ = \"message\"; window.__ONDURA_MODULE__ = {};",
        serde_json::to_string(message_id).unwrap()
    );
    let title = if title.trim().is_empty() { ondura_i18n::translate("Ondura Mail") } else { title.to_string() };
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .initialization_script(script)
        .title(title)
        .inner_size(1040.0, 820.0)
        .min_inner_size(640.0, 480.0);
    let window = chrome(window).center().build()?;
    set_app_identity(&window, "mail", "Ondura Mail");
    Ok(())
}

/// Modules shown inside the Ondura Mail window.
pub const MAIL_MODULES: &[&str] = &["calendar", "contacts", "tasks"];

pub fn open_app_window(app: &AppHandle, app_id: &str) -> tauri::Result<()> {
    open_app_window_with(app, app_id, "")
}

fn open_app_window_with(app: &AppHandle, app_id: &str, extra_script: &str) -> tauri::Result<()> {
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
    let mut script = format!("window.__ONDURA_APP__ = {};", serde_json::to_string(id).unwrap());
    if let Some(module) = module {
        script.push_str(&format!("window.__ONDURA_MODULE__ = {};", serde_json::to_string(module).unwrap()));
    }
    script.push_str(extra_script);
    let (width, height) = if *id == "home" { (1100.0, 720.0) } else { (1440.0, 900.0) };
    let window = WebviewWindowBuilder::new(app, *id, WebviewUrl::App("index.html".into()))
        // The frontend routes on this value (see `useRoute` in main.tsx).
        .initialization_script(script)
        .title(ondura_i18n::translate(title))
        .inner_size(width, height)
        .min_inner_size(900.0, 560.0);
    let window = chrome(window).center().build()?;
    set_app_identity(&window, id, title);
    Ok(())
}

/// Window frame: the frontend draws its own title bar
/// (src/shell/SuiteHeader.tsx). On macOS the system's traffic lights stay,
/// drawn over that title bar.
fn chrome<'a>(builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    #[cfg(target_os = "macos")]
    return builder.decorations(true).title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(tauri::LogicalPosition::new(14.0, 20.0));
    #[cfg(not(target_os = "macos"))]
    builder.decorations(false).shadow(true)
}

/// AppUserModelID of an app: Windows groups taskbar buttons by it, so Text,
/// Sheets, Slides and Mail get their own buttons although they run in one
/// process. Shortcuts carry the same id (windows/installer-hooks.nsh).
#[cfg(windows)]
pub fn app_user_model_id(app_id: &str) -> String {
    if app_id == "home" { "de.mirranet.ondura".into() } else { format!("de.mirranet.ondura.{app_id}") }
}

/// Window icon of the app (all windows share one process and its icon).
fn app_icon(app_id: &str) -> Option<tauri::image::Image<'static>> {
    let bytes: &[u8] = match app_id {
        "mail" => include_bytes!("../icons/apps/mail.png"),
        "text" => include_bytes!("../icons/apps/text.png"),
        "sheets" => include_bytes!("../icons/apps/sheets.png"),
        "slides" => include_bytes!("../icons/apps/slides.png"),
        _ => return None,
    };
    tauri::image::Image::from_bytes(bytes).ok()
}

fn set_app_identity(window: &tauri::WebviewWindow, app_id: &str, title: &str) {
    if let Some(icon) = app_icon(app_id) {
        let _ = window.set_icon(icon);
    }
    #[cfg(windows)]
    set_taskbar_identity(window, app_id, title);
    #[cfg(not(windows))]
    let _ = title;
}

/// Sets the AppUserModelID and what "pin to taskbar" starts for a window.
#[cfg(windows)]
fn set_taskbar_identity(window: &tauri::WebviewWindow, app_id: &str, title: &str) {
    use windows::Win32::Storage::EnhancedStorage::{PKEY_AppUserModel_ID, PKEY_AppUserModel_RelaunchCommand, PKEY_AppUserModel_RelaunchDisplayNameResource, PKEY_AppUserModel_RelaunchIconResource};
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
    let Ok(hwnd) = window.hwnd() else { return };
    let Ok(exe) = std::env::current_exe() else { return };
    let icon = exe.parent().map(|d| d.join("icons").join(format!("{app_id}.ico")));
    // SAFETY: plain COM calls on a window handle that belongs to us.
    unsafe {
        let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd) else { return };
        let set = |key, value: &str| {
            let _ = store.SetValue(&key, &PROPVARIANT::from(value));
        };
        if app_id != "home" {
            set(PKEY_AppUserModel_RelaunchCommand, &format!("\"{}\" --app {app_id}", exe.display()));
            set(PKEY_AppUserModel_RelaunchDisplayNameResource, &ondura_i18n::translate(title));
            if let Some(icon) = icon.filter(|p| p.exists()) {
                set(PKEY_AppUserModel_RelaunchIconResource, &format!("{},0", icon.display()));
            }
        }
        set(PKEY_AppUserModel_ID, &app_user_model_id(app_id));
        let _ = store.Commit();
    }
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
        assert_eq!(app_from_args(&["ondura", "--app", "mail"]), "mail");
        assert_eq!(app_from_args(&["ondura", "--app=calendar"]), "calendar");
        assert_eq!(app_from_args(&["ondura"]), "home");
    }

    #[test]
    fn document_arguments_pick_the_app() {
        use super::{Launch, launch_from_args};
        assert_eq!(launch_from_args(&["ondura", r"C:\Docs\Brief.DOCX"]), Launch { app: "text".into(), file: Some(r"C:\Docs\Brief.DOCX".into()), mailto: None });
        assert_eq!(launch_from_args(&["ondura", "/home/n/zahlen.xlsx"]).app, "sheets");
        assert_eq!(launch_from_args(&["ondura", "/home/n/brief.odt"]).app, "text");
        assert_eq!(launch_from_args(&["ondura", "/home/n/zahlen.ods"]).app, "sheets");
        assert_eq!(launch_from_args(&["ondura", "/home/n/vortrag.odp"]).app, "slides");
        assert_eq!(launch_from_args(&["ondura", r"C:\Scans\Vertrag.PDF"]).app, "pdf");
        assert_eq!(launch_from_args(&["ondura", "--app", "mail"]), Launch { app: "mail".into(), file: None, mailto: None });
        let l = launch_from_args(&["ondura", "--mailto", "MAILTO:a@x.de?subject=Hi"]);
        assert_eq!((l.app.as_str(), l.mailto.as_deref()), ("mail", Some("MAILTO:a@x.de?subject=Hi")));
    }
}
