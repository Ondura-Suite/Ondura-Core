import { useState } from "react";
import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  SplitButton,
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
  CalendarAdd20Regular,
  CalendarPerson24Regular,
  Mail20Regular,
  PeopleTeam20Regular,
  Video20Regular,
  FolderAdd24Regular,
  Rename24Regular,
  FolderProhibited24Regular,
  MailAllRead24Regular,
  DeleteDismiss24Regular,
  ArrowSync24Regular,
  MailInbox24Regular,
  MailOff24Regular,
  ChatOff24Regular,
  PanelRightContract24Regular,
  TextDescription24Regular,
  ArrowSort24Regular,
  ZoomIn24Regular,
  TextLineSpacing24Regular,
  ArrowSortDown24Regular,
  ArrowSortUp24Regular,
  MailArrowUp24Regular,
} from "@fluentui/react-icons";
import { type MessageSort, SORT_LABELS } from "./MessageList";
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

export type ReadingPanePosition = "right" | "bottom" | "off";

export interface RibbonProps {
  selected: MessageSummary | null;
  folders: Folder[];
  /** For the folders of other accounts in "Verschieben"/"Kopieren". */
  accounts?: Account[];
  syncing: boolean;
  onToggleFolders: () => void;
  onNew: () => void;
  /** New appointment, meeting or Teams meeting from the mail app. */
  onNewEvent?: (kind: "appointment" | "meeting" | "teams") => void;
  /** Invite the sender and recipients of the selected mail to a meeting. */
  onReplyMeeting?: () => void;
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
  /** Outlook parity: ignore, junk, folder commands, view options. */
  onIgnore?: () => void;
  onJunk?: (junk: boolean) => void;
  folder?: Folder | null;
  onFolder?: (a: "new" | "newSub" | "rename" | "delete" | "markAllRead" | "empty") => void;
  onSyncFolder?: () => void;
  onOutbox?: () => void;
  sort?: { by: MessageSort; desc: boolean };
  onSort?: (s: { by: MessageSort; desc: boolean }) => void;
  showPreview?: boolean;
  onTogglePreview?: () => void;
  compact?: boolean;
  onToggleCompact?: () => void;
  zoom?: number;
  onZoom?: (z: number) => void;
}

