import { type Presentation, THEMES, newSlide, newTable } from "./model";

/** Demo presentation for the browser preview. */
export function samplePresentation(): Presentation {
  const t = THEMES[1];
  const s1 = newSlide(1280, 720, "title", t);
  s1.shapes[0].paragraphs = [{ align: "center", runs: [{ text: "Ondura 2027", size: 60, font: t.headingFont, color: t.title, bold: true }] }];
  s1.shapes[1].paragraphs = [{ align: "center", runs: [{ text: "Die Office-Suite von MirraNET", size: 26, font: t.font, color: t.text }] }];
  s1.shapes.push({ id: 10, kind: "roundRect", x: 540, y: 560, w: 200, h: 8, fill: t.accent, paragraphs: [] });
  s1.notes = "Begrüßung und kurzer Überblick.";
  const s2 = newSlide(1280, 720, "titleContent", t);
  s2.shapes[0].paragraphs = [{ runs: [{ text: "Was ist neu?", size: 40, font: t.headingFont, color: t.title }] }];
  s2.shapes[1].w = 640;
  s2.shapes[1].paragraphs = [
    { bullet: "•", runs: [{ text: "Ondura Mail: E-Mail, Kalender, Kontakte, Aufgaben", size: 26, font: t.font, color: t.text }] },
    { bullet: "•", runs: [{ text: "Text mit Seitenansicht und .docx", size: 26, font: t.font, color: t.text }] },
    { bullet: "•", level: 1, runs: [{ text: "Kopf- und Fußzeilen, Tabellen, Bilder", size: 22, font: t.font, color: t.text }] },
    { bullet: "•", runs: [{ text: "Tabellen mit ", size: 26, font: t.font, color: t.text }, { text: "180 Funktionen", size: 26, font: t.font, color: t.accent, bold: true }] },
    { bullet: "•", runs: [{ text: "Präsentation mit Referentenansicht", size: 26, font: t.font, color: t.text }] },
  ];
  s2.shapes.push({ id: 11, kind: "ellipse", x: 820, y: 230, w: 300, h: 300, fill: t.accent, anchor: "middle", paragraphs: [{ align: "center", runs: [{ text: "100 %", size: 44, bold: true, color: "#ffffff", font: t.headingFont }] }, { align: "center", runs: [{ text: "Office-Formate", size: 20, color: "#ffffff", font: t.font }] }] });
  s2.shapes.push({ id: 12, kind: "rightArrow", x: 740, y: 350, w: 70, h: 60, fill: "#c7c8f3", paragraphs: [] });
  s2.notes = "Die drei Office-Apps lesen und schreiben die Microsoft-Formate direkt.";
  const s3 = newSlide(1280, 720, "titleOnly", t);
  s3.shapes[0].paragraphs = [{ runs: [{ text: "Fahrplan", size: 40, font: t.headingFont, color: t.title }] }];
  ["Q1: Ondura Mail", "Q2: Text", "Q3: Tabellen", "Q4: Präsentation"].forEach((label, i) =>
    s3.shapes.push({ id: 20 + i, kind: "chevron", x: 90 + i * 280, y: 320, w: 270, h: 110, fill: i < 2 ? t.accent : "#a5a8f0", anchor: "middle", paragraphs: [{ align: "center", runs: [{ text: label, size: 20, bold: true, color: "#ffffff", font: t.font }] }] }),
  );
  s3.transition = { kind: "push", dir: "u", duration: 700 };
  s3.animations = [20, 21, 22, 23].map((id, i) => ({ shape: id, effect: "fly" as const, trigger: i === 0 ? ("click" as const) : ("after" as const), dir: "l", duration: 400 }));
  const s4 = newSlide(1280, 720, "titleOnly", t);
  s4.shapes[0].paragraphs = [{ runs: [{ text: "Zahlen 2026", size: 40, font: t.headingFont, color: t.title }] }];
  const table = newTable(4, 3, 520, t.accent);
  const rows = [
    ["App", "Nutzer", "Wachstum"],
    ["Ondura Mail", "1.240", "+18 %"],
    ["Text", "860", "+25 %"],
    ["Tabellen", "640", "+31 %"],
  ];
  table.rows.forEach((r, i) => r.cells.forEach((c, j) => (c.paragraphs = [{ align: j ? "right" : undefined, runs: [{ text: rows[i][j], size: 20, font: t.font }] }])));
  s4.shapes.push({ id: 30, kind: "table", x: 80, y: 200, w: 520, h: 200, paragraphs: [], table });
  s4.shapes.push({
    id: 31,
    kind: "chart",
    x: 650,
    y: 170,
    w: 560,
    h: 420,
    paragraphs: [],
    chart: {
      kind: "column",
      title: "Nutzer je Quartal",
      legend: "b",
      series: [
        { name: "Ondura Mail", categories: ["Q1", "Q2", "Q3", "Q4"], values: [820, 960, 1100, 1240] },
        { name: "Office-Apps", categories: ["Q1", "Q2", "Q3", "Q4"], values: [300, 520, 780, 1500] },
      ],
    },
  });
  s4.transition = { kind: "fade", duration: 700 };
  s4.animations = [
    { shape: 30, effect: "fade", trigger: "click", duration: 500 },
    { shape: 31, effect: "wipe", trigger: "after", dir: "b", duration: 700 },
    { shape: 31, class: "emph", effect: "pulse", trigger: "click", duration: 600 },
  ];
  return { width: 1280, height: 720, slides: [s1, s2, s3, s4], title: "Ondura 2027", author: "Niklas Linz" };
}
