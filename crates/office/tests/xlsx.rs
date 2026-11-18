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
    });

    let s = &mut wb.sheets[0];
    s.validations.push(Validation { range: "C2:C5".into(), kind: "list".into(), formulas: vec!["\"Offen,Erledigt\"".into()], allow_blank: true, prompt: Some("Status wählen".into()), ..Default::default() });
    s.validations.push(Validation { range: "B2:B5".into(), kind: "decimal".into(), operator: Some("between".into()), formulas: vec!["0".into(), "1000".into()], error: Some("0 bis 1000".into()), ..Default::default() });
    s.sparklines.push(Sparkline { cell: "B7".into(), source: "Tabelle1!B2:B5".into(), kind: "column".into(), color: Some("#376092".into()), negative_color: Some("#d00000".into()), ..Default::default() });
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
