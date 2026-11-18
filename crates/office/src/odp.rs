//! OpenDocument Presentation (.odp) ⇄ [`Presentation`] for Ondura
//! Präsentation.
//!
//! Slides, text, shapes, pictures, tables, audio/video, notes, transitions
//! and entrance/emphasis/exit animations are mapped; charts and SmartArt
//! equivalents are not.

use std::collections::{BTreeSet, HashMap};

use crate::Result;
use crate::odf::{self, AutoStyles, Extra, OdfDoc, Styles, cm_px, esc_attr, px, text_xml};
use crate::pptx::{
    Animation, Loaded, Para, Presentation, Run, Shape, Slide, SmartArt, SmartArtMeta, Table,
    TableCell, TableRow, Transition, table_cell_fill,
};
use crate::xml::{Element, Node};

/// pptx geometry ↔ ODF custom shape type.
const GEOMETRY: [(&str, &str); 22] = [
    ("rect", "rectangle"),
    ("roundRect", "round-rectangle"),
    ("ellipse", "ellipse"),
    ("triangle", "isosceles-triangle"),
    ("rtTriangle", "right-triangle"),
    ("diamond", "diamond"),
    ("pentagon", "pentagon"),
    ("hexagon", "hexagon"),
    ("octagon", "octagon"),
    ("parallelogram", "parallelogram"),
    ("trapezoid", "trapezoid"),
    ("star5", "star5"),
    ("rightArrow", "right-arrow"),
    ("leftArrow", "left-arrow"),
    ("upArrow", "up-arrow"),
    ("downArrow", "down-arrow"),
    ("leftRightArrow", "left-right-arrow"),
    ("chevron", "chevron"),
    ("homePlate", "pentagon-right"),
    ("plus", "cross"),
    ("heart", "heart"),
    ("cloud", "cloud"),
];

/// Our effect ↔ LibreOffice preset id (class prefix added).
const EFFECTS: [(&str, &str, &str); 14] = [
    ("entr", "appear", "ooo-entrance-appear"),
    ("entr", "fade", "ooo-entrance-fade-in"),
    ("entr", "fly", "ooo-entrance-fly-in"),
    ("entr", "wipe", "ooo-entrance-wipe"),
    ("entr", "zoom", "ooo-entrance-zoom"),
    ("emph", "pulse", "ooo-emphasis-flash-bulb"),
    ("emph", "spin", "ooo-emphasis-spin"),
    ("emph", "grow", "ooo-emphasis-grow-and-shrink"),
    ("emph", "teeter", "ooo-emphasis-teeter"),
    ("exit", "appear", "ooo-exit-disappear"),
    ("exit", "fade", "ooo-exit-fade-out"),
    ("exit", "fly", "ooo-exit-fly-out"),
    ("exit", "wipe", "ooo-exit-wipe"),
    ("exit", "zoom", "ooo-exit-zoom"),
];

fn dir_name(d: Option<&str>) -> &'static str {
    match d {
        Some("t") => "from-top",
        Some("l") => "from-left",
        Some("r") => "from-right",
        _ => "from-bottom",
    }
}

/// `0.5s`, `500ms`, `00:00:01.5` → milliseconds.
fn ms(s: &str) -> Option<u32> {
    let s = s.trim();
    if let Some(v) = s.strip_suffix("ms") {
        return v.parse::<f64>().ok().map(|v| v.round() as u32);
    }
    if let Some(v) = s.strip_suffix('s') {
        return v.parse::<f64>().ok().map(|v| (v * 1000.0).round() as u32);
    }
    if s.contains(':') {
        let parts: Vec<f64> = s.split(':').filter_map(|p| p.parse().ok()).collect();
        let secs = parts.iter().fold(0.0, |acc, v| acc * 60.0 + v);
        return Some((secs * 1000.0).round() as u32);
    }
    s.parse::<f64>().ok().map(|v| (v * 1000.0).round() as u32)
}

// --------------------------------------------------------------- reading --

struct Reader<'a> {
    doc: &'a OdfDoc,
    st: Styles,
    warnings: BTreeSet<String>,
    next_id: u32,
    /// draw:id / xml:id → shape id (per slide).
    ids: HashMap<String, u32>,
    master: String,
}

/// Parse an .odp file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let doc = OdfDoc::open(bytes, odf::MIME_SLIDES, "Präsentationsdokument")?;
    let st = doc.styles();
    let mut r = Reader {
        doc: &doc,
        st,
        warnings: BTreeSet::new(),
        next_id: 1,
        ids: HashMap::new(),
        master: "Default".into(),
    };
    let mut p = Presentation {
        slides: Vec::new(),
        ..Default::default()
    };
    (p.title, p.author) = doc.meta();
    let body = doc
        .content
        .child("office:body")
        .and_then(|b| b.child("office:presentation"));
    let pages: Vec<&Element> = body
        .map(|b| b.children_named("draw:page").collect())
        .unwrap_or_default();
    // Slide size from the first page's master.
    if let Some(first) = pages.first() {
        let master = first.attr("draw:master-page-name").unwrap_or("Default");
        if let Some(layout) = r
            .master_page(master)
            .and_then(|m| m.attr("style:page-layout-name"))
            .and_then(|l| r.st.page_layouts.get(l))
            && let (Some(w), Some(h)) = (
                layout.get("fo:page-width").and_then(|v| px(v)),
                layout.get("fo:page-height").and_then(|v| px(v)),
            )
        {
            p.width = (w * 10.0).round() / 10.0;
            p.height = (h * 10.0).round() / 10.0;
        }
    }
    for page in pages {
        p.slides.push(r.slide(page));
    }
    if p.slides.is_empty() {
        p.slides.push(Slide::default());
    }
    Ok(Loaded {
        presentation: p,
        warnings: r.warnings.into_iter().collect(),
    })
}

