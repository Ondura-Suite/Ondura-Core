//! Automatic replies for IMAP accounts via ManageSieve (RFC 5804) and the
//! Sieve `vacation` extension (RFC 5230), as offered by Dovecot Pigeonhole
//! and most other IMAP servers.
//!
//! Ondura keeps its reply in an own script, `ondura`. If another script was
//! active before, the Ondura script pulls it in with `include` (RFC 6609) so
//! the user's filters keep working, and turning the reply off activates the
//! previous script again. The settings are stored as JSON in a comment of
//! the script, so they survive even while the reply is off.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ondura_mail_core::model::AutoReply;
use ondura_mail_core::{Error, Result};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

/// Default ManageSieve port.
pub const PORT: u16 = 4190;
/// Name of the script Ondura manages.
pub const SCRIPT: &str = "ondura";
const MARKER: &str = "# ondura:";
const TIMEOUT: Duration = Duration::from_secs(20);

/// What Ondura stores in its script besides the Sieve code.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    reply: AutoReply,
    /// Script that was active before Ondura's (included and restored).
    #[serde(default)]
    previous: Option<String>,
}

/// One server response: data lines/literals and the final status.
#[derive(Debug, Default)]
struct Response {
    lines: Vec<String>,
    literals: Vec<String>,
}

trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}

struct Client {
    io: BufReader<Box<dyn Stream>>,
    capabilities: Vec<String>,
}

/// Quote a string for ManageSieve and Sieve.
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The quoted strings of a line, unescaped.
fn strings(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut s = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\\' => s.extend(chars.next()),
                '"' => break,
                c => s.push(c),
            }
        }
        out.push(s);
    }
    out
}

impl Client {
    async fn read_response(&mut self) -> Result<Response> {
        let mut r = Response::default();
        loop {
            let mut line = String::new();
            if self.io.read_line(&mut line).await? == 0 {
                return Err(Error::Network("ManageSieve connection closed".into()));
            }
            let line = line.trim_end_matches(['\r', '\n']).to_string();
            // A literal: {n} or {n+} at the end of the line.
            if let Some(n) = line.strip_suffix('}').and_then(|l| l.rsplit_once('{')).and_then(|(_, n)| n.trim_end_matches('+').parse::<usize>().ok()) {
                let mut buf = vec![0; n];
                self.io.read_exact(&mut buf).await?;
                r.literals.push(String::from_utf8_lossy(&buf).into_owned());
                continue;
            }
            let upper = line.to_ascii_uppercase();
            if upper == "OK" || upper.starts_with("OK ") {
                return Ok(r);
            }
            if upper.starts_with("NO") || upper.starts_with("BYE") {
                let msg = strings(&line).pop().unwrap_or(line);
                return Err(Error::Protocol(format!("ManageSieve: {msg}")));
            }
            if !line.is_empty() {
                r.lines.push(line);
            }
        }
    }

    async fn command(&mut self, cmd: &str) -> Result<Response> {
        self.io.get_mut().write_all(format!("{cmd}\r\n").as_bytes()).await?;
        self.io.get_mut().flush().await?;
        self.read_response().await
    }

    fn read_capabilities(&mut self, r: &Response) {
        self.capabilities = r.lines.iter().map(|l| strings(l).join(" ").to_ascii_uppercase()).collect();
    }

