//! S/MIME on whole messages (RFC 8551): signing as multipart/signed,
//! encryption as application/pkcs7-mime, and the reverse for received
//! messages.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::cert::{Certificate, Trust};
use crate::cms;
use crate::{Error, Identity, Result};

/// What S/MIME protection a received message had.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityInfo {
    pub encrypted: bool,
    /// Set if the message is encrypted but could not be opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decrypt_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<SignatureInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureInfo {
    /// Content and signature match.
    pub valid: bool,
    /// The certificate chains up to a known root.
    pub trusted: bool,
    pub signer_name: String,
    pub signer_emails: Vec<String>,
    pub issuer: String,
    pub not_after: Option<DateTime<Utc>>,
    pub signing_time: Option<DateTime<Utc>>,
    pub problem: Option<String>,
    pub fingerprint: Option<String>,
    /// Signer certificate (DER), kept to encrypt replies.
    #[serde(skip)]
    pub certificate: Option<Vec<u8>>,
}

/// A message after removing its S/MIME layers.
#[derive(Debug)]
pub struct Unprotected {
    pub raw: Vec<u8>,
    pub info: SecurityInfo,
}

/// Split at the first empty line: (header lines, body).
fn split(raw: &[u8]) -> (Vec<String>, &[u8]) {
    let mut lines: Vec<String> = Vec::new();
    let mut pos = 0;
    while pos < raw.len() {
        let end = raw[pos..].iter().position(|b| *b == b'\n').map_or(raw.len(), |i| pos + i + 1);
        let line = String::from_utf8_lossy(&raw[pos..end]).trim_end_matches(['\r', '\n']).to_string();
        pos = end;
        if line.is_empty() {
            return (lines, &raw[pos..]);
        }
        match lines.last_mut() {
            Some(last) if line.starts_with([' ', '\t']) => {
                last.push_str("\r\n");
                last.push_str(&line);
            }
            _ => lines.push(line),
        }
    }
    (lines, &raw[raw.len()..])
}

fn header<'a>(lines: &'a [String], name: &str) -> Option<&'a str> {
    lines.iter().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

fn is_content_header(line: &str) -> bool {
    line.split_once(':').is_some_and(|(k, _)| k.trim().to_ascii_lowercase().starts_with("content-"))
}

/// Media type (lower case) and a parameter of a Content-Type value.
fn param(value: &str, name: &str) -> Option<String> {
    let unfolded = value.replace("\r\n", " ");
    unfolded.split(';').skip(1).find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim().trim_matches('"').to_string())
    })
}

fn media_type(value: &str) -> String {
    value.split(';').next().unwrap_or_default().trim().to_ascii_lowercase()
}

fn crlf(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + data.len() / 40);
    let mut prev = 0u8;
    for &b in data {
        if b == b'\n' && prev != b'\r' {
            out.push(b'\r');
        }
        out.push(b);
        prev = b;
    }
    out
}

fn wrap_base64(data: &[u8]) -> String {
    let b = B64.encode(data);
    let mut out = String::with_capacity(b.len() + b.len() / 76 * 2 + 2);
    for chunk in b.as_bytes().chunks(76) {
        out.push_str(std::str::from_utf8(chunk).expect("base64 is ascii"));
        out.push_str("\r\n");
    }
    out
}

fn decode_body(lines: &[String], body: &[u8]) -> Result<Vec<u8>> {
    let cte = header(lines, "Content-Transfer-Encoding").unwrap_or("7bit").to_ascii_lowercase();
    if cte == "base64" {
        let clean: Vec<u8> = body.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
        B64.decode(clean).map_err(|e| Error::Format(format!("base64: {e}")))
    } else {
        Ok(body.to_vec())
    }
}

