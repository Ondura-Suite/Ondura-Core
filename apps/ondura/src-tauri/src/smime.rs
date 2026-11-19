//! S/MIME certificates: import of own identities (PKCS#12), the list of
//! known certificates of other people, and loading both into the keyring
//! of `ondura_mail_core::smime` at startup.
//!
//! Private keys live in the secret store (`smime-key:<fingerprint>`), the
//! certificate chains in the settings table.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ondura_mail_core::smime::{self as keyring, CertInfo, Certificate, Identity};
use ondura_mail_core::sync::KNOWN_CERTS_KEY;
use ondura_mail_core::{SecretStore, Store};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

const IDENTITIES_KEY: &str = "smime.identities";
const TRUSTED_KEY: &str = "smime.trusted";

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredIdentity {
    fingerprint: String,
    /// Base64 DER, own certificate first.
    chain: Vec<String>,
}

fn key_name(fingerprint: &str) -> String {
    format!("smime-key:{fingerprint}")
}

fn stored(store: &Store) -> Vec<StoredIdentity> {
    store.setting(IDENTITIES_KEY).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

fn json_list(store: &Store, key: &str) -> Vec<String> {
    store.setting(key).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

/// Fill the process-wide keyring from the store (startup and changes).
pub fn load(store: &Store, secrets: &dyn SecretStore) {
    let mut identities = Vec::new();
    for s in stored(store) {
        let Ok(Some(key)) = secrets.get(&key_name(&s.fingerprint)) else { continue };
        let (Ok(key), Ok(chain)) = (B64.decode(key), s.chain.iter().map(|c| B64.decode(c)).collect::<Result<Vec<_>, _>>()) else { continue };
        match Identity::new(&key, &chain) {
            Ok(id) => identities.push(id),
            Err(e) => tracing::warn!(error = %e, "could not load S/MIME identity"),
        }
    }
    keyring::set_identities(identities);
    for der in json_list(store, KNOWN_CERTS_KEY) {
        if let Ok(cert) = B64.decode(der).map_err(|e| e.to_string()).and_then(|d| Certificate::from_der(&d).map_err(|e| e.to_string())) {
            keyring::add_known(cert);
        }
    }
    keyring::set_trusted(json_list(store, TRUSTED_KEY));
}

/// An own certificate as shown in the settings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmimeIdentity {
    #[serde(flatten)]
    info: CertInfo,
    /// The certificate chains up to a known root.
    trusted: bool,
}

#[tauri::command]
pub fn smime_identities(state: State<'_, AppState>) -> Vec<SmimeIdentity> {
    let trusted = json_list(state.store(), TRUSTED_KEY);
    stored(state.store())
        .iter()
        .filter_map(|s| {
            let chain: Vec<Certificate> = s.chain.iter().filter_map(|c| B64.decode(c).ok()).filter_map(|d| Certificate::from_der(&d).ok()).collect();
            let leaf = chain.first()?;
            Some(SmimeIdentity { info: leaf.info(), trusted: ondura_smime::cert::chain_trust(leaf, &chain, &trusted) == ondura_smime::Trust::Trusted })
        })
        .collect()
}

/// Import a .p12/.pfx file (base64) with its password.
#[tauri::command]
pub fn smime_import(state: State<'_, AppState>, data: String, password: String, any_purpose: Option<bool>) -> CmdResult<CertInfo> {
    let bytes = B64.decode(data.trim()).map_err(|e| e.to_string())?;
    let id = Identity::from_pkcs12(&bytes, &password).map_err(|e| match e {
        ondura_smime::Error::Crypto(_) => ondura_i18n::tr!("Falsches Passwort oder beschädigte Datei").to_string(),
        other => other.to_string(),
    })?;
    let cert = id.certificate();
    // Certificates without an address can still sign PDF documents.
    if cert.emails.is_empty() && !any_purpose.unwrap_or(false) {
        return Err(ondura_i18n::tr!("Das Zertifikat enthält keine E-Mail-Adresse und eignet sich nicht für S/MIME"));
    }
    let fingerprint = cert.fingerprint();
    state.secrets.set(&key_name(&fingerprint), &B64.encode(id.key_pkcs8())).map_err(|e| e.to_string())?;
    let mut list = stored(state.store());
    list.retain(|s| s.fingerprint != fingerprint);
    list.push(StoredIdentity { fingerprint, chain: id.chain.iter().map(|c| B64.encode(&c.der)).collect() });
    state.store().set_setting(IDENTITIES_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let info = cert.info();
    load(state.store(), state.secrets.as_ref());
    Ok(info)
}

#[tauri::command]
pub fn smime_remove(state: State<'_, AppState>, fingerprint: String) -> CmdResult<()> {
    let mut list = stored(state.store());
    list.retain(|s| s.fingerprint != fingerprint);
    state.store().set_setting(IDENTITIES_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let _ = state.secrets.delete(&key_name(&fingerprint));
    load(state.store(), state.secrets.as_ref());
    Ok(())
}

/// Trust a signer's certificate (or CA) that does not chain to a known root.
#[tauri::command]
pub fn smime_trust(state: State<'_, AppState>, fingerprint: String) -> CmdResult<()> {
    let mut list = json_list(state.store(), TRUSTED_KEY);
    if !list.iter().any(|f| f.eq_ignore_ascii_case(&fingerprint)) {
        list.push(fingerprint);
    }
    state.store().set_setting(TRUSTED_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    keyring::set_trusted(list);
    Ok(())
}

/// Which of the addresses have no certificate (encryption impossible).
#[tauri::command]
pub fn smime_missing(emails: Vec<String>) -> Vec<String> {
    keyring::missing_certificates(&emails)
}

/// Whether an own certificate exists for the address (signing possible).
#[tauri::command]
pub fn smime_can_sign(email: String) -> bool {
    keyring::identity_for(&email).is_some()
}

// ------------------------------------------------------------ PDF signing --

/// An own identity by certificate fingerprint, loaded from the store.
fn identity(state: &AppState, fingerprint: &str) -> CmdResult<Identity> {
    let s = stored(state.store()).into_iter().find(|s| s.fingerprint == fingerprint).ok_or_else(|| ondura_i18n::tr!("Zertifikat nicht gefunden"))?;
    let key = state.secrets.get(&key_name(fingerprint)).map_err(|e| e.to_string())?.ok_or_else(|| ondura_i18n::tr!("Der private Schlüssel des Zertifikats fehlt"))?;
    let key = B64.decode(key).map_err(|e| e.to_string())?;
    let chain = s.chain.iter().map(|c| B64.decode(c)).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Identity::new(&key, &chain).map_err(|e| e.to_string())
}

/// CMS signature (`adbe.pkcs7.detached`, SHA-256) over the signed byte
/// ranges of a PDF, as base64 DER. The PDF app embeds it in `/Contents`.
#[tauri::command]
pub fn pdf_sign(state: State<'_, AppState>, fingerprint: String, data: String) -> CmdResult<String> {
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    let id = identity(&state, &fingerprint)?;
    let cms = ondura_smime::cms::sign(&bytes, &id.key, &id.chain, chrono::Utc::now()).map_err(|e| e.to_string())?;
    Ok(B64.encode(cms))
}

/// Result of checking one PDF signature.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSignatureCheck {
    valid: bool,
    trusted: bool,
    signer: Option<CertInfo>,
    signing_time: Option<String>,
    problem: Option<String>,
}

/// Checks a PDF signature: `contents` is the CMS from `/Contents`, `signed`
/// the bytes its `/ByteRange` covers (both base64).
#[tauri::command]
pub fn pdf_verify(state: State<'_, AppState>, contents: String, signed: String) -> CmdResult<PdfSignatureCheck> {
    let cms = B64.decode(contents.as_bytes()).map_err(|e| e.to_string())?;
    let data = B64.decode(signed.as_bytes()).map_err(|e| e.to_string())?;
    let pool: Vec<Certificate> = keyring::known_der().iter().filter_map(|d| Certificate::from_der(d).ok()).collect();
    let trusted = json_list(state.store(), TRUSTED_KEY);
    match ondura_smime::cms::verify(&cms, Some(&data), &pool, &trusted) {
        Ok((check, _)) => Ok(PdfSignatureCheck {
            valid: check.valid,
            trusted: check.trust == ondura_smime::Trust::Trusted,
            signer: check.signer.as_ref().map(|c| c.info()),
            signing_time: check.signing_time.map(|t| t.to_rfc3339()),
            problem: check.problem,
        }),
        Err(e) => Ok(PdfSignatureCheck { valid: false, trusted: false, signer: None, signing_time: None, problem: Some(e.to_string()) }),
    }
}
