//! Microsoft Graph adapter (Microsoft 365 / Exchange Online).
//!
//! EWS is being switched off in Exchange Online (Oct 2026 – Apr 2027), so
//! Graph is the only long-term option for cloud mailboxes. Sync uses the
//! `messages/delta` endpoint; the delta link is stored as folder sync state.

pub mod auth;
pub mod drive;
pub mod pim;

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ondura_mail_core::model::{Address, AttachmentInfo, AutoReply, ExternalAudience, FolderRole, Importance, MessageBody, OutgoingMessage, ResolvedAttachment};
use ondura_mail_core::preview::{MAX_INLINE_IMAGE, data_uri};
use ondura_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, RemoteFlags, RemoteFolder, RemoteMessage};
use ondura_mail_core::{Error, Result, SecretStore};
use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::{debug, warn};

pub use auth::{TokenManager, TokenResponse, login_interactive, login_interactive_with_scopes};

pub(crate) const GRAPH: &str = "https://graph.microsoft.com/v1.0";
/// Initial sync only looks at messages from the last N days.
const INITIAL_DAYS: i64 = 90;
/// Attachments up to this total size are sent inline with the request;
/// larger ones go through an upload session.
const INLINE_ATTACHMENT_LIMIT: usize = 3 * 1024 * 1024;
/// Chunk size for upload sessions (must be a multiple of 320 KiB).
const UPLOAD_CHUNK: usize = 320 * 1024 * 12;
/// Largest file attachment Exchange Online accepts (upload session limit).
/// Bigger files are uploaded to the sender's OneDrive and shared as a link.
const MAX_ATTACHMENT: usize = 150 * 1024 * 1024;
const PREFER_HTML: &str = "outlook.body-content-type=\"html\"";
const BODY_URL_SUFFIX: &str = "?$select=body,hasAttachments&$expand=attachments($select=id,name,contentType,size,isInline)";
const MESSAGE_SELECT: &str =
    "subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments,importance,internetMessageId,categories,parentFolderId";

/// Percent-encoding for a query parameter value.
pub(crate) fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// HTTP client configured with the shared rustls setup.
pub fn http_client() -> reqwest::Client {
    let mut tls = (*ondura_mail_core::net::tls_client_config()).clone();
    tls.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
        .expect("reqwest client")
}

