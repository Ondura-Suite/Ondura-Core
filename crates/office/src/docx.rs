//! WordprocessingML (.docx) ⇄ [`Document`] for Nexora Text.

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
        Self { width_mm: 210.0, height_mm: 297.0, margin_top_mm: 25.0, margin_bottom_mm: 20.0, margin_left_mm: 25.0, margin_right_mm: 20.0, header_mm: 12.5, footer_mm: 12.5 }
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
    SectionBreak { page: PageSetup },
    /// Table of contents (a TOC field); entries are filled in by the app.
    Toc {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default)]
        entries: Vec<TocEntry>,
    },
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
    #[serde(default)]
    pub content: Vec<Inline>,
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
    /// `page` or `pages`.
    Field { field: String },
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
}

/// Parse a .docx file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let pkg = Package::open(bytes)?;
    let main = pkg
        .main_part("officeDocument")?
        .filter(|p| pkg.has(p))
        .or_else(|| pkg.has("word/document.xml").then(|| "word/document.xml".to_string()))
        .ok_or_else(|| Error::Format("Kein Word-Dokument gefunden.".into()))?;
    let root = pkg.xml(&main)?.ok_or_else(|| Error::Format("Dokument fehlt".into()))?;
    let body = root.child("w:body").ok_or_else(|| Error::Format("Dokument ohne Inhalt".into()))?;

    let rels: HashMap<String, Relationship> = pkg.rels(&main)?.into_iter().map(|r| (r.id.clone(), r)).collect();
    let mut r = Reader { pkg: &pkg, rels: HashMap::new(), styles: HashMap::new(), numbering: HashMap::new(), theme_minor: None, theme_major: None, warnings: BTreeSet::new(), field: None, open_comments: Vec::new(), notes: HashMap::new(), toc_styles: HashMap::new() };

    let by_kind = |k: &str| rels.values().find(|x| x.kind == k).map(|x| x.target.clone());
    if let Some(theme) = by_kind("theme").and_then(|t| pkg.xml(&t).ok().flatten()) {
        r.theme_minor = theme.find("a:minorFont").and_then(|f| f.child("a:latin")).and_then(|l| l.attr("typeface")).map(String::from);
        r.theme_major = theme.find("a:majorFont").and_then(|f| f.child("a:latin")).and_then(|l| l.attr("typeface")).map(String::from);
    }
    let mut doc = Document { blocks: Vec::new(), ..Default::default() };
    if let Some(styles) = by_kind("styles").and_then(|t| pkg.xml(&t).ok().flatten()) {
        r.read_styles(&styles, &mut doc);
    }
    if let Some(num) = by_kind("numbering").and_then(|t| pkg.xml(&t).ok().flatten()) {
        r.read_numbering(&num);
    }
    for (k, tag, endnote) in [("footnotes", "w:footnote", false), ("endnotes", "w:endnote", true)] {
        let Some(part) = by_kind(k).and_then(|t| pkg.xml(&t).ok().flatten()) else { continue };
        for n in part.children_named(tag).filter(|n| n.attr("w:type").is_none()) {
            let text = n.children_named("w:p").map(note_text).collect::<Vec<_>>().join("\n");
            r.notes.insert((endnote, n.attr("w:id").unwrap_or_default().to_string()), text.trim().to_string());
        }
    }
    if let Some(part) = by_kind("comments").and_then(|t| pkg.xml(&t).ok().flatten()) {
        for c in part.children_named("w:comment") {
            let Some(id) = c.attr("w:id").and_then(|v| v.parse().ok()) else { continue };
            doc.comments.push(Comment {
                id,
                author: c.attr("w:author").unwrap_or_default().to_string(),
                date: c.attr("w:date").unwrap_or_default().to_string(),
                text: c.children_named("w:p").map(note_text).collect::<Vec<_>>().join("\n").trim().to_string(),
            });
        }
    }

    r.rels = rels.clone();
    doc.blocks = r.blocks(body);
    if doc.blocks.is_empty() {
        doc.blocks.push(Block::Paragraph(Paragraph::default()));
    }

    let sect = body.child("w:sectPr");
    if let Some(sect) = sect {
        doc.page = read_page(sect);
        let mut hf = |name: &str, kind: &str| -> Vec<Block> {
            let Some(reference) = sect.children_named(name).find(|h| h.attr("w:type").unwrap_or("default") == kind) else { return Vec::new() };
            let Some(rel) = reference.attr("r:id").and_then(|id| rels.get(id)) else { return Vec::new() };
            let Ok(Some(part)) = pkg.xml(&rel.target) else { return Vec::new() };
            r.rels = pkg.rels(&rel.target).unwrap_or_default().into_iter().map(|x| (x.id.clone(), x)).collect();
            r.blocks(&part)
        };
        doc.header = hf("w:headerReference", "default");
        doc.footer = hf("w:footerReference", "default");
        doc.different_first = on(sect.child("w:titlePg")) == Some(true);
        if doc.different_first {
            doc.header_first = hf("w:headerReference", "first");
            doc.footer_first = hf("w:footerReference", "first");
        }
        if sect.children_named("w:headerReference").chain(sect.children_named("w:footerReference")).any(|h| h.attr("w:type") == Some("even")) {
            r.warnings.insert("Abweichende Kopf-/Fußzeilen für gerade Seiten werden vereinheitlicht.".into());
        }
    }
    let (title, author) = package::read_core(&pkg);
    doc.title = title;
    doc.author = author;
    Ok(Loaded { document: doc, warnings: r.warnings.into_iter().collect() })
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
    (v.len() == 6 && v.chars().all(|c| c.is_ascii_hexdigit())).then(|| format!("#{}", v.to_ascii_lowercase()))
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
            doc.default_size = rpr.child_val("w:sz").and_then(|v| v.parse::<f64>().ok()).map(|v| v / 2.0);
        }
        for s in styles.children_named("w:style") {
            let Some(id) = s.attr("w:styleId") else { continue };
            let ppr = s.child("w:pPr");
            let rpr = s.child("w:rPr");
            let info = StyleInfo {
                name: s.child_val("w:name").unwrap_or(id).to_ascii_lowercase(),
                based_on: s.child_val("w:basedOn").map(String::from),
                kind: s.attr("w:type").unwrap_or("paragraph").to_string(),
                outline: ppr.and_then(|p| p.child_val("w:outlineLvl")).and_then(|v| v.parse().ok()),
                num: ppr.and_then(|p| p.child("w:numPr")).and_then(|n| Some((n.child_val("w:numId")?.to_string(), n.child_val("w:ilvl").and_then(|v| v.parse().ok()).unwrap_or(0)))),
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
            if let Some(l) = info.name.strip_prefix("toc ").and_then(|l| l.trim().parse::<u8>().ok()) {
                self.toc_styles.insert(id.to_string(), l);
            }
            self.styles.insert(id.to_string(), info);
        }
    }

    fn read_numbering(&mut self, num: &Element) {
        let mut abstracts: HashMap<String, HashMap<u8, bool>> = HashMap::new();
        for a in num.children_named("w:abstractNum") {
            let levels = a
                .children_named("w:lvl")
                .filter_map(|l| Some((l.attr("w:ilvl")?.parse().ok()?, !matches!(l.child_val("w:numFmt"), Some("bullet" | "none")))))
                .collect();
            if let Some(id) = a.attr("w:abstractNumId") {
                abstracts.insert(id.to_string(), levels);
            }
        }
        for n in num.children_named("w:num") {
            if let (Some(id), Some(abs)) = (n.attr("w:numId"), n.child_val("w:abstractNumId")) {
                self.numbering.insert(id.to_string(), abstracts.get(abs).cloned().unwrap_or_default());
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
            if let Some(level) = n.strip_prefix("heading ").or_else(|| n.strip_prefix("überschrift ")).and_then(|l| l.trim().parse::<u8>().ok()) {
                return Some(format!("heading{}", level.clamp(1, 6)));
            }
            match n {
                "title" | "titel" => return Some("title".into()),
                "subtitle" | "untertitel" => return Some("subtitle".into()),
                "quote" | "zitat" | "intense quote" | "intensives zitat" => return Some("quote".into()),
                "html preformatted" | "code" | "source code" => return Some("code".into()),
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
        let mut out = Vec::new();
        for e in parent.elements() {
            match e.name.as_str() {
                "w:p" => {
                    self.paragraph(e, &mut out);
                    if let Some(sect) = e.child("w:pPr").and_then(|p| p.child("w:sectPr")) {
                        out.push(Block::SectionBreak { page: read_page(sect) });
                    }
                }
                "w:tbl" => out.push(Block::Table(self.table(e))),
                "w:sdt" => {
                    let gallery = e.find("w:docPartGallery").and_then(|g| g.attr("w:val")).unwrap_or_default();
                    if let Some(c) = e.child("w:sdtContent") {
                        if gallery == "Table of Contents" {
                            out.push(self.toc(c));
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
                    self.warnings.insert("Eingebettete Fremdinhalte (altChunk) werden nicht angezeigt.".into());
                }
                _ => {}
            }
        }
        out
    }

    fn paragraph(&mut self, p: &Element, out: &mut Vec<Block>) {
        let mut para = Paragraph::default();
        let ppr = p.child("w:pPr");
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
                para.indent_mm = twips(ind, "w:left").or_else(|| twips(ind, "w:start")).map(twips_to_mm).unwrap_or(0.0);
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
                    para.line_height = twips(sp, "w:line").map(|v| (v / 240.0 * 100.0).round() / 100.0);
                }
            }
            let num = ppr.child("w:numPr").and_then(|n| Some((n.child_val("w:numId")?.to_string(), n.child_val("w:ilvl").and_then(|v| v.parse().ok()).unwrap_or(0u8)))).or(style_num);
            if let Some((id, level)) = num.filter(|(id, _)| id != "0") {
                let ordered = self.numbering.get(&id).and_then(|l| l.get(&level)).copied().unwrap_or(false);
                para.list = Some(ListRef { ordered, level: level.min(8) });
                // List indentation comes from the numbering definition.
                para.indent_mm = 0.0;
                para.first_line_mm = 0.0;
            }
            if on(ppr.child("w:pageBreakBefore")) == Some(true) {
                out.push(Block::PageBreak);
            }
        }
        let template = Paragraph { content: Vec::new(), ..para.clone() };
        let mut inlines = Vec::new();
        self.inlines(p, &Marks::default(), &mut inlines);
        // Split at page breaks.
        let mut current = Vec::new();
        for i in inlines {
            match i {
                Pending::Inline(i) => current.push(i),
                Pending::PageBreak => {
                    if !current.is_empty() {
                        out.push(Block::Paragraph(Paragraph { content: merge_text(std::mem::take(&mut current)), ..template.clone() }));
                    }
                    out.push(Block::PageBreak);
                }
            }
        }
        let empty_after_break = current.is_empty() && matches!(out.last(), Some(Block::PageBreak)) && ppr.is_none();
        if !empty_after_break {
            para.content = merge_text(current);
            out.push(Block::Paragraph(para));
        }
    }

    fn inlines(&mut self, parent: &Element, marks: &Marks, out: &mut Vec<Pending>) {
        for e in parent.elements() {
            match e.name.as_str() {
                "w:r" => self.run(e, marks, out),
                "w:hyperlink" => {
                    let mut m = marks.clone();
                    let target = e.attr("r:id").and_then(|id| self.rels.get(id)).map(|r| r.target.clone()).or_else(|| e.attr("w:anchor").map(|a| format!("#{a}")));
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
                    if let Some(c) = e.child("w:sdtContent") {
                        self.inlines(c, marks, out);
                    }
                }
                "w:fldSimple" => {
                    let instr = e.attr("w:instr").unwrap_or_default().trim().to_ascii_uppercase();
                    if let Some(f) = field_kind(&instr) {
                        out.push(Pending::Inline(Inline::Field { field: f.into() }));
                    } else {
                        let mut m = marks.clone();
                        if let Some(url) = hyperlink_instr(e.attr("w:instr").unwrap_or_default()) {
                            m.link = Some(url);
                        }
                        self.inlines(e, &m, out);
                    }
                }
                "m:oMath" | "m:oMathPara" | "oMath" | "oMathPara" => {
                    self.warnings.insert("Formeln werden als Text angezeigt.".into());
                    out.push(Pending::Inline(Inline::Text { text: e.text(), marks: marks.clone() }));
                }
                _ => {}
            }
        }
    }

    fn run_marks(&self, r: &Element, base: &Marks) -> Marks {
        let mut m = base.clone();
        let Some(rpr) = r.child("w:rPr") else { return m };
        if let Some(id) = rpr.child_val("w:rStyle") {
            for s in self.style_chain(id).iter().rev() {
                if let Some(b) = s.bold {
                    m.bold = b;
                }
                if let Some(i) = s.italic {
                    m.italic = i;
                }
            }
            let n = self.styles.get(id).map(|s| s.name.as_str()).unwrap_or_default();
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
            m.highlight = HIGHLIGHTS.iter().find(|(n, _)| *n == h).map(|(_, c)| c.to_string());
        } else if let Some(fill) = rpr.child("w:shd").and_then(|s| s.attr("w:fill")).and_then(hex_color) {
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
                            if let Some(f) = field_kind(&instr.trim().to_ascii_uppercase()) {
                                out.push(Pending::Inline(Inline::Field { field: f.into() }));
                            }
                        }
                    }
                    Some("end") => self.field = None,
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
                    if let Some((instr, sep)) = &self.field
                        && (!sep || field_kind(&instr.trim().to_ascii_uppercase()).is_some())
                    {
                        continue;
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
            "w:t" | "w:delText" => out.push(Pending::Inline(Inline::Text { text: e.text(), marks: marks.clone() })),
            "w:tab" | "w:ptab" => out.push(Pending::Inline(Inline::Tab)),
            "w:br" => match e.attr("w:type") {
                Some("page") => out.push(Pending::PageBreak),
                Some("column") => out.push(Pending::Inline(Inline::Break)),
                _ => out.push(Pending::Inline(Inline::Break)),
            },
            "w:cr" => out.push(Pending::Inline(Inline::Break)),
            "w:noBreakHyphen" => out.push(Pending::Inline(Inline::Text { text: "\u{2011}".into(), marks: marks.clone() })),
            "w:sym" => {
                if let Some(c) = e.attr("w:char").and_then(|c| u32::from_str_radix(c, 16).ok()) {
                    // Symbol fonts use the private use area F0xx.
                    let c = if (0xF000..0xF100).contains(&c) { c - 0xF000 } else { c };
                    let text = match (e.attr("w:font").unwrap_or_default(), c) {
                        (f, 0xB7) if f.contains("Symbol") => "•".to_string(),
                        (f, 0xFC) if f.contains("Wingdings") => "✓".to_string(),
                        _ => char::from_u32(c).map(String::from).unwrap_or_default(),
                    };
                    out.push(Pending::Inline(Inline::Text { text, marks: marks.clone() }));
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
                let key = (e.name == "w:endnoteReference", e.attr("w:id").unwrap_or_default().to_string());
                if let Some(text) = self.notes.get(&key) {
                    out.push(Pending::Inline(Inline::Footnote { text: text.clone(), endnote: key.0 }));
                }
            }
            "w:commentReference" => {}
            _ => {}
        }
    }

    fn drawing(&mut self, e: &Element, out: &mut Vec<Pending>) {
        if e.find("wps:txbx").is_some() || e.find("w:txbxContent").is_some() {
            self.warnings.insert("Textfelder werden nicht unterstützt; ihr Inhalt wird als Text eingefügt.".into());
            if let Some(tb) = e.find("w:txbxContent") {
                let text: Vec<String> = tb.children_named("w:p").map(|p| p.text()).filter(|t| !t.is_empty()).collect();
                if !text.is_empty() {
                    out.push(Pending::Inline(Inline::Text { text: text.join(" "), marks: Marks::default() }));
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
                self.warnings.insert("Zeichnungen und Diagramme werden nicht angezeigt.".into());
            }
            return;
        };
        if e.find("wp:anchor").is_some() {
            self.warnings.insert("Frei positionierte Bilder werden im Textfluss angezeigt.".into());
        }
        let mime = package::mime_for(&rel.target);
        if matches!(mime, "image/x-emf" | "image/x-wmf" | "image/tiff" | "application/octet-stream") {
            self.warnings.insert("EMF/WMF-Grafiken können nicht angezeigt werden.".into());
            return;
        }
        let Some(data) = self.pkg.part(&rel.target) else { return };
        let (mut w, mut h) = (200.0, 150.0);
        if let Some(ext) = e.find("wp:extent") {
            w = ext.attr("cx").and_then(|v| v.parse().ok()).map(emu_to_px).unwrap_or(w);
            h = ext.attr("cy").and_then(|v| v.parse().ok()).map(emu_to_px).unwrap_or(h);
        }
        let alt = e.find("wp:docPr").and_then(|d| d.attr("descr")).unwrap_or_default().to_string();
        out.push(Pending::Inline(Inline::Image { src: package::data_url(mime, data), width: w.round(), height: h.round(), alt }));
    }

    fn table(&mut self, t: &Element) -> Table {
        let columns_mm: Vec<f64> = t.child("w:tblGrid").map(|g| g.children_named("w:gridCol").map(|c| twips(c, "w:w").map(twips_to_mm).unwrap_or(30.0)).collect()).unwrap_or_default();
        let mut rows: Vec<Row> = Vec::new();
        // grid column → (row index, cell index) of the cell a vertical merge continues.
        let mut merges: HashMap<usize, (usize, usize)> = HashMap::new();
        for tr in t.elements().filter(|e| e.name == "w:tr" || e.name == "w:sdt" || e.name == "w:customXml") {
            let tr = if tr.name == "w:tr" { tr } else if let Some(x) = tr.find("w:tr") { x } else { continue };
            let header = tr.child("w:trPr").map(|p| on(p.child("w:tblHeader")) == Some(true)).unwrap_or(false);
            let row_idx = rows.len();
            let mut row = Row { header, cells: Vec::new() };
            let mut col = tr.child("w:trPr").and_then(|p| p.child_val("w:gridBefore")).and_then(|v| v.parse().ok()).unwrap_or(0usize);
            for tc in tr.elements().filter(|e| e.name == "w:tc" || e.name == "w:sdt") {
                let tc = if tc.name == "w:tc" { tc } else if let Some(x) = tc.find("w:tc") { x } else { continue };
                let pr = tc.child("w:tcPr");
                let span = pr.and_then(|p| p.child_val("w:gridSpan")).and_then(|v| v.parse().ok()).unwrap_or(1u32).max(1);
                let vmerge = pr.and_then(|p| p.child("w:vMerge")).map(|v| v.attr("w:val").unwrap_or("continue").to_string());
                if vmerge.as_deref() == Some("continue") {
                    if let Some(&(r, c)) = merges.get(&col) {
                        rows[r].cells[c].row_span += 1;
                    }
                    col += span as usize;
                    continue;
                }
                let background = pr.and_then(|p| p.child("w:shd")).and_then(|s| s.attr("w:fill")).and_then(hex_color);
                let mut blocks = self.blocks(tc);
                if blocks.is_empty() {
                    blocks.push(Block::Paragraph(Paragraph::default()));
                }
                if vmerge.as_deref() == Some("restart") {
                    merges.insert(col, (row_idx, row.cells.len()));
                } else {
                    merges.remove(&col);
                }
                row.cells.push(Cell { col_span: span, row_span: 1, background, blocks });
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
            let style = p.child("w:pPr").and_then(|x| x.child_val("w:pStyle")).unwrap_or_default();
            let text = note_text(p);
            if let Some(level) = self.toc_styles.get(style).copied() {
                let (label, page) = match text.rsplit_once('\t') {
                    Some((l, n)) if n.trim().chars().all(|c| c.is_ascii_digit()) => (l.trim().to_string(), n.trim().parse().unwrap_or(0)),
                    _ => (text.trim().to_string(), 0),
                };
                if !label.is_empty() {
                    entries.push(TocEntry { level, text: label, page });
                }
            } else if entries.is_empty() && title.is_none() && !text.trim().is_empty() {
                title = Some(text.trim().to_string());
            }
        }
        Block::Toc { title, entries }
    }
}

fn revision(e: &Element) -> Revision {
    Revision { author: e.attr("w:author").unwrap_or_default().to_string(), date: e.attr("w:date").unwrap_or_default().to_string() }
}

/// Visible text of a paragraph (tabs kept, field codes and deleted text skipped).
fn note_text(p: &Element) -> String {
    fn walk(e: &Element, out: &mut String) {
        for c in e.elements() {
            match c.name.as_str() {
                "w:t" => out.push_str(&c.text()),
                "w:tab" => out.push('\t'),
                "w:br" | "w:cr" => out.push('\n'),
                "w:instrText" | "w:del" | "w:delText" | "w:footnoteRef" | "w:endnoteRef" | "w:annotationRef" => {}
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

fn field_kind(instr: &str) -> Option<&'static str> {
    let word = instr.split_whitespace().next().unwrap_or_default();
    match word {
        "PAGE" => Some("page"),
        "NUMPAGES" | "SECTIONPAGES" => Some("pages"),
        _ => None,
    }
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
            if let Some(Inline::Text { text: prev, marks: pm }) = out.last_mut()
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

const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture""#;

struct Writer<'a> {
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
        if let Some((id, ..)) = self.rels.iter().find(|(_, k, t, e)| k == kind && *t == target && *e == external) {
            return id.clone();
        }
        let id = format!("rId{}", self.rels.len() + 10);
        self.rels.push((id.clone(), kind.to_string(), target, external));
        id
    }

    fn blocks(&mut self, blocks: &[Block], out: &mut String) {
        for (i, b) in blocks.iter().enumerate() {
            match b {
                Block::Paragraph(p) => {
                    // A comment range may continue into the next paragraph.
                    let next = match blocks.get(i + 1) {
                        Some(Block::Paragraph(n)) => n.content.iter().find_map(|x| if let Inline::Text { marks, .. } = x { Some(marks.comment) } else { None }).flatten(),
                        _ => None,
                    };
                    self.paragraph(p, next, out)
                }
                Block::Toc { title, entries } => {
                    self.current_ordered = None;
                    self.toc(title.as_deref(), entries, out);
                }
                Block::Table(t) => {
                    self.current_ordered = None;
                    self.table(t, out);
                }
                Block::PageBreak => out.push_str(r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#),
                Block::SectionBreak { page } => {
                    self.current_ordered = None;
                    out.push_str(&format!("<w:p><w:pPr><w:sectPr>{}{}</w:sectPr></w:pPr></w:p>", self.section_refs, sect_props(page, self.different_first, true)));
                }
            }
        }
    }

    fn close_comment(&mut self, out: &mut String) {
        if let Some(id) = self.open_comment.take() {
            out.push_str(&format!(r#"<w:commentRangeEnd w:id="{id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{id}"/></w:r>"#));
        }
    }

    /// Open/close comment ranges before a text run.
    fn comment_at(&mut self, i: &Inline, out: &mut String) {
        let Inline::Text { marks, .. } = i else { return };
        if marks.comment != self.open_comment {
            self.close_comment(out);
            if let Some(id) = marks.comment {
                out.push_str(&format!(r#"<w:commentRangeStart w:id="{id}"/>"#));
                self.open_comment = Some(id);
            }
        }
    }

    fn toc(&mut self, title: Option<&str>, entries: &[TocEntry], out: &mut String) {
        out.push_str(r#"<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>"#);
        if let Some(t) = title {
            out.push_str(&format!(r#"<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, esc(t)));
        }
        let begin = r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#;
        let end = r#"<w:r><w:fldChar w:fldCharType="end"/></w:r>"#;
        if entries.is_empty() {
            out.push_str(&format!(r#"<w:p>{begin}<w:r><w:t>Keine Einträge für das Inhaltsverzeichnis gefunden.</w:t></w:r>{end}</w:p>"#));
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
        out.push_str("<w:p><w:pPr>");
        let style = match p.style.as_deref() {
            Some(s) if s.starts_with("heading") => Some(format!("Heading{}", s[7..].parse::<u8>().unwrap_or(1).clamp(1, 6))),
            Some("title") => Some("Title".into()),
            Some("subtitle") => Some("Subtitle".into()),
            Some("quote") => Some("Quote".into()),
            Some("code") => Some("Code".into()),
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
            out.push_str(&format!(r#"<w:numPr><w:ilvl w:val="{}"/><w:numId w:val="{num}"/></w:numPr>"#, l.level.min(8)));
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
                out.push_str(&format!(r#" w:line="{}" w:lineRule="auto""#, (l * 240.0).round() as i64));
            }
            out.push_str("/>");
        }
        if p.list.is_none() && (!is_zero(&p.indent_mm) || !is_zero(&p.first_line_mm)) {
            out.push_str(&format!(r#"<w:ind w:left="{}""#, mm_to_twips(p.indent_mm)));
            if p.first_line_mm < 0.0 {
                out.push_str(&format!(r#" w:hanging="{}""#, mm_to_twips(-p.first_line_mm)));
            } else if p.first_line_mm > 0.0 {
                out.push_str(&format!(r#" w:firstLine="{}""#, mm_to_twips(p.first_line_mm)));
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
            if let Inline::Text { marks: Marks { link: Some(url), .. }, .. } = &p.content[i] {
                let url = url.clone();
                let mut j = i;
                while j < p.content.len() && matches!(&p.content[j], Inline::Text { marks, .. } if marks.link.as_deref() == Some(url.as_str())) {
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
                    out.push_str(&format!(r#"<{w} w:id="{}" w:author="{}""#, self.revision_id, esc(if r.author.is_empty() { "Nexora" } else { &r.author })));
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
                            out.push_str(&format!(r#"<{tag} xml:space="preserve">{}</{tag}>"#, esc(part)));
                        }
                    }
                    out.push_str("</w:r>");
                }
                if let Some((w, _)) = wrap {
                    out.push_str(&format!("</{w}>"));
                }
            }
            Inline::Footnote { text, endnote: true } => {
                self.endnotes.push(text.clone());
                out.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="{}"/></w:r>"#, self.endnotes.len()));
            }
            Inline::Footnote { text, .. } => {
                self.footnotes.push(text.clone());
                out.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="{}"/></w:r>"#, self.footnotes.len()));
            }
            Inline::Break => out.push_str("<w:r><w:br/></w:r>"),
            Inline::Tab => out.push_str("<w:r><w:tab/></w:r>"),
            Inline::Field { field } => {
                let instr = if field == "pages" { "NUMPAGES" } else { "PAGE" };
                out.push_str(&format!(r#"<w:fldSimple w:instr=" {instr} "><w:r><w:t>1</w:t></w:r></w:fldSimple>"#));
            }
            Inline::Image { src, width, height, alt } => {
                let Some((mime, data)) = package::parse_data_url(src) else { return };
                *self.media_count += 1;
                let name = format!("media/image{}.{}", self.media_count, package::ext_for(&mime));
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
        let cols = t.rows.iter().map(|r| r.cells.iter().map(|c| c.col_span as usize).sum::<usize>()).max().unwrap_or(1).max(t.columns_mm.len()).max(1);
        let widths: Vec<f64> = (0..cols).map(|i| t.columns_mm.get(i).copied().unwrap_or(160.0 / cols as f64)).collect();
        out.push_str(r#"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>"#);
        for w in &widths {
            out.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, mm_to_twips(*w)));
        }
        out.push_str("</w:tblGrid>");
        // grid column → (rows still covered, col span)
        let mut active: HashMap<usize, (u32, u32)> = HashMap::new();
        for row in &t.rows {
            out.push_str("<w:tr>");
            if row.header {
                out.push_str("<w:trPr><w:tblHeader/></w:trPr>");
            }
            let mut cells = row.cells.iter();
            let mut col = 0usize;
            loop {
                if let Some(&(left, span)) = active.get(&col) {
                    let w: f64 = widths[col..(col + span as usize).min(cols)].iter().sum();
                    out.push_str(&format!(r#"<w:tc><w:tcPr><w:tcW w:w="{}" w:type="dxa"/>"#, mm_to_twips(w)));
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
                let w: f64 = widths[col.min(cols - 1)..(col + span as usize).min(cols)].iter().sum();
                out.push_str(&format!(r#"<w:tc><w:tcPr><w:tcW w:w="{}" w:type="dxa"/>"#, mm_to_twips(w)));
                if span > 1 {
                    out.push_str(&format!(r#"<w:gridSpan w:val="{span}"/>"#));
                }
                if cell.row_span > 1 {
                    out.push_str(r#"<w:vMerge w:val="restart"/>"#);
                    active.insert(col, (cell.row_span - 1, span));
                }
                if let Some(bg) = &cell.background {
                    out.push_str(&format!(r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#, esc(bg.trim_start_matches('#'))));
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
    let format = Marks { comment: None, ins: None, del: None, link: None, ..m.clone() };
    if format.is_plain() && !link {
        return;
    }
    out.push_str("<w:rPr>");
    if link {
        out.push_str(r#"<w:rStyle w:val="Hyperlink"/>"#);
    }
    if let Some(f) = &m.font {
        let f = esc(f);
        out.push_str(&format!(r#"<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:cs="{f}"/>"#));
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
        out.push_str(&format!(r#"<w:color w:val="{}"/>"#, esc(c.trim_start_matches('#'))));
    }
    if let Some(s) = m.size.filter(|s| *s > 0.0) {
        let hp = (s * 2.0).round() as i64;
        out.push_str(&format!(r#"<w:sz w:val="{hp}"/><w:szCs w:val="{hp}"/>"#));
    }
    let named = m.highlight.as_ref().and_then(|h| HIGHLIGHTS.iter().find(|(_, c)| c.eq_ignore_ascii_case(h)).map(|(n, _)| *n));
    if let Some(n) = named {
        out.push_str(&format!(r#"<w:highlight w:val="{n}"/>"#));
    }
    if m.underline {
        out.push_str(r#"<w:u w:val="single"/>"#);
    }
    if let (None, Some(h)) = (named, &m.highlight) {
        out.push_str(&format!(r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#, esc(h.trim_start_matches('#'))));
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
        if next_page { r#"<w:type w:val="nextPage"/>"# } else { "" },
        mm_to_twips(p.width_mm),
        mm_to_twips(p.height_mm),
        if landscape { r#" w:orient="landscape""# } else { "" },
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
        for (blocks, kind, which) in [(&doc.header, "header", "default"), (&doc.footer, "footer", "default"), (&doc.header_first, "header", "first"), (&doc.footer_first, "footer", "first")] {
            if blocks.is_empty() || (which == "first" && !doc.different_first) {
                continue;
            }
            section_refs.push_str(&format!(r#"<w:{kind}Reference w:type="{which}" r:id="rId{}"/>"#, 4 + i));
            i += 1;
        }
    }
    let content_twips = mm_to_twips(doc.page.width_mm - doc.page.margin_left_mm - doc.page.margin_right_mm);

    let mut hf_parts = Vec::new();
    let mut hf_list = vec![(&doc.header, "w:hdr", "header", "header1.xml", "default"), (&doc.footer, "w:ftr", "footer", "footer1.xml", "default")];
    if doc.different_first {
        hf_list.push((&doc.header_first, "w:hdr", "header", "header2.xml", "first"));
        hf_list.push((&doc.footer_first, "w:ftr", "footer", "footer2.xml", "first"));
    }
    for (blocks, tag, kind, file, which) in hf_list {
        if blocks.is_empty() {
            continue;
        }
        let mut w = Writer { pkg: &mut pkg, rels: Vec::new(), media_count: &mut media, drawing_id: &mut drawing, ordered_nums: &mut ordered, current_ordered: None, footnotes: &mut footnotes, endnotes: &mut endnotes, section_refs: section_refs.clone(), different_first: doc.different_first, revision_id: &mut revision, open_comment: None, content_twips };
        let mut body = String::new();
        w.blocks(blocks, &mut body);
        if !matches!(blocks.last(), Some(Block::Paragraph(_))) {
            body.push_str("<w:p/>");
        }
        let rels = w.rels;
        if !rels.is_empty() {
            pkg.add(&format!("word/_rels/{file}.rels"), None, package::rels_xml(&rels));
        }
        pkg.add(
            &format!("word/{file}"),
            Some(&format!("application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml")),
            format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><{tag} {NS}>{body}</{tag}>"#),
        );
        hf_parts.push((kind, file, which));
    }

    let mut w = Writer { pkg: &mut pkg, rels: Vec::new(), media_count: &mut media, drawing_id: &mut drawing, ordered_nums: &mut ordered, current_ordered: None, footnotes: &mut footnotes, endnotes: &mut endnotes, section_refs: section_refs.clone(), different_first: doc.different_first, revision_id: &mut revision, open_comment: None, content_twips };
    let mut body = String::new();
    w.blocks(&doc.blocks, &mut body);
    // A comment range still open at the end is closed in a final paragraph.
    if w.open_comment.is_some() {
        body.push_str("<w:p>");
        w.close_comment(&mut body);
        body.push_str("</w:p>");
    }
    let mut rels = w.rels;
    rels.push(("rId1".into(), package::REL_STYLES.into(), "styles.xml".into(), false));
    rels.push(("rId2".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering".into(), "numbering.xml".into(), false));
    rels.push(("rId3".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings".into(), "settings.xml".into(), false));
    for (i, (kind, file, _)) in hf_parts.iter().enumerate() {
        let id = format!("rId{}", 4 + i);
        rels.push((id.clone(), format!("http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}"), file.to_string(), false));
    }
    let sect = format!("<w:sectPr>{section_refs}{}</w:sectPr>", sect_props(&doc.page, doc.different_first, false));
    let ct = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    // Comments that are anchored in the text.
    let used: BTreeSet<u32> = {
        fn collect(blocks: &[Block], out: &mut BTreeSet<u32>) {
            for b in blocks {
                match b {
                    Block::Paragraph(p) => out.extend(p.content.iter().filter_map(|i| if let Inline::Text { marks, .. } = i { marks.comment } else { None })),
                    Block::Table(t) => t.rows.iter().flat_map(|r| &r.cells).for_each(|c| collect(&c.blocks, out)),
                    _ => {}
                }
            }
        }
        let mut u = BTreeSet::new();
        collect(&doc.blocks, &mut u);
        u
    };
    if !used.is_empty() {
        let mut x = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments {NS}>"#);
        for c in doc.comments.iter().filter(|c| used.contains(&c.id)) {
            x.push_str(&format!(r#"<w:comment w:id="{}" w:author="{}""#, c.id, esc(if c.author.is_empty() { "Nexora" } else { &c.author })));
            if !c.date.is_empty() {
                x.push_str(&format!(r#" w:date="{}""#, esc(&c.date)));
            }
            let initials: String = c.author.split_whitespace().filter_map(|w| w.chars().next()).collect();
            x.push_str(&format!(r#" w:initials="{}">"#, esc(&initials)));
            for (n, line) in c.text.split('\n').enumerate() {
                x.push_str(r#"<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>"#);
                if n == 0 {
                    x.push_str(r#"<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>"#);
                }
                x.push_str(&format!(r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, esc(line)));
            }
            x.push_str("</w:comment>");
        }
        x.push_str("</w:comments>");
        pkg.add("word/comments.xml", Some(&format!("{ct}.comments+xml")), x);
        rels.push(("rId8".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments".into(), "comments.xml".into(), false));
    }
    let has_notes = !footnotes.is_empty();
    let has_endnotes = !endnotes.is_empty();
    // Footnotes and endnotes share the layout: two separators, then the notes.
    let notes_xml = |root: &str, tag: &str, style: &str, ref_tag: &str, notes: &[String]| {
        let sep = |kind: &str, id: i32, inner: &str| format!(r#"<w:{tag} w:type="{kind}" w:id="{id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:{inner}/></w:r></w:p></w:{tag}>"#);
        let mut x = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:{root} {NS}>{}{}"#, sep("separator", -1, "separator"), sep("continuationSeparator", 0, "continuationSeparator"));
        for (i, text) in notes.iter().enumerate() {
            x.push_str(&format!(r#"<w:{tag} w:id="{}">"#, i + 1));
            for (n, line) in text.split('\n').enumerate() {
                x.push_str(&format!(r#"<w:p><w:pPr><w:pStyle w:val="{style}Text"/></w:pPr>"#));
                if n == 0 {
                    x.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="{style}Reference"/></w:rPr><w:{ref_tag}/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>"#));
                }
                x.push_str(&format!(r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#, esc(line)));
            }
            x.push_str(&format!("</w:{tag}>"));
        }
        x.push_str(&format!("</w:{root}>"));
        x
    };
    if has_notes {
        pkg.add("word/footnotes.xml", Some(&format!("{ct}.footnotes+xml")), notes_xml("footnotes", "footnote", "Footnote", "footnoteRef", &footnotes));
        rels.push(("rId9".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes".into(), "footnotes.xml".into(), false));
    }
    if has_endnotes {
        pkg.add("word/endnotes.xml", Some(&format!("{ct}.endnotes+xml")), notes_xml("endnotes", "endnote", "Endnote", "endnoteRef", &endnotes));
        rels.push(("rIdEndnotes".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes".into(), "endnotes.xml".into(), false));
    }
    if !matches!(doc.blocks.last(), Some(Block::Paragraph(_))) {
        body.push_str("<w:p/>");
    }
    pkg.add(
        "word/document.xml",
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{body}{sect}</w:body></w:document>"#),
    );
    pkg.add("word/_rels/document.xml.rels", None, package::rels_xml(&rels));
    pkg.add("word/styles.xml", Some("application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"), styles_xml(doc));
    pkg.add("word/numbering.xml", Some("application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"), numbering_xml(ordered));
    pkg.add(
        "word/settings.xml",
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/>{}{}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>"#,
            if has_notes { r#"<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>"# } else { "" },
            if has_endnotes { r#"<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>"# } else { "" }
        ),
    );
    pkg.add("docProps/core.xml", Some("application/vnd.openxmlformats-package.core-properties+xml"), package::core_xml(&doc.title, &doc.author));
    pkg.add(
        "_rels/.rels",
        None,
        package::rels_xml(&[
            ("rId1".into(), package::REL_OFFICE_DOCUMENT.into(), "word/document.xml".into(), false),
            ("rId2".into(), package::REL_CORE.into(), "docProps/core.xml".into(), false),
        ]),
    );
    pkg.finish()
}

fn styles_xml(doc: &Document) -> String {
    let font = esc(doc.default_font.as_deref().unwrap_or("Calibri"));
    let size = (doc.default_size.unwrap_or(11.0) * 2.0).round() as i64;
    let heading = |id: u8, size: u32, color: &str, before: u32| {
        format!(
            r#"<w:style w:type="paragraph" w:styleId="Heading{id}"><w:name w:val="heading {id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="{before}" w:after="80"/><w:outlineLvl w:val="{}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="{color}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>"#,
            id - 1
        )
    };
    let mut s = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}" w:cs="{font}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>"#
    );
    for (id, sz, before) in [(1u8, 40u32, 360u32), (2, 32, 160), (3, 28, 160), (4, 24, 80), (5, 22, 80), (6, 22, 80)] {
        s.push_str(&heading(id, sz, "1F3864", before));
    }
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="595959"/><w:spacing w:val="15"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>"#);
    s.push_str(r#"<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="160"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>"#);
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
    s.push_str("</w:styles>");
    s
}

fn numbering_xml(ordered_lists: usize) -> String {
    let mut s = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#);
    s.push_str(r#"<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>"#);
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
