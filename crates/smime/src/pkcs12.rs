//! PKCS#12 (.p12/.pfx) import: the private key and certificates of an
//! S/MIME identity as exported by Windows, macOS, Firefox or OpenSSL.
//! Supports PBES2 (PBKDF2 + AES/3DES) and the legacy PKCS#12 PBE schemes
//! (3DES, RC2-40, RC2-128).

use aes::cipher::{BlockDecryptMut, InnerIvInit, block_padding::Pkcs7};
use sha1::{Digest, Sha1};

use crate::cert::Certificate;
use crate::cms::decrypt_cbc;
use crate::der::Tlv;
use crate::{Error, Result};

const DATA: &str = "1.2.840.113549.1.7.1";
const ENCRYPTED_DATA: &str = "1.2.840.113549.1.7.6";
const KEY_BAG: &str = "1.2.840.113549.1.12.10.1.1";
const SHROUDED_KEY_BAG: &str = "1.2.840.113549.1.12.10.1.2";
const CERT_BAG: &str = "1.2.840.113549.1.12.10.1.3";
const LOCAL_KEY_ID: &str = "1.2.840.113549.1.9.21";
const PBES2: &str = "1.2.840.113549.1.5.13";
const PBKDF2: &str = "1.2.840.113549.1.5.12";
const PBE_SHA_3DES: &str = "1.2.840.113549.1.12.1.3";
const PBE_SHA_RC2_128: &str = "1.2.840.113549.1.12.1.5";
const PBE_SHA_RC2_40: &str = "1.2.840.113549.1.12.1.6";

/// Contents of a PKCS#12 file.
#[derive(Debug)]
pub struct Pkcs12 {
    /// PKCS#8 `PrivateKeyInfo` (DER) of the first key.
    pub key: Vec<u8>,
    /// Certificate of the key first, then the rest of the chain.
    pub chain: Vec<Certificate>,
}

/// PKCS#12 key derivation (RFC 7292, appendix B.2) with SHA-1.
fn pkcs12_kdf(password: &str, salt: &[u8], iterations: u64, id: u8, len: usize) -> Vec<u8> {
    const U: usize = 20;
    const V: usize = 64;
    let mut pw: Vec<u8> = password.encode_utf16().flat_map(u16::to_be_bytes).collect();
    pw.extend([0, 0]);
    let fill = |src: &[u8]| -> Vec<u8> {
        if src.is_empty() {
            return Vec::new();
        }
        let n = src.len().div_ceil(V) * V;
        src.iter().cycle().take(n).copied().collect()
    };
    let mut i_buf = [fill(salt), fill(&pw)].concat();
    let d = [id; V];
    let mut out = Vec::new();
    while out.len() < len {
        let mut a = Sha1::new().chain_update(d).chain_update(&i_buf).finalize().to_vec();
        for _ in 1..iterations {
            a = Sha1::digest(&a).to_vec();
        }
        let b: Vec<u8> = a.iter().cycle().take(V).copied().collect();
        for block in i_buf.chunks_mut(V) {
            // block = (block + b + 1) mod 2^(8v)
            let mut carry = 1u16;
            for k in (0..V).rev() {
                let sum = block[k] as u16 + b[k] as u16 + carry;
                block[k] = sum as u8;
                carry = sum >> 8;
            }
        }
        out.extend_from_slice(&a[..U.min(len - out.len())]);
    }
    out
}

/// Decrypt data protected by a password-based scheme (`alg` is the
/// AlgorithmIdentifier element).
fn pbe_decrypt(alg: &Tlv, password: &str, data: &[u8]) -> Result<Vec<u8>> {
    let id = alg.child(0)?.oid()?;
    let params = alg.child(1)?;
    let wrong = || Error::Crypto("Falsches Passwort oder beschädigte Datei".into());
    match id.as_str() {
        PBES2 => {
            let kdf = params.child(0)?;
            if kdf.child(0)?.oid()? != PBKDF2 {
                return Err(Error::Unsupported("key derivation".into()));
            }
            let kp = kdf.child(1)?.children()?;
            let salt = kp.first().ok_or_else(|| Error::Format("no salt".into()))?.octets()?;
            let iterations = kp.get(1).ok_or_else(|| Error::Format("no iterations".into()))?.small_int()? as u32;
            let prf = kp.iter().skip(2).find(|t| t.tag == crate::der::SEQUENCE).and_then(|t| t.child(0).ok()).and_then(|o| o.oid().ok());
            let scheme = params.child(1)?;
            let cipher = scheme.child(0)?.oid()?;
            let iv = scheme.child(1)?.octets()?;
            let key_len = match cipher.as_str() {
                "2.16.840.1.101.3.4.1.2" => 16,
                "2.16.840.1.101.3.4.1.22" => 24,
                "2.16.840.1.101.3.4.1.42" => 32,
                "1.2.840.113549.3.7" => 24,
                other => return Err(Error::Unsupported(format!("cipher {other}"))),
            };
            let mut key = vec![0u8; key_len];
            match prf.as_deref() {
                None | Some("1.2.840.113549.2.7") => pbkdf2::pbkdf2_hmac::<Sha1>(password.as_bytes(), &salt, iterations, &mut key),
                Some("1.2.840.113549.2.9") => pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, iterations, &mut key),
                Some("1.2.840.113549.2.10") => pbkdf2::pbkdf2_hmac::<sha2::Sha384>(password.as_bytes(), &salt, iterations, &mut key),
                Some("1.2.840.113549.2.11") => pbkdf2::pbkdf2_hmac::<sha2::Sha512>(password.as_bytes(), &salt, iterations, &mut key),
                Some(other) => return Err(Error::Unsupported(format!("PRF {other}"))),
            }
            decrypt_cbc(&cipher, &key, &iv, data).map_err(|_| wrong())
        }
        PBE_SHA_3DES | PBE_SHA_RC2_128 | PBE_SHA_RC2_40 => {
            let salt = params.child(0)?.octets()?;
            let iterations = params.child(1)?.small_int()?;
            let key_len = match id.as_str() {
                PBE_SHA_3DES => 24,
                PBE_SHA_RC2_128 => 16,
                _ => 5,
            };
            let key = pkcs12_kdf(password, &salt, iterations, 1, key_len);
            let iv = pkcs12_kdf(password, &salt, iterations, 2, 8);
            if id == PBE_SHA_3DES {
                decrypt_cbc("1.2.840.113549.3.7", &key, &iv, data).map_err(|_| wrong())
            } else {
                let cipher = rc2::Rc2::new_with_eff_key_len(&key, key_len * 8);
                cbc::Decryptor::<rc2::Rc2>::inner_iv_slice_init(cipher, &iv)
                    .map_err(|_| wrong())?
                    .decrypt_padded_vec_mut::<Pkcs7>(data)
                    .map_err(|_| wrong())
            }
        }
        other => Err(Error::Unsupported(format!("encryption {other}"))),
    }
}

