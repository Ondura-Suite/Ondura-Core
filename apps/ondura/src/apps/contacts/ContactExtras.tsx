// Contacts extras: finding and merging duplicates, org chart from the
// Microsoft 365 directory.

import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Contact } from "../../lib/pim";
import type { DirectoryEntry, OrgInfo } from "../../lib/types";
import { api } from "../../lib/api";
import { tl } from "../../lib/i18n";

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const phoneKey = (p: string) => p.replace(/[^\d+]/g, "").replace(/^00/, "+").slice(-9);

const nameOf = (c: Contact) => c.displayName || `${c.givenName} ${c.familyName}`.trim() || c.company || c.emails[0]?.value || "";

/** Groups of contacts that look like the same person (same e-mail address,
 * same phone number or same name), within writable address books. */
export function findDuplicates(contacts: Contact[]): Contact[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const seen = new Map<string, string>();
  for (const c of contacts) {
    parent.set(c.id, c.id);
    const keys = [
      ...c.emails.map((e) => `e:${e.value.trim().toLowerCase()}`),
      ...c.phones.map((p) => phoneKey(p.value)).filter((k) => k.length >= 6).map((k) => `p:${k}`),
      nameOf(c) && !nameOf(c).includes("@") ? `n:${norm(nameOf(c))}` : "",
    ].filter(Boolean);
    for (const k of keys) {
      const other = seen.get(k);
      if (other) union(c.id, other);
      else seen.set(k, c.id);
    }
  }
  const groups = new Map<string, Contact[]>();
  for (const c of contacts) {
    const r = find(c.id);
    groups.set(r, [...(groups.get(r) ?? []), c]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Combine contacts into the first one: empty fields are filled, lists are joined. */
export function mergeContacts(list: Contact[]): Contact {
  const [first, ...rest] = list;
  const out: Contact = structuredClone(first);
  for (const c of rest) {
    for (const k of ["displayName", "givenName", "familyName", "company", "jobTitle"] as const) if (!out[k] && c[k]) out[k] = c[k];
    if (!out.birthday && c.birthday) out.birthday = c.birthday;
    if (!out.photo && c.photo) out.photo = c.photo;
    if (c.notes && !out.notes.includes(c.notes)) out.notes = [out.notes, c.notes].filter(Boolean).join("\n\n");
    for (const e of c.emails) if (!out.emails.some((x) => x.value.toLowerCase() === e.value.toLowerCase())) out.emails.push(e);
    for (const p of c.phones) if (!out.phones.some((x) => phoneKey(x.value) === phoneKey(p.value))) out.phones.push(p);
    for (const a of c.addresses) if (!out.addresses.some((x) => norm(`${x.street}${x.city}`) === norm(`${a.street}${a.city}`))) out.addresses.push(a);
    out.groups = [...new Set([...(out.groups ?? []), ...(c.groups ?? [])])];
  }
  return out;
}

const useStyles = makeStyles({
  group: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: "8px 12px", display: "flex", flexDirection: "column", gap: "4px" },
  list: { display: "flex", flexDirection: "column", gap: "10px", maxHeight: "60vh", overflowY: "auto" },
  sub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

export function DuplicatesDialog({
  open,
  contacts,
  bookName,
  onClose,
  onMerge,
}: {
  open: boolean;
  contacts: Contact[];
  bookName: (c: Contact) => string;
  onClose: () => void;
  onMerge: (groups: Contact[][]) => Promise<void>;
}) {
  const s = useStyles();
  const groups = useMemo(() => (open ? findDuplicates(contacts) : []), [open, contacts]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setChosen(new Set(groups.map((_, i) => i))), [groups]);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{tl("Doppelte Kontakte")}</DialogTitle>
          <DialogContent>
            {groups.length === 0 ? (
              <Text>{tl("Keine doppelten Kontakte gefunden.")}</Text>
            ) : (
              <div className={s.list}>
                <Text>{tl("Diese Kontakte scheinen dieselbe Person zu sein. Ausgewählte Gruppen werden zum ersten Kontakt zusammengeführt.")}</Text>
                {groups.map((g, i) => (
                  <div key={g[0].id} className={s.group}>
                    <Checkbox
                      checked={chosen.has(i)}
                      onChange={(_, d) =>
                        setChosen((cur) => {
                          const n = new Set(cur);
                          if (d.checked) n.add(i);
                          else n.delete(i);
                          return n;
                        })
                      }
                      label={<b>{nameOf(g[0])}</b>}
                    />
                    {g.map((c) => (
                      <span key={c.id} className={s.sub} style={{ paddingLeft: 28 }}>
                        {nameOf(c)} · {[c.emails[0]?.value, c.phones[0]?.value].filter(Boolean).join(" · ")} · {bookName(c)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={busy || chosen.size === 0}
              icon={busy ? <Spinner size="tiny" /> : undefined}
              onClick={async () => {
                setBusy(true);
                try {
                  await onMerge(groups.filter((_, i) => chosen.has(i)));
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {tl("Zusammenführen")}
            </Button>
            <Button onClick={onClose} disabled={busy}>{tl("Schließen")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const useOrgStyles = makeStyles({
  box: { display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" },
  person: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px", borderRadius: tokens.borderRadiusMedium },
  me: { backgroundColor: tokens.colorBrandBackground2 },
  line: { width: "2px", height: "10px", backgroundColor: tokens.colorNeutralStroke1, marginLeft: "20px" },
  sub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  reports: { display: "flex", flexDirection: "column", gap: "2px", paddingLeft: "24px", borderLeft: `2px solid ${tokens.colorNeutralStroke1}`, marginLeft: "20px" },
});

/** Manager and direct reports of an address (Microsoft 365); nothing if unknown. */
export function OrgChart({ email, onPick }: { email: string; onPick?: (p: DirectoryEntry) => void }) {
  const [info, setInfo] = useState<OrgInfo | null | undefined>(undefined);
  useEffect(() => {
    let off = false;
    setInfo(undefined);
    api.orgInfo(email).then(
      (i) => !off && setInfo(i),
      () => !off && setInfo(null),
    );
    return () => {
      off = true;
    };
  }, [email]);
  if (info === undefined) return <Spinner size="extra-tiny" />;
  if (!info || (!info.manager && !info.reports.length)) return null;
  return <OrgChartView info={info} onPick={onPick} />;
}

export function OrgChartView({ info, onPick }: { info: OrgInfo; onPick?: (p: DirectoryEntry) => void }) {
  const s = useOrgStyles();
  const card = (p: DirectoryEntry, me = false) => (
    <span key={p.email} className={`${s.person} ${me ? s.me : ""}`} style={{ cursor: onPick && !me ? "pointer" : undefined }} onClick={() => !me && onPick?.(p)}>
      <Avatar name={p.name} size={28} color="colorful" />
      <span>
        {p.name}
        <br />
        <span className={s.sub}>{[p.jobTitle, p.department].filter(Boolean).join(" · ")}</span>
      </span>
    </span>
  );
  return (
    <div className={s.box}>
      {info.manager && (
        <>
          {card(info.manager)}
          <span className={s.line} />
        </>
      )}
      {info.person && card(info.person, true)}
      {info.reports.length > 0 && <div className={s.reports}>{info.reports.map((r) => card(r))}</div>}
    </div>
  );
}
