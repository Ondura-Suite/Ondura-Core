//! Start of the per-app programs (and of `ondura.exe` in Windows release
//! builds): load `ondura_core.dll` from the program's folder and run the
//! suite. Which app this is follows from the program's name (see
//! `windows::exe_app` in the app crate).

/// Runs Ondura from `ondura_core.dll`; never returns.
#[cfg(windows)]
pub fn start() -> ! {
    match load_and_run() {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            show_error(&e);
            std::process::exit(1)
        }
    }
}

#[cfg(windows)]
fn load_and_run() -> Result<i32, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LOAD_WITH_ALTERED_SEARCH_PATH, LoadLibraryExW};
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dll = exe.with_file_name("ondura_core.dll");
    let wide: Vec<u16> = dll.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // SAFETY: a NUL-terminated absolute path; the library stays loaded for
    // the lifetime of the process. Dependencies are looked up next to it.
    let module = unsafe { LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), LOAD_WITH_ALTERED_SEARCH_PATH) };
    if module.is_null() {
        return Err(format!("{}: {}", dll.display(), std::io::Error::last_os_error()));
    }
    // SAFETY: `module` is a loaded library and the name is NUL-terminated.
    let entry = unsafe { GetProcAddress(module, c"ondura_main".as_ptr().cast()) }.ok_or_else(|| format!("{}: ondura_main not found", dll.display()))?;
    // SAFETY: ondura_main is `extern "C" fn() -> i32` (apps/ondura/core-dll).
    let entry: extern "C" fn() -> i32 = unsafe { std::mem::transmute(entry) };
    Ok(entry())
}

#[cfg(windows)]
fn show_error(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let text = wide(&format!("Ondura konnte nicht gestartet werden. Bitte installieren Sie Ondura erneut.\n\nOndura could not be started. Please reinstall Ondura.\n\n{message}"));
    let title = wide("Ondura");
    // SAFETY: NUL-terminated buffers that outlive the call.
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

/// Only Windows has separate programs; elsewhere `ondura` runs the suite.
#[cfg(not(windows))]
pub fn start() -> ! {
    eprintln!("The Ondura app programs exist on Windows only; start `ondura --app <app>`.");
    std::process::exit(1)
}
