//! macOS integration: the menu bar (with the Edit menu that makes ⌘C/⌘V
//! work in the webview), documents opened from Finder and the Dock.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use tauri::AppHandle;

/// Menu bar of the app; item ids contain ':' so the tray handler ignores them.
#[cfg(target_os = "macos")]
pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    use ondura_i18n::tr;
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = AboutMetadata {
        name: Some("Ondura".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        copyright: Some("© 2026 Niklas Linz (MirraNET)".into()),
        website: Some("https://ondura.mirranet.de".into()),
        license: Some("GPL-3.0-or-later".into()),
        ..Default::default()
    };
    let sep = || PredefinedMenuItem::separator(app);
    let item = |id: &str, text: String, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);

    let app_menu = Submenu::with_items(
        app,
        "Ondura",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&tr!("Über Ondura")), Some(about))?,
            &item("app:update", tr!("Nach Updates suchen …"), None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &item("app:quit", tr!("Ondura beenden"), Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        tr!("Ablage"),
        true,
        &[
            &item("app:home", tr!("Startseite"), Some("CmdOrCtrl+Shift+H"))?,
            &sep()?,
            &item("app:mail", tr!("Ondura Mail"), None)?,
            &item("app:text", tr!("Neues Dokument"), None)?,
            &item("app:sheets", tr!("Neue Arbeitsmappe"), None)?,
            &item("app:slides", tr!("Neue Präsentation"), None)?,
            &item("app:pdf", tr!("Ondura PDF"), None)?,
            &item("app:notes", tr!("Ondura Notizen"), None)?,
            &item("app:planner", tr!("Ondura Planer"), None)?,
            &item("app:diagram", tr!("Neues Diagramm"), None)?,
            &item("app:forms", tr!("Neues Formular"), None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        tr!("Bearbeiten"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        tr!("Fenster"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(app, tr!("Hilfe"), true, &[&item("app:website", tr!("Hilfe und Website"), None)?])?;
    let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &window, &help])?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let Some(id) = event.id.as_ref().strip_prefix("app:") else { return };
        match id {
            "quit" => crate::request_quit(app),
            "website" => {
                let _ = tauri_plugin_opener::OpenerExt::opener(app).open_url("https://ondura.mirranet.de", None::<&str>);
            }
            "update" => {
                let _ = tauri::Emitter::emit(app, "check-updates", ());
            }
            "home" | "mail" => {
                let _ = crate::windows::open_app_window(app, id);
            }
            app_id => {
                let _ = crate::windows::open_document_window(app, app_id, None);
            }
        }
    });
    Ok(())
}

/// Files opened from Finder (double-click, "Open with", Dock drop).
pub fn open_urls(app: &AppHandle, urls: &[tauri::Url]) {
    for url in urls {
        let Ok(path) = url.to_file_path() else { continue };
        let path = path.display().to_string();
        let launch = crate::windows::launch_from_args(&["ondura", path.as_str()]);
        if let Err(e) = crate::windows::open_launch(app, &launch) {
            tracing::error!(error = %e, "could not open {path}");
        }
    }
}
