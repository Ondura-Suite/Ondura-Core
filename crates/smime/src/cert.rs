//! X.509 certificates: the fields S/MIME needs, signature checks and a
//! simple chain check against the Mozilla root store (webpki-roots).

use chrono::{DateTime, NaiveDateTime, Utc};
use rsa::RsaPublicKey;
use rsa::pkcs1::DecodeRsaPublicKey;
use rsa::pkcs1v15::Pkcs1v15Sign;
use serde::Serialize;
use sha2::Digest;

use crate::der::{self, Tlv};
use crate::{Error, Result};

pub const RSA_ENCRYPTION: &str = "1.2.840.113549.1.1.1";
const EMAIL_ADDRESS: &str = "1.2.840.113549.1.9.1";
const COMMON_NAME: &str = "2.5.4.3";
const ORGANIZATION: &str = "2.5.4.10";
const SUBJECT_ALT_NAME: &str = "2.5.29.17";
const SUBJECT_KEY_ID: &str = "2.5.29.14";

/// A parsed certificate (the DER is kept for re-encoding).
#[derive(Debug, Clone)]
pub struct Certificate {
    pub der: Vec<u8>,
    /// Encoded `Name` elements (compared bytewise).
    pub issuer: Vec<u8>,
    pub subject: Vec<u8>,
    /// Encoded serial INTEGER element.
    pub serial: Vec<u8>,
    pub not_before: DateTime<Utc>,
    pub not_after: DateTime<Utc>,
    pub emails: Vec<String>,
    pub subject_name: String,
    pub issuer_name: String,
    pub key_id: Option<Vec<u8>>,
    /// Encoded SubjectPublicKeyInfo.
    spki: Vec<u8>,
    tbs: Vec<u8>,
    sig_alg: String,
    signature: Vec<u8>,
}

/// Display form of a certificate for the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    pub subject: String,
    pub issuer: String,
    pub emails: Vec<String>,
    pub not_before: DateTime<Utc>,
    pub not_after: DateTime<Utc>,
    /// SHA-256 of the certificate, hex.
    pub fingerprint: String,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn time(t: &Tlv) -> Result<DateTime<Utc>> {
    let s = std::str::from_utf8(t.body).map_err(|_| Error::Format("bad time".into()))?;
    let s = s.trim_end_matches('Z');
    let parsed = match t.tag {
        der::UTC_TIME => {
            let year: i32 = s.get(..2).and_then(|y| y.parse().ok()).ok_or_else(|| Error::Format("bad UTCTime".into()))?;
            let full = if year >= 50 { 1900 + year } else { 2000 + year };
            NaiveDateTime::parse_from_str(&format!("{full}{}", &s[2..]), "%Y%m%d%H%M%S")
        }
        _ => NaiveDateTime::parse_from_str(s.split('.').next().unwrap_or(s), "%Y%m%d%H%M%S"),
    };
    parsed.map(|t| t.and_utc()).map_err(|_| Error::Format(format!("bad time {s}")))
}

/// Attribute values of a Name by OID.
fn name_values(name: &Tlv, wanted: &str) -> Vec<String> {
    let mut out = Vec::new();
    for rdn in name.children().unwrap_or_default() {
        for atv in rdn.children().unwrap_or_default() {
            let Ok(kids) = atv.children() else { continue };
            if kids.len() == 2 && kids[0].oid().is_ok_and(|o| o == wanted) {
                let v = kids[1];
                let text = if v.tag == 0x1e {
                    // BMPString
                    String::from_utf16_lossy(&v.body.chunks(2).map(|c| u16::from_be_bytes([c[0], *c.get(1).unwrap_or(&0)])).collect::<Vec<_>>())
                } else {
                    String::from_utf8_lossy(v.body).into_owned()
                };
                out.push(text);
            }
        }
    }
    out
}

fn display_name(name: &Tlv) -> String {
    let cn = name_values(name, COMMON_NAME);
    let o = name_values(name, ORGANIZATION);
    match (cn.first(), o.first()) {
        (Some(cn), Some(o)) if cn != o => format!("{cn} ({o})"),
        (Some(cn), _) => cn.clone(),
        (None, Some(o)) => o.clone(),
        _ => name_values(name, EMAIL_ADDRESS).into_iter().next().unwrap_or_default(),
    }
}

