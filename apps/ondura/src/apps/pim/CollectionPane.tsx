import { useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, Delete16Regular, LockClosed12Regular, MoreHorizontal16Regular, PersonAdd16Regular } from "@fluentui/react-icons";
import { COLLECTION_COLORS, type Collection } from "../../lib/pim";
import { LOCAL_ACCOUNT } from "./usePim";

const useStyles = makeStyles({
  pane: {
    width: "250px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    overflow: "hidden",
  },
  scroll: { flex: 1, overflowY: "auto", padding: "4px 4px 12px" },
  group: { marginTop: "8px" },
  groupHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 4px 4px 12px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "32px",
    padding: "0 4px 0 8px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":hover .more": { opacity: 1 },
  },
  selected: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokens.fontSizeBase300 },
  count: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, paddingRight: "6px" },
  more: { opacity: 0 },
  swatches: { display: "grid", gridTemplateColumns: "repeat(4, 24px)", gap: "6px", padding: "4px" },
  swatch: { width: "24px", height: "24px", borderRadius: "50%", border: "none", cursor: "pointer" },
  newForm: { display: "flex", flexDirection: "column", gap: "8px", width: "220px" },
  footer: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" },
});

export interface CollectionPaneProps {
  top?: ReactNode;
  collections: Collection[];
  accountName: (id: string) => string;
  /** Checkbox mode (calendars) or single selection (address books, task lists). */
  mode: "visibility" | "select";
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  counts?: Record<string, number>;
  onToggle?: (c: Collection, visible: boolean) => void;
  onColor?: (c: Collection, color: string) => void;
  onCreate: (name: string, color: string | null) => void;
  onDelete: (c: Collection) => void;
  onAddAccount: () => void;
  newLabel: string;
  extraItems?: (c: Collection) => ReactNode;
  footer?: ReactNode;
}

export function CollectionPane(p: CollectionPaneProps) {
  const s = useStyles();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[2]);

  const groups = new Map<string, Collection[]>();
  for (const c of p.collections) {
    if (!groups.has(c.accountId)) groups.set(c.accountId, []);
    groups.get(c.accountId)!.push(c);
  }
  const order = [...groups.keys()].sort((a, b) => (a === LOCAL_ACCOUNT ? -1 : b === LOCAL_ACCOUNT ? 1 : p.accountName(a).localeCompare(p.accountName(b))));

  const create = () => {
    if (!newName.trim()) return;
    p.onCreate(newName.trim(), p.mode === "visibility" ? newColor : null);
    setNewName("");
    setNewOpen(false);
  };

  return (
    <aside className={s.pane}>
      {p.top}
      <div className={s.scroll}>
        {order.map((accountId) => (
          <div key={accountId} className={s.group}>
            <div className={s.groupHead} title={p.accountName(accountId)}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.accountName(accountId)}</span>
              {accountId === LOCAL_ACCOUNT && (
                <Popover open={newOpen} onOpenChange={(_, d) => setNewOpen(d.open)} positioning="below-end" trapFocus>
                  <PopoverTrigger disableButtonEnhancement>
                    <Button size="small" appearance="subtle" icon={<Add16Regular />} aria-label={p.newLabel} title={p.newLabel} />
                  </PopoverTrigger>
                  <PopoverSurface>
                    <div className={s.newForm}>
                      <strong>{p.newLabel}</strong>
                      <Input autoFocus value={newName} placeholder="Name" onChange={(_, d) => setNewName(d.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
                      {p.mode === "visibility" && (
                        <div className={s.swatches}>
                          {COLLECTION_COLORS.map((c) => (
                            <button
                              key={c}
                              className={s.swatch}
                              style={{ background: c, outline: c === newColor ? `2px solid ${tokens.colorNeutralForeground1}` : undefined, outlineOffset: 2 }}
                              onClick={() => setNewColor(c)}
                              aria-label={c}
                            />
                          ))}
                        </div>
                      )}
                      <Button appearance="primary" disabled={!newName.trim()} onClick={create}>
                        Erstellen
                      </Button>
                    </div>
                  </PopoverSurface>
                </Popover>
              )}
            </div>
            {groups.get(accountId)!.map((c) => {
              const color = c.color ?? COLLECTION_COLORS[0];
              const canDelete = accountId === LOCAL_ACCOUNT && !c.isDefault;
              return (
                <div
                  key={c.id}
                  className={mergeClasses(s.row, p.mode === "select" && p.selectedId === c.id && s.selected)}
                  onClick={() => (p.mode === "select" ? p.onSelect?.(c.id) : p.onToggle?.(c, !c.visible))}
                >
                  {p.mode === "visibility" && (
                    <Checkbox
                      checked={c.visible}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(_, d) => p.onToggle?.(c, !!d.checked)}
                      indicator={{ style: c.visible ? { background: color, borderColor: color } : { borderColor: color } }}
                    />
                  )}
                  <span className={s.name} title={c.name}>
                    {c.name}
                  </span>
                  {c.readOnly && <LockClosed12Regular style={{ color: tokens.colorNeutralForeground3 }} aria-label="Schreibgeschützt" />}
                  {p.counts?.[c.id] ? <span className={s.count}>{p.counts[c.id]}</span> : null}
                  {(p.onColor || canDelete || p.extraItems) && (
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <Button size="small" appearance="subtle" className={mergeClasses(s.more, "more")} icon={<MoreHorizontal16Regular />} onClick={(e) => e.stopPropagation()} aria-label="Weitere Optionen" />
                      </MenuTrigger>
                      <MenuPopover onClick={(e) => e.stopPropagation()}>
                        {p.onColor && (
                          <div className={s.swatches}>
                            {COLLECTION_COLORS.map((col) => (
                              <button
                                key={col}
                                className={s.swatch}
                                style={{ background: col, outline: col === c.color ? `2px solid ${tokens.colorNeutralForeground1}` : undefined, outlineOffset: 2 }}
                                onClick={() => p.onColor!(c, col)}
                                aria-label={`Farbe ${col}`}
                              />
                            ))}
                          </div>
                        )}
                        <MenuList>
                          {p.extraItems?.(c)}
                          {canDelete && (
                            <MenuItem icon={<Delete16Regular />} onClick={() => p.onDelete(c)}>
                              Löschen
                            </MenuItem>
                          )}
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className={s.footer}>
        {p.footer}
        <Button appearance="subtle" icon={<PersonAdd16Regular />} onClick={p.onAddAccount} style={{ width: "100%", justifyContent: "flex-start" }}>
          Konto hinzufügen
        </Button>
      </div>
    </aside>
  );
}
