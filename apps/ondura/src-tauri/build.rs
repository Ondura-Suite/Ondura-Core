fn main() {
    // Compiled in by option_env! in src/update.rs.
    println!("cargo:rerun-if-env-changed=NEXORA_UPDATE_PUBKEY");
    tauri_build::build()
}
