//! Printing without the browser's print dialog: the office apps show their
//! own print view (printer, copies, pages, duplex, preview) and print with
//! these settings directly.
//!
//! Windows prints the current page through WebView2's `Print` with explicit
//! print settings (no browser header/footer). Linux and macOS export the
//! page into a temporary PDF (see `pdf.rs`) and hand it to CUPS (`lp`).

use serde::{Deserialize, Serialize};
use tauri::Webview;

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printer {
    pub name: String,
    pub is_default: bool,
}

/// Print settings chosen in the print view.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettings {
    /// Printer name; empty = default printer.
    #[serde(default)]
    pub printer: String,
    #[serde(default = "one")]
    pub copies: u32,
    /// Page ranges like `1-3,5`; empty = all pages.
    #[serde(default)]
    pub pages: String,
    /// `none`, `long` (flip on long edge) or `short`.
    #[serde(default)]
    pub duplex: String,
    #[serde(default = "yes")]
    pub collate: bool,
    #[serde(default = "yes")]
    pub color: bool,
    #[serde(default = "one")]
    pub pages_per_sheet: u32,
    pub width_mm: f64,
    pub height_mm: f64,
    #[serde(default)]
    pub margins_mm: Option<[f64; 4]>,
}

fn one() -> u32 {
    1
}
fn yes() -> bool {
    true
}

/// Only digits, commas, dashes and spaces may reach the printer.
pub fn clean_ranges(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit() || *c == ',' || *c == '-').collect()
}

/// Installed printers, the default one first.
#[tauri::command]
pub async fn printers_list() -> CmdResult<Vec<Printer>> {
    let mut list = tokio::task::spawn_blocking(list_printers).await.map_err(|e| e.to_string())??;
    list.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(list)
}

/// A path for a temporary file in the system's temp folder.
#[tauri::command]
pub fn temp_file(ext: String) -> String {
    let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    std::env::temp_dir().join(format!("ondura-{}.{ext}", uuid::Uuid::new_v4())).to_string_lossy().into_owned()
}

/// Deletes a temporary file made by [`temp_file`] (other paths are ignored).
#[tauri::command]
pub fn temp_remove(path: String) {
    let p = std::path::Path::new(&path);
    let ours = p.parent() == Some(std::env::temp_dir().as_path()) && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("ondura-"));
    if ours {
        let _ = std::fs::remove_file(p);
    }
}

/// Print the calling window (its print CSS) with `settings`.
#[tauri::command]
pub async fn print_page(webview: Webview, settings: PrintSettings) -> CmdResult<()> {
    print_impl(webview, settings).await
}

/// Print an existing PDF file (Ondura PDF on Linux/macOS).
#[tauri::command]
pub async fn print_pdf_file(path: String, settings: PrintSettings) -> CmdResult<()> {
    #[cfg(unix)]
    {
        tokio::task::spawn_blocking(move || lp(&path, &settings)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(unix))]
    {
        let _ = (path, settings);
        Err("not supported".into())
    }
}

// ----------------------------------------------------------------- unix --

#[cfg(unix)]
fn list_printers() -> CmdResult<Vec<Printer>> {
    use std::process::Command;
    let default = Command::new("lpstat")
        .arg("-d")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .and_then(|s| s.rsplit_once(':').map(|(_, d)| d.trim().to_string()))
        .unwrap_or_default();
    let out = Command::new("lpstat").arg("-e").output().map_err(|_| ondura_i18n::tr!("Kein Drucksystem (CUPS) gefunden."))?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|name| Printer { name: name.to_string(), is_default: name == default })
        .collect())
}

/// `lp` arguments for the settings (without the file).
#[cfg(any(unix, test))]
pub fn lp_args(s: &PrintSettings) -> Vec<String> {
    let mut a = Vec::new();
    if !s.printer.is_empty() {
        a.push("-d".into());
        a.push(s.printer.clone());
    }
    a.push("-n".into());
    a.push(s.copies.clamp(1, 999).to_string());
    let pages = clean_ranges(&s.pages);
    if !pages.is_empty() {
        a.push("-o".into());
        a.push(format!("page-ranges={pages}"));
    }
    a.push("-o".into());
    a.push(
        match s.duplex.as_str() {
            "long" => "sides=two-sided-long-edge",
            "short" => "sides=two-sided-short-edge",
            _ => "sides=one-sided",
        }
        .into(),
    );
    if s.copies > 1 {
        a.push("-o".into());
        a.push(format!("collate={}", s.collate));
    }
    if !s.color {
        a.push("-o".into());
        a.push("print-color-mode=monochrome".into());
    }
    if s.pages_per_sheet > 1 {
        a.push("-o".into());
        a.push(format!("number-up={}", s.pages_per_sheet));
    }
    a
}