impl<'a> Reader<'a> {
    fn master_page(&self, name: &str) -> Option<&'a Element> {
        let doc: &'a OdfDoc = self.doc;
        let ms = doc.styles.as_ref()?.child("office:master-styles")?;
        ms.children_named("style:master-page")
            .find(|m| m.attr("style:name") == Some(name))
            .or_else(|| ms.children_named("style:master-page").next())
    }

    fn slide(&mut self, page: &Element) -> Slide {
        self.ids.clear();
        self.next_id = 2;
        self.master = page
            .attr("draw:master-page-name")
            .unwrap_or("Default")
            .to_string();
        let mut s = Slide::default();
        let ps = page.attr("draw:style-name");
        let master_style = self
            .master_page(&self.master.clone())
            .and_then(|m| m.attr("draw:style-name"));
        // Background: page style, else the master's.
        for style in [ps, master_style] {
            let g = |a: &str| self.st.get("drawing-page", style, a);
            match g("draw:fill") {
                Some("solid") => {
                    s.background = g("draw:fill-color").and_then(odf::color);
                }
                Some("bitmap") => {
                    s.background_image = g("draw:fill-image-name").and_then(|n| self.fill_image(n));
                }
                _ => continue,
            }
            break;
        }
        s.hidden = self.st.get("drawing-page", ps, "presentation:visibility") == Some("hidden");
        s.transition = self.transition(ps);
        // Master decoration (non-placeholder shapes) first.
        if let Some(m) = self.master_page(&self.master.clone()) {
            let mut deco = Vec::new();
            for e in m
                .elements()
                .filter(|e| e.attr("presentation:class").is_none())
            {
                self.element(e, &mut deco);
            }
            s.shapes.extend(deco);
        }
        for e in page.elements() {
            match e.name.as_str() {
                "presentation:notes" => {
                    let mut frames = Vec::new();
                    e.find_all("draw:frame", &mut frames);
                    if let Some(f) = frames
                        .iter()
                        .find(|f| f.attr("presentation:class") == Some("notes"))
                    {
                        s.notes = f
                            .child("draw:text-box")
                            .map(odf::plain_text)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                    }
                }
                "anim:par" => {}
                _ => self.element(e, &mut s.shapes),
            }
        }
        if let Some(t) = page.child("anim:par") {
            s.animations = self.animations(t);
            let dur = t
                .children_named("anim:par")
                .find_map(|p| {
                    p.child("anim:transitionFilter")
                        .filter(|f| f.attr("smil:targetElement").is_none())
                })
                .and_then(|f| f.attr("smil:dur"))
                .and_then(ms);
            if let (Some(tr), Some(d)) = (s.transition.as_mut(), dur) {
                tr.duration = d;
            }
        }
        s
    }

    fn fill_image(&self, name: &str) -> Option<String> {
        let st = self.doc.styles.as_ref()?.child("office:styles")?;
        let img = st
            .children_named("draw:fill-image")
            .find(|i| i.attr("draw:name") == Some(name))?;
        self.doc.data_url(img.attr("xlink:href")?)
    }

    fn transition(&self, style: Option<&str>) -> Option<Transition> {
        let g = |a: &str| self.st.get("drawing-page", style, a);
        let advance_after = (g("presentation:transition-type") == Some("automatic"))
            .then(|| g("presentation:duration").and_then(ms))
            .flatten();
        let Some(ty) = g("smil:type") else {
            return advance_after.map(|a| Transition {
                kind: "none".into(),
                dir: None,
                duration: 0,
                advance_after: Some(a),
            });
        };
        let sub = g("smil:subtype").unwrap_or_default();
        let kind = match ty {
            "fade" => "fade",
            "pushWipe" => "push",
            "slideWipe" => "cover",
            "barWipe" => "wipe",
            "barnDoorWipe" => "split",
            "irisWipe" | "ellipseWipe" | "zoom" => "zoom",
            _ => "fade",
        };
        let reverse = g("smil:direction") == Some("reverse");
        let dir = match (kind, sub, reverse) {
            ("push" | "cover", "fromRight", _) => Some("l"),
            ("push" | "cover", "fromLeft", _) => Some("r"),
            ("push" | "cover", "fromBottom", _) => Some("u"),
            ("push" | "cover", "fromTop", _) => Some("d"),
            ("wipe", "topToBottom", false) => Some("d"),
            ("wipe", "topToBottom", true) => Some("u"),
            ("wipe", _, true) => Some("l"),
            ("wipe", _, false) => Some("r"),
            _ => None,
        };
        let duration = g("presentation:transition-duration")
            .and_then(ms)
            .unwrap_or(match g("presentation:transition-speed") {
                Some("fast") => 500,
                Some("slow") => 1500,
                _ => 1000,
            });
        Some(Transition {
            kind: kind.into(),
            dir: dir.map(String::from),
            duration,
            advance_after,
        })
    }

    /// Style of a presentation object or drawing shape.
    fn style_of(e: &Element) -> (&'static str, Option<&str>) {
        match e.attr("presentation:style-name") {
            Some(s) => ("presentation", Some(s)),
            None => ("graphic", e.attr("draw:style-name")),
        }
    }

    fn base(&mut self, e: &Element) -> Shape {
        let n = |a: &str| e.attr(a).and_then(px).unwrap_or(0.0);
        let mut s = Shape {
            x: n("svg:x"),
            y: n("svg:y"),
            w: n("svg:width"),
            h: n("svg:height"),
            ..Default::default()
        };
        if let Some(t) = e.attr("draw:transform") {
            apply_transform(&mut s, t);
        }
        s.id = self.next_id;
        self.next_id += 1;
        for key in [e.attr("draw:id"), e.attr("xml:id")].into_iter().flatten() {
            self.ids.insert(key.to_string(), s.id);
        }
        let r = |v: f64| (v * 10.0).round() / 10.0;
        (s.x, s.y, s.w, s.h) = (r(s.x), r(s.y), r(s.w), r(s.h));
        let (family, style) = Self::style_of(e);
        let g = |a: &str| self.st.get(family, style, a);
        s.fill = match g("draw:fill") {
            Some("solid") => g("draw:fill-color").and_then(odf::color),
            _ => None,
        };
        if g("draw:stroke").is_some_and(|v| v != "none") {
            s.line = g("svg:stroke-color")
                .and_then(odf::color)
                .or(Some("#000000".into()));
            s.line_width = g("svg:stroke-width")
                .and_then(odf::pt)
                .map(|v| (v * 100.0).round() / 100.0)
                .unwrap_or(0.75);
        }
        s.anchor = match g("draw:textarea-vertical-align") {
            Some("middle") => Some("middle".into()),
            Some("bottom") => Some("bottom".into()),
            _ => None,
        };
        s
    }

    fn element(&mut self, e: &Element, out: &mut Vec<Shape>) {
        match e.name.as_str() {
            "draw:frame" => self.frame(e, out),
            "draw:custom-shape" | "draw:rect" | "draw:ellipse" => {
                let mut s = self.base(e);
                s.kind = match e.name.as_str() {
                    "draw:rect" => "rect".into(),
                    "draw:ellipse" => "ellipse".into(),
                    _ => {
                        let g = e.child("draw:enhanced-geometry");
                        let ty = g.and_then(|g| g.attr("draw:type")).unwrap_or("rectangle");
                        s.flip_h = g.and_then(|g| g.attr("draw:mirror-horizontal")) == Some("true");
                        s.flip_v = g.and_then(|g| g.attr("draw:mirror-vertical")) == Some("true");
                        let ty = ty.strip_prefix("ooxml-").unwrap_or(ty);
                        GEOMETRY
                            .iter()
                            .find(|(k, o)| *o == ty || *k == ty)
                            .map(|(k, _)| k.to_string())
                            .unwrap_or_else(|| {
                                if ty != "rectangle" {
                                    self.warnings.insert(
                                        "Einige Formen werden als Rechteck angezeigt.".into(),
                                    );
                                }
                                "rect".into()
                            })
                    }
                };
                s.paragraphs = self.text(e, &s, None);
                out.push(s);
            }
            "draw:line" => {
                let n = |a: &str| e.attr(a).and_then(px).unwrap_or(0.0);
                let (x1, y1, x2, y2) = (n("svg:x1"), n("svg:y1"), n("svg:x2"), n("svg:y2"));
                let mut s = self.base(e);
                s.kind = "line".into();
                s.x = x1.min(x2);
                s.y = y1.min(y2);
                s.w = (x2 - x1).abs();
                s.h = (y2 - y1).abs();
                s.flip_h = x2 < x1;
                s.flip_v = y2 < y1;
                if s.line.is_none() {
                    s.line = Some("#000000".into());
                    s.line_width = 0.75;
                }
                out.push(s);
            }
            "draw:g" => {
                let desc = e.child("svg:desc").map(|d| d.text());
                if let Some(sa) = desc
                    .as_deref()
                    .and_then(|d| d.trim().strip_prefix(SMARTART_DESC))
                    .and_then(|j| serde_json::from_str::<OdpSmartArt>(j).ok())
                {
                    // A SmartArt written by Ondura: children back to local coordinates.
                    let mut shapes = Vec::new();
                    for c in e.elements() {
                        self.element(c, &mut shapes);
                    }
                    let [x, y, w, h] = sa.frame;
                    for (i, c) in shapes.iter_mut().enumerate() {
                        c.id = i as u32 + 1;
                        c.x = ((c.x - x) * 10.0).round() / 10.0;
                        c.y = ((c.y - y) * 10.0).round() / 10.0;
                    }
                    let mut s = self.base(e);
                    s.kind = "smartart".into();
                    (s.x, s.y, s.w, s.h) = (x, y, w, h);
                    s.fill = None;
                    s.line = None;
                    s.smartart = Some(SmartArt {
                        layout: sa.meta.layout,
                        items: sa.meta.items,
                        color: sa.meta.color,
                        base_w: w,
                        base_h: h,
                        shapes,
                    });
                    out.push(s);
                    return;
                }
                for c in e.elements() {
                    self.element(c, out);
                }
            }
            "draw:connector" | "draw:polygon" | "draw:polyline" | "draw:path" => {
                self.warnings
                    .insert("Verbinder und Freihandformen werden nicht übernommen.".into());
            }
            _ => {}
        }
    }

    fn frame(&mut self, e: &Element, out: &mut Vec<Shape>) {
        let class = e.attr("presentation:class");
        if matches!(
            class,
            Some("page-number" | "date-time" | "footer" | "header")
        ) {
            return;
        }
        let mut s = self.base(e);
        s.placeholder = match class {
            Some("title") => Some("title".into()),
            Some("subtitle") => Some("subTitle".into()),
            Some("outline") => Some("body".into()),
            _ => None,
        };
        if let Some(tb) = e.child("draw:text-box") {
            s.kind = "text".into();
            s.paragraphs = self.text(tb, &s, class);
        } else if let Some(t) = e.child("table:table") {
            // Tables come with a replacement picture; the table wins.
            s.kind = "table".into();
            s.fill = None;
            s.table = Some(self.table(t, &s));
        } else if let Some(plugin) = e.child("draw:plugin") {
            s.fill = None;
            let href = plugin.attr("xlink:href").unwrap_or_default();
            match self.doc.data_url(href) {
                Some(url) => {
                    let audio = url.starts_with("data:audio");
                    s.kind = "image".into();
                    s.media = Some(url);
                    s.media_kind = Some(if audio { "audio" } else { "video" }.into());
                    s.src = e
                        .child("draw:image")
                        .and_then(|i| i.attr("xlink:href"))
                        .and_then(|h| self.doc.data_url(h))
                        .filter(|u| u.starts_with("data:image/"));
                }
                None => {
                    self.warnings.insert(
                        "Verknüpfte Audio- und Videodateien werden nicht übernommen.".into(),
                    );
                    return;
                }
            }
        } else if let Some(img) = e.child("draw:image") {
            match img
                .attr("xlink:href")
                .and_then(|h| self.doc.data_url(h))
                .filter(|u| u.starts_with("data:image/") && !u.starts_with("data:image/x-"))
            {
                Some(src) => {
                    s.kind = "image".into();
                    s.src = Some(src);
                    s.fill = None;
                }
                None => {
                    // Empty picture placeholders and unknown formats.
                    if class.is_none() {
                        self.warnings.insert("Einige Bilder (verknüpft oder in unbekanntem Format) werden nicht angezeigt.".into());
                    }
                    return;
                }
            }
        } else if e.child("draw:object").is_some() || e.child("draw:object-ole").is_some() {
            self.warnings
                .insert("Diagramme und eingebettete Objekte werden nicht angezeigt.".into());
            return;
        } else {
            return;
        }
        out.push(s);
    }

    fn table(&mut self, t: &Element, shape: &Shape) -> Table {
        let mut table = Table::default();
        for c in t.children_named("table:table-column") {
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
                .and_then(px)
                .unwrap_or(100.0);
            table
                .cols
                .extend(std::iter::repeat_n((w * 10.0).round() / 10.0, n));
        }
        for row in t.children_named("table:table-row") {
            let h = self
                .st
                .get(
                    "table-row",
                    row.attr("table:style-name"),
                    "style:row-height",
                )
                .or_else(|| {
                    self.st.get(
                        "table-row",
                        row.attr("table:style-name"),
                        "style:min-row-height",
                    )
                })
                .and_then(px)
                .unwrap_or(40.0);
            let mut cells = Vec::new();
            for c in row.elements() {
                let merged = c.name == "table:covered-table-cell";
                if !merged && c.name != "table:table-cell" {
                    continue;
                }
                let fill = self
                    .st
                    .get("table-cell", c.attr("table:style-name"), "draw:fill-color")
                    .filter(|_| {
                        self.st
                            .get("table-cell", c.attr("table:style-name"), "draw:fill")
                            != Some("none")
                    })
                    .and_then(odf::color);
                let span = |a: &str| {
                    c.attr(a)
                        .and_then(|v| v.parse::<u32>().ok())
                        .filter(|&v| v > 1)
                };
                cells.push(TableCell {
                    paragraphs: if merged {
                        Vec::new()
                    } else {
                        self.text(c, shape, None)
                    },
                    fill,
                    span: span("table:number-columns-spanned"),
                    row_span: span("table:number-rows-spanned"),
                    merged,
                    anchor: None,
                });
            }
            table.rows.push(TableRow {
                h: (h * 10.0).round() / 10.0,
                cells,
            });
        }
        if table.cols.is_empty() {
            let n = table
                .rows
                .iter()
                .map(|r| r.cells.len())
                .max()
                .unwrap_or(1)
                .max(1);
            table.cols = vec![shape.w / n as f64; n];
        }
        table
    }

    /// Run properties of a style (following parents).
    fn run_props(&self, family: &str, style: Option<&str>, base: &Run) -> Run {
        let g = |a: &str| self.st.get(family, style, a);
        let mut r = base.clone();
        if let Some(w) = g("fo:font-weight") {
            r.bold = w == "bold" || w.parse::<u32>().is_ok_and(|v| v >= 600);
        }
        if let Some(v) = g("fo:font-style") {
            r.italic = v == "italic" || v == "oblique";
        }
        if let Some(v) = g("style:text-underline-style") {
            r.underline = v != "none";
        }
        if let Some(v) = g("style:text-line-through-style") {
            r.strike = v != "none";
        }
        if let Some(v) = g("fo:font-size").and_then(odf::pt) {
            r.size = Some((v * 10.0).round() / 10.0);
        }
        if let Some(c) = g("fo:color").and_then(odf::color) {
            r.color = Some(c);
        }
        if let Some(f) = self.st.font(family, style) {
            r.font = Some(f);
        }
        r
    }

    /// Paragraphs of a text container; `class` selects the master's text styles.
    fn text(&mut self, container: &Element, shape: &Shape, class: Option<&str>) -> Vec<Para> {
        let (family, style) = Self::style_of_owner(container);
        let mut base = self.run_props(family, style, &Run::default());
        if let Some(c) = class {
            let ms = match c {
                "title" => format!("{}-title", self.master),
                "subtitle" => format!("{}-subtitle", self.master),
                "outline" => format!("{}-outline1", self.master),
                _ => String::new(),
            };
            if !ms.is_empty() {
                let master_run = self.run_props("presentation", Some(&ms), &Run::default());
                base = merge_run(&master_run, &base);
            }
        }
        let _ = shape;
        let mut out = Vec::new();
        self.paras(container, &base, class, None, &mut out);
        out
    }

    fn style_of_owner(e: &Element) -> (&'static str, Option<&str>) {
        match e.attr("presentation:style-name") {
            Some(s) => ("presentation", Some(s)),
            None => ("graphic", e.attr("draw:style-name")),
        }
    }

    fn paras(
        &mut self,
        e: &Element,
        base: &Run,
        class: Option<&str>,
        list: Option<(String, u8)>,
        out: &mut Vec<Para>,
    ) {
        for c in e.elements() {
            match c.name.as_str() {
                "text:p" | "text:h" => {
                    let ps = c.attr("text:style-name");
                    let level = list.as_ref().map(|l| l.1).unwrap_or(0);
                    // Outline levels use the master's outline style of that level.
                    let mut b = base.clone();
                    if class == Some("outline") && level > 0 {
                        let ms = format!("{}-outline{}", self.master, level + 1);
                        b = merge_run(
                            &self.run_props("presentation", Some(&ms), &b),
                            &Run::default(),
                        );
                    }
                    let pr = self.run_props("paragraph", ps, &b);
                    let mut para = Para {
                        align: match self.st.get("paragraph", ps, "fo:text-align") {
                            Some("center") => Some("center".into()),
                            Some("end" | "right") => Some("right".into()),
                            Some("justify") => Some("justify".into()),
                            _ => None,
                        },
                        level,
                        bullet: list
                            .as_ref()
                            .map(|(b, _)| b.clone())
                            .filter(|b| !b.is_empty()),
                        runs: Vec::new(),
                        size: None,
                    };
                    self.runs(c, &pr, &mut para.runs);
                    if para.runs.is_empty() {
                        para.size = pr.size;
                    }
                    out.push(para);
                }
                "text:list" => {
                    let lvl = list.as_ref().map(|l| l.1 + 1).unwrap_or(0);
                    let style = c.attr("text:style-name");
                    let bullet = match list.as_ref() {
                        Some(l) if style.is_none() => l.0.clone(),
                        _ => self.bullet(style, lvl, class),
                    };
                    for item in c.elements() {
                        self.paras(item, base, class, Some((bullet.clone(), lvl)), out);
                    }
                }
                _ => {}
            }
        }
    }

    /// Bullet character (`#` = numbered, empty = none) of a list level.
    fn bullet(&self, style: Option<&str>, level: u8, class: Option<&str>) -> String {
        let doc: &OdfDoc = self.doc;
        let find = |root: Option<&Element>| -> Option<String> {
            let root = root?;
            let ls = root
                .children_named("text:list-style")
                .find(|l| l.attr("style:name") == style)?;
            let lv = ls.elements().find(|l| {
                l.attr("text:level").and_then(|v| v.parse::<u8>().ok()) == Some(level + 1)
            })?;
            Some(match lv.name.as_str() {
                "text:list-level-style-number" => "#".into(),
                "text:list-level-style-bullet" => {
                    lv.attr("text:bullet-char").unwrap_or("•").to_string()
                }
                _ => String::new(),
            })
        };
        find(doc.content.child("office:automatic-styles"))
            .or_else(|| find(doc.styles.as_ref().and_then(|s| s.child("office:styles"))))
            .or_else(|| {
                find(
                    doc.styles
                        .as_ref()
                        .and_then(|s| s.child("office:automatic-styles")),
                )
            })
            .unwrap_or_else(|| {
                if class == Some("outline") {
                    "•".into()
                } else {
                    String::new()
                }
            })
    }

    fn runs(&mut self, e: &Element, base: &Run, out: &mut Vec<Run>) {
        for c in &e.children {
            match c {
                Node::Text(t) => push_run(out, base, t.replace(['\n', '\r'], " ")),
                Node::Element(x) => match x.name.as_str() {
                    "text:span" => {
                        let r = self.run_props("text", x.attr("text:style-name"), base);
                        self.runs(x, &r, out);
                    }
                    "text:s" => push_run(
                        out,
                        base,
                        " ".repeat(
                            x.attr("text:c")
                                .and_then(|v| v.parse().ok())
                                .unwrap_or(1usize)
                                .min(1000),
                        ),
                    ),
                    "text:tab" => push_run(out, base, "\t".into()),
                    "text:line-break" => push_run(out, base, "\n".into()),
                    "office:annotation"
                    | "text:bookmark"
                    | "text:bookmark-start"
                    | "text:bookmark-end" => {}
                    _ => self.runs(x, base, out),
                },
            }
        }
    }

    fn animations(&mut self, root: &Element) -> Vec<Animation> {
        let mut nodes = Vec::new();
        root.find_all("anim:par", &mut nodes);
        let mut out = Vec::new();
        for n in nodes {
            let (Some(class), Some(preset)) = (
                n.attr("presentation:preset-class"),
                n.attr("presentation:preset-id"),
            ) else {
                continue;
            };
            let class = match class {
                "entrance" => "entr",
                "emphasis" => "emph",
                "exit" => "exit",
                "motion-path" => "path",
                _ => continue,
            };
            // Motion path in PowerPoint's syntax (ODF has no end marker `E`).
            let path = if class == "path" {
                let Some(p) = n
                    .child("anim:animateMotion")
                    .and_then(|m| m.attr("svg:path"))
                else {
                    continue;
                };
                let p = p.trim();
                Some(if p.ends_with('E') {
                    p.to_string()
                } else {
                    format!("{p} E")
                })
            } else {
                None
            };
            // LibreOffice names some effects differently from what we write.
            let preset = match preset {
                "ooo-exit-fade-out-and-zoom" => "ooo-exit-zoom",
                "ooo-entrance-fade-in-and-zoom" => "ooo-entrance-zoom",
                "ooo-emphasis-pulse" => "ooo-emphasis-flash-bulb",
                p => p,
            };
            let effect = if let Some(p) = &path {
                crate::pptx::path_kind(p)
            } else {
                EFFECTS
                    .iter()
                    .find(|(c, _, p)| *c == class && *p == preset)
                    .map(|(_, e, _)| *e)
                    .unwrap_or_else(|| {
                        self.warnings.insert(
                            "Einige Animationseffekte werden durch Verblassen ersetzt.".into(),
                        );
                        if class == "emph" { "pulse" } else { "fade" }
                    })
            };
            let mut targets = Vec::new();
            for c in n.elements() {
                if let Some(t) = c.attr("smil:targetElement") {
                    targets.push(t.to_string());
                }
            }
            let Some(shape) = targets.first().and_then(|t| self.ids.get(t)).copied() else {
                continue;
            };
            let trigger = match n.attr("presentation:node-type") {
                Some("with-previous") => "with",
                Some("after-previous") => "after",
                _ => "click",
            };
            let dur = n.elements().filter_map(|c| {
                let d = c.attr("smil:dur").and_then(ms)?;
                let rev = if c.attr("smil:autoReverse") == Some("true") {
                    2
                } else {
                    1
                };
                let rep = c
                    .attr("smil:repeatCount")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(1.0);
                Some((d as f64 * rev as f64 * rep) as u32)
            });
            let duration = dur.filter(|d| *d > 1).max().unwrap_or(500);
            let delay = n.attr("smil:begin").and_then(ms).unwrap_or(0);
            let dir = matches!(effect, "fly" | "wipe").then(|| {
                match n.attr("presentation:preset-sub-type") {
                    Some("from-top" | "to-top") => "t",
                    Some("from-left" | "to-left") => "l",
                    Some("from-right" | "to-right") => "r",
                    _ => "b",
                }
            });
            out.push(Animation {
                shape,
                class: class.into(),
                effect: effect.into(),
                path,
                trigger: trigger.into(),
                dir: dir.map(String::from),
                duration,
                delay,
            });
        }
        out
    }
}

