import type React from "react";
import { useMemo, useState } from "react";
import { Avatar, Button, CounterBadge, Tab, TabList, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Spinner, Text, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  Attach16Regular,
  Delete16Regular,
  Filter20Regular,
  Flag16Filled,
  Flag16Regular,
  Important16Filled,
  MailRead16Regular,
  MailUnread16Regular,
  Pin16Filled,
  Pin16Regular,
  Clock16Regular,
} from "@fluentui/react-icons";
import type { MessageSummary } from "../../lib/types";
import { displayName, groupMessages, listDate } from "../../lib/format";
import { CategoryChips } from "./Categories";
import { tl } from "../../lib/i18n";

/** Conversation key of a message (messages without subject stand alone). */
export const convKey = (m: MessageSummary) => m.threadKey || `id:${m.id}`;

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
    ":hover .ondura-hover-actions": { display: "flex" },
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
  count: {
    flexShrink: 0,
    minWidth: "18px",
    height: "18px",
    padding: "0 5px",
    borderRadius: "9px",
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorNeutralBackground3Hover,
    color: tokens.colorNeutralForeground2,
  },
  previewRow: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", color: tokens.colorNeutralForeground3, padding: "24px" },
});

type Filter = "all" | "unread" | "flagged";

export interface MessageListProps {
  title: string;
  messages: MessageSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (m: MessageSummary) => void;
  /** Double-click: open the message in its own window. */
  onOpen?: (m: MessageSummary) => void;
  onDelete: (m: MessageSummary) => void;
  onToggleRead: (m: MessageSummary) => void;
  onToggleFlag: (m: MessageSummary) => void;
  /** Right-click on a message. */
  onContextMenu?: (m: MessageSummary, e: React.MouseEvent) => void;
  showFrom?: "from" | "to";
  /** Called when the user scrolls near the end of the list. */
  onEndReached?: () => void;
  /** Fetch older messages from the server; undefined hides the button. */
  onLoadOlder?: () => void;
  olderState?: "idle" | "loading" | "done";
  /** Group messages of a conversation into one entry. */
  conversations?: boolean;
  /** Messages per conversation (key → count) for the badge. */
  threadCounts?: Record<string, number>;
  /** Focused inbox: the selected tab and the unread counts per tab. */
  focusTab?: "focused" | "other";
  focusUnread?: [number, number];
  onFocusTab?: (tab: "focused" | "other") => void;
  onTogglePin?: (m: MessageSummary) => void;
  /** While searching: continue the search on the servers. */
  onSearchServer?: () => void;
  serverSearchState?: "idle" | "loading" | "done";
}

