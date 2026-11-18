//! PresentationML (.pptx) ⇄ [`Presentation`] for Nexora Präsentation.
//!
//! Shapes are flattened to absolutely positioned boxes with resolved text
//! formatting (inherited from layout and master), so the editor does not
//! need to know about the placeholder hierarchy. New files are written on
//! a blank layout with explicit positions and formats.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::package::{self, Package, PackageWriter};
use crate::units::{emu_to_px, px_to_emu};
use crate::xml::{Element, esc};
use crate::{Error, Result};

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presentation {
    /// Slide size in CSS pixels (16:9 = 1280 × 720).
    pub width: f64,
    pub height: f64,
    pub slides: Vec<Slide>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
}

impl Default for Presentation {
    fn default() -> Self {
        Self { width: 1280.0, height: 720.0, slides: vec![Slide::default()], title: String::new(), author: String::new() }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// Background picture as `data:` URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_image: Option<String>,
    #[serde(default)]
    pub shapes: Vec<Shape>,
    #[serde(default)]
    pub notes: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    pub id: u32,
    /// `text` (text box), `image`, or a DrawingML preset geometry such as
    /// `rect`, `roundRect`, `ellipse`, `triangle`, `rightArrow`, `line`.
    pub kind: String,
    /// `title`, `body`, `subTitle`, … for placeholders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rotation: f64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub flip_h: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub flip_v: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    /// Outline width in points.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub line_width: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    /// `top`, `middle`, `bottom`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    #[serde(default)]
    pub paragraphs: Vec<Para>,
}

fn is_zero(v: &f64) -> bool {
    v.abs() < 1e-9
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Para {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub level: u8,
    /// Bullet character, or `"#"` for automatic numbering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bullet: Option<String>,
    #[serde(default)]
    pub runs: Vec<Run>,
    /// Font size of an empty paragraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
}

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub text: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub strike: bool,
    /// Points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub presentation: Presentation,
    pub warnings: Vec<String>,
}

// --------------------------------------------------------------- colours --

#[derive(Clone, Default)]
struct Theme {
    colors: HashMap<String, String>,
    major: String,
    minor: String,
}

fn hsl_adjust(hex: &str, lum_mod: f64, lum_off: f64) -> String {
    let v = u32::from_str_radix(hex, 16).unwrap_or(0);
    let (r, g, b) = (((v >> 16) & 255) as f64 / 255.0, ((v >> 8) & 255) as f64 / 255.0, (v & 255) as f64 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let mut l = (max + min) / 2.0;
    let d = max - min;
    let (h, s) = if d.abs() < 1e-9 {
        (0.0, 0.0)
    } else {
        let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
        let h = if max == r {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        } / 6.0;
        (h, s)
    };
    l = (l * lum_mod + lum_off).clamp(0.0, 1.0);
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    let (r, g, b) = if s == 0.0 { (l, l, l) } else { (f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0)) };
    format!("{:02x}{:02x}{:02x}", (r * 255.0).round() as u8, (g * 255.0).round() as u8, (b * 255.0).round() as u8)
}

fn mix(hex: &str, other: u8, amount: f64) -> String {
    let v = u32::from_str_radix(hex, 16).unwrap_or(0);
    let ch = |s: u32| {
        let c = ((v >> s) & 255) as f64;
        (c + (other as f64 - c) * amount).round().clamp(0.0, 255.0) as u8
    };
    format!("{:02x}{:02x}{:02x}", ch(16), ch(8), ch(0))
}

const PRESET: [(&str, &str); 12] = [
    ("black", "000000"),
    ("white", "ffffff"),
    ("red", "ff0000"),
    ("green", "008000"),
    ("blue", "0000ff"),
    ("yellow", "ffff00"),
    ("gray", "808080"),
    ("grey", "808080"),
    ("orange", "ffa500"),
    ("darkBlue", "00008b"),
    ("lightGray", "d3d3d3"),
    ("darkGray", "a9a9a9"),
];

impl Theme {
    /// Resolve the colour child of a fill element (`a:solidFill`, `a:fgClr`, …).
    fn color(&self, fill: Option<&Element>, override_scheme: Option<&str>) -> Option<String> {
        let e = fill?.elements().next()?;
        let base = match e.name.as_str() {
            "a:srgbClr" => e.attr("val")?.to_ascii_lowercase(),
            "a:sysClr" => e.attr("lastClr").unwrap_or("000000").to_ascii_lowercase(),
            "a:prstClr" => PRESET.iter().find(|(n, _)| Some(*n) == e.attr("val")).map(|(_, c)| c.to_string())?,
            "a:schemeClr" => {
                let mut v = e.attr("val")?;
                if v == "phClr" {
                    v = override_scheme?;
                }
                let key = match v {
                    "bg1" => "lt1",
                    "tx1" => "dk1",
                    "bg2" => "lt2",
                    "tx2" => "dk2",
                    other => other,
                };
                self.colors.get(key)?.clone()
            }
            _ => return None,
        };
        let mut c = base;
        let (mut lum_mod, mut lum_off) = (1.0, 0.0);
        for m in e.elements() {
            let val = m.attr("val").and_then(|v| v.parse::<f64>().ok()).unwrap_or(100000.0) / 100000.0;
            match m.name.as_str() {
                "a:lumMod" => lum_mod = val,
                "a:lumOff" => lum_off = val,
                "a:tint" => c = mix(&c, 255, 1.0 - val),
                "a:shade" => c = mix(&c, 0, 1.0 - val),
                _ => {}
            }
        }
        if (lum_mod - 1.0).abs() > 1e-6 || lum_off.abs() > 1e-6 {
            c = hsl_adjust(&c, lum_mod, lum_off);
        }
        Some(format!("#{c}"))
    }

