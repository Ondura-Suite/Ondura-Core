use nexora_office::{ods, xlsx};

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
    });
    let lost = ods::losses(&wb);
    let bytes = ods::write(&wb).expect("write");
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
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
