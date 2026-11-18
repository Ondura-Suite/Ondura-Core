// Accessibility checks for Ondura Präsentation (following PowerPoint's
// checker): slide titles, alternative texts, contrast.

import { contrastTooLow, type A11yIssue } from "../../shell/a11y";
import type { Presentation, Shape } from "./model";

export interface SlideCheckActions {
  select: (slide: number, shape?: number) => void;
  editAlt: (slide: number, shape: number, current: string) => void;
}

const isTitle = (s: Shape) => s.placeholder === "title" || s.placeholder === "ctrTitle";
const text = (s: Shape) => s.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim();

export function checkPresentation(pres: Presentation, a: SlideCheckActions): A11yIssue[] {
  const issues: A11yIssue[] = [];
  let seq = 0;
  const id = () => `p${seq++}`;
  const titles = new Map<string, number[]>();
  pres.slides.forEach((slide, i) => {
    const n = `Folie ${i + 1}`;
    const title = slide.shapes.find((s) => isTitle(s) && text(s));
    if (!title) {
      issues.push({
        id: id(),
        severity: "error",
        rule: "Fehlender Folientitel",
        where: n,
        help: "Bildschirmleser nutzen Folientitel zum Navigieren. Geben Sie jeder Folie einen Titel – auch ausgeblendet, wenn er nicht sichtbar sein soll.",
        select: () => a.select(i),
      });
    } else {
      const t = text(title).toLowerCase();
      titles.set(t, [...(titles.get(t) ?? []), i]);
    }
    const bg = slide.background ?? pres.master?.background ?? "#ffffff";
    for (const s of slide.shapes) {
      if ((s.kind === "image" || s.kind === "smartart") && !s.alt?.trim()) {
        issues.push({
          id: id(),
          severity: "error",
          rule: "Fehlender Alternativtext",
          where: `${n}: ${s.name || (s.media ? "Video" : s.kind === "smartart" ? "SmartArt" : "Bild")}`,
          help: "Beschreiben Sie, was das Objekt zeigt, damit Personen mit Bildschirmleser den Inhalt verstehen.",
          select: () => a.select(i, s.id),
          fix: { label: "Alternativtext hinzufügen", run: () => a.editAlt(i, s.id, "") },
        });
      }
      const back = s.fill && s.fill !== "none" ? s.fill : bg;
      const run = s.paragraphs.flatMap((p) => p.runs.map((r) => ({ r, size: r.size ?? p.size ?? 18 }))).find(({ r }) => r.text.trim() && r.color && contrastTooLow(r.color, back, r.size, !!r.bold));
      if (run) {
        issues.push({
          id: id(),
          severity: "warning",
          rule: "Schwer lesbarer Textkontrast",
          where: `${n}: „${run.r.text.trim().slice(0, 30)}“`,
          help: "Der Kontrast zwischen Text und Hintergrund ist kleiner als 4,5:1 (große Schrift 3:1). Wählen Sie eine kräftigere Schrift- oder Füllfarbe.",
          select: () => a.select(i, s.id),
        });
      }
    }
  });
  for (const [t, list] of titles) {
    if (list.length < 2) continue;
    issues.push({
      id: id(),
      severity: "warning",
      rule: "Doppelter Folientitel",
      where: `„${t.slice(0, 40)}“ (Folien ${list.map((i) => i + 1).join(", ")})`,
      help: "Gleiche Titel machen es schwer, Folien zu unterscheiden. Ergänzen Sie z. B. „(Fortsetzung)“ oder „Teil 2“.",
      select: () => a.select(list[1]),
    });
  }
  return issues;
}