impl Certificate {
    pub fn from_der(der_bytes: &[u8]) -> Result<Self> {
        let cert = Tlv::parse(der_bytes)?.expect(der::SEQUENCE)?;
        let parts = cert.children()?;
        if parts.len() < 3 {
            return Err(Error::Format("certificate too short".into()));
        }
        let tbs = parts[0];
        let sig_alg = parts[1].child(0)?.oid()?;
        let signature = parts[2].body.get(1..).unwrap_or_default().to_vec();
        let mut f = tbs.children()?.into_iter().peekable();
        if f.peek().is_some_and(|t| t.tag == 0xa0) {
            f.next();
        }
        let serial = f.next().ok_or_else(|| Error::Format("no serial".into()))?;
        let _alg = f.next();
        let issuer = f.next().ok_or_else(|| Error::Format("no issuer".into()))?;
        let validity = f.next().ok_or_else(|| Error::Format("no validity".into()))?.children()?;
        let subject = f.next().ok_or_else(|| Error::Format("no subject".into()))?;
        let spki = f.next().ok_or_else(|| Error::Format("no key".into()))?;
        let mut emails: Vec<String> = name_values(&subject, EMAIL_ADDRESS);
        let mut key_id = None;
        for rest in f {
            if rest.tag != 0xa3 {
                continue;
            }
            for ext in rest.child(0)?.children()? {
                let kids = ext.children()?;
                let Some(id) = kids.first().and_then(|k| k.oid().ok()) else { continue };
                let Some(value) = kids.last() else { continue };
                match id.as_str() {
                    SUBJECT_ALT_NAME => {
                        for gn in Tlv::parse(value.body)?.children()? {
                            if gn.tag == 0x81 {
                                emails.push(String::from_utf8_lossy(gn.body).into_owned());
                            }
                        }
                    }
                    SUBJECT_KEY_ID => key_id = Some(Tlv::parse(value.body)?.body.to_vec()),
                    _ => {}
                }
            }
        }
        let mut seen = std::collections::HashSet::new();
        emails.retain(|e| seen.insert(e.to_lowercase()));
        Ok(Certificate {
            der: der_bytes[..cert.raw.len()].to_vec(),
            issuer: issuer.raw.to_vec(),
            subject: subject.raw.to_vec(),
            serial: serial.raw.to_vec(),
            not_before: time(validity.first().ok_or_else(|| Error::Format("no notBefore".into()))?)?,
            not_after: time(validity.get(1).ok_or_else(|| Error::Format("no notAfter".into()))?)?,
            emails,
            subject_name: display_name(&subject),
            issuer_name: display_name(&issuer),
            key_id,
            spki: spki.raw.to_vec(),
            tbs: tbs.raw.to_vec(),
            sig_alg,
            signature,
        })
    }

    pub fn fingerprint(&self) -> String {
        hex(&sha2::Sha256::digest(&self.der))
    }

    pub fn info(&self) -> CertInfo {
        CertInfo {
            subject: self.subject_name.clone(),
            issuer: self.issuer_name.clone(),
            emails: self.emails.clone(),
            not_before: self.not_before,
            not_after: self.not_after,
            fingerprint: self.fingerprint(),
        }
    }

    pub fn has_email(&self, email: &str) -> bool {
        self.emails.iter().any(|e| e.eq_ignore_ascii_case(email))
    }

    pub fn valid_at(&self, t: DateTime<Utc>) -> bool {
        self.not_before <= t && t <= self.not_after
    }

    /// RSA public key of the certificate.
    pub fn rsa_key(&self) -> Result<RsaPublicKey> {
        rsa_key_from_spki(&self.spki)
    }

    /// `IssuerAndSerialNumber` of this certificate.
    pub fn issuer_and_serial(&self) -> Vec<u8> {
        der::seq(&[&self.issuer, &self.serial])
    }

    /// Whether this certificate was signed by the key in `issuer_spki`.
    fn signed_by_spki(&self, issuer_spki: &[u8]) -> bool {
        let Ok(key) = rsa_key_from_spki(issuer_spki) else { return false };
        verify_rsa(&key, &self.sig_alg, None, &self.tbs, &self.signature).is_ok()
    }
}

