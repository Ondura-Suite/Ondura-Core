use nexora_office::xlsx::{self, Value};

#[test]
fn reads_excel_workbook() {
    let l = xlsx::read(include_bytes!("fixtures/sample.xlsx")).expect("parse");
    let wb = &l.workbook;
    assert_eq!(wb.sheets.len(), 2);
    let s = &wb.sheets[0];
    assert_eq!(s.name, "Umsatz");
    assert_eq!(s.cells["A2"].v, Some(Value::Text("Januar".into())));
    assert_eq!(s.cells["B2"].v, Some(Value::Number(1200.5)));
    assert_eq!(s.cells["B5"].f.as_deref(), Some("SUM(B2:B4)"));
    assert_eq!(s.cells["C3"].f.as_deref(), Some("B3/$B$5"));
    assert_eq!(s.cells["E3"].v, Some(Value::Bool(true)));
    let head = &wb.styles[s.cells["A1"].s];
    assert!(head.bold);
    assert_eq!(head.fill.as_deref(), Some("#4472c4"));
    assert_eq!(head.color.as_deref(), Some("#ffffff"));
    assert_eq!(
        wb.styles[s.cells["B2"].s].num_fmt.as_deref(),
        Some("#,##0.00 €")
    );
    assert_eq!(
        wb.styles[s.cells["E2"].s].num_fmt.as_deref(),
        Some("dd.mm.yyyy")
    );
    let b5 = &wb.styles[s.cells["B5"].s];
    assert_eq!(
        (b5.border_top.as_deref(), b5.border_bottom.as_deref()),
        (Some("thin"), Some("double"))
    );
    assert_eq!(s.merges, vec!["A7:C7".to_string()]);
    assert_eq!(
        wb.styles[s.cells["A7"].s].h_align.as_deref(),
        Some("center")
    );
    assert!(wb.styles[s.cells["A7"].s].wrap);
    assert_eq!(s.freeze_rows, 1);
    assert_eq!(s.cols.get(&0), Some(&131.0));
    assert_eq!(s.rows.get(&6), Some(&40.0));
    assert_eq!(wb.sheets[1].cells["A2"].f.as_deref(), Some("Umsatz!B5*2"));
}

#[test]
fn round_trip() {
    let wb = xlsx::read(include_bytes!("fixtures/sample.xlsx"))
        .unwrap()
        .workbook;
    let bytes = xlsx::write(&wb).expect("write");
    let again = xlsx::read(&bytes).expect("re-read").workbook;
    assert_eq!(again.sheets, wb.sheets);
    // Styles are re-interned but must resolve to the same formats.
    for (k, c) in &wb.sheets[0].cells {
        assert_eq!(
            again.styles[again.sheets[0].cells[k].s], wb.styles[c.s],
            "style of {k}"
        );
    }
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/roundtrip.xlsx"), &bytes).unwrap();
    }
}

