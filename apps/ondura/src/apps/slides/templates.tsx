// Built-in presentation templates for the start page ("Datei › Start" /
// "Neu"): an empty presentation, one per design and a sample deck.

import type { OfficeTemplate } from "../../shell/office";
import { tl } from "../../lib/i18n";
import { type DesignTheme, type Presentation, THEMES, emptyPresentation, newSlide } from "./model";
import { samplePresentation } from "./sample";
import { SlideThumb } from "./SlideView";

export interface SlidesTemplate {
  id: string;
  label: string;
  theme: DesignTheme;
  build: () => Presentation;
  /** Same deck with sample text, for the miniature. */
  preview: () => Presentation;
}

function themed(t: DesignTheme, withText: boolean): Presentation {
  const s = newSlide(1280, 720, "title", t);
  if (withText) {
    s.shapes[0].paragraphs = [{ align: "center", runs: [{ text: t.name, size: 60, font: t.headingFont, color: t.title }] }];
    s.shapes[1].paragraphs = [{ align: "center", runs: [{ text: tl("Präsentation"), size: 26, font: t.font, color: t.text }] }];
  }
  // A short accent rule gives each design its character.
  s.shapes.push({ id: 10, kind: "rect", x: 560, y: 382, w: 160, h: 6, fill: t.accent, paragraphs: [] });
  return { width: 1280, height: 720, slides: [s], title: "", author: "" };
}

function withTitle(p: Presentation, title: string): Presentation {
  const s = p.slides[0];
  s.shapes[0].paragraphs = [{ align: "center", runs: [{ text: title, size: 60, font: THEMES[0].headingFont, color: THEMES[0].title }] }];
  return p;
}

export const SLIDES_TEMPLATES: SlidesTemplate[] = [
  { id: "blank", label: tl("Leere Präsentation"), theme: THEMES[0], build: emptyPresentation, preview: () => withTitle(emptyPresentation(), tl("Titel")) },
  ...THEMES.slice(1).map((t) => ({ id: `theme-${t.id}`, label: tl("Design: {0}", t.name), theme: t, build: () => themed(t, false), preview: () => themed(t, true) })),
  { id: "sample", label: tl("Ondura 2027 (Beispiel)"), theme: THEMES[1], build: samplePresentation, preview: samplePresentation },
];

export function slidesTemplates(): OfficeTemplate[] {
  return SLIDES_TEMPLATES.map((t) => {
    const p = t.preview();
    return { id: t.id, label: t.label, preview: <SlideThumb slide={p.slides[0]} width={208} presWidth={p.width} presHeight={p.height} /> };
  });
}

export function findSlidesTemplate(id: string): SlidesTemplate | null {
  return SLIDES_TEMPLATES.find((t) => t.id === id) ?? null;
}
