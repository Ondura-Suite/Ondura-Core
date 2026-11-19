// Account button in the title bar (like Office): profile picture of the
// Microsoft account, a card with name and address, links to the account
// and OneDrive, switching between accounts, adding and signing out.

import { useCallback, useEffect, useState } from "react";
import { Avatar, Button, Divider, Popover, PopoverSurface, PopoverTrigger, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Add20Regular, Cloud20Regular, Open16Regular, PersonCircle20Regular } from "@fluentui/react-icons";
import { accountsChanged, cloud, type CloudAccount } from "../lib/cloud";
import { api, errorMessage, isTauri } from "../lib/api";
import { CloudSignInDialog } from "./cloud";
import { useNotify } from "./notify";
import { tl } from "../lib/i18n";

const ACTIVE = "ondura.account.active";

const useStyles = makeStyles({
  trigger: { minWidth: "36px", padding: "0 4px", borderRadius: "50%", marginLeft: "4px" },
  card: { width: "340px", padding: 0 },
  top: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  me: { display: "flex", gap: "14px", alignItems: "center", padding: "6px 14px 14px" },
  meText: { display: "flex", flexDirection: "column", minWidth: 0, gap: "2px" },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  link: { justifyContent: "flex-start", padding: "0", minWidth: 0, height: "auto", fontWeight: tokens.fontWeightRegular },
  other: { display: "flex", gap: "10px", alignItems: "center", width: "100%", padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", color: tokens.colorNeutralForeground1, ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover } },
  section: { padding: "6px 14px 2px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

function usePhoto(key: string | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!key) return;
    let live = true;
    void cloud.photo(key).then((p) => live && setSrc(p));
    return () => {
      live = false;
    };
  }, [key]);
  return src;
}

function AccountAvatar({ a, size }: { a: CloudAccount; size: 28 | 32 | 48 | 64 }) {
  const photo = usePhoto(a.key);
  return <Avatar name={a.name || a.email} image={photo ? { src: photo } : undefined} size={size} color="colorful" />;
}

/** Accounts of the office apps and Ondura Mail; the active one first. */
function useAccounts() {
  const [accounts, setAccounts] = useState<CloudAccount[] | null>(null);
  const [active, setActiveKey] = useState<string | null>(() => localStorage.getItem(ACTIVE));
  const reload = useCallback(() => {
    cloud
      .accounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);
  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE) setActiveKey(e.newValue);
      if (e.key === "ondura.accounts.changed") reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("ondura-accounts-changed", reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ondura-accounts-changed", reload);
    };
  }, [reload]);
  const setActive = (key: string) => {
    setActiveKey(key);
    try {
      localStorage.setItem(ACTIVE, key);
    } catch {
      /* ignore */
    }
  };
  const current = accounts?.find((a) => a.key === active) ?? accounts?.[0] ?? null;
  return { accounts, current, setActive, reload };
}

/** Title bar button; `fallbackName` is shown when no Microsoft account is signed in (e.g. IMAP in Mail). */
export function AccountButton({ fallbackName }: { fallbackName?: string }) {
  const s = useStyles();
  const notify = useNotify();
  const { accounts, current, setActive, reload } = useAccounts();
  const [open, setOpen] = useState(false);
  const [signIn, setSignIn] = useState(false);
  if (accounts === null) return null;
  const others = (accounts ?? []).filter((a) => a.key !== current?.key);
  const accountUrl = (a: CloudAccount) => (a.personal ? "https://account.microsoft.com" : "https://myaccount.microsoft.com");
  const openUrl = (url: string) => void (isTauri ? api.openExternal(url) : window.open(url, "_blank"));
  const openDrive = async (a: CloudAccount) => {
    try {
      const drive = (await cloud.locations(a.key))[0];
      openUrl(drive?.webUrl || (a.personal ? "https://onedrive.live.com" : "https://www.office.com/onedrive"));
    } catch (e) {
      notify(tl("OneDrive"), errorMessage(e), "error");
    }
  };
  const signOut = async (a: CloudAccount) => {
    try {
      await cloud.signOut(a.key);
      accountsChanged();
      reload();
      setOpen(false);
    } catch (e) {
      notify(tl("Abmelden"), errorMessage(e), "error");
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-end" withArrow>
        <PopoverTrigger disableButtonEnhancement>
          <Tooltip content={current ? `${current.name}\n${current.email}` : tl("Konto")} relationship="label">
            <Button appearance="subtle" className={s.trigger} aria-label={tl("Konto-Manager")}>
              {current ? <AccountAvatar a={current} size={28} /> : fallbackName ? <Avatar name={fallbackName} size={28} color="colorful" /> : <PersonCircle20Regular style={{ fontSize: 24 }} />}
            </Button>
          </Tooltip>
        </PopoverTrigger>
        <PopoverSurface className={s.card}>
          {current ? (
            <>
              <div className={s.top}>
                <span>{current.personal ? tl("Microsoft-Konto") : tl("Geschäfts- oder Schulkonto")}</span>
                {current.fromMail ? (
                  <Text size={200} title={tl("Dieses Konto gehört zu Ondura Mail und wird dort entfernt.")}>{tl("Ondura Mail")}</Text>
                ) : (
                  <Button appearance="transparent" size="small" className={s.link} onClick={() => void signOut(current)}>
                    {tl("Abmelden")}
                  </Button>
                )}
              </div>
              <div className={s.me}>
                <AccountAvatar a={current} size={64} />
                <div className={s.meText}>
                  <Text weight="semibold" size={400} className={s.ellipsis}>{current.name || current.email}</Text>
                  <Text size={200} className={s.ellipsis}>{current.email}</Text>
                  <Button appearance="transparent" size="small" className={s.link} icon={<Open16Regular />} onClick={() => openUrl(accountUrl(current))}>
                    {tl("Konto anzeigen")}
                  </Button>
                  <Button appearance="transparent" size="small" className={s.link} icon={<Cloud20Regular style={{ fontSize: 16 }} />} onClick={() => void openDrive(current)}>
                    {tl("OneDrive öffnen")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className={s.me}>
              {fallbackName ? <Avatar name={fallbackName} size={48} color="colorful" /> : <PersonCircle20Regular style={{ fontSize: 48 }} />}
              <div className={s.meText}>
                {fallbackName && <Text weight="semibold">{fallbackName}</Text>}
                <Text size={200}>{tl("Melden Sie sich mit einem Microsoft-Konto an, um Dokumente in OneDrive und SharePoint zu öffnen und zu speichern.")}</Text>
              </div>
            </div>
          )}
          {others.length > 0 && (
            <>
              <Divider />
              <div className={s.section}>{tl("Weitere Konten")}</div>
              {others.map((a) => (
                <button key={a.key} className={s.other} onClick={() => (setActive(a.key), setOpen(false))}>
                  <AccountAvatar a={a} size={32} />
                  <span className={s.meText}>
                    <Text size={300} className={s.ellipsis}>{a.name || a.email}</Text>
                    <Text size={200} className={s.ellipsis}>{a.email}</Text>
                  </span>
                </button>
              ))}
            </>
          )}
          <Divider />
          <button className={s.other} onClick={() => (setOpen(false), setSignIn(true))}>
            <Add20Regular />
            <Text size={300}>{current ? tl("Mit einem anderen Konto anmelden") : tl("Anmelden")}</Text>
          </button>
        </PopoverSurface>
      </Popover>
      <CloudSignInDialog
        open={signIn}
        onClose={() => setSignIn(false)}
        onSignedIn={(a) => {
          setActive(a.key);
          reload();
        }}
      />
    </>
  );
}
