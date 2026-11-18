//! Print the model of an office document as JSON (for debugging imports):
//! `cargo run -p ondura-office --example dump -- datei.odt`

use ondura_office::{docx, odp, ods, odt, pptx, xlsx};

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("Usage: dump <file>");
        std::process::exit(2);
    };
    let bytes = std::fs::read(&path).expect("read file");
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let json = match ext.as_str() {
        "docx" => serde_json::to_string_pretty(&docx::read(&bytes).expect("parse")),
        "odt" => serde_json::to_string_pretty(&odt::read(&bytes).expect("parse")),
        "xlsx" | "xlsm" => serde_json::to_string_pretty(&xlsx::read(&bytes).expect("parse")),
        "ods" => serde_json::to_string_pretty(&ods::read(&bytes).expect("parse")),
        "pptx" => serde_json::to_string_pretty(&pptx::read(&bytes).expect("parse")),
        "odp" => serde_json::to_string_pretty(&odp::read(&bytes).expect("parse")),
        _ => {
            eprintln!("Unknown format: {ext}");
            std::process::exit(2);
        }
    };
    println!("{}", json.expect("serialise"));
}
