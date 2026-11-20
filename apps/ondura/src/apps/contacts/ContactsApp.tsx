import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Field,
  Input,
  MenuItem,
  Spinner,
  Text,
  Textarea,
  Toolbar,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add16Regular,
  ArrowDownload16Regular,
  ArrowSync20Regular,
  Building16Regular,
  Calendar16Regular,
  Call16Regular,
  Delete16Regular,
  Delete20Regular,
  Edit20Regular,
  Location16Regular,
  Mail16Regular,
  Note16Regular,
  People16Regular,
  PeopleTeam16Regular,
  ArrowExportUp16Regular,
  PersonAdd20Regular,
  People48Regular,
} from "@fluentui/react-icons";
import { api, errorMessage, isTauri } from "../../lib/api";
import { contactName, newContact, pim, type Collection, type Contact, type Labeled, type PostalAddress } from "../../lib/pim";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { AccountDialog } from "../mail/AccountDialog";
import { CollectionPane } from "../pim/CollectionPane";
import { usePimCollections, writable } from "../pim/usePim";
import { requestCompose } from "../../lib/bus";
import { DuplicatesDialog, OrgChartView, mergeContacts } from "./ContactExtras";
import type { DirectoryEntry, OrgInfo } from "../../lib/types";
import { PeopleSync16Regular, Organization16Regular } from "@fluentui/react-icons";
import { tl, LOCALE } from "../../lib/i18n";
import { openContextMenu, type MenuEntry } from "../../shell/contextMenu";

