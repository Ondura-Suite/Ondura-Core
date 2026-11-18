//! OpenDocument Text (.odt) ⇄ [`Document`] for Ondura Text.
//!
//! The same model as [`crate::docx`] is used, so a document can be opened
//! in one format and saved in the other.

use std::collections::{BTreeSet, HashMap};

use crate::Result;
use crate::docx::{
    Block, Cell, Comment, Document, IndexEntry, Inline, ListRef, Loaded, Marks, PageSetup,
    Paragraph, Revision, Row, Table, TocEntry,
};
use crate::odf::{self, AutoStyles, Extra, OdfDoc, Styles, cm, mm, pt, px, text_xml};
use crate::xml::{Element, Node, esc};

// --------------------------------------------------------------- reading --

struct Reader<'a> {
    doc: &'a OdfDoc,
    st: Styles,
    warnings: BTreeSet<String>,
    comments: Vec<Comment>,
    /// Ranged comments still open: (office:name, id).
    open_comments: Vec<(String, u32)>,
    /// Comment without range, applied to the next text.
    point_comment: Option<u32>,
    /// Tracked changes by id: (insertion?, revision, deleted text).
    changes: HashMap<String, (bool, Revision, String)>,
    insertion: Option<Revision>,
    /// Master page of the current section, and whether a block was read.
    master: Option<String>,
    started: bool,
    /// Sources found in bibliography marks.
    sources: Vec<crate::docx::Source>,
}

/// Parse an .odt file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let doc = OdfDoc::open(bytes, odf::MIME_TEXT, "Textdokument")?;
    let st = doc.styles();
    let mut r = Reader {
        doc: &doc,
        st,
        warnings: BTreeSet::new(),
        comments: Vec::new(),
        sources: Vec::new(),
        open_comments: Vec::new(),
        point_comment: None,
        changes: HashMap::new(),
        insertion: None,
        master: None,
        started: false,
    };
    let body = doc
        .content
        .child("office:body")
        .and_then(|b| b.child("office:text"));
    let mut d = Document {
        blocks: Vec::new(),
        ..Default::default()
    };
    (d.title, d.author) = doc.meta();
    if let Some(body) = body {
        if let Some(tc) = body.child("text:tracked-changes") {
            r.read_changes(tc);
        }
        r.blocks(body, &mut d.blocks, None, true);
    }
    if d.blocks.is_empty() {
        d.blocks.push(Block::Paragraph(Paragraph::default()));
    }
    // Page setup of the last section; header and footer of the first master page.
    let last_master = r.master.clone();
    d.page = r.page(last_master.as_deref());
    let mp = r.master_page(None);
    if let Some(mp) = mp {
        // Header/footer paragraphs use the automatic styles of styles.xml.
        let hs = std::mem::replace(&mut r.st, doc.master_styles());
        let hf = |r: &mut Reader, name: &str| {
            let mut out = Vec::new();
            if let Some(h) = mp
                .child(name)
                .filter(|h| h.attr("style:display") != Some("false"))
            {
                r.blocks(h, &mut out, None, false);
            }
            out
        };
        d.header = hf(&mut r, "style:header");
        d.footer = hf(&mut r, "style:footer");
        d.header_first = hf(&mut r, "style:header-first");
        d.footer_first = hf(&mut r, "style:footer-first");
        d.different_first =
            mp.child("style:header-first").is_some() || mp.child("style:footer-first").is_some();
        r.st = hs;
    }
    let std = Some("Standard");
    d.default_font = r.st.font("paragraph", std);
    d.default_size =
        r.st.get("paragraph", std, "fo:font-size")
            .and_then(pt)
            .map(|v| (v * 2.0).round() / 2.0);
    d.comments = std::mem::take(&mut r.comments);
    d.sources = std::mem::take(&mut r.sources);
    Ok(Loaded {
        document: d,
        warnings: r.warnings.into_iter().collect(),
    })
}

