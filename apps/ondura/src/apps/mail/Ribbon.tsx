import { useState } from "react";
import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tab,
  TabList,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Spinner,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Archive24Regular,
  ArrowClockwise24Regular,
  ArrowForward24Regular,
  ArrowReply24Regular,
  ArrowReplyAll24Regular,
  DarkTheme24Regular,
  Delete24Regular,
  Flag24Filled,
  Flag24Regular,
  FolderArrowRight24Regular,
  Mail24Regular,
  MailRead24Regular,
  MailUnread24Regular,
  Navigation24Regular,
  PanelBottomRegular,
  PanelRight24Regular,
  PersonAdd24Regular,
  Chat24Regular,
  TextBulletListSquareEdit24Regular,
  CalendarArrowRight24Regular,
  MailboxRegular,
  Pin24Regular,
  Clock24Regular,
  Broom24Regular,
  PersonProhibited24Regular,
  Print24Regular,
  Flash24Regular,
  Filter24Regular,
} from "@fluentui/react-icons";
import type React from "react";
import { CategorizeMenu } from "./Categories";
import type { Account, Folder, MessageSummary } from "../../lib/types";
import { useThemeMode } from "../../shell/theme";
import { FolderIcon } from "./FolderPane";
import { tl } from "../../lib/i18n";
import { folderLabel } from "../../lib/format";

const useStyles = makeStyles({
  root: {
    flexShrink: 0,
    margin: "8px 8px 0 8px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
  },
  tabs: { display: "flex", alignItems: "center", padding: "0 4px" },
  toolbar: { padding: "2px 8px 6px 8px", flexWrap: "wrap", rowGap: "2px" },
  newMail: { marginRight: "8px" },
});

export type ReadingPanePosition = "right" | "bottom";

export interface RibbonProps {
  selected: MessageSummary | null;
  folders: Folder[];
  /** For the folders of other accounts in "Verschieben"/"Kopieren". */
  accounts?: Account[];
  syncing: boolean;
  onToggleFolders: () => void;
  onNew: () => void;
  onReply: (mode: "reply" | "replyAll" | "forward") => void;
  onDelete: () => void;
  onArchive: () => void;
  onMove: (folderId: string) => void;
  onCopy?: (folderId: string) => void;
  onToggleRead: () => void;
  onToggleFlag: () => void;
  onSync: () => void;
  onAddAccount: () => void;
  readingPane: ReadingPanePosition;
  onReadingPane: (p: ReadingPanePosition) => void;
  conversations: boolean;
  onToggleConversations: () => void;
  knownCategories: string[];
  onCategorize: (categories: string[]) => void;
  onRules: () => void;
  onAutoReplies: () => void;
  onSharedMailbox: () => void;
  onPin: () => void;
  onSnoozeMenu: (e: React.MouseEvent) => void;
  onSweep: () => void;
  onBlock: () => void;
  onPrint: () => void;
  quickSteps: { id: string; name: string; title: string }[];
  onQuickStep: (id: string) => void;
  onManageQuickSteps: () => void;
  focusedInbox: boolean;
  onToggleFocusedInbox: () => void;
}