export function MessageList(p: MessageListProps) {
  const s = useStyles();
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(() => {
    const list = p.messages.filter((m) => (filter === "unread" ? !m.isRead : filter === "flagged" ? m.isFlagged : true));
    if (!p.conversations) return list;
    // Newest message represents the conversation; unread if any part is unread.
    const seen = new Map<string, MessageSummary>();
    for (const m of list) {
      const k = convKey(m);
      const first = seen.get(k);
      if (!first) seen.set(k, m);
      else if (!m.isRead && first.isRead) seen.set(k, { ...first, isRead: false });
    }
    return [...seen.values()];
  }, [p.messages, filter, p.conversations]);
  const groups = useMemo(() => {
    const pinned = filtered.filter((m) => m.pinned);
    const rest = groupMessages(filtered.filter((m) => !m.pinned));
    return pinned.length ? [{ label: tl("Angeheftet"), items: pinned }, ...rest] : rest;
  }, [filtered]);

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <section className={s.root} aria-label={tl("Nachrichtenliste")}>
      <div className={s.header}>
        {p.focusTab && p.onFocusTab ? (
          <TabList size="small" selectedValue={p.focusTab} onTabSelect={(_, d) => p.onFocusTab!(d.value as "focused" | "other")} style={{ flex: 1 }}>
            <Tab value="focused">{tl("Relevant")}</Tab>
            <Tab value="other">
              {tl("Sonstige")}
              {!!p.focusUnread?.[1] && p.focusTab === "focused" && <CounterBadge size="small" appearance="ghost" count={p.focusUnread[1]} style={{ marginLeft: 4 }} />}
            </Tab>
          </TabList>
        ) : (
          <span className={s.title}>{p.title}</span>
        )}
        {p.loading && <Spinner size="tiny" />}
        <Menu
          checkedValues={{ filter: [filter] }}
          onCheckedValueChange={(_, d) => setFilter((d.checkedItems[0] as Filter) ?? "all")}
        >
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={tl("Filter")} relationship="label">
              <Button appearance={filter === "all" ? "subtle" : "transparent"} icon={<Filter20Regular />} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItemRadio name="filter" value="all">{tl("Alle")}</MenuItemRadio>
              <MenuItemRadio name="filter" value="unread">{tl("Ungelesen")}</MenuItemRadio>
              <MenuItemRadio name="filter" value="flagged">{tl("Gekennzeichnet")}</MenuItemRadio>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      {filtered.length === 0 ? (
        <div className={s.empty}>
          {p.loading ? <Spinner /> : <Text>{filter === "all" ? tl("Hier gibt es nichts.") : tl("Keine passenden Elemente.")}</Text>}
          {p.onSearchServer && !p.loading && (
            p.serverSearchState === "loading" ? (
              <Spinner size="tiny" label={tl("Suche auf dem Server…")} />
            ) : p.serverSearchState === "done" ? (
              <Text size={200}>{tl("Auch auf dem Server nichts gefunden.")}</Text>
            ) : (
              <Button appearance="subtle" size="small" onClick={p.onSearchServer}>{tl("Auf dem Server weitersuchen")}</Button>
            )
          )}
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
                    onDoubleClick={() => p.onOpen?.(m)}
                    onContextMenu={(e) => p.onContextMenu?.(m, e)}
                  >
                    <Avatar name={displayName(person)} size={32} color="colorful" />
                    <div className={s.body}>
                      <div className={s.row}>
                        <span className={mergeClasses(s.from, !m.isRead && s.bold)}>
                          {p.showFrom === "to" ? tl("An: {0}", displayName(person)) : displayName(person)}
                        </span>
                        <span className={s.icons}>
                          {m.pinned && <Pin16Filled style={{ color: tokens.colorBrandForeground1 }} />}
                          {m.snoozedUntil && <Clock16Regular />}
                          {m.importance === "high" && <Important16Filled style={{ color: tokens.colorPaletteRedForeground1 }} />}
                          {m.hasAttachments && <Attach16Regular />}
                          {m.isFlagged && <Flag16Filled className={s.flag} />}
                        </span>
                      </div>
                      <div className={s.row}>
                        <span className={mergeClasses(s.subject, !m.isRead && s.brand)}>{m.subject || tl("(Kein Betreff)")}</span>
                        {p.conversations && (p.threadCounts?.[m.threadKey ?? ""] ?? 0) > 1 && (
                          <span className={s.count} title={tl("Nachrichten in dieser Unterhaltung")}>{p.threadCounts![m.threadKey!]}</span>
                        )}
                        <span className={mergeClasses(s.date, !m.isRead && s.brand)}>{listDate(m.date)}</span>
                      </div>
                      <div className={s.previewRow}>
                        <CategoryChips categories={m.categories} />
                        <span className={s.preview}>{m.preview || "\u00a0"}</span>
                      </div>
                    </div>
                    <div className={mergeClasses(s.hoverActions, "ondura-hover-actions")}>
                      <Tooltip content={tl("Löschen")} relationship="label">
                        <Button size="small" appearance="subtle" icon={<Delete16Regular />} onClick={stop(() => p.onDelete(m))} />
                      </Tooltip>
                      <Tooltip content={m.isRead ? tl("Als ungelesen markieren") : tl("Als gelesen markieren")} relationship="label">
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={m.isRead ? <MailUnread16Regular /> : <MailRead16Regular />}
                          onClick={stop(() => p.onToggleRead(m))}
                        />
                      </Tooltip>
                      <Tooltip content={m.isFlagged ? tl("Kennzeichnung entfernen") : tl("Kennzeichnen")} relationship="label">
                        <Button size="small" appearance="subtle" icon={<Flag16Regular />} onClick={stop(() => p.onToggleFlag(m))} />
                      </Tooltip>
                      {p.onTogglePin && (
                        <Tooltip content={m.pinned ? tl("Lösen") : tl("Anheften")} relationship="label">
                          <Button size="small" appearance="subtle" icon={m.pinned ? <Pin16Filled /> : <Pin16Regular />} onClick={stop(() => p.onTogglePin!(m))} />
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {p.onSearchServer && (
            <div className={s.more}>
              {p.serverSearchState === "loading" ? (
                <Spinner size="tiny" label={tl("Suche auf dem Server…")} />
              ) : p.serverSearchState === "done" ? (
                <span>{tl("Suche auf dem Server abgeschlossen.")}</span>
              ) : (
                <Button appearance="subtle" size="small" onClick={p.onSearchServer}>{tl("Auf dem Server weitersuchen")}</Button>
              )}
            </div>
          )}
          {p.onLoadOlder && filter === "all" && (
            <div className={s.more}>
              {p.olderState === "loading" ? (
                <Spinner size="tiny" label={tl("Ältere Nachrichten werden geladen…")} />
              ) : p.olderState === "done" ? (
                <span>{tl("Keine weiteren Nachrichten auf dem Server.")}</span>
              ) : (
                <Button appearance="subtle" size="small" onClick={p.onLoadOlder}>{tl("Ältere Nachrichten vom Server laden")}</Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
