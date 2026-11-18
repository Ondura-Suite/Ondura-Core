//! Page layout of a worksheet ("Seitenlayout"): paper, margins, scaling,
//! print area and titles, page breaks, headers and footers. Read and
//! written for xlsx and ods.

use serde::{Deserialize, Serialize};

use crate::xml::{Element, esc};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PageSetup {
    pub landscape: bool,
    /// "A4", "A3", "A5", "Letter" or "Legal".
    pub paper: String,
    /// Margins in centimetres.
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub margin_header: f64,
    pub margin_footer: f64,
    /// Scaling in percent (10–400), used when not fitting to pages.
    pub scale: u32,
    /// Fit to this many pages wide / tall (0 = automatic).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_height: Option<u32>,
    pub gridlines: bool,
    pub headings: bool,
    pub center_h: bool,
    pub center_v: bool,
    /// Header and footer in Excel code syntax (`&L…&C…&R…`, `&P`, `&N`, `&D`, `&T`, `&F`, `&A`).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub header: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub footer: String,
    /// Print area, e.g. `A1:F40`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_area: Option<String>,
    /// Rows / columns repeated on every page, e.g. `1:2` and `A:A`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_rows: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_cols: Option<String>,
    /// Manual page breaks: 0-based index of the first row/column of a new page.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub row_breaks: Vec<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub col_breaks: Vec<u32>,
}

impl Default for PageSetup {
    fn default() -> Self {
        // Excel's "Normal" margins.
        Self {
            landscape: false,
            paper: "A4".into(),
            margin_top: 1.91,
            margin_bottom: 1.91,
            margin_left: 1.78,
            margin_right: 1.78,
            margin_header: 0.76,
            margin_footer: 0.76,
            scale: 100,
            fit_width: None,
            fit_height: None,
            gridlines: false,
            headings: false,
            center_h: false,
            center_v: false,
            header: String::new(),
            footer: String::new(),
            print_area: None,
            title_rows: None,
            title_cols: None,
            row_breaks: Vec::new(),
            col_breaks: Vec::new(),
        }
    }
}

/// Paper sizes: name, Excel paperSize code, width and height in mm.
const PAPERS: [(&str, u32, f64, f64); 5] = [
    ("A4", 9, 210.0, 297.0),
    ("A3", 8, 297.0, 420.0),
    ("A5", 11, 148.0, 210.0),
    ("Letter", 1, 215.9, 279.4),
    ("Legal", 5, 215.9, 355.6),
];

impl PageSetup {
    /// Paper width and height in mm (portrait).
    pub fn paper_mm(&self) -> (f64, f64) {
        PAPERS
            .iter()
            .find(|p| p.0 == self.paper)
            .map(|p| (p.2, p.3))
            .unwrap_or((210.0, 297.0))
    }

    fn fit(&self) -> bool {
        self.fit_width.is_some() || self.fit_height.is_some()
    }

    // ------------------------------------------------------------ xlsx --

