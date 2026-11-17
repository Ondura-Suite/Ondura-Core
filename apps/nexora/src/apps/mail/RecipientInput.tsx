import { useEffect, useRef, useState } from "react";
import { Avatar, Input, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { pim } from "../../lib/pim";

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

interface Suggestion {
  name: string;
  email: string;
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
      pim.suggest(token).then(
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
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
