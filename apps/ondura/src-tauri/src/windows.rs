//! Windows of the suite apps, and which process shows them.
//!
//! Each app runs in its own process (Windows, Linux): Ondura Mail, Text,
//! Sheets, … are separate programs (`ondura-mail.exe`, `ondura-text.exe`, …
//! on Windows, `ondura-mail`, … links to `ondura` on Linux) that work
//! together as a suite: opening another app hands the request to its process
//! (see instance.rs) or starts it. `ondura --app mail` still works and is
//! passed on to the right program. On macOS the suite stays one process
//! (`suite`) with one window per app.
//!
//! Calendar, contacts and tasks are modules of the Ondura Mail window (like in
//! Outlook): `--app calendar` opens Ondura Mail and switches it to the calendar.

use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::instance;

/// (id, window title) of every app in the suite. Keep in sync with
/// `src/suite.tsx` and the installer shortcuts.
pub const APPS: &[(&str, &str)] = &[
    ("home", "Ondura"),
    ("mail", "Ondura Mail"),
    ("text", "Ondura Text"),
    ("sheets", "Ondura Tabellen"),
    ("slides", "Ondura Präsentation"),
    ("pdf", "Ondura PDF"),
    ("notes", "Ondura Notizen"),
    ("planner", "Ondura Planer"),
    ("diagram", "Ondura Diagramme"),
    ("forms", "Ondura Formulare"),
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
        "text" | "sheets" | "slides" | "pdf" | "notes" | "planner" | "diagram" | "forms" => office,
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

/// Whether every app runs in its own process (not on macOS, where Ondura
/// is one application bundle).
pub const fn per_app() -> bool {
    !cfg!(target_os = "macos")
}

static PROCESS_APP: OnceLock<&'static str> = OnceLock::new();

/// App of this process (`suite` on macOS: all of them).
pub fn process_app() -> &'static str {
    PROCESS_APP.get().copied().unwrap_or("suite")
}

pub fn set_process_app(app: &'static str) {
    let _ = PROCESS_APP.set(app);
}

/// Process (app id) that shows the windows of `app_id`.
pub fn owner_of(app_id: &str) -> &'static str {
    if !per_app() {
        return "suite";
    }
    if MAIL_MODULES.contains(&app_id) || app_id == "message" {
        return "mail";
    }
    APPS.iter().map(|(id, _)| *id).find(|id| *id == app_id).unwrap_or("home")
}

/// Whether the windows of `app_id` belong to this process.
pub fn is_own(app_id: &str) -> bool {
    owner_of(app_id) == process_app()
}

/// Whether this process syncs mail and calendars, shows the tray icon and
/// the notifications: Ondura Mail (or the whole suite on macOS).
pub fn syncs() -> bool {
    matches!(process_app(), "mail" | "suite")
}

/// Program name of an app: `ondura-text` for Text, `ondura` for the start
/// page.
pub fn program_name(app_id: &str) -> String {
    if app_id == "home" { "ondura".into() } else { format!("ondura-{app_id}") }
}

/// App of the program this process was started as (`ondura-text` → `text`,
/// `ondura` → `home`), `None` for unknown names. On Linux the programs are
/// links to one binary, so the name comes from the command line.
pub fn exe_app() -> Option<&'static str> {
    #[cfg(windows)]
    let name = std::env::current_exe().ok()?.file_stem()?.to_string_lossy().to_ascii_lowercase();
    #[cfg(not(windows))]
    let name = std::path::Path::new(&std::env::args_os().next()?).file_name()?.to_string_lossy().to_string();
    app_of_program(&name)
}

/// What a command line asks for, with the program name (its first entry)
/// deciding the app when nothing else does.
pub fn resolve_launch(args: &[String]) -> Launch {
    let mut launch = launch_from_args(args);
    if !launch.explicit
        && let Some(app) = args.first().and_then(|a| app_of_program(&program_stem(a)))
    {
        launch.app = app.to_string();
    }
    launch
}