pub fn rsa_key_from_spki(spki: &[u8]) -> Result<RsaPublicKey> {
    let t = Tlv::parse(spki)?;
    let alg = t.child(0)?.child(0)?.oid()?;
    if alg != RSA_ENCRYPTION {
        return Err(Error::Unsupported(format!("public key algorithm {alg}")));
    }
    let bits = t.child(1)?;
    RsaPublicKey::from_pkcs1_der(bits.body.get(1..).unwrap_or_default()).map_err(|e| Error::Format(format!("RSA key: {e}")))
}

/// Hash `data` with the digest algorithm named by `oid`.
pub fn digest(oid: &str, data: &[u8]) -> Result<(Vec<u8>, Pkcs1v15Sign)> {
    Ok(match oid {
        "1.3.14.3.2.26" | "1.2.840.113549.1.1.5" => (sha1::Sha1::digest(data).to_vec(), Pkcs1v15Sign::new::<sha1::Sha1>()),
        "2.16.840.1.101.3.4.2.1" | "1.2.840.113549.1.1.11" => (sha2::Sha256::digest(data).to_vec(), Pkcs1v15Sign::new::<sha2::Sha256>()),
        "2.16.840.1.101.3.4.2.2" | "1.2.840.113549.1.1.12" => (sha2::Sha384::digest(data).to_vec(), Pkcs1v15Sign::new::<sha2::Sha384>()),
        "2.16.840.1.101.3.4.2.3" | "1.2.840.113549.1.1.13" => (sha2::Sha512::digest(data).to_vec(), Pkcs1v15Sign::new::<sha2::Sha512>()),
        other => return Err(Error::Unsupported(format!("digest algorithm {other}"))),
    })
}

/// Check an RSA PKCS#1 v1.5 signature. `digest_alg` is used when
/// `sig_alg` is plain `rsaEncryption` (as in CMS signer infos).
pub fn verify_rsa(key: &RsaPublicKey, sig_alg: &str, digest_alg: Option<&str>, data: &[u8], signature: &[u8]) -> Result<()> {
    let alg = if sig_alg == RSA_ENCRYPTION { digest_alg.ok_or_else(|| Error::Unsupported("digest".into()))? } else { sig_alg };
    let (hash, scheme) = digest(alg, data)?;
    key.verify(scheme, &hash, signature).map_err(|_| Error::BadSignature)
}

/// Result of checking where a certificate comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Trust {
    /// Chains up to a root of the Mozilla root store (or a trusted cert).
    Trusted,
    /// The chain could not be completed or checked.
    Unknown,
}

/// Follow issuers through `pool` up to a root of webpki-roots or one of
/// `trusted` (fingerprints). Only RSA-signed chains can be checked.
pub fn chain_trust(cert: &Certificate, pool: &[Certificate], trusted: &[String]) -> Trust {
    let mut current = cert.clone();
    for _ in 0..8 {
        if trusted.iter().any(|f| f.eq_ignore_ascii_case(&current.fingerprint())) {
            return Trust::Trusted;
        }
        // A root of the Mozilla store as issuer?
        for anchor in webpki_roots::TLS_SERVER_ROOTS {
            let subject: &[u8] = anchor.subject.as_ref();
            let issuer_body = Tlv::parse(&current.issuer).map(|t| t.body).unwrap_or_default();
            if subject == issuer_body || subject == current.issuer.as_slice() {
                let spki: &[u8] = anchor.subject_public_key_info.as_ref();
                let full = if spki.first() == Some(&der::SEQUENCE) { spki.to_vec() } else { der::tlv(der::SEQUENCE, spki) };
                if current.signed_by_spki(&full) {
                    return Trust::Trusted;
                }
            }
        }
        let Some(parent) = pool.iter().find(|c| c.subject == current.issuer && c.der != current.der) else { return Trust::Unknown };
        if !current.signed_by_spki(&parent.spki) {
            return Trust::Unknown;
        }
        current = parent.clone();
    }
    Trust::Unknown
}
