import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Button, Checkbox, Input, Slider, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDown16Regular, ArrowUp16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { Backstage, DocumentInfo, StatusBar, useUnsavedPrompt } from "../../shell/office";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { errorMessage, isTauri } from "../../lib/api";
import { addRecent, baseName, guardClose, initialFile, officeInvoke, openDocumentWindow, pickOpenPath, pickPdfPath, pickSavePath, printToPdf, setWindowTitle, withoutExt } from "../../lib/office";
import { textExtensions, replaceAll, replaceCurrent, searchState, setSearch, stepSearch } from "./extensions";
import { refreshPagination, type PageGeometry } from "./pagination";
import { TextRibbon } from "./TextRibbon";
import { HeaderFooterDialog, type HeaderFooterValue, LinkDialog, PageSetupDialog, ParagraphDialog, type ParagraphValues, TextDialog } from "./dialogs";
import { type Block, type Comment, type PageSetup, type Paragraph, type TextDocument, documentToPm, emptyDocument, mmToPx, pmBlocks } from "./model";
import { commentRanges, gotoChange, headingPosition, isTracking, removeComment, resolveChanges, setTracking, tocEntries, updateTocs } from "./review";
import { CommentsPane, FootnoteList, roman } from "./ReviewPane";
import { sampleDocument } from "./sample";
import "./text.css";

const COLOR = "#2b5bd7";
const PANE_W = 290;
const GAP = 24;

const useStyles = makeStyles({
  root: { height: "100%", display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground3 },
  work: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "8px 8px 0", borderRadius: `${tokens.borderRadiusLarge} ${tokens.borderRadiusLarge} 0 0`, overflow: "hidden", position: "relative" },
  find: {
    position: "absolute",
    top: "10px",
    right: "24px",
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    width: "340px",
  },
  findRow: { display: "flex", gap: "4px", alignItems: "center" },
  loading: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, backgroundColor: "rgba(0,0,0,0.04)" },
  zoom: { display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" },
});

interface Loaded {
  document: TextDocument;
  warnings: string[];
}

function hfDom(blocks: Block[], page: number, pages: number): HTMLElement | null {
  if (!blocks.length) return null;
  const wrap = document.createElement("div");
  for (const b of blocks) {
    if (b.type !== "paragraph") continue;
    const line = document.createElement("div");
    line.style.textAlign = b.align ?? "left";
    line.textContent = b.content.map((i) => (i.type === "text" ? i.text : i.type === "field" ? String(i.field === "pages" ? pages : page) : i.type === "tab" ? " " : "")).join("") || " ";
    wrap.appendChild(line);
  }
  return wrap;
}

function cssString(s: string) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `content:` value for an @page margin box. */
function hfCss(blocks: Block[]): { content: string; align: string } | null {
  const paras = blocks.filter((b): b is Paragraph => b.type === "paragraph");
  if (!paras.length) return null;
  const parts: string[] = [];
  paras.forEach((p, n) => {
    if (n > 0) parts.push('"\\A"');
    for (const i of p.content) {
      if (i.type === "text") parts.push(cssString(i.text));
      else if (i.type === "field") parts.push(i.field === "pages" ? "counter(pages)" : "counter(page)");
      else if (i.type === "tab") parts.push('"  "');
    }
  });
  return { content: parts.join(" ") || '""', align: paras[0].align ?? "left" };
}

