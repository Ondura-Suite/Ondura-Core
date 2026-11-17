import { useMemo, useState } from "react";
import { Avatar, Button, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Spinner, Text, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  Attach16Regular,
  Delete16Regular,
  Filter20Regular,
  Flag16Filled,
  Flag16Regular,
  Important16Filled,
  MailRead16Regular,
  MailUnread16Regular,
} from "@fluentui/react-icons";
import type { MessageSummary } from "../../lib/types";
import { displayName, groupMessages, listDate } from "../../lib/format";

const useStyles = makeStyles({
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "12px 12px 8px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: { flex: 1, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  list: { flex: 1, overflowY: "auto" },
  group: {
    padding: "10px 16px 4px 16px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  item: {
    position: "relative",
    display: "flex",
    gap: "12px",
    padding: "10px 12px 10px 16px",
    cursor: "pointer",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":hover .nexora-hover-actions": { display: "flex" },
  },
  selected: {
    backgroundColor: tokens.colorBrandBackground2,
    ":hover": { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  unreadBar: {
    "::before": {
      content: '""',
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: "3px",
      backgroundColor: tokens.colorBrandBackground,
    },
  },
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" },
  row: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  from: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokens.fontSizeBase300 },
  subject: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokens.fontSizeBase300 },
  preview: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  date: { flexShrink: 0, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  bold: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  brand: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  icons: { display: "flex", gap: "4px", color: tokens.colorNeutralForeground3, flexShrink: 0 },
  flag: { color: tokens.colorPaletteRedForeground1 },
  hoverActions: {
    display: "none",
    position: "absolute",
    right: "8px",
    top: "6px",
    gap: "2px",
    padding: "2px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
  },
  more: { display: "flex", justifyContent: "center", padding: "12px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", color: tokens.colorNeutralForeground3, padding: "24px" },
});

type Filter = "all" | "unread" | "flagged";

export interface MessageListProps {
  title: string;
  messages: MessageSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (m: MessageSummary) => void;
  onDelete: (m: MessageSummary) => void;
  onToggleRead: (m: MessageSummary) => void;
  onToggleFlag: (m: MessageSummary) => void;
  showFrom?: "from" | "to";
  /** Called when the user scrolls near the end of the list. */
  onEndReached?: () => void;
  /** Fetch older messages from the server; undefined hides the button. */
  onLoadOlder?: () => void;
  olderState?: "idle" | "loading" | "done";
}

export function MessageList(p: MessageListProps) {
  const s = useStyles();
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(
    () => p.messages.filter((m) => (filter === "unread" ? !m.isRead : filter === "flagged" ? m.isFlagged : true)),
    [p.messages, filter],
  );
  const groups = useMemo(() => groupMessages(filtered), [filtered]);

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <section className={s.root} aria-label="Nachrichtenliste">
      <div className={s.header}>
        <span className={s.title}>{p.title}</span>
        {p.loading && <Spinner size="tiny" />}
        <Menu
          checkedValues={{ filter: [filter] }}
          onCheckedValueChange={(_, d) => setFilter((d.checkedItems[0] as Filter) ?? "all")}
        >
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="Filter" relationship="label">
              <Button appearance={filter === "all" ? "subtle" : "transparent"} icon={<Filter20Regular />} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItemRadio name="filter" value="all">Alle</MenuItemRadio>
              <MenuItemRadio name="filter" value="unread">Ungelesen</MenuItemRadio>
              <MenuItemRadio name="filter" value="flagged">Gekennzeichnet</MenuItemRadio>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      {filtered.length === 0 ? (
        <div className={s.empty}>
          {p.loading ? <Spinner /> : <Text>{filter === "all" ? "Hier gibt es nichts." : "Keine passenden Elemente."}</Text>}
        </div>
      ) : (
        <div
          className={s.list}
          role="listbox"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) p.onEndReached?.();
          }}
        >
          {groups.map((g) => (
            <div key={g.label}>
              <div className={s.group}>{g.label}</div>
              {g.items.map((m) => {
                const selected = m.id === p.selectedId;
                const person = p.showFrom === "to" ? m.to[0] ?? null : m.from;
                return (
                  <div
                    key={m.id}
                    role="option"
                    aria-selected={selected}
                    className={mergeClasses(s.item, selected && s.selected, !m.isRead && s.unreadBar)}
                    onClick={() => p.onSelect(m)}
                  >
                    <Avatar name={displayName(person)} size={32} color="colorful" />
                    <div className={s.body}>
                      <div className={s.row}>
                        <span className={mergeClasses(s.from, !m.isRead && s.bold)}>
                          {p.showFrom === "to" ? `An: ${displayName(person)}` : displayName(person)}
                        </span>
                        <span className={s.icons}>
                          {m.importance === "high" && <Important16Filled style={{ color: tokens.colorPaletteRedForeground1 }} />}
                          {m.hasAttachments && <Attach16Regular />}
                          {m.isFlagged && <Flag16Filled className={s.flag} />}
                        </span>
                      </div>
                      <div className={s.row}>
                        <span className={mergeClasses(s.subject, !m.isRead && s.brand)}>{m.subject || "(Kein Betreff)"}</span>
                        <span className={mergeClasses(s.date, !m.isRead && s.brand)}>{listDate(m.date)}</span>
                      </div>
                      <span className={s.preview}>{m.preview || " "}</span>
                    </div>
                    <div className={mergeClasses(s.hoverActions, "nexora-hover-actions")}>
                      <Tooltip content="Löschen" relationship="label">
                        <Button size="small" appearance="subtle" icon={<Delete16Regular />} onClick={stop(() => p.onDelete(m))} />
                      </Tooltip>
                      <Tooltip content={m.isRead ? "Als ungelesen markieren" : "Als gelesen markieren"} relationship="label">
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={m.isRead ? <MailUnread16Regular /> : <MailRead16Regular />}
                          onClick={stop(() => p.onToggleRead(m))}
                        />
                      </Tooltip>
                      <Tooltip content={m.isFlagged ? "Kennzeichnung entfernen" : "Kennzeichnen"} relationship="label">
                        <Button size="small" appearance="subtle" icon={<Flag16Regular />} onClick={stop(() => p.onToggleFlag(m))} />
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {p.onLoadOlder && filter === "all" && (
            <div className={s.more}>
              {p.olderState === "loading" ? (
                <Spinner size="tiny" label="Ältere Nachrichten werden geladen…" />
              ) : p.olderState === "done" ? (
                <span>Keine weiteren Nachrichten auf dem Server.</span>
              ) : (
                <Button appearance="subtle" size="small" onClick={p.onLoadOlder}>Ältere Nachrichten vom Server laden</Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
