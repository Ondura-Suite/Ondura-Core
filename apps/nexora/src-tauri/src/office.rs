//! Commands of the office apps (Nexora Text, Tabellen, Präsentation).

use nexora_office::docx;
use tauri::AppHandle;

use crate::windows;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Open a document (or a new, empty one) in a new window of its app.
#[tauri::command]
pub async fn open_document(app: AppHandle, app_id: String, path: Option<String>) -> CmdResult<()> {
    let app_id = path.as_deref().and_then(windows::app_for_file).map(String::from).unwrap_or(app_id);
    windows::open_document_window(&app, &app_id, path.as_deref()).map_err(err)
}

async fn read_file(path: &str) -> CmdResult<Vec<u8>> {
    tokio::fs::read(path).await.map_err(|e| format!("Die Datei konnte nicht gelesen werden: {e}"))
}

/// Write via a temporary file, so a failed save never destroys the original.
async fn write_file(path: &str, bytes: &[u8]) -> CmdResult<()> {
    let tmp = format!("{path}.nexora-tmp");
    tokio::fs::write(&tmp, bytes).await.map_err(|e| format!("Die Datei konnte nicht gespeichert werden: {e}"))?;
    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!("Die Datei konnte nicht gespeichert werden (ist sie in einem anderen Programm geöffnet?): {e}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn text_open(path: String) -> CmdResult<docx::Loaded> {
    let bytes = read_file(&path).await?;
    tauri::async_runtime::spawn_blocking(move || docx::read(&bytes)).await.map_err(err)?.map_err(err)
}

#[tauri::command]
pub async fn text_save(path: String, document: docx::Document) -> CmdResult<()> {
    let bytes = tauri::async_runtime::spawn_blocking(move || docx::write(&document)).await.map_err(err)?.map_err(err)?;
    write_file(&path, &bytes).await
}
