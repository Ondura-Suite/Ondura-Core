//! Password-protected Office files (MS-OFFCRYPTO "agile" encryption, as
//! written by Office 2010 and later): the OOXML package is encrypted with
//! AES-256 and stored in a Compound File next to the encryption parameters.

use std::io::{Cursor, Read, Write};

use aes::Aes256;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use cbc::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit, block_padding::NoPadding};
use hmac::{Hmac, Mac};
use quick_xml::events::Event;
use sha2::{Digest, Sha512};

use crate::{Error, Result};

/// First bytes of a Compound File (OLE2), the container of encrypted files.
const CFB_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

const BLOCK_VERIFIER_INPUT: [u8; 8] = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE: [u8; 8] = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY: [u8; 8] = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const BLOCK_HMAC_KEY: [u8; 8] = [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6];
const BLOCK_HMAC_VALUE: [u8; 8] = [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33];
const SEGMENT: usize = 4096;
const SPIN_COUNT: u32 = 100_000;

type Enc = cbc::Encryptor<Aes256>;
type Dec = cbc::Decryptor<Aes256>;

/// `true` for an encrypted (or other Compound File) document.
pub fn is_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(&CFB_MAGIC)
}

/// Error text the apps recognise to ask for a password.
pub const PASSWORD_REQUIRED: &str = "ONDURA_PASSWORD_REQUIRED";
pub const PASSWORD_WRONG: &str = "ONDURA_PASSWORD_WRONG";

fn sha512(parts: &[&[u8]]) -> Vec<u8> {
    let mut h = Sha512::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().to_vec()
}

/// Hash truncated or padded with 0x36 to `len` bytes.
fn fit(mut v: Vec<u8>, len: usize, pad: u8) -> Vec<u8> {
    v.resize(len, pad);
    v
}

/// Iterated password hash (before the block key is mixed in).
fn password_hash(password: &str, salt: &[u8], spin: u32) -> Vec<u8> {
    let pw: Vec<u8> = password.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut h = sha512(&[salt, &pw]);
    for i in 0..spin {
        h = sha512(&[&i.to_le_bytes(), &h]);
    }
    h
}

fn derived_key(hash: &[u8], block: &[u8], key_len: usize) -> Vec<u8> {
    fit(sha512(&[hash, block]), key_len, 0x36)
}

fn aes(key: &[u8], iv: &[u8], data: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    let mut buf = data.to_vec();
    let rem = buf.len() % 16;
    if rem != 0 {
        buf.resize(buf.len() + 16 - rem, 0);
    }
    let n = buf.len();
    let bad = |_| Error::Format("AES".into());
    if encrypt {
        Enc::new_from_slices(key, &iv[..16])
            .map_err(bad)?
            .encrypt_padded_mut::<NoPadding>(&mut buf, n)
            .map_err(|_| Error::Format("AES".into()))?;
    } else {
        Dec::new_from_slices(key, &iv[..16])
            .map_err(bad)?
            .decrypt_padded_mut::<NoPadding>(&mut buf)
            .map_err(|_| Error::Format("AES".into()))?;
    }
    Ok(buf)
}

/// Attributes of `<keyData>` and `<p:encryptedKey>`.
#[derive(Default, Debug)]
struct Params {
    key_salt: Vec<u8>,
    key_bits: usize,
    pw_salt: Vec<u8>,
    spin: u32,
    verifier_input: Vec<u8>,
    verifier_value: Vec<u8>,
    key_value: Vec<u8>,
    pw_key_bits: usize,
}

