//! Shared networking helpers: one rustls configuration for every adapter,
//! plus user-approved certificates for servers with self-signed or
//! privately issued certificates.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

use crate::{Error, Result};

fn trusted() -> &'static RwLock<HashSet<String>> {
    static TRUSTED: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
    TRUSTED.get_or_init(Default::default)
}

/// SHA-256 fingerprint as upper-case hex pairs separated by colons.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// Replace the set of certificates the user explicitly trusts.
pub fn set_trusted_certificates<I: IntoIterator<Item = String>>(fps: I) {
    *trusted().write().unwrap() = fps.into_iter().map(|f| f.to_uppercase()).collect();
}

pub fn has_trusted_certificates() -> bool {
    !trusted().read().unwrap().is_empty()
}

pub fn is_trusted(fp: &str) -> bool {
    trusted().read().unwrap().contains(&fp.to_uppercase())
}

/// Web PKI verification with the Mozilla roots; certificates whose
/// fingerprint the user has approved are accepted even if the chain or
/// host name does not verify.
#[derive(Debug)]
struct PinningVerifier {
    inner: Arc<WebPkiServerVerifier>,
}

impl ServerCertVerifier for PinningVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        match self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp, now) {
            Ok(v) => Ok(v),
            Err(e) if is_trusted(&fingerprint(end_entity)) => {
                tracing::debug!("accepting user-trusted certificate despite: {e}");
                Ok(ServerCertVerified::assertion())
            }
            Err(e) => Err(e),
        }
    }

    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(m, c, d)
    }

    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(m, c, d)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

/// A rustls client configuration using the `ring` provider and the Mozilla
/// root store (`webpki-roots`), so behaviour is identical on Windows and Linux.
pub fn tls_client_config() -> Arc<ClientConfig> {
    let roots = Arc::new(rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned()));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let inner = WebPkiServerVerifier::builder_with_provider(roots, Arc::clone(&provider)).build().expect("web pki verifier");
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("ring supports the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinningVerifier { inner }))
        .with_no_client_auth();
    Arc::new(config)
}

/// How to reach the TLS layer of a server for [`probe_certificate`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeMode {
    /// TLS from the first byte (IMAPS 993, SMTPS 465, HTTPS).
    Direct,
    ImapStartTls,
    SmtpStartTls,
}

/// The certificate a server presented.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateInfo {
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    /// `None` if the certificate verifies against the public roots.
    pub problem: Option<String>,
    pub trusted: bool,
}

/// Records the certificate and the verdict of the normal verifier, then
/// lets the handshake continue so the certificate can be shown to the user.
#[derive(Debug)]
struct CaptureVerifier {
    inner: Arc<WebPkiServerVerifier>,
    seen: Mutex<Option<(String, Option<String>)>>,
}

impl ServerCertVerifier for CaptureVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        let problem = self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp, now).err().map(|e| e.to_string());
        *self.seen.lock().unwrap() = Some((fingerprint(end_entity), problem));
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(m, c, d)
    }

    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(m, c, d)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

async fn read_reply(r: &mut BufReader<TcpStream>, smtp: bool) -> Result<String> {
    let mut all = String::new();
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).await.map_err(Error::network)? == 0 {
            return Err(Error::Network("Verbindung vom Server geschlossen".into()));
        }
        all.push_str(&line);
        // SMTP multi-line replies use "250-"; the last line has a space.
        if !smtp || line.as_bytes().get(3) != Some(&b'-') {
            return Ok(all);
        }
    }
}

/// Connect to a server and report the certificate it presents, including
/// why it would be rejected.
pub async fn probe_certificate(host: &str, port: u16, mode: ProbeMode) -> Result<CertificateInfo> {
    let run = async {
        let tcp = TcpStream::connect((host, port)).await.map_err(Error::network)?;
        let tcp = match mode {
            ProbeMode::Direct => tcp,
            ProbeMode::ImapStartTls => {
                let mut r = BufReader::new(tcp);
                read_reply(&mut r, false).await?;
                r.get_mut().write_all(b"a1 STARTTLS\r\n").await.map_err(Error::network)?;
                let reply = read_reply(&mut r, false).await?;
                if !reply.starts_with("a1 OK") {
                    return Err(Error::Protocol(format!("STARTTLS abgelehnt: {}", reply.trim())));
                }
                r.into_inner()
            }
            ProbeMode::SmtpStartTls => {
                let mut r = BufReader::new(tcp);
                read_reply(&mut r, true).await?;
                r.get_mut().write_all(b"EHLO nexora.local\r\n").await.map_err(Error::network)?;
                read_reply(&mut r, true).await?;
                r.get_mut().write_all(b"STARTTLS\r\n").await.map_err(Error::network)?;
                let reply = read_reply(&mut r, true).await?;
                if !reply.starts_with("220") {
                    return Err(Error::Protocol(format!("STARTTLS abgelehnt: {}", reply.trim())));
                }
                r.into_inner()
            }
        };
        let roots = Arc::new(rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned()));
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let inner = WebPkiServerVerifier::builder_with_provider(roots, Arc::clone(&provider)).build().map_err(|e| Error::Other(e.to_string()))?;
        let capture = Arc::new(CaptureVerifier { inner, seen: Mutex::new(None) });
        let config = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| Error::Other(e.to_string()))?
            .dangerous()
            .with_custom_certificate_verifier(capture.clone())
            .with_no_client_auth();
        let name = ServerName::try_from(host.to_string()).map_err(|e| Error::Other(format!("Ungültiger Servername: {e}")))?;
        let _ = tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp).await;
        let (fp, problem) = capture.seen.lock().unwrap().clone().ok_or_else(|| Error::Network("Der Server hat kein Zertifikat gesendet".into()))?;
        Ok(CertificateInfo { host: host.to_string(), port, trusted: is_trusted(&fp), fingerprint: fp, problem })
    };
    tokio::time::timeout(Duration::from_secs(15), run).await.map_err(|_| Error::Network("Zeitüberschreitung beim Abrufen des Zertifikats".into()))?
}

/// `true` if an error message looks like a rejected server certificate.
pub fn is_certificate_error(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    m.contains("certificate") || m.contains("unknownissuer") || m.contains("zertifikat")
}