    fn font(&self, typeface: &str) -> String {
        match typeface {
            "+mj-lt" | "+mj-ea" | "+mj-cs" => self.major.clone(),
            "+mn-lt" | "+mn-ea" | "+mn-cs" => self.minor.clone(),
            other => other.to_string(),
        }
    }
}

fn read_theme(e: &Element) -> Theme {
    let mut t = Theme::default();
    if let Some(cs) = e.find("a:clrScheme") {
        for c in cs.elements() {
            let name = c.name.trim_start_matches("a:").to_string();
            let val = c.child("a:srgbClr").and_then(|x| x.attr("val")).or_else(|| c.child("a:sysClr").and_then(|x| x.attr("lastClr"))).unwrap_or("000000");
            t.colors.insert(name, val.to_ascii_lowercase());
        }
    }
    t.major = e.find("a:majorFont").and_then(|f| f.child("a:latin")).and_then(|l| l.attr("typeface")).unwrap_or("Calibri Light").to_string();
    t.minor = e.find("a:minorFont").and_then(|f| f.child("a:latin")).and_then(|l| l.attr("typeface")).unwrap_or("Calibri").to_string();
    t
}

// --------------------------------------------------------------- reading --

/// Text defaults of one list level, accumulated from the inheritance chain.
#[derive(Clone, Default, Debug)]
struct LevelStyle {
    size: Option<f64>,
    bold: Option<bool>,
    italic: Option<bool>,
    color: Option<String>,
    font: Option<String>,
    align: Option<String>,
    bullet: Option<Option<String>>,
}

impl LevelStyle {
    fn merge_from(&mut self, other: &LevelStyle) {
        // `self` wins; fill gaps from `other`.
        if self.size.is_none() {
            self.size = other.size;
        }
        if self.bold.is_none() {
            self.bold = other.bold;
        }
        if self.italic.is_none() {
            self.italic = other.italic;
        }
        if self.color.is_none() {
            self.color = other.color.clone();
        }
        if self.font.is_none() {
            self.font = other.font.clone();
        }
        if self.align.is_none() {
            self.align = other.align.clone();
        }
        if self.bullet.is_none() {
            self.bullet = other.bullet.clone();
        }
    }
}

fn level_style(theme: &Theme, ppr: Option<&Element>) -> LevelStyle {
    let mut s = LevelStyle::default();
    let Some(ppr) = ppr else { return s };
    s.align = ppr.attr("algn").map(align_name);
    if ppr.child("a:buNone").is_some() {
        s.bullet = Some(None);
    } else if let Some(c) = ppr.child("a:buChar") {
        s.bullet = Some(Some(c.attr("char").unwrap_or("•").to_string()));
    } else if ppr.child("a:buAutoNum").is_some() {
        s.bullet = Some(Some("#".into()));
    }
    if let Some(d) = ppr.child("a:defRPr") {
        s.size = d.attr("sz").and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100.0);
        s.bold = d.attr("b").map(|v| v == "1" || v == "true");
        s.italic = d.attr("i").map(|v| v == "1" || v == "true");
        s.color = theme.color(d.child("a:solidFill"), None);
        s.font = d.child("a:latin").and_then(|l| l.attr("typeface")).map(|t| theme.font(t));
    }
    s
}

fn align_name(a: &str) -> String {
    match a {
        "ctr" => "center",
        "r" => "right",
        "just" | "dist" => "justify",
        _ => "left",
    }
    .to_string()
}

/// lstStyle-like element → styles for levels 1..9.
fn list_styles(theme: &Theme, e: Option<&Element>) -> Vec<LevelStyle> {
    (1..=9).map(|l| level_style(theme, e.and_then(|x| x.child(&format!("a:lvl{l}pPr"))))).collect()
}

#[derive(Clone, Default)]
struct PlaceholderInfo {
    xfrm: Option<(f64, f64, f64, f64)>,
    levels: Vec<LevelStyle>,
    anchor: Option<String>,
}

/// Placeholders of a layout or master by (type, idx).
struct Holders {
    by_type: HashMap<String, PlaceholderInfo>,
    by_idx: HashMap<String, PlaceholderInfo>,
}

fn ph_type(nv: Option<&Element>) -> Option<(String, Option<String>)> {
    let ph = nv?.find("p:ph")?;
    Some((ph.attr("type").unwrap_or("body").to_string(), ph.attr("idx").map(String::from)))
}

fn xfrm_of(sp_pr: Option<&Element>) -> Option<(f64, f64, f64, f64)> {
    let x = sp_pr?.child("a:xfrm")?;
    let off = x.child("a:off")?;
    let ext = x.child("a:ext")?;
    let n = |e: &Element, a: &str| e.attr(a).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    Some((n(off, "x"), n(off, "y"), n(ext, "cx"), n(ext, "cy")))
}

fn holders(theme: &Theme, tree: Option<&Element>) -> Holders {
    let mut h = Holders { by_type: HashMap::new(), by_idx: HashMap::new() };
    let Some(tree) = tree else { return h };
    let mut sps = Vec::new();
    tree.find_all("p:sp", &mut sps);
    for sp in sps {
        let Some((t, idx)) = ph_type(sp.child("p:nvSpPr")) else { continue };
        let body = sp.child("p:txBody");
        let info = PlaceholderInfo {
            xfrm: xfrm_of(sp.child("p:spPr")),
            levels: list_styles(theme, body.and_then(|b| b.child("a:lstStyle"))),
            anchor: body.and_then(|b| b.child("a:bodyPr")).and_then(|b| b.attr("anchor")).map(String::from),
        };
        if let Some(i) = idx {
            h.by_idx.insert(i, info.clone());
        }
        h.by_type.entry(t).or_insert(info);
    }
    h
}

impl Holders {
    fn get(&self, t: &str, idx: Option<&str>) -> Option<&PlaceholderInfo> {
        idx.and_then(|i| self.by_idx.get(i)).filter(|_| t == "body" || t == "obj" || t == "pic" || t == "tbl" || t == "chart").or_else(|| self.by_type.get(t)).or_else(|| idx.and_then(|i| self.by_idx.get(i)))
    }
}

struct SlideCtx<'a> {
    pkg: &'a Package,
    theme: &'a Theme,
    rels: HashMap<String, package::Relationship>,
    layout: &'a Holders,
    master: &'a Holders,
    master_styles: &'a [Vec<LevelStyle>; 3],
    warnings: &'a mut BTreeSet<String>,
    next_id: u32,
}

const EMU: f64 = 9525.0;

/// Group transform: maps child coordinates into slide coordinates.
#[derive(Clone, Copy)]
struct Xf {
    ox: f64,
    oy: f64,
    sx: f64,
    sy: f64,
    cx: f64,
    cy: f64,
}

