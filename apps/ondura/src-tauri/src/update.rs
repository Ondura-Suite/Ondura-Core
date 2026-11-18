//! Updates from the GitHub releases of Ondura-Suite/Ondura-Core.
//!
//! The newest release is looked up through the GitHub API. Every release
//! asset comes with a minisign signature (`<asset>.sig`, made by
//! `tauri signer sign` in CI); the public key is compiled in from
//! `ONDURA_UPDATE_PUBKEY`. A download is only installed when its signature
//! verifies, so a tampered file is never run.
//!
//! Installation:
//! * Windows: the NSIS installer runs elevated (UAC prompt) with `/P /UPDATE /R`
//!   – passive, keeps the chosen apps, starts Ondura again.
//! * Linux AppImage: the file replaces the running AppImage.
//! * Linux .deb/.rpm: `pkexec dpkg -i` / `pkexec rpm -U` (password prompt).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const REPO: &str = "Ondura-Suite/Ondura-Core";
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const PUBKEY: Option<&str> = option_env!("ONDURA_UPDATE_PUBKEY");

type CmdResult<T> = Result<T, String>;

/// A newer release than the running version.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
    pub published: String,
    /// Release page (for reading the notes or a manual download).
    pub page: String,
    pub asset: Option<Asset>,
    /// Why this installation cannot update itself (manual download instead).
    pub manual_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sig_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    WindowsNsis,
    AppImage,
    Deb,
    Rpm,
    Unknown,
}

fn install_kind() -> Kind {
    if cfg!(windows) {
        return Kind::WindowsNsis;
    }
    if std::env::var_os("APPIMAGE").is_some() {
        return Kind::AppImage;
    }
    if Path::new("/var/lib/dpkg/info/ondura.list").exists() {
        return Kind::Deb;
    }
    if std::process::Command::new("rpm").args(["-q", "ondura"]).output().is_ok_and(|o| o.status.success()) {
        return Kind::Rpm;
    }
    Kind::Unknown
}