#[cfg(unix)]
fn lp(file: &str, s: &PrintSettings) -> CmdResult<()> {
    let out = std::process::Command::new("lp")
        .args(lp_args(s))
        .arg("--")
        .arg(file)
        .output()
        .map_err(|_| ondura_i18n::tr!("Kein Drucksystem (CUPS) gefunden."))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(unix)]
async fn print_impl(webview: Webview, s: PrintSettings) -> CmdResult<()> {
    let tmp = temp_file("pdf".into());
    crate::pdf::export_pdf(webview, tmp.clone(), s.width_mm, s.height_mm, s.margins_mm).await?;
    let file = tmp.clone();
    let r = tokio::task::spawn_blocking(move || lp(&file, &s)).await.map_err(|e| e.to_string())?;
    // CUPS copies the file when the job is queued.
    let _ = std::fs::remove_file(&tmp);
    r
}

// -------------------------------------------------------------- windows --

#[cfg(windows)]
fn list_printers() -> CmdResult<Vec<Printer>> {
    use windows_sys::Win32::Graphics::Printing::{EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W};
    let wide = |p: *const u16| -> String {
        if p.is_null() {
            return String::new();
        }
        // SAFETY: null-terminated string owned by the buffer filled by the API.
        unsafe {
            let len = (0..).take_while(|&i| *p.add(i) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
        }
    };
    // SAFETY: two-call pattern; the buffer is sized by the first call and
    // aligned for PRINTER_INFO_4W (u64 storage).
    unsafe {
        let mut len = 0u32;
        GetDefaultPrinterW(std::ptr::null_mut(), &mut len);
        let mut def = vec![0u16; len.max(1) as usize];
        let default = if GetDefaultPrinterW(def.as_mut_ptr(), &mut len) != 0 { wide(def.as_ptr()) } else { String::new() };
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut needed, mut count) = (0u32, 0u32);
        EnumPrintersW(flags, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut count);
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
        if EnumPrintersW(flags, std::ptr::null(), 4, buf.as_mut_ptr().cast(), needed, &mut needed, &mut count) == 0 {
            return Err(ondura_i18n::tr!("Die Drucker konnten nicht gelesen werden."));
        }
        let infos = std::slice::from_raw_parts(buf.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize);
        Ok(infos
            .iter()
            .map(|i| {
                let name = wide(i.pPrinterName);
                Printer { is_default: name == default, name }
            })
            .collect())
    }
}

#[cfg(windows)]
async fn print_impl(webview: Webview, s: PrintSettings) -> CmdResult<()> {
    let (tx, rx) = tokio::sync::oneshot::channel::<CmdResult<()>>();
    webview
        .with_webview(move |pw| {
            if let Err(e) = start_print(pw, &s, tx) {
                tracing::error!(error = %e, "printing could not start");
            }
        })
        .map_err(|e| e.to_string())?;
    let r = tokio::time::timeout(std::time::Duration::from_secs(300), rx).await.map_err(|_| ondura_i18n::tr!("Der Druckauftrag hat zu lange gedauert.").to_string())?;
    r.map_err(|_| ondura_i18n::tr!("Der Druckauftrag wurde abgebrochen.").to_string())?
}

