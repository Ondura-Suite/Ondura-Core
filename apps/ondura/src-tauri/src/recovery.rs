//! AutoRecover for Ondura Text, Tabellen and Präsentation: open windows write
//! a snapshot of a changed document every minute; after a crash the next
//! window of the app offers to restore it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

type CmdResult<T> = Result<T, String>;

/// Snapshot ids of windows alive in this process (their files are not
/// offered), with the label of the window that writes them.
static LIVE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn dir() -> CmdResult<PathBuf> {
    let base = directories::ProjectDirs::from("de", "MirraNET", "Ondura").ok_or("no data directory")?;
    let dir = base.data_dir().join("recovery");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn file(app: &str, id: &str) -> CmdResult<PathBuf> {
    if !valid(app) || !valid(id) {
        return Err("invalid id".into());
    }
    Ok(dir()?.join(format!("{app}.{id}.json")))
}

fn live(f: impl FnOnce(&mut HashMap<String, String>)) {
    let mut g = LIVE.lock().unwrap();
    f(g.get_or_insert_with(HashMap::new));
}

/// A window was closed normally: its snapshots are not needed any more
/// (the user saved or chose not to). Crashes never get here.
pub fn window_closed(label: &str) {
    let ids: Vec<String> = {
        let mut g = LIVE.lock().unwrap();
        let map = g.get_or_insert_with(HashMap::new);
        let ids: Vec<String> = map.iter().filter(|(_, l)| l.as_str() == label).map(|(id, _)| id.clone()).collect();
        for id in &ids {
            map.remove(id);
        }
        ids
    };
    let Ok(dir) = dir() else { return };
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if ids.iter().any(|id| name.ends_with(&format!(".{id}.json")) || name.ends_with(&format!(".{id}.name"))) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Store the snapshot of a window's document (JSON written by the app).
#[tauri::command]
pub fn recovery_save(window: tauri::Window, app: String, id: String, name: String, data: String) -> CmdResult<()> {
    let path = file(&app, &id)?;
    std::fs::write(path.with_extension("name"), name).map_err(|e| e.to_string())?;
    live(|l| {
        l.insert(id.clone(), window.label().to_string());
    });
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// The document was saved or closed: drop its snapshot.
#[tauri::command]
pub fn recovery_clear(app: String, id: String) -> CmdResult<()> {
    let path = file(&app, &id)?;
    live(|l| {
        l.remove(&id);
    });
    let _ = std::fs::remove_file(path.with_extension("name"));
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovered {
    pub id: String,
    /// Document name as the window showed it.
    pub name: String,
    /// Unix milliseconds of the snapshot.
    pub modified: u64,
    pub size: u64,
}

/// Snapshots left behind by windows that are gone (crash, power loss).
#[tauri::command]
pub fn recovery_list(app: String) -> CmdResult<Vec<Recovered>> {
    if !valid(&app) {
        return Err("invalid app".into());
    }
    let alive = LIVE.lock().unwrap().clone().unwrap_or_default();
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir()?).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_prefix(&format!("{app}.")).and_then(|r| r.strip_suffix(".json")) else { continue };
        if alive.contains_key(id) {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let name = std::fs::read_to_string(entry.path().with_extension("name")).unwrap_or_default();
        out.push(Recovered { id: id.to_string(), name, modified, size: meta.len() });
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.modified));
    Ok(out)
}

/// Read a snapshot and remove it (the restoring window saves its own).
#[tauri::command]
pub fn recovery_take(app: String, id: String) -> CmdResult<String> {
    let path = file(&app, &id)?;
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(path.with_extension("name"));
    let _ = std::fs::remove_file(path);
    Ok(data)
}