export function TextApp() {
  const s = useStyles();
  const notify = useNotify();
  const unsaved = useUnsavedPrompt();

  const initial = useMemo<TextDocument>(() => (isTauri ? emptyDocument() : sampleDocument()), []);
  const [path, setPath] = useState<string | null>(null);
  // The document is dirty when its content differs from the last
  // loaded/saved state, or when page setup, header/footer or properties
  // were changed.
  const [docDirty, setDocDirty] = useState(false);
  const [metaDirty, setDirty] = useState(false);
  const dirty = docDirty || metaDirty;
  const savedDoc = useRef<import("@tiptap/pm/model").Node | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [page, setPage] = useState<PageSetup>(initial.page);
  const [header, setHeader] = useState<Block[]>(initial.header);
  const [footer, setFooter] = useState<Block[]>(initial.footer);
  const [first, setFirst] = useState({ enabled: !!initial.differentFirst, header: initial.headerFirst ?? [], footer: initial.footerFirst ?? [] });
  const [comments, setComments] = useState<Comment[]>(initial.comments ?? []);
  const [userName, setUserName] = useState(() => {
    try {
      return localStorage.getItem("nexora.userName") ?? "";
    } catch {
      return "";
    }
  });
  const [footnoteEdit, setFootnoteEdit] = useState<null | { pos: number | null; text: string; endnote: boolean }>(null);
  // Page setup of the section that ends at a section break (its position).
  const [sectionEdit, setSectionEdit] = useState<null | { pos: number; page: PageSetup }>(null);
  const [focusComment, setFocusComment] = useState<number | null>(null);
  const [meta, setMeta] = useState({ title: initial.title, author: initial.author, font: initial.defaultFont ?? null, size: initial.defaultSize ?? null });
  const [layout, setLayout] = useState({ pages: 1, minHeight: 0 });
  const [zoom, setZoom] = useState(1);
  const [backstage, setBackstage] = useState<null | "open" | "info">(null);
  const [dialog, setDialog] = useState<null | "page" | "hf" | "link" | "paragraph" | "name">(null);
  const [find, setFind] = useState<null | { replace: boolean }>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  // Target file while the print view is exported as PDF instead of printed.
  const pdfTarget = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const pageRef = useRef(page);
  const hfRef = useRef({ header, footer, first });
  pageRef.current = page;
  hfRef.current = { header, footer, first };
  const author = userName.trim() || meta.author.trim() || "Ich";
  const authorRef = useRef(author);
  authorRef.current = author;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const canvas = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [paperSize, setPaperSize] = useState({ w: 0, h: 0 });

  const geometry = useCallback((): PageGeometry => {
    const p = pageRef.current;
    return {
      contentHeight: mmToPx(p.heightMm - p.marginTopMm - p.marginBottomMm),
      marginTop: mmToPx(p.marginTopMm),
      marginBottom: mmToPx(p.marginBottomMm),
      marginLeft: mmToPx(p.marginLeftMm),
      marginRight: mmToPx(p.marginRightMm),
      gap: GAP,
    };
  }, []);

  const editor = useEditor({
    extensions: textExtensions({
      pagination: {
        geometry,
        renderHeader: (pg, n) => {
          const hf = hfRef.current;
          const el = hfDom(hf.first.enabled && pg === 1 ? hf.first.header : hf.header, pg, n);
          if (el) el.style.paddingTop = `${mmToPx(pageRef.current.headerMm)}px`;
          return el;
        },
        renderFooter: (pg, n) => {
          const hf = hfRef.current;
          const el = hfDom(hf.first.enabled && pg === 1 ? hf.first.footer : hf.footer, pg, n);
          if (el) {
            el.style.marginTop = "auto";
            el.style.paddingBottom = `${mmToPx(pageRef.current.footerMm)}px`;
          }
          return el;
        },
        onLayout: (l) => setLayout({ pages: l.pages, minHeight: l.minHeight }),
      },
      author: () => authorRef.current,
    }),
    content: documentToPm(initial),
    editorProps: {
      attributes: { spellcheck: "true", lang: "de" },
      handleDoubleClickOn: (_view, pos, node) => {
        if (node.type.name === "sectionBreak") {
          setSectionEdit({ pos, page: node.attrs.page ?? pageRef.current });
          return true;
        }
        if (node.type.name !== "footnote") return false;
        setFootnoteEdit({ pos, text: node.attrs.text ?? "", endnote: !!node.attrs.endnote });
        return true;
      },
      handleClickOn: (view, _pos, node, _nodePos, event) => {
        if (node.type.name !== "toc") return false;
        const entry = (event.target as HTMLElement).closest("[data-index]");
        if (!entry) return false;
        const target = headingPosition({ state: view.state } as never, Number(entry.getAttribute("data-index")));
        if (target !== null) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).scrollIntoView());
          view.focus();
        }
        return true;
      },
    },
    onCreate: ({ editor: e }) => {
      savedDoc.current = e.state.doc;
      // Normalisation on the first transactions (trailing paragraph) is not an edit.
      requestAnimationFrame(() => (savedDoc.current = e.state.doc));
      if (!isTauri) (window as { __nexoraText?: unknown }).__nexoraText = e;
    },
    onUpdate: ({ editor: e }) => setDocDirty(!savedDoc.current || !e.state.doc.eq(savedDoc.current)),
    onSelectionUpdate: ({ editor: e }) => {
      // Page of the cursor: number of page gaps above it.
      try {
        const top = e.view.coordsAtPos(e.state.selection.from).top;
        const spacers = e.view.dom.querySelectorAll<HTMLElement>(".nx-page-spacer");
        let n = 1;
        spacers.forEach((sp) => {
          if (sp.getBoundingClientRect().bottom < top) n++;
        });
        setCurrentPage(n);
      } catch {
        /* position not rendered */
      }
    },
  });

  const words = useEditorState({ editor, selector: ({ editor: e }) => (e?.storage.characterCount?.words?.() ?? 0) }) ?? 0;

  const name = path ? baseName(path) : meta.title || "Dokument1";
  useEffect(() => {
    void setWindowTitle(`${dirty ? "• " : ""}${withoutExt(name)} – Nexora Text`);
  }, [name, dirty]);

  // Re-render headers/footers and re-measure when the page setup changes.
  useEffect(() => {
    if (editor) refreshPagination(editor.view);
  }, [editor, page, header, footer, first]);

  useEffect(() => {
    const el = paper.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPaperSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => splashDone(), []);

  // ---------------------------------------------------------------- files --

  const currentDocument = useCallback((): TextDocument => {
    const blocks = pmBlocks(editor?.getJSON().content ?? []);
    return {
      page,
      blocks: blocks.length ? blocks : [{ type: "paragraph", content: [] }],
      header,
      footer,
      title: meta.title,
      author: meta.author,
      defaultFont: meta.font,
      defaultSize: meta.size,
      differentFirst: first.enabled,
      headerFirst: first.enabled ? first.header : [],
      footerFirst: first.enabled ? first.footer : [],
      comments,
    };
  }, [editor, page, header, footer, meta, first, comments]);

  const apply = useCallback(
    (doc: TextDocument) => {
      if (!editor) return;
      setPage(doc.page);
      setHeader(doc.header ?? []);
      setFooter(doc.footer ?? []);
      setFirst({ enabled: !!doc.differentFirst, header: doc.headerFirst ?? [], footer: doc.footerFirst ?? [] });
      setComments(doc.comments ?? []);
      setMeta({ title: doc.title ?? "", author: doc.author ?? "", font: doc.defaultFont ?? null, size: doc.defaultSize ?? null });
      // A fresh state also resets the undo history.
      const node = editor.schema.nodeFromJSON(documentToPm(doc));
      editor.view.updateState(EditorState.create({ doc: node, plugins: editor.state.plugins, schema: editor.schema }));
      editor.commands.setTextSelection(1);
      savedDoc.current = editor.state.doc;
      setDocDirty(false);
      setDirty(false);
    },
    [editor],
  );

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const r = await officeInvoke<Loaded>("text_open", { path: p });
        apply(r.document);
        setPath(p);
        setWarnings(r.warnings);
        addRecent("text", p);
        if (r.warnings.length) notify("Nicht alles konnte übernommen werden", "Details unter Datei › Informationen.", "warning");
      } catch (e) {
        notify("Öffnen fehlgeschlagen", errorMessage(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [apply, notify],
  );

  useEffect(() => {
    const f = initialFile();
    if (f && editor) void load(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const saveTo = useCallback(
    async (target: string) => {
      // Page numbers in tables of contents are refreshed on save.
      if (editor) updateTocs(editor);
      await officeInvoke("text_save", { path: target, document: currentDocument() });
      setPath(target);
      savedDoc.current = editor?.state.doc ?? null;
      setDocDirty(false);
      setDirty(false);
      addRecent("text", target);
      notify("Gespeichert", baseName(target), "success");
    },
    [currentDocument, notify, editor],
  );

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (!isTauri) {
      notify("Speichern", "Im Browser-Vorschaumodus nicht verfügbar.", "info");
      return false;
    }
    const target = await pickSavePath("text", withoutExt(name));
    if (!target) return false;
    try {
      await saveTo(target);
      return true;
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      return false;
    }
  }, [name, notify, saveTo]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!path) return saveAs();
    try {
      await saveTo(path);
      return true;
    } catch (e) {
      notify("Speichern fehlgeschlagen", errorMessage(e), "error");
      return false;
    }
  }, [path, saveAs, saveTo, notify]);

  const open = useCallback(
    async (target?: string) => {
      const p = target ?? (await pickOpenPath("text"));
      if (!p) return;
      setBackstage(null);
      // An untouched new document is replaced, like in Word.
      if (!path && !dirtyRef.current) await load(p);
      else await openDocumentWindow("text", p);
    },
    [load, path],
  );

  useEffect(() => guardClose(() => dirtyRef.current, () => unsaved.ask(withoutExt(name)), save), [name, save, unsaved]);

  // --------------------------------------------------------------- print --

  const sectionCss = useRef("");
  const print = useCallback(() => {
    if (!editor) return;
    setBackstage(null);
    const notes: string[] = [];
    const endnotes: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "footnote") (n.attrs.endnote ? endnotes : notes).push(n.attrs.text ?? "");
    });
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const list = notes.length ? `<div class="nx-footnotes">${notes.map((t, i) => `<div class="nx-footnote"><sup>${i + 1}</sup> ${esc(t)}</div>`).join("")}</div>` : "";
    const endList = endnotes.length ? `<div class="nx-footnotes"><div class="nx-endnotes-title">Endnoten</div>${endnotes.map((t, i) => `<div class="nx-footnote"><sup>${roman(i)}</sup> ${esc(t)}</div>`).join("")}</div>` : "";
    // Sections become named pages with their own size and margins.
    const pages: PageSetup[] = [];
    editor.state.doc.forEach((n) => {
      if (n.type.name === "sectionBreak" && n.attrs.page) pages.push(n.attrs.page as PageSetup);
    });
    const parts = editor.getHTML().split(/<div[^>]*data-section-break[^>]*>.*?<\/div>/);
    let css = "";
    const html = parts
      .map((part, i) => {
        const sp = pages[i];
        if (!sp) return `<div class="nx-sec">${part}${list}${endList}</div>`;
        css += `@page nxs${i} { size: ${sp.widthMm}mm ${sp.heightMm}mm; margin: ${sp.marginTopMm}mm ${sp.marginRightMm}mm ${sp.marginBottomMm}mm ${sp.marginLeftMm}mm; } .nx-sec-${i} { page: nxs${i}; }`;
        return `<div class="nx-sec nx-sec-${i}">${part}</div>`;
      })
      .join("");
    sectionCss.current = css + " .nx-sec + .nx-sec { break-before: page; }";
    setPrinting(html);
  }, [editor]);

  useEffect(() => {
    if (printing == null) return;
    const p = page;
    const h = hfCss(header);
    const f = hfCss(footer);
    const h1 = first.enabled ? hfCss(first.header) : null;
    const f1 = first.enabled ? hfCss(first.footer) : null;
    const box = (where: "top" | "bottom", v: { content: string; align: string } | null) =>
      v ? `@${where}-${v.align === "center" ? "center" : v.align === "right" ? "right" : "left"} { content: ${v.content}; white-space: pre; font: 9pt Calibri, Carlito, sans-serif; color: #555; vertical-align: ${where === "top" ? "bottom" : "top"}; }` : "";
    const style = document.createElement("style");
    style.textContent = `@page { size: ${p.widthMm}mm ${p.heightMm}mm; margin: ${p.marginTopMm}mm ${p.marginRightMm}mm ${p.marginBottomMm}mm ${p.marginLeftMm}mm; ${box("top", h)} ${box("bottom", f)} }${first.enabled ? ` @page :first { ${box("top", h1)} ${box("bottom", f1)} }` : ""} ${sectionCss.current}`;
    document.head.appendChild(style);
    const t = setTimeout(async () => {
      const target = pdfTarget.current;
      pdfTarget.current = null;
      if (target) {
        try {
          await printToPdf(target, p.widthMm, p.heightMm, [p.marginTopMm, p.marginRightMm, p.marginBottomMm, p.marginLeftMm]);
          notify("Als PDF exportiert", baseName(target));
        } catch (e) {
          notify("PDF-Export fehlgeschlagen", errorMessage(e), "error");
        }
      } else window.print();
      style.remove();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printing, page, header, footer, first, notify]);

  const exportPdf = async () => {
    const target = await pickPdfPath(withoutExt(name));
    if (!target) return;
    pdfTarget.current = target;
    print();
  };

  // ------------------------------------------------------- review commands --

  const commentAction = (action: "new" | "delete" | "next" | "prev") => {
    if (!editor) return;
    if (action === "new") {
      const { from, to, empty } = editor.state.selection;
      let a = from;
      let b = to;
      if (empty) {
        // Comment on the word at the cursor.
        const $p = editor.state.doc.resolve(from);
        const text = $p.parent.textContent;
        const off = $p.parentOffset;
        let s0 = off;
        let e0 = off;
        while (s0 > 0 && /[\p{L}\p{N}]/u.test(text[s0 - 1])) s0--;
        while (e0 < text.length && /[\p{L}\p{N}]/u.test(text[e0])) e0++;
        if (s0 === e0) return notify("Kommentar", "Markiere zuerst den Text, den du kommentieren möchtest.", "info");
        a = from - (off - s0);
        b = from + (e0 - off);
      }
      const id = Math.max(0, ...comments.map((c) => c.id)) + 1;
      editor.chain().focus().setTextSelection({ from: a, to: b }).setMark("comment", { id }).run();
      setComments((c) => [...c, { id, author, date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), text: "" }]);
      setFocusComment(id);
      setDirty(true);
    } else if (action === "delete") {
      const id = editor.getAttributes("comment").id;
      if (id != null) deleteComment(Number(id));
    } else {
      const ranges = [...commentRanges(editor.state.doc).entries()].sort((x, y) => x[1].from - y[1].from);
      if (!ranges.length) return;
      const cur = editor.state.selection.from;
      const hit = action === "next" ? ranges.find(([, r]) => r.from > cur) ?? ranges[0] : [...ranges].reverse().find(([, r]) => r.to < cur) ?? ranges[ranges.length - 1];
      editor.chain().focus().setTextSelection(hit[1]).scrollIntoView().run();
      setFocusComment(hit[0]);
    }
  };

  const deleteComment = (id: number) => {
    if (editor) removeComment(editor, id);
    setComments((c) => c.filter((x) => x.id !== id));
    setDirty(true);
  };

  const trackAction = (action: "toggle" | "accept" | "acceptAll" | "reject" | "rejectAll" | "next" | "prev") => {
    if (!editor) return;
    switch (action) {
      case "toggle":
        setTracking(editor, !isTracking(editor));
        break;
      case "accept":
      case "acceptAll":
      case "reject":
      case "rejectAll":
        resolveChanges(editor, action.startsWith("accept"), action.endsWith("All"));
        break;
      default:
        if (!gotoChange(editor, action === "next" ? 1 : -1)) notify("Keine nachverfolgten Änderungen im Dokument.");
    }
  };

  const tocAction = (mode: "insert" | "update") => {
    if (!editor) return;
    if (mode === "insert") {
      editor.chain().focus().insertContent([{ type: "toc", attrs: { title: "Inhalt", entries: tocEntries(editor) } }, { type: "paragraph" }]).run();
      // Page numbers shift once the table itself is laid out.
      setTimeout(() => updateTocs(editor), 300);
    } else if (!updateTocs(editor)) notify("Inhaltsverzeichnis ist aktuell");
  };

  // ------------------------------------------------------------ commands --

  const fitZoom = useCallback(
    (z: number | "width" | "page") => {
      const c = canvas.current;
      if (z === "width" && c) setZoom(Math.max(0.2, Math.min(5, (c.clientWidth - 48) / mmToPx(page.widthMm))));
      else if (z === "page" && c) setZoom(Math.max(0.2, Math.min(5, (c.clientHeight - 48) / mmToPx(page.heightMm))));
      else if (typeof z === "number") setZoom(Math.round(z * 100) / 100);
    },
    [page],
  );

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new window.Image();
      img.onload = () => {
        const max = mmToPx(page.widthMm - page.marginLeftMm - page.marginRightMm);
        const scale = Math.min(1, max / img.naturalWidth);
        editor?.chain().focus().setImage({ src, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) }).run();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
      } else if (k === "o") {
        e.preventDefault();
        void open();
      } else if (k === "n") {
        e.preventDefault();
        void openDocumentWindow("text");
      } else if (k === "p") {
        e.preventDefault();
        print();
      } else if (k === "f" || k === "h") {
        e.preventDefault();
        setFind({ replace: k === "h" });
      } else if (k === "k") {
        e.preventDefault();
        setDialog("link");
      } else if (e.key === ">" || (e.shiftKey && e.key === ".")) {
        e.preventDefault();
        const cur = parseFloat(editor?.getAttributes("textStyle").fontSize ?? "11") || 11;
        editor?.chain().focus().setFontSize(`${cur + 1}pt`).run();
      } else if (e.key === "<" || (e.shiftKey && e.key === ",")) {
        e.preventDefault();
        const cur = parseFloat(editor?.getAttributes("textStyle").fontSize ?? "11") || 11;
        editor?.chain().focus().setFontSize(`${Math.max(1, cur - 1)}pt`).run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, open, print, save, saveAs]);

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(5, Math.round((z - Math.sign(e.deltaY) * 0.1) * 100) / 100)));
  };

  if (!editor) return null;

  const pW = mmToPx(page.widthMm);
  const pH = mmToPx(page.heightMm);
  const mt = mmToPx(page.marginTopMm);
  const mb = mmToPx(page.marginBottomMm);
  const ml = mmToPx(page.marginLeftMm);
  const mr = mmToPx(page.marginRightMm);
  const firstHeader = hfDom(first.enabled ? first.header : header, 1, layout.pages)?.innerHTML;
  const lastFooter = hfDom(first.enabled && layout.pages === 1 ? first.footer : footer, layout.pages, layout.pages)?.innerHTML;
  // Footnotes are listed after the text and may need another sheet.
  const sheets = Math.max(layout.pages, Math.ceil((paperSize.h + GAP) / (pH + GAP)) || 1);
  const showComments = comments.length > 0;
  const para = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  const paraValues: ParagraphValues = {
    indent: Number(para.indent) || 0,
    firstLine: Number(para.firstLine) || 0,
    spaceBefore: para.spaceBefore ?? 0,
    spaceAfter: para.spaceAfter ?? 8,
    lineHeight: parseFloat(para.lineHeight) || 1.15,
  };
  const docStyle = {
    "--nx-doc-font": meta.font ? `"${meta.font}", Calibri, Carlito, sans-serif` : undefined,
    "--nx-doc-size": meta.size ? `${meta.size}pt` : undefined,
  } as React.CSSProperties;

  return (
    <div className={s.root}>
      <SuiteHeader appName="Text" logo="/text.svg" center={`${withoutExt(name)}${dirty ? " •" : ""}${path ? "" : " – nicht gespeichert"}`} />
      <TextRibbon
        editor={editor}
        color={COLOR}
        page={page}
        zoom={zoom}
        onFile={() => setBackstage("open")}
        onLink={() => setDialog("link")}
        onImage={() => imageInput.current?.click()}
        onPageSetup={() => setDialog("page")}
        onPageChange={(p) => (setPage(p), setDirty(true))}
        onHeaderFooter={() => setDialog("hf")}
        onParagraph={() => setDialog("paragraph")}
        onFind={(replace) => setFind({ replace })}
        onZoom={fitZoom}
        onToc={tocAction}
        onFootnote={(endnote) => setFootnoteEdit({ pos: null, text: "", endnote })}
        onSectionBreak={() => editor.chain().focus().setSectionBreak(page).run()}
        onComment={commentAction}
        onTrack={trackAction}
        onUserName={() => setDialog("name")}
        hasComments={comments.length > 0}
      />
      <div className={s.work}>
        {find && editor && <FindBar editor={editor} replace={find.replace} onClose={() => (setFind(null), setSearch(editor, "", false), editor.commands.focus())} />}
        {loading && (
          <div className={s.loading}>
            <Spinner label="Dokument wird geöffnet…" />
          </div>
        )}
        <div className="nx-canvas" ref={canvas} onWheel={onWheel} onMouseDown={(e) => e.target === canvas.current && editor.commands.focus("end")}>
          <div style={{ width: ((paperSize.w || pW) + (showComments ? PANE_W : 0)) * zoom, height: (paperSize.h || pH) * zoom, margin: "24px auto", paddingBottom: 24 }}>
            <div className="nx-zoom" style={{ transform: `scale(${zoom})`, width: pW + (showComments ? PANE_W : 0), display: "flex", alignItems: "flex-start" }}>
              <div ref={paper} className="nx-paper" style={{ ...docStyle, width: pW, flexShrink: 0, minHeight: sheets * (pH + GAP) - GAP, padding: `${mt}px ${mr}px ${mb}px ${ml}px` }}>
                {Array.from({ length: sheets }, (_, i) => (
                  <div key={i} className="nx-sheet" style={{ top: i * (pH + GAP), height: pH }} />
                ))}
                {firstHeader && <div className="nx-hf-fixed" style={{ top: 0, height: mt, padding: `${mmToPx(page.headerMm)}px ${mr}px 0 ${ml}px` }} dangerouslySetInnerHTML={{ __html: firstHeader }} />}
                <EditorContent editor={editor} className="tiptap-wrap" style={{ minHeight: layout.minHeight || pH - mt - mb }} />
                <FootnoteList editor={editor} />
                {lastFooter && (
                  <div className="nx-hf-fixed" style={{ bottom: 0, height: mb, justifyContent: "flex-end", padding: `0 ${mr}px ${mmToPx(page.footerMm)}px ${ml}px` }} dangerouslySetInnerHTML={{ __html: lastFooter }} />
                )}
              </div>
              {showComments && (
                <CommentsPane
                  editor={editor}
                  paper={paper}
                  zoom={zoom}
                  comments={comments}
                  focus={focusComment}
                  onFocused={() => setFocusComment(null)}
                  onChange={(id, text) => (setComments((c) => c.map((x) => (x.id === id ? { ...x, text } : x))), setDirty(true))}
                  onDelete={deleteComment}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <StatusBar>
        <span>
          Seite {Math.min(currentPage, layout.pages)} von {layout.pages}
        </span>
        <span>{words.toLocaleString("de-DE")} Wörter</span>
        <span>Deutsch (Deutschland)</span>
        {warnings.length > 0 && (
          <Button size="small" appearance="transparent" onClick={() => setBackstage("info")} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>
            ⚠ Kompatibilitätshinweise
          </Button>
        )}
        <span className={s.zoom}>
          <Button size="small" appearance="transparent" style={{ minWidth: 20, padding: 0 }} onClick={() => fitZoom(Math.max(0.2, zoom - 0.1))}>
            −
          </Button>
          <Slider size="small" min={20} max={300} value={Math.round(zoom * 100)} onChange={(_, d) => setZoom(d.value / 100)} style={{ width: 120, minWidth: 0 }} />
          <Button size="small" appearance="transparent" style={{ minWidth: 20, padding: 0 }} onClick={() => fitZoom(Math.min(5, zoom + 0.1))}>
            +
          </Button>
          <Button size="small" appearance="transparent" style={{ minWidth: 44, padding: 0, fontSize: 12 }} onClick={() => fitZoom(1)}>
            {Math.round(zoom * 100)} %
          </Button>
        </span>
      </StatusBar>

      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImage(f);
          e.target.value = "";
        }}
      />

      {backstage && (
        <Backstage
          app="text"
          color={COLOR}
          initialPage={backstage}
          onClose={() => setBackstage(null)}
          onNew={() => (setBackstage(null), void openDocumentWindow("text"))}
          onOpen={(p) => void open(p)}
          onSave={() => (setBackstage(null), void save())}
          onSaveAs={() => (setBackstage(null), void saveAs())}
          onPrint={print}
          onExportPdf={isTauri ? () => void exportPdf() : undefined}
          info={
            <DocumentInfo
              path={path}
              title={meta.title}
              author={meta.author}
              onChange={(title, author) => (setMeta({ ...meta, title, author }), setDirty(true))}
              warnings={warnings}
              stats={
                <Text>
                  {layout.pages} {layout.pages === 1 ? "Seite" : "Seiten"} · {words.toLocaleString("de-DE")} Wörter · {(editor.storage.characterCount?.characters?.() ?? 0).toLocaleString("de-DE")} Zeichen
                </Text>
              }
            />
          }
        />
      )}

      <PageSetupDialog open={dialog === "page"} page={page} onClose={() => setDialog(null)} onApply={(p) => (setPage(p), setDirty(true))} />
      <PageSetupDialog
        open={!!sectionEdit}
        page={sectionEdit?.page ?? page}
        onClose={() => setSectionEdit(null)}
        onApply={(p) => sectionEdit && editor.view.dispatch(editor.state.tr.setNodeMarkup(sectionEdit.pos, undefined, { page: p }))}
      />
      <HeaderFooterDialog
        open={dialog === "hf"}
        value={{ header, footer, differentFirst: first.enabled, headerFirst: first.header, footerFirst: first.footer } satisfies HeaderFooterValue}
        onClose={() => setDialog(null)}
        onApply={(v) => (setHeader(v.header), setFooter(v.footer), setFirst({ enabled: v.differentFirst, header: v.headerFirst, footer: v.footerFirst }), setDirty(true))}
      />
      <TextDialog
        open={dialog === "name"}
        title="Benutzername"
        label="Name für Kommentare und nachverfolgte Änderungen"
        initial={author === "Ich" ? "" : author}
        onClose={() => setDialog(null)}
        onApply={(v) => {
          setUserName(v.trim());
          try {
            localStorage.setItem("nexora.userName", v.trim());
          } catch {
            /* ignore */
          }
        }}
      />
      <TextDialog
        open={!!footnoteEdit}
        title={`${footnoteEdit?.endnote ? "Endnote" : "Fußnote"} ${footnoteEdit?.pos == null ? "einfügen" : "bearbeiten"}`}
        label={footnoteEdit?.endnote ? "Text der Endnote" : "Text der Fußnote"}
        multiline
        initial={footnoteEdit?.text ?? ""}
        onClose={() => setFootnoteEdit(null)}
        onApply={(text) => {
          const fe = footnoteEdit;
          if (!fe || !text.trim()) return;
          if (fe.pos == null) editor.chain().focus().insertContent({ type: "footnote", attrs: { text: text.trim(), endnote: fe.endnote } }).run();
          else editor.view.dispatch(editor.state.tr.setNodeMarkup(fe.pos, undefined, { text: text.trim(), endnote: fe.endnote }));
        }}
      />
      <LinkDialog
        open={dialog === "link"}
        initial={editor.getAttributes("link").href ?? ""}
        onClose={() => setDialog(null)}
        onApply={(href) => {
          const c = editor.chain().focus().extendMarkRange("link");
          if (!href) c.unsetLink().run();
          else if (editor.state.selection.empty && !editor.isActive("link")) c.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
          else c.setLink({ href }).run();
        }}
      />
      <ParagraphDialog
        open={dialog === "paragraph"}
        initial={paraValues}
        onClose={() => setDialog(null)}
        onApply={(v) =>
          editor
            .chain()
            .focus()
            .setParagraphSpacing({
              indent: v.indent || null,
              firstLine: v.firstLine || null,
              spaceBefore: v.spaceBefore || null,
              spaceAfter: v.spaceAfter === 8 ? null : v.spaceAfter,
              lineHeight: Math.abs(v.lineHeight - 1.15) < 0.01 ? null : String(v.lineHeight),
            })
            .run()
        }
      />
      {unsaved.dialog}
      {printing != null &&
        createPortal(
          <div className="nx-print-root">
            <div className="nx-paper" style={docStyle}>
              <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: printing }} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function FindBar({ editor, replace, onClose }: { editor: import("@tiptap/react").Editor; replace: boolean; onClose: () => void }) {
  const s = useStyles();
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    return from !== to && to - from < 100 ? editor.state.doc.textBetween(from, to) : "";
  });
  const [caseSensitive, setCase] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(replace);
  const st = useEditorState({ editor, selector: ({ editor: e }) => { const x = searchState(e); return { n: x?.matches.length ?? 0, i: x?.index ?? 0 }; } })!;
  const notify = useNotify();
  useEffect(() => setShowReplace(replace), [replace]);
  useEffect(() => setSearch(editor, query, caseSensitive), [editor, query, caseSensitive]);
  return (
    <div className={s.find} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className={s.findRow}>
        <Input
          autoFocus
          size="small"
          style={{ flex: 1 }}
          placeholder="Im Dokument suchen"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          onKeyDown={(e) => e.key === "Enter" && stepSearch(editor, e.shiftKey ? -1 : 1)}
          contentAfter={<Text size={200} style={{ whiteSpace: "nowrap" }}>{query ? (st.n ? `${st.i + 1}/${st.n}` : "0/0") : ""}</Text>}
        />
        <Button size="small" appearance="subtle" icon={<ArrowUp16Regular />} aria-label="Vorheriges" onClick={() => stepSearch(editor, -1)} />
        <Button size="small" appearance="subtle" icon={<ArrowDown16Regular />} aria-label="Nächstes" onClick={() => stepSearch(editor, 1)} />
        <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label="Schließen" onClick={onClose} />
      </div>
      {showReplace && (
        <div className={s.findRow}>
          <Input size="small" style={{ flex: 1 }} placeholder="Ersetzen durch" value={replacement} onChange={(_, d) => setReplacement(d.value)} onKeyDown={(e) => e.key === "Enter" && replaceCurrent(editor, replacement)} />
          <Button size="small" onClick={() => replaceCurrent(editor, replacement)} disabled={!st.n}>
            Ersetzen
          </Button>
          <Button size="small" onClick={() => notify(`${replaceAll(editor, replacement)} Ersetzungen`)} disabled={!st.n}>
            Alle
          </Button>
        </div>
      )}
      <div className={s.findRow}>
        <Checkbox size="medium" checked={caseSensitive} onChange={(_, d) => setCase(!!d.checked)} label="Groß-/Kleinschreibung" />
        {!showReplace && (
          <Button size="small" appearance="transparent" style={{ marginLeft: "auto" }} onClick={() => setShowReplace(true)}>
            Ersetzen…
          </Button>
        )}
      </div>
    </div>
  );
}
