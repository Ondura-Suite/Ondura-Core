//! Desktop notifications that open what they announce when clicked: a new
//! mail opens in its own window, several new mails open Ondura Mail, a
//! reminder opens the calendar or the tasks.
//!
//! Windows shows the toast itself (WinRT) to receive the click; other
//! systems use the notification plugin (a click focuses the app there).

use tauri::AppHandle;

/// What a click on the notification opens.
// Only Windows reports the click to the app.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone)]
pub enum Target {
    Message { id: String, title: String },
    App(&'static str),
}

#[cfg_attr(not(windows), allow(dead_code))]
fn open(app: &AppHandle, target: &Target) {
    let r = match target {
        Target::Message { id, title } => crate::windows::open_message_window(app, id, title),
        Target::App(id) => crate::windows::open_app_window(app, id),
    };
    if let Err(e) = r {
        tracing::warn!(error = %e, "could not open the target of a notification");
    }
}

#[cfg(windows)]
pub fn show(app: &AppHandle, title: &str, body: &str, target: Target) {
    use tauri_winrt_notification::Toast;
    // The same AUMID as the notification plugin (installed with the shortcuts).
    let id = app.config().identifier.clone();
    let handle = app.clone();
    let result = Toast::new(&id)
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            // Windows calls this on a COM thread; windows are created on the main thread.
            let h = handle.clone();
            let t = target.clone();
            let _ = handle.run_on_main_thread(move || open(&h, &t));
            Ok(())
        })
        .show();
    if let Err(e) = result {
        tracing::warn!(error = %e, "toast notification failed");
    }
}

#[cfg(not(windows))]
pub fn show(app: &AppHandle, title: &str, body: &str, _target: Target) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}
