use ondura_office::docx::{
    self, Block, Comment, Inline, ListRef, Marks, PageSetup, Paragraph, Revision, TocEntry,
};
use ondura_office::odt;

fn para(text: &str) -> Paragraph {
    Paragraph {
        content: vec![Inline::Text {
            text: text.into(),
            marks: Marks::default(),
        }],
        ..Default::default()
    }
}

/// The Word fixture plus the features only reachable from the editor.
fn document() -> docx::Document {
    let mut d = docx::read(include_bytes!("fixtures/sample.docx"))
        .expect("fixture")
        .document;
    let rev = Revision {
        author: "Niklas".into(),
        date: "2026-11-18T08:00:00Z".into(),
    };
    let mut extra = vec![
        Block::Toc {
            title: Some("Inhalt".into()),
            entries: vec![
                TocEntry {
                    level: 1,
                    text: "Überschrift Eins".into(),
                    page: 1,
                },
                TocEntry {
                    level: 2,
                    text: "Teil".into(),
                    page: 2,
                },
            ],
            caption: None,
        },
        Block::Paragraph(Paragraph {
            content: vec![
                Inline::Text {
                    text: "Mit  zwei Leerzeichen".into(),
                    marks: Marks::default(),
                },
                Inline::Footnote {
                    text: "Fußnote".into(),
                    endnote: false,
                },
                Inline::Text {
                    text: " und ".into(),
                    marks: Marks::default(),
                },
                Inline::Footnote {
                    text: "Endnote\nzweite Zeile".into(),
                    endnote: true,
                },
                Inline::Tab,
                Inline::Text {
                    text: "Link".into(),
                    marks: Marks {
                        link: Some("https://mirranet.de".into()),
                        underline: true,
                        ..Default::default()
                    },
                },
                Inline::Text {
                    text: " kommentiert".into(),
                    marks: Marks {
                        comment: Some(1),
                        ..Default::default()
                    },
                },
                Inline::Text {
                    text: " neu".into(),
                    marks: Marks {
                        ins: Some(rev.clone()),
                        ..Default::default()
                    },
                },
                Inline::Text {
                    text: " alt".into(),
                    marks: Marks {
                        del: Some(rev.clone()),
                        ..Default::default()
                    },
                },
                Inline::Text {
                    text: "x".into(),
                    marks: Marks {
                        superscript: true,
                        highlight: Some("#ffff00".into()),
                        ..Default::default()
                    },
                },
            ],
            ..Default::default()
        }),
        Block::Paragraph(Paragraph {
            list: Some(ListRef {
                ordered: true,
                level: 0,
            }),
            ..para("Eins")
        }),
        Block::Paragraph(Paragraph {
            list: Some(ListRef {
                ordered: false,
                level: 1,
            }),
            ..para("Unterpunkt")
        }),
        Block::Paragraph(Paragraph {
            list: Some(ListRef {
                ordered: true,
                level: 0,
            }),
            ..para("Zwei")
        }),
        Block::Paragraph(Paragraph {
            style: Some("quote".into()),
            space_before_pt: Some(6.0),
            line_height: Some(1.5),
            indent_mm: 10.0,
            ..para("Zitat")
        }),
        Block::SectionBreak {
            page: PageSetup::default(),
        },
        Block::Paragraph(Paragraph {
            style: Some("title".into()),
            ..para("Anhang quer")
        }),
    ];
    d.blocks.append(&mut extra);
    // ODF stores lengths with limited precision.
    for b in &mut d.blocks {
        if let Block::Table(t) = b {
            t.columns_mm
                .iter_mut()
                .for_each(|w| *w = (*w * 10.0).round() / 10.0);
        }
    }
    d.page = PageSetup {
        width_mm: 297.0,
        height_mm: 210.0,
        ..PageSetup::default()
    };
    d.comments = vec![Comment {
        id: 1,
        author: "Niklas".into(),
        date: "2026-11-18T08:00:00Z".into(),
        text: "Bitte prüfen".into(),
    }];
    d.title = "ODF-Test".into();
    d.author = "Niklas Linz".into();
    d
}

#[test]
fn odt_round_trip() {
    let d = document();
    let bytes = odt::write(&d).expect("write");
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/test.odt"), &bytes).unwrap();
    }
    let l = odt::read(&bytes).expect("read");
    let again = l.document;
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
    assert_eq!(again.title, d.title);
    assert_eq!(again.author, d.author);
    assert_eq!(again.comments, d.comments);
    for (a, b) in again.blocks.iter().zip(&d.blocks) {
        assert_eq!(a, b);
    }
    assert_eq!(again.blocks.len(), d.blocks.len());
    assert_eq!(again.header, d.header);
    assert_eq!(again.footer, d.footer);
    let near = |a: f64, b: f64| (a - b).abs() < 0.1;
    assert!(
        near(again.page.width_mm, 297.0)
            && near(again.page.margin_top_mm, d.page.margin_top_mm)
            && near(again.page.header_mm, d.page.header_mm),
        "{:?}",
        again.page
    );
}