impl<'a> Reader<'a> {
    fn master_page(&self, name: Option<&str>) -> Option<&'a Element> {
        let doc: &'a OdfDoc = self.doc;
        let ms = doc.styles.as_ref()?.child("office:master-styles")?;
        let want = name.unwrap_or("Standard");
        ms.children_named("style:master-page")
            .find(|m| m.attr("style:name") == Some(want))
            .or_else(|| ms.children_named("style:master-page").next())
    }

    fn page(&self, master: Option<&str>) -> PageSetup {
        let mut p = PageSetup::default();
        let Some(layout) = self
            .master_page(master)
            .and_then(|m| m.attr("style:page-layout-name"))
            .and_then(|l| self.st.page_layouts.get(l))
        else {
            return p;
        };
        let g = |k: &str| layout.get(k).and_then(|v| mm(v));
        p.width_mm = g("fo:page-width").unwrap_or(p.width_mm);
        p.height_mm = g("fo:page-height").unwrap_or(p.height_mm);
        p.margin_top_mm = g("fo:margin-top").unwrap_or(p.margin_top_mm);
        p.margin_bottom_mm = g("fo:margin-bottom").unwrap_or(p.margin_bottom_mm);
        p.margin_left_mm = g("fo:margin-left").unwrap_or(p.margin_left_mm);
        p.margin_right_mm = g("fo:margin-right").unwrap_or(p.margin_right_mm);
        // A header sits inside the top margin: body = margin + height + spacing.
        if let Some(h) = g("header:fo:min-height").or_else(|| g("header:svg:height")) {
            p.header_mm = p.margin_top_mm;
            p.margin_top_mm += h + g("header:fo:margin-bottom").unwrap_or(0.0);
        }
        if let Some(h) = g("footer:fo:min-height").or_else(|| g("footer:svg:height")) {
            p.footer_mm = p.margin_bottom_mm;
            p.margin_bottom_mm += h + g("footer:fo:margin-top").unwrap_or(0.0);
        }
        p
    }

    fn read_changes(&mut self, tc: &Element) {
        for region in tc.children_named("text:changed-region") {
            let Some(id) = region.attr("text:id").or_else(|| region.attr("xml:id")) else {
                continue;
            };
            for (kind, ins) in [("text:insertion", true), ("text:deletion", false)] {
                if let Some(c) = region.child(kind) {
                    let info = c.child("office:change-info");
                    let rev = Revision {
                        author: info
                            .and_then(|i| i.child("dc:creator"))
                            .map(|e| e.text())
                            .unwrap_or_default(),
                        date: info
                            .and_then(|i| i.child("dc:date"))
                            .map(|e| e.text())
                            .unwrap_or_default(),
                    };
                    let text = c
                        .children_named("text:p")
                        .map(odf::plain_text)
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.changes.insert(id.to_string(), (ins, rev, text));
                }
            }
            if region.child("text:format-change").is_some() {
                self.warnings
                    .insert("Nachverfolgte Formatänderungen werden nicht übernommen.".into());
            }
        }
    }

    /// Section and page breaks requested by a block's style.
    fn breaks(&mut self, family: &str, style: Option<&str>, out: &mut Vec<Block>, top: bool) {
        if !top {
            return;
        }
        let master = style
            .and_then(|s| self.st.style(family, s))
            .and_then(|s| s.master_page.clone());
        let page_break = matches!(self.st.get(family, style, "fo:break-before"), Some("page"));
        if let Some(m) = master {
            if self.started {
                if self.master.as_deref() != Some(m.as_str()) {
                    out.push(Block::SectionBreak {
                        page: self.page(self.master.as_deref()),
                    });
                } else {
                    out.push(Block::PageBreak);
                }
            }
            self.master = Some(m);
        } else if page_break && self.started && !matches!(out.last(), Some(Block::PageBreak)) {
            out.push(Block::PageBreak);
        }
        self.started = true;
    }

    fn blocks(
        &mut self,
        parent: &Element,
        out: &mut Vec<Block>,
        list: Option<(Option<String>, u8)>,
        top: bool,
    ) {
        for e in parent.elements() {
            match e.name.as_str() {
                "text:p" | "text:h" => {
                    self.breaks("paragraph", e.attr("text:style-name"), out, top);
                    let p = self.paragraph(e, list.as_ref());
                    out.push(Block::Paragraph(p));
                }
                "text:list" => {
                    let style = e
                        .attr("text:style-name")
                        .map(String::from)
                        .or_else(|| list.as_ref().and_then(|l| l.0.clone()));
                    let level = list.as_ref().map(|l| (l.1 + 1).min(8)).unwrap_or(0);
                    for item in e
                        .elements()
                        .filter(|i| i.name == "text:list-item" || i.name == "text:list-header")
                    {
                        self.blocks(item, out, Some((style.clone(), level)), top);
                    }
                }
                "table:table" => {
                    self.breaks("table", e.attr("table:style-name"), out, top);
                    out.push(Block::Table(self.table(e)));
                }
                "text:section" | "text:index-body" => self.blocks(e, out, list.clone(), top),
                "text:table-of-content" => {
                    self.started = true;
                    out.push(self.toc(e));
                }
                "text:alphabetical-index" => {
                    self.started = true;
                    let entries = index_lines(e)
                        .into_iter()
                        .filter(|(t, _)| {
                            t.chars().count() > 1 || !t.chars().all(char::is_uppercase)
                        })
                        .map(|(term, pages)| IndexEntry { term, pages })
                        .collect();
                    out.push(Block::Index { entries });
                }
                "text:bibliography" => {
                    self.started = true;
                    let title = e
                        .child("text:index-body")
                        .and_then(|b| b.child("text:index-title"))
                        .map(|t| odf::plain_text(t).trim().to_string())
                        .filter(|t| !t.is_empty());
                    let entries = index_lines(e)
                        .into_iter()
                        .map(|(t, p)| if p.is_empty() { t } else { format!("{t} {p}") })
                        .collect();
                    out.push(Block::Bibliography { title, entries });
                }
                "text:illustration-index" | "text:table-index" => {
                    self.started = true;
                    let caption = e
                        .child(if e.name == "text:table-index" {
                            "text:table-index-source"
                        } else {
                            "text:illustration-index-source"
                        })
                        .and_then(|s| s.attr("text:caption-sequence-name"))
                        .unwrap_or(if e.name == "text:table-index" {
                            "Tabelle"
                        } else {
                            "Abbildung"
                        })
                        .to_string();
                    let title = e
                        .child("text:index-body")
                        .and_then(|b| b.child("text:index-title"))
                        .map(|t| odf::plain_text(t).trim().to_string())
                        .filter(|t| !t.is_empty());
                    let entries = index_lines(e)
                        .into_iter()
                        .map(|(text, p)| TocEntry {
                            level: 1,
                            text,
                            page: p.parse().unwrap_or(0),
                        })
                        .collect();
                    out.push(Block::Toc {
                        title,
                        entries,
                        caption: Some(caption),
                    });
                }
                "text:user-index" | "text:object-index" => {
                    self.warnings.insert(
                        "Verzeichnisse außer dem Inhaltsverzeichnis werden als Text übernommen."
                            .into(),
                    );
                    if let Some(b) = e.child("text:index-body") {
                        self.blocks(b, out, None, top);
                    }
                }
                _ => {}
            }
        }
    }

    fn toc(&mut self, e: &Element) -> Block {
        let body = e.child("text:index-body");
        let title = body
            .and_then(|b| b.child("text:index-title"))
            .map(|t| odf::plain_text(t).trim().to_string())
            .filter(|t| !t.is_empty());
        let mut entries = Vec::new();
        for p in body
            .map(|b| b.children_named("text:p").collect::<Vec<_>>())
            .unwrap_or_default()
        {
            let chain = self.st.chain("paragraph", p.attr("text:style-name"));
            let level = chain
                .iter()
                .find_map(|n| {
                    n.strip_prefix("Contents ")
                        .and_then(|l| l.trim().parse::<u8>().ok())
                })
                .unwrap_or(1);
            let text = odf::plain_text(p);
            let (text, page) = match text.rsplit_once('\t') {
                Some((t, pg)) => (t.trim().to_string(), pg.trim().parse().unwrap_or(0)),
                None => (text.trim().to_string(), 0),
            };
            if !text.is_empty() {
                entries.push(TocEntry { level, text, page });
            }
        }
        Block::Toc {
            title,
            entries,
            caption: None,
        }
    }

    /// Text properties of a style as marks.
    fn marks(&self, family: &str, style: Option<&str>, base: &Marks, follow: bool) -> Marks {
        let mut m = base.clone();
        // Paragraph styles only contribute their own (automatic) formatting;
        // named paragraph styles map to the document's own styles.
        let get = |attr: &str| -> Option<&str> {
            if follow {
                self.st.get(family, style, attr)
            } else {
                style
                    .and_then(|s| self.st.style(family, s))
                    .filter(|s| s.automatic)
                    .and_then(|s| s.props.get(attr))
                    .map(String::as_str)
            }
        };
        if let Some(w) = get("fo:font-weight") {
            m.bold = w == "bold" || w.parse::<u32>().is_ok_and(|v| v >= 600);
        }
        if let Some(s) = get("fo:font-style") {
            m.italic = s == "italic" || s == "oblique";
        }
        if let Some(u) = get("style:text-underline-style") {
            m.underline = u != "none";
        }
        if let Some(u) = get("style:text-line-through-style") {
            m.strike = u != "none";
        }
        if let Some(p) = get("style:text-position") {
            let first = p.split_whitespace().next().unwrap_or("0");
            m.superscript = first == "super"
                || first
                    .trim_end_matches('%')
                    .parse::<f64>()
                    .is_ok_and(|v| v > 0.0);
            m.subscript = first == "sub"
                || first
                    .trim_end_matches('%')
                    .parse::<f64>()
                    .is_ok_and(|v| v < 0.0);
        }
        if let Some(s) = get("fo:font-size").and_then(pt) {
            m.size = Some((s * 2.0).round() / 2.0);
        }
        if let Some(c) = get("fo:color").and_then(odf::color) {
            m.color = Some(c);
        }
        if let Some(c) = get("fo:background-color").and_then(odf::color) {
            m.highlight = Some(c);
        }
        if let Some(f) = get("style:font-name") {
            m.font = Some(
                self.st
                    .fonts
                    .get(f)
                    .cloned()
                    .unwrap_or_else(|| f.to_string()),
            );
        } else if let Some(f) = get("fo:font-family") {
            m.font = Some(f.trim_matches('\'').to_string());
        }
        m
    }

    fn paragraph(&mut self, e: &Element, list: Option<&(Option<String>, u8)>) -> Paragraph {
        let sn = e.attr("text:style-name");
        let chain = self.st.chain("paragraph", sn);
        let has = |n: &str| chain.iter().any(|c| c.eq_ignore_ascii_case(n));
        let style = if has("Caption") || has("Figure") || has("Illustration") || has("Drawing") {
            Some("caption".to_string())
        } else if has("Title") {
            Some("title".to_string())
        } else if has("Subtitle") {
            Some("subtitle".to_string())
        } else if e.name == "text:h" || chain.iter().any(|c| c.starts_with("Heading ")) {
            let lvl = e
                .attr("text:outline-level")
                .and_then(|v| v.parse::<u8>().ok())
                .or_else(|| {
                    chain
                        .iter()
                        .find_map(|c| c.strip_prefix("Heading ").and_then(|l| l.parse().ok()))
                })
                .unwrap_or(1);
            Some(format!("heading{}", lvl.clamp(1, 6)))
        } else if has("Quotations") || has("Quote") {
            Some("quote".to_string())
        } else if has("Preformatted Text") || has("Source Text") {
            Some("code".to_string())
        } else {
            None
        };
        let own = sn
            .and_then(|s| self.st.style("paragraph", s))
            .filter(|s| s.automatic)
            .map(|s| s.props.clone())
            .unwrap_or_default();
        let align = match self.st.get("paragraph", sn, "fo:text-align") {
            Some("center") => Some("center".to_string()),
            Some("end" | "right") => Some("right".to_string()),
            Some("justify") => Some("justify".to_string()),
            _ => None,
        };
        let list_ref = list.map(|(name, level)| {
            let name = name
                .clone()
                .or_else(|| self.st.list_style("paragraph", sn).map(String::from));
            let ordered = name
                .and_then(|n| {
                    self.st
                        .lists
                        .get(&n)
                        .map(|l| l.get(*level as usize).copied().unwrap_or(false))
                })
                .unwrap_or(false);
            ListRef {
                ordered,
                level: *level,
            }
        });
        let mut p = Paragraph {
            style,
            align,
            list: list_ref,
            indent_mm: if list.is_some() {
                0.0
            } else {
                own.get("fo:margin-left").and_then(|v| mm(v)).unwrap_or(0.0)
            },
            first_line_mm: if list.is_some() {
                0.0
            } else {
                own.get("fo:text-indent").and_then(|v| mm(v)).unwrap_or(0.0)
            },
            space_before_pt: own
                .get("fo:margin-top")
                .and_then(|v| pt(v))
                .map(|v| v.round()),
            space_after_pt: own
                .get("fo:margin-bottom")
                .and_then(|v| pt(v))
                .map(|v| v.round()),
            line_height: own
                .get("fo:line-height")
                .and_then(|v| v.strip_suffix('%'))
                .and_then(|v| v.parse::<f64>().ok())
                .map(|v| (v / 100.0 * 100.0).round() / 100.0),
            content: Vec::new(),
        };
        let base = self.marks("paragraph", sn, &Marks::default(), false);
        let mut content = Vec::new();
        self.inline(e, &base, &mut content);
        p.content = content;
        p
    }

    fn push_text(&mut self, out: &mut Vec<Inline>, text: String, marks: &Marks) {
        if text.is_empty() {
            return;
        }
        let mut m = marks.clone();
        if let Some(id) = self.point_comment.take() {
            m.comment = Some(id);
        } else if let Some((_, id)) = self.open_comments.last() {
            m.comment = Some(*id);
        }
        if m.ins.is_none() {
            m.ins = self.insertion.clone();
        }
        if let Some(Inline::Text { text: t, marks: pm }) = out.last_mut()
            && *pm == m
        {
            t.push_str(&text);
            return;
        }
        out.push(Inline::Text { text, marks: m });
    }

    fn inline(&mut self, e: &Element, marks: &Marks, out: &mut Vec<Inline>) {
        for c in &e.children {
            let x = match c {
                Node::Text(t) => {
                    let t: String = t
                        .chars()
                        .map(|c| {
                            if matches!(c, '\n' | '\r' | '\t') {
                                ' '
                            } else {
                                c
                            }
                        })
                        .collect();
                    self.push_text(out, t, marks);
                    continue;
                }
                Node::Element(x) => x,
            };
            match x.name.as_str() {
                "text:span" => {
                    let m = self.marks("text", x.attr("text:style-name"), marks, true);
                    self.inline(x, &m, out);
                }
                "text:a" => {
                    // The link character style (blue, underlined) is the editor's look anyway.
                    let mut m = marks.clone();
                    m.link = x.attr("xlink:href").map(String::from);
                    self.inline(x, &m, out);
                }
                "text:s" => {
                    let n = x
                        .attr("text:c")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(1usize);
                    self.push_text(out, " ".repeat(n.min(1000)), marks);
                }
                "text:tab" => out.push(Inline::Tab),
                "text:line-break" => out.push(Inline::Break),
                "text:bookmark-start" | "text:bookmark-end" | "text:bookmark" => {
                    if let Some(name) = x
                        .attr("text:name")
                        .filter(|n| !n.starts_with("_Toc") && !n.starts_with("__RefHeading"))
                    {
                        let end = x.name == "text:bookmark-end";
                        out.push(Inline::Bookmark {
                            name: name.to_string(),
                            end,
                        });
                        if x.name == "text:bookmark" {
                            out.push(Inline::Bookmark {
                                name: name.to_string(),
                                end: true,
                            });
                        }
                    }
                }
                "text:sequence" => out.push(Inline::Field {
                    field: format!("seq {}", x.attr("text:name").unwrap_or("Abbildung")),
                    result: x.text(),
                }),
                "text:bookmark-ref" | "text:sequence-ref" | "text:reference-ref" => {
                    out.push(Inline::Field {
                        field: format!("ref {}", x.attr("text:ref-name").unwrap_or_default()),
                        result: x.text(),
                    })
                }
                "text:date" => out.push(Inline::Field {
                    field: "date".into(),
                    result: x.text(),
                }),
                "text:author-name" | "text:initial-creator" | "text:creator" => {
                    out.push(Inline::Field {
                        field: "author".into(),
                        result: x.text(),
                    })
                }
                "text:title" => out.push(Inline::Field {
                    field: "title".into(),
                    result: x.text(),
                }),
                "text:file-name" => out.push(Inline::Field {
                    field: "filename".into(),
                    result: x.text(),
                }),
                "text:database-display" => out.push(Inline::Field {
                    field: format!("merge {}", x.attr("text:column-name").unwrap_or_default()),
                    result: x.text(),
                }),
                "text:alphabetical-index-mark" => {
                    if let Some(term) = x.attr("text:string-value") {
                        out.push(Inline::Field {
                            field: format!("xe {term}"),
                            result: String::new(),
                        });
                    }
                }
                "text:bibliography-mark" => {
                    let tag = x.attr("text:identifier").unwrap_or_default().to_string();
                    if !tag.is_empty() && !self.sources.iter().any(|s| s.tag == tag) {
                        let a = |n: &str| x.attr(n).unwrap_or_default().to_string();
                        let kind = match x.attr("text:bibliography-type") {
                            Some("article") => "article",
                            Some("www") => "web",
                            Some("techreport") | Some("report") => "report",
                            _ => "book",
                        };
                        self.sources.push(crate::docx::Source {
                            tag: tag.clone(),
                            kind: kind.into(),
                            author: a("text:author").replace(" and ", "; "),
                            title: a("text:title"),
                            year: a("text:year"),
                            publisher: a("text:publisher"),
                            city: a("text:address"),
                            journal: a("text:journal"),
                            pages: a("text:pages"),
                            url: a("text:url"),
                        });
                    }
                    out.push(Inline::Field {
                        field: format!("cite {tag}"),
                        result: x.text(),
                    });
                }
                "text:soft-page-break"
                | "text:reference-mark"
                | "text:reference-mark-start"
                | "text:reference-mark-end"
                | "text:toc-mark" => {}
                "text:note" => {
                    let text = x.child("text:note-body").map(note_text).unwrap_or_default();
                    out.push(Inline::Footnote {
                        text,
                        endnote: x.attr("text:note-class") == Some("endnote"),
                    });
                }
                "text:page-number" => out.push(Inline::Field {
                    field: "page".into(),
                    result: String::new(),
                }),
                "text:page-count" => out.push(Inline::Field {
                    field: "pages".into(),
                    result: String::new(),
                }),
                "draw:frame" => self.frame(x, marks, out),
                "draw:a" => self.inline(x, marks, out),
                "office:annotation" => {
                    let id = self.comments.len() as u32 + 1;
                    self.comments.push(Comment {
                        id,
                        author: x.child("dc:creator").map(|e| e.text()).unwrap_or_default(),
                        date: x.child("dc:date").map(|e| e.text()).unwrap_or_default(),
                        text: x
                            .children_named("text:p")
                            .map(odf::plain_text)
                            .collect::<Vec<_>>()
                            .join("\n"),
                    });
                    match x.attr("office:name") {
                        Some(n) => self.open_comments.push((n.to_string(), id)),
                        None => self.point_comment = Some(id),
                    }
                }
                "office:annotation-end" => {
                    let n = x.attr("office:name").unwrap_or_default();
                    self.open_comments.retain(|(name, _)| name != n);
                }
                "text:change-start" => {
                    if let Some((true, rev, _)) =
                        x.attr("text:change-id").and_then(|id| self.changes.get(id))
                    {
                        self.insertion = Some(rev.clone());
                    }
                }
                "text:change-end" => self.insertion = None,
                "text:change" => {
                    if let Some((false, rev, text)) = x
                        .attr("text:change-id")
                        .and_then(|id| self.changes.get(id))
                        .cloned()
                    {
                        let mut m = marks.clone();
                        m.del = Some(rev);
                        self.push_text(out, text, &m);
                    }
                }
                "text:sequence-decls" | "text:variable-decls" | "text:user-field-decls" => {}
                // Fields with a text result and unknown wrappers keep their text.
                _ => self.inline(x, marks, out),
            }
        }
    }

    fn frame(&mut self, x: &Element, marks: &Marks, out: &mut Vec<Inline>) {
        let w = x.attr("svg:width").and_then(px).unwrap_or(100.0);
        let h = x.attr("svg:height").and_then(px).unwrap_or(100.0);
        if let Some(img) = x.child("draw:image") {
            match img.attr("xlink:href").and_then(|h| self.doc.data_url(h)) {
                Some(src) if !src.starts_with("data:application/octet-stream") => {
                    let alt = x
                        .child("svg:title")
                        .or_else(|| x.child("svg:desc"))
                        .map(|e| e.text())
                        .unwrap_or_default();
                    out.push(Inline::Image {
                        src,
                        width: (w * 10.0).round() / 10.0,
                        height: (h * 10.0).round() / 10.0,
                        alt,
                    });
                }
                _ => {
                    self.warnings.insert("Einige Bilder (verknüpft oder in unbekanntem Format) werden nicht angezeigt.".into());
                }
            }
        } else if let Some(tb) = x.child("draw:text-box") {
            self.warnings
                .insert("Textrahmen werden als normaler Text übernommen.".into());
            for p in tb
                .elements()
                .filter(|p| p.name == "text:p" || p.name == "text:h")
            {
                self.inline(p, marks, out);
                out.push(Inline::Break);
            }
        } else {
            self.warnings
                .insert("Zeichnungen und eingebettete Objekte werden nicht angezeigt.".into());
        }
    }

    fn table(&mut self, t: &Element) -> Table {
        let mut table = Table::default();
        let mut cols = Vec::new();
        t.find_all("table:table-column", &mut cols);
        for c in cols {
            let n = c
                .attr("table:number-columns-repeated")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(1)
                .min(64);
            let w = self
                .st
                .get(
                    "table-column",
                    c.attr("table:style-name"),
                    "style:column-width",
                )
                .and_then(mm)
                .unwrap_or(30.0);
            table
                .columns_mm
                .extend(std::iter::repeat_n((w * 10.0).round() / 10.0, n));
        }
        let mut rows: Vec<(&Element, bool)> = Vec::new();
        fn collect<'e>(e: &'e Element, header: bool, out: &mut Vec<(&'e Element, bool)>) {
            for c in e.elements() {
                match c.name.as_str() {
                    "table:table-row" => out.push((c, header)),
                    "table:table-header-rows" => collect(c, true, out),
                    "table:table-rows" | "table:table-row-group" => collect(c, header, out),
                    _ => {}
                }
            }
        }
        collect(t, false, &mut rows);
        for (r, header) in rows {
            let mut row = Row {
                header,
                cells: Vec::new(),
            };
            for c in r.children_named("table:table-cell") {
                let repeat = c
                    .attr("table:number-columns-repeated")
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(1)
                    .min(64);
                let mut blocks = Vec::new();
                self.blocks(c, &mut blocks, None, false);
                if blocks.is_empty() {
                    blocks.push(Block::Paragraph(Paragraph::default()));
                }
                let background = self
                    .st
                    .get(
                        "table-cell",
                        c.attr("table:style-name"),
                        "fo:background-color",
                    )
                    .and_then(odf::color);
                let span = |a: &str| {
                    c.attr(a)
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(1)
                        .max(1)
                };
                for _ in 0..repeat {
                    row.cells.push(Cell {
                        col_span: span("table:number-columns-spanned"),
                        row_span: span("table:number-rows-spanned"),
                        background: background.clone(),
                        blocks: blocks.clone(),
                    });
                }
            }
            table.rows.push(row);
        }
        table
    }
}

