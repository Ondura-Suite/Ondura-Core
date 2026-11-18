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