export function Ribbon(p: RibbonProps) {
  const s = useStyles();
  const [tab, setTab] = useState<"home" | "view" | "folder" | "send">("home");
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
        <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "home" | "view" | "folder" | "send")}>
          <Tab value="home">{tl("Start")}</Tab>
          <Tab value="send">{tl("Senden/Empfangen")}</Tab>
          <Tab value="folder">{tl("Ordner")}</Tab>
          <Tab value="view">{tl("Ansicht")}</Tab>
        </TabList>
      </div>
      {tab === "home" ? (
        <Toolbar size="medium" className={s.toolbar}>
          {p.onNewEvent ? (
            <Menu positioning="below-start">
              <MenuTrigger disableButtonEnhancement>
                {(triggerProps) => (
                  <SplitButton
                    appearance="primary"
                    icon={<Mail24Regular />}
                    className={s.newMail}
                    menuButton={{ ...triggerProps, "aria-label": tl("Weitere Elemente") }}
                    primaryActionButton={{ onClick: p.onNew }}
                  >
                    {tl("Neue E-Mail")}
                  </SplitButton>
                )}
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<Mail20Regular />} onClick={p.onNew}>{tl("E-Mail")}</MenuItem>
                  <MenuItem icon={<CalendarAdd20Regular />} onClick={() => p.onNewEvent!("appointment")}>{tl("Termin")}</MenuItem>
                  <MenuItem icon={<PeopleTeam20Regular />} onClick={() => p.onNewEvent!("meeting")}>{tl("Besprechung")}</MenuItem>
                  <MenuItem icon={<Video20Regular />} onClick={() => p.onNewEvent!("teams")}>{tl("Teams-Besprechung")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : (
            <Button appearance="primary" icon={<Mail24Regular />} className={s.newMail} onClick={p.onNew}>
              {tl("Neue E-Mail")}
            </Button>
          )}
          <ToolbarButton icon={<Delete24Regular />} disabled={!has} onClick={p.onDelete}>{tl("Löschen")}</ToolbarButton>
          <ToolbarButton icon={<Archive24Regular />} disabled={!has} onClick={p.onArchive}>{tl("Archiv")}</ToolbarButton>
          {p.onIgnore && <ToolbarButton icon={<ChatOff24Regular />} disabled={!has} onClick={p.onIgnore}>{tl("Ignorieren")}</ToolbarButton>}
          {p.onJunk && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <ToolbarButton icon={<MailOff24Regular />} disabled={!has}>{tl("Junk-E-Mail")}</ToolbarButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => p.onJunk!(true)}>{tl("Als Junk-E-Mail markieren")}</MenuItem>
                  <MenuItem onClick={() => p.onJunk!(false)}>{tl("Keine Junk-E-Mail")}</MenuItem>
                  <MenuDivider />
                  <MenuItem disabled={!p.selected?.from} onClick={p.onBlock}>{tl("Absender blockieren")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
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
          {p.onReplyMeeting && (
            <Tooltip content={tl("Absender und Empfänger zu einer Besprechung einladen")} relationship="description">
              <ToolbarButton icon={<CalendarPerson24Regular />} disabled={!has} onClick={p.onReplyMeeting}>{tl("Besprechung")}</ToolbarButton>
            </Tooltip>
          )}
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
      ) : tab === "send" ? (
        <Toolbar size="medium" className={s.toolbar}>
          <ToolbarButton icon={p.syncing ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />} disabled={p.syncing} onClick={p.onSync}>{tl("Alle Ordner senden/empfangen")}</ToolbarButton>
          {p.onSyncFolder && <ToolbarButton icon={<ArrowSync24Regular />} disabled={!p.folder} onClick={p.onSyncFolder}>{tl("Ordner aktualisieren")}</ToolbarButton>}
          {p.onOutbox && <ToolbarButton icon={<MailArrowUp24Regular />} disabled={!p.folder} onClick={p.onOutbox}>{tl("Postausgang anzeigen")}</ToolbarButton>}
        </Toolbar>
      ) : tab === "folder" ? (
        <Toolbar size="medium" className={s.toolbar}>
          <ToolbarButton icon={<FolderAdd24Regular />} disabled={!p.folder} onClick={() => p.onFolder?.("new")}>{tl("Neuer Ordner")}</ToolbarButton>
          <ToolbarButton icon={<FolderAdd24Regular />} disabled={!p.folder} onClick={() => p.onFolder?.("newSub")}>{tl("Neuer Unterordner")}</ToolbarButton>
          <ToolbarButton icon={<Rename24Regular />} disabled={!p.folder || p.folder.role !== "other"} onClick={() => p.onFolder?.("rename")}>{tl("Ordner umbenennen")}</ToolbarButton>
          <ToolbarButton icon={<FolderProhibited24Regular />} disabled={!p.folder || p.folder.role !== "other"} onClick={() => p.onFolder?.("delete")}>{tl("Ordner löschen")}</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<MailAllRead24Regular />} disabled={!p.folder} onClick={() => p.onFolder?.("markAllRead")}>{tl("Alle als gelesen markieren")}</ToolbarButton>
          <ToolbarButton icon={<DeleteDismiss24Regular />} disabled={!p.folder} onClick={() => p.onFolder?.("empty")}>{tl("Ordner leeren")}</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<MailInbox24Regular />} onClick={p.onRules}>{tl("Regeln verwalten")}</ToolbarButton>
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
          <ToolbarButton icon={<PanelRightContract24Regular />} appearance={p.readingPane === "off" ? "primary" : "subtle"} onClick={() => p.onReadingPane("off")}>
            {tl("Lesebereich aus")}
          </ToolbarButton>
          {p.onTogglePreview && (
            <ToolbarButton icon={<TextDescription24Regular />} appearance={p.showPreview !== false ? "primary" : "subtle"} onClick={p.onTogglePreview}>
              {tl("Nachrichtenvorschau")}
            </ToolbarButton>
          )}
          {p.onToggleCompact && (
            <ToolbarButton icon={<TextLineSpacing24Regular />} appearance={p.compact ? "primary" : "subtle"} onClick={p.onToggleCompact}>
              {tl("Kompakt")}
            </ToolbarButton>
          )}
          {p.onSort && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <ToolbarButton icon={<ArrowSort24Regular />}>{tl("Anordnen nach: {0}", SORT_LABELS()[p.sort?.by ?? "date"])}</ToolbarButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {(Object.keys(SORT_LABELS()) as MessageSort[]).map((k) => (
                    <MenuItem key={k} onClick={() => p.onSort!({ by: k, desc: k === "date" })}>
                      {SORT_LABELS()[k]}
                      {(p.sort?.by ?? "date") === k ? " ✓" : ""}
                    </MenuItem>
                  ))}
                  <MenuDivider />
                  <MenuItem icon={p.sort?.desc === false ? <ArrowSortUp24Regular /> : <ArrowSortDown24Regular />} onClick={() => p.onSort!({ by: p.sort?.by ?? "date", desc: !(p.sort?.desc ?? true) })}>
                    {tl("Reihenfolge umkehren")}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
          {p.onZoom && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <ToolbarButton icon={<ZoomIn24Regular />}>{tl("Zoom {0} %", Math.round((p.zoom ?? 1) * 100))}</ToolbarButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {[0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((z) => (
                    <MenuItem key={z} onClick={() => p.onZoom!(z)}>
                      {Math.round(z * 100)} %
                    </MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
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
