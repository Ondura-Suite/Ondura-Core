//! Finds the mail server settings for an email address, like Thunderbird
//! and Outlook do, so the account dialog only needs the password:
//!
//! 1. the provider's own autoconfig file (`autoconfig.<domain>`,
//!    `<domain>/.well-known/autoconfig`),
//! 2. the Thunderbird ISP database (also for the domain of the MX server,
//!    which covers custom domains hosted at Google, IONOS, Strato …),
//! 3. DNS SRV records (RFC 6186),
//! 4. probing the usual host names and ports, preferring implicit TLS.
//!
//! Every server found is checked with a TLS handshake before it is
//! suggested. Domains whose mail is handled by Microsoft 365 or an Exchange
//! server are reported as such, so the dialog can offer the better account
//! type.

use std::time::Duration;

use ondura_mail_core::model::Security;
use ondura_mail_core::net::{ProbeMode, probe_certificate};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub security: Security,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub imap: Option<Server>,
    pub smtp: Option<Server>,
    /// User name for both servers (often the address or its local part).
    pub username: Option<String>,
    /// Where the settings came from: "provider", "ispdb", "dns", "probe".
    pub source: Option<String>,
    /// Name of the provider (from the autoconfig file).
    pub provider: Option<String>,
    /// "microsoft365" or "exchange" when that account type fits better.
    pub suggest: Option<String>,
    /// EWS address for an Exchange server.
    pub ews_url: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct Config {
    provider: Option<String>,
    imap: Vec<(Server, String)>,
    smtp: Vec<(Server, String)>,
}

const ISPDB: &str = "https://autoconfig.thunderbird.net/v1.1/";

/// Settings for `email`, or empty fields if nothing was found.
#[tauri::command]
pub async fn discover_mail_settings(email: String) -> Result<Discovery, String> {
    let email = email.trim().to_lowercase();
    let Some((local, domain)) = email.rsplit_once('@').filter(|(l, d)| !l.is_empty() && d.contains('.')) else {
        return Ok(Discovery::default());
    };
    let domain = domain.trim_end_matches('.').to_string();
    let http = crate::update::client(Some(Duration::from_secs(8)));
    let mx = mx_host(&http, &domain).await;

    let mut found = Discovery::default();
    if mx.as_deref().is_some_and(|mx| mx.ends_with(".mail.protection.outlook.com")) {
        found.suggest = Some("microsoft365".into());
    }

    let candidates = autoconfig_sources(&http, &email, &domain, mx.as_deref()).await;
    for (source, config) in candidates {
        if let Some(d) = pick(&config, &email, local, &domain).await {
            return Ok(Discovery { source: Some(source.into()), provider: config.provider.clone(), suggest: found.suggest, ..d });
        }
    }
    if let Some(d) = from_srv(&http, &domain).await {
        return Ok(Discovery { source: Some("dns".into()), suggest: found.suggest, username: Some(email.clone()), ..d });
    }
    if found.suggest.is_none() && is_exchange(&http, &domain).await {
        found.suggest = Some("exchange".into());
        found.ews_url = Some(format!("https://mail.{domain}/EWS/Exchange.asmx"));
    }
    let (imap, smtp) = tokio::join!(probe_imap(&domain, mx.as_deref()), probe_smtp(&domain, mx.as_deref()));
    if imap.is_some() || smtp.is_some() {
        found.imap = imap;
        found.smtp = smtp;
        found.username = Some(email.clone());
        found.source = Some("probe".into());
    }
    Ok(found)
}

