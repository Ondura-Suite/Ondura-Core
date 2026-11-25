//! Push over the client API's WebSocket (`/api/v1/ws`).
//!
//! One connection per account runs in the background while the engine
//! watches the inbox. The server sends `{"type":"changed"}` after every
//! change and `{"type":"sync"}` on connect or when it fell behind; both wake
//! the engine. The connection is re-established with a growing delay when it
//! drops, and closed again when nobody waited for a while.

use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use futures::StreamExt;
use ondura_mail_core::{Error, Result};
use tokio::net::TcpStream;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tracing::debug;

use super::{CLIENT_HEADER, CLIENT_NAME};

/// Without a waiter for this long the connection is closed.
const IDLE_CLOSE: Duration = Duration::from_secs(15 * 60);
/// No frame at all for this long: the connection is considered dead.
const SILENCE: Duration = Duration::from_secs(120);
const PING_EVERY: Duration = Duration::from_secs(45);

struct Shared {
    origin: String,
    auth: String,
    /// Set when the server reported a change nobody has picked up yet.
    pending: Mutex<bool>,
    notify: Notify,
    last_wait: Mutex<Instant>,
    /// The server refused the WebSocket (no push): fall back to polling.
    unsupported: Mutex<bool>,
    running: Mutex<bool>,
}

pub struct Push(Arc<Shared>);

impl Push {
    pub fn new(origin: String, username: String, password: String) -> Self {
        Self(Arc::new(Shared {
            origin,
            auth: format!("Basic {}", B64.encode(format!("{username}:{password}"))),
            pending: Mutex::new(false),
            notify: Notify::new(),
            last_wait: Mutex::new(Instant::now()),
            unsupported: Mutex::new(false),
            running: Mutex::new(false),
        }))
    }

    /// Waits until the server reports a change (`true`) or `timeout` passes.
    pub async fn wait(&self, timeout: Duration) -> Result<bool> {
        let s = &self.0;
        *s.last_wait.lock().unwrap() = Instant::now();
        if *s.unsupported.lock().unwrap() {
            return Err(Error::Unsupported("push".into()));
        }
        self.ensure_running();
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let notified = s.notify.notified();
            if std::mem::take(&mut *s.pending.lock().unwrap()) {
                return Ok(true);
            }
            if *s.unsupported.lock().unwrap() {
                return Err(Error::Unsupported("push".into()));
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                *s.last_wait.lock().unwrap() = Instant::now();
                return Ok(false);
            }
        }
    }

    fn ensure_running(&self) {
        let mut running = self.0.running.lock().unwrap();
        if *running {
            return;
        }
        *running = true;
        tokio::spawn(run(Arc::downgrade(&self.0)));
    }
}

impl Drop for Push {
    fn drop(&mut self) {
        // Wakes the background task, which then sees the provider is gone.
        self.0.notify.notify_waiters();
    }
}

fn signal(s: &Shared) {
    *s.pending.lock().unwrap() = true;
    s.notify.notify_waiters();
}

async fn run(weak: Weak<Shared>) {
    let mut failures = 0u32;
    loop {
        let Some(s) = weak.upgrade() else { return };
        if s.last_wait.lock().unwrap().elapsed() > IDLE_CLOSE {
            *s.running.lock().unwrap() = false;
            return;
        }
        let result = connection(&s, &weak).await;
        let Some(s) = weak.upgrade() else { return };
        match result {
            Err(Error::Unsupported(e)) => {
                debug!(error = %e, "push not available");
                *s.unsupported.lock().unwrap() = true;
                *s.running.lock().unwrap() = false;
                s.notify.notify_waiters();
                return;
            }
            Err(e) => {
                failures += 1;
                debug!(error = %e, failures, "push connection lost");
            }
            Ok(()) => failures = 0,
        }
        drop(s);
        tokio::time::sleep(Duration::from_secs((5 * 2u64.pow(failures.min(6))).min(300))).await;
    }
}

/// One WebSocket connection until it ends.
async fn connection(s: &Arc<Shared>, weak: &Weak<Shared>) -> Result<()> {
    let ws_url = format!("{}/api/v1/ws", s.origin.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1));
    let url = reqwest::Url::parse(&ws_url).map_err(|e| Error::Other(e.to_string()))?;
    let host = url.host_str().ok_or_else(|| Error::Other("no host".into()))?.to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let mut req = ws_url.as_str().into_client_request().map_err(|e| Error::Other(e.to_string()))?;
    req.headers_mut().insert("Authorization", HeaderValue::from_str(&s.auth).map_err(|e| Error::Other(e.to_string()))?);
    req.headers_mut().insert(CLIENT_HEADER, HeaderValue::from_static(CLIENT_NAME));

    let tcp = tokio::time::timeout(Duration::from_secs(20), TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| Error::Network("connection timed out".into()))??;
    let refused = |e: tokio_tungstenite::tungstenite::Error| match e {
        tokio_tungstenite::tungstenite::Error::Http(r) if r.status().as_u16() == 401 => Error::Auth("push".into()),
        tokio_tungstenite::tungstenite::Error::Http(r) if r.status().is_client_error() => Error::Unsupported(format!("HTTP {}", r.status())),
        other => Error::Network(other.to_string()),
    };
    if url.scheme() == "wss" {
        let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| Error::Network(e.to_string()))?;
        let tls = tokio_rustls::TlsConnector::from(ondura_mail_core::net::tls_client_config()).connect(name, tcp).await?;
        let (ws, _) = tokio_tungstenite::client_async(req, tls).await.map_err(refused)?;
        pump(ws, s, weak).await
    } else {
        let (ws, _) = tokio_tungstenite::client_async(req, tcp).await.map_err(refused)?;
        pump(ws, s, weak).await
    }
}

async fn pump<S>(ws: tokio_tungstenite::WebSocketStream<S>, s: &Arc<Shared>, weak: &Weak<Shared>) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use futures::SinkExt;
    debug!(origin = %s.origin, "push connected");
    let (mut sink, mut stream) = ws.split();
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    loop {
        tokio::select! {
            msg = tokio::time::timeout(SILENCE, stream.next()) => {
                let msg = match msg {
                    Err(_) => return Err(Error::Network("push connection silent".into())),
                    Ok(None) => return Ok(()),
                    Ok(Some(m)) => m.map_err(|e| Error::Network(e.to_string()))?,
                };
                if let Message::Text(t) = &msg
                    && let Ok(v) = serde_json::from_str::<serde_json::Value>(t)
                    && matches!(v["type"].as_str(), Some("changed" | "sync"))
                {
                    signal(s);
                }
                if let Message::Close(_) = msg {
                    return Ok(());
                }
            }
            _ = ping.tick() => {
                // Nobody waits any more (account removed, app idle): close.
                if weak.strong_count() <= 1 || s.last_wait.lock().unwrap().elapsed() > IDLE_CLOSE {
                    let _ = sink.send(Message::Close(None)).await;
                    return Ok(());
                }
                sink.send(Message::Ping(Vec::new().into())).await.map_err(|e| Error::Network(e.to_string()))?;
            }
        }
    }
}
