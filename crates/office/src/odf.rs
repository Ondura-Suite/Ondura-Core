//! Shared OpenDocument (ODF 1.3) helpers: packages, lengths, colours and
//! style lookup. The format modules are [`crate::odt`], [`crate::ods`] and
//! [`crate::odp`].

use std::collections::HashMap;
use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;

use crate::package::Package;
use crate::xml::{Element, esc};
use crate::{Error, Result};

/// Namespace declarations for the root element of every ODF part.
pub(crate) const NS: &str = concat!(
    r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" "#,
    r#"xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" "#,
    r#"xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" "#,
    r#"xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" "#,
    r#"xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" "#,
    r#"xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" "#,
    r#"xmlns:xlink="http://www.w3.org/1999/xlink" "#,
    r#"xmlns:dc="http://purl.org/dc/elements/1.1/" "#,
    r#"xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" "#,
    r#"xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" "#,
    r#"xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" "#,
    r#"xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" "#,
    r#"xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0" "#,
    r#"xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" "#,
    r#"xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" "#,
    r#"office:version="1.3""#
);

pub(crate) const MIME_TEXT: &str = "application/vnd.oasis.opendocument.text";
pub(crate) const MIME_SHEET: &str = "application/vnd.oasis.opendocument.spreadsheet";
pub(crate) const MIME_SLIDES: &str = "application/vnd.oasis.opendocument.presentation";

/// An opened ODF package with its main parts parsed.
pub(crate) struct OdfDoc {
    pub pkg: Package,
    pub content: Element,
    pub styles: Option<Element>,
    pub meta: Option<Element>,
}

impl OdfDoc {
    pub fn open(bytes: &[u8], mime: &str, what: &str) -> Result<Self> {
        let pkg = Package::open(bytes)?;
        if let Some(m) = pkg.part("mimetype") {
            let m = String::from_utf8_lossy(m);
            if !m.trim().starts_with(mime) {
                return Err(Error::Format(format!(
                    "Die Datei ist kein OpenDocument-{what}."
                )));
            }
        }
        let content = pkg
            .xml("content.xml")?
            .ok_or_else(|| Error::Format(format!("Kein OpenDocument-{what} gefunden.")))?;
        let styles = pkg.xml("styles.xml")?;
        let meta = pkg.xml("meta.xml")?;
        Ok(Self {
            pkg,
            content,
            styles,
            meta,
        })
    }

    /// Title and author from meta.xml.
    pub fn meta(&self) -> (String, String) {
        let m = self.meta.as_ref().and_then(|m| m.child("office:meta"));
        let get = |n: &str| {
            m.and_then(|m| m.child(n))
                .map(|e| e.text().trim().to_string())
                .unwrap_or_default()
        };
        let author = Some(get("meta:initial-creator"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| get("dc:creator"));
        (get("dc:title"), author)
    }

    /// An embedded file (`Pictures/…`) as a data URL.
    pub fn data_url(&self, href: &str) -> Option<String> {
        let href = href.trim_start_matches("./");
        let data = self.pkg.part(href)?;
        Some(crate::package::data_url(
            crate::package::mime_for(href),
            data,
        ))
    }

    /// Styles for the document body (content.xml automatic styles win).
    pub fn styles(&self) -> Styles {
        self.build_styles(false)
    }

    /// Styles for master-page content (styles.xml automatic styles win).
    pub fn master_styles(&self) -> Styles {
        self.build_styles(true)
    }

    fn build_styles(&self, master: bool) -> Styles {
        let mut s = Styles::default();
        let content_auto = self.content.child("office:automatic-styles");
        let styles_auto = self
            .styles
            .as_ref()
            .and_then(|st| st.child("office:automatic-styles"));
        for decls in self
            .styles
            .iter()
            .chain(std::iter::once(&self.content))
            .flat_map(|r| r.children_named("office:font-face-decls"))
        {
            s.read_fonts(decls);
        }
        if let Some(c) = self
            .styles
            .as_ref()
            .and_then(|st| st.child("office:styles"))
        {
            s.read(c, false);
        }
        let (first, last) = if master {
            (content_auto, styles_auto)
        } else {
            (styles_auto, content_auto)
        };
        for c in [first, last].into_iter().flatten() {
            s.read(c, true);
        }
        s
    }
}

/// One `style:style` (or default style), with all formatting properties
/// merged into one attribute map.
#[derive(Debug, Clone, Default)]
pub(crate) struct StyleDef {
    /// Automatic style (direct formatting) rather than a named style.
    pub automatic: bool,
    pub parent: Option<String>,
    pub display: String,
    pub props: HashMap<String, String>,
    pub master_page: Option<String>,
    pub list_style: Option<String>,
    pub data_style: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct Styles {
    /// (family, name) → style
    pub map: HashMap<(String, String), StyleDef>,
    /// family → default style
    pub defaults: HashMap<String, StyleDef>,
    /// font face name → family
    pub fonts: HashMap<String, String>,
    /// list style → ordered per level (0-based)
    pub lists: HashMap<String, Vec<bool>>,
    /// page layout name → properties
    pub page_layouts: HashMap<String, HashMap<String, String>>,
    /// number style name → element
    pub number_styles: HashMap<String, Element>,
}

impl Styles {
    fn read_fonts(&mut self, decls: &Element) {
        for f in decls.children_named("style:font-face") {
            if let (Some(n), Some(fam)) = (f.attr("style:name"), f.attr("svg:font-family")) {
                self.fonts.insert(
                    n.to_string(),
                    fam.trim_matches(|c| c == '\'' || c == '"').to_string(),
                );
            }
        }
    }