/// Text of a footnote body (paragraphs separated by `\n`).
fn note_text(body: &Element) -> String {
    body.elements()
        .filter(|p| p.name == "text:p" || p.name == "text:h")
        .map(odf::plain_text)
        .collect::<Vec<_>>()
        .join("\n")
}

// --------------------------------------------------------------- writing --

struct Writer {
    content: AutoStyles,
    master: AutoStyles,
    /// Whether output currently goes to styles.xml (header/footer).
    in_master: bool,
    fonts: BTreeSet<String>,
    extras: Vec<Extra>,
    images: HashMap<String, String>,
    tables: u32,
    frames: u32,
    notes: u32,
    changes: String,
    change_id: u32,
    comments: HashMap<u32, Comment>,
    open_comment: Option<u32>,
    /// Applied to the next paragraph or table.
    pending_master: Option<String>,
    pending_break: bool,
    /// Page width without margins (mm), for tables without column widths.
    text_width: f64,
    sources: Vec<crate::docx::Source>,
}

/// Serialise a document as .odt.
pub fn write(doc: &Document) -> Result<Vec<u8>> {
    let mut w = Writer {
        content: AutoStyles::new("A"),
        master: AutoStyles::new("M"),
        in_master: false,
        fonts: BTreeSet::new(),
        extras: Vec::new(),
        images: HashMap::new(),
        tables: 0,
        frames: 0,
        notes: 0,
        changes: String::new(),
        change_id: 0,
        comments: doc.comments.iter().map(|c| (c.id, c.clone())).collect(),
        open_comment: None,
        pending_master: None,
        pending_break: false,
        text_width: doc.page.width_mm - doc.page.margin_left_mm - doc.page.margin_right_mm,
        sources: doc.sources.clone(),
    };
    let default_font = doc.default_font.clone().unwrap_or_else(|| "Calibri".into());
    w.fonts.insert(default_font.clone());

    // Sections: the page of each section break describes the section before it.
    let mut pages: Vec<&PageSetup> = doc
        .blocks
        .iter()
        .filter_map(|b| {
            if let Block::SectionBreak { page } = b {
                Some(page)
            } else {
                None
            }
        })
        .collect();
    pages.push(&doc.page);

    // Header and footer (styles.xml).
    w.in_master = true;
    let header = w.blocks(&doc.header);
    let footer = w.blocks(&doc.footer);
    let (header_first, footer_first) = if doc.different_first {
        (w.blocks(&doc.header_first), w.blocks(&doc.footer_first))
    } else {
        (String::new(), String::new())
    };
    w.in_master = false;

    let mut masters = String::new();
    let mut layouts = String::new();
    let mut master_names = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let lname = format!("pm{}", i + 1);
        let has_h = !doc.header.is_empty() || (doc.different_first && !doc.header_first.is_empty());
        let has_f = !doc.footer.is_empty() || (doc.different_first && !doc.footer_first.is_empty());
        let (mt, hs) = if has_h {
            (
                page.header_mm,
                format!(
                    r#"<style:header-style><style:header-footer-properties fo:min-height="{}" fo:margin-bottom="0cm" style:dynamic-spacing="false"/></style:header-style>"#,
                    cm((page.margin_top_mm - page.header_mm).max(1.0))
                ),
            )
        } else {
            (page.margin_top_mm, "<style:header-style/>".into())
        };
        let (mb, fs) = if has_f {
            (
                page.footer_mm,
                format!(
                    r#"<style:footer-style><style:header-footer-properties fo:min-height="{}" fo:margin-top="0cm" style:dynamic-spacing="false"/></style:footer-style>"#,
                    cm((page.margin_bottom_mm - page.footer_mm).max(1.0))
                ),
            )
        } else {
            (page.margin_bottom_mm, "<style:footer-style/>".into())
        };
        let orient = if page.width_mm > page.height_mm {
            "landscape"
        } else {
            "portrait"
        };
        layouts.push_str(&format!(
            r#"<style:page-layout style:name="{lname}"><style:page-layout-properties fo:page-width="{}" fo:page-height="{}" style:print-orientation="{orient}" fo:margin-top="{}" fo:margin-bottom="{}" fo:margin-left="{}" fo:margin-right="{}" style:writing-mode="lr-tb"/>{hs}{fs}</style:page-layout>"#,
            cm(page.width_mm),
            cm(page.height_mm),
            cm(mt),
            cm(mb),
            cm(page.margin_left_mm),
            cm(page.margin_right_mm)
        ));
        let name = if i == 0 {
            "Standard".to_string()
        } else {
            format!("Section{i}")
        };
        let mut body = String::new();
        if !doc.header.is_empty() {
            body.push_str(&format!("<style:header>{header}</style:header>"));
        }
        if doc.different_first && !doc.header_first.is_empty() {
            body.push_str(&format!(
                "<style:header-first>{header_first}</style:header-first>"
            ));
        }
        if !doc.footer.is_empty() {
            body.push_str(&format!("<style:footer>{footer}</style:footer>"));
        }
        if doc.different_first && !doc.footer_first.is_empty() {
            body.push_str(&format!(
                "<style:footer-first>{footer_first}</style:footer-first>"
            ));
        }
        masters.push_str(&format!(r#"<style:master-page style:name="{name}" style:page-layout-name="{lname}">{body}</style:master-page>"#));
        master_names.push(name);
    }

    // Body.
    let mut body = String::new();
    let mut section = 0;
    let mut i = 0;
    while i < doc.blocks.len() {
        if let Block::SectionBreak { .. } = &doc.blocks[i] {
            section += 1;
            w.pending_master = master_names.get(section).cloned();
            w.pending_break = false;
            i += 1;
            continue;
        }
        let n = w.block_run(&doc.blocks[i..], &mut body);
        i += n;
    }
    if w.pending_master.is_some() || w.pending_break {
        body.push_str(&w.paragraph(&Paragraph::default(), "text:p"));
    }
    if let Some(id) = w.open_comment.take() {
        body.push_str(&format!(r#"<office:annotation-end office:name="c{id}"/>"#));
    }

    let size = doc.default_size.unwrap_or(11.0);
    let fonts = odf::font_decls(
        w.fonts
            .iter()
            .map(String::as_str)
            .chain(["Liberation Mono"]),
    );
    let styles = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ns}>{fonts}<office:styles>{named}</office:styles><office:automatic-styles>{layouts}{auto}</office:automatic-styles><office:master-styles>{masters}</office:master-styles></office:document-styles>"#,
        ns = odf::NS,
        named = named_styles(&default_font, size),
        auto = w.master.xml,
    );
    let mut tracked = if w.changes.is_empty() {
        String::new()
    } else {
        format!("<text:tracked-changes>{}</text:tracked-changes>", w.changes)
    };
    let mut seqs = std::collections::BTreeSet::new();
    sequence_names(&doc.blocks, &mut seqs);
    if !seqs.is_empty() {
        tracked.push_str("<text:sequence-decls>");
        for n in &seqs {
            tracked.push_str(&format!(
                r#"<text:sequence-decl text:display-outline-level="0" text:name="{}"/>"#,
                esc(n)
            ));
        }
        tracked.push_str("</text:sequence-decls>");
    }
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}>{fonts}<office:automatic-styles>{auto}</office:automatic-styles><office:body><office:text>{tracked}{body}</office:text></office:body></office:document-content>"#,
        ns = odf::NS,
        auto = w.content.xml,
    );
    odf::package(
        odf::MIME_TEXT,
        content,
        styles,
        odf::meta_xml(&doc.title, &doc.author),
        w.extras,
    )
}

