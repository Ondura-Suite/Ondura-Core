// Shared state for the calendar, contacts and tasks apps: collections of one
// kind, the accounts they belong to and a change counter bumped by sync events.

import { useCallback, useEffect, useState } from "react";
import type { Account } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { pim, type Collection, type CollectionKind } from "../../lib/pim";
import { useNotify } from "../../shell/notify";

export const LOCAL_ACCOUNT = "local";

export function usePimCollections(kind: CollectionKind) {
  const notify = useNotify();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [cols, accs] = await Promise.all([pim.collections(), api.listAllAccounts()]);
      setCollections(cols.filter((c) => c.kind === kind));
      setAccounts(accs);
    } catch (e) {
      notify("Laden fehlgeschlagen", errorMessage(e), "error");
    }
  }, [kind, notify]);

  useEffect(() => {
    void reload();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void pim
      .onEvent((e) => {
        if (e.type === "collectionsChanged") void reload();
        if (e.type === "changed" && e.kind === kind) setRevision((r) => r + 1);
        if (e.type === "error") console.warn("pim sync error", e.accountId, e.message);
      })
      .then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [kind, reload]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await pim.sync();
      await reload();
      setRevision((r) => r + 1);
    } catch (e) {
      notify("Synchronisierung fehlgeschlagen", errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  }, [notify, reload]);

  const accountName = useCallback(
    (accountId: string) => {
      if (accountId === LOCAL_ACCOUNT) return "Auf diesem Computer";
      const a = accounts.find((x) => x.id === accountId);
      return a ? a.email || a.displayName : "Konto";
    },
    [accounts],
  );

  return { collections, setCollections, accounts, accountName, reload, revision, bump: () => setRevision((r) => r + 1), sync, syncing };
}

/** Writable collections, default first. */
export function writable(collections: Collection[]): Collection[] {
  return collections.filter((c) => !c.readOnly).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