    fn has(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c.split_whitespace().next() == Some(capability))
    }

    fn sieve_extension(&self, ext: &str) -> bool {
        self.capabilities.iter().any(|c| c.starts_with("SIEVE ") && c.split_whitespace().any(|e| e.eq_ignore_ascii_case(ext)))
    }

    async fn connect(host: &str, port: u16, tls: Arc<rustls::ClientConfig>, user: &str, password: &str) -> Result<Client> {
        let tcp = tokio::time::timeout(TIMEOUT, TcpStream::connect((host, port)))
            .await
            .map_err(|_| Error::Network("ManageSieve: connection timed out".into()))?
            .map_err(|e| Error::Network(format!("ManageSieve ({host}:{port}): {e}")))?;
        let mut client = Client { io: BufReader::new(Box::new(tcp)), capabilities: Vec::new() };
        let greeting = client.read_response().await?;
        client.read_capabilities(&greeting);
        if client.has("STARTTLS") {
            client.command("STARTTLS").await?;
            let plain = client.io.into_inner();
            // Only a TcpStream is ever wrapped here; re-box after the handshake.
            let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|e| Error::Network(format!("invalid host name: {e}")))?;
            let tls = TlsConnector::from(tls).connect(name, plain).await?;
            client = Client { io: BufReader::new(Box::new(tls)), capabilities: Vec::new() };
            let caps = client.read_response().await?;
            client.read_capabilities(&caps);
        }
        let token = B64.encode(format!("\0{user}\0{password}"));
        client
            .command(&format!("AUTHENTICATE \"PLAIN\" {}", quote(&token)))
            .await
            .map_err(|e| Error::Auth(format!("ManageSieve-Anmeldung fehlgeschlagen: {e}")))?;
        Ok(client)
    }

    /// `(name, active)` of every script.
    async fn list(&mut self) -> Result<Vec<(String, bool)>> {
        let r = self.command("LISTSCRIPTS").await?;
        Ok(r.lines
            .iter()
            .filter_map(|l| {
                let name = strings(l).into_iter().next()?;
                Some((name, l.to_ascii_uppercase().trim_end().ends_with("ACTIVE")))
            })
            .collect())
    }

    async fn get(&mut self, name: &str) -> Result<String> {
        let r = self.command(&format!("GETSCRIPT {}", quote(name))).await?;
        Ok(r.literals.into_iter().next().unwrap_or_default())
    }

    async fn put(&mut self, name: &str, script: &str) -> Result<()> {
        let cmd = format!("PUTSCRIPT {} {{{}+}}\r\n{script}", quote(name), script.len());
        self.command(&cmd).await.map(|_| ())
    }

    async fn activate(&mut self, name: &str) -> Result<()> {
        self.command(&format!("SETACTIVE {}", quote(name))).await.map(|_| ())
    }

    async fn logout(mut self) {
        let _ = self.command("LOGOUT").await;
    }
}

/// Plain text of an HTML reply, keeping paragraphs and line breaks.
fn reply_text(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let Some(end) = rest[i..].find('>') else {
            rest = "";
            break;
        };
        let tag = rest[i + 1..i + end].trim().to_ascii_lowercase();
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        match name.as_str() {
            "br" => out.push('\n'),
            "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" if tag.starts_with('/') => out.push('\n'),
            _ => {}
        }
        rest = &rest[i + end + 1..];
    }
    out.push_str(rest);
    let text = out.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    text.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// Sieve `text:` block (dot-stuffed).
