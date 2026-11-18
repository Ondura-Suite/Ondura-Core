//! OPC package (zip) helpers shared by the three formats.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;

use crate::xml::{self, Element};
use crate::{Error, Result};

/// A read-only view on an OPC package.
pub struct Package {
    parts: BTreeMap<String, Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct Relationship {
    pub id: String,
    pub kind: String,
    pub target: String,
    pub external: bool,
}

impl Package {
    pub fn open(bytes: &[u8]) -> Result<Self> {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| {
            Error::Format("Die Datei ist kein gültiges Office-Dokument (kein ZIP-Archiv).".into())
        })?;
        let mut parts = BTreeMap::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| Error::Format(e.to_string()))?;
            if f.is_dir() {
                continue;
            }
            // Guard against zip bombs: Office parts are rarely above 200 MB.
            if f.size() > 512 * 1024 * 1024 {
                return Err(Error::Format("Ein Teil der Datei ist zu groß.".into()));
            }
            let mut data = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut data)
                .map_err(|e| Error::Format(e.to_string()))?;
            parts.insert(f.name().trim_start_matches('/').to_string(), data);
        }
        Ok(Self { parts })
    }

    /// `true` if the package carries a VBA project (.xlsm/.docm/.pptm).
    pub fn has_vba(&self) -> bool {
        [
            "xl/vbaProject.bin",
            "word/vbaProject.bin",
            "ppt/vbaProject.bin",
        ]
        .iter()
        .any(|p| self.has(p))
    }

    pub fn part(&self, name: &str) -> Option<&[u8]> {
        self.parts
            .get(name.trim_start_matches('/'))
            .map(Vec::as_slice)
    }

    pub fn xml(&self, name: &str) -> Result<Option<Element>> {
        self.part(name).map(xml::parse).transpose()
    }

    pub fn has(&self, name: &str) -> bool {
        self.parts.contains_key(name.trim_start_matches('/'))
    }

    /// Relationships of a part (`word/document.xml` → `word/_rels/document.xml.rels`).
    /// Targets are resolved to package paths.
    pub fn rels(&self, part: &str) -> Result<Vec<Relationship>> {
        let (dir, file) = match part.rfind('/') {
            Some(i) => (&part[..i], &part[i + 1..]),
            None => ("", part),
        };
        let rels_name = if dir.is_empty() {
            format!("_rels/{file}.rels")
        } else {
            format!("{dir}/_rels/{file}.rels")
        };
        let Some(root) = self.xml(&rels_name)? else {
            return Ok(Vec::new());
        };
        Ok(root
            .elements()
            .filter(|e| e.name.ends_with("Relationship"))
            .map(|e| {
                let external = e.attr("TargetMode") == Some("External");
                let target = e.attr("Target").unwrap_or_default().to_string();
                Relationship {
                    id: e.attr("Id").unwrap_or_default().to_string(),
                    kind: e
                        .attr("Type")
                        .unwrap_or_default()
                        .rsplit('/')
                        .next()
                        .unwrap_or_default()
                        .to_string(),
                    target: if external {
                        target
                    } else {
                        resolve(dir, &target)
                    },
                    external,
                }
            })
            .collect())
    }

    /// Target of the package-level relationship of the given kind (e.g. `officeDocument`).
    pub fn main_part(&self, kind: &str) -> Result<Option<String>> {
        Ok(self
            .rels("")?
            .into_iter()
            .find(|r| r.kind == kind)
            .map(|r| r.target))
    }
}

/// Resolve a relative relationship target against the source part's directory.
pub fn resolve(dir: &str, target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        return abs.to_string();
    }
    let mut parts: Vec<&str> = if dir.is_empty() {
        Vec::new()
    } else {
        dir.split('/').collect()
    };
    for seg in target.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

pub fn mime_for(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("emf") => "image/x-emf",
        Some("wmf") => "image/x-wmf",
        Some("tif" | "tiff") => "image/tiff",
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("wmv") => "video/x-ms-wmv",
        Some("avi") => "video/x-msvideo",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("ogg" | "oga") => "audio/ogg",
        Some("weba") => "audio/webm",
        Some("wma") => "audio/x-ms-wma",
        _ => "application/octet-stream",
    }
}

