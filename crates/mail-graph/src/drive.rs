//! OneDrive and SharePoint files via Microsoft Graph, for the office apps
//! (open and save documents in the cloud, share links).
//!
//! Works with personal Microsoft accounts (OneDrive) and work or school
//! accounts (OneDrive for Business, SharePoint document libraries of
//! followed sites).

use std::sync::Arc;
use std::time::Duration;

use ondura_mail_core::{Error, Result, SecretStore};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::auth::TokenManager;
use crate::{GRAPH, http_client, percent_encode};

/// Scopes of the office sign-in: all files the user can open, and the
/// SharePoint sites they follow (work and school accounts).
pub const OFFICE_LOGIN_SCOPES_WORK: &str = "offline_access openid profile email User.Read Files.ReadWrite.All Sites.Read.All";
/// Personal Microsoft accounts have no SharePoint.
pub const OFFICE_LOGIN_SCOPES_PERSONAL: &str = "offline_access openid profile email User.Read Files.ReadWrite.All";
const SCOPE_WORK: &str = "offline_access Files.ReadWrite.All Sites.Read.All";
const SCOPE_PERSONAL: &str = "offline_access Files.ReadWrite.All";
/// What a mail account was granted (own OneDrive only).
const SCOPE_MAIL: &str = crate::auth::FILES_SCOPE;

/// Files up to this size are uploaded in one request.
const SIMPLE_UPLOAD: usize = 4 * 1024 * 1024;
/// Chunk size for upload sessions (a multiple of 320 KiB).
const CHUNK: usize = 32 * 320 * 1024;

/// How the account was signed in, which decides the token scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriveAccess {
    /// Office sign-in of a work or school account.
    Work,
    /// Office sign-in of a personal Microsoft account.
    Personal,
    /// Token of a mail account (own OneDrive only).
    Mail,
}

/// A file or folder.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveItem {
    pub id: String,
    pub drive_id: String,
    pub name: String,
    pub folder: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub modified_by: Option<String>,
    pub web_url: Option<String>,
    /// Number of children of a folder.
    pub child_count: Option<u64>,
}

/// An earlier version of a file (OneDrive/SharePoint version history).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveVersion {
    pub id: String,
    pub modified: Option<String>,
    pub modified_by: Option<String>,
    pub size: u64,
}

/// A document library (drive), e.g. of a SharePoint site.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub id: String,
    pub name: String,
    pub site: Option<String>,
    pub web_url: Option<String>,
}

pub struct DriveClient {
    http: reqwest::Client,
    tokens: TokenManager,
    scope: &'static str,
    base: String,
}

fn item_from(v: &Value) -> Option<DriveItem> {
    // Items shared with the user and recent items wrap the real item.
    let r = if v["remoteItem"].is_object() { &v["remoteItem"] } else { v };
    let id = r["id"].as_str()?.to_string();
    let drive_id = r["parentReference"]["driveId"].as_str().or_else(|| v["parentReference"]["driveId"].as_str())?.to_string();
    Some(DriveItem {
        id,
        drive_id,
        name: v["name"].as_str().or_else(|| r["name"].as_str()).unwrap_or_default().to_string(),
        folder: r["folder"].is_object() || r["package"].is_object() && r["package"]["type"] == "oneNote",
        size: r["size"].as_u64().unwrap_or(0),
        modified: r["lastModifiedDateTime"].as_str().map(String::from),
        modified_by: r["lastModifiedBy"]["user"]["displayName"].as_str().map(String::from),
        web_url: r["webUrl"].as_str().map(String::from),
        child_count: r["folder"]["childCount"].as_u64(),
    })
}

impl DriveClient {
    pub fn new(tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String, access: DriveAccess) -> Self {
        let http = http_client();
        let tokens = TokenManager::new(http.clone(), tenant, client_id, secrets, secret_key);
        let scope = match access {
            DriveAccess::Work => SCOPE_WORK,
            DriveAccess::Personal => SCOPE_PERSONAL,
            DriveAccess::Mail => SCOPE_MAIL,
        };
        Self { http, tokens, scope, base: GRAPH.to_string() }
    }

    /// Same as [`Self::new`] against another server (tests).
    pub fn with_base_url(tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String, access: DriveAccess, base: String) -> Self {
        let mut c = Self::new(tenant, client_id, secrets, secret_key, access);
        c.base = base;
        c
    }

    pub fn tokens(&self) -> &TokenManager {
        &self.tokens
    }

