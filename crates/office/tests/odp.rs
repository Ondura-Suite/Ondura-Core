use ondura_office::{odp, pptx};
use pptx::*;

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.6
}

#[test]
fn odp_round_trip() {
    let mut p = pptx::read(include_bytes!("fixtures/sample.pptx"))
        .expect("fixture")
        .presentation;
    // Features of the editor on an extra slide.
    let run = |t: &str| Run {
        text: t.into(),
        size: Some(24.0),
        color: Some("#1f3864".into()),
        ..Default::default()
    };
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let shapes = vec![
        Shape {
            id: 2,
            kind: "text".into(),
            placeholder: Some("title".into()),
            x: 60.0,
            y: 30.0,
            w: 1100.0,
            h: 90.0,
            paragraphs: vec![Para {
                runs: vec![Run {
                    bold: true,
                    ..run("Titel")
                }],
                ..Default::default()
            }],
            ..Default::default()
        },
        Shape {
            id: 3,
            kind: "text".into(),
            x: 60.0,
            y: 140.0,
            w: 600.0,
            h: 300.0,
            paragraphs: vec![
                Para {
                    bullet: Some("•".into()),
                    runs: vec![run("Punkt")],
                    ..Default::default()
                },
                Para {
                    bullet: Some("•".into()),
                    level: 1,
                    runs: vec![Run {
                        italic: true,
                        ..run("Unterpunkt")
                    }],
                    ..Default::default()
                },
                Para {
                    bullet: Some("#".into()),
                    runs: vec![run("Nummer")],
                    ..Default::default()
                },
                Para {
                    align: Some("center".into()),
                    runs: vec![run("Mitte")],
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
        Shape {
            id: 4,
            kind: "rightArrow".into(),
            x: 700.0,
            y: 140.0,
            w: 200.0,
            h: 100.0,
            fill: Some("#70ad47".into()),
            line: Some("#000000".into()),
            line_width: 2.0,
            rotation: 30.0,
            anchor: Some("middle".into()),
            paragraphs: vec![Para {
                runs: vec![run("Los")],
                ..Default::default()
            }],
            ..Default::default()
        },
        Shape {
            id: 5,
            kind: "image".into(),
            x: 950.0,
            y: 140.0,
            w: 200.0,
            h: 120.0,
            src: Some(png.into()),
            alt: Some("Produktvideo".into()),
            media: Some("data:video/mp4;base64,AAAAIGZ0eXBpc29t".into()),
            media_kind: Some("video".into()),
            ..Default::default()
        },
        Shape {
            id: 6,
            kind: "line".into(),
            x: 60.0,
            y: 500.0,
            w: 400.0,
            h: 0.0,
            line: Some("#ff0000".into()),
            line_width: 3.0,
            ..Default::default()
        },
        Shape {
            id: 7,
            kind: "table".into(),
            x: 700.0,
            y: 400.0,
            w: 400.0,
            h: 80.0,
            table: Some(Table {
                cols: vec![200.0, 200.0],
                rows: vec![
                    TableRow {
                        h: 40.0,
                        cells: vec![
                            TableCell {
                                paragraphs: vec![Para {
                                    runs: vec![run("A")],
                                    ..Default::default()
                                }],
                                fill: Some("#4472c4".into()),
                                span: Some(2),
                                ..Default::default()
                            },
                            TableCell {
                                merged: true,
                                ..Default::default()
                            },
                        ],
                    },
                    TableRow {
                        h: 40.0,
                        cells: vec![
                            TableCell {
                                paragraphs: vec![Para {
                                    runs: vec![run("B")],
                                    ..Default::default()
                                }],
                                ..Default::default()
                            },
                            TableCell {
                                paragraphs: vec![Para {
                                    runs: vec![run("C")],
                                    ..Default::default()
                                }],
                                fill: Some("#dae3f3".into()),
                                ..Default::default()
                            },
                        ],
                    },
                ],
                ..Default::default()
            }),
            ..Default::default()
        },
    ];
    let anim =
        |shape, class: &str, effect: &str, trigger: &str, dir: Option<&str>, duration| Animation {
            shape,
            class: class.into(),
            path: None,
            effect: effect.into(),
            trigger: trigger.into(),
            dir: dir.map(String::from),
            duration,
            delay: 0,
        };
    p.slides.push(Slide {
        background: Some("#fff2cc".into()),
        notes: "Notiz\nzweite Zeile".into(),
        transition: Some(Transition {
            kind: "push".into(),
            dir: Some("u".into()),
            duration: 700,
            advance_after: None,
        }),
        animations: vec![
            anim(3, "entr", "fly", "click", Some("l"), 500),
            anim(4, "emph", "spin", "after", None, 1000),
            anim(4, "exit", "fade", "click", None, 500),
            Animation {
                shape: 6,
                class: "path".into(),
                effect: "down".into(),
                path: Some("M 0 0 L 0 0.25 E".into()),
                trigger: "after".into(),
                dir: None,
                duration: 1500,
                delay: 0,
            },
        ],
        shapes,
        ..Default::default()
    });
    let bytes = odp::write(&p).expect("write");
    if let Ok(dir) = std::env::var("ONDURA_OFFICE_OUT") {
        std::fs::write(format!("{dir}/test.odp"), &bytes).unwrap();
    }
    let l = odp::read(&bytes).expect("read");
    assert!(l.warnings.is_empty(), "{:?}", l.warnings);
    let q = l.presentation;
    assert!(near(q.width, p.width) && near(q.height, p.height));
    assert_eq!(q.slides.len(), p.slides.len());
    for (a, b) in q.slides.iter().zip(&p.slides) {
        let master_bg = p.master.as_ref().and_then(|m| m.background.clone());
        assert_eq!(a.background, b.background.clone().or(master_bg));
        assert_eq!(a.notes.trim(), b.notes.trim());
        let shapes: Vec<&Shape> = b.shapes.iter().filter(|s| s.kind != "chart").collect();
        assert_eq!(a.shapes.len(), shapes.len());
        for (x, y) in a.shapes.iter().zip(shapes) {
            assert_eq!(x.kind, y.kind);
            assert!(
                near(x.x, y.x) && near(x.y, y.y) && near(x.w, y.w) && near(x.h, y.h),
                "{x:?} vs {y:?}"
            );
            assert!((x.rotation - y.rotation).abs() < 0.1);
            assert_eq!(x.fill, y.fill);
            assert_eq!(x.line, y.line);
            assert_eq!(x.src, y.src);
            assert_eq!(x.media, y.media);
            let texts = |s: &Shape| {
                s.paragraphs
                    .iter()
                    .map(|p| {
                        (
                            p.bullet.clone(),
                            p.level,
                            p.align.clone(),
                            p.runs
                                .iter()
                                .map(|r| {
                                    (r.text.clone(), r.bold, r.italic, r.size, r.color.clone())
                                })
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect::<Vec<_>>()
            };
            assert_eq!(texts(x), texts(y));
            if let (Some(t), Some(u)) = (&x.table, &y.table) {
                assert_eq!(t.rows.len(), u.rows.len());
                assert_eq!(t.rows[0].cells[0].span, Some(2));
                assert!(t.rows[0].cells[1].merged);
                assert_eq!(t.rows[1].cells[1].fill.as_deref(), Some("#dae3f3"));
            }
        }
    }
    let last = q.slides.last().unwrap();
    assert_eq!(last.transition, p.slides.last().unwrap().transition);
    assert_eq!(last.animations, p.slides.last().unwrap().animations);
}
