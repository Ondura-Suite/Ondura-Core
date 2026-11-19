//! OneDrive and SharePoint for the office apps ("Office-Konto").
//!
//! Cloud documents are addressed with paths of the form
//! `onedrive://<account>/<drive id>/<item id>/<file name>`, so the open and
//! save commands of the office apps work unchanged: `office.rs` reads and
//! writes such paths through [`read`] and [`write`]. The file name at the
//! end keeps extension checks and window titles working.
//!
//! Accounts are either office sign-ins (`o-<uuid>`, any file the user can
//! open plus SharePoint) or Microsoft 365 mail accounts (`m-<account id>`,
//! their own OneDrive, using the mail sign-in).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use ondura_mail_core::model::AccountKind;
use ondura_mail_core::secrets::refresh_token_key;
use ondura_mail_core::{Error, SecretStore, Store};
use ondura_mail_graph::drive::{DriveAccess, DriveClient, DriveInfo, DriveItem, DriveVersion, OFFICE_LOGIN_SCOPES_PERSONAL, OFFICE_LOGIN_SCOPES_WORK};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::commands::effective_client_id;
use crate::state::AppState;

type CmdResult<T> = Result<T, String>;

const ACCOUNTS_KEY: &str = "cloud.accounts";
pub const SCHEME: &str = "onedrive://";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAccount {
    key: String,
    email: String,
    name: String,
    tenant: String,
    personal: bool,
}

/// An account with files, as shown in the office apps.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAccount {
    pub key: String,
    pub email: String,
    pub name: String,
    pub personal: bool,
    /// `true` for a Microsoft 365 mail account (own OneDrive only).
    pub from_mail: bool,
}

struct Hub {
    store: Arc<Store>,
    secrets: Arc<dyn SecretStore>,
    clients: Mutex<HashMap<String, Arc<DriveClient>>>,
}

static HUB: OnceLock<Hub> = OnceLock::new();

/// Called once at startup.
pub fn init(store: Arc<Store>, secrets: Arc<dyn SecretStore>) {
    let _ = HUB.set(Hub { store, secrets, clients: Mutex::default() });
}

fn hub() -> CmdResult<&'static Hub> {
    HUB.get().ok_or_else(|| ondura_i18n::tr!("OneDrive ist noch nicht bereit").to_string())
}

fn secret_key(key: &str) -> String {
    format!("cloud-refresh:{key}")
}

