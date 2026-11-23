//! Recognising an Ondura Server.
//!
//! Ondura Server (Ondura-Suite/Ondura-Server) speaks EWS, so Ondura Mail uses
//! it like an Exchange server, but it identifies itself: every HTTP response
//! carries `X-Ondura-Server: Ondura-Server/<version>`, and
//! `GET /.well-known/ondura-server` returns, without signing in,
//!
//! ```json
//! { "identifier": "ondura-server", "version": "0.1.0", "hostname": "mail.example.com",
//!   "endpoints": { "ews": "https://mail.example.com/EWS/Exchange.asmx", "webmail": "…" } }
//! ```
//!
//! The automatic setup looks for it next to the e-mail domain, the manual
//! setup asks for its name, and an EWS account added for an Ondura Server is
//! marked as one (`EwsConfig::product`).

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// What an Ondura Server says about itself.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OnduraServer {
    pub version: String,
    pub hostname: String,
    pub ews_url: String,
    pub webmail_url: Option<String>,
}

#[derive(Deserialize)]
struct Identity {
    identifier: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    endpoints: Endpoints,
}

#[derive(Deserialize, Default)]
struct Endpoints {
    ews: Option<String>,
    webmail: Option<String>,
}

const HEADER: &str = "x-ondura-server";

/// HTTP client with the certificates the user trusts (a self-hosted server
/// often has its own certificate) and a short timeout: detection must not
/// hold up the setup.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .tls_backend_preconfigured((*ondura_mail_core::net::tls_client_config()).clone())
        .timeout(Duration::from_secs(5))
        .user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

/// `https://host[:port]` for a server name or any URL on the server.
pub fn origin(server: &str) -> Option<String> {
    let s = server.trim().trim_end_matches('/');
    if s.is_empty() || s.contains(char::is_whitespace) {
        return None;
    }
    let with_scheme = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let url = reqwest::Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?;
    Some(match url.port() {
        Some(p) => format!("{}://{host}:{p}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    })
}

/// Parses the discovery document; `None` if it is not an Ondura Server's.
fn parse_identity(body: &str, origin: &str) -> Option<OnduraServer> {
    let id: Identity = serde_json::from_str(body).ok()?;
    if id.identifier != ondura_mail_core::ONDURA_SERVER {
        return None;
    }
    let hostname = if id.hostname.is_empty() { origin.split("://").nth(1).unwrap_or(origin).to_string() } else { id.hostname };
    Some(OnduraServer {
        ews_url: id.endpoints.ews.unwrap_or_else(|| format!("{origin}/EWS/Exchange.asmx")),
        webmail_url: id.endpoints.webmail,
        version: id.version,
        hostname,
    })
}

/// The Ondura Server at `server` (a name like `mail.example.com` or a URL).
pub async fn identify(server: &str) -> Option<OnduraServer> {
    let origin = origin(server)?;
    let http = client();
    let resp = http.get(format!("{origin}/.well-known/ondura-server")).send().await.ok()?;
    let header = resp.headers().get(HEADER).and_then(|v| v.to_str().ok()).map(str::to_string);
    if resp.status().is_success()
        && let Ok(body) = resp.text().await
        && let Some(found) = parse_identity(&body, &origin)
    {
        return Some(found);
    }
    // An older server or a proxy in front of the document: the header alone.
    let version = header?.strip_prefix("Ondura-Server/").map(str::to_string).unwrap_or_default();
    Some(OnduraServer {
        version,
        hostname: origin.split("://").nth(1).unwrap_or(&origin).to_string(),
        ews_url: format!("{origin}/EWS/Exchange.asmx"),
        webmail_url: None,
    })
}

/// The first Ondura Server among the usual names of a mail domain
/// (`domain`, `mail.`, `autodiscover.`, the MX host), asked in parallel.
pub async fn find_for_domain(domain: &str, mx: Option<&str>) -> Option<OnduraServer> {
    let mut names = vec![domain.to_string(), format!("mail.{domain}"), format!("autodiscover.{domain}")];
    if let Some(mx) = mx.map(|m| m.trim_end_matches('.').to_string())
        && !names.contains(&mx)
    {
        names.push(mx);
    }
    let found = futures::future::join_all(names.iter().map(|n| identify(n))).await;
    found.into_iter().flatten().next()
}

/// Manual setup: the Ondura Server at the name the user entered.
#[tauri::command]
pub async fn detect_ondura_server(server: String) -> Result<OnduraServer, String> {
    if origin(&server).is_none() {
        return Err(ondura_i18n::tr!("Bitte den Namen des Servers eingeben, z. B. mail.example.com."));
    }
    identify(&server).await.ok_or_else(|| ondura_i18n::tr!("Unter {0} wurde kein Ondura Server gefunden.", server.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins() {
        assert_eq!(origin("mail.example.com").as_deref(), Some("https://mail.example.com"));
        assert_eq!(origin(" https://mail.example.com/EWS/Exchange.asmx ").as_deref(), Some("https://mail.example.com"));
        assert_eq!(origin("http://10.0.0.5:8080/").as_deref(), Some("http://10.0.0.5:8080"));
        assert_eq!(origin(""), None);
        assert_eq!(origin("mail example"), None);
    }

    #[test]
    fn reads_the_discovery_document() {
        let body = r#"{"product":"Ondura Server","vendor":"Ondura","identifier":"ondura-server","version":"0.1.0","hostname":"mail.example.com",
            "protocols":["EWS"],"endpoints":{"ews":"https://mail.example.com/EWS/Exchange.asmx","activesync":"x","autodiscover":"y","webmail":null}}"#;
        let s = parse_identity(body, "https://example.com").unwrap();
        assert_eq!(s.version, "0.1.0");
        assert_eq!(s.hostname, "mail.example.com");
        assert_eq!(s.ews_url, "https://mail.example.com/EWS/Exchange.asmx");
        assert_eq!(s.webmail_url, None);
        assert!(parse_identity(r#"{"identifier":"something-else"}"#, "https://x").is_none());
        assert!(parse_identity("<html></html>", "https://x").is_none());
        let minimal = parse_identity(r#"{"identifier":"ondura-server"}"#, "https://mail.example.org").unwrap();
        assert_eq!(minimal.ews_url, "https://mail.example.org/EWS/Exchange.asmx");
        assert_eq!(minimal.hostname, "mail.example.org");
    }
}
