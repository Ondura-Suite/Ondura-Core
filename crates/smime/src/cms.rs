//! CMS (RFC 5652): detached and enveloped signatures and RSA key-transport
//! encryption, as used by S/MIME 3.2/4.0.

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use chrono::{DateTime, Utc};
use rand_core::{OsRng, RngCore};
use rsa::{Oaep, Pkcs1v15Encrypt, RsaPrivateKey};

use crate::cert::{self, Certificate, Trust};
use crate::der::{self, Tlv};
use crate::{Error, Result};

const DATA: &str = "1.2.840.113549.1.7.1";
const SIGNED_DATA: &str = "1.2.840.113549.1.7.2";
const ENVELOPED_DATA: &str = "1.2.840.113549.1.7.3";
const CONTENT_TYPE: &str = "1.2.840.113549.1.9.3";
const MESSAGE_DIGEST: &str = "1.2.840.113549.1.9.4";
const SIGNING_TIME: &str = "1.2.840.113549.1.9.5";
const SMIME_CAPABILITIES: &str = "1.2.840.113549.1.9.15";
const SHA256: &str = "2.16.840.1.101.3.4.2.1";
const RSAES_OAEP: &str = "1.2.840.113549.1.1.7";
const RSASSA_PSS: &str = "1.2.840.113549.1.1.10";
const AES128_CBC: &str = "2.16.840.1.101.3.4.1.2";
const AES192_CBC: &str = "2.16.840.1.101.3.4.1.22";
const AES256_CBC: &str = "2.16.840.1.101.3.4.1.42";
const DES_EDE3_CBC: &str = "1.2.840.113549.3.7";

/// Outcome of a signature check.
#[derive(Debug, Clone)]
pub struct SignatureCheck {
    /// The signature matches the content and the signer's key.
    pub valid: bool,
    pub trust: Trust,
    pub signer: Option<Certificate>,
    pub signing_time: Option<DateTime<Utc>>,
    /// Why `valid` is false (or what could not be checked).
    pub problem: Option<String>,
}

fn content_info(oid: &str, content: &[u8]) -> Vec<u8> {
    der::seq(&[&der::oid(oid), &der::ctx(0, content)])
}

fn utc_time(t: DateTime<Utc>) -> Vec<u8> {
    der::tlv(der::UTC_TIME, t.format("%y%m%d%H%M%SZ").to_string().as_bytes())
}

fn attribute(oid: &str, value: &[u8]) -> Vec<u8> {
    der::seq(&[&der::oid(oid), &der::set_of(&[value.to_vec()])])
}

/// Detached `SignedData` over `content` (SHA-256, RSA PKCS#1 v1.5) with
/// the signer's chain, as a DER ContentInfo.
pub fn sign(content: &[u8], key: &RsaPrivateKey, chain: &[Certificate], now: DateTime<Utc>) -> Result<Vec<u8>> {
    let signer = chain.first().ok_or_else(|| Error::Format("no signing certificate".into()))?;
    let (hash, scheme) = cert::digest(SHA256, content)?;
    let caps = der::seq(&[&der::alg(AES256_CBC, None), &der::alg(AES128_CBC, None), &der::alg(DES_EDE3_CBC, None)]);
    let attrs = vec![
        attribute(CONTENT_TYPE, &der::oid(DATA)),
        attribute(SIGNING_TIME, &utc_time(now)),
        attribute(MESSAGE_DIGEST, &der::octets(&hash)),
        attribute(SMIME_CAPABILITIES, &caps),
    ];
    let signed_attrs = der::set_of(&attrs);
    let (attr_hash, _) = cert::digest(SHA256, &signed_attrs)?;
    let signature = key.sign(scheme, &attr_hash).map_err(|e| Error::Crypto(e.to_string()))?;
    // Stored as [0] IMPLICIT: same content, other tag.
    let mut implicit = signed_attrs.clone();
    implicit[0] = 0xa0;
    let signer_info = der::seq(&[
        &der::int(1),
        &signer.issuer_and_serial(),
        &der::alg(SHA256, Some(&der::null())),
        &implicit,
        &der::alg(cert::RSA_ENCRYPTION, Some(&der::null())),
        &der::octets(&signature),
    ]);
    let certs: Vec<u8> = chain.iter().flat_map(|c| c.der.clone()).collect();
    let signed_data = der::seq(&[
        &der::int(1),
        &der::set_of(&[der::alg(SHA256, Some(&der::null()))]),
        &der::seq(&[&der::oid(DATA)]),
        &der::ctx(0, &certs),
        &der::set_of(&[signer_info]),
    ]);
    Ok(content_info(SIGNED_DATA, &signed_data))
}

