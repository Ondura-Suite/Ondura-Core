import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, Spinner, Text, ToolbarButton, makeStyles, tokens } from "@fluentui/react-components";
import { Add16Regular, Delete16Regular, Dismiss16Regular, Tag24Regular, TagMultiple16Regular } from "@fluentui/react-icons";
import { api, errorMessage } from "../../lib/api";
import { CATEGORY_PALETTE, DEFAULT_CATEGORIES, categoryColor, defaultCategoryColor, setCategoryColors } from "../../lib/categories";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  chips: { display: "flex", gap: "4px", flexWrap: "nowrap", flexShrink: 0, maxWidth: "60%", overflow: "hidden" },
  chip: { display: "inline-flex", alignItems: "center", gap: "4px", height: "18px", padding: "0 6px", borderRadius: "9px", fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, whiteSpace: "nowrap" },
  dot: { width: "10px", height: "10px", borderRadius: "3px", display: "inline-block" },
  newRow: { display: "flex", gap: "4px", padding: "4px 8px" },
  swatch: { width: "16px", height: "16px", borderRadius: "4px", display: "inline-block" },
  palette: { display: "grid", gridTemplateColumns: "repeat(3, 28px)", gap: "6px", padding: "8px" },
  paletteItem: { width: "28px", height: "28px", borderRadius: "6px", border: "none", cursor: "pointer", outlineOffset: "2px" },
  manager: { display: "flex", flexDirection: "column", gap: "10px" },
  list: { display: "flex", flexDirection: "column", gap: "4px", maxHeight: "320px", overflowY: "auto" },
  row: { display: "flex", alignItems: "center", gap: "6px" },
  name: { flex: 1 },
});

