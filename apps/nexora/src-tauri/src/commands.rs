//! Tauri commands called from the frontend (see `src/lib/api.ts`).

use std::path::PathBuf;
use std::sync::Arc;

use nexora_mail_core::OutboxItem;
use nexora_mail_core::model::*;
use nexora_mail_core::secrets::{password_key, refresh_token_key};
use nexora_mail_ews::EwsProvider;
use nexora_mail_graph::GraphProvider;
use nexora_mail_imap::ImapProvider;
use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::state::{AppSettings, AppState};
use crate::windows;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Client id of the Entra ID app registration, injected at build time
/// (`NEXORA_GRAPH_CLIENT_ID=... cargo tauri build`).
const DEFAULT_GRAPH_CLIENT_ID: Option<&str> = option_env!("NEXORA_GRAPH_CLIENT_ID");

const ACCOUNT_COLORS: [&str; 6] = ["#4f54d4", "#107c41", "#c239b3", "#ca5010", "#0e7a8a", "#6b4fbb"];

fn next_color(state: &AppState) -> String {
    let n = state.store().list_accounts().map(|a| a.len()).unwrap_or(0);
    ACCOUNT_COLORS[n % ACCOUNT_COLORS.len()].to_string()
}

// ------------------------------------------------------------------ accounts

/// Mail accounts (Orbit).
#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
    Ok(state.store().list_accounts().map_err(err)?.into_iter().filter(Account::has_mail).collect())
}

/// All accounts incl. calendar/contacts-only ones.
#[tauri::command]
pub fn list_all_accounts(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
    state.store().list_accounts().map_err(err)
}

#[tauri::command]
pub fn default_graph_client_id() -> Option<&'static str> {
    DEFAULT_GRAPH_CLIENT_ID.filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewImapAccount {
    display_name: String,
    email: String,
    password: String,
    config: ImapConfig,
}

#[tauri::command]
pub async fn add_imap_account(state: State<'_, AppState>, input: NewImapAccount) -> CmdResult<Account> {
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        display_name: input.display_name.trim().to_string(),
        email: input.email.trim().to_string(),
        kind: AccountKind::Imap(input.config.clone()),
        color: Some(next_color(&state)),
        signature: None,
        dav: None,
    };
    // Verify the credentials before saving anything.
    let provider = ImapProvider::new(input.config, Address::new(Some(account.display_name.clone()), &account.email), input.password.clone());
    provider.test_login().await.map_err(|e| format!("Anmeldung am IMAP-Server fehlgeschlagen: {e}"))?;

    drop(provider);
    state.secrets.set(&password_key(&account.id), &input.password).map_err(err)?;
    state.store().upsert_account(&account).map_err(err)?;
    state.activate(&account).map_err(err)?;
    Ok(account)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEwsAccount {
    display_name: String,
    email: String,
    password: String,
    config: EwsConfig,
}

/// Exchange Server (on-premises) via EWS.
#[tauri::command]
pub async fn add_ews_account(state: State<'_, AppState>, input: NewEwsAccount) -> CmdResult<Account> {
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        display_name: input.display_name.trim().to_string(),
        email: input.email.trim().to_string(),
        kind: AccountKind::Ews(input.config.clone()),
        color: Some(next_color(&state)),
        signature: None,
        dav: None,
    };
    let provider = EwsProvider::new(input.config, Address::new(Some(account.display_name.clone()), &account.email), input.password.clone());
    provider.test_login().await.map_err(|e| format!("Verbindung zum Exchange-Server fehlgeschlagen: {e}"))?;
    state.secrets.set(&password_key(&account.id), &input.password).map_err(err)?;
    state.store().upsert_account(&account).map_err(err)?;
    state.activate(&account).map_err(err)?;
    Ok(account)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGraphAccount {
    tenant: String,
    client_id: String,
}