fn merge_run(over: &Run, base: &Run) -> Run {
    Run {
        text: String::new(),
        bold: over.bold || base.bold,
        italic: over.italic || base.italic,
        underline: over.underline || base.underline,
        strike: over.strike || base.strike,
        size: base.size.or(over.size),
        color: base.color.clone().or(over.color.clone()),
        font: base.font.clone().or(over.font.clone()),
    }
}

fn push_run(out: &mut Vec<Run>, base: &Run, text: String) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = out.last_mut() {
        let mut l = last.clone();
        l.text = String::new();
        let mut b = base.clone();
        b.text = String::new();
        if l == b {
            last.text.push_str(&text);
            return;
        }
    }
    out.push(Run {
        text,
        ..base.clone()
    });
}

/// `rotate (a) translate (x y)` → rotation (clockwise degrees) and position.
fn apply_transform(s: &mut Shape, t: &str) {
    let num = |name: &str| -> Option<Vec<String>> {
        let i = t.find(name)?;
        let rest = &t[i + name.len()..];
        let open = rest.find('(')?;
        let close = rest.find(')')?;
        Some(
            rest[open + 1..close]
                .split_whitespace()
                .map(String::from)
                .collect(),
        )
    };
    let a = num("rotate")
        .and_then(|v| v.first().and_then(|x| x.parse::<f64>().ok()))
        .unwrap_or(0.0);
    let Some(tr) = num("translate") else { return };
    let (Some(tx), Some(ty)) = (
        tr.first().and_then(|v| px(v)),
        tr.get(1).and_then(|v| px(v)),
    ) else {
        return;
    };
    let theta = -a; // ODF rotates counter-clockwise
    let (sin, cos) = theta.sin_cos();
    let (hw, hh) = (s.w / 2.0, s.h / 2.0);
    let cx = tx + hw * cos - hh * sin;
    let cy = ty + hw * sin + hh * cos;
    s.x = cx - hw;
    s.y = cy - hh;
    let mut deg = theta.to_degrees() % 360.0;
    if deg < 0.0 {
        deg += 360.0;
    }
    s.rotation = (deg * 100.0).round() / 100.0;
}