impl Xf {
    const ID: Xf = Xf { ox: 0.0, oy: 0.0, sx: 1.0, sy: 1.0, cx: 0.0, cy: 0.0 };
    fn apply(&self, (x, y, w, h): (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
        (self.ox + (x - self.cx) * self.sx, self.oy + (y - self.cy) * self.sy, w * self.sx, h * self.sy)
    }
}

impl SlideCtx<'_> {
    fn image(&self, blip: Option<&Element>) -> Option<String> {
        let id = blip?.attr("r:embed")?;
        let rel = self.rels.get(id)?;
        let mime = package::mime_for(&rel.target);
        if matches!(mime, "image/x-emf" | "image/x-wmf" | "image/tiff" | "application/octet-stream") {
            return None;
        }
        Some(package::data_url(mime, self.pkg.part(&rel.target)?))
    }

    fn tree(&mut self, tree: &Element, xf: Xf, out: &mut Vec<Shape>) {
        for e in tree.elements() {
            match e.name.as_str() {
                "p:sp" | "p:cxnSp" => {
                    if let Some(s) = self.shape(e, xf) {
                        out.push(s);
                    }
                }
                "p:pic" => {
                    if let Some(s) = self.picture(e, xf) {
                        out.push(s);
                    }
                }
                "p:grpSp" => {
                    let gx = e.child("p:grpSpPr").and_then(|g| g.child("a:xfrm"));
                    let inner = match gx {
                        Some(x) => {
                            let n = |c: &str, a: &str| x.child(c).and_then(|e| e.attr(a)).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
                            let (ox, oy, ex, ey) = (n("a:off", "x"), n("a:off", "y"), n("a:ext", "cx"), n("a:ext", "cy"));
                            let (cx, cy, cex, cey) = (n("a:chOff", "x"), n("a:chOff", "y"), n("a:chExt", "cx"), n("a:chExt", "cy"));
                            let (sx, sy) = (if cex > 0.0 { ex / cex } else { 1.0 }, if cey > 0.0 { ey / cey } else { 1.0 });
                            // Compose with the parent transform.
                            let (pox, poy, _, _) = xf.apply((ox, oy, 0.0, 0.0));
                            Xf { ox: pox, oy: poy, sx: sx * xf.sx, sy: sy * xf.sy, cx, cy }
                        }
                        None => xf,
                    };
                    self.tree(e, inner, out);
                }
                "p:graphicFrame" => {
                    let uri = e.find("a:graphicData").and_then(|g| g.attr("uri")).unwrap_or_default();
                    if uri.ends_with("/table") {
                        if let Some(s) = self.table(e, xf) {
                            out.push(s);
                        }
                        self.warnings.insert("Tabellen auf Folien werden als Textfeld übernommen.".into());
                    } else if uri.contains("chart") {
                        self.warnings.insert("Diagramme werden nicht angezeigt.".into());
                    } else if uri.contains("diagram") {
                        self.warnings.insert("SmartArt-Grafiken werden nicht angezeigt.".into());
                    } else {
                        self.warnings.insert("Eingebettete Objekte werden nicht angezeigt.".into());
                    }
                }
                "mc:AlternateContent" => {
                    if let Some(c) = e.child("mc:Fallback").or_else(|| e.child("mc:Choice")) {
                        self.tree(c, xf, out);
                    }
                }
                _ => {}
            }
        }
    }

