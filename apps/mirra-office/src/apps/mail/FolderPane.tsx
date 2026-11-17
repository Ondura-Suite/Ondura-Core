import { useState } from "react";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  Archive20Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  Delete20Regular,
  Document20Regular,
  Folder20Regular,
  MailInbox20Regular,
  MoreHorizontal16Regular,
  PersonAdd20Regular,
  Send20Regular,
  ShieldError20Regular,
} from "@fluentui/react-icons";
import type { Account, Folder, FolderRole } from "../../lib/types";

export function FolderIcon({ role }: { role: FolderRole }) {
  switch (role) {
    case "inbox":
      return <MailInbox20Regular />;
    case "drafts":
      return <Document20Regular />;
    case "sent":
      return <Send20Regular />;
    case "archive":
      return <Archive20Regular />;
    case "junk":
      return <ShieldError20Regular />;
    case "trash":
      return <Delete20Regular />;
    default:
      return <Folder20Regular />;
  }
}

const useStyles = makeStyles({
  root: {
    width: "240px",
    flexShrink: 0,
    overflowY: "auto",
    padding: "8px 4px 8px 8px",
    display: "flex",
    flexDirection: "column",
  },
  account: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    width: "100%",
    padding: "8px 6px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    textAlign: "left",
    borderRadius: tokens.borderRadiusMedium,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  accountName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dot: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, marginRight: "4px" },
  folder: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    height: "34px",
    padding: "0 8px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover, color: tokens.colorNeutralForeground1 },
  },
  folderSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ":hover": { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  label: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  unread: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase200 },
  unreadLabel: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  add: { marginTop: "auto", justifyContent: "flex-start" },
});

/** Orders folders as a tree (depth-first) and returns their depth. */
function treeOrder(folders: Folder[]): { folder: Folder; depth: number }[] {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const parent = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(f);
  }
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface FolderPaneProps {
  accounts: Account[];
  folders: Record<string, Folder[]>;
  selectedFolderId: string | null;
  syncing: Set<string>;
  onSelect: (folder: Folder) => void;
  onAddAccount: () => void;
  onRemoveAccount: (account: Account) => void;
  onSyncAccount: (account: Account) => void;
}

export function FolderPane(p: FolderPaneProps) {
  const s = useStyles();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <nav className={s.root} aria-label="Ordner">
      {p.accounts.map((account) => {
        const open = !collapsed.has(account.id);
        return (
          <div key={account.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button className={s.account} onClick={() => toggle(account.id)} title={account.email}>
                {open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                <span className={s.dot} style={{ background: account.color ?? tokens.colorBrandBackground }} />
                <span className={s.accountName}>{account.email}</span>
                {p.syncing.has(account.id) && <Spinner size="extra-tiny" />}
              </button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} aria-label="Kontooptionen" />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onSyncAccount(account)}>Jetzt synchronisieren</MenuItem>
                    <MenuItem onClick={() => p.onRemoveAccount(account)}>Konto entfernen</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </div>
            {open &&
              treeOrder(p.folders[account.id] ?? []).map(({ folder, depth }) => {
                const selected = folder.id === p.selectedFolderId;
                const showUnread = folder.unreadCount > 0 && folder.role !== "sent" && folder.role !== "drafts" && folder.role !== "trash";
                return (
                  <button
                    key={folder.id}
                    className={mergeClasses(s.folder, selected && s.folderSelected)}
                    style={{ paddingLeft: 8 + depth * 18 }}
                    onClick={() => p.onSelect(folder)}
                  >
                    <FolderIcon role={folder.role} />
                    <span className={mergeClasses(s.label, showUnread && s.unreadLabel)}>{folder.name}</span>
                    {showUnread && <span className={s.unread}>{folder.unreadCount}</span>}
                    {folder.role === "drafts" && folder.totalCount > 0 && <span className={s.unread}>[{folder.totalCount}]</span>}
                  </button>
                );
              })}
          </div>
        );
      })}
      <Button appearance="subtle" icon={<PersonAdd20Regular />} className={s.add} onClick={p.onAddAccount}>
        Konto hinzufügen
      </Button>
    </nav>
  );
}
