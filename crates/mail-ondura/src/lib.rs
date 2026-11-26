//! Ondura Mail adapter for Ondura Server's native client API (`/api/v1`).
//!
//! An Ondura Server also speaks EWS, and an account for it is an EWS account
//! marked as an Ondura Server. Servers that offer the native API (see
//! Ondura-Server `docs/client-api.md`) are used through it for mail:
//!
//! - one incremental change feed for the whole mailbox (`/sync?since=modseq`)
//!   instead of a sync state per folder,
//! - push over a WebSocket (`/ws`) instead of polling,
//! - message sources and submission as raw RFC 5322, so the client renders and
//!   sends exactly what it does over IMAP (S/MIME, inline images, receipts).
//!
//! Whether the server has the API is asked once per session
//! (`/api/v1/identity`); an older server, and everything the API does not
//! cover (automatic replies, the address book, the organisation chart), goes
//! through the EWS provider given as fallback.

mod push;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use chrono::{DateTime, Utc};
use ondura_mail_core::model::{Address, AutoReply, CategoryDef, DirectoryEntry, MailRule, FolderRole, Importance, OrgInfo, OutgoingMessage, Photo, Quota, ResolvedAttachment};
use ondura_mail_core::preview::{attachment_bytes, parse_body, parse_headers};
use ondura_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, RemoteFolder, RemoteMessage};
use ondura_mail_core::{Error, Result, categories};
use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::OnceCell;
use tracing::debug;

/// Header that opens the native API for an Ondura client.
const CLIENT_HEADER: &str = "X-Ondura-Client";
const CLIENT_NAME: &str = concat!("Ondura-Mail/", env!("CARGO_PKG_VERSION"));
/// Messages of a folder loaded on the first sync (newest first).
const WINDOW: usize = 500;
const PAGE: usize = 200;
/// One change feed answers the syncs of all folders of one round.
const FEED_REUSE: Duration = Duration::from_secs(5);
/// A modseq larger than any real one: `/sync` then only reports the current modseq.
const NOW_MODSEQ: i64 = i64::MAX;

/// Flag bits of the server (`model::flags`).
mod flags {
    pub const READ: i64 = 1;
    pub const FLAGGED: i64 = 2;
}

pub struct OnduraProvider {
    origin: String,
    username: String,
    password: String,
    from: Address,
    http: reqwest::Client,
    fallback: Arc<dyn MailProvider>,
    native: OnceCell<bool>,
    /// Last change feed: (since, fetched at, feed).
    feed: Mutex<Option<(i64, Instant, Arc<Feed>)>>,
    /// Drafts folder id, from the last folder list.
    drafts: Mutex<Option<String>>,
    push: push::Push,
}

/// `https://host[:port]` of a server URL (e.g. its EWS endpoint).
pub fn origin(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url.trim()).ok()?;
    let host = u.host_str()?;
    Some(match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    })
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .tls_backend_preconfigured((*ondura_mail_core::net::tls_client_config()).clone())
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(90))
        .user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

/// Whether the server at `origin` offers the native client API. `Ok(false)`
/// for a server without it; network errors are reported, so a temporary
/// problem never decides the protocol.
pub async fn has_client_api(origin: &str) -> Result<bool> {
    let resp = http_client().get(format!("{origin}/api/v1/identity")).send().await.map_err(net_err)?;
    if resp.status().is_server_error() {
        return Err(Error::Network(format!("HTTP {}", resp.status())));
    }
    if !resp.status().is_success() {
        return Ok(false);
    }
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    Ok(v["api"] == "ondura-client")
}

fn net_err(e: reqwest::Error) -> Error {
    if e.is_decode() { Error::Protocol(e.to_string()) } else { Error::Network(e.to_string()) }
}

/// One answer of `/sync`.
#[derive(Debug, Deserialize)]
struct Feed {
    modseq: i64,
    #[serde(default)]
    changes: Vec<FeedChange>,
}

#[derive(Debug, Deserialize)]
struct FeedChange {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    folder: Option<i64>,
    #[serde(default)]
    item: Option<Item>,
    /// Id of a deleted item.
    #[serde(default)]
    id: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Person {
    name: String,
    email: String,
}

/// A message as the API lists it (feed items and `/messages` entries).
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Item {
    id: i64,
    #[serde(alias = "folderId")]
    folder: Option<i64>,
    kind: Option<String>,
    subject: String,
    from: Option<Person>,
    to: Vec<Person>,
    cc: Vec<Person>,
    /// Feed items: `received`; `/messages`: `date` (both Unix seconds).
    #[serde(alias = "date")]
    received: i64,
    preview: String,
    /// Feed: bit field; `/messages`: object with `read`, `flagged`.
    flags: Value,
    has_attachments: bool,
    importance: Option<String>,
    message_id: Option<String>,
    categories: Option<Vec<String>>,
}

fn address(p: &Person) -> Option<Address> {
    (!p.email.is_empty()).then(|| Address::new((!p.name.is_empty()).then(|| p.name.clone()), &p.email))
}

impl Item {
    fn is_mail(&self) -> bool {
        self.kind.as_deref().is_none_or(|k| k == "mail")
    }