    fn base(&mut self, nv: Option<&Element>, sp_pr: Option<&Element>, xf: Xf) -> Option<(Shape, Option<PlaceholderInfo>, String)> {
        let ph = ph_type(nv);
        let info = ph.as_ref().and_then(|(t, i)| {
            let l = self.layout.get(t, i.as_deref()).cloned();
            let m = self.master.get(t, i.as_deref()).cloned();
            match (l, m) {
                (Some(mut l), Some(m)) => {
                    if l.xfrm.is_none() {
                        l.xfrm = m.xfrm;
                    }
                    if l.anchor.is_none() {
                        l.anchor = m.anchor.clone();
                    }
                    for (a, b) in l.levels.iter_mut().zip(m.levels.iter()) {
                        a.merge_from(b);
                    }
                    Some(l)
                }
                (l, m) => l.or(m),
            }
        });
        let raw = xfrm_of(sp_pr).or_else(|| info.as_ref().and_then(|i| i.xfrm))?;
        let (x, y, w, h) = xf.apply(raw);
        let x_el = sp_pr.and_then(|s| s.child("a:xfrm"));
        self.next_id += 1;
        let shape = Shape {
            id: nv.and_then(|n| n.find("p:cNvPr")).and_then(|c| c.attr("id")).and_then(|v| v.parse().ok()).unwrap_or(self.next_id),
            kind: "rect".into(),
            placeholder: ph.as_ref().map(|(t, _)| t.clone()),
            x: (x / EMU * 10.0).round() / 10.0,
            y: (y / EMU * 10.0).round() / 10.0,
            w: (w / EMU * 10.0).round() / 10.0,
            h: (h / EMU * 10.0).round() / 10.0,
            rotation: x_el.and_then(|x| x.attr("rot")).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 60000.0).unwrap_or(0.0),
            flip_h: x_el.and_then(|x| x.attr("flipH")).is_some_and(|v| v == "1"),
            flip_v: x_el.and_then(|x| x.attr("flipV")).is_some_and(|v| v == "1"),
            ..Default::default()
        };
        let kind = ph.map(|(t, _)| t).unwrap_or_default();
        Some((shape, info, kind))
    }

    fn fill_and_line(&self, s: &mut Shape, sp_pr: Option<&Element>, style: Option<&Element>) {
        let sp = sp_pr;
        let style_color = |name: &str| style.and_then(|st| st.child(name)).and_then(|r| self.theme.color(Some(r), None));
        match sp.and_then(|p| p.elements().find(|e| matches!(e.name.as_str(), "a:solidFill" | "a:noFill" | "a:gradFill" | "a:pattFill" | "a:blipFill"))) {
            Some(f) if f.name == "a:solidFill" => s.fill = self.theme.color(Some(f), None),
            Some(f) if f.name == "a:gradFill" => s.fill = f.find("a:gs").and_then(|g| self.theme.color(Some(g), None)),
            Some(f) if f.name == "a:pattFill" => s.fill = self.theme.color(f.child("a:fgClr"), None),
            Some(f) if f.name == "a:blipFill" => s.src = self.image(f.child("a:blip")),
            Some(_) => {}
            None => {
                if style.and_then(|st| st.child("a:fillRef")).and_then(|r| r.attr("idx")).is_some_and(|i| i != "0") {
                    s.fill = style_color("a:fillRef");
                }
            }
        }
        let ln = sp.and_then(|p| p.child("a:ln"));
        match ln {
            Some(l) if l.child("a:noFill").is_some() => {}
            Some(l) => {
                s.line = self.theme.color(l.child("a:solidFill"), None).or_else(|| style_color("a:lnRef"));
                s.line_width = l.attr("w").and_then(|v| v.parse::<f64>().ok()).map(|v| v / 12700.0).unwrap_or(if s.line.is_some() { 0.75 } else { 0.0 });
            }
            None => {
                if style.and_then(|st| st.child("a:lnRef")).and_then(|r| r.attr("idx")).is_some_and(|i| i != "0") {
                    s.line = style_color("a:lnRef");
                    s.line_width = 1.0;
                }
            }
        }
        if s.line.is_none() {
            s.line_width = 0.0;
        }
    }

    fn shape(&mut self, e: &Element, xf: Xf) -> Option<Shape> {
        let nv = e.child("p:nvSpPr").or_else(|| e.child("p:nvCxnSpPr"));
        let sp_pr = e.child("p:spPr");
        let (mut s, info, ph) = self.base(nv, sp_pr, xf)?;
        let geom = sp_pr.and_then(|p| p.child("a:prstGeom")).and_then(|g| g.attr("prst")).map(String::from);
        if sp_pr.and_then(|p| p.child("a:custGeom")).is_some() {
            self.warnings.insert("Freihandformen werden als Rechteck angezeigt.".into());
        }
        let style = e.child("p:style");
        self.fill_and_line(&mut s, sp_pr, style);
        let is_text_box = nv.and_then(|n| n.child("p:cNvSpPr")).and_then(|c| c.attr("txBox")).is_some_and(|v| v == "1");
        s.kind = if e.name == "p:cxnSp" {
            "line".into()
        } else if is_text_box || (s.placeholder.is_some() && s.fill.is_none() && s.line.is_none()) {
            "text".into()
        } else {
            geom.unwrap_or_else(|| "rect".into())
        };
        if s.src.is_some() && s.kind != "text" {
            s.kind = "image".into();
        }
        // Text
        if let Some(body) = e.child("p:txBody") {
            let bp = body.child("a:bodyPr");
            s.anchor = bp
                .and_then(|b| b.attr("anchor"))
                .map(String::from)
                .or_else(|| info.as_ref().and_then(|i| i.anchor.clone()))
                .map(|a| match a.as_str() {
                    "ctr" => "middle".to_string(),
                    "b" => "bottom".to_string(),
                    _ => "top".to_string(),
                });
            let scale = bp.and_then(|b| b.child("a:normAutofit")).and_then(|n| n.attr("fontScale")).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100000.0).unwrap_or(1.0);
            let own = list_styles(self.theme, body.child("a:lstStyle"));
            let master_idx = match ph.as_str() {
                "title" | "ctrTitle" => 0,
                "" => 2,
                _ => 1,
            };
            let font_ref = style.and_then(|st| st.child("a:fontRef")).and_then(|f| self.theme.color(Some(f), None));
            for p in body.children_named("a:p") {
                let ppr = p.child("a:pPr");
                let level: usize = ppr.and_then(|x| x.attr("lvl")).and_then(|v| v.parse().ok()).unwrap_or(0).min(8);
                let mut ls = level_style(self.theme, ppr);
                ls.merge_from(&own[level]);
                if let Some(i) = &info {
                    ls.merge_from(&i.levels[level]);
                }
                ls.merge_from(&self.master_styles[master_idx][level]);
                let mut para = Para { align: ls.align.clone().filter(|a| a != "left"), level: level as u8, bullet: if ph.is_empty() && ls.bullet.is_none() { None } else { ls.bullet.clone().flatten() }, ..Default::default() };
                for r in p.elements() {
                    let (text, rpr) = match r.name.as_str() {
                        "a:r" | "a:fld" => (r.child("a:t").map(|t| t.text()).unwrap_or_default(), r.child("a:rPr")),
                        "a:br" => ("\n".to_string(), r.child("a:rPr")),
                        _ => continue,
                    };
                    let flag = |a: &str| rpr.and_then(|x| x.attr(a)).map(|v| v == "1" || v == "true");
                    let size = rpr.and_then(|x| x.attr("sz")).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100.0).or(ls.size).unwrap_or(18.0);
                    let run = Run {
                        text,
                        bold: flag("b").or(ls.bold).unwrap_or(false),
                        italic: flag("i").or(ls.italic).unwrap_or(false),
                        underline: rpr.and_then(|x| x.attr("u")).is_some_and(|u| u != "none"),
                        strike: rpr.and_then(|x| x.attr("strike")).is_some_and(|u| u != "noStrike"),
                        size: Some(((size * scale) * 10.0).round() / 10.0),
                        color: self.theme.color(rpr.and_then(|x| x.child("a:solidFill")), None).or_else(|| font_ref.clone()).or_else(|| ls.color.clone()),
                        font: rpr.and_then(|x| x.child("a:latin")).and_then(|l| l.attr("typeface")).map(|t| self.theme.font(t)).or_else(|| ls.font.clone()),
                    };
                    para.runs.push(run);
                }
                if para.runs.is_empty() {
                    let end = p.child("a:endParaRPr").and_then(|x| x.attr("sz")).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100.0);
                    para.size = Some((end.or(ls.size).unwrap_or(18.0) * scale * 10.0).round() / 10.0);
                }
                s.paragraphs.push(para);
            }
            // Empty placeholders show prompt text only while editing in PowerPoint.
            if s.placeholder.is_some() && s.paragraphs.iter().all(|p| p.runs.iter().all(|r| r.text.trim().is_empty())) && s.kind == "text" {
                return None;
            }
        } else if s.kind == "text" {
            return None;
        }
        if s.placeholder.as_deref().is_some_and(|p| matches!(p, "dt" | "ftr" | "sldNum")) {
            return None;
        }
        Some(s)
    }

    fn picture(&mut self, e: &Element, xf: Xf) -> Option<Shape> {
        let nv = e.child("p:nvPicPr");
        let sp_pr = e.child("p:spPr");
        let (mut s, _, _) = self.base(nv, sp_pr, xf)?;
        s.kind = "image".into();
        s.src = self.image(e.child("p:blipFill").and_then(|b| b.child("a:blip")));
        if s.src.is_none() {
            self.warnings.insert("Einige Bilder (EMF/WMF/verknüpft) können nicht angezeigt werden.".into());
            return None;
        }
        self.fill_and_line(&mut s, sp_pr, e.child("p:style"));
        if e.find("a:videoFile").is_some() || e.find("a:audioFile").is_some() {
            self.warnings.insert("Audio und Video werden nicht abgespielt.".into());
        }
        Some(s)
    }

    /// Tables become a text box with one tab-separated line per row.
    fn table(&mut self, e: &Element, xf: Xf) -> Option<Shape> {
        let x = e.child("p:xfrm")?;
        let n = |c: &str, a: &str| x.child(c).and_then(|e| e.attr(a)).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        let (px, py, pw, ph) = xf.apply((n("a:off", "x"), n("a:off", "y"), n("a:ext", "cx"), n("a:ext", "cy")));
        let mut rows = Vec::new();
        e.find_all("a:tr", &mut rows);
        self.next_id += 1;
        let paragraphs = rows
            .iter()
            .map(|tr| Para {
                runs: vec![Run { text: tr.children_named("a:tc").map(|tc| tc.text()).collect::<Vec<_>>().join("\t"), size: Some(14.0), ..Default::default() }],
                ..Default::default()
            })
            .collect();
        Some(Shape { id: self.next_id, kind: "text".into(), x: px / EMU, y: py / EMU, w: pw / EMU, h: ph / EMU, line: Some("#a0a0a0".into()), line_width: 0.75, paragraphs, ..Default::default() })
    }

    fn background(&self, csld: Option<&Element>) -> Option<(Option<String>, Option<String>)> {
        let bg = csld?.child("p:bg")?;
        if let Some(pr) = bg.child("p:bgPr") {
            if let Some(f) = pr.child("a:solidFill") {
                return Some((self.theme.color(Some(f), None), None));
            }
            if let Some(g) = pr.child("a:gradFill") {
                return Some((g.find("a:gs").and_then(|s| self.theme.color(Some(s), None)), None));
            }
            if let Some(b) = pr.child("a:blipFill") {
                return Some((None, self.image(b.child("a:blip"))));
            }
        }
        if let Some(r) = bg.child("p:bgRef") {
            return Some((self.theme.color(Some(r), None), None));
        }
        None
    }
}

