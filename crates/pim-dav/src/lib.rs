//! CalDAV (RFC 4791) and CardDAV (RFC 6352) transport.
//!
//! Discovery follows RFC 6764: the configured URL (or `/.well-known/caldav`
//! and `/.well-known/carddav`) → `current-user-principal` → home sets →
//! collections. Sync compares ETags from a depth-1 PROPFIND and fetches
//! changed resources with `*-multiget` REPORTs; the CTag skips unchanged
//! collections. Works with Nextcloud, Radicale, Baïkal, SOGo, iCloud etc.

use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use ondura_mail_core::model::Address;
use ondura_mail_core::xml::{Node, escape};
use ondura_mail_core::{Error, Result};
use ondura_pim_core::provider::RemoteCollection;
use ondura_pim_core::resource::{ResourceBackend, ResourceProvider};
use ondura_pim_core::CollectionKind;
use reqwest::{Method, StatusCode};
use tokio::sync::Mutex;
use tracing::debug;
use url::Url;

/// Prefix of task-list ids (a CalDAV calendar may hold events and tasks).
const TASKS_PREFIX: &str = "tasks:";

#[derive(Debug, Clone, Default)]
struct Homes {
    calendar: Option<Url>,
    addressbook: Option<Url>,
}

pub struct DavBackend {
    base: Url,
    username: String,
    password: String,
    owner: Address,
    http: reqwest::Client,
    homes: Mutex<Option<Homes>>,
}

pub type DavProvider = ResourceProvider<DavBackend>;

pub fn provider(url: &str, username: &str, password: &str, owner: Address) -> Result<DavProvider> {
    Ok(ResourceProvider::new(DavBackend::new(url, username, password, owner)?))
}

fn http_client() -> reqwest::Client {
    let mut tls = (*ondura_mail_core::net::tls_client_config()).clone();
    tls.alpn_protocols = vec![b"http/1.1".to_vec()];
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        // Redirects are followed by hand so PROPFIND stays PROPFIND.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

fn status_error(status: StatusCode, what: &str) -> Error {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Error::Auth(format!("{what}: {status}")),
        StatusCode::NOT_FOUND => Error::NotFound(format!("{what}: {status}")),
        StatusCode::PRECONDITION_FAILED => Error::Protocol(ondura_i18n::tr!("{0}: wurde zwischenzeitlich geändert ({1})", what, status)),
        s if s.is_server_error() => Error::Network(format!("{what}: {status}")),
        s => Error::Protocol(format!("{what}: {s}")),
    }
}

