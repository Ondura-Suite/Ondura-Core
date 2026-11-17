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
import { contactName, newContact, pim, type Contact, type Labeled, type PostalAddress } from "../../lib/pim";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { AppRail } from "../../shell/AppRail";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { AccountDialog } from "../mail/AccountDialog";
import { CollectionPane } from "../pim/CollectionPane";
import { usePimCollections, writable } from "../pim/usePim";
import { requestCompose } from "../../lib/bus";

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
  toolbar: { padding: "6px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", gap: "4px" },
});

const LABELS: Record<string, string> = { work: "Geschäftlich", home: "Privat", mobile: "Mobil", cell: "Mobil", other: "Sonstige", fax: "Fax", main: "Haupt", "": "Sonstige" };
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

  useEffect(() => {
    pim.contacts(null).then(
      (all) => setAllGroups([...new Set(all.flatMap((c) => c.groups ?? []))].sort((a, b) => a.localeCompare(b, "de"))),
      () => {},
    );
  }, [revision]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContacts(await pim.contacts(bookId, query.trim() || undefined));
    } catch (e) {
      notify("Kontakte konnten nicht geladen werden", errorMessage(e), "error");
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
    () => contacts.filter((c) => !group || (c.groups ?? []).includes(group)).sort((a, b) => (a.familyName || contactName(a)).localeCompare(b.familyName || contactName(b), "de", { sensitivity: "base" })),
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
      notify("Kein beschreibbares Adressbuch", undefined, "warning");
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
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Contact) => {
    if (!(await api.confirm(`Kontakt „${contactName(c)}“ löschen?`, "Kontakt löschen"))) return;
    try {
      await pim.deleteContact(c.id);
      setSelectedId(null);
      bump();
    } catch (e) {
      notify("Löschen fehlgeschlagen", errorMessage(e), "error");
    }
  };

  const importInto = async (collectionId: string) => {
    try {
      const n = await pim.importContacts(collectionId);
      if (n > 0) {
        notify(`${n} Kontakt${n === 1 ? "" : "e"} importiert`, undefined, "success");
        bump();
      } else if (!isTauri) notify("Import ist nur in der Desktop-App verfügbar", undefined, "info");
    } catch (e) {
      notify("Import fehlgeschlagen", errorMessage(e), "error");
    }
  };

  let lastLetter = "";

  return (
    <div className={s.root}>
      <SuiteHeader appName="Orbit" searchPlaceholder="Kontakte suchen" onSearch={setQuery} />
      <div className={s.body}>
        <AppRail current="contacts" />
        <div className={s.panes}>
          <CollectionPane
            top={
              <>
                <Button appearance="primary" icon={<PersonAdd20Regular />} style={{ margin: "8px 8px 4px" }} onClick={startNew}>
                  Neuer Kontakt
                </Button>
                {allGroups.length > 0 && (
                  <div style={{ padding: "0 4px" }}>
                    <div className={s.groupHead}>Gruppen</div>
                    {allGroups.map((g) => (
                      <button key={g} className={mergeClasses(s.groupItem, group === g && s.groupSel)} onClick={() => setGroup((cur) => (cur === g ? null : g))}>
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
            selectedId={bookId}
            onSelect={(id) => setBookId((cur) => (cur === id ? null : id))}
            counts={counts}
            newLabel="Neues Adressbuch"
            onCreate={async (name) => {
              try {
                await pim.createCollection("contacts", name, null);
                await reload();
              } catch (e) {
                notify("Adressbuch konnte nicht erstellt werden", errorMessage(e), "error");
              }
            }}
            onDelete={async (c) => {
              if (!(await api.confirm(`Adressbuch „${c.name}“ mit allen Kontakten löschen?`, "Adressbuch löschen"))) return;
              await pim.deleteCollection(c.id).catch((e) => notify("Löschen fehlgeschlagen", errorMessage(e), "error"));
              if (bookId === c.id) setBookId(null);
              await reload();
            }}
            extraItems={(c) =>
              c.readOnly ? null : (
                <MenuItem icon={<ArrowDownload16Regular />} onClick={() => importInto(c.id)}>
                  vCard importieren…
                </MenuItem>
              )
            }
            onAddAccount={() => setAccountDialog(true)}
          />

          <section className={mergeClasses(s.card, s.list)}>
            <div className={s.listHead}>
              <Text weight="semibold">{group ? `Gruppe: ${group}` : bookId ? collections.find((c) => c.id === bookId)?.name : "Alle Kontakte"}</Text>
              <span>
                {group && sorted.some((c) => c.emails[0]) && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Mail16Regular />}
                    title="E-Mail an alle in der Gruppe"
                    aria-label="E-Mail an Gruppe"
                    onClick={() => requestCompose({ to: sorted.filter((c) => c.emails[0]).map((c) => ({ name: contactName(c), email: c.emails[0].value })) })}
                  />
                )}
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowExportUp16Regular />}
                  title="Als vCard exportieren"
                  aria-label="Exportieren"
                  disabled={!sorted.length}
                  onClick={async () => {
                    try {
                      const path = await pim.exportContacts(sorted.map((c) => c.id), `${group ?? "Kontakte"}.vcf`);
                      if (path) notify(`${sorted.length} Kontakt${sorted.length === 1 ? "" : "e"} exportiert`, path, "success");
                      else if (!isTauri) notify("Export ist nur in der Desktop-App verfügbar", undefined, "info");
                    } catch (e) {
                      notify("Export fehlgeschlagen", errorMessage(e), "error");
                    }
                  }}
                />
                {loading && <Spinner size="extra-tiny" />}
                <Button appearance="subtle" size="small" icon={syncing ? <Spinner size="extra-tiny" /> : <ArrowSync20Regular />} disabled={syncing} onClick={sync} aria-label="Synchronisieren" title="Synchronisieren" />
              </span>
            </div>
            <div className={s.listScroll}>
              {sorted.length === 0 && !loading && <Text style={{ padding: 16, display: "block", color: tokens.colorNeutralForeground3 }}>{query ? "Keine Treffer." : "Noch keine Kontakte."}</Text>}
              {sorted.map((c) => {
                const letter = initialOf(c);
                const head = letter !== lastLetter;
                lastLetter = letter;
                return (
                  <div key={c.id}>
                    {head && <div className={s.letter}>{letter}</div>}
                    <div
                      className={mergeClasses(s.item, c.id === selectedId && !draft && s.itemSel)}
                      onClick={() => {
                        setDraft(null);
                        setSelectedId(c.id);
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
            {draft ? (
              <ContactEditor draft={draft} setDraft={setDraft} books={books} saving={saving} onSave={save} onCancel={() => setDraft(null)} />
            ) : selected ? (
              <>
                <Toolbar className={s.toolbar}>
                  {!book?.readOnly && (
                    <>
                      <Button appearance="subtle" icon={<Edit20Regular />} onClick={() => setDraft(structuredClone(selected))}>
                        Bearbeiten
                      </Button>
                      <Button appearance="subtle" icon={<Delete20Regular />} onClick={() => remove(selected)}>
                        Löschen
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
                            E-Mail senden
                          </Button>
                        )}
                        {selected.phones[0] && (
                          <Button size="small" icon={<Call16Regular />} onClick={() => api.openExternal(`tel:${selected.phones[0].value.replace(/\s/g, "")}`)}>
                            Anrufen
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={s.section}>
                    {selected.emails.map((e, i) => (
                      <Row key={`e${i}`} icon={<Mail16Regular />} label={`E-Mail (${label(e.label)})`}>
                        <span className={s.link} onClick={() => requestCompose({ to: [{ name: contactName(selected), email: e.value }] })}>
                          {e.value}
                        </span>
                      </Row>
                    ))}
                    {selected.phones.map((p, i) => (
                      <Row key={`p${i}`} icon={<Call16Regular />} label={`Telefon (${label(p.label)})`}>
                        <span className={s.link} onClick={() => api.openExternal(`tel:${p.value.replace(/\s/g, "")}`)}>
                          {p.value}
                        </span>
                      </Row>
                    ))}
                    {selected.company && (
                      <Row icon={<Building16Regular />} label="Firma">
                        {selected.company}
                        {selected.jobTitle ? `, ${selected.jobTitle}` : ""}
                      </Row>
                    )}
                    {selected.addresses.map((a, i) => (
                      <Row key={`a${i}`} icon={<Location16Regular />} label={`Adresse (${label(a.label)})`}>
                        <span style={{ whiteSpace: "pre-line" }}>{[a.street, `${a.postalCode} ${a.city}`.trim(), a.country].filter(Boolean).join("\n")}</span>
                      </Row>
                    ))}
                    {selected.birthday && (
                      <Row icon={<Calendar16Regular />} label="Geburtstag">
                        {new Date(`${selected.birthday.slice(0, 10)}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: selected.birthday.startsWith("1604") ? undefined : "numeric" })}
                      </Row>
                    )}
                    {!!selected.groups?.length && (
                      <Row icon={<PeopleTeam16Regular />} label="Gruppen">
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
                      <Row icon={<Note16Regular />} label="Notizen">
                        <span style={{ whiteSpace: "pre-wrap" }}>{selected.notes}</span>
                      </Row>
                    )}
                    {book && (
                      <Row icon={<People16Regular />} label="Adressbuch">
                        {book.name} <span className={s.sub}>· {accountName(book.accountId)}</span>
                      </Row>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className={s.empty}>
                <People48Regular />
                <Text>Wählen Sie einen Kontakt aus.</Text>
              </div>
            )}
          </section>
        </div>
      </div>
      <AccountDialog pim open={accountDialog} onClose={() => setAccountDialog(false)} onAdded={() => void reload()} />
    </div>
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
            <Button appearance="subtle" icon={<Delete16Regular />} onClick={() => set(key, list.filter((_, j) => j !== i))} aria-label="Entfernen" />
          </div>
        ))}
        <Button appearance="transparent" size="small" icon={<Add16Regular />} style={{ alignSelf: "flex-start" }} onClick={() => set(key, [...list, { label: labels[0], value: "" }])}>
          {key === "emails" ? "E-Mail-Adresse hinzufügen" : "Telefonnummer hinzufügen"}
        </Button>
      </div>
    );
  };

  const updateAddr = (i: number, patch: Partial<PostalAddress>) => set("addresses", draft.addresses.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <>
      <Toolbar className={s.toolbar}>
        <Button appearance="primary" onClick={onSave} disabled={saving} icon={saving ? <Spinner size="tiny" /> : undefined}>
          Speichern
        </Button>
        <Button appearance="subtle" onClick={onCancel} disabled={saving}>
          Abbrechen
        </Button>
      </Toolbar>
      <div className={s.detailScroll}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <Avatar name={contactName(draft)} color="colorful" size={72} image={draft.photo ? { src: draft.photo } : undefined} />
          <div>
            <Text size={600} weight="semibold" style={{ display: "block" }}>
              {isNew ? "Neuer Kontakt" : "Kontakt bearbeiten"}
            </Text>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <Button size="small" onClick={() => photoInput.current?.click()}>
                Foto wählen …
              </Button>
              {draft.photo && (
                <Button size="small" appearance="subtle" onClick={() => set("photo", null)}>
                  Foto entfernen
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
          <Field label="Vorname">
            <Input autoFocus value={draft.givenName} onChange={(_, d) => set("givenName", d.value)} />
          </Field>
          <Field label="Nachname">
            <Input value={draft.familyName} onChange={(_, d) => set("familyName", d.value)} />
          </Field>
          <Field label="Anzeigename" hint="Leer = Vor- und Nachname">
            <Input value={draft.displayName} onChange={(_, d) => set("displayName", d.value)} />
          </Field>
          {isNew ? (
            <Field label="Adressbuch">
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
          <Field label="Firma">
            <Input value={draft.company} onChange={(_, d) => set("company", d.value)} />
          </Field>
          <Field label="Position">
            <Input value={draft.jobTitle} onChange={(_, d) => set("jobTitle", d.value)} />
          </Field>

          <Text className={s.formHead}>E-Mail</Text>
          {labeledList("emails", EMAIL_LABELS, "name@example.com", "email")}
          <Text className={s.formHead}>Telefon</Text>
          {labeledList("phones", PHONE_LABELS, "+49 …", "tel")}

          <Text className={s.formHead}>Adressen</Text>
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
                <Input value={a.street} placeholder="Straße" onChange={(_, d) => updateAddr(i, { street: d.value })} />
                <Input value={a.postalCode} placeholder="PLZ" onChange={(_, d) => updateAddr(i, { postalCode: d.value })} />
                <Input value={a.city} placeholder="Ort" onChange={(_, d) => updateAddr(i, { city: d.value })} />
                <Input value={a.country} placeholder="Land" onChange={(_, d) => updateAddr(i, { country: d.value })} />
                <Button appearance="subtle" icon={<Delete16Regular />} onClick={() => set("addresses", draft.addresses.filter((_, j) => j !== i))} aria-label="Entfernen" />
              </div>
            ))}
            <Button
              appearance="transparent"
              size="small"
              icon={<Add16Regular />}
              style={{ alignSelf: "flex-start" }}
              onClick={() => set("addresses", [...draft.addresses, { label: "home", street: "", city: "", postalCode: "", country: "" }])}
            >
              Adresse hinzufügen
            </Button>
          </div>

          <Field label="Gruppen" className={s.full} hint="Durch Komma getrennt, z. B. Familie, Verein">
            <Input
              value={groupsText}
              onChange={(_, d) => {
                setGroupsText(d.value);
                set("groups", d.value.split(",").map((g) => g.trim()).filter(Boolean));
              }}
            />
          </Field>
          <Field label="Geburtstag">
            <Input type="date" value={draft.birthday?.slice(0, 10) ?? ""} onChange={(_, d) => set("birthday", d.value || null)} />
          </Field>
          <span />
          <Field label="Notizen" className={s.full}>
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
    img.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
    img.src = URL.createObjectURL(file);
  });
}
