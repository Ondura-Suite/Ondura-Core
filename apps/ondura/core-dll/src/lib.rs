//! `ondura_core.dll`: the whole suite, loaded by `ondura.exe` and the
//! per-app programs (`ondura-mail.exe`, `ondura-text.exe`, …) on Windows.

/// Runs Ondura in the calling process; returns the exit code.
#[unsafe(no_mangle)]
pub extern "C" fn ondura_main() -> i32 {
    // A panic must not unwind into the program that loaded us.
    std::panic::catch_unwind(ondura_app::run).unwrap_or(101)
}
