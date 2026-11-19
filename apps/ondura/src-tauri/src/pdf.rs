//! Direct PDF export: the platform webview prints the current page (with
//! the app's print CSS) into a file, without a print dialog.
//!
//! Windows uses WebView2's `PrintToPdf`, Linux WebKitGTK's print operation
//! with the "Print to File" backend, macOS a WKWebView print operation whose
//! job is saved to a file (no panels).

use tauri::Webview;
use tokio::sync::oneshot;

type CmdResult<T> = Result<T, String>;

/// Page margins in millimetres (top, right, bottom, left).
type Margins = [f64; 4];

/// Print the calling window to `path` on pages of `width_mm` × `height_mm`.
/// The margins are passed explicitly because WebKitGTK ignores `@page`
/// margins; WebView2 gets the same values.
#[tauri::command]
pub async fn export_pdf(webview: Webview, path: String, width_mm: f64, height_mm: f64, margins_mm: Option<Margins>) -> CmdResult<()> {
    let margins = margins_mm.unwrap_or([0.0; 4]);
    let (tx, rx) = oneshot::channel::<CmdResult<()>>();
    let target = path.clone();
    webview
        .with_webview(move |pw| {
            if let Err(e) = start(pw, &target, width_mm, height_mm, margins, tx) {
                tracing::error!(error = %e, "PDF export could not start");
            }
        })
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(120), rx).await.map_err(|_| ondura_i18n::tr!("Der PDF-Export hat zu lange gedauert.").to_string())?;
    result.map_err(|_| ondura_i18n::tr!("Der PDF-Export wurde abgebrochen.").to_string())??;
    if !std::path::Path::new(&path).exists() {
        return Err(ondura_i18n::tr!("Die PDF-Datei wurde nicht erstellt."));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn start(pw: tauri::webview::PlatformWebview, path: &str, width_mm: f64, height_mm: f64, [top, right, bottom, left]: Margins, tx: oneshot::Sender<CmdResult<()>>) -> Result<(), String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use webkit2gtk::PrintOperationExt;

    let op = webkit2gtk::PrintOperation::new(&pw.inner());
    let settings = gtk::PrintSettings::new();
    settings.set_printer("Print to File");
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
    let uri = gtk::glib::filename_to_uri(path, None).map_err(|e| e.to_string())?;
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
    let setup = gtk::PageSetup::new();
    let landscape = width_mm > height_mm;
    let (w, h) = if landscape { (height_mm, width_mm) } else { (width_mm, height_mm) };
    let paper = gtk::PaperSize::new_custom("ondura", "Ondura", w, h, gtk::Unit::Mm);
    setup.set_paper_size(&paper);
    setup.set_orientation(if landscape { gtk::PageOrientation::Landscape } else { gtk::PageOrientation::Portrait });
    setup.set_top_margin(top, gtk::Unit::Mm);
    setup.set_bottom_margin(bottom, gtk::Unit::Mm);
    setup.set_left_margin(left, gtk::Unit::Mm);
    setup.set_right_margin(right, gtk::Unit::Mm);
    op.set_print_settings(&settings);
    op.set_page_setup(&setup);
    let tx = Rc::new(RefCell::new(Some(tx)));
    let failed = tx.clone();
    op.connect_failed(move |_, e| {
        if let Some(tx) = failed.borrow_mut().take() {
            let _ = tx.send(Err(e.to_string()));
        }
    });
    op.connect_finished(move |_| {
        if let Some(tx) = tx.borrow_mut().take() {
            let _ = tx.send(Ok(()));
        }
    });
    op.print();
    Ok(())
}

