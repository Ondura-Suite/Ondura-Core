//! OAuth 2.0 for the Microsoft identity platform: authorization code flow with
//! PKCE and a loopback redirect (`http://localhost:<random port>`), which is
//! what Microsoft recommends for desktop apps.

use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use nexora_mail_core::{Error, Result, SecretStore};
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::debug;

/// Delegated permissions requested at sign-in. Calendar and contacts are
/// requested up front so the other Nexora apps can reuse the account.
pub const SCOPES: &str = "offline_access openid profile email User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Contacts.ReadWrite Tasks.ReadWrite";

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: String,
}

fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::rng();
    (0..len).map(|_| CHARS[rng.random_range(0..CHARS.len())] as char).collect()
}

fn endpoint(tenant: &str, path: &str) -> String {
    format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{path}")
}

async fn token_request(http: &reqwest::Client, tenant: &str, form: &[(&str, &str)]) -> Result<TokenResponse> {
    let resp = http.post(endpoint(tenant, "token")).form(form).send().await.map_err(Error::network)?;
    let status = resp.status();
    let body = resp.text().await.map_err(Error::network)?;
    if status.is_success() {
        Ok(serde_json::from_str(&body)?)
    } else {
        let err: TokenError = serde_json::from_str(&body).unwrap_or(TokenError { error: status.to_string(), error_description: body });
        Err(Error::Auth(format!("{}: {}", err.error, err.error_description)))
    }
}

/// Interactive sign-in. `open_browser` receives the URL to open in the
/// user's default browser; the function then waits for the redirect.
pub async fn login_interactive(
    http: &reqwest::Client,
    tenant: &str,
    client_id: &str,
    open_browser: impl FnOnce(&str) -> std::result::Result<(), String>,
) -> Result<TokenResponse> {
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let redirect_uri = format!("http://localhost:{}", listener.local_addr()?.port());

    let mut url = url::Url::parse(&endpoint(tenant, "authorize")).expect("static url");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    open_browser(url.as_str()).map_err(Error::Other)?;

    let code = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(&listener, &state))
        .await
        .map_err(|_| Error::Auth("sign-in timed out".into()))??;

    token_request(
        http,
        tenant,
        &[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", &verifier),
            ("scope", SCOPES),
        ],
    )
    .await
}

const DONE_PAGE: &str = "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><title>Nexora</title>\
<body style=\"font-family:Segoe UI,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f5f5f5\">\
<div style=\"background:#fff;padding:32px 40px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.12)\">\
<h2 style=\"margin:0 0 8px;color:#0f6cbd\">Anmeldung abgeschlossen</h2>\
<p style=\"margin:0;color:#424242\">Sie k&ouml;nnen dieses Fenster jetzt schlie&szlig;en und zu Nexora zur&uuml;ckkehren.</p>\
</div></body></html>";

async fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String> {
    loop {
        let (mut socket, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let n = socket.read(&mut buf).await?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
        let url = url::Url::parse(&format!("http://localhost{target}")).map_err(Error::protocol)?;
        let param = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());

        let (code, error) = (param("code"), param("error"));
        if code.is_none() && error.is_none() {
            // e.g. /favicon.ico
            let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
            continue;
        }
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            DONE_PAGE.len(),
            DONE_PAGE
        );
        let _ = socket.write_all(response.as_bytes()).await;
        if let Some(e) = error {
            return Err(Error::Auth(format!("{e}: {}", param("error_description").unwrap_or_default())));
        }
        if param("state").as_deref() != Some(expected_state) {
            return Err(Error::Auth("state mismatch".into()));
        }
        debug!("received authorization code");
        return Ok(code.expect("checked above"));
    }
}

/// Holds the access token and refreshes it with the refresh token kept in
/// the [`SecretStore`].
pub struct TokenManager {
    http: reqwest::Client,
    tenant: String,
    client_id: String,
    secrets: Arc<dyn SecretStore>,
    secret_key: String,
    cached: Mutex<Option<(String, Instant)>>,
}

impl TokenManager {
    pub fn new(http: reqwest::Client, tenant: String, client_id: String, secrets: Arc<dyn SecretStore>, secret_key: String) -> Self {
        Self { http, tenant, client_id, secrets, secret_key, cached: Mutex::new(None) }
    }

    /// Seed the manager with a fresh sign-in result.
    pub async fn store(&self, token: &TokenResponse) -> Result<()> {
        if let Some(rt) = &token.refresh_token {
            self.secrets.set(&self.secret_key, rt)?;
        }
        *self.cached.lock().await = Some((token.access_token.clone(), Instant::now() + Duration::from_secs(token.expires_in)));
        Ok(())
    }

    /// A valid access token, refreshed if it expires within a minute.
    pub async fn access_token(&self) -> Result<String> {
        let mut cached = self.cached.lock().await;
        if let Some((token, expires)) = cached.as_ref()
            && *expires > Instant::now() + Duration::from_secs(60)
        {
            return Ok(token.clone());
        }
        let refresh = self
            .secrets
            .get(&self.secret_key)?
            .ok_or_else(|| Error::Auth("not signed in".into()))?;
        let token = token_request(
            &self.http,
            &self.tenant,
            &[
                ("client_id", self.client_id.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh.as_str()),
                ("scope", SCOPES),
            ],
        )
        .await?;
        if let Some(rt) = &token.refresh_token {
            self.secrets.set(&self.secret_key, rt)?;
        }
        *cached = Some((token.access_token.clone(), Instant::now() + Duration::from_secs(token.expires_in)));
        Ok(token.access_token)
    }

    /// Force a refresh on the next call (after a 401).
    pub async fn invalidate(&self) {
        *self.cached.lock().await = None;
    }
}