    fn flag(&self, bit: i64, name: &str) -> bool {
        match &self.flags {
            Value::Number(n) => n.as_i64().unwrap_or(0) & bit != 0,
            Value::Object(o) => o.get(name).and_then(Value::as_bool).unwrap_or(false),
            _ => false,
        }
    }

    fn remote(&self) -> RemoteMessage {
        RemoteMessage {
            remote_id: self.id.to_string(),
            subject: self.subject.clone(),
            from: self.from.as_ref().and_then(address),
            to: self.to.iter().filter_map(address).collect(),
            cc: self.cc.iter().filter_map(address).collect(),
            date: DateTime::from_timestamp(self.received, 0).unwrap_or_else(Utc::now),
            preview: self.preview.clone(),
            is_read: self.flag(flags::READ, "read"),
            is_flagged: self.flag(flags::FLAGGED, "flagged"),
            has_attachments: self.has_attachments,
            importance: match self.importance.as_deref() {
                Some("high") => Importance::High,
                Some("low") => Importance::Low,
                _ => Importance::Normal,
            },
            // Stored with angle brackets, as parsed from the header.
            internet_message_id: self.message_id.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(|m| if m.starts_with('<') { m.to_string() } else { format!("<{m}>") }),
            categories: self.categories.clone(),
            focused: None,
            follow_up: None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Me {
    #[serde(default)]
    quota: i64,
    #[serde(default)]
    used: i64,
    #[serde(default)]
    folders: Vec<ApiFolder>,
}

#[derive(Debug, Deserialize)]
struct ApiFolder {
    id: i64,
    name: String,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    class: String,
    #[serde(default)]
    parent: Option<i64>,
    #[serde(default)]
    total: i64,
    #[serde(default)]
    unread: i64,
}

fn role(role: Option<&str>) -> FolderRole {
    match role {
        Some("inbox") => FolderRole::Inbox,
        Some("drafts") => FolderRole::Drafts,
        Some("sentitems") => FolderRole::Sent,
        Some("deleteditems") => FolderRole::Trash,
        Some("junkemail") => FolderRole::Junk,
        Some("archive") => FolderRole::Archive,
        _ => FolderRole::Other,
    }
}

/// Mail folders of `/me`; folders below the mailbox root are top level.
fn mail_folders(folders: &[ApiFolder]) -> Vec<RemoteFolder> {
    let mail: HashSet<i64> = folders.iter().filter(|f| f.class == "mail").map(|f| f.id).collect();
    folders
        .iter()
        // The outbox is the server's queue, not a folder to show.
        .filter(|f| f.class == "mail" && f.role.as_deref() != Some("outbox"))
        .map(|f| RemoteFolder {
            remote_id: f.id.to_string(),
            name: f.name.clone(),
            parent_remote_id: f.parent.filter(|p| mail.contains(p)).map(|p| p.to_string()),
            role: role(f.role.as_deref()),
            unread_count: f.unread.max(0) as u32,
            total_count: f.total.max(0) as u32,
            selectable: true,
        })
        .collect()
}

/// Folder state: the modseq up to which the folder is known.
fn parse_state(state: Option<&str>) -> Option<i64> {
    state.and_then(|s| s.strip_prefix("modseq:")).and_then(|s| s.parse().ok())
}

/// Ondura Server's colour key for a colour (`#rrggbb`), or the default for the name.
fn color_key(name: &str, color: Option<&str>) -> &'static str {
    let hex = color.unwrap_or_else(|| categories::default_color(name));
    categories::nearest(hex, &categories::PALETTE).unwrap_or("blue")
}

fn category_hex(color: &str) -> Option<String> {
    if color.starts_with('#') {
        return Some(color.to_string());
    }
    categories::hex_of(color).map(str::to_string)
}

/// An inbox rule as Ondura Server keeps it.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ApiRule {
    id: i64,
    name: String,
    enabled: bool,
    match_all: bool,
    stop: bool,
    conditions: Vec<ApiCondition>,
    actions: Vec<ApiAction>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ApiCondition {
    field: String,
    value: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ApiAction {
    #[serde(rename = "type")]
    kind: String,
    folder: Option<i64>,
    category: Option<String>,
}

/// A server rule in the app's form, if the app can show it: conditions
/// combined with "and" (one per field), and only actions the app knows.
fn rule_from_api(r: ApiRule) -> Option<MailRule> {
    if !r.match_all && r.conditions.len() > 1 {
        return None;
    }
    let mut rule = MailRule { id: r.id.to_string(), name: r.name, enabled: r.enabled, stop: r.stop, ..Default::default() };
    for c in r.conditions {
        let slot = match c.field.as_str() {
            "from" => &mut rule.from_contains,
            "subject" => &mut rule.subject_contains,
            "to" => &mut rule.to_contains,
            _ => return None,
        };
        if slot.is_some() {
            return None;
        }
        *slot = Some(c.value);
    }
    for a in r.actions {
        match a.kind.as_str() {
            "move" => rule.move_to = Some(a.folder?.to_string()),
            "markRead" => rule.mark_read = true,
            "categorize" if rule.category.is_none() => rule.category = a.category,
            "delete" => rule.delete = true,
            _ => return None,
        }
    }
    Some(rule)
}

fn rule_to_api(r: &MailRule) -> Result<Value> {
    let mut conditions = Vec::new();
    for (field, value) in [("from", &r.from_contains), ("subject", &r.subject_contains), ("to", &r.to_contains)] {
        if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            conditions.push(json!({ "field": field, "value": v }));
        }
    }
    let mut actions = Vec::new();
    if let Some(folder) = &r.move_to {
        actions.push(json!({ "type": "move", "folder": id_of(folder)? }));
    }
    if r.mark_read {
        actions.push(json!({ "type": "markRead" }));
    }
    if let Some(c) = r.category.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        actions.push(json!({ "type": "categorize", "category": c }));
    }
    if r.delete {
        actions.push(json!({ "type": "delete" }));
    }
    let id = r.id.parse::<i64>().ok();
    Ok(json!({ "id": id, "name": r.name, "enabled": r.enabled, "matchAll": true, "stop": r.stop, "conditions": conditions, "actions": actions }))
}

#[derive(Debug, Deserialize)]
struct ApiCategory {
    id: i64,
    name: String,
    #[serde(default)]
    color: String,
}

/// Percent-encoding for a path segment or query value.
fn percent(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~@".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn id_of(remote_id: &str) -> Result<i64> {
    remote_id.parse().map_err(|_| Error::NotFound(format!("message {remote_id}")))
}

/// Applies a change feed to one folder.
fn folder_changes(folder: i64, feed: &Feed) -> FolderChanges {
    let mut changes = FolderChanges { new_state: Some(format!("modseq:{}", feed.modseq)), ..Default::default() };
    let mut upserted: HashMap<i64, RemoteMessage> = HashMap::new();
    let mut removed: HashSet<i64> = HashSet::new();
    // In modseq order: the last change of an item wins.
    for c in &feed.changes {
        match (c.kind.as_str(), &c.item) {
            ("add" | "update", Some(item)) if item.is_mail() => {
                if c.folder.or(item.folder) == Some(folder) {
                    removed.remove(&item.id);
                    upserted.insert(item.id, item.remote());
                } else {
                    // Moved elsewhere (or never here): not in this folder.
                    upserted.remove(&item.id);
                    removed.insert(item.id);
                }
            }
            ("delete", _) => {
                if let Some(id) = c.id {
                    upserted.remove(&id);
                    removed.insert(id);
                }
            }
            _ => {}
        }
    }
    changes.upserted = upserted.into_values().collect();
    changes.removed = removed.into_iter().map(|id| id.to_string()).collect();
    changes
}

impl OnduraProvider {
    /// `server_url` is any URL of the server (the account's EWS URL).
    pub fn new(server_url: &str, username: &str, password: &str, from: Address, fallback: Arc<dyn MailProvider>) -> Arc<Self> {
        let origin = origin(server_url).unwrap_or_else(|| server_url.trim_end_matches('/').to_string());
        Arc::new(Self {
            push: push::Push::new(origin.clone(), username.to_string(), password.to_string()),
            origin,
            username: username.to_string(),
            password: password.to_string(),
            from,
            http: http_client(),
            fallback,
            native: OnceCell::new(),
            feed: Mutex::new(None),
            drafts: Mutex::new(None),
        })
    }