    /// Reads printOptions, pageMargins, pageSetup, headerFooter and breaks.
    /// Returns `None` when the sheet only has default settings.
    pub fn from_xlsx(ws: &Element) -> Option<PageSetup> {
        let mut p = PageSetup::default();
        let on = |e: &Element, a: &str| matches!(e.attr(a), Some("1" | "true"));
        if let Some(o) = ws.child("x:printOptions") {
            p.gridlines = on(o, "gridLines");
            p.headings = on(o, "headings");
            p.center_h = on(o, "horizontalCentered");
            p.center_v = on(o, "verticalCentered");
        }
        if let Some(m) = ws.child("x:pageMargins") {
            let cm = |a: &str, d: f64| {
                m.attr(a)
                    .and_then(|v| v.parse::<f64>().ok())
                    .map(|inch| (inch * 2.54 * 100.0).round() / 100.0)
                    .unwrap_or(d)
            };
            p.margin_top = cm("top", p.margin_top);
            p.margin_bottom = cm("bottom", p.margin_bottom);
            p.margin_left = cm("left", p.margin_left);
            p.margin_right = cm("right", p.margin_right);
            p.margin_header = cm("header", p.margin_header);
            p.margin_footer = cm("footer", p.margin_footer);
        }
        let fit_to_page = ws
            .child("x:sheetPr")
            .and_then(|s| s.child("x:pageSetUpPr"))
            .is_some_and(|s| on(s, "fitToPage"));
        if let Some(s) = ws.child("x:pageSetup") {
            p.landscape = s.attr("orientation") == Some("landscape");
            if let Some(code) = s.attr("paperSize").and_then(|v| v.parse::<u32>().ok())
                && let Some(paper) = PAPERS.iter().find(|x| x.1 == code)
            {
                p.paper = paper.0.into();
            }
            if let Some(sc) = s.attr("scale").and_then(|v| v.parse().ok()) {
                p.scale = sc;
            }
            if fit_to_page {
                let n = |a: &str| s.attr(a).and_then(|v| v.parse().ok()).unwrap_or(1);
                p.fit_width = Some(n("fitToWidth"));
                p.fit_height = Some(n("fitToHeight"));
            }
        } else if fit_to_page {
            p.fit_width = Some(1);
            p.fit_height = Some(1);
        }
        if let Some(h) = ws.child("x:headerFooter") {
            p.header = h.child("x:oddHeader").map(|e| e.text()).unwrap_or_default();
            p.footer = h.child("x:oddFooter").map(|e| e.text()).unwrap_or_default();
        }
        let breaks = |tag: &str| -> Vec<u32> {
            ws.child(tag)
                .map(|b| {
                    b.children_named("x:brk")
                        .filter_map(|k| k.attr("id")?.parse().ok())
                        .filter(|&i: &u32| i > 0)
                        .collect()
                })
                .unwrap_or_default()
        };
        p.row_breaks = breaks("x:rowBreaks");
        p.col_breaks = breaks("x:colBreaks");
        (p != PageSetup::default()).then_some(p)
    }