fn stored(store: &Store) -> Vec<StoredAccount> {
    store.setting(ACCOUNTS_KEY).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

fn save_stored(store: &Store, list: &[StoredAccount]) -> CmdResult<()> {
    store.set_setting(ACCOUNTS_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn err(e: Error) -> String {
    match e {
        Error::NotFound(_) => ondura_i18n::tr!("Die Datei wurde in OneDrive nicht gefunden (gelöscht oder verschoben?)."),
        Error::Conflict(_) => "exists".into(),
        other => other.to_string(),
    }
}

fn list_accounts(h: &Hub) -> Vec<CloudAccount> {
    let office = stored(&h.store);
    let mut out: Vec<CloudAccount> = office
        .iter()
        .map(|a| CloudAccount { key: a.key.clone(), email: a.email.clone(), name: a.name.clone(), personal: a.personal, from_mail: false })
        .collect();
    for acc in h.store.list_accounts().unwrap_or_default() {
        if let AccountKind::Graph(cfg) = &acc.kind
            && cfg.mailbox.is_none()
            && !out.iter().any(|o| o.email.eq_ignore_ascii_case(&acc.email))
        {
            out.push(CloudAccount { key: format!("m-{}", acc.id), email: acc.email.clone(), name: acc.display_name.clone(), personal: cfg.tenant == "consumers", from_mail: true });
        }
    }
    out
}

fn client(key: &str) -> CmdResult<Arc<DriveClient>> {
    let h = hub()?;
    if let Some(c) = h.clients.lock().unwrap().get(key) {
        return Ok(Arc::clone(c));
    }
    let c = if let Some(id) = key.strip_prefix("m-") {
        let acc = h.store.get_account(id).map_err(|_| ondura_i18n::tr!("Das Konto gibt es nicht mehr").to_string())?;
        let AccountKind::Graph(cfg) = &acc.kind else { return Err(ondura_i18n::tr!("Kein Microsoft-365-Konto")) };
        DriveClient::new(cfg.tenant.clone(), effective_client_id(&cfg.client_id)?, Arc::clone(&h.secrets), refresh_token_key(id), DriveAccess::Mail)
    } else {
        let a = stored(&h.store).into_iter().find(|a| a.key == key).ok_or_else(|| ondura_i18n::tr!("Das Konto ist nicht mehr angemeldet"))?;
        let access = if a.personal { DriveAccess::Personal } else { DriveAccess::Work };
        DriveClient::new(a.tenant, effective_client_id("")?, Arc::clone(&h.secrets), secret_key(key), access)
    };
    let c = Arc::new(c);
    h.clients.lock().unwrap().insert(key.to_string(), Arc::clone(&c));
    Ok(c)
}

/// Sign-in data of an account for other Microsoft Graph features (OneNote,
/// Planner): tenant, client id, the secret key of its refresh token and
/// whether it is a personal Microsoft account.
pub fn account_auth(key: &str) -> CmdResult<(String, String, String, bool, String)> {
    let h = hub()?;
    if let Some(id) = key.strip_prefix("m-") {
        let acc = h.store.get_account(id).map_err(|_| ondura_i18n::tr!("Das Konto gibt es nicht mehr").to_string())?;
        let AccountKind::Graph(cfg) = &acc.kind else { return Err(ondura_i18n::tr!("Kein Microsoft-365-Konto")) };
        Ok((cfg.tenant.clone(), effective_client_id(&cfg.client_id)?, refresh_token_key(id), cfg.tenant == "consumers", acc.email.clone()))
    } else {
        let a = stored(&h.store).into_iter().find(|a| a.key == key).ok_or_else(|| ondura_i18n::tr!("Das Konto ist nicht mehr angemeldet"))?;
        Ok((a.tenant, effective_client_id("")?, secret_key(key), a.personal, a.email))
    }
}

pub fn secrets() -> CmdResult<Arc<dyn SecretStore>> {
    Ok(Arc::clone(&hub()?.secrets))
}

/// Only `%` and `/` are escaped, so the file name stays readable.
fn enc(s: &str) -> String {
    s.replace('%', "%25").replace('/', "%2F")
}

fn dec(s: &str) -> String {
    s.replace("%2F", "/").replace("%25", "%")
}

/// Path of a cloud file.
pub fn path_of(key: &str, item: &DriveItem) -> String {
    format!("{SCHEME}{}/{}/{}/{}", enc(key), enc(&item.drive_id), enc(&item.id), enc(&item.name))
}

/// `(account, drive, item, name)` of a cloud path.
pub fn parse(path: &str) -> Option<(String, String, String, String)> {
    let rest = path.strip_prefix(SCHEME)?;
    let mut p = rest.splitn(4, '/');
    Some((dec(p.next()?), dec(p.next()?), dec(p.next()?), dec(p.next()?)))
}

pub fn is_cloud(path: &str) -> bool {
    path.starts_with(SCHEME)
}

/// Content of a cloud file (used by `office.rs`).
pub async fn read(path: &str) -> CmdResult<Vec<u8>> {
    let (key, drive, item, _) = parse(path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    client(&key)?.download(&drive, &item).await.map_err(err)
}

/// Replace the content of a cloud file (used by `office.rs`).
pub async fn write(path: &str, data: Vec<u8>) -> CmdResult<()> {
    let (key, drive, item, _) = parse(path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    client(&key)?.upload(&drive, &item, data).await.map(|_| ()).map_err(err)
}

// ----------------------------------------------------------- commands --

#[tauri::command]
pub fn cloud_accounts() -> CmdResult<Vec<CloudAccount>> {
    Ok(list_accounts(hub()?))
}

/// Sign in to OneDrive in the browser. `personal` = Microsoft account
/// (Outlook.com etc.), otherwise work or school account.
#[tauri::command]
pub async fn cloud_sign_in(app: AppHandle, state: State<'_, AppState>, personal: bool, tenant: Option<String>) -> CmdResult<CloudAccount> {
    let h = hub()?;
    let client_id = effective_client_id("")?;
    let tenant = tenant.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| (if personal { "consumers" } else { "organizations" }).to_string());
    let http = ondura_mail_graph::http_client();
    let opener = app.clone();
    let scopes = if personal { OFFICE_LOGIN_SCOPES_PERSONAL } else { OFFICE_LOGIN_SCOPES_WORK };
    let token = ondura_mail_graph::login_interactive_with_scopes(&http, &tenant, &client_id, scopes, move |url| opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("Microsoft-Anmeldung fehlgeschlagen: {e}"))?;
    let key = format!("o-{}", uuid::Uuid::new_v4());
    let access = if personal { DriveAccess::Personal } else { DriveAccess::Work };
    let c = DriveClient::new(tenant.clone(), client_id, Arc::clone(&state.secrets), secret_key(&key), access);
    c.tokens().store(&token).await.map_err(err)?;
    let (name, email) = c.me().await.map_err(err)?;
    let mut list = stored(&h.store);
    // Signing in again replaces the old entry of the same address.
    for old in list.iter().filter(|a| a.email.eq_ignore_ascii_case(&email)) {
        let _ = h.secrets.delete(&secret_key(&old.key));
        h.clients.lock().unwrap().remove(&old.key);
    }
    list.retain(|a| !a.email.eq_ignore_ascii_case(&email));
    list.push(StoredAccount { key: key.clone(), email: email.clone(), name: name.clone(), tenant, personal });
    save_stored(&h.store, &list)?;
    h.clients.lock().unwrap().insert(key.clone(), Arc::new(c));
    Ok(CloudAccount { key, email, name, personal, from_mail: false })
}

#[tauri::command]
pub fn cloud_sign_out(key: String) -> CmdResult<()> {
    let h = hub()?;
    if key.starts_with("m-") {
        return Err(ondura_i18n::tr!("Dieses Konto gehört zu Ondura Mail und wird dort entfernt."));
    }
    let mut list = stored(&h.store);
    list.retain(|a| a.key != key);
    save_stored(&h.store, &list)?;
    let _ = h.secrets.delete(&secret_key(&key));
    h.clients.lock().unwrap().remove(&key);
    Ok(())
}

/// OneDrive and, for work accounts, the SharePoint libraries the user follows.
#[tauri::command]
pub async fn cloud_locations(key: String) -> CmdResult<Vec<DriveInfo>> {
    let c = client(&key)?;
    let mut out = vec![c.my_drive().await.map_err(err)?];
    if !key.starts_with("m-") && !stored(&hub()?.store).iter().any(|a| a.key == key && a.personal) {
        // Followed sites are a bonus; a tenant may not allow them.
        out.extend(c.site_drives().await.unwrap_or_default());
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudEntry {
    #[serde(flatten)]
    item: DriveItem,
    /// Path to open the file with (files only).
    path: Option<String>,
}

fn entries(key: &str, items: Vec<DriveItem>) -> Vec<CloudEntry> {
    items.into_iter().map(|i| CloudEntry { path: (!i.folder).then(|| path_of(key, &i)), item: i }).collect()
}

#[tauri::command]
pub async fn cloud_list(key: String, drive_id: String, folder_id: Option<String>) -> CmdResult<Vec<CloudEntry>> {
    let items = client(&key)?.children(&drive_id, folder_id.as_deref()).await.map_err(err)?;
    Ok(entries(&key, items))
}

#[tauri::command]
pub async fn cloud_recent(key: String) -> CmdResult<Vec<CloudEntry>> {
    Ok(entries(&key, client(&key)?.recent().await.map_err(err)?))
}

#[tauri::command]
pub async fn cloud_shared(key: String) -> CmdResult<Vec<CloudEntry>> {
    Ok(entries(&key, client(&key)?.shared_with_me().await.map_err(err)?))
}

#[tauri::command]
pub async fn cloud_search(key: String, query: String) -> CmdResult<Vec<CloudEntry>> {
    Ok(entries(&key, client(&key)?.search(&query).await.map_err(err)?))
}

#[tauri::command]
pub async fn cloud_create_folder(key: String, drive_id: String, parent_id: Option<String>, name: String) -> CmdResult<DriveItem> {
    let c = client(&key)?;
    let parent = match parent_id {
        Some(p) => p,
        None => c.root_id(&drive_id).await.map_err(err)?,
    };
    c.create_folder(&drive_id, &parent, name.trim()).await.map_err(err)
}

/// Target for "Speichern unter" in a cloud folder: creates the file (empty,
/// it is written right after) and returns its path. If the name exists the
/// error is `exists`, unless `replace` is set.
#[tauri::command]
pub async fn cloud_reserve(key: String, drive_id: String, folder_id: Option<String>, name: String, replace: bool) -> CmdResult<String> {
    let c = client(&key)?;
    let folder = match folder_id {
        Some(f) => f,
        None => c.root_id(&drive_id).await.map_err(err)?,
    };
    if let Some(existing) = c.child_by_name(&drive_id, &folder, &name).await.map_err(err)? {
        if existing.folder || !replace {
            return Err("exists".into());
        }
        return Ok(path_of(&key, &existing));
    }
    let item = c.create(&drive_id, &folder, &name, Vec::new()).await.map_err(err)?;
    Ok(path_of(&key, &item))
}

/// Web address and current state of a cloud file.
#[tauri::command]
pub async fn cloud_info(path: String) -> CmdResult<DriveItem> {
    let (key, drive, item, _) = parse(&path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    client(&key)?.item(&drive, &item).await.map_err(err)
}

/// Profile picture of an account as `data:` URL (`None` without one).
#[tauri::command]
pub async fn cloud_photo(key: String) -> CmdResult<Option<String>> {
    use base64::Engine;
    let photo = client(&key)?.photo().await.map_err(err)?;
    Ok(photo.map(|(mime, data)| format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(data))))
}

/// Version history of a cloud file.
#[tauri::command]
pub async fn cloud_versions(path: String) -> CmdResult<Vec<DriveVersion>> {
    let (key, drive, item, _) = parse(&path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    client(&key)?.versions(&drive, &item).await.map_err(err)
}

/// Restores an earlier version (it becomes the current one).
#[tauri::command]
pub async fn cloud_restore_version(path: String, version: String) -> CmdResult<()> {
    let (key, drive, item, _) = parse(&path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    client(&key)?.restore_version(&drive, &item, &version).await.map_err(err)
}

/// Saves an earlier version as a local copy (temp folder) to open it.
#[tauri::command]
pub async fn cloud_version_copy(path: String, version: String, label: String) -> CmdResult<String> {
    let (key, drive, item, name) = parse(&path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    let data = client(&key)?.version_content(&drive, &item, &version).await.map_err(err)?;
    let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, ""));
    let safe: String = format!("{stem} ({label})").chars().map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c }).collect();
    let dir = std::env::temp_dir().join("ondura-versions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(if ext.is_empty() { safe } else { format!("{safe}.{ext}") });
    std::fs::write(&file, data).map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}

/// Sharing link for a cloud file. `edit` = recipients can edit;
/// `organization` = only people of the organisation (work accounts).
#[tauri::command]
pub async fn cloud_share(path: String, edit: bool, organization: bool) -> CmdResult<String> {
    let (key, drive, item, _) = parse(&path).ok_or_else(|| ondura_i18n::tr!("Ungültige OneDrive-Adresse"))?;
    client(&key)?.share_link(&drive, &item, if edit { "edit" } else { "view" }, if organization { "organization" } else { "anonymous" }).await.map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_paths_round_trip() {
        let item = DriveItem {
            id: "01ABC!123".into(),
            drive_id: "b!x/y z".into(),
            name: "Bericht März.docx".into(),
            folder: false,
            size: 0,
            modified: None,
            modified_by: None,
            web_url: None,
            child_count: None,
        };
        let p = path_of("o-1", &item);
        assert!(p.starts_with(SCHEME) && p.ends_with(".docx"));
        assert_eq!(parse(&p).unwrap(), ("o-1".into(), "b!x/y z".into(), "01ABC!123".into(), "Bericht März.docx".into()));
        assert!(!is_cloud("C:\\Users\\a.docx"));
    }
}