#[tauri::command]
pub async fn add_graph_account(app: AppHandle, state: State<'_, AppState>, input: NewGraphAccount) -> CmdResult<Account> {
    let id = uuid::Uuid::new_v4().to_string();
    let http = nexora_mail_graph::http_client();
    let opener = app.clone();
    let token = nexora_mail_graph::login_interactive(&http, &input.tenant, &input.client_id, move |url| {
        opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Microsoft-Anmeldung fehlgeschlagen: {e}"))?;

    let provider = GraphProvider::new(input.tenant.clone(), input.client_id.clone(), Arc::clone(&state.secrets), refresh_token_key(&id));
    provider.tokens().store(&token).await.map_err(err)?;
    let me = provider.me().await.map_err(err)?;

    let account = Account {
        id,
        display_name: me.display_name.clone().unwrap_or_else(|| me.email()),
        email: me.email(),
        kind: AccountKind::Graph(GraphConfig { tenant: input.tenant, client_id: input.client_id }),
        color: Some(next_color(&state)),
        signature: None,
        dav: None,
    };
    drop(provider);
    state.store().upsert_account(&account).map_err(err)?;
    state.activate(&account).map_err(err)?;
    Ok(account)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDavAccount {
    display_name: String,
    email: String,
    password: String,
    url: String,
    #[serde(default)]
    username: String,
}

/// Calendars, contacts and tasks from a CalDAV/CardDAV server (e.g. Nextcloud).
#[tauri::command]
pub async fn add_dav_account(state: State<'_, AppState>, input: NewDavAccount) -> CmdResult<Account> {
    let cfg = DavConfig { url: input.url.trim().to_string(), username: input.username.trim().to_string() };
    let user = if cfg.username.is_empty() { input.email.trim().to_string() } else { cfg.username.clone() };
    let owner = Address::new(Some(input.display_name.clone()), input.email.trim());
    let backend = nexora_pim_dav::DavBackend::new(&cfg.url, &user, &input.password, owner).map_err(err)?;
    let found = backend.test().await.map_err(|e| format!("Verbindung zum CalDAV-/CardDAV-Server fehlgeschlagen: {e}"))?;
    if found == 0 {
        return Err("Auf dem Server wurden keine Kalender oder Adressbücher gefunden".into());
    }
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        display_name: input.display_name.trim().to_string(),
        email: input.email.trim().to_string(),
        kind: AccountKind::Dav(cfg),
        color: Some(next_color(&state)),
        signature: None,
        dav: None,
    };
    state.secrets.set(&password_key(&account.id), &input.password).map_err(err)?;
    state.store().upsert_account(&account).map_err(err)?;
    state.activate(&account).map_err(err)?;
    Ok(account)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUpdate {
    display_name: String,
    signature: Option<String>,
    color: Option<String>,
}

#[tauri::command]
pub fn update_account(state: State<'_, AppState>, account_id: String, update: AccountUpdate) -> CmdResult<Account> {
    let mut account = state.store().get_account(&account_id).map_err(err)?;
    let name_changed = account.display_name != update.display_name.trim();
    account.display_name = update.display_name.trim().to_string();
    account.signature = update.signature.filter(|s| !s.trim().is_empty());
    if update.color.is_some() {
        account.color = update.color;
    }
    state.store().upsert_account(&account).map_err(err)?;
    if name_changed {
        // The sender name is baked into the IMAP adapter.
        let _ = state.activate(&account);
    }
    Ok(account)
}

/// New password for an IMAP or Exchange account (after the server rejected the old one).
#[tauri::command]
pub async fn update_password(state: State<'_, AppState>, account_id: String, password: String) -> CmdResult<()> {
    let account = state.store().get_account(&account_id).map_err(err)?;
    let from = Address::new(Some(account.display_name.clone()), &account.email);
    let provider: Arc<dyn nexora_mail_core::MailProvider> = match &account.kind {
        AccountKind::Imap(cfg) => {
            let p = ImapProvider::new(cfg.clone(), from, password.clone());
            p.test_login().await.map_err(|e| format!("Anmeldung fehlgeschlagen: {e}"))?;
            p
        }
        AccountKind::Ews(cfg) => {
            let p = EwsProvider::new(cfg.clone(), from, password.clone());
            p.test_login().await.map_err(|e| format!("Anmeldung fehlgeschlagen: {e}"))?;
            p
        }
        AccountKind::Graph(_) => return Err("Microsoft-365-Konten melden sich im Browser an".into()),
        AccountKind::Dav(cfg) => {
            let user = if cfg.username.is_empty() { account.email.clone() } else { cfg.username.clone() };
            let backend = nexora_pim_dav::DavBackend::new(&cfg.url, &user, &password, from).map_err(err)?;
            backend.test().await.map_err(|e| format!("Anmeldung fehlgeschlagen: {e}"))?;
            state.secrets.set(&password_key(&account_id), &password).map_err(err)?;
            state.activate(&account).map_err(err)?;
            return Ok(());
        }
    };
    drop(provider);
    state.secrets.set(&password_key(&account_id), &password).map_err(err)?;
    state.activate(&account).map_err(err)?;
    state.engine.retry_pending(&account_id).map_err(err)?;
    sync_now(&state, account_id);
    Ok(())
}

/// Sign in to Microsoft again (expired or revoked refresh token).
#[tauri::command]
pub async fn reauth_graph(app: AppHandle, state: State<'_, AppState>, account_id: String) -> CmdResult<()> {
    let account = state.store().get_account(&account_id).map_err(err)?;
    let AccountKind::Graph(cfg) = &account.kind else {
        return Err("Nur für Microsoft-365-Konten".into());
    };
    let http = nexora_mail_graph::http_client();
    let opener = app.clone();
    let token = nexora_mail_graph::login_interactive(&http, &cfg.tenant, &cfg.client_id, move |url| {
        opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Microsoft-Anmeldung fehlgeschlagen: {e}"))?;
    let provider = GraphProvider::new(cfg.tenant.clone(), cfg.client_id.clone(), Arc::clone(&state.secrets), refresh_token_key(&account_id));
    provider.tokens().store(&token).await.map_err(err)?;
    drop(provider);
    state.activate(&account).map_err(err)?;
    state.engine.retry_pending(&account_id).map_err(err)?;
    sync_now(&state, account_id);
    Ok(())
}

#[tauri::command]
pub fn account_statuses(state: State<'_, AppState>) -> Vec<AccountStatus> {
    state.engine.statuses()
}

fn sync_now(state: &AppState, account_id: String) {
    let engine = Arc::clone(&state.engine);
    tauri::async_runtime::spawn(async move {
        let _ = engine.sync_account(&account_id).await;
    });
}

#[tauri::command]
pub fn remove_account(state: State<'_, AppState>, account_id: String) -> CmdResult<()> {
    state.engine.unregister(&account_id);
    state.pim.unregister(&account_id).map_err(err)?;
    let _ = state.secrets.delete(&password_key(&account_id));
    let _ = state.secrets.delete(&refresh_token_key(&account_id));
    state.store().delete_account(&account_id).map_err(err)
}

// ------------------------------------------------------------------ reading

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>, account_id: String) -> CmdResult<Vec<Folder>> {
    state.store().list_folders(&account_id).map_err(err)
}

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, folder_id: String, offset: u32, limit: u32) -> CmdResult<Vec<MessageSummary>> {
    state.store().list_messages(&folder_id, offset, limit.min(1000)).map_err(err)
}

#[tauri::command]
pub fn search_messages(state: State<'_, AppState>, query: String) -> CmdResult<Vec<MessageSummary>> {
    state.store().search(&query, None, 200).map_err(err)
}

/// Fetch older messages from the server; returns how many were added.
#[tauri::command]
pub async fn load_older(state: State<'_, AppState>, folder_id: String, limit: usize) -> CmdResult<usize> {
    state.engine.load_older(&folder_id, limit.clamp(1, 500)).await.map_err(err)
}

#[tauri::command]
pub async fn get_message(state: State<'_, AppState>, message_id: String) -> CmdResult<MessageDetail> {
    state.engine.get_message(&message_id).await.map_err(err)
}

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() { "Anhang".into() } else { cleaned }
}

/// Unused path in `dir` for `name` ("file (1).pdf" if "file.pdf" exists).
fn unique_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .expect("infinite iterator")
}

/// Save an attachment to the Downloads folder and open it with the default app.
#[tauri::command]
pub async fn open_attachment(app: AppHandle, state: State<'_, AppState>, message_id: String, attachment_id: String, file_name: String) -> CmdResult<String> {
    let bytes = state.engine.get_attachment(&message_id, &attachment_id).await.map_err(err)?;
    let dir = directories::UserDirs::new()
        .and_then(|d| d.download_dir().map(PathBuf::from))
        .or_else(|| directories::UserDirs::new().map(|d| d.home_dir().to_path_buf()))
        .ok_or("Kein Download-Ordner gefunden")?;
    let path = unique_path(&dir, &safe_file_name(&file_name));
    std::fs::write(&path, bytes).map_err(err)?;
    let path_str = path.to_string_lossy().into_owned();
    app.opener().open_path(&path_str, None::<&str>).map_err(err)?;
    Ok(path_str)
}

// ------------------------------------------------------------------ actions

#[tauri::command]
pub async fn set_read(state: State<'_, AppState>, message_id: String, read: bool) -> CmdResult<()> {
    state.engine.set_read(&message_id, read).await.map_err(err)
}

#[tauri::command]
pub async fn set_flagged(state: State<'_, AppState>, message_id: String, flagged: bool) -> CmdResult<()> {
    state.engine.set_flagged(&message_id, flagged).await.map_err(err)
}

#[tauri::command]
pub async fn move_message(state: State<'_, AppState>, message_id: String, target_folder_id: String) -> CmdResult<()> {
    state.engine.move_message(&message_id, &target_folder_id).await.map_err(err)
}

#[tauri::command]
pub async fn delete_message(state: State<'_, AppState>, message_id: String) -> CmdResult<()> {
    state.engine.delete_message(&message_id).await.map_err(err)
}

#[tauri::command]
pub async fn archive_message(state: State<'_, AppState>, message_id: String) -> CmdResult<()> {
    state.engine.archive_message(&message_id).await.map_err(err)
}

/// Queues the message; the result arrives as `messageSent` / `sendFailed`.
#[tauri::command]
pub async fn send_message(state: State<'_, AppState>, account_id: String, message: OutgoingMessage) -> CmdResult<()> {
    state.engine.send(&account_id, &message).await.map_err(err)
}

#[tauri::command]
pub async fn save_draft(state: State<'_, AppState>, account_id: String, message: OutgoingMessage) -> CmdResult<()> {
    state.engine.save_draft(&account_id, &message).await.map_err(err)
}

#[tauri::command]
pub fn outbox(state: State<'_, AppState>, account_id: String) -> CmdResult<Vec<OutboxItem>> {
    state.engine.outbox(&account_id).map_err(err)
}

#[tauri::command]
pub fn retry_pending(state: State<'_, AppState>, account_id: String) -> CmdResult<()> {
    state.engine.retry_pending(&account_id).map_err(err)
}

#[tauri::command]
pub fn discard_pending(state: State<'_, AppState>, account_id: String, op_id: i64) -> CmdResult<()> {
    state.engine.discard_op(&account_id, op_id).map_err(err)
}

/// Starts a sync in the background; progress arrives as `mail-sync` events.
#[tauri::command]
pub fn sync_account(state: State<'_, AppState>, account_id: String) {
    sync_now(&state, account_id);
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> CmdResult<()> {
    state.save_settings(&settings).map_err(err)
}

#[tauri::command]
pub fn sync_folder(state: State<'_, AppState>, folder_id: String) {
    let engine = Arc::clone(&state.engine);
    tauri::async_runtime::spawn(async move {
        let _ = engine.sync_folder(&folder_id).await;
    });
}

// ------------------------------------------------------------------ shell

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> CmdResult<()> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("Nur http(s)- und mailto-Links werden geöffnet".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

/// Must be async: creating a window from a synchronous command deadlocks
/// WebView2 on Windows and leaves the new window blank.
#[tauri::command]
pub async fn open_app(app: AppHandle, app_id: String) -> CmdResult<()> {
    windows::open_app_window(&app, &app_id).map_err(err)
}
