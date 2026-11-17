//! Shared networking helpers.

use std::sync::Arc;

use rustls::ClientConfig;

/// A rustls client configuration using the `ring` provider and the Mozilla
/// root store (`webpki-roots`), so behaviour is identical on Windows and Linux.
pub fn tls_client_config() -> Arc<ClientConfig> {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("ring supports the default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    Arc::new(config)
}