/// Text of a `href` element below `node` (for home sets / principals).
fn href_in(node: &Node, prop: &str) -> Option<String> {
    node.find(prop).and_then(|p| p.find("href")).map(|h| h.text.trim().to_string()).filter(|h| !h.is_empty())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Normalise hrefs for comparison (servers differ in encoding and slashes).
fn same_path(a: &str, b: &str) -> bool {
    percent_decode(a).trim_end_matches('/') == percent_decode(b).trim_end_matches('/')
}

impl DavBackend {
    pub fn new(url: &str, username: &str, password: &str, owner: Address) -> Result<Self> {
        let mut base = Url::parse(url.trim()).map_err(|e| Error::Other(ondura_i18n::tr!("Ungültige Adresse: {0}", e)))?;
        if !base.path().ends_with('/') {
            let p = format!("{}/", base.path());
            base.set_path(&p);
        }
        Ok(Self {
            base,
            username: username.to_string(),
            password: password.to_string(),
            owner,
            http: http_client(),
            homes: Mutex::new(None),
        })
    }

    async fn request(&self, method: &str, url: &Url, depth: Option<&str>, body: Option<String>, headers: &[(&str, &str)]) -> Result<(StatusCode, reqwest::header::HeaderMap, String, Url)> {
        let mut url = url.clone();
        for _ in 0..5 {
            let mut req = self
                .http
                .request(Method::from_bytes(method.as_bytes()).expect("valid method"), url.clone())
                .basic_auth(&self.username, Some(&self.password));
            if let Some(d) = depth {
                req = req.header("Depth", d);
            }
            for (k, v) in headers {
                req = req.header(*k, *v);
            }
            if let Some(b) = &body {
                req = req.header("Content-Type", "application/xml; charset=utf-8").body(b.clone());
            }
            let resp = req.send().await.map_err(Error::network)?;
            let status = resp.status();
            if status.is_redirection()
                && let Some(loc) = resp.headers().get("Location").and_then(|l| l.to_str().ok())
            {
                url = url.join(loc).map_err(Error::protocol)?;
                continue;
            }
            let headers = resp.headers().clone();
            let text = resp.text().await.map_err(Error::network)?;
            return Ok((status, headers, text, url));
        }
        Err(Error::Protocol(ondura_i18n::tr!("zu viele Weiterleitungen")))
    }

    async fn propfind(&self, url: &Url, depth: &str, props: &str) -> Result<(Node, Url)> {
        let body = format!(
            r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"><d:prop>{props}</d:prop></d:propfind>"#
        );
        let (status, _, text, final_url) = self.request("PROPFIND", url, Some(depth), Some(body), &[]).await?;
        if status != StatusCode::MULTI_STATUS {
            return Err(status_error(status, "PROPFIND"));
        }
        Ok((Node::parse(&text).map_err(Error::protocol)?, final_url))
    }

    async fn principal(&self) -> Result<Url> {
        let mut candidates = vec![self.base.clone()];
        for wk in ["/.well-known/caldav", "/.well-known/carddav"] {
            if let Ok(u) = self.base.join(wk) {
                candidates.push(u);
            }
        }
        let mut last_err = None;
        for url in candidates {
            match self.propfind(&url, "0", "<d:current-user-principal/>").await {
                Ok((doc, final_url)) => {
                    if let Some(href) = href_in(&doc, "current-user-principal") {
                        return final_url.join(&href).map_err(Error::protocol);
                    }
                }
                Err(e @ Error::Auth(_)) => return Err(e),
                Err(e) => last_err = Some(e),
            }
        }
        // Some servers (old Radicale, plain WebDAV) have no principal: use the URL itself.
        match last_err {
            Some(Error::Network(m)) => Err(Error::Network(m)),
            _ => Ok(self.base.clone()),
        }
    }

    async fn homes(&self) -> Result<Homes> {
        if let Some(h) = self.homes.lock().await.clone() {
            return Ok(h);
        }
        let principal = self.principal().await?;
        let (doc, url) = self
            .propfind(&principal, "0", "<c:calendar-home-set/><card:addressbook-home-set/>")
            .await?;
        let homes = Homes {
            calendar: href_in(&doc, "calendar-home-set").and_then(|h| url.join(&h).ok()),
            addressbook: href_in(&doc, "addressbook-home-set").and_then(|h| url.join(&h).ok()),
        };
        // Without home sets, treat the configured URL as the home.
        let homes = Homes {
            calendar: homes.calendar.or_else(|| Some(self.base.clone())),
            addressbook: homes.addressbook.or_else(|| Some(self.base.clone())),
        };
        *self.homes.lock().await = Some(homes.clone());
        Ok(homes)
    }

    fn collection_url(&self, col: &RemoteCollection) -> Result<Url> {
        let href = col.remote_id.strip_prefix(TASKS_PREFIX).unwrap_or(&col.remote_id);
        self.base.join(href).map_err(Error::protocol)
    }

    async fn scan_home(&self, home: &Url, out: &mut Vec<RemoteCollection>, seen: &mut Vec<String>) -> Result<()> {
        let (doc, url) = self
            .propfind(
                home,
                "1",
                "<d:resourcetype/><d:displayname/><ic:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/>",
            )
            .await?;
        let mut responses = Vec::new();
        doc.find_all("response", &mut responses);
        for r in responses {
            let Some(href) = r.child("href").map(|h| h.text.trim().to_string()) else { continue };
            let Some(rt) = r.find("resourcetype") else { continue };
            let is_cal = rt.child("calendar").is_some();
            let is_book = rt.child("addressbook").is_some();
            if !is_cal && !is_book {
                continue;
            }
            let path = url.join(&href).map(|u| u.path().to_string()).unwrap_or(href.clone());
            if seen.iter().any(|s| same_path(s, &path)) {
                continue;
            }
            seen.push(path.clone());
            let name = r.find("displayname").map(|d| d.text.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| {
                percent_decode(path.trim_end_matches('/').rsplit('/').next().unwrap_or("Kalender"))
            });
            let color = r.find("calendar-color").map(|c| c.text.trim().chars().take(7).collect::<String>()).filter(|c| c.starts_with('#'));
            let read_only = r.find("current-user-privilege-set").is_some_and(|p| {
                let mut privs = Vec::new();
                p.find_all("privilege", &mut privs);
                !privs.is_empty() && !privs.iter().any(|x| x.find("write").is_some() || x.find("write-content").is_some() || x.find("all").is_some())
            });
            if is_book {
                out.push(RemoteCollection { remote_id: path, kind: CollectionKind::Contacts, name, color: None, read_only, is_default: false });
                continue;
            }
            let comps: Vec<String> = r
                .find("supported-calendar-component-set")
                .map(|s| s.children.iter().filter_map(|c| c.attr("name").map(str::to_ascii_uppercase)).collect())
                .unwrap_or_default();
            let events = comps.is_empty() || comps.iter().any(|c| c == "VEVENT");
            let todos = comps.iter().any(|c| c == "VTODO");
            if events {
                out.push(RemoteCollection { remote_id: path.clone(), kind: CollectionKind::Calendar, name: name.clone(), color: color.clone(), read_only, is_default: false });
            }
            if todos {
                out.push(RemoteCollection { remote_id: format!("{TASKS_PREFIX}{path}"), kind: CollectionKind::Tasks, name, color, read_only, is_default: false });
            }
        }
        Ok(())
    }

    /// Check URL and credentials.
    pub async fn test(&self) -> Result<usize> {
        Ok(self.collections().await?.len())
    }
}

#[async_trait]
impl ResourceBackend for DavBackend {
    async fn collections(&self) -> Result<Vec<RemoteCollection>> {
        let homes = self.homes().await?;
        let mut out = Vec::new();
        let mut seen = Vec::new();
        let mut targets = vec![homes.calendar.clone()];
        if homes.addressbook != homes.calendar {
            targets.push(homes.addressbook.clone());
        }
        let mut first_err = None;
        for home in targets.into_iter().flatten() {
            if let Err(e) = self.scan_home(&home, &mut out, &mut seen).await {
                debug!(home = %home, error = %e, "scanning DAV home failed");
                first_err.get_or_insert(e);
            }
        }
        if out.is_empty()
            && let Some(e) = first_err
        {
            return Err(e);
        }
        // First collection of each kind becomes the default.
        for kind in [CollectionKind::Calendar, CollectionKind::Contacts, CollectionKind::Tasks] {
            if let Some(c) = out.iter_mut().find(|c| c.kind == kind && !c.read_only) {
                c.is_default = true;
            }
        }
        Ok(out)
    }

    async fn list(&self, col: &RemoteCollection) -> Result<(HashMap<String, String>, Option<String>)> {
        let url = self.collection_url(col)?;
        let (doc, base) = self.propfind(&url, "1", "<d:getetag/><cs:getctag/><d:sync-token/><d:resourcetype/>").await?;
        let mut responses = Vec::new();
        doc.find_all("response", &mut responses);
        let mut out = HashMap::new();
        let mut ctag = None;
        for r in responses {
            let Some(href) = r.child("href").map(|h| h.text.trim().to_string()) else { continue };
            let path = base.join(&href).map(|u| u.path().to_string()).unwrap_or(href);
            if same_path(&path, url.path()) {
                ctag = r.find("getctag").or_else(|| r.find("sync-token")).map(|t| t.text.trim().to_string()).filter(|t| !t.is_empty());
                continue;
            }
            if r.find("resourcetype").is_some_and(|t| t.child("collection").is_some()) {
                continue;
            }
            // Only successful propstats carry an etag.
            if let Some(etag) = r.find("getetag").map(|e| e.text.trim().to_string()).filter(|e| !e.is_empty()) {
                out.insert(path, etag);
            }
        }
        Ok((out, ctag))
    }

    async fn fetch(&self, col: &RemoteCollection, hrefs: &[String]) -> Result<Vec<(String, String, String)>> {
        let url = self.collection_url(col)?;
        let (report, data_prop) = if col.kind == CollectionKind::Contacts {
            ("card:addressbook-multiget", "<card:address-data/>")
        } else {
            ("c:calendar-multiget", "<c:calendar-data/>")
        };
        let hrefs_xml: String = hrefs.iter().map(|h| format!("<d:href>{}</d:href>", escape(h))).collect();
        let body = format!(
            r#"<?xml version="1.0" encoding="utf-8"?><{report} xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/>{data_prop}</d:prop>{hrefs_xml}</{report}>"#
        );
        let (status, _, text, base) = self.request("REPORT", &url, Some("1"), Some(body), &[]).await?;
        if status != StatusCode::MULTI_STATUS {
            return Err(status_error(status, "REPORT"));
        }
        let doc = Node::parse(&text).map_err(Error::protocol)?;
        let mut responses = Vec::new();
        doc.find_all("response", &mut responses);
        let mut out = Vec::new();
        for r in responses {
            let Some(href) = r.child("href").map(|h| h.text.trim().to_string()) else { continue };
            let path = base.join(&href).map(|u| u.path().to_string()).unwrap_or(href);
            let data = r.find("calendar-data").or_else(|| r.find("address-data")).map(|d| d.text.clone());
            let etag = r.find("getetag").map(|e| e.text.trim().to_string()).unwrap_or_default();
            if let Some(data) = data.filter(|d| !d.is_empty()) {
                out.push((path, etag, data));
            }
        }
        Ok(out)
    }

    async fn put(&self, col: &RemoteCollection, href: Option<&str>, name: &str, data: &str, etag: Option<&str>) -> Result<String> {
        let base = self.collection_url(col)?;
        let url = match href {
            Some(h) => base.join(h).map_err(Error::protocol)?,
            None => base.join(name).map_err(Error::protocol)?,
        };
        let content_type = if col.kind == CollectionKind::Contacts { "text/vcard; charset=utf-8" } else { "text/calendar; charset=utf-8" };
        let mut req = self
            .http
            .put(url.clone())
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", content_type)
            .body(data.to_string());
        req = match (href, etag) {
            (None, _) => req.header("If-None-Match", "*"),
            (Some(_), Some(e)) => req.header("If-Match", e),
            _ => req,
        };
        let resp = req.send().await.map_err(Error::network)?;
        if !resp.status().is_success() {
            return Err(status_error(resp.status(), "PUT"));
        }
        Ok(url.path().to_string())
    }

    async fn delete(&self, col: &RemoteCollection, href: &str, etag: Option<&str>) -> Result<()> {
        let url = self.collection_url(col)?.join(href).map_err(Error::protocol)?;
        let headers: Vec<(&str, &str)> = etag.map(|e| vec![("If-Match", e)]).unwrap_or_default();
        let (status, _, _, _) = self.request("DELETE", &url, None, None, &headers).await?;
        if status.is_success() || status == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(status_error(status, "DELETE"))
        }
    }

    fn owner(&self) -> Option<Address> {
        Some(self.owner.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_paths() {
        assert!(same_path("/dav/cal%20one/", "/dav/cal one"));
        assert!(!same_path("/dav/a/", "/dav/b/"));
    }
}
