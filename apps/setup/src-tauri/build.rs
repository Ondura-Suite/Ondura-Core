//! Embeds the NSIS installer built by `apps/nexora` as the payload.
//!
//! `NEXORA_SETUP_PAYLOAD` points to that installer, `NEXORA_SETUP_APP_SIZE`
//! (optional) is the size of the installed `nexora.exe` in bytes and drives
//! the progress bar. Without a payload the setup still builds (for CI checks on
//! Linux) and reports that nothing is embedded.

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=NEXORA_SETUP_PAYLOAD");
    println!("cargo:rerun-if-env-changed=NEXORA_SETUP_APP_SIZE");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("payload.exe");
    match std::env::var("NEXORA_SETUP_PAYLOAD") {
        Ok(path) if !path.is_empty() => {
            println!("cargo:rerun-if-changed={path}");
            std::fs::copy(&path, &out).unwrap_or_else(|e| panic!("cannot read NEXORA_SETUP_PAYLOAD {path}: {e}"));
        }
        _ => std::fs::write(&out, b"").unwrap(),
    }
    let size = std::env::var("NEXORA_SETUP_APP_SIZE").ok().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
    println!("cargo:rustc-env=NEXORA_SETUP_APP_SIZE={size}");
    // The version shown and compared is the one of the embedded suite.
    let conf = "../../nexora/src-tauri/tauri.conf.json";
    println!("cargo:rerun-if-changed={conf}");
    let version = std::fs::read_to_string(conf)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["version"].as_str().map(str::to_string))
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap());
    println!("cargo:rustc-env=NEXORA_VERSION={version}");
    tauri_build::build()
}
