import { useEffect, useRef, useState } from "react";
import { Avatar, Input, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { pim } from "../../lib/pim";
import { api } from "../../lib/api";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  wrap: { position: "relative", flex: 1, minWidth: 0, display: "flex" },
  list: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 10,
    minWidth: "320px",
    maxWidth: "100%",
    marginTop: "2px",
    padding: "4px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
  },
  item: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px", borderRadius: tokens.borderRadiusSmall, cursor: "pointer" },
  active: { backgroundColor: tokens.colorNeutralBackground1Hover },
  text: { display: "flex", flexDirection: "column", minWidth: 0 },
  mail: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export interface Suggestion {
  name: string;
  email: string;
  /** Job title / department from the directory. */
  detail?: string;
  isGroup?: boolean;
}

/** Address book contacts first, then the directory (global address list)
 * and frequent correspondents, without duplicates. */
export async function suggestPeople(query: string, limit = 10): Promise<Suggestion[]> {
  const [contacts, people] = await Promise.all([pim.suggest(query).catch(() => []), api.searchPeople(query, limit).catch(() => [])]);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (seen.has(c.email.toLowerCase())) continue;
    seen.add(c.email.toLowerCase());
    out.push({ name: c.name, email: c.email });
  }
  for (const p of people) {
    if (seen.has(p.email.toLowerCase())) continue;
    seen.add(p.email.toLowerCase());
    const detail = p.isGroup ? tl("Gruppe") : [p.jobTitle, p.department, p.office].filter(Boolean).join(" · ");
    out.push({ name: p.name, email: p.email, detail: detail || undefined, isGroup: p.isGroup });
  }
  return out.slice(0, limit);
}

/** Comma-separated address field with suggestions from the address books. */
export function RecipientInput({ value, onChange, className, autoFocus }: { value: string; onChange: (v: string) => void; className?: string; autoFocus?: boolean }) {
  const s = useStyles();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  const token = value.split(/[,;]/).pop()!.trim();

  useEffect(() => {
    if (token.length < 2 || token.includes(">")) {
      setItems([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      suggestPeople(token).then(
        (r) => n === seq.current && (setItems(r), setActive(0)),
        () => setItems([]),
      );
    }, 120);
    return () => clearTimeout(t);
  }, [token]);

  const pick = (sug: Suggestion) => {
    const parts = value.split(/[,;]/);
    parts.pop();
    const head = parts.map((p) => p.trim()).filter(Boolean);
    const name = sug.name.replace(/[,;<>"]/g, " ").trim();
    const addr = name && name !== sug.email ? `${name} <${sug.email}>` : sug.email;
    onChange([...head, addr].join(", ") + ", ");
    setItems([]);
  };

  return (
    <div className={s.wrap}>
      <Input
        appearance="underline"
        className={className}
        style={{ flex: 1 }}
        value={value}
        autoFocus={autoFocus}
        onChange={(_, d) => onChange(d.value)}
        onBlur={() => setTimeout(() => setItems([]), 150)}
        onKeyDown={(e) => {
          if (!items.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => (a + 1) % items.length));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => (a - 1 + items.length) % items.length));
          else if (e.key === "Enter" || e.key === "Tab") (e.preventDefault(), pick(items[active]));
          else if (e.key === "Escape") setItems([]);
        }}
      />
      {items.length > 0 && (
        <div className={s.list} role="listbox">
          {items.map((it, i) => (
            <div
              key={it.email}
              role="option"
              aria-selected={i === active}
              className={mergeClasses(s.item, i === active && s.active)}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => (e.preventDefault(), pick(it))}
            >
              <Avatar name={it.name} size={28} color="colorful" />
              <span className={s.text}>
                <span>{it.name}</span>
                <span className={s.mail}>{it.email}</span>
                {it.detail && <span className={s.mail}>{it.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
