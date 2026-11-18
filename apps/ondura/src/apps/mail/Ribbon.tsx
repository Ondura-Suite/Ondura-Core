import { useState } from "react";
import {
  Button,
  Menu,
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
} from "@fluentui/react-icons";
import { CategorizeMenu } from "./Categories";
import type { Folder, MessageSummary } from "../../lib/types";
import { useThemeMode } from "../../shell/theme";
import { FolderIcon } from "./FolderPane";

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
  syncing: boolean;
  onToggleFolders: () => void;
  onNew: () => void;
  onReply: (mode: "reply" | "replyAll" | "forward") => void;
  onDelete: () => void;
  onArchive: () => void;
  onMove: (folderId: string) => void;
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
}

export function Ribbon(p: RibbonProps) {
  const s = useStyles();
  const [tab, setTab] = useState<"home" | "view">("home");
  const { toggle } = useThemeMode();
  const has = !!p.selected;
  const moveTargets = p.folders.filter((f) => f.accountId === p.selected?.accountId && f.id !== p.selected?.folderId);

  return (
    <div className={s.root}>
      <div className={s.tabs}>
        <Button appearance="subtle" icon={<Navigation24Regular />} aria-label="Ordnerbereich ein-/ausblenden" onClick={p.onToggleFolders} />
        <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "home" | "view")}>
          <Tab value="home">Start</Tab>
          <Tab value="view">Ansicht</Tab>
        </TabList>
      </div>
      {tab === "home" ? (
        <Toolbar size="medium" className={s.toolbar}>
          <Button appearance="primary" icon={<Mail24Regular />} className={s.newMail} onClick={p.onNew}>
            Neue E-Mail
          </Button>
          <ToolbarButton icon={<Delete24Regular />} disabled={!has} onClick={p.onDelete}>Löschen</ToolbarButton>
          <ToolbarButton icon={<Archive24Regular />} disabled={!has} onClick={p.onArchive}>Archiv</ToolbarButton>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton icon={<FolderArrowRight24Regular />} disabled={!has}>Verschieben</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {moveTargets.map((f) => (
                  <MenuItem key={f.id} icon={<FolderIcon role={f.role} />} onClick={() => p.onMove(f.id)}>
                    {f.name}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowReply24Regular />} disabled={!has} onClick={() => p.onReply("reply")}>Antworten</ToolbarButton>
          <ToolbarButton icon={<ArrowReplyAll24Regular />} disabled={!has} onClick={() => p.onReply("replyAll")}>Allen antworten</ToolbarButton>
          <ToolbarButton icon={<ArrowForward24Regular />} disabled={!has} onClick={() => p.onReply("forward")}>Weiterleiten</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            icon={p.selected?.isRead === false ? <MailRead24Regular /> : <MailUnread24Regular />}
            disabled={!has}
            onClick={p.onToggleRead}
          >
            {p.selected?.isRead === false ? "Gelesen" : "Ungelesen"}
          </ToolbarButton>
          <ToolbarButton icon={p.selected?.isFlagged ? <Flag24Filled /> : <Flag24Regular />} disabled={!has} onClick={p.onToggleFlag}>
            Kennzeichnen
          </ToolbarButton>
          <CategorizeMenu current={p.selected?.categories ?? []} known={p.knownCategories} disabled={!has} onChange={p.onCategorize} />
          <ToolbarDivider />
          <Tooltip content={p.syncing ? "Synchronisiert…" : "Alle Konten synchronisieren"} relationship="label">
            <ToolbarButton icon={p.syncing ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} disabled={p.syncing} onClick={p.onSync} />
          </Tooltip>
        </Toolbar>
      ) : (
        <Toolbar size="medium" className={s.toolbar}>
          <ToolbarButton icon={<DarkTheme24Regular />} onClick={toggle}>Dunkler Modus</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            icon={<PanelRight24Regular />}
            appearance={p.readingPane === "right" ? "primary" : "subtle"}
            onClick={() => p.onReadingPane("right")}
          >
            Lesebereich rechts
          </ToolbarButton>
          <ToolbarButton
            icon={<PanelBottomRegular />}
            appearance={p.readingPane === "bottom" ? "primary" : "subtle"}
            onClick={() => p.onReadingPane("bottom")}
          >
            Lesebereich unten
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<Chat24Regular />} appearance={p.conversations ? "primary" : "subtle"} onClick={p.onToggleConversations}>
            Als Unterhaltungen anzeigen
          </ToolbarButton>
          <ToolbarButton icon={<TextBulletListSquareEdit24Regular />} onClick={p.onRules}>Regeln</ToolbarButton>
          <ToolbarButton icon={<CalendarArrowRight24Regular />} onClick={p.onAutoReplies}>Automatische Antworten</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<PersonAdd24Regular />} onClick={p.onAddAccount}>Konto hinzufügen</ToolbarButton>
          <ToolbarButton icon={<MailboxRegular fontSize={24} />} onClick={p.onSharedMailbox}>Freigegebenes Postfach</ToolbarButton>
        </Toolbar>
      )}
    </div>
  );
}
