//! Nexora Setup: a small Office-style installer for Windows.
//!
//! The actual installation is done by the NSIS installer of `apps/nexora`,
//! which is embedded as payload (see build.rs) and run silently. This program
//! only provides the user interface: it detects an existing installation and
//! offers an update, shows real progress (the growing `nexora.exe` in the
//! install folder) and starts Orbit at the end.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Installer of the suite, embedded at build time (empty in check builds).
static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));
/// Size of the installed `nexora.exe`, 0 if unknown.
const APP_SIZE: &str = env!("NEXORA_SETUP_APP_SIZE");
/// Version of the embedded suite (from apps/nexora/src-tauri/tauri.conf.json).
const VERSION: &str = env!("NEXORA_VERSION");
const PRODUCT: &str = "Nexora";
const BINARY: &str = "nexora.exe";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Installed {
    version: String,
    location: String,
    /// Installed for all users (needs administrator rights to change).
    per_machine: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupInfo {
    version: String,
    has_payload: bool,
    supported: bool,
    install_dir: String,
    installed: Option<Installed>,
    /// -1: older version installed (update), 0: same version, 1: newer version installed.
    compare: i32,
    running: bool,
    legacy: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// 0..1, or `None` while unknown.
    fraction: Option<f64>,
    step: String,
}

fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| v.split(['.', '-', '+']).take(3).map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a).cmp(&parse(b))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};

    const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    fn read(root: &RegKey, product: &str) -> Option<(String, String, String)> {
        let key = root.open_subkey_with_flags(format!(r"{UNINSTALL}\{product}"), KEY_READ | KEY_WOW64_64KEY).ok()?;
        let version: String = key.get_value("DisplayVersion").unwrap_or_default();
        let location: String = key.get_value("InstallLocation").unwrap_or_default();
        let uninstall: String = key.get_value("UninstallString").unwrap_or_default();
        Some((version, location.trim_matches('"').to_string(), uninstall))
    }

    pub fn installed() -> Option<Installed> {
        if let Some((version, location, _)) = read(&RegKey::predef(HKEY_CURRENT_USER), PRODUCT) {
            return Some(Installed { version, location, per_machine: false });
        }
        read(&RegKey::predef(HKEY_LOCAL_MACHINE), PRODUCT).map(|(version, location, _)| Installed { version, location, per_machine: true })
    }

    /// Per-user uninstaller of the pre-rename "Mirra Office".
    pub fn legacy_uninstaller() -> Option<String> {
        read(&RegKey::predef(HKEY_CURRENT_USER), "Mirra Office").map(|(_, _, u)| u).filter(|u| !u.is_empty())
    }

    pub fn default_dir() -> PathBuf {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join(PRODUCT)
    }

    pub fn running() -> bool {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {BINARY}"), "/NH"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(BINARY))
            .unwrap_or(false)
    }

    /// Runs a command line without a console window and waits for it.
    pub fn run(program: &Path, raw_args: &str) -> std::io::Result<i32> {
        use std::os::windows::process::CommandExt;
        let status = std::process::Command::new(program).raw_arg(raw_args).creation_flags(0x0800_0000).status()?;
        Ok(status.code().unwrap_or(-1))
    }

    pub fn run_uninstall_string(cmd: &str, extra: &str) {
        use std::os::windows::process::CommandExt;
        // UninstallString is `"C:\...\uninstall.exe"`.
        let exe = cmd.trim().trim_matches('"');
        let _ = std::process::Command::new(exe).raw_arg(extra).creation_flags(0x0800_0000).status();
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn installed() -> Option<Installed> {
        None
    }
    pub fn legacy_uninstaller() -> Option<String> {
        None
    }
    pub fn default_dir() -> PathBuf {
        std::env::temp_dir().join(PRODUCT)
    }
    pub fn running() -> bool {
        false
    }
    pub fn run(_program: &Path, _raw_args: &str) -> std::io::Result<i32> {
        Err(std::io::Error::other("Nexora Setup läuft nur unter Windows"))
    }
    pub fn run_uninstall_string(_cmd: &str, _extra: &str) {}
}

fn install_dir(installed: &Option<Installed>) -> PathBuf {
    match installed {
        Some(i) if !i.location.is_empty() && !i.per_machine => PathBuf::from(&i.location),
        _ => platform::default_dir(),
    }
}

