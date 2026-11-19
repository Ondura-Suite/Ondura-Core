// Command search ("Was möchten Sie tun?") and the quick access toolbar of
// the office ribbon. Both work on the ribbon's DOM: every tab stays mounted,
// so each button can be found by its tab and label and clicked.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Input, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Search16Regular } from "@fluentui/react-icons";
import { tl } from "../lib/i18n";
import { openContextMenu } from "./contextMenu";

export interface QuickCommand {
  tab: string;
  label: string;
  /** SVG of the button's icon, copied when the command was added. */
  icon?: string;
}

const key = (app: string) => `ondura.quickAccess.${app}`;

export function loadQuick(app: string): QuickCommand[] {
  try {
    return JSON.parse(localStorage.getItem(key(app)) ?? "[]");
  } catch {
    return [];
  }
}

export function saveQuick(app: string, list: QuickCommand[]): QuickCommand[] {
  try {
    localStorage.setItem(key(app), JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

const labelOf = (b: HTMLElement) => (b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim();

/** The ribbon command under an element (for the context menu). */
export function commandOf(el: HTMLElement): QuickCommand | null {
  const button = el.closest("button");
  const tab = button?.closest<HTMLElement>("[data-ribbon-tab]");
  if (!button || !tab) return null;
  const label = labelOf(button);
  if (!label) return null;
  return { tab: tab.dataset.ribbonTab!, label, icon: button.querySelector("svg")?.outerHTML };
}

/** All commands of the ribbon with their tab and group. */
function allCommands(root: HTMLElement | null): (QuickCommand & { tabLabel: string; group: string })[] {
  if (!root) return [];
  const out: (QuickCommand & { tabLabel: string; group: string })[] = [];
  const seen = new Set<string>();
  for (const tab of root.querySelectorAll<HTMLElement>("[data-ribbon-tab]")) {
    for (const b of tab.querySelectorAll<HTMLButtonElement>("button")) {
      const label = labelOf(b);
      if (!label || label.length > 60) continue;
      const id = `${tab.dataset.ribbonTab}|${label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        tab: tab.dataset.ribbonTab!,
        tabLabel: tab.dataset.ribbonLabel ?? "",
        label,
        group: b.closest("[role=group]")?.getAttribute("aria-label") ?? "",
        icon: b.querySelector("svg")?.outerHTML,
      });
    }
  }
  return out;
}

/** Switch to the command's tab and press its button. */
export function runRibbonCommand(root: HTMLElement | null, cmd: QuickCommand, onTab: (id: string) => void) {
  onTab(cmd.tab);
  // After the tab became visible (menus need a visible anchor).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const tab = root?.querySelector<HTMLElement>(`[data-ribbon-tab="${CSS.escape(cmd.tab)}"]`);
      const button = [...(tab?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => labelOf(b) === cmd.label);
      if (button && !button.disabled) {
        button.focus();
        button.click();
      }
    }),
  );
}

const useStyles = makeStyles({
  qat: { display: "flex", alignItems: "center", gap: "1px", marginRight: "6px" },
  qbtn: {
    border: "none",
    background: "transparent",
    borderRadius: tokens.borderRadiusMedium,
    width: "26px",
    height: "26px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    "& svg": { width: "16px", height: "16px" },
  },
  search: { width: "220px", alignSelf: "center" },
  wrap: { position: "relative", display: "flex", alignItems: "center" },
  list: {
    position: "absolute",
    top: "100%",
    right: 0,
    zIndex: 100,
    width: "320px",
    maxHeight: "360px",
    overflowY: "auto",
    marginTop: "4px",
    padding: "4px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
  },
  item: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: tokens.borderRadiusSmall, cursor: "pointer", "& svg": { width: "16px", height: "16px", flexShrink: 0 } },
  active: { backgroundColor: tokens.colorNeutralBackground1Hover },
  where: { marginLeft: "auto", fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" },
});

export function QuickAccessBar({ items, onRun, onRemove }: { items: QuickCommand[]; onRun: (c: QuickCommand) => void; onRemove: (c: QuickCommand) => void }) {
  const s = useStyles();
  if (!items.length) return null;
  return (
    <div className={s.qat} role="toolbar" aria-label={tl("Symbolleiste für den Schnellzugriff")}>
      {items.map((q) => (
        <button
          key={`${q.tab}|${q.label}`}
          className={s.qbtn}
          title={q.label}
          aria-label={q.label}
          onClick={() => onRun(q)}
          onContextMenu={(e) => {
            e.stopPropagation();
            openContextMenu(e, [{ label: tl("Aus der Symbolleiste für den Schnellzugriff entfernen"), onClick: () => onRemove(q) }]);
          }}
        >
          {q.icon ? <span style={{ display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: q.icon }} /> : q.label.slice(0, 2)}
        </button>
      ))}
    </div>
  );
}

const norm = (t: string) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CommandSearch({ root, onRun }: { root: RefObject<HTMLElement | null>; onRun: (c: QuickCommand) => void }) {
  const s = useStyles();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Alt+Q jumps into the search, like in Office.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q || !open) return [];
    const words = q.split(/\s+/);
    return allCommands(root.current)
      .map((c) => ({ c, hay: norm(`${c.label} ${c.group} ${c.tabLabel}`), label: norm(c.label) }))
      .filter((x) => words.every((w) => x.hay.includes(w)))
      .sort((a, b) => Number(!a.label.startsWith(words[0])) - Number(!b.label.startsWith(words[0])) || a.label.length - b.label.length)
      .slice(0, 12)
      .map((x) => x.c);
  }, [query, open, root]);
  const pick = (c: QuickCommand) => {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    onRun(c);
  };
  return (
    <div className={s.wrap}>
      <Input
        ref={input}
        size="small"
        className={s.search}
        contentBefore={<Search16Regular />}
        placeholder={tl("Was möchten Sie tun?")}
        aria-label={tl("Befehl suchen")}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(_, d) => (setQuery(d.value), setActive(0), setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && results[active]) (e.preventDefault(), pick(results[active]));
          else if (e.key === "Escape") (setQuery(""), input.current?.blur());
        }}
      />
      {open && query.trim() && (
        <div className={s.list} role="listbox">
          {results.length === 0 && <div className={s.item}>{tl("Kein passender Befehl.")}</div>}
          {results.map((c, i) => (
            <div
              key={`${c.tab}|${c.label}`}
              role="option"
              aria-selected={i === active}
              className={mergeClasses(s.item, i === active && s.active)}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => (e.preventDefault(), pick(c))}
            >
              {c.icon && <span style={{ display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: c.icon }} />}
              <span>{c.label}</span>
              <span className={s.where}>
                {c.tabLabel}
                {c.group ? ` › ${c.group}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