/// Parse a PKCS#12 file.
pub fn parse(data: &[u8], password: &str) -> Result<Pkcs12> {
    let pfx = Tlv::parse(data)?;
    let auth = pfx.child(1)?;
    if auth.child(0)?.oid()? != DATA {
        return Err(Error::Unsupported("public-key protected PKCS#12".into()));
    }
    let safes_der = auth.child(1)?.child(0)?.octets()?;
    let safes = Tlv::parse(&safes_der)?;
    let mut keys: Vec<(Vec<u8>, Option<Vec<u8>>)> = Vec::new();
    let mut certs: Vec<(Certificate, Option<Vec<u8>>)> = Vec::new();
    for ci in safes.children()? {
        let kind = ci.child(0)?.oid()?;
        let contents = match kind.as_str() {
            DATA => ci.child(1)?.child(0)?.octets()?,
            ENCRYPTED_DATA => {
                let ed = ci.child(1)?.child(0)?;
                let eci = ed.child(1)?;
                let alg = eci.child(1)?;
                let enc = eci.child(2)?.octets()?;
                pbe_decrypt(&alg, password, &enc)?
            }
            _ => continue,
        };
        for bag in Tlv::parse(&contents)?.children()? {
            let f = bag.children()?;
            let id = f.first().ok_or_else(|| Error::Format("empty bag".into()))?.oid()?;
            let value = f.get(1).ok_or_else(|| Error::Format("bag without value".into()))?.child(0)?;
            let local_id = f.get(2).and_then(|attrs| {
                attrs.children().ok()?.into_iter().find_map(|a| {
                    let k = a.children().ok()?;
                    if k.first()?.oid().ok()? == LOCAL_KEY_ID { Some(k.get(1)?.child(0).ok()?.body.to_vec()) } else { None }
                })
            });
            match id.as_str() {
                KEY_BAG => keys.push((value.to_der()?, local_id)),
                SHROUDED_KEY_BAG => {
                    let alg = value.child(0)?;
                    let enc = value.child(1)?.octets()?;
                    keys.push((pbe_decrypt(&alg, password, &enc)?, local_id));
                }
                CERT_BAG => {
                    let der = value.child(1)?.child(0)?.octets()?;
                    if let Ok(c) = Certificate::from_der(&der) {
                        certs.push((c, local_id));
                    }
                }
                _ => {}
            }
        }
    }
    let (key, key_id) = keys.into_iter().next().ok_or_else(|| Error::Format("Die Datei enthält keinen privaten Schlüssel".into()))?;
    // The key's own certificate first: matching local key id, else the
    // certificate whose public key matches.
    let public = {
        use rsa::pkcs8::DecodePrivateKey;
        rsa::RsaPrivateKey::from_pkcs8_der(&key).map(|k| k.to_public_key()).ok()
    };
    let leaf = certs
        .iter()
        .position(|(_, id)| key_id.is_some() && *id == key_id)
        .or_else(|| certs.iter().position(|(c, _)| public.as_ref().is_some_and(|p| c.rsa_key().is_ok_and(|k| &k == p))))
        .ok_or_else(|| Error::Format("Die Datei enthält kein Zertifikat zum Schlüssel".into()))?;
    let mut chain = vec![certs[leaf].0.clone()];
    chain.extend(certs.into_iter().enumerate().filter(|(i, _)| *i != leaf).map(|(_, (c, _))| c));
    Ok(Pkcs12 { key, chain })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kdf_matches_reference() {
        // Test vector from the PKCS#12 KDF used by OpenSSL (pass "smeg").
        let salt = [0x0a, 0x58, 0xcf, 0x64, 0x53, 0x0d, 0x82, 0x3f];
        let key = pkcs12_kdf("smeg", &salt, 1, 1, 24);
        assert_eq!(crate::cert::hex(&key), "8aaae6297b6cb04642ab5b077851284eb7128f1a2a7fbca3");
        let iv = pkcs12_kdf("smeg", &salt, 1, 2, 8);
        assert_eq!(crate::cert::hex(&iv), "79993dfe048d3b76");
    }
}
