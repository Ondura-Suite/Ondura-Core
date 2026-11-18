// Sheet protection: password hashes compatible with Excel and
// OpenDocument, and the checks that block changes of protected cells.

import type { Book, CellStyle, Protection, Rect, SheetState } from "./model";
import { key } from "./model";
import { tl } from "../../lib/i18n";

/** Legacy 16-bit Excel password hash as 4 hex digits (`<sheetProtection password>`). */
export function legacyHash(password: string): string {
  let h = 0;
  const chars = [...password].map((c) => c.charCodeAt(0) & 0x7fff).slice(0, 15);
  for (let i = chars.length - 1; i >= 0; i--) {
    h = ((h >> 14) & 1) | ((h << 1) & 0x7fff);
    h ^= chars[i];
  }
  h = ((h >> 14) & 1) | ((h << 1) & 0x7fff);
  h ^= chars.length;
  h ^= 0xce4b;
  return h.toString(16).toUpperCase().padStart(4, "0");
}

const ODF_SHA256 = "http://www.w3.org/2000/09/xmldsig#sha256";

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** Excel 2013+ hash: SHA-x over salt + UTF-16LE password, iterated `spin` times. */
async function modernHash(password: string, algorithm: string, salt: Uint8Array, spin: number): Promise<string> {
  const alg = algorithm.toUpperCase().replace(/^SHA-?/, "SHA-");
  let h = new Uint8Array(await crypto.subtle.digest(alg, concat(salt, utf16le(password))));
  const it = new Uint8Array(4);
  for (let i = 0; i < spin; i++) {
    new DataView(it.buffer).setUint32(0, i, true);
    h = new Uint8Array(await crypto.subtle.digest(alg, concat(h, it)));
  }
  return b64(h);
}

/** Protection with hashes of `password` for both xlsx and ods (empty = no password). */
export async function protectionFor(password: string, allow: Partial<Protection>): Promise<Protection> {
  const p: Protection = { selectLocked: true, ...allow };
  if (!password) return p;
  p.password = legacyHash(password);
  p.odfKey = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)));
  p.odfAlgorithm = ODF_SHA256;
  return p;
}

/** Does `password` remove the protection? Accepts every hash a file may bring. */
export async function checkPassword(p: Protection, password: string): Promise<boolean> {
  const hashed = !!(p.password || p.hash || p.odfKey);
  if (!hashed) return true;
  if (p.hash && p.salt && p.algorithm) {
    try {
      return (await modernHash(password, p.algorithm, unb64(p.salt), p.spinCount ?? 100000)) === p.hash;
    } catch {
      /* unknown algorithm: try the others */
    }
  }
  if (p.password) return legacyHash(password) === p.password.toUpperCase();
  if (p.odfKey) {
    const alg = (p.odfAlgorithm ?? "").toLowerCase();
    const digest = alg.includes("sha256") || alg.includes("sha-256") ? "SHA-256" : "SHA-1";
    return b64(await crypto.subtle.digest(digest, new TextEncoder().encode(password))) === p.odfKey;
  }
  return false;
}

/** Cell style of r/c (protection flags only matter here). */
function styleAt(book: Book, sheet: SheetState, r: number, c: number): CellStyle | undefined {
  const cell = sheet.cells.get(key(r, c));
  return cell?.s ? book.styles[cell.s] : undefined;
}

export const isLocked = (book: Book, sheet: SheetState, r: number, c: number) => styleAt(book, sheet, r, c)?.locked !== false;
export const formulaHidden = (book: Book, sheet: SheetState, r: number, c: number) => !!sheet.protection && !!styleAt(book, sheet, r, c)?.hideFormula;

/** Is any cell of `rect` locked on a protected sheet? Whole rows/columns count as locked. */
export function rangeLocked(book: Book, sheet: SheetState, rect: Rect): boolean {
  if (!sheet.protection) return false;
  const n = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
  if (n > 100_000) return true;
  for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) if (isLocked(book, sheet, r, c)) return true;
  return false;
}

export const PROTECTED_MESSAGE = tl("Die Zelle oder das Diagramm, die bzw. das Sie ändern möchten, befindet sich auf einem geschützten Blatt. Heben Sie den Blattschutz auf (Überprüfen › Blattschutz aufheben), um Änderungen vorzunehmen.");
