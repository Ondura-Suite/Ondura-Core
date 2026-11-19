// OneNote through Microsoft Graph: notebooks, sections, pages and page
// content. Pages are HTML; Ondura edits the content of the page's outlines
// as one flowing page and writes changes back as PATCH commands on the
// elements' generated ids (replace changed blocks, insert new ones), so
// the rest of the page (positions, ink, other outlines) stays untouched.

import { graph, graphAll, graphRaw } from "../../lib/graphApps";

export interface OneSection {
  id: string;
  name: string;
  /** Section group path ("Gruppe / Untergruppe"), if any. */
  group?: string;
}

export interface OneNotebook {
  id: string;
  name: string;
  sections: OneSection[];
}

export interface OnePageInfo {
  id: string;
  title: string;
  created: string;
  modified: string;
  level: number;
  order: number;
}

interface RawSectionGroup {
  displayName: string;
  sections?: { id: string; displayName: string }[];
  sectionGroups?: RawSectionGroup[];
}

export async function notebooks(account: string): Promise<OneNotebook[]> {
  const raw = await graphAll<{ id: string; displayName: string; sections?: { id: string; displayName: string }[]; sectionGroups?: RawSectionGroup[] }>(
    account,
    "notes",
    "/me/onenote/notebooks?$expand=sections($select=id,displayName),sectionGroups($expand=sections($select=id,displayName),sectionGroups($expand=sections($select=id,displayName)))&$select=id,displayName&$orderby=displayName",
  );
  const flatten = (groups: RawSectionGroup[] | undefined, prefix: string): OneSection[] =>
    (groups ?? []).flatMap((g) => {
      const path = prefix ? `${prefix} / ${g.displayName}` : g.displayName;
      return [...(g.sections ?? []).map((s) => ({ id: s.id, name: s.displayName, group: path })), ...flatten(g.sectionGroups, path)];
    });
  return raw.map((n) => ({ id: n.id, name: n.displayName, sections: [...(n.sections ?? []).map((s) => ({ id: s.id, name: s.displayName })), ...flatten(n.sectionGroups, "")] }));
}

export async function pages(account: string, sectionId: string): Promise<OnePageInfo[]> {
  const raw = await graphAll<{ id: string; title?: string; createdDateTime: string; lastModifiedDateTime: string; level?: number; order?: number }>(
    account,
    "notes",
    `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,order&$top=100&pagelevel=true`,
  );
  return raw
    .map((p, i) => ({ id: p.id, title: p.title ?? "", created: p.createdDateTime, modified: p.lastModifiedDateTime, level: p.level ?? 0, order: p.order ?? i }))
    .sort((a, b) => a.order - b.order);
}

export async function createNotebook(account: string, name: string): Promise<OneNotebook> {
  const n = await graph<{ id: string; displayName: string }>(account, "notes", "POST", "/me/onenote/notebooks", { body: { displayName: name } });
  return { id: n.id, name: n.displayName, sections: [] };
}

export async function createSection(account: string, notebookId: string, name: string): Promise<OneSection> {
  const s = await graph<{ id: string; displayName: string }>(account, "notes", "POST", `/me/onenote/notebooks/${encodeURIComponent(notebookId)}/sections`, { body: { displayName: name } });
  return { id: s.id, name: s.displayName };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function createPage(account: string, sectionId: string, title: string, html = "<p></p>"): Promise<OnePageInfo> {
  const doc = `<!DOCTYPE html><html><head><title>${esc(title)}</title><meta name="created" content="${new Date().toISOString()}" /></head><body>${html}</body></html>`;
  const p = await graph<{ id: string; title?: string; createdDateTime: string; lastModifiedDateTime: string }>(account, "notes", "POST", `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`, { body: doc, contentType: "text/html" });
  return { id: p.id, title: p.title ?? title, created: p.createdDateTime, modified: p.lastModifiedDateTime ?? p.createdDateTime, level: 0, order: Number.MAX_SAFE_INTEGER };
}

export async function deletePage(account: string, pageId: string): Promise<void> {
  await graphRaw(account, "notes", "DELETE", `/me/onenote/pages/${encodeURIComponent(pageId)}`);
}

// ------------------------------------------------------------ content --

export interface Block {
  /** Generated id of the element (target of PATCH commands). */
  id: string;
  html: string;
}

export interface PageContent {
  title: string;
  created: string;
  /** Content blocks of all outlines, in reading order. */
  blocks: Block[];
}

/** Tags with a meaning in OneNote's output that the editor understands. */
const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "TABLE", "IMG", "OBJECT", "DIV", "PRE", "BLOCKQUOTE"]);

