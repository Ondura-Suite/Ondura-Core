//! Windows resources of the per-app programs: icon, manifest and version
//! information with the app's name, which the Task Manager and Explorer show.

use std::path::{Path, PathBuf};

/// (program, icon, name shown by Windows). Keep in sync with `APPS` in
/// src-tauri/src/windows.rs.
const APPS: &[(&str, &str, &str)] = &[
    ("ondura-mail", "mail", "Ondura Mail"),
    ("ondura-text", "text", "Ondura Text"),
    ("ondura-sheets", "sheets", "Ondura Tabellen"),
    ("ondura-slides", "slides", "Ondura Präsentation"),
    ("ondura-pdf", "pdf", "Ondura PDF"),
    ("ondura-notes", "notes", "Ondura Notizen"),
    ("ondura-planner", "planner", "Ondura Planer"),
    ("ondura-diagram", "diagram", "Ondura Diagramme"),
    ("ondura-forms", "forms", "Ondura Formulare"),
];

/// Common controls 6 (modern dialogs), as tauri-build gives `ondura.exe`.
const MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
"#;

fn rc_path(p: &Path) -> String {
    p.display().to_string().replace('\\', "\\\\")
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let icons = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../src-tauri/icons/apps");
    let version = std::env::var("CARGO_PKG_VERSION").unwrap();
    let mut parts: Vec<u16> = version.split(['.', '-', '+']).take(3).map(|p| p.parse().unwrap_or(0)).collect();
    parts.resize(4, 0);
    let numeric = parts.iter().map(u16::to_string).collect::<Vec<_>>().join(",");
    let manifest = out.join("ondura-app.manifest");
    std::fs::write(&manifest, MANIFEST).unwrap();
    for (program, icon, name) in APPS {
        let icon = icons.join(format!("{icon}.ico"));
        println!("cargo:rerun-if-changed={}", icon.display());
        // Numeric ids: 1 ICON, RT_MANIFEST (24) id 1, VS_VERSION_INFO (1).
        let rc = format!(
            r#"#pragma code_page(65001)
1 ICON "{icon}"
1 24 "{manifest}"
1 VERSIONINFO
FILEVERSION {numeric}
PRODUCTVERSION {numeric}
FILEOS 0x40004
FILETYPE 0x1
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040704b0"
    BEGIN
      VALUE "CompanyName", "MirraNET"
      VALUE "FileDescription", "{name}"
      VALUE "FileVersion", "{version}"
      VALUE "InternalName", "{program}"
      VALUE "LegalCopyright", "© Niklas Linz, MirraNET"
      VALUE "OriginalFilename", "{program}.exe"
      VALUE "ProductName", "Ondura"
      VALUE "ProductVersion", "{version}"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x407, 1200
  END
END
"#,
            icon = rc_path(&icon),
            manifest = rc_path(&manifest),
        );
        let path = out.join(format!("{program}.rc"));
        std::fs::write(&path, rc).unwrap();
        let result = embed_resource::compile_for(&path, [program], embed_resource::NONE);
        // Windows builds must have the resources; a check from another
        // system (cross `cargo check`) may lack a resource compiler.
        if cfg!(windows) {
            result.manifest_required().unwrap();
        } else if let Err(e) = result.manifest_optional() {
            panic!("{e}");
        }
    }
}