// ------------------------------------------------------------------ JSON

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    value: Vec<T>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
    #[serde(rename = "@odata.deltaLink")]
    delta_link: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GFolder {
    id: String,
    display_name: String,
    parent_folder_id: Option<String>,
    #[serde(default)]
    unread_item_count: u32,
    #[serde(default)]
    total_item_count: u32,
    #[serde(default)]
    child_folder_count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GEmail {
    name: Option<String>,
    address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GRecipient {
    email_address: GEmail,
}

impl GRecipient {
    fn to_address(&self) -> Option<Address> {
        Some(Address::new(self.email_address.name.clone(), self.email_address.address.clone()?))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GFlag {
    flag_status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GMessage {
    id: String,
    subject: Option<String>,
    from: Option<GRecipient>,
    to_recipients: Option<Vec<GRecipient>>,
    cc_recipients: Option<Vec<GRecipient>>,
    received_date_time: Option<DateTime<Utc>>,
    body_preview: Option<String>,
    is_read: Option<bool>,
    flag: Option<GFlag>,
    has_attachments: Option<bool>,
    importance: Option<String>,
    internet_message_id: Option<String>,
    categories: Option<Vec<String>>,
    parent_folder_id: Option<String>,
    #[serde(rename = "@removed")]
    removed: Option<Value>,
}

impl GMessage {
    fn is_flagged(&self) -> bool {
        self.flag.as_ref().and_then(|f| f.flag_status.as_deref()) == Some("flagged")
    }

    fn into_remote(self) -> RemoteMessage {
        let recipients = |v: Option<Vec<GRecipient>>| v.unwrap_or_default().iter().filter_map(GRecipient::to_address).collect();
        RemoteMessage {
            is_flagged: self.is_flagged(),
            remote_id: self.id,
            subject: self.subject.unwrap_or_default(),
            from: self.from.as_ref().and_then(GRecipient::to_address),
            to: recipients(self.to_recipients),
            cc: recipients(self.cc_recipients),
            date: self.received_date_time.unwrap_or_else(Utc::now),
            preview: self.body_preview.unwrap_or_default(),
            is_read: self.is_read.unwrap_or(false),
            has_attachments: self.has_attachments.unwrap_or(false),
            importance: match self.importance.as_deref() {
                Some("high") => Importance::High,
                Some("low") => Importance::Low,
                _ => Importance::Normal,
            },
            internet_message_id: self.internet_message_id,
            categories: self.categories,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GBody {
    content_type: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GAttachment {
    id: String,
    name: Option<String>,
    content_type: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    is_inline: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GFileAttachment {
    content_id: Option<String>,
    content_type: Option<String>,
    content_bytes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GFullMessage {
    body: Option<GBody>,
    #[serde(default)]
    attachments: Vec<GAttachment>,
}

/// Signed-in user, used during account setup.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub display_name: Option<String>,
    pub mail: Option<String>,
    pub user_principal_name: String,
}

impl Me {
    pub fn email(&self) -> String {
        self.mail.clone().unwrap_or_else(|| self.user_principal_name.clone())
    }
}

// ------------------------------------------------------------------ client

pub struct GraphProvider {
    http: reqwest::Client,
    tokens: TokenManager,
    base: String,
    /// `/me`, or `/users/<address>` for a shared mailbox.
    root: String,
    /// Token scope of every request (`None` = the default scopes).
    scope: Option<&'static str>,
}

impl GraphProvider {
    pub fn new(tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String) -> Arc<Self> {
        let http = http_client();
        let tokens = TokenManager::new(http.clone(), tenant, client_id, secrets, secret_key);
        Arc::new(Self { http, tokens, base: GRAPH.to_string(), root: "/me".into(), scope: None })
    }

    /// Adapter for a shared mailbox the signed-in user has access to. Paths
    /// are the same as for the own mailbox with `/me` replaced by
    /// `/users/<address>`; requests use the `.Shared` permissions.
    pub fn shared(tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String, mailbox: &str) -> Arc<Self> {
        let http = http_client();
        let tokens = TokenManager::new(http.clone(), tenant, client_id, secrets, secret_key);
        Arc::new(Self { http, tokens, base: GRAPH.to_string(), root: format!("/users/{}", percent_encode(mailbox)), scope: Some(auth::SHARED_SCOPE) })
    }

    /// Point the adapter at another Graph endpoint (national clouds, tests).
    pub fn with_base_url(tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String, base: String) -> Arc<Self> {
        let http = http_client();
        let tokens = TokenManager::new(http.clone(), tenant, client_id, secrets, secret_key);
        Arc::new(Self { http, tokens, base, root: "/me".into(), scope: None })
    }

    /// Same as [`Self::with_base_url`] for a shared mailbox (tests).
    pub fn shared_with_base_url(tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String, base: String, mailbox: &str) -> Arc<Self> {
        let http = http_client();
        let tokens = TokenManager::new(http.clone(), tenant, client_id, secrets, secret_key);
        Arc::new(Self { http, tokens, base, root: format!("/users/{}", percent_encode(mailbox)), scope: Some(auth::SHARED_SCOPE) })
    }

    /// `true` for a shared mailbox.
    pub fn is_shared(&self) -> bool {
        self.root != "/me"
    }

    /// Map a `/me…` path onto the mailbox of this adapter. OneDrive stays
    /// with the signed-in user.
    pub(crate) fn path(&self, url: &str) -> String {
        match url.strip_prefix("/me") {
            Some(rest) if self.is_shared() && !rest.starts_with("/drive") && (rest.is_empty() || rest.starts_with(['/', '?'])) => format!("{}{rest}", self.root),
            _ => url.to_string(),
        }
    }

    pub fn tokens(&self) -> &TokenManager {
        &self.tokens
    }

    /// Send a request with auth, retrying once on 401 and on throttling (429/503).
    async fn request(&self, method: Method, url: &str, body: Option<&Value>, prefer: Option<&str>) -> Result<reqwest::Response> {
        self.send(method, url, body, prefer, self.scope).await
    }

    /// [`Self::request`] with a token for `scope` (`None` = default scopes).
    async fn send(&self, method: Method, url: &str, body: Option<&Value>, prefer: Option<&str>, scope: Option<&'static str>) -> Result<reqwest::Response> {
        let url = if url.starts_with("https://") || url.starts_with("http://") { url.to_string() } else { format!("{}{}", self.base, self.path(url)) };
        let mut attempts = 0;
        loop {
            attempts += 1;
            let token = match scope {
                Some(scope) => self.tokens.scoped_token(scope).await.map_err(|e| {
                    if auth::is_consent_error(&e) { Error::Auth(consent_message(scope)) } else { e }
                })?,
                None => self.tokens.access_token().await?,
            };
            let mut req = self.http.request(method.clone(), &url).bearer_auth(token);
            if let Some(p) = prefer {
                req = req.header("Prefer", p);
            }
            if let Some(b) = body {
                req = req.json(b);
            }
            let resp = req.send().await.map_err(Error::network)?;
            match resp.status() {
                StatusCode::UNAUTHORIZED if attempts < 2 => {
                    self.tokens.invalidate().await;
                }
                StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE if attempts < 4 => {
                    let wait = resp
                        .headers()
                        .get("Retry-After")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(5u64);
                    warn!(wait, "Graph throttling, retrying");
                    tokio::time::sleep(Duration::from_secs(wait.min(60))).await;
                }
                s if s.is_success() => return Ok(resp),
                s => {
                    let text = resp.text().await.unwrap_or_default();
                    let msg = serde_json::from_str::<Value>(&text)
                        .ok()
                        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
                        .unwrap_or(text);
                    return Err(match s {
                        StatusCode::NOT_FOUND => Error::NotFound(msg),
                        StatusCode::GONE => Error::Protocol(format!("gone: {msg}")),
                        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Error::Auth(msg),
                        _ => Error::Protocol(format!("{s}: {msg}")),
                    });
                }
            }
        }
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str, prefer: Option<&str>) -> Result<T> {
        self.request(Method::GET, url, None, prefer).await?.json().await.map_err(Error::network)
    }

    pub async fn me(&self) -> Result<Me> {
        self.get_json("/me?$select=displayName,mail,userPrincipalName", None).await
    }

    /// Turn a Graph message (body + attachment list) into a [`MessageBody`],
    /// embedding inline images referenced as `cid:`.
    async fn to_body(&self, message_id: &str, m: GFullMessage) -> Result<MessageBody> {
        let (mut html, text) = match m.body {
            Some(b) if b.content_type.eq_ignore_ascii_case("html") => (Some(b.content), None),
            Some(b) => (None, Some(b.content)),
            None => (None, None),
        };
        let mut attachments: Vec<AttachmentInfo> = m
            .attachments
            .into_iter()
            .map(|a| AttachmentInfo {
                id: a.id,
                name: a.name.unwrap_or_else(|| ondura_i18n::tr!("Anhang")),
                content_type: a.content_type.unwrap_or_else(|| "application/octet-stream".into()),
                size: a.size,
                is_inline: a.is_inline,
                content_id: None,
            })
            .collect();
        if let Some(h) = html.as_mut().filter(|h| h.contains("cid:")) {
            for a in attachments.iter_mut().filter(|a| a.is_inline && (a.size as usize) <= MAX_INLINE_IMAGE) {
                let Ok(full) = self.get_json::<GFileAttachment>(&format!("/me/messages/{message_id}/attachments/{}", a.id), None).await else {
                    continue;
                };
                let (Some(cid), Some(bytes)) = (full.content_id, full.content_bytes) else { continue };
                let Ok(data) = B64.decode(bytes) else { continue };
                let ct = full.content_type.unwrap_or_else(|| a.content_type.clone());
                *h = h.replace(&format!("cid:{}", cid.trim_start_matches('<').trim_end_matches('>')), &data_uri(&ct, &data));
                a.content_id = Some(cid);
            }
        }
        Ok(MessageBody { html, text, attachments, security: None })
    }

    /// Body of a message; S/MIME messages (which Graph shows as an
    /// `smime.p7m` attachment) are fetched as MIME and opened locally.
    async fn fetched(&self, message_id: &str, m: GFullMessage) -> Result<FetchedBody> {
        let smime = m.attachments.iter().any(|a| {
            a.name.as_deref().is_some_and(|n| n.eq_ignore_ascii_case("smime.p7m"))
                || a.content_type.as_deref().is_some_and(|c| c.contains("pkcs7-mime") || c.contains("multipart/signed"))
        });
        if smime {
            let raw = self.request(Method::GET, &format!("/me/messages/{message_id}/$value"), None, None).await?.bytes().await.map_err(Error::network)?.to_vec();
            return Ok(FetchedBody { body: ondura_mail_core::preview::parse_body(&raw), raw: Some(raw), recipients: None });
        }
        Ok(FetchedBody { body: self.to_body(message_id, m).await?, raw: None, recipients: None })
    }

    /// Send a complete MIME message (used for S/MIME, which Graph's JSON
    /// messages cannot express).
    async fn send_mime(&self, raw: &[u8]) -> Result<()> {
        let url = format!("{}{}", self.base, self.path("/me/sendMail"));
        let body = B64.encode(raw);
        for attempt in 0..2 {
            let token = match self.scope {
                Some(scope) => self.tokens.scoped_token(scope).await?,
                None => self.tokens.access_token().await?,
            };
            let resp = self.http.post(&url).bearer_auth(token).header("Content-Type", "text/plain").body(body.clone()).send().await.map_err(Error::network)?;
            match resp.status() {
                StatusCode::UNAUTHORIZED if attempt == 0 => self.tokens.invalidate().await,
                s if s.is_success() => return Ok(()),
                s => {
                    let text = resp.text().await.unwrap_or_default();
                    return Err(Error::Protocol(format!("{s}: {text}")));
                }
            }
        }
        Err(Error::Auth(ondura_i18n::tr!("Microsoft hat die Anmeldung abgelehnt")))
    }

    fn message_json(m: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Value {
        let recipients = |list: &[Address]| -> Vec<Value> {
            list.iter()
                .map(|a| json!({ "emailAddress": { "address": a.email, "name": a.name.clone().unwrap_or_default() } }))
                .collect()
        };
        let mut msg = json!({
            "subject": m.subject,
            "body": { "contentType": "HTML", "content": m.body_html },
            "toRecipients": recipients(&m.to),
            "ccRecipients": recipients(&m.cc),
            "bccRecipients": recipients(&m.bcc),
        });
        if !attachments.is_empty() {
            msg["attachments"] = attachments
                .iter()
                .map(|a| {
                    json!({
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": a.name,
                        "contentType": a.content_type,
                        "contentBytes": B64.encode(&a.data),
                    })
                })
                .collect();
        }
        msg
    }

    /// Create a draft in "Drafts"; large attachments are uploaded in chunks.
    /// Returns the id of the new message.
    async fn create_draft(&self, m: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<String> {
        let total: usize = attachments.iter().map(|a| a.data.len()).sum();
        let (small, large): (Vec<_>, Vec<_>) = if total <= INLINE_ATTACHMENT_LIMIT {
            (attachments.to_vec(), Vec::new())
        } else {
            attachments.iter().cloned().partition(|a| a.data.len() < 1024 * 1024)
        };
        let created: Value = self
            .request(Method::POST, "/me/messages", Some(&Self::message_json(m, &small)), None)
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        let id = created["id"].as_str().ok_or_else(|| Error::protocol("draft without id"))?.to_string();
        for a in &large {
            self.upload_attachment(&id, a).await?;
        }
        Ok(id)
    }

    /// Files too large for Exchange: upload them to OneDrive ("Ondura-Anlagen")
    /// and add sharing links to the message body.
    async fn share_large(&self, m: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<(OutgoingMessage, Vec<ResolvedAttachment>)> {
        let (huge, rest): (Vec<_>, Vec<_>) = attachments.iter().cloned().partition(|a| a.data.len() > MAX_ATTACHMENT);
        if huge.is_empty() {
            return Ok((m.clone(), rest));
        }
        let token = self.tokens.files_token().await?;
        let mut links = String::new();
        for a in &huge {
            let url = self.upload_to_onedrive(&token, a).await?;
            let mb = a.data.len() as f64 / 1024.0 / 1024.0;
            links.push_str(&format!(
                r#"<li><a href="{}">{}</a> ({:.0} MB)</li>"#,
                html_escape(&url),
                html_escape(&a.name),
                mb
            ));
        }
        let mut out = m.clone();
        out.body_html.push_str(&format!(
            r#"<div style="margin-top:16px;padding:10px 14px;border:1px solid #d1d1d1;border-radius:6px;font-family:Segoe UI,sans-serif;font-size:13px"><b>Über OneDrive geteilte Dateien</b><ul style="margin:6px 0 0;padding-left:18px">{links}</ul></div>"#
        ));
        Ok((out, rest))
    }

    /// Upload a file to OneDrive in chunks and return a sharing link.
    async fn upload_to_onedrive(&self, token: &str, a: &ResolvedAttachment) -> Result<String> {
        let name: String = a.name.chars().map(|c| if r#"\/:*?"<>|#%"#.contains(c) { '_' } else { c }).collect();
        let session: Value = self
            .http
            .post(format!("{}/me/drive/root:/Ondura-Anlagen/{}:/createUploadSession", self.base, urlencoding(&name)))
            .bearer_auth(token)
            .json(&json!({ "item": { "@microsoft.graph.conflictBehavior": "rename" } }))
            .send()
            .await
            .map_err(Error::network)?
            .error_for_status()
            .map_err(|e| Error::Protocol(format!("OneDrive: {e}")))?
            .json()
            .await
            .map_err(Error::network)?;
        let url = session["uploadUrl"].as_str().ok_or_else(|| Error::protocol("upload session without url"))?;
        let len = a.data.len();
        let mut item = Value::Null;
        for (i, chunk) in a.data.chunks(UPLOAD_CHUNK).enumerate() {
            let start = i * UPLOAD_CHUNK;
            let end = start + chunk.len() - 1;
            let resp = self
                .http
                .put(url)
                .header("Content-Range", format!("bytes {start}-{end}/{len}"))
                .header("Content-Length", chunk.len())
                .body(chunk.to_vec())
                .send()
                .await
                .map_err(Error::network)?;
            if !resp.status().is_success() {
                return Err(Error::Protocol(format!("OneDrive-Upload fehlgeschlagen: {}", resp.status())));
            }
            // The last chunk answers with the new drive item.
            if end + 1 == len {
                item = resp.json().await.unwrap_or(Value::Null);
            }
        }
        let id = item["id"].as_str().ok_or_else(|| Error::protocol("OneDrive upload without item"))?;
        // Organisation links for work accounts; personal accounts only know anonymous links.
        for scope in ["organization", "anonymous"] {
            let resp = self
                .http
                .post(format!("{}/me/drive/items/{id}/createLink", self.base))
                .bearer_auth(token)
                .json(&json!({ "type": "view", "scope": scope }))
                .send()
                .await
                .map_err(Error::network)?;
            if resp.status().is_success() {
                let link: Value = resp.json().await.map_err(Error::network)?;
                if let Some(url) = link["link"]["webUrl"].as_str() {
                    return Ok(url.to_string());
                }
            }
        }
        // Fall back to the item's own address (visible to the sender only).
        Ok(item["webUrl"].as_str().unwrap_or_default().to_string())
    }

    async fn upload_attachment(&self, message_id: &str, a: &ResolvedAttachment) -> Result<()> {
        let session: Value = self
            .request(
                Method::POST,
                &format!("/me/messages/{message_id}/attachments/createUploadSession"),
                Some(&json!({ "AttachmentItem": { "attachmentType": "file", "name": a.name, "size": a.data.len(), "contentType": a.content_type } })),
                None,
            )
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        let url = session["uploadUrl"].as_str().ok_or_else(|| Error::protocol("upload session without url"))?;
        let len = a.data.len();
        for (i, chunk) in a.data.chunks(UPLOAD_CHUNK).enumerate() {
            let start = i * UPLOAD_CHUNK;
            let end = start + chunk.len() - 1;
            // The upload URL is pre-authenticated; it must not get a bearer token.
            let resp = self
                .http
                .put(url)
                .header("Content-Range", format!("bytes {start}-{end}/{len}"))
                .header("Content-Length", chunk.len())
                .body(chunk.to_vec())
                .send()
                .await
                .map_err(Error::network)?;
            if !resp.status().is_success() {
                return Err(Error::Protocol(format!("attachment upload failed: {}", resp.status())));
            }
        }
        Ok(())
    }

    async fn collect_folders(&self, url: String, out: &mut Vec<GFolder>) -> Result<()> {
        let mut next = Some(url);
        while let Some(url) = next {
            let page: Page<GFolder> = self.get_json(&url, None).await?;
            next = page.next_link;
            for f in page.value {
                if f.child_folder_count > 0 {
                    Box::pin(self.collect_folders(
                        format!("/me/mailFolders/{}/childFolders?$top=250&includeHiddenFolders=false", f.id),
                        out,
                    ))
                    .await?;
                }
                out.push(f);
            }
        }
        Ok(())
    }

    /// Resolve the ids of the well-known folders with a single `$batch` call.
    async fn well_known(&self) -> Result<Vec<(String, FolderRole)>> {
        let names = [
            ("inbox", FolderRole::Inbox),
            ("drafts", FolderRole::Drafts),
            ("sentitems", FolderRole::Sent),
            ("deleteditems", FolderRole::Trash),
            ("junkemail", FolderRole::Junk),
            ("archive", FolderRole::Archive),
        ];
        let requests: Vec<Value> = names
            .iter()
            .map(|(n, _)| json!({ "id": n, "method": "GET", "url": self.path(&format!("/me/mailFolders/{n}?$select=id")) }))
            .collect();
        let resp: Value = self
            .request(Method::POST, "/$batch", Some(&json!({ "requests": requests })), None)
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        let mut out = Vec::new();
        for r in resp["responses"].as_array().into_iter().flatten() {
            if r["status"].as_u64() != Some(200) {
                continue;
            }
            let (Some(name), Some(id)) = (r["id"].as_str(), r["body"]["id"].as_str()) else { continue };
            if let Some((_, role)) = names.iter().find(|(n, _)| *n == name) {
                out.push((id.to_string(), *role));
            }
        }
        Ok(out)
    }

    fn initial_delta_url(folder_id: &str) -> String {
        let since = (Utc::now() - chrono::Duration::days(INITIAL_DAYS)).format("%Y-%m-%dT%H:%M:%SZ");
        format!("/me/mailFolders/{folder_id}/messages/delta?$select={MESSAGE_SELECT}&$filter=receivedDateTime+ge+{since}")
    }

    async fn run_delta(&self, start: String, reset: bool) -> Result<FolderChanges> {
        let mut changes = FolderChanges { reset, ..Default::default() };
        let mut next = Some(start);
        while let Some(url) = next {
            let page: Page<GMessage> = self.get_json(&url, Some("odata.maxpagesize=100")).await?;
            for m in page.value {
                if m.removed.is_some() {
                    changes.removed.push(m.id);
                } else if m.subject.is_none() && m.received_date_time.is_none() {
                    // Partial update: only flags changed.
                    changes.flags.push(RemoteFlags {
                        is_flagged: m.is_flagged(),
                        is_read: m.is_read.unwrap_or(false),
                        remote_id: m.id,
                    });
                } else {
                    changes.upserted.push(m.into_remote());
                }
            }
            if page.delta_link.is_some() {
                changes.new_state = page.delta_link;
            }
            next = page.next_link;
        }
        debug!(upserted = changes.upserted.len(), removed = changes.removed.len(), "delta page set processed");
        Ok(changes)
    }
}

#[async_trait]
impl MailProvider for GraphProvider {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        let mut raw = Vec::new();
        self.collect_folders("/me/mailFolders?$top=250&includeHiddenFolders=false".into(), &mut raw).await?;
        let roles = self.well_known().await.unwrap_or_default();
        let ids: std::collections::HashSet<String> = raw.iter().map(|f| f.id.clone()).collect();
        Ok(raw
            .into_iter()
            .map(|f| RemoteFolder {
                role: roles.iter().find(|(id, _)| *id == f.id).map(|(_, r)| *r).unwrap_or(FolderRole::Other),
                parent_remote_id: f.parent_folder_id.filter(|p| ids.contains(p)),
                remote_id: f.id,
                name: f.display_name,
                unread_count: f.unread_item_count,
                total_count: f.total_item_count,
                selectable: true,
            })
            .collect())
    }

    async fn sync_folder(&self, folder: &RemoteFolder, state: Option<&str>) -> Result<FolderChanges> {
        match state {
            Some(delta_link) => match self.run_delta(delta_link.to_string(), false).await {
                // Expired / invalid delta token: start over.
                Err(Error::Protocol(m)) if m.starts_with("gone") || m.contains("syncStateNotFound") => {
                    self.run_delta(Self::initial_delta_url(&folder.remote_id), true).await
                }
                other => other,
            },
            None => self.run_delta(Self::initial_delta_url(&folder.remote_id), true).await,
        }
    }

    async fn fetch_body(&self, _folder: &str, message_remote_id: &str) -> Result<FetchedBody> {
        let m: GFullMessage = self.get_json(&format!("/me/messages/{message_remote_id}{BODY_URL_SUFFIX}"), Some(PREFER_HTML)).await?;
        self.fetched(message_remote_id, m).await
    }

    /// Bodies in batches of 20 via `$batch`.
    async fn fetch_bodies(&self, _folder: &str, message_remote_ids: &[String]) -> Result<Vec<(String, FetchedBody)>> {
        let mut out = Vec::with_capacity(message_remote_ids.len());
        for chunk in message_remote_ids.chunks(20) {
            let requests: Vec<Value> = chunk
                .iter()
                .map(|id| json!({ "id": id, "method": "GET", "url": self.path(&format!("/me/messages/{id}{BODY_URL_SUFFIX}")), "headers": { "Prefer": PREFER_HTML } }))
                .collect();
            let resp: Value = self
                .request(Method::POST, "/$batch", Some(&json!({ "requests": requests })), None)
                .await?
                .json()
                .await
                .map_err(Error::network)?;
            for r in resp["responses"].as_array().into_iter().flatten() {
                let (Some(id), Some(200)) = (r["id"].as_str(), r["status"].as_u64()) else { continue };
                let Ok(m) = serde_json::from_value::<GFullMessage>(r["body"].clone()) else { continue };
                out.push((id.to_string(), self.fetched(id, m).await?));
            }
        }
        Ok(out)
    }

    async fn fetch_older(
        &self,
        folder: &RemoteFolder,
        _known: &HashSet<String>,
        oldest_date: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<RemoteMessage>> {
        let mut url = format!(
            "/me/mailFolders/{}/messages?$select={MESSAGE_SELECT}&$orderby=receivedDateTime+desc&$top={}",
            folder.remote_id,
            limit.min(250)
        );
        if let Some(d) = oldest_date {
            url.push_str(&format!("&$filter=receivedDateTime+lt+{}", d.format("%Y-%m-%dT%H:%M:%SZ")));
        }
        let page: Page<GMessage> = self.get_json(&url, None).await?;
        Ok(page.value.into_iter().map(GMessage::into_remote).collect())
    }

    async fn fetch_attachment(&self, _folder: &str, message_remote_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let resp = self
            .request(Method::GET, &format!("/me/messages/{message_remote_id}/attachments/{attachment_id}/$value"), None, None)
            .await?;
        Ok(resp.bytes().await.map_err(Error::network)?.to_vec())
    }

    async fn set_flags(&self, _folder: &str, message_remote_id: &str, read: Option<bool>, flagged: Option<bool>) -> Result<()> {
        let mut patch = serde_json::Map::new();
        if let Some(r) = read {
            patch.insert("isRead".into(), json!(r));
        }
        if let Some(f) = flagged {
            patch.insert("flag".into(), json!({ "flagStatus": if f { "flagged" } else { "notFlagged" } }));
        }
        self.request(Method::PATCH, &format!("/me/messages/{message_remote_id}"), Some(&Value::Object(patch)), None)
            .await?;
        Ok(())
    }

    async fn set_categories(&self, _folder: &str, message_remote_id: &str, categories: &[String]) -> Result<()> {
        self.request(Method::PATCH, &format!("/me/messages/{message_remote_id}"), Some(&json!({ "categories": categories })), None)
            .await?;
        Ok(())
    }

    async fn search(&self, query: &str, limit: usize) -> Result<Vec<(String, RemoteMessage)>> {
        let q = percent_encode(&format!("\"{}\"", query.replace('"', " ").trim()));
        let page: Value = self.get_json(&format!("/me/messages?$search={q}&$top={}&$select={MESSAGE_SELECT}", limit.min(250)), None).await?;
        let mut out: Vec<(String, RemoteMessage)> = page["value"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| serde_json::from_value::<GMessage>(v).ok())
            .filter_map(|m| Some((m.parent_folder_id.clone()?, m.into_remote())))
            .collect();
        out.sort_by_key(|h| std::cmp::Reverse(h.1.date));
        Ok(out)
    }

    async fn move_message(&self, _folder: &str, message_remote_id: &str, target_folder_remote_id: &str) -> Result<Option<String>> {
        let resp: Value = self
            .request(
                Method::POST,
                &format!("/me/messages/{message_remote_id}/move"),
                Some(&json!({ "destinationId": target_folder_remote_id })),
                None,
            )
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        Ok(resp["id"].as_str().map(str::to_string))
    }

    async fn delete_message(&self, _folder: &str, message_remote_id: &str) -> Result<()> {
        self.request(Method::POST, &format!("/me/messages/{message_remote_id}/permanentDelete"), None, None)
            .await?;
        Ok(())
    }

    async fn send(&self, m: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        if m.sign || m.encrypt {
            let me = self.me().await?;
            let from = Address::new(me.display_name.clone(), me.email());
            let raw = ondura_mail_imap::build_message(&from, m, attachments)?.formatted();
            let raw = ondura_mail_core::smime::protect_outgoing(raw, &from.email, m)?;
            return self.send_mime(&raw).await;
        }
        let (m, attachments) = self.share_large(m, attachments).await?;
        let (m, attachments) = (&m, attachments.as_slice());
        let total: usize = attachments.iter().map(|a| a.data.len()).sum();
        if total <= INLINE_ATTACHMENT_LIMIT {
            let body = json!({ "message": Self::message_json(m, attachments), "saveToSentItems": true });
            self.request(Method::POST, "/me/sendMail", Some(&body), None).await?;
        } else {
            // Large attachments: draft + upload sessions, then send the draft.
            let id = self.create_draft(m, attachments).await?;
            self.request(Method::POST, &format!("/me/messages/{id}/send"), None, None).await?;
        }
        Ok(())
    }

    async fn auto_reply(&self) -> Result<AutoReply> {
        let v: Value = self
            .send(Method::GET, "/me/mailboxSettings/automaticRepliesSetting", None, None, Some(auth::SETTINGS_SCOPE))
            .await?
            .json()
            .await
            .map_err(Error::network)?;
        Ok(parse_auto_reply(&v))
    }

    async fn set_auto_reply(&self, reply: &AutoReply) -> Result<()> {
        let body = json!({ "automaticRepliesSetting": auto_reply_json(reply) });
        self.send(Method::PATCH, "/me/mailboxSettings", Some(&body), None, Some(auth::SETTINGS_SCOPE)).await.map(|_| ())
    }

    async fn save_draft(&self, m: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        let (m, attachments) = self.share_large(m, attachments).await?;
        self.create_draft(&m, &attachments).await.map(|_| ())
    }
}

/// Percent-encode a path segment (OneDrive file names).
fn graph_time(v: &Value) -> Option<DateTime<Utc>> {
    // Graph answers in the time zone it was given; Ondura always sends UTC.
    let text = v["dateTime"].as_str()?;
    let naive = chrono::NaiveDateTime::parse_from_str(text.trim_end_matches('Z'), "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    Some(naive.and_utc())
}

fn parse_auto_reply(v: &Value) -> AutoReply {
    let status = v["status"].as_str().unwrap_or("disabled");
    let scheduled = status == "scheduled";
    AutoReply {
        enabled: status != "disabled",
        start: if scheduled { graph_time(&v["scheduledStartDateTime"]) } else { None },
        end: if scheduled { graph_time(&v["scheduledEndDateTime"]) } else { None },
        internal: v["internalReplyMessage"].as_str().unwrap_or_default().to_string(),
        external: v["externalReplyMessage"].as_str().unwrap_or_default().to_string(),
        external_audience: match v["externalAudience"].as_str() {
            Some("none") => ExternalAudience::None,
            Some("contactsOnly") => ExternalAudience::Known,
            _ => ExternalAudience::All,
        },
    }
}

fn auto_reply_json(r: &AutoReply) -> Value {
    let status = match (r.enabled, r.start.zip(r.end)) {
        (false, _) => "disabled",
        (true, Some(_)) => "scheduled",
        (true, None) => "alwaysEnabled",
    };
    let mut v = json!({
        "status": status,
        "externalAudience": match r.external_audience { ExternalAudience::None => "none", ExternalAudience::Known => "contactsOnly", ExternalAudience::All => "all" },
        "internalReplyMessage": r.internal,
        "externalReplyMessage": r.external,
    });
    if let Some((start, end)) = r.start.zip(r.end) {
        let t = |d: DateTime<Utc>| json!({ "dateTime": d.format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone": "UTC" });
        v["scheduledStartDateTime"] = t(start);
        v["scheduledEndDateTime"] = t(end);
    }
    v
}

/// Explanation for a permission that was never granted.
fn consent_message(scope: &str) -> String {
    if scope == auth::PLACES_SCOPE {
        "Die Raumliste braucht die Berechtigung „Place.Read.All“, die ein Administrator des Microsoft-365-Mandanten freigeben muss.".into()
    } else {
        "Für diese Funktion braucht Ondura eine zusätzliche Berechtigung – bitte melden Sie das Konto neu an (Konten › Neu anmelden).".into()
    }
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_onedrive_names() {
        assert_eq!(urlencoding("Bericht Q4 (final).pdf"), "Bericht%20Q4%20%28final%29.pdf");
        assert_eq!(urlencoding("Grüße.zip"), "Gr%C3%BC%C3%9Fe.zip");
    }

    #[test]
    fn parses_delta_page() {
        let json = r#"{
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/x/messages/delta?$deltatoken=abc",
          "value": [
            { "id": "A", "subject": "Hallo", "receivedDateTime": "2026-11-17T09:00:00Z", "isRead": false,
              "from": { "emailAddress": { "name": "Alice", "address": "alice@contoso.com" } },
              "toRecipients": [], "flag": { "flagStatus": "flagged" }, "importance": "high", "hasAttachments": true },
            { "id": "B", "@removed": { "reason": "deleted" } },
            { "id": "C", "isRead": true, "flag": { "flagStatus": "notFlagged" } }
          ]
        }"#;
        let page: Page<GMessage> = serde_json::from_str(json).unwrap();
        assert!(page.delta_link.is_some());
        let mut it = page.value.into_iter();
        let a = it.next().unwrap().into_remote();
        assert!(a.is_flagged && !a.is_read && a.has_attachments);
        assert_eq!(a.importance, Importance::High);
        assert_eq!(a.from.unwrap().email, "alice@contoso.com");
        assert!(it.next().unwrap().removed.is_some());
        let c = it.next().unwrap();
        assert!(c.subject.is_none() && c.is_read == Some(true));
    }

    #[test]
    fn auto_reply_round_trip() {
        let r = AutoReply {
            enabled: true,
            start: Some("2026-12-20T08:00:00Z".parse().unwrap()),
            end: Some("2027-01-06T17:00:00Z".parse().unwrap()),
            internal: "<p>Bin im Urlaub</p>".into(),
            external: "<p>Out of office</p>".into(),
            external_audience: ExternalAudience::Known,
        };
        let v = auto_reply_json(&r);
        assert_eq!(v["status"], "scheduled");
        assert_eq!(v["externalAudience"], "contactsOnly");
        assert_eq!(v["scheduledStartDateTime"]["dateTime"], "2026-12-20T08:00:00");
        assert_eq!(parse_auto_reply(&v), r);
        let off = parse_auto_reply(&json!({ "status": "disabled", "externalAudience": "all" }));
        assert!(!off.enabled && off.start.is_none());
    }

    #[test]
    fn shared_mailbox_paths() {
        let secrets: Arc<dyn SecretStore> = Arc::new(ondura_mail_core::MemorySecretStore::default());
        let g = GraphProvider::shared("common".into(), "id".into(), secrets, "k".into(), "team@example.com");
        assert_eq!(g.path("/me/mailFolders?$top=1"), "/users/team%40example.com/mailFolders?$top=1");
        assert_eq!(g.path("/me?$select=mail"), "/users/team%40example.com?$select=mail");
        assert_eq!(g.path("/me/drive/root"), "/me/drive/root");
        assert_eq!(g.path("/$batch"), "/$batch");
    }

    #[test]
    fn http_client_builds() {
        let _ = http_client();
    }
}