fn entity(lines: &[String], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for l in lines {
        out.extend_from_slice(l.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(body);
    out
}

fn boundary() -> String {
    use rand_core::RngCore;
    let mut b = [0u8; 12];
    rand_core::OsRng.fill_bytes(&mut b);
    format!("----=_ondura_smime_{}", crate::cert::hex(&b))
}

/// Sign and/or encrypt a complete RFC 5322 message. Encryption is for
/// `recipients` (include the sender to keep a readable copy).
pub fn protect(raw: &[u8], signer: Option<&Identity>, recipients: &[Certificate], now: DateTime<Utc>) -> Result<Vec<u8>> {
    let raw = crlf(raw);
    let (lines, body) = split(&raw);
    let (content, outer): (Vec<String>, Vec<String>) = lines.into_iter().partition(|l| is_content_header(l));
    let outer: Vec<String> = outer.into_iter().filter(|l| !l.to_ascii_lowercase().starts_with("mime-version:")).collect();
    let mut inner = entity(&content, body);
    if let Some(id) = signer {
        let signature = cms::sign(&inner, &id.key, &id.chain, now)?;
        let b = boundary();
        let mut signed = format!(
            "Content-Type: multipart/signed; protocol=\"application/pkcs7-signature\"; micalg=sha-256;\r\n boundary=\"{b}\"\r\n\r\nThis is a cryptographically signed message in MIME format.\r\n\r\n--{b}\r\n"
        )
        .into_bytes();
        signed.extend_from_slice(&inner);
        // This CRLF belongs to the delimiter, not to the signed content.
        signed.extend_from_slice(b"\r\n");
        signed.extend_from_slice(
            format!(
                "--{b}\r\nContent-Type: application/pkcs7-signature; name=\"smime.p7s\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"smime.p7s\"\r\nContent-Description: S/MIME Cryptographic Signature\r\n\r\n{}--{b}--\r\n",
                wrap_base64(&signature)
            )
            .as_bytes(),
        );
        inner = signed;
    }
    if !recipients.is_empty() {
        let enveloped = cms::encrypt(&inner, recipients)?;
        inner = format!(
            "Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name=\"smime.p7m\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"smime.p7m\"\r\nContent-Description: S/MIME Encrypted Message\r\n\r\n{}",
            wrap_base64(&enveloped)
        )
        .into_bytes();
    }
    let mut out = Vec::new();
    for l in &outer {
        out.extend_from_slice(l.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"MIME-Version: 1.0\r\n");
    out.extend_from_slice(&inner);
    Ok(out)
}

/// `true` if the top-level content type is an S/MIME type.
pub fn is_protected(raw: &[u8]) -> bool {
    let (lines, _) = split(raw);
    let ct = header(&lines, "Content-Type").map(media_type).unwrap_or_default();
    ct == "multipart/signed" && header(&lines, "Content-Type").and_then(|v| param(v, "protocol")).is_some_and(|p| p.to_ascii_lowercase().contains("pkcs7-signature"))
        || ct == "application/pkcs7-mime"
        || ct == "application/x-pkcs7-mime"
}

/// The signed content and signature of a multipart/signed body.
fn signed_parts(body: &[u8], boundary: &str) -> Option<(Vec<u8>, Vec<String>, Vec<u8>)> {
    let delim = format!("--{boundary}");
    let find = |from: usize| -> Option<usize> {
        let mut i = from;
        while i + delim.len() <= body.len() {
            if body[i..].starts_with(delim.as_bytes()) && (i == 0 || body[i - 1] == b'\n') {
                return Some(i);
            }
            i += 1;
        }
        None
    };
    let first = find(0)?;
    let start = first + delim.len() + body[first + delim.len()..].iter().position(|b| *b == b'\n')? + 1;
    let second = find(start)?;
    // The CRLF before the boundary belongs to the delimiter.
    let mut end = second;
    if end > start && body[end - 1] == b'\n' {
        end -= 1;
        if end > start && body[end - 1] == b'\r' {
            end -= 1;
        }
    }
    let content = body[start..end].to_vec();
    let sig_start = second + delim.len() + body[second + delim.len()..].iter().position(|b| *b == b'\n')? + 1;
    let sig_end = find(sig_start).unwrap_or(body.len());
    let (sig_lines, sig_body) = split(&body[sig_start..sig_end]);
    Some((content, sig_lines.clone(), decode_body(&sig_lines, sig_body).ok()?))
}

fn signature_info(check: cms::SignatureCheck) -> SignatureInfo {
    let c = check.signer.as_ref();
    SignatureInfo {
        valid: check.valid && check.problem.is_none(),
        trusted: check.trust == Trust::Trusted,
        signer_name: c.map(|c| c.subject_name.clone()).unwrap_or_default(),
        signer_emails: c.map(|c| c.emails.clone()).unwrap_or_default(),
        issuer: c.map(|c| c.issuer_name.clone()).unwrap_or_default(),
        not_after: c.map(|c| c.not_after),
        signing_time: check.signing_time,
        problem: check.problem,
        fingerprint: c.map(|c| c.fingerprint()),
        certificate: c.map(|c| c.der.clone()),
    }
}

/// Remove the S/MIME layers of a received message: decrypt with one of
/// `identities` and check signatures. `None` if it is not S/MIME.
pub fn unprotect(raw: &[u8], identities: &[Identity], pool: &[Certificate], trusted: &[String]) -> Option<Unprotected> {
    if !is_protected(raw) {
        return None;
    }
    let (lines, body) = split(raw);
    let outer: Vec<String> = lines.iter().filter(|l| !is_content_header(l)).cloned().collect();
    let mut current = entity(&lines.iter().filter(|l| is_content_header(l)).cloned().collect::<Vec<_>>(), body);
    let mut info = SecurityInfo::default();
    let keys: Vec<(&rsa::RsaPrivateKey, &Certificate)> = identities.iter().filter_map(|i| Some((&i.key, i.chain.first()?))).collect();
    for _ in 0..4 {
        let (l, b) = split(&current);
        let ct_value = header(&l, "Content-Type").unwrap_or("text/plain").to_string();
        let ct = media_type(&ct_value);
        if ct == "application/pkcs7-mime" || ct == "application/x-pkcs7-mime" {
            let Ok(der) = decode_body(&l, b) else { break };
            let smime_type = param(&ct_value, "smime-type").unwrap_or_default().to_ascii_lowercase();
            if smime_type == "enveloped-data" || (smime_type.is_empty() && cms::is_enveloped(&der)) {
                info.encrypted = true;
                match cms::decrypt(&der, &keys) {
                    Ok(inner) => current = crlf(&inner),
                    Err(Error::NoKey) => {
                        info.decrypt_error = Some(if keys.is_empty() {
                            ondura_i18n::tr!("Die Nachricht ist verschlüsselt. Importieren Sie Ihr S/MIME-Zertifikat (Einstellungen › Konten › S/MIME), um sie zu lesen.")
                        } else {
                            ondura_i18n::tr!("Die Nachricht ist für ein anderes Zertifikat verschlüsselt.")
                        });
                        break;
                    }
                    Err(e) => {
                        info.decrypt_error = Some(e.to_string());
                        break;
                    }
                }
            } else {
                match cms::verify(&der, None, pool, trusted) {
                    Ok((check, content)) => {
                        info.signature = Some(signature_info(check));
                        current = crlf(&content);
                    }
                    Err(_) => break,
                }
            }
        } else if ct == "multipart/signed" {
            let Some(boundary) = param(&ct_value, "boundary") else { break };
            let Some((content, _, sig)) = signed_parts(b, &boundary) else { break };
            let mut result = cms::verify(&sig, Some(&content), pool, trusted);
            // Stored messages may have lost their CRLFs.
            if result.as_ref().is_ok_and(|(c, _)| !c.valid) {
                let normalised = crlf(&content);
                if normalised != content
                    && let Ok(again) = cms::verify(&sig, Some(&normalised), pool, trusted)
                    && again.0.valid
                {
                    result = Ok(again);
                }
            }
            match result {
                Ok((check, _)) => info.signature = Some(signature_info(check)),
                Err(e) => {
                    info.signature = Some(SignatureInfo {
                        valid: false,
                        trusted: false,
                        signer_name: String::new(),
                        signer_emails: Vec::new(),
                        issuer: String::new(),
                        not_after: None,
                        signing_time: None,
                        problem: Some(ondura_i18n::tr!("Signatur nicht lesbar: {0}", e)),
                        fingerprint: None,
                        certificate: None,
                    })
                }
            }
            current = content;
        } else {
            break;
        }
    }
    let mut out = Vec::new();
    for l in &outer {
        out.extend_from_slice(l.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(&current);
    Some(Unprotected { raw: out, info })
}
