//! S/MIME (RFC 8551) for Ondura Mail, in pure Rust: X.509 certificates,
//! PKCS#12 import, CMS signatures and RSA/AES encryption.
//!
//! Only RSA keys are supported, which is what S/MIME certificates from
//! public CAs and corporate PKIs use in practice.

pub mod cert;
pub mod cms;
pub mod der;
pub mod mime;
pub mod pkcs12;

pub use cert::{CertInfo, Certificate, Trust};
pub use mime::{SecurityInfo, SignatureInfo, Unprotected, is_protected, protect, unprotect};

use rsa::RsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid data: {0}")]
    Format(String),
    #[error("not supported: {0}")]
    Unsupported(String),
    #[error("{0}")]
    Crypto(String),
    #[error("signature does not match")]
    BadSignature,
    #[error("no matching key")]
    NoKey,
}

/// An own S/MIME identity: private key and certificate chain (own
/// certificate first).
#[derive(Clone)]
pub struct Identity {
    pub key: RsaPrivateKey,
    pub chain: Vec<Certificate>,
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Identity").field("certificate", &self.chain.first().map(|c| &c.subject_name)).finish_non_exhaustive()
    }
}

impl Identity {
    /// From a PKCS#8 private key and DER certificates.
    pub fn new(pkcs8: &[u8], chain: &[Vec<u8>]) -> Result<Self> {
        let key = RsaPrivateKey::from_pkcs8_der(pkcs8).map_err(|e| Error::Unsupported(format!("private key: {e}")))?;
        let chain = chain.iter().map(|c| Certificate::from_der(c)).collect::<Result<Vec<_>>>()?;
        if chain.is_empty() {
            return Err(Error::Format("no certificate".into()));
        }
        Ok(Self { key, chain })
    }

    /// Import a PKCS#12 file (.p12/.pfx).
    pub fn from_pkcs12(data: &[u8], password: &str) -> Result<Self> {
        let p = pkcs12::parse(data, password)?;
        let key = RsaPrivateKey::from_pkcs8_der(&p.key).map_err(|e| Error::Unsupported(ondura_i18n::tr!("Nur RSA-Schlüssel werden unterstützt ({0})", e)))?;
        Ok(Self { key, chain: p.chain })
    }

    pub fn certificate(&self) -> &Certificate {
        &self.chain[0]
    }

    /// PKCS#8 DER of the private key (for the secret store).
    pub fn key_pkcs8(&self) -> Vec<u8> {
        use rsa::pkcs8::EncodePrivateKey;
        self.key.to_pkcs8_der().map(|d| d.as_bytes().to_vec()).unwrap_or_default()
    }
}
