//! Exchange Web Services adapter for Exchange Server on-premises
//! (2013 SP1 and newer). Exchange Online is handled by Microsoft Graph,
//! since Microsoft removes EWS from Exchange Online in 2026/27.
//!
//! * Sync: `SyncFolderItems` with the server's sync state (incremental,
//!   resumable; at most [`MAX_SYNC_PAGES`] pages per call).
//! * Bodies: `GetItem` with MIME content, parsed like IMAP messages, so
//!   attachments and inline images work the same way.
//! * Sending: `CreateItem` with MIME content (`SendAndSaveCopy`).
//! * Authentication: NTLMv2 (the on-premises default) or Basic, detected
//!   from the server's `WWW-Authenticate` header.

mod ntlm;
pub mod pim;
pub use ondura_mail_core::xml;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use chrono::{DateTime, Utc};
use ondura_mail_core::model::{Address, AutoReply, EwsConfig, ExternalAudience, FolderRole, Importance, OutgoingMessage, ResolvedAttachment};
use ondura_mail_core::preview::{parse_body, parse_headers};
use ondura_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, Recipients, RemoteFlags, RemoteFolder, RemoteMessage};
use ondura_mail_core::{Error, Result};
use reqwest::StatusCode;
use tokio::sync::Mutex;
use tracing::debug;

use ondura_mail_core::xml::{Node, escape};

const MAX_SYNC_PAGES: usize = 4;
const PAGE_SIZE: usize = 512;
const BODY_BATCH: usize = 10;

/// Properties requested for list views (SyncFolderItems / FindItem).
const ITEM_PROPERTIES: &str = r#"<t:AdditionalProperties>
<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="item:DisplayTo"/>
<t:FieldURI FieldURI="item:DisplayCc"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="message:IsRead"/>
<t:FieldURI FieldURI="item:HasAttachments"/><t:FieldURI FieldURI="item:Importance"/><t:FieldURI FieldURI="message:InternetMessageId"/>
<t:FieldURI FieldURI="item:Flag"/><t:FieldURI FieldURI="item:Preview"/><t:FieldURI FieldURI="item:Categories"/>
<t:FieldURI FieldURI="item:ParentFolderId"/>
</t:AdditionalProperties>"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthMode {
    Unknown,
    Basic,
    Ntlm,
}

pub struct EwsProvider {
    url: String,
    username: String,
    password: String,
    from: Address,
    http: reqwest::Client,
    /// Separate connection for streaming notifications (long requests must
    /// not block the serialised SOAP calls).
    stream_http: reqwest::Client,
    subscription: Mutex<Option<String>>,
    auth: Mutex<AuthMode>,
    /// Remote ids of well-known folders, learned from `list_folders`.
    well_known: std::sync::Mutex<HashMap<&'static str, String>>,
    /// Shared mailbox opened with this user's rights (`None` = own mailbox).
    mailbox: Option<String>,
}

