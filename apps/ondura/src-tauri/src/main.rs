// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! `ondura`: the start page of the suite, and the program behind file
//! associations and `--app` (each app is passed on to its own program).
//!
//! Windows release builds load the suite from `ondura_core.dll`, like the
//! per-app programs (apps/ondura/launcher), so the code exists once.

#[cfg(all(windows, not(debug_assertions)))]
fn main() {
    ondura_launcher::start();
}

#[cfg(not(all(windows, not(debug_assertions))))]
fn main() {
    std::process::exit(ondura_app::run());
}