    fn props(e: &Element) -> HashMap<String, String> {
        let mut m = HashMap::new();
        // `loext:graphic-properties` (table cells) arrives without prefix.
        for p in e.elements().filter(|c| {
            c.name.ends_with("-properties")
                && (c.name.starts_with("style:") || !c.name.contains(':'))
        }) {
            for (k, v) in &p.attrs {
                m.entry(k.clone()).or_insert_with(|| v.clone());
            }
            // Background images, tab stops etc. are ignored.
        }
        m
    }

    fn read(&mut self, root: &Element, automatic: bool) {
        for e in root.elements() {
            match e.name.as_str() {
                "style:style" => {
                    let (Some(name), Some(family)) = (e.attr("style:name"), e.attr("style:family"))
                    else {
                        continue;
                    };
                    let def = StyleDef {
                        automatic,
                        parent: e.attr("style:parent-style-name").map(String::from),
                        display: e
                            .attr("style:display-name")
                            .map(String::from)
                            .unwrap_or_else(|| name.replace("_20_", " ")),
                        props: Self::props(e),
                        master_page: e
                            .attr("style:master-page-name")
                            .filter(|m| !m.is_empty())
                            .map(String::from),
                        list_style: e.attr("style:list-style-name").map(String::from),
                        data_style: e.attr("style:data-style-name").map(String::from),
                    };
                    self.map.insert((family.to_string(), name.to_string()), def);
                }
                "style:default-style" => {
                    if let Some(family) = e.attr("style:family") {
                        self.defaults.insert(
                            family.to_string(),
                            StyleDef {
                                props: Self::props(e),
                                ..Default::default()
                            },
                        );
                    }
                }
                "text:list-style" => {
                    let Some(name) = e.attr("style:name") else {
                        continue;
                    };
                    let mut levels = vec![false; 10];
                    for l in e.elements() {
                        let lvl: usize = l
                            .attr("text:level")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(1);
                        if (1..=10).contains(&lvl) {
                            levels[lvl - 1] = l.name == "text:list-level-style-number";
                        }
                    }
                    self.lists.insert(name.to_string(), levels);
                }
                "style:page-layout" => {
                    if let Some(name) = e.attr("style:name") {
                        let mut props = Self::props(e);
                        if let Some(h) = e
                            .child("style:header-style")
                            .and_then(|h| h.child("style:header-footer-properties"))
                        {
                            for (k, v) in &h.attrs {
                                props.insert(format!("header:{k}"), v.clone());
                            }
                        }
                        if let Some(h) = e
                            .child("style:footer-style")
                            .and_then(|h| h.child("style:header-footer-properties"))
                        {
                            for (k, v) in &h.attrs {
                                props.insert(format!("footer:{k}"), v.clone());
                            }
                        }
                        self.page_layouts.insert(name.to_string(), props);
                    }
                }
                n if n.starts_with("number:") && n.ends_with("-style") => {
                    if let Some(name) = e.attr("style:name") {
                        self.number_styles.insert(name.to_string(), e.clone());
                    }
                }
                _ => {}
            }
        }
    }

    pub fn style(&self, family: &str, name: &str) -> Option<&StyleDef> {
        self.map.get(&(family.to_string(), name.to_string()))
    }

    /// A property of a style, following parents and the family default.
    pub fn get(&self, family: &str, name: Option<&str>, attr: &str) -> Option<&str> {
        let mut cur = name;
        let mut guard = 0;
        while let Some(n) = cur {
            let Some(s) = self.style(family, n) else {
                break;
            };
            if let Some(v) = s.props.get(attr) {
                return Some(v);
            }
            cur = s.parent.as_deref();
            guard += 1;
            if guard > 32 {
                break;
            }
        }
        self.defaults
            .get(family)
            .and_then(|d| d.props.get(attr))
            .map(String::as_str)
    }