/// Point every `DistinguishedFolderId` of a request at `mailbox`.
fn qualify(body: &str, mailbox: Option<&str>) -> String {
    let Some(mailbox) = mailbox else { return body.to_string() };
    const TAG: &str = "<t:DistinguishedFolderId ";
    let qualified = format!("><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:DistinguishedFolderId>", escape(mailbox));
    let mut out = String::with_capacity(body.len() + 128);
    let mut rest = body;
    while let Some(i) = rest.find(TAG) {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find('>') else { break };
        if rest[..end].ends_with('/') {
            out.push_str(&rest[..end - 1]);
            out.push_str(&qualified);
        } else {
            out.push_str(&rest[..=end]);
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

fn oof_time(node: Option<&Node>, name: &str) -> Option<DateTime<Utc>> {
    node?.text_of(name)?.parse().ok()
}

fn parse_oof(doc: &Node) -> Result<AutoReply> {
    if let Some(m) = doc.find("ResponseMessage")
        && m.attr("ResponseClass") == Some("Error")
    {
        return Err(Error::Protocol(m.text_of("MessageText").unwrap_or("GetUserOofSettings").to_string()));
    }
    let s = doc.find("OofSettings").ok_or_else(|| Error::protocol("no OofSettings in EWS response"))?;
    let state = s.text_of("OofState").unwrap_or("Disabled");
    let duration = s.child("Duration");
    let scheduled = state == "Scheduled";
    let reply = |n: &str| s.child(n).and_then(|r| r.text_of("Message")).unwrap_or_default().to_string();
    Ok(AutoReply {
        enabled: state != "Disabled",
        start: if scheduled { oof_time(duration, "StartTime") } else { None },
        end: if scheduled { oof_time(duration, "EndTime") } else { None },
        internal: reply("InternalReply"),
        external: reply("ExternalReply"),
        external_audience: match s.text_of("ExternalAudience") {
            Some("None") => ExternalAudience::None,
            Some("Known") => ExternalAudience::Known,
            _ => ExternalAudience::All,
        },
    })
}

fn oof_request(address: &str, r: &AutoReply) -> String {
    let state = match (r.enabled, r.start.zip(r.end)) {
        (false, _) => "Disabled",
        (true, Some(_)) => "Scheduled",
        (true, None) => "Enabled",
    };
    let audience = match r.external_audience {
        ExternalAudience::None => "None",
        ExternalAudience::Known => "Known",
        ExternalAudience::All => "All",
    };
    // A duration is required by some servers even when not scheduled.
    let (start, end) = r.start.zip(r.end).unwrap_or_else(|| (Utc::now(), Utc::now() + chrono::Duration::days(1)));
    let t = |d: DateTime<Utc>| d.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    format!(
        r#"<m:SetUserOofSettingsRequest><t:Mailbox><t:Address>{}</t:Address></t:Mailbox><t:UserOofSettings><t:OofState>{state}</t:OofState><t:ExternalAudience>{audience}</t:ExternalAudience><t:Duration><t:StartTime>{}</t:StartTime><t:EndTime>{}</t:EndTime></t:Duration><t:InternalReply><t:Message>{}</t:Message></t:InternalReply><t:ExternalReply><t:Message>{}</t:Message></t:ExternalReply></t:UserOofSettings></m:SetUserOofSettingsRequest>"#,
        escape(address),
        t(start),
        t(end),
        escape(&r.internal),
        escape(&r.external)
    )
}

fn envelope(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
<soap:Header><t:RequestServerVersion Version="Exchange2013_SP1"/></soap:Header>
<soap:Body>{body}</soap:Body>
</soap:Envelope>"#
    )
}

fn item_ids(ids: &[String]) -> String {
    ids.iter().map(|id| format!(r#"<t:ItemId Id="{}"/>"#, escape(id))).collect()
}

fn parse_bool(s: Option<&str>) -> bool {
    s.is_some_and(|v| v.eq_ignore_ascii_case("true"))
}

fn mailbox(node: Option<&Node>) -> Option<Address> {
    let mb = node?.find("Mailbox")?;
    let name = mb.text_of("Name").map(str::to_string).filter(|n| !n.is_empty());
    let email = mb.text_of("EmailAddress").unwrap_or_default();
    // Internal senders may come as an Exchange DN (/O=…); keep the name then.
    let email = if email.starts_with('/') { String::new() } else { email.to_string() };
    if email.is_empty() && name.is_none() {
        return None;
    }
    Some(Address::new(name, email))
}

/// "Anna Schmitt; Max Becker" → name-only addresses (filled in with real
/// addresses once the MIME body is downloaded).
fn display_list(s: Option<&str>) -> Vec<Address> {
    s.unwrap_or_default()
        .split(';')
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| Address::new(Some(n.to_string()), ""))
        .collect()
}

fn parse_item(item: &Node) -> Option<RemoteMessage> {
    let id = item.child("ItemId")?.attr("Id")?.to_string();
    Some(RemoteMessage {
        remote_id: id,
        subject: item.text_of("Subject").unwrap_or_default().to_string(),
        from: mailbox(item.child("From")),
        to: display_list(item.text_of("DisplayTo")),
        cc: display_list(item.text_of("DisplayCc")),
        date: item
            .text_of("DateTimeReceived")
            .and_then(|d| DateTime::parse_from_rfc3339(d).ok())
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
        preview: item.text_of("Preview").unwrap_or_default().to_string(),
        is_read: parse_bool(item.text_of("IsRead")),
        is_flagged: item.child("Flag").and_then(|f| f.text_of("FlagStatus")) == Some("Flagged"),
        has_attachments: parse_bool(item.text_of("HasAttachments")),
        importance: match item.text_of("Importance") {
            Some("High") => Importance::High,
            Some("Low") => Importance::Low,
            _ => Importance::Normal,
        },
        internet_message_id: item.text_of("InternetMessageId").map(str::to_string),
        categories: Some(
            item.child("Categories")
                .map(|c| c.children_named("String").map(|s| s.text.clone()).filter(|t| !t.is_empty()).collect())
                .unwrap_or_default(),
        ),
    })
}

/// Error from the first failed response message, if any.
fn check_responses(doc: &Node) -> Result<()> {
    if let Some(fault) = doc.find("Fault") {
        let msg = fault.text_of("faultstring").unwrap_or("SOAP fault");
        return Err(Error::Protocol(msg.to_string()));
    }
    let Some(messages) = doc.find("ResponseMessages") else {
        return Err(Error::protocol("no ResponseMessages in EWS response"));
    };
    for m in &messages.children {
        if m.attr("ResponseClass") == Some("Error") {
            let code = m.text_of("ResponseCode").unwrap_or("Error");
            let text = m.text_of("MessageText").unwrap_or_default();
            return Err(match code {
                "ErrorItemNotFound" | "ErrorFolderNotFound" => Error::NotFound(format!("{code}: {text}")),
                "ErrorInvalidSyncStateData" => Error::Protocol(format!("syncstate: {text}")),
                _ => Error::Protocol(format!("{code}: {text}")),
            });
        }
    }
    Ok(())
}

fn http_client() -> reqwest::Client {
    let mut tls = (*ondura_mail_core::net::tls_client_config()).clone();
    tls.alpn_protocols = vec![b"http/1.1".to_vec()];
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        // NTLM authenticates a TCP connection: HTTP/1.1, one connection.
        .http1_only()
        .pool_max_idle_per_host(1)
        .timeout(Duration::from_secs(120))
        .user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

fn stream_client() -> reqwest::Client {
    let mut tls = (*ondura_mail_core::net::tls_client_config()).clone();
    tls.alpn_protocols = vec![b"http/1.1".to_vec()];
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .http1_only()
        .pool_max_idle_per_host(1)
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

/// Event types that mean "the folder changed" in a streaming response.
const CHANGE_EVENTS: [&str; 5] = ["NewMailEvent", "CreatedEvent", "DeletedEvent", "ModifiedEvent", "MovedEvent"];

impl EwsProvider {
    pub fn new(config: EwsConfig, from: Address, password: String) -> Arc<Self> {
        Arc::new(Self {
            url: config.url,
            username: config.username,
            password,
            from,
            http: http_client(),
            stream_http: stream_client(),
            subscription: Mutex::new(None),
            auth: Mutex::new(AuthMode::Unknown),
            well_known: std::sync::Mutex::default(),
            mailbox: config.mailbox.filter(|m| !m.trim().is_empty()),
        })
    }

    async fn post(&self, body: &str, authorization: Option<String>, basic: bool) -> Result<reqwest::Response> {
        self.post_with(&self.http, body, authorization, basic).await
    }

    async fn post_with(&self, client: &reqwest::Client, body: &str, authorization: Option<String>, basic: bool) -> Result<reqwest::Response> {
        let mut req = client
            .post(&self.url)
            .header("Content-Type", "text/xml; charset=utf-8")
            .body(body.to_string());
        if basic {
            req = req.basic_auth(&self.username, Some(&self.password));
        } else if let Some(a) = authorization {
            req = req.header("Authorization", a);
        }
        req.send().await.map_err(Error::network)
    }

    fn challenge_of(resp: &reqwest::Response) -> Option<String> {
        resp.headers()
            .get_all("WWW-Authenticate")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|v| v.strip_prefix("NTLM ").map(str::to_string))
    }

    fn offers(resp: &reqwest::Response, scheme: &str) -> bool {
        resp.headers()
            .get_all("WWW-Authenticate")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .any(|v| v.split_whitespace().next().is_some_and(|s| s.eq_ignore_ascii_case(scheme)))
    }

    /// One authenticated SOAP call. Calls are serialised so the NTLM
    /// handshake stays on one connection.
    pub(crate) async fn call(&self, body: &str) -> Result<Node> {
        let doc = self.call_lenient(body).await?;
        check_responses(&doc)?;
        Ok(doc)
    }

    /// Like [`Self::call`] but leaves per-item errors to the caller (for
    /// batch requests where single items may fail).
    pub(crate) async fn call_lenient(&self, body: &str) -> Result<Node> {
        let soap = envelope(&qualify(body, self.mailbox.as_deref()));
        let mut mode = self.auth.lock().await;
        let resp = match *mode {
            AuthMode::Basic => self.post(&soap, None, true).await?,
            AuthMode::Ntlm => self.ntlm_post(&soap).await?,
            AuthMode::Unknown => {
                let probe = self.post(&soap, None, false).await?;
                if probe.status() == StatusCode::UNAUTHORIZED {
                    let ntlm = Self::offers(&probe, "NTLM") || Self::offers(&probe, "Negotiate");
                    let basic = Self::offers(&probe, "Basic");
                    let _ = probe.bytes().await;
                    if ntlm {
                        *mode = AuthMode::Ntlm;
                        self.ntlm_post(&soap).await?
                    } else if basic {
                        *mode = AuthMode::Basic;
                        self.post(&soap, None, true).await?
                    } else {
                        return Err(Error::Auth("Der Server bietet weder NTLM noch Basic an".into()));
                    }
                } else {
                    probe
                }
            }
        };
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED {
            *mode = AuthMode::Unknown;
            return Err(Error::Auth("Benutzername oder Passwort wurde vom Exchange-Server abgelehnt".into()));
        }
        let text = resp.text().await.map_err(Error::network)?;
        drop(mode);
        if status.is_server_error() && !text.contains("Envelope") {
            return Err(Error::Network(format!("Exchange-Server antwortet mit {status}")));
        }
        let doc = Node::parse(&text).map_err(|e| Error::Protocol(format!("invalid EWS response ({status}): {e}")))?;
        if let Some(fault) = doc.find("Fault") {
            return Err(Error::Protocol(fault.text_of("faultstring").unwrap_or("SOAP fault").to_string()));
        }
        Ok(doc)
    }

    async fn ntlm_post(&self, soap: &str) -> Result<reqwest::Response> {
        self.ntlm_post_with(&self.http, soap).await
    }

    async fn ntlm_post_with(&self, client: &reqwest::Client, soap: &str) -> Result<reqwest::Response> {
        let first = self.post_with(client, soap, Some(format!("NTLM {}", ntlm::negotiate())), false).await?;
        if first.status() != StatusCode::UNAUTHORIZED {
            return Ok(first);
        }
        let challenge = Self::challenge_of(&first).and_then(|c| ntlm::parse_challenge(&c));
        // Read the body so the connection is reused for the second leg.
        let _ = first.bytes().await;
        let challenge = challenge.ok_or_else(|| Error::Auth("NTLM-Anmeldung: keine Challenge vom Server".into()))?;
        let auth = ntlm::authenticate(&challenge, &self.username, &self.password);
        self.post_with(client, soap, Some(format!("NTLM {auth}")), false).await
    }

    /// Streaming subscription for a folder (created on first use).
    async fn subscription_for(&self, folder_remote_id: &str) -> Result<String> {
        if let Some(id) = self.subscription.lock().await.clone() {
            return Ok(id);
        }
        let types: String = CHANGE_EVENTS.iter().map(|t| format!("<t:EventType>{t}</t:EventType>")).collect();
        let doc = self
            .call(&format!(
                r#"<m:Subscribe><m:StreamingSubscriptionRequest><t:FolderIds><t:FolderId Id="{}"/></t:FolderIds><t:EventTypes>{types}</t:EventTypes></m:StreamingSubscriptionRequest></m:Subscribe>"#,
                escape(folder_remote_id)
            ))
            .await?;
        let id = doc.find("SubscriptionId").map(|n| n.text.clone()).filter(|s| !s.is_empty()).ok_or_else(|| Error::Protocol("Subscribe ohne SubscriptionId".into()))?;
        *self.subscription.lock().await = Some(id.clone());
        Ok(id)
    }

    /// Push via EWS streaming notifications: holds a GetStreamingEvents
    /// request open and returns as soon as the server reports a change.
    async fn stream_changes(&self, folder_remote_id: &str, timeout: Duration) -> Result<bool> {
        let subscription = self.subscription_for(folder_remote_id).await?;
        let minutes = (timeout.as_secs() / 60).clamp(1, 30);
        let soap = envelope(&format!(
            r#"<m:GetStreamingEvents><m:SubscriptionIds><t:SubscriptionId>{}</t:SubscriptionId></m:SubscriptionIds><m:ConnectionTimeout>{minutes}</m:ConnectionTimeout></m:GetStreamingEvents>"#,
            escape(&subscription)
        ));
        let basic = matches!(*self.auth.lock().await, AuthMode::Basic);
        let mut resp = if basic {
            self.post_with(&self.stream_http, &soap, None, true).await?
        } else {
            self.ntlm_post_with(&self.stream_http, &soap).await?
        };
        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(Error::Auth("Exchange hat die Anmeldung für Benachrichtigungen abgelehnt".into()));
        }
        let mut seen = String::new();
        let read = async {
            while let Some(chunk) = resp.chunk().await.map_err(Error::network)? {
                seen.push_str(&String::from_utf8_lossy(&chunk));
                if CHANGE_EVENTS.iter().any(|e| seen.contains(&format!(":{e}>"))) {
                    return Ok(true);
                }
                if seen.contains("ErrorInvalidSubscription") || seen.contains("ErrorExpiredSubscription") || seen.contains("ErrorSubscriptionNotFound") {
                    *self.subscription.lock().await = None;
                    return Ok(false);
                }
                // Keep only the tail; events are short.
                if seen.len() > 64 * 1024 {
                    seen.drain(..seen.len() - 8 * 1024);
                }
            }
            Ok(false)
        };
        match tokio::time::timeout(Duration::from_secs(minutes * 60 + 30), read).await {
            Ok(r) => r,
            Err(_) => Ok(false),
        }
    }

    /// Verify URL and credentials (account setup).
    pub async fn test_login(&self) -> Result<()> {
        self.call(r#"<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="inbox"/></m:FolderIds></m:GetFolder>"#)
            .await
            .map(|_| ())
    }

    fn known(&self, key: &str) -> Option<String> {
        self.well_known.lock().unwrap().get(key).cloned()
    }

    async fn get_mime(&self, ids: &[String]) -> Result<Vec<(String, Vec<u8>)>> {
        let doc = self
            .call_lenient(&format!(
                r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape><m:ItemIds>{}</m:ItemIds></m:GetItem>"#,
                item_ids(ids)
            ))
            .await?;
        let mut out = Vec::new();
        let mut items = Vec::new();
        doc.find_all("Items", &mut items);
        for items in items {
            for item in &items.children {
                let (Some(id), Some(mime)) = (item.child("ItemId").and_then(|i| i.attr("Id")), item.text_of("MimeContent")) else {
                    continue;
                };
                let raw = B64.decode(mime.trim()).map_err(Error::protocol)?;
                out.push((id.to_string(), raw));
            }
        }
        Ok(out)
    }

    fn to_fetched(raw: Vec<u8>) -> FetchedBody {
        let headers = parse_headers(&raw);
        FetchedBody {
            body: parse_body(&raw),
            recipients: Some(Recipients { from: headers.from, to: headers.to, cc: headers.cc }),
            raw: Some(raw),
        }
    }

    fn mime_item(&self, m: &OutgoingMessage, attachments: &[ResolvedAttachment], draft: bool) -> Result<String> {
        let raw = ondura_mail_imap::build_message(&self.from, m, attachments)?.formatted();
        let bcc: String = if m.bcc.is_empty() {
            String::new()
        } else {
            let list: String = m
                .bcc
                .iter()
                .map(|a| format!("<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>", escape(&a.email)))
                .collect();
            format!("<t:BccRecipients>{list}</t:BccRecipients>")
        };
        // PR_MESSAGE_FLAGS = MSGFLAG_UNSENT marks a draft as editable in Outlook.
        let draft_flag = if draft {
            r#"<t:ExtendedProperty><t:ExtendedFieldURI PropertyTag="3591" PropertyType="Integer"/><t:Value>8</t:Value></t:ExtendedProperty>"#
        } else {
            ""
        };
        Ok(format!(
            r#"<t:Message><t:MimeContent CharacterSet="UTF-8">{}</t:MimeContent>{draft_flag}{bcc}</t:Message>"#,
            B64.encode(raw)
        ))
    }
}

#[async_trait]
impl MailProvider for EwsProvider {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        // Ids of well-known folders.
        let names = [
            ("msgfolderroot", None),
            ("inbox", Some(FolderRole::Inbox)),
            ("drafts", Some(FolderRole::Drafts)),
            ("sentitems", Some(FolderRole::Sent)),
            ("deleteditems", Some(FolderRole::Trash)),
            ("junkemail", Some(FolderRole::Junk)),
        ];
        let ids: String = names.iter().map(|(n, _)| format!(r#"<t:DistinguishedFolderId Id="{n}"/>"#)).collect();
        // Lenient: a mailbox without e.g. a junk folder must not lose the other roles.
        let doc = self
            .call_lenient(&format!(r#"<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds>{ids}</m:FolderIds></m:GetFolder>"#))
            .await;
        let mut roles: HashMap<String, FolderRole> = HashMap::new();
        let mut root = None;
        let mut known = HashMap::new();
        if let Ok(doc) = doc {
            let responses = doc.find("ResponseMessages").map(|r| r.children.clone()).unwrap_or_default();
            for ((name, role), resp) in names.iter().zip(responses.iter()) {
                if resp.attr("ResponseClass") == Some("Error") {
                    continue;
                }
                let Some(id) = resp.find("FolderId").and_then(|f| f.attr("Id")) else { continue };
                known.insert(*name, id.to_string());
                match role {
                    Some(r) => {
                        roles.insert(id.to_string(), *r);
                    }
                    None => root = Some(id.to_string()),
                }
            }
        }

        let doc = self
            .call(
                r#"<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties>
<t:FieldURI FieldURI="folder:ParentFolderId"/><t:FieldURI FieldURI="folder:FolderClass"/></t:AdditionalProperties></m:FolderShape>
<m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>"#,
            )
            .await?;
        let mut folders = Vec::new();
        doc.find_all("Folder", &mut folders);
        let mut out: Vec<RemoteFolder> = folders
            .into_iter()
            .filter(|f| f.text_of("FolderClass").is_none_or(|c| c.is_empty() || c.starts_with("IPF.Note")))
            .filter_map(|f| {
                let id = f.child("FolderId")?.attr("Id")?.to_string();
                let parent = f.child("ParentFolderId").and_then(|p| p.attr("Id")).map(str::to_string);
                let name = f.text_of("DisplayName").unwrap_or_default().to_string();
                let role = roles.get(&id).copied().unwrap_or_else(|| {
                    let top = parent.is_some() && parent == root;
                    if top && matches!(name.to_lowercase().as_str(), "archive" | "archiv") { FolderRole::Archive } else { FolderRole::Other }
                });
                Some(RemoteFolder {
                    remote_id: id,
                    name,
                    parent_remote_id: parent.filter(|p| Some(p) != root.as_ref()),
                    role,
                    unread_count: f.text_of("UnreadCount").and_then(|v| v.parse().ok()).unwrap_or(0),
                    total_count: f.text_of("TotalCount").and_then(|v| v.parse().ok()).unwrap_or(0),
                    selectable: true,
                })
            })
            .collect();
        // Parents that were filtered out (non-mail folders) make children top-level.
        let ids: HashSet<String> = out.iter().map(|f| f.remote_id.clone()).collect();
        for f in &mut out {
            if f.parent_remote_id.as_ref().is_some_and(|p| !ids.contains(p)) {
                f.parent_remote_id = None;
            }
        }
        if let Some(archive) = out.iter().find(|f| f.role == FolderRole::Archive) {
            known.insert("archive", archive.remote_id.clone());
        }
        *self.well_known.lock().unwrap() = known;
        Ok(out)
    }

    async fn sync_folder(&self, folder: &RemoteFolder, state: Option<&str>) -> Result<FolderChanges> {
        let mut changes = FolderChanges { reset: state.is_none(), ..Default::default() };
        let mut sync_state = state.map(str::to_string);
        for page in 0..MAX_SYNC_PAGES {
            let state_xml = sync_state.as_deref().map(|s| format!("<m:SyncState>{}</m:SyncState>", escape(s))).unwrap_or_default();
            let body = format!(
                r#"<m:SyncFolderItems><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>{ITEM_PROPERTIES}</m:ItemShape>
<m:SyncFolderId><t:FolderId Id="{}"/></m:SyncFolderId>{state_xml}<m:MaxChangesReturned>{PAGE_SIZE}</m:MaxChangesReturned></m:SyncFolderItems>"#,
                escape(&folder.remote_id)
            );
            let doc = match self.call(&body).await {
                Err(Error::Protocol(m)) if m.starts_with("syncstate") && sync_state.is_some() => {
                    // Invalid sync state: start over.
                    return self.sync_folder(folder, None).await;
                }
                other => other?,
            };
            let msg = doc.find("SyncFolderItemsResponseMessage").ok_or_else(|| Error::protocol("missing SyncFolderItemsResponseMessage"))?;
            sync_state = msg.text_of("SyncState").map(str::to_string);
            if let Some(list) = msg.child("Changes") {
                for change in &list.children {
                    match change.name.as_str() {
                        "Create" | "Update" => {
                            if let Some(m) = change.children.first().and_then(parse_item) {
                                changes.upserted.push(m);
                            }
                        }
                        "Delete" => {
                            if let Some(id) = change.child("ItemId").and_then(|i| i.attr("Id")) {
                                changes.removed.push(id.to_string());
                            }
                        }
                        "ReadFlagChange" => {
                            if let Some(id) = change.child("ItemId").and_then(|i| i.attr("Id")) {
                                // Flag state is unknown here; keep it via a full item update next time.
                                changes.flags.push(RemoteFlags { remote_id: id.to_string(), is_read: parse_bool(change.text_of("IsRead")), is_flagged: false });
                            }
                        }
                        _ => {}
                    }
                }
            }
            if parse_bool(msg.text_of("IncludesLastItemInRange")) {
                break;
            }
            debug!(page, "EWS sync continues on the next call");
        }
        // ReadFlagChange has no flag status: turn those into read-only updates
        // by dropping them where the message is upserted anyway.
        let upserted: HashSet<&str> = changes.upserted.iter().map(|m| m.remote_id.as_str()).collect();
        changes.flags.retain(|f| !upserted.contains(f.remote_id.as_str()));
        changes.new_state = sync_state;
        Ok(changes)
    }

    async fn fetch_body(&self, _folder: &str, message_remote_id: &str) -> Result<FetchedBody> {
        let mut items = self.get_mime(&[message_remote_id.to_string()]).await?;
        let (_, raw) = items.pop().ok_or_else(|| Error::NotFound(message_remote_id.into()))?;
        Ok(Self::to_fetched(raw))
    }

    async fn fetch_bodies(&self, _folder: &str, message_remote_ids: &[String]) -> Result<Vec<(String, FetchedBody)>> {
        let mut out = Vec::new();
        for chunk in message_remote_ids.chunks(BODY_BATCH) {
            for (id, raw) in self.get_mime(chunk).await? {
                out.push((id, Self::to_fetched(raw)));
            }
        }
        Ok(out)
    }

    async fn fetch_older(&self, folder: &RemoteFolder, known: &HashSet<String>, oldest_date: Option<DateTime<Utc>>, limit: usize) -> Result<Vec<RemoteMessage>> {
        let restriction = oldest_date
            .map(|d| {
                format!(
                    r#"<m:Restriction><t:IsLessThanOrEqualTo><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURIOrConstant><t:Constant Value="{}"/></t:FieldURIOrConstant></t:IsLessThanOrEqualTo></m:Restriction>"#,
                    d.format("%Y-%m-%dT%H:%M:%SZ")
                )
            })
            .unwrap_or_default();
        let body = format!(
            r#"<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>{ITEM_PROPERTIES}</m:ItemShape>
<m:IndexedPageItemView MaxEntriesReturned="{}" Offset="0" BasePoint="Beginning"/>{restriction}
<m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
<m:ParentFolderIds><t:FolderId Id="{}"/></m:ParentFolderIds></m:FindItem>"#,
            (limit + known.len().min(50)).min(1000),
            escape(&folder.remote_id)
        );
        let doc = self.call(&body).await?;
        let Some(items) = doc.find("Items") else { return Ok(Vec::new()) };
        Ok(items
            .children
            .iter()
            .filter_map(parse_item)
            .filter(|m| !known.contains(&m.remote_id))
            .take(limit)
            .collect())
    }

    async fn fetch_attachment(&self, folder: &str, message_remote_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let fetched = self.fetch_body(folder, message_remote_id).await?;
        let index: usize = attachment_id.parse().map_err(|_| Error::NotFound(attachment_id.into()))?;
        ondura_mail_core::preview::attachment_bytes(&fetched.raw.unwrap_or_default(), index).ok_or_else(|| Error::NotFound(attachment_id.into()))
    }

    async fn set_flags(&self, _folder: &str, message_remote_id: &str, read: Option<bool>, flagged: Option<bool>) -> Result<()> {
        let mut updates = String::new();
        if let Some(r) = read {
            updates.push_str(&format!(
                r#"<t:SetItemField><t:FieldURI FieldURI="message:IsRead"/><t:Message><t:IsRead>{r}</t:IsRead></t:Message></t:SetItemField>"#
            ));
        }
        if let Some(f) = flagged {
            let status = if f { "Flagged" } else { "NotFlagged" };
            updates.push_str(&format!(
                r#"<t:SetItemField><t:FieldURI FieldURI="item:Flag"/><t:Message><t:Flag><t:FlagStatus>{status}</t:FlagStatus></t:Flag></t:Message></t:SetItemField>"#
            ));
        }
        if updates.is_empty() {
            return Ok(());
        }
        self.call(&format!(
            r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite" SuppressReadReceipts="true"><m:ItemChanges><t:ItemChange><t:ItemId Id="{}"/><t:Updates>{updates}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>"#,
            escape(message_remote_id)
        ))
        .await
        .map(|_| ())
    }

    async fn set_categories(&self, _folder: &str, message_remote_id: &str, categories: &[String]) -> Result<()> {
        let update = if categories.is_empty() {
            r#"<t:DeleteItemField><t:FieldURI FieldURI="item:Categories"/></t:DeleteItemField>"#.to_string()
        } else {
            let list: String = categories.iter().map(|c| format!("<t:String>{}</t:String>", escape(c))).collect();
            format!(r#"<t:SetItemField><t:FieldURI FieldURI="item:Categories"/><t:Message><t:Categories>{list}</t:Categories></t:Message></t:SetItemField>"#)
        };
        self.call(&format!(
            r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite"><m:ItemChanges><t:ItemChange><t:ItemId Id="{}"/><t:Updates>{update}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>"#,
            escape(message_remote_id)
        ))
        .await
        .map(|_| ())
    }

    async fn search(&self, query: &str, limit: usize) -> Result<Vec<(String, RemoteMessage)>> {
        // AQS search (Exchange 2013+) over the main folders of the mailbox.
        let doc = self
            .call_lenient(&format!(
                r#"<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>{ITEM_PROPERTIES}</m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="{limit}" Offset="0" BasePoint="Beginning"/><m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/><t:DistinguishedFolderId Id="sentitems"/><t:DistinguishedFolderId Id="drafts"/></m:ParentFolderIds><m:QueryString>{}</m:QueryString></m:FindItem>"#,
                escape(query)
            ))
            .await?;
        let mut items = Vec::new();
        doc.find_all("Message", &mut items);
        let mut out: Vec<(String, RemoteMessage)> = items
            .into_iter()
            .filter_map(|item| {
                let folder = item.child("ParentFolderId")?.attr("Id")?.to_string();
                Some((folder, parse_item(item)?))
            })
            .collect();
        out.sort_by_key(|h| std::cmp::Reverse(h.1.date));
        out.truncate(limit);
        Ok(out)
    }

    async fn wait_for_change(&self, folder_remote_id: &str, timeout: Duration) -> Result<bool> {
        match self.stream_changes(folder_remote_id, timeout).await {
            // Exchange 2010 SP1+ supports streaming; without it the engine polls.
            Err(Error::Protocol(e)) if e.contains("ErrorInvalidRequest") || e.contains("ErrorInvalidServerVersion") => Err(Error::Unsupported(e)),
            other => other,
        }
    }

    async fn move_message(&self, _folder: &str, message_remote_id: &str, target_folder_remote_id: &str) -> Result<Option<String>> {
        let doc = self
            .call(&format!(
                r#"<m:MoveItem><m:ToFolderId><t:FolderId Id="{}"/></m:ToFolderId><m:ItemIds><t:ItemId Id="{}"/></m:ItemIds></m:MoveItem>"#,
                escape(target_folder_remote_id),
                escape(message_remote_id)
            ))
            .await?;
        Ok(doc.find("ItemId").and_then(|i| i.attr("Id")).map(str::to_string))
    }

    async fn delete_message(&self, _folder: &str, message_remote_id: &str) -> Result<()> {
        self.call(&format!(
            r#"<m:DeleteItem DeleteType="HardDelete"><m:ItemIds><t:ItemId Id="{}"/></m:ItemIds></m:DeleteItem>"#,
            escape(message_remote_id)
        ))
        .await
        .map(|_| ())
    }

    async fn send(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        let item = self.mime_item(message, attachments, false)?;
        self.call(&format!(
            r#"<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:SavedItemFolderId><t:DistinguishedFolderId Id="sentitems"/></m:SavedItemFolderId><m:Items>{item}</m:Items></m:CreateItem>"#
        ))
        .await
        .map(|_| ())
    }

    async fn auto_reply(&self) -> Result<AutoReply> {
        let address = self.mailbox.clone().unwrap_or_else(|| self.from.email.clone());
        let doc = self
            .call_lenient(&format!(r#"<m:GetUserOofSettingsRequest><t:Mailbox><t:Address>{}</t:Address></t:Mailbox></m:GetUserOofSettingsRequest>"#, escape(&address)))
            .await?;
        parse_oof(&doc)
    }

    async fn set_auto_reply(&self, reply: &AutoReply) -> Result<()> {
        let address = self.mailbox.clone().unwrap_or_else(|| self.from.email.clone());
        let doc = self.call_lenient(&oof_request(&address, reply)).await?;
        match doc.find("ResponseMessage") {
            Some(m) if m.attr("ResponseClass") == Some("Error") => {
                Err(Error::Protocol(m.text_of("MessageText").unwrap_or("SetUserOofSettings").to_string()))
            }
            _ => Ok(()),
        }
    }

    async fn save_draft(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        let item = self.mime_item(message, attachments, true)?;
        let folder = match self.known("drafts") {
            Some(id) => format!(r#"<t:FolderId Id="{}"/>"#, escape(&id)),
            None => r#"<t:DistinguishedFolderId Id="drafts"/>"#.to_string(),
        };
        self.call(&format!(
            r#"<m:CreateItem MessageDisposition="SaveOnly"><m:SavedItemFolderId>{folder}</m:SavedItemFolderId><m:Items>{item}</m:Items></m:CreateItem>"#
        ))
        .await
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualifies_folder_ids_for_shared_mailboxes() {
        let body = r#"<m:FolderIds><t:DistinguishedFolderId Id="inbox"/><t:FolderId Id="x"/></m:FolderIds>"#;
        assert_eq!(qualify(body, None), body);
        assert_eq!(
            qualify(body, Some("team@example.com")),
            r#"<m:FolderIds><t:DistinguishedFolderId Id="inbox"><t:Mailbox><t:EmailAddress>team@example.com</t:EmailAddress></t:Mailbox></t:DistinguishedFolderId><t:FolderId Id="x"/></m:FolderIds>"#
        );
    }

    #[test]
    fn oof_settings_round_trip() {
        let xml = r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetUserOofSettingsResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages"><ResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode></ResponseMessage><OofSettings xmlns="http://schemas.microsoft.com/exchange/services/2006/types"><OofState>Scheduled</OofState><ExternalAudience>Known</ExternalAudience><Duration><StartTime>2026-12-20T08:00:00Z</StartTime><EndTime>2027-01-06T17:00:00Z</EndTime></Duration><InternalReply><Message>&lt;p&gt;Urlaub&lt;/p&gt;</Message></InternalReply><ExternalReply><Message>Away</Message></ExternalReply></OofSettings></GetUserOofSettingsResponse></s:Body></s:Envelope>"#;
        let r = parse_oof(&Node::parse(xml).unwrap()).unwrap();
        assert!(r.enabled);
        assert_eq!(r.external_audience, ExternalAudience::Known);
        assert_eq!(r.internal, "<p>Urlaub</p>");
        assert_eq!(r.end.unwrap().to_rfc3339(), "2027-01-06T17:00:00+00:00");
        let req = oof_request("niklas@example.com", &r);
        assert!(req.contains("<t:OofState>Scheduled</t:OofState>"));
        assert!(req.contains("<t:Message>&lt;p&gt;Urlaub&lt;/p&gt;</t:Message>"));
    }

    #[test]
    fn parses_items_and_errors() {
        let xml = r#"<s:Envelope xmlns:s="s"><s:Body><m:SyncFolderItemsResponse><m:ResponseMessages>
<m:SyncFolderItemsResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
<m:SyncState>H4sI</m:SyncState><m:IncludesLastItemInRange>true</m:IncludesLastItemInRange><m:Changes>
<t:Create><t:Message><t:ItemId Id="AAMk1" ChangeKey="CQ"/><t:Subject>Angebot</t:Subject><t:DateTimeReceived>2026-11-17T09:00:00Z</t:DateTimeReceived>
<t:HasAttachments>true</t:HasAttachments><t:Importance>High</t:Importance><t:DisplayTo>Niklas Linz; Anna</t:DisplayTo>
<t:IsRead>false</t:IsRead><t:From><t:Mailbox><t:Name>Max</t:Name><t:EmailAddress>max@example.com</t:EmailAddress></t:Mailbox></t:From>
<t:Flag><t:FlagStatus>Flagged</t:FlagStatus></t:Flag><t:Preview>Hallo</t:Preview></t:Message></t:Create>
<t:Delete><t:ItemId Id="AAMk2"/></t:Delete>
<t:ReadFlagChange><t:ItemId Id="AAMk3"/><t:IsRead>true</t:IsRead></t:ReadFlagChange>
</m:Changes></m:SyncFolderItemsResponseMessage></m:ResponseMessages></m:SyncFolderItemsResponse></s:Body></s:Envelope>"#;
        let doc = Node::parse(xml).unwrap();
        check_responses(&doc).unwrap();
        let create = doc.find("Create").unwrap();
        let m = parse_item(&create.children[0]).unwrap();
        assert_eq!(m.remote_id, "AAMk1");
        assert!(m.is_flagged && !m.is_read && m.has_attachments);
        assert_eq!(m.importance, Importance::High);
        assert_eq!(m.to.len(), 2);
        assert_eq!(m.from.unwrap().email, "max@example.com");

        let err = r#"<s:Envelope xmlns:s="s"><s:Body><m:R><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Error">
<m:MessageText>gone</m:MessageText><m:ResponseCode>ErrorItemNotFound</m:ResponseCode></m:GetItemResponseMessage></m:ResponseMessages></m:R></s:Body></s:Envelope>"#;
        assert!(matches!(check_responses(&Node::parse(err).unwrap()), Err(Error::NotFound(_))));
    }
}
