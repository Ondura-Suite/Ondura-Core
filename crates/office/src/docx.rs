//! WordprocessingML (.docx) ⇄ [`Document`] for Ondura Text.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::package::{self, Package, PackageWriter, Relationship};
use crate::units::{emu_to_px, mm_to_twips, px_to_emu, twips_to_mm};
use crate::xml::{Element, esc};
use crate::{Error, Result};

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default)]
    pub page: PageSetup,
    pub blocks: Vec<Block>,
    #[serde(default)]
    pub header: Vec<Block>,
    #[serde(default)]
    pub footer: Vec<Block>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    /// Body font and size (pt) of the "Normal" style.
    #[serde(default)]
    pub default_font: Option<String>,
    #[serde(default)]
    pub default_size: Option<f64>,
    /// Header/footer of the first page when `different_first` is set.
    #[serde(default)]
    pub different_first: bool,
    #[serde(default)]
    pub header_first: Vec<Block>,
    #[serde(default)]
    pub footer_first: Vec<Block>,
    #[serde(default)]
    pub comments: Vec<Comment>,
    /// Sources for citations and the bibliography.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<Source>,
    /// Built-in paragraph styles whose look differs from Ondura's defaults.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub styles: Vec<StyleDef>,
    /// Page colour (`#rrggbb`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_border: Option<PageBorder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watermark: Option<Watermark>,
    /// Editing restrictions ("Bearbeitung einschränken").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protection: Option<Protection>,
    /// Save as a template (.dotx).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub template: bool,
}

/// Border around every page.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageBorder {
    /// `single`, `double`, `dotted`, `dashed` or `thick`.
    pub style: String,
    /// `#rrggbb`
    pub color: String,
    /// Line width in points.
    pub width_pt: f64,
}

/// Text watermark behind the text of every page ("ENTWURF").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    pub text: String,
    /// `#rrggbb`
    pub color: String,
    /// Diagonal (otherwise horizontal).
    #[serde(default = "yes")]
    pub diagonal: bool,
}

fn yes() -> bool {
    true
}

/// Editing restriction stored in the settings (`w:documentProtection`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Protection {
    /// `readOnly`, `comments`, `trackedChanges` or `forms`.
    pub edit: String,
    /// Password to set; the hash is computed when saving.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Base64 SHA-512 hash and salt of the password (empty = no password).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub hash: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub salt: String,
    pub spin_count: u32,
}

impl Protection {
    /// Password hash of `w:documentProtection` (ISO/IEC 29500 with
    /// `w:algorithmName="SHA-512"`): H0 = H(salt + password), Hn = H(Hn-1 + n).
    pub fn hash_password(password: &str, salt: &[u8], spin: u32) -> Vec<u8> {
        use sha2::{Digest, Sha512};
        let pw: Vec<u8> = password.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut h = Sha512::new()
            .chain_update(salt)
            .chain_update(&pw)
            .finalize()
            .to_vec();
        for i in 0..spin {
            h = Sha512::new()
                .chain_update(&h)
                .chain_update(i.to_le_bytes())
                .finalize()
                .to_vec();
        }
        h
    }

    /// `true` if `password` lifts the restriction (always without a password).
    pub fn check(&self, password: &str) -> bool {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD;
        if self.hash.is_empty() {
            return true;
        }
        let Ok(salt) = b64.decode(&self.salt) else {
            return false;
        };
        b64.encode(Self::hash_password(password, &salt, self.spin_count.max(1))) == self.hash
    }
}

/// Look of a built-in paragraph style ("Formatvorlage ändern"); unset
/// fields keep the default.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleDef {
    /// `normal`, `heading1`…`heading6`, `title`, `subtitle`, `quote` or `caption`.
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    /// `#rrggbb`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_before: Option<f64>,
    /// Points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_after: Option<f64>,
    /// `left`, `center`, `right` or `justify`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
}

/// Built-in paragraph style as written to `styles.xml`.
#[derive(Clone)]
struct StyleSpec {
    id: &'static str,
    word_id: &'static str,
    name: &'static str,
    ui_priority: Option<u32>,
    outline: Option<u8>,
    keep: bool,
    before: Option<f64>,
    after: Option<f64>,
    /// Single line spacing (`w:line="240"`).
    single: bool,
    contextual: bool,
    indent: Option<(u32, u32)>,
    align: Option<String>,
    font: Option<String>,
    bold: bool,
    italic: bool,
    color: Option<String>,
    char_spacing: Option<i32>,
    kern: Option<u32>,
    size: Option<f64>,
}

impl StyleSpec {
    fn base(id: &'static str, word_id: &'static str, name: &'static str) -> Self {
        Self {
            id,
            word_id,
            name,
            ui_priority: None,
            outline: None,
            keep: false,
            before: None,
            after: None,
            single: false,
            contextual: false,
            indent: None,
            align: None,
            font: None,
            bold: false,
            italic: false,
            color: None,
            char_spacing: None,
            kern: None,
            size: None,
        }
    }

    fn apply(&mut self, d: &StyleDef) {
        if d.font.is_some() {
            self.font = d.font.clone();
        }
        if d.size.is_some() {
            self.size = d.size;
        }
        if d.color.is_some() {
            self.color = d
                .color
                .as_ref()
                .map(|c| c.trim_start_matches('#').to_ascii_uppercase());
        }
        if let Some(b) = d.bold {
            self.bold = b;
        }
        if let Some(i) = d.italic {
            self.italic = i;
        }
        if d.space_before.is_some() {
            self.before = d.space_before;
        }
        if d.space_after.is_some() {
            self.after = d.space_after;
        }
        if d.align.is_some() {
            self.align = d.align.clone();
        }
    }

