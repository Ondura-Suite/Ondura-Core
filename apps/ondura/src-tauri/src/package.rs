//! Running from an MSIX package (the Microsoft Store build).
//!
//! Windows gives a packaged process a package identity. The Store then
//! installs and updates Ondura, each app has its own Start entry
//! (`Application` in `msix/AppxManifest.xml`), and taskbar buttons and
//! notifications must use the AppUserModelIDs of those entries
//! (`<package family name>!<application id>`).

/// Package family name, if this process runs from an MSIX package.
#[cfg(windows)]
pub fn family_name() -> Option<&'static str> {
    use std::sync::OnceLock;
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFamilyName;
    static NAME: OnceLock<Option<String>> = OnceLock::new();
    NAME.get_or_init(|| {
        let mut len: u32 = 0;
        // SAFETY: the first call only asks for the length (null buffer of length 0).
        let rc = unsafe { GetCurrentPackageFamilyName(&mut len, std::ptr::null_mut()) };
        // ERROR_INSUFFICIENT_BUFFER: packaged; APPMODEL_ERROR_NO_PACKAGE (15700): not.
        if rc != 122 || len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        // SAFETY: `buf` holds `len` UTF-16 units, as the API asked for.
        let rc = unsafe { GetCurrentPackageFamilyName(&mut len, buf.as_mut_ptr()) };
        (rc == 0).then(|| String::from_utf16_lossy(&buf[..buf.iter().position(|c| *c == 0).unwrap_or(buf.len())]))
    })
    .as_deref()
}

#[cfg(not(windows))]
pub fn family_name() -> Option<&'static str> {
    None
}

/// Installed from the Microsoft Store (or another MSIX installation).
pub fn is_packaged() -> bool {
    family_name().is_some()
}

/// `Application Id` in the package manifest of an app's Start entry.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn application_id(app_id: &str) -> &'static str {
    match app_id {
        "mail" => "Mail",
        "text" => "Text",
        "sheets" => "Sheets",
        "slides" => "Slides",
        "pdf" => "Pdf",
        "notes" => "Notes",
        "planner" => "Planner",
        "diagram" => "Diagram",
        "forms" => "Forms",
        _ => "Ondura",
    }
}

/// AppUserModelID of an app's Start entry, when packaged.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn aumid(app_id: &str) -> Option<String> {
    family_name().map(|family| format!("{family}!{}", application_id(app_id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn application_ids_match_the_manifest() {
        let manifest = include_str!("../msix/AppxManifest.xml");
        for (app, _) in crate::windows::APPS {
            let id = application_id(app);
            assert!(manifest.contains(&format!("<Application Id=\"{id}\"")), "{app} → {id} missing in AppxManifest.xml");
        }
        assert!(!is_packaged());
    }
}