    /// Whether this server is used through the native API (asked once).
    pub async fn native(&self) -> Result<bool> {
        self.native
            .get_or_try_init(|| async {
                let native = has_client_api(&self.origin).await?;
                debug!(origin = %self.origin, native, "Ondura Server client API");
                Ok::<_, Error>(native)
            })
            .await
            .copied()
    }

    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        self.http.request(method, format!("{}/api/v1{path}", self.origin)).basic_auth(&self.username, Some(&self.password)).header(CLIENT_HEADER, CLIENT_NAME)
    }

    async fn send_req(&self, req: reqwest::RequestBuilder) -> Result<reqwest::Response> {
        let resp = req.send().await.map_err(net_err)?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["error"].as_str().map(str::to_string)).unwrap_or_else(|| if text.trim().is_empty() { status.to_string() } else { text.trim().to_string() });
        Err(match status {
            StatusCode::UNAUTHORIZED => Error::Auth(msg),
            StatusCode::NOT_FOUND => Error::NotFound(msg),
            StatusCode::CONFLICT => Error::Conflict(msg),
            StatusCode::TOO_MANY_REQUESTS | StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT => Error::Network(msg),
            _ => Error::Protocol(msg),
        })
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.send_req(self.request(Method::GET, path)).await?.json().await.map_err(net_err)
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value> {
        // The mailbox changes: a cached feed would hide this change from the
        // sync that usually follows right away.
        *self.feed.lock().unwrap() = None;
        self.send_req(self.request(Method::POST, path).json(&body)).await?.json().await.map_err(net_err)
    }

