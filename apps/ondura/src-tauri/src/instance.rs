//! One process per app, one instance per app and user.
//!
//! Every app (Ondura Mail, Text, Sheets, …) runs in its own process. The
//! first process of an app claims a local endpoint – a named pipe on Windows,
//! a Unix socket elsewhere – and later launches of the same app hand their
//! command line to it and end. The same endpoint carries the few messages
//! the apps exchange as a suite: open something, "are you running?", and
//! "restart for an update".
//!
//! On macOS the suite still runs in one process (`suite`), with the same
//! mechanism as its single-instance lock.

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Messages between the processes of the suite (one JSON line each).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "kebab-case")]
pub enum Message {
    /// A launch of this app: its command line (first entry: the program).
    Open { args: Vec<String> },
    /// Liveness check, answered without doing anything.
    Ping,
    /// An update is being installed: quit and start again. With a version,
    /// once that version is in place (Windows, the installer runs after
    /// quitting); without, right away (the new version is already there).
    Restart { version: Option<String> },
}

const TIMEOUT: Duration = Duration::from_secs(3);

/// Sends a message to the running instance of `app`. `false` if there is
/// none (or it did not answer).
pub fn send(app: &str, message: &Message) -> bool {
    let Ok(line) = serde_json::to_string(message) else { return false };
    #[cfg(windows)]
    // The other process may bring its window to the front (only the
    // foreground process may pass that right on).
    // SAFETY: plain Win32 call without pointers.
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(windows_sys::Win32::UI::WindowsAndMessaging::ASFW_ANY);
    }
    match connect(app) {
        Some(stream) => exchange(stream, &line).is_some(),
        None => false,
    }
}

/// Whether `app` is running (for the current user).
pub fn running(app: &str) -> bool {
    send(app, &Message::Ping)
}

fn exchange<S: std::io::Read + Write>(mut stream: S, line: &str) -> Option<()> {
    stream.write_all(format!("{line}\n").as_bytes()).ok()?;
    stream.flush().ok()?;
    let mut answer = String::new();
    BufReader::new(stream).read_line(&mut answer).ok()?;
    (answer.trim() == "ok").then_some(())
}

/// Safe part of a user name for endpoint names.
fn clean(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect()
}

/// Whether `app` is a valid endpoint name (app ids and "suite").
fn valid(app: &str) -> bool {
    !app.is_empty() && app.len() <= 32 && app.chars().all(|c| c.is_ascii_lowercase())
}

// ---------------------------------------------------------------- Windows --

#[cfg(windows)]
fn endpoint(app: &str) -> String {
    // Pipe names are machine-wide: one per user and session.
    let user = clean(&format!("{}_{}", std::env::var("USERDOMAIN").unwrap_or_default(), std::env::var("USERNAME").unwrap_or_default()));
    let mut session = 0u32;
    // SAFETY: writes the session id of our own process into `session`.
    unsafe {
        windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId(std::process::id(), &mut session);
    }
    format!(r"\\.\pipe\de.mirranet.ondura.{app}.{user}.{session}")
}

#[cfg(windows)]
fn connect(app: &str) -> Option<std::fs::File> {
    if !valid(app) {
        return None;
    }
    let name = endpoint(app);
    // All pipe instances busy: the server is between two connections.
    for _ in 0..20 {
        match std::fs::OpenOptions::new().read(true).write(true).open(&name) {
            Ok(f) => return Some(f),
            Err(e) if e.raw_os_error() == Some(231) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
    None
}

/// The claimed endpoint of this process; `serve` answers on it.
#[cfg(windows)]
pub struct Listener {
    name: String,
    first: tokio::net::windows::named_pipe::NamedPipeServer,
}

/// Claims the endpoint of `app`. `None` if another process already has it.
#[cfg(windows)]
pub fn claim(app: &str) -> Option<Listener> {
    use tokio::net::windows::named_pipe::ServerOptions;
    if !valid(app) {
        return None;
    }
    let name = endpoint(app);
    let first = tauri::async_runtime::block_on(async { ServerOptions::new().first_pipe_instance(true).create(&name) }).ok()?;
    Some(Listener { name, first })
}

/// Answers messages for the lifetime of the process.
#[cfg(windows)]
pub fn serve(listener: Listener, handler: impl Fn(Message) + Send + Sync + 'static) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let handler = std::sync::Arc::new(handler);
    tauri::async_runtime::spawn(async move {
        let Listener { name, mut first } = listener;
        loop {
            let connected = first.connect().await.is_ok();
            // The next instance waits for the next client (also after a
            // failed connection, which leaves this one unusable).
            let next = match ServerOptions::new().create(&name) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(error = %e, "instance pipe");
                    break;
                }
            };
            let connection = std::mem::replace(&mut first, next);
            if connected {
                let handler = std::sync::Arc::clone(&handler);
                tauri::async_runtime::spawn(async move { answer(connection, handler.as_ref()).await });
            }
        }
    });
}

