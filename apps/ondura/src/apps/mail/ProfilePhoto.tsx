// Own profile picture of an Ondura Server mailbox (account settings).

import { useRef, useState } from "react";
import { Button, Field } from "@fluentui/react-components";
import type { Account } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { tl } from "../../lib/i18n";
import { PersonAvatar, forgetPersonPhoto, usePersonPhoto } from "./personPhoto";

/** Longest side of an uploaded picture (the server allows 1 MiB). */
const SIZE = 384;

/** Whether the account can have a profile picture on its server. */
export const hasProfilePhoto = (a: Account) => a.kind.type === "ews" && a.kind.product === "ondura-server" && !a.kind.mailbox;

/** Square crop from the middle of an image, as PNG (keeps transparency) or JPEG. */
async function squareImage(file: File): Promise<{ data: string; type: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(tl("Das Bild konnte nicht gelesen werden"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const type = file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp" ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(type, 0.9);
  return { data: url.slice(url.indexOf(",") + 1), type };
}

export function ProfilePhoto({ account, onError }: { account: Account; onError: (message: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const photo = usePersonPhoto(account.email);

  const apply = async (data: string | null, type: string | null) => {
    setBusy(true);
    onError(null);
    try {
      await api.setAccountPhoto(account.id, data, type);
      forgetPersonPhoto(account.email);
    } catch (e) {
      const msg = errorMessage(e);
      onError(/not supported|unsupported|nicht unterstützt/i.test(msg) ? tl("Dieser Ondura Server unterstützt noch keine Profilbilder. Aktualisieren Sie den Server.") : msg);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { data, type } = await squareImage(file);
      await apply(data, type);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <Field label={tl("Profilbild")} hint={tl("Für alle Postfächer auf diesem Ondura Server sichtbar")}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PersonAvatar email={account.email} name={account.displayName || account.email} size={56} />
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {photo ? tl("Bild ändern …") : tl("Bild auswählen …")}
        </Button>
        {photo && (
          <Button appearance="subtle" disabled={busy} onClick={() => void apply(null, null)}>
            {tl("Entfernen")}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </Field>
  );
}