// --------------------------------------------------------------- writing --

/// What a save as .odp cannot keep.
pub fn losses(p: &Presentation) -> Vec<String> {
    let mut out = BTreeSet::new();
    for s in &p.slides {
        for sh in &s.shapes {
            if sh.kind == "chart" {
                out.insert("Diagramme".to_string());
            }
        }
    }
    out.into_iter().collect()
}

struct Writer {
    /// Number of the slide being written (for unique ids).
    slide: usize,
    auto: AutoStyles,
    fonts: BTreeSet<String>,
    extras: Vec<Extra>,
    files: HashMap<String, String>,
    fill_images: String,
}

impl Writer {
    /// Package path of an embedded data URL (deduplicated).
    fn file(&mut self, url: &str, dir: &str, stem: &str) -> Option<String> {
        if let Some(p) = self.files.get(url) {
            return Some(p.clone());
        }
        let (mime, data) = crate::package::parse_data_url(url)?;
        let path = format!(
            "{dir}/{stem}{}.{}",
            self.files.len() + 1,
            crate::package::ext_for(&mime)
        );
        self.extras.push(Extra {
            path: path.clone(),
            mime,
            data,
        });
        self.files.insert(url.to_string(), path.clone());
        Some(path)
    }

    fn run_props(&mut self, r: &Run) -> String {
        let mut a = String::new();
        if r.bold {
            a.push_str(r#" fo:font-weight="bold""#);
        }
        if r.italic {
            a.push_str(r#" fo:font-style="italic""#);
        }
        if r.underline {
            a.push_str(r#" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color""#);
        }
        if r.strike {
            a.push_str(r#" style:text-line-through-style="solid""#);
        }
        if let Some(s) = r.size {
            a.push_str(&format!(r#" fo:font-size="{s}pt""#));
        }
        if let Some(c) = &r.color {
            a.push_str(&format!(r#" fo:color="{}""#, esc_attr(c)));
        }
        if let Some(f) = &r.font {
            self.fonts.insert(f.clone());
            a.push_str(&format!(r#" style:font-name="{}""#, esc_attr(f)));
        }
        a
    }

    fn para(&mut self, p: &Para) -> String {
        let mut props = String::new();
        match p.align.as_deref() {
            Some("center") => props.push_str(r#" fo:text-align="center""#),
            Some("right") => props.push_str(r#" fo:text-align="end""#),
            Some("justify") => props.push_str(r#" fo:text-align="justify""#),
            _ => props.push_str(r#" fo:text-align="start""#),
        }
        if p.bullet.is_none() && p.level > 0 {
            props.push_str(&format!(
                r#" fo:margin-left="{}""#,
                odf::cm(p.level as f64 * 12.7)
            ));
        }
        let mut body = format!("<style:paragraph-properties{props}/>");
        if p.runs.is_empty()
            && let Some(s) = p.size
        {
            body.push_str(&format!(r#"<style:text-properties fo:font-size="{s}pt"/>"#));
        }
        let style = self.auto.get("paragraph", "", &body);
        let mut inner = String::new();
        for r in &p.runs {
            let a = self.run_props(r);
            if a.is_empty() {
                inner.push_str(&text_xml(&r.text));
            } else {
                let ts = self
                    .auto
                    .get("text", "", &format!("<style:text-properties{a}/>"));
                inner.push_str(&format!(
                    r#"<text:span text:style-name="{ts}">{}</text:span>"#,
                    text_xml(&r.text)
                ));
            }
        }
        format!(r#"<text:p text:style-name="{style}">{inner}</text:p>"#)
    }

    /// Paragraphs with bullets grouped into lists.
    fn paras(&mut self, paras: &[Para]) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < paras.len() {
            let Some(b) = paras[i].bullet.clone() else {
                out.push_str(&self.para(&paras[i]));
                i += 1;
                continue;
            };
            let n = paras[i..]
                .iter()
                .take_while(|p| p.bullet.as_deref() == Some(b.as_str()))
                .count();
            let ls = self.auto.raw(&format!("list:{b}"), |name| {
                let mut s = format!(r#"<text:list-style style:name="{name}">"#);
                for lvl in 1..=9 {
                    let pos = format!(r#"<style:list-level-properties text:space-before="{}" text:min-label-width="0.6cm"/>"#, odf::cm((lvl - 1) as f64 * 12.7));
                    if b == "#" {
                        s.push_str(&format!(r#"<text:list-level-style-number text:level="{lvl}" style:num-suffix="." style:num-format="1">{pos}</text:list-level-style-number>"#));
                    } else {
                        s.push_str(&format!(r#"<text:list-level-style-bullet text:level="{lvl}" text:bullet-char="{}">{pos}<style:text-properties fo:font-family="Arial"/></text:list-level-style-bullet>"#, esc_attr(&b)));
                    }
                }
                s.push_str("</text:list-style>");
                s
            });
            out.push_str(&format!(r#"<text:list text:style-name="{ls}">"#));
            for p in &paras[i..i + n] {
                out.push_str("<text:list-item>");
                for _ in 0..p.level {
                    out.push_str("<text:list><text:list-item>");
                }
                out.push_str(&self.para(p));
                for _ in 0..p.level {
                    out.push_str("</text:list-item></text:list>");
                }
                out.push_str("</text:list-item>");
            }
            out.push_str("</text:list>");
            i += n;
        }
        out
    }

    fn graphic_style(&mut self, s: &Shape, family: &str, text: bool) -> String {
        let mut g = String::new();
        match &s.fill {
            Some(f) => g.push_str(&format!(
                r#" draw:fill="solid" draw:fill-color="{}""#,
                esc_attr(f)
            )),
            None => g.push_str(r#" draw:fill="none""#),
        }
        match &s.line {
            Some(l) => g.push_str(&format!(
                r#" draw:stroke="solid" svg:stroke-color="{}" svg:stroke-width="{}pt""#,
                esc_attr(l),
                if s.line_width > 0.0 {
                    s.line_width
                } else {
                    0.75
                }
            )),
            None => g.push_str(r#" draw:stroke="none""#),
        }
        if text {
            let va = match s.anchor.as_deref() {
                Some("middle") => "middle",
                Some("bottom") => "bottom",
                _ => "top",
            };
            g.push_str(&format!(r#" draw:textarea-vertical-align="{va}" draw:auto-grow-height="false" fo:min-height="0cm" fo:padding-top="0.127cm" fo:padding-bottom="0.127cm" fo:padding-left="0.254cm" fo:padding-right="0.254cm" fo:wrap-option="wrap""#));
        }
        self.auto
            .get(family, "", &format!("<style:graphic-properties{g}/>"))
    }

    fn shape(&mut self, s: &Shape) -> String {
        // xml:id must be unique in the whole document, not only on the slide.
        let id = format!(r#" draw:id="s{0}-{1}" xml:id="s{0}-{1}""#, self.slide, s.id);
        let geo = if s.rotation.abs() > 1e-6 {
            let theta = s.rotation.to_radians();
            let (sin, cos) = theta.sin_cos();
            let (hw, hh) = (s.w / 2.0, s.h / 2.0);
            let (cx, cy) = (s.x + hw, s.y + hh);
            let tx = cx - (hw * cos - hh * sin);
            let ty = cy - (hw * sin + hh * cos);
            format!(
                r#" svg:width="{}" svg:height="{}" draw:transform="rotate ({}) translate ({} {})""#,
                cm_px(s.w),
                cm_px(s.h),
                -theta,
                cm_px(tx),
                cm_px(ty)
            )
        } else {
            format!(
                r#" svg:x="{}" svg:y="{}" svg:width="{}" svg:height="{}""#,
                cm_px(s.x),
                cm_px(s.y),
                cm_px(s.w),
                cm_px(s.h)
            )
        };
        let class = match s.placeholder.as_deref() {
            Some("title" | "ctrTitle") => Some("title"),
            Some("subTitle") => Some("subtitle"),
            Some("body" | "obj") => Some("outline"),
            _ => None,
        };
        match s.kind.as_str() {
            "text" => {
                let (attr, family) = if class.is_some() {
                    ("presentation:style-name", "presentation")
                } else {
                    ("draw:style-name", "graphic")
                };
                let st = self.graphic_style(s, family, true);
                let cls = class
                    .map(|c| {
                        format!(r#" presentation:class="{c}" presentation:user-transformed="true""#)
                    })
                    .unwrap_or_default();
                let body = self.paras(&s.paragraphs);
                format!(
                    r#"<draw:frame {attr}="{st}"{cls}{id}{geo}><draw:text-box>{body}</draw:text-box></draw:frame>"#
                )
            }
            "image" => {
                let st = self.graphic_style(s, "graphic", false);
                let poster = s
                    .src
                    .as_deref()
                    .and_then(|u| self.file(u, "Pictures", "image"));
                let img = poster.map(|p| format!(r#"<draw:image xlink:href="{p}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>"#)).unwrap_or_default();
                let media = s
                    .media
                    .as_deref()
                    .and_then(|u| self.file(u, "Media", "media"));
                let inner = match media {
                    Some(m) => format!(
                        r#"<draw:plugin xlink:href="{m}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="application/vnd.sun.star.media"><draw:param draw:name="Loop" draw:value="false"/><draw:param draw:name="Mute" draw:value="false"/><draw:param draw:name="VolumeDB" draw:value="0"/><draw:param draw:name="Zoom" draw:value="fit"/></draw:plugin>{img}"#
                    ),
                    None => img,
                };
                format!(r#"<draw:frame draw:style-name="{st}"{id}{geo}>{inner}</draw:frame>"#)
            }
            "table" => self.table(s, &id, &geo),
            "chart" => String::new(),
            "smartart" => {
                let Some(sa) = &s.smartart else {
                    return String::new();
                };
                let (sx, sy) = (
                    if sa.base_w > 0.0 {
                        s.w / sa.base_w
                    } else {
                        1.0
                    },
                    if sa.base_h > 0.0 {
                        s.h / sa.base_h
                    } else {
                        1.0
                    },
                );
                let meta = OdpSmartArt {
                    meta: SmartArtMeta {
                        layout: sa.layout.clone(),
                        items: sa.items.clone(),
                        color: sa.color.clone(),
                    },
                    frame: [s.x, s.y, s.w, s.h],
                };
                let mut g = format!(
                    "<draw:g><svg:desc>{}{}</svg:desc>",
                    SMARTART_DESC,
                    esc_attr(&serde_json::to_string(&meta).unwrap_or_default())
                );
                for (j, c) in sa.shapes.iter().enumerate() {
                    let mut c = c.clone();
                    c.id = s.id * 1000 + j as u32 + 1;
                    c.x = s.x + c.x * sx;
                    c.y = s.y + c.y * sy;
                    c.w *= sx;
                    c.h *= sy;
                    g.push_str(&self.shape(&c));
                }
                g.push_str("</draw:g>");
                g
            }
            "line" => {
                let st = self.graphic_style(
                    &Shape {
                        fill: None,
                        ..s.clone()
                    },
                    "graphic",
                    false,
                );
                let (x1, x2) = if s.flip_h {
                    (s.x + s.w, s.x)
                } else {
                    (s.x, s.x + s.w)
                };
                let (y1, y2) = if s.flip_v {
                    (s.y + s.h, s.y)
                } else {
                    (s.y, s.y + s.h)
                };
                format!(
                    r#"<draw:line draw:style-name="{st}"{id} svg:x1="{}" svg:y1="{}" svg:x2="{}" svg:y2="{}"><text:p/></draw:line>"#,
                    cm_px(x1),
                    cm_px(y1),
                    cm_px(x2),
                    cm_px(y2)
                )
            }
            kind => {
                let st = self.graphic_style(s, "graphic", true);
                let ty = GEOMETRY
                    .iter()
                    .find(|(k, _)| *k == kind)
                    .map(|(_, o)| *o)
                    .unwrap_or("rectangle");
                let mirror = format!(
                    "{}{}",
                    if s.flip_h {
                        r#" draw:mirror-horizontal="true""#
                    } else {
                        ""
                    },
                    if s.flip_v {
                        r#" draw:mirror-vertical="true""#
                    } else {
                        ""
                    }
                );
                let body = self.paras(&s.paragraphs);
                format!(
                    r#"<draw:custom-shape draw:style-name="{st}"{id}{geo}>{body}<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="{ty}"{mirror}/></draw:custom-shape>"#
                )
            }
        }
    }

    fn table(&mut self, s: &Shape, id: &str, geo: &str) -> String {
        let Some(t) = &s.table else {
            return String::new();
        };
        let mut out = format!(
            r#"<draw:frame draw:style-name="{}"{id}{geo}><table:table>"#,
            self.graphic_style(&Shape::default(), "graphic", false)
        );
        for w in &t.cols {
            let cs = self.auto.get(
                "table-column",
                "",
                &format!(
                    r#"<style:table-column-properties style:column-width="{}"/>"#,
                    cm_px(*w)
                ),
            );
            out.push_str(&format!(r#"<table:table-column table:style-name="{cs}"/>"#));
        }
        for (ri, row) in t.rows.iter().enumerate() {
            let rs = self.auto.get(
                "table-row",
                "",
                &format!(
                    r#"<style:table-row-properties style:row-height="{}"/>"#,
                    cm_px(row.h)
                ),
            );
            out.push_str(&format!(r#"<table:table-row table:style-name="{rs}">"#));
            for c in &row.cells {
                if c.merged {
                    out.push_str("<table:covered-table-cell/>");
                    continue;
                }
                let fill = match table_cell_fill(t, ri, c) {
                    Some(f) => format!(r#" draw:fill="solid" draw:fill-color="{}""#, esc_attr(&f)),
                    None => r#" draw:fill="none""#.into(),
                };
                let va = match c.anchor.as_deref() {
                    Some("middle") => "middle",
                    Some("bottom") => "bottom",
                    _ => "top",
                };
                let cs = self.auto.get("table-cell", "", &format!(r#"<style:graphic-properties{fill} draw:textarea-vertical-align="{va}"/><style:paragraph-properties fo:border="0.5pt solid #ffffff"/>"#));
                let mut a = String::new();
                if let Some(n) = c.span {
                    a.push_str(&format!(r#" table:number-columns-spanned="{n}""#));
                }
                if let Some(n) = c.row_span {
                    a.push_str(&format!(r#" table:number-rows-spanned="{n}""#));
                }
                let body = self.paras(&c.paragraphs);
                out.push_str(&format!(
                    r#"<table:table-cell table:style-name="{cs}"{a}>{}</table:table-cell>"#,
                    if body.is_empty() {
                        "<text:p/>".into()
                    } else {
                        body
                    }
                ));
            }
            out.push_str("</table:table-row>");
        }
        out.push_str("</table:table></draw:frame>");
        out
    }

    fn page_style(&mut self, s: &Slide, index: usize) -> String {
        let mut p = String::new();
        if let Some(img) = s
            .background_image
            .as_deref()
            .and_then(|u| self.file(u, "Pictures", "image"))
        {
            let name = format!("Hintergrund{}", index + 1);
            self.fill_images.push_str(&format!(r#"<draw:fill-image draw:name="{name}" xlink:href="{img}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>"#));
            p.push_str(&format!(
                r#" draw:fill="bitmap" draw:fill-image-name="{name}" style:repeat="stretch""#
            ));
        } else if let Some(bg) = &s.background {
            p.push_str(&format!(
                r#" draw:fill="solid" draw:fill-color="{}""#,
                esc_attr(bg)
            ));
        }
        if s.hidden {
            p.push_str(r#" presentation:visibility="hidden""#);
        }
        if let Some(t) = &s.transition {
            let (ty, sub, rev) = transition_smil(t);
            let manual = if t.advance_after.is_some() {
                "automatic"
            } else {
                "manual"
            };
            if let Some(a) = t.advance_after {
                p.push_str(&format!(r#" presentation:duration="{}""#, iso_dur(a)));
            }
            if ty.is_empty() && t.advance_after.is_some() {
                p.push_str(r#" presentation:transition-type="automatic""#);
            }
            if !ty.is_empty() {
                let speed = if t.duration < 750 {
                    "fast"
                } else if t.duration < 1250 {
                    "medium"
                } else {
                    "slow"
                };
                p.push_str(&format!(r#" presentation:transition-type="{manual}" smil:type="{ty}" smil:subtype="{sub}" presentation:transition-speed="{speed}" presentation:transition-duration="{}""#, iso_dur(t.duration)));
                if rev {
                    p.push_str(r#" smil:direction="reverse""#);
                }
            }
        }
        self.auto.get(
            "drawing-page",
            "",
            &format!("<style:drawing-page-properties{p}/>"),
        )
    }
}

/// SMIL type, subtype and reverse flag of a transition (`""` for cut).
fn transition_smil(t: &Transition) -> (&'static str, &'static str, bool) {
    match (t.kind.as_str(), t.dir.as_deref()) {
        ("cut" | "none", _) => ("", "", false),
        ("push", d) => ("pushWipe", push_sub(d), false),
        ("cover", d) => ("slideWipe", push_sub(d), false),
        ("wipe", Some("d")) => ("barWipe", "topToBottom", false),
        ("wipe", Some("u")) => ("barWipe", "topToBottom", true),
        ("wipe", Some("l")) => ("barWipe", "leftToRight", true),
        ("wipe", _) => ("barWipe", "leftToRight", false),
        ("split", _) => ("barnDoorWipe", "vertical", false),
        ("zoom", _) => ("irisWipe", "rectangle", false),
        _ => ("fade", "crossfade", false),
    }
}

fn push_sub(d: Option<&str>) -> &'static str {
    match d {
        Some("r") => "fromLeft",
        Some("u") => "fromBottom",
        Some("d") => "fromTop",
        _ => "fromRight",
    }
}

/// Milliseconds → `PT0.5S`.
fn iso_dur(ms: u32) -> String {
    format!("PT{}S", ms as f64 / 1000.0)
}

fn secs(ms: u32) -> String {
    format!("{}s", ms as f64 / 1000.0)
}

/// `anim:` timing tree of a slide's animations.
fn animations_xml(s: &Slide, page_id: &str, slide_no: usize) -> String {
    let anims: Vec<&Animation> = s
        .animations
        .iter()
        .filter(|a| {
            s.shapes
                .iter()
                .any(|x| x.id == a.shape && x.kind != "chart")
        })
        .collect();
    // The slide transition's exact duration lives in the timing tree.
    let transition = match &s.transition {
        Some(t) if t.kind != "cut" => {
            let (ty, sub, rev) = transition_smil(t);
            let rev = if rev {
                r#" smil:direction="reverse""#
            } else {
                ""
            };
            format!(
                r#"<anim:par smil:begin="{page_id}.begin"><anim:transitionFilter smil:dur="{}" smil:type="{ty}" smil:subtype="{sub}"{rev}/></anim:par>"#,
                secs(t.duration)
            )
        }
        _ => String::new(),
    };
    if anims.is_empty() {
        return if transition.is_empty() {
            String::new()
        } else {
            format!(r#"<anim:par presentation:node-type="timing-root">{transition}</anim:par>"#)
        };
    }
    // Click groups → sub-groups started with/after the previous effect.
    let mut clicks: Vec<Vec<Vec<&Animation>>> = Vec::new();
    for a in &anims {
        match a.trigger.as_str() {
            "with" if !clicks.is_empty() => clicks.last_mut().unwrap().last_mut().unwrap().push(a),
            "after" if !clicks.is_empty() => clicks.last_mut().unwrap().push(vec![a]),
            _ => clicks.push(vec![vec![a]]),
        }
    }
    let mut seq = String::new();
    for (ci, click) in clicks.iter().enumerate() {
        let auto = ci == 0 && click[0][0].trigger != "click";
        seq.push_str(&format!(
            r#"<anim:par smil:begin="{}" smil:fill="hold">"#,
            if auto { "0s" } else { "next" }
        ));
        let mut start = 0u32;
        for (gi, group) in click.iter().enumerate() {
            seq.push_str(&format!(
                r#"<anim:par smil:begin="{}" smil:fill="hold">"#,
                secs(start)
            ));
            let mut longest = 0;
            for (ai, a) in group.iter().enumerate() {
                let class = match a.class.as_str() {
                    "emph" => "emph",
                    "exit" => "exit",
                    "path" if a.path.is_some() => "path",
                    _ => "entr",
                };
                let preset = EFFECTS
                    .iter()
                    .find(|(c, e, _)| *c == class && *e == a.effect)
                    .map(|(_, _, p)| *p)
                    .unwrap_or(if class == "path" {
                        "libo-motionpath-custom"
                    } else if class == "emph" {
                        "ooo-emphasis-flash-bulb"
                    } else if class == "exit" {
                        "ooo-exit-fade-out"
                    } else {
                        "ooo-entrance-fade-in"
                    });
                let node = match (gi, ai) {
                    (0, 0) => match a.trigger.as_str() {
                        "with" => "with-previous",
                        "after" => "after-previous",
                        _ => "on-click",
                    },
                    (_, 0) => "after-previous",
                    _ => "with-previous",
                };
                let dur = if a.effect == "appear" {
                    1
                } else {
                    a.duration.max(2)
                };
                longest = longest.max(a.delay + dur);
                let tgt = format!("s{slide_no}-{}", a.shape);
                let pclass = match class {
                    "emph" => "emphasis",
                    "exit" => "exit",
                    "path" => "motion-path",
                    _ => "entrance",
                };
                let sub = if matches!(a.effect.as_str(), "fly" | "wipe") {
                    format!(
                        r#" presentation:preset-sub-type="{}""#,
                        if class == "exit" {
                            dir_name(a.dir.as_deref()).replace("from", "to")
                        } else {
                            dir_name(a.dir.as_deref()).to_string()
                        }
                    )
                } else {
                    String::new()
                };
                seq.push_str(&format!(r#"<anim:par smil:begin="{}" smil:fill="hold" presentation:node-type="{node}" presentation:preset-class="{pclass}" presentation:preset-id="{preset}"{sub}>"#, secs(a.delay)));
                let d = secs(dur);
                let mode = if class == "exit" {
                    r#" smil:mode="out""#
                } else {
                    ""
                };
                if class == "entr" {
                    seq.push_str(&format!(r#"<anim:set smil:begin="0s" smil:dur="0.001s" smil:fill="hold" smil:targetElement="{tgt}" smil:attributeName="visibility" smil:to="visible"/>"#));
                }
                match (class, a.effect.as_str()) {
                    ("path", _) => {
                        let p = a.path.as_deref().unwrap_or("M 0 0").trim().trim_end_matches('E').trim();
                        seq.push_str(&format!(r#"<anim:animateMotion smil:dur="{d}" smil:fill="hold" smil:targetElement="{tgt}" svg:path="{}"/>"#, esc_attr(p)));
                    }
                    ("emph", "spin") => seq.push_str(&format!(r#"<anim:animateTransform smil:dur="{d}" smil:fill="hold" smil:targetElement="{tgt}" smil:by="360" smil:attributeName="transform" svg:type="rotate"/>"#)),
                    ("emph", "teeter") => seq.push_str(&format!(r#"<anim:animateTransform smil:dur="{}" smil:fill="hold" smil:targetElement="{tgt}" smil:autoReverse="true" smil:repeatCount="2" smil:by="5" smil:attributeName="transform" svg:type="rotate"/>"#, secs((dur / 4).max(1)))),
                    ("emph", e) => {
                        // Scale offsets (LibreOffice adds them to 1).
                        let by = if e == "grow" { "0.5" } else { "0.1" };
                        seq.push_str(&format!(r#"<anim:animateTransform smil:dur="{}" smil:fill="hold" smil:targetElement="{tgt}" smil:autoReverse="true" smil:by="{by},{by}" smil:attributeName="transform" svg:type="scale"/>"#, secs((dur / 2).max(1))));
                    }
                    (_, "appear") => {}
                    (_, "fly") => {
                        let (attr, off) = match a.dir.as_deref() {
                            Some("t") => ("y", "0-height/2"),
                            Some("l") => ("x", "0-width/2"),
                            Some("r") => ("x", "1+width/2"),
                            _ => ("y", "1+height/2"),
                        };
                        let (other, keep) = if attr == "x" { ("y", "y") } else { ("x", "x") };
                        let values = if class == "exit" { format!("{attr};{off}") } else { format!("{off};{attr}") };
                        seq.push_str(&format!(r#"<anim:animate smil:dur="{d}" smil:fill="hold" smil:targetElement="{tgt}" smil:attributeName="{other}" smil:values="{keep};{keep}" smil:keyTimes="0;1" presentation:additive="base"/><anim:animate smil:dur="{d}" smil:fill="hold" smil:targetElement="{tgt}" smil:attributeName="{attr}" smil:values="{values}" smil:keyTimes="0;1" presentation:additive="base"/>"#));
                    }
                    (_, "wipe") => {
                        let (sub, rev) = match a.dir.as_deref() {
                            Some("t") => ("topToBottom", false),
                            Some("l") => ("leftToRight", false),
                            Some("r") => ("leftToRight", true),
                            _ => ("topToBottom", true),
                        };
                        let rev = if rev { r#" smil:direction="reverse""# } else { "" };
                        seq.push_str(&format!(r#"<anim:transitionFilter smil:dur="{d}" smil:targetElement="{tgt}"{mode} smil:type="barWipe" smil:subtype="{sub}"{rev}/>"#));
                    }
                    (_, "zoom") => {
                        let (w, h) = if class == "exit" { ("width;0", "height;0") } else { ("0;width", "0;height") };
                        seq.push_str(&format!(r#"<anim:transitionFilter smil:dur="{d}" smil:targetElement="{tgt}"{mode} smil:type="fade" smil:subtype="crossfade"/><anim:animate smil:dur="{d}" smil:fill="hold" smil:targetElement="{tgt}" smil:attributeName="width" smil:values="{w}" smil:keyTimes="0;1"/><anim:animate smil:dur="{d}" smil:fill="hold" smil:targetElement="{tgt}" smil:attributeName="height" smil:values="{h}" smil:keyTimes="0;1"/>"#));
                    }
                    _ => seq.push_str(&format!(r#"<anim:transitionFilter smil:dur="{d}" smil:targetElement="{tgt}"{mode} smil:type="fade" smil:subtype="crossfade"/>"#)),
                }
                if class == "exit" {
                    seq.push_str(&format!(r#"<anim:set smil:begin="{}" smil:dur="0.001s" smil:fill="hold" smil:targetElement="{tgt}" smil:attributeName="visibility" smil:to="hidden"/>"#, secs(dur.saturating_sub(1))));
                }
                seq.push_str("</anim:par>");
            }
            seq.push_str("</anim:par>");
            start += longest;
        }
        seq.push_str("</anim:par>");
    }
    format!(
        r#"<anim:par smil:dur="indefinite" smil:restart="never" presentation:node-type="timing-root">{transition}<anim:seq smil:dur="indefinite" presentation:node-type="main-sequence">{seq}</anim:seq></anim:par>"#
    )
}

/// Serialise a presentation as .odp.
pub fn write(p: &Presentation) -> Result<Vec<u8>> {
    let mut w = Writer {
        slide: 0,
        auto: AutoStyles::new("a"),
        fonts: BTreeSet::from(["Calibri".to_string()]),
        extras: Vec::new(),
        files: HashMap::new(),
        fill_images: String::new(),
    };
    let mut pages = String::new();
    for (i, s) in p.slides.iter().enumerate() {
        w.slide = i + 1;
        // The slide master's background and shapes are part of every page.
        let flat;
        let s = match &p.master {
            Some(m) => {
                let mut c = s.clone();
                if c.background.is_none() && c.background_image.is_none() {
                    c.background = m.background.clone();
                }
                if !c.hide_master {
                    c.shapes.splice(0..0, m.shapes.iter().cloned());
                }
                flat = c;
                &flat
            }
            None => s,
        };
        let ps = w.page_style(s, i);
        let mut shapes = String::new();
        for sh in &s.shapes {
            shapes.push_str(&w.shape(sh));
        }
        let notes_style = w.auto.get(
            "presentation",
            "",
            r#"<style:graphic-properties draw:fill="none" draw:stroke="none"/>"#,
        );
        let notes: String = s
            .notes
            .split('\n')
            .map(|l| format!("<text:p>{}</text:p>", text_xml(l)))
            .collect();
        pages.push_str(&format!(
            r#"<draw:page draw:name="Folie{n}" draw:style-name="{ps}" draw:master-page-name="Default" xml:id="page{n}" draw:id="page{n}">{shapes}{anim}<presentation:notes><draw:page-thumbnail presentation:class="page" svg:x="2cm" svg:y="2cm" svg:width="17cm" svg:height="9.6cm" draw:page-number="{n}"/><draw:frame presentation:style-name="{notes_style}" presentation:class="notes" svg:x="2cm" svg:y="13cm" svg:width="17cm" svg:height="13cm"><draw:text-box>{notes}</draw:text-box></draw:frame></presentation:notes></draw:page>"#,
            n = i + 1,
            anim = animations_xml(s, &format!("page{}", i + 1), i + 1),
        ));
    }
    let fonts = odf::font_decls(w.fonts.iter().map(String::as_str));
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}>{fonts}<office:automatic-styles>{auto}</office:automatic-styles><office:body><office:presentation>{pages}</office:presentation></office:body></office:document-content>"#,
        ns = odf::NS,
        auto = w.auto.xml
    );
    let styles = format!(
        r##"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ns}>{fonts}<office:styles>{fill}<style:default-style style:family="graphic"><style:graphic-properties svg:stroke-color="#3465a4" draw:fill-color="#729fcf"/><style:paragraph-properties fo:text-align="start"/><style:text-properties style:font-name="Calibri" fo:font-size="18pt" fo:language="de" fo:country="DE"/></style:default-style><style:style style:name="Default-background" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="#ffffff"/></style:style><style:style style:name="Default-title" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none" draw:textarea-vertical-align="middle"/><style:text-properties fo:font-size="44pt"/></style:style><style:style style:name="Default-subtitle" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="24pt"/></style:style><style:style style:name="Default-outline1" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="28pt"/></style:style><style:style style:name="Default-notes" style:family="presentation"><style:text-properties fo:font-size="12pt"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="{pw}" fo:page-height="{ph}" style:print-orientation="landscape"/></style:page-layout><style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#ffffff"/></style:style></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1"/></office:master-styles></office:document-styles>"##,
        ns = odf::NS,
        fill = w.fill_images,
        pw = cm_px(p.width),
        ph = cm_px(p.height),
    );
    odf::package(
        odf::MIME_SLIDES,
        content,
        styles,
        odf::meta_xml(&p.title, &p.author),
        w.extras,
    )
}

/// Prefix of the `svg:desc` of a group that is a Ondura SmartArt.
const SMARTART_DESC: &str = "ondura-smartart:";

#[derive(serde::Serialize, serde::Deserialize)]
struct OdpSmartArt {
    #[serde(flatten)]
    meta: SmartArtMeta,
    /// Position and size of the graphic (px).
    frame: [f64; 4],
}