/// `C:\…\ONDURA-MAIL.exe` or `/usr/bin/ondura-mail` → `ondura-mail`.
fn program_stem(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    name.strip_suffix(".exe").map(str::to_string).unwrap_or(name)
}

fn app_of_program(name: &str) -> Option<&'static str> {
    if name == "ondura" {
        return Some("home");
    }
    let id = name.strip_prefix("ondura-")?;
    APPS.iter().map(|(id, _)| *id).find(|a| *a == id)
}

/// The program of an app next to this one, if installed that way.
fn app_program(app_id: &str) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = program_name(app_id);
    #[cfg(windows)]
    let path = exe.with_file_name(format!("{name}.exe"));
    // Linux: the links sit next to the binary (`/usr/bin`); the binary
    // itself is resolved by current_exe, so look where we were started too.
    #[cfg(not(windows))]
    let path = {
        let started = std::env::args_os().next().map(std::path::PathBuf::from);
        let dir = started.as_deref().and_then(|p| p.parent()).filter(|d| !d.as_os_str().is_empty()).and_then(|d| std::path::absolute(d).ok());
        let in_dir = dir.map(|d| d.join(&name)).filter(|p| p.exists());
        in_dir.unwrap_or_else(|| exe.with_file_name(&name))
    };
    path.exists().then_some(path)
}

/// Command that starts `app_id` as its own process: its program, or the
/// AppImage (a new mount; the current one ends with this process), or this
/// binary with `--app`.
pub fn app_command(app_id: &str) -> std::process::Command {
    let owner = if per_app() { owner_of(app_id) } else { app_id };
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        let mut cmd = std::process::Command::new(appimage);
        cmd.args(["--app", app_id]);
        return cmd;
    }
    if let Some(program) = app_program(owner) {
        let mut cmd = std::process::Command::new(program);
        if owner != app_id {
            cmd.args(["--app", app_id]);
        }
        return cmd;
    }
    let mut cmd = std::process::Command::new(std::env::current_exe().unwrap_or_else(|_| "ondura".into()));
    cmd.args(["--app", app_id]);
    cmd
}

/// Opens `app_id` in its own process: hands `extra` arguments (a file,
/// `--new`, `--mailto …`) to the running instance or starts the program.
pub fn open_elsewhere(app_id: &str, extra: &[String]) -> tauri::Result<()> {
    let owner = owner_of(app_id);
    let mut args = vec!["ondura".to_string(), "--app".into(), app_id.to_string()];
    args.extend(extra.iter().cloned());
    if instance::send(owner, &instance::Message::Open { args }) {
        return Ok(());
    }
    let mut cmd = app_command(app_id);
    cmd.args(extra);
    cmd.spawn()?;
    Ok(())
}

/// A launch through the program of a different app (a file association of
/// `ondura`, an old shortcut with `--app`): passed on to the right program
/// if it is installed or running. `false`: this process shows it itself.
pub fn hand_over(owner: &str, args: &[String]) -> bool {
    if instance::send(owner, &instance::Message::Open { args: args.to_vec() }) {
        return true;
    }
    if std::env::var_os("APPIMAGE").is_some() {
        return false;
    }
    let Some(program) = app_program(owner) else { return false };
    std::process::Command::new(program).args(args.iter().skip(1)).spawn().is_ok()
}

/// Ids of the other apps of the suite that are running right now.
pub fn others_running() -> Vec<&'static str> {
    if !per_app() {
        return Vec::new();
    }
    let own = process_app();
    APPS.iter().map(|(id, _)| *id).filter(|id| *id != own && instance::running(id)).collect()
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
        "drawio" => Some("diagram"),
        "ondform" => Some("forms"),
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
    /// `--new`: a new, empty document window of an office app.
    pub new_doc: bool,
    /// The command line names an app, a document or a link (otherwise the
    /// program decides: `ondura-text` opens Text).
    pub explicit: bool,
}

