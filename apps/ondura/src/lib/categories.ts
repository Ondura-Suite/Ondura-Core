// Colour categories. A category is a name with a colour. Servers with a
// category list (Ondura Server, Microsoft 365) keep the colour; otherwise the
// app's own list does, and a category without one gets a colour from its
// name, so it looks the same everywhere. The palette and the derivation match
// the engine (crates/mail-core/src/categories.rs).

/** Ondura's category colours (also Ondura Server's web app palette). */
export const CATEGORY_PALETTE: { hex: string; label: string }[] = [
  { hex: "#e05260", label: "Rot" },
  { hex: "#e8873b", label: "Orange" },
  { hex: "#e6b800", label: "Gelb" },
  { hex: "#3aa655", label: "Grün" },
  { hex: "#17a2a2", label: "Türkis" },
  { hex: "#3b82c4", label: "Blau" },
  { hex: "#9b59b6", label: "Lila" },
  { hex: "#e0559b", label: "Rosa" },
  { hex: "#8a93a2", label: "Grau" },
];

/** Colour names in category names ("Rot", "Blaue Kategorie") keep their colour. */
const NAMED: Record<string, number> = { rot: 0, red: 0, orange: 1, gelb: 2, yellow: 2, grün: 3, green: 3, türkis: 4, teal: 4, blau: 5, blue: 5, lila: 6, purple: 6, rosa: 7, pink: 7, grau: 8, gray: 8, grey: 8 };

/** Colours of the category list, by lower-case name. */
const listColors = new Map<string, string>();

/** Takes over the colours of the category list. */
export function setCategoryColors(list: { name: string; color: string | null }[]) {
  listColors.clear();
  for (const c of list) if (c.color && /^#[0-9a-f]{3,8}$/i.test(c.color)) listColors.set(c.name.trim().toLowerCase(), c.color);
}

/** Colour a category gets without one of its own. */
export function defaultCategoryColor(name: string): string {
  const key = name.trim().toLowerCase();
  const word = key.split(/\s+/)[0] ?? "";
  for (const stem of [word, word.replace(/en$/, ""), word.replace(/e$/, "")]) if (stem in NAMED) return CATEGORY_PALETTE[NAMED[stem]].hex;
  let h = 0;
  for (const ch of key) h = (Math.imul(h, 31) + ch.codePointAt(0)!) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length].hex;
}

export function categoryColor(name: string): string {
  return listColors.get(name.trim().toLowerCase()) ?? defaultCategoryColor(name);
}

/** Offered while no category exists yet (as in Outlook). */
export const DEFAULT_CATEGORIES = ["Rot", "Orange", "Gelb", "Grün", "Blau", "Lila"];