    fn xml(&self) -> String {
        let normal = self.id == "normal";
        let mut s = format!(
            r#"<w:style w:type="paragraph"{} w:styleId="{}"><w:name w:val="{}"/>"#,
            if normal { r#" w:default="1""# } else { "" },
            self.word_id,
            self.name
        );
        if !normal {
            s.push_str(r#"<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>"#);
        }
        if let Some(u) = self.ui_priority {
            s.push_str(&format!(r#"<w:uiPriority w:val="{u}"/>"#));
        }
        s.push_str("<w:qFormat/>");
        let mut ppr = String::new();
        if self.keep {
            ppr.push_str("<w:keepNext/><w:keepLines/>");
        }
        if self.before.is_some() || self.after.is_some() || self.single {
            ppr.push_str("<w:spacing");
            if let Some(b) = self.before {
                ppr.push_str(&format!(r#" w:before="{}""#, (b * 20.0).round() as i64));
            }
            if let Some(a) = self.after {
                ppr.push_str(&format!(r#" w:after="{}""#, (a * 20.0).round() as i64));
            }
            if self.single {
                ppr.push_str(r#" w:line="240" w:lineRule="auto""#);
            }
            ppr.push_str("/>");
        }
        if let Some((l, r)) = self.indent {
            ppr.push_str(&format!(r#"<w:ind w:left="{l}" w:right="{r}"/>"#));
        }
        if self.contextual {
            ppr.push_str("<w:contextualSpacing/>");
        }
        if let Some(a) = &self.align {
            let jc = match a.as_str() {
                "center" => "center",
                "right" => "right",
                "justify" => "both",
                _ => "left",
            };
            ppr.push_str(&format!(r#"<w:jc w:val="{jc}"/>"#));
        }
        if let Some(o) = self.outline {
            ppr.push_str(&format!(r#"<w:outlineLvl w:val="{o}"/>"#));
        }
        if !ppr.is_empty() {
            s.push_str(&format!("<w:pPr>{ppr}</w:pPr>"));
        }
        let mut rpr = String::new();
        if let Some(f) = &self.font {
            let f = esc(f);
            rpr.push_str(&format!(
                r#"<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:eastAsia="{f}" w:cs="{f}"/>"#
            ));
        }
        if self.bold {
            rpr.push_str("<w:b/><w:bCs/>");
        }
        if self.italic {
            rpr.push_str("<w:i/><w:iCs/>");
        }
        if let Some(c) = &self.color {
            rpr.push_str(&format!(r#"<w:color w:val="{}"/>"#, esc(c)));
        }
        if let Some(c) = self.char_spacing {
            rpr.push_str(&format!(r#"<w:spacing w:val="{c}"/>"#));
        }
        if let Some(k) = self.kern {
            rpr.push_str(&format!(r#"<w:kern w:val="{k}"/>"#));
        }
        if let Some(sz) = self.size {
            let v = (sz * 2.0).round() as i64;
            rpr.push_str(&format!(r#"<w:sz w:val="{v}"/><w:szCs w:val="{v}"/>"#));
        }
        if !rpr.is_empty() {
            s.push_str(&format!("<w:rPr>{rpr}</w:rPr>"));
        }
        s.push_str("</w:style>");
        s
    }
}

/// Ondura's built-in paragraph styles.
fn style_specs() -> Vec<StyleSpec> {
    let mut out = vec![StyleSpec::base("normal", "Normal", "Normal")];
    for (level, size, before) in [
        (1u8, 20.0, 18.0),
        (2, 16.0, 8.0),
        (3, 14.0, 8.0),
        (4, 12.0, 4.0),
        (5, 11.0, 4.0),
        (6, 11.0, 4.0),
    ] {
        const IDS: [(&str, &str, &str); 6] = [
            ("heading1", "Heading1", "heading 1"),
            ("heading2", "Heading2", "heading 2"),
            ("heading3", "Heading3", "heading 3"),
            ("heading4", "Heading4", "heading 4"),
            ("heading5", "Heading5", "heading 5"),
            ("heading6", "Heading6", "heading 6"),
        ];
        let (id, word_id, name) = IDS[level as usize - 1];
        let mut h = StyleSpec::base(id, word_id, name);
        h.ui_priority = Some(9);
        h.outline = Some(level - 1);
        h.keep = true;
        h.before = Some(before);
        h.after = Some(4.0);
        h.bold = true;
        h.color = Some("1F3864".into());
        h.size = Some(size);
        out.push(h);
    }
    let mut t = StyleSpec::base("title", "Title", "Title");
    t.after = Some(4.0);
    t.single = true;
    t.contextual = true;
    t.char_spacing = Some(-10);
    t.kern = Some(28);
    t.size = Some(28.0);
    out.push(t);
    let mut st = StyleSpec::base("subtitle", "Subtitle", "Subtitle");
    st.color = Some("595959".into());
    st.char_spacing = Some(15);
    st.size = Some(15.0);
    out.push(st);
    let mut q = StyleSpec::base("quote", "Quote", "Quote");
    q.before = Some(8.0);
    q.indent = Some((864, 864));
    q.align = Some("center".into());
    q.italic = true;
    q.color = Some("404040".into());
    out.push(q);
    let mut c = StyleSpec::base("caption", "Caption", "caption");
    c.ui_priority = Some(35);
    c.after = Some(10.0);
    c.single = true;
    c.italic = true;
    c.color = Some("44546A".into());
    c.size = Some(9.0);
    out.push(c);
    out
}

/// Differences of a style (its `basedOn` chain, nearest first) from the
/// built-in style `spec`. `size` is the document's default size.
fn style_def_from(
    spec: &StyleSpec,
    chain: &[&Element],
    font: Option<String>,
    size: f64,
) -> Option<StyleDef> {
    let rpr = |name: &str| {
        chain
            .iter()
            .find_map(|s| s.child("w:rPr").and_then(|r| r.child(name)))
    };
    let ppr = |name: &str| {
        chain
            .iter()
            .find_map(|s| s.child("w:pPr").and_then(|r| r.child(name)))
    };
    let spacing = |attr: &str| {
        chain
            .iter()
            .find_map(|s| s.child("w:pPr")?.child("w:spacing")?.attr(attr))
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v / 20.0)
    };
    let mut d = StyleDef {
        id: spec.id.into(),
        ..Default::default()
    };
    if let Some(f) = font.filter(|f| Some(f) != spec.font.as_ref()) {
        d.font = Some(f);
    }
    let sz = rpr("w:sz")
        .and_then(|e| e.attr("w:val"))
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v / 2.0)
        .unwrap_or(size);
    if sz != spec.size.unwrap_or(size) {
        d.size = Some(sz);
    }
    let color = rpr("w:color")
        .and_then(|c| c.attr("w:val"))
        .filter(|c| *c != "auto")
        .map(|c| c.to_ascii_uppercase());
    if color != spec.color {
        d.color = Some(color.map_or("#000000".into(), |c| format!("#{}", c.to_ascii_lowercase())));
    }
    let b = on(rpr("w:b")).unwrap_or(false);
    if b != spec.bold {
        d.bold = Some(b);
    }
    let i = on(rpr("w:i")).unwrap_or(false);
    if i != spec.italic {
        d.italic = Some(i);
    }
    let before = spacing("w:before").unwrap_or(0.0);
    if before != spec.before.unwrap_or(0.0) {
        d.space_before = Some(before);
    }
    if let Some(after) = spacing("w:after")
        && after != spec.after.unwrap_or(8.0)
    {
        d.space_after = Some(after);
    }
    let align = match ppr("w:jc").and_then(|e| e.attr("w:val")) {
        Some("center") => "center",
        Some("right" | "end") => "right",
        Some("both" | "distribute") => "justify",
        _ => "left",
    };
    if align != spec.align.as_deref().unwrap_or("left") {
        d.align = Some(align.into());
    }
    let changed = d.font.is_some()
        || d.size.is_some()
        || d.color.is_some()
        || d.bold.is_some()
        || d.italic.is_some()
        || d.space_before.is_some()
        || d.space_after.is_some()
        || d.align.is_some();
    changed.then_some(d)
}

/// A comment; the commented text carries `Marks::comment` with its id.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: u32,
    #[serde(default)]
    pub author: String,
    /// ISO 8601.
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub text: String,
}

/// Author and time of a tracked insertion or deletion.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub date: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub level: u8,
    pub text: String,
    #[serde(default)]
    pub page: u32,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            page: PageSetup::default(),
            blocks: vec![Block::Paragraph(Paragraph::default())],
            header: Vec::new(),
            footer: Vec::new(),
            title: String::new(),
            author: String::new(),
            default_font: None,
            default_size: None,
            different_first: false,
            header_first: Vec::new(),
            footer_first: Vec::new(),
            comments: Vec::new(),
            sources: Vec::new(),
            styles: Vec::new(),
            page_color: None,
            page_border: None,
            watermark: None,
            protection: None,
            template: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    pub width_mm: f64,
    pub height_mm: f64,
    pub margin_top_mm: f64,
    pub margin_bottom_mm: f64,
    pub margin_left_mm: f64,
    pub margin_right_mm: f64,
    /// Distance of header/footer from the page edge.
    #[serde(default = "default_hf")]
    pub header_mm: f64,
    #[serde(default = "default_hf")]
    pub footer_mm: f64,
}

fn default_hf() -> f64 {
    12.5
}

impl Default for PageSetup {
    /// DIN A4 portrait with the margins of a new German Word document.
    fn default() -> Self {
        Self {
            width_mm: 210.0,
            height_mm: 297.0,
            margin_top_mm: 25.0,
            margin_bottom_mm: 20.0,
            margin_left_mm: 25.0,
            margin_right_mm: 20.0,
            header_mm: 12.5,
            footer_mm: 12.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    Paragraph(Paragraph),
    Table(Table),
    PageBreak,
    /// End of a section; `page` is the page setup of the section that ends
    /// here (the last section uses [`Document::page`]). The next section
    /// starts on a new page.
    SectionBreak {
        page: PageSetup,
    },
    /// Table of contents (a TOC field); entries are filled in by the app.
    /// With `caption` it is a table of figures for that caption label.
    Toc {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default)]
        entries: Vec<TocEntry>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    /// Alphabetical index (INDEX field) built from `xe` fields.
    Index {
        #[serde(default)]
        entries: Vec<IndexEntry>,
    },
    /// Bibliography (BIBLIOGRAPHY field) of the cited sources.
    Bibliography {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default)]
        entries: Vec<String>,
    },
    /// Text in columns (a continuous section with several columns).
    Columns {
        count: u32,
        /// Space between the columns.
        #[serde(default = "default_column_gap")]
        gap_mm: f64,
        #[serde(default)]
        blocks: Vec<Block>,
    },
}

fn default_column_gap() -> f64 {
    12.5
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexEntry {
    pub term: String,
    /// Page numbers as shown, e.g. `3, 7`.
    pub pages: String,
}

/// A source for citations (Quellen verwalten).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Source {
    /// Tag used by `cite` fields.
    pub tag: String,
    /// `book`, `article`, `web`, `report`.
    pub kind: String,
    /// Authors as "Last, First; Last, First".
    pub author: String,
    pub title: String,
    pub year: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub publisher: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub city: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub journal: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub pages: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    /// `heading1`…`heading6`, `title`, `subtitle`, `quote`, `code`; `None` = Normal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// `center`, `right` or `justify`; `None` = left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<ListRef>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub indent_mm: f64,
    /// First-line indent; negative for a hanging indent.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub first_line_mm: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_before_pt: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_after_pt: Option<f64>,
    /// Line spacing as a multiple (1.0 = single).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    /// Drop cap over this many lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drop_cap: Option<u8>,
    #[serde(default)]
    pub content: Vec<Inline>,
}

fn inline_wrap() -> String {
    "inline".into()
}

fn is_zero(v: &f64) -> bool {
    v.abs() < 0.01
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListRef {
    pub ordered: bool,
    pub level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Inline {
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Marks::is_plain")]
        marks: Marks,
    },
    Break,
    Tab,
    Image {
        /// `data:` URL.
        src: String,
        width: f64,
        height: f64,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        alt: String,
    },
    /// Field: `page`, `pages`, `date`, `author`, `title`, `filename`,
    /// `seq <name>` (caption numbers), `ref <bookmark>` (cross-reference),
    /// `merge <column>` (mail merge), `xe <term>` (index entry, not shown),
    /// `cite <source>` (citation). `result` is the last shown text.
    Field {
        field: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        result: String,
    },
    /// Start or end of a bookmark (target of cross-references).
    Bookmark {
        name: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        end: bool,
    },
    /// Content control (form field) with its shown text: `text`,
    /// `checkbox`, `dropdown` or `date`.
    Control {
        kind: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        title: String,
        #[serde(default)]
        value: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        checked: bool,
        /// Choices of a drop-down list.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        items: Vec<String>,
        /// Date format in Word notation (`dd.MM.yyyy`).
        #[serde(default, skip_serializing_if = "String::is_empty")]
        format: String,
        /// `value` is the placeholder text, not an entry.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        placeholder: bool,
        #[serde(default, skip_serializing_if = "Marks::is_plain")]
        marks: Marks,
    },
    /// Formula as Office Math (OMML `m:oMath` element, written as is).
    Math {
        omml: String,
        /// Shown as its own centred line (`m:oMathPara`).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        display: bool,
    },
    /// Shape or text box (DrawingML word processing shape).
    Shape {
        /// `rect`, `roundRect`, `ellipse`, `triangle`, `rightArrow`, `star5`, `line` or `textBox`.
        kind: String,
        width_mm: f64,
        height_mm: f64,
        /// `#rrggbb`; `None` = no fill.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        /// Outline colour; `None` = no outline.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        line: Option<String>,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        text: String,
        /// `inline`, `left` or `right` (floating, text flows around it).
        #[serde(default = "inline_wrap")]
        wrap: String,
    },
    /// Footnote reference with the note's text (paragraphs separated by `\n`).
    Footnote {
        text: String,
        /// Endnote (collected at the end of the document) instead of a footnote.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        endnote: bool,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Marks {
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub strike: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub superscript: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub subscript: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    /// `#rrggbb`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// Id of the comment anchored on this text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<u32>,
    /// Tracked insertion.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ins: Option<Revision>,
    /// Tracked deletion (the text is still shown, struck through).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub del: Option<Revision>,
}

impl Marks {
    pub fn is_plain(&self) -> bool {
        *self == Marks::default()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    #[serde(default)]
    pub columns_mm: Vec<f64>,
    pub rows: Vec<Row>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub header: bool,
    pub cells: Vec<Cell>,
    /// Exact row height (labels); unset = automatic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height_mm: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    #[serde(default = "one")]
    pub col_span: u32,
    #[serde(default = "one")]
    pub row_span: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    pub blocks: Vec<Block>,
}

fn one() -> u32 {
    1
}

/// Result of [`read`]: the document and what could not be imported.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub document: Document,
    pub warnings: Vec<String>,
}

// --------------------------------------------------------------- reading --

#[derive(Debug, Clone, Default)]
struct StyleInfo {
    name: String,
    based_on: Option<String>,
    kind: String,
    outline: Option<u8>,
    num: Option<(String, u8)>,
    bold: Option<bool>,
    italic: Option<bool>,
}

struct Reader<'a> {
    pkg: &'a Package,
    rels: HashMap<String, Relationship>,
    styles: HashMap<String, StyleInfo>,
    /// numId → (level → ordered)
    numbering: HashMap<String, HashMap<u8, bool>>,
    theme_minor: Option<String>,
    theme_major: Option<String>,
    warnings: BTreeSet<String>,
    /// Complex field state: (instruction, past "separate").
    field: Option<(String, bool)>,
    /// Comments whose range is open.
    open_comments: Vec<u32>,
    /// Footnote and endnote texts by id.
    notes: HashMap<(bool, String), String>,
    /// Paragraph style ids that are TOC entries (`toc 1` → 1).
    toc_styles: HashMap<String, u8>,
    /// Open bookmarks: id → name.
    bookmarks: HashMap<String, String>,
    /// Paragraph style ids of index entries (`index 1`).
    index_styles: std::collections::HashSet<String>,
    /// Text of a drop cap frame, joined to the next paragraph.
    drop_cap: Option<(Vec<Inline>, u8)>,
}

/// Parse a .docx file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let pkg = Package::open(bytes)?;
    let main = pkg
        .main_part("officeDocument")?
        .filter(|p| pkg.has(p))
        .or_else(|| {
            pkg.has("word/document.xml")
                .then(|| "word/document.xml".to_string())
        })
        .ok_or_else(|| Error::Format("Kein Word-Dokument gefunden.".into()))?;
    let root = pkg
        .xml(&main)?
        .ok_or_else(|| Error::Format("Dokument fehlt".into()))?;
    let body = root
        .child("w:body")
        .ok_or_else(|| Error::Format("Dokument ohne Inhalt".into()))?;

    let rels: HashMap<String, Relationship> = pkg
        .rels(&main)?
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    let mut r = Reader {
        pkg: &pkg,
        rels: HashMap::new(),
        styles: HashMap::new(),
        numbering: HashMap::new(),
        theme_minor: None,
        theme_major: None,
        warnings: BTreeSet::new(),
        field: None,
        open_comments: Vec::new(),
        notes: HashMap::new(),
        toc_styles: HashMap::new(),
        bookmarks: HashMap::new(),
        index_styles: Default::default(),
        drop_cap: None,
    };
    if pkg.has_vba() {
        r.warnings.insert(ondura_i18n::tr!("Die Datei enthält VBA-Makros. Ondura führt sie nicht aus; beim Speichern werden sie nicht übernommen. Eigene Makros legen Sie unter Ansicht/Entwicklertools › Makros an."));
    }

    let by_kind = |k: &str| {
        rels.values()
            .find(|x| x.kind == k)
            .map(|x| x.target.clone())
    };
    if let Some(theme) = by_kind("theme").and_then(|t| pkg.xml(&t).ok().flatten()) {
        r.theme_minor = theme
            .find("a:minorFont")
            .and_then(|f| f.child("a:latin"))
            .and_then(|l| l.attr("typeface"))
            .map(String::from);
        r.theme_major = theme
            .find("a:majorFont")
            .and_then(|f| f.child("a:latin"))
            .and_then(|l| l.attr("typeface"))
            .map(String::from);
    }
    let mut doc = Document {
        blocks: Vec::new(),
        ..Default::default()
    };
    if let Some(styles) = by_kind("styles").and_then(|t| pkg.xml(&t).ok().flatten()) {
        r.read_styles(&styles, &mut doc);
    }
    if let Some(num) = by_kind("numbering").and_then(|t| pkg.xml(&t).ok().flatten()) {
        r.read_numbering(&num);
    }
    for (k, tag, endnote) in [
        ("footnotes", "w:footnote", false),
        ("endnotes", "w:endnote", true),
    ] {
        let Some(part) = by_kind(k).and_then(|t| pkg.xml(&t).ok().flatten()) else {
            continue;
        };
        for n in part
            .children_named(tag)
            .filter(|n| n.attr("w:type").is_none())
        {
            let text = n
                .children_named("w:p")
                .map(note_text)
                .collect::<Vec<_>>()
                .join("\n");
            r.notes.insert(
                (endnote, n.attr("w:id").unwrap_or_default().to_string()),
                text.trim().to_string(),
            );
        }
    }
    // Bibliography sources live in a custom XML part.
    for i in 1..=20 {
        if let Some(x) = pkg.xml(&format!("customXml/item{i}.xml")).ok().flatten()
            && x.name.ends_with("Sources")
        {
            doc.sources = read_sources(&x);
            break;
        }
    }
    if let Some(part) = by_kind("comments").and_then(|t| pkg.xml(&t).ok().flatten()) {
        for c in part.children_named("w:comment") {
            let Some(id) = c.attr("w:id").and_then(|v| v.parse().ok()) else {
                continue;
            };
            doc.comments.push(Comment {
                id,
                author: c.attr("w:author").unwrap_or_default().to_string(),
                date: c.attr("w:date").unwrap_or_default().to_string(),
                text: c
                    .children_named("w:p")
                    .map(note_text)
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim()
                    .to_string(),
            });
        }
    }

    r.rels = rels.clone();
    doc.page_color = root
        .child("w:background")
        .and_then(|b| b.attr("w:color"))
        .and_then(hex_color);
    if let Some(settings) = by_kind("settings").and_then(|t| pkg.xml(&t).ok().flatten())
        && let Some(dp) = settings.child("w:documentProtection")
        && matches!(dp.attr("w:enforcement"), Some("1" | "true" | "on"))
    {
        let sha512 = dp.attr("w:algorithmName") == Some("SHA-512");
        doc.protection = Some(Protection {
            edit: dp.attr("w:edit").unwrap_or("readOnly").to_string(),
            password: None,
            // Only SHA-512 hashes can be checked; others open without password.
            hash: if sha512 {
                dp.attr("w:hashValue").unwrap_or_default().to_string()
            } else {
                String::new()
            },
            salt: if sha512 {
                dp.attr("w:saltValue").unwrap_or_default().to_string()
            } else {
                String::new()
            },
            spin_count: dp
                .attr("w:spinCount")
                .and_then(|v| v.parse().ok())
                .unwrap_or(100_000),
        });
    }
    doc.blocks = r.blocks(body);
    if doc.blocks.is_empty() {
        doc.blocks.push(Block::Paragraph(Paragraph::default()));
    }

    let sect = body.child("w:sectPr");
    if let Some(sect) = sect {
        doc.page = read_page(sect);
        doc.page_border = sect
            .child("w:pgBorders")
            .and_then(|b| b.child("w:top"))
            .map(|t| PageBorder {
                style: match t.attr("w:val") {
                    Some(v @ ("double" | "dotted" | "dashed" | "thick")) => v.to_string(),
                    _ => "single".into(),
                },
                color: t
                    .attr("w:color")
                    .and_then(hex_color)
                    .unwrap_or_else(|| "#000000".into()),
                width_pt: t
                    .attr("w:sz")
                    .and_then(|v| v.parse::<f64>().ok())
                    .map(|v| v / 8.0)
                    .unwrap_or(0.5),
            });
        // Watermark: the WordArt shape Word puts into the headers.
        for h in sect.children_named("w:headerReference") {
            let Some(part) = h
                .attr("r:id")
                .and_then(|id| rels.get(id))
                .and_then(|rel| pkg.xml(&rel.target).ok().flatten())
            else {
                continue;
            };
            let mut shapes = Vec::new();
            part.find_all("v:shape", &mut shapes);
            if let Some(shape) = shapes.into_iter().find(|s| s.child("v:textpath").is_some()) {
                let text = shape
                    .child("v:textpath")
                    .and_then(|t| t.attr("string"))
                    .unwrap_or_default()
                    .to_string();
                let style = shape.attr("style").unwrap_or_default();
                doc.watermark = Some(Watermark {
                    text,
                    color: shape
                        .attr("fillcolor")
                        .map(vml_color)
                        .unwrap_or_else(|| "#c0c0c0".into()),
                    diagonal: style.contains("rotation:315") || style.contains("rotation:-45"),
                });
                break;
            }
        }
        let mut hf = |name: &str, kind: &str| -> Vec<Block> {
            let Some(reference) = sect
                .children_named(name)
                .find(|h| h.attr("w:type").unwrap_or("default") == kind)
            else {
                return Vec::new();
            };
            let Some(rel) = reference.attr("r:id").and_then(|id| rels.get(id)) else {
                return Vec::new();
            };
            let Ok(Some(part)) = pkg.xml(&rel.target) else {
                return Vec::new();
            };
            r.rels = pkg
                .rels(&rel.target)
                .unwrap_or_default()
                .into_iter()
                .map(|x| (x.id.clone(), x))
                .collect();
            r.blocks(&part)
        };
        doc.header = hf("w:headerReference", "default");
        doc.footer = hf("w:footerReference", "default");
        doc.different_first = on(sect.child("w:titlePg")) == Some(true);
        if doc.different_first {
            doc.header_first = hf("w:headerReference", "first");
            doc.footer_first = hf("w:footerReference", "first");
        }
        if sect
            .children_named("w:headerReference")
            .chain(sect.children_named("w:footerReference"))
            .any(|h| h.attr("w:type") == Some("even"))
        {
            r.warnings.insert(ondura_i18n::tr!(
                "Abweichende Kopf-/Fußzeilen für gerade Seiten werden vereinheitlicht."
            ));
        }
    }
    let (title, author) = package::read_core(&pkg);
    doc.title = title;
    doc.author = author;
    Ok(Loaded {
        document: doc,
        warnings: r.warnings.into_iter().collect(),
    })
}

/// Column count and gap of a section with more than one column.
fn section_columns(sect: &Element) -> Option<(u32, f64)> {
    let cols = sect.child("w:cols")?;
    let count = cols
        .attr("w:num")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1);
    (count > 1).then(|| {
        (
            count.min(10),
            twips(cols, "w:space").map(twips_to_mm).unwrap_or(12.5),
        )
    })
}

/// VML colour (`silver`, `#c0c0c0`, `#ccc [3212]`) as `#rrggbb`.
fn vml_color(v: &str) -> String {
    let v = v.split_whitespace().next().unwrap_or(v);
    if let Some(hex) = v.strip_prefix('#') {
        if hex.len() == 3 {
            return format!(
                "#{}",
                hex.chars()
                    .flat_map(|c| [c, c])
                    .collect::<String>()
                    .to_ascii_lowercase()
            );
        }
        if let Some(c) = hex_color(hex) {
            return c;
        }
    }
    match v {
        "black" => "#000000",
        "red" => "#ff0000",
        "blue" => "#0000ff",
        "gray" | "grey" => "#808080",
        _ => "#c0c0c0",
    }
    .into()
}

fn twips(e: &Element, attr: &str) -> Option<f64> {
    e.attr(attr).and_then(|v| v.parse::<f64>().ok())
}

fn read_page(sect: &Element) -> PageSetup {
    let mut p = PageSetup::default();
    if let Some(sz) = sect.child("w:pgSz") {
        if let Some(w) = twips(sz, "w:w") {
            p.width_mm = twips_to_mm(w);
        }
        if let Some(h) = twips(sz, "w:h") {
            p.height_mm = twips_to_mm(h);
        }
    }
    if let Some(m) = sect.child("w:pgMar") {
        let get = |a: &str, d: f64| twips(m, a).map(|v| twips_to_mm(v.abs())).unwrap_or(d);
        p.margin_top_mm = get("w:top", p.margin_top_mm);
        p.margin_bottom_mm = get("w:bottom", p.margin_bottom_mm);
        p.margin_left_mm = get("w:left", p.margin_left_mm);
        p.margin_right_mm = get("w:right", p.margin_right_mm);
        p.header_mm = get("w:header", p.header_mm);
        p.footer_mm = get("w:footer", p.footer_mm);
    }
    p
}

fn on(e: Option<&Element>) -> Option<bool> {
    e.map(|e| !matches!(e.attr("w:val"), Some("0" | "false" | "off" | "none")))
}

fn hex_color(v: &str) -> Option<String> {
    (v.len() == 6 && v.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("#{}", v.to_ascii_lowercase()))
}

const HIGHLIGHTS: [(&str, &str); 16] = [
    ("yellow", "#ffff00"),
    ("green", "#00ff00"),
    ("cyan", "#00ffff"),
    ("magenta", "#ff00ff"),
    ("blue", "#0000ff"),
    ("red", "#ff0000"),
    ("darkBlue", "#000080"),
    ("darkCyan", "#008080"),
    ("darkGreen", "#008000"),
    ("darkMagenta", "#800080"),
    ("darkRed", "#800000"),
    ("darkYellow", "#808000"),
    ("darkGray", "#808080"),
    ("lightGray", "#c0c0c0"),
    ("black", "#000000"),
    ("white", "#ffffff"),
];

impl Reader<'_> {
    fn read_styles(&mut self, styles: &Element, doc: &mut Document) {
        if let Some(rpr) = styles.find("w:rPrDefault").and_then(|d| d.find("w:rPr")) {
            doc.default_font = self.font(rpr);
            doc.default_size = rpr
                .child_val("w:sz")
                .and_then(|v| v.parse::<f64>().ok())
                .map(|v| v / 2.0);
        }
        for s in styles.children_named("w:style") {
            let Some(id) = s.attr("w:styleId") else {
                continue;
            };
            let ppr = s.child("w:pPr");
            let rpr = s.child("w:rPr");
            let info = StyleInfo {
                name: s.child_val("w:name").unwrap_or(id).to_ascii_lowercase(),
                based_on: s.child_val("w:basedOn").map(String::from),
                kind: s.attr("w:type").unwrap_or("paragraph").to_string(),
                outline: ppr
                    .and_then(|p| p.child_val("w:outlineLvl"))
                    .and_then(|v| v.parse().ok()),
                num: ppr.and_then(|p| p.child("w:numPr")).and_then(|n| {
                    Some((
                        n.child_val("w:numId")?.to_string(),
                        n.child_val("w:ilvl")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0),
                    ))
                }),
                bold: rpr.and_then(|r| on(r.child("w:b"))),
                italic: rpr.and_then(|r| on(r.child("w:i"))),
            };
            if s.attr("w:default") == Some("1")
                && info.kind == "paragraph"
                && let Some(rpr) = rpr
            {
                if let Some(f) = self.font(rpr) {
                    doc.default_font = Some(f);
                }
                if let Some(sz) = rpr.child_val("w:sz").and_then(|v| v.parse::<f64>().ok()) {
                    doc.default_size = Some(sz / 2.0);
                }
            }
            if info
                .name
                .strip_prefix("index ")
                .and_then(|l| l.trim().parse::<u8>().ok())
                .is_some()
            {
                self.index_styles.insert(id.to_string());
            }
            if let Some(l) = info
                .name
                .strip_prefix("toc ")
                .and_then(|l| l.trim().parse::<u8>().ok())
            {
                self.toc_styles.insert(id.to_string(), l);
            }
            self.styles.insert(id.to_string(), info);
        }
        // Built-in styles whose look differs from Ondura's (fonts other than
        // the document default, sizes, colours, spacing).
        let specs = style_specs();
        let by_id: HashMap<&str, &Element> = styles
            .children_named("w:style")
            .filter_map(|s| Some((s.attr("w:styleId")?, s)))
            .collect();
        for s in styles.children_named("w:style") {
            if s.attr("w:type").unwrap_or("paragraph") != "paragraph" {
                continue;
            }
            let name = s
                .child_val("w:name")
                .unwrap_or_default()
                .to_ascii_lowercase();
            let id = match name.as_str() {
                "normal" | "standard" => "normal",
                "title" | "titel" => "title",
                "subtitle" | "untertitel" => "subtitle",
                "quote" | "zitat" => "quote",
                "caption" | "beschriftung" => "caption",
                n => match n
                    .strip_prefix("heading ")
                    .or_else(|| n.strip_prefix("überschrift "))
                {
                    Some("1") => "heading1",
                    Some("2") => "heading2",
                    Some("3") => "heading3",
                    Some("4") => "heading4",
                    Some("5") => "heading5",
                    Some("6") => "heading6",
                    _ => continue,
                },
            };
            let Some(spec) = specs.iter().find(|x| x.id == id) else {
                continue;
            };
            let mut chain = vec![s];
            let mut next = s.child_val("w:basedOn");
            while let Some(n) = next {
                let Some(p) = by_id.get(n) else { break };
                // What comes from Normal is inherited, not part of the style.
                if p.attr("w:default") == Some("1") || chain.len() > 16 {
                    break;
                }
                chain.push(p);
                next = p.child_val("w:basedOn");
            }
            // The Normal style's own font and size are the document defaults.
            let font = if id == "normal" {
                None
            } else {
                chain
                    .iter()
                    .find_map(|e| e.child("w:rPr").and_then(|r| self.font(r)))
                    .filter(|f| Some(f) != doc.default_font.as_ref())
            };
            if let Some(mut d) =
                style_def_from(spec, &chain, font, doc.default_size.unwrap_or(11.0))
            {
                if id == "normal" {
                    d.size = None;
                }
                if d != (StyleDef {
                    id: id.into(),
                    ..Default::default()
                }) && !doc.styles.iter().any(|x| x.id == id)
                {
                    doc.styles.push(d);
                }
            }
        }
    }

    fn read_numbering(&mut self, num: &Element) {
        let mut abstracts: HashMap<String, HashMap<u8, bool>> = HashMap::new();
        for a in num.children_named("w:abstractNum") {
            let levels = a
                .children_named("w:lvl")
                .filter_map(|l| {
                    Some((
                        l.attr("w:ilvl")?.parse().ok()?,
                        !matches!(l.child_val("w:numFmt"), Some("bullet" | "none")),
                    ))
                })
                .collect();
            if let Some(id) = a.attr("w:abstractNumId") {
                abstracts.insert(id.to_string(), levels);
            }
        }
        for n in num.children_named("w:num") {
            if let (Some(id), Some(abs)) = (n.attr("w:numId"), n.child_val("w:abstractNumId")) {
                self.numbering.insert(
                    id.to_string(),
                    abstracts.get(abs).cloned().unwrap_or_default(),
                );
            }
        }
    }

    /// Walk the `basedOn` chain.
    fn style_chain(&self, id: &str) -> Vec<&StyleInfo> {
        let mut out = Vec::new();
        let mut cur = Some(id.to_string());
        while let Some(c) = cur {
            let Some(s) = self.styles.get(&c) else { break };
            out.push(s);
            if out.len() > 16 {
                break;
            }
            cur = s.based_on.clone();
        }
        out
    }

    fn paragraph_style(&self, id: &str) -> Option<String> {
        for s in self.style_chain(id) {
            let n = s.name.as_str();
            if let Some(level) = n
                .strip_prefix("heading ")
                .or_else(|| n.strip_prefix("überschrift "))
                .and_then(|l| l.trim().parse::<u8>().ok())
            {
                return Some(format!("heading{}", level.clamp(1, 6)));
            }
            match n {
                "title" | "titel" => return Some("title".into()),
                "subtitle" | "untertitel" => return Some("subtitle".into()),
                "quote" | "zitat" | "intense quote" | "intensives zitat" => {
                    return Some("quote".into());
                }
                "html preformatted" | "code" | "source code" => return Some("code".into()),
                "caption" | "beschriftung" => return Some("caption".into()),
                _ => {}
            }
            if let Some(o) = s.outline.filter(|o| *o < 6) {
                return Some(format!("heading{}", o + 1));
            }
        }
        None
    }

    fn font(&self, rpr: &Element) -> Option<String> {
        let f = rpr.child("w:rFonts")?;
        if let Some(n) = f.attr("w:ascii").or_else(|| f.attr("w:hAnsi")) {
            return Some(n.to_string());
        }
        match f.attr("w:asciiTheme").or_else(|| f.attr("w:hAnsiTheme")) {
            Some(t) if t.starts_with("major") => self.theme_major.clone(),
            Some(_) => self.theme_minor.clone(),
            None => None,
        }
    }

    fn blocks(&mut self, parent: &Element) -> Vec<Block> {
        let mut section_start = 0usize;
        let blocks = self.blocks_walk(parent, &mut section_start);
        // Columns of the last section (document-wide columns).
        match parent.child("w:sectPr").and_then(section_columns) {
            Some((count, gap_mm)) if section_start < blocks.len() => {
                let mut blocks = blocks;
                let tail: Vec<Block> = blocks.drain(section_start..).collect();
                blocks.push(Block::Columns {
                    count,
                    gap_mm,
                    blocks: tail,
                });
                blocks
            }
            _ => blocks,
        }
    }

    fn blocks_walk(&mut self, parent: &Element, section_start: &mut usize) -> Vec<Block> {
        let mut out = Vec::new();
        for e in parent.elements() {
            match e.name.as_str() {
                "w:p"
                    if e.child("w:pPr")
                        .and_then(|p| p.child_val("w:pStyle"))
                        .is_some_and(|s| self.index_styles.contains(s)) =>
                {
                    // Index entry "Begriff<tab>3, 7".
                    let text = note_text(e);
                    let (term, pages) = text
                        .rsplit_once('\t')
                        .map(|(t, p)| (t.trim().to_string(), p.trim().to_string()))
                        .unwrap_or((text.trim().to_string(), String::new()));
                    if let Some(Block::Index { entries }) = out.last_mut() {
                        entries.push(IndexEntry { term, pages });
                    } else {
                        out.push(Block::Index {
                            entries: vec![IndexEntry { term, pages }],
                        });
                    }
                }
                "w:p" => {
                    self.paragraph(e, &mut out);
                    if let Some(sect) = e.child("w:pPr").and_then(|p| p.child("w:sectPr")) {
                        // An empty paragraph that only carries the section is dropped.
                        if matches!(out.last(), Some(Block::Paragraph(p)) if p.content.is_empty() && p.style.is_none() && p.list.is_none())
                        {
                            out.pop();
                        }
                        // The paragraph carrying the properties is part of the section.
                        let cols = section_columns(sect);
                        let continuous = sect.child_val("w:type") == Some("continuous");
                        if let Some((count, gap_mm)) = cols {
                            let blocks: Vec<Block> = out.drain(*section_start..).collect();
                            out.push(Block::Columns {
                                count,
                                gap_mm,
                                blocks,
                            });
                        } else if !continuous {
                            out.push(Block::SectionBreak {
                                page: read_page(sect),
                            });
                        }
                        *section_start = out.len();
                    }
                }
                "w:tbl" => out.push(Block::Table(self.table(e))),
                "w:sdt" => {
                    let gallery = e
                        .find("w:docPartGallery")
                        .and_then(|g| g.attr("w:val"))
                        .unwrap_or_default();
                    if let Some(c) = e.child("w:sdtContent") {
                        if gallery == "Table of Contents" {
                            out.push(self.toc(c));
                        } else if gallery == "Bibliographies" {
                            let mut ps = Vec::new();
                            c.find_all("w:p", &mut ps);
                            let paras: Vec<String> = ps
                                .into_iter()
                                .map(note_text)
                                .map(|t| t.trim().to_string())
                                .filter(|t| !t.is_empty())
                                .collect();
                            let mut it = paras.into_iter();
                            let title = it.next();
                            out.push(Block::Bibliography {
                                title,
                                entries: it.collect(),
                            });
                        } else {
                            out.extend(self.blocks(c));
                        }
                    }
                }
                "w:commentRangeStart" => {
                    if let Some(id) = e.attr("w:id").and_then(|v| v.parse().ok()) {
                        self.open_comments.push(id);
                    }
                }
                "w:commentRangeEnd" => {
                    if let Some(id) = e.attr("w:id").and_then(|v| v.parse::<u32>().ok()) {
                        self.open_comments.retain(|x| *x != id);
                    }
                }
                "w:customXml" | "w:ins" | "w:moveTo" => out.extend(self.blocks(e)),
                "w:altChunk" => {
                    self.warnings.insert(ondura_i18n::tr!(
                        "Eingebettete Fremdinhalte (altChunk) werden nicht angezeigt."
                    ));
                }
                _ => {}
            }
        }
        out
    }

    fn paragraph(&mut self, p: &Element, out: &mut Vec<Block>) {
        let mut para = Paragraph::default();
        let ppr = p.child("w:pPr");
        // Drop cap frame: keep its letters for the next paragraph.
        if let Some(frame) = ppr.and_then(|x| x.child("w:framePr"))
            && matches!(frame.attr("w:dropCap"), Some("drop" | "margin"))
        {
            let mut inlines = Vec::new();
            self.inlines(p, &Marks::default(), &mut inlines);
            let content: Vec<Inline> = inlines
                .into_iter()
                .filter_map(|i| match i {
                    Pending::Inline(Inline::Text { text, mut marks }) => {
                        marks.size = None;
                        Some(Inline::Text { text, marks })
                    }
                    _ => None,
                })
                .collect();
            let lines = frame
                .attr("w:lines")
                .and_then(|v| v.parse().ok())
                .unwrap_or(3u8);
            self.drop_cap = Some((content, lines));
            return;
        }
        let mut style_num = None;
        if let Some(ppr) = ppr {
            if let Some(id) = ppr.child_val("w:pStyle") {
                para.style = self.paragraph_style(id);
                style_num = self.style_chain(id).iter().find_map(|s| s.num.clone());
            }
            para.align = match ppr.child_val("w:jc") {
                Some("center") => Some("center".into()),
                Some("right" | "end") => Some("right".into()),
                Some("both" | "distribute") => Some("justify".into()),
                _ => None,
            };
            if let Some(ind) = ppr.child("w:ind") {
                para.indent_mm = twips(ind, "w:left")
                    .or_else(|| twips(ind, "w:start"))
                    .map(twips_to_mm)
                    .unwrap_or(0.0);
                if let Some(h) = twips(ind, "w:hanging") {
                    para.first_line_mm = -twips_to_mm(h);
                } else if let Some(f) = twips(ind, "w:firstLine") {
                    para.first_line_mm = twips_to_mm(f);
                }
            }
            if let Some(sp) = ppr.child("w:spacing") {
                para.space_before_pt = twips(sp, "w:before").map(|v| v / 20.0);
                para.space_after_pt = twips(sp, "w:after").map(|v| v / 20.0);
                if matches!(sp.attr("w:lineRule"), None | Some("auto")) {
                    para.line_height =
                        twips(sp, "w:line").map(|v| (v / 240.0 * 100.0).round() / 100.0);
                }
            }
            let num = ppr
                .child("w:numPr")
                .and_then(|n| {
                    Some((
                        n.child_val("w:numId")?.to_string(),
                        n.child_val("w:ilvl")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0u8),
                    ))
                })
                .or(style_num);
            if let Some((id, level)) = num.filter(|(id, _)| id != "0") {
                let ordered = self
                    .numbering
                    .get(&id)
                    .and_then(|l| l.get(&level))
                    .copied()
                    .unwrap_or(false);
                para.list = Some(ListRef {
                    ordered,
                    level: level.min(8),
                });
                // List indentation comes from the numbering definition.
                para.indent_mm = 0.0;
                para.first_line_mm = 0.0;
            }
            if on(ppr.child("w:pageBreakBefore")) == Some(true) {
                out.push(Block::PageBreak);
            }
        }
        let template = Paragraph {
            content: Vec::new(),
            ..para.clone()
        };
        let mut inlines = Vec::new();
        self.inlines(p, &Marks::default(), &mut inlines);
        // Split at page breaks.
        let mut current = Vec::new();
        for i in inlines {
            match i {
                Pending::Inline(i) => current.push(i),
                Pending::PageBreak => {
                    if !current.is_empty() {
                        out.push(Block::Paragraph(Paragraph {
                            content: merge_text(std::mem::take(&mut current)),
                            ..template.clone()
                        }));
                    }
                    out.push(Block::PageBreak);
                }
            }
        }
        let empty_after_break =
            current.is_empty() && matches!(out.last(), Some(Block::PageBreak)) && ppr.is_none();
        if let Some((mut letters, lines)) = self.drop_cap.take() {
            letters.extend(current);
            current = letters;
            para.drop_cap = Some(lines);
        }
        if !empty_after_break || para.drop_cap.is_some() {
            para.content = merge_text(current);
            out.push(Block::Paragraph(para));
        }
    }

    fn inlines(&mut self, parent: &Element, marks: &Marks, out: &mut Vec<Pending>) {
        for e in parent.elements() {
            match e.name.as_str() {
                "w:r" => self.run(e, marks, out),
                "m:oMath" => out.push(Pending::Inline(Inline::Math {
                    omml: e.to_xml(),
                    display: false,
                })),
                "m:oMathPara" => {
                    for m in e.children_named("m:oMath") {
                        out.push(Pending::Inline(Inline::Math {
                            omml: m.to_xml(),
                            display: true,
                        }));
                    }
                }
                "w:hyperlink" => {
                    let mut m = marks.clone();
                    let target = e
                        .attr("r:id")
                        .and_then(|id| self.rels.get(id))
                        .map(|r| r.target.clone())
                        .or_else(|| e.attr("w:anchor").map(|a| format!("#{a}")));
                    m.link = target;
                    self.inlines(e, &m, out);
                }
                "w:ins" | "w:moveTo" => {
                    let mut m = marks.clone();
                    m.ins = Some(revision(e));
                    self.inlines(e, &m, out);
                }
                "w:del" | "w:moveFrom" => {
                    let mut m = marks.clone();
                    m.del = Some(revision(e));
                    self.inlines(e, &m, out);
                }
                "w:commentRangeStart" => {
                    if let Some(id) = e.attr("w:id").and_then(|v| v.parse().ok()) {
                        self.open_comments.push(id);
                    }
                }
                "w:commentRangeEnd" => {
                    if let Some(id) = e.attr("w:id").and_then(|v| v.parse::<u32>().ok()) {
                        self.open_comments.retain(|x| *x != id);
                    }
                }
                "w:smartTag" | "w:customXml" | "w:dir" | "w:bdo" => self.inlines(e, marks, out),
                "w:sdt" => {
                    if let Some(ctrl) = self.control(e, marks) {
                        out.push(Pending::Inline(ctrl));
                    } else if let Some(c) = e.child("w:sdtContent") {
                        self.inlines(c, marks, out);
                    }
                }
                "w:bookmarkStart" => {
                    if let (Some(id), Some(name)) = (e.attr("w:id"), e.attr("w:name"))
                        && !name.starts_with("_GoBack")
                        && !name.starts_with("_Toc")
                    {
                        self.bookmarks.insert(id.to_string(), name.to_string());
                        out.push(Pending::Inline(Inline::Bookmark {
                            name: name.to_string(),
                            end: false,
                        }));
                    }
                }
                "w:bookmarkEnd" => {
                    if let Some(name) = e.attr("w:id").and_then(|id| self.bookmarks.remove(id)) {
                        out.push(Pending::Inline(Inline::Bookmark { name, end: true }));
                    }
                }
                "w:fldSimple" => {
                    let raw = e.attr("w:instr").unwrap_or_default().trim().to_string();
                    if let Some(f) = field_kind(&raw) {
                        let result = if matches!(f.as_str(), "page" | "pages") {
                            String::new()
                        } else {
                            e.text()
                        };
                        out.push(Pending::Inline(Inline::Field { field: f, result }));
                    } else {
                        let mut m = marks.clone();
                        if let Some(url) = hyperlink_instr(e.attr("w:instr").unwrap_or_default()) {
                            m.link = Some(url);
                        }
                        self.inlines(e, &m, out);
                    }
                }
                // Formulas without the math namespace prefix (unusual writers).
                "oMath" | "oMathPara" => {
                    self.warnings
                        .insert(ondura_i18n::tr!("Formeln werden als Text angezeigt."));
                    out.push(Pending::Inline(Inline::Text {
                        text: e.text(),
                        marks: marks.clone(),
                    }));
                }
                _ => {}
            }
        }
    }

    /// Inline content control of a supported kind.
    fn control(&self, sdt: &Element, marks: &Marks) -> Option<Inline> {
        let pr = sdt.child("w:sdtPr")?;
        let content = sdt.child("w:sdtContent");
        let mut checked = false;
        let mut items = Vec::new();
        let mut format = String::new();
        let kind = if let Some(cb) = pr.child("w14:checkbox") {
            checked = cb
                .child("w14:checked")
                .and_then(|c| c.attr("w14:val"))
                .is_some_and(|v| v == "1" || v == "true");
            "checkbox"
        } else if let Some(list) = pr
            .child("w:dropDownList")
            .or_else(|| pr.child("w:comboBox"))
        {
            items = list
                .children_named("w:listItem")
                .filter_map(|i| i.attr("w:displayText").or_else(|| i.attr("w:value")))
                .map(str::to_string)
                .collect();
            "dropdown"
        } else if let Some(d) = pr.child("w:date") {
            format = d
                .child_val("w:dateFormat")
                .unwrap_or("dd.MM.yyyy")
                .to_string();
            "date"
        } else if pr.child("w:text").is_some() {
            "text"
        } else {
            return None;
        };
        let mut value = String::new();
        let mut run_marks = marks.clone();
        if let Some(c) = content {
            let mut runs = Vec::new();
            c.find_all("w:r", &mut runs);
            if let Some(r) = runs.first() {
                run_marks = self.run_marks(r, marks);
            }
            for r in runs {
                for t in r.children_named("w:t") {
                    value.push_str(&t.text());
                }
            }
        }
        if kind == "checkbox" {
            value.clear();
        }
        Some(Inline::Control {
            kind: kind.into(),
            title: pr.child_val("w:alias").unwrap_or_default().to_string(),
            value,
            checked,
            items,
            format,
            placeholder: pr.child("w:showingPlcHdr").is_some(),
            marks: run_marks,
        })
    }

    fn run_marks(&self, r: &Element, base: &Marks) -> Marks {
        let mut m = base.clone();
        let Some(rpr) = r.child("w:rPr") else {
            return m;
        };
        if let Some(id) = rpr.child_val("w:rStyle") {
            for s in self.style_chain(id).iter().rev() {
                if let Some(b) = s.bold {
                    m.bold = b;
                }
                if let Some(i) = s.italic {
                    m.italic = i;
                }
            }
            let n = self
                .styles
                .get(id)
                .map(|s| s.name.as_str())
                .unwrap_or_default();
            if matches!(n, "strong" | "fett") {
                m.bold = true;
            }
            if matches!(n, "emphasis" | "hervorhebung") {
                m.italic = true;
            }
        }
        if let Some(v) = on(rpr.child("w:b")) {
            m.bold = v;
        }
        if let Some(v) = on(rpr.child("w:i")) {
            m.italic = v;
        }
        if let Some(u) = rpr.child("w:u") {
            m.underline = !matches!(u.attr("w:val"), Some("none" | "0"));
        }
        if let Some(v) = on(rpr.child("w:strike")).or_else(|| on(rpr.child("w:dstrike"))) {
            m.strike = v;
        }
        match rpr.child_val("w:vertAlign") {
            Some("superscript") => m.superscript = true,
            Some("subscript") => m.subscript = true,
            _ => {}
        }
        if let Some(f) = self.font(rpr) {
            m.font = Some(f);
        }
        if let Some(sz) = rpr.child_val("w:sz").and_then(|v| v.parse::<f64>().ok()) {
            m.size = Some(sz / 2.0);
        }
        if let Some(c) = rpr.child_val("w:color").and_then(hex_color) {
            m.color = Some(c);
        }
        if let Some(h) = rpr.child_val("w:highlight") {
            m.highlight = HIGHLIGHTS
                .iter()
                .find(|(n, _)| *n == h)
                .map(|(_, c)| c.to_string());
        } else if let Some(fill) = rpr
            .child("w:shd")
            .and_then(|s| s.attr("w:fill"))
            .and_then(hex_color)
        {
            m.highlight = Some(fill);
        }
        if on(rpr.child("w:vanish")) == Some(true) {
            m.size = Some(-1.0); // marker: hidden text, dropped below
        }
        m
    }

    fn run(&mut self, r: &Element, base: &Marks, out: &mut Vec<Pending>) {
        let mut marks = self.run_marks(r, base);
        if let Some(c) = self.open_comments.last() {
            marks.comment = Some(*c);
        }
        if marks.size == Some(-1.0) {
            return;
        }
        for e in r.elements() {
            match e.name.as_str() {
                "w:fldChar" => match e.attr("w:fldCharType") {
                    Some("begin") => self.field = Some((String::new(), false)),
                    Some("separate") => {
                        if let Some((instr, sep)) = &mut self.field {
                            *sep = true;
                            if let Some(f) = field_kind(instr.trim()) {
                                out.push(Pending::Inline(Inline::Field {
                                    field: f,
                                    result: String::new(),
                                }));
                            }
                        }
                    }
                    Some("end") => {
                        // Fields without a result part (XE, …) end here.
                        if let Some((instr, false)) = &self.field
                            && let Some(f) = field_kind(instr.trim())
                        {
                            out.push(Pending::Inline(Inline::Field {
                                field: f,
                                result: String::new(),
                            }));
                        }
                        self.field = None;
                    }
                    _ => {}
                },
                "w:instrText" => {
                    if let Some((instr, false)) = &mut self.field {
                        instr.push_str(&e.text());
                    }
                }
                _ => {
                    // Inside a field: skip the instruction part, and the
                    // cached result of page number fields.
                    if let Some((instr, sep)) = &self.field {
                        if !sep {
                            continue;
                        }
                        if let Some(kind) = field_kind(instr.trim()) {
                            // Keep the shown text of the field as its result.
                            if !matches!(kind.as_str(), "page" | "pages")
                                && e.name == "w:t"
                                && let Some(Pending::Inline(Inline::Field { result, .. })) =
                                    out.last_mut()
                            {
                                result.push_str(&e.text());
                            }
                            continue;
                        }
                    }
                    let mut marks = marks.clone();
                    if let Some((instr, _)) = &self.field
                        && let Some(url) = hyperlink_instr(instr)
                    {
                        marks.link = Some(url);
                    }
                    self.run_child(e, &marks, out);
                }
            }
        }
    }

    fn run_child(&mut self, e: &Element, marks: &Marks, out: &mut Vec<Pending>) {
        match e.name.as_str() {
            "w:t" | "w:delText" => out.push(Pending::Inline(Inline::Text {
                text: e.text(),
                marks: marks.clone(),
            })),
            "w:tab" | "w:ptab" => out.push(Pending::Inline(Inline::Tab)),
            "w:br" => match e.attr("w:type") {
                Some("page") => out.push(Pending::PageBreak),
                Some("column") => out.push(Pending::Inline(Inline::Break)),
                _ => out.push(Pending::Inline(Inline::Break)),
            },
            "w:cr" => out.push(Pending::Inline(Inline::Break)),
            "w:noBreakHyphen" => out.push(Pending::Inline(Inline::Text {
                text: "\u{2011}".into(),
                marks: marks.clone(),
            })),
            "w:sym" => {
                if let Some(c) = e
                    .attr("w:char")
                    .and_then(|c| u32::from_str_radix(c, 16).ok())
                {
                    // Symbol fonts use the private use area F0xx.
                    let c = if (0xF000..0xF100).contains(&c) {
                        c - 0xF000
                    } else {
                        c
                    };
                    let text = match (e.attr("w:font").unwrap_or_default(), c) {
                        (f, 0xB7) if f.contains("Symbol") => "•".to_string(),
                        (f, 0xFC) if f.contains("Wingdings") => "✓".to_string(),
                        _ => char::from_u32(c).map(String::from).unwrap_or_default(),
                    };
                    out.push(Pending::Inline(Inline::Text {
                        text,
                        marks: marks.clone(),
                    }));
                }
            }
            "w:drawing" | "w:pict" | "w:object" => self.drawing(e, out),
            "mc:AlternateContent" => {
                // Prefer the choice; its fallback is a VML copy of the same content.
                if let Some(c) = e.child("mc:Choice").or_else(|| e.child("mc:Fallback")) {
                    for x in c.elements() {
                        self.run_child(x, marks, out);
                    }
                }
            }
            "w:footnoteReference" | "w:endnoteReference" => {
                let key = (
                    e.name == "w:endnoteReference",
                    e.attr("w:id").unwrap_or_default().to_string(),
                );
                if let Some(text) = self.notes.get(&key) {
                    out.push(Pending::Inline(Inline::Footnote {
                        text: text.clone(),
                        endnote: key.0,
                    }));
                }
            }
            "w:commentReference" => {}
            _ => {}
        }
    }

    fn drawing(&mut self, e: &Element, out: &mut Vec<Pending>) {
        if let Some(wsp) = e.find("wps:wsp")
            && let Some(ext) = e.find("wp:extent")
        {
            let emu = |a: &str| {
                ext.attr(a)
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0)
                    / 36_000.0
            };
            let sp = wsp.child("wps:spPr");
            let prst = sp
                .and_then(|s| s.child("a:prstGeom"))
                .and_then(|g| g.attr("prst"))
                .unwrap_or("rect");
            let text_box = wsp.child("wps:cNvSpPr").and_then(|c| c.attr("txBox")) == Some("1");
            let color = |el: Option<&Element>| -> Option<String> {
                let el = el?;
                if el.child("a:noFill").is_some() {
                    return None;
                }
                el.child("a:solidFill")
                    .and_then(|f| f.child("a:srgbClr"))
                    .and_then(|c| c.attr("val"))
                    .and_then(hex_color)
            };
            let fill = color(sp);
            let line = color(sp.and_then(|s| s.child("a:ln")));
            let text = wsp
                .find("w:txbxContent")
                .map(|t| {
                    t.children_named("w:p")
                        .map(|p| p.text())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();
            let wrap = match e.find("wp:anchor") {
                Some(a) => match a
                    .find("wp:positionH")
                    .and_then(|p| p.child("wp:align"))
                    .map(|x| x.text())
                {
                    Some(t) if t == "right" => "right",
                    _ => "left",
                },
                None => "inline",
            };
            let kind = if text_box {
                "textBox"
            } else {
                match prst {
                    k
                    @ ("roundRect" | "ellipse" | "triangle" | "rightArrow" | "star5" | "line") => k,
                    _ => "rect",
                }
            };
            out.push(Pending::Inline(Inline::Shape {
                kind: kind.to_string(),
                width_mm: (emu("cx") * 10.0).round() / 10.0,
                height_mm: (emu("cy") * 10.0).round() / 10.0,
                fill,
                line,
                text,
                wrap: wrap.to_string(),
            }));
            return;
        }
        if e.find("wps:txbx").is_some() || e.find("w:txbxContent").is_some() {
            self.warnings.insert(ondura_i18n::tr!(
                "Textfelder werden nicht unterstützt; ihr Inhalt wird als Text eingefügt."
            ));
            if let Some(tb) = e.find("w:txbxContent") {
                let text: Vec<String> = tb
                    .children_named("w:p")
                    .map(|p| p.text())
                    .filter(|t| !t.is_empty())
                    .collect();
                if !text.is_empty() {
                    out.push(Pending::Inline(Inline::Text {
                        text: text.join(" "),
                        marks: Marks::default(),
                    }));
                }
            }
            return;
        }
        let rid = e
            .find("a:blip")
            .and_then(|b| b.attr("r:embed").or_else(|| b.attr("r:link")))
            .or_else(|| e.find("imagedata").and_then(|i| i.attr("r:id")))
            .map(String::from);
        let Some(rel) = rid.and_then(|id| self.rels.get(&id)).cloned() else {
            if e.name == "w:drawing" {
                self.warnings.insert(ondura_i18n::tr!(
                    "Zeichnungen und Diagramme werden nicht angezeigt."
                ));
            }
            return;
        };
        if e.find("wp:anchor").is_some() {
            self.warnings.insert(ondura_i18n::tr!(
                "Frei positionierte Bilder werden im Textfluss angezeigt."
            ));
        }
        let mime = package::mime_for(&rel.target);
        if matches!(
            mime,
            "image/x-emf" | "image/x-wmf" | "image/tiff" | "application/octet-stream"
        ) {
            self.warnings.insert(ondura_i18n::tr!(
                "EMF/WMF-Grafiken können nicht angezeigt werden."
            ));
            return;
        }
        let Some(data) = self.pkg.part(&rel.target) else {
            return;
        };
        let (mut w, mut h) = (200.0, 150.0);
        if let Some(ext) = e.find("wp:extent") {
            w = ext
                .attr("cx")
                .and_then(|v| v.parse().ok())
                .map(emu_to_px)
                .unwrap_or(w);
            h = ext
                .attr("cy")
                .and_then(|v| v.parse().ok())
                .map(emu_to_px)
                .unwrap_or(h);
        }
        let alt = e
            .find("wp:docPr")
            .and_then(|d| d.attr("descr"))
            .unwrap_or_default()
            .to_string();
        out.push(Pending::Inline(Inline::Image {
            src: package::data_url(mime, data),
            width: w.round(),
            height: h.round(),
            alt,
        }));
    }

    fn table(&mut self, t: &Element) -> Table {
        let columns_mm: Vec<f64> = t
            .child("w:tblGrid")
            .map(|g| {
                g.children_named("w:gridCol")
                    .map(|c| twips(c, "w:w").map(twips_to_mm).unwrap_or(30.0))
                    .collect()
            })
            .unwrap_or_default();
        let mut rows: Vec<Row> = Vec::new();
        // grid column → (row index, cell index) of the cell a vertical merge continues.
        let mut merges: HashMap<usize, (usize, usize)> = HashMap::new();
        for tr in t
            .elements()
            .filter(|e| e.name == "w:tr" || e.name == "w:sdt" || e.name == "w:customXml")
        {
            let tr = if tr.name == "w:tr" {
                tr
            } else if let Some(x) = tr.find("w:tr") {
                x
            } else {
                continue;
            };
            let header = tr
                .child("w:trPr")
                .map(|p| on(p.child("w:tblHeader")) == Some(true))
                .unwrap_or(false);
            let row_idx = rows.len();
            let height_mm = tr
                .child("w:trPr")
                .and_then(|p| p.child("w:trHeight"))
                .filter(|h| h.attr("w:hRule") == Some("exact"))
                .and_then(|h| h.attr("w:val"))
                .and_then(|v| v.parse::<f64>().ok())
                .map(twips_to_mm);
            let mut row = Row {
                header,
                cells: Vec::new(),
                height_mm,
            };
            let mut col = tr
                .child("w:trPr")
                .and_then(|p| p.child_val("w:gridBefore"))
                .and_then(|v| v.parse().ok())
                .unwrap_or(0usize);
            for tc in tr
                .elements()
                .filter(|e| e.name == "w:tc" || e.name == "w:sdt")
            {
                let tc = if tc.name == "w:tc" {
                    tc
                } else if let Some(x) = tc.find("w:tc") {
                    x
                } else {
                    continue;
                };
                let pr = tc.child("w:tcPr");
                let span = pr
                    .and_then(|p| p.child_val("w:gridSpan"))
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1u32)
                    .max(1);
                let vmerge = pr
                    .and_then(|p| p.child("w:vMerge"))
                    .map(|v| v.attr("w:val").unwrap_or("continue").to_string());
                if vmerge.as_deref() == Some("continue") {
                    if let Some(&(r, c)) = merges.get(&col) {
                        rows[r].cells[c].row_span += 1;
                    }
                    col += span as usize;
                    continue;
                }
                let background = pr
                    .and_then(|p| p.child("w:shd"))
                    .and_then(|s| s.attr("w:fill"))
                    .and_then(hex_color);
                let mut blocks = self.blocks(tc);
                if blocks.is_empty() {
                    blocks.push(Block::Paragraph(Paragraph::default()));
                }
                if vmerge.as_deref() == Some("restart") {
                    merges.insert(col, (row_idx, row.cells.len()));
                } else {
                    merges.remove(&col);
                }
                row.cells.push(Cell {
                    col_span: span,
                    row_span: 1,
                    background,
                    blocks,
                });
                col += span as usize;
            }
            rows.push(row);
        }
        Table { columns_mm, rows }
    }
}

impl Reader<'_> {
    /// Table of contents: entries from the cached field result.
    fn toc(&mut self, content: &Element) -> Block {
        let mut title = None;
        let mut entries = Vec::new();
        let mut paras = Vec::new();
        content.find_all("w:p", &mut paras);
        for p in paras {
            let style = p
                .child("w:pPr")
                .and_then(|x| x.child_val("w:pStyle"))
                .unwrap_or_default();
            let text = note_text(p);
            if let Some(level) = self.toc_styles.get(style).copied() {
                let (label, page) = match text.rsplit_once('\t') {
                    Some((l, n)) if n.trim().chars().all(|c| c.is_ascii_digit()) => {
                        (l.trim().to_string(), n.trim().parse().unwrap_or(0))
                    }
                    _ => (text.trim().to_string(), 0),
                };
                if !label.is_empty() {
                    entries.push(TocEntry {
                        level,
                        text: label,
                        page,
                    });
                }
            } else if entries.is_empty() && title.is_none() && !text.trim().is_empty() {
                title = Some(text.trim().to_string());
            }
        }
        Block::Toc {
            title,
            entries,
            caption: None,
        }
    }
}

fn revision(e: &Element) -> Revision {
    Revision {
        author: e.attr("w:author").unwrap_or_default().to_string(),
        date: e.attr("w:date").unwrap_or_default().to_string(),
    }
}

/// Visible text of a paragraph (tabs kept, field codes and deleted text skipped).
fn note_text(p: &Element) -> String {
    fn walk(e: &Element, out: &mut String) {
        for c in e.elements() {
            match c.name.as_str() {
                "w:t" => out.push_str(&c.text()),
                "w:tab" => out.push('\t'),
                "w:br" | "w:cr" => out.push('\n'),
                "w:instrText" | "w:del" | "w:delText" | "w:footnoteRef" | "w:endnoteRef"
                | "w:annotationRef" => {}
                _ => walk(c, out),
            }
        }
    }
    let mut s = String::new();
    walk(p, &mut s);
    s
}

#[allow(clippy::large_enum_variant)]
enum Pending {
    Inline(Inline),
    PageBreak,
}

/// Field instruction → model field (see [`Inline::Field`]).
fn field_kind(instr: &str) -> Option<String> {
    let mut parts = instr.split_whitespace();
    let word = parts.next().unwrap_or_default().to_ascii_uppercase();
    // First argument, without quotes.
    let arg = || {
        let rest = instr.trim()[word.len()..].trim();
        let a = if let Some(q) = rest.strip_prefix('"') {
            q.split('"').next().unwrap_or_default()
        } else {
            rest.split_whitespace().next().unwrap_or_default()
        };
        a.to_string()
    };
    match word.as_str() {
        "PAGE" => Some("page".into()),
        "NUMPAGES" | "SECTIONPAGES" => Some("pages".into()),
        "DATE" | "CREATEDATE" | "SAVEDATE" => Some("date".into()),
        "AUTHOR" | "LASTSAVEDBY" => Some("author".into()),
        "TITLE" => Some("title".into()),
        "FILENAME" => Some("filename".into()),
        "SEQ" => Some(format!("seq {}", arg())),
        "REF" | "PAGEREF" if !arg().is_empty() => Some(format!("ref {}", arg())),
        "MERGEFIELD" => Some(format!("merge {}", arg())),
        "XE" => Some(format!("xe {}", arg())),
        "CITATION" => Some(format!("cite {}", arg())),
        _ => None,
    }
}

/// Model field → Word field instruction.
fn field_instr(field: &str) -> String {
    let (kind, arg) = field.split_once(' ').unwrap_or((field, ""));
    let quoted = |a: &str| format!("\"{}\"", a.replace('"', "'"));
    match kind {
        "pages" => "NUMPAGES".into(),
        "date" => r#"DATE \@ "dd.MM.yyyy""#.into(),
        "author" => "AUTHOR".into(),
        "title" => "TITLE".into(),
        "filename" => "FILENAME".into(),
        "seq" => format!(r"SEQ {arg} \* ARABIC"),
        "ref" => format!(r"REF {arg} \h"),
        "merge" => format!(
            "MERGEFIELD {}",
            if arg.contains(' ') {
                quoted(arg)
            } else {
                arg.to_string()
            }
        ),
        "xe" => format!("XE {}", quoted(arg)),
        "cite" => format!(r"CITATION {arg} \l 1031"),
        _ => "PAGE".into(),
    }
}

/// Stable bookmark id from its name (ids must be unique per document).
fn bookmark_id(name: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in name.bytes() {
        h = (h ^ u32::from(b)).wrapping_mul(16777619);
    }
    h % 1_000_000 + 1000
}

fn hyperlink_instr(instr: &str) -> Option<String> {
    let rest = instr.trim().strip_prefix("HYPERLINK")?.trim();
    let url = rest.split('"').nth(1)?;
    Some(url.to_string())
}

/// Merge adjacent text runs with identical formatting (Word splits runs
/// for spell checking and revision tracking).
fn merge_text(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    for i in inlines {
        if let Inline::Text { text, marks } = &i {
            if text.is_empty() {
                continue;
            }
            if let Some(Inline::Text {
                text: prev,
                marks: pm,
            }) = out.last_mut()
                && pm == marks
            {
                prev.push_str(text);
                continue;
            }
        }
        out.push(i);
    }
    out
}

// --------------------------------------------------------------- writing --

const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word" mc:Ignorable="w14 wps""#;

struct Writer<'a> {
    /// Page setup of the last section (for column sections).
    page: PageSetup,
    /// `w:pgBorders` of the document, if any.
    page_borders: Option<String>,
    /// The next section starts without a page break (after columns).
    continuous_next: bool,
    pkg: &'a mut PackageWriter,
    /// Relationships of the part being written: (id, type, target, external).
    rels: Vec<(String, String, String, bool)>,
    media_count: &'a mut usize,
    drawing_id: &'a mut usize,
    /// Ordered lists get their own numbering instance so each restarts at 1.
    ordered_nums: &'a mut usize,
    current_ordered: Option<usize>,
    /// Footnote texts in order (id = index + 1).
    footnotes: &'a mut Vec<String>,
    endnotes: &'a mut Vec<String>,
    /// Header/footer references repeated in every section.
    section_refs: String,
    different_first: bool,
    /// Revision ids must be unique in the document.
    revision_id: &'a mut u32,
    open_comment: Option<u32>,
    /// Content width, for the right tab of TOC entries.
    content_twips: i64,
}

impl Writer<'_> {
    fn rel(&mut self, kind: &str, target: String, external: bool) -> String {
        if let Some((id, ..)) = self
            .rels
            .iter()
            .find(|(_, k, t, e)| k == kind && *t == target && *e == external)
        {
            return id.clone();
        }
        let id = format!("rId{}", self.rels.len() + 10);
        self.rels
            .push((id.clone(), kind.to_string(), target, external));
        id
    }

    fn blocks(&mut self, blocks: &[Block], out: &mut String) {
        for (i, b) in blocks.iter().enumerate() {
            match b {
                Block::Paragraph(p) => {
                    // A comment range may continue into the next paragraph.
                    let next = match blocks.get(i + 1) {
                        Some(Block::Paragraph(n)) => n
                            .content
                            .iter()
                            .find_map(|x| {
                                if let Inline::Text { marks, .. } = x {
                                    Some(marks.comment)
                                } else {
                                    None
                                }
                            })
                            .flatten(),
                        _ => None,
                    };
                    self.paragraph(p, next, out)
                }
                Block::Toc {
                    title,
                    entries,
                    caption,
                } => {
                    self.current_ordered = None;
                    self.toc(title.as_deref(), entries, caption.as_deref(), out);
                }
                Block::Index { entries } => {
                    self.current_ordered = None;
                    self.index(entries, out);
                }
                Block::Bibliography { title, entries } => {
                    self.current_ordered = None;
                    self.bibliography(title.as_deref(), entries, out);
                }
                Block::Table(t) => {
                    self.current_ordered = None;
                    self.table(t, out);
                }
                Block::PageBreak => out.push_str(r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#),
                Block::SectionBreak { page } => {
                    self.current_ordered = None;
                    out.push_str(&format!(
                        "<w:p><w:pPr><w:sectPr>{}{}</w:sectPr></w:pPr></w:p>",
                        self.section_refs,
                        self.with_decoration(&sect_props(
                            page,
                            self.different_first,
                            !self.continuous_next
                        ))
                    ));
                    self.continuous_next = false;
                }
                Block::Columns {
                    count,
                    gap_mm,
                    blocks,
                } => {
                    self.current_ordered = None;
                    // The text before ends in its own section; the columns
                    // form a continuous section whose properties follow them.
                    let page = self.page.clone();
                    let mut before =
                        self.with_decoration(&sect_props(&page, self.different_first, false));
                    if self.continuous_next {
                        before = format!(r#"<w:type w:val="continuous"/>{before}"#);
                    }
                    out.push_str(&format!(
                        "<w:p><w:pPr><w:sectPr>{}{before}</w:sectPr></w:pPr></w:p>",
                        self.section_refs
                    ));
                    self.blocks(blocks, out);
                    self.current_ordered = None;
                    let cols = format!(
                        r#"<w:cols w:num="{}" w:space="{}"/>"#,
                        count.clamp(&1, &10),
                        mm_to_twips(*gap_mm)
                    );
                    let props = self
                        .with_decoration(&sect_props(&page, self.different_first, false))
                        .replace(r#"<w:cols w:space="708"/>"#, &cols);
                    out.push_str(&format!(
                        r#"<w:p><w:pPr><w:sectPr>{}<w:type w:val="continuous"/>{props}</w:sectPr></w:pPr></w:p>"#,
                        self.section_refs
                    ));
                    self.continuous_next = true;
                }
            }
        }
    }

    /// Page border of the document added to a section's properties.
    fn with_decoration(&self, props: &str) -> String {
        match &self.page_borders {
            Some(b) => props.replacen(
                r#"<w:cols w:space="708"/>"#,
                &format!(r#"{b}<w:cols w:space="708"/>"#),
                1,
            ),
            None => props.to_string(),
        }
    }

    fn close_comment(&mut self, out: &mut String) {
        if let Some(id) = self.open_comment.take() {
            out.push_str(&format!(r#"<w:commentRangeEnd w:id="{id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{id}"/></w:r>"#));
        }
    }

    /// Open/close comment ranges before a text run.
    fn comment_at(&mut self, i: &Inline, out: &mut String) {
        let Inline::Text { marks, .. } = i else {
            return;
        };
        if marks.comment != self.open_comment {
            self.close_comment(out);
            if let Some(id) = marks.comment {
                out.push_str(&format!(r#"<w:commentRangeStart w:id="{id}"/>"#));
                self.open_comment = Some(id);
            }
        }
    }

    /// Paragraphs of a generated list inside one complex field.
    fn field_list(
        &mut self,
        instr: &str,
        style: &str,
        lines: &[(String, String)],
        empty: &str,
        out: &mut String,
    ) {
        let begin = format!(
            r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> {} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#,
            esc(instr)
        );
        let end = r#"<w:r><w:fldChar w:fldCharType="end"/></w:r>"#;
        let tab = format!(
            r#"<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{}"/></w:tabs>"#,
            self.content_twips
        );
        if lines.is_empty() {
            out.push_str(&format!(r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>{begin}<w:r><w:t>{}</w:t></w:r>{end}</w:p>"#, esc(empty)));
            return;
        }
        for (i, (text, right)) in lines.iter().enumerate() {
            out.push_str(&format!(
                r#"<w:p><w:pPr><w:pStyle w:val="{style}"/>{}</w:pPr>"#,
                if right.is_empty() { "" } else { tab.as_str() }
            ));
            if i == 0 {
                out.push_str(&begin);
            }
            out.push_str(&format!(
                r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
                esc(text)
            ));
            if !right.is_empty() {
                out.push_str(&format!(
                    r#"<w:r><w:tab/></w:r><w:r><w:t>{}</w:t></w:r>"#,
                    esc(right)
                ));
            }
            if i + 1 == lines.len() {
                out.push_str(end);
            }
            out.push_str("</w:p>");
        }
    }

    fn index(&mut self, entries: &[IndexEntry], out: &mut String) {
        let lines: Vec<(String, String)> = entries
            .iter()
            .map(|e| (e.term.clone(), e.pages.clone()))
            .collect();
        self.field_list(
            r#"INDEX \e "	" \c "1" \z "1031""#,
            "Index1",
            &lines,
            &ondura_i18n::tr!("Keine Indexeinträge gefunden."),
            out,
        );
    }

    fn bibliography(&mut self, title: Option<&str>, entries: &[String], out: &mut String) {
        out.push_str(r#"<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Bibliographies"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>"#);
        out.push_str(&format!(r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, esc(title.unwrap_or("Literaturverzeichnis"))));
        let lines: Vec<(String, String)> =
            entries.iter().map(|e| (e.clone(), String::new())).collect();
        self.field_list(
            r#"BIBLIOGRAPHY \l 1031"#,
            "Bibliography",
            &lines,
            &ondura_i18n::tr!("Im aktuellen Dokument sind keine Quellen vorhanden."),
            out,
        );
        out.push_str("</w:sdtContent></w:sdt>");
    }

    fn toc(
        &mut self,
        title: Option<&str>,
        entries: &[TocEntry],
        caption: Option<&str>,
        out: &mut String,
    ) {
        if let Some(label) = caption {
            // Table of figures: a plain TOC field over the caption label.
            if let Some(t) = title {
                out.push_str(&format!(r#"<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, esc(t)));
            }
            let lines: Vec<(String, String)> = entries
                .iter()
                .map(|e| (e.text.clone(), e.page.to_string()))
                .collect();
            self.field_list(
                &format!(r#"TOC \h \z \c "{}""#, label.replace('"', "'")),
                "TableofFigures",
                &lines,
                "Es konnten keine Einträge für ein Abbildungsverzeichnis gefunden werden.",
                out,
            );
            return;
        }
        out.push_str(r#"<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>"#);
        if let Some(t) = title {
            out.push_str(&format!(r#"<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, esc(t)));
        }
        let begin = r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#;
        let end = r#"<w:r><w:fldChar w:fldCharType="end"/></w:r>"#;
        if entries.is_empty() {
            let none = ondura_i18n::tr!("Keine Einträge für das Inhaltsverzeichnis gefunden.");
            out.push_str(&format!(
                r#"<w:p>{begin}<w:r><w:t>{none}</w:t></w:r>{end}</w:p>"#
            ));
        }
        for (i, e) in entries.iter().enumerate() {
            out.push_str(&format!(
                r#"<w:p><w:pPr><w:pStyle w:val="TOC{}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{}"/></w:tabs></w:pPr>"#,
                e.level.clamp(1, 9),
                self.content_twips
            ));
            if i == 0 {
                out.push_str(begin);
            }
            out.push_str(&format!(r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>{}</w:t></w:r>"#, esc(&e.text), e.page));
            if i + 1 == entries.len() {
                out.push_str(end);
            }
            out.push_str("</w:p>");
        }
        out.push_str("</w:sdtContent></w:sdt>");
    }

    fn paragraph(&mut self, p: &Paragraph, next_comment: Option<u32>, out: &mut String) {
        // Drop cap: Word keeps the first letter in a framed paragraph of its own.
        if let Some(lines) = p.drop_cap.filter(|l| *l >= 2)
            && let Some(Inline::Text { text, marks }) = p.content.first()
            && let Some(first) = text.chars().next()
        {
            let lines = lines.min(10) as i64;
            let mut m = marks.clone();
            m.size = Some((lines as f64) * 17.5);
            out.push_str(&format!(
                r#"<w:p><w:pPr><w:keepNext/><w:framePr w:dropCap="drop" w:lines="{lines}" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/><w:spacing w:after="0" w:line="{}" w:lineRule="exact"/><w:textAlignment w:val="baseline"/></w:pPr><w:r>"#,
                lines * 269
            ));
            let mut props = String::new();
            run_props(&m, false, &mut props);
            out.push_str(&props.replacen("</w:rPr>", r#"<w:position w:val="-6"/></w:rPr>"#, 1));
            if !props.contains("<w:rPr>") {
                out.push_str(r#"<w:rPr><w:position w:val="-6"/></w:rPr>"#);
            }
            out.push_str(&format!(
                r#"<w:t>{}</w:t></w:r></w:p>"#,
                esc(&first.to_string())
            ));
            let mut rest = p.clone();
            rest.drop_cap = None;
            if let Some(Inline::Text { text, .. }) = rest.content.first_mut() {
                *text = text.chars().skip(1).collect();
            }
            return self.paragraph(&rest, next_comment, out);
        }
        out.push_str("<w:p><w:pPr>");
        let style = match p.style.as_deref() {
            Some(s) if s.starts_with("heading") => Some(format!(
                "Heading{}",
                s[7..].parse::<u8>().unwrap_or(1).clamp(1, 6)
            )),
            Some("title") => Some("Title".into()),
            Some("subtitle") => Some("Subtitle".into()),
            Some("quote") => Some("Quote".into()),
            Some("code") => Some("Code".into()),
            Some("caption") => Some("Caption".into()),
            _ if p.list.is_some() => Some("ListParagraph".into()),
            _ => None,
        };
        if let Some(s) = style {
            out.push_str(&format!(r#"<w:pStyle w:val="{s}"/>"#));
        }
        if let Some(l) = p.list {
            let num = if l.ordered {
                let n = *self.current_ordered.get_or_insert_with(|| {
                    *self.ordered_nums += 1;
                    *self.ordered_nums
                });
                n + 1
            } else {
                1
            };
            out.push_str(&format!(
                r#"<w:numPr><w:ilvl w:val="{}"/><w:numId w:val="{num}"/></w:numPr>"#,
                l.level.min(8)
            ));
        } else {
            self.current_ordered = None;
        }
        if p.space_before_pt.is_some() || p.space_after_pt.is_some() || p.line_height.is_some() {
            out.push_str("<w:spacing");
            if let Some(b) = p.space_before_pt {
                out.push_str(&format!(r#" w:before="{}""#, (b * 20.0).round() as i64));
            }
            if let Some(a) = p.space_after_pt {
                out.push_str(&format!(r#" w:after="{}""#, (a * 20.0).round() as i64));
            }
            if let Some(l) = p.line_height {
                out.push_str(&format!(
                    r#" w:line="{}" w:lineRule="auto""#,
                    (l * 240.0).round() as i64
                ));
            }
            out.push_str("/>");
        }
        if p.list.is_none() && (!is_zero(&p.indent_mm) || !is_zero(&p.first_line_mm)) {
            out.push_str(&format!(r#"<w:ind w:left="{}""#, mm_to_twips(p.indent_mm)));
            if p.first_line_mm < 0.0 {
                out.push_str(&format!(
                    r#" w:hanging="{}""#,
                    mm_to_twips(-p.first_line_mm)
                ));
            } else if p.first_line_mm > 0.0 {
                out.push_str(&format!(
                    r#" w:firstLine="{}""#,
                    mm_to_twips(p.first_line_mm)
                ));
            }
            out.push_str("/>");
        }
        match p.align.as_deref() {
            Some("center") => out.push_str(r#"<w:jc w:val="center"/>"#),
            Some("right") => out.push_str(r#"<w:jc w:val="right"/>"#),
            Some("justify") => out.push_str(r#"<w:jc w:val="both"/>"#),
            _ => {}
        }
        out.push_str("</w:pPr>");
        let mut i = 0;
        while i < p.content.len() {
            // Group a hyperlink's runs.
            self.comment_at(&p.content[i], out);
            if let Inline::Text {
                marks: Marks {
                    link: Some(url), ..
                },
                ..
            } = &p.content[i]
            {
                let url = url.clone();
                let mut j = i;
                while j < p.content.len()
                    && matches!(&p.content[j], Inline::Text { marks, .. } if marks.link.as_deref() == Some(url.as_str()))
                {
                    j += 1;
                }
                if let Some(anchor) = url.strip_prefix('#') {
                    out.push_str(&format!(r#"<w:hyperlink w:anchor="{}">"#, esc(anchor)));
                } else {
                    let id = self.rel(package::REL_HYPERLINK, url.clone(), true);
                    out.push_str(&format!(r#"<w:hyperlink r:id="{id}">"#));
                }
                for inl in &p.content[i..j] {
                    self.inline(inl, true, out);
                }
                out.push_str("</w:hyperlink>");
                i = j;
            } else {
                self.inline(&p.content[i], false, out);
                i += 1;
            }
        }
        if self.open_comment.is_some() && self.open_comment != next_comment {
            self.close_comment(out);
        }
        out.push_str("</w:p>");
    }

    fn inline(&mut self, i: &Inline, link: bool, out: &mut String) {
        match i {
            Inline::Text { text, marks } => {
                let (wrap, tag) = match (&marks.ins, &marks.del) {
                    (_, Some(r)) => (Some(("w:del", r)), "w:delText"),
                    (Some(r), None) => (Some(("w:ins", r)), "w:t"),
                    _ => (None, "w:t"),
                };
                if let Some((w, r)) = wrap {
                    *self.revision_id += 1;
                    out.push_str(&format!(
                        r#"<{w} w:id="{}" w:author="{}""#,
                        self.revision_id,
                        esc(if r.author.is_empty() {
                            "Ondura"
                        } else {
                            &r.author
                        })
                    ));
                    if !r.date.is_empty() {
                        out.push_str(&format!(r#" w:date="{}""#, esc(&r.date)));
                    }
                    out.push('>');
                }
                for (n, line) in text.split('\n').enumerate() {
                    out.push_str("<w:r>");
                    run_props(marks, link, out);
                    if n > 0 {
                        out.push_str("<w:br/>");
                    }
                    for (k, part) in line.split('\t').enumerate() {
                        if k > 0 {
                            out.push_str("<w:tab/>");
                        }
                        if !part.is_empty() {
                            out.push_str(&format!(
                                r#"<{tag} xml:space="preserve">{}</{tag}>"#,
                                esc(part)
                            ));
                        }
                    }
                    out.push_str("</w:r>");
                }
                if let Some((w, _)) = wrap {
                    out.push_str(&format!("</{w}>"));
                }
            }
            Inline::Footnote {
                text,
                endnote: true,
            } => {
                self.endnotes.push(text.clone());
                out.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="{}"/></w:r>"#, self.endnotes.len()));
            }
            Inline::Footnote { text, .. } => {
                self.footnotes.push(text.clone());
                out.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="{}"/></w:r>"#, self.footnotes.len()));
            }
            Inline::Control {
                kind,
                title,
                value,
                checked,
                items,
                format,
                placeholder,
                marks,
            } => {
                *self.drawing_id += 1;
                out.push_str("<w:sdt><w:sdtPr>");
                run_props(marks, false, out);
                if !title.is_empty() {
                    out.push_str(&format!(
                        r#"<w:alias w:val="{0}"/><w:tag w:val="{0}"/>"#,
                        esc(title)
                    ));
                }
                out.push_str(&format!(
                    r#"<w:id w:val="{}"/>"#,
                    100_000 + *self.drawing_id
                ));
                if *placeholder {
                    out.push_str("<w:showingPlcHdr/>");
                }
                let shown = match kind.as_str() {
                    "checkbox" => {
                        out.push_str(&format!(r#"<w14:checkbox><w14:checked w14:val="{}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>"#, u8::from(*checked)));
                        if *checked { "☒" } else { "☐" }.to_string()
                    }
                    "dropdown" => {
                        out.push_str("<w:dropDownList>");
                        for i in items {
                            out.push_str(&format!(
                                r#"<w:listItem w:displayText="{0}" w:value="{0}"/>"#,
                                esc(i)
                            ));
                        }
                        out.push_str("</w:dropDownList>");
                        value.clone()
                    }
                    "date" => {
                        let f = if format.is_empty() {
                            "dd.MM.yyyy"
                        } else {
                            format
                        };
                        out.push_str(&format!(r#"<w:date><w:dateFormat w:val="{}"/><w:lid w:val="de-DE"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>"#, esc(f)));
                        value.clone()
                    }
                    _ => {
                        out.push_str("<w:text/>");
                        value.clone()
                    }
                };
                out.push_str("</w:sdtPr><w:sdtContent><w:r>");
                run_props(marks, false, out);
                out.push_str(&format!(
                    r#"<w:t xml:space="preserve">{}</w:t></w:r></w:sdtContent></w:sdt>"#,
                    esc(&shown)
                ));
            }
            Inline::Break => out.push_str("<w:r><w:br/></w:r>"),
            Inline::Tab => out.push_str("<w:r><w:tab/></w:r>"),
            Inline::Math { omml, display } => {
                // Only an m:oMath element is accepted (the app generates it).
                let omml = omml.trim();
                if omml.starts_with("<m:oMath") && !omml.starts_with("<m:oMathPara") {
                    if *display {
                        out.push_str(&format!("<m:oMathPara>{omml}</m:oMathPara>"));
                    } else {
                        out.push_str(omml);
                    }
                }
            }
            Inline::Shape {
                kind,
                width_mm,
                height_mm,
                fill,
                line,
                text,
                wrap,
            } => {
                *self.drawing_id += 1;
                let n = *self.drawing_id;
                let (cx, cy) = (mm_to_emu(*width_mm), mm_to_emu(*height_mm));
                let prst = match kind.as_str() {
                    "textBox" => "rect",
                    k
                    @ ("roundRect" | "ellipse" | "triangle" | "rightArrow" | "star5" | "line") => k,
                    _ => "rect",
                };
                let solid =
                    |c: &Option<String>| match c.as_deref().and_then(|c| c.strip_prefix('#')) {
                        Some(hex) => format!(
                            r#"<a:solidFill><a:srgbClr val="{}"/></a:solidFill>"#,
                            esc(hex)
                        ),
                        None => "<a:noFill/>".into(),
                    };
                let mut body = String::new();
                if !text.is_empty() {
                    body.push_str("<wps:txbx><w:txbxContent>");
                    for l in text.split('\n') {
                        body.push_str(&format!(r#"<w:p><w:pPr><w:jc w:val="{}"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, if kind == "textBox" { "left" } else { "center" }, esc(l)));
                    }
                    body.push_str("</w:txbxContent></wps:txbx>");
                }
                let shape = format!(
                    r#"<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr{}/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>{}<a:ln w="12700">{}</a:ln></wps:spPr>{body}<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="{}"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>"#,
                    if kind == "textBox" {
                        r#" txBox="1""#
                    } else {
                        ""
                    },
                    solid(fill),
                    solid(line),
                    if kind == "textBox" { "t" } else { "ctr" },
                );
                let doc_pr = format!(
                    r#"<wp:docPr id="{n}" name="{} {n}"/>"#,
                    if kind == "textBox" {
                        "Textfeld"
                    } else {
                        "Form"
                    }
                );
                if wrap == "left" || wrap == "right" {
                    out.push_str(&format!(
                        r#"<w:r><w:drawing><wp:anchor distT="45720" distB="45720" distL="114300" distR="114300" simplePos="0" relativeHeight="{}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>{wrap}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>{doc_pr}<wp:cNvGraphicFramePr/>{shape}</wp:anchor></w:drawing></w:r>"#,
                        251_659_264 + n
                    ));
                } else {
                    out.push_str(&format!(
                        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{doc_pr}<wp:cNvGraphicFramePr/>{shape}</wp:inline></w:drawing></w:r>"#
                    ));
                }
            }
            Inline::Field { field, result } => {
                let instr = esc(&field_instr(field));
                if field.starts_with("xe ") {
                    out.push_str(&format!(r#"<w:fldSimple w:instr=" {instr} "/>"#));
                } else {
                    let shown = if result.is_empty() {
                        match field.strip_prefix("merge ") {
                            Some(col) => format!("«{col}»"),
                            None => "1".into(),
                        }
                    } else {
                        result.clone()
                    };
                    out.push_str(&format!(r#"<w:fldSimple w:instr=" {instr} "><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:fldSimple>"#, esc(&shown)));
                }
            }
            Inline::Bookmark { name, end } => {
                let id = bookmark_id(name);
                if *end {
                    out.push_str(&format!(r#"<w:bookmarkEnd w:id="{id}"/>"#));
                } else {
                    out.push_str(&format!(
                        r#"<w:bookmarkStart w:id="{id}" w:name="{}"/>"#,
                        esc(name)
                    ));
                }
            }
            Inline::Image {
                src,
                width,
                height,
                alt,
            } => {
                let Some((mime, data)) = package::parse_data_url(src) else {
                    return;
                };
                *self.media_count += 1;
                let name = format!(
                    "media/image{}.{}",
                    self.media_count,
                    package::ext_for(&mime)
                );
                self.pkg.add_media(&format!("word/{name}"), &mime, data);
                let id = self.rel(package::REL_IMAGE, name, false);
                *self.drawing_id += 1;
                let n = *self.drawing_id;
                let (cx, cy) = (px_to_emu(*width), px_to_emu(*height));
                out.push_str(&format!(
                    r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{n}" name="Bild {n}" descr="{alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{n}" name="Bild {n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
                    alt = esc(alt)
                ));
            }
        }
    }

    fn table(&mut self, t: &Table, out: &mut String) {
        let cols = t
            .rows
            .iter()
            .map(|r| r.cells.iter().map(|c| c.col_span as usize).sum::<usize>())
            .max()
            .unwrap_or(1)
            .max(t.columns_mm.len())
            .max(1);
        let widths: Vec<f64> = (0..cols)
            .map(|i| t.columns_mm.get(i).copied().unwrap_or(160.0 / cols as f64))
            .collect();
        out.push_str(r#"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>"#);
        for w in &widths {
            out.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, mm_to_twips(*w)));
        }
        out.push_str("</w:tblGrid>");
        // grid column → (rows still covered, col span)
        let mut active: HashMap<usize, (u32, u32)> = HashMap::new();
        for row in &t.rows {
            out.push_str("<w:tr>");
            if row.header || row.height_mm.is_some() {
                out.push_str("<w:trPr>");
                if let Some(h) = row.height_mm {
                    out.push_str(&format!(
                        r#"<w:cantSplit/><w:trHeight w:val="{}" w:hRule="exact"/>"#,
                        mm_to_twips(h)
                    ));
                }
                if row.header {
                    out.push_str("<w:tblHeader/>");
                }
                out.push_str("</w:trPr>");
            }
            let mut cells = row.cells.iter();
            let mut col = 0usize;
            loop {
                if let Some(&(left, span)) = active.get(&col) {
                    let w: f64 = widths[col..(col + span as usize).min(cols)].iter().sum();
                    out.push_str(&format!(
                        r#"<w:tc><w:tcPr><w:tcW w:w="{}" w:type="dxa"/>"#,
                        mm_to_twips(w)
                    ));
                    if span > 1 {
                        out.push_str(&format!(r#"<w:gridSpan w:val="{span}"/>"#));
                    }
                    out.push_str("<w:vMerge/></w:tcPr><w:p/></w:tc>");
                    if left <= 1 {
                        active.remove(&col);
                    } else {
                        active.insert(col, (left - 1, span));
                    }
                    col += span as usize;
                    continue;
                }
                let Some(cell) = cells.next() else { break };
                let span = cell.col_span.max(1);
                let w: f64 = widths[col.min(cols - 1)..(col + span as usize).min(cols)]
                    .iter()
                    .sum();
                out.push_str(&format!(
                    r#"<w:tc><w:tcPr><w:tcW w:w="{}" w:type="dxa"/>"#,
                    mm_to_twips(w)
                ));
                if span > 1 {
                    out.push_str(&format!(r#"<w:gridSpan w:val="{span}"/>"#));
                }
                if cell.row_span > 1 {
                    out.push_str(r#"<w:vMerge w:val="restart"/>"#);
                    active.insert(col, (cell.row_span - 1, span));
                }
                if let Some(bg) = &cell.background {
                    out.push_str(&format!(
                        r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                        esc(bg.trim_start_matches('#'))
                    ));
                }
                out.push_str("</w:tcPr>");
                let saved = self.current_ordered.take();
                self.blocks(&cell.blocks, out);
                self.current_ordered = saved;
                // A cell must end with a paragraph.
                if !matches!(cell.blocks.last(), Some(Block::Paragraph(_))) {
                    out.push_str("<w:p/>");
                }
                out.push_str("</w:tc>");
                col += span as usize;
            }
            out.push_str("</w:tr>");
        }
        out.push_str("</w:tbl>");
    }
}

fn run_props(m: &Marks, link: bool, out: &mut String) {
    let format = Marks {
        comment: None,
        ins: None,
        del: None,
        link: None,
        ..m.clone()
    };
    if format.is_plain() && !link {
        return;
    }
    out.push_str("<w:rPr>");
    if link {
        out.push_str(r#"<w:rStyle w:val="Hyperlink"/>"#);
    }
    if let Some(f) = &m.font {
        let f = esc(f);
        out.push_str(&format!(
            r#"<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:cs="{f}"/>"#
        ));
    }
    if m.bold {
        out.push_str("<w:b/><w:bCs/>");
    }
    if m.italic {
        out.push_str("<w:i/><w:iCs/>");
    }
    if m.strike {
        out.push_str("<w:strike/>");
    }
    if let Some(c) = &m.color {
        out.push_str(&format!(
            r#"<w:color w:val="{}"/>"#,
            esc(c.trim_start_matches('#'))
        ));
    }
    if let Some(s) = m.size.filter(|s| *s > 0.0) {
        let hp = (s * 2.0).round() as i64;
        out.push_str(&format!(r#"<w:sz w:val="{hp}"/><w:szCs w:val="{hp}"/>"#));
    }
    let named = m.highlight.as_ref().and_then(|h| {
        HIGHLIGHTS
            .iter()
            .find(|(_, c)| c.eq_ignore_ascii_case(h))
            .map(|(n, _)| *n)
    });
    if let Some(n) = named {
        out.push_str(&format!(r#"<w:highlight w:val="{n}"/>"#));
    }
    if m.underline {
        out.push_str(r#"<w:u w:val="single"/>"#);
    }
    if let (None, Some(h)) = (named, &m.highlight) {
        out.push_str(&format!(
            r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
            esc(h.trim_start_matches('#'))
        ));
    }
    if m.superscript {
        out.push_str(r#"<w:vertAlign w:val="superscript"/>"#);
    } else if m.subscript {
        out.push_str(r#"<w:vertAlign w:val="subscript"/>"#);
    }
    out.push_str("</w:rPr>");
}

/// Page size, margins and first-page flag of a `w:sectPr` (after the
/// header/footer references). `next_page` marks a section that ends inside
/// the document.
fn sect_props(p: &PageSetup, different_first: bool, next_page: bool) -> String {
    let landscape = p.width_mm > p.height_mm;
    format!(
        r#"{}<w:pgSz w:w="{}" w:h="{}"{}/><w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="{}" w:footer="{}" w:gutter="0"/><w:cols w:space="708"/>{}"#,
        if next_page {
            r#"<w:type w:val="nextPage"/>"#
        } else {
            ""
        },
        mm_to_twips(p.width_mm),
        mm_to_twips(p.height_mm),
        if landscape {
            r#" w:orient="landscape""#
        } else {
            ""
        },
        mm_to_twips(p.margin_top_mm),
        mm_to_twips(p.margin_right_mm),
        mm_to_twips(p.margin_bottom_mm),
        mm_to_twips(p.margin_left_mm),
        mm_to_twips(p.header_mm),
        mm_to_twips(p.footer_mm),
        if different_first { "<w:titlePg/>" } else { "" },
    )
}

/// Serialise a document as .docx.
pub fn write(doc: &Document) -> Result<Vec<u8>> {
    let mut pkg = PackageWriter::new();
    let mut media = 0usize;
    let mut drawing = 0usize;
    let mut ordered = 0usize;
    let mut footnotes: Vec<String> = Vec::new();
    let mut endnotes: Vec<String> = Vec::new();
    let mut revision = 0u32;
    // Header/footer parts get rId4… in the order below.
    let mut section_refs = String::new();
    {
        let mut i = 0;
        for (blocks, kind, which) in [
            (&doc.header, "header", "default"),
            (&doc.footer, "footer", "default"),
            (&doc.header_first, "header", "first"),
            (&doc.footer_first, "footer", "first"),
        ] {
            // A watermark lives in the headers, so they exist with one.
            let watermark = kind == "header" && doc.watermark.is_some();
            if (blocks.is_empty() && !watermark) || (which == "first" && !doc.different_first) {
                continue;
            }
            section_refs.push_str(&format!(
                r#"<w:{kind}Reference w:type="{which}" r:id="rId{}"/>"#,
                4 + i
            ));
            i += 1;
        }
    }
    let content_twips =
        mm_to_twips(doc.page.width_mm - doc.page.margin_left_mm - doc.page.margin_right_mm);
    let page_borders = doc.page_border.as_ref().map(page_borders_xml);

    let mut hf_parts = Vec::new();
    let mut hf_list = vec![
        (&doc.header, "w:hdr", "header", "header1.xml", "default"),
        (&doc.footer, "w:ftr", "footer", "footer1.xml", "default"),
    ];
    if doc.different_first {
        hf_list.push((&doc.header_first, "w:hdr", "header", "header2.xml", "first"));
        hf_list.push((&doc.footer_first, "w:ftr", "footer", "footer2.xml", "first"));
    }
    for (blocks, tag, kind, file, which) in hf_list {
        let watermark = if kind == "header" {
            doc.watermark.as_ref()
        } else {
            None
        };
        if blocks.is_empty() && watermark.is_none() {
            continue;
        }
        let mut w = Writer {
            page: doc.page.clone(),
            page_borders: page_borders.clone(),
            continuous_next: false,
            pkg: &mut pkg,
            rels: Vec::new(),
            media_count: &mut media,
            drawing_id: &mut drawing,
            ordered_nums: &mut ordered,
            current_ordered: None,
            footnotes: &mut footnotes,
            endnotes: &mut endnotes,
            section_refs: section_refs.clone(),
            different_first: doc.different_first,
            revision_id: &mut revision,
            open_comment: None,
            content_twips,
        };
        let mut body = String::new();
        if let Some(wm) = watermark {
            body.push_str(&watermark_xml(wm, which));
        }
        w.blocks(blocks, &mut body);
        if !matches!(blocks.last(), Some(Block::Paragraph(_)))
            && !(blocks.is_empty() && watermark.is_some())
        {
            body.push_str("<w:p/>");
        }
        let rels = w.rels;
        if !rels.is_empty() {
            pkg.add(
                &format!("word/_rels/{file}.rels"),
                None,
                package::rels_xml(&rels),
            );
        }
        pkg.add(
            &format!("word/{file}"),
            Some(&format!("application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml")),
            format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><{tag} {NS}>{body}</{tag}>"#),
        );
        hf_parts.push((kind, file, which));
    }

    let mut w = Writer {
        page: doc.page.clone(),
        page_borders: page_borders.clone(),
        continuous_next: false,
        pkg: &mut pkg,
        rels: Vec::new(),
        media_count: &mut media,
        drawing_id: &mut drawing,
        ordered_nums: &mut ordered,
        current_ordered: None,
        footnotes: &mut footnotes,
        endnotes: &mut endnotes,
        section_refs: section_refs.clone(),
        different_first: doc.different_first,
        revision_id: &mut revision,
        open_comment: None,
        content_twips,
    };
    let mut body = String::new();
    w.blocks(&doc.blocks, &mut body);
    let w_continuous_end = w.continuous_next;
    // A comment range still open at the end is closed in a final paragraph.
    if w.open_comment.is_some() {
        body.push_str("<w:p>");
        w.close_comment(&mut body);
        body.push_str("</w:p>");
    }
    let mut rels = w.rels;
    rels.push((
        "rId1".into(),
        package::REL_STYLES.into(),
        "styles.xml".into(),
        false,
    ));
    rels.push((
        "rId2".into(),
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering".into(),
        "numbering.xml".into(),
        false,
    ));
    rels.push((
        "rId3".into(),
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings".into(),
        "settings.xml".into(),
        false,
    ));
    if !doc.sources.is_empty() {
        rels.push((
            "rIdSources".into(),
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml".into(),
            "../customXml/item1.xml".into(),
            false,
        ));
    }
    for (i, (kind, file, _)) in hf_parts.iter().enumerate() {
        let id = format!("rId{}", 4 + i);
        rels.push((
            id.clone(),
            format!("http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}"),
            file.to_string(),
            false,
        ));
    }
    let mut last = sect_props(&doc.page, doc.different_first, false);
    if let Some(b) = &page_borders {
        last = last.replacen(
            r#"<w:cols w:space="708"/>"#,
            &format!(r#"{b}<w:cols w:space="708"/>"#),
            1,
        );
    }
    if w_continuous_end {
        last = format!(r#"<w:type w:val="continuous"/>{last}"#);
    }
    let sect = format!("<w:sectPr>{section_refs}{last}</w:sectPr>");
    let ct = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    // Comments that are anchored in the text.
    let used: BTreeSet<u32> = {
        fn collect(blocks: &[Block], out: &mut BTreeSet<u32>) {
            for b in blocks {
                match b {
                    Block::Paragraph(p) => out.extend(p.content.iter().filter_map(|i| {
                        if let Inline::Text { marks, .. } = i {
                            marks.comment
                        } else {
                            None
                        }
                    })),
                    Block::Table(t) => t
                        .rows
                        .iter()
                        .flat_map(|r| &r.cells)
                        .for_each(|c| collect(&c.blocks, out)),
                    _ => {}
                }
            }
        }
        let mut u = BTreeSet::new();
        collect(&doc.blocks, &mut u);
        u
    };
    if !used.is_empty() {
        let mut x =
            format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments {NS}>"#);
        for c in doc.comments.iter().filter(|c| used.contains(&c.id)) {
            x.push_str(&format!(
                r#"<w:comment w:id="{}" w:author="{}""#,
                c.id,
                esc(if c.author.is_empty() {
                    "Ondura"
                } else {
                    &c.author
                })
            ));
            if !c.date.is_empty() {
                x.push_str(&format!(r#" w:date="{}""#, esc(&c.date)));
            }
            let initials: String = c
                .author
                .split_whitespace()
                .filter_map(|w| w.chars().next())
                .collect();
            x.push_str(&format!(r#" w:initials="{}">"#, esc(&initials)));
            for (n, line) in c.text.split('\n').enumerate() {
                x.push_str(r#"<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>"#);
                if n == 0 {
                    x.push_str(r#"<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>"#);
                }
                x.push_str(&format!(
                    r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
                    esc(line)
                ));
            }
            x.push_str("</w:comment>");
        }
        x.push_str("</w:comments>");
        pkg.add("word/comments.xml", Some(&format!("{ct}.comments+xml")), x);
        rels.push((
            "rId8".into(),
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments".into(),
            "comments.xml".into(),
            false,
        ));
    }
    let has_notes = !footnotes.is_empty();
    let has_endnotes = !endnotes.is_empty();
    // Footnotes and endnotes share the layout: two separators, then the notes.
    let notes_xml = |root: &str, tag: &str, style: &str, ref_tag: &str, notes: &[String]| {
        let sep = |kind: &str, id: i32, inner: &str| {
            format!(
                r#"<w:{tag} w:type="{kind}" w:id="{id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:{inner}/></w:r></w:p></w:{tag}>"#
            )
        };
        let mut x = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:{root} {NS}>{}{}"#,
            sep("separator", -1, "separator"),
            sep("continuationSeparator", 0, "continuationSeparator")
        );
        for (i, text) in notes.iter().enumerate() {
            x.push_str(&format!(r#"<w:{tag} w:id="{}">"#, i + 1));
            for (n, line) in text.split('\n').enumerate() {
                x.push_str(&format!(
                    r#"<w:p><w:pPr><w:pStyle w:val="{style}Text"/></w:pPr>"#
                ));
                if n == 0 {
                    x.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="{style}Reference"/></w:rPr><w:{ref_tag}/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>"#));
                }
                x.push_str(&format!(
                    r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
                    esc(line)
                ));
            }
            x.push_str(&format!("</w:{tag}>"));
        }
        x.push_str(&format!("</w:{root}>"));
        x
    };
    if has_notes {
        pkg.add(
            "word/footnotes.xml",
            Some(&format!("{ct}.footnotes+xml")),
            notes_xml(
                "footnotes",
                "footnote",
                "Footnote",
                "footnoteRef",
                &footnotes,
            ),
        );
        rels.push((
            "rId9".into(),
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes".into(),
            "footnotes.xml".into(),
            false,
        ));
    }
    if has_endnotes {
        pkg.add(
            "word/endnotes.xml",
            Some(&format!("{ct}.endnotes+xml")),
            notes_xml("endnotes", "endnote", "Endnote", "endnoteRef", &endnotes),
        );
        rels.push((
            "rIdEndnotes".into(),
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes".into(),
            "endnotes.xml".into(),
            false,
        ));
    }
    if !matches!(doc.blocks.last(), Some(Block::Paragraph(_))) {
        body.push_str("<w:p/>");
    }
    let background = doc
        .page_color
        .as_deref()
        .and_then(|c| c.strip_prefix('#'))
        .map(|c| format!(r#"<w:background w:color="{}"/>"#, esc(c)))
        .unwrap_or_default();
    pkg.add(
        "word/document.xml",
        Some(if doc.template {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
        } else {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
        }),
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}>{background}<w:body>{body}{sect}</w:body></w:document>"#),
    );
    pkg.add(
        "word/_rels/document.xml.rels",
        None,
        package::rels_xml(&rels),
    );
    pkg.add(
        "word/styles.xml",
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"),
        styles_xml(doc),
    );
    if !doc.sources.is_empty() {
        pkg.add("customXml/item1.xml", None, sources_xml(&doc.sources));
        pkg.add(
            "customXml/itemProps1.xml",
            Some("application/vnd.openxmlformats-officedocument.customXmlProperties+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{6E2B8C51-7A3D-4F1B-9C2E-5D4A3B2C1E0F}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>"#,
        );
        pkg.add(
            "customXml/_rels/item1.xml.rels",
            None,
            package::rels_xml(&[("rId1".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps".into(), "itemProps1.xml".into(), false)]),
        );
    }
    pkg.add(
        "word/numbering.xml",
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"),
        numbering_xml(ordered),
    );
    pkg.add(
        "word/settings.xml",
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">{}{}<w:defaultTabStop w:val="708"/>{}{}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>"#,
            if doc.page_color.is_some() { "<w:displayBackgroundShape/>" } else { "" },
            doc.protection.as_ref().map(protection_xml).unwrap_or_default(),
            if has_notes { r#"<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>"# } else { "" },
            if has_endnotes { r#"<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>"# } else { "" }
        ),
    );
    pkg.add(
        "docProps/core.xml",
        Some("application/vnd.openxmlformats-package.core-properties+xml"),
        package::core_xml(&doc.title, &doc.author),
    );
    pkg.add(
        "_rels/.rels",
        None,
        package::rels_xml(&[
            (
                "rId1".into(),
                package::REL_OFFICE_DOCUMENT.into(),
                "word/document.xml".into(),
                false,
            ),
            (
                "rId2".into(),
                package::REL_CORE.into(),
                "docProps/core.xml".into(),
                false,
            ),
        ]),
    );
    pkg.finish()
}

fn mm_to_emu(mm: f64) -> i64 {
    (mm * 36_000.0).round() as i64
}

/// `w:pgBorders` for a page border.
fn page_borders_xml(b: &PageBorder) -> String {
    let (val, factor) = match b.style.as_str() {
        "double" => ("double", 1.0),
        "dotted" => ("dotted", 1.0),
        "dashed" => ("dashed", 1.0),
        "thick" => ("thick", 1.0),
        _ => ("single", 1.0),
    };
    // Eighths of a point, 2..96.
    let sz = ((b.width_pt * 8.0 * factor).round() as i64).clamp(2, 96);
    let color = b.color.trim_start_matches('#');
    let side = |s: &str| {
        format!(
            r#"<w:{s} w:val="{val}" w:sz="{sz}" w:space="24" w:color="{}"/>"#,
            esc(color)
        )
    };
    format!(
        r#"<w:pgBorders w:offsetFrom="page">{}{}{}{}</w:pgBorders>"#,
        side("top"),
        side("left"),
        side("bottom"),
        side("right")
    )
}

/// Watermark as Word writes it: a VML WordArt shape in the header.
fn watermark_xml(w: &Watermark, which: &str) -> String {
    let color = esc(&w.color);
    format!(
        r##"<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="PowerPlusWaterMarkObject{}" o:spid="_x0000_s20{}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:117pt;{}z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="{color}" stroked="f"><v:fill opacity=".5"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="{}"/></v:shape></w:pict></w:r></w:p>"##,
        if which == "first" { 2 } else { 1 },
        if which == "first" { 50 } else { 49 },
        if w.diagonal { "rotation:315;" } else { "" },
        esc(&w.text),
    )
}

/// `w:documentProtection`; the hash is made from a new password.
fn protection_xml(p: &Protection) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let edit = match p.edit.as_str() {
        e @ ("readOnly" | "comments" | "trackedChanges" | "forms") => e,
        _ => return String::new(),
    };
    let (hash, salt, spin) = match p.password.as_deref().filter(|pw| !pw.is_empty()) {
        Some(pw) => {
            let salt: Vec<u8> = (0..16).map(|_| rand::random::<u8>()).collect();
            let spin = 100_000;
            (
                b64.encode(Protection::hash_password(pw, &salt, spin)),
                b64.encode(&salt),
                spin,
            )
        }
        None => (p.hash.clone(), p.salt.clone(), p.spin_count),
    };
    if hash.is_empty() {
        return format!(r#"<w:documentProtection w:edit="{edit}" w:enforcement="1"/>"#);
    }
    format!(
        r#"<w:documentProtection w:edit="{edit}" w:enforcement="1" w:algorithmName="SHA-512" w:hashValue="{}" w:saltValue="{}" w:spinCount="{spin}"/>"#,
        esc(&hash),
        esc(&salt)
    )
}

fn styles_xml(doc: &Document) -> String {
    let font = esc(doc.default_font.as_deref().unwrap_or("Calibri"));
    let size = (doc.default_size.unwrap_or(11.0) * 2.0).round() as i64;
    let mut s = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}" w:cs="{font}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>"#
    );
    for mut spec in style_specs() {
        if let Some(d) = doc.styles.iter().find(|d| d.id == spec.id) {
            spec.apply(d);
        }
        s.push_str(&spec.xml());
    }
    s.push_str(r#"<w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>"#);
    s.push_str(r#"<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>"#);
    for l in 1..=3 {
        s.push_str(&format!(r#"<w:style w:type="paragraph" w:styleId="TOC{l}"><w:name w:val="toc {l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="{}"/></w:pPr></w:style>"#, (l - 1) * 220));
    }
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="TableofFigures"><w:name w:val="table of figures"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Index1"><w:name w:val="index 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="220" w:hanging="220"/></w:pPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="37"/><w:unhideWhenUsed/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:style>"#);
    s.push_str("</w:styles>");
    s
}

fn numbering_xml(ordered_lists: usize) -> String {
    let mut s = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#,
    );
    s.push_str(
        r#"<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>"#,
    );
    for l in 0..9 {
        let (bullet, font) = match l % 3 {
            0 => ("\u{F0B7}", "Symbol"),
            1 => ("o", "Courier New"),
            _ => ("\u{F0A7}", "Wingdings"),
        };
        s.push_str(&format!(
            r#"<w:lvl w:ilvl="{l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="{bullet}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:hint="default"/></w:rPr></w:lvl>"#,
            720 * (l + 1)
        ));
    }
    s.push_str(r#"</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>"#);
    for l in 0..9 {
        let fmt = match l % 3 {
            0 => "decimal",
            1 => "lowerLetter",
            _ => "lowerRoman",
        };
        s.push_str(&format!(
            r#"<w:lvl w:ilvl="{l}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="%{}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{}" w:hanging="360"/></w:pPr></w:lvl>"#,
            l + 1,
            720 * (l + 1)
        ));
    }
    s.push_str(r#"</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#);
    for n in 1..=ordered_lists.max(1) {
        s.push_str(&format!(r#"<w:num w:numId="{}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>"#, n + 1));
    }
    s.push_str("</w:numbering>");
    s
}

const SOURCE_TYPES: [(&str, &str); 4] = [
    ("book", "Book"),
    ("article", "JournalArticle"),
    ("web", "InternetSite"),
    ("report", "Report"),
];

/// `b:Sources` part (Word's source manager).
fn sources_xml(sources: &[Source]) -> String {
    let mut x = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><b:Sources SelectedStyle="\APASixthEditionOfficeOnline.xsl" StyleName="APA" Version="6" xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" xmlns="http://schemas.openxmlformats.org/officeDocument/2006/bibliography">"#,
    );
    for (n, s) in sources.iter().enumerate() {
        let kind = SOURCE_TYPES
            .iter()
            .find(|t| t.0 == s.kind)
            .map(|t| t.1)
            .unwrap_or("Book");
        x.push_str(&format!("<b:Source><b:Tag>{}</b:Tag><b:SourceType>{kind}</b:SourceType><b:Guid>{{6E2B8C51-0000-4000-8000-{:012X}}}</b:Guid>", esc(&s.tag), n + 1));
        let people: Vec<String> = s
            .author
            .split(';')
            .map(str::trim)
            .filter(|a| !a.is_empty())
            .map(|a| match a.split_once(',') {
                Some((last, first)) => format!(
                    "<b:Person><b:Last>{}</b:Last><b:First>{}</b:First></b:Person>",
                    esc(last.trim()),
                    esc(first.trim())
                ),
                None => format!("<b:Person><b:Last>{}</b:Last></b:Person>", esc(a)),
            })
            .collect();
        if !people.is_empty() {
            x.push_str(&format!(
                "<b:Author><b:Author><b:NameList>{}</b:NameList></b:Author></b:Author>",
                people.concat()
            ));
        }
        for (tag, v) in [
            ("Title", &s.title),
            ("Year", &s.year),
            ("Publisher", &s.publisher),
            ("City", &s.city),
            ("JournalName", &s.journal),
            ("Pages", &s.pages),
            ("URL", &s.url),
        ] {
            if !v.is_empty() {
                x.push_str(&format!("<b:{tag}>{}</b:{tag}>", esc(v)));
            }
        }
        x.push_str("</b:Source>");
    }
    x.push_str("</b:Sources>");
    x
}

fn read_sources(root: &Element) -> Vec<Source> {
    let local = |e: &Element| e.name.rsplit(':').next().unwrap_or_default().to_string();
    let child = |e: &Element, n: &str| {
        e.elements()
            .find(|c| local(c) == n)
            .map(|c| c.text().trim().to_string())
            .unwrap_or_default()
    };
    root.elements()
        .filter(|e| local(e) == "Source")
        .map(|e| {
            let kind_raw = child(e, "SourceType");
            let kind = SOURCE_TYPES
                .iter()
                .find(|t| t.1 == kind_raw)
                .map(|t| t.0)
                .unwrap_or("book")
                .to_string();
            let mut people = Vec::new();
            fn persons<'a>(e: &'a Element, out: &mut Vec<&'a Element>) {
                for c in e.elements() {
                    if c.name.rsplit(':').next() == Some("Person") {
                        out.push(c);
                    } else {
                        persons(c, out);
                    }
                }
            }
            if let Some(a) = e.elements().find(|c| local(c) == "Author") {
                persons(a, &mut people);
            }
            let author = people
                .iter()
                .map(|p| {
                    let (l, f) = (child(p, "Last"), child(p, "First"));
                    if f.is_empty() { l } else { format!("{l}, {f}") }
                })
                .collect::<Vec<_>>()
                .join("; ");
            Source {
                tag: child(e, "Tag"),
                kind,
                author,
                title: child(e, "Title"),
                year: child(e, "Year"),
                publisher: child(e, "Publisher"),
                city: child(e, "City"),
                journal: child(e, "JournalName"),
                pages: child(e, "Pages"),
                url: child(e, "URL"),
            }
        })
        .filter(|s| !s.tag.is_empty())
        .collect()
}