    /// Display names of a style and its parents (`Heading 1`, `Heading`, …).
    pub fn chain(&self, family: &str, name: Option<&str>) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = name;
        while let Some(n) = cur {
            let Some(s) = self.style(family, n) else {
                out.push(n.replace("_20_", " "));
                break;
            };
            out.push(s.display.clone());
            cur = s.parent.as_deref();
            if out.len() > 32 {
                break;
            }
        }
        out
    }

    /// First of a style's chain that names a list style.
    pub fn list_style(&self, family: &str, name: Option<&str>) -> Option<&str> {
        let mut cur = name;
        for _ in 0..32 {
            let s = self.style(family, cur?)?;
            if let Some(l) = &s.list_style {
                return Some(l);
            }
            cur = s.parent.as_deref();
        }
        None
    }

    pub fn font(&self, family: &str, name: Option<&str>) -> Option<String> {
        self.get(family, name, "style:font-name")
            .map(|f| self.fonts.get(f).cloned().unwrap_or_else(|| f.to_string()))
            .or_else(|| {
                self.get(family, name, "fo:font-family")
                    .map(|f| f.trim_matches('\'').to_string())
            })
    }
}

// --------------------------------------------------------------- values --

/// An ODF length (`2cm`, `12pt`, `0.5in`, …) in millimetres.
pub(crate) fn mm(s: &str) -> Option<f64> {
    let s = s.trim();
    let split = s.find(|c: char| c.is_ascii_alphabetic() || c == '%')?;
    let (num, unit) = s.split_at(split);
    let v: f64 = num.trim().parse().ok()?;
    Some(match unit {
        "mm" => v,
        "cm" => v * 10.0,
        "in" | "inch" => v * 25.4,
        "pt" => v * 25.4 / 72.0,
        "pc" => v * 25.4 / 6.0,
        "px" => v * 25.4 / 96.0,
        _ => return None,
    })
}

pub(crate) fn pt(s: &str) -> Option<f64> {
    mm(s).map(|v| v * 72.0 / 25.4)
}

/// CSS pixels at 96 dpi.
pub(crate) fn px(s: &str) -> Option<f64> {
    mm(s).map(|v| v * 96.0 / 25.4)
}

pub(crate) fn cm(mm: f64) -> String {
    format!("{:.3}cm", mm / 10.0)
}

pub(crate) fn cm_px(px: f64) -> String {
    cm(px * 25.4 / 96.0)
}

/// `#RRGGBB` → `#rrggbb`; `transparent` → None.
pub(crate) fn color(s: &str) -> Option<String> {
    let s = s.trim();
    (s.starts_with('#') && s.len() == 7).then(|| s.to_ascii_lowercase())
}

/// Text with ODF whitespace: runs of spaces become `text:s`, tabs `text:tab`
/// and newlines `text:line-break`.
pub(crate) fn text_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut spaces = 0usize;
    let mut at_start = true;
    let flush = |out: &mut String, n: usize, leading: bool| {
        if n == 0 {
            return;
        }
        // One ordinary space is kept unless it starts the text.
        let (plain, extra) = if leading { (0, n) } else { (1, n - 1) };
        out.push_str(&" ".repeat(plain));
        if extra == 1 {
            out.push_str("<text:s/>");
        } else if extra > 1 {
            out.push_str(&format!(r#"<text:s text:c="{extra}"/>"#));
        }
    };
    for ch in s.chars() {
        if ch == ' ' {
            spaces += 1;
            continue;
        }
        flush(&mut out, spaces, at_start);
        spaces = 0;
        at_start = false;
        match ch {
            '\t' => out.push_str("<text:tab/>"),
            '\n' => out.push_str("<text:line-break/>"),
            c => out.push_str(&esc(&c.to_string())),
        }
    }
    flush(&mut out, spaces, at_start);
    out
}

/// Text content of an element, honouring `text:s`, `text:tab` and
/// `text:line-break` (used for plain-text values such as cells and notes).
pub(crate) fn plain_text(e: &Element) -> String {
    let mut s = String::new();
    collect(e, &mut s);
    s
}

fn collect(e: &Element, s: &mut String) {
    for c in &e.children {
        match c {
            crate::xml::Node::Text(t) => s.push_str(t),
            crate::xml::Node::Element(x) => match x.name.as_str() {
                "text:s" => s.push_str(
                    &" ".repeat(x.attr("text:c").and_then(|v| v.parse().ok()).unwrap_or(1)),
                ),
                "text:tab" => s.push('\t'),
                "text:line-break" => s.push('\n'),
                "text:p" | "text:h" => {
                    if !s.is_empty() {
                        s.push('\n');
                    }
                    collect(x, s);
                }
                "office:annotation" | "text:note" | "text:tracked-changes" => {}
                _ => collect(x, s),
            },
        }
    }
}

// -------------------------------------------------------------- writing --

/// Escape for attribute values (same as element text: quotes included).
pub(crate) fn esc_attr(s: &str) -> String {
    esc(s)
}

/// A file of the package besides content/styles/meta.
pub(crate) struct Extra {
    pub path: String,
    pub mime: String,
    pub data: Vec<u8>,
}

pub(crate) fn meta_xml(title: &str, author: &str) -> String {
    let mut m = String::new();
    if !title.is_empty() {
        m.push_str(&format!("<dc:title>{}</dc:title>", esc(title)));
    }
    if !author.is_empty() {
        m.push_str(&format!(
            "<meta:initial-creator>{0}</meta:initial-creator><dc:creator>{0}</dc:creator>",
            esc(author)
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-meta {NS}><office:meta><meta:generator>Nexora</meta:generator>{m}</office:meta></office:document-meta>"#
    )
}

/// Zip an ODF package: `mimetype` first and uncompressed, then the manifest.
pub(crate) fn package(
    mime: &str,
    content: String,
    styles: String,
    meta: String,
    extras: Vec<Extra>,
) -> Result<Vec<u8>> {
    let mut manifest = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="{mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>"#
    );
    for x in &extras {
        manifest.push_str(&format!(
            r#"<manifest:file-entry manifest:full-path="{}" manifest:media-type="{}"/>"#,
            esc(&x.path),
            esc(&x.mime)
        ));
    }
    manifest.push_str("</manifest:manifest>");
    let mut out = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut out);
        let stored =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let err = |e: zip::result::ZipError| Error::Format(e.to_string());
        zip.start_file("mimetype", stored).map_err(err)?;
        zip.write_all(mime.as_bytes())?;
        for (name, data) in [
            ("content.xml", content.into_bytes()),
            ("styles.xml", styles.into_bytes()),
            ("meta.xml", meta.into_bytes()),
            ("META-INF/manifest.xml", manifest.into_bytes()),
        ] {
            zip.start_file(name, deflated).map_err(err)?;
            zip.write_all(&data)?;
        }
        for x in extras {
            zip.start_file(x.path.as_str(), deflated).map_err(err)?;
            zip.write_all(&x.data)?;
        }
        zip.finish().map_err(err)?;
    }
    Ok(out.into_inner())
}

/// Deduplicating collector of automatic styles (`prefix` + number).
pub(crate) struct AutoStyles {
    prefix: &'static str,
    by_body: HashMap<String, String>,
    pub xml: String,
}

impl AutoStyles {
    pub fn new(prefix: &'static str) -> Self {
        Self {
            prefix,
            by_body: HashMap::new(),
            xml: String::new(),
        }
    }

