//! IMAP + SMTP adapter for Mirra Mail.
//!
//! Sync strategy: the newest [`WINDOW`] messages of each folder are mirrored.
//! The sync state is `v1:<UIDVALIDITY>:<highest UID>`; new messages are found
//! via UID ranges, deletions via `UID SEARCH ALL`, and flag changes by
//! re-fetching `FLAGS` for the window (cheap, even without CONDSTORE).

mod utf7;

use std::collections::HashSet;
use std::sync::Arc;

use async_imap::types::{Fetch, Flag, NameAttribute};
use async_imap::{Client, Session};
use async_trait::async_trait;
use chrono::Utc;
use futures::TryStreamExt;
use lettre::message::{Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use mirra_mail_core::model::{Address, FolderRole, ImapConfig, Importance, OutgoingMessage, Security};
use mirra_mail_core::preview::{html_to_text, parse_body, parse_headers};
use mirra_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, RemoteFlags, RemoteFolder, RemoteMessage};
use mirra_mail_core::{Error, Result};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, MutexGuard};
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;
use tracing::debug;

/// Number of newest messages mirrored per folder.
pub const WINDOW: usize = 500;
/// UIDs per FETCH command.
const CHUNK: usize = 100;

type Stream = TlsStream<TcpStream>;
type ImapSession = Session<Stream>;

pub struct ImapProvider {
    config: ImapConfig,
    password: String,
    from: Address,
    session: Mutex<Option<ImapSession>>,
    tls: Arc<rustls::ClientConfig>,
    /// Remote id of the "Sent" folder (learned from LIST) for APPEND.
    sent_folder: std::sync::Mutex<Option<String>>,
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
        Self::with_tls_config(config, from, password, mirra_mail_core::net::tls_client_config())
    }

    /// Like [`ImapProvider::new`] with a custom TLS configuration, e.g. one
    /// that trusts a private CA (used by the integration tests).
    pub fn with_tls_config(config: ImapConfig, from: Address, password: String, tls: Arc<rustls::ClientConfig>) -> Arc<Self> {
        Arc::new(Self {
            config,
            password,
            from,
            session: Mutex::new(None),
            tls,
            sent_folder: std::sync::Mutex::new(None),
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
        let tcp = tokio::time::timeout(std::time::Duration::from_secs(20), TcpStream::connect(addr))
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
        let session = client
            .login(&self.config.username, &self.password)
            .await
            .map_err(|(e, _)| Error::Auth(e.to_string()))?;
        debug!(host = %self.config.imap_host, "IMAP session established");
        Ok(session)
    }

    /// Cached session; reconnects if there is none.
    async fn session(&self) -> Result<MutexGuard<'_, Option<ImapSession>>> {
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            *guard = Some(self.connect().await?);
        }
        Ok(guard)
    }

    /// Run `f` on the session; drops the session on network errors so the
    /// next call reconnects.
    async fn with_session<T, F>(&self, f: F) -> Result<T>
    where
        F: for<'s> FnOnce(&'s mut ImapSession) -> futures::future::BoxFuture<'s, Result<T>>,
    {
        let mut guard = self.session().await?;
        let session = guard.as_mut().expect("session present");
        let result = f(session).await;
        while session.unsolicited_responses.try_recv().is_ok() {}
        if matches!(result, Err(Error::Network(_))) {
            *guard = None;
        }
        result
    }

    /// Verify the credentials (used by the account setup dialog).
    pub async fn test_login(&self) -> Result<()> {
        self.with_session(|s| Box::pin(async move { s.noop().await.map_err(imap_err) })).await
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

/// Build the RFC 5322 message for sending.
pub fn build_message(from: &Address, m: &OutgoingMessage) -> Result<lettre::Message> {
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
    b = b.user_agent("Mirra Mail".into());
    let text = html_to_text(&m.body_html);
    b.multipart(MultiPart::alternative_plain_html(text, m.body_html.clone()))
        .map_err(|e| Error::Other(e.to_string()))
}

#[async_trait]
impl MailProvider for ImapProvider {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        let folders = self
            .with_session(|s| {
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
        Ok(folders)
    }

    async fn sync_folder(&self, folder: &RemoteFolder, state: Option<&str>) -> Result<FolderChanges> {
        let name = folder.remote_id.clone();
        let previous = parse_state(state);
        self.with_session(move |s| {
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

                let mut all: Vec<u32> = s.uid_search("ALL").await.map_err(imap_err)?.into_iter().collect();
                all.sort_unstable();
                let window: Vec<u32> = all.iter().rev().take(WINDOW).copied().collect();
                let max_uid = all.last().copied().unwrap_or(0);

                let new_uids: Vec<u32> = window.iter().copied().filter(|u| reset || *u > known_max).collect();
                for chunk in new_uids.chunks(CHUNK) {
                    let fetches: Vec<Fetch> = s
                        .uid_fetch(uid_set(chunk), "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])")
                        .await
                        .map_err(imap_err)?
                        .try_collect()
                        .await
                        .map_err(imap_err)?;
                    changes.upserted.extend(fetches.iter().filter_map(message_from_fetch));
                }

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

                changes.present = Some(window.iter().map(u32::to_string).collect());
                changes.new_state = Some(format!("v1:{validity}:{max_uid}"));
                Ok(changes)
            })
        })
        .await
    }

    async fn fetch_body(&self, folder_remote_id: &str, message_remote_id: &str) -> Result<FetchedBody> {
        let (folder, uid) = (folder_remote_id.to_string(), message_remote_id.to_string());
        let raw = self
            .with_session(move |s| {
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
        Ok(FetchedBody { body: parse_body(&raw), raw: Some(raw) })
    }

    async fn fetch_attachment(&self, folder_remote_id: &str, message_remote_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let fetched = self.fetch_body(folder_remote_id, message_remote_id).await?;
        let index: usize = attachment_id.parse().map_err(|_| Error::NotFound(attachment_id.into()))?;
        mirra_mail_core::preview::attachment_bytes(&fetched.raw.unwrap_or_default(), index)
            .ok_or_else(|| Error::NotFound(attachment_id.into()))
    }

    async fn set_flags(&self, folder_remote_id: &str, message_remote_id: &str, read: Option<bool>, flagged: Option<bool>) -> Result<()> {
        let (folder, uid) = (folder_remote_id.to_string(), message_remote_id.to_string());
        self.with_session(move |s| {
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
        self.with_session(move |s| {
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
        self.with_session(move |s| {
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

    async fn send(&self, message: &OutgoingMessage) -> Result<()> {
        let msg = build_message(&self.from, message)?;
        let raw = msg.formatted();
        self.smtp_send(msg).await?;

        // Gmail stores sent mail itself; everyone else needs an APPEND.
        let sent = self.sent_folder.lock().unwrap().clone();
        if let Some(sent) = sent.filter(|_| !self.config.imap_host.ends_with("gmail.com")) {
            self.with_session(move |s| {
                Box::pin(async move { s.append(&sent, Some("(\\Seen)"), None, &raw).await.map_err(imap_err) })
            })
            .await?;
        }
        Ok(())
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
        let raw = String::from_utf8(build_message(&from, &msg).unwrap().formatted()).unwrap();
        assert!(raw.contains("In-Reply-To: <abc@example.com>"));
        assert!(raw.contains("multipart/alternative"));
        assert!(raw.contains("To: alice@example.com"));
    }
}
