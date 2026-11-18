import { useState } from "react";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  Archive20Regular,
  ArrowSync16Regular,
  Mailbox20Regular,
  Warning16Filled,
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
import type { Account, AccountStatus, Folder, FolderRole } from "../../lib/types";
import { tl, LOCALE } from "../../lib/i18n";
import { folderLabel } from "../../lib/format";

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
  warning: { color: tokens.colorPaletteDarkOrangeForeground1, flexShrink: 0 },
  errorBox: {
    margin: "2px 4px 6px 28px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteYellowBackground1,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase200,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  errorText: { overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
});

function lastSyncText(st?: AccountStatus) {
  if (!st?.lastSync) return tl("Noch nicht synchronisiert");
  const d = new Date(st.lastSync * 1000);
  return tl("Zuletzt synchronisiert: {0}", d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }));
}

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
  statuses: Record<string, AccountStatus>;
  onSelect: (folder: Folder) => void;
  onFixAccount: (account: Account) => void;
  onOpenOutbox: (account: Account) => void;
  onAccountSettings: (account: Account) => void;
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
    <nav className={s.root} aria-label={tl("Ordner")}>
      {p.accounts.map((account) => {
        const open = !collapsed.has(account.id);
        const st = p.statuses[account.id];
        return (
          <div key={account.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button className={s.account} onClick={() => toggle(account.id)} title={`${account.email}\n${lastSyncText(st)}`}>
                {open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                <span className={s.dot} style={{ background: account.color ?? tokens.colorBrandBackground }} />
                <span className={s.accountName}>{account.email}</span>
                {(p.syncing.has(account.id) || st?.syncing) && <Spinner size="extra-tiny" />}
                {!!st?.pendingOps && !st.error && (
                  <Tooltip content={tl("{0} Änderung(en) werden übertragen", st.pendingOps)} relationship="label">
                    <ArrowSync16Regular style={{ color: tokens.colorNeutralForeground3 }} />
                  </Tooltip>
                )}
                {st?.error && <Warning16Filled className={s.warning} />}
              </button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} aria-label={tl("Kontooptionen")} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => p.onSyncAccount(account)}>{tl("Jetzt synchronisieren")}</MenuItem>
                    <MenuItem onClick={() => p.onAccountSettings(account)}>{tl("Kontoeinstellungen…")}</MenuItem>
                    <MenuItem onClick={() => p.onRemoveAccount(account)}>{tl("Konto entfernen")}</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </div>
            {open && st?.error && (
              <div className={s.errorBox}>
                <span className={s.errorText} title={st.error}>
                  {st.needsAuth ? tl("Anmeldung fehlgeschlagen.") : tl("Keine Verbindung zum Server.")} {st.error}
                </span>
                <span style={{ display: "flex", gap: 4 }}>
                  {st.needsAuth ? (
                    <Button size="small" appearance="primary" onClick={() => p.onFixAccount(account)}>
                      {account.kind.type === "graph" ? tl("Neu anmelden") : tl("Passwort eingeben")}
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => p.onSyncAccount(account)}>{tl("Erneut versuchen")}</Button>
                  )}
                </span>
              </div>
            )}
            {open && !!st?.outbox && (
              <button className={s.folder} style={{ paddingLeft: 8 }} onClick={() => p.onOpenOutbox(account)}>
                <Mailbox20Regular />
                <span className={mergeClasses(s.label, s.unreadLabel)}>{tl("Postausgang")}</span>
                <span className={s.unread}>{st.outbox}</span>
              </button>
            )}
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
                    <span className={mergeClasses(s.label, showUnread && s.unreadLabel)}>{folderLabel(folder)}</span>
                    {showUnread && <span className={s.unread}>{folder.unreadCount}</span>}
                    {folder.role === "drafts" && folder.totalCount > 0 && <span className={s.unread}>[{folder.totalCount}]</span>}
                  </button>
                );
              })}
          </div>
        );
      })}
      <Button appearance="subtle" icon={<PersonAdd20Regular />} className={s.add} onClick={p.onAddAccount}>
        {tl("Konto hinzufügen")}
      </Button>
    </nav>
  );
}