fn parse_info(info: &[u8]) -> Result<Params> {
    if info.len() < 8 {
        return Err(Error::Format("EncryptionInfo".into()));
    }
    let (major, minor) = (
        u16::from_le_bytes([info[0], info[1]]),
        u16::from_le_bytes([info[2], info[3]]),
    );
    if (major, minor) != (4, 4) {
        return Err(Error::Format(ondura_i18n::tr!(
            "Diese Verschlüsselung (Version {0}.{1}) wird nicht unterstützt. Speichern Sie die Datei in Office erneut mit Kennwort.",
            major,
            minor
        )));
    }
    let mut p = Params::default();
    let mut reader = quick_xml::Reader::from_reader(&info[8..]);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e) | Event::Empty(e)) => {
                let name = e.name();
                let local = name.local_name();
                let attr = |k: &str| -> Option<String> {
                    e.attributes()
                        .flatten()
                        .find(|a| a.key.local_name().as_ref() == k.as_bytes())
                        .and_then(|a| a.unescape_value().ok())
                        .map(|v| v.into_owned())
                };
                let b64 = |k: &str| {
                    attr(k)
                        .and_then(|v| B64.decode(v.trim()).ok())
                        .unwrap_or_default()
                };
                match local.as_ref() {
                    b"keyData" => {
                        p.key_salt = b64("saltValue");
                        p.key_bits = attr("keyBits").and_then(|v| v.parse().ok()).unwrap_or(256);
                        if attr("hashAlgorithm").as_deref() != Some("SHA512")
                            || attr("cipherAlgorithm").as_deref() != Some("AES")
                        {
                            return Err(Error::Format(ondura_i18n::tr!(
                                "Nur AES/SHA-512-verschlüsselte Dateien werden unterstützt"
                            )));
                        }
                    }
                    b"encryptedKey" => {
                        p.pw_salt = b64("saltValue");
                        p.spin = attr("spinCount")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(SPIN_COUNT);
                        p.verifier_input = b64("encryptedVerifierHashInput");
                        p.verifier_value = b64("encryptedVerifierHashValue");
                        p.key_value = b64("encryptedKeyValue");
                        p.pw_key_bits = attr("keyBits").and_then(|v| v.parse().ok()).unwrap_or(256);
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Error::Format(e.to_string())),
            _ => {}
        }
        buf.clear();
    }
    if p.key_salt.is_empty() || p.pw_salt.is_empty() || p.key_value.is_empty() {
        return Err(Error::Format("EncryptionInfo".into()));
    }
    Ok(p)
}

fn read_stream(cf: &mut cfb::CompoundFile<Cursor<&[u8]>>, name: &str) -> Result<Vec<u8>> {
    let mut s = cf
        .open_stream(name)
        .map_err(|e| Error::Format(format!("{name}: {e}")))?;
    let mut out = Vec::new();
    s.read_to_end(&mut out)
        .map_err(|e| Error::Format(e.to_string()))?;
    Ok(out)
}

/// Decrypt an encrypted Office file; the result is the plain OOXML package.
pub fn decrypt(bytes: &[u8], password: Option<&str>) -> Result<Vec<u8>> {
    let mut cf =
        cfb::CompoundFile::open(Cursor::new(bytes)).map_err(|e| Error::Format(e.to_string()))?;
    let info = read_stream(&mut cf, "/EncryptionInfo").map_err(|_| {
        Error::Format(ondura_i18n::tr!(
            "Die Datei ist kein Office-Dokument im XML-Format (z. B. eine alte .doc/.xls-Datei)"
        ))
    })?;
    let package = read_stream(&mut cf, "/EncryptedPackage")?;
    let p = parse_info(&info)?;
    let Some(password) = password else {
        return Err(Error::Format(PASSWORD_REQUIRED.into()));
    };
    let hash = password_hash(password, &p.pw_salt, p.spin);
    let kl = p.pw_key_bits / 8;
    let input = aes(
        &derived_key(&hash, &BLOCK_VERIFIER_INPUT, kl),
        &p.pw_salt,
        &p.verifier_input,
        false,
    )?;
    let value = aes(
        &derived_key(&hash, &BLOCK_VERIFIER_VALUE, kl),
        &p.pw_salt,
        &p.verifier_value,
        false,
    )?;
    let expected = sha512(&[&input[..p.pw_salt.len().min(input.len())]]);
    if value.len() < 64 || value[..64] != expected[..] {
        return Err(Error::Format(PASSWORD_WRONG.into()));
    }
    let key = aes(
        &derived_key(&hash, &BLOCK_KEY, kl),
        &p.pw_salt,
        &p.key_value,
        false,
    )?;
    let key = &key[..p.key_bits / 8];
    if package.len() < 8 {
        return Err(Error::Format("EncryptedPackage".into()));
    }
    let size = u64::from_le_bytes(package[..8].try_into().expect("8 bytes")) as usize;
    let mut out = Vec::with_capacity(size);
    for (i, chunk) in package[8..].chunks(SEGMENT).enumerate() {
        let iv = sha512(&[&p.key_salt, &(i as u32).to_le_bytes()]);
        out.extend(aes(key, &iv, chunk, false)?);
    }
    if out.len() < size {
        return Err(Error::Format("EncryptedPackage".into()));
    }
    out.truncate(size);
    Ok(out)
}

