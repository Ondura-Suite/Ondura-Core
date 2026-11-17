//! IMAP + SMTP adapter for Relay.
//!
//! Sync strategy: the newest [`WINDOW`] messages of each folder are mirrored
//! (older ones on demand via `fetch_older`). The sync state is
//! `v1:<UIDVALIDITY>:<highest UID>`; new messages are found via UID ranges,
//! deletions via `UID SEARCH ALL`, and flag changes by re-fetching `FLAGS`
//! for the window (cheap, even without CONDSTORE).
//!
//! Connections: one for background sync, one for user actions (so opening a
//! message never waits behind a long sync) and one for IDLE on the inbox.
//! Every command has a timeout; a timed-out or broken connection is dropped
//! and re-established on the next call.

mod utf7;

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_imap::extensions::idle::IdleResponse;
use async_imap::types::{Fetch, Flag, NameAttribute};
use async_imap::{Client, Session};
use async_trait::async_trait;
use chrono::Utc;
use futures::TryStreamExt;
use chrono::DateTime;
use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use nexora_mail_core::model::{Address, FolderRole, ImapConfig, Importance, OutgoingMessage, ResolvedAttachment, Security};
use nexora_mail_core::preview::{html_to_text, parse_body, parse_headers};
use nexora_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, RemoteFlags, RemoteFolder, RemoteMessage};
use nexora_mail_core::{Error, Result};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;
use tracing::debug;

/// Number of newest messages mirrored per folder.
pub const WINDOW: usize = 500;
/// UIDs per FETCH command.
const CHUNK: usize = 100;
/// Full bodies per FETCH command when prefetching.
const BODY_CHUNK: usize = 10;
/// Upper bound for a single IMAP operation.
const OP_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

/// Which connection an operation uses.
#[derive(Clone, Copy, Debug)]
enum Lane {
    Sync,
    Interactive,
}

type Stream = TlsStream<TcpStream>;
type ImapSession = Session<Stream>;

pub struct ImapProvider {
    config: ImapConfig,
    password: String,
    from: Address,
    sync_session: Mutex<Option<ImapSession>>,
    interactive_session: Mutex<Option<ImapSession>>,
    idle_session: Mutex<Option<ImapSession>>,
    tls: Arc<rustls::ClientConfig>,
    /// Remote ids of the "Sent" and "Drafts" folders (learned from LIST).
    sent_folder: std::sync::Mutex<Option<String>>,
    drafts_folder: std::sync::Mutex<Option<String>>,
}

fn imap_err(e: async_imap::error::Error) -> Error {
    match e {
        async_imap::error::Error::Io(io) => Error::Network(io.to_string()),
        async_imap::error::Error::No(m) | async_imap::error::Error::Bad(m) => Error::Protocol(m),
        other => Error::Protocol(other.to_string()),
    }
}

/// Compress UIDs into an IMAP sequence set (`1:5,7,9:12`).
fn uid_set(uids: &[u32]) -> String {
    let mut sorted = uids.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut parts = Vec::new();
    let mut i = 0;
    while i < sorted.len() {
        let start = sorted[i];
        let mut end = start;
        while i + 1 < sorted.len() && sorted[i + 1] == end + 1 {
            i += 1;
            end = sorted[i];
        }
        parts.push(if start == end { start.to_string() } else { format!("{start}:{end}") });
        i += 1;
    }
    parts.join(",")
}


