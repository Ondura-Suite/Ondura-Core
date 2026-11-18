// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod office;
mod pdf;
mod cloud;
mod legal;
mod commands;
mod pim_commands;
mod secrets;
mod smime;
mod state;
mod update;
mod update_helper;
mod windows;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use ondura_mail_core::{SecretStore, Store, SyncEngine, SyncEvent};
use ondura_pim_core::{PimEngine, PimEvent, PimStore};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;
use tracing::{error, info, warn};

use crate::secrets::{FileSecretStore, KeyringSecretStore, LayeredSecretStore};
use crate::state::AppState;

/// Quit Ondura for real (closing windows only hides to the tray otherwise).
pub(crate) fn request_quit(app: &AppHandle) {
    app.state::<AppState>().quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn main() {
    // Privileged update helpers (see update_helper.rs) run without any UI.
    #[cfg(windows)]
    if std::env::args().any(|a| a == "--update-service") {
        update_helper::run_service();
        return;
    }
    #[cfg(target_os = "linux")]
    if std::env::args().any(|a| a == "--apply-update") {
        std::process::exit(update_helper::apply_linux_requests());
    }
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,ondura=debug".into()))
        .init();
    migrate_webview_profile();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Err(e) = windows::open_launch(app, &windows::launch_from_args(&args)) {
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
            // Language of the last session until a window reports its own.
            if let Some(l) = store.setting("ui.language").ok().flatten().and_then(|c| ondura_i18n::Lang::parse(&c)) {
                ondura_i18n::set_language(l);
            }
            ondura_mail_core::net::set_trusted_certificates(commands::load_trusted(&store));
            let engine = SyncEngine::new(Arc::clone(&store));
            let pim = PimEngine::new(Arc::new(PimStore::open(data_dir.join("pim.sqlite"))?))?;
            smime::load(&store, secrets.as_ref());
            cloud::init(Arc::clone(&store), Arc::clone(&secrets));
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

            // Installs with the office apps only have no mail tray icon.
            if windows::installed("mail")
                && let Err(e) = build_tray(app.handle())
            {
                warn!(error = %e, "tray icon unavailable");
            }

            let args: Vec<String> = std::env::args().collect();
            windows::open_launch(app.handle(), &windows::launch_from_args(&args))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update::update_check,
            update::update_download,
            update::update_install,
            set_language,
            legal::legal_text,
            commands::list_accounts,
            commands::list_all_accounts,
            commands::add_dav_account,
            commands::has_builtin_graph_client_id,
            commands::add_imap_account,
            commands::add_graph_account,
            commands::add_shared_mailbox,
            commands::get_auto_reply,
            smime::smime_identities,
            cloud::cloud_accounts,
            cloud::cloud_sign_in,
            cloud::cloud_sign_out,
            cloud::cloud_locations,
            cloud::cloud_list,
            cloud::cloud_recent,
            cloud::cloud_shared,
            cloud::cloud_search,
            cloud::cloud_create_folder,
            cloud::cloud_reserve,
            cloud::cloud_info,
            cloud::cloud_share,
            smime::smime_import,
            smime::smime_remove,
            smime::smime_trust,
            smime::smime_missing,
            smime::smime_can_sign,
            commands::set_auto_reply,
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
            commands::installed_apps,
            office::open_document,
            office::read_text_file,
            office::save_bytes,
            office::text_open,
            office::text_save,
            office::sheets_open,
            office::sheets_save,
            office::slides_open,
            office::slides_save,
            pdf::export_pdf,
            commands::probe_certificate,
            commands::trusted_certificates,
            commands::set_certificate_trust,
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
            pim_commands::pim_rooms,
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
        .expect("error while building Ondura");

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
                    let title = if *count > 1 { format!("{count} neue E-Mails") } else { ondura_i18n::tr!("Neue E-Mail von {0}", from) };
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
                        ondura_i18n::tr!("Heute (ganztägig)").to_string()
                    } else {
                        start.with_timezone(&chrono::Local).format("%H:%M Uhr").to_string()
                    };
                    let body = if location.is_empty() { when } else { format!("{when} · {location}") };
                    let _ = handle.notification().builder().title(title).body(body).show();
                }
                if let PimEvent::TaskReminder { title, due, .. } = &event
                    && handle.state::<AppState>().settings().notifications
                {
                    let body = due.map(|d| ondura_i18n::tr!("Aufgabe · fällig am {0}", d.format("%d.%m.%Y"))).unwrap_or_else(|| "Aufgabe".into());
                    let _ = handle.notification().builder().title(title).body(body).show();
                }
                let _ = handle.emit("pim-sync", event);
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => break,
        }
    }
}

/// Tray menu in the current language (rebuilt when the language changes).
fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use ondura_i18n::tr;
    let open_mail = MenuItem::with_id(app, "mail", tr!("Ondura Mail öffnen"), true, None::<&str>)?;
    let open_calendar = MenuItem::with_id(app, "calendar", tr!("Kalender"), true, None::<&str>)?;
    let open_contacts = MenuItem::with_id(app, "contacts", tr!("Kontakte"), true, None::<&str>)?;
    let open_tasks = MenuItem::with_id(app, "tasks", tr!("Aufgaben"), true, None::<&str>)?;
    let open_home = MenuItem::with_id(app, "home", "Ondura", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", tr!("Beenden"), true, None::<&str>)?;
    Menu::with_items(app, &[&open_mail, &open_calendar, &open_contacts, &open_tasks, &open_home, &separator, &quit])
}

/// Sets the language of backend messages (called by every window with its
/// UI language) and stores it for the next start.
#[tauri::command]
fn set_language(app: AppHandle, state: tauri::State<'_, AppState>, lang: String) {
    let Some(l) = ondura_i18n::Lang::parse(&lang) else { return };
    if ondura_i18n::language() == l && state.store().setting("ui.language").ok().flatten().as_deref() == Some(l.code()) {
        return;
    }
    ondura_i18n::set_language(l);
    let _ = state.store().set_setting("ui.language", l.code());
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("ondura"), tray_menu(&app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;
    let mut tray = TrayIconBuilder::with_id("ondura")
        .tooltip("Ondura")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => request_quit(app),
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

/// Data directory of the suite.
fn data_dir() -> Option<std::path::PathBuf> {
    let dir = directories::ProjectDirs::from("de", "MirraNET", "Ondura")?.data_dir().to_path_buf();
    // Installations from before the rename ("Nexora") keep their accounts,
    // mail cache and calendars.
    if let Some(old) = directories::ProjectDirs::from("de", "MirraNET", "Nexora") {
        migrate_dir(old.data_dir(), &dir);
    }
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Moves the web view profile (settings kept in local storage) of the
/// pre-rename identifier. Must run before the first window is created.
fn migrate_webview_profile() {
    if let Some(base) = directories::BaseDirs::new() {
        let root = base.data_local_dir();
        migrate_dir(&root.join("de.mirranet.nexora"), &root.join("de.mirranet.ondura"));
    }
}

/// Renames `old` to `new` if only the old directory exists.
fn migrate_dir(old: &std::path::Path, new: &std::path::Path) {
    if new.exists() || !old.exists() {
        return;
    }
    if let Some(parent) = new.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::rename(old, new) {
        Ok(()) => info!(from = %old.display(), to = %new.display(), "migrated directory"),
        Err(e) => warn!(error = %e, from = %old.display(), "could not migrate directory"),
    }
}
