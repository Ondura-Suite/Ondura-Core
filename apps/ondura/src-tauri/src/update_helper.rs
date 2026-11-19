//! Privileged side of the updater: installs a downloaded update without an
//! installer window or password prompt.
//!
//! * Windows: `ondura.exe --update-service` runs as the "Ondura Update"
//!   service (LocalSystem, demand start). The NSIS installer registers it
//!   and allows every user to start it. Ondura starts it with the path of
//!   the downloaded installer; the service reads the file, checks its
//!   minisign signature against the key compiled into Ondura, copies it to
//!   the system temp folder and runs it silently (`/S /UPDATE`).
//! * Linux (.deb/.rpm): Ondura writes a request into
//!   `/var/lib/ondura/updates` (world-writable, sticky). The systemd path
//!   unit `ondura-update.path` starts `ondura-update.service`, which runs
//!   `ondura --apply-update` as root: it verifies the package the same
//!   way, checks that it is newer than the installed version and installs
//!   it with dpkg or rpm. The result is written to `status.json`.
//!
//! Only packages signed with the Ondura update key are ever installed, so
//! the helpers can't be used to run other code with elevated rights.

use std::path::Path;

use crate::update::{CURRENT, PUBKEY, newer, verify};

/// Read a downloaded file and its `.sig` and check the signature.
fn verified(path: &Path) -> Result<Vec<u8>, String> {
    let key = PUBKEY.ok_or("built without update key")?;
    // Regular files only (no FIFOs or devices that would block the helper).
    if !std::fs::metadata(path).map_err(|e| format!("read {}: {e}", path.display()))?.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    let data = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let sig_path = path.with_file_name(format!("{}.sig", path.file_name().and_then(|n| n.to_str()).unwrap_or_default()));
    let sig = std::fs::read_to_string(&sig_path).map_err(|e| format!("read {}: {e}", sig_path.display()))?;
    verify(key, &data, &sig)?;
    Ok(data)
}

fn random_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:x}", t, std::process::id())
}

/// Version in a release file name (`Ondura_1.2.3_x64_SilentInstall.exe`,
/// `ondura_1.2.3_amd64.deb`).
fn version_in_name(name: &str) -> Option<String> {
    name.split(['_', '-']).find(|p| p.split('.').count() == 3 && p.split('.').all(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))).map(String::from)
}

// --------------------------------------------------------------- Windows --

#[cfg(windows)]
pub const SERVICE: &str = "OnduraUpdate";

#[cfg(windows)]
fn log(line: &str) {
    use std::io::Write;
    let dir = std::env::var_os("ProgramData").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir).join("Ondura");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("update.log")) {
        let _ = writeln!(f, "{} {line}", chrono::Utc::now().to_rfc3339());
    }
}

/// Ask the update service to install `path`; waits until it accepted it.
#[cfg(windows)]
pub fn start_service(path: &Path) -> Result<(), String> {
    use std::time::Duration;
    use windows_service::service::{ServiceAccess, ServiceExitCode, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).map_err(|e| e.to_string())?;
    let service = manager.open_service(SERVICE, ServiceAccess::START | ServiceAccess::QUERY_STATUS).map_err(|e| e.to_string())?;
    service.start(&[path.as_os_str()]).map_err(|e| e.to_string())?;
    for _ in 0..240 {
        std::thread::sleep(Duration::from_millis(250));
        let status = service.query_status().map_err(|e| e.to_string())?;
        if status.current_state == ServiceState::Stopped {
            return match status.exit_code {
                ServiceExitCode::Win32(0) => Ok(()),
                _ => Err(ondura_i18n::tr!("Der Update-Dienst hat das Update abgelehnt (Details in %ProgramData%\\Ondura\\update.log).").into()),
            };
        }
    }
    Err(ondura_i18n::tr!("Der Update-Dienst antwortet nicht.").into())
}

#[cfg(windows)]
windows_service::define_windows_service!(ffi_service_main, service_main);

/// Entry point of `ondura.exe --update-service`.
#[cfg(windows)]
pub fn run_service() {
    if let Err(e) = windows_service::service_dispatcher::start(SERVICE, ffi_service_main) {
        log(&format!("service dispatcher: {e}"));
    }
}

#[cfg(windows)]
fn service_main(args: Vec<std::ffi::OsString>) {
    use std::time::Duration;
    use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    let Ok(handle) = service_control_handler::register(SERVICE, |c| match c {
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    }) else {
        return;
    };
    let status = |state, code| ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: code,
        checkpoint: 0,
        wait_hint: Duration::from_secs(30),
        process_id: None,
    };
    let _ = handle.set_service_status(status(ServiceState::Running, ServiceExitCode::Win32(0)));
    // The first argument is the service name.
    let result = match args.get(1) {
        Some(path) => apply_windows(Path::new(path)),
        None => Err("no installer given".into()),
    };
    let code = match result {
        Ok(()) => ServiceExitCode::Win32(0),
        Err(e) => {
            log(&format!("update rejected: {e}"));
            ServiceExitCode::ServiceSpecific(1)
        }
    };
    let _ = handle.set_service_status(status(ServiceState::Stopped, code));
}

