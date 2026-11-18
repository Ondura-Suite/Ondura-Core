import { useState } from "react";
import { Button, Input, Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger, ToolbarButton, makeStyles, tokens } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular, Tag24Regular } from "@fluentui/react-icons";
import { DEFAULT_CATEGORIES, categoryColor } from "../../lib/categories";

const useStyles = makeStyles({
  chips: { display: "flex", gap: "4px", flexWrap: "nowrap", flexShrink: 0, maxWidth: "60%", overflow: "hidden" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    height: "18px",
    padding: "0 6px",
    borderRadius: "9px",
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
  },
  dot: { width: "10px", height: "10px", borderRadius: "3px", display: "inline-block" },
  newRow: { display: "flex", gap: "4px", padding: "4px 8px" },
});

export function CategoryChips({ categories, size = "small" }: { categories?: string[]; size?: "small" | "medium" }) {
  const s = useStyles();
  if (!categories?.length) return null;
  return (
    <span className={s.chips}>
      {categories.map((c) => {
        const color = categoryColor(c);
        return (
          <span
            key={c}
            className={s.chip}
            style={{
              background: `color-mix(in srgb, ${color} 18%, transparent)`,
              color,
              height: size === "medium" ? 22 : undefined,
              fontSize: size === "medium" ? 12 : undefined,
            }}
          >
            {c}
          </span>
        );
      })}
    </span>
  );
}

export interface CategorizeMenuProps {
  current: string[];
  known: string[];
  disabled?: boolean;
  onChange: (categories: string[]) => void;
}

/** "Kategorisieren" in the ribbon. */
export function CategorizeMenu({ current, known, disabled, onChange }: CategorizeMenuProps) {
  const s = useStyles();
  const [name, setName] = useState("");
  const all = [...new Set([...DEFAULT_CATEGORIES, ...known, ...current])];
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...current.filter((c) => c.toLowerCase() !== n.toLowerCase()), n]);
    setName("");
  };
  return (
    <Menu
      checkedValues={{ cat: current }}
      onCheckedValueChange={(_, d) => onChange(all.filter((c) => d.checkedItems.includes(c)))}
    >
      <MenuTrigger disableButtonEnhancement>
        <ToolbarButton icon={<Tag24Regular />} disabled={disabled}>
          Kategorisieren
        </ToolbarButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {all.map((c) => (
            <MenuItemCheckbox key={c} name="cat" value={c} icon={<span className={s.dot} style={{ background: categoryColor(c) }} />}>
              {c}
            </MenuItemCheckbox>
          ))}
          <MenuDivider />
          <div className={s.newRow} onKeyDown={(e) => e.stopPropagation()}>
            <Input size="small" placeholder="Neue Kategorie" value={name} onChange={(_, d) => setName(d.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <Button size="small" icon={<Add16Regular />} onClick={add} aria-label="Hinzufügen" />
          </div>
          {current.length > 0 && (
            <MenuItem icon={<Dismiss16Regular />} onClick={() => onChange([])}>
              Alle Kategorien entfernen
            </MenuItem>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
