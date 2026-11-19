// AutoRecover for the office apps: a changed document is written to disk
// every minute (src-tauri/src/recovery.rs). After a crash the next window of
// the app offers the snapshots for restoring.

import { useEffect, useRef, useState } from "react";
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { LOCALE, tl } from "./i18n";
import type { OfficeApp } from "./office";

export interface Snapshot<T> {
  name: string;
  path: string | null;
  data: T;
}

interface Recovered {
  id: string;
  name: string;
  modified: number;
  size: number;
}

const INTERVAL = 60_000;

/** Keep a snapshot of the document on disk while it has unsaved changes. */
export function useAutoRecover<T>(app: OfficeApp, dirty: boolean, snapshot: () => Snapshot<T>) {
  const id = useRef(crypto.randomUUID()).current;
  const snap = useRef(snapshot);
  snap.current = snapshot;
  useEffect(() => {
    if (!isTauri) return;
    if (!dirty) {
      void invoke("recovery_clear", { app, id }).catch(() => {});
      return;
    }
    const write = () => {
      try {
        const s = snap.current();
        void invoke("recovery_save", { app, id, name: s.name, data: JSON.stringify(s) }).catch(() => {});
      } catch {
        /* snapshot failed – try again next time */
      }
    };
    const first = setTimeout(write, 10_000);
    const every = setInterval(write, INTERVAL);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [app, id, dirty]);
}

/**
 * Banner offering documents left behind by a crash. Shown only while the
 * window's own document is unchanged, so restoring never overwrites work.
 */
export function RecoveryBar<T>({ app, canRestore, onRestore }: { app: OfficeApp; canRestore: boolean; onRestore: (s: Snapshot<T>) => void }) {
  const [items, setItems] = useState<Recovered[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    invoke<Recovered[]>("recovery_list", { app }).then(setItems, () => setItems([]));
  }, [app]);
  if (!items.length || !canRestore) return null;
  const first = items[0];
  const drop = (id: string) => {
    setItems((l) => l.filter((x) => x.id !== id));
    void invoke("recovery_clear", { app, id }).catch(() => {});
  };
  const restore = async (id: string) => {
    try {
      const raw = await invoke<string>("recovery_take", { app, id });
      setItems((l) => l.filter((x) => x.id !== id));
      onRestore(JSON.parse(raw));
    } catch {
      drop(id);
    }
  };
  return (
    <MessageBar intent="warning" style={{ margin: "4px 8px" }}>
      <MessageBarBody>
        <MessageBarTitle>{tl("Dokumentwiederherstellung")}</MessageBarTitle>
        {tl("„{0}“ wurde nicht gespeichert, bevor Ondura beendet wurde (Stand {1}).", first.name || tl("Unbenannt"), new Date(first.modified).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }))}
        {items.length > 1 && ` ${tl("Weitere: {0}", items.length - 1)}`}
      </MessageBarBody>
      <MessageBarActions>
        <Button size="small" appearance="primary" onClick={() => void restore(first.id)}>
          {tl("Wiederherstellen")}
        </Button>
        <Button size="small" onClick={() => drop(first.id)}>
          {tl("Verwerfen")}
        </Button>
      </MessageBarActions>
    </MessageBar>
  );
}