#[cfg(windows)]
fn apply_windows(path: &Path) -> Result<(), String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("bad file name")?;
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with("_silentinstall.exe") && !lower.ends_with("-setup.exe") {
        return Err(format!("not an Ondura installer: {name}"));
    }
    let version = version_in_name(name).ok_or("no version in file name")?;
    if !newer(&version, CURRENT) {
        return Err(format!("{version} is not newer than {CURRENT}"));
    }
    let data = verified(path)?;
    // A fresh file the user can't touch: the system temp folder of the
    // service account, created exclusively.
    let target = std::env::temp_dir().join(format!("ondura-update-{}.exe", random_suffix()));
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
    f.write_all(&data).map_err(|e| e.to_string())?;
    drop(f);
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    std::process::Command::new(&target)
        .args(["/S", "/UPDATE"])
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map_err(|e| format!("start installer: {e}"))?;
    log(&format!("installing {version} from {}", path.display()));
    Ok(())
}

/// Start Ondura again once the installer has put `version` in place: a
/// hidden PowerShell waits for the new file version and for the installer
/// to finish.
#[cfg(windows)]
pub fn relaunch_when_installed(exe: &Path, version: &str) -> Result<(), String> {
    relaunch_when_installed_with(exe, version, &[])
}

/// Like `relaunch_when_installed`, with arguments for the new process.
#[cfg(windows)]
pub fn relaunch_when_installed_with(exe: &Path, version: &str, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let q = |s: &str| s.replace('\'', "''");
    let arg_list = if args.is_empty() { String::new() } else { format!(" -ArgumentList {}", args.iter().map(|a| format!("'{}'", q(a))).collect::<Vec<_>>().join(",")) };
    // Waits until the new version is in place and the installer has ended
    // (named `Ondura_<v>_x64_SilentInstall`, before 0.1.2 `…-setup`).
    let script = format!(
        "$p='{}'; $v='{}'; Start-Sleep -Seconds 3; for($i=0; $i -lt 600; $i++){{ try {{ $ok = (Get-Item -LiteralPath $p).VersionInfo.ProductVersion -like \"$v*\"; $busy = Get-Process -Name 'ondura-update-*','Ondura_*-setup','Ondura_*_SilentInstall' -ErrorAction SilentlyContinue; if($ok -and -not $busy){{ Start-Process -FilePath $p{arg_list}; exit }} }} catch {{}}; Start-Sleep -Seconds 1 }}",
        q(&exe.display().to_string()),
        q(version)
    );
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Neustart nach dem Update: {e}"))
}

// ----------------------------------------------------------------- Linux --

#[cfg(target_os = "linux")]
const REQUEST_DIR: &str = "/var/lib/ondura/updates";
#[cfg(target_os = "linux")]
const STAGING_DIR: &str = "/var/lib/ondura/staging";

#[cfg(target_os = "linux")]
#[derive(serde::Serialize, serde::Deserialize)]
struct Status {
    version: String,
    ok: bool,
    message: String,
}

/// The root helper is installed and its path unit is active.
#[cfg(target_os = "linux")]
pub fn linux_helper_available() -> bool {
    Path::new(REQUEST_DIR).is_dir() && std::process::Command::new("systemctl").args(["is-active", "--quiet", "ondura-update.path"]).status().is_ok_and(|s| s.success())
}

#[cfg(target_os = "linux")]
pub fn request_linux_update(package: &Path) -> std::io::Result<()> {
    let dir = Path::new(REQUEST_DIR);
    let id = random_suffix();
    let tmp = dir.join(format!(".tmp-{id}"));
    std::fs::write(&tmp, serde_json::json!({ "package": package }).to_string())?;
    // The rename makes the request visible to the path unit in one step.
    std::fs::rename(&tmp, dir.join(format!("request-{id}")))
}

/// Wait until the helper reports the result for `version`.
#[cfg(target_os = "linux")]
pub async fn wait_linux_update(version: &str) -> Result<(), String> {
    let status_path = Path::new(REQUEST_DIR).join("status.json");
    let before = std::fs::metadata(&status_path).and_then(|m| m.modified()).ok();
    for _ in 0..600 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let Ok(meta) = std::fs::metadata(&status_path) else { continue };
        if before.is_some() && meta.modified().ok() == before {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&status_path) else { continue };
        let Ok(status) = serde_json::from_str::<Status>(&text) else { continue };
        if status.version != version && status.ok {
            continue;
        }
        return if status.ok { Ok(()) } else { Err(ondura_i18n::tr!("Das Update wurde nicht installiert: {0}", status.message)) };
    }
    Err(ondura_i18n::tr!("Das Update dauert ungewöhnlich lange. Bitte starten Sie Ondura später neu."))
}