fn random(n: usize) -> Vec<u8> {
    (0..n).map(|_| rand::random::<u8>()).collect()
}

/// UNICODE-LP-P4: byte length, UTF-16LE text, padded to four bytes.
fn lp_p4(s: &str, out: &mut Vec<u8>) {
    let bytes: Vec<u8> = s.encode_utf16().flat_map(u16::to_le_bytes).collect();
    out.extend((bytes.len() as u32).to_le_bytes());
    out.extend(&bytes);
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

fn versions(out: &mut Vec<u8>) {
    for _ in 0..3 {
        out.extend([1, 0, 0, 0]); // major 1, minor 0
    }
}

/// The `\x06DataSpaces` storage Office expects next to an encrypted package.
fn data_spaces() -> Vec<(&'static str, Vec<u8>)> {
    let mut version = Vec::new();
    lp_p4("Microsoft.Container.DataSpaces", &mut version);
    versions(&mut version);

    let mut entry = Vec::new();
    entry.extend(1u32.to_le_bytes());
    entry.extend(0u32.to_le_bytes());
    lp_p4("EncryptedPackage", &mut entry);
    lp_p4("StrongEncryptionDataSpace", &mut entry);
    let mut map = Vec::new();
    map.extend(8u32.to_le_bytes());
    map.extend(1u32.to_le_bytes());
    map.extend(((entry.len() + 4) as u32).to_le_bytes());
    map.extend(entry);

    let mut info = Vec::new();
    info.extend(8u32.to_le_bytes());
    info.extend(1u32.to_le_bytes());
    lp_p4("StrongEncryptionTransform", &mut info);

    let mut primary = Vec::new();
    let mut id = Vec::new();
    lp_p4("{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}", &mut id);
    primary.extend(((8 + id.len()) as u32).to_le_bytes());
    primary.extend(1u32.to_le_bytes());
    primary.extend(id);
    lp_p4("Microsoft.Container.EncryptionTransform", &mut primary);
    versions(&mut primary);
    primary.extend(0u32.to_le_bytes()); // EncryptionName (empty)
    primary.extend(0u32.to_le_bytes()); // EncryptionBlockSize
    primary.extend(0u32.to_le_bytes()); // CipherMode
    primary.extend(4u32.to_le_bytes()); // Reserved

    vec![
        ("/\u{6}DataSpaces/Version", version),
        ("/\u{6}DataSpaces/DataSpaceMap", map),
        (
            "/\u{6}DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace",
            info,
        ),
        (
            "/\u{6}DataSpaces/TransformInfo/StrongEncryptionTransform/\u{6}Primary",
            primary,
        ),
    ]
}

/// Encrypt a plain OOXML package with a password (AES-256, SHA-512).
pub fn encrypt(package: &[u8], password: &str) -> Result<Vec<u8>> {
    let key_salt = random(16);
    let pw_salt = random(16);
    let key = random(32);

    // EncryptedPackage: size + 4096-byte segments.
    let mut enc = Vec::with_capacity(package.len() + 8 + 16);
    enc.extend((package.len() as u64).to_le_bytes());
    for (i, chunk) in package.chunks(SEGMENT).enumerate() {
        let iv = sha512(&[&key_salt, &(i as u32).to_le_bytes()]);
        enc.extend(aes(&key, &iv, chunk, true)?);
    }

    // Data integrity: HMAC-SHA512 of the whole EncryptedPackage stream.
    let hmac_key = random(64);
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(&hmac_key)
        .map_err(|e| Error::Format(e.to_string()))?;
    mac.update(&enc);
    let hmac_value = mac.finalize().into_bytes().to_vec();
    let enc_hmac_key = aes(
        &key,
        &sha512(&[&key_salt, &BLOCK_HMAC_KEY]),
        &hmac_key,
        true,
    )?;
    let enc_hmac_value = aes(
        &key,
        &sha512(&[&key_salt, &BLOCK_HMAC_VALUE]),
        &hmac_value,
        true,
    )?;

    // Password verifier and the wrapped package key.
    let hash = password_hash(password, &pw_salt, SPIN_COUNT);
    let verifier = random(16);
    let enc_verifier_input = aes(
        &derived_key(&hash, &BLOCK_VERIFIER_INPUT, 32),
        &pw_salt,
        &verifier,
        true,
    )?;
    let enc_verifier_value = aes(
        &derived_key(&hash, &BLOCK_VERIFIER_VALUE, 32),
        &pw_salt,
        &sha512(&[&verifier]),
        true,
    )?;
    let enc_key = aes(&derived_key(&hash, &BLOCK_KEY, 32), &pw_salt, &key, true)?;

    let b = |v: &[u8]| B64.encode(v);
    let params = |salt: &[u8]| {
        format!(
            r#"saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="{}""#,
            b(salt)
        )
    };
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<encryption xmlns=\"http://schemas.microsoft.com/office/2006/encryption\" xmlns:p=\"http://schemas.microsoft.com/office/2006/keyEncryptor/password\" xmlns:c=\"http://schemas.microsoft.com/office/2006/keyEncryptor/certificate\"><keyData {}/><dataIntegrity encryptedHmacKey=\"{}\" encryptedHmacValue=\"{}\"/><keyEncryptors><keyEncryptor uri=\"http://schemas.microsoft.com/office/2006/keyEncryptor/password\"><p:encryptedKey spinCount=\"{SPIN_COUNT}\" {} encryptedVerifierHashInput=\"{}\" encryptedVerifierHashValue=\"{}\" encryptedKeyValue=\"{}\"/></keyEncryptor></keyEncryptors></encryption>",
        params(&key_salt),
        b(&enc_hmac_key),
        b(&enc_hmac_value),
        params(&pw_salt),
        b(&enc_verifier_input),
        b(&enc_verifier_value),
        b(&enc_key),
    );
    let mut info = vec![4, 0, 4, 0, 0x40, 0, 0, 0];
    info.extend(xml.as_bytes());

    let io = |e: std::io::Error| Error::Format(e.to_string());
    let mut cf = cfb::CompoundFile::create(Cursor::new(Vec::new())).map_err(io)?;
    for (path, data) in data_spaces() {
        if let Some(parent) = path
            .rsplit_once('/')
            .map(|(p, _)| p)
            .filter(|p| !p.is_empty())
        {
            cf.create_storage_all(parent).map_err(io)?;
        }
        cf.create_stream(path)
            .map_err(io)?
            .write_all(&data)
            .map_err(io)?;
    }
    cf.create_stream("/EncryptionInfo")
        .map_err(io)?
        .write_all(&info)
        .map_err(io)?;
    cf.create_stream("/EncryptedPackage")
        .map_err(io)?
        .write_all(&enc)
        .map_err(io)?;
    cf.flush().map_err(io)?;
    Ok(cf.into_inner().into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let plain: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
        let enc = encrypt(&plain, "Geheim123").unwrap();
        assert!(is_encrypted(&enc));
        assert_eq!(decrypt(&enc, Some("Geheim123")).unwrap(), plain);
        assert!(
            matches!(decrypt(&enc, Some("falsch")), Err(Error::Format(m)) if m == PASSWORD_WRONG)
        );
        assert!(matches!(decrypt(&enc, None), Err(Error::Format(m)) if m == PASSWORD_REQUIRED));
    }
}
