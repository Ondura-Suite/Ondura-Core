//! S/MIME keyring of the running app and the hooks used by message parsing
//! and the adapters' send paths.
//!
//! The keyring holds the user's own identities (private key + certificate,
//! imported from PKCS#12) and certificates of other people, learned from
//! signed messages they sent. It is process-wide like the trusted TLS
//! certificates in [`crate::net`], because parsing happens deep inside the
//! adapters.

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

pub use ondura_smime::{CertInfo, Certificate, Identity, SecurityInfo, SignatureInfo};

use crate::error::{Error, Result};
use crate::model::OutgoingMessage;

#[derive(Default)]
struct Keyring {
    identities: Vec<Identity>,
    /// Certificates of other people by lower-case address.
    known: HashMap<String, Vec<Certificate>>,
    /// Fingerprints of certificates (or CAs) the user trusts explicitly.
    trusted: Vec<String>,
}

static KEYRING: LazyLock<RwLock<Keyring>> = LazyLock::new(Default::default);

/// Replace the own identities.
pub fn set_identities(identities: Vec<Identity>) {
    KEYRING.write().unwrap().identities = identities;
}

pub fn set_trusted(fingerprints: Vec<String>) {
    KEYRING.write().unwrap().trusted = fingerprints;
}

/// Remember a certificate of another person (from a signed message or an
/// import). Returns `true` if it was new.
pub fn add_known(cert: Certificate) -> bool {
    let mut k = KEYRING.write().unwrap();
    let mut added = false;
    for email in cert.emails.clone() {
        let list = k.known.entry(email.to_lowercase()).or_default();
        if !list.iter().any(|c| c.der == cert.der) {
            list.push(cert.clone());
            added = true;
        }
    }
    added
}

/// All known certificates of other people (DER), for persisting.
pub fn known_der() -> Vec<Vec<u8>> {
    let k = KEYRING.read().unwrap();
    let mut out: Vec<Vec<u8>> = Vec::new();
    for c in k.known.values().flatten() {
        if !out.contains(&c.der) {
            out.push(c.der.clone());
        }
    }
    out
}

/// Own identity for an address.
pub fn identity_for(email: &str) -> Option<Identity> {
    KEYRING.read().unwrap().identities.iter().find(|i| i.certificate().has_email(email)).cloned()
}

/// Newest valid certificate for an address (own or known).
pub fn certificate_for(email: &str) -> Option<Certificate> {
    let k = KEYRING.read().unwrap();
    let now = chrono::Utc::now();
    let own = k.identities.iter().filter_map(|i| i.chain.first()).filter(|c| c.has_email(email));
    let known = k.known.get(&email.to_lowercase()).into_iter().flatten();
    own.chain(known).filter(|c| c.valid_at(now)).max_by_key(|c| c.not_after).cloned()
}

/// Addresses without a usable certificate.
pub fn missing_certificates(emails: &[String]) -> Vec<String> {
    emails.iter().filter(|e| certificate_for(e).is_none()).cloned().collect()
}

/// Remove the S/MIME layers of a received message (decrypt, check
/// signatures). `None` if the message is not S/MIME.
pub fn unprotect(raw: &[u8]) -> Option<ondura_smime::Unprotected> {
    if !ondura_smime::is_protected(raw) {
        return None;
    }
    let k = KEYRING.read().unwrap();
    let pool: Vec<Certificate> = k.known.values().flatten().cloned().chain(k.identities.iter().flat_map(|i| i.chain.clone())).collect();
    ondura_smime::unprotect(raw, &k.identities, &pool, &k.trusted)
}

/// Sign and/or encrypt an outgoing message as requested by its flags.
/// Encrypted messages are also encrypted for the sender, so the copy in
/// "Sent" stays readable.
pub fn protect_outgoing(raw: Vec<u8>, from_email: &str, m: &OutgoingMessage) -> Result<Vec<u8>> {
    if !m.sign && !m.encrypt {
        return Ok(raw);
    }
    let signer = if m.sign {
        Some(identity_for(from_email).ok_or_else(|| Error::Other(format!("Für {from_email} ist kein S/MIME-Zertifikat eingerichtet")))?)
    } else {
        None
    };
    let mut recipients = Vec::new();
    if m.encrypt {
        let mut addresses: Vec<String> = m.to.iter().chain(&m.cc).chain(&m.bcc).map(|a| a.email.clone()).collect();
        addresses.push(from_email.to_string());
        let missing = missing_certificates(&addresses);
        if !missing.is_empty() {
            return Err(Error::Other(format!(
                "Verschlüsseln nicht möglich – kein Zertifikat für: {}. Ein Zertifikat wird bekannt, sobald die Person Ihnen eine signierte Nachricht schickt.",
                missing.join(", ")
            )));
        }
        for a in &addresses {
            if let Some(c) = certificate_for(a)
                && !recipients.iter().any(|r: &Certificate| r.der == c.der)
            {
                recipients.push(c);
            }
        }
    }
    ondura_smime::protect(&raw, signer.as_ref(), &recipients, chrono::Utc::now()).map_err(|e| Error::Other(format!("S/MIME: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Address;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{}/../smime/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    /// The keyring is global; everything runs in one test to avoid races.
    #[test]
    fn opens_and_protects_messages() {
        let id = Identity::from_pkcs12(&fixture("user-aes.p12"), "geheim").unwrap();
        set_identities(vec![id.clone()]);

        let body = crate::preview::parse_body(&fixture("encrypted-openssl.eml"));
        let sec = body.security.clone().unwrap();
        assert!(sec.encrypted && sec.decrypt_error.is_none());
        assert!(body.text.unwrap().contains("Geheime Nachricht"));

        let signed = crate::preview::parse_body(&fixture("signed-openssl.eml"));
        assert!(signed.security.unwrap().signature.unwrap().valid);
        assert!(signed.attachments.is_empty(), "smime.p7s is hidden");

        // Encrypting needs certificates of all recipients.
        let m = OutgoingMessage { to: vec![Address::new(None, "anna@example.com")], subject: "x".into(), body_html: "<p>x</p>".into(), encrypt: true, ..Default::default() };
        let raw = b"From: niklas@example.com\r\nTo: anna@example.com\r\nSubject: x\r\nContent-Type: text/plain\r\n\r\nx\r\n".to_vec();
        let e = protect_outgoing(raw.clone(), "niklas@example.com", &m).unwrap_err().to_string();
        assert!(e.contains("anna@example.com"), "{e}");
        let to_self = OutgoingMessage { to: vec![Address::new(None, "niklas@example.com")], sign: true, ..m };
        let out = protect_outgoing(raw, "niklas@example.com", &to_self).unwrap();
        let back = crate::preview::parse_body(&out);
        let sec = back.security.unwrap();
        assert!(sec.encrypted && sec.signature.unwrap().valid);
        set_identities(Vec::new());
    }
}