/// Entry point of `ondura --apply-update` (root, from ondura-update.service).
#[cfg(target_os = "linux")]
pub fn apply_linux_requests() -> i32 {
    let Ok(entries) = std::fs::read_dir(REQUEST_DIR) else { return 1 };
    let mut code = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("request-") {
            continue;
        }
        let path = entry.path();
        let text = read_regular(&path).unwrap_or_default();
        let _ = std::fs::remove_file(&path);
        let package = serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|v| v["package"].as_str().map(String::from));
        let result = match package {
            Some(p) => apply_linux(Path::new(&p)),
            None => Err((String::new(), "invalid request".into())),
        };
        let status = match result {
            Ok(version) => Status { version, ok: true, message: "installed".into() },
            Err((version, message)) => {
                code = 1;
                eprintln!("ondura update rejected: {message}");
                Status { version, ok: false, message }
            }
        };
        write_status(&status);
    }
    code
}

/// Reads a small regular file without following symlinks or blocking on
/// FIFOs (the request folder is writable by every user).
#[cfg(target_os = "linux")]
fn read_regular(path: &Path) -> Option<String> {
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;
    let file = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut text = String::new();
    file.take(64 * 1024).read_to_string(&mut text).ok()?;
    Some(text)
}

/// Writes status.json atomically. The temporary file lives in the root-only
/// staging folder so no user can plant a symlink in its place.
#[cfg(target_os = "linux")]
fn write_status(status: &Status) {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(STAGING_DIR);
    let tmp = Path::new(STAGING_DIR).join(format!("status-{}.json", random_suffix()));
    let Ok(mut f) = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o644).open(&tmp) else { return };
    if f.write_all(serde_json::to_string(status).unwrap_or_default().as_bytes()).is_ok() {
        drop(f);
        if std::fs::rename(&tmp, Path::new(REQUEST_DIR).join("status.json")).is_ok() {
            return;
        }
    }
    let _ = std::fs::remove_file(&tmp);
}

#[cfg(target_os = "linux")]
fn apply_linux(package: &Path) -> Result<String, (String, String)> {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let name = package.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let guess = version_in_name(&name).unwrap_or_default();
    let fail = |m: String| (guess.clone(), m);
    let ext = if name.ends_with(".deb") {
        "deb"
    } else if name.ends_with(".rpm") {
        "rpm"
    } else {
        return Err(fail(format!("not an Ondura package: {name}")));
    };
    let data = verified(package).map_err(&fail)?;
    let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(STAGING_DIR);
    let staged = Path::new(STAGING_DIR).join(format!("ondura-{}.{ext}", random_suffix()));
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&staged).map_err(|e| fail(e.to_string()))?;
    f.write_all(&data).map_err(|e| fail(e.to_string()))?;
    drop(f);
    let result = (|| {
        // The version from the (signed) package itself, not the file name.
        let query = if ext == "deb" {
            std::process::Command::new("dpkg-deb").args(["-f"]).arg(&staged).arg("Version").output()
        } else {
            std::process::Command::new("rpm").args(["-qp", "--qf", "%{VERSION}"]).arg(&staged).output()
        };
        let version = query.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|v| !v.is_empty()).ok_or_else(|| fail("cannot read package version".into()))?;
        if !newer(&version, CURRENT) {
            return Err((version.clone(), ondura_i18n::tr!("{0} ist nicht neuer als {1}", version, CURRENT)));
        }
        let status = if ext == "deb" {
            std::process::Command::new("dpkg").env("DEBIAN_FRONTEND", "noninteractive").arg("-i").arg(&staged).status()
        } else {
            std::process::Command::new("rpm").args(["-U", "--replacepkgs"]).arg(&staged).status()
        };
        match status {
            Ok(s) if s.success() => Ok(version),
            Ok(s) => Err((version, format!("Paketinstallation fehlgeschlagen ({s})"))),
            Err(e) => Err((version, e.to_string())),
        }
    })();
    let _ = std::fs::remove_file(&staged);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_from_release_names() {
        assert_eq!(version_in_name("Ondura_0.3.1_x64-setup.exe").as_deref(), Some("0.3.1"));
        assert_eq!(version_in_name("Ondura_0.3.1_x64_SilentInstall.exe").as_deref(), Some("0.3.1"));
        assert_eq!(version_in_name("ondura_1.10.0_amd64.deb").as_deref(), Some("1.10.0"));
        assert_eq!(version_in_name("ondura-0.2.0-1.x86_64.rpm").as_deref(), Some("0.2.0"));
        assert_eq!(version_in_name("setup.exe"), None);
    }
}
