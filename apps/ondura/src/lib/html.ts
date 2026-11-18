// HTML handling for untrusted mail content.

import { escapeHtml } from "./format";

const DROP_ELEMENTS = "script,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,style,title,svg";

/**
 * Sanitises mail HTML for insertion into the app document (compose editor).
 * Parsing with DOMParser creates an inert document, so nothing executes
 * while we clean it.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(DROP_ELEMENTS).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "formaction") el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "xlink:href") && (value.startsWith("javascript:") || value.startsWith("data:text"))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

/** True if the HTML references images or other resources from the web. */
export function hasRemoteContent(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

/**
 * Builds the `srcdoc` for the sandboxed reading-pane iframe. A strict CSP
 * blocks scripts and (unless allowed) remote images, which are commonly used
 * as tracking pixels.
 */
export function buildMailDocument(body: { html: string | null; text: string | null }, allowRemote: boolean): string {
  const img = allowRemote ? "data: cid: https: http:" : "data: cid:";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; font-src data:${allowRemote ? " https:" : ""}; media-src 'none'`;
  const content = body.html ?? `<pre class="ondura-plain">${linkify(escapeHtml(body.text ?? ""))}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#242424}
  body{font-family:"Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.45;padding:4px 2px;overflow-wrap:anywhere}
  .ondura-plain{white-space:pre-wrap;font-family:inherit;margin:0}
  img{max-width:100%;height:auto}
  a{color:#4f54d4}
  blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #c8c8c8;color:#424242}
</style></head><body>${content}</body></html>`;
}

function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<>"]+/g, (url) => `<a href="${url}">${url}</a>`);
}