// ------------------------------------------------------------------- Unix --

#[cfg(unix)]
fn endpoint_dir() -> Option<std::path::PathBuf> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    if let Some(dir) = std::env::var_os("XDG_RUNTIME_DIR").map(std::path::PathBuf::from).filter(|d| d.is_dir()) {
        return Some(dir);
    }
    // SAFETY: getuid has no preconditions.
    let uid = unsafe { libc_getuid() };
    let dir = std::env::temp_dir().join(format!("ondura-{uid}"));
    if !dir.exists() {
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).ok()?;
    }
    // Only a private directory of our own user.
    let meta = std::fs::symlink_metadata(&dir).ok()?;
    (meta.is_dir() && meta.uid() == uid && meta.mode() & 0o077 == 0).then_some(dir)
}

#[cfg(unix)]
unsafe extern "C" {
    #[link_name = "getuid"]
    fn libc_getuid() -> u32;
}

#[cfg(unix)]
fn endpoint(app: &str) -> Option<std::path::PathBuf> {
    let user = clean(&std::env::var("USER").unwrap_or_default());
    Some(endpoint_dir()?.join(format!("de.mirranet.ondura.{app}.{user}.sock")))
}

#[cfg(unix)]
fn connect(app: &str) -> Option<std::os::unix::net::UnixStream> {
    if !valid(app) {
        return None;
    }
    let stream = std::os::unix::net::UnixStream::connect(endpoint(app)?).ok()?;
    stream.set_read_timeout(Some(TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TIMEOUT)).ok()?;
    Some(stream)
}

#[cfg(unix)]
pub struct Listener {
    listener: std::os::unix::net::UnixListener,
}

#[cfg(unix)]
pub fn claim(app: &str) -> Option<Listener> {
    if !valid(app) {
        return None;
    }
    let path = endpoint(app)?;
    let listener = match std::os::unix::net::UnixListener::bind(&path) {
        Ok(l) => l,
        Err(_) => {
            // A socket of a process that is still alive belongs to it; a
            // leftover of a crashed one is replaced.
            if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                return None;
            }
            let _ = std::fs::remove_file(&path);
            std::os::unix::net::UnixListener::bind(&path).ok()?
        }
    };
    listener.set_nonblocking(true).ok()?;
    Some(Listener { listener })
}

#[cfg(unix)]
pub fn serve(listener: Listener, handler: impl Fn(Message) + Send + Sync + 'static) {
    let handler = std::sync::Arc::new(handler);
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::UnixListener::from_std(listener.listener) else { return };
        loop {
            let Ok((connection, _)) = listener.accept().await else { continue };
            let handler = std::sync::Arc::clone(&handler);
            tauri::async_runtime::spawn(async move { answer(connection, handler.as_ref()).await });
        }
    });
}

/// Reads one message, confirms it and hands it to the handler.
async fn answer<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(stream: S, handler: &(dyn Fn(Message) + Send + Sync)) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    let mut reader = tokio::io::BufReader::new(stream);
    let mut line = String::new();
    let read = tokio::time::timeout(TIMEOUT, reader.read_line(&mut line)).await;
    if !matches!(read, Ok(Ok(n)) if n > 0 && n < 64 * 1024) {
        return;
    }
    let Ok(message) = serde_json::from_str::<Message>(line.trim()) else { return };
    let _ = reader.get_mut().write_all(b"ok\n").await;
    let _ = reader.get_mut().flush().await;
    handler(message);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_round_trip() {
        let m = serde_json::to_string(&Message::Open { args: vec!["ondura".into(), "--app".into(), "text".into()] }).unwrap();
        assert_eq!(m, r#"{"cmd":"open","args":["ondura","--app","text"]}"#);
        assert!(matches!(serde_json::from_str(r#"{"cmd":"restart","version":"1.2.3"}"#).unwrap(), Message::Restart { version: Some(v) } if v == "1.2.3"));
        assert!(matches!(serde_json::from_str(r#"{"cmd":"ping"}"#).unwrap(), Message::Ping));
    }

    #[test]
    fn endpoint_names() {
        assert!(valid("text") && valid("suite"));
        assert!(!valid("") && !valid("../x") && !valid("Text"));
        assert_eq!(clean("DOM\\nik las/.."), "DOMniklas");
    }

    #[cfg(unix)]
    #[test]
    fn claim_send_and_release() {
        let app = "instancetest";
        let listener = claim(app).expect("claim");
        assert!(claim(app).is_none(), "second claim must fail while the first is alive");
        let (tx, rx) = std::sync::mpsc::channel();
        serve(listener, move |m| {
            let _ = tx.send(m);
        });
        assert!(send(app, &Message::Open { args: vec!["x".into()] }));
        assert!(matches!(rx.recv_timeout(TIMEOUT).unwrap(), Message::Open { args } if args == ["x"]));
        assert!(running(app));
        assert!(!running("instancetestnone"));
        let _ = std::fs::remove_file(endpoint(app).unwrap());
    }
}
