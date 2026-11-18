use nexora_office::docx::{self, Block, Inline, Paragraph};

fn sample() -> docx::Loaded {
    docx::read(include_bytes!("fixtures/sample.docx")).expect("parse fixture")
}

fn paragraphs(blocks: &[Block]) -> Vec<&Paragraph> {
    blocks.iter().filter_map(|b| if let Block::Paragraph(p) = b { Some(p) } else { None }).collect()
}

fn text(p: &Paragraph) -> String {
    p.content.iter().filter_map(|i| if let Inline::Text { text, .. } = i { Some(text.as_str()) } else { None }).collect()
}

#[test]
fn reads_word_document() {
    let l = sample();
    let d = &l.document;
    assert_eq!(d.title, "Testdokument");
    assert!((d.page.width_mm - 210.0).abs() < 0.5 && (d.page.margin_right_mm - 20.0).abs() < 0.5);
    let ps = paragraphs(&d.blocks);
    assert_eq!(ps[0].style.as_deref(), Some("heading1"));
    assert_eq!(text(ps[0]), "Überschrift Eins");
    let p = ps[1];
    assert_eq!(p.align.as_deref(), Some("center"));
    let bold = p.content.iter().find_map(|i| match i { Inline::Text { text, marks } if marks.bold => Some(text.clone()), _ => None });
    assert_eq!(bold.as_deref(), Some("fett"));
    assert!(p.content.iter().any(|i| matches!(i, Inline::Text { marks, .. } if marks.color.as_deref() == Some("#c00000") && marks.italic)));
    assert!(p.content.iter().any(|i| matches!(i, Inline::Text { marks, .. } if marks.size == Some(16.0) && marks.font.as_deref() == Some("Arial"))));

    let lists: Vec<_> = ps.iter().filter_map(|p| p.list.map(|l| (text(p), l.ordered, l.level))).collect();
    assert_eq!(lists, vec![("Punkt A".into(), false, 0), ("Punkt B".into(), false, 0), ("Erstens".into(), true, 0)]);

    let table = d.blocks.iter().find_map(|b| if let Block::Table(t) = b { Some(t) } else { None }).expect("table");
    assert_eq!(table.rows.len(), 3);
    assert_eq!(table.rows[0].cells[0].col_span, 2);
    assert_eq!(table.rows[1].cells[2].row_span, 2);
    assert_eq!(table.rows[2].cells.len(), 2);

    let idx = d.blocks.iter().position(|b| matches!(b, Block::PageBreak)).expect("page break");
    assert!(matches!(&d.blocks[idx - 1], Block::Paragraph(p) if text(p) == "Vor Umbruch"));
    assert!(matches!(&d.blocks[idx + 1], Block::Paragraph(p) if text(p) == "Nach Umbruch"));
    assert!(ps.iter().any(|p| p.content.iter().any(|i| matches!(i, Inline::Image { src, width, .. } if src.starts_with("data:image/png;base64,") && (*width - 75.6).abs() < 1.0))));
    assert_eq!(text(paragraphs(&d.header)[0]), "Kopfzeile Nexora");
}

#[test]
fn round_trip_is_lossless_for_the_model() {
    let mut d = sample().document;
    d.footer = vec![Block::Paragraph(Paragraph {
        align: Some("center".into()),
        content: vec![Inline::Text { text: "Seite ".into(), marks: Default::default() }, Inline::Field { field: "page".into() }],
        ..Default::default()
    })];
    let bytes = docx::write(&d).expect("write");
    let again = docx::read(&bytes).expect("re-read").document;
    assert_eq!(again.blocks, d.blocks);
    assert_eq!(again.header, d.header);
    assert_eq!(again.footer, d.footer);
    assert_eq!(again.page, d.page);
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/roundtrip.docx"), &bytes).unwrap();
    }
}

#[test]
fn ordered_lists_restart() {
    let p = |t: &str, ordered: bool| {
        Block::Paragraph(Paragraph { list: Some(docx::ListRef { ordered, level: 0 }), content: vec![Inline::Text { text: t.into(), marks: Default::default() }], ..Default::default() })
    };
    let d = docx::Document { blocks: vec![p("a", true), p("b", true), Block::Paragraph(Paragraph::default()), p("c", true)], ..Default::default() };
    let bytes = docx::write(&d).unwrap();
    let xml = String::from_utf8(read_part(&bytes, "word/document.xml")).unwrap();
    assert_eq!(xml.matches(r#"<w:numId w:val="2"/>"#).count(), 2);
    assert_eq!(xml.matches(r#"<w:numId w:val="3"/>"#).count(), 1);
}

fn read_part(bytes: &[u8], name: &str) -> Vec<u8> {
    use std::io::Read;
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut f = z.by_name(name).unwrap();
    let mut v = Vec::new();
    f.read_to_end(&mut v).unwrap();
    v
}

#[test]
fn comments_footnotes_revisions_toc_and_first_page() {
    use docx::{Comment, Marks, Revision, TocEntry};
    let t = |text: &str, marks: Marks| Inline::Text { text: text.into(), marks };
    let rev = Revision { author: "Niklas".into(), date: "2026-11-18T07:00:00Z".into() };
    let para = |content: Vec<Inline>| Block::Paragraph(Paragraph { content, ..Default::default() });
    let doc = docx::Document {
        blocks: vec![
            Block::Toc { title: Some("Inhalt".into()), entries: vec![TocEntry { level: 1, text: "Einleitung".into(), page: 1 }, TocEntry { level: 2, text: "Details".into(), page: 2 }] },
            Block::Paragraph(Paragraph { style: Some("heading1".into()), content: vec![t("Einleitung", Marks::default())], ..Default::default() }),
            para(vec![
                t("Ein ", Marks::default()),
                t("kommentierter", Marks { comment: Some(1), ..Default::default() }),
                t(" Satz", Marks { comment: Some(1), bold: true, ..Default::default() }),
                Inline::Footnote { text: "Quelle: Handbuch".into() },
                t(" mit ", Marks::default()),
                t("neuem", Marks { ins: Some(rev.clone()), ..Default::default() }),
                t("altem", Marks { del: Some(rev.clone()), ..Default::default() }),
                t(" Text.", Marks::default()),
            ]),
            para(vec![t("Über zwei Absätze", Marks { comment: Some(2), ..Default::default() })]),
            para(vec![t("kommentiert.", Marks { comment: Some(2), ..Default::default() })]),
        ],
        comments: vec![
            Comment { id: 1, author: "Niklas Linz".into(), date: "2026-11-18T07:00:00Z".into(), text: "Bitte prüfen".into() },
            Comment { id: 2, author: "Niklas Linz".into(), date: String::new(), text: "Zweizeilig\nZweite Zeile".into() },
        ],
        different_first: true,
        header: vec![para(vec![t("Kopf", Marks::default())])],
        header_first: vec![para(vec![t("Titelseite", Marks::default())])],
        ..Default::default()
    };
    let bytes = docx::write(&doc).unwrap();
    if let Ok(dir) = std::env::var("NEXORA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/features.docx"), &bytes).unwrap();
    }
    let again = docx::read(&bytes).unwrap();
    assert!(again.warnings.is_empty(), "{:?}", again.warnings);
    let d = again.document;
    assert_eq!(d.blocks, doc.blocks);
    assert_eq!(d.comments, doc.comments);
    assert!(d.different_first);
    assert_eq!(d.header_first, doc.header_first);
    assert_eq!(d.header, doc.header);
}