/// `--app <id>` and/or a document path (file associations pass the path).
pub fn launch_from_args<S: AsRef<str>>(args: &[S]) -> Launch {
    // Registered as `--mailto "%1"`; a bare `mailto:` argument works too.
    let mailto = args.iter().skip(1).map(AsRef::as_ref).find(|a| a.len() > 7 && a[..7].eq_ignore_ascii_case("mailto:")).map(String::from);
    if mailto.is_some() {
        return Launch { app: "mail".into(), file: None, mailto, new_doc: false, explicit: true };
    }
    let new_doc = args.iter().any(|a| a.as_ref() == "--new");
    let file = args.iter().skip(1).map(AsRef::as_ref).find(|a| !a.starts_with("--") && app_for_file(a).is_some()).map(String::from);
    match file {
        Some(f) => Launch { app: app_for_file(&f).unwrap_or("home").to_string(), file: Some(f), mailto: None, new_doc: false, explicit: true },
        None => {
            let explicit = args.iter().any(|a| a.as_ref() == "--app" || a.as_ref().starts_with("--app="));
            Launch { app: app_from_args(args), file: None, mailto: None, new_doc, explicit }
        }
    }
}

pub fn open_launch(app: &AppHandle, launch: &Launch) -> tauri::Result<()> {
    if let Some(link) = &launch.mailto {
        return open_mailto(app, link);
    }
    match &launch.file {
        Some(f) => open_document_window(app, &launch.app, Some(f)),
        None if launch.new_doc => open_document_window(app, &launch.app, None),
        None => open_app_window(app, &launch.app),
    }
}

/// A new message from a `mailto:` link in the Ondura Mail window: handed to
/// the open window as an event, or to a new one at start-up.
fn open_mailto(app: &AppHandle, link: &str) -> tauri::Result<()> {
    if !is_own("mail") {
        return open_elsewhere("mail", &["--mailto".into(), link.into()]);
    }
    if app.get_webview_window("mail").is_some() {
        let _ = app.emit_to("mail", "mail-module", "mail");
        let _ = app.emit_to("mail", "mailto", link);
        return open_app_window(app, "mail");
    }
    let extra = format!("window.__ONDURA_MAILTO__ = {};", serde_json::to_string(link).unwrap());
    open_app_window_with(app, "mail", &extra)
}

/// Office apps open one window per document. The first window
/// of an app uses the app id as label, further ones `<app>-<n>`.
pub fn open_document_window(app: &AppHandle, app_id: &str, file: Option<&str>) -> tauri::Result<()> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(2);
    let Some((id, title)) = APPS.iter().find(|(id, _)| *id == app_id && installed(id)) else {
        return open_app_window(app, "home");
    };
    if !is_own(id) {
        let extra = match file {
            Some(f) => vec![f.to_string()],
            None => vec!["--new".to_string()],
        };
        return open_elsewhere(id, &extra);
    }
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
    watch_dropped_files(&window);
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
    watch_dropped_files(&window);
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
    if !is_own(id) {
        // Calendar etc.: the module, not just Ondura Mail.
        return open_elsewhere(module.unwrap_or(id), &[]);
    }
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
    watch_dropped_files(&window);
    set_app_identity(&window, id, title);
    Ok(())
}

/// Window frame: the frontend draws its own title bar
/// (src/shell/SuiteHeader.tsx). On macOS the system's traffic lights stay,
/// drawn over that title bar.
fn chrome<'a>(builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    // The apps use HTML drag and drop (mail onto folders, cards, slides,
    // files into the window); Tauri's own handler would swallow it on
    // Windows.
    let builder = builder.disable_drag_drop_handler();
    #[cfg(target_os = "macos")]
    return builder.decorations(true).title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(tauri::LogicalPosition::new(14.0, 20.0));
    #[cfg(not(target_os = "macos"))]
    builder.decorations(false).shadow(true)
}