#[tauri::command]
fn setup_info() -> SetupInfo {
    let installed = platform::installed();
    let compare = match &installed {
        Some(i) => match version_cmp(&i.version, VERSION) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        },
        None => -1,
    };
    SetupInfo {
        version: VERSION.into(),
        has_payload: !PAYLOAD.is_empty(),
        supported: cfg!(windows),
        install_dir: install_dir(&installed).display().to_string(),
        installed,
        compare,
        running: platform::running(),
        legacy: platform::legacy_uninstaller().is_some(),
    }
}

/// Watches the main binary grow while NSIS extracts it.
fn watch_progress(app: AppHandle, exe: PathBuf, started: SystemTime, done: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    let expected: u64 = APP_SIZE.parse().unwrap_or(0);
    std::thread::spawn(move || {
        let mut best = 0.0f64;
        while !done.load(std::sync::atomic::Ordering::Relaxed) {
            let fraction = if expected > 0 {
                std::fs::metadata(&exe)
                    .ok()
                    .filter(|m| m.modified().map(|t| t >= started).unwrap_or(false))
                    .map(|m| (m.len() as f64 / expected as f64).min(1.0) * 0.92)
            } else {
                None
            };
            if let Some(f) = fraction {
                best = best.max(f);
            }
            let step = if best >= 0.92 { "Verknüpfungen werden eingerichtet …" } else { "Dateien werden installiert …" };
            let _ = app.emit("setup-progress", Progress { fraction: (expected > 0).then_some(best), step: step.into() });
            std::thread::sleep(Duration::from_millis(150));
        }
    });
}

#[tauri::command]
async fn install(app: AppHandle) -> Result<String, String> {
    if PAYLOAD.is_empty() {
        return Err("Dieses Setup enthält kein Installationspaket.".into());
    }
    let installed = platform::installed();
    if let Some(i) = &installed
        && i.per_machine
    {
        return Err(format!(
            "Nexora {} ist für alle Benutzer installiert. Bitte deinstallieren Sie diese Version zuerst unter „Einstellungen → Apps“.",
            i.version
        ));
    }
    let dir = install_dir(&installed);
    let exe = dir.join(BINARY);

    let _ = app.emit("setup-progress", Progress { fraction: None, step: "Installation wird vorbereitet …".into() });
    let payload = std::env::temp_dir().join(format!("nexora-setup-{}.exe", std::process::id()));
    std::fs::write(&payload, PAYLOAD).map_err(|e| format!("Installationspaket konnte nicht entpackt werden: {e}"))?;

    let started = SystemTime::now() - Duration::from_secs(2);
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    watch_progress(app.clone(), exe.clone(), started, done.clone());

    // `/S` = silent; NSIS closes a running Nexora itself. `/D=` must come last
    // and unquoted, even with spaces.
    let args = format!("/S /D={}", dir.display());
    let result = tauri::async_runtime::spawn_blocking(move || platform::run(&payload, &args).map(|code| (code, payload)))
        .await
        .map_err(|e| e.to_string())?;
    done.store(true, std::sync::atomic::Ordering::Relaxed);
    let (code, payload) = result.map_err(|e| format!("Das Installationsprogramm konnte nicht gestartet werden: {e}"))?;
    let _ = std::fs::remove_file(&payload);
    if code != 0 || !exe.exists() {
        return Err(match code {
            2 => "Die Installation wurde abgebrochen.".into(),
            _ => format!("Die Installation ist fehlgeschlagen (Code {code})."),
        });
    }

    // Remove the old per-user "Mirra Office" installation (data was migrated already).
    if let Some(uninstall) = platform::legacy_uninstaller() {
        let _ = app.emit("setup-progress", Progress { fraction: Some(0.97), step: "Mirra Office wird entfernt …".into() });
        platform::run_uninstall_string(&uninstall, "/S");
    }
    let _ = app.emit("setup-progress", Progress { fraction: Some(1.0), step: "Fertig".into() });
    Ok(dir.display().to_string())
}

#[tauri::command]
fn launch(dir: String) -> Result<(), String> {
    let exe = Path::new(&dir).join(BINARY);
    std::process::Command::new(exe).args(["--app", "mail"]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![setup_info, install, launch])
        .run(tauri::generate_context!())
        .expect("error while running Nexora Setup");
}

#[cfg(test)]
mod tests {
    use super::version_cmp;
    use std::cmp::Ordering;

    #[test]
    fn compares_versions() {
        assert_eq!(version_cmp("0.1.0", "0.2.0"), Ordering::Less);
        assert_eq!(version_cmp("0.10.0", "0.9.3"), Ordering::Greater);
        assert_eq!(version_cmp("1.0.0", "1.0.0"), Ordering::Equal);
        assert_eq!(version_cmp("", "0.1.0"), Ordering::Less);
    }
}
