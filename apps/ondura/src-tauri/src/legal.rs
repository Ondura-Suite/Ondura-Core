//! License texts shipped with Ondura (LICENSE, THIRD-PARTY-NOTICES.txt),
//! shown in Hilfe › Über Ondura.

use tauri::{AppHandle, Manager, path::BaseDirectory};

/// Reads a bundled license file: `license` (GPL text) or `notices`
/// (third-party notices).
#[tauri::command]
pub async fn legal_text(app: AppHandle, which: String) -> Result<String, String> {
    let name = match which.as_str() {
        "license" => "LICENSE.txt",
        "notices" => "THIRD-PARTY-NOTICES.txt",
        _ => return Err("unknown text".into()),
    };
    let path = app.path().resolve(name, BaseDirectory::Resource).map_err(|e| e.to_string())?;
    tokio::fs::read_to_string(&path).await.map_err(|e| format!("{}: {e}", path.display()))
}