/// Autoconfig files in order of trust: provider, then the ISP database for
/// the domain and for the MX domain.
async fn autoconfig_sources(http: &reqwest::Client, email: &str, domain: &str, mx: Option<&str>) -> Vec<(&'static str, Config)> {
    let with_address = |base: String| reqwest::Url::parse_with_params(&base, [("emailaddress", email)]).map(String::from).unwrap_or(base);
    let urls = [
        ("provider", with_address(format!("https://autoconfig.{domain}/mail/config-v1.1.xml"))),
        ("provider", with_address(format!("https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml"))),
        ("ispdb", format!("{ISPDB}{domain}")),
    ];
    let fetches = urls.iter().map(|(_, url)| fetch_config(http, url));
    let results = futures::future::join_all(fetches).await;
    let mut out: Vec<(&'static str, Config)> = urls.iter().zip(results).filter_map(|((src, _), c)| c.map(|c| (*src, c))).collect();
    if out.is_empty()
        && let Some(mx) = mx
    {
        // mx1.example-hoster.net → example-hoster.net (and the full name).
        let labels: Vec<&str> = mx.split('.').collect();
        let mut tried = vec![domain.to_string()];
        for n in [2, 3] {
            if labels.len() >= n {
                let d = labels[labels.len() - n..].join(".");
                if !tried.contains(&d) {
                    if let Some(c) = fetch_config(http, &format!("{ISPDB}{d}")).await {
                        out.push(("ispdb", c));
                        break;
                    }
                    tried.push(d);
                }
            }
        }
    }
    out
}

async fn fetch_config(http: &reqwest::Client, url: &str) -> Option<Config> {
    let resp = http.get(url).send().await.ok()?.error_for_status().ok()?;
    let text = resp.text().await.ok()?;
    let config = parse_config(&text);
    (!config.imap.is_empty() || !config.smtp.is_empty()).then_some(config)
}

/// Parses a Thunderbird autoconfig file (clientConfig v1.1).
fn parse_config(xml: &str) -> Config {
    use quick_xml::Reader;
    use quick_xml::events::Event;

    #[derive(Default)]
    struct Current {
        incoming: bool,
        kind: String,
        host: String,
        port: String,
        socket: String,
        user: String,
    }
    let mut config = Config::default();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut current: Option<Current> = None;
    let mut path: Vec<String> = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "incomingServer" || name == "outgoingServer" {
                    let kind = e
                        .attributes()
                        .flatten()
                        .find(|a| a.key.local_name().as_ref() == b"type")
                        .map(|a| String::from_utf8_lossy(&a.value).to_string())
                        .unwrap_or_default();
                    current = Some(Current { incoming: name == "incomingServer", kind, ..Default::default() });
                }
                path.push(name);
            }
            Ok(Event::Text(t)) => {
                let text = t.decode().map(|s| s.trim().to_string()).unwrap_or_default();
                match (current.as_mut(), path.last().map(String::as_str)) {
                    (Some(c), Some("hostname")) => c.host = text,
                    (Some(c), Some("port")) => c.port = text,
                    (Some(c), Some("socketType")) => c.socket = text,
                    (Some(c), Some("username")) => c.user = text,
                    (None, Some("displayName")) if config.provider.is_none() => config.provider = Some(text),
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                path.pop();
                if (name == "incomingServer" || name == "outgoingServer")
                    && let Some(c) = current.take()
                {
                    let security = match c.socket.as_str() {
                        "SSL" => Some(Security::Tls),
                        "STARTTLS" => Some(Security::StartTls),
                        _ => None, // plain text is never suggested
                    };
                    if let (Some(security), Ok(port)) = (security, c.port.parse::<u16>())
                        && !c.host.is_empty()
                    {
                        let server = (Server { host: c.host, port, security }, c.user);
                        match (c.incoming, c.kind.as_str()) {
                            (true, "imap") => config.imap.push(server),
                            (false, "smtp") => config.smtp.push(server),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    config
}

/// First reachable IMAP and SMTP server of a config (implicit TLS first).
async fn pick(config: &Config, email: &str, local: &str, domain: &str) -> Option<Discovery> {
    let sorted = |list: &[(Server, String)]| {
        let mut list = list.to_vec();
        list.sort_by_key(|(s, _)| matches!(s.security, Security::StartTls));
        list
    };
    let imap = first_reachable(&sorted(&config.imap), false).await;
    let smtp = first_reachable(&sorted(&config.smtp), true).await;
    let (imap, user) = match imap {
        Some((s, u)) => (Some(s), Some(u)),
        None => (None, None),
    };
    if imap.is_none() && smtp.is_none() {
        return None;
    }
    let username = user.or_else(|| smtp.as_ref().map(|(_, u)| u.clone())).map(|u| u.replace("%EMAILADDRESS%", email).replace("%EMAILLOCALPART%", local).replace("%EMAILDOMAIN%", domain));
    Some(Discovery { imap, smtp: smtp.map(|(s, _)| s), username: username.filter(|u| !u.contains('%')).or(Some(email.to_string())), ..Default::default() })
}

async fn first_reachable(list: &[(Server, String)], smtp: bool) -> Option<(Server, String)> {
    for (server, user) in list {
        if reachable(server, smtp).await {
            return Some((server.clone(), user.clone()));
        }
    }
    None
}

/// TLS handshake with the server (STARTTLS included); a certificate the
/// public roots don't accept still counts, the dialog asks about it later.
async fn reachable(server: &Server, smtp: bool) -> bool {
    let mode = match (server.security, smtp) {
        (Security::Tls, _) => ProbeMode::Direct,
        (Security::StartTls, false) => ProbeMode::ImapStartTls,
        (Security::StartTls, true) => ProbeMode::SmtpStartTls,
    };
    tokio::time::timeout(Duration::from_secs(6), probe_certificate(&server.host, server.port, mode)).await.is_ok_and(|r| r.is_ok())
}

/// Probes the usual names; among the reachable ones a valid certificate wins.
async fn probe(hosts: Vec<String>, ports: [(u16, Security); 2], smtp: bool) -> Option<Server> {
    let candidates: Vec<Server> = hosts.iter().flat_map(|h| ports.iter().map(move |(port, security)| Server { host: h.clone(), port: *port, security: *security })).collect();
    let checks = candidates.iter().map(|s| async move {
        let mode = match (s.security, smtp) {
            (Security::Tls, _) => ProbeMode::Direct,
            (Security::StartTls, false) => ProbeMode::ImapStartTls,
            (Security::StartTls, true) => ProbeMode::SmtpStartTls,
        };
        match tokio::time::timeout(Duration::from_secs(6), probe_certificate(&s.host, s.port, mode)).await {
            Ok(Ok(info)) => Some(info.problem.is_none()),
            _ => None,
        }
    });
    let results = futures::future::join_all(checks).await;
    let valid = candidates.iter().zip(&results).find(|(_, r)| **r == Some(true));
    let any = candidates.iter().zip(&results).find(|(_, r)| r.is_some());
    valid.or(any).map(|(s, _)| s.clone())
}

fn hosts(prefix: &str, domain: &str, mx: Option<&str>) -> Vec<String> {
    let mut hosts = vec![format!("{prefix}.{domain}"), format!("mail.{domain}"), domain.to_string()];
    if let Some(mx) = mx
        && !hosts.iter().any(|h| h == mx)
    {
        hosts.push(mx.to_string());
    }
    hosts
}

async fn probe_imap(domain: &str, mx: Option<&str>) -> Option<Server> {
    probe(hosts("imap", domain, mx), [(993, Security::Tls), (143, Security::StartTls)], false).await
}

async fn probe_smtp(domain: &str, mx: Option<&str>) -> Option<Server> {
    probe(hosts("smtp", domain, mx), [(465, Security::Tls), (587, Security::StartTls)], true).await
}

/// DNS over HTTPS (the system resolver can't look up MX/SRV records).
async fn dns(http: &reqwest::Client, name: &str, kind: &str) -> Vec<String> {
    #[derive(serde::Deserialize)]
    struct Answer {
        #[serde(rename = "type")]
        kind: u16,
        data: String,
    }
    #[derive(serde::Deserialize)]
    struct Reply {
        #[serde(rename = "Answer", default)]
        answer: Vec<Answer>,
    }
    let wanted = match kind {
        "MX" => 15,
        "SRV" => 33,
        _ => 0,
    };
    let Ok(url) = reqwest::Url::parse_with_params("https://cloudflare-dns.com/dns-query", [("name", name), ("type", kind)]) else { return Vec::new() };
    let Ok(resp) = http.get(url).header("accept", "application/dns-json").send().await else { return Vec::new() };
    let Ok(reply) = resp.json::<Reply>().await else { return Vec::new() };
    reply.answer.into_iter().filter(|a| a.kind == wanted).map(|a| a.data).collect()
}

/// Mail server with the lowest preference.
async fn mx_host(http: &reqwest::Client, domain: &str) -> Option<String> {
    let mut records: Vec<(u32, String)> = dns(http, domain, "MX")
        .await
        .into_iter()
        .filter_map(|r| {
            let (pref, host) = r.split_once(' ')?;
            Some((pref.parse().ok()?, host.trim_end_matches('.').to_lowercase()))
        })
        .filter(|(_, h)| !h.is_empty())
        .collect();
    records.sort();
    records.into_iter().next().map(|(_, h)| h)
}

/// RFC 6186: `_imaps._tcp`, `_imap._tcp`, `_submissions._tcp`, `_submission._tcp`.
async fn from_srv(http: &reqwest::Client, domain: &str) -> Option<Discovery> {
    async fn srv(http: &reqwest::Client, name: String) -> Option<(String, u16)> {
        let mut records: Vec<(u32, u16, String)> = dns(http, &name, "SRV")
            .await
            .into_iter()
            .filter_map(|r| {
                let parts: Vec<&str> = r.split_whitespace().collect();
                let [prio, _weight, port, target] = parts[..] else { return None };
                let target = target.trim_end_matches('.').to_string();
                (!target.is_empty() && target != ".").then_some((prio.parse().ok()?, port.parse().ok()?, target))
            })
            .collect();
        records.sort();
        records.into_iter().next().map(|(_, port, host)| (host, port))
    }
    let (imaps, imap, subs, sub) = tokio::join!(
        srv(http, format!("_imaps._tcp.{domain}")),
        srv(http, format!("_imap._tcp.{domain}")),
        srv(http, format!("_submissions._tcp.{domain}")),
        srv(http, format!("_submission._tcp.{domain}")),
    );
    let imap = imaps.map(|(host, port)| Server { host, port, security: Security::Tls }).or(imap.map(|(host, port)| Server { host, port, security: Security::StartTls }));
    let smtp = subs.map(|(host, port)| Server { host, port, security: Security::Tls }).or(sub.map(|(host, port)| Server { host, port, security: Security::StartTls }));
    let imap = match imap {
        Some(s) if reachable(&s, false).await => Some(s),
        _ => None,
    };
    let smtp = match smtp {
        Some(s) if reachable(&s, true).await => Some(s),
        _ => None,
    };
    (imap.is_some() || smtp.is_some()).then(|| Discovery { imap, smtp, ..Default::default() })
}

/// An Exchange server answers Autodiscover with an authentication request.
async fn is_exchange(http: &reqwest::Client, domain: &str) -> bool {
    for url in [format!("https://autodiscover.{domain}/autodiscover/autodiscover.xml"), format!("https://{domain}/autodiscover/autodiscover.xml")] {
        if let Ok(resp) = http.get(&url).send().await
            && resp.status() == reqwest::StatusCode::UNAUTHORIZED
            && resp.headers().get_all("www-authenticate").iter().any(|h| h.to_str().is_ok_and(|v| v.starts_with("NTLM") || v.starts_with("Negotiate")))
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_autoconfig() {
        let xml = r#"<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>
    <displayName>Example Mail</displayName>
    <incomingServer type="pop3"><hostname>pop.example.com</hostname><port>995</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
    <incomingServer type="imap"><hostname>imap.example.com</hostname><port>143</port><socketType>STARTTLS</socketType><username>%EMAILLOCALPART%</username></incomingServer>
    <incomingServer type="imap"><hostname>imap.example.com</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.example.com</hostname><port>25</port><socketType>plain</socketType></outgoingServer>
    <outgoingServer type="smtp"><hostname>smtp.example.com</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>
  </emailProvider>
</clientConfig>"#;
        let c = parse_config(xml);
        assert_eq!(c.provider.as_deref(), Some("Example Mail"));
        assert_eq!(c.imap.len(), 2);
        assert_eq!(c.imap[1].0, Server { host: "imap.example.com".into(), port: 993, security: Security::Tls });
        assert_eq!(c.imap[1].1, "%EMAILLOCALPART%");
        // Plain-text servers are skipped.
        assert_eq!(c.smtp.len(), 1);
        assert_eq!(c.smtp[0].0.port, 587);
    }
}