export function CategoryChips({ categories, size = "small" }: { categories?: string[]; size?: "small" | "medium" }) {
  const s = useStyles();
  if (!categories?.length) return null;
  return (
    <span className={s.chips}>
      {categories.map((c) => {
        const color = categoryColor(c);
        return (
          <span key={c} className={s.chip} style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color, height: size === "medium" ? 22 : undefined, fontSize: size === "medium" ? 12 : undefined }}>
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
  /** The category list changed in the manager (reload it). */
  onListChanged?: () => void;
}

/** "Kategorisieren" in the ribbon. */
export function CategorizeMenu({ current, known, disabled, onChange, onListChanged }: CategorizeMenuProps) {
  const s = useStyles();
  const [name, setName] = useState("");
  const [manage, setManage] = useState(false);
  const all = [...new Set([...(known.length ? known : DEFAULT_CATEGORIES), ...current])];
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...current.filter((c) => c.toLowerCase() !== n.toLowerCase()), n]);
    setName("");
  };
  return (
    <>
      <Menu checkedValues={{ cat: current }} onCheckedValueChange={(_, d) => onChange(all.filter((c) => d.checkedItems.includes(c)))}>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton icon={<Tag24Regular />} disabled={disabled}>
            {tl("Kategorisieren")}
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
              <Input size="small" placeholder={tl("Neue Kategorie")} value={name} onChange={(_, d) => setName(d.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              <Button size="small" icon={<Add16Regular />} onClick={add} aria-label={tl("Hinzufügen")} />
            </div>
            {current.length > 0 && (
              <MenuItem icon={<Dismiss16Regular />} onClick={() => onChange([])}>
                {tl("Alle Kategorien entfernen")}
              </MenuItem>
            )}
            <MenuItem icon={<TagMultiple16Regular />} onClick={() => setManage(true)}>
              {tl("Alle Kategorien …")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {manage && <CategoriesDialog onClose={() => setManage(false)} onChanged={() => onListChanged?.()} />}
    </>
  );
}

/** Colour picker for a category: the palette as swatches. */
function ColorPick({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const s = useStyles();
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button size="small" appearance="subtle" aria-label={label} title={label} icon={<span className={s.swatch} style={{ background: value }} />} />
      </MenuTrigger>
      <MenuPopover>
        <div className={s.palette} role="listbox" aria-label={label}>
          {CATEGORY_PALETTE.map((c) => (
            <button
              key={c.hex}
              type="button"
              role="option"
              aria-selected={c.hex.toLowerCase() === value.toLowerCase()}
              aria-label={tl(c.label)}
              title={tl(c.label)}
              className={s.paletteItem}
              style={{ background: c.hex, outline: c.hex.toLowerCase() === value.toLowerCase() ? `2px solid ${tokens.colorNeutralForeground1}` : undefined }}
              onClick={() => onChange(c.hex)}
            />
          ))}
        </div>
      </MenuPopover>
    </Menu>
  );
}

interface Row {
  name: string;
  color: string;
}

/**
 * "Farbkategorien": every category with its colour. Creating, recolouring,
 * renaming and deleting reach all accounts whose server keeps a category list
 * (and the messages carrying the category).
 */
export function CategoriesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const s = useStyles();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CATEGORY_PALETTE[5].hex);

  const load = useCallback(() => {
    api.categories().then(
      (list) => {
        setCategoryColors(list);
        setRows(list.map((c) => ({ name: c.name, color: c.color ?? defaultCategoryColor(c.name) })).sort((a, b) => a.name.localeCompare(b.name)));
        setEdits({});
      },
      (e) => setError(errorMessage(e)),
    );
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exists = (name: string, except?: string) => (rows ?? []).some((r) => r.name.toLowerCase() === name.trim().toLowerCase() && r.name !== except);

  const rename = (row: Row) => {
    const next = (edits[row.name] ?? row.name).trim();
    if (!next || next === row.name) return setEdits((e) => ({ ...e, [row.name]: row.name }));
    if (exists(next, row.name)) return setError(tl("Eine Kategorie mit diesem Namen gibt es schon."));
    void run(() => api.renameCategory(row.name, next));
  };

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    if (exists(n)) return setError(tl("Eine Kategorie mit diesem Namen gibt es schon."));
    void run(async () => {
      await api.saveCategory(n, newColor);
      setNewName("");
    });
  };

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{tl("Farbkategorien")}</DialogTitle>
          <DialogContent>
            <div className={s.manager}>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              <Text size={200}>{tl("Änderungen gelten für alle Konten, deren Server Kategorien verwaltet, und für die Nachrichten mit der Kategorie.")}</Text>
              {rows === null ? (
                <Spinner size="small" />
              ) : rows.length === 0 ? (
                <Text>{tl("Noch keine Kategorien.")}</Text>
              ) : (
                <div className={s.list} role="list">
                  {rows.map((row) => (
                    <div key={row.name} className={s.row} role="listitem">
                      <ColorPick label={tl("Farbe von {0}", row.name)} value={row.color} onChange={(hex) => void run(() => api.saveCategory(row.name, hex))} />
                      <Input size="small" className={s.name} aria-label={tl("Name")} value={edits[row.name] ?? row.name} disabled={busy} onChange={(_, d) => setEdits((e) => ({ ...e, [row.name]: d.value }))} onBlur={() => rename(row)} onKeyDown={(e) => e.key === "Enter" && rename(row)} />
                      {confirm === row.name ? (
                        <Button size="small" appearance="primary" disabled={busy} onClick={() => (setConfirm(null), void run(() => api.deleteCategory(row.name)))}>
                          {tl("Wirklich löschen")}
                        </Button>
                      ) : (
                        <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label={tl("{0} löschen", row.name)} disabled={busy} onClick={() => setConfirm(row.name)} />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className={s.row}>
                <ColorPick label={tl("Farbe der neuen Kategorie")} value={newColor} onChange={setNewColor} />
                <Input size="small" className={s.name} placeholder={tl("Neue Kategorie")} value={newName} disabled={busy} onChange={(_, d) => setNewName(d.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
                <Button size="small" icon={<Add16Regular />} disabled={busy || !newName.trim()} onClick={create}>
                  {tl("Hinzufügen")}
                </Button>
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {tl("Schließen")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