    async fn send(&self, method: Method, url: &str, body: Option<Body>) -> Result<reqwest::Response> {
        let url = if url.starts_with("http") { url.to_string() } else { format!("{}{url}", self.base) };
        for attempt in 0..4 {
            let token = self.tokens.scoped_token(self.scope).await.map_err(|e| {
                if crate::auth::is_consent_error(&e) {
                    Error::Auth(ondura_i18n::tr!("Für OneDrive braucht Ondura Ihre Zustimmung – bitte melden Sie das Konto neu an."))
                } else {
                    e
                }
            })?;
            let mut req = self.http.request(method.clone(), &url).bearer_auth(token);
            req = match &body {
                Some(Body::Json(v)) => req.json(v),
                Some(Body::Bytes(b)) => req.header("Content-Type", "application/octet-stream").body(b.clone()),
                None => req,
            };
            let resp = req.send().await.map_err(Error::network)?;
            match resp.status() {
                s if s.is_success() => return Ok(resp),
                StatusCode::UNAUTHORIZED if attempt == 0 => self.tokens.invalidate().await,
                StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE if attempt < 3 => {
                    let wait = resp.headers().get("Retry-After").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(2u64);
                    tokio::time::sleep(Duration::from_secs(wait.min(30))).await;
                }
                s => {
                    let text = resp.text().await.unwrap_or_default();
                    let msg = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["error"]["message"].as_str().map(String::from)).unwrap_or(text);
                    return Err(match s {
                        StatusCode::NOT_FOUND => Error::NotFound(msg),
                        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => Error::Conflict(msg),
                        StatusCode::FORBIDDEN => Error::Auth(format!("Kein Zugriff: {msg}")),
                        StatusCode::INSUFFICIENT_STORAGE => Error::Other(ondura_i18n::tr!("Der OneDrive-Speicher ist voll.")),
                        _ => Error::Protocol(format!("{s}: {msg}")),
                    });
                }
            }
        }
        Err(Error::Network(ondura_i18n::tr!("OneDrive antwortet nicht")))
    }

    async fn json(&self, method: Method, url: &str, body: Option<Body>) -> Result<Value> {
        self.send(method, url, body).await?.json().await.map_err(Error::network)
    }

    /// Items of a listing, following `@odata.nextLink`.
    async fn items(&self, url: &str, limit: usize) -> Result<Vec<DriveItem>> {
        let mut out = Vec::new();
        let mut next = Some(url.to_string());
        while let Some(u) = next.take() {
            let v = self.json(Method::GET, &u, None).await?;
            out.extend(v["value"].as_array().into_iter().flatten().filter_map(item_from));
            if out.len() < limit {
                next = v["@odata.nextLink"].as_str().map(String::from);
            }
        }
        out.truncate(limit);
        Ok(out)
    }

    /// Display name and address of the signed-in user.
    pub async fn me(&self) -> Result<(String, String)> {
        let v = self.json(Method::GET, "/me?$select=displayName,mail,userPrincipalName", None).await?;
        let email = v["mail"].as_str().filter(|m| !m.is_empty()).or(v["userPrincipalName"].as_str()).unwrap_or_default().to_string();
        Ok((v["displayName"].as_str().unwrap_or(&email).to_string(), email))
    }

    /// The user's own OneDrive.
    pub async fn my_drive(&self) -> Result<DriveInfo> {
        let v = self.json(Method::GET, "/me/drive?$select=id,name,webUrl,driveType", None).await?;
        Ok(DriveInfo {
            id: v["id"].as_str().unwrap_or_default().to_string(),
            name: "OneDrive".into(),
            site: None,
            web_url: v["webUrl"].as_str().map(String::from),
        })
    }

    /// Children of a folder (`None` = root of the drive).
    pub async fn children(&self, drive_id: &str, folder_id: Option<&str>) -> Result<Vec<DriveItem>> {
        let select = "$select=id,name,size,folder,file,package,parentReference,lastModifiedDateTime,lastModifiedBy,webUrl&$top=200";
        let url = match folder_id {
            Some(f) => format!("/drives/{}/items/{}/children?{select}", percent_encode(drive_id), percent_encode(f)),
            None => format!("/drives/{}/root/children?{select}", percent_encode(drive_id)),
        };
        let mut items = self.items(&url, 2000).await?;
        items.sort_by(|a, b| b.folder.cmp(&a.folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(items)
    }

    /// Files the user opened recently (all drives).
    pub async fn recent(&self) -> Result<Vec<DriveItem>> {
        Ok(self.items("/me/drive/recent?$top=50", 50).await?.into_iter().filter(|i| !i.folder).collect())
    }

    /// Files and folders other people shared with the user.
    pub async fn shared_with_me(&self) -> Result<Vec<DriveItem>> {
        self.items("/me/drive/sharedWithMe?$top=100", 200).await
    }

    /// Search the user's OneDrive.
    pub async fn search(&self, query: &str) -> Result<Vec<DriveItem>> {
        let q = query.replace('\'', "''");
        self.items(&format!("/me/drive/root/search(q='{}')?$top=100", percent_encode(&q)), 200).await
    }

    /// Document libraries of the SharePoint sites the user follows.
    pub async fn site_drives(&self) -> Result<Vec<DriveInfo>> {
        let sites = self.json(Method::GET, "/me/followedSites?$select=id,displayName,webUrl", None).await?;
        let mut out = Vec::new();
        for site in sites["value"].as_array().into_iter().flatten() {
            let (Some(id), name) = (site["id"].as_str(), site["displayName"].as_str().unwrap_or("Website")) else { continue };
            let Ok(drives) = self.json(Method::GET, &format!("/sites/{id}/drives?$select=id,name,webUrl"), None).await else { continue };
            for d in drives["value"].as_array().into_iter().flatten() {
                if let Some(did) = d["id"].as_str() {
                    out.push(DriveInfo {
                        id: did.to_string(),
                        name: d["name"].as_str().unwrap_or("Dokumente").to_string(),
                        site: Some(name.to_string()),
                        web_url: d["webUrl"].as_str().map(String::from),
                    });
                }
            }
        }
        Ok(out)
    }

    pub async fn item(&self, drive_id: &str, item_id: &str) -> Result<DriveItem> {
        let v = self.json(Method::GET, &format!("/drives/{}/items/{}", percent_encode(drive_id), percent_encode(item_id)), None).await?;
        item_from(&v).ok_or_else(|| Error::protocol("no drive item"))
    }

    /// Item `name` in a folder, if it exists.
    pub async fn child_by_name(&self, drive_id: &str, folder_id: &str, name: &str) -> Result<Option<DriveItem>> {
        let url = format!("/drives/{}/items/{}:/{}", percent_encode(drive_id), percent_encode(folder_id), percent_encode(name));
        match self.json(Method::GET, &url, None).await {
            Ok(v) => Ok(item_from(&v)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Profile picture of the signed-in user (`None` if there is none).
    pub async fn photo(&self) -> Result<Option<(String, Vec<u8>)>> {
        match self.send(Method::GET, "/me/photos/96x96/$value", None).await {
            Ok(r) => {
                let mime = r.headers().get("Content-Type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
                let data = r.bytes().await.map_err(Error::network)?.to_vec();
                Ok((!data.is_empty()).then_some((mime, data)))
            }
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Versions of a file, newest first.
    pub async fn versions(&self, drive_id: &str, item_id: &str) -> Result<Vec<DriveVersion>> {
        let url = format!("/drives/{}/items/{}/versions?$top=100", percent_encode(drive_id), percent_encode(item_id));
        let v = self.json(Method::GET, &url, None).await?;
        let mut out: Vec<DriveVersion> = v["value"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| {
                        Some(DriveVersion {
                            id: x["id"].as_str()?.to_string(),
                            modified: x["lastModifiedDateTime"].as_str().map(String::from),
                            modified_by: x["lastModifiedBy"]["user"]["displayName"].as_str().map(String::from),
                            size: x["size"].as_u64().unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)
    }

    pub async fn version_content(&self, drive_id: &str, item_id: &str, version_id: &str) -> Result<Vec<u8>> {
        let url = format!("/drives/{}/items/{}/versions/{}/content", percent_encode(drive_id), percent_encode(item_id), percent_encode(version_id));
        Ok(self.send(Method::GET, &url, None).await?.bytes().await.map_err(Error::network)?.to_vec())
    }

    /// Makes an earlier version the current one (a new version is created).
    pub async fn restore_version(&self, drive_id: &str, item_id: &str, version_id: &str) -> Result<()> {
        let url = format!("/drives/{}/items/{}/versions/{}/restoreVersion", percent_encode(drive_id), percent_encode(item_id), percent_encode(version_id));
        self.send(Method::POST, &url, Some(Body::Json(json!({})))).await?;
        Ok(())
    }

    pub async fn download(&self, drive_id: &str, item_id: &str) -> Result<Vec<u8>> {
        let url = format!("/drives/{}/items/{}/content", percent_encode(drive_id), percent_encode(item_id));
        Ok(self.send(Method::GET, &url, None).await?.bytes().await.map_err(Error::network)?.to_vec())
    }

    /// Replace the content of an existing file.
    pub async fn upload(&self, drive_id: &str, item_id: &str, data: Vec<u8>) -> Result<DriveItem> {
        let item = format!("/drives/{}/items/{}", percent_encode(drive_id), percent_encode(item_id));
        if data.len() <= SIMPLE_UPLOAD {
            let v = self.json(Method::PUT, &format!("{item}/content"), Some(Body::Bytes(data))).await?;
            return item_from(&v).ok_or_else(|| Error::protocol("no drive item"));
        }
        self.upload_session(&format!("{item}/createUploadSession"), json!({ "item": { "@microsoft.graph.conflictBehavior": "replace" } }), data).await
    }

    /// Create `name` in a folder. Fails with `Conflict` if it exists.
    pub async fn create(&self, drive_id: &str, folder_id: &str, name: &str, data: Vec<u8>) -> Result<DriveItem> {
        let path = format!("/drives/{}/items/{}:/{}:", percent_encode(drive_id), percent_encode(folder_id), percent_encode(name));
        if data.len() <= SIMPLE_UPLOAD {
            let v = self.json(Method::PUT, &format!("{path}/content?@microsoft.graph.conflictBehavior=fail"), Some(Body::Bytes(data))).await?;
            return item_from(&v).ok_or_else(|| Error::protocol("no drive item"));
        }
        self.upload_session(&format!("{path}/createUploadSession"), json!({ "item": { "@microsoft.graph.conflictBehavior": "fail" } }), data).await
    }

    async fn upload_session(&self, url: &str, body: Value, data: Vec<u8>) -> Result<DriveItem> {
        let session = self.json(Method::POST, url, Some(Body::Json(body))).await?;
        let upload_url = session["uploadUrl"].as_str().ok_or_else(|| Error::protocol("no uploadUrl"))?.to_string();
        let total = data.len();
        let mut offset = 0;
        loop {
            let end = (offset + CHUNK).min(total);
            // The upload URL is pre-authenticated: no bearer token.
            let resp = self
                .http
                .put(&upload_url)
                .header("Content-Range", format!("bytes {offset}-{}/{total}", end - 1))
                .body(data[offset..end].to_vec())
                .send()
                .await
                .map_err(Error::network)?;
            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                return Err(if status == StatusCode::CONFLICT { Error::Conflict(text) } else { Error::Protocol(format!("Upload: {status}: {text}")) });
            }
            if end == total {
                let v: Value = resp.json().await.map_err(Error::network)?;
                return item_from(&v).ok_or_else(|| Error::protocol("no drive item"));
            }
            offset = end;
        }
    }

    pub async fn create_folder(&self, drive_id: &str, parent_id: &str, name: &str) -> Result<DriveItem> {
        let url = format!("/drives/{}/items/{}/children", percent_encode(drive_id), percent_encode(parent_id));
        let v = self
            .json(Method::POST, &url, Some(Body::Json(json!({ "name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "rename" }))))
            .await?;
        item_from(&v).ok_or_else(|| Error::protocol("no drive item"))
    }

    /// Sharing link: `kind` "view" or "edit", `scope` "anonymous" or
    /// "organization" (work accounts).
    pub async fn share_link(&self, drive_id: &str, item_id: &str, kind: &str, scope: &str) -> Result<String> {
        let url = format!("/drives/{}/items/{}/createLink", percent_encode(drive_id), percent_encode(item_id));
        let v = self.json(Method::POST, &url, Some(Body::Json(json!({ "type": kind, "scope": scope })))).await?;
        v["link"]["webUrl"].as_str().map(String::from).ok_or_else(|| Error::protocol("no link"))
    }

    /// Root folder id of a drive (to save into it).
    pub async fn root_id(&self, drive_id: &str) -> Result<String> {
        let v = self.json(Method::GET, &format!("/drives/{}/root?$select=id", percent_encode(drive_id)), None).await?;
        v["id"].as_str().map(String::from).ok_or_else(|| Error::protocol("no root"))
    }
}

enum Body {
    Json(Value),
    Bytes(Vec<u8>),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_items_and_remote_items() {
        let own = json!({ "id": "1", "name": "Bericht.docx", "size": 1200, "file": {}, "parentReference": { "driveId": "d1" }, "lastModifiedDateTime": "2026-11-18T10:00:00Z", "lastModifiedBy": { "user": { "displayName": "Niklas" } } });
        let i = item_from(&own).unwrap();
        assert_eq!((i.id.as_str(), i.drive_id.as_str(), i.folder, i.modified_by.as_deref()), ("1", "d1", false, Some("Niklas")));
        let shared = json!({ "id": "local", "name": "Plan.xlsx", "remoteItem": { "id": "r9", "parentReference": { "driveId": "other" }, "size": 5 } });
        let s = item_from(&shared).unwrap();
        assert_eq!((s.id.as_str(), s.drive_id.as_str(), s.name.as_str()), ("r9", "other", "Plan.xlsx"));
        let folder = json!({ "id": "f", "name": "Projekte", "folder": { "childCount": 3 }, "parentReference": { "driveId": "d1" } });
        assert_eq!(item_from(&folder).unwrap().child_count, Some(3));
    }
}
