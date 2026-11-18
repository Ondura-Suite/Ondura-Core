//! Commands of the office apps (Ondura Text, Tabellen, Präsentation).

use ondura_office::{docx, odp, ods, odt, pptx, xlsx};
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
    let tmp = format!("{path}.ondura-tmp");
    tokio::fs::write(&tmp, bytes).await.map_err(|e| format!("Die Datei konnte nicht gespeichert werden: {e}"))?;
    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!("Die Datei konnte nicht gespeichert werden (ist sie in einem anderen Programm geöffnet?): {e}"));
    }
    Ok(())
}

/// OpenDocument file (by extension)?
fn is_odf(path: &str, ext: &str) -> bool {
    path.rsplit('.').next().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Run a converter off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> ondura_office::Result<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?.map_err(err)
}

/// Writes a file sent as base64 (exported videos).
#[tauri::command]
pub async fn save_bytes(path: String, data: String) -> CmdResult<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(err)?;
    write_file(&path, &bytes).await
}

/// Reads a text file such as a CSV recipient list. UTF-8 is used when the
/// bytes are valid UTF-8, otherwise Windows-1252 (Excel's CSV default).
#[tauri::command]
pub async fn read_text_file(path: String) -> CmdResult<String> {
    let bytes = read_file(&path).await?;
    Ok(decode_text(&bytes))
}

fn decode_text(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_owned();
    }
    // Windows-1252: like Latin-1 except for 0x80..=0x9F.
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    bytes.iter().map(|&b| if (0x80..0xa0).contains(&b) { HIGH[(b - 0x80) as usize] } else { b as char }).collect()
}

#[tauri::command]
pub async fn text_open(path: String) -> CmdResult<docx::Loaded> {
    let bytes = read_file(&path).await?;
    if is_odf(&path, "odt") { blocking(move || odt::read(&bytes)).await } else { blocking(move || docx::read(&bytes)).await }
}

/// Saves as .docx or .odt; returns what the format could not keep.
#[tauri::command]
pub async fn text_save(path: String, document: docx::Document) -> CmdResult<Vec<String>> {
    let bytes = if is_odf(&path, "odt") { blocking(move || odt::write(&document)).await? } else { blocking(move || docx::write(&document)).await? };
    write_file(&path, &bytes).await?;
    Ok(Vec::new())
}

#[tauri::command]
pub async fn sheets_open(path: String) -> CmdResult<xlsx::Loaded> {
    let bytes = read_file(&path).await?;
    if is_odf(&path, "ods") { blocking(move || ods::read(&bytes)).await } else { blocking(move || xlsx::read(&bytes)).await }
}

/// Saves as .xlsx or .ods; returns what the format could not keep.
#[tauri::command]
pub async fn sheets_save(path: String, workbook: xlsx::Workbook) -> CmdResult<Vec<String>> {
    let (bytes, lost) = if is_odf(&path, "ods") {
        let lost = ods::losses(&workbook);
        (blocking(move || ods::write(&workbook)).await?, lost)
    } else {
        (blocking(move || xlsx::write(&workbook)).await?, Vec::new())
    };
    write_file(&path, &bytes).await?;
    Ok(lost)
}

#[tauri::command]
pub async fn slides_open(path: String) -> CmdResult<pptx::Loaded> {
    let bytes = read_file(&path).await?;
    if is_odf(&path, "odp") { blocking(move || odp::read(&bytes)).await } else { blocking(move || pptx::read(&bytes)).await }
}

/// Saves as .pptx or .odp; returns what the format could not keep.
#[tauri::command]
pub async fn slides_save(path: String, presentation: pptx::Presentation) -> CmdResult<Vec<String>> {
    let (bytes, lost) = if is_odf(&path, "odp") {
        let lost = odp::losses(&presentation);
        (blocking(move || odp::write(&presentation)).await?, lost)
    } else {
        (blocking(move || pptx::write(&presentation)).await?, Vec::new())
    };
    write_file(&path, &bytes).await?;
    Ok(lost)
}

#[cfg(test)]
mod tests {
    use super::decode_text;

    #[test]
    fn decodes_utf8_and_windows_1252() {
        assert_eq!(decode_text("Größe;Straße".as_bytes()), "Größe;Straße");
        assert_eq!(decode_text(&[0x47, 0x72, 0xf6, 0xdf, 0x65, 0x20, 0x80]), "Größe €");
    }
}