fn master_text_styles(theme: &Theme, master: &Element) -> [Vec<LevelStyle>; 3] {
    let tx = master.child("p:txStyles");
    [
        list_styles(theme, tx.and_then(|t| t.child("p:titleStyle"))),
        list_styles(theme, tx.and_then(|t| t.child("p:bodyStyle"))),
        list_styles(theme, tx.and_then(|t| t.child("p:otherStyle"))),
    ]
}

/// Parse a .pptx file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let pkg = Package::open(bytes)?;
    let main = pkg
        .main_part("officeDocument")?
        .filter(|p| pkg.has(p))
        .or_else(|| pkg.has("ppt/presentation.xml").then(|| "ppt/presentation.xml".to_string()))
        .ok_or_else(|| Error::Format("Keine PowerPoint-Präsentation gefunden.".into()))?;
    let pres = pkg.xml(&main)?.ok_or_else(|| Error::Format("Präsentation fehlt".into()))?;
    let rels: HashMap<String, package::Relationship> = pkg.rels(&main)?.into_iter().map(|r| (r.id.clone(), r)).collect();
    let mut warnings = BTreeSet::new();
    let (mut width, mut height) = (1280.0, 720.0);
    if let Some(sz) = pres.child("p:sldSz") {
        width = sz.attr("cx").and_then(|v| v.parse::<f64>().ok()).map(emu_to_px).unwrap_or(width);
        height = sz.attr("cy").and_then(|v| v.parse::<f64>().ok()).map(emu_to_px).unwrap_or(height);
    }
    let mut slides = Vec::new();
    let mut theme_cache: HashMap<String, Theme> = HashMap::new();
    for id in pres.child("p:sldIdLst").map(|l| l.children_named("p:sldId").cloned().collect::<Vec<_>>()).unwrap_or_default() {
        let Some(target) = id.attr("r:id").and_then(|r| rels.get(r)).map(|r| r.target.clone()) else { continue };
        let Some(sx) = pkg.xml(&target)? else { continue };
        let srels: HashMap<String, package::Relationship> = pkg.rels(&target)?.into_iter().map(|r| (r.id.clone(), r)).collect();
        let layout_path = srels.values().find(|r| r.kind == "slideLayout").map(|r| r.target.clone());
        let layout = layout_path.as_ref().and_then(|p| pkg.xml(p).ok().flatten());
        let master_path = layout_path.as_ref().and_then(|p| pkg.rels(p).ok()).and_then(|r| r.into_iter().find(|x| x.kind == "slideMaster")).map(|r| r.target);
        let master = master_path.as_ref().and_then(|p| pkg.xml(p).ok().flatten());
        let theme = master_path
            .as_ref()
            .and_then(|mp| {
                let t = pkg.rels(mp).ok()?.into_iter().find(|x| x.kind == "theme")?.target;
                if let Some(th) = theme_cache.get(&t) {
                    return Some(th.clone());
                }
                let th = read_theme(&pkg.xml(&t).ok()??);
                theme_cache.insert(t, th.clone());
                Some(th)
            })
            .unwrap_or_default();
        let lh = holders(&theme, layout.as_ref().and_then(|l| l.find("p:spTree")));
        let mh = holders(&theme, master.as_ref().and_then(|m| m.find("p:spTree")));
        let mstyles = master.as_ref().map(|m| master_text_styles(&theme, m)).unwrap_or_else(|| [Vec::new(), Vec::new(), Vec::new()]);
        let mstyles = if mstyles[0].is_empty() { [vec![LevelStyle::default(); 9], vec![LevelStyle::default(); 9], vec![LevelStyle::default(); 9]] } else { mstyles };
        let mut ctx = SlideCtx { pkg: &pkg, theme: &theme, rels: srels.clone(), layout: &lh, master: &mh, master_styles: &mstyles, warnings: &mut warnings, next_id: 1000 };
        let mut slide = Slide { hidden: sx.attr("show") == Some("0"), ..Default::default() };
        // Background: slide, then layout, then master.
        let bg = ctx.background(sx.child("p:cSld"));
        let bg = bg.or_else(|| {
            let l = layout.as_ref()?;
            ctx.rels = layout_path.as_ref().and_then(|p| pkg.rels(p).ok()).unwrap_or_default().into_iter().map(|r| (r.id.clone(), r)).collect();
            ctx.background(l.child("p:cSld"))
        });
        let bg = bg.or_else(|| {
            let m = master.as_ref()?;
            ctx.rels = master_path.as_ref().and_then(|p| pkg.rels(p).ok()).unwrap_or_default().into_iter().map(|r| (r.id.clone(), r)).collect();
            ctx.background(m.child("p:cSld"))
        });
        if let Some((c, img)) = bg {
            slide.background = c;
            slide.background_image = img;
        }
        // Pictures and shapes of the master/layout (logos, decorations) are
        // drawn below the slide content unless the slide hides them.
        // Pictures and shapes of the master/layout (logos, decorations) are
        // drawn below the slide content unless the slide or layout hides them.
        let layout_hides_master = layout.as_ref().is_some_and(|l| l.attr("showMasterSp") == Some("0"));
        if sx.attr("showMasterSp") != Some("0") {
            let parts = [(&master, &master_path, !layout_hides_master), (&layout, &layout_path, true)];
            for (part, path, show) in parts {
                let (Some(x), Some(p), true) = (part, path, show) else { continue };
                ctx.rels = pkg.rels(p).unwrap_or_default().into_iter().map(|r| (r.id.clone(), r)).collect();
                let Some(tree) = x.find("p:spTree") else { continue };
                for e in tree.elements() {
                    // Only decorations, not placeholders.
                    if e.elements().next().and_then(|n| n.find("p:ph")).is_some() {
                        continue;
                    }
                    let one = Element { name: "tree".into(), attrs: Vec::new(), children: vec![crate::xml::Node::Element(e.clone())] };
                    ctx.tree(&one, Xf::ID, &mut slide.shapes);
                }
            }
        }
        ctx.rels = srels.clone();
        if let Some(tree) = sx.find("p:spTree") {
            ctx.tree(tree, Xf::ID, &mut slide.shapes);
        }
        // Notes
        if let Some(notes) = srels.values().find(|r| r.kind == "notesSlide").and_then(|r| pkg.xml(&r.target).ok().flatten()) {
            let mut sps = Vec::new();
            notes.find_all("p:sp", &mut sps);
            for sp in sps {
                if ph_type(sp.child("p:nvSpPr")).is_some_and(|(t, _)| t == "body") {
                    slide.notes = sp.children_named("p:txBody").flat_map(|b| b.children_named("a:p").map(|p| p.text()).collect::<Vec<_>>()).collect::<Vec<_>>().join("\n");
                }
            }
        }
        if sx.find("p:timing").is_some_and(|t| t.find("p:par").is_some()) {
            warnings.insert("Animationen werden nicht übernommen.".into());
        }
        if sx.child("p:transition").is_some() {
            warnings.insert("Folienübergänge werden durch eine Überblendung ersetzt.".into());
        }
        slides.push(slide);
    }
    if slides.is_empty() {
        slides.push(Slide::default());
    }
    let (title, author) = package::read_core(&pkg);
    Ok(Loaded { presentation: Presentation { width, height, slides, title, author }, warnings: warnings.into_iter().collect() })
}

