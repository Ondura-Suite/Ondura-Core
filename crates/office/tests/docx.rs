use ondura_office::docx::{self, Block, Inline, Paragraph};

fn sample() -> docx::Loaded {
    docx::read(include_bytes!("fixtures/sample.docx")).expect("parse fixture")
}

fn paragraphs(blocks: &[Block]) -> Vec<&Paragraph> {
    blocks
        .iter()
        .filter_map(|b| {
            if let Block::Paragraph(p) = b {
                Some(p)
            } else {
                None
            }
        })
        .collect()
}

fn text(p: &Paragraph) -> String {
    p.content
        .iter()
        .filter_map(|i| {
            if let Inline::Text { text, .. } = i {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect()
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
    let bold = p.content.iter().find_map(|i| match i {
        Inline::Text { text, marks } if marks.bold => Some(text.clone()),
        _ => None,
    });
    assert_eq!(bold.as_deref(), Some("fett"));
    assert!(p.content.iter().any(|i| matches!(i, Inline::Text { marks, .. } if marks.color.as_deref() == Some("#c00000") && marks.italic)));
    assert!(p.content.iter().any(|i| matches!(i, Inline::Text { marks, .. } if marks.size == Some(16.0) && marks.font.as_deref() == Some("Arial"))));

    let lists: Vec<_> = ps
        .iter()
        .filter_map(|p| p.list.map(|l| (text(p), l.ordered, l.level)))
        .collect();
    assert_eq!(
        lists,
        vec![
            ("Punkt A".into(), false, 0),
            ("Punkt B".into(), false, 0),
            ("Erstens".into(), true, 0)
        ]
    );

    let table = d
        .blocks
        .iter()
        .find_map(|b| {
            if let Block::Table(t) = b {
                Some(t)
            } else {
                None
            }
        })
        .expect("table");
    assert_eq!(table.rows.len(), 3);
    assert_eq!(table.rows[0].cells[0].col_span, 2);
    assert_eq!(table.rows[1].cells[2].row_span, 2);
    assert_eq!(table.rows[2].cells.len(), 2);

    let idx = d
        .blocks
        .iter()
        .position(|b| matches!(b, Block::PageBreak))
        .expect("page break");
    assert!(matches!(&d.blocks[idx - 1], Block::Paragraph(p) if text(p) == "Vor Umbruch"));
    assert!(matches!(&d.blocks[idx + 1], Block::Paragraph(p) if text(p) == "Nach Umbruch"));
    assert!(ps.iter().any(|p| p.content.iter().any(|i| matches!(i, Inline::Image { src, width, .. } if src.starts_with("data:image/png;base64,") && (*width - 75.6).abs() < 1.0))));
    assert_eq!(text(paragraphs(&d.header)[0]), "Kopfzeile Ondura");
}

#[test]
fn round_trip_is_lossless_for_the_model() {
    let mut d = sample().document;
    d.footer = vec![Block::Paragraph(Paragraph {
        align: Some("center".into()),
        content: vec![
            Inline::Text {
                text: "Seite ".into(),
                marks: Default::default(),
            },
            Inline::Field {
                field: "page".into(),
                result: String::new(),
            },
        ],
        ..Default::default()
    })];
    let bytes = docx::write(&d).expect("write");
    let again = docx::read(&bytes).expect("re-read").document;
    assert_eq!(again.blocks, d.blocks);
    assert_eq!(again.header, d.header);
    assert_eq!(again.footer, d.footer);
    assert_eq!(again.page, d.page);
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/roundtrip.docx"), &bytes).unwrap();
    }
}

#[test]
fn ordered_lists_restart() {
    let p = |t: &str, ordered: bool| {
        Block::Paragraph(Paragraph {
            list: Some(docx::ListRef { ordered, level: 0 }),
            content: vec![Inline::Text {
                text: t.into(),
                marks: Default::default(),
            }],
            ..Default::default()
        })
    };
    let d = docx::Document {
        blocks: vec![
            p("a", true),
            p("b", true),
            Block::Paragraph(Paragraph::default()),
            p("c", true),
        ],
        ..Default::default()
    };
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
    let t = |text: &str, marks: Marks| Inline::Text {
        text: text.into(),
        marks,
    };
    let rev = Revision {
        author: "Niklas".into(),
        date: "2026-11-18T07:00:00Z".into(),
    };
    let para = |content: Vec<Inline>| {
        Block::Paragraph(Paragraph {
            content,
            ..Default::default()
        })
    };
    let doc = docx::Document {
        blocks: vec![
            Block::Toc {
                title: Some("Inhalt".into()),
                entries: vec![
                    TocEntry {
                        level: 1,
                        text: "Einleitung".into(),
                        page: 1,
                    },
                    TocEntry {
                        level: 2,
                        text: "Details".into(),
                        page: 2,
                    },
                ],
                caption: None,
            },
            Block::Paragraph(Paragraph {
                style: Some("heading1".into()),
                content: vec![t("Einleitung", Marks::default())],
                ..Default::default()
            }),
            para(vec![
                t("Ein ", Marks::default()),
                t(
                    "kommentierter",
                    Marks {
                        comment: Some(1),
                        ..Default::default()
                    },
                ),
                t(
                    " Satz",
                    Marks {
                        comment: Some(1),
                        bold: true,
                        ..Default::default()
                    },
                ),
                Inline::Footnote {
                    text: "Quelle: Handbuch".into(),
                    endnote: false,
                },
                t(" mit ", Marks::default()),
                t(
                    "neuem",
                    Marks {
                        ins: Some(rev.clone()),
                        ..Default::default()
                    },
                ),
                t(
                    "altem",
                    Marks {
                        del: Some(rev.clone()),
                        ..Default::default()
                    },
                ),
                t(" Text.", Marks::default()),
            ]),
            para(vec![t(
                "Über zwei Absätze",
                Marks {
                    comment: Some(2),
                    ..Default::default()
                },
            )]),
            para(vec![t(
                "kommentiert.",
                Marks {
                    comment: Some(2),
                    ..Default::default()
                },
            )]),
        ],
        comments: vec![
            Comment {
                id: 1,
                author: "Niklas Linz".into(),
                date: "2026-11-18T07:00:00Z".into(),
                text: "Bitte prüfen".into(),
            },
            Comment {
                id: 2,
                author: "Niklas Linz".into(),
                date: String::new(),
                text: "Zweizeilig\nZweite Zeile".into(),
            },
        ],
        different_first: true,
        header: vec![para(vec![t("Kopf", Marks::default())])],
        header_first: vec![para(vec![t("Titelseite", Marks::default())])],
        ..Default::default()
    };
    let bytes = docx::write(&doc).unwrap();
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
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

#[test]
fn sections_and_endnotes() {
    use docx::{Marks, PageSetup};
    let t = |text: &str| Inline::Text {
        text: text.into(),
        marks: Marks::default(),
    };
    let para = |content: Vec<Inline>| {
        Block::Paragraph(Paragraph {
            content,
            ..Default::default()
        })
    };
    let landscape = PageSetup {
        width_mm: 297.0,
        height_mm: 210.0,
        ..Default::default()
    };
    let doc = docx::Document {
        blocks: vec![
            para(vec![
                t("Hochformat"),
                Inline::Footnote {
                    text: "Fußnote".into(),
                    endnote: false,
                },
            ]),
            Block::SectionBreak {
                page: PageSetup::default(),
            },
            para(vec![
                t("Querformat"),
                Inline::Footnote {
                    text: "Endnote eins".into(),
                    endnote: true,
                },
            ]),
            Block::SectionBreak {
                page: landscape.clone(),
            },
            para(vec![
                t("Wieder hoch"),
                Inline::Footnote {
                    text: "Endnote zwei".into(),
                    endnote: true,
                },
            ]),
        ],
        header: vec![para(vec![t("Kopf")])],
        ..Default::default()
    };
    let bytes = docx::write(&doc).expect("write");
    let back = docx::read(&bytes).expect("read");
    assert!(back.warnings.is_empty(), "{:?}", back.warnings);
    let breaks: Vec<_> = back
        .document
        .blocks
        .iter()
        .filter_map(|b| {
            if let Block::SectionBreak { page } = b {
                Some(page.clone())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(breaks.len(), 2);
    assert!((breaks[1].width_mm - 297.0).abs() < 0.5);
    let notes: Vec<(String, bool)> = back
        .document
        .blocks
        .iter()
        .filter_map(|b| {
            if let Block::Paragraph(p) = b {
                Some(p)
            } else {
                None
            }
        })
        .flat_map(|p| p.content.iter())
        .filter_map(|i| {
            if let Inline::Footnote { text, endnote } = i {
                Some((text.clone(), *endnote))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        notes,
        vec![
            ("Fußnote".into(), false),
            ("Endnote eins".into(), true),
            ("Endnote zwei".into(), true)
        ]
    );
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/sections.docx"), &bytes).unwrap();
    }
}

#[test]
fn captions_references_index_bibliography() {
    use docx::{IndexEntry, Source, TocEntry};
    let t = |s: &str| Inline::Text {
        text: s.into(),
        marks: Default::default(),
    };
    let field = |f: &str, r: &str| Inline::Field {
        field: f.into(),
        result: r.into(),
    };
    let mut doc = docx::Document::default();
    doc.sources.push(Source {
        tag: "Lin26".into(),
        kind: "book".into(),
        author: "Linz, Niklas; Muster, Max".into(),
        title: "Office in Rust".into(),
        year: "2026".into(),
        publisher: "MirraNET".into(),
        city: "Niederwürzbach".into(),
        ..Default::default()
    });
    doc.blocks = vec![
        Block::Paragraph(Paragraph {
            style: Some("caption".into()),
            content: vec![
                Inline::Bookmark {
                    name: "_Ref1".into(),
                    end: false,
                },
                t("Abbildung "),
                field("seq Abbildung", "1"),
                Inline::Bookmark {
                    name: "_Ref1".into(),
                    end: true,
                },
                t(": Übersicht"),
            ],
            ..Default::default()
        }),
        Block::Paragraph(Paragraph {
            content: vec![
                t("Siehe "),
                field("ref _Ref1", "Abbildung 1"),
                t(" und "),
                field("cite Lin26", "(Linz, 2026)"),
                field("xe Rust", ""),
                t(", Stand "),
                field("date", "18.11.2026"),
                t(", "),
                field("merge Vorname", ""),
            ],
            ..Default::default()
        }),
        Block::Toc {
            title: Some("Abbildungsverzeichnis".into()),
            entries: vec![TocEntry {
                level: 1,
                text: "Abbildung 1: Übersicht".into(),
                page: 1,
            }],
            caption: Some("Abbildung".into()),
        },
        Block::Index {
            entries: vec![IndexEntry {
                term: "Rust".into(),
                pages: "1".into(),
            }],
        },
        Block::Bibliography {
            title: Some("Literaturverzeichnis".into()),
            entries: vec![
                "Linz, N., & Muster, M. (2026). Office in Rust. Niederwürzbach: MirraNET.".into(),
            ],
        },
    ];
    let bytes = docx::write(&doc).unwrap();
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/refs.docx"), &bytes).unwrap();
    }
    let back = docx::read(&bytes).unwrap().document;
    assert_eq!(back.sources, doc.sources);
    let p0 = match &back.blocks[0] {
        Block::Paragraph(p) => p,
        b => panic!("{b:?}"),
    };
    assert_eq!(p0.style.as_deref(), Some("caption"));
    assert!(p0.content.contains(&Inline::Bookmark {
        name: "_Ref1".into(),
        end: false
    }));
    assert!(p0.content.contains(&field("seq Abbildung", "1")));
    let p1 = match &back.blocks[1] {
        Block::Paragraph(p) => p,
        b => panic!("{b:?}"),
    };
    for f in [
        "ref _Ref1",
        "cite Lin26",
        "xe Rust",
        "date",
        "merge Vorname",
    ] {
        assert!(
            p1.content
                .iter()
                .any(|i| matches!(i, Inline::Field { field, .. } if field == f)),
            "{f}: {:?}",
            p1.content
        );
    }
    assert!(p1.content.contains(&field("ref _Ref1", "Abbildung 1")));
    assert!(
        back.blocks
            .iter()
            .any(|b| matches!(b, Block::Index { entries } if entries[0].term == "Rust"))
    );
    assert!(
        back.blocks
            .iter()
            .any(|b| matches!(b, Block::Bibliography { entries, .. } if entries.len() == 1))
    );

    let odt = ondura_office::odt::write(&doc).unwrap();
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/refs.odt"), &odt).unwrap();
    }
    let o = ondura_office::odt::read(&odt).unwrap().document;
    assert_eq!(o.sources.len(), 1);
    assert_eq!(o.sources[0].title, "Office in Rust");
    let q0 = match &o.blocks[0] {
        Block::Paragraph(p) => p,
        b => panic!("{b:?}"),
    };
    assert_eq!(q0.style.as_deref(), Some("caption"));
    assert!(q0.content.contains(&field("seq Abbildung", "1")));
    assert!(
        o.blocks
            .iter()
            .any(|b| matches!(b, Block::Toc { caption: Some(c), .. } if c == "Abbildung"))
    );
    assert!(o.blocks.iter().any(
        |b| matches!(b, Block::Index { entries } if entries.iter().any(|e| e.term == "Rust"))
    ));
    assert!(
        o.blocks
            .iter()
            .any(|b| matches!(b, Block::Bibliography { .. }))
    );
}

fn controls() -> Vec<Inline> {
    let c = |kind: &str, title: &str, value: &str| Inline::Control {
        kind: kind.into(),
        title: title.into(),
        value: value.into(),
        checked: false,
        items: vec![],
        format: String::new(),
        placeholder: false,
        marks: Default::default(),
    };
    let mut check = c("checkbox", "Zustimmung", "");
    if let Inline::Control { checked, .. } = &mut check {
        *checked = true;
    }
    let mut list = c("dropdown", "Abteilung", "Technik");
    if let Inline::Control { items, .. } = &mut list {
        *items = vec!["Technik".into(), "Vertrieb".into()];
    }
    let mut date = c("date", "Datum", "18.11.2026");
    if let Inline::Control { format, .. } = &mut date {
        *format = "dd.MM.yyyy".into();
    }
    let mut empty = c("text", "Name", "Klicken Sie hier, um Text einzugeben.");
    if let Inline::Control { placeholder, .. } = &mut empty {
        *placeholder = true;
    }
    vec![c("text", "Firma", "MirraNET"), check, list, date, empty]
}

#[test]
fn content_controls() {
    let doc = docx::Document {
        blocks: vec![Block::Paragraph(Paragraph {
            content: controls(),
            ..Default::default()
        })],
        ..Default::default()
    };
    let bytes = docx::write(&doc).unwrap();
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/controls.docx"), &bytes).unwrap();
    }
    let back = docx::read(&bytes).unwrap().document;
    let p = paragraphs(&back.blocks)[0];
    assert_eq!(p.content, controls());
}

fn styled() -> Vec<docx::StyleDef> {
    vec![
        docx::StyleDef {
            id: "heading1".into(),
            font: Some("Georgia".into()),
            size: Some(24.0),
            color: Some("#c00000".into()),
            bold: Some(false),
            space_before: Some(12.0),
            ..Default::default()
        },
        docx::StyleDef {
            id: "normal".into(),
            space_after: Some(6.0),
            align: Some("justify".into()),
            ..Default::default()
        },
        docx::StyleDef {
            id: "quote".into(),
            italic: Some(false),
            align: Some("left".into()),
            ..Default::default()
        },
    ]
}

#[test]
fn modified_styles() {
    let doc = docx::Document {
        styles: styled(),
        ..Default::default()
    };
    let bytes = docx::write(&doc).unwrap();
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/styles.docx"), &bytes).unwrap();
    }
    let mut back = docx::read(&bytes).unwrap().document.styles;
    back.sort_by(|a, b| a.id.cmp(&b.id));
    let mut want = styled();
    want.sort_by(|a, b| a.id.cmp(&b.id));
    assert_eq!(back, want);
    // A document with Ondura's own styles has no differences.
    let plain = docx::write(&docx::Document::default()).unwrap();
    assert!(docx::read(&plain).unwrap().document.styles.is_empty());
    println!("{:?}", sample().document.styles);
}