/**
 * Splits OneNote's output HTML into blocks. Outlines (absolutely positioned
 * divs) are read top to bottom, then left to right; nested divs are
 * flattened into their children.
 */
export function parsePage(html: string): PageContent {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent ?? "";
  const created = doc.querySelector('meta[name="created"]')?.getAttribute("content") ?? "";
  const outlines = Array.from(doc.body.children).filter((el) => el.tagName === "DIV") as HTMLElement[];
  const pos = (el: HTMLElement) => [parseFloat(el.style.top) || 0, parseFloat(el.style.left) || 0];
  outlines.sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1]);
  const blocks: Block[] = [];
  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!BLOCK_TAGS.has(child.tagName)) continue;
      if (child.tagName === "DIV") {
        visit(child);
        continue;
      }
      blocks.push({ id: child.id, html: child.outerHTML });
    }
  };
  // Content directly in the body (pages made elsewhere) counts as one outline.
  const loose = Array.from(doc.body.children).filter((el) => el.tagName !== "DIV" && BLOCK_TAGS.has(el.tagName));
  for (const el of loose) blocks.push({ id: el.id, html: el.outerHTML });
  for (const o of outlines) visit(o);
  return { title, created, blocks };
}

export async function pageContent(account: string, pageId: string): Promise<PageContent> {
  const r = await graphRaw(account, "notes", "GET", `/me/onenote/pages/${encodeURIComponent(pageId)}/content?includeIDs=true`);
  return parsePage(r.body);
}

/** Image resources become data URLs (they need the account's token). */
export async function inlineImages(account: string, html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("data-fullres-src") || img.getAttribute("src") || "";
      if (!src.startsWith("https://graph.microsoft.com/")) return;
      try {
        const r = await graphRaw(account, "notes", "GET", src, { binary: true });
        img.setAttribute("src", `data:${r.contentType?.split(";")[0] || "image/png"};base64,${r.body}`);
        img.removeAttribute("data-fullres-src");
        img.removeAttribute("data-src-type");
        img.removeAttribute("data-fullres-src-type");
      } catch {
        /* leave the image out of the editor */
      }
    }),
  );
  return doc.body.innerHTML;
}

export interface PatchCommand {
  target: string;
  action: "replace" | "append" | "insert";
  position?: "before" | "after";
  content: string;
}

/**
 * PATCH commands that turn the page from `before` into `after`. Blocks
 * keep their OneNote id in `after`; blocks without an id are new. OneNote
 * cannot delete elements, so removed blocks are replaced by an empty
 * paragraph.
 */
export function diffBlocks(before: Block[], after: { id: string | null; html: string }[], titleBefore: string, titleAfter: string): PatchCommand[] {
  const cmds: PatchCommand[] = [];
  if (titleAfter !== titleBefore) cmds.push({ target: "title", action: "replace", content: esc(titleAfter) });
  const old = new Map(before.map((b) => [b.id, b.html]));
  const kept = new Set<string>();
  let anchor: string | null = null;
  let pending: string[] = [];
  const flushNew = () => {
    if (!pending.length) return;
    const content = pending.join("");
    if (anchor) cmds.push({ target: anchor, action: "insert", position: "after", content });
    else cmds.push({ target: "body", action: "append", position: "before", content });
    pending = [];
  };
  for (const b of after) {
    if (b.id && old.has(b.id) && !kept.has(b.id)) {
      flushNew();
      kept.add(b.id);
      if (old.get(b.id) !== b.html) cmds.push({ target: b.id, action: "replace", content: b.html });
      anchor = b.id;
    } else pending.push(b.html);
  }
  flushNew();
  for (const b of before) if (b.id && !kept.has(b.id)) cmds.push({ target: b.id, action: "replace", content: "<p></p>" });
  return cmds;
}

export async function patchPage(account: string, pageId: string, cmds: PatchCommand[]): Promise<void> {
  if (!cmds.length) return;
  await graphRaw(account, "notes", "PATCH", `/me/onenote/pages/${encodeURIComponent(pageId)}/content`, { body: cmds });
}