/// Named styles of the document (styles.xml `office:styles`).
fn named_styles(font: &str, size: f64) -> String {
    let font = esc(font);
    let mut s = format!(
        r#"<style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:writing-mode="page"/><style:text-properties style:font-name="{font}" fo:font-size="{size}pt" fo:language="de" fo:country="DE"/></style:default-style><style:default-style style:family="table"><style:table-properties table:border-model="collapsing"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.212cm" fo:line-height="108%"/></style:style><style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.106cm" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style>"#
    );
    for (lvl, sz, color) in [
        (1, 16.0, "#2f5496"),
        (2, 13.0, "#2f5496"),
        (3, 12.0, "#1f3763"),
        (4, 11.0, "#2f5496"),
        (5, 11.0, "#2f5496"),
        (6, 11.0, "#1f3763"),
    ] {
        s.push_str(&format!(
            r#"<style:style style:name="Heading_20_{lvl}" style:display-name="Heading {lvl}" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:default-outline-level="{lvl}" style:class="text"><style:text-properties fo:font-size="{sz}pt" fo:color="{color}"/></style:style>"#
        ));
    }
    s.push_str(concat!(
        r##"<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:margin-bottom="0.141cm"/><style:text-properties fo:font-size="28pt"/></style:style>"##,
        r##"<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:text-properties fo:font-size="15pt" fo:color="#595959"/></style:style>"##,
        r##"<style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="0.106cm" fo:margin-bottom="0.212cm"/><style:text-properties fo:font-size="9pt" fo:font-style="italic" fo:color="#44546a"/></style:style>"##,
        r##"<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm"/><style:text-properties fo:font-style="italic" fo:color="#404040"/></style:style>"##,
        r##"<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="100%"/><style:text-properties style:font-name="Liberation Mono" fo:font-size="10pt"/></style:style>"##,
        r##"<style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"/><style:text-properties fo:font-size="10pt"/></style:style>"##,
        r##"<style:style style:name="Endnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"/><style:text-properties fo:font-size="10pt"/></style:style>"##,
        r##"<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0cm"/></style:style>"##,
        r##"<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0cm"/></style:style>"##,
        r##"<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Heading_20_1" style:class="index"/>"##,
        r##"<style:style style:name="Contents_20_1" style:display-name="Contents 1" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties><style:tab-stops><style:tab-stop style:position="16cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>"##,
        r##"<style:style style:name="Contents_20_2" style:display-name="Contents 2" style:family="paragraph" style:parent-style-name="Contents_20_1" style:class="index"><style:paragraph-properties fo:margin-left="0.5cm"/></style:style>"##,
        r##"<style:style style:name="Contents_20_3" style:display-name="Contents 3" style:family="paragraph" style:parent-style-name="Contents_20_1" style:class="index"><style:paragraph-properties fo:margin-left="1cm"/></style:style>"##,
        r##"<style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>"##,
        r##"<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#0563c1" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>"##,
        r##"<text:notes-configuration text:note-class="footnote" style:num-format="1" text:start-value="0" text:footnotes-position="page" text:start-numbering-at="document"/><text:notes-configuration text:note-class="endnote" style:num-format="i" text:start-value="0"/>"##,
    ));
    s
}

