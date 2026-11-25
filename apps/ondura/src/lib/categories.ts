// Colour categories (Exchange/Graph categories). A category is a name; servers with
// a category list (Ondura Server) give it a colour, otherwise the colour is derived
// from the name so it is the same everywhere without extra state.

const PALETTE = ["#d13438", "#ca5010", "#c19c00", "#107c41", "#0e7a8a", "#4f54d4", "#8764b8", "#c239b3", "#986f0b", "#5c7e10"];

/** Well-known Outlook category names keep their usual colour. */
const NAMED: Record<string, string> = {
  rot: "#d13438",
  "rote kategorie": "#d13438",
  orange: "#ca5010",
  "orange kategorie": "#ca5010",
  gelb: "#c19c00",
  "gelbe kategorie": "#c19c00",
  grün: "#107c41",
  "grüne kategorie": "#107c41",
  blau: "#4f54d4",
  "blaue kategorie": "#4f54d4",
  lila: "#8764b8",
  "lila kategorie": "#8764b8",
};

/** Colours the servers keep, by lower-case name. */
const serverColors = new Map<string, string>();

/** Takes over the colours of the servers' category lists. */
export function setCategoryColors(list: { name: string; color: string | null }[]) {
  serverColors.clear();
  for (const c of list) if (c.color && /^#[0-9a-f]{3,8}$/i.test(c.color)) serverColors.set(c.name.trim().toLowerCase(), c.color);
}

export function categoryColor(name: string): string {
  const key = name.trim().toLowerCase();
  const server = serverColors.get(key);
  if (server) return server;
  if (NAMED[key]) return NAMED[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const DEFAULT_CATEGORIES = ["Rot", "Orange", "Gelb", "Grün", "Blau", "Lila"];