export function Ribbon(p: RibbonProps) {
  const s = useStyles();
  const [tab, setTab] = useState<"home" | "view">("home");
  const { toggle } = useThemeMode();
  const has = !!p.selected;
  const moveTargets = p.folders.filter((f) => f.accountId === p.selected?.accountId && f.id !== p.selected?.folderId);
  const otherAccounts = (p.accounts ?? []).filter((a) => a.id !== p.selected?.accountId && p.folders.some((f) => f.accountId === a.id));
  /** Folders of the other accounts, one submenu each. */
  const otherFolders = (pick: (id: string) => void) =>
    otherAccounts.map((a) => (
      <Menu key={a.id}>
        <MenuTrigger disableButtonEnhancement>
          <MenuItem>{a.email}</MenuItem>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {p.folders
              .filter((f) => f.accountId === a.id)
              .map((f) => (
                <MenuItem key={f.id} icon={<FolderIcon role={f.role} />} onClick={() => pick(f.id)}>
                  {folderLabel(f)}
                </MenuItem>
              ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    ));

  return (
    <div className={s.root}>
      <div className={s.tabs}>
        <Button appearance="subtle" icon={<Navigation24Regular />} aria-label={tl("Ordnerbereich ein-/ausblenden")} onClick={p.onToggleFolders} />
        <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "home" | "view")}>
          <Tab value="home">{tl("Start")}</Tab>
          <Tab value="view">{tl("Ansicht")}</Tab>
        </TabList>
      </div>
      {tab === "home" ? (
        <Toolbar size="medium" className={s.toolbar}>
          <Button appearance="primary" icon={<Mail24Regular />} className={s.newMail} onClick={p.onNew}>
            {tl("Neue E-Mail")}
          </Button>
          <ToolbarButton icon={<Delete24Regular />} disabled={!has} onClick={p.onDelete}>{tl("Löschen")}</ToolbarButton>
          <ToolbarButton icon={<Archive24Regular />} disabled={!has} onClick={p.onArchive}>{tl("Archiv")}</ToolbarButton>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton icon={<FolderArrowRight24Regular />} disabled={!has}>{tl("Verschieben")}</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {moveTargets.map((f) => (
                  <MenuItem key={f.id} icon={<FolderIcon role={f.role} />} onClick={() => p.onMove(f.id)}>
                    {folderLabel(f)}
                  </MenuItem>
                ))}
                {otherAccounts.length > 0 && <MenuDivider />}
                {otherFolders(p.onMove)}
                {p.onCopy && (
                  <>
                    <MenuDivider />
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <MenuItem>{tl("In Ordner kopieren")}</MenuItem>
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList>
                          {p.folders
                            .filter((f) => f.accountId === p.selected?.accountId)
                            .map((f) => (
                              <MenuItem key={f.id} icon={<FolderIcon role={f.role} />} onClick={() => p.onCopy!(f.id)}>
                                {folderLabel(f)}
                              </MenuItem>
                            ))}
                          {otherAccounts.length > 0 && <MenuDivider />}
                          {otherFolders(p.onCopy)}
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                  </>
                )}
              </MenuList>
            </MenuPopover>
          </Menu>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowReply24Regular />} disabled={!has} onClick={() => p.onReply("reply")}>{tl("Antworten")}</ToolbarButton>
          <ToolbarButton icon={<ArrowReplyAll24Regular />} disabled={!has} onClick={() => p.onReply("replyAll")}>{tl("Allen antworten")}</ToolbarButton>
          <ToolbarButton icon={<ArrowForward24Regular />} disabled={!has} onClick={() => p.onReply("forward")}>{tl("Weiterleiten")}</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            icon={p.selected?.isRead === false ? <MailRead24Regular /> : <MailUnread24Regular />}
            disabled={!has}
            onClick={p.onToggleRead}
          >
            {p.selected?.isRead === false ? tl("Gelesen") : tl("Ungelesen")}
          </ToolbarButton>
          <ToolbarButton icon={p.selected?.isFlagged ? <Flag24Filled /> : <Flag24Regular />} disabled={!has} onClick={p.onToggleFlag}>
            {tl("Kennzeichnen")}
          </ToolbarButton>
          <CategorizeMenu current={p.selected?.categories ?? []} known={p.knownCategories} disabled={!has} onChange={p.onCategorize} />
          <ToolbarButton icon={<Pin24Regular />} disabled={!has} onClick={p.onPin}>{p.selected?.pinned ? tl("Lösen") : tl("Anheften")}</ToolbarButton>
          <ToolbarButton icon={<Clock24Regular />} disabled={!has} onClick={(e) => p.onSnoozeMenu(e)}>{tl("Zurückstellen")}</ToolbarButton>
          <ToolbarDivider />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton icon={<Flash24Regular />} disabled={!has}>{tl("QuickSteps")}</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {p.quickSteps.map((q) => (
                  <MenuItem key={q.id} title={q.title} onClick={() => p.onQuickStep(q.id)}>{q.name}</MenuItem>
                ))}
                <MenuItem onClick={p.onManageQuickSteps}>{tl("QuickSteps verwalten…")}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <ToolbarButton icon={<Broom24Regular />} disabled={!has || !p.selected?.from} onClick={p.onSweep}>{tl("Aufräumen")}</ToolbarButton>
          <ToolbarButton icon={<PersonProhibited24Regular />} disabled={!has || !p.selected?.from} onClick={p.onBlock}>{tl("Blockieren")}</ToolbarButton>
          <ToolbarButton icon={<Print24Regular />} disabled={!has} onClick={p.onPrint}>{tl("Drucken")}</ToolbarButton>
          <ToolbarDivider />
          <Tooltip content={p.syncing ? tl("Synchronisiert…") : tl("Alle Konten synchronisieren")} relationship="label">
            <ToolbarButton icon={p.syncing ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} disabled={p.syncing} onClick={p.onSync} />
          </Tooltip>
        </Toolbar>
      ) : (
        <Toolbar size="medium" className={s.toolbar}>
          <ToolbarButton icon={<DarkTheme24Regular />} onClick={toggle}>{tl("Dunkler Modus")}</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            icon={<PanelRight24Regular />}
            appearance={p.readingPane === "right" ? "primary" : "subtle"}
            onClick={() => p.onReadingPane("right")}
          >
            {tl("Lesebereich rechts")}
          </ToolbarButton>
          <ToolbarButton
            icon={<PanelBottomRegular />}
            appearance={p.readingPane === "bottom" ? "primary" : "subtle"}
            onClick={() => p.onReadingPane("bottom")}
          >
            {tl("Lesebereich unten")}
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<Chat24Regular />} appearance={p.conversations ? "primary" : "subtle"} onClick={p.onToggleConversations}>
            {tl("Als Unterhaltungen anzeigen")}
          </ToolbarButton>
          <ToolbarButton icon={<Filter24Regular />} appearance={p.focusedInbox ? "primary" : "subtle"} onClick={p.onToggleFocusedInbox}>
            {tl("Relevanter Posteingang")}
          </ToolbarButton>
          <ToolbarButton icon={<TextBulletListSquareEdit24Regular />} onClick={p.onRules}>{tl("Regeln")}</ToolbarButton>
          <ToolbarButton icon={<CalendarArrowRight24Regular />} onClick={p.onAutoReplies}>{tl("Automatische Antworten")}</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<PersonAdd24Regular />} onClick={p.onAddAccount}>{tl("Konto hinzufügen")}</ToolbarButton>
          <ToolbarButton icon={<MailboxRegular fontSize={24} />} onClick={p.onSharedMailbox}>{tl("Freigegebenes Postfach")}</ToolbarButton>
        </Toolbar>
      )}
    </div>
  );
}
