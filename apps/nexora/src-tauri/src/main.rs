// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod pim_commands;
mod secrets;
mod state;
mod windows;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use nexora_mail_core::{SecretStore, Store, SyncEngine, SyncEvent};
use nexora_pim_core::{PimEngine, PimEvent, PimStore};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;
use tracing::{error, info, warn};

use crate::secrets::{FileSecretStore, KeyringSecretStore, LayeredSecretStore};
use crate::state::AppState;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,nexora=debug".into()))
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let app_id = windows::app_from_args(&args);
            if let Err(e) = windows::open_app_window(app, &app_id) {
                error!(error = %e, "could not open window");
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = data_dir().ok_or("no home directory")?;
            let db = data_dir.join("mail.sqlite");
            info!(path = %db.display(), "opening mail store");

            let keyring_available = KeyringSecretStore::works();
            if !keyring_available {
                warn!("no OS credential store available, using file fallback");
            }
            let secrets: Arc<dyn SecretStore> = Arc::new(LayeredSecretStore {
                keyring: keyring_available.then_some(KeyringSecretStore),
                file: FileSecretStore::open(data_dir.join("secrets.json")),
            });

            let store = Arc::new(Store::open(&db)?);
            let engine = SyncEngine::new(Arc::clone(&store));
            let pim = PimEngine::new(Arc::new(PimStore::open(data_dir.join("pim.sqlite"))?))?;
            app.manage(AppState { engine: Arc::clone(&engine), pim, secrets, keyring_available, quitting: AtomicBool::new(false) });

            // Accounts, background sync and the event bridge need the async runtime.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                for account in state.store().list_accounts().unwrap_or_default() {
                    if let Err(e) = state.activate(&account) {
                        error!(account = %account.email, error = %e, "could not activate account");
                    }
                }
                state.engine.start();
                state.pim.start();
                tauri::async_runtime::spawn(forward_pim_events(handle.clone(), state.pim.subscribe()));
                forward_events(handle.clone(), state.engine.subscribe()).await;
            });

            if let Err(e) = build_tray(app.handle()) {
                warn!(error = %e, "tray icon unavailable");
            }

            let args: Vec<String> = std::env::args().collect();
            windows::open_app_window(app.handle(), &windows::app_from_args(&args))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::list_all_accounts,
            commands::add_dav_account,
            commands::has_builtin_graph_client_id,
            commands::add_imap_account,
            commands::add_graph_account,
            commands::add_ews_account,
            commands::update_account,
            commands::update_password,
            commands::reauth_graph,
            commands::account_statuses,
            commands::remove_account,
            commands::list_folders,
            commands::list_messages,
            commands::load_older,
            commands::search_messages,
            commands::search_server,
            commands::attachment_text,
            commands::conversation,
            commands::thread_counts,
            commands::set_categories,
            commands::categories,
            commands::rules,
            commands::save_rules,
            commands::get_message,
            commands::open_attachment,
            commands::set_read,
            commands::set_flagged,
            commands::move_message,
            commands::delete_message,
            commands::archive_message,
            commands::send_message,
            commands::save_draft,
            commands::outbox,
            commands::retry_pending,
            commands::discard_pending,
            commands::sync_account,
            commands::sync_folder,
            commands::get_settings,
            commands::save_settings,
            commands::open_external,
            commands::open_app,
            pim_commands::pim_collections,
            pim_commands::pim_set_visible,
            pim_commands::pim_set_color,
            pim_commands::pim_create_collection,
            pim_commands::pim_delete_collection,
            pim_commands::pim_sync,
            pim_commands::pim_events,
            pim_commands::pim_search_events,
            pim_commands::pim_create_event,
            pim_commands::pim_update_event,
            pim_commands::pim_move_event,
            pim_commands::pim_delete_event,
            pim_commands::pim_respond_event,
            pim_commands::pim_free_busy,
            pim_commands::pim_import_ics,
            pim_commands::pim_invitation_ics,
            pim_commands::pim_export_contacts,
            pim_commands::pim_contacts,
            pim_commands::pim_save_contact,
            pim_commands::pim_delete_contact,
            pim_commands::pim_import_contacts,
            pim_commands::pim_suggest,
            pim_commands::pim_tasks,
            pim_commands::pim_save_task,
            pim_commands::pim_delete_task,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nexora");

    app.run(|handle, event| {
        // Closing the last window keeps the app in the tray (setting
        // "run in background"), so new mail still arrives.
        if let RunEvent::ExitRequested { api, code: None, .. } = event
            && let Some(state) = handle.try_state::<AppState>()
            && !state.quitting.load(Ordering::SeqCst)
            && state.settings().run_in_background
        {
            api.prevent_exit();
        }
    });
}

