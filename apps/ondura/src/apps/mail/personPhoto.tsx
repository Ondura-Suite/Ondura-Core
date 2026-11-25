// Profile pictures of people in Ondura Mail. Ondura Server keeps a picture
// per mailbox; the engine asks the servers of the accounts and caches the
// answer. Other account types simply have none and show initials.

import { useEffect, useState } from "react";
import { Avatar, type AvatarProps } from "@fluentui/react-components";
import { api } from "../../lib/api";

const cache = new Map<string, Promise<string | null>>();
const listeners = new Set<(email: string) => void>();

const keyOf = (email: string) => email.trim().toLowerCase();

/** Picture of `email` as `data:` URL, or `null` without one. */
export function personPhoto(email: string): Promise<string | null> {
  const key = keyOf(email);
  if (!key.includes("@")) return Promise.resolve(null);
  let p = cache.get(key);
  if (!p) {
    p = api.personPhoto(key).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** Drops the cached picture of `email` (after changing one's own). */
export function forgetPersonPhoto(email: string) {
  const key = keyOf(email);
  cache.delete(key);
  for (const l of listeners) l(key);
}

export function usePersonPhoto(email: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!email) return;
    const key = keyOf(email);
    const onChange = (changed: string) => changed === key && setVersion((v) => v + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [email]);
  useEffect(() => {
    setSrc(null);
    if (!email) return;
    let live = true;
    void personPhoto(email).then((p) => live && setSrc(p));
    return () => {
      live = false;
    };
  }, [email, version]);
  return src;
}

/** Avatar with the person's picture where the server has one. */
export function PersonAvatar({ email, ...props }: AvatarProps & { email: string | null | undefined }) {
  const photo = usePersonPhoto(email);
  return <Avatar color="colorful" {...props} image={photo ? { src: photo } : undefined} />;
}
