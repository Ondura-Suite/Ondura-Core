//! Updates from the GitHub releases of Ondura-Suite/Ondura-Core.
//!
//! The newest release is looked up through the GitHub API. Every release
//! asset comes with a minisign signature (`<asset>.sig`, made by
//! `tauri signer sign` in CI); the public key is compiled in from
//! `ONDURA_UPDATE_PUBKEY`. A download is only installed when its signature
//! verifies, so a tampered file is never run.
//!
//! Updates are downloaded in the background and installed by Ondura itself,
//! without an installer window or password prompt ("Neu starten"):
//! * Windows: the "Ondura Update" service (installed with Ondura, runs as
//!   LocalSystem, may be started by every user) checks the signature again
//!   and runs the NSIS installer silently (`/S /UPDATE`); see
//!   `update_helper.rs`. Ondura starts again once the new version is in
//!   place. Without the service (older installs) the installer runs
//!   silently after a UAC prompt.
//! * Linux .deb/.rpm: a request file in `/var/lib/ondura/updates` starts the
//!   systemd unit `ondura-update.service` (root) through
//!   `ondura-update.path`; it verifies and installs the package. Without the
//!   unit, `pkexec dpkg -i` / `pkexec rpm -U` is used.
//! * Linux AppImage: the file replaces the running AppImage.
//! * macOS: `Ondura.app.tar.gz` replaces the installed bundle (an admin
//!   password is asked for only if its folder isn't writable).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const REPO: &str = "Ondura-Suite/Ondura-Core";
pub(crate) const CURRENT: &str = env!("CARGO_PKG_VERSION");
pub(crate) const PUBKEY: Option<&str> = option_env!("ONDURA_UPDATE_PUBKEY");

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
    MacApp,
    AppImage,
    Deb,
    Rpm,
    Unknown,
}