pub fn ext_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpeg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "video/x-ms-wmv" => "wmv",
        "video/x-msvideo" => "avi",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/ogg" => "ogg",
        "audio/webm" => "weba",
        "audio/x-ms-wma" => "wma",
        _ => "bin",
    }
}

/// `data:` URL for embedded media.
pub fn data_url(mime: &str, data: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    )
}

/// Decode a `data:` URL into (mime, bytes).
pub fn parse_data_url(url: &str) -> Option<(String, Vec<u8>)> {
    use base64::Engine;
    let rest = url.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let mime = meta
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = if meta.ends_with(";base64") {
        base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .ok()?
    } else {
        data.as_bytes().to_vec()
    };
    Some((mime, bytes))
}

/// Builder for a new package.
#[derive(Default)]
pub struct PackageWriter {
    parts: Vec<(String, Vec<u8>)>,
    overrides: Vec<(String, String)>,
    defaults: BTreeMap<String, String>,
}

impl PackageWriter {
    pub fn new() -> Self {
        let mut w = Self::default();
        w.defaults.insert(
            "rels".into(),
            "application/vnd.openxmlformats-package.relationships+xml".into(),
        );
        w.defaults.insert("xml".into(), "application/xml".into());
        w
    }

    /// Add a part; `content_type` registers an override for it.
    pub fn add(&mut self, name: &str, content_type: Option<&str>, data: impl Into<Vec<u8>>) {
        if let Some(ct) = content_type {
            self.overrides.push((format!("/{name}"), ct.to_string()));
        }
        self.parts.push((name.to_string(), data.into()));
    }

    pub fn add_media(&mut self, name: &str, mime: &str, data: Vec<u8>) {
        let ext = name.rsplit('.').next().unwrap_or("bin").to_string();
        self.defaults.entry(ext).or_insert_with(|| mime.to_string());
        self.parts.push((name.to_string(), data));
    }

    pub fn finish(self) -> Result<Vec<u8>> {
        let mut ct = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#,
        );
        for (ext, mime) in &self.defaults {
            ct.push_str(&format!(
                r#"<Default Extension="{}" ContentType="{}"/>"#,
                xml::esc(ext),
                xml::esc(mime)
            ));
        }
        for (part, mime) in &self.overrides {
            ct.push_str(&format!(
                r#"<Override PartName="{}" ContentType="{}"/>"#,
                xml::esc(part),
                xml::esc(mime)
            ));
        }
        ct.push_str("</Types>");
        let mut out = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut out);
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("[Content_Types].xml", opts)
                .map_err(|e| Error::Format(e.to_string()))?;
            zip.write_all(ct.as_bytes())?;
            for (name, data) in &self.parts {
                zip.start_file(name.as_str(), opts)
                    .map_err(|e| Error::Format(e.to_string()))?;
                zip.write_all(data)?;
            }
            zip.finish().map_err(|e| Error::Format(e.to_string()))?;
        }
        Ok(out.into_inner())
    }
}

/// Serialise a relationships part.
pub fn rels_xml(rels: &[(String, String, String, bool)]) -> String {
    let mut s = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (id, kind, target, external) in rels {
        s.push_str(&format!(
            r#"<Relationship Id="{}" Type="{}" Target="{}"{}/>"#,
            xml::esc(id),
            xml::esc(kind),
            xml::esc(target),
            if *external {
                r#" TargetMode="External""#
            } else {
                ""
            }
        ));
    }
    s.push_str("</Relationships>");
    s
}

pub const REL_OFFICE_DOCUMENT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
pub const REL_CORE: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
pub const REL_IMAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
pub const REL_HYPERLINK: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
pub const REL_STYLES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";

/// docProps/core.xml with title and author.
pub fn core_xml(title: &str, author: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{}</dc:title><dc:creator>{}</dc:creator></cp:coreProperties>"#,
        xml::esc(title),
        xml::esc(author)
    )
}

/// (title, author) from docProps/core.xml.
pub fn read_core(pkg: &Package) -> (String, String) {
    let Ok(Some(core)) = pkg.xml("docProps/core.xml") else {
        return Default::default();
    };
    (
        core.find("dc:title").map(|e| e.text()).unwrap_or_default(),
        core.find("dc:creator")
            .map(|e| e.text())
            .unwrap_or_default(),
    )
}