    /// `<sheetPr>` content (goes first in the worksheet).
    pub fn xlsx_sheet_pr(&self) -> &'static str {
        if self.fit() {
            r#"<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>"#
        } else {
            ""
        }
    }

    /// printOptions, pageMargins, pageSetup and headerFooter, in schema order.
    pub fn xlsx_print(&self) -> String {
        let mut x = String::new();
        if self.gridlines || self.headings || self.center_h || self.center_v {
            x.push_str("<printOptions");
            for (on, a) in [
                (self.center_h, "horizontalCentered"),
                (self.center_v, "verticalCentered"),
                (self.headings, "headings"),
                (self.gridlines, "gridLines"),
            ] {
                if on {
                    x.push_str(&format!(r#" {a}="1""#));
                }
            }
            x.push_str("/>");
        }
        let inch = |cm: f64| format!("{}", (cm / 2.54 * 1e6).round() / 1e6);
        x.push_str(&format!(
            r#"<pageMargins left="{}" right="{}" top="{}" bottom="{}" header="{}" footer="{}"/>"#,
            inch(self.margin_left),
            inch(self.margin_right),
            inch(self.margin_top),
            inch(self.margin_bottom),
            inch(self.margin_header),
            inch(self.margin_footer)
        ));
        let code = PAPERS
            .iter()
            .find(|p| p.0 == self.paper)
            .map(|p| p.1)
            .unwrap_or(9);
        x.push_str(&format!(r#"<pageSetup paperSize="{code}""#));
        if self.scale != 100 {
            x.push_str(&format!(r#" scale="{}""#, self.scale.clamp(10, 400)));
        }
        if self.fit() {
            x.push_str(&format!(
                r#" fitToWidth="{}" fitToHeight="{}""#,
                self.fit_width.unwrap_or(0),
                self.fit_height.unwrap_or(0)
            ));
        }
        x.push_str(&format!(
            r#" orientation="{}"/>"#,
            if self.landscape {
                "landscape"
            } else {
                "portrait"
            }
        ));
        if !self.header.is_empty() || !self.footer.is_empty() {
            x.push_str("<headerFooter>");
            if !self.header.is_empty() {
                x.push_str(&format!("<oddHeader>{}</oddHeader>", esc(&self.header)));
            }
            if !self.footer.is_empty() {
                x.push_str(&format!("<oddFooter>{}</oddFooter>", esc(&self.footer)));
            }
            x.push_str("</headerFooter>");
        }
        x
    }

    /// rowBreaks and colBreaks (after headerFooter).
    pub fn xlsx_breaks(&self) -> String {
        let mut x = String::new();
        for (tag, list, max) in [
            ("rowBreaks", &self.row_breaks, 16383),
            ("colBreaks", &self.col_breaks, 1048575),
        ] {
            if list.is_empty() {
                continue;
            }
            x.push_str(&format!(
                r#"<{tag} count="{n}" manualBreakCount="{n}">"#,
                n = list.len()
            ));
            for b in list {
                x.push_str(&format!(r#"<brk id="{b}" max="{max}" man="1"/>"#));
            }
            x.push_str(&format!("</{tag}>"));
        }
        x
    }

    // ------------------------------------------------------------- ods --

    /// `style:page-layout-properties` attributes.
    pub fn ods_layout_props(&self) -> String {
        let (w, h) = self.paper_mm();
        let (w, h) = if self.landscape { (h, w) } else { (w, h) };
        let mut print = vec!["charts", "drawings", "objects", "zero-values"];
        if self.gridlines {
            print.push("grid");
        }
        if self.headings {
            print.push("headers");
        }
        let centering = match (self.center_h, self.center_v) {
            (true, true) => "both",
            (true, false) => "horizontal",
            (false, true) => "vertical",
            _ => "none",
        };
        let mut x = format!(
            r#" fo:page-width="{w}mm" fo:page-height="{h}mm" style:print-orientation="{}" fo:margin-top="{}cm" fo:margin-bottom="{}cm" fo:margin-left="{}cm" fo:margin-right="{}cm" style:print="{}" style:table-centering="{centering}" style:writing-mode="lr-tb""#,
            if self.landscape {
                "landscape"
            } else {
                "portrait"
            },
            if self.header.is_empty() {
                self.margin_top
            } else {
                self.margin_header.min(self.margin_top)
            },
            if self.footer.is_empty() {
                self.margin_bottom
            } else {
                self.margin_footer.min(self.margin_bottom)
            },
            self.margin_left,
            self.margin_right,
            print.join(" ")
        );
        if self.fit() {
            x.push_str(&format!(
                r#" style:scale-to-X="{}" style:scale-to-Y="{}""#,
                self.fit_width.unwrap_or(0),
                self.fit_height.unwrap_or(0)
            ));
        } else if self.scale != 100 {
            x.push_str(&format!(r#" style:scale-to="{}%""#, self.scale));
        }
        x
    }

    /// `style:header-style` / `style:footer-style` content: the distance
    /// between the header and the body is the rest of the top margin.
    pub fn ods_hf_style(&self, header: bool) -> String {
        let (on, gap) = if header {
            (
                !self.header.is_empty(),
                self.margin_top - self.margin_header,
            )
        } else {
            (
                !self.footer.is_empty(),
                self.margin_bottom - self.margin_footer,
            )
        };
        let side = if header { "bottom" } else { "top" };
        format!(
            r#"<style:header-footer-properties fo:min-height="0.6cm" fo:margin-{side}="{:.2}cm" style:display="{}"/>"#,
            (gap - 0.6).max(0.1),
            if on { "true" } else { "false" }
        )
    }

    /// `style:header` / `style:footer` of the master page.
    pub fn ods_master(&self) -> String {
        let mut x = String::new();
        for (tag, code) in [("header", &self.header), ("footer", &self.footer)] {
            if code.is_empty() {
                x.push_str(&format!(r#"<style:{tag} style:display="false"/>"#));
                continue;
            }
            let [l, c, r] = split_sections(code);
            x.push_str(&format!("<style:{tag}>"));
            for (region, text) in [("left", l), ("center", c), ("right", r)] {
                x.push_str(&format!(
                    "<style:region-{region}><text:p>{}</text:p></style:region-{region}>",
                    odf_fields(&text)
                ));
            }
            x.push_str(&format!("</style:{tag}>"));
        }
        x
    }

    /// Reads the page layout and master page of an ods sheet.
    pub fn from_ods(layout: Option<&Element>, master: Option<&Element>) -> Option<PageSetup> {
        let mut p = PageSetup::default();
        let props = layout.and_then(|l| l.child("style:page-layout-properties"));
        let cm = |v: Option<&str>| {
            v.and_then(crate::odf::mm)
                .map(|mm| (mm / 10.0 * 100.0).round() / 100.0)
        };
        if let Some(pp) = props {
            p.landscape = pp.attr("style:print-orientation") == Some("landscape");
            let w = cm(pp.attr("fo:page-width")).map(|v| v * 10.0);
            let h = cm(pp.attr("fo:page-height")).map(|v| v * 10.0);
            if let (Some(w), Some(h)) = (w, h) {
                let (a, b) = if w > h { (h, w) } else { (w, h) };
                if let Some(paper) = PAPERS
                    .iter()
                    .find(|x| (x.2 - a).abs() < 2.0 && (x.3 - b).abs() < 2.0)
                {
                    p.paper = paper.0.into();
                }
            }
            let print = pp.attr("style:print").unwrap_or_default();
            p.gridlines = print.split_whitespace().any(|x| x == "grid");
            p.headings = print.split_whitespace().any(|x| x == "headers");
            match pp.attr("style:table-centering") {
                Some("both") => (p.center_h, p.center_v) = (true, true),
                Some("horizontal") => p.center_h = true,
                Some("vertical") => p.center_v = true,
                _ => {}
            }
            if let Some(s) = pp
                .attr("style:scale-to")
                .and_then(|v| v.trim_end_matches('%').parse::<f64>().ok())
            {
                p.scale = s.round() as u32;
            }
            let fx = pp.attr("style:scale-to-X").and_then(|v| v.parse().ok());
            let fy = pp.attr("style:scale-to-Y").and_then(|v| v.parse().ok());
            if fx.is_some() || fy.is_some() {
                p.fit_width = Some(fx.unwrap_or(0));
                p.fit_height = Some(fy.unwrap_or(0));
            }
            if let Some(pages) = pp
                .attr("style:scale-to-pages")
                .and_then(|v| v.parse::<u32>().ok())
                && pages == 1
            {
                p.fit_width = Some(1);
                p.fit_height = Some(1);
            }
            let top = cm(pp.attr("fo:margin-top")).unwrap_or(p.margin_top);
            let bottom = cm(pp.attr("fo:margin-bottom")).unwrap_or(p.margin_bottom);
            p.margin_left = cm(pp.attr("fo:margin-left")).unwrap_or(p.margin_left);
            p.margin_right = cm(pp.attr("fo:margin-right")).unwrap_or(p.margin_right);
            // In ODF the page margin ends where the header starts.
            let hf = |tag: &str| -> f64 {
                layout
                    .and_then(|l| l.child(tag))
                    .and_then(|s| s.child("style:header-footer-properties"))
                    .filter(|x| x.attr("style:display") != Some("false"))
                    .map(|x| {
                        cm(x.attr("fo:min-height")).unwrap_or(0.0)
                            + cm(x.attr("fo:margin-bottom").or(x.attr("fo:margin-top")))
                                .unwrap_or(0.0)
                    })
                    .unwrap_or(0.0)
            };
            let (h, f) = (hf("style:header-style"), hf("style:footer-style"));
            p.margin_top = top + h;
            p.margin_bottom = bottom + f;
            if h > 0.0 {
                p.margin_header = top;
            }
            if f > 0.0 {
                p.margin_footer = bottom;
            }
        }
        if let Some(m) = master {
            for (tag, out) in [
                ("style:header", &mut p.header),
                ("style:footer", &mut p.footer),
            ] {
                let Some(h) = m.child(tag) else { continue };
                if h.attr("style:display") == Some("false") {
                    continue;
                }
                let region = |r: &str| h.child(r).map(excel_codes).unwrap_or_default();
                let (l, c, r) = (
                    region("style:region-left"),
                    region("style:region-center"),
                    region("style:region-right"),
                );
                let single = if l.is_empty() && c.is_empty() && r.is_empty() {
                    excel_codes(h)
                } else {
                    String::new()
                };
                let mut code = String::new();
                for (k, v) in [
                    ("&L", l),
                    ("&C", if single.is_empty() { c } else { single }),
                    ("&R", r),
                ] {
                    if !v.is_empty() {
                        code.push_str(k);
                        code.push_str(&v);
                    }
                }
                *out = code;
            }
        }
        (p != PageSetup::default()).then_some(p)
    }
}

/// Splits `&L…&C…&R…` into its three sections (text without a section is centred).
pub fn split_sections(code: &str) -> [String; 3] {
    let mut out = [String::new(), String::new(), String::new()];
    let mut cur = 1;
    let mut chars = code.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '&' {
            match chars.peek().copied() {
                Some('L' | 'l') => {
                    cur = 0;
                    chars.next();
                    continue;
                }
                Some('C' | 'c') => {
                    cur = 1;
                    chars.next();
                    continue;
                }
                Some('R' | 'r') => {
                    cur = 2;
                    chars.next();
                    continue;
                }
                _ => {}
            }
        }
        out[cur].push(ch);
    }
    out
}

/// One section of Excel codes as ODF text with fields.
fn odf_fields(text: &str) -> String {
    let mut x = String::new();
    let mut chars = text.chars().peekable();
    let mut plain = String::new();
    let flush = |plain: &mut String, x: &mut String| {
        if !plain.is_empty() {
            x.push_str(&esc(plain));
            plain.clear();
        }
    };
    while let Some(ch) = chars.next() {
        if ch != '&' {
            plain.push(ch);
            continue;
        }
        let field = match chars.peek().copied() {
            Some('P' | 'p') => "<text:page-number>1</text:page-number>",
            Some('N' | 'n') => "<text:page-count>1</text:page-count>",
            Some('D' | 'd') => "<text:date/>",
            Some('T' | 't') => "<text:time/>",
            Some('F' | 'f') => r#"<text:file-name text:display="name-and-extension"/>"#,
            Some('Z' | 'z') => r#"<text:file-name text:display="path"/>"#,
            Some('A' | 'a') => "<text:sheet-name/>",
            Some('&') => {
                chars.next();
                plain.push('&');
                continue;
            }
            // Font codes (&"Arial,Bold", &12, &B …) are dropped.
            Some('"') => {
                chars.next();
                for c in chars.by_ref() {
                    if c == '"' {
                        break;
                    }
                }
                continue;
            }
            Some(c) if c.is_ascii_digit() => {
                while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
                    chars.next();
                }
                continue;
            }
            Some(_) => {
                chars.next();
                continue;
            }
            None => continue,
        };
        chars.next();
        flush(&mut plain, &mut x);
        x.push_str(field);
    }
    flush(&mut plain, &mut x);
    x
}

/// ODF header text (paragraphs with fields) as Excel codes.
fn excel_codes(e: &Element) -> String {
    let mut out = String::new();
    let mut first = true;
    for p in e.children_named("text:p") {
        if !first {
            out.push('\n');
        }
        first = false;
        walk(p, &mut out);
    }
    out
}

fn walk(e: &Element, out: &mut String) {
    for n in &e.children {
        match n {
            crate::xml::Node::Text(t) => out.push_str(&t.replace('&', "&&")),
            crate::xml::Node::Element(c) => match c.name.as_str() {
                "text:page-number" => out.push_str("&P"),
                "text:page-count" => out.push_str("&N"),
                "text:date" => out.push_str("&D"),
                "text:time" => out.push_str("&T"),
                "text:sheet-name" => out.push_str("&A"),
                "text:file-name" => out.push_str(if c.attr("text:display") == Some("path") {
                    "&Z"
                } else {
                    "&F"
                }),
                "text:title" => out.push_str("&F"),
                "text:s" => out.push(' '),
                _ => walk(c, out),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_and_fields() {
        let [l, c, r] = split_sections("&LOndura&CSeite &P von &N&R&D");
        assert_eq!(
            (l.as_str(), c.as_str(), r.as_str()),
            ("Ondura", "Seite &P von &N", "&D")
        );
        assert_eq!(split_sections("Nur Mitte")[1], "Nur Mitte");
        assert_eq!(
            odf_fields("Seite &P von &N &&"),
            "Seite <text:page-number>1</text:page-number> von <text:page-count>1</text:page-count> &amp;"
        );
    }
}