/// `1.2.10` → [1, 2, 10]; pre-release suffixes are ignored.
fn parse_version(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches('v').split(['-', '+']).next().unwrap_or("").split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

fn newer(candidate: &str, current: &str) -> bool {
    let (a, b) = (parse_version(candidate), parse_version(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

fn client(timeout: Option<Duration>) -> reqwest::Client {
    let mut tls = (*ondura_mail_core::net::tls_client_config()).clone();
    tls.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    let mut b = reqwest::Client::builder().tls_backend_preconfigured(tls).user_agent(concat!("Ondura/", env!("CARGO_PKG_VERSION"))).connect_timeout(Duration::from_secs(20));
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    b.build().expect("reqwest client")
}

#[derive(serde::Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(serde::Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    assets: Vec<GhAsset>,
}

fn pick_asset(kind: Kind, assets: &[GhAsset]) -> Option<&GhAsset> {
    let ends = |a: &&GhAsset, suffix: &str| a.name.to_ascii_lowercase().ends_with(suffix);
    match kind {
        // The NSIS installer of the app, not the "Ondura Setup" wrapper.
        Kind::WindowsNsis => assets.iter().find(|a| ends(a, "-setup.exe")),
        Kind::AppImage => assets.iter().find(|a| ends(a, ".appimage")),
        Kind::Deb => assets.iter().find(|a| ends(a, ".deb")),
        Kind::Rpm => assets.iter().find(|a| ends(a, ".rpm")),
        Kind::Unknown => None,
    }
}

/// Newest release, if it is newer than this version.
#[tauri::command]
pub async fn update_check() -> CmdResult<Option<UpdateInfo>> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp = client(Some(Duration::from_secs(30))).get(&url).header("Accept", "application/vnd.github+json").send().await.map_err(|e| format!("Die Update-Prüfung ist fehlgeschlagen: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None); // no release yet
    }
    if !resp.status().is_success() {
        return Err(format!("Die Update-Prüfung ist fehlgeschlagen (HTTP {}).", resp.status().as_u16()));
    }
    let rel: GhRelease = resp.json().await.map_err(|e| format!("Unerwartete Antwort von GitHub: {e}"))?;
    if rel.draft || rel.prerelease || !newer(&rel.tag_name, CURRENT) {
        return Ok(None);
    }
    let kind = install_kind();
    let asset = pick_asset(kind, &rel.assets);
    let sig = asset.and_then(|a| rel.assets.iter().find(|s| s.name == format!("{}.sig", a.name)));
    let manual_reason = if PUBKEY.is_none() {
        Some("Diese Version wurde ohne Update-Schlüssel gebaut.".to_string())
    } else if kind == Kind::Unknown {
        Some("Die Installationsart wurde nicht erkannt.".to_string())
    } else if asset.is_none() {
        Some("Für dieses System gibt es in der Version keine Installationsdatei.".to_string())
    } else if sig.is_none() {
        Some("Die Installationsdatei ist nicht signiert.".to_string())
    } else {
        None
    };
    Ok(Some(UpdateInfo {
        version: rel.tag_name.trim_start_matches('v').to_string(),
        current: CURRENT.to_string(),
        notes: rel.body.unwrap_or_default(),
        published: rel.published_at.unwrap_or_default(),
        page: rel.html_url,
        asset: match (asset, sig) {
            (Some(a), Some(s)) if manual_reason.is_none() => Some(Asset { name: a.name.clone(), url: a.browser_download_url.clone(), size: a.size, sig_url: s.browser_download_url.clone() }),
            _ => None,
        },
        manual_reason,
    }))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: u64,
}

fn download_dir() -> PathBuf {
    std::env::temp_dir().join("ondura-update")
}

/// Verifies a minisign signature (both values base64-encoded as written by
/// `tauri signer`).
fn verify(pubkey_b64: &str, data: &[u8], sig_b64: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let pk_text = String::from_utf8(b64.decode(pubkey_b64.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let sig_text = String::from_utf8(b64.decode(sig_b64.trim()).map_err(|_| "Ungültige Signatur".to_string())?).map_err(|e| e.to_string())?;
    let pk = minisign_verify::PublicKey::decode(&pk_text).map_err(|e| format!("Ungültiger Update-Schlüssel: {e}"))?;
    let sig = minisign_verify::Signature::decode(&sig_text).map_err(|e| format!("Ungültige Signatur: {e}"))?;
    pk.verify(data, &sig, false).map_err(|_| "Die Signatur des Updates ist ungültig – die Datei wurde nicht installiert.".to_string())
}

/// Downloads and verifies the update; returns the path of the file.
/// Progress is reported as `update-progress` events.
#[tauri::command]
pub async fn update_download(app: AppHandle, asset: Asset) -> CmdResult<String> {
    // Only files from this repository's releases.
    let prefix = format!("https://github.com/{REPO}/releases/download/");
    if !asset.url.starts_with(&prefix) || !asset.sig_url.starts_with(&prefix) || asset.name.contains(['/', '\\']) {
        return Err("Ungültige Update-Adresse.".into());
    }
    let http = client(None);
    let sig = http.get(&asset.sig_url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("Die Signatur konnte nicht geladen werden: {e}"))?.text().await.map_err(|e| e.to_string())?;
    let mut resp = http.get(&asset.url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("Der Download ist fehlgeschlagen: {e}"))?;
    let total = resp.content_length().unwrap_or(asset.size);
    let mut data = Vec::with_capacity(total as usize);
    let mut last = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Der Download wurde unterbrochen: {e}"))? {
        data.extend_from_slice(&chunk);
        let done = data.len() as u64;
        if done - last >= 256 * 1024 || done == total {
            last = done;
            let _ = app.emit("update-progress", Progress { downloaded: done, total });
        }
    }
    verify(PUBKEY.ok_or("Diese Version wurde ohne Update-Schlüssel gebaut.")?, &data, &sig)?;
    let dir = download_dir();
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join(&asset.name);
    tokio::fs::write(&path, &data).await.map_err(|e| format!("Das Update konnte nicht gespeichert werden: {e}"))?;
    Ok(path.display().to_string())
}

/// Installs a downloaded (and verified) update and restarts Ondura.
#[tauri::command]
pub async fn update_install(app: AppHandle, path: String) -> CmdResult<()> {
    let path = PathBuf::from(path);
    // Only files written by update_download.
    if path.parent() != Some(download_dir().as_path()) || !path.exists() {
        return Err("Ungültige Update-Datei.".into());
    }
    match install_kind() {
        Kind::WindowsNsis => install_windows(&app, &path),
        Kind::AppImage => install_appimage(&app, &path),
        Kind::Deb => install_package(&app, "dpkg", &["-i"], &path),
        Kind::Rpm => install_package(&app, "rpm", &["-U", "--replacepkgs"], &path),
        Kind::Unknown => Err("Die Installationsart wurde nicht erkannt.".into()),
    }
}

#[cfg(windows)]
fn install_windows(app: &AppHandle, path: &Path) -> CmdResult<()> {
    use windows_sys::Win32::Foundation::{ERROR_CANCELLED, GetLastError};
    use windows_sys::Win32::UI::Shell::{SHELLEXECUTEINFOW, ShellExecuteExW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (verb, file, params) = (wide("runas"), wide(&path.display().to_string()), wide("/P /UPDATE /R"));
    // SAFETY: plain data struct; the buffers outlive the call.
    let ok = unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_SHOWNORMAL;
        ShellExecuteExW(&mut info) != 0
    };
    if !ok {
        // SAFETY: reads the thread's last error.
        let cancelled = unsafe { GetLastError() } == ERROR_CANCELLED;
        return Err(if cancelled { "Die Installation wurde abgebrochen (keine Administratorrechte erteilt).".into() } else { std::io::Error::last_os_error().to_string() });
    }
    // The installer closes Ondura itself; quit now so files can be replaced.
    crate::request_quit(app);
    Ok(())
}

#[cfg(not(windows))]
fn install_windows(_: &AppHandle, _: &Path) -> CmdResult<()> {
    Err("Nur unter Windows verfügbar.".into())
}

fn relaunch(app: &AppHandle, exe: &Path) {
    let _ = std::process::Command::new(exe).spawn();
    crate::request_quit(app);
}

fn install_appimage(app: &AppHandle, path: &Path) -> CmdResult<()> {
    let target = PathBuf::from(std::env::var_os("APPIMAGE").ok_or("Kein AppImage")?);
    let tmp = target.with_extension("ondura-update");
    std::fs::copy(path, &tmp).map_err(|e| format!("Das AppImage kann nicht ersetzt werden (Schreibrechte?): {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    relaunch(app, &target);
    Ok(())
}

fn install_package(app: &AppHandle, tool: &str, args: &[&str], path: &Path) -> CmdResult<()> {
    let status = std::process::Command::new("pkexec")
        .arg(tool)
        .args(args)
        .arg(path)
        .status()
        .map_err(|e| format!("pkexec ist nicht verfügbar ({e}). Bitte installieren Sie {} manuell.", path.display()))?;
    match status.code() {
        Some(0) => {
            relaunch(app, Path::new("/usr/bin/ondura"));
            Ok(())
        }
        Some(126) => Err("Die Installation wurde abgebrochen (keine Berechtigung erteilt).".into()),
        _ => Err(format!("Die Installation ist fehlgeschlagen ({tool}).")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(newer("v0.2.0", "0.1.9"));
        assert!(newer("1.0.10", "1.0.9"));
        assert!(!newer("v0.1.0", "0.1.0"));
        assert!(!newer("0.1.0-beta", "0.1.0"));
    }

    /// Key pair made with `tauri signer generate` only for this test.
    const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEY5OTA4MUNBNjFGNjZBNjUKUldSbGF2Wmh5b0dRK1JvakhSRWFWZ2NKM0wwMUNsM2NNc1FMTmc2NDdYdFF5WUZ3ckYyTG5YZEwK";
    const TEST_SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSbGF2Wmh5b0dRK2RiMnZ1bXJ4TFZkSFVoSStaZWVyVDcxcis5clhtRVhULzNjUzM5ZUNxQzNQeXEzajQyaENvcFdtdjlUSFBTSGVFVWJKcFZtMmQ1VXBDSUpZeDJETXdVPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0OTkzOTQzCWZpbGU6cGF5bG9hZC5iaW4KVStFNDJSamdQcUIveEtHVjFKZENCRUhmQlN0TW9jZzVmU3d2OXFRUjUwcXVRdkNYZFhwL3R3Q1ZvbnkyK2RLOTg3bnByVXpLcFRKNVN1WVMzYUZQRHc9PQo=";

    #[test]
    fn signatures() {
        let data = b"Nexora update test payload\n";
        assert!(verify(TEST_PUBKEY, data, TEST_SIG).is_ok());
        assert!(verify(TEST_PUBKEY, b"tampered", TEST_SIG).is_err());
    }
}