/// Guess the role of a folder from RFC 6154 attributes or well-known names
/// (English and German variants used by common servers).
fn folder_role(name: &str, attrs: &[NameAttribute<'_>]) -> FolderRole {
    for a in attrs {
        match a {
            NameAttribute::Sent => return FolderRole::Sent,
            NameAttribute::Drafts => return FolderRole::Drafts,
            NameAttribute::Trash => return FolderRole::Trash,
            NameAttribute::Junk => return FolderRole::Junk,
            NameAttribute::Archive => return FolderRole::Archive,
            _ => {}
        }
    }
    let leaf = name.rsplit(['/', '.']).next().unwrap_or(name).to_lowercase();
    if name.eq_ignore_ascii_case("INBOX") {
        return FolderRole::Inbox;
    }
    match leaf.as_str() {
        "sent" | "sent items" | "sent messages" | "gesendet" | "gesendete elemente" | "gesendete objekte" => FolderRole::Sent,
        "drafts" | "entwürfe" => FolderRole::Drafts,
        "trash" | "deleted" | "deleted items" | "deleted messages" | "papierkorb" | "gelöschte elemente" => FolderRole::Trash,
        "junk" | "spam" | "junk-e-mail" | "junk e-mail" => FolderRole::Junk,
        "archive" | "archiv" => FolderRole::Archive,
        _ => FolderRole::Other,
    }
}

fn parse_state(state: Option<&str>) -> Option<(u32, u32)> {
    let mut parts = state?.split(':');
    if parts.next()? != "v1" {
        return None;
    }
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

fn message_from_fetch(f: &Fetch) -> Option<RemoteMessage> {
    let uid = f.uid?;
    let headers = parse_headers(f.header().unwrap_or_default());
    let flags: Vec<Flag<'_>> = f.flags().collect();
    let date = headers
        .date
        .or_else(|| f.internal_date().map(|d| d.with_timezone(&Utc)))
        .unwrap_or_else(Utc::now);
    Some(RemoteMessage {
        remote_id: uid.to_string(),
        subject: headers.subject,
        from: headers.from,
        to: headers.to,
        cc: headers.cc,
        date,
        preview: String::new(),
        is_read: flags.contains(&Flag::Seen),
        is_flagged: flags.contains(&Flag::Flagged),
        has_attachments: headers.is_multipart_mixed,
        importance: if headers.high_importance { Importance::High } else { Importance::Normal },
        internet_message_id: headers.message_id,
    })
}

impl ImapProvider {
    pub fn new(config: ImapConfig, from: Address, password: String) -> Arc<Self> {
        Self::with_tls_config(config, from, password, nexora_mail_core::net::tls_client_config())
    }

    /// Like [`ImapProvider::new`] with a custom TLS configuration, e.g. one
    /// that trusts a private CA (used by the integration tests).
    pub fn with_tls_config(config: ImapConfig, from: Address, password: String, tls: Arc<rustls::ClientConfig>) -> Arc<Self> {
        Arc::new(Self {
            config,
            password,
            from,
            sync_session: Mutex::new(None),
            interactive_session: Mutex::new(None),
            idle_session: Mutex::new(None),
            tls,
            sent_folder: std::sync::Mutex::new(None),
            drafts_folder: std::sync::Mutex::new(None),
        })
    }

    async fn tls(&self, tcp: TcpStream) -> Result<Stream> {
        let connector = TlsConnector::from(Arc::clone(&self.tls));
        let name = rustls::pki_types::ServerName::try_from(self.config.imap_host.clone())
            .map_err(|e| Error::Network(format!("invalid host name: {e}")))?;
        Ok(connector.connect(name, tcp).await?)
    }

    async fn connect(&self) -> Result<ImapSession> {
        let addr = (self.config.imap_host.as_str(), self.config.imap_port);
        let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
            .await
            .map_err(|_| Error::Network("connection timed out".into()))??;
        let stream = match self.config.imap_security {
            Security::Tls => self.tls(tcp).await?,
            Security::StartTls => {
                let mut plain = Client::new(tcp);
                plain.read_response().await?;
                plain.run_command_and_check_ok("STARTTLS", None).await.map_err(imap_err)?;
                self.tls(plain.into_inner()).await?
            }
        };
        let mut client = Client::new(stream);
        if matches!(self.config.imap_security, Security::Tls) {
            client.read_response().await?; // server greeting
        }
        let session = tokio::time::timeout(CONNECT_TIMEOUT, client.login(&self.config.username, &self.password))
            .await
            .map_err(|_| Error::Network("login timed out".into()))?
            .map_err(|(e, _)| Error::Auth(e.to_string()))?;
        debug!(host = %self.config.imap_host, "IMAP session established");
        Ok(session)
    }

    fn slot(&self, lane: Lane) -> &Mutex<Option<ImapSession>> {
        match lane {
            Lane::Sync => &self.sync_session,
            Lane::Interactive => &self.interactive_session,
        }
    }

    /// Run `f` on the session of `lane` (connecting if needed). The session
    /// is dropped on network errors and timeouts so the next call reconnects.
    async fn with_session<T, F>(&self, lane: Lane, f: F) -> Result<T>
    where
        F: for<'s> FnOnce(&'s mut ImapSession) -> futures::future::BoxFuture<'s, Result<T>>,
    {
        let mut guard = self.slot(lane).lock().await;
        if guard.is_none() {
            *guard = Some(self.connect().await?);
        }
        let session = guard.as_mut().expect("session present");
        let result = match tokio::time::timeout(OP_TIMEOUT, f(session)).await {
            Ok(r) => r,
            Err(_) => Err(Error::Network(format!("IMAP operation timed out ({lane:?})"))),
        };
        if let Some(session) = guard.as_mut() {
            while session.unsolicited_responses.try_recv().is_ok() {}
        }
        if matches!(result, Err(Error::Network(_))) {
            *guard = None;
        }
        result
    }

    /// Verify the credentials (used by the account setup dialog).
    pub async fn test_login(&self) -> Result<()> {
        self.with_session(Lane::Interactive, |s| Box::pin(async move { s.noop().await.map_err(imap_err) })).await
    }

    /// Append a raw message to a folder (used by tests and import).
    pub async fn append_for_test(&self, folder: &str, raw: &[u8]) -> Result<()> {
        let (folder, raw) = (folder.to_string(), raw.to_vec());
        self.with_session(Lane::Interactive, move |s| Box::pin(async move { s.append(&folder, None, None, &raw).await.map_err(imap_err) }))
            .await
    }

    async fn smtp_send(&self, msg: lettre::Message) -> Result<()> {
        let creds = Credentials::new(self.config.username.clone(), self.password.clone());
        let builder = match self.config.smtp_security {
            Security::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&self.config.smtp_host),
            Security::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.config.smtp_host),
        }
        .map_err(|e| Error::Network(e.to_string()))?;
        let transport = builder.port(self.config.smtp_port).credentials(creds).build();
        transport.send(msg).await.map_err(|e| {
            if e.is_permanent() { Error::Protocol(e.to_string()) } else { Error::Network(e.to_string()) }
        })?;
        Ok(())
    }
}