/// The ContentInfo type and its `[0]` content.
fn open_content_info(data: &[u8]) -> Result<(String, Tlv<'_>)> {
    let ci = Tlv::parse(data)?.expect(der::SEQUENCE)?;
    let kind = ci.child(0)?.oid()?;
    let content = ci.child(1)?.expect(0xa0)?.child(0)?;
    Ok((kind, content))
}

/// Check a `SignedData`. `detached` is the signed content for detached
/// signatures (multipart/signed); otherwise the encapsulated content is
/// used and returned. `pool` adds certificates for the chain check.
pub fn verify(data: &[u8], detached: Option<&[u8]>, pool: &[Certificate], trusted: &[String]) -> Result<(SignatureCheck, Vec<u8>)> {
    let (kind, sd) = open_content_info(data)?;
    if kind != SIGNED_DATA {
        return Err(Error::Format(format!("not signed data ({kind})")));
    }
    let parts = sd.children()?;
    let encap = parts.get(2).ok_or_else(|| Error::Format("no content info".into()))?;
    let content = match detached {
        Some(c) => c.to_vec(),
        None => match encap.children()?.get(1) {
            Some(c) => c.expect(0xa0)?.child(0)?.octets()?,
            None => return Err(Error::Format("signature without content".into())),
        },
    };
    let mut certs: Vec<Certificate> = Vec::new();
    let mut signer_infos = None;
    for p in &parts[3..] {
        match p.tag {
            0xa0 => {
                for c in p.children()? {
                    if c.tag == der::SEQUENCE
                        && let Ok(cert) = Certificate::from_der(&c.to_der()?)
                    {
                        certs.push(cert);
                    }
                }
            }
            der::SET => signer_infos = Some(*p),
            _ => {}
        }
    }
    let si = signer_infos.ok_or_else(|| Error::Format("no signer".into()))?.child(0)?;
    let f = si.children()?;
    let sid = f.get(1).ok_or_else(|| Error::Format("no signer id".into()))?;
    let mut all: Vec<Certificate> = certs.clone();
    all.extend(pool.iter().cloned());
    let signer = match sid.tag {
        der::SEQUENCE => {
            let issuer = sid.child(0)?.to_der()?;
            let serial = sid.child(1)?.raw.to_vec();
            all.iter().find(|c| c.issuer == issuer && c.serial == serial).cloned()
        }
        0x80 => all.iter().find(|c| c.key_id.as_deref() == Some(sid.body)).cloned(),
        _ => None,
    };
    let digest_alg = f.get(2).ok_or_else(|| Error::Format("no digest algorithm".into()))?.child(0)?.oid()?;
    let mut idx = 3;
    let mut signed_attrs = None;
    if f.get(idx).is_some_and(|t| t.tag == 0xa0) {
        signed_attrs = Some(f[idx]);
        idx += 1;
    }
    let sig_alg = f.get(idx).ok_or_else(|| Error::Format("no signature algorithm".into()))?.child(0)?.oid()?;
    let signature = f.get(idx + 1).ok_or_else(|| Error::Format("no signature".into()))?.octets()?;

    let mut check = SignatureCheck { valid: false, trust: Trust::Unknown, signer: signer.clone(), signing_time: None, problem: None };
    let Some(signer) = signer else {
        check.problem = Some(ondura_i18n::tr!("Das Zertifikat des Absenders fehlt in der Nachricht"));
        return Ok((check, content));
    };
    let (content_hash, _) = match cert::digest(&digest_alg, &content) {
        Ok(h) => h,
        Err(e) => {
            check.problem = Some(e.to_string());
            return Ok((check, content));
        }
    };
    let signed_bytes = match signed_attrs {
        Some(attrs) => {
            let mut digest_ok = false;
            for a in attrs.children()? {
                let kids = a.children()?;
                let id = kids.first().map(|k| k.oid()).transpose()?.unwrap_or_default();
                let value = kids.get(1).and_then(|s| s.children().ok()).and_then(|v| v.first().copied());
                match (id.as_str(), value) {
                    (MESSAGE_DIGEST, Some(v)) => digest_ok = v.body == content_hash.as_slice(),
                    (SIGNING_TIME, Some(v)) => {
                        check.signing_time = parse_time(&v);
                    }
                    _ => {}
                }
            }
            if !digest_ok {
                check.problem = Some(ondura_i18n::tr!("Der Inhalt wurde nach dem Signieren verändert"));
                return Ok((check, content));
            }
            // The signature covers the attributes encoded as SET.
            let mut der_attrs = attrs.to_der()?;
            der_attrs[0] = der::SET;
            der_attrs
        }
        None => content.clone(),
    };
    let key = match signer.rsa_key() {
        Ok(k) => k,
        Err(e) => {
            check.problem = Some(e.to_string());
            return Ok((check, content));
        }
    };
    let alg = sig_alg.as_str();
    if alg == RSASSA_PSS {
        check.problem = Some(ondura_i18n::tr!("RSASSA-PSS-Signaturen werden nicht unterstützt"));
        return Ok((check, content));
    }
    match cert::verify_rsa(&key, alg, Some(&digest_alg), &signed_bytes, &signature) {
        Ok(()) => {
            check.valid = true;
            check.trust = cert::chain_trust(&signer, &all, trusted);
            let at = check.signing_time.unwrap_or_else(Utc::now);
            if !signer.valid_at(at) {
                check.problem = Some(ondura_i18n::tr!("Das Zertifikat war zum Zeitpunkt der Signatur nicht gültig"));
            }
        }
        Err(Error::Unsupported(what)) => check.problem = Some(ondura_i18n::tr!("Nicht unterstützt: {0}", what)),
        Err(_) => check.problem = Some(ondura_i18n::tr!("Die Signatur passt nicht zum Inhalt")),
    }
    Ok((check, content))
}

