//! DrawingML charts (`c:chartSpace`) shared by spreadsheets and slides.
//!
//! Only the common 2-D chart families are modelled: column, bar, line,
//! area, pie, doughnut and scatter. Series keep both their source
//! references (spreadsheets) and cached values (slides, and the caches
//! written for other applications).

use serde::{Deserialize, Serialize};

use crate::xml::{Element, esc};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    /// `column`, `bar`, `line`, `area`, `pie`, `doughnut` or `scatter`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub series: Vec<Series>,
    /// Legend position (`r`, `b`, `t`, `l`); `None` hides the legend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stacked: bool,
    /// Show data labels.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub labels: bool,
    /// Waterfall: indexes of the points that are totals.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subtotals: Vec<u32>,
    /// Histogram: number of bins (automatic if neither is set).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin_width: Option<f64>,
}

/// Chart types stored as Excel 2016 "chartex" parts.
pub fn is_chartex(kind: &str) -> bool {
    matches!(kind, "waterfall" | "histogram" | "funnel")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Reference of the name cell, e.g. `Tabelle1!$B$1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cat_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val_ref: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub values: Vec<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Type of this series in a combination chart (`column`, `line`, `area`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Plotted on the secondary value axis.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secondary: bool,
}

const KINDS: [(&str, &str); 10] = [
    ("c:barChart", "column"),
    ("c:bar3DChart", "column"),
    ("c:lineChart", "line"),
    ("c:line3DChart", "line"),
    ("c:areaChart", "area"),
    ("c:area3DChart", "area"),
    ("c:pieChart", "pie"),
    ("c:pie3DChart", "pie"),
    ("c:doughnutChart", "doughnut"),
    ("c:scatterChart", "scatter"),
];

fn rich_text(e: &Element) -> String {
    let mut runs = Vec::new();
    e.find_all("a:t", &mut runs);
    runs.iter().map(|t| t.text()).collect()
}

fn str_cache(e: &Element) -> (Option<String>, Vec<String>) {
    // <c:strRef>/<c:numRef> with a cache, or literal <c:strLit>/<c:numLit>/<c:v>.
    let reference = e
        .find("c:f")
        .map(|f| f.text().trim().to_string())
        .filter(|f| !f.is_empty());
    let mut pts: Vec<(usize, String)> = Vec::new();
    let mut found = Vec::new();
    e.find_all("c:pt", &mut found);
    for pt in found {
        let idx = pt
            .attr("idx")
            .and_then(|v| v.parse().ok())
            .unwrap_or(pts.len());
        pts.push((idx, pt.child("c:v").map(|v| v.text()).unwrap_or_default()));
    }
    let count = e
        .find("c:ptCount")
        .and_then(|c| c.attr("val"))
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0)
        .max(pts.iter().map(|(i, _)| i + 1).max().unwrap_or(0));
    let mut out = vec![String::new(); count.min(100_000)];
    for (i, v) in pts {
        if let Some(slot) = out.get_mut(i) {
            *slot = v;
        }
    }
    if out.is_empty()
        && let Some(v) = e.child("c:v")
    {
        out.push(v.text());
    }
    (reference, out)
}

fn solid_color(sp: Option<&Element>) -> Option<String> {
    let fill = sp?
        .child("a:solidFill")
        .or_else(|| sp?.find("a:ln").and_then(|l| l.child("a:solidFill")))?;
    fill.child("a:srgbClr")
        .and_then(|c| c.attr("val"))
        .map(|v| format!("#{}", v.to_ascii_lowercase()))
}

/// Parse a `c:chartSpace` root. Returns the chart and whether parts of it
/// (combination charts, secondary axes) were dropped.
pub fn read(root: &Element) -> Option<(Chart, bool)> {
    let chart = root.child("c:chart")?;
    let plot = chart.child("c:plotArea")?;
    let groups: Vec<(&Element, &str)> = plot
        .elements()
        .filter_map(|e| {
            KINDS
                .iter()
                .find(|(t, _)| *t == e.name)
                .map(|(_, k)| (e, *k))
        })
        .collect();
    let (first, mut kind) = *groups.first()?;
    if first.name.starts_with("c:bar")
        && first.child("c:barDir").and_then(|d| d.attr("val")) == Some("bar")
    {
        kind = "bar";
    }
    let grouping = first
        .child("c:grouping")
        .and_then(|g| g.attr("val"))
        .unwrap_or("clustered");
    let stacked = matches!(grouping, "stacked" | "percentStacked");
    let mut series = Vec::new();
    // Value axes on the right are secondary axes.
    let secondary_axes: Vec<String> = plot
        .children_named("c:valAx")
        .filter(|a| {
            a.child("c:axPos").and_then(|p| p.attr("val")) == Some("r")
                || a.child("c:crosses").and_then(|c| c.attr("val")) == Some("max")
        })
        .filter_map(|a| {
            a.child("c:axId")
                .and_then(|i| i.attr("val"))
                .map(String::from)
        })
        .collect();
    let combo = groups.len() > 1;
    for (g, gk) in &groups {
        let on_secondary = g.children_named("c:axId").any(|a| {
            a.attr("val")
                .is_some_and(|v| secondary_axes.iter().any(|x| x == v))
        });
        let gkind =
            if *gk == "column" && g.child("c:barDir").and_then(|d| d.attr("val")) == Some("bar") {
                "bar"
            } else {
                gk
            };
        for ser in g.children_named("c:ser") {
            let mut s = Series {
                kind: combo.then(|| gkind.to_string()),
                secondary: on_secondary,
                ..Default::default()
            };
            if let Some(tx) = ser.child("c:tx") {
                let (r, vals) = str_cache(tx);
                s.name_ref = r;
                s.name = vals.into_iter().next().filter(|v| !v.is_empty());
            }
            if let Some(cat) = ser.child("c:cat").or_else(|| ser.child("c:xVal")) {
                let (r, vals) = str_cache(cat);
                s.cat_ref = r;
                s.categories = vals;
            }
            if let Some(val) = ser.child("c:val").or_else(|| ser.child("c:yVal")) {
                let (r, vals) = str_cache(val);
                s.val_ref = r;
                s.values = vals.iter().map(|v| v.trim().parse::<f64>().ok()).collect();
            }
            s.color = solid_color(ser.child("c:spPr"));
            series.push(s);
        }
    }
    let title = chart.child("c:title").and_then(|t| {
        let tx = t.child("c:tx")?;
        if let Some(rich) = tx.child("c:rich") {
            return Some(rich_text(rich));
        }
        str_cache(tx).1.into_iter().next()
    });
    let auto_deleted = chart
        .child("c:autoTitleDeleted")
        .and_then(|a| a.attr("val"))
        .is_some_and(|v| v == "1" || v == "true");
    let title = match title {
        Some(t) => Some(t),
        // Excel shows the single series name as an automatic title.
        None if !auto_deleted && chart.child("c:title").is_some() && series.len() == 1 => {
            series[0].name.clone()
        }
        None => None,
    };
    let legend = chart.child("c:legend").map(|l| {
        l.child("c:legendPos")
            .and_then(|p| p.attr("val"))
            .unwrap_or("r")
            .to_string()
    });
    let labels = first
        .child("c:dLbls")
        .and_then(|d| d.child("c:showVal"))
        .and_then(|v| v.attr("val"))
        .is_some_and(|v| v == "1" || v == "true");
    Some((
        Chart {
            kind: if combo { "combo".into() } else { kind.into() },
            title,
            series,
            legend,
            stacked,
            labels,
            ..Default::default()
        },
        false,
    ))
}

fn str_ref(reference: &Option<String>, values: &[String]) -> String {
    let mut s = String::new();
    s.push_str(&format!(r#"<c:ptCount val="{}"/>"#, values.len()));
    for (i, v) in values.iter().enumerate() {
        s.push_str(&format!(r#"<c:pt idx="{i}"><c:v>{}</c:v></c:pt>"#, esc(v)));
    }
    match reference {
        Some(f) => format!(
            "<c:strRef><c:f>{}</c:f><c:strCache>{s}</c:strCache></c:strRef>",
            esc(f)
        ),
        None => format!("<c:strLit>{s}</c:strLit>"),
    }
}

fn num_ref(reference: &Option<String>, values: &[Option<f64>]) -> String {
    let mut s = String::from("<c:formatCode>General</c:formatCode>");
    s.push_str(&format!(r#"<c:ptCount val="{}"/>"#, values.len()));
    for (i, v) in values.iter().enumerate() {
        if let Some(v) = v.filter(|v| v.is_finite()) {
            s.push_str(&format!(r#"<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>"#));
        }
    }
    match reference {
        Some(f) => format!(
            "<c:numRef><c:f>{}</c:f><c:numCache>{s}</c:numCache></c:numRef>",
            esc(f)
        ),
        None => format!("<c:numLit>{s}</c:numLit>"),
    }
}

fn rich(text: &str, size: u32) -> String {
    format!(
        r#"<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="{size}" b="0"/></a:pPr><a:r><a:rPr lang="de-DE" sz="{size}" b="0"/><a:t>{}</a:t></a:r></a:p></c:rich></c:tx>"#,
        esc(text)
    )
}

/// Default series colours (Office theme accents).
pub const PALETTE: [&str; 6] = [
    "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47",
];

/// One chart group (`c:barChart`, `c:lineChart`, …) with the given series.
fn write_group(x: &mut String, chart: &Chart, kind: &str, secondary: bool, members: &[usize]) {
    let pie = matches!(kind, "pie" | "doughnut");
    let scatter = kind == "scatter";
    let tag = match kind {
        "line" => "c:lineChart",
        "area" => "c:areaChart",
        "pie" => "c:pieChart",
        "doughnut" => "c:doughnutChart",
        "scatter" => "c:scatterChart",
        _ => "c:barChart",
    };
    x.push_str(&format!("<{tag}>"));
    match kind {
        "bar" | "column" => x.push_str(&format!(
            r#"<c:barDir val="{}"/><c:grouping val="{}"/><c:varyColors val="0"/>"#,
            if kind == "bar" { "bar" } else { "col" },
            if chart.stacked {
                "stacked"
            } else {
                "clustered"
            }
        )),
        "line" | "area" => x.push_str(&format!(
            r#"<c:grouping val="{}"/><c:varyColors val="0"/>"#,
            if chart.stacked { "stacked" } else { "standard" }
        )),
        "scatter" => x.push_str(r#"<c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>"#),
        _ => x.push_str(r#"<c:varyColors val="1"/>"#),
    }
    for &i in members {
        let s = &chart.series[i];
        x.push_str(&format!(r#"<c:ser><c:idx val="{i}"/><c:order val="{i}"/>"#));
        if s.name.is_some() || s.name_ref.is_some() {
            let name = s.name.clone().unwrap_or_default();
            match &s.name_ref {
                Some(_) => x.push_str(&format!("<c:tx>{}</c:tx>", str_ref(&s.name_ref, &[name]))),
                None => x.push_str(&format!("<c:tx><c:v>{}</c:v></c:tx>", esc(&name))),
            }
        }
        if !pie {
            let color = s
                .color
                .clone()
                .unwrap_or_else(|| PALETTE[i % PALETTE.len()].to_string());
            let hex = color.trim_start_matches('#').to_ascii_uppercase();
            if matches!(kind, "line" | "scatter") {
                x.push_str(&format!(r#"<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="{hex}"/></a:solidFill><a:round/></a:ln></c:spPr>"#));
                x.push_str(r#"<c:marker><c:symbol val="none"/></c:marker>"#);
            } else {
                x.push_str(&format!(
                    r#"<c:spPr><a:solidFill><a:srgbClr val="{hex}"/></a:solidFill></c:spPr>"#
                ));
            }
            if matches!(kind, "bar" | "column") {
                x.push_str(r#"<c:invertIfNegative val="0"/>"#);
            }
        } else {
            for p in 0..s.values.len() {
                let hex = PALETTE[p % PALETTE.len()]
                    .trim_start_matches('#')
                    .to_ascii_uppercase();
                x.push_str(&format!(r#"<c:dPt><c:idx val="{p}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="{hex}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>"#));
            }
        }
        if chart.labels {
            x.push_str(r#"<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>"#);
        }
        if scatter {
            let xs: Vec<Option<f64>> = s.categories.iter().map(|c| c.trim().parse().ok()).collect();
            x.push_str(&format!(
                "<c:xVal>{}</c:xVal><c:yVal>{}</c:yVal><c:smooth val=\"0\"/>",
                num_ref(&s.cat_ref, &xs),
                num_ref(&s.val_ref, &s.values)
            ));
        } else {
            if !s.categories.is_empty() || s.cat_ref.is_some() {
                x.push_str(&format!(
                    "<c:cat>{}</c:cat>",
                    str_ref(&s.cat_ref, &s.categories)
                ));
            }
            x.push_str(&format!(
                "<c:val>{}</c:val>",
                num_ref(&s.val_ref, &s.values)
            ));
            if kind == "line" {
                x.push_str(r#"<c:smooth val="0"/>"#);
            }
        }
        x.push_str("</c:ser>");
    }
    match kind {
        "bar" | "column" => {
            x.push_str(r#"<c:gapWidth val="150"/>"#);
            if chart.stacked {
                x.push_str(r#"<c:overlap val="100"/>"#);
            }
        }
        "line" => x.push_str(r#"<c:marker val="1"/>"#),
        "pie" => x.push_str(r#"<c:firstSliceAng val="0"/>"#),
        "doughnut" => x.push_str(r#"<c:firstSliceAng val="0"/><c:holeSize val="50"/>"#),
        _ => {}
    }
    if !pie {
        x.push_str(if secondary {
            r#"<c:axId val="500000003"/><c:axId val="500000004"/>"#
        } else {
            r#"<c:axId val="500000001"/><c:axId val="500000002"/>"#
        });
    }
    x.push_str(&format!("</{tag}>"));
}

/// Serialise a chart as a `c:chartSpace` part. `embedded` is the
/// relationship id of an embedded workbook (slides), if any.
pub fn write(chart: &Chart, embedded: Option<&str>) -> String {
    let kind = chart.kind.as_str();
    let pie = matches!(kind, "pie" | "doughnut");
    let scatter = kind == "scatter";
    let mut x = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="de-DE"/><c:roundedCorners val="0"/><c:chart>"#,
    );
    match &chart.title {
        Some(t) if !t.is_empty() => x.push_str(&format!(
            r#"<c:title>{}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>"#,
            rich(t, 1400)
        )),
        _ => x.push_str(r#"<c:autoTitleDeleted val="1"/>"#),
    }
    x.push_str("<c:plotArea><c:layout/>");
    // One chart group per series type and axis (combination charts).
    let mut groups: Vec<(String, bool, Vec<usize>)> = Vec::new();
    for (i, s) in chart.series.iter().enumerate() {
        let k = if kind == "combo" {
            s.kind.clone().unwrap_or_else(|| {
                if i == 0 {
                    "column".into()
                } else {
                    "line".into()
                }
            })
        } else {
            kind.to_string()
        };
        let sec = s.secondary && !pie && !scatter;
        match groups.iter_mut().find(|g| g.0 == k && g.1 == sec) {
            Some(g) => g.2.push(i),
            None => groups.push((k, sec, vec![i])),
        }
    }
    if groups.is_empty() {
        groups.push((
            if kind == "combo" {
                "column".into()
            } else {
                kind.to_string()
            },
            false,
            vec![],
        ));
    }
    let any_secondary = groups.iter().any(|g| g.1);
    for (gkind, secondary, members) in &groups {
        write_group(&mut x, chart, gkind, *secondary, members);
    }
    if !pie {
        let first = groups[0].0.as_str();
        let (cat_pos, val_pos) = if first == "bar" {
            ("l", "b")
        } else {
            ("b", "l")
        };
        let common = r#"<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="de-DE"/></a:p></c:txPr>"#;
        if scatter {
            x.push_str(&format!(r#"<c:valAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/>{common}<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>"#));
        } else {
            x.push_str(&format!(
                r#"<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="{cat_pos}"/><c:numFmt formatCode="General" sourceLinked="1"/>{common}<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>"#
            ));
        }
        x.push_str(&format!(
            r#"<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="{val_pos}"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="1"/>{common}<c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="{}"/></c:valAx>"#,
            if scatter { "midCat" } else { "between" }
        ));
        if any_secondary {
            // Secondary value axis on the right with a hidden category axis.
            x.push_str(&format!(
                r#"<c:valAx><c:axId val="500000004"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="General" sourceLinked="1"/>{common}<c:crossAx val="500000003"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx><c:catAx><c:axId val="500000003"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000004"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>"#
            ));
        }
    }
    x.push_str("</c:plotArea>");
    if let Some(pos) = &chart.legend {
        x.push_str(&format!(
            r#"<c:legend><c:legendPos val="{}"/><c:overlay val="0"/></c:legend>"#,
            esc(pos)
        ));
    }
    x.push_str(r#"<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>"#);
    x.push_str(r#"<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="de-DE"/></a:p></c:txPr>"#);
    if let Some(id) = embedded {
        x.push_str(&format!(
            r#"<c:externalData r:id="{id}"><c:autoUpdate val="0"/></c:externalData>"#
        ));
    }
    x.push_str("</c:chartSpace>");
    x
}