fn install_kind() -> Kind {
    if cfg!(windows) {
        return Kind::WindowsNsis;
    }
    if cfg!(target_os = "macos") {
        return if mac_bundle().is_some() { Kind::MacApp } else { Kind::Unknown };
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
pub(crate) fn parse_version(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches('v').split(['-', '+']).next().unwrap_or("").split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

pub(crate) fn newer(candidate: &str, current: &str) -> bool {
    let (a, b) = (parse_version(candidate), parse_version(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

pub(crate) fn client(timeout: Option<Duration>) -> reqwest::Client {
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
        Kind::WindowsNsis => assets.iter().find(|a| ends(a, "_silentinstall.exe")).or_else(|| assets.iter().find(|a| ends(a, "-setup.exe"))),
        Kind::MacApp => assets.iter().find(|a| ends(a, ".app.tar.gz")),
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
    let resp = client(Some(Duration::from_secs(30))).get(&url).header("Accept", "application/vnd.github+json").send().await.map_err(|e| ondura_i18n::tr!("Die Update-Prüfung ist fehlgeschlagen: {0}", e))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None); // no release yet
    }
    if !resp.status().is_success() {
        return Err(ondura_i18n::tr!("Die Update-Prüfung ist fehlgeschlagen (HTTP {0}).", resp.status().as_u16()));
    }
    let rel: GhRelease = resp.json().await.map_err(|e| ondura_i18n::tr!("Unerwartete Antwort von GitHub: {0}", e))?;
    if rel.draft || rel.prerelease || !newer(&rel.tag_name, CURRENT) {
        return Ok(None);
    }
    let kind = install_kind();
    let asset = pick_asset(kind, &rel.assets);
    let sig = asset.and_then(|a| rel.assets.iter().find(|s| s.name == format!("{}.sig", a.name)));
    let manual_reason = if PUBKEY.is_none() {
        Some(ondura_i18n::tr!("Diese Version wurde ohne Update-Schlüssel gebaut.").to_string())
    } else if kind == Kind::Unknown {
        Some(ondura_i18n::tr!("Die Installationsart wurde nicht erkannt.").to_string())
    } else if asset.is_none() {
        Some(ondura_i18n::tr!("Für dieses System gibt es in der Version keine Installationsdatei.").to_string())
    } else if sig.is_none() {
        Some(ondura_i18n::tr!("Die Installationsdatei ist nicht signiert.").to_string())
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
pub(crate) fn verify(pubkey_b64: &str, data: &[u8], sig_b64: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let pk_text = String::from_utf8(b64.decode(pubkey_b64.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let sig_text = String::from_utf8(b64.decode(sig_b64.trim()).map_err(|_| ondura_i18n::tr!("Ungültige Signatur").to_string())?).map_err(|e| e.to_string())?;
    let pk = minisign_verify::PublicKey::decode(&pk_text).map_err(|e| ondura_i18n::tr!("Ungültiger Update-Schlüssel: {0}", e))?;
    let sig = minisign_verify::Signature::decode(&sig_text).map_err(|e| ondura_i18n::tr!("Ungültige Signatur: {0}", e))?;
    pk.verify(data, &sig, false).map_err(|_| ondura_i18n::tr!("Die Signatur des Updates ist ungültig – die Datei wurde nicht installiert.").to_string())
}

/// Downloads and verifies the update; returns the path of the file.
/// Progress is reported as `update-progress` events.
#[tauri::command]
pub async fn update_download(app: AppHandle, asset: Asset) -> CmdResult<String> {
    // Only files from this repository's releases.
    let prefix = format!("https://github.com/{REPO}/releases/download/");
    if !asset.url.starts_with(&prefix) || !asset.sig_url.starts_with(&prefix) || asset.name.contains(['/', '\\']) {
        return Err(ondura_i18n::tr!("Ungültige Update-Adresse."));
    }
    // Several windows may ask at once; download only once.
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = LOCK.lock().await;
    let dir = download_dir();
    let path = dir.join(&asset.name);
    let sig_path = dir.join(format!("{}.sig", asset.name));
    if let (Ok(data), Ok(sig), Some(key)) = (tokio::fs::read(&path).await, tokio::fs::read_to_string(&sig_path).await, PUBKEY)
        && verify(key, &data, &sig).is_ok()
    {
        let _ = app.emit("update-progress", Progress { downloaded: data.len() as u64, total: data.len() as u64 });
        return Ok(path.display().to_string());
    }
    let http = client(None);
    let sig = http.get(&asset.sig_url).send().await.and_then(|r| r.error_for_status()).map_err(|e| ondura_i18n::tr!("Die Signatur konnte nicht geladen werden: {0}", e))?.text().await.map_err(|e| e.to_string())?;
    let mut resp = http.get(&asset.url).send().await.and_then(|r| r.error_for_status()).map_err(|e| ondura_i18n::tr!("Der Download ist fehlgeschlagen: {0}", e))?;
    let total = resp.content_length().unwrap_or(asset.size);
    let mut data = Vec::with_capacity(total as usize);
    let mut last = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| ondura_i18n::tr!("Der Download wurde unterbrochen: {0}", e))? {
        data.extend_from_slice(&chunk);
        let done = data.len() as u64;
        if done - last >= 256 * 1024 || done == total {
            last = done;
            let _ = app.emit("update-progress", Progress { downloaded: done, total });
        }
    }
    verify(PUBKEY.ok_or_else(|| ondura_i18n::tr!("Diese Version wurde ohne Update-Schlüssel gebaut."))?, &data, &sig)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &data).await.map_err(|e| ondura_i18n::tr!("Das Update konnte nicht gespeichert werden: {0}", e))?;
    // The privileged helper checks the signature again.
    tokio::fs::write(&sig_path, &sig).await.map_err(|e| ondura_i18n::tr!("Das Update konnte nicht gespeichert werden: {0}", e))?;
    Ok(path.display().to_string())
}

/// A verified update waiting to be installed when Ondura is quit or its last
/// window is closed (Windows: silently via the update service).
static PENDING: std::sync::Mutex<Option<(PathBuf, String)>> = std::sync::Mutex::new(None);

fn valid_download(path: &Path, version: &str) -> CmdResult<()> {
    // Only files written by update_download.
    if path.parent() != Some(download_dir().as_path()) || !path.exists() {
        return Err(ondura_i18n::tr!("Ungültige Update-Datei."));
    }
    if !newer(version, CURRENT) {
        return Err(ondura_i18n::tr!("Diese Version ist bereits installiert."));
    }
    Ok(())
}

/// Marks a downloaded update for automatic installation. Returns whether
/// this platform installs it by itself (Windows); elsewhere the user
/// restarts from the update dialog.
#[tauri::command]
pub fn update_schedule(path: String, version: String) -> CmdResult<bool> {
    let path = PathBuf::from(path);
    valid_download(&path, &version)?;
    if install_kind() != Kind::WindowsNsis {
        return Ok(false);
    }
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some((path, version));
    Ok(true)
}

/// Installs a scheduled update now, without asking: on quit (`relaunch`
/// false) or when the last window was closed while Ondura keeps running in
/// the tray (`relaunch` true: it comes back in the tray, without a window).
pub fn install_pending(app: &AppHandle, relaunch: bool) -> bool {
    let Some((path, version)) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).take() else { return false };
    if valid_download(&path, &version).is_err() {
        return false;
    }
    #[cfg(windows)]
    {
        // Without the service a UAC prompt would appear out of nowhere;
        // then the update waits for the dialog instead.
        if let Err(e) = crate::update_helper::start_service(&path) {
            tracing::warn!(error = %e, "automatic update: service unavailable");
            return false;
        }
        // On quit the app is already ending; from the tray it ends here and
        // comes back once the new version is in place.
        if relaunch {
            if let Ok(exe) = std::env::current_exe() {
                let _ = crate::update_helper::relaunch_when_installed_with(&exe, &version, &["--tray"]);
            }
            crate::request_quit(app);
        }
        true
    }
    #[cfg(not(windows))]
    {
        let _ = (app, relaunch);
        false
    }
}

/// Installs a downloaded (and verified) update and restarts Ondura.
/// `version` is the version being installed (to know when it is in place).
#[tauri::command]
pub async fn update_install(app: AppHandle, path: String, version: String) -> CmdResult<()> {
    let path = PathBuf::from(path);
    valid_download(&path, &version)?;
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).take();
    let _ = app.emit("update-installing", ());
    match install_kind() {
        Kind::WindowsNsis => install_windows(&app, &path, &version).await,
        Kind::MacApp => install_macos(&app, &path).await,
        Kind::AppImage => install_appimage(&app, &path),
        Kind::Deb | Kind::Rpm => install_linux_package(&app, &path, &version).await,
        Kind::Unknown => Err(ondura_i18n::tr!("Die Installationsart wurde nicht erkannt.")),
    }
}

#[cfg(windows)]
async fn install_windows(app: &AppHandle, path: &Path, version: &str) -> CmdResult<()> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let target = path.to_path_buf();
    let started = tauri::async_runtime::spawn_blocking(move || crate::update_helper::start_service(&target)).await.map_err(|e| e.to_string())?;
    match started {
        Ok(()) => {}
        // No service (installed before it existed, or removed): run the
        // installer silently after one UAC prompt.
        Err(e) => {
            tracing::warn!(error = %e, "update service unavailable, falling back to UAC");
            run_elevated(path, "/S /UPDATE")?;
        }
    }
    crate::update_helper::relaunch_when_installed(&exe, version)?;
    // The installer replaces the files; quit so nothing is locked.
    crate::request_quit(app);
    Ok(())
}

#[cfg(windows)]
fn run_elevated(path: &Path, params: &str) -> CmdResult<()> {
    use windows_sys::Win32::Foundation::{ERROR_CANCELLED, GetLastError};
    use windows_sys::Win32::UI::Shell::{SHELLEXECUTEINFOW, ShellExecuteExW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (verb, file, params) = (wide("runas"), wide(&path.display().to_string()), wide(params));
    // SAFETY: plain data struct; the buffers outlive the call.
    let ok = unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        ShellExecuteExW(&mut info) != 0
    };
    if !ok {
        // SAFETY: reads the thread's last error.
        let cancelled = unsafe { GetLastError() } == ERROR_CANCELLED;
        return Err(if cancelled { ondura_i18n::tr!("Die Installation wurde abgebrochen (keine Administratorrechte erteilt).").into() } else { std::io::Error::last_os_error().to_string() });
    }
    Ok(())
}

#[cfg(not(windows))]
async fn install_windows(_: &AppHandle, _: &Path, _: &str) -> CmdResult<()> {
    Err(ondura_i18n::tr!("Nur unter Windows verfügbar."))
}

fn relaunch(app: &AppHandle, exe: &Path) {
    let _ = std::process::Command::new(exe).spawn();
    crate::request_quit(app);
}

fn install_appimage(app: &AppHandle, path: &Path) -> CmdResult<()> {
    let target = PathBuf::from(std::env::var_os("APPIMAGE").ok_or_else(|| ondura_i18n::tr!("Kein AppImage"))?);
    let tmp = target.with_extension("ondura-update");
    std::fs::copy(path, &tmp).map_err(|e| ondura_i18n::tr!("Das AppImage kann nicht ersetzt werden (Schreibrechte?): {0}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    relaunch(app, &target);
    Ok(())
}

/// The running `Ondura.app` bundle (…/Ondura.app/Contents/MacOS/ondura).
fn mac_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// macOS: unpack `Ondura.app.tar.gz` next to the installed bundle and swap
/// the bundles; if the folder isn't writable (e.g. /Applications for a
/// standard user), macOS asks for an administrator password once.
async fn install_macos(app: &AppHandle, path: &Path) -> CmdResult<()> {
    let bundle = mac_bundle().ok_or_else(|| ondura_i18n::tr!("Die Installationsart wurde nicht erkannt."))?;
    let staging = std::env::temp_dir().join(format!("ondura-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let unpacked = std::process::Command::new("/usr/bin/tar").arg("-xzf").arg(path).arg("-C").arg(&staging).status().map_err(|e| e.to_string())?;
    let new_app = std::fs::read_dir(&staging)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|x| x == "app"));
    let Some(new_app) = new_app.filter(|_| unpacked.success()) else {
        return Err(ondura_i18n::tr!("Ungültige Update-Datei."));
    };
    let q = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "'\\''"));
    let old = bundle.with_extension("app.old");
    // ditto keeps permissions, symlinks and signatures; the old bundle is
    // removed only after the new one is in place.
    let script = format!(
        "rm -rf {old} && /usr/bin/ditto {new} {tmp} && mv {bundle} {old} && mv {tmp} {bundle} && rm -rf {old}",
        old = q(&old),
        new = q(&new_app),
        tmp = q(&bundle.with_extension("app.new")),
        bundle = q(&bundle),
    );
    let writable = bundle.parent().and_then(|d| tempfile_in(d).ok()).is_some();
    let status = if writable {
        std::process::Command::new("/bin/sh").arg("-c").arg(&script).status()
    } else {
        let escaped = script.replace('\\', "\\\\").replace('"', "\\\"");
        std::process::Command::new("/usr/bin/osascript").arg("-e").arg(format!("do shell script \"{escaped}\" with administrator privileges")).status()
    }
    .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&staging);
    if !status.success() {
        return Err(if writable { ondura_i18n::tr!("Die Installation ist fehlgeschlagen ({0}).", "ditto") } else { ondura_i18n::tr!("Die Installation wurde abgebrochen (keine Berechtigung erteilt).") });
    }
    // Start the new bundle once this process has quit.
    let _ = std::process::Command::new("/bin/sh").arg("-c").arg(format!("sleep 1; /usr/bin/open {}", q(&bundle))).spawn();
    crate::request_quit(app);
    Ok(())
}

/// Checks whether a folder is writable by creating (and removing) a file.
fn tempfile_in(dir: &Path) -> std::io::Result<()> {
    let probe = dir.join(format!(".ondura-write-test-{}", std::process::id()));
    std::fs::write(&probe, b"")?;
    std::fs::remove_file(probe)
}

/// .deb/.rpm: hand the package to the root helper, or ask with pkexec.
async fn install_linux_package(app: &AppHandle, path: &Path, version: &str) -> CmdResult<()> {
    #[cfg(target_os = "linux")]
    if crate::update_helper::linux_helper_available() {
        crate::update_helper::request_linux_update(path).map_err(|e| ondura_i18n::tr!("Das Update konnte nicht übergeben werden: {0}", e))?;
        crate::update_helper::wait_linux_update(version).await?;
        relaunch(app, Path::new("/usr/bin/ondura"));
        return Ok(());
    }
    let (tool, args): (&str, &[&str]) = if install_kind() == Kind::Deb { ("dpkg", &["-i"]) } else { ("rpm", &["-U", "--replacepkgs"]) };
    let status = std::process::Command::new("pkexec")
        .arg(tool)
        .args(args)
        .arg(path)
        .status()
        .map_err(|e| ondura_i18n::tr!("pkexec ist nicht verfügbar ({0}). Bitte installieren Sie {1} manuell.", e, path.display()))?;
    let _ = version;
    match status.code() {
        Some(0) => {
            relaunch(app, Path::new("/usr/bin/ondura"));
            Ok(())
        }
        Some(126) => Err(ondura_i18n::tr!("Die Installation wurde abgebrochen (keine Berechtigung erteilt).")),
        _ => Err(ondura_i18n::tr!("Die Installation ist fehlgeschlagen ({0}).", tool)),
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