const useStyles = makeStyles({
  root: { height: "100vh", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  panes: { flex: 1, display: "flex", minHeight: 0, minWidth: 0, padding: "8px", gap: "8px" },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusLarge, boxShadow: tokens.shadow2, overflow: "hidden", display: "flex", flexDirection: "column" },
  list: { width: "320px", flexShrink: 0 },
  listHead: { padding: "10px 16px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  listScroll: { flex: 1, overflowY: "auto" },
  letter: {
    position: "sticky",
    top: 0,
    padding: "4px 16px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
  },
  item: {
    display: "flex",
    userSelect: "none",
    alignItems: "center",
    gap: "12px",
    padding: "8px 16px",
    cursor: "pointer",
    borderLeft: "3px solid transparent",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  itemSel: { backgroundColor: tokens.colorNeutralBackground1Selected, borderLeft: `3px solid ${tokens.colorBrandStroke1}` },
  itemText: { minWidth: 0, display: "flex", flexDirection: "column" },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  sub: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  detail: { flex: 1, minWidth: 0 },
  detailScroll: { flex: 1, overflowY: "auto", padding: "24px 32px" },
  hero: { display: "flex", alignItems: "center", gap: "20px", marginBottom: "24px" },
  heroName: { fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightHero700 },
  section: { display: "grid", gridTemplateColumns: "24px 120px 1fr", gap: "10px 8px", alignItems: "baseline", maxWidth: "640px" },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  icon: { color: tokens.colorNeutralForeground3, alignSelf: "center" },
  link: { color: tokens.colorBrandForegroundLink, cursor: "pointer", ":hover": { textDecoration: "underline" } },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", color: tokens.colorNeutralForeground3 },
  form: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", maxWidth: "680px" },
  full: { gridColumn: "1 / -1" },
  multi: { gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "6px" },
  multiRow: { display: "grid", gridTemplateColumns: "120px 1fr 32px", gap: "6px", "& > *": { minWidth: 0 } },
  addrRow: { display: "grid", gridTemplateColumns: "110px 2fr 80px 1.5fr 1fr 32px", gap: "6px", "& > *": { minWidth: 0 } },
  formHead: { gridColumn: "1 / -1", fontWeight: tokens.fontWeightSemibold, marginTop: "8px" },
  groupChip: {
    padding: "1px 8px",
    borderRadius: "10px",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    cursor: "pointer",
  },
  groupHead: { padding: "10px 12px 2px", fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  groupItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minHeight: "30px",
    padding: "0 12px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  groupSel: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  dropTarget: { backgroundColor: tokens.colorBrandBackground2, outline: `2px dashed ${tokens.colorBrandStroke1}`, outlineOffset: "-2px" },
  manySelected: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "24px", textAlign: "center" },
  manyActions: { display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" },
  toolbar: { padding: "6px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", gap: "4px" },
});

const LABELS: Record<string, string> = { work: tl("Geschäftlich"), home: tl("Privat"), mobile: tl("Mobil"), cell: tl("Mobil"), other: tl("Sonstige"), fax: tl("Fax"), main: tl("Haupt"), "": "Sonstige" };
const label = (l: string) => LABELS[l.toLowerCase()] ?? l;

function initialOf(c: Contact): string {
  const key = (c.familyName || contactName(c)).trim();
  const ch = key.charAt(0).toUpperCase();
  return /[A-ZÄÖÜ]/.test(ch) ? ch.replace("Ä", "A").replace("Ö", "O").replace("Ü", "U") : "#";
}

export function ContactsApp() {
  const s = useStyles();
  const notify = useNotify();
  const { collections, accountName, reload, revision, bump, sync, syncing } = usePimCollections("contacts");
  const [bookId, setBookId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accountDialog, setAccountDialog] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [allGroups, setAllGroups] = useState<string[]>([]);
  const [dupesOpen, setDupesOpen] = useState(false);
  // Multi-selection (Strg/Umschalt+Klick, Strg+A): two or more ids.
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const dragged = useRef<Contact[]>([]);
  const [groupDrop, setGroupDrop] = useState<string | null>(null);

  useEffect(() => {
    pim.contacts(null).then(
      (all) => setAllGroups([...new Set(all.flatMap((c) => c.groups ?? []))].sort((a, b) => a.localeCompare(b, LOCALE))),
      () => {},
    );
  }, [revision]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContacts(await pim.contacts(bookId, query.trim() || undefined));
    } catch (e) {
      notify(tl("Kontakte konnten nicht geladen werden"), errorMessage(e), "error");
    } finally {
      setLoading(false);
      splashDone();
    }
  }, [bookId, query, notify]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, revision]);

  const sorted = useMemo(
    () => contacts.filter((c) => !group || (c.groups ?? []).includes(group)).sort((a, b) => (a.familyName || contactName(a)).localeCompare(b.familyName || contactName(b), LOCALE, { sensitivity: "base" })),
    [contacts, group],
  );
  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  const book = collections.find((c) => c.id === (draft?.collectionId ?? selected?.collectionId));
  const books = writable(collections);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    if (!bookId && !query) for (const c of contacts) m[c.collectionId] = (m[c.collectionId] ?? 0) + 1;
    return m;
  }, [contacts, bookId, query]);

  const startNew = () => {
    const target = (bookId && books.find((b) => b.id === bookId)) || books[0];
    if (!target) {
      notify(tl("Kein beschreibbares Adressbuch"), undefined, "warning");
      return;
    }
    setDraft(newContact(target.id));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const clean: Contact = {
        ...draft,
        emails: draft.emails.filter((e) => e.value.trim()),
        phones: draft.phones.filter((p) => p.value.trim()),
        addresses: draft.addresses.filter((a) => a.street || a.city || a.postalCode || a.country),
        displayName: draft.displayName.trim() || `${draft.givenName} ${draft.familyName}`.trim(),
      };
      await pim.saveContact(clean.collectionId, clean);
      setDraft(null);
      bump();
      if (clean.id) setSelectedId(clean.id);
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Contact) => {
    if (!(await api.confirm(tl("Kontakt „{0}“ löschen?", contactName(c)), tl("Kontakt löschen")))) return;
    try {
      await pim.deleteContact(c.id);
      setSelectedId(null);
      bump();
    } catch (e) {
      notify(tl("Löschen fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  const multi = picked.length > 1;
  const pickedContacts = multi ? sorted.filter((c) => picked.includes(c.id)) : selected ? [selected] : [];
  useEffect(() => setPicked([]), [bookId, group, query]);

  /** Click, Strg+click (toggle), Umschalt+click (range) in the list. */
  const listSelect = (c: Contact, e: React.MouseEvent) => {
    setDraft(null);
    const current = picked.length ? picked : selectedId ? [selectedId] : [];
    let next: string[] | null = null;
    if (e.ctrlKey || e.metaKey) next = current.includes(c.id) ? current.filter((x) => x !== c.id) : [...current, c.id];
    else if (e.shiftKey) {
      const order = sorted.map((x) => x.id);
      const from = order.indexOf(anchor.current ?? selectedId ?? c.id);
      const to = order.indexOf(c.id);
      if (from >= 0 && to >= 0) next = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    }
    if (!e.shiftKey) anchor.current = c.id;
    if (next && next.length > 1) {
      setPicked(next);
      return;
    }
    setPicked([]);
    setSelectedId(next?.length === 0 ? null : (next?.[0] ?? c.id));
  };

  const writableBook = (c: Contact) => !collections.find((b) => b.id === c.collectionId)?.readOnly;

  /** Adds (or removes) a group for contacts of writable address books. */
  const setGroupFor = async (list: Contact[], g: string, add: boolean) => {
    const changed = list.filter((c) => writableBook(c) && (c.groups ?? []).includes(g) !== add);
    try {
      for (const c of changed) await pim.saveContact(c.collectionId, { ...c, groups: add ? [...(c.groups ?? []), g] : (c.groups ?? []).filter((x) => x !== g) });
      if (changed.length) notify(add ? tl("{0} Kontakt(e) zu „{1}“ hinzugefügt", changed.length, g) : tl("{0} Kontakt(e) aus „{1}“ entfernt", changed.length, g), undefined, "success");
    } catch (e) {
      notify(tl("Speichern fehlgeschlagen"), errorMessage(e), "error");
    }
    bump();
  };

  /** Moves contacts into another address book (a copy there, then the original goes). */
  const moveContacts = async (list: Contact[], target: Collection) => {
    const movable = list.filter((c) => c.collectionId !== target.id && writableBook(c));
    try {
      for (const c of movable) {
        await pim.saveContact(target.id, { ...c, id: "", remoteId: "", collectionId: target.id, accountId: target.accountId });
        await pim.deleteContact(c.id);
      }
      if (movable.length) notify(tl("{0} Kontakt(e) verschoben", movable.length), target.name, "success");
    } catch (e) {
      notify(tl("Verschieben fehlgeschlagen"), errorMessage(e), "error");
    }
    setPicked([]);
    setSelectedId(null);
    bump();
  };

  const removeMany = async (list: Contact[]) => {
    const deletable = list.filter(writableBook);
    if (!deletable.length || !(await api.confirm(tl("{0} Kontakte löschen?", deletable.length), tl("Kontakte löschen")))) return;
    try {
      for (const c of deletable) await pim.deleteContact(c.id);
    } catch (e) {
      notify(tl("Löschen fehlgeschlagen"), errorMessage(e), "error");
    }
    setPicked([]);
    setSelectedId(null);
    bump();
  };

  const mailTo = (list: Contact[]) => requestCompose({ to: list.filter((c) => c.emails[0]).map((c) => ({ name: contactName(c), email: c.emails[0].value })) });

  const exportList = async (list: Contact[], name: string) => {
    try {
      const path = await pim.exportContacts(list.map((c) => c.id), `${name}.vcf`);
      if (path) notify(list.length === 1 ? tl("1 Kontakt exportiert") : tl("{0} Kontakte exportiert", list.length), path, "success");
      else if (!isTauri) notify(tl("Export ist nur in der Desktop-App verfügbar"), undefined, "info");
    } catch (e) {
      notify(tl("Export fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  /** Menu entries for the selected contacts. */
  const manyMenu = (list: Contact[]): MenuEntry[] => [
    { label: tl("{0} Kontakte ausgewählt", list.length), disabled: true },
    "divider",
    { label: tl("E-Mail senden"), disabled: !list.some((c) => c.emails[0]), onClick: () => mailTo(list) },
    { label: tl("Als vCard exportieren"), onClick: () => void exportList(list, tl("Kontakte")) },
    {
      label: tl("Zur Gruppe hinzufügen"),
      disabled: !allGroups.length,
      items: allGroups.map((g): MenuEntry => ({ label: g, onClick: () => void setGroupFor(list, g, true) })),
    },
    !!group && { label: tl("Aus Gruppe „{0}“ entfernen", group), onClick: () => void setGroupFor(list, group, false) },
    { label: tl("In Adressbuch verschieben"), items: books.map((b): MenuEntry => ({ label: b.name, onClick: () => void moveContacts(list, b) })) },
    "divider",
    { label: tl("Löschen"), onClick: () => void removeMany(list) },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA"].includes(t.tagName) || document.querySelector("[role=dialog]") || draft) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && sorted.length > 1) {
        e.preventDefault();
        setPicked(sorted.map((c) => c.id));
      } else if (e.key === "Escape" && multi) setPicked([]);
      else if (e.key === "Delete" && pickedContacts.length) void removeMany(pickedContacts);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const importInto = async (collectionId: string) => {
    try {
      const n = await pim.importContacts(collectionId);
      if (n > 0) {
        notify(n === 1 ? tl("1 Kontakt importiert") : tl("{0} Kontakte importiert", n), undefined, "success");
        bump();
      } else if (!isTauri) notify(tl("Import ist nur in der Desktop-App verfügbar"), undefined, "info");
    } catch (e) {
      notify(tl("Import fehlgeschlagen"), errorMessage(e), "error");
    }
  };

  let lastLetter = "";

  return (
    <div className={s.root}>
      <SuiteHeader appName={tl("Ondura Mail")} searchPlaceholder={tl("Kontakte suchen")} onSearch={setQuery} />
      <div className={s.body}>
        <AppRail current="contacts" />
        <div className={s.panes}>
          <CollectionPane
            top={
              <>
                <Button appearance="primary" icon={<PersonAdd20Regular />} style={{ margin: "8px 8px 4px" }} onClick={startNew}>
                  {tl("Neuer Kontakt")}
                </Button>
                {allGroups.length > 0 && (
                  <div style={{ padding: "0 4px" }}>
                    <div className={s.groupHead}>{tl("Gruppen")}</div>
                    {allGroups.map((g) => (
                      <button
                        key={g}
                        className={mergeClasses(s.groupItem, group === g && s.groupSel, groupDrop === g && s.dropTarget)}
                        onClick={() => setGroup((cur) => (cur === g ? null : g))}
                        onDragOver={(e) => {
                          if (!dragged.current.length) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "copy";
                          if (groupDrop !== g) setGroupDrop(g);
                        }}
                        onDragLeave={() => setGroupDrop((d) => (d === g ? null : d))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setGroupDrop(null);
                          const list = dragged.current;
                          dragged.current = [];
                          void setGroupFor(list, g, true);
                        }}
                      >
                        <PeopleTeam16Regular />
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </>
            }
            collections={[...collections]}
            accountName={accountName}
            mode="select"
            canDrop={(b) => b.kind === "contacts" && !b.readOnly && dragged.current.some((c) => c.collectionId !== b.id)}
            onDrop={(b) => {
              const list = dragged.current;
              dragged.current = [];
              void moveContacts(list, b);
            }}
            selectedId={bookId}
            onSelect={(id) => setBookId((cur) => (cur === id ? null : id))}
            counts={counts}
            newLabel={tl("Neues Adressbuch")}
            onCreate={async (name) => {
              try {
                await pim.createCollection("contacts", name, null);
                await reload();
              } catch (e) {
                notify(tl("Adressbuch konnte nicht erstellt werden"), errorMessage(e), "error");
              }
            }}
            onDelete={async (c) => {
              if (!(await api.confirm(tl("Adressbuch „{0}“ mit allen Kontakten löschen?", c.name), tl("Adressbuch löschen")))) return;
              await pim.deleteCollection(c.id).catch((e) => notify(tl("Löschen fehlgeschlagen"), errorMessage(e), "error"));
              if (bookId === c.id) setBookId(null);
              await reload();
            }}
            extraItems={(c) =>
              c.readOnly ? null : (
                <MenuItem icon={<ArrowDownload16Regular />} onClick={() => importInto(c.id)}>
                  {tl("vCard importieren…")}
                </MenuItem>
              )
            }
            onAddAccount={() => setAccountDialog(true)}
          />

          <section className={mergeClasses(s.card, s.list)}>
            <div className={s.listHead}>
              <Text weight="semibold">{group ? tl("Gruppe: {0}", group) : bookId ? collections.find((c) => c.id === bookId)?.name : tl("Alle Kontakte")}</Text>
              <span>
                {group && sorted.some((c) => c.emails[0]) && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Mail16Regular />}
                    title={tl("E-Mail an alle in der Gruppe")}
                    aria-label={tl("E-Mail an Gruppe")}
                    onClick={() => requestCompose({ to: sorted.filter((c) => c.emails[0]).map((c) => ({ name: contactName(c), email: c.emails[0].value })) })}
                  />
                )}
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowExportUp16Regular />}
                  title={tl("Als vCard exportieren")}
                  aria-label={tl("Exportieren")}
                  disabled={!sorted.length}
                  onClick={async () => {
                    try {
                      const path = await pim.exportContacts(sorted.map((c) => c.id), `${group ?? tl("Kontakte")}.vcf`);
                      if (path) notify(sorted.length === 1 ? tl("1 Kontakt exportiert") : tl("{0} Kontakte exportiert", sorted.length), path, "success");
                      else if (!isTauri) notify(tl("Export ist nur in der Desktop-App verfügbar"), undefined, "info");
                    } catch (e) {
                      notify(tl("Export fehlgeschlagen"), errorMessage(e), "error");
                    }
                  }}
                />
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<PeopleSync16Regular />}
                  title={tl("Doppelte Kontakte zusammenführen")}
                  aria-label={tl("Doppelte Kontakte zusammenführen")}
                  onClick={() => setDupesOpen(true)}
                />
                {loading && <Spinner size="extra-tiny" />}
                <Button appearance="subtle" size="small" icon={syncing ? <Spinner size="extra-tiny" /> : <ArrowSync20Regular />} disabled={syncing} onClick={sync} aria-label={tl("Synchronisieren")} title={tl("Synchronisieren")} />
              </span>
            </div>
            <div className={s.listScroll}>
              {sorted.length === 0 && !loading && <Text style={{ padding: 16, display: "block", color: tokens.colorNeutralForeground3 }}>{query ? tl("Keine Treffer.") : tl("Noch keine Kontakte.")}</Text>}
              {sorted.map((c) => {
                const letter = initialOf(c);
                const head = letter !== lastLetter;
                lastLetter = letter;
                return (
                  <div key={c.id}>
                    {head && <div className={s.letter}>{letter}</div>}
                    <div
                      className={mergeClasses(s.item, ((multi ? picked.includes(c.id) : c.id === selectedId) && !draft) && s.itemSel)}
                      onClick={(e) => listSelect(c, e)}
                      draggable
                      onDragStart={(e) => {
                        const list = multi && picked.includes(c.id) ? pickedContacts : [c];
                        dragged.current = list;
                        e.dataTransfer.effectAllowed = "copyMove";
                        e.dataTransfer.setData("text/plain", list.map(contactName).join("\n"));
                      }}
                      onDragEnd={() => (dragged.current = [])}
                      onContextMenu={(e) => {
                        if (multi && picked.includes(c.id)) {
                          openContextMenu(e, manyMenu(pickedContacts));
                          return;
                        }
                        setPicked([]);
                        setDraft(null);
                        setSelectedId(c.id);
                        openContextMenu(e, [
                          { label: tl("E-Mail senden"), disabled: !c.emails[0], onClick: () => requestCompose({ to: [{ name: contactName(c), email: c.emails[0].value }] }) },
                          { label: tl("Bearbeiten"), onClick: () => (setSelectedId(c.id), setDraft(structuredClone(c))) },
                          "divider",
                          { label: tl("Löschen"), onClick: () => void remove(c) },
                        ]);
                      }}
                    >
                      <Avatar name={contactName(c)} color="colorful" size={32} image={c.photo ? { src: c.photo } : undefined} />
                      <div className={s.itemText}>
                        <span className={s.ellipsis}>{contactName(c)}</span>
                        <span className={mergeClasses(s.sub, s.ellipsis)}>{c.company || c.emails[0]?.value || c.phones[0]?.value || ""}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={mergeClasses(s.card, s.detail)}>
            {multi && !draft ? (
              <div className={s.manySelected}>
                <Text size={500} weight="semibold">
                  {tl("{0} Kontakte ausgewählt", pickedContacts.length)}
                </Text>
                <div className={s.manyActions}>
                  <Button icon={<Mail16Regular />} disabled={!pickedContacts.some((c) => c.emails[0])} onClick={() => mailTo(pickedContacts)}>
                    {tl("E-Mail senden")}
                  </Button>
                  <Button icon={<ArrowExportUp16Regular />} onClick={() => void exportList(pickedContacts, tl("Kontakte"))}>
                    {tl("Exportieren")}
                  </Button>
                  <Button icon={<PeopleTeam16Regular />} disabled={!allGroups.length} onClick={(e) => openContextMenu(e, allGroups.map((g): MenuEntry => ({ label: g, onClick: () => void setGroupFor(pickedContacts, g, true) })))}>
                    {tl("Zur Gruppe hinzufügen")}
                  </Button>
                  <Button icon={<Delete20Regular />} onClick={() => void removeMany(pickedContacts)}>
                    {tl("Löschen")}
                  </Button>
                  <Button appearance="subtle" onClick={() => setPicked([])}>
                    {tl("Auswahl aufheben")}
                  </Button>
                </div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {tl("Tipp: Ziehen Sie die Auswahl auf eine Gruppe oder ein Adressbuch.")}
                </Text>
              </div>
            ) : draft ? (
              <ContactEditor draft={draft} setDraft={setDraft} books={books} saving={saving} onSave={save} onCancel={() => setDraft(null)} />
            ) : selected ? (
              <>
                <Toolbar className={s.toolbar}>
                  {!book?.readOnly && (
                    <>
                      <Button appearance="subtle" icon={<Edit20Regular />} onClick={() => setDraft(structuredClone(selected))}>
                        {tl("Bearbeiten")}
                      </Button>
                      <Button appearance="subtle" icon={<Delete20Regular />} onClick={() => remove(selected)}>
                        {tl("Löschen")}
                      </Button>
                    </>
                  )}
                </Toolbar>
                <div className={s.detailScroll}>
                  <div className={s.hero}>
                    <Avatar name={contactName(selected)} color="colorful" size={96} image={selected.photo ? { src: selected.photo } : undefined} />
                    <div>
                      <div className={s.heroName}>{contactName(selected)}</div>
                      {(selected.jobTitle || selected.company) && <Text>{[selected.jobTitle, selected.company].filter(Boolean).join(" · ")}</Text>}
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        {selected.emails[0] && (
                          <Button size="small" icon={<Mail16Regular />} onClick={() => requestCompose({ to: [{ name: contactName(selected), email: selected.emails[0].value }] })}>
                            {tl("E-Mail senden")}
                          </Button>
                        )}
                        {selected.phones[0] && (
                          <Button size="small" icon={<Call16Regular />} onClick={() => api.openExternal(`tel:${selected.phones[0].value.replace(/\s/g, "")}`)}>
                            {tl("Anrufen")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={s.section}>
                    {selected.emails.map((e, i) => (
                      <Row key={`e${i}`} icon={<Mail16Regular />} label={tl("E-Mail ({0})", label(e.label))}>
                        <span className={s.link} onClick={() => requestCompose({ to: [{ name: contactName(selected), email: e.value }] })}>
                          {e.value}
                        </span>
                      </Row>
                    ))}
                    {selected.phones.map((p, i) => (
                      <Row key={`p${i}`} icon={<Call16Regular />} label={tl("Telefon ({0})", label(p.label))}>
                        <span className={s.link} onClick={() => api.openExternal(`tel:${p.value.replace(/\s/g, "")}`)}>
                          {p.value}
                        </span>
                      </Row>
                    ))}
                    {selected.company && (
                      <Row icon={<Building16Regular />} label={tl("Firma")}>
                        {selected.company}
                        {selected.jobTitle ? `, ${selected.jobTitle}` : ""}
                      </Row>
                    )}
                    {selected.addresses.map((a, i) => (
                      <Row key={`a${i}`} icon={<Location16Regular />} label={tl("Adresse ({0})", label(a.label))}>
                        <span style={{ whiteSpace: "pre-line" }}>{[a.street, `${a.postalCode} ${a.city}`.trim(), a.country].filter(Boolean).join("\n")}</span>
                      </Row>
                    ))}
                    {selected.birthday && (
                      <Row icon={<Calendar16Regular />} label={tl("Geburtstag")}>
                        {new Date(`${selected.birthday.slice(0, 10)}T12:00:00`).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: selected.birthday.startsWith("1604") ? undefined : "numeric" })}
                      </Row>
                    )}
                    {!!selected.groups?.length && (
                      <Row icon={<PeopleTeam16Regular />} label={tl("Gruppen")}>
                        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                          {selected.groups.map((g) => (
                            <span key={g} className={s.groupChip} onClick={() => setGroup(g)}>
                              {g}
                            </span>
                          ))}
                        </span>
                      </Row>
                    )}
                    {selected.notes && (
                      <Row icon={<Note16Regular />} label={tl("Notizen")}>
                        <span style={{ whiteSpace: "pre-wrap" }}>{selected.notes}</span>
                      </Row>
                    )}
                    {selected.emails[0] && (
                      <OrgSection email={selected.emails[0].value} onPick={(p) => setQuery(p.name)} />
                    )}
                    {book && (
                      <Row icon={<People16Regular />} label={tl("Adressbuch")}>
                        {book.name} <span className={s.sub}>· {accountName(book.accountId)}</span>
                      </Row>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className={s.empty}>
                <People48Regular />
                <Text>{tl("Wählen Sie einen Kontakt aus.")}</Text>
              </div>
            )}
          </section>
        </div>
      </div>
      <AccountDialog pim open={accountDialog} onClose={() => setAccountDialog(false)} onAdded={() => void reload()} />
      <DuplicatesDialog
        open={dupesOpen}
        contacts={contacts.filter((c) => books.some((b) => b.id === c.collectionId))}
        bookName={(c) => collections.find((b) => b.id === c.collectionId)?.name ?? ""}
        onClose={() => setDupesOpen(false)}
        onMerge={async (groups) => {
          let merged = 0;
          for (const g of groups) {
            try {
              const target = mergeContacts(g);
              await pim.saveContact(target.collectionId, target);
              for (const c of g.slice(1)) await pim.deleteContact(c.id);
              merged++;
            } catch (e) {
              notify(tl("Zusammenführen fehlgeschlagen"), errorMessage(e), "error");
            }
          }
          if (merged) notify(tl("{0} Kontakt(e) zusammengeführt", merged), undefined, "success");
          bump();
        }}
      />
    </div>
  );
}

/** Org chart of a contact, shown only when the directory knows the person. */
function OrgSection({ email, onPick }: { email: string; onPick: (p: DirectoryEntry) => void }) {
  const [info, setInfo] = useState<OrgInfo | null>(null);
  useEffect(() => {
    let off = false;
    setInfo(null);
    api.orgInfo(email).then((i) => !off && setInfo(i), () => {});
    return () => {
      off = true;
    };
  }, [email]);
  if (!info || (!info.manager && !info.reports.length)) return null;
  return (
    <Row icon={<Organization16Regular />} label={tl("Organisation")}>
      <OrgChartView info={info} onPick={onPick} />
    </Row>
  );
}

function Row({ icon, label: l, children }: { icon: React.JSX.Element; label: string; children: React.ReactNode }) {
  const s = useStyles();
  return (
    <>
      <span className={s.icon}>{icon}</span>
      <span className={s.label}>{l}</span>
      <span>{children}</span>
    </>
  );
}

const PHONE_LABELS = ["mobile", "work", "home", "other"];
const EMAIL_LABELS = ["work", "home", "other"];

function ContactEditor({
  draft,
  setDraft,
  books,
  saving,
  onSave,
  onCancel,
}: {
  draft: Contact;
  setDraft: (c: Contact) => void;
  books: { id: string; name: string }[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const s = useStyles();
  const set = <K extends keyof Contact>(k: K, v: Contact[K]) => setDraft({ ...draft, [k]: v });
  const photoInput = useRef<HTMLInputElement>(null);
  const [groupsText, setGroupsText] = useState((draft.groups ?? []).join(", "));
  const isNew = !draft.id;

  const labeledList = (key: "emails" | "phones", labels: string[], placeholder: string, type: "email" | "tel") => {
    const list = draft[key];
    const update = (i: number, patch: Partial<Labeled>) => set(key, list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    return (
      <div className={s.multi}>
        {list.map((item, i) => (
          <div key={i} className={s.multiRow}>
            <select value={item.label} onChange={(e) => update(i, { label: e.target.value })} style={selectStyle}>
              {[...new Set([...labels, item.label])].map((l) => (
                <option key={l} value={l}>
                  {label(l)}
                </option>
              ))}
            </select>
            <Input type={type} value={item.value} placeholder={placeholder} onChange={(_, d) => update(i, { value: d.value })} />
            <Button appearance="subtle" icon={<Delete16Regular />} onClick={() => set(key, list.filter((_, j) => j !== i))} aria-label={tl("Entfernen")} />
          </div>
        ))}
        <Button appearance="transparent" size="small" icon={<Add16Regular />} style={{ alignSelf: "flex-start" }} onClick={() => set(key, [...list, { label: labels[0], value: "" }])}>
          {key === "emails" ? tl("E-Mail-Adresse hinzufügen") : tl("Telefonnummer hinzufügen")}
        </Button>
      </div>
    );
  };

  const updateAddr = (i: number, patch: Partial<PostalAddress>) => set("addresses", draft.addresses.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <>
      <Toolbar className={s.toolbar}>
        <Button appearance="primary" onClick={onSave} disabled={saving} icon={saving ? <Spinner size="tiny" /> : undefined}>
          {tl("Speichern")}
        </Button>
        <Button appearance="subtle" onClick={onCancel} disabled={saving}>
          {tl("Abbrechen")}
        </Button>
      </Toolbar>
      <div className={s.detailScroll}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <Avatar name={contactName(draft)} color="colorful" size={72} image={draft.photo ? { src: draft.photo } : undefined} />
          <div>
            <Text size={600} weight="semibold" style={{ display: "block" }}>
              {isNew ? tl("Neuer Kontakt") : tl("Kontakt bearbeiten")}
            </Text>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <Button size="small" onClick={() => photoInput.current?.click()}>
                {tl("Foto wählen …")}
              </Button>
              {draft.photo && (
                <Button size="small" appearance="subtle" onClick={() => set("photo", null)}>
                  {tl("Foto entfernen")}
                </Button>
              )}
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) set("photo", await shrinkPhoto(file));
                }}
              />
            </div>
          </div>
        </div>
        <div className={s.form}>
          <Field label={tl("Vorname")}>
            <Input autoFocus value={draft.givenName} onChange={(_, d) => set("givenName", d.value)} />
          </Field>
          <Field label={tl("Nachname")}>
            <Input value={draft.familyName} onChange={(_, d) => set("familyName", d.value)} />
          </Field>
          <Field label={tl("Anzeigename")} hint={tl("Leer = Vor- und Nachname")}>
            <Input value={draft.displayName} onChange={(_, d) => set("displayName", d.value)} />
          </Field>
          {isNew ? (
            <Field label={tl("Adressbuch")}>
              <select value={draft.collectionId} onChange={(e) => set("collectionId", e.target.value)} style={selectStyle}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <span />
          )}
          <Field label={tl("Firma")}>
            <Input value={draft.company} onChange={(_, d) => set("company", d.value)} />
          </Field>
          <Field label={tl("Position")}>
            <Input value={draft.jobTitle} onChange={(_, d) => set("jobTitle", d.value)} />
          </Field>

          <Text className={s.formHead}>{tl("E-Mail")}</Text>
          {labeledList("emails", EMAIL_LABELS, "name@example.com", "email")}
          <Text className={s.formHead}>{tl("Telefon")}</Text>
          {labeledList("phones", PHONE_LABELS, "+49 …", "tel")}

          <Text className={s.formHead}>{tl("Adressen")}</Text>
          <div className={s.multi}>
            {draft.addresses.map((a, i) => (
              <div key={i} className={s.addrRow}>
                <select value={a.label} onChange={(e) => updateAddr(i, { label: e.target.value })} style={selectStyle}>
                  {["home", "work", "other"].map((l) => (
                    <option key={l} value={l}>
                      {label(l)}
                    </option>
                  ))}
                </select>
                <Input value={a.street} placeholder={tl("Straße")} onChange={(_, d) => updateAddr(i, { street: d.value })} />
                <Input value={a.postalCode} placeholder="PLZ" onChange={(_, d) => updateAddr(i, { postalCode: d.value })} />
                <Input value={a.city} placeholder={tl("Ort")} onChange={(_, d) => updateAddr(i, { city: d.value })} />
                <Input value={a.country} placeholder={tl("Land")} onChange={(_, d) => updateAddr(i, { country: d.value })} />
                <Button appearance="subtle" icon={<Delete16Regular />} onClick={() => set("addresses", draft.addresses.filter((_, j) => j !== i))} aria-label={tl("Entfernen")} />
              </div>
            ))}
            <Button
              appearance="transparent"
              size="small"
              icon={<Add16Regular />}
              style={{ alignSelf: "flex-start" }}
              onClick={() => set("addresses", [...draft.addresses, { label: "home", street: "", city: "", postalCode: "", country: "" }])}
            >
              {tl("Adresse hinzufügen")}
            </Button>
          </div>

          <Field label={tl("Gruppen")} className={s.full} hint={tl("Durch Komma getrennt, z. B. Familie, Verein")}>
            <Input
              value={groupsText}
              onChange={(_, d) => {
                setGroupsText(d.value);
                set("groups", d.value.split(",").map((g) => g.trim()).filter(Boolean));
              }}
            />
          </Field>
          <Field label={tl("Geburtstag")}>
            <Input type="date" value={draft.birthday?.slice(0, 10) ?? ""} onChange={(_, d) => set("birthday", d.value || null)} />
          </Field>
          <span />
          <Field label={tl("Notizen")} className={s.full}>
            <Textarea value={draft.notes} onChange={(_, d) => set("notes", d.value)} rows={4} resize="vertical" />
          </Field>
        </div>
      </div>
    </>
  );
}

const selectStyle: React.CSSProperties = {
  height: 32,
  borderRadius: 4,
  border: `1px solid ${tokens.colorNeutralStroke1}`,
  background: tokens.colorNeutralBackground1,
  color: tokens.colorNeutralForeground1,
  padding: "0 6px",
  fontFamily: "inherit",
};

/** Square photo, at most 256 px, as JPEG data URI (keeps vCards small). */
function shrinkPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(256, img.width, img.height);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error(tl("Bild konnte nicht gelesen werden")));
    img.src = URL.createObjectURL(file);
  });
}
