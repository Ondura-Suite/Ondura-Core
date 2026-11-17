// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod secrets;
mod state;
mod windows;

use std::sync::Arc;
use std::time::Duration;

use mirra_mail_core::{SecretStore, Store, SyncEngine};
use tauri::{Emitter, Manager};
use tracing::{error, info};

use crate::state::AppState;

/// How often all accounts are synchronised in the background.
const SYNC_INTERVAL: Duration = Duration::from_secs(120);

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,mirra=debug".into()))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let app_id = windows::app_from_args(&args);
            if let Err(e) = windows::open_app_window(app, &app_id) {
                error!(error = %e, "could not open window");
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dirs = directories::ProjectDirs::from("de", "MirraNET", "Mirra Office").ok_or("no home directory")?;
            std::fs::create_dir_all(dirs.data_dir())?;
            let db = dirs.data_dir().join("mail.sqlite");
            info!(path = %db.display(), "opening mail store");

            let store = Arc::new(Store::open(&db)?);
            let engine = SyncEngine::new(Arc::clone(&store));
            let secrets: Arc<dyn SecretStore> = Arc::new(secrets::KeyringSecretStore);
            let state = AppState { engine: Arc::clone(&engine), secrets };

            for account in store.list_accounts()? {
                if let Err(e) = state.activate(&account) {
                    error!(account = %account.email, error = %e, "could not activate account");
                }
            }
            app.manage(state);

            // Forward sync events to all windows.
            let handle = app.handle().clone();
            let mut events = engine.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            let _ = handle.emit("mail-sync", event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
            tauri::async_runtime::spawn(async move {
                engine.spawn_periodic(SYNC_INTERVAL);
            });

            let args: Vec<String> = std::env::args().collect();
            windows::open_app_window(app.handle(), &windows::app_from_args(&args))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::default_graph_client_id,
            commands::add_imap_account,
            commands::add_graph_account,
            commands::remove_account,
            commands::list_folders,
            commands::list_messages,
            commands::search_messages,
            commands::get_message,
            commands::open_attachment,
            commands::set_read,
            commands::set_flagged,
            commands::move_message,
            commands::delete_message,
            commands::archive_message,
            commands::send_message,
            commands::sync_account,
            commands::sync_folder,
            commands::open_external,
            commands::open_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mirra Office");
}
