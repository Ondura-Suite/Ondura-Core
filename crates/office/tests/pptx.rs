use nexora_office::pptx;

#[test]
fn reads_powerpoint() {
    let l = pptx::read(include_bytes!("fixtures/sample.pptx")).expect("parse");
    let p = &l.presentation;
    assert_eq!((p.width.round(), p.height.round()), (1280.0, 720.0));
    assert_eq!(p.slides.len(), 2);
    let title = p.slides[0].shapes.iter().find(|s| s.placeholder.as_deref() == Some("ctrTitle")).expect("title");
    assert_eq!(title.paragraphs[0].runs[0].text, "Nexora Präsentation");
    assert_eq!(title.paragraphs[0].runs[0].size, Some(44.0));
    assert!(title.w > 100.0 && title.h > 20.0, "title position inherited from the layout");
    let s2 = &p.slides[1];
    let body = s2.shapes.iter().find(|s| s.placeholder.as_deref() == Some("body") || s.placeholder.as_deref() == Some("obj")).expect("body");
    assert_eq!(body.paragraphs.len(), 3);
    assert_eq!(body.paragraphs[0].bullet.as_deref(), Some("•"));
    assert_eq!(body.paragraphs[1].level, 1);
    assert!(body.paragraphs[2].runs[0].bold);
    assert_eq!(body.paragraphs[2].runs[0].color.as_deref(), Some("#c00000"));
    let rect = s2.shapes.iter().find(|s| s.kind == "roundRect").expect("shape");
    assert_eq!(rect.fill.as_deref(), Some("#4f54d4"));
    assert_eq!(rect.paragraphs[0].runs[0].text, "Form mit Text");
    assert!(s2.shapes.iter().any(|s| s.kind == "image" && s.src.as_deref().is_some_and(|x| x.starts_with("data:image/png"))));
    assert_eq!(s2.notes, "Sprechernotiz für Folie 2");
    assert_eq!(s2.background.as_deref(), Some("#f5f5fa"));
}

#[test]
fn round_trip() {
    let p = pptx::read(include_bytes!("fixtures/sample.pptx")).unwrap().presentation;
    let bytes = pptx::write(&p).expect("write");
    let again = pptx::read(&bytes).expect("re-read").presentation;
    assert_eq!(again.slides.len(), p.slides.len());
    for (a, b) in again.slides.iter().zip(p.slides.iter()) {
        assert_eq!(a.notes, b.notes);
        assert_eq!(a.background, b.background);
        assert_eq!(a.shapes.len(), b.shapes.len());
        for (x, y) in a.shapes.iter().zip(b.shapes.iter()) {
            assert_eq!(x.kind, y.kind);
            assert!((x.x - y.x).abs() < 0.2 && (x.w - y.w).abs() < 0.2);
            let text = |s: &pptx::Shape| s.paragraphs.iter().map(|p| p.runs.iter().map(|r| r.text.clone()).collect::<String>()).collect::<Vec<_>>();
            assert_eq!(text(x), text(y));
            for (pa, pb) in x.paragraphs.iter().zip(y.paragraphs.iter()) {
                assert_eq!(pa.bullet, pb.bullet);
                assert_eq!(pa.level, pb.level);
                for (ra, rb) in pa.runs.iter().zip(pb.runs.iter()) {
                    assert_eq!((ra.bold, ra.size, &ra.color), (rb.bold, rb.size, &rb.color));
                }
            }
        }
    }
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/roundtrip.pptx"), &bytes).unwrap();
    }
}

#[test]
fn tables_charts_transitions_animations() {
    use nexora_office::chart::{Chart, Series};
    use pptx::*;
    let run = |t: &str| Para { runs: vec![Run { text: t.into(), size: Some(16.0), ..Default::default() }], ..Default::default() };
    let cell = |t: &str| TableCell { paragraphs: vec![run(t)], ..Default::default() };
    let table = Table {
        cols: vec![200.0, 150.0, 150.0],
        rows: vec![
            TableRow { h: 40.0, cells: vec![cell("Produkt"), cell("Q1"), cell("Q2")] },
            TableRow { h: 40.0, cells: vec![cell("Orbit"), cell("120"), cell("150")] },
            TableRow { h: 40.0, cells: vec![cell("Tabellen"), TableCell { fill: Some("#ffeb9c".into()), ..cell("80") }, cell("95")] },
        ],
        header: true,
        banded: true,
        color: Some("#4472c4".into()),
    };
    let chart = Chart {
        kind: "bar".into(),
        title: Some("Umsatz".into()),
        series: vec![
            Series { name: Some("Q1".into()), categories: vec!["Orbit".into(), "Tabellen".into()], values: vec![Some(120.0), Some(80.0)], ..Default::default() },
            Series { name: Some("Q2".into()), categories: vec!["Orbit".into(), "Tabellen".into()], values: vec![Some(150.0), Some(95.0)], ..Default::default() },
        ],
        legend: Some("b".into()),
        stacked: false,
        labels: false,
    };
    let title = Shape { id: 2, kind: "text".into(), x: 60.0, y: 30.0, w: 1100.0, h: 80.0, paragraphs: vec![run("Quartalszahlen")], ..Default::default() };
    let tbl = Shape { id: 3, kind: "table".into(), x: 60.0, y: 140.0, w: 500.0, h: 120.0, table: Some(table), ..Default::default() };
    let ch = Shape { id: 4, kind: "chart".into(), x: 620.0, y: 140.0, w: 600.0, h: 400.0, chart: Some(chart), ..Default::default() };
    let anim = |shape, effect: &str, trigger: &str, dir: Option<&str>| Animation { shape, effect: effect.into(), trigger: trigger.into(), dir: dir.map(String::from), duration: 500, delay: 0 };
    let slide = Slide {
        shapes: vec![title, tbl, ch],
        transition: Some(Transition { kind: "push".into(), dir: Some("u".into()), duration: 900 }),
        animations: vec![anim(2, "fade", "with", None), anim(3, "fly", "click", Some("l")), anim(4, "wipe", "after", Some("b"))],
        ..Default::default()
    };
    let p = Presentation { slides: vec![slide], ..Default::default() };
    let bytes = write(&p).expect("write");
    let loaded = read(&bytes).expect("read");
    assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
    let s = &loaded.presentation.slides[0];
    assert_eq!(s.transition, p.slides[0].transition);
    assert_eq!(s.animations, p.slides[0].animations);
    let t = s.shapes.iter().find(|x| x.kind == "table").and_then(|x| x.table.as_ref()).expect("table");
    assert_eq!(t.rows.len(), 3);
    assert!(t.header && t.banded);
    assert_eq!(t.rows[2].cells[1].fill.as_deref(), Some("#ffeb9c"));
    assert_eq!(t.rows[1].cells[0].paragraphs[0].runs[0].text, "Orbit");
    let c = s.shapes.iter().find(|x| x.kind == "chart").and_then(|x| x.chart.as_ref()).expect("chart");
    assert_eq!(c.kind, "bar");
    assert_eq!(c.series[1].values, vec![Some(150.0), Some(95.0)]);
    assert_eq!(c.series[0].categories, vec!["Orbit", "Tabellen"]);
    assert_eq!(c.title.as_deref(), Some("Umsatz"));
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/features.pptx"), &bytes).unwrap();
    }
}
