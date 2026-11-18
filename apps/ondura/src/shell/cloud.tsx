// OneDrive / SharePoint in the backstage of the office apps: places to open
// from and save to, the Office account page, sharing, and AutoSave for
// cloud documents.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowUp20Regular,
  ChevronRight12Regular,
  Clock24Regular,
  Cloud24Regular,
  CloudCheckmark20Regular,
  CloudArrowUp20Regular,
  CloudDismiss20Regular,
  Desktop24Regular,
  Document24Regular,
  Folder24Regular,
  FolderAdd20Regular,
  Globe24Regular,
  Link20Regular,
  PeopleTeam24Regular,
  Person24Regular,
  Search20Regular,
  SignOut20Regular,
} from "@fluentui/react-icons";
import { cloud, formatSize, isCloudPath, type CloudAccount, type CloudEntry, type DriveInfo } from "../lib/cloud";
import { FORMATS, extOf, type OfficeApp } from "../lib/office";
import { errorMessage } from "../lib/api";

const useStyles = makeStyles({
  root: { display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px", minHeight: 0, flex: 1 },
  places: { display: "flex", flexDirection: "column", gap: "2px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, paddingRight: "12px", overflowY: "auto" },
  place: {
    display: "grid",
    gridTemplateColumns: "24px 1fr",
    gap: "10px",
    alignItems: "center",
    padding: "8px 10px",
    border: "none",
    background: "transparent",
    borderRadius: tokens.borderRadiusMedium,
    textAlign: "left",
    font: "inherit",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  placeActive: { backgroundColor: tokens.colorNeutralBackground1Selected, fontWeight: tokens.fontWeightSemibold },
  placeSub: { display: "block", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  group: { marginTop: "12px", marginBottom: "2px", paddingLeft: "10px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold },
  main: { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, gap: "10px" },
  crumbs: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", minHeight: "32px" },
  crumb: { border: "none", background: "transparent", font: "inherit", color: tokens.colorBrandForeground1, cursor: "pointer", padding: "2px 4px", borderRadius: tokens.borderRadiusSmall, ":hover": { textDecoration: "underline" } },
  crumbLast: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold, cursor: "default", ":hover": { textDecoration: "none" } },
  list: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" },
  row: {
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr) 160px 90px",
    gap: "12px",
    alignItems: "center",
    padding: "7px 10px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowDisabled: { opacity: 0.45, cursor: "default" },
  head: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, cursor: "default", ":hover": { backgroundColor: "transparent" } },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  saveBar: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", paddingTop: "8px", borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  toolbar: { display: "flex", gap: "8px", alignItems: "center" },
  empty: { padding: "40px 16px", textAlign: "center", color: tokens.colorNeutralForeground3 },
  card: { display: "grid", gridTemplateColumns: "40px 1fr auto", gap: "12px", alignItems: "center", padding: "12px 14px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusLarge, maxWidth: "560px" },
  avatar: { width: "40px", height: "40px", borderRadius: "50%", display: "grid", placeItems: "center", color: "#fff", fontWeight: tokens.fontWeightSemibold },
  titleBox: { display: "inline-flex", alignItems: "center", gap: "10px" },
  titleState: { display: "inline-flex", alignItems: "center", gap: "4px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

type Place =
  | { kind: "recent" }
  | { kind: "pc" }
  | { kind: "drive"; account: CloudAccount; drive: DriveInfo }
  | { kind: "shared"; account: CloudAccount };

interface Crumb {
  id: string | null;
  name: string;
}

const matchesApp = (app: OfficeApp, name: string) => {
  const f = FORMATS[app];
  const e = extOf(name);
  return e === f.ext || e === f.odf.ext || (app === "sheets" && e === "xlsm");
};

const dateText = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

/** Sign-in dialog for OneDrive (work/school or personal account). */
export function CloudSignInDialog({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: (a: CloudAccount) => void }) {
  const [kind, setKind] = useState<"work" | "personal">("work");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>Speicherort hinzufügen</DialogTitle>
          <DialogContent>
            <Text block style={{ marginBottom: 12 }}>
              Melden Sie sich bei Microsoft an, um Dateien in OneDrive und SharePoint zu öffnen und zu speichern. Die Anmeldung öffnet sich im Browser.
            </Text>
            <RadioGroup value={kind} onChange={(_, d) => setKind(d.value as "work" | "personal")}>
              <Radio value="work" label="Geschäfts-, Schul- oder Unikonto (OneDrive for Business, SharePoint)" />
              <Radio value="personal" label="Privates Microsoft-Konto (OneDrive, Outlook.com, Hotmail)" />
            </RadioGroup>
            {error && (
              <MessageBar intent="error" style={{ marginTop: 12 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={busy}>Abbrechen</Button>
            <Button
              appearance="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  onSignedIn(await cloud.signIn(kind === "personal"));
                  onClose();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner size="tiny" label="Warte auf Anmeldung…" /> : "Anmelden"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function useCloudAccounts() {
  const [accounts, setAccounts] = useState<CloudAccount[] | null>(null);
  const [drives, setDrives] = useState<Record<string, DriveInfo[]>>({});
  const reload = useCallback(async () => {
    const list = await cloud.accounts().catch(() => []);
    setAccounts(list);
    for (const a of list) {
      cloud.locations(a.key).then(
        (d) => setDrives((m) => ({ ...m, [a.key]: d })),
        () => setDrives((m) => ({ ...m, [a.key]: [] })),
      );
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { accounts, drives, reload };
}

export interface CloudPlacesProps {
  app: OfficeApp;
  color: string;
  mode: "open" | "save";
  /** Recently used files (this PC and cloud). */
  recent?: React.ReactNode;
  onBrowseLocal: () => void;
  onOpen?: (path: string) => void;
  /** Save to a cloud path; rejects with a message on failure. */
  onSave?: (path: string) => Promise<void>;
  suggestedName?: string;
  /** Extension of the open file (preselects the format). */
  currentExt?: string;
}

/** Places like in Office's backstage: recent, OneDrive/SharePoint, this PC. */
export function CloudPlaces(p: CloudPlacesProps) {
  const s = useStyles();
  const { accounts, drives, reload } = useCloudAccounts();
  const [place, setPlace] = useState<Place>(p.mode === "open" ? { kind: "recent" } : { kind: "pc" });
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [items, setItems] = useState<CloudEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [signIn, setSignIn] = useState(false);
  const f = FORMATS[p.app];
  const [fileName, setFileName] = useState(p.suggestedName || f.label);
  const [ext, setExt] = useState(p.currentExt === f.odf.ext ? f.odf.ext : f.ext);
  const [saving, setSaving] = useState(false);
  const [overwrite, setOverwrite] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const loadId = useRef(0);

  // Save mode starts in the first OneDrive, like Office.
  useEffect(() => {
    if (p.mode !== "save" || place.kind !== "pc" || !accounts?.length) return;
    const a = accounts[0];
    const d = drives[a.key]?.[0];
    if (d) setPlace({ kind: "drive", account: a, drive: d });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, drives]);

  const folderId = crumbs.length ? crumbs[crumbs.length - 1].id : null;
  const load = useCallback(async () => {
    const id = ++loadId.current;
    setError(null);
    setItems(null);
    try {
      let list: CloudEntry[] = [];
      if (place.kind === "drive") list = query.trim() && place.drive.name === "OneDrive" ? await cloud.search(place.account.key, query.trim()) : await cloud.list(place.account.key, place.drive.id, folderId);
      else if (place.kind === "shared") list = await cloud.shared(place.account.key);
      if (id === loadId.current) setItems(list);
    } catch (e) {
      if (id === loadId.current) {
        setItems([]);
        setError(errorMessage(e));
      }
    }
  }, [place, folderId, query]);

  useEffect(() => {
    if (place.kind === "drive" || place.kind === "shared") void load();
  }, [load, place.kind]);

  const go = (pl: Place) => {
    setPlace(pl);
    setCrumbs(pl.kind === "drive" ? [{ id: null, name: pl.drive.site ? `${pl.drive.site} › ${pl.drive.name}` : pl.drive.name }] : []);
    setQuery("");
  };
  useEffect(() => {
    if (place.kind === "drive" && crumbs.length === 0) setCrumbs([{ id: null, name: place.drive.site ? `${place.drive.site} › ${place.drive.name}` : place.drive.name }]);
  }, [place, crumbs.length]);

  const shown = useMemo(() => (items ?? []).filter((e) => e.folder || matchesApp(p.app, e.name)), [items, p.app, p.mode]);

  const save = async (replace = false) => {
    if (place.kind !== "drive" || !p.onSave) return;
    const name = `${fileName.trim().replace(/[\\/:*?"<>|]/g, "_") || f.label}.${ext}`;
    setSaving(true);
    setError(null);
    try {
      const path = await cloud.reserve(place.account.key, place.drive.id, folderId, name, replace);
      await p.onSave(path);
    } catch (e) {
      const msg = errorMessage(e);
      if (msg === "exists") setOverwrite(name);
      else setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const placeButton = (pl: Place, icon: React.ReactNode, label: string, sub?: string) => {
    const active =
      pl.kind === place.kind &&
      (pl.kind !== "drive" || (place.kind === "drive" && place.drive.id === pl.drive.id && place.account.key === pl.account.key)) &&
      (pl.kind !== "shared" || (place.kind === "shared" && place.account.key === pl.account.key));
    return (
      <button className={mergeClasses(s.place, active && s.placeActive)} onClick={() => go(pl)}>
        {icon}
        <span style={{ minWidth: 0 }}>
          {label}
          {sub && <span className={s.placeSub}>{sub}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className={s.root}>
      <nav className={s.places} aria-label="Speicherorte">
        {p.mode === "open" && placeButton({ kind: "recent" }, <Clock24Regular />, "Zuletzt verwendet")}
        {accounts?.map((a) => (
          <div key={a.key} style={{ display: "contents" }}>
            <div className={s.group}>{a.personal ? "Privat" : a.email.split("@")[1] ?? "Microsoft 365"}</div>
            {(drives[a.key] ?? []).map((d) =>
              placeButton({ kind: "drive", account: a, drive: d }, d.site ? <Globe24Regular /> : <Cloud24Regular style={{ color: "#0364b8" }} />, d.site ? d.name : `OneDrive – ${a.personal ? "Privat" : a.email.split("@")[1]}`, d.site ?? a.email),
            )}
            {!a.fromMail && p.mode === "open" && placeButton({ kind: "shared", account: a }, <PeopleTeam24Regular />, "Für mich freigegeben", a.email)}
          </div>
        ))}
        <div className={s.group}>Andere Speicherorte</div>
        {placeButton({ kind: "pc" }, <Desktop24Regular />, "Dieser PC")}
        <button className={s.place} onClick={() => setSignIn(true)}>
          <Add20Regular style={{ justifySelf: "center" }} />
          <span>Speicherort hinzufügen</span>
        </button>
      </nav>

      <div className={s.main}>
        {place.kind === "recent" ? (
          p.recent
        ) : place.kind === "pc" ? (
          <>
            <div className={s.toolbar}>
              <Button appearance="primary" icon={<Desktop24Regular />} onClick={p.onBrowseLocal}>
                Durchsuchen…
              </Button>
            </div>
            <Text className={s.muted}>{p.mode === "open" ? "Eine Datei auf diesem Computer öffnen." : "Auf diesem Computer speichern."}</Text>
          </>
        ) : (
          <>
            <div className={s.toolbar}>
              {place.kind === "drive" && (
                <>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<ArrowUp20Regular />}
                    aria-label="Übergeordneter Ordner"
                    disabled={crumbs.length <= 1}
                    onClick={() => setCrumbs((c) => c.slice(0, -1))}
                  />
                  {p.mode === "save" && (
                    <Button size="small" appearance="subtle" icon={<FolderAdd20Regular />} onClick={() => setNewFolder("Neuer Ordner")}>
                      Neuer Ordner
                    </Button>
                  )}
                  {place.drive.name === "OneDrive" && p.mode === "open" && (
                    <Input
                      size="small"
                      contentBefore={<Search20Regular />}
                      placeholder="In OneDrive suchen"
                      value={query}
                      onChange={(_, d) => setQuery(d.value)}
                      style={{ marginLeft: "auto", width: 240 }}
                    />
                  )}
                </>
              )}
            </div>
            {place.kind === "drive" && !query && (
              <div className={s.crumbs}>
                {crumbs.map((c, i) => (
                  <span key={`${c.id}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {i > 0 && <ChevronRight12Regular />}
                    <button className={mergeClasses(s.crumb, i === crumbs.length - 1 && s.crumbLast)} onClick={() => setCrumbs((cs) => cs.slice(0, i + 1))}>
                      {c.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <div className={s.list} role="list">
              <div className={mergeClasses(s.row, s.head)}>
                <span />
                <span>Name</span>
                <span>Geändert</span>
                <span>Größe</span>
              </div>
              {items === null ? (
                <Spinner size="small" style={{ marginTop: 24 }} />
              ) : shown.length === 0 ? (
                <div className={s.empty}>Keine Dateien</div>
              ) : (
                shown.map((e) => {
                  const disabled = !e.folder && p.mode === "save";
                  return (
                    <div
                      key={`${e.driveId}-${e.id}`}
                      role="listitem"
                      tabIndex={disabled ? -1 : 0}
                      className={mergeClasses(s.row, disabled && s.rowDisabled)}
                      onClick={() => {
                        if (e.folder) {
                          if (place.kind === "shared") {
                            const a = place.account;
                            setPlace({ kind: "drive", account: a, drive: { id: e.driveId, name: e.name } });
                            setCrumbs([{ id: e.id, name: e.name }]);
                          } else setCrumbs((c) => [...c, { id: e.id, name: e.name }]);
                          setQuery("");
                        } else if (p.mode === "open" && e.path) p.onOpen?.(e.path);
                        else if (p.mode === "save") setFileName(e.name.replace(/\.[^.]+$/, ""));
                      }}
                      onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLElement).click()}
                    >
                      {e.folder ? <Folder24Regular style={{ color: "#dcb04a" }} /> : <Document24Regular style={{ color: p.color }} />}
                      <span style={{ minWidth: 0 }}>
                        <Text block truncate wrap={false} weight={e.folder ? "regular" : "semibold"}>
                          {e.name}
                        </Text>
                        {e.modifiedBy && (
                          <Text block truncate wrap={false} className={s.muted}>
                            {e.modifiedBy}
                          </Text>
                        )}
                      </span>
                      <span className={s.muted}>{dateText(e.modified)}</span>
                      <span className={s.muted}>{e.folder ? (e.childCount != null ? `${e.childCount} Elemente` : "") : formatSize(e.size)}</span>
                    </div>
                  );
                })
              )}
            </div>
            {p.mode === "save" && place.kind === "drive" && (
              <div className={s.saveBar}>
                <Field label="Dateiname" style={{ flex: 1, minWidth: 220 }}>
                  <Input value={fileName} onChange={(_, d) => setFileName(d.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
                </Field>
                <Field label="Dateityp">
                  <Dropdown value={ext === f.ext ? `${f.name} (.${f.ext})` : `${f.odf.name} (.${f.odf.ext})`} selectedOptions={[ext]} onOptionSelect={(_, d) => d.optionValue && setExt(d.optionValue)}>
                    <Option value={f.ext}>{`${f.name} (.${f.ext})`}</Option>
                    <Option value={f.odf.ext}>{`${f.odf.name} (.${f.odf.ext})`}</Option>
                  </Dropdown>
                </Field>
                <Button appearance="primary" disabled={saving || !fileName.trim()} onClick={() => void save()}>
                  {saving ? <Spinner size="tiny" /> : "Speichern"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <CloudSignInDialog open={signIn} onClose={() => setSignIn(false)} onSignedIn={() => void reload()} />
      <Dialog open={!!overwrite} onOpenChange={(_, d) => !d.open && setOverwrite(null)}>
        <DialogSurface style={{ maxWidth: 420 }}>
          <DialogBody>
            <DialogTitle>Datei ersetzen?</DialogTitle>
            <DialogContent>„{overwrite}“ gibt es in diesem Ordner bereits. Möchten Sie die vorhandene Datei ersetzen?</DialogContent>
            <DialogActions>
              <Button onClick={() => setOverwrite(null)}>Abbrechen</Button>
              <Button appearance="primary" onClick={() => (setOverwrite(null), void save(true))}>
                Ersetzen
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={newFolder !== null} onOpenChange={(_, d) => !d.open && setNewFolder(null)}>
        <DialogSurface style={{ maxWidth: 380 }}>
          <DialogBody>
            <DialogTitle>Neuer Ordner</DialogTitle>
            <DialogContent>
              <Input value={newFolder ?? ""} onChange={(_, d) => setNewFolder(d.value)} autoFocus style={{ width: "100%" }} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setNewFolder(null)}>Abbrechen</Button>
              <Button
                appearance="primary"
                disabled={!newFolder?.trim()}
                onClick={async () => {
                  const name = newFolder!.trim();
                  setNewFolder(null);
                  if (place.kind !== "drive") return;
                  try {
                    const f = await cloud.createFolder(place.account.key, place.drive.id, folderId, name);
                    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                Erstellen
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

const AVATAR_COLORS = ["#4f52b2", "#0f6cbd", "#038387", "#8764b8", "#ca5010"];

/** Backstage page "Konto": connected Microsoft accounts. */
export function AccountPage() {
  const s = useStyles();
  const { accounts, reload } = useCloudAccounts();
  const [signIn, setSignIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Text>Mit einem Microsoft-Konto öffnen und speichern Sie Dateien direkt in OneDrive und SharePoint – mit privaten Konten ebenso wie mit Geschäfts- oder Schulkonten.</Text>
      {accounts === null ? (
        <Spinner size="small" />
      ) : accounts.length === 0 ? (
        <Text className={s.muted}>Noch kein Konto verbunden.</Text>
      ) : (
        accounts.map((a, i) => (
          <div key={a.key} className={s.card}>
            <span className={s.avatar} style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
              {a.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || <Person24Regular />}
            </span>
            <span style={{ minWidth: 0 }}>
              <Text block weight="semibold" truncate wrap={false}>
                {a.name}
              </Text>
              <Text block className={s.muted} truncate wrap={false}>
                {a.email} · {a.personal ? "Privates Microsoft-Konto" : "Geschäfts- oder Schulkonto"}
                {a.fromMail ? " · aus Ondura Mail" : ""}
              </Text>
            </span>
            {a.fromMail ? (
              <Tooltip content="Dieses Konto ist in Ondura Mail eingerichtet. Für SharePoint und freigegebene Dateien melden Sie es hier zusätzlich an." relationship="description">
                <Button size="small" onClick={() => setSignIn(true)}>
                  Erweitern
                </Button>
              </Tooltip>
            ) : (
              <Button
                size="small"
                icon={<SignOut20Regular />}
                onClick={async () => {
                  try {
                    await cloud.signOut(a.key);
                    await reload();
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                Abmelden
              </Button>
            )}
          </div>
        ))
      )}
      <div>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setSignIn(true)}>
          Konto hinzufügen
        </Button>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <CloudSignInDialog open={signIn} onClose={() => setSignIn(false)} onSignedIn={() => void reload()} />
    </div>
  );
}

/** Backstage page "Freigeben": sharing links for cloud documents. */
export function SharePage({ path, onSaveToCloud }: { path: string | null; onSaveToCloud: () => void }) {
  const s = useStyles();
  const [edit, setEdit] = useState(true);
  const [scope, setScope] = useState<"organization" | "anonymous">("organization");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isCloudPath(path)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
        <Text>Um das Dokument mit anderen zu teilen, speichern Sie es zuerst in OneDrive oder SharePoint.</Text>
        <div>
          <Button appearance="primary" icon={<CloudArrowUp20Regular />} onClick={onSaveToCloud}>
            In OneDrive speichern
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      <Text>Erstellen Sie einen Link, über den andere das Dokument in OneDrive öffnen können.</Text>
      <RadioGroup value={edit ? "edit" : "view"} onChange={(_, d) => setEdit(d.value === "edit")}>
        <Radio value="edit" label="Bearbeiten erlauben" />
        <Radio value="view" label="Nur anzeigen" />
      </RadioGroup>
      <RadioGroup value={scope} onChange={(_, d) => setScope(d.value as "organization" | "anonymous")}>
        <Radio value="organization" label="Personen in meiner Organisation" />
        <Radio value="anonymous" label="Jeder mit dem Link" />
      </RadioGroup>
      <div>
        <Button
          appearance="primary"
          icon={<Link20Regular />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const url = await cloud.share(path, edit, scope === "organization");
              setLink(url);
              await navigator.clipboard?.writeText(url).catch(() => {});
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner size="tiny" /> : "Link kopieren"}
        </Button>
      </div>
      {link && (
        <MessageBar intent="success">
          <MessageBarBody>
            Link in die Zwischenablage kopiert: <span className={s.muted}>{link}</span>
          </MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Text className={s.muted}>„Personen in meiner Organisation“ gibt es nur bei Geschäfts- und Schulkonten; bei privaten Konten wird ein Link für jeden erstellt.</Text>
    </div>
  );
}

// ------------------------------------------------------------- AutoSave --

const AUTOSAVE_KEY = "ondura.autosave";

/**
 * AutoSave for documents in OneDrive/SharePoint, like in Office: saves a
 * few seconds after the last change. On by default for cloud documents.
 */
export function useCloudAutoSave(path: string | null, dirty: boolean, save: () => Promise<boolean>) {
  const cloudDoc = isCloudPath(path);
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(AUTOSAVE_KEY) !== "off");
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const busy = useRef(false);
  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(AUTOSAVE_KEY, v ? "on" : "off");
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    if (!cloudDoc || !enabled || !dirty) return;
    const t = setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      setState("saving");
      const ok = await save().catch(() => false);
      busy.current = false;
      setState(ok ? "saved" : "error");
    }, 3000);
    return () => clearTimeout(t);
  }, [cloudDoc, enabled, dirty, save]);
  return { cloudDoc, enabled: cloudDoc && enabled, setEnabled, state };
}

/** Title in the header: AutoSave switch for cloud documents, name, state. */
export function DocumentTitle({ name, dirty, path, autoSave }: { name: string; dirty: boolean; path: string | null; autoSave: ReturnType<typeof useCloudAutoSave> }) {
  const s = useStyles();
  if (!autoSave.cloudDoc) return <>{`${name}${dirty ? " •" : ""}${path ? "" : " – nicht gespeichert"}`}</>;
  const state = autoSave.state === "error" ? (
    <span className={s.titleState} style={{ color: tokens.colorPaletteRedForeground1 }}>
      <CloudDismiss20Regular /> Nicht gespeichert
    </span>
  ) : autoSave.state === "saving" ? (
    <span className={s.titleState}>
      <CloudArrowUp20Regular /> Wird gespeichert…
    </span>
  ) : dirty ? (
    <span className={s.titleState}>
      <Cloud24Regular style={{ fontSize: 18 }} /> Änderungen nicht gespeichert
    </span>
  ) : (
    <span className={s.titleState}>
      <CloudCheckmark20Regular /> In OneDrive gespeichert
    </span>
  );
  return (
    <span className={s.titleBox}>
      <Switch
        checked={autoSave.enabled}
        onChange={(_, d) => autoSave.setEnabled(d.checked)}
        label="Automatisch speichern"
        labelPosition="before"
        style={{ fontSize: 12 }}
      />
      <span>{name}</span>
      {state}
    </span>
  );
}