#[cfg(windows)]
fn start_print(pw: tauri::webview::PlatformWebview, s: &PrintSettings, tx: tokio::sync::oneshot::Sender<CmdResult<()>>) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_COLLATION_COLLATED, COREWEBVIEW2_PRINT_COLLATION_UNCOLLATED, COREWEBVIEW2_PRINT_COLOR_MODE_COLOR, COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE, COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
        COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE, COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE,
        COREWEBVIEW2_PRINT_STATUS_SUCCEEDED, ICoreWebView2_16, ICoreWebView2Environment6, ICoreWebView2PrintSettings2,
    };
    use webview2_com::PrintCompletedHandler;
    use windows::core::{HSTRING, Interface};

    let e = |e: windows::core::Error| e.to_string();
    let [top, right, bottom, left] = s.margins_mm.unwrap_or([0.0; 4]);
    // SAFETY: COM calls on the webview's own (main) thread, as required.
    unsafe {
        let core = pw.controller().CoreWebView2().map_err(e)?;
        let core16: ICoreWebView2_16 = core.cast().map_err(e)?;
        let env6: ICoreWebView2Environment6 = pw.environment().cast().map_err(e)?;
        let settings = env6.CreatePrintSettings().map_err(e)?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(e)?;
        settings.SetPageWidth(s.width_mm / 25.4).map_err(e)?;
        settings.SetPageHeight(s.height_mm / 25.4).map_err(e)?;
        settings.SetMarginTop(top / 25.4).map_err(e)?;
        settings.SetMarginBottom(bottom / 25.4).map_err(e)?;
        settings.SetMarginLeft(left / 25.4).map_err(e)?;
        settings.SetMarginRight(right / 25.4).map_err(e)?;
        settings.SetShouldPrintBackgrounds(true).map_err(e)?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(e)?;
        let s2: ICoreWebView2PrintSettings2 = settings.cast().map_err(e)?;
        if !s.printer.is_empty() {
            s2.SetPrinterName(&HSTRING::from(s.printer.as_str())).map_err(e)?;
        }
        s2.SetCopies(s.copies.clamp(1, 999) as i32).map_err(e)?;
        let pages = clean_ranges(&s.pages);
        if !pages.is_empty() {
            s2.SetPageRanges(&HSTRING::from(pages.as_str())).map_err(e)?;
        }
        s2.SetDuplex(match s.duplex.as_str() {
            "long" => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
            "short" => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
            _ => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
        })
        .map_err(e)?;
        s2.SetCollation(if s.collate { COREWEBVIEW2_PRINT_COLLATION_COLLATED } else { COREWEBVIEW2_PRINT_COLLATION_UNCOLLATED }).map_err(e)?;
        s2.SetColorMode(if s.color { COREWEBVIEW2_PRINT_COLOR_MODE_COLOR } else { COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE }).map_err(e)?;
        s2.SetPagesPerSide(s.pages_per_sheet.clamp(1, 16) as i32).map_err(e)?;
        let mut tx = Some(tx);
        let handler = PrintCompletedHandler::create(Box::new(move |result, status| {
            if let Some(tx) = tx.take() {
                let _ = tx.send(match result {
                    Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED => Ok(()),
                    Ok(()) if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE => Err(ondura_i18n::tr!("Der Drucker ist nicht verfügbar.").into()),
                    Ok(()) => Err(ondura_i18n::tr!("Der Druckauftrag ist fehlgeschlagen.").into()),
                    Err(err) => Err(err.to_string()),
                });
            }
            Ok(())
        }));
        core16.Print(&settings, &handler).map_err(e)?;
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn list_printers() -> CmdResult<Vec<Printer>> {
    Ok(Vec::new())
}

#[cfg(not(any(unix, windows)))]
async fn print_impl(_webview: Webview, _s: PrintSettings) -> CmdResult<()> {
    Err("not supported".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> PrintSettings {
        serde_json::from_value(serde_json::json!({ "printer": "Büro", "copies": 2, "pages": "1-3, 5;rm", "duplex": "long", "color": false, "pagesPerSheet": 2, "widthMm": 210.0, "heightMm": 297.0 })).unwrap()
    }

    #[test]
    fn ranges_are_sanitised() {
        assert_eq!(clean_ranges("1-3, 5;rm -rf"), "1-3,5-");
    }

    #[test]
    fn lp_arguments() {
        let a = lp_args(&settings()).join(" ");
        assert_eq!(a, "-d Büro -n 2 -o page-ranges=1-3,5 -o sides=two-sided-long-edge -o collate=true -o print-color-mode=monochrome -o number-up=2");
    }
}