#[test]
fn charts_filters_conditional_formats_and_names() {
    use nexora_office::chart::{Chart, Series};
    use nexora_office::xlsx::*;
    let mut wb = Workbook::default();
    let s = &mut wb.sheets[0];
    let put = |s: &mut Sheet, r: &str, v: Value| {
        s.cells.insert(
            r.to_string(),
            Cell {
                v: Some(v),
                ..Default::default()
            },
        );
    };
    put(s, "A1", Value::Text("Monat".into()));
    put(s, "B1", Value::Text("Umsatz".into()));
    for (i, (m, v)) in [("Jan", 120.0), ("Feb", 80.0), ("Mär", 150.0), ("Apr", 95.0)]
        .iter()
        .enumerate()
    {
        put(s, &format!("A{}", i + 2), Value::Text(m.to_string()));
        put(s, &format!("B{}", i + 2), Value::Number(*v));
    }
    s.auto_filter = Some(AutoFilter {
        range: "A1:B5".into(),
        columns: vec![FilterColumn {
            col: 0,
            values: vec!["Jan".into(), "Mär".into()],
        }],
    });
    s.hidden_rows = vec![2, 4];
    s.cond_formats.push(CondFormat {
        range: "B2:B5".into(),
        rules: vec![
            CondRule {
                kind: "cellIs".into(),
                operator: Some("greaterThan".into()),
                formulas: vec!["100".into()],
                style: Some(CellStyle {
                    bold: true,
                    fill: Some("#c6efce".into()),
                    color: Some("#006100".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            CondRule {
                kind: "dataBar".into(),
                colors: vec!["#638ec6".into()],
                ..Default::default()
            },
        ],
    });
    s.cond_formats.push(CondFormat {
        range: "A2:A5".into(),
        rules: vec![CondRule {
            kind: "containsText".into(),
            text: Some("ä".into()),
            style: Some(CellStyle {
                italic: true,
                ..Default::default()
            }),
            ..Default::default()
        }],
    });
    s.charts.push(SheetChart {
        chart: Chart {
            kind: "column".into(),
            title: Some("Umsatz je Monat".into()),
            series: vec![Series {
                name_ref: Some("Tabelle1!$B$1".into()),
                cat_ref: Some("Tabelle1!$A$2:$A$5".into()),
                val_ref: Some("Tabelle1!$B$2:$B$5".into()),
                ..Default::default()
            }],
            legend: Some("b".into()),
            stacked: false,
            labels: true,
            ..Default::default()
        },
        anchor: Anchor {
            col: 3,
            row: 1,
            dx: 10.0,
            dy: 5.0,
            w: 400.0,
            h: 250.0,
        },
    });
    // 1×1 PNG
    s.images.push(SheetImage { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==".into(), anchor: Anchor { col: 3, row: 16, dx: 0.0, dy: 0.0, w: 64.0, h: 40.0 }, name: Some("Logo".into()) });
    wb.names.push(DefinedName {
        name: "Umsatz".into(),
        formula: "Tabelle1!$B$2:$B$5".into(),
        sheet: None,
        hidden: false,
    });

    let s = &mut wb.sheets[0];
    s.validations.push(Validation {
        range: "C2:C5".into(),
        kind: "list".into(),
        formulas: vec!["\"Offen,Erledigt\"".into()],
        allow_blank: true,
        prompt: Some("Status wählen".into()),
        ..Default::default()
    });
    s.validations.push(Validation {
        range: "B2:B5".into(),
        kind: "decimal".into(),
        operator: Some("between".into()),
        formulas: vec!["0".into(), "1000".into()],
        error: Some("0 bis 1000".into()),
        ..Default::default()
    });
    s.sparklines.push(Sparkline {
        cell: "B7".into(),
        source: "Tabelle1!B2:B5".into(),
        kind: "column".into(),
        color: Some("#376092".into()),
        negative_color: Some("#d00000".into()),
        ..Default::default()
    });
    let bytes = write(&wb).expect("write");
    let loaded = read(&bytes).expect("re-read");
    assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
    let again = loaded.workbook;
    assert_eq!(again.names, wb.names);
    assert_eq!(again.sheets[0].validations, wb.sheets[0].validations);
    assert_eq!(again.sheets[0].sparklines, wb.sheets[0].sparklines);
    let (a, b) = (&again.sheets[0], &wb.sheets[0]);
    assert_eq!(a.auto_filter, b.auto_filter);
    assert_eq!(a.cond_formats[0].rules[1], b.cond_formats[0].rules[1]);
    assert_eq!(
        a.cond_formats[0].rules[0].style,
        b.cond_formats[0].rules[0].style
    );
    assert_eq!(a.cond_formats[1].rules[0].text.as_deref(), Some("ä"));
    assert_eq!(a.charts.len(), 1);
    let ch = &a.charts[0];
    assert_eq!(ch.chart.title.as_deref(), Some("Umsatz je Monat"));
    assert_eq!(
        ch.chart.series[0].values,
        vec![Some(120.0), Some(80.0), Some(150.0), Some(95.0)]
    );
    assert_eq!(
        ch.chart.series[0].categories,
        vec!["Jan", "Feb", "Mär", "Apr"]
    );
    assert_eq!(ch.chart.series[0].name.as_deref(), Some("Umsatz"));
    assert_eq!((ch.anchor.col, ch.anchor.row), (3, 1));
    assert!(
        (ch.anchor.w - 400.0).abs() < 0.5 && (ch.anchor.h - 250.0).abs() < 0.5,
        "{:?}",
        ch.anchor
    );
    assert_eq!(a.images.len(), 1);
    assert!((a.images[0].anchor.w - 64.0).abs() < 0.5);
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/features.xlsx"), &bytes).unwrap();
    }
}

#[test]
fn dynamic_arrays_and_new_functions() {
    use std::io::Read;
    let mut wb = xlsx::Workbook::default();
    let mut s = xlsx::Sheet::new("Daten");
    let cell = |f: &str, v: Option<Value>, spill: Option<&str>| xlsx::Cell {
        f: Some(f.into()),
        v,
        spill: spill.map(String::from),
        ..Default::default()
    };
    s.cells.insert(
        "A1".into(),
        cell("SEQUENCE(3)", Some(Value::Number(1.0)), Some("A1:A3")),
    );
    s.cells.insert(
        "A2".into(),
        xlsx::Cell {
            v: Some(Value::Number(2.0)),
            ..Default::default()
        },
    );
    s.cells.insert(
        "A3".into(),
        xlsx::Cell {
            v: Some(Value::Number(3.0)),
            ..Default::default()
        },
    );
    s.cells.insert(
        "B1".into(),
        cell(
            "LET(x,SUM(A1#),XLOOKUP(2,A1:A3,A1:A3)+x)",
            Some(Value::Number(8.0)),
            None,
        ),
    );
    s.cells.insert(
        "C1".into(),
        cell("STDEV.S(A1:A3)", Some(Value::Number(1.0)), None),
    );
    wb.sheets = vec![s];
    let bytes = xlsx::write(&wb).expect("write");
    // The file uses Excel's prefixes and dynamic array metadata.
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
    let mut sheet = String::new();
    zip.by_name("xl/worksheets/sheet1.xml")
        .unwrap()
        .read_to_string(&mut sheet)
        .unwrap();
    assert!(sheet.contains(r#"cm="1""#), "{sheet}");
    assert!(
        sheet.contains(r#"<f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f>"#),
        "{sheet}"
    );
    assert!(
        sheet.contains("_xlfn.LET(_xlpm.x,SUM(A1#),_xlfn.XLOOKUP(2,A1:A3,A1:A3)+_xlpm.x)"),
        "{sheet}"
    );
    assert!(sheet.contains("_xlfn.STDEV.S(A1:A3)"), "{sheet}");
    assert!(zip.by_name("xl/metadata.xml").is_ok());
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/dynamic.xlsx"), &bytes).unwrap();
    }
    // Reading strips the prefixes and drops the spilled results.
    let back = xlsx::read(&bytes).unwrap().workbook;
    let s = &back.sheets[0];
    assert_eq!(s.cells["A1"].f.as_deref(), Some("SEQUENCE(3)"));
    assert_eq!(s.cells["A1"].spill.as_deref(), Some("A1:A3"));
    assert!(!s.cells.contains_key("A2"));
    assert_eq!(
        s.cells["B1"].f.as_deref(),
        Some("LET(x,SUM(A1#),XLOOKUP(2,A1:A3,A1:A3)+x)")
    );
    // And through OpenDocument.
    let ods = nexora_office::ods::write(&back).unwrap();
    let o = nexora_office::ods::read(&ods).unwrap().workbook;
    assert_eq!(o.sheets[0].cells["A1"].spill.as_deref(), Some("A1:A3"));
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/dynamic.ods"), &ods).unwrap();
    }
}

#[test]
fn excel_tables() {
    use std::io::Read;
    let mut wb = xlsx::Workbook::default();
    let mut s = xlsx::Sheet::new("Daten");
    let text = |t: &str| xlsx::Cell {
        v: Some(Value::Text(t.into())),
        ..Default::default()
    };
    let num = |n: f64| xlsx::Cell {
        v: Some(Value::Number(n)),
        ..Default::default()
    };
    let f = |f: &str| xlsx::Cell {
        f: Some(f.into()),
        ..Default::default()
    };
    for (k, c) in [
        ("A1", text("Artikel")),
        ("B1", text("Menge")),
        ("C1", text("Preis")),
        ("D1", text("Summe")),
    ] {
        s.cells.insert(k.into(), c);
    }
    for (r, (a, m, p)) in [("Kabel", 3.0, 2.5), ("Stecker", 10.0, 0.4)]
        .iter()
        .enumerate()
    {
        let r = r + 2;
        s.cells.insert(format!("A{r}"), text(a));
        s.cells.insert(format!("B{r}"), num(*m));
        s.cells.insert(format!("C{r}"), num(*p));
        s.cells.insert(format!("D{r}"), f("[@Menge]*[@Preis]"));
    }
    s.cells.insert("A4".into(), text("Ergebnis"));
    s.cells
        .insert("D4".into(), f("SUBTOTAL(109,Tabelle1[Summe])"));
    s.cells.insert("F1".into(), f("SUM(Tabelle1[Menge])"));
    s.tables.push(xlsx::SheetTable {
        name: "Tabelle1".into(),
        range: "A1:D4".into(),
        header_row: true,
        totals_row: true,
        style: Some("TableStyleMedium2".into()),
        banded_rows: true,
        filter: true,
        columns: ["Artikel", "Menge", "Preis", "Summe"]
            .iter()
            .map(|n| xlsx::TableColumn {
                name: n.to_string(),
                totals_function: (*n == "Summe").then(|| "sum".into()),
                totals_label: (*n == "Artikel").then(|| "Ergebnis".into()),
                formula: (*n == "Summe").then(|| "[@Menge]*[@Preis]".into()),
            })
            .collect(),
        ..Default::default()
    });
    s.tables[0].filter_columns = vec![xlsx::FilterColumn {
        col: 0,
        values: vec!["Kabel".into()],
    }];
    wb.sheets = vec![s];
    let bytes = xlsx::write(&wb).unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
    let mut sheet = String::new();
    zip.by_name("xl/worksheets/sheet1.xml")
        .unwrap()
        .read_to_string(&mut sheet)
        .unwrap();
    assert!(
        sheet.contains("Tabelle1[[#This Row],[Menge]]*Tabelle1[[#This Row],[Preis]]"),
        "{sheet}"
    );
    assert!(sheet.contains(r#"<tableParts count="1">"#));
    assert!(
        !sheet.contains("<autoFilter"),
        "the filter belongs to the table"
    );
    let mut table = String::new();
    zip.by_name("xl/tables/table1.xml")
        .unwrap()
        .read_to_string(&mut table)
        .unwrap();
    assert!(
        table.contains(r#"ref="A1:D4""#)
            && table.contains(r#"totalsRowCount="1""#)
            && table.contains(
                r#"<autoFilter ref="A1:D3"><filterColumn colId="0"><filters><filter val="Kabel"/>"#
            ),
        "{table}"
    );
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/tables.xlsx"), &bytes).unwrap();
    }
    let back = xlsx::read(&bytes).unwrap();
    let s = &back.workbook.sheets[0];
    assert_eq!(s.tables, wb.sheets[0].tables);
    assert_eq!(s.cells["D2"].f.as_deref(), Some("[@Menge]*[@Preis]"));
    assert!(s.auto_filter.is_none());
    assert!(
        back.warnings.iter().all(|w| !w.contains("Tabellen")),
        "{:?}",
        back.warnings
    );
    // OpenDocument: ranges instead of structured references, the table as a database range.
    let ods = nexora_office::ods::write(&back.workbook).unwrap();
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(ods.clone())).unwrap();
    let mut content = String::new();
    z.by_name("content.xml")
        .unwrap()
        .read_to_string(&mut content)
        .unwrap();
    assert!(
        content.contains("of:=[.B2]*[.C2]") && content.contains("SUM([.B2:.B3])"),
        "{content}"
    );
    let o = nexora_office::ods::read(&ods).unwrap().workbook;
    assert_eq!(o.sheets[0].tables[0].name, "Tabelle1");
    assert_eq!(o.sheets[0].tables[0].columns[3].name, "Summe");
    assert_eq!(
        o.sheets[0].tables[0].filter_columns,
        wb.sheets[0].tables[0].filter_columns
    );
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/tables.ods"), &ods).unwrap();
    }
}

#[test]
fn scenarios_and_data_tables() {
    use std::io::{Read, Write};
    let mut wb = xlsx::Workbook::default();
    let s = &mut wb.sheets[0];
    let num = |n: f64| xlsx::Cell {
        v: Some(Value::Number(n)),
        ..Default::default()
    };
    s.cells.insert("A1".into(), num(5.0));
    s.cells.insert(
        "B2".into(),
        xlsx::Cell {
            f: Some("A1*2".into()),
            ..Default::default()
        },
    );
    s.cells.insert("A3".into(), num(1.0));
    s.cells.insert("A4".into(), num(2.0));
    s.cells.insert("B3".into(), num(2.0));
    s.cells.insert("B4".into(), num(4.0));
    s.cells.insert(
        "C1".into(),
        xlsx::Cell {
            f: Some("MULTIPLE.OPERATIONS(B2,A1,7)".into()),
            v: Some(Value::Number(14.0)),
            ..Default::default()
        },
    );
    s.scenarios.push(xlsx::Scenario {
        name: "Hoch".into(),
        comment: Some("Bestfall".into()),
        cells: vec![xlsx::ScenarioCell {
            cell: "A1".into(),
            value: "9".into(),
        }],
    });
    let bytes = xlsx::write(&wb).unwrap();
    // Excel has no MULTIPLE.OPERATIONS: only its value is written.
    let mut zin = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for i in 0..zin.len() {
        let mut f = zin.by_index(i).unwrap();
        let name = f.name().to_string();
        let mut data = Vec::new();
        f.read_to_end(&mut data).unwrap();
        if name == "xl/worksheets/sheet1.xml" {
            let mut x = String::from_utf8(data).unwrap();
            assert!(x.contains(r#"<c r="C1"><v>14</v></c>"#), "{x}");
            assert!(x.contains(r#"<scenario name="Hoch" count="1" user="Nexora" comment="Bestfall"><inputCells r="A1" val="9"/>"#), "{x}");
            // An Excel data table (column input A1) on B3:B4.
            x = x.replace(
                r#"<c r="B3"><v>2</v></c>"#,
                r#"<c r="B3"><f t="dataTable" ref="B3:B4" dt2D="0" dtr="0" r1="A1"/><v>2</v></c>"#,
            );
            data = x.into_bytes();
        }
        out.start_file(name.as_str(), zip::write::SimpleFileOptions::default())
            .unwrap();
        out.write_all(&data).unwrap();
    }
    let bytes = out.finish().unwrap().into_inner();
    let back = xlsx::read(&bytes).unwrap().workbook;
    let s = &back.sheets[0];
    assert_eq!(s.scenarios, wb.sheets[0].scenarios);
    assert_eq!(
        s.cells["B3"].f.as_deref(),
        Some("MULTIPLE.OPERATIONS(B$2,$A$1,$A3)")
    );
    assert_eq!(
        s.cells["B4"].f.as_deref(),
        Some("MULTIPLE.OPERATIONS(B$2,$A$1,$A4)")
    );
}

#[test]
fn combo_and_chartex_charts() {
    use nexora_office::chart::{Chart, Series};
    let mut wb = xlsx::Workbook::default();
    let anchor = xlsx::Anchor {
        col: 3,
        row: 1,
        dx: 0.0,
        dy: 0.0,
        w: 480.0,
        h: 288.0,
    };
    let ser = |name: &str, vals: &[f64], kind: Option<&str>, secondary: bool| Series {
        name: Some(name.into()),
        categories: vec!["Q1".into(), "Q2".into(), "Q3".into()],
        values: vals.iter().map(|v| Some(*v)).collect(),
        kind: kind.map(String::from),
        secondary,
        ..Default::default()
    };
    let combo = Chart {
        kind: "combo".into(),
        title: Some("Umsatz und Marge".into()),
        series: vec![
            ser("Umsatz", &[100.0, 120.0, 90.0], Some("column"), false),
            ser("Marge", &[0.2, 0.25, 0.18], Some("line"), true),
        ],
        legend: Some("b".into()),
        ..Default::default()
    };
    let waterfall = Chart {
        kind: "waterfall".into(),
        title: Some("Ergebnis".into()),
        series: vec![ser("Wert", &[100.0, -30.0, 70.0], None, false)],
        subtotals: vec![2],
        ..Default::default()
    };
    let histogram = Chart {
        kind: "histogram".into(),
        series: vec![Series {
            values: [1.0, 2.0, 2.5, 3.0, 7.0].iter().map(|v| Some(*v)).collect(),
            ..Default::default()
        }],
        bin_count: Some(3),
        ..Default::default()
    };
    for c in [&combo, &waterfall, &histogram] {
        wb.sheets[0].charts.push(xlsx::SheetChart {
            chart: c.clone(),
            anchor: anchor.clone(),
        });
    }
    let bytes = xlsx::write(&wb).unwrap();
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/charts2016.xlsx"), &bytes).unwrap();
    }
    let back = xlsx::read(&bytes).unwrap();
    let charts = &back.workbook.sheets[0].charts;
    assert_eq!(charts.len(), 3, "{:?}", back.warnings);
    let c = &charts[0].chart;
    assert_eq!(c.kind, "combo");
    assert_eq!(
        (c.series[0].kind.as_deref(), c.series[0].secondary),
        (Some("column"), false)
    );
    assert_eq!(
        (c.series[1].kind.as_deref(), c.series[1].secondary),
        (Some("line"), true)
    );
    assert_eq!(charts[1].chart.kind, "waterfall");
    assert_eq!(charts[1].chart.subtotals, vec![2]);
    assert_eq!(charts[1].chart.series[0].values, waterfall.series[0].values);
    assert_eq!(
        charts[1].chart.series[0].categories,
        waterfall.series[0].categories
    );
    assert_eq!(charts[2].chart.kind, "histogram");
    assert_eq!(charts[2].chart.bin_count, Some(3));
}

#[test]
fn notes_links_protection_outline() {
    let mut wb = xlsx::Workbook { protect_structure: true, ..Default::default() };
    let unlocked = wb.styles.len();
    wb.styles.push(xlsx::CellStyle {
        locked: Some(false),
        ..Default::default()
    });
    let s = &mut wb.sheets[0];
    s.cells.insert(
        "A1".into(),
        xlsx::Cell {
            v: Some(Value::Text("Website".into())),
            ..Default::default()
        },
    );
    s.cells.insert(
        "A2".into(),
        xlsx::Cell {
            v: Some(Value::Text("Zu Blatt 2".into())),
            ..Default::default()
        },
    );
    s.cells.insert(
        "B1".into(),
        xlsx::Cell {
            v: Some(Value::Number(5.0)),
            s: unlocked,
            ..Default::default()
        },
    );
    s.notes.push(xlsx::Note {
        cell: "B1".into(),
        text: "Eingabe hier\nzweite Zeile".into(),
        author: Some("Niklas".into()),
        visible: true,
    });
    s.links.push(xlsx::Link {
        cell: "A1".into(),
        target: "https://mirranet.de/".into(),
        tooltip: Some("MirraNET".into()),
    });
    s.links.push(xlsx::Link {
        cell: "A2".into(),
        target: "#Zwei!A1".into(),
        tooltip: None,
    });
    s.protection = Some(xlsx::Protection {
        password: Some("CC1A".into()),
        format_cells: true,
        select_locked: true,
        ..Default::default()
    });
    s.row_levels.insert(3, 1);
    s.row_levels.insert(4, 1);
    s.col_levels.insert(2, 2);
    let mut hidden = xlsx::Sheet::new("Zwei");
    hidden.hidden = true;
    wb.sheets.push(hidden);
    let bytes = xlsx::write(&wb).unwrap();
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/review.xlsx"), &bytes).unwrap();
    }
    let back = xlsx::read(&bytes).unwrap().workbook;
    let a = &back.sheets[0];
    assert!(back.protect_structure);
    assert_eq!(a.notes, wb.sheets[0].notes);
    assert_eq!(a.links, wb.sheets[0].links);
    assert_eq!(a.protection, wb.sheets[0].protection);
    assert_eq!(a.row_levels, wb.sheets[0].row_levels);
    assert_eq!(a.col_levels, wb.sheets[0].col_levels);
    assert_eq!(back.styles[a.cells["B1"].s].locked, Some(false));
    assert!(back.sheets[1].hidden);
    let ods = nexora_office::ods::write(&back).unwrap();
    let o = nexora_office::ods::read(&ods).unwrap().workbook;
    assert_eq!(o.sheets[0].notes, wb.sheets[0].notes);
    assert_eq!(
        o.sheets[0]
            .links
            .iter()
            .map(|l| (&l.cell, &l.target))
            .collect::<Vec<_>>(),
        wb.sheets[0]
            .links
            .iter()
            .map(|l| (&l.cell, &l.target))
            .collect::<Vec<_>>()
    );
    assert!(o.sheets[0].protection.is_some());
    assert!(o.sheets[1].hidden);
    assert_eq!(o.styles[o.sheets[0].cells["B1"].s].locked, Some(false));
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/review.ods"), &ods).unwrap();
    }
}
