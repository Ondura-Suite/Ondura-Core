// Accessibility checker shared by Ondura Text, Tabellen and Präsentation:
// the issue model, colour-contrast helpers (WCAG 2.1) and the task pane
// that lists the findings with "select" and quick-fix actions.

import { useEffect, useState, type ReactElement } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowClockwise16Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  CheckmarkCircle24Regular,
  Dismiss16Regular,
  ErrorCircle16Filled,
  Info16Filled,
  Warning16Filled,
} from "@fluentui/react-icons";
import { tl } from "../lib/i18n";

export type Severity = "error" | "warning" | "tip";

export interface A11yIssue {
  id: string;
  severity: Severity;
  /** Group heading, e.g. "Fehlender Alternativtext". */
  rule: string;
  /** Where: "Bild 2", "Folie 3", "Tabelle1!B4". */
  where: string;
  /** Why it matters and how to fix it. */
  help: string;
  /** Select the object in the document. */
  select?: () => void;
  /** One-click fix. */
  fix?: { label: string; run: () => void };
}

// ------------------------------------------------------------- contrast --

/** `#rgb`/`#rrggbb` → [r, g, b] (0–255), or null. */
export function parseColor(c: string | null | undefined): [number, number, number] | null {
  if (!c) return null;
  const m = c.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) {
    const rgb = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  }
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1–21) of two colours; null if unknown. */
export function contrast(fg: string | null | undefined, bg: string | null | undefined): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Text needs 4.5:1, large text (≥ 18 pt, or 14 pt bold) 3:1. */
export function contrastTooLow(fg: string | null | undefined, bg: string | null | undefined, pt = 11, bold = false): boolean {
  const r = contrast(fg, bg);
  if (r === null) return false;
  const large = pt >= 18 || (bold && pt >= 14);
  return r < (large ? 3 : 4.5);
}

/** Link texts that say nothing about the target. */
export function vagueLinkText(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!:]+$/, "");
  return /^(hier|klicken sie hier|hier klicken|link|mehr|weiterlesen|click here|here|more|read more|https?:\/\/\S+)$/.test(t);
}

// ---------------------------------------------------------------- pane --

const useStyles = makeStyles({
  pane: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "330px",
    zIndex: 60,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    backdropFilter: "blur(40px) saturate(1.6)",
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow16,
  },
  head: { display: "flex", alignItems: "center", gap: "4px", padding: "10px 8px 6px 16px" },
  title: { flex: 1, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  body: { flex: 1, overflowY: "auto", padding: "0 8px 12px" },
  section: { marginTop: "8px" },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "6px 8px",
    font: "inherit",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    textAlign: "left",
    borderRadius: tokens.borderRadiusMedium,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  count: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  rule: { padding: "4px 8px 0 30px", fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  item: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    font: "inherit",
    padding: "4px 8px 4px 30px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  picked: { backgroundColor: tokens.colorBrandBackground2 },
  help: { padding: "4px 8px 8px 30px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" },
  ok: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "32px 16px", textAlign: "center", color: tokens.colorNeutralForeground2 },
});

const SECTIONS: { severity: Severity; label: string; icon: ReactElement }[] = [
  { severity: "error", label: tl("Fehler"), icon: <ErrorCircle16Filled color={tokens.colorPaletteRedForeground1} /> },
  { severity: "warning", label: tl("Warnungen"), icon: <Warning16Filled color={tokens.colorPaletteMarigoldForeground1} /> },
  { severity: "tip", label: tl("Tipps"), icon: <Info16Filled color={tokens.colorBrandForeground1} /> },
];

export function AccessibilityPane({ issues, onClose, onRefresh }: { issues: A11yIssue[]; onClose: () => void; onRefresh: () => void }) {
  const s = useStyles();
  const [open, setOpen] = useState<Record<Severity, boolean>>({ error: true, warning: true, tip: false });
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (picked && !issues.some((i) => i.id === picked)) setPicked(null);
  }, [issues, picked]);

  return (
    <aside className={s.pane} aria-label={tl("Barrierefreiheit")}>
      <div className={s.head}>
        <span className={s.title}>{tl("Barrierefreiheit")}</span>
        <Button size="small" appearance="subtle" icon={<ArrowClockwise16Regular />} aria-label={tl("Erneut prüfen")} title={tl("Erneut prüfen")} onClick={onRefresh} />
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={tl("Schließen")} onClick={onClose} />
      </div>
      <div className={s.body}>
        {issues.length === 0 ? (
          <div className={s.ok}>
            <CheckmarkCircle24Regular color={tokens.colorPaletteGreenForeground1} />
            <Text weight="semibold">{tl("Keine Probleme gefunden")}</Text>
            <Text size={200}>{tl("Menschen mit Behinderungen sollten keine Schwierigkeiten haben, dieses Dokument zu lesen.")}</Text>
          </div>
        ) : (
          SECTIONS.map(({ severity, label, icon }) => {
            const list = issues.filter((i) => i.severity === severity);
            if (!list.length) return null;
            const rules = [...new Set(list.map((i) => i.rule))];
            return (
              <div key={severity} className={s.section}>
                <button className={s.sectionHead} aria-expanded={open[severity]} onClick={() => setOpen((o) => ({ ...o, [severity]: !o[severity] }))}>
                  {open[severity] ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                  {icon}
                  {label} <span className={s.count}>({list.length})</span>
                </button>
                {open[severity] &&
                  rules.map((rule) => (
                    <div key={rule}>
                      <div className={s.rule}>{rule}</div>
                      {list
                        .filter((i) => i.rule === rule)
                        .map((i) => (
                          <div key={i.id}>
                            <button
                              className={`${s.item} ${picked === i.id ? s.picked : ""}`}
                              onClick={() => {
                                setPicked(i.id);
                                i.select?.();
                              }}
                            >
                              {i.where}
                            </button>
                            {picked === i.id && (
                              <div className={s.help}>
                                <span>{i.help}</span>
                                {i.fix && (
                                  <Button size="small" appearance="primary" onClick={i.fix.run}>
                                    {i.fix.label}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

/** Dialog to enter the alternative text of an object. */
export function AltTextDialog({ open, initial, onClose, onSave }: { open: boolean; initial: string; onClose: () => void; onSave: (alt: string) => void }) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Alternativtext")}</DialogTitle>
          <DialogContent>
            <Field label={tl("Beschreiben Sie das Objekt für blinde oder sehbehinderte Personen")} hint={tl("Ein bis zwei Sätze, die Inhalt und Zweck wiedergeben.")}>
              <Textarea rows={4} value={value} onChange={(_, d) => setValue(d.value)} autoFocus />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{tl("Abbrechen")}</Button>
            <Button appearance="primary" disabled={!value.trim()} onClick={() => onSave(value.trim())}>
              {tl("OK")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
