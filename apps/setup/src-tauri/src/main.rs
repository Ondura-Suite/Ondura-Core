//! Ondura Setup: a small Office-style installer for Windows.
//!
//! The actual installation is done by the NSIS installer of `apps/ondura`,
//! which is embedded as payload (see build.rs) and run silently. This program
//! only provides the user interface: it lets the user choose the apps (Ondura Mail
//! on its own and/or the office apps together), detects an existing
//! installation and offers an update, shows real progress (the growing
//! `ondura.exe` in the install folder) and starts the suite at the end.
//!
//! Ondura is installed for all users (Program Files). The setup itself runs
//! as the signed-in user and only the embedded installer is started with
//! administrator rights (UAC prompt), so the app is opened afterwards as that
//! user and not as the administrator.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Installer of the suite, embedded at build time (empty in check builds).
static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));
/// Size of the installed `ondura.exe`, 0 if unknown.
const APP_SIZE: &str = env!("ONDURA_SETUP_APP_SIZE");
/// Version of the embedded suite (from apps/ondura/src-tauri/tauri.conf.json).
const VERSION: &str = env!("ONDURA_VERSION");
const PRODUCT: &str = "Ondura";
const BINARY: &str = "ondura.exe";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Installed {
    version: String,
    location: String,
    /// Installed for all users. Older versions installed per user; such an
    /// installation is replaced by a system-wide one.
    per_machine: bool,
}

/// Apps chosen in a previous installation.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Components {
    mail: bool,
    office: bool,
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
    components: Components,
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
        if let Some((version, location, _)) = read(&RegKey::predef(HKEY_LOCAL_MACHINE), PRODUCT) {
            return Some(Installed { version, location, per_machine: true });
        }
        read(&RegKey::predef(HKEY_CURRENT_USER), PRODUCT).map(|(version, location, _)| Installed { version, location, per_machine: false })
    }

    /// (uninstaller, folder) of an earlier per-user installation of Ondura.
    pub fn per_user_uninstaller() -> Option<(String, String)> {
        read(&RegKey::predef(HKEY_CURRENT_USER), PRODUCT).map(|(_, l, u)| (u, l)).filter(|(u, _)| !u.is_empty())
    }

    /// Components chosen last time (written by the installer hooks).
    pub fn components() -> Option<Components> {
        let key = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(r"Software\MirraNET\Ondura", KEY_READ | KEY_WOW64_64KEY).ok()?;
        let mail: String = key.get_value("Mail").ok()?;
        let office: String = key.get_value("Office").unwrap_or_else(|_| "1".into());
        Some(Components { mail: mail != "0", office: office != "0" })
    }

    pub fn default_dir() -> PathBuf {
        std::env::var_os("ProgramW6432").or_else(|| std::env::var_os("ProgramFiles")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Program Files")).join(PRODUCT)
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Runs a program with administrator rights (UAC prompt) and waits for it.
    /// Returns the exit code; 2 if the user declined the prompt.
    pub fn run_elevated(program: &Path, raw_args: &str) -> std::io::Result<i32> {
        use windows_sys::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, GetLastError};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject};
        use windows_sys::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let verb = wide("runas");
        let file = wide(&program.display().to_string());
        let params = wide(raw_args);
        // SAFETY: the struct is plain data; all pointers outlive the call.
        unsafe {
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_NOCLOSEPROCESS;
            info.lpVerb = verb.as_ptr();
            info.lpFile = file.as_ptr();
            info.lpParameters = params.as_ptr();
            // NSIS with /S has no window anyway; nothing is started hidden.
            info.nShow = SW_SHOWNORMAL;
            if ShellExecuteExW(&mut info) == 0 {
                return if GetLastError() == ERROR_CANCELLED { Ok(2) } else { Err(std::io::Error::last_os_error()) };
            }
            if info.hProcess.is_null() {
                return Ok(0);
            }
            WaitForSingleObject(info.hProcess, INFINITE);
            let mut code = 0u32;
            GetExitCodeProcess(info.hProcess, &mut code);
            CloseHandle(info.hProcess);
            Ok(code as i32)
        }
    }

    /// Whether Ondura is running, from a process snapshot (no helper process).
    pub fn running() -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
        // SAFETY: the snapshot handle is closed below; the entry is plain data
        // with dwSize set as the API requires.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return false;
            }
            let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut found = false;
            let mut ok = Process32FirstW(snap, &mut entry) != 0;
            while ok {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case(BINARY) {
                    found = true;
                    break;
                }
                ok = Process32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
            found
        }
    }

    pub fn run_uninstall_string(cmd: &str, extra: &str) {
        use std::os::windows::process::CommandExt;
        // UninstallString is `"C:\...\uninstall.exe"`. The NSIS uninstaller
        // shows no window with /S, so it is started normally.
        let exe = cmd.trim().trim_matches('"');
        let _ = std::process::Command::new(exe).raw_arg(extra).status();
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn installed() -> Option<Installed> {
        None
    }
    pub fn per_user_uninstaller() -> Option<(String, String)> {
        None
    }
    pub fn components() -> Option<Components> {
        None
    }
    pub fn default_dir() -> PathBuf {
        std::env::temp_dir().join(PRODUCT)
    }
    pub fn running() -> bool {
        false
    }
    pub fn run_elevated(_program: &Path, _raw_args: &str) -> std::io::Result<i32> {
        Err(std::io::Error::other(ondura_i18n::tr!("Ondura Setup läuft nur unter Windows")))
    }
    pub fn run_uninstall_string(_cmd: &str, _extra: &str) {}
}