    async fn me(&self) -> Result<Me> {
        let me: Me = self.get_json("/me").await?;
        *self.drafts.lock().unwrap() = mail_folders(&me.folders).into_iter().find(|f| f.role == FolderRole::Drafts).map(|f| f.remote_id);
        Ok(me)
    }

    async fn drafts_folder(&self) -> Result<String> {
        if let Some(id) = self.drafts.lock().unwrap().clone() {
            return Ok(id);
        }
        self.me().await?;
        self.drafts.lock().unwrap().clone().ok_or_else(|| Error::NotFound("Drafts".into()))
    }

    /// Changes since `since`; one answer serves every folder of a sync round.
    async fn feed(&self, since: i64) -> Result<Arc<Feed>> {
        if let Some((s, at, feed)) = self.feed.lock().unwrap().as_ref()
            && *s == since
            && at.elapsed() < FEED_REUSE
        {
            return Ok(Arc::clone(feed));
        }
        let feed: Arc<Feed> = Arc::new(self.get_json(&format!("/sync?since={since}")).await?);
        *self.feed.lock().unwrap() = Some((since, Instant::now(), Arc::clone(&feed)));
        Ok(feed)
    }

    async fn list(&self, folder: &str, offset: usize, limit: usize) -> Result<Vec<Item>> {
        #[derive(Deserialize)]
        struct List {
            #[serde(default)]
            messages: Vec<Item>,
        }
        let l: List = self.get_json(&format!("/messages?folder={folder}&offset={offset}&limit={limit}")).await?;
        Ok(l.messages)
    }

