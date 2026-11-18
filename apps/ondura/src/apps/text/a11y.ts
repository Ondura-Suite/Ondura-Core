// Accessibility checks for Ondura Text documents (the rules follow the
// Word accessibility checker).

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { contrastTooLow, vagueLinkText, type A11yIssue } from "../../shell/a11y";
import { tl } from "../../lib/i18n";

export interface TextCheckActions {
  /** Ask for an alternative text and store it on the image at `pos`. */
  editAlt: (pos: number, current: string) => void;
  /** Open the document properties (title). */
  editTitle: () => void;
}

function selectAt(editor: Editor, pos: number, node?: PMNode) {
  const chain = editor.chain().focus();
  if (node && (node.type.name === "image" || node.isAtom)) chain.setNodeSelection(pos);
  else chain.setTextSelection(pos + 1);
  chain.scrollIntoView().run();
}

export function checkText(editor: Editor, title: string, actions: TextCheckActions): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const doc = editor.state.doc;
  let images = 0;
  let tables = 0;
  let lastLevel = 0;
  let emptyRun = 0;
  let emptyRunStart = -1;
  let seq = 0;
  const id = () => `t${seq++}`;

  doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name !== "paragraph") {
      if (emptyRun >= 3) {
        const at = emptyRunStart;
        issues.push({
          id: id(),
          severity: "tip",
          rule: tl("Leere Absätze als Abstand"),
          where: tl("{0} leere Absätze", emptyRun),
          help: tl("Bildschirmleser lesen jeden leeren Absatz als „leer“ vor. Nutzen Sie stattdessen den Abstand vor/nach in den Absatzeinstellungen oder einen Seitenumbruch."),
          select: () => selectAt(editor, at),
        });
      }
      emptyRun = 0;
    }
    switch (name) {
      case "image": {
        images++;
        const alt = String(node.attrs.alt ?? "").trim();
        if (!alt) {
          issues.push({
            id: id(),
            severity: "error",
            rule: tl("Fehlender Alternativtext"),
            where: tl("Bild {0}", images),
            help: tl("Ohne Alternativtext erfahren Personen mit Bildschirmleser nicht, was das Bild zeigt. Beschreiben Sie Inhalt und Zweck in ein bis zwei Sätzen."),
            select: () => selectAt(editor, pos, node),
            fix: { label: tl("Alternativtext hinzufügen"), run: () => actions.editAlt(pos, "") },
          });
        }
        return false;
      }
      case "table": {
        tables++;
        const first = node.firstChild;
        const header = !!first && first.childCount > 0 && Array.from({ length: first.childCount }, (_, i) => first.child(i)).every((c) => c.type.name === "tableHeader");
        if (!header) {
          issues.push({
            id: id(),
            severity: "warning",
            rule: tl("Keine Kopfzeile in der Tabelle"),
            where: tl("Tabelle {0}", tables),
            help: tl("Mit einer Kopfzeile kann ein Bildschirmleser zu jeder Zelle sagen, zu welcher Spalte sie gehört."),
            select: () => selectAt(editor, pos + 2),
            fix: {
              label: tl("Erste Zeile als Kopfzeile"),
              run: () => {
                editor.chain().focus().setTextSelection(pos + 3).toggleHeaderRow().run();
              },
            },
          });
        }
        let merged = false;
        node.descendants((c) => {
          if ((c.attrs.colspan ?? 1) > 1 || (c.attrs.rowspan ?? 1) > 1) merged = true;
          return !merged;
        });
        if (merged) {
          issues.push({
            id: id(),
            severity: "warning",
            rule: tl("Verbundene Zellen"),
            where: tl("Tabelle {0}", tables),
            help: tl("Verbundene oder geteilte Zellen bringen die Navigation mit Bildschirmlesern durcheinander. Verwenden Sie möglichst eine einfache Tabellenstruktur."),
            select: () => selectAt(editor, pos + 2),
          });
        }
        return true;
      }
      case "heading": {
        const level = Number(node.attrs.level ?? 1);
        const text = node.textContent.trim();
        if (!text) {
          issues.push({
            id: id(),
            severity: "warning",
            rule: tl("Leere Überschrift"),
            where: tl("Überschrift {0}", level),
            help: tl("Leere Überschriften erscheinen in der Navigation und im Inhaltsverzeichnis. Füllen Sie sie aus oder wandeln Sie sie in normalen Text um."),
            select: () => selectAt(editor, pos),
          });
        } else if (lastLevel && level > lastLevel + 1) {
          issues.push({
            id: id(),
            severity: "warning",
            rule: tl("Übersprungene Überschriftenebene"),
            where: tl("„{0}“ (Ebene {1} nach {2})", text.slice(0, 40), level, lastLevel),
            help: tl("Überschriften sollten die Gliederung abbilden. Auf Überschrift 1 folgt Überschrift 2, nicht 3."),
            select: () => selectAt(editor, pos),
            fix: { label: tl("In Überschrift {0} ändern", lastLevel + 1), run: () => editor.chain().focus().setTextSelection(pos + 1).setHeading({ level: (lastLevel + 1) as 1 | 2 | 3 | 4 | 5 | 6 }).run() },
          });
        }
        if (text) lastLevel = level;
        break;
      }
      case "paragraph":
        if (node.childCount === 0) {
          if (emptyRun === 0) emptyRunStart = pos;
          emptyRun++;
        } else {
          if (emptyRun >= 3) {
            const at = emptyRunStart;
            const n = emptyRun;
            issues.push({
              id: id(),
              severity: "tip",
              rule: tl("Leere Absätze als Abstand"),
              where: tl("{0} leere Absätze", n),
              help: tl("Bildschirmleser lesen jeden leeren Absatz als „leer“ vor. Nutzen Sie stattdessen den Abstand vor/nach in den Absatzeinstellungen oder einen Seitenumbruch."),
              select: () => selectAt(editor, at),
            });
          }
          emptyRun = 0;
        }
        break;
      case "text": {
        const link = node.marks.find((m) => m.type.name === "link");
        if (link && vagueLinkText(node.text ?? "")) {
          issues.push({
            id: id(),
            severity: "tip",
            rule: tl("Wenig aussagekräftiger Linktext"),
            where: `„${(node.text ?? "").slice(0, 40)}“`,
            help: tl("Der Linktext sollte sagen, wohin der Link führt (z. B. „Preisliste 2027“ statt „hier“). Viele Personen springen mit dem Bildschirmleser von Link zu Link."),
            select: () => editor.chain().focus().setTextSelection({ from: pos, to: pos + node.nodeSize }).scrollIntoView().run(),
          });
        }
        const color = node.marks.find((m) => m.type.name === "textStyle")?.attrs.color as string | undefined;
        const bg = (node.marks.find((m) => m.type.name === "highlight")?.attrs.color as string | undefined) ?? "#ffffff";
        const bold = node.marks.some((m) => m.type.name === "bold");
        const size = parseFloat(String(node.marks.find((m) => m.type.name === "textStyle")?.attrs.fontSize ?? "11"));
        if (color && contrastTooLow(color, bg, size || 11, bold)) {
          issues.push({
            id: id(),
            severity: "warning",
            rule: tl("Schwer lesbarer Textkontrast"),
            where: `„${(node.text ?? "").slice(0, 40)}“`,
            help: tl("Der Kontrast zwischen Text und Hintergrund ist kleiner als 4,5:1 (WCAG 2.1). Wählen Sie eine dunklere Schriftfarbe."),
            select: () => editor.chain().focus().setTextSelection({ from: pos, to: pos + node.nodeSize }).scrollIntoView().run(),
            fix: { label: tl("Automatische Schriftfarbe"), run: () => editor.chain().focus().setTextSelection({ from: pos, to: pos + node.nodeSize }).unsetColor().run() },
          });
        }
        break;
      }
    }
    return true;
  });

  if (!title.trim()) {
    issues.push({
      id: id(),
      severity: "tip",
      rule: tl("Kein Dokumenttitel"),
      where: tl("Dokumenteigenschaften"),
      help: tl("Bildschirmleser und PDF-Betrachter zeigen den Titel statt des Dateinamens an."),
      fix: { label: tl("Titel festlegen"), run: actions.editTitle },
    });
  }
  // Combine contrast findings of neighbouring text nodes would be nicer;
  // keep at most 20 per rule so the pane stays usable.
  const perRule = new Map<string, number>();
  return issues.filter((i) => {
    const n = (perRule.get(i.rule) ?? 0) + 1;
    perRule.set(i.rule, n);
    return n <= 20;
  });
}