/// Relay engine events to all windows and show desktop notifications.
async fn forward_events(handle: AppHandle, mut events: tokio::sync::broadcast::Receiver<SyncEvent>) {
    loop {
        match events.recv().await {
            Ok(event) => {
                if let SyncEvent::NewMail { from, subject, count, .. } = &event
                    && handle.state::<AppState>().settings().notifications
                {
                    let title = if *count > 1 { format!("{count} neue E-Mails") } else { format!("Neue E-Mail von {from}") };
                    let _ = handle.notification().builder().title(title).body(subject).show();
                }
                let _ = handle.emit("mail-sync", event);
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => break,
        }
    }
}

/// Calendar/contacts/tasks events to all windows; reminders as notifications.
async fn forward_pim_events(handle: AppHandle, mut events: tokio::sync::broadcast::Receiver<PimEvent>) {
    loop {
        match events.recv().await {
            Ok(event) => {
                if let PimEvent::Reminder { title, start, location, all_day, .. } = &event
                    && handle.state::<AppState>().settings().notifications
                {
                    let when = if *all_day {
                        "Heute (ganztägig)".to_string()
                    } else {
                        start.with_timezone(&chrono::Local).format("%H:%M Uhr").to_string()
                    };
                    let body = if location.is_empty() { when } else { format!("{when} · {location}") };
                    let _ = handle.notification().builder().title(title).body(body).show();
                }
                if let PimEvent::TaskReminder { title, due, .. } = &event
                    && handle.state::<AppState>().settings().notifications
                {
                    let body = due.map(|d| format!("Aufgabe · fällig am {}", d.format("%d.%m.%Y"))).unwrap_or_else(|| "Aufgabe".into());
                    let _ = handle.notification().builder().title(title).body(body).show();
                }
                let _ = handle.emit("pim-sync", event);
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => break,
        }
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_mail = MenuItem::with_id(app, "mail", "Orbit öffnen", true, None::<&str>)?;
    let open_calendar = MenuItem::with_id(app, "calendar", "Kalender", true, None::<&str>)?;
    let open_contacts = MenuItem::with_id(app, "contacts", "Kontakte", true, None::<&str>)?;
    let open_tasks = MenuItem::with_id(app, "tasks", "Aufgaben", true, None::<&str>)?;
    let open_home = MenuItem::with_id(app, "home", "Nexora", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_mail, &open_calendar, &open_contacts, &open_tasks, &open_home, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id("nexora")
        .tooltip("Nexora")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.state::<AppState>().quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            id => {
                let _ = windows::open_app_window(app, id);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = windows::open_app_window(tray.app_handle(), "mail");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Data directory of the suite. Installations from before the rename
/// ("Mirra Office") are moved over on first start so accounts, mail cache and
/// calendars stay intact.
fn data_dir() -> Option<std::path::PathBuf> {
    let new = directories::ProjectDirs::from("de", "MirraNET", "Nexora")?.data_dir().to_path_buf();
    if !new.exists()
        && let Some(old) = directories::ProjectDirs::from("de", "MirraNET", "Mirra Office").map(|d| d.data_dir().to_path_buf())
        && old.join("mail.sqlite").exists()
    {
        if let Some(parent) = new.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::rename(&old, &new) {
            Ok(()) => info!(from = %old.display(), to = %new.display(), "migrated data directory"),
            Err(e) => {
                warn!(error = %e, "could not move the old data directory, keep using it");
                return Some(old);
            }
        }
    }
    std::fs::create_dir_all(&new).ok()?;
    Some(new)
}