#[cfg(windows)]
fn start(pw: tauri::webview::PlatformWebview, path: &str, width_mm: f64, height_mm: f64, [top, right, bottom, left]: Margins, tx: oneshot::Sender<CmdResult<()>>) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, ICoreWebView2_7, ICoreWebView2Environment6};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{HSTRING, Interface};

    let e = |e: windows::core::Error| e.to_string();
    // SAFETY: COM calls on the webview's own (main) thread, as required.
    unsafe {
        let core = pw.controller().CoreWebView2().map_err(e)?;
        let core7: ICoreWebView2_7 = core.cast().map_err(e)?;
        let env6: ICoreWebView2Environment6 = pw.environment().cast().map_err(e)?;
        let settings = env6.CreatePrintSettings().map_err(e)?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(e)?;
        settings.SetPageWidth(width_mm / 25.4).map_err(e)?;
        settings.SetPageHeight(height_mm / 25.4).map_err(e)?;
        settings.SetMarginTop(top / 25.4).map_err(e)?;
        settings.SetMarginBottom(bottom / 25.4).map_err(e)?;
        settings.SetMarginLeft(left / 25.4).map_err(e)?;
        settings.SetMarginRight(right / 25.4).map_err(e)?;
        settings.SetShouldPrintBackgrounds(true).map_err(e)?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(e)?;
        let mut tx = Some(tx);
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            if let Some(tx) = tx.take() {
                let _ = tx.send(match result {
                    Ok(()) if ok => Ok(()),
                    Ok(()) => Err(ondura_i18n::tr!("Die PDF-Datei konnte nicht geschrieben werden.").into()),
                    Err(err) => Err(err.to_string()),
                });
            }
            Ok(())
        }));
        core7.PrintToPdf(&HSTRING::from(path), &settings, &handler).map_err(e)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn start(pw: tauri::webview::PlatformWebview, path: &str, width_mm: f64, height_mm: f64, [top, right, bottom, left]: Margins, tx: oneshot::Sender<CmdResult<()>>) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Sel};
    use objc2::msg_send;
    use objc2_foundation::{NSSize, NSString, NSURL};

    let pt = |mm: f64| mm * 72.0 / 25.4;
    let target = std::path::PathBuf::from(path);
    // A previous export must not count as done.
    let _ = std::fs::remove_file(&target);
    // SAFETY: Objective-C calls on the main thread (with_webview runs there)
    // with the documented argument types; `inner` is the WKWebView.
    unsafe {
        let webview = pw.inner() as *mut AnyObject;
        let webview = webview.as_ref().ok_or("no webview")?;
        let info: Retained<AnyObject> = msg_send![objc2::class!(NSPrintInfo), sharedPrintInfo];
        let info: Retained<AnyObject> = msg_send![&*info, copy];
        let _: () = msg_send![&*info, setPaperSize: NSSize::new(pt(width_mm), pt(height_mm))];
        let _: () = msg_send![&*info, setTopMargin: pt(top)];
        let _: () = msg_send![&*info, setBottomMargin: pt(bottom)];
        let _: () = msg_send![&*info, setLeftMargin: pt(left)];
        let _: () = msg_send![&*info, setRightMargin: pt(right)];
        let _: () = msg_send![&*info, setHorizontallyCentered: false];
        let _: () = msg_send![&*info, setVerticallyCentered: false];
        let _: () = msg_send![&*info, setJobDisposition: objc2_app_kit::NSPrintSaveJob];
        let dict: Retained<AnyObject> = msg_send![&*info, dictionary];
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let _: () = msg_send![&*dict, setObject: &*url, forKey: objc2_app_kit::NSPrintJobSavingURL];

        let op: Option<Retained<AnyObject>> = msg_send![webview, printOperationWithPrintInfo: &*info];
        let op = op.ok_or_else(|| ondura_i18n::tr!("Der PDF-Export wird auf diesem System nicht unterstützt."))?;
        let _: () = msg_send![&*op, setShowsPrintPanel: false];
        let _: () = msg_send![&*op, setShowsProgressPanel: false];
        let window: Option<Retained<AnyObject>> = msg_send![webview, window];
        let window = window.ok_or("no window")?;
        // WKWebView only prints through the modal variant; without panels it
        // just writes the file.
        let _: () = msg_send![&*op, runOperationModalForWindow: &*window, delegate: std::ptr::null::<AnyObject>(), didRunSelector: None::<Sel>, contextInfo: std::ptr::null_mut::<std::ffi::c_void>()];
    }
    // Done when the file exists and has stopped growing.
    std::thread::spawn(move || {
        let mut last = None;
        for _ in 0..1200 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let size = std::fs::metadata(&target).ok().map(|m| m.len()).filter(|n| *n > 0);
            if size.is_some() && size == last {
                let _ = tx.send(Ok(()));
                return;
            }
            last = size;
        }
        let _ = tx.send(Err(ondura_i18n::tr!("Die PDF-Datei wurde nicht erstellt.")));
    });
    Ok(())
}

#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
fn start(_pw: tauri::webview::PlatformWebview, _path: &str, _w: f64, _h: f64, _m: Margins, tx: oneshot::Sender<CmdResult<()>>) -> Result<(), String> {
    let _ = tx.send(Err(ondura_i18n::tr!("Der PDF-Export wird auf diesem System nicht unterstützt.").into()));
    Ok(())
}
