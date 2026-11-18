import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { Button, Checkbox, Input, Slider, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDown16Regular, ArrowUp16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { SuiteHeader } from "../../shell/SuiteHeader";
import { Backstage, DocumentInfo, StatusBar, useUnsavedPrompt } from "../../shell/office";
import { useNotify } from "../../shell/notify";
import { splashDone } from "../../shell/splash";
import { errorMessage, isTauri } from "../../lib/api";
import { addRecent, baseName, guardClose, initialFile, officeInvoke, openDocumentWindow, pickOpenPath, pickSavePath, setWindowTitle, withoutExt } from "../../lib/office";
import { textExtensions, replaceAll, replaceCurrent, searchState, setSearch, stepSearch } from "./extensions";
import { refreshPagination, type PageGeometry } from "./pagination";
import { TextRibbon } from "./TextRibbon";
import { HeaderFooterDialog, LinkDialog, PageSetupDialog, ParagraphDialog, type ParagraphValues } from "./dialogs";
import { type Block, type PageSetup, type Paragraph, type TextDocument, documentToPm, emptyDocument, mmToPx, pmBlocks } from "./model";
import { sampleDocument } from "./sample";
import "./text.css";

const COLOR = "#2b5bd7";
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
  const [meta, setMeta] = useState({ title: initial.title, author: initial.author, font: initial.defaultFont ?? null, size: initial.defaultSize ?? null });
  const [layout, setLayout] = useState({ pages: 1, minHeight: 0 });
  const [zoom, setZoom] = useState(1);
  const [backstage, setBackstage] = useState<null | "open" | "info">(null);
  const [dialog, setDialog] = useState<null | "page" | "hf" | "link" | "paragraph">(null);
  const [find, setFind] = useState<null | { replace: boolean }>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const pageRef = useRef(page);
  const hfRef = useRef({ header, footer });
  pageRef.current = page;
  hfRef.current = { header, footer };
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
          const el = hfDom(hfRef.current.header, pg, n);
          if (el) el.style.paddingTop = `${mmToPx(pageRef.current.headerMm)}px`;
          return el;
        },
        renderFooter: (pg, n) => {
          const el = hfDom(hfRef.current.footer, pg, n);
          if (el) {
            el.style.marginTop = "auto";
            el.style.paddingBottom = `${mmToPx(pageRef.current.footerMm)}px`;
          }
          return el;
        },
        onLayout: (l) => setLayout({ pages: l.pages, minHeight: l.minHeight }),
      },
    }),
    content: documentToPm(initial),
    editorProps: { attributes: { spellcheck: "true", lang: "de" } },
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
  }, [editor, page, header, footer]);

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
    };
  }, [editor, page, header, footer, meta]);

  const apply = useCallback(
    (doc: TextDocument) => {
      if (!editor) return;
      setPage(doc.page);
      setHeader(doc.header ?? []);
      setFooter(doc.footer ?? []);
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

  const print = useCallback(() => {
    if (!editor) return;
    setBackstage(null);
    setPrinting(editor.getHTML());
  }, [editor]);

  useEffect(() => {
    if (printing == null) return;
    const p = page;
    const h = hfCss(header);
    const f = hfCss(footer);
    const box = (where: "top" | "bottom", v: { content: string; align: string } | null) =>
      v ? `@${where}-${v.align === "center" ? "center" : v.align === "right" ? "right" : "left"} { content: ${v.content}; white-space: pre; font: 9pt Calibri, Carlito, sans-serif; color: #555; vertical-align: ${where === "top" ? "bottom" : "top"}; }` : "";
    const style = document.createElement("style");
    style.textContent = `@page { size: ${p.widthMm}mm ${p.heightMm}mm; margin: ${p.marginTopMm}mm ${p.marginRightMm}mm ${p.marginBottomMm}mm ${p.marginLeftMm}mm; ${box("top", h)} ${box("bottom", f)} }`;
    document.head.appendChild(style);
    const t = setTimeout(() => {
      window.print();
      style.remove();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(t);
  }, [printing, page, header, footer]);

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
  const firstHeader = hfDom(header, 1, layout.pages)?.innerHTML;
  const lastFooter = hfDom(footer, layout.pages, layout.pages)?.innerHTML;
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
      />
      <div className={s.work}>
        {find && editor && <FindBar editor={editor} replace={find.replace} onClose={() => (setFind(null), setSearch(editor, "", false), editor.commands.focus())} />}
        {loading && (
          <div className={s.loading}>
            <Spinner label="Dokument wird geöffnet…" />
          </div>
        )}
        <div className="nx-canvas" ref={canvas} onWheel={onWheel} onMouseDown={(e) => e.target === canvas.current && editor.commands.focus("end")}>
          <div style={{ width: paperSize.w * zoom || pW * zoom, height: paperSize.h * zoom || pH * zoom, margin: "24px auto", paddingBottom: 24 }}>
            <div className="nx-zoom" style={{ transform: `scale(${zoom})`, width: pW }}>
              <div ref={paper} className="nx-paper" style={{ ...docStyle, width: pW, minHeight: pH, padding: `${mt}px ${mr}px ${mb}px ${ml}px` }}>
                {Array.from({ length: layout.pages }, (_, i) => (
                  <div key={i} className="nx-sheet" style={{ top: i * (pH + GAP), height: pH }} />
                ))}
                {firstHeader && <div className="nx-hf-fixed" style={{ top: 0, height: mt, padding: `${mmToPx(page.headerMm)}px ${mr}px 0 ${ml}px` }} dangerouslySetInnerHTML={{ __html: firstHeader }} />}
                <EditorContent editor={editor} className="tiptap-wrap" style={{ minHeight: layout.minHeight || pH - mt - mb }} />
                {lastFooter && (
                  <div className="nx-hf-fixed" style={{ bottom: 0, height: mb, justifyContent: "flex-end", padding: `0 ${mr}px ${mmToPx(page.footerMm)}px ${ml}px` }} dangerouslySetInnerHTML={{ __html: lastFooter }} />
                )}
              </div>
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
      <HeaderFooterDialog open={dialog === "hf"} header={header} footer={footer} onClose={() => setDialog(null)} onApply={(h, f) => (setHeader(h), setFooter(f), setDirty(true))} />
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