    /// The server's category list; `None` for servers without one.
    async fn registry(&self) -> Result<Option<Vec<ApiCategory>>> {
        #[derive(Deserialize)]
        struct List {
            #[serde(default)]
            categories: Vec<ApiCategory>,
        }
        match self.get_json::<List>("/categories").await {
            Ok(l) => Ok(Some(l.categories)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Adds categories the server does not list yet, so its web app shows
    /// them with a colour too.
    async fn register_categories(&self, names: &[String]) -> Result<()> {
        let Some(known) = self.registry().await? else { return Ok(()) };
        for name in names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()) {
            if !known.iter().any(|k| k.name.eq_ignore_ascii_case(name)) {
                self.post("/category", json!({ "name": name, "color": color_key(name, None) })).await?;
            }
        }
        Ok(())
    }

    async fn raw(&self, id: &str) -> Result<Vec<u8>> {
        let id = id_of(id)?;
        Ok(self.send_req(self.request(Method::GET, &format!("/message/{id}/raw"))).await?.bytes().await.map_err(net_err)?.to_vec())
    }

    /// Files a message; returns its id.
    async fn import(&self, folder: &str, raw: &[u8], read: bool, draft: bool) -> Result<Option<String>> {
        let received = parse_headers(raw).date.map(|d| d.timestamp());
        let v = self.post("/import", json!({ "folder": id_of(folder)?, "mime": B64.encode(raw), "read": read, "draft": draft, "received": received })).await?;
        Ok(v["id"].as_i64().map(|id| id.to_string()))
    }
}

/// Runs the native implementation, or the fallback for servers without the API.
macro_rules! either {
    ($self:ident, $native:expr, $fallback:expr) => {
        if $self.native().await? { $native } else { $fallback }
    };
}

#[async_trait]
impl MailProvider for OnduraProvider {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        either!(self, Ok(mail_folders(&self.me().await?.folders)), self.fallback.list_folders().await)
    }

    async fn sync_folder(&self, folder: &RemoteFolder, state: Option<&str>) -> Result<FolderChanges> {
        if !self.native().await? {
            return self.fallback.sync_folder(folder, state).await;
        }
        let fid = id_of(&folder.remote_id)?;
        if let Some(since) = parse_state(state) {
            return Ok(folder_changes(fid, &*self.feed(since).await?));
        }
        // First sync: the newest messages of the folder; the modseq is taken
        // before listing, so nothing that changes meanwhile is missed.
        let modseq = self.feed(NOW_MODSEQ).await?.modseq;
        let mut upserted = Vec::new();
        while upserted.len() < WINDOW {
            let page = self.list(&folder.remote_id, upserted.len(), PAGE.min(WINDOW - upserted.len())).await?;
            let done = page.len() < PAGE.min(WINDOW - upserted.len());
            upserted.extend(page.iter().filter(|i| i.is_mail()).map(Item::remote));
            if done || page.is_empty() {
                break;
            }
        }
        Ok(FolderChanges { reset: true, upserted, new_state: Some(format!("modseq:{modseq}")), ..Default::default() })
    }

    async fn fetch_body(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<FetchedBody> {
        either!(
            self,
            {
                let raw = self.raw(message_remote_id).await?;
                Ok(FetchedBody { body: parse_body(&raw), raw: Some(raw), recipients: None })
            },
            self.fallback.fetch_body(folder_remote_id, message_remote_id).await
        )
    }

    async fn fetch_older(&self, folder: &RemoteFolder, known: &HashSet<String>, oldest_date: Option<DateTime<Utc>>, limit: usize) -> Result<Vec<RemoteMessage>> {
        if !self.native().await? {
            return self.fallback.fetch_older(folder, known, oldest_date, limit).await;
        }
        // The list is newest first: page on until `limit` unknown messages are found.
        let mut out = Vec::new();
        let mut offset = known.len().saturating_sub(PAGE);
        loop {
            let page = self.list(&folder.remote_id, offset, PAGE).await?;
            out.extend(page.iter().filter(|i| i.is_mail() && !known.contains(&i.id.to_string())).map(Item::remote));
            if page.len() < PAGE || out.len() >= limit {
                break;
            }
            offset += PAGE;
        }
        out.truncate(limit);
        Ok(out)
    }

    async fn fetch_attachment(&self, folder_remote_id: &str, message_remote_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        either!(
            self,
            {
                let raw = self.raw(message_remote_id).await?;
                let index: usize = attachment_id.parse().map_err(|_| Error::NotFound(attachment_id.into()))?;
                attachment_bytes(&raw, index).ok_or_else(|| Error::NotFound(attachment_id.into()))
            },
            self.fallback.fetch_attachment(folder_remote_id, message_remote_id, attachment_id).await
        )
    }

    async fn set_flags(&self, folder_remote_id: &str, message_remote_id: &str, read: Option<bool>, flagged: Option<bool>) -> Result<()> {
        either!(
            self,
            self.post("/flag", json!({ "id": id_of(message_remote_id)?, "read": read, "flagged": flagged })).await.map(|_| ()),
            self.fallback.set_flags(folder_remote_id, message_remote_id, read, flagged).await
        )
    }

    async fn set_categories(&self, folder_remote_id: &str, message_remote_id: &str, categories: &[String]) -> Result<()> {
        either!(
            self,
            {
                self.post("/categories", json!({ "id": id_of(message_remote_id)?, "categories": categories })).await?;
                if let Err(e) = self.register_categories(categories).await {
                    debug!(error = %e, "categories not added to the server's list");
                }
                Ok(())
            },
            self.fallback.set_categories(folder_remote_id, message_remote_id, categories).await
        )
    }

    async fn mark_folder_read(&self, folder_remote_id: &str) -> Result<()> {
        either!(
            self,
            self.post("/folder/read", json!({ "folder": id_of(folder_remote_id)? })).await.map(|_| ()),
            self.fallback.mark_folder_read(folder_remote_id).await
        )
    }

    async fn empty_folder(&self, folder_remote_id: &str, trash_remote_id: Option<&str>) -> Result<()> {
        if !self.native().await? {
            return self.fallback.empty_folder(folder_remote_id, trash_remote_id).await;
        }
        match trash_remote_id.filter(|t| *t != folder_remote_id) {
            // Into the trash: move every message (in pages, the list shrinks).
            Some(trash) => loop {
                let ids: Vec<i64> = self.list(folder_remote_id, 0, PAGE).await?.iter().map(|i| i.id).collect();
                if ids.is_empty() {
                    return Ok(());
                }
                self.post("/bulk", json!({ "ids": ids, "action": "move", "folder": id_of(trash)? })).await?;
            },
            None => self.post("/empty", json!({ "folder": id_of(folder_remote_id)? })).await.map(|_| ()),
        }
    }

    async fn move_message(&self, folder_remote_id: &str, message_remote_id: &str, target_folder_remote_id: &str) -> Result<Option<String>> {
        either!(
            self,
            {
                self.post("/move", json!({ "id": id_of(message_remote_id)?, "folder": id_of(target_folder_remote_id)? })).await?;
                // Items keep their id when they move.
                Ok(Some(message_remote_id.to_string()))
            },
            self.fallback.move_message(folder_remote_id, message_remote_id, target_folder_remote_id).await
        )
    }

    async fn delete_message(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<()> {
        either!(
            self,
            match self.post("/destroy", json!({ "id": id_of(message_remote_id)? })).await {
                // Already gone.
                Err(Error::NotFound(_)) => Ok(()),
                other => other.map(|_| ()),
            },
            self.fallback.delete_message(folder_remote_id, message_remote_id).await
        )
    }

    async fn send(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        if !self.native().await? {
            return self.fallback.send(message, attachments).await;
        }
        let msg = ondura_mail_imap::build_message(&self.from, message, attachments)?;
        let raw = ondura_mail_core::smime::protect_outgoing(msg.formatted(), &self.from.email, message)?;
        // The envelope carries Bcc, which the message itself does not.
        let recipients: Vec<String> = msg.envelope().to().iter().map(ToString::to_string).collect();
        self.post("/submit", json!({ "mime": B64.encode(&raw), "recipients": recipients, "saveCopy": true })).await?;
        Ok(())
    }

    async fn save_draft(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<Option<String>> {
        if !self.native().await? {
            return self.fallback.save_draft(message, attachments).await;
        }
        let drafts = self.drafts_folder().await?;
        let raw = ondura_mail_imap::build_draft(&self.from, message, attachments)?.formatted();
        self.import(&drafts, &raw, true, true).await
    }

    async fn fetch_raw(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<Vec<u8>> {
        either!(self, self.raw(message_remote_id).await, self.fallback.fetch_raw(folder_remote_id, message_remote_id).await)
    }

    async fn import_message(&self, folder_remote_id: &str, raw: &[u8], read: bool) -> Result<()> {
        either!(self, self.import(folder_remote_id, raw, read, false).await.map(|_| ()), self.fallback.import_message(folder_remote_id, raw, read).await)
    }

    async fn wait_for_change(&self, folder_remote_id: &str, timeout: Duration) -> Result<bool> {
        either!(self, self.push.wait(timeout).await, self.fallback.wait_for_change(folder_remote_id, timeout).await)
    }

    async fn search(&self, query: &str, limit: usize) -> Result<Vec<(String, RemoteMessage)>> {
        if !self.native().await? {
            return self.fallback.search(query, limit).await;
        }
        #[derive(Deserialize)]
        struct Hits {
            #[serde(default)]
            messages: Vec<Item>,
        }
        let hits: Hits = self.get_json(&format!("/messages?search={}&limit={}", percent(query), limit.clamp(1, 200))).await?;
        Ok(hits.messages.iter().filter(|i| i.is_mail()).filter_map(|i| Some((i.folder?.to_string(), i.remote()))).collect())
    }

    async fn auto_reply(&self) -> Result<AutoReply> {
        self.fallback.auto_reply().await
    }

    async fn set_auto_reply(&self, reply: &AutoReply) -> Result<()> {
        self.fallback.set_auto_reply(reply).await
    }

    async fn create_folder(&self, parent_remote_id: Option<&str>, name: &str) -> Result<()> {
        either!(
            self,
            {
                let parent = parent_remote_id.map(id_of).transpose()?;
                self.post("/folder", json!({ "name": name, "parent": parent })).await.map(|_| ())
            },
            self.fallback.create_folder(parent_remote_id, name).await
        )
    }

    async fn rename_folder(&self, remote_id: &str, name: &str) -> Result<()> {
        either!(self, self.post("/folder/rename", json!({ "id": id_of(remote_id)?, "name": name })).await.map(|_| ()), self.fallback.rename_folder(remote_id, name).await)
    }

    async fn delete_folder(&self, remote_id: &str) -> Result<()> {
        either!(self, self.post("/folder/delete", json!({ "id": id_of(remote_id)? })).await.map(|_| ()), self.fallback.delete_folder(remote_id).await)
    }

    async fn search_directory(&self, query: &str, limit: usize) -> Result<Vec<DirectoryEntry>> {
        self.fallback.search_directory(query, limit).await
    }

    async fn org_info(&self, email: &str) -> Result<OrgInfo> {
        self.fallback.org_info(email).await
    }

    async fn server_rules(&self) -> Result<Vec<MailRule>> {
        if !self.native().await? {
            return self.fallback.server_rules().await;
        }
        #[derive(Deserialize)]
        struct List {
            #[serde(default)]
            rules: Vec<ApiRule>,
        }
        match self.get_json::<List>("/rules").await {
            Ok(l) => Ok(l.rules.into_iter().filter_map(rule_from_api).collect()),
            // A server from before inbox rules.
            Err(Error::NotFound(_)) => Err(Error::Unsupported("server rules".into())),
            Err(e) => Err(e),
        }
    }

    async fn save_server_rule(&self, rule: &MailRule) -> Result<()> {
        either!(self, self.post("/rule", rule_to_api(rule)?).await.map(|_| ()), self.fallback.save_server_rule(rule).await)
    }

    async fn delete_server_rule(&self, id: &str) -> Result<()> {
        either!(self, self.post("/rule/delete", json!({ "id": id_of(id)? })).await.map(|_| ()), self.fallback.delete_server_rule(id).await)
    }

    async fn category_list(&self) -> Result<Vec<CategoryDef>> {
        if !self.native().await? {
            return self.fallback.category_list().await;
        }
        match self.registry().await? {
            Some(list) => Ok(list.into_iter().map(|c| CategoryDef { color: category_hex(&c.color), name: c.name }).collect()),
            None => Err(Error::Unsupported("category list".into())),
        }
    }

    async fn upsert_category(&self, name: &str, color: Option<&str>) -> Result<()> {
        if !self.native().await? {
            return self.fallback.upsert_category(name, color).await;
        }
        let Some(list) = self.registry().await? else { return Err(Error::Unsupported("category list".into())) };
        let body = match list.iter().find(|c| c.name.eq_ignore_ascii_case(name)) {
            Some(c) => json!({ "id": c.id, "name": c.name, "color": color_key(name, color) }),
            None => json!({ "name": name, "color": color_key(name, color) }),
        };
        self.post("/category", body).await.map(|_| ())
    }

    async fn rename_category(&self, old: &str, new: &str) -> Result<bool> {
        if !self.native().await? {
            return self.fallback.rename_category(old, new).await;
        }
        let Some(list) = self.registry().await? else { return Err(Error::Unsupported("category list".into())) };
        match list.iter().find(|c| c.name.eq_ignore_ascii_case(old)) {
            // The server renames it on its messages too.
            Some(c) => self.post("/category", json!({ "id": c.id, "name": new, "color": c.color })).await.map(|_| true),
            None => {
                self.upsert_category(new, None).await?;
                Ok(false)
            }
        }
    }

    async fn delete_category(&self, name: &str) -> Result<bool> {
        if !self.native().await? {
            return self.fallback.delete_category(name).await;
        }
        let Some(list) = self.registry().await? else { return Err(Error::Unsupported("category list".into())) };
        match list.iter().find(|c| c.name.eq_ignore_ascii_case(name)) {
            Some(c) => self.post("/category/delete", json!({ "id": c.id })).await.map(|_| true),
            None => Ok(false),
        }
    }

    async fn person_photo(&self, email: &str) -> Result<Option<Photo>> {
        if !self.native().await? {
            return self.fallback.person_photo(email).await;
        }
        let path = format!("/avatar/{}", percent(email.trim()));
        match self.send_req(self.request(Method::GET, &path)).await {
            Ok(resp) => {
                let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/png").to_string();
                let data = resp.bytes().await.map_err(net_err)?.to_vec();
                Ok((!data.is_empty() && content_type.starts_with("image/")).then_some(Photo { content_type, data }))
            }
            // No picture, or not a mailbox of this server.
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    async fn set_photo(&self, photo: Option<&Photo>) -> Result<()> {
        if !self.native().await? {
            return self.fallback.set_photo(photo).await;
        }
        match photo {
            Some(p) => self.send_req(self.request(Method::POST, "/avatar").header(reqwest::header::CONTENT_TYPE, &p.content_type).body(p.data.clone())).await.map(|_| ()),
            None => self.send_req(self.request(Method::DELETE, "/avatar")).await.map(|_| ()),
        }
    }

    async fn quota(&self) -> Result<Quota> {
        either!(
            self,
            {
                let me = self.me().await?;
                Ok(Quota { used: me.used.max(0) as u64, limit: (me.quota > 0).then_some(me.quota as u64) })
            },
            self.fallback.quota().await
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(v: Value) -> Feed {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn feed_applies_per_folder() {
        let f = feed(json!({ "modseq": 20, "changes": [
            { "type": "add", "folder": 3, "item": { "id": 1, "folderId": 3, "kind": "mail", "subject": "Neu", "flags": 0, "received": 1764000000,
              "from": { "name": "Anna", "email": "anna@example.com" }, "to": [{ "email": "me@example.com" }], "importance": "high", "messageId": "m1@x", "categories": ["Rot"] } },
            { "type": "update", "folder": 3, "item": { "id": 2, "folderId": 3, "kind": "mail", "flags": 3, "received": 1764000000 } },
            // Moved from 3 to 4.
            { "type": "update", "folder": 4, "item": { "id": 5, "folderId": 4, "kind": "mail", "flags": 0, "received": 1764000000 } },
            { "type": "delete", "id": 7, "modseq": 18 },
            // Not mail.
            { "type": "add", "folder": 3, "item": { "id": 9, "kind": "event", "received": 0 } },
        ] }));
        let c = folder_changes(3, &f);
        assert_eq!(c.new_state.as_deref(), Some("modseq:20"));
        let mut ids: Vec<_> = c.upserted.iter().map(|m| m.remote_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["1", "2"]);
        let neu = c.upserted.iter().find(|m| m.remote_id == "1").unwrap();
        assert_eq!(neu.from.as_ref().unwrap().email, "anna@example.com");
        assert_eq!(neu.to[0].email, "me@example.com");
        assert_eq!(neu.importance, Importance::High);
        assert_eq!(neu.categories.as_deref(), Some(&["Rot".to_string()][..]));
        let two = c.upserted.iter().find(|m| m.remote_id == "2").unwrap();
        assert!(two.is_read && two.is_flagged);
        let mut removed = c.removed.clone();
        removed.sort();
        assert_eq!(removed, ["5", "7"]);
        // The other folder sees the moved message.
        assert_eq!(folder_changes(4, &f).upserted[0].remote_id, "5");
    }

    #[test]
    fn last_change_of_an_item_wins() {
        let f = feed(json!({ "modseq": 9, "changes": [
            { "type": "add", "folder": 3, "item": { "id": 1, "folderId": 3, "kind": "mail", "received": 0, "flags": 0 } },
            { "type": "delete", "id": 1, "modseq": 9 },
        ] }));
        let c = folder_changes(3, &f);
        assert!(c.upserted.is_empty());
        assert_eq!(c.removed, ["1"]);
    }

    #[test]
    fn folders_and_roles() {
        let folders: Vec<ApiFolder> = serde_json::from_value(json!([
            { "id": 1, "name": "Root", "role": "msgfolderroot", "class": "root", "parent": null },
            { "id": 2, "name": "Inbox", "role": "inbox", "class": "mail", "parent": 1, "total": 4, "unread": 2 },
            { "id": 3, "name": "Projekte", "role": null, "class": "mail", "parent": 2 },
            { "id": 4, "name": "Outbox", "role": "outbox", "class": "mail", "parent": 1 },
            { "id": 5, "name": "Calendar", "role": "calendar", "class": "calendar", "parent": 1 },
            { "id": 6, "name": "Sent Items", "role": "sentitems", "class": "mail", "parent": 1 },
        ]))
        .unwrap();
        let f = mail_folders(&folders);
        assert_eq!(f.iter().map(|f| f.remote_id.as_str()).collect::<Vec<_>>(), ["2", "3", "6"]);
        assert_eq!(f[0].role, FolderRole::Inbox);
        assert_eq!(f[0].parent_remote_id, None);
        assert_eq!(f[0].unread_count, 2);
        assert_eq!(f[1].parent_remote_id.as_deref(), Some("2"));
        assert_eq!(f[2].role, FolderRole::Sent);
    }

    #[test]
    fn list_entries_use_flag_objects() {
        let i: Item = serde_json::from_value(json!({ "id": 4, "folder": 2, "subject": "x", "date": 1764000000, "flags": { "read": true, "flagged": false } })).unwrap();
        let m = i.remote();
        assert!(m.is_read && !m.is_flagged);
        assert_eq!(m.date.timestamp(), 1764000000);
    }

    #[test]
    fn category_colours() {
        assert_eq!(color_key("Rot", None), "red");
        assert_eq!(color_key("Blaue Kategorie", None), "blue");
        assert_eq!(color_key("Projekt", Some("#3aa655")), "green");
        assert_eq!(color_key("Projekt X", None), color_key("projekt x", None));
        assert_eq!(category_hex("teal").as_deref(), Some("#17a2a2"));
        assert_eq!(category_hex("#123456").as_deref(), Some("#123456"));
        assert_eq!(category_hex("unknown"), None);
    }

    #[test]
    fn rules_round_trip() {
        let api: ApiRule = serde_json::from_value(json!({ "id": 7, "name": "Chef", "enabled": true, "matchAll": true, "stop": true,
            "conditions": [{ "field": "from", "value": "boss@" }, { "field": "subject", "value": "Urgent" }],
            "actions": [{ "type": "move", "folder": 12 }, { "type": "markRead" }, { "type": "categorize", "category": "Rot" }] }))
        .unwrap();
        let r = rule_from_api(api).unwrap();
        assert_eq!((r.id.as_str(), r.from_contains.as_deref(), r.subject_contains.as_deref(), r.move_to.as_deref()), ("7", Some("boss@"), Some("Urgent"), Some("12")));
        assert!(r.mark_read && r.stop && !r.delete);
        let back = rule_to_api(&r).unwrap();
        assert_eq!(back["id"], 7);
        assert_eq!(back["conditions"].as_array().unwrap().len(), 2);
        assert_eq!(back["actions"][0], json!({ "type": "move", "folder": 12 }));
        // Rules the app cannot show stay out (and untouched on the server).
        let any: ApiRule = serde_json::from_value(json!({ "id": 8, "matchAll": false, "conditions": [{ "field": "from", "value": "a" }, { "field": "from", "value": "b" }] })).unwrap();
        assert!(rule_from_api(any).is_none());
        let unknown: ApiRule = serde_json::from_value(json!({ "id": 9, "matchAll": true, "actions": [{ "type": "forward" }] })).unwrap();
        assert!(rule_from_api(unknown).is_none());
    }

    #[test]
    fn origin_of_ews_url() {
        assert_eq!(origin("https://mail.example.com/EWS/Exchange.asmx").as_deref(), Some("https://mail.example.com"));
        assert_eq!(origin("https://mail.example.com:8443/EWS/Exchange.asmx").as_deref(), Some("https://mail.example.com:8443"));
    }
}