fn para_style_name(style: Option<&str>) -> (&'static str, Option<u8>) {
    match style {
        Some(s) if s.starts_with("heading") => {
            let lvl = s[7..].parse::<u8>().unwrap_or(1).clamp(1, 6);
            (
                [
                    "Heading_20_1",
                    "Heading_20_2",
                    "Heading_20_3",
                    "Heading_20_4",
                    "Heading_20_5",
                    "Heading_20_6",
                ][lvl as usize - 1],
                Some(lvl),
            )
        }
        Some("title") => ("Title", None),
        Some("subtitle") => ("Subtitle", None),
        Some("quote") => ("Quotations", None),
        Some("code") => ("Preformatted_20_Text", None),
        Some("caption") => ("Caption", None),
        _ => ("Standard", None),
    }
}

/// `style:text-properties` of marks (link, comment and revisions excluded).
fn text_props(m: &Marks) -> String {
    let mut a = String::new();
    if m.bold {
        a.push_str(r#" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold""#);
    }
    if m.italic {
        a.push_str(r#" fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic""#);
    }
    if m.underline {
        a.push_str(r#" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color""#);
    }
    if m.strike {
        a.push_str(
            r#" style:text-line-through-style="solid" style:text-line-through-type="single""#,
        );
    }
    if m.superscript {
        a.push_str(r#" style:text-position="super 58%""#);
    } else if m.subscript {
        a.push_str(r#" style:text-position="sub 58%""#);
    }
    if let Some(s) = m.size {
        a.push_str(&format!(
            r#" fo:font-size="{s}pt" style:font-size-asian="{s}pt" style:font-size-complex="{s}pt""#
        ));
    }
    if let Some(c) = &m.color {
        a.push_str(&format!(r#" fo:color="{}""#, esc(c)));
    }
    if let Some(c) = &m.highlight {
        a.push_str(&format!(r#" fo:background-color="{}""#, esc(c)));
    }
    if let Some(f) = &m.font {
        a.push_str(&format!(
            r#" style:font-name="{0}" style:font-name-asian="{0}" style:font-name-complex="{0}""#,
            esc(f)
        ));
    }
    if a.is_empty() {
        String::new()
    } else {
        format!("<style:text-properties{a}/>")
    }
}

impl Writer {
    fn sink(&mut self) -> &mut AutoStyles {
        if self.in_master {
            &mut self.master
        } else {
            &mut self.content
        }
    }

    /// Blocks, with list paragraphs grouped into `text:list` elements.
    fn blocks(&mut self, blocks: &[Block]) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < blocks.len() {
            i += self.block_run(&blocks[i..], &mut out);
        }
        out
    }

    /// Writes the first block (or the run of list paragraphs it starts) and
    /// returns how many blocks were consumed.
    fn block_run(&mut self, blocks: &[Block], out: &mut String) -> usize {
        match &blocks[0] {
            Block::Paragraph(p) if p.list.is_some() => {
                // A list ends where a level switches between bullets and numbers.
                let mut kinds = [None::<bool>; 10];
                let n = blocks
                    .iter()
                    .take_while(|b| {
                        let Block::Paragraph(Paragraph { list: Some(l), .. }) = b else {
                            return false;
                        };
                        let slot = &mut kinds[(l.level as usize).min(9)];
                        *slot.get_or_insert(l.ordered) == l.ordered
                    })
                    .count();
                let run: Vec<&Paragraph> = blocks[..n]
                    .iter()
                    .filter_map(|b| {
                        if let Block::Paragraph(p) = b {
                            Some(p)
                        } else {
                            None
                        }
                    })
                    .collect();
                out.push_str(&self.list(&run));
                n
            }
            Block::Paragraph(p) => {
                let tag = if p.style.as_deref().is_some_and(|s| s.starts_with("heading")) {
                    "text:h"
                } else {
                    "text:p"
                };
                out.push_str(&self.paragraph(p, tag));
                1
            }
            Block::Table(t) => {
                out.push_str(&self.table(t));
                1
            }
            Block::PageBreak => {
                self.pending_break = true;
                1
            }
            Block::SectionBreak { .. } => 1,
            Block::Toc {
                title,
                entries,
                caption: Some(label),
            } => {
                out.push_str(&self.figures(title.as_deref(), entries, label));
                1
            }
            Block::Toc { title, entries, .. } => {
                out.push_str(&self.toc(title.as_deref(), entries));
                1
            }
            Block::Index { entries } => {
                self.pending_break = false;
                let mut body = String::from(
                    r#"<text:index-title text:name="Stichwortverzeichnis1_Head"><text:p text:style-name="Index_20_Heading">Stichwortverzeichnis</text:p></text:index-title>"#,
                );
                let mut letter = None;
                for e in entries {
                    let first = e
                        .term
                        .chars()
                        .next()
                        .map(|c| c.to_uppercase().collect::<String>());
                    if first != letter {
                        letter = first.clone();
                        body.push_str(&format!(
                            r#"<text:p text:style-name="Index_20_Separator">{}</text:p>"#,
                            text_xml(&first.unwrap_or_default())
                        ));
                    }
                    body.push_str(&format!(
                        r#"<text:p text:style-name="Index_20_1">{}, {}</text:p>"#,
                        text_xml(&e.term),
                        text_xml(&e.pages)
                    ));
                }
                out.push_str(&format!(r#"<text:alphabetical-index text:name="Stichwortverzeichnis1"><text:alphabetical-index-source text:ignore-case="true" text:main-entry-style-name="Main_20_index_20_entry" text:alphabetical-separators="true" fo:language="de" fo:country="DE"><text:index-title-template text:style-name="Index_20_Heading">Stichwortverzeichnis</text:index-title-template><text:alphabetical-index-entry-template text:outline-level="separator" text:style-name="Index_20_Separator"><text:index-entry-text/></text:alphabetical-index-entry-template><text:alphabetical-index-entry-template text:outline-level="1" text:style-name="Index_20_1"><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:alphabetical-index-entry-template></text:alphabetical-index-source><text:index-body>{body}</text:index-body></text:alphabetical-index>"#));
                1
            }
            Block::Bibliography { title, entries } => {
                self.pending_break = false;
                let title = title.as_deref().unwrap_or("Literaturverzeichnis");
                let mut body = format!(
                    r#"<text:index-title text:name="Literaturverzeichnis1_Head"><text:p text:style-name="Bibliography_20_Heading">{}</text:p></text:index-title>"#,
                    text_xml(title)
                );
                for e in entries {
                    body.push_str(&format!(
                        r#"<text:p text:style-name="Bibliography_20_1">{}</text:p>"#,
                        text_xml(e)
                    ));
                }
                out.push_str(&format!(r#"<text:bibliography text:name="Literaturverzeichnis1"><text:bibliography-source><text:index-title-template text:style-name="Bibliography_20_Heading">{}</text:index-title-template><text:bibliography-entry-template text:bibliography-type="book" text:style-name="Bibliography_20_1"><text:index-entry-bibliography text:bibliography-data-field="author"/><text:index-entry-span>, </text:index-entry-span><text:index-entry-bibliography text:bibliography-data-field="title"/><text:index-entry-span>, </text:index-entry-span><text:index-entry-bibliography text:bibliography-data-field="year"/></text:bibliography-entry-template></text:bibliography-source><text:index-body>{body}</text:index-body></text:bibliography>"#, esc(title)));
                1
            }
        }
    }

    fn list(&mut self, run: &[&Paragraph]) -> String {
        // Numbering per level from the first paragraph at that level.
        let mut ordered = [None::<bool>; 10];
        for p in run {
            let l = p.list.unwrap();
            let slot = &mut ordered[(l.level as usize).min(9)];
            if slot.is_none() {
                *slot = Some(l.ordered);
            }
        }
        let key: String = ordered
            .iter()
            .map(|o| if o == &Some(true) { 'n' } else { 'b' })
            .collect();
        let name = self.sink().raw(&format!("list:{key}"), |name| {
            let mut s = format!(r#"<text:list-style style:name="{name}">"#);
            for (i, c) in key.chars().enumerate() {
                let lvl = i + 1;
                let pos = format!(r#"<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="{0}" fo:text-indent="-0.635cm" fo:margin-left="{0}"/></style:list-level-properties>"#, cm(6.35 * lvl as f64));
                if c == 'n' {
                    let fmt = ["1", "a", "i"][i % 3];
                    s.push_str(&format!(r#"<text:list-level-style-number text:level="{lvl}" style:num-suffix="." style:num-format="{fmt}">{pos}</text:list-level-style-number>"#));
                } else {
                    let ch = ["•", "◦", "▪"][i % 3];
                    s.push_str(&format!(r#"<text:list-level-style-bullet text:level="{lvl}" text:bullet-char="{ch}">{pos}</text:list-level-style-bullet>"#));
                }
            }
            s.push_str("</text:list-style>");
            s
        });
        let mut out = format!(r#"<text:list text:style-name="{name}"><text:list-item>"#);
        let mut cur = 0usize;
        for (i, p) in run.iter().enumerate() {
            let l = p.list.unwrap().level as usize;
            if i == 0 {
                for _ in 0..l {
                    out.push_str("<text:list><text:list-item>");
                }
            } else if l > cur {
                for _ in cur..l {
                    out.push_str("<text:list><text:list-item>");
                }
            } else {
                for _ in l..cur {
                    out.push_str("</text:list-item></text:list>");
                }
                out.push_str("</text:list-item><text:list-item>");
            }
            let tag = if p.style.as_deref().is_some_and(|s| s.starts_with("heading")) {
                "text:h"
            } else {
                "text:p"
            };
            out.push_str(&self.paragraph(p, tag));
            cur = l;
        }
        for _ in 0..cur {
            out.push_str("</text:list-item></text:list>");
        }
        out.push_str("</text:list-item></text:list>");
        out
    }

    fn paragraph(&mut self, p: &Paragraph, tag: &str) -> String {
        let (parent, level) = para_style_name(p.style.as_deref());
        let parent = if self.in_master && parent == "Standard" {
            "Header"
        } else {
            parent
        };
        let mut props = String::new();
        match p.align.as_deref() {
            Some("center") => props.push_str(r#" fo:text-align="center""#),
            Some("right") => props.push_str(r#" fo:text-align="end""#),
            Some("justify") => props.push_str(r#" fo:text-align="justify""#),
            _ => {}
        }
        if p.indent_mm.abs() > 0.01 {
            props.push_str(&format!(r#" fo:margin-left="{}""#, cm(p.indent_mm)));
        }
        if p.first_line_mm.abs() > 0.01 {
            props.push_str(&format!(r#" fo:text-indent="{}""#, cm(p.first_line_mm)));
        }
        if let Some(v) = p.space_before_pt {
            props.push_str(&format!(r#" fo:margin-top="{v}pt""#));
        }
        if let Some(v) = p.space_after_pt {
            props.push_str(&format!(r#" fo:margin-bottom="{v}pt""#));
        }
        if let Some(v) = p.line_height {
            props.push_str(&format!(r#" fo:line-height="{}%""#, (v * 100.0).round()));
        }
        let mut attrs = format!(r#" style:parent-style-name="{parent}""#);
        if !self.in_master {
            if let Some(m) = self.pending_master.take() {
                attrs.push_str(&format!(r#" style:master-page-name="{m}""#));
            } else if std::mem::take(&mut self.pending_break) {
                props.push_str(r#" fo:break-before="page""#);
            }
        }
        let style = if props.is_empty() && !attrs.contains("master-page") {
            parent.to_string()
        } else {
            let body = if props.is_empty() {
                String::new()
            } else {
                format!("<style:paragraph-properties{props}/>")
            };
            self.sink().get("paragraph", &attrs, &body)
        };
        let outline = level
            .map(|l| format!(r#" text:outline-level="{l}""#))
            .unwrap_or_default();
        format!(
            r#"<{tag} text:style-name="{style}"{outline}>{}</{tag}>"#,
            self.inlines(&p.content)
        )
    }

    fn inlines(&mut self, content: &[Inline]) -> String {
        let mut out = String::new();
        let mut link: Option<&str> = None;
        for inl in content {
            let this_link = if let Inline::Text { marks, .. } = inl {
                marks.link.as_deref()
            } else {
                link
            };
            if this_link != link {
                if link.is_some() {
                    out.push_str("</text:a>");
                }
                if let Some(l) = this_link {
                    out.push_str(&format!(r#"<text:a xlink:type="simple" xlink:href="{}" text:style-name="Internet_20_link">"#, esc(l)));
                }
                link = this_link;
            }
            match inl {
                Inline::Text { text, marks } => {
                    // Comment ranges.
                    if marks.comment != self.open_comment {
                        if let Some(id) = self.open_comment.take() {
                            out.push_str(&format!(
                                r#"<office:annotation-end office:name="c{id}"/>"#
                            ));
                        }
                        if let Some(id) = marks.comment {
                            let c = self.comments.get(&id).cloned().unwrap_or_default();
                            let paras: String = c
                                .text
                                .split('\n')
                                .map(|l| format!("<text:p>{}</text:p>", text_xml(l)))
                                .collect();
                            let date = if c.date.is_empty() {
                                String::new()
                            } else {
                                format!("<dc:date>{}</dc:date>", esc(&c.date))
                            };
                            out.push_str(&format!(r#"<office:annotation office:name="c{id}"><dc:creator>{}</dc:creator>{date}{paras}</office:annotation>"#, esc(&c.author)));
                            self.open_comment = Some(id);
                        }
                    }
                    if let Some(rev) = &marks.del {
                        self.change_id += 1;
                        let id = self.change_id;
                        self.changes.push_str(&format!(
                            r#"<text:changed-region text:id="ct{id}"><text:deletion><office:change-info><dc:creator>{}</dc:creator><dc:date>{}</dc:date></office:change-info><text:p>{}</text:p></text:deletion></text:changed-region>"#,
                            esc(&rev.author),
                            esc(&rev.date),
                            text_xml(text)
                        ));
                        out.push_str(&format!(r#"<text:change text:change-id="ct{id}"/>"#));
                        continue;
                    }
                    let ins = marks.ins.as_ref().map(|rev| {
                        self.change_id += 1;
                        let id = self.change_id;
                        self.changes.push_str(&format!(
                            r#"<text:changed-region text:id="ct{id}"><text:insertion><office:change-info><dc:creator>{}</dc:creator><dc:date>{}</dc:date></office:change-info></text:insertion></text:changed-region>"#,
                            esc(&rev.author),
                            esc(&rev.date)
                        ));
                        id
                    });
                    if let Some(id) = ins {
                        out.push_str(&format!(r#"<text:change-start text:change-id="ct{id}"/>"#));
                    }
                    if let Some(f) = &marks.font {
                        self.fonts.insert(f.clone());
                    }
                    let props = text_props(marks);
                    if props.is_empty() {
                        out.push_str(&text_xml(text));
                    } else {
                        let name = self.sink().get("text", "", &props);
                        out.push_str(&format!(
                            r#"<text:span text:style-name="{name}">{}</text:span>"#,
                            text_xml(text)
                        ));
                    }
                    if let Some(id) = ins {
                        out.push_str(&format!(r#"<text:change-end text:change-id="ct{id}"/>"#));
                    }
                }
                Inline::Break => out.push_str("<text:line-break/>"),
                Inline::Tab => out.push_str("<text:tab/>"),
                Inline::Field { field, result } if field.starts_with("cite ") => {
                    let tag = &field[5..];
                    let src = self.sources.iter().find(|s| s.tag == tag);
                    let mut attrs = String::new();
                    if let Some(s) = src {
                        let kind = match s.kind.as_str() {
                            "article" => "article",
                            "web" => "www",
                            "report" => "techreport",
                            _ => "book",
                        };
                        attrs.push_str(&format!(r#" text:bibliography-type="{kind}""#));
                        for (n, v) in [
                            ("author", s.author.replace("; ", " and ")),
                            ("title", s.title.clone()),
                            ("year", s.year.clone()),
                            ("publisher", s.publisher.clone()),
                            ("address", s.city.clone()),
                            ("journal", s.journal.clone()),
                            ("pages", s.pages.clone()),
                            ("url", s.url.clone()),
                        ] {
                            if !v.is_empty() {
                                attrs.push_str(&format!(r#" text:{n}="{}""#, esc(&v)));
                            }
                        }
                    } else {
                        attrs.push_str(r#" text:bibliography-type="book""#);
                    }
                    let shown = if result.is_empty() {
                        format!("[{tag}]")
                    } else {
                        result.clone()
                    };
                    out.push_str(&format!(r#"<text:bibliography-mark text:identifier="{}"{attrs}>{}</text:bibliography-mark>"#, esc(tag), text_xml(&shown)));
                }
                Inline::Field { field, result } => out.push_str(&odf_field(field, result)),
                Inline::Bookmark { name, end } => out.push_str(&format!(
                    r#"<text:bookmark-{} text:name="{}"/>"#,
                    if *end { "end" } else { "start" },
                    esc(name)
                )),
                Inline::Footnote { text, endnote } => {
                    self.notes += 1;
                    let (class, style) = if *endnote {
                        ("endnote", "Endnote")
                    } else {
                        ("footnote", "Footnote")
                    };
                    let paras: String = text
                        .split('\n')
                        .map(|l| {
                            format!(
                                r#"<text:p text:style-name="{style}">{}</text:p>"#,
                                text_xml(l)
                            )
                        })
                        .collect();
                    out.push_str(&format!(r#"<text:note text:id="n{}" text:note-class="{class}"><text:note-citation>{}</text:note-citation><text:note-body>{paras}</text:note-body></text:note>"#, self.notes, self.notes));
                }
                Inline::Image {
                    src,
                    width,
                    height,
                    alt,
                } => out.push_str(&self.image(src, *width, *height, alt)),
            }
        }
        if link.is_some() {
            out.push_str("</text:a>");
        }
        out
    }

    fn image(&mut self, src: &str, width: f64, height: f64, alt: &str) -> String {
        let href = match self.images.get(src) {
            Some(h) => h.clone(),
            None => {
                let Some((mime, data)) = crate::package::parse_data_url(src) else {
                    return String::new();
                };
                let path = format!(
                    "Pictures/image{}.{}",
                    self.images.len() + 1,
                    crate::package::ext_for(&mime)
                );
                self.extras.push(Extra {
                    path: path.clone(),
                    mime,
                    data,
                });
                self.images.insert(src.to_string(), path.clone());
                path
            }
        };
        self.frames += 1;
        let style = self
            .sink()
            .get("graphic", r#" style:parent-style-name="Graphics""#, "");
        let title = if alt.is_empty() {
            String::new()
        } else {
            format!("<svg:title>{}</svg:title>", esc(alt))
        };
        format!(
            r#"<draw:frame draw:style-name="{style}" draw:name="Bild{}" text:anchor-type="as-char" svg:width="{}" svg:height="{}" draw:z-index="{}"><draw:image xlink:href="{href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>{title}</draw:frame>"#,
            self.frames,
            odf::cm_px(width),
            odf::cm_px(height),
            self.frames
        )
    }

    fn table(&mut self, t: &Table) -> String {
        self.tables += 1;
        let ncols = t.columns_mm.len().max(
            t.rows
                .iter()
                .map(|r| {
                    r.cells
                        .iter()
                        .map(|c| c.col_span.max(1) as usize)
                        .sum::<usize>()
                })
                .max()
                .unwrap_or(1),
        );
        let widths: Vec<f64> = (0..ncols)
            .map(|i| {
                t.columns_mm
                    .get(i)
                    .copied()
                    .unwrap_or(self.text_width / ncols as f64)
            })
            .collect();
        let total: f64 = widths.iter().sum();
        let mut tprops = format!(r#" style:width="{}" table:align="left""#, cm(total));
        let mut attrs = String::new();
        if !self.in_master {
            if let Some(m) = self.pending_master.take() {
                attrs.push_str(&format!(r#" style:master-page-name="{m}""#));
            } else if std::mem::take(&mut self.pending_break) {
                tprops.push_str(r#" fo:break-before="page""#);
            }
        }
        let tstyle = self.sink().get(
            "table",
            &attrs,
            &format!("<style:table-properties{tprops}/>"),
        );
        let mut out = format!(
            r#"<table:table table:name="Tabelle{}" table:style-name="{tstyle}">"#,
            self.tables
        );
        for w in &widths {
            let cs = self.sink().get(
                "table-column",
                "",
                &format!(
                    r#"<style:table-column-properties style:column-width="{}"/>"#,
                    cm(*w)
                ),
            );
            out.push_str(&format!(r#"<table:table-column table:style-name="{cs}"/>"#));
        }
        // Columns still covered by a cell spanning rows: col → (rows left, width).
        let mut active: HashMap<usize, (u32, usize)> = HashMap::new();
        let mut in_header = false;
        for (ri, row) in t.rows.iter().enumerate() {
            if row.header && ri == 0 {
                out.push_str("<table:table-header-rows>");
                in_header = true;
            } else if in_header && !row.header {
                out.push_str("</table:table-header-rows>");
                in_header = false;
            }
            out.push_str("<table:table-row>");
            let mut col = 0usize;
            let mut cells = row.cells.iter();
            loop {
                if let Some((left, span)) = active.get(&col).copied() {
                    out.push_str(&"<table:covered-table-cell/>".repeat(span));
                    if left <= 1 {
                        active.remove(&col);
                    } else {
                        active.insert(col, (left - 1, span));
                    }
                    col += span;
                    continue;
                }
                let Some(cell) = cells.next() else { break };
                let span = cell.col_span.max(1) as usize;
                let bg = cell
                    .background
                    .as_deref()
                    .map(|b| format!(r#" fo:background-color="{}""#, esc(b)))
                    .unwrap_or_default();
                let cstyle = self.sink().get("table-cell", "", &format!(r#"<style:table-cell-properties fo:padding="0.097cm" fo:border="0.5pt solid #000000"{bg}/>"#));
                let mut a = String::new();
                if span > 1 {
                    a.push_str(&format!(r#" table:number-columns-spanned="{span}""#));
                }
                if cell.row_span > 1 {
                    a.push_str(&format!(
                        r#" table:number-rows-spanned="{}""#,
                        cell.row_span
                    ));
                    active.insert(col, (cell.row_span - 1, span));
                }
                let inner = if cell.blocks.is_empty() {
                    "<text:p/>".to_string()
                } else {
                    self.blocks(&cell.blocks)
                };
                out.push_str(&format!(r#"<table:table-cell table:style-name="{cstyle}" office:value-type="string"{a}>{inner}</table:table-cell>"#));
                out.push_str(&"<table:covered-table-cell/>".repeat(span - 1));
                col += span;
            }
            // Pad short rows so every row has the full column count.
            while col < ncols {
                out.push_str("<table:table-cell><text:p/></table:table-cell>");
                col += 1;
            }
            out.push_str("</table:table-row>");
        }
        if in_header {
            out.push_str("</table:table-header-rows>");
        }
        out.push_str("</table:table>");
        out
    }

    /// Table of figures for a caption label.
    fn figures(&mut self, title: Option<&str>, entries: &[TocEntry], label: &str) -> String {
        self.pending_break = false;
        let title = title.unwrap_or("Abbildungsverzeichnis");
        let mut body = format!(
            r#"<text:index-title text:name="Abbildungsverzeichnis1_Head"><text:p text:style-name="Illustration_20_Index_20_Heading">{}</text:p></text:index-title>"#,
            text_xml(title)
        );
        for e in entries {
            body.push_str(&format!(
                r#"<text:p text:style-name="Illustration_20_Index_20_1">{}<text:tab/>{}</text:p>"#,
                text_xml(&e.text),
                e.page
            ));
        }
        format!(
            r#"<text:illustration-index text:name="Abbildungsverzeichnis1"><text:illustration-index-source text:caption-sequence-name="{}" text:caption-sequence-format="text"><text:index-title-template text:style-name="Illustration_20_Index_20_Heading">{}</text:index-title-template><text:illustration-index-entry-template text:style-name="Illustration_20_Index_20_1"><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:illustration-index-entry-template></text:illustration-index-source><text:index-body>{body}</text:index-body></text:illustration-index>"#,
            esc(label),
            esc(title)
        )
    }

    fn toc(&mut self, title: Option<&str>, entries: &[TocEntry]) -> String {
        let title = title.unwrap_or("Inhaltsverzeichnis");
        let mut tpl = String::new();
        for l in 1..=3 {
            tpl.push_str(&format!(
                r#"<text:table-of-content-entry-template text:outline-level="{l}" text:style-name="Contents_20_{l}"><text:index-entry-link-start/><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:table-of-content-entry-template>"#
            ));
        }
        let mut body = format!(
            r#"<text:index-title text:name="Inhaltsverzeichnis1_Head"><text:p text:style-name="Contents_20_Heading">{}</text:p></text:index-title>"#,
            text_xml(title)
        );
        for e in entries {
            let l = e.level.clamp(1, 3);
            body.push_str(&format!(
                r#"<text:p text:style-name="Contents_20_{l}">{}<text:tab/>{}</text:p>"#,
                text_xml(&e.text),
                e.page
            ));
        }
        self.pending_break = false;
        format!(
            r#"<text:table-of-content text:name="Inhaltsverzeichnis1"><text:table-of-content-source text:outline-level="3"><text:index-title-template text:style-name="Contents_20_Heading">{}</text:index-title-template>{tpl}</text:table-of-content-source><text:index-body>{body}</text:index-body></text:table-of-content>"#,
            esc(title)
        )
    }
}

/// A model field as ODF text field.
fn odf_field(field: &str, result: &str) -> String {
    let (kind, arg) = field.split_once(' ').unwrap_or((field, ""));
    let shown = |d: &str| esc(if result.is_empty() { d } else { result });
    match kind {
        "pages" => "<text:page-count>1</text:page-count>".into(),
        "page" => r#"<text:page-number text:select-page="current">1</text:page-number>"#.into(),
        "date" => format!("<text:date>{}</text:date>", shown("")),
        "author" => format!("<text:initial-creator>{}</text:initial-creator>", shown("")),
        "title" => format!("<text:title>{}</text:title>", shown("")),
        "filename" => format!(
            r#"<text:file-name text:display="name-and-extension">{}</text:file-name>"#,
            shown("")
        ),
        "seq" => format!(
            r#"<text:sequence text:name="{n}" text:formula="ooow:{n}+1" style:num-format="1">{}</text:sequence>"#,
            shown("1"),
            n = esc(arg)
        ),
        "ref" => format!(
            r#"<text:bookmark-ref text:reference-format="text" text:ref-name="{}">{}</text:bookmark-ref>"#,
            esc(arg),
            shown("")
        ),
        "merge" => format!(
            r#"<text:database-display text:table-name="" text:table-type="table" text:column-name="{}">&lt;{}&gt;</text:database-display>"#,
            esc(arg),
            esc(arg)
        ),
        "xe" => format!(
            r#"<text:alphabetical-index-mark text:string-value="{}"/>"#,
            esc(arg)
        ),
        "cite" => format!(
            r#"<text:bibliography-mark text:identifier="{}" text:bibliography-type="book">{}</text:bibliography-mark>"#,
            esc(arg),
            shown(&format!("[{arg}]"))
        ),
        _ => shown("").to_string(),
    }
}

/// Sequence names used by caption fields (declared at the start of the body).
fn sequence_names(blocks: &[Block], out: &mut std::collections::BTreeSet<String>) {
    for b in blocks {
        match b {
            Block::Paragraph(p) => {
                for i in &p.content {
                    if let Inline::Field { field, .. } = i
                        && let Some(n) = field.strip_prefix("seq ")
                    {
                        out.insert(n.to_string());
                    }
                }
            }
            Block::Table(t) => {
                for r in &t.rows {
                    for c in &r.cells {
                        sequence_names(&c.blocks, out);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Lines of a generated index body: (text, trailing page part after a tab or ", ").
fn index_lines(e: &Element) -> Vec<(String, String)> {
    let Some(body) = e.child("text:index-body") else {
        return Vec::new();
    };
    body.children_named("text:p")
        .map(odf::plain_text)
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .map(|t| match t.rsplit_once('\t') {
            Some((a, b)) => (a.trim().to_string(), b.trim().to_string()),
            None => match t.rsplit_once(", ") {
                Some((a, b))
                    if b.chars()
                        .all(|c| c.is_ascii_digit() || c == ',' || c == ' ' || c == '-') =>
                {
                    (a.to_string(), b.to_string())
                }
                _ => (t, String::new()),
            },
        })
        .collect()
}