fn parse_time(t: &Tlv) -> Option<DateTime<Utc>> {
    let s = std::str::from_utf8(t.body).ok()?.trim_end_matches('Z');
    let full = if t.tag == der::UTC_TIME { format!("20{s}") } else { s.to_string() };
    chrono::NaiveDateTime::parse_from_str(full.split('.').next()?, "%Y%m%d%H%M%S").ok().map(|d| d.and_utc())
}

/// Encrypt `content` for every recipient (AES-256-CBC, RSA PKCS#1 v1.5
/// key transport) as a DER `EnvelopedData` ContentInfo.
pub fn encrypt(content: &[u8], recipients: &[Certificate]) -> Result<Vec<u8>> {
    let mut key = [0u8; 32];
    let mut iv = [0u8; 16];
    OsRng.fill_bytes(&mut key);
    OsRng.fill_bytes(&mut iv);
    let ciphertext = cbc::Encryptor::<aes::Aes256>::new(&key.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(content);
    let mut infos = Vec::new();
    for r in recipients {
        let pk = r.rsa_key()?;
        let enc = pk.encrypt(&mut OsRng, Pkcs1v15Encrypt, &key).map_err(|e| Error::Crypto(e.to_string()))?;
        infos.push(der::seq(&[&der::int(0), &r.issuer_and_serial(), &der::alg(cert::RSA_ENCRYPTION, Some(&der::null())), &der::octets(&enc)]));
    }
    let eci = der::seq(&[&der::oid(DATA), &der::alg(AES256_CBC, Some(&der::octets(&iv))), &der::tlv(0x80, &ciphertext)]);
    let env = der::seq(&[&der::int(0), &der::set_of(&infos), &eci]);
    Ok(content_info(ENVELOPED_DATA, &env))
}

/// `true` if `data` is an `EnvelopedData` ContentInfo.
pub fn is_enveloped(data: &[u8]) -> bool {
    open_content_info(data).is_ok_and(|(k, _)| k == ENVELOPED_DATA)
}

/// Decrypt an `EnvelopedData` with one of `identities` (key + certificate).
pub fn decrypt(data: &[u8], identities: &[(&RsaPrivateKey, &Certificate)]) -> Result<Vec<u8>> {
    let (kind, env) = open_content_info(data)?;
    if kind != ENVELOPED_DATA {
        return Err(Error::Format(format!("not enveloped data ({kind})")));
    }
    let mut parts = env.children()?.into_iter();
    parts.next(); // version
    let mut infos = parts.next().ok_or_else(|| Error::Format("no recipients".into()))?;
    if infos.tag == 0xa0 {
        // originatorInfo
        infos = parts.next().ok_or_else(|| Error::Format("no recipients".into()))?;
    }
    let eci = parts.next().ok_or_else(|| Error::Format("no encrypted content".into()))?;
    let mut cek = None;
    for ri in infos.children()? {
        if ri.tag != der::SEQUENCE {
            continue; // only key transport recipients
        }
        let f = ri.children()?;
        let (Some(rid), Some(alg), Some(enc)) = (f.get(1), f.get(2), f.get(3)) else { continue };
        let mine = identities.iter().find(|(_, c)| match rid.tag {
            der::SEQUENCE => rid.child(0).and_then(|i| i.to_der()).is_ok_and(|i| i == c.issuer) && rid.child(1).is_ok_and(|s| s.raw == c.serial.as_slice()),
            0x80 => c.key_id.as_deref() == Some(rid.body),
            _ => false,
        });
        let Some((key, _)) = mine else { continue };
        let alg_oid = alg.child(0)?.oid()?;
        let encrypted = enc.octets()?;
        let result = if alg_oid == RSAES_OAEP {
            // Parameters name the hash; SHA-1 is the default.
            let sha256 = alg.child(1).ok().is_some_and(|p| oid_in(&p, SHA256));
            if sha256 { key.decrypt(Oaep::new::<sha2::Sha256>(), &encrypted) } else { key.decrypt(Oaep::new::<sha1::Sha1>(), &encrypted) }
        } else {
            key.decrypt(Pkcs1v15Encrypt, &encrypted)
        };
        cek = Some(result.map_err(|_| Error::Crypto(ondura_i18n::tr!("Der Schlüssel passt nicht zur Nachricht")))?);
        break;
    }
    let cek = cek.ok_or(Error::NoKey)?;
    let f = eci.children()?;
    let alg = f.get(1).ok_or_else(|| Error::Format("no content algorithm".into()))?;
    let alg_oid = alg.child(0)?.oid()?;
    let iv = alg.child(1)?.octets()?;
    let ciphertext = f.get(2).ok_or_else(|| Error::Format("no ciphertext".into()))?.octets()?;
    decrypt_cbc(&alg_oid, &cek, &iv, &ciphertext)
}

fn oid_in(t: &Tlv, oid: &str) -> bool {
    if t.oid().is_ok_and(|o| o == oid) {
        return true;
    }
    t.tag & 0x20 != 0 && t.children().is_ok_and(|c| c.iter().any(|k| oid_in(k, oid)))
}

/// CBC decryption for the content ciphers in use.
pub fn decrypt_cbc(alg: &str, key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>> {
    let bad = |_| Error::Crypto(ondura_i18n::tr!("falscher Schlüssel oder beschädigte Daten"));
    let len = |e: aes::cipher::InvalidLength| Error::Crypto(ondura_i18n::tr!("ungültige Schlüssellänge: {0}", e));
    match alg {
        AES128_CBC => cbc::Decryptor::<aes::Aes128>::new_from_slices(key, iv).map_err(len)?.decrypt_padded_vec_mut::<Pkcs7>(data).map_err(bad),
        AES192_CBC => cbc::Decryptor::<aes::Aes192>::new_from_slices(key, iv).map_err(len)?.decrypt_padded_vec_mut::<Pkcs7>(data).map_err(bad),
        AES256_CBC => cbc::Decryptor::<aes::Aes256>::new_from_slices(key, iv).map_err(len)?.decrypt_padded_vec_mut::<Pkcs7>(data).map_err(bad),
        DES_EDE3_CBC => cbc::Decryptor::<des::TdesEde3>::new_from_slices(key, iv).map_err(len)?.decrypt_padded_vec_mut::<Pkcs7>(data).map_err(bad),
        other => Err(Error::Unsupported(format!("content encryption {other}"))),
    }
}