/// Paths of files dropped from the file manager (Windows). The web page
/// only gets their content; it hands the `File` objects to the host with
/// `chrome.webview.postMessageWithAdditionalObjects({ ondura: "drop", id }, files)`
/// and gets the paths back as event `ondura-dropped-paths` (see
/// src/shell/fileDrop.tsx). Linux and macOS give the page `file://` URIs.
#[cfg(windows)]
fn watch_dropped_files(window: &tauri::WebviewWindow) {
    let handle = window.app_handle().clone();
    let label = window.label().to_string();
    let result = window.with_webview(move |pw| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
        use webview2_com::{WebMessageReceivedEventHandler, take_pwstr};
        use windows::core::{Interface, PWSTR};
        // SAFETY: COM calls on the webview's own thread, where with_webview
        // runs and the handler is called.
        unsafe {
            let Ok(core) = pw.controller().CoreWebView2() else { return };
            let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                // Tauri's own messages are strings; ours is a JSON object.
                let mut json = PWSTR::null();
                args.WebMessageAsJson(&mut json)?;
                let Ok(msg) = serde_json::from_str::<serde_json::Value>(&take_pwstr(json)) else { return Ok(()) };
                if msg["ondura"] != "drop" {
                    return Ok(());
                }
                let mut paths = Vec::new();
                if let Ok(objects) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>().and_then(|a| a.AdditionalObjects()) {
                    let mut count = 0u32;
                    objects.Count(&mut count)?;
                    for i in 0..count {
                        if let Ok(file) = objects.GetValueAtIndex(i).and_then(|o| o.cast::<ICoreWebView2File>()) {
                            let mut path = PWSTR::null();
                            if file.Path(&mut path).is_ok() {
                                paths.push(take_pwstr(path));
                            }
                        }
                    }
                }
                let _ = handle.emit_to(label.as_str(), "ondura-dropped-paths", serde_json::json!({ "id": msg["id"], "paths": paths }));
                Ok(())
            }));
            let mut token = 0i64;
            if let Err(e) = core.add_WebMessageReceived(&handler, &mut token) {
                tracing::warn!(error = %e, "dropped files: no message handler");
            }
        }
    });
    if let Err(e) = result {
        tracing::warn!(error = %e, "dropped files: no webview");
    }
}

#[cfg(not(windows))]
fn watch_dropped_files(_window: &tauri::WebviewWindow) {}

/// Opens files (dropped onto a window) each in its app; returns the names
/// of those no app opens.
pub fn open_files(app: &AppHandle, paths: &[String]) -> Vec<String> {
    let mut unknown = Vec::new();
    for path in paths {
        match app_for_file(path) {
            Some(id) => {
                if let Err(e) = open_document_window(app, id, Some(path)) {
                    tracing::warn!(error = %e, path, "could not open dropped file");
                }
            }
            None => unknown.push(std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone())),
        }
    }
    unknown
}

/// AppUserModelID of an app: Windows groups taskbar buttons by it (and by
/// the shortcuts, which carry the same id, windows/installer-hooks.nsh).
#[cfg(windows)]
pub fn app_user_model_id(app_id: &str) -> String {
    if app_id == "home" { "de.mirranet.ondura".into() } else { format!("de.mirranet.ondura.{app_id}") }
}