fn mailbox(a: &Address) -> Result<Mailbox> {
    let email = a.email.parse().map_err(|e| Error::Other(format!("invalid address {}: {e}", a.email)))?;
    Ok(Mailbox::new(a.name.clone().filter(|n| !n.is_empty()), email))
}

/// Build the RFC 5322 message for sending or saving as a draft.
pub fn build_message(from: &Address, m: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<lettre::Message> {
    let mut b = lettre::Message::builder().from(mailbox(from)?).subject(m.subject.clone());
    for a in &m.to {
        b = b.to(mailbox(a)?);
    }
    for a in &m.cc {
        b = b.cc(mailbox(a)?);
    }
    for a in &m.bcc {
        b = b.bcc(mailbox(a)?);
    }
    if let Some(id) = &m.in_reply_to {
        b = b.in_reply_to(id.clone()).references(id.clone());
    }
    if m.to.is_empty() && m.cc.is_empty() && m.bcc.is_empty() {
        // Drafts may have no recipients yet; lettre needs an envelope anyway.
        let me: lettre::Address = from.email.parse().map_err(|e| Error::Other(format!("invalid address {}: {e}", from.email)))?;
        let envelope = lettre::address::Envelope::new(Some(me.clone()), vec![me]).map_err(|e| Error::Other(e.to_string()))?;
        b = b.envelope(envelope);
    }
    b = b.user_agent("Relay".into());
    let text = html_to_text(&m.body_html);
    let alternative = MultiPart::alternative_plain_html(text, m.body_html.clone());
    let result = if attachments.is_empty() {
        b.multipart(alternative)
    } else {
        let mut mixed = MultiPart::mixed().multipart(alternative);
        for a in attachments {
            let ct = ContentType::parse(&a.content_type).unwrap_or(ContentType::parse("application/octet-stream").expect("valid"));
            mixed = mixed.singlepart(Attachment::new(a.name.clone()).body(a.data.clone(), ct));
        }
        b.multipart(mixed)
    };
    result.map_err(|e| Error::Other(e.to_string()))
}

async fn fetch_headers(s: &mut ImapSession, uids: &[u32]) -> Result<Vec<RemoteMessage>> {
    let mut out = Vec::with_capacity(uids.len());
    for chunk in uids.chunks(CHUNK) {
        let fetches: Vec<Fetch> = s
            .uid_fetch(uid_set(chunk), "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])")
            .await
            .map_err(imap_err)?
            .try_collect()
            .await
            .map_err(imap_err)?;
        out.extend(fetches.iter().filter_map(message_from_fetch));
    }
    Ok(out)
}

async fn search_all(s: &mut ImapSession) -> Result<Vec<u32>> {
    let mut all: Vec<u32> = s.uid_search("ALL").await.map_err(imap_err)?.into_iter().collect();
    all.sort_unstable();
    Ok(all)
}

#[async_trait]
impl MailProvider for ImapProvider {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        let folders = self
            .with_session(Lane::Sync, |s| {
                Box::pin(async move {
                    let names: Vec<_> = s.list(Some(""), Some("*")).await.map_err(imap_err)?.try_collect().await.map_err(imap_err)?;
                    let mut out = Vec::with_capacity(names.len());
                    for n in &names {
                        let raw = n.name().to_string();
                        let selectable = !n.attributes().contains(&NameAttribute::NoSelect);
                        let delim = n.delimiter().unwrap_or("/");
                        let (parent, leaf) = match raw.rsplit_once(delim) {
                            Some((p, l)) if !delim.is_empty() => (Some(p.to_string()), l.to_string()),
                            _ => (None, raw.clone()),
                        };
                        let role = folder_role(&utf7::decode(&raw), n.attributes());
                        let (unread, total) = if selectable {
                            match s.status(&raw, "(MESSAGES UNSEEN)").await {
                                Ok(mb) => (mb.unseen.unwrap_or(0), mb.exists),
                                Err(_) => (0, 0),
                            }
                        } else {
                            (0, 0)
                        };
                        out.push(RemoteFolder {
                            name: if role == FolderRole::Inbox { "Posteingang".into() } else { utf7::decode(&leaf) },
                            remote_id: raw,
                            parent_remote_id: parent,
                            role,
                            unread_count: unread,
                            total_count: total,
                            selectable,
                        });
                    }
                    Ok(out)
                })
            })
            .await?;
        *self.sent_folder.lock().unwrap() = folders.iter().find(|f| f.role == FolderRole::Sent).map(|f| f.remote_id.clone());
        *self.drafts_folder.lock().unwrap() = folders.iter().find(|f| f.role == FolderRole::Drafts).map(|f| f.remote_id.clone());
        Ok(folders)
    }

    async fn sync_folder(&self, folder: &RemoteFolder, state: Option<&str>) -> Result<FolderChanges> {
        let name = folder.remote_id.clone();
        let previous = parse_state(state);
        self.with_session(Lane::Sync, move |s| {
            Box::pin(async move {
                let mb = s.select(&name).await.map_err(imap_err)?;
                let validity = mb.uid_validity.unwrap_or(0);
                let (reset, known_max) = match previous {
                    Some((v, max)) if v == validity => (false, max),
                    _ => (true, 0),
                };
                let mut changes = FolderChanges { reset, ..Default::default() };
                if mb.exists == 0 {
                    changes.present = Some(vec![]);
                    changes.new_state = Some(format!("v1:{validity}:0"));
                    return Ok(changes);
                }

                let all = search_all(s).await?;
                let window: Vec<u32> = all.iter().rev().take(WINDOW).copied().collect();
                let max_uid = all.last().copied().unwrap_or(0);

                let new_uids: Vec<u32> = window.iter().copied().filter(|u| reset || *u > known_max).collect();
                changes.upserted = fetch_headers(s, &new_uids).await?;

                if !reset {
                    let new: HashSet<u32> = new_uids.iter().copied().collect();
                    let existing: Vec<u32> = window.iter().copied().filter(|u| !new.contains(u)).collect();
                    for chunk in existing.chunks(CHUNK * 5) {
                        let fetches: Vec<Fetch> = s
                            .uid_fetch(uid_set(chunk), "(UID FLAGS)")
                            .await
                            .map_err(imap_err)?
                            .try_collect()
                            .await
                            .map_err(imap_err)?;
                        changes.flags.extend(fetches.iter().filter_map(|f| {
                            let flags: Vec<Flag<'_>> = f.flags().collect();
                            Some(RemoteFlags {
                                remote_id: f.uid?.to_string(),
                                is_read: flags.contains(&Flag::Seen),
                                is_flagged: flags.contains(&Flag::Flagged),
                            })
                        }));
                    }
                }

                // All UIDs (not just the window), so messages loaded with
                // "load older" are only removed when they are gone on the server.
                changes.present = Some(all.iter().map(u32::to_string).collect());
                changes.new_state = Some(format!("v1:{validity}:{max_uid}"));
                Ok(changes)
            })
        })
        .await
    }

    async fn fetch_older(
        &self,
        folder: &RemoteFolder,
        known: &HashSet<String>,
        _oldest_date: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<RemoteMessage>> {
        let name = folder.remote_id.clone();
        let known: HashSet<u32> = known.iter().filter_map(|r| r.parse().ok()).collect();
        self.with_session(Lane::Sync, move |s| {
            Box::pin(async move {
                s.select(&name).await.map_err(imap_err)?;
                let all = search_all(s).await?;
                // Highest UIDs that are not stored locally yet (also fills gaps).
                let older: Vec<u32> = all.into_iter().filter(|u| !known.contains(u)).rev().take(limit).collect();
                fetch_headers(s, &older).await
            })
        })
        .await
    }

    async fn fetch_bodies(&self, folder_remote_id: &str, message_remote_ids: &[String]) -> Result<Vec<(String, FetchedBody)>> {
        let folder = folder_remote_id.to_string();
        let uids: Vec<u32> = message_remote_ids.iter().filter_map(|r| r.parse().ok()).collect();
        self.with_session(Lane::Sync, move |s| {
            Box::pin(async move {
                s.select(&folder).await.map_err(imap_err)?;
                let mut out = Vec::with_capacity(uids.len());
                for chunk in uids.chunks(BODY_CHUNK) {
                    let fetches: Vec<Fetch> = s
                        .uid_fetch(uid_set(chunk), "(UID BODY.PEEK[])")
                        .await
                        .map_err(imap_err)?
                        .try_collect()
                        .await
                        .map_err(imap_err)?;
                    for f in &fetches {
                        if let (Some(uid), Some(raw)) = (f.uid, f.body()) {
                            out.push((uid.to_string(), FetchedBody { body: parse_body(raw), raw: Some(raw.to_vec()), recipients: None }));
                        }
                    }
                }
                Ok(out)
            })
        })
        .await
    }

    async fn fetch_body(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<FetchedBody> {
        let (folder, uid) = (folder_remote_id.to_string(), message_remote_id.to_string());
        let raw = self
            .with_session(Lane::Interactive, move |s| {
                Box::pin(async move {
                    s.select(&folder).await.map_err(imap_err)?;
                    let fetches: Vec<Fetch> = s
                        .uid_fetch(&uid, "(UID BODY.PEEK[])")
                        .await
                        .map_err(imap_err)?
                        .try_collect()
                        .await
                        .map_err(imap_err)?;
                    fetches
                        .iter()
                        .find_map(|f| f.body().map(<[u8]>::to_vec))
                        .ok_or_else(|| Error::NotFound(format!("message {uid}")))
                })
            })
            .await?;
        Ok(FetchedBody { body: parse_body(&raw), raw: Some(raw), recipients: None })
    }

    async fn fetch_attachment(&self, folder_remote_id: &str, message_remote_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let fetched = self.fetch_body(folder_remote_id, message_remote_id).await?;
        let index: usize = attachment_id.parse().map_err(|_| Error::NotFound(attachment_id.into()))?;
        nexora_mail_core::preview::attachment_bytes(&fetched.raw.unwrap_or_default(), index)
            .ok_or_else(|| Error::NotFound(attachment_id.into()))
    }

    async fn set_flags(&self, folder_remote_id: &str, message_remote_id: &str, read: Option<bool>, flagged: Option<bool>) -> Result<()> {
        let (folder, uid) = (folder_remote_id.to_string(), message_remote_id.to_string());
        self.with_session(Lane::Interactive, move |s| {
            Box::pin(async move {
                s.select(&folder).await.map_err(imap_err)?;
                for (value, flag) in [(read, "\\Seen"), (flagged, "\\Flagged")] {
                    if let Some(v) = value {
                        let op = if v { "+FLAGS.SILENT" } else { "-FLAGS.SILENT" };
                        let _: Vec<Fetch> = s
                            .uid_store(&uid, format!("{op} ({flag})"))
                            .await
                            .map_err(imap_err)?
                            .try_collect()
                            .await
                            .map_err(imap_err)?;
                    }
                }
                Ok(())
            })
        })
        .await
    }

    async fn move_message(&self, folder_remote_id: &str, message_remote_id: &str, target_folder_remote_id: &str) -> Result<Option<String>> {
        let (folder, uid, target) = (folder_remote_id.to_string(), message_remote_id.to_string(), target_folder_remote_id.to_string());
        self.with_session(Lane::Interactive, move |s| {
            Box::pin(async move {
                s.select(&folder).await.map_err(imap_err)?;
                if s.uid_mv(&uid, &target).await.is_err() {
                    // Server without MOVE (RFC 6851): COPY + \Deleted + EXPUNGE.
                    s.uid_copy(&uid, &target).await.map_err(imap_err)?;
                    let _: Vec<Fetch> = s
                        .uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")
                        .await
                        .map_err(imap_err)?
                        .try_collect()
                        .await
                        .map_err(imap_err)?;
                    let _: Vec<u32> = s.uid_expunge(&uid).await.map_err(imap_err)?.try_collect().await.map_err(imap_err)?;
                }
                Ok(None)
            })
        })
        .await
    }

    async fn delete_message(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<()> {
        let (folder, uid) = (folder_remote_id.to_string(), message_remote_id.to_string());
        self.with_session(Lane::Interactive, move |s| {
            Box::pin(async move {
                s.select(&folder).await.map_err(imap_err)?;
                let _: Vec<Fetch> = s
                    .uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")
                    .await
                    .map_err(imap_err)?
                    .try_collect()
                    .await
                    .map_err(imap_err)?;
                let _: Vec<u32> = s.uid_expunge(&uid).await.map_err(imap_err)?.try_collect().await.map_err(imap_err)?;
                Ok(())
            })
        })
        .await
    }

    async fn send(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        let msg = build_message(&self.from, message, attachments)?;
        let raw = msg.formatted();
        self.smtp_send(msg).await?;

        // Gmail stores sent mail itself; everyone else needs an APPEND.
        let sent = self.sent_folder.lock().unwrap().clone();
        if let Some(sent) = sent.filter(|_| !self.config.imap_host.ends_with("gmail.com")) {
            let result = self
                .with_session(Lane::Interactive, move |s| {
                    Box::pin(async move { s.append(&sent, Some("(\\Seen)"), None, &raw).await.map_err(imap_err) })
                })
                .await;
            // The mail is out; failing to file a copy must not resend it.
            if let Err(e) = result {
                tracing::warn!(error = %e, "could not store copy in Sent");
            }
        }
        Ok(())
    }

    async fn save_draft(&self, message: &OutgoingMessage, attachments: &[ResolvedAttachment]) -> Result<()> {
        let drafts = self
            .drafts_folder
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| Error::NotFound("Entwürfe-Ordner".into()))?;
        let raw = build_message(&self.from, message, attachments)?.formatted();
        self.with_session(Lane::Interactive, move |s| {
            Box::pin(async move { s.append(&drafts, Some("(\\Seen \\Draft)"), None, &raw).await.map_err(imap_err) })
        })
        .await
    }

    async fn wait_for_change(&self, folder_remote_id: &str, timeout: Duration) -> Result<bool> {
        let mut slot = self.idle_session.lock().await;
        let mut session = match slot.take() {
            Some(s) => s,
            None => self.connect().await?,
        };
        let has_idle = session
            .capabilities()
            .await
            .map(|c| c.has_str("IDLE"))
            .map_err(imap_err)?;
        if !has_idle {
            *slot = Some(session);
            return Err(Error::Unsupported("IDLE".into()));
        }
        session.examine(folder_remote_id).await.map_err(imap_err)?;
        let mut handle = session.idle();
        handle.init().await.map_err(imap_err)?;
        let (wait, _stop) = handle.wait_with_timeout(timeout);
        let response = wait.await.map_err(imap_err)?;
        let session = handle.done().await.map_err(imap_err)?;
        *slot = Some(session);
        Ok(matches!(response, IdleResponse::NewData(_)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uid_sets_are_compressed() {
        assert_eq!(uid_set(&[5, 1, 2, 3, 7, 9, 10]), "1:3,5,7,9:10");
        assert_eq!(uid_set(&[42]), "42");
    }

    #[test]
    fn detects_folder_roles() {
        assert_eq!(folder_role("INBOX", &[]), FolderRole::Inbox);
        assert_eq!(folder_role("INBOX.Gesendet", &[]), FolderRole::Sent);
        assert_eq!(folder_role("Whatever", &[NameAttribute::Trash]), FolderRole::Trash);
        assert_eq!(folder_role("Projekte", &[]), FolderRole::Other);
    }

    #[test]
    fn parses_state() {
        assert_eq!(parse_state(Some("v1:123:456")), Some((123, 456)));
        assert_eq!(parse_state(Some("garbage")), None);
        assert_eq!(parse_state(None), None);
    }

    #[test]
    fn builds_outgoing_message() {
        let from = Address::new(Some("Niklas".into()), "niklas@mirranet.de");
        let msg = OutgoingMessage {
            to: vec![Address::new(None, "alice@example.com")],
            subject: "Grüße".into(),
            body_html: "<p>Hallo <b>Alice</b></p>".into(),
            in_reply_to: Some("<abc@example.com>".into()),
            ..Default::default()
        };
        let raw = String::from_utf8(build_message(&from, &msg, &[]).unwrap().formatted()).unwrap();
        assert!(raw.contains("In-Reply-To: <abc@example.com>"));
        assert!(raw.contains("multipart/alternative"));
        assert!(raw.contains("To: alice@example.com"));

        let att = ResolvedAttachment { name: "bericht.pdf".into(), content_type: "application/pdf".into(), data: b"%PDF-1.4".to_vec() };
        let raw = String::from_utf8(build_message(&from, &msg, &[att]).unwrap().formatted()).unwrap();
        assert!(raw.contains("multipart/mixed"));
        assert!(raw.contains("filename=\"bericht.pdf\""));
    }
}
