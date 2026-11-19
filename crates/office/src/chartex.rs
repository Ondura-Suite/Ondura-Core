//! Excel 2016 chart types stored as "chartex" parts (`cx:chartSpace`):
//! waterfall, histogram, funnel, treemap, sunburst and box & whisker.

use crate::chart::{Chart, Series};
use crate::xml::{Element, esc};

pub(crate) const REL: &str = "http://schemas.microsoft.com/office/2014/relationships/chartEx";
pub(crate) const CONTENT_TYPE: &str = "application/vnd.ms-office.chartex+xml";
pub(crate) const URI: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";

fn text_of(e: &Element) -> String {
    let mut ts = Vec::new();
    e.find_all("t", &mut ts);
    if ts.is_empty() {
        e.find_all("a:t", &mut ts);
    }
    ts.iter().map(|t| t.text()).collect()
}

/// Points of a `cx:lvl` (by index).
fn points(lvl: &Element) -> Vec<String> {
    let n: usize = lvl
        .attr("ptCount")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut out = vec![String::new(); n.min(100_000)];
    for p in lvl.children_named("pt") {
        let i: usize = p.attr("idx").and_then(|v| v.parse().ok()).unwrap_or(0);
        if i >= out.len() {
            out.resize(i + 1, String::new());
        }
        out[i] = p.text();
    }
    out
}

/// Reads a `cx:chartSpace` (local names, the namespace is not known to the
/// XML reader). Unsupported layouts give `None`.
pub(crate) fn read(root: &Element) -> Option<Chart> {
    let chart = root.child("chart")?;
    let plot = chart.find("plotAreaRegion")?;
    let ser = plot.child("series")?;
    let kind = match ser.attr("layoutId")? {
        "waterfall" => "waterfall",
        "clusteredColumn" => "histogram",
        "funnel" => "funnel",
        "treemap" => "treemap",
        "sunburst" => "sunburst",
        "boxWhisker" => "boxWhisker",
        _ => return None,
    };
    let data_id = ser
        .child("dataId")
        .and_then(|d| d.attr("val"))
        .unwrap_or("0");
    let data = root
        .child("chartData")?
        .children_named("data")
        .find(|d| d.attr("id").unwrap_or("0") == data_id)?;
    if kind == "boxWhisker" {
        return read_box(root, chart, plot);
    }
    let mut s = Series::default();
    for dim in data.elements() {
        let f = dim.child("f").map(|f| f.text());
        let lvl = dim.child("lvl");
        match (dim.name.as_str(), dim.attr("type")) {
            ("strDim" | "numDim", Some("cat")) => {
                s.cat_ref = f;
                // Hierarchies list the leaf level first, then the parents.
                let lvls: Vec<Vec<String>> = dim.children_named("lvl").map(points).collect();
                s.categories = lvls.first().cloned().unwrap_or_default();
                if lvls.len() > 1 {
                    let n = lvls[0].len();
                    s.levels = (0..n)
                        .map(|i| {
                            lvls.iter()
                                .rev()
                                .map(|l| l.get(i).cloned().unwrap_or_default())
                                .collect()
                        })
                        .collect();
                }
            }
            ("numDim", Some("val" | "size")) => {
                s.val_ref = f;
                s.values = lvl
                    .map(points)
                    .unwrap_or_default()
                    .iter()
                    .map(|v| v.trim().parse().ok())
                    .collect();
            }
            _ => {}
        }
    }
    if let Some(tx) = ser.child("tx").and_then(|t| t.child("txData")) {
        s.name_ref = tx.child("f").map(|f| f.text());
        s.name = tx.child("v").map(|v| v.text());
    }
    let layout = ser.child("layoutPr");
    let subtotals = layout
        .and_then(|l| l.child("subtotals"))
        .map(|st| {
            st.children_named("idx")
                .filter_map(|i| i.attr("val")?.parse().ok())
                .collect()
        })
        .unwrap_or_default();
    let binning = layout.and_then(|l| l.child("binning"));
    let bin_count = binning
        .and_then(|b| b.child("binCount"))
        .and_then(|c| c.attr("val"))
        .and_then(|v| v.parse().ok());
    let bin_width = binning
        .and_then(|b| b.child("binSize"))
        .and_then(|c| c.attr("val"))
        .and_then(|v| v.parse().ok());
    let title = chart.child("title").map(text_of).filter(|t| !t.is_empty());
    let legend = chart
        .child("legend")
        .map(|l| l.attr("pos").unwrap_or("t").to_string());
    let labels = ser
        .child("dataLabels")
        .and_then(|d| d.child("visibility"))
        .and_then(|v| v.attr("value"))
        .is_some_and(|v| v == "1");
    Some(Chart {
        kind: kind.into(),
        title,
        series: vec![s],
        legend,
        labels,
        subtotals,
        bin_count,
        bin_width,
        ..Default::default()
    })
}

