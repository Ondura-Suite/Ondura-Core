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
    assert_eq!(wb.styles[s.cells["B2"].s].num_fmt.as_deref(), Some("#,##0.00 €"));
    assert_eq!(wb.styles[s.cells["E2"].s].num_fmt.as_deref(), Some("dd.mm.yyyy"));
    let b5 = &wb.styles[s.cells["B5"].s];
    assert_eq!((b5.border_top.as_deref(), b5.border_bottom.as_deref()), (Some("thin"), Some("double")));
    assert_eq!(s.merges, vec!["A7:C7".to_string()]);
    assert_eq!(wb.styles[s.cells["A7"].s].h_align.as_deref(), Some("center"));
    assert!(wb.styles[s.cells["A7"].s].wrap);
    assert_eq!(s.freeze_rows, 1);
    assert_eq!(s.cols.get(&0), Some(&131.0));
    assert_eq!(s.rows.get(&6), Some(&40.0));
    assert_eq!(wb.sheets[1].cells["A2"].f.as_deref(), Some("Umsatz!B5*2"));
}

#[test]
fn round_trip() {
    let wb = xlsx::read(include_bytes!("fixtures/sample.xlsx")).unwrap().workbook;
    let bytes = xlsx::write(&wb).expect("write");
    let again = xlsx::read(&bytes).expect("re-read").workbook;
    assert_eq!(again.sheets, wb.sheets);
    // Styles are re-interned but must resolve to the same formats.
    for (k, c) in &wb.sheets[0].cells {
        assert_eq!(again.styles[again.sheets[0].cells[k].s], wb.styles[c.s], "style of {k}");
    }
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/roundtrip.xlsx"), &bytes).unwrap();
    }
}