    /// Name of a `style:style` of `family` with the given attributes and
    /// property elements (`body`), created on first use.
    pub fn get(&mut self, family: &str, attrs: &str, body: &str) -> String {
        let key = format!("{family}|{attrs}|{body}");
        if let Some(n) = self.by_body.get(&key) {
            return n.clone();
        }
        let name = format!("{}{}", self.prefix, self.by_body.len() + 1);
        self.xml.push_str(&format!(r#"<style:style style:name="{name}" style:family="{family}"{attrs}>{body}</style:style>"#));
        self.by_body.insert(key, name.clone());
        name
    }

    /// Raw element added once under a fixed key (list styles, page layouts).
    pub fn raw(&mut self, key: &str, make: impl FnOnce(&str) -> String) -> String {
        if let Some(n) = self.by_body.get(key) {
            return n.clone();
        }
        let name = format!("{}{}", self.prefix, self.by_body.len() + 1);
        self.xml.push_str(&make(&name));
        self.by_body.insert(key.to_string(), name.clone());
        name
    }
}

/// `<style:font-face>` declarations for the given families.
pub(crate) fn font_decls<'a>(fonts: impl IntoIterator<Item = &'a str>) -> String {
    let mut seen = std::collections::BTreeSet::new();
    let mut s = String::from("<office:font-face-decls>");
    for f in fonts {
        if seen.insert(f.to_string()) {
            s.push_str(&format!(
                r#"<style:font-face style:name="{0}" svg:font-family="'{0}'"/>"#,
                esc(f)
            ));
        }
    }
    s.push_str("</office:font-face-decls>");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lengths() {
        assert_eq!(mm("2cm"), Some(20.0));
        assert!((pt("1in").unwrap() - 72.0).abs() < 1e-9);
        assert!((px("0.5in").unwrap() - 48.0).abs() < 1e-9);
    }

    #[test]
    fn whitespace() {
        assert_eq!(text_xml("a  b\tc"), "a <text:s/>b<text:tab/>c");
        assert_eq!(text_xml(" x"), "<text:s/>x");
    }
}
