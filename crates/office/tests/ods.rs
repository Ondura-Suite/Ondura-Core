use ondura_office::{ods, xlsx};

#[test]
fn ods_round_trip() {
    let mut wb = xlsx::read(include_bytes!("fixtures/sample.xlsx"))
        .expect("fixture")
        .workbook;
    // ODF keeps lengths with limited precision.
    for s in &mut wb.sheets {
        s.cols
            .values_mut()
            .for_each(|w| *w = (*w * 10.0).round() / 10.0);
        s.rows
            .values_mut()
            .for_each(|h| *h = (*h * 10.0).round() / 10.0);
    }
    wb.names.push(xlsx::DefinedName {
        name: "Bereich".into(),
        formula: format!("{}!$A$1:$B$3", wb.sheets[0].name),
        sheet: None,
        hidden: false,
    });
    let lost = ods::losses(&wb);
    let bytes = ods::write(&wb).expect("write");
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/test.ods"), &bytes).unwrap();
    }
    let l = ods::read(&bytes).expect("read");
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
    let again = l.workbook;
    assert_eq!(again.sheets.len(), wb.sheets.len());
    for (a, b) in again.sheets.iter().zip(&wb.sheets) {
        assert_eq!(a.name, b.name);
        for (k, c) in &b.cells {
            let d = a.cells.get(k).unwrap_or_else(|| panic!("{k} missing"));
            assert_eq!((&d.v, &d.f, &d.e), (&c.v, &c.f, &c.e), "{}!{k}", b.name);
            assert_eq!(again.styles[d.s], wb.styles[c.s], "style of {}!{k}", b.name);
        }
        assert_eq!(a.merges, b.merges);
        assert_eq!(a.cols, b.cols);
        assert_eq!(a.rows, b.rows);
        assert_eq!(
            (a.freeze_rows, a.freeze_cols, a.show_grid),
            (b.freeze_rows, b.freeze_cols, b.show_grid)
        );
        assert_eq!(
            (&a.hidden_rows, &a.hidden_cols),
            (&b.hidden_rows, &b.hidden_cols)
        );
    }
    assert_eq!(again.names, wb.names);
    assert_eq!(again.active, wb.active);
    eprintln!("not kept: {lost:?}");
}

#[test]
fn ods_charts_images_rules_validation_filters_sparklines() {
    use ondura_office::chart::{Chart, Series};
    use ondura_office::xlsx::*;
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
    let green = CellStyle {
        bold: true,
        fill: Some("#c6efce".into()),
        color: Some("#006100".into()),
        ..Default::default()
    };
    s.cond_formats.push(CondFormat {
        range: "B2:B5".into(),
        rules: vec![
            CondRule {
                kind: "cellIs".into(),
                operator: Some("greaterThan".into()),
                formulas: vec!["100".into()],
                style: Some(green.clone()),
                ..Default::default()
            },
            CondRule {
                kind: "cellIs".into(),
                operator: Some("between".into()),
                formulas: vec!["80".into(), "90".into()],
                style: Some(CellStyle {
                    italic: true,
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
        rules: vec![
            CondRule {
                kind: "containsText".into(),
                text: Some("ä".into()),
                style: Some(CellStyle {
                    italic: true,
                    ..Default::default()
                }),
                ..Default::default()
            },
            CondRule {
                kind: "top10".into(),
                rank: Some(2),
                bottom: true,
                style: Some(green.clone()),
                ..Default::default()
            },
        ],
    });
    s.cond_formats.push(CondFormat {
        range: "C2:C5".into(),
        rules: vec![CondRule {
            kind: "colorScale".into(),
            colors: vec!["#f8696b".into(), "#ffeb84".into(), "#63be7b".into()],
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
                color: Some("#4472c4".into()),
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
    s.images.push(SheetImage { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==".into(), anchor: Anchor { col: 3, row: 16, dx: 0.0, dy: 0.0, w: 64.0, h: 40.0 }, name: Some("Logo".into()) });
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
    s.validations.push(Validation {
        range: "E2:E9".into(),
        kind: "textLength".into(),
        operator: Some("lessThanOrEqual".into()),
        formulas: vec!["5".into()],
        allow_blank: true,
        error_style: Some("warning".into()),
        ..Default::default()
    });
    s.validations.push(Validation {
        range: "F2".into(),
        kind: "list".into(),
        formulas: vec!["$A$2:$A$5".into()],
        allow_blank: true,
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
    assert!(ods::losses(&wb).is_empty());
    let bytes = ods::write(&wb).expect("write");
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/features.ods"), &bytes).unwrap();
    }
    let l = ods::read(&bytes).expect("read");
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
    let (a, b) = (&l.workbook.sheets[0], &wb.sheets[0]);
    assert_eq!(a.auto_filter, b.auto_filter);
    assert_eq!(a.cond_formats, b.cond_formats);
    let mut va = a.validations.clone();
    let mut vb = b.validations.clone();
    va.sort_by(|x, y| x.range.cmp(&y.range));
    vb.sort_by(|x, y| x.range.cmp(&y.range));
    assert_eq!(va, vb);
    assert_eq!(a.sparklines, b.sparklines);
    assert_eq!(a.images, b.images);
    assert_eq!(a.charts.len(), 1);
    let ch = &a.charts[0];
    assert_eq!(ch.anchor, b.charts[0].anchor);
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
    assert_eq!(
        (
            ch.chart.series[0].val_ref.as_deref(),
            ch.chart.series[0].color.as_deref()
        ),
        (Some("Tabelle1!$B$2:$B$5"), Some("#4472c4"))
    );
    assert!(ch.chart.labels && ch.chart.legend.as_deref() == Some("b"));
}