/// Window icon of the app (the process icon is that of its program; on
/// macOS and in development all apps share one).
fn app_icon(app_id: &str) -> Option<tauri::image::Image<'static>> {
    let bytes: &[u8] = match app_id {
        "mail" => include_bytes!("../icons/apps/mail.png"),
        "text" => include_bytes!("../icons/apps/text.png"),
        "sheets" => include_bytes!("../icons/apps/sheets.png"),
        "slides" => include_bytes!("../icons/apps/slides.png"),
        "pdf" => include_bytes!("../icons/apps/pdf.png"),
        "notes" => include_bytes!("../icons/apps/notes.png"),
        "planner" => include_bytes!("../icons/apps/planner.png"),
        "diagram" => include_bytes!("../icons/apps/diagram.png"),
        "forms" => include_bytes!("../icons/apps/forms.png"),
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
    // Pinned buttons start the app's own program.
    let program = app_program(app_id).unwrap_or_else(|| exe.clone());
    // SAFETY: plain COM calls on a window handle that belongs to us.
    unsafe {
        let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd) else { return };
        let set = |key, value: &str| {
            let _ = store.SetValue(&key, &PROPVARIANT::from(value));
        };
        if app_id != "home" {
            set(PKEY_AppUserModel_RelaunchCommand, &format!("\"{}\" --app {app_id}", program.display()));
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
    fn program_name_decides_without_arguments() {
        use super::resolve_launch;
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(resolve_launch(&v(&["./ondura-text"])).app, "text");
        assert_eq!(resolve_launch(&v(&[r"C:\Program Files\Ondura\ONDURA-MAIL.exe"])).app, "mail");
        assert_eq!(resolve_launch(&v(&["ondura-text", "--app", "sheets"])).app, "sheets");
        assert_eq!(resolve_launch(&v(&["ondura-text", "/x/a.pdf"])).app, "pdf");
        assert_eq!(resolve_launch(&v(&["ondura"])).app, "home");
    }

    #[test]
    fn programs_and_owners() {
        use super::{app_of_program, owner_of, program_name};
        assert_eq!(app_of_program("ondura"), Some("home"));
        assert_eq!(app_of_program("ondura-text"), Some("text"));
        assert_eq!(app_of_program("ondura-calendar"), None);
        assert_eq!(app_of_program("ondura-update-1"), None);
        assert_eq!(program_name("home"), "ondura");
        assert_eq!(program_name("sheets"), "ondura-sheets");
        if super::per_app() {
            assert_eq!(owner_of("calendar"), "mail");
            assert_eq!(owner_of("message"), "mail");
            assert_eq!(owner_of("text"), "text");
            assert_eq!(owner_of("nonsense"), "home");
        }
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
        assert_eq!(launch_from_args(&["ondura", r"C:\Docs\Brief.DOCX"]), Launch { app: "text".into(), file: Some(r"C:\Docs\Brief.DOCX".into()), mailto: None, new_doc: false, explicit: true });
        assert_eq!(launch_from_args(&["ondura", "/home/n/zahlen.xlsx"]).app, "sheets");
        assert_eq!(launch_from_args(&["ondura", "/home/n/brief.odt"]).app, "text");
        assert_eq!(launch_from_args(&["ondura", "/home/n/zahlen.ods"]).app, "sheets");
        assert_eq!(launch_from_args(&["ondura", "/home/n/vortrag.odp"]).app, "slides");
        assert_eq!(launch_from_args(&["ondura", r"C:\Scans\Vertrag.PDF"]).app, "pdf");
        assert_eq!(launch_from_args(&["ondura", "/home/a/Netz.drawio"]).app, "diagram");
        assert_eq!(launch_from_args(&["ondura", "Umfrage.ondform"]).app, "forms");
        assert_eq!(launch_from_args(&["ondura", "--app", "mail"]), Launch { app: "mail".into(), file: None, mailto: None, new_doc: false, explicit: true });
        assert!(!launch_from_args(&["ondura-text"]).explicit);
        assert!(launch_from_args(&["ondura-text", "--app", "text", "--new"]).new_doc);
        let l = launch_from_args(&["ondura", "--mailto", "MAILTO:a@x.de?subject=Hi"]);
        assert_eq!((l.app.as_str(), l.mailto.as_deref()), ("mail", Some("MAILTO:a@x.de?subject=Hi")));
    }
}