// --------------------------------------------------------------- writing --

const T_MASTER: &str = include_str!("../templates/pptx/slideMaster1.xml");
const T_LAYOUT: &str = include_str!("../templates/pptx/slideLayout1.xml");
const T_THEME: &str = include_str!("../templates/pptx/theme1.xml");
const T_THEME2: &str = include_str!("../templates/pptx/theme2.xml");
const T_NOTES_MASTER: &str = include_str!("../templates/pptx/notesMaster1.xml");
const T_PRES_PROPS: &str = include_str!("../templates/pptx/presProps.xml");
const T_VIEW_PROPS: &str = include_str!("../templates/pptx/viewProps.xml");
const T_TABLE_STYLES: &str = include_str!("../templates/pptx/tableStyles.xml");
const T_DEFAULT_TEXT: &str = include_str!("../templates/pptx/defaultTextStyle.xml");

const NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CT: &str = "application/vnd.openxmlformats-officedocument.presentationml.";

fn color_xml(c: &str) -> String {
    format!(r#"<a:solidFill><a:srgbClr val="{}"/></a:solidFill>"#, esc(c.trim_start_matches('#').to_ascii_uppercase().as_str()))
}

const GEOMETRIES: [&str; 24] = [
    "rect", "roundRect", "ellipse", "triangle", "rtTriangle", "diamond", "pentagon", "hexagon", "octagon", "parallelogram", "trapezoid", "star5", "star6", "rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "chevron", "homePlate", "plus", "heart", "cloud", "line",
];

fn shape_xml(s: &Shape, n: u32, rels: &mut Vec<(String, String, String, bool)>, pkg: &mut PackageWriter, media: &mut usize) -> String {
    let xfrm = |tag: &str| {
        let mut attrs = String::new();
        if !is_zero(&s.rotation) {
            attrs.push_str(&format!(r#" rot="{}""#, (s.rotation * 60000.0).round() as i64));
        }
        if s.flip_h {
            attrs.push_str(r#" flipH="1""#);
        }
        if s.flip_v {
            attrs.push_str(r#" flipV="1""#);
        }
        format!(r#"<{tag}{attrs}><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></{tag}>"#, px_to_emu(s.x), px_to_emu(s.y), px_to_emu(s.w.max(0.0)), px_to_emu(s.h.max(0.0)))
    };
    let line = match (&s.line, s.line_width) {
        (Some(c), w) => format!(r#"<a:ln w="{}">{}</a:ln>"#, ((if w > 0.0 { w } else { 0.75 }) * 12700.0).round() as i64, color_xml(c)),
        _ => "<a:ln><a:noFill/></a:ln>".into(),
    };
    let name = esc(&format!("{} {n}", match s.kind.as_str() {
        "text" => "Textfeld",
        "image" => "Bild",
        _ => "Form",
    }));
    if s.kind == "image" {
        let Some((mime, data)) = s.src.as_deref().and_then(package::parse_data_url) else { return String::new() };
        *media += 1;
        let file = format!("media/image{}.{}", media, package::ext_for(&mime));
        pkg.add_media(&format!("ppt/{file}"), &mime, data);
        let rid = format!("rId{}", rels.len() + 2);
        rels.push((rid.clone(), format!("{REL}image"), format!("../{file}"), false));
        return format!(
            r#"<p:pic><p:nvPicPr><p:cNvPr id="{n}" name="{name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{}</p:spPr></p:pic>"#,
            xfrm("a:xfrm"),
            if s.line.is_some() { line.clone() } else { String::new() }
        );
    }
    let text_box = s.kind == "text";
    let geom = if text_box { "rect" } else if GEOMETRIES.contains(&s.kind.as_str()) { s.kind.as_str() } else { "rect" };
    let fill = s.fill.as_deref().map(color_xml).unwrap_or_else(|| "<a:noFill/>".into());
    let anchor = match s.anchor.as_deref() {
        Some("middle") => "ctr",
        Some("bottom") => "b",
        _ => "t",
    };
    let mut body = format!(r#"<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="{anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>"#);
    if s.paragraphs.is_empty() {
        body.push_str(r#"<a:p><a:endParaRPr lang="de-DE"/></a:p>"#);
    }
    for p in &s.paragraphs {
        body.push_str("<a:p><a:pPr");
        if p.level > 0 {
            body.push_str(&format!(r#" lvl="{}""#, p.level.min(8)));
        }
        let indent = 342900i64;
        if p.bullet.is_some() {
            body.push_str(&format!(r#" marL="{}" indent="-{indent}""#, indent + p.level as i64 * 457200));
        } else if p.level > 0 {
            body.push_str(&format!(r#" marL="{}" indent="0""#, p.level as i64 * 457200));
        }
        match p.align.as_deref() {
            Some("center") => body.push_str(r#" algn="ctr""#),
            Some("right") => body.push_str(r#" algn="r""#),
            Some("justify") => body.push_str(r#" algn="just""#),
            _ => body.push_str(r#" algn="l""#),
        }
        body.push('>');
        match p.bullet.as_deref() {
            Some("#") => body.push_str(r#"<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>"#),
            Some(ch) => body.push_str(&format!(r#"<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="{}"/>"#, esc(ch))),
            None => body.push_str("<a:buNone/>"),
        }
        body.push_str("</a:pPr>");
        for r in &p.runs {
            for (i, line) in r.text.split('\n').enumerate() {
                let rpr = run_props(r);
                if i > 0 {
                    body.push_str(&format!("<a:br>{rpr}</a:br>"));
                }
                if !line.is_empty() {
                    body.push_str(&format!(r#"<a:r>{rpr}<a:t>{}</a:t></a:r>"#, esc(line)));
                }
            }
        }
        let end_size = p.size.or_else(|| p.runs.last().and_then(|r| r.size)).unwrap_or(18.0);
        body.push_str(&format!(r#"<a:endParaRPr lang="de-DE" sz="{}" dirty="0"/></a:p>"#, (end_size * 100.0).round() as i64));
    }
    body.push_str("</p:txBody>");
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{n}" name="{name}"/><p:cNvSpPr{}/><p:nvPr/></p:nvSpPr><p:spPr>{}<a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom>{fill}{line}</p:spPr>{body}</p:sp>"#,
        if text_box { r#" txBox="1""# } else { "" },
        xfrm("a:xfrm"),
    )
}

fn run_props(r: &Run) -> String {
    let mut s = String::from(r#"<a:rPr lang="de-DE""#);
    if let Some(sz) = r.size {
        s.push_str(&format!(r#" sz="{}""#, (sz * 100.0).round() as i64));
    }
    if r.bold {
        s.push_str(r#" b="1""#);
    }
    if r.italic {
        s.push_str(r#" i="1""#);
    }
    if r.underline {
        s.push_str(r#" u="sng""#);
    }
    if r.strike {
        s.push_str(r#" strike="sngStrike""#);
    }
    s.push_str(r#" dirty="0">"#);
    if let Some(c) = &r.color {
        s.push_str(&color_xml(c));
    }
    if let Some(f) = &r.font {
        s.push_str(&format!(r#"<a:latin typeface="{0}"/><a:cs typeface="{0}"/>"#, esc(f)));
    }
    s.push_str("</a:rPr>");
    s
}

/// Serialise a presentation as .pptx.
pub fn write(p: &Presentation) -> Result<Vec<u8>> {
    let mut pkg = PackageWriter::new();
    let mut media = 0usize;
    let mut pres_rels = vec![
        ("rId1".to_string(), format!("{REL}slideMaster"), "slideMasters/slideMaster1.xml".to_string(), false),
        ("rId2".to_string(), format!("{REL}notesMaster"), "notesMasters/notesMaster1.xml".to_string(), false),
        ("rId3".to_string(), format!("{REL}presProps"), "presProps.xml".to_string(), false),
        ("rId4".to_string(), format!("{REL}viewProps"), "viewProps.xml".to_string(), false),
        ("rId5".to_string(), format!("{REL}theme"), "theme/theme1.xml".to_string(), false),
        ("rId6".to_string(), format!("{REL}tableStyles"), "tableStyles.xml".to_string(), false),
    ];
    let mut sld_ids = String::new();
    for (i, slide) in p.slides.iter().enumerate() {
        let n = i + 1;
        let mut rels = vec![("rId1".to_string(), format!("{REL}slideLayout"), "../slideLayouts/slideLayout1.xml".to_string(), false)];
        let mut tree = String::from(r#"<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>"#);
        for (k, s) in slide.shapes.iter().enumerate() {
            tree.push_str(&shape_xml(s, k as u32 + 2, &mut rels, &mut pkg, &mut media));
        }
        let bg = if let Some(img) = slide.background_image.as_deref().and_then(package::parse_data_url) {
            media += 1;
            let file = format!("media/image{}.{}", media, package::ext_for(&img.0));
            pkg.add_media(&format!("ppt/{file}"), &img.0, img.1);
            let rid = format!("rId{}", rels.len() + 2);
            rels.push((rid.clone(), format!("{REL}image"), format!("../{file}"), false));
            format!(r#"<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>"#)
        } else if let Some(c) = &slide.background {
            format!(r#"<p:bg><p:bgPr>{}<a:effectLst/></p:bgPr></p:bg>"#, color_xml(c))
        } else {
            String::new()
        };
        if !slide.notes.trim().is_empty() {
            let notes_rels = vec![
                ("rId1".to_string(), format!("{REL}notesMaster"), "../notesMasters/notesMaster1.xml".to_string(), false),
                ("rId2".to_string(), format!("{REL}slide"), format!("../slides/slide{n}.xml"), false),
            ];
            let paras: String = slide.notes.split('\n').map(|l| if l.is_empty() { r#"<a:p><a:endParaRPr lang="de-DE"/></a:p>"#.to_string() } else { format!(r#"<a:p><a:r><a:rPr lang="de-DE" dirty="0"/><a:t>{}</a:t></a:r></a:p>"#, esc(l)) }).collect();
            pkg.add(
                &format!("ppt/notesSlides/notesSlide{n}.xml"),
                Some(&format!("{CT}notesSlide+xml")),
                format!(
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes {NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Folienbildplatzhalter 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notizenplatzhalter 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
                ),
            );
            pkg.add(&format!("ppt/notesSlides/_rels/notesSlide{n}.xml.rels"), None, package::rels_xml(&notes_rels));
            rels.push((format!("rId{}", rels.len() + 2), format!("{REL}notesSlide"), format!("../notesSlides/notesSlide{n}.xml"), false));
        }
        pkg.add(
            &format!("ppt/slides/slide{n}.xml"),
            Some(&format!("{CT}slide+xml")),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}{}><p:cSld>{bg}<p:spTree>{tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
                if slide.hidden { r#" show="0""# } else { "" }
            ),
        );
        pkg.add(&format!("ppt/slides/_rels/slide{n}.xml.rels"), None, package::rels_xml(&rels));
        let rid = format!("rId{}", 100 + n);
        sld_ids.push_str(&format!(r#"<p:sldId id="{}" r:id="{rid}"/>"#, 255 + n));
        pres_rels.push((rid, format!("{REL}slide"), format!("slides/slide{n}.xml"), false));
    }
    let (cx, cy) = (px_to_emu(p.width), px_to_emu(p.height));
    let ratio = p.width / p.height.max(1.0);
    let size_type = if (ratio - 16.0 / 9.0).abs() < 0.01 { "" } else if (ratio - 4.0 / 3.0).abs() < 0.01 { r#" type="screen4x3""# } else { r#" type="custom""# };
    pkg.add(
        "ppt/presentation.xml",
        Some(&format!("{CT}presentation.main+xml")),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation {NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>{sld_ids}</p:sldIdLst><p:sldSz cx="{cx}" cy="{cy}"{size_type}/><p:notesSz cx="6858000" cy="9144000"/>{T_DEFAULT_TEXT}</p:presentation>"#
        ),
    );
    pkg.add("ppt/_rels/presentation.xml.rels", None, package::rels_xml(&pres_rels));
    pkg.add("ppt/slideMasters/slideMaster1.xml", Some(&format!("{CT}slideMaster+xml")), T_MASTER);
    pkg.add(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        None,
        package::rels_xml(&[
            ("rId1".into(), format!("{REL}slideLayout"), "../slideLayouts/slideLayout1.xml".into(), false),
            ("rId2".into(), format!("{REL}theme"), "../theme/theme1.xml".into(), false),
        ]),
    );
    pkg.add("ppt/slideLayouts/slideLayout1.xml", Some(&format!("{CT}slideLayout+xml")), T_LAYOUT);
    pkg.add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", None, package::rels_xml(&[("rId1".into(), format!("{REL}slideMaster"), "../slideMasters/slideMaster1.xml".into(), false)]));
    pkg.add("ppt/notesMasters/notesMaster1.xml", Some(&format!("{CT}notesMaster+xml")), T_NOTES_MASTER);
    pkg.add("ppt/notesMasters/_rels/notesMaster1.xml.rels", None, package::rels_xml(&[("rId1".into(), format!("{REL}theme"), "../theme/theme2.xml".into(), false)]));
    pkg.add("ppt/theme/theme1.xml", Some("application/vnd.openxmlformats-officedocument.theme+xml"), T_THEME);
    pkg.add("ppt/theme/theme2.xml", Some("application/vnd.openxmlformats-officedocument.theme+xml"), T_THEME2);
    pkg.add("ppt/presProps.xml", Some(&format!("{CT}presProps+xml")), T_PRES_PROPS);
    pkg.add("ppt/viewProps.xml", Some(&format!("{CT}viewProps+xml")), T_VIEW_PROPS);
    pkg.add("ppt/tableStyles.xml", Some(&format!("{CT}tableStyles+xml")), T_TABLE_STYLES);
    pkg.add("docProps/core.xml", Some("application/vnd.openxmlformats-package.core-properties+xml"), package::core_xml(&p.title, &p.author));
    pkg.add(
        "_rels/.rels",
        None,
        package::rels_xml(&[
            ("rId1".into(), package::REL_OFFICE_DOCUMENT.into(), "ppt/presentation.xml".into(), false),
            ("rId2".into(), package::REL_CORE.into(), "docProps/core.xml".into(), false),
        ]),
    );
    pkg.finish()
}