fn multiline(text: &str) -> String {
    let mut out = String::from("text:\r\n");
    for line in text.lines() {
        if line.starts_with('.') {
            out.push('.');
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out.push_str(".\r\n");
    out
}

/// The Sieve script for a reply.
fn script(stored: &Stored, addresses: &[String], include: bool) -> String {
    let r = &stored.reply;
    let mut requires = vec!["vacation"];
    let scheduled = r.start.zip(r.end);
    if scheduled.is_some() {
        requires.extend(["date", "relational"]);
    }
    let include_previous = include && stored.previous.is_some();
    if include_previous {
        requires.push("include");
    }
    let json = serde_json::to_string(stored).unwrap_or_default();
    let mut s = format!("# Automatic replies, managed by Ondura Mail.\r\n{MARKER}{json}\r\nrequire [{}];\r\n", requires.iter().map(|r| quote(r)).collect::<Vec<_>>().join(", "));
    let text = reply_text(if r.internal.trim().is_empty() { &r.external } else { &r.internal });
    let addresses = if addresses.is_empty() {
        String::new()
    } else {
        format!(" :addresses [{}]", addresses.iter().map(|a| quote(a)).collect::<Vec<_>>().join(", "))
    };
    let vacation = format!("vacation :days 1 :subject \"Automatische Antwort\"{addresses} {};\r\n", multiline(text.trim()));
    match scheduled {
        Some((start, end)) => {
            let t = |d: chrono::DateTime<chrono::Utc>| quote(&d.format("%Y-%m-%dT%H:%M:%S").to_string());
            s.push_str(&format!(
                "if allof (currentdate :zone \"+0000\" :value \"ge\" \"iso8601\" {}, currentdate :zone \"+0000\" :value \"le\" \"iso8601\" {}) {{\r\n{vacation}}}\r\n",
                t(start),
                t(end)
            ));
        }
        None => s.push_str(&vacation),
    }
    if let (true, Some(previous)) = (include_previous, &stored.previous) {
        s.push_str(&format!("include :personal {};\r\n", quote(previous)));
    }
    s
}

fn parse_stored(script: &str) -> Option<Stored> {
    let json = script.lines().find_map(|l| l.strip_prefix(MARKER))?;
    serde_json::from_str(json).ok()
}

/// Read the automatic reply.
pub async fn get(host: &str, tls: Arc<rustls::ClientConfig>, user: &str, password: &str) -> Result<AutoReply> {
    let mut c = Client::connect(host, PORT, tls, user, password).await?;
    let scripts = c.list().await?;
    let mut reply = AutoReply::default();
    if let Some((_, active)) = scripts.iter().find(|(n, _)| n == SCRIPT) {
        if let Some(stored) = parse_stored(&c.get(SCRIPT).await?) {
            reply = stored.reply;
        }
        reply.enabled &= *active;
    }
    c.logout().await;
    Ok(reply)
}

/// Write the automatic reply.
pub async fn set(host: &str, tls: Arc<rustls::ClientConfig>, user: &str, password: &str, reply: &AutoReply, addresses: &[String]) -> Result<()> {
    let mut c = Client::connect(host, PORT, tls, user, password).await?;
    if !c.sieve_extension("vacation") {
        c.logout().await;
        return Err(Error::Unsupported(ondura_i18n::tr!("Der Mailserver unterstützt keine Sieve-Abwesenheitsnotizen (vacation)")));
    }
    let scripts = c.list().await?;
    let own = scripts.iter().find(|(n, _)| n == SCRIPT);
    let mut previous = match own {
        Some(_) => parse_stored(&c.get(SCRIPT).await?).and_then(|s| s.previous),
        None => None,
    };
    if let Some((name, _)) = scripts.iter().find(|(n, active)| *active && n != SCRIPT) {
        previous = Some(name.clone());
    }
    previous = previous.filter(|p| scripts.iter().any(|(n, _)| n == p));
    let include = c.sieve_extension("include");
    if reply.enabled && previous.is_some() && !include {
        c.logout().await;
        return Err(Error::Unsupported(ondura_i18n::tr!("Auf dem Server ist bereits das Sieve-Skript „{0}“ aktiv, und der Server kann keine Skripte einbinden (include). Bitte die Abwesenheitsnotiz in der Webmail einrichten.", previous.unwrap_or_default())));
    }
    let stored = Stored { reply: reply.clone(), previous: previous.clone() };
    c.put(SCRIPT, &script(&stored, addresses, include)).await?;
    if reply.enabled {
        c.activate(SCRIPT).await?;
    } else if own.is_some_and(|(_, active)| *active) {
        // Hand control back to the script that was active before.
        c.activate(previous.as_deref().unwrap_or("")).await?;
    }
    c.logout().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ondura_mail_core::model::ExternalAudience;

    #[test]
    fn parses_quoted_strings() {
        assert_eq!(strings(r#""SIEVE" "fileinto vacation""#), vec!["SIEVE", "fileinto vacation"]);
        assert_eq!(strings(r#""a\"b" ACTIVE"#), vec!["a\"b"]);
    }

    #[test]
    fn builds_scheduled_script_with_include() {
        let stored = Stored {
            reply: AutoReply {
                enabled: true,
                start: Some("2026-12-20T08:00:00Z".parse().unwrap()),
                end: Some("2027-01-06T17:00:00Z".parse().unwrap()),
                internal: "<p>Ich bin im Urlaub.</p><p>.Zurück am 7.1.</p>".into(),
                external: String::new(),
                external_audience: ExternalAudience::All,
            },
            previous: Some("filters".into()),
        };
        let s = script(&stored, &["niklas@mirranet.de".into()], true);
        assert!(s.contains(r#"require ["vacation", "date", "relational", "include"];"#));
        assert!(s.contains(r#"currentdate :zone "+0000" :value "ge" "iso8601" "2026-12-20T08:00:00""#));
        assert!(s.contains(r#":addresses ["niklas@mirranet.de"]"#));
        assert!(s.contains("\r\n..Zurück am 7.1.\r\n.\r\n"));
        assert!(s.trim_end().ends_with(r#"include :personal "filters";"#));
        let back = parse_stored(&s).unwrap();
        assert_eq!(back.reply, stored.reply);
        assert_eq!(back.previous.as_deref(), Some("filters"));
    }

    /// Against a real server: `ONDURA_SIEVE_TEST=host:user:password`.
    #[tokio::test]
    async fn live_server() {
        let Ok(spec) = std::env::var("ONDURA_SIEVE_TEST") else { return };
        let mut parts = spec.splitn(3, ':');
        let (host, user, pw) = (parts.next().unwrap(), parts.next().unwrap(), parts.next().unwrap());
        let tls = ondura_mail_core::net::tls_client_config();
        // Another active script that has to keep working.
        let mut c = Client::connect(host, PORT, tls.clone(), user, pw).await.unwrap();
        c.put("filters", "require [\"fileinto\"];\r\nif header :contains \"subject\" \"spam\" { fileinto \"Junk\"; }\r\n").await.unwrap();
        c.activate("filters").await.unwrap();
        c.logout().await;
        let reply = AutoReply {
            enabled: true,
            start: Some("2026-01-01T00:00:00Z".parse().unwrap()),
            end: Some("2030-01-01T00:00:00Z".parse().unwrap()),
            internal: "<p>Ich bin im Urlaub.</p><p>Gruß</p>".into(),
            ..Default::default()
        };
        set(host, tls.clone(), user, pw, &reply, &["niklas@example.com".into()]).await.unwrap();
        assert_eq!(get(host, tls.clone(), user, pw).await.unwrap(), reply);
        let off = AutoReply { enabled: false, ..reply.clone() };
        set(host, tls.clone(), user, pw, &off, &[]).await.unwrap();
        let back = get(host, tls.clone(), user, pw).await.unwrap();
        assert!(!back.enabled && back.internal == reply.internal);
        let mut c = Client::connect(host, PORT, tls, user, pw).await.unwrap();
        let scripts = c.list().await.unwrap();
        assert!(scripts.contains(&("filters".to_string(), true)), "{scripts:?}");
        c.logout().await;
    }

    /// Minimal ManageSieve server for the client round trip.
    #[tokio::test]
    async fn talks_managesieve() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let mut io = BufReader::new(sock);
            io.get_mut().write_all(b"\"IMPLEMENTATION\" \"Test\"\r\n\"SIEVE\" \"fileinto vacation include\"\r\n\"SASL\" \"PLAIN\"\r\nOK \"ready\"\r\n").await.unwrap();
            let mut stored = String::new();
            let mut log = Vec::new();
            loop {
                let mut line = String::new();
                if io.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                log.push(line.trim_end().to_string());
                let reply: Vec<u8> = if line.starts_with("AUTHENTICATE") {
                    b"OK\r\n".to_vec()
                } else if line.starts_with("LISTSCRIPTS") {
                    b"\"filters\" ACTIVE\r\nOK\r\n".to_vec()
                } else if line.starts_with("PUTSCRIPT") {
                    let n: usize = line.trim_end().rsplit_once('{').unwrap().1.trim_end_matches("+}").parse().unwrap();
                    let mut buf = vec![0; n + 2];
                    io.read_exact(&mut buf).await.unwrap();
                    stored = String::from_utf8(buf).unwrap();
                    b"OK\r\n".to_vec()
                } else if line.starts_with("LOGOUT") {
                    io.get_mut().write_all(b"OK\r\n").await.unwrap();
                    break;
                } else {
                    b"OK\r\n".to_vec()
                };
                io.get_mut().write_all(&reply).await.unwrap();
            }
            (stored, log)
        });
        let tls = ondura_mail_core::net::tls_client_config();
        let mut c = Client::connect("127.0.0.1", port, tls, "niklas", "pw").await.unwrap();
        assert!(c.sieve_extension("vacation") && c.sieve_extension("include"));
        assert_eq!(c.list().await.unwrap(), vec![("filters".to_string(), true)]);
        let reply = AutoReply { enabled: true, internal: "Bin weg".into(), ..Default::default() };
        let stored = Stored { reply, previous: Some("filters".into()) };
        c.put(SCRIPT, &script(&stored, &[], true)).await.unwrap();
        c.activate(SCRIPT).await.unwrap();
        c.logout().await;
        let (script_text, log) = server.await.unwrap();
        assert!(script_text.contains("vacation :days 1"));
        assert!(log.iter().any(|l| l == r#"SETACTIVE "ondura""#));
        assert!(log[0].starts_with("AUTHENTICATE \"PLAIN\" \"AG5pa2xhcwBwdw==\""));
    }
}