fn install_dir(installed: &Option<Installed>) -> PathBuf {
    match installed {
        Some(i) if !i.location.is_empty() && i.per_machine => PathBuf::from(&i.location),
        _ => platform::default_dir(),
    }
}

#[tauri::command]
fn setup_info(lang: Option<String>) -> SetupInfo {
    // Messages of the following commands in the language of the setup UI.
    if let Some(l) = lang.as_deref().and_then(ondura_i18n::Lang::parse) {
        ondura_i18n::set_language(l);
    }
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
        components: platform::components().unwrap_or(Components { mail: true, office: true }),
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
            let step = if best >= 0.92 { ondura_i18n::tr!("Verknüpfungen werden eingerichtet …") } else { ondura_i18n::tr!("Dateien werden installiert …") };
            let _ = app.emit("setup-progress", Progress { fraction: (expected > 0).then_some(best), step });
            std::thread::sleep(Duration::from_millis(150));
        }
    });
}

/// `%LOCALAPPDATA%\Ondura\Setup\Ondura_<version>_x64_SilentInstall.exe`.
fn payload_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("Ondura").join("Setup").join(format!("Ondura_{VERSION}_x64_SilentInstall.exe"))
}

#[tauri::command]
async fn install(app: AppHandle, mail: bool, office: bool) -> Result<String, String> {
    if PAYLOAD.is_empty() {
        return Err(ondura_i18n::tr!("Dieses Setup enthält kein Installationspaket."));
    }
    if !mail && !office {
        return Err(ondura_i18n::tr!("Bitte wählen Sie mindestens eine App aus."));
    }
    // An earlier per-user installation is removed first (as this user; the
    // accounts and data in the user profile stay).
    if let Some((uninstall, folder)) = platform::per_user_uninstaller() {
        let _ = app.emit("setup-progress", Progress { fraction: None, step: "Bisherige Installation wird entfernt …".into() });
        let _ = tauri::async_runtime::spawn_blocking(move || {
            // `_?=` makes the NSIS uninstaller run in place and wait; it then
            // leaves itself behind, so remove it and the folder afterwards.
            platform::run_uninstall_string(&uninstall, &format!("/S _?={folder}"));
            let _ = std::fs::remove_file(uninstall.trim().trim_matches('"'));
            let _ = std::fs::remove_dir(&folder);
        })
        .await;
    }
    let installed = platform::installed();
    let dir = install_dir(&installed);
    let exe = dir.join(BINARY);

    let _ = app.emit("setup-progress", Progress { fraction: None, step: ondura_i18n::tr!("Installation wird vorbereitet …") });
    // The embedded installer is unpacked under its published name into
    // Ondura's own folder (not a random name in %TEMP%), so it is the very
    // same, signed file that is offered for download.
    let payload = payload_path();
    if let Some(parent) = payload.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ondura_i18n::tr!("Installationspaket konnte nicht entpackt werden: {0}", e))?;
    }
    std::fs::write(&payload, PAYLOAD).map_err(|e| ondura_i18n::tr!("Installationspaket konnte nicht entpackt werden: {0}", e))?;

    let started = SystemTime::now() - Duration::from_secs(2);
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    watch_progress(app.clone(), exe.clone(), started, done.clone());

    let _ = app.emit("setup-progress", Progress { fraction: None, step: ondura_i18n::tr!("Bitte bestätigen Sie die Administratorrechte …") });
    // `/S` = silent; NSIS closes a running Ondura itself. `/MAILONLY` and
    // `/OFFICEONLY` select the apps (installer-hooks.nsh). `/D=` must come
    // last and unquoted, even with spaces.
    let components = match (mail, office) {
        (true, false) => "/MAILONLY ",
        (false, true) => "/OFFICEONLY ",
        _ => "",
    };
    let args = format!("/S {components}/D={}", dir.display());
    let result = tauri::async_runtime::spawn_blocking(move || platform::run_elevated(&payload, &args).map(|code| (code, payload)))
        .await
        .map_err(|e| e.to_string())?;
    done.store(true, std::sync::atomic::Ordering::Relaxed);
    let (code, payload) = result.map_err(|e| ondura_i18n::tr!("Das Installationsprogramm konnte nicht gestartet werden: {0}", e))?;
    let _ = std::fs::remove_file(&payload);
    if code != 0 || !exe.exists() {
        return Err(match code {
            2 => ondura_i18n::tr!("Die Installation wurde abgebrochen."),
            _ => ondura_i18n::tr!("Die Installation ist fehlgeschlagen (Code {0}).", code),
        });
    }

    let _ = app.emit("setup-progress", Progress { fraction: Some(1.0), step: ondura_i18n::tr!("Fertig") });
    Ok(dir.display().to_string())
}

#[tauri::command]
fn launch(dir: String, app: String) -> Result<(), String> {
    let exe = Path::new(&dir).join(BINARY);
    std::process::Command::new(exe).args(["--app", &app]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![setup_info, install, launch])
        .run(tauri::generate_context!())
        .expect("error while running Ondura Setup");
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