/// Box & whisker charts: one series per data block.
fn read_box(root: &Element, chart: &Element, plot: &Element) -> Option<Chart> {
    let datas: Vec<&Element> = root.child("chartData")?.children_named("data").collect();
    let mut series = Vec::new();
    for ser in plot.children_named("series") {
        let id = ser
            .child("dataId")
            .and_then(|d| d.attr("val"))
            .unwrap_or("0");
        let Some(data) = datas.iter().find(|d| d.attr("id").unwrap_or("0") == id) else {
            continue;
        };
        let mut s = Series::default();
        for dim in data.elements() {
            let f = dim.child("f").map(|f| f.text());
            let lvl = dim.child("lvl");
            match (dim.name.as_str(), dim.attr("type")) {
                ("strDim" | "numDim", Some("cat")) => {
                    s.cat_ref = f;
                    s.categories = lvl.map(points).unwrap_or_default();
                }
                ("numDim", Some("val")) => {
                    s.val_ref = f;
                    s.values = lvl
                        .map(points)
                        .unwrap_or_default()
                        .iter()
                        .map(|v| v.trim().parse().ok())
                        .collect();
                }
                _ => {}
            }
        }
        if let Some(tx) = ser.child("tx").and_then(|t| t.child("txData")) {
            s.name_ref = tx.child("f").map(|f| f.text());
            s.name = tx.child("v").map(|v| v.text());
        }
        series.push(s);
    }
    if series.is_empty() {
        return None;
    }
    Some(Chart {
        kind: "boxWhisker".into(),
        title: chart.child("title").map(text_of).filter(|t| !t.is_empty()),
        series,
        legend: chart
            .child("legend")
            .map(|l| l.attr("pos").unwrap_or("t").to_string()),
        ..Default::default()
    })
}

fn lvl(values: &[String], numeric: bool) -> String {
    let mut x = format!(
        r#"<cx:lvl ptCount="{}"{}>"#,
        values.len(),
        if numeric {
            r#" formatCode="General""#
        } else {
            ""
        }
    );
    for (i, v) in values.iter().enumerate() {
        if !v.is_empty() {
            x.push_str(&format!(r#"<cx:pt idx="{i}">{}</cx:pt>"#, esc(v)));
        }
    }
    x.push_str("</cx:lvl>");
    x
}

/// Writes a `cx:chartSpace` part for a waterfall, histogram or funnel chart.
pub(crate) fn write(chart: &Chart) -> String {
    if chart.kind == "boxWhisker" {
        return write_box(chart);
    }
    let s = chart.series.first().cloned().unwrap_or_default();
    let layout = match chart.kind.as_str() {
        "histogram" => "clusteredColumn",
        "funnel" => "funnel",
        "treemap" => "treemap",
        "sunburst" => "sunburst",
        _ => "waterfall",
    };
    let hierarchy = chart.kind == "treemap" || chart.kind == "sunburst";
    let mut x = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chartData><cx:data id="0">"#,
    );
    if chart.kind != "histogram" {
        x.push_str(r#"<cx:strDim type="cat">"#);
        if let Some(f) = &s.cat_ref {
            x.push_str(&format!("<cx:f>{}</cx:f>", esc(f)));
        }
        if hierarchy && !s.levels.is_empty() {
            let depth = s.levels.iter().map(Vec::len).max().unwrap_or(1);
            for d in (0..depth).rev() {
                let level: Vec<String> = s
                    .levels
                    .iter()
                    .map(|p| p.get(d).cloned().unwrap_or_default())
                    .collect();
                x.push_str(&lvl(&level, false));
            }
        } else {
            x.push_str(&lvl(&s.categories, false));
        }
        x.push_str("</cx:strDim>");
    }
    x.push_str(if hierarchy {
        r#"<cx:numDim type="size">"#
    } else {
        r#"<cx:numDim type="val">"#
    });
    if let Some(f) = &s.val_ref {
        x.push_str(&format!("<cx:f>{}</cx:f>", esc(f)));
    }
    let vals: Vec<String> = s
        .values
        .iter()
        .map(|v| v.map(|n| n.to_string()).unwrap_or_default())
        .collect();
    x.push_str(&lvl(&vals, true));
    x.push_str("</cx:numDim></cx:data></cx:chartData><cx:chart>");
    if let Some(t) = chart.title.as_ref().filter(|t| !t.is_empty()) {
        x.push_str(&format!(
            r#"<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>{0}</cx:v></cx:txData></cx:tx><cx:txPr><a:bodyPr spcFirstLastPara="1" vertOverflow="ellipsis" horzOverflow="overflow" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr algn="ctr"><a:defRPr sz="1400"/></a:pPr><a:r><a:rPr lang="de-DE" sz="1400"/><a:t>{0}</a:t></a:r></a:p></cx:txPr></cx:title>"#,
            esc(t)
        ));
    }
    x.push_str(&format!(r#"<cx:plotArea><cx:plotAreaRegion><cx:series layoutId="{layout}" uniqueId="{{6F1E0C0A-0000-4E58-9000-000000000001}}">"#));
    if s.name.is_some() || s.name_ref.is_some() {
        x.push_str("<cx:tx><cx:txData>");
        if let Some(f) = &s.name_ref {
            x.push_str(&format!("<cx:f>{}</cx:f>", esc(f)));
        }
        x.push_str(&format!(
            "<cx:v>{}</cx:v></cx:txData></cx:tx>",
            esc(s.name.as_deref().unwrap_or(""))
        ));
    }
    if hierarchy {
        x.push_str(r#"<cx:dataLabels pos="inEnd"><cx:visibility seriesName="0" categoryName="1" value="0"/></cx:dataLabels>"#);
    } else if chart.labels || chart.kind == "waterfall" || chart.kind == "funnel" {
        x.push_str(&format!(r#"<cx:dataLabels pos="{}"><cx:visibility seriesName="0" categoryName="0" value="{}"/></cx:dataLabels>"#, if chart.kind == "funnel" { "ctr" } else { "outEnd" }, u8::from(chart.labels || chart.kind != "histogram")));
    }
    x.push_str(r#"<cx:dataId val="0"/>"#);
    match chart.kind.as_str() {
        "waterfall" => {
            x.push_str("<cx:layoutPr>");
            if !chart.subtotals.is_empty() {
                x.push_str("<cx:subtotals>");
                for i in &chart.subtotals {
                    x.push_str(&format!(r#"<cx:idx val="{i}"/>"#));
                }
                x.push_str("</cx:subtotals>");
            }
            x.push_str("</cx:layoutPr>");
        }
        "histogram" => {
            x.push_str(r#"<cx:layoutPr><cx:binning intervalClosed="r">"#);
            if let Some(w) = chart.bin_width {
                x.push_str(&format!(r#"<cx:binSize val="{w}"/>"#));
            } else if let Some(c) = chart.bin_count {
                x.push_str(&format!(r#"<cx:binCount val="{c}"/>"#));
            }
            x.push_str("</cx:binning></cx:layoutPr>");
        }
        "treemap" => {
            x.push_str(r#"<cx:layoutPr><cx:parentLabelLayout val="overlapping"/></cx:layoutPr>"#)
        }
        _ => {}
    }
    x.push_str("</cx:series></cx:plotAreaRegion>");
    if hierarchy {
        // No axes.
    } else if chart.kind == "funnel" {
        x.push_str(r#"<cx:axis id="0"><cx:catScaling gapWidth="0.06"/><cx:tickLabels/></cx:axis>"#);
    } else {
        x.push_str(&format!(r#"<cx:axis id="0"><cx:catScaling gapWidth="{}"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>"#, if chart.kind == "histogram" { "0" } else { "0.5" }));
    }
    x.push_str("</cx:plotArea>");
    if let Some(pos) = &chart.legend {
        x.push_str(&format!(
            r#"<cx:legend pos="{}" align="ctr" overlay="0"/>"#,
            esc(pos)
        ));
    }
    x.push_str("</cx:chart></cx:chartSpace>");
    x
}

fn write_box(chart: &Chart) -> String {
    let mut x = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chartData>"#,
    );
    for (i, s) in chart.series.iter().enumerate() {
        x.push_str(&format!(r#"<cx:data id="{i}">"#));
        if s.cat_ref.is_some() || !s.categories.is_empty() {
            x.push_str(r#"<cx:strDim type="cat">"#);
            if let Some(f) = &s.cat_ref {
                x.push_str(&format!("<cx:f>{}</cx:f>", esc(f)));
            }
            x.push_str(&lvl(&s.categories, false));
            x.push_str("</cx:strDim>");
        }
        x.push_str(r#"<cx:numDim type="val">"#);
        if let Some(f) = &s.val_ref {
            x.push_str(&format!("<cx:f>{}</cx:f>", esc(f)));
        }
        let vals: Vec<String> = s
            .values
            .iter()
            .map(|v| v.map(|n| n.to_string()).unwrap_or_default())
            .collect();
        x.push_str(&lvl(&vals, true));
        x.push_str("</cx:numDim></cx:data>");
    }
    x.push_str("</cx:chartData><cx:chart>");
    if let Some(t) = chart.title.as_ref().filter(|t| !t.is_empty()) {
        x.push_str(&format!(
            r#"<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>{0}</cx:v></cx:txData></cx:tx></cx:title>"#,
            esc(t)
        ));
    }
    x.push_str("<cx:plotArea><cx:plotAreaRegion>");
    for (i, s) in chart.series.iter().enumerate() {
        x.push_str(&format!(
            r#"<cx:series layoutId="boxWhisker" uniqueId="{{6F1E0C0A-0000-4E58-9000-0000000001{i:02}}}">"#
        ));
        if s.name.is_some() || s.name_ref.is_some() {
            x.push_str("<cx:tx><cx:txData>");
            if let Some(f) = &s.name_ref {
                x.push_str(&format!("<cx:f>{}</cx:f>", esc(f)));
            }
            x.push_str(&format!(
                "<cx:v>{}</cx:v></cx:txData></cx:tx>",
                esc(s.name.as_deref().unwrap_or(""))
            ));
        }
        x.push_str(&format!(
            r#"<cx:dataId val="{i}"/><cx:layoutPr><cx:visibility meanLine="0" meanMarker="1" nonoutliers="0" outliers="1"/><cx:statistics quartileMethod="exclusive"/></cx:layoutPr></cx:series>"#
        ));
    }
    x.push_str(r#"</cx:plotAreaRegion><cx:axis id="0"><cx:catScaling gapWidth="1"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis></cx:plotArea>"#);
    if let Some(pos) = &chart.legend {
        x.push_str(&format!(
            r#"<cx:legend pos="{}" align="ctr" overlay="0"/>"#,
            esc(pos)
        ));
    }
    x.push_str("</cx:chart></cx:chartSpace>");
    x
}

/// Drawing anchor body for a chartex graphic frame (with a fallback shape
/// for applications without chartex support).
pub(crate) fn frame_xml(id: u32, rid: &str, w_emu: i64, h_emu: i64) -> String {
    format!(
        r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1"><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{id}" name="Diagramm {}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="{URI}"><cx:chart xmlns:cx="{URI}" r:id="{rid}"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice><mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w_emu}" cy="{h_emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE" sz="1100"/><a:t>Dieses Diagramm ist in Ihrer Version von Excel nicht verfügbar.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>"#,
        id - 1
    )
}
