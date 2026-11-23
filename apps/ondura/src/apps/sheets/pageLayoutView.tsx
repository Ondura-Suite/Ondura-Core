// Seitenlayout view: the sheet as printed pages (paper, margins, header and
// footer, title rows/columns, breaks and scaling) in which cells can be
// selected and edited, like Excel's Page Layout view.

import { type Book, type CalcResult, type CellStyle, DEFAULT_COL, DEFAULT_ROW, key } from "./model";
import { type Scalar, colName } from "./formula";
import { formatValue } from "./format";
import { type CondCell, condFormatting } from "./features";
import { tableAt, tableLook } from "./tables";
import { type HfContext, pageOf, pageText, paperMm, printPages, splitSections } from "./pageLayout";
import { tl } from "../../lib/i18n";
import { ChartView } from "../chart/ChartView";
import { resolveChart } from "./features";
import { ShapeBody } from "./sheetExtras";
import type { SheetObject } from "./model";

const CM = 96 / 2.54;
const MM = 96 / 25.4;

/** One cell as printed: format of the cell, value as displayed. */
export function PrintCell({
  book,
  vals,
  si,
  r,
  c,
  colW,
  rowH,
  cond,
  active,
  onMouseDown,
  onDoubleClick,
}: {
  book: Book;
  vals: Map<number, Scalar> | undefined;
  si: number;
  r: number;
  c: number;
  colW: (c: number) => number;
  rowH: (r: number) => number;
  cond?: Map<number, CondCell>;
  active?: boolean;
  onMouseDown?: () => void;
  onDoubleClick?: () => void;
}) {
  const sh = book.sheets[si];
  const cell = sh.cells.get(key(r, c));
  const cf = cond?.get(key(r, c));
  // As on screen: table format below the cell's own format, conditional
  // formats on top.
  const tbl = sh.tables.length ? tableAt(sh, r, c) : undefined;
  const look = tbl ? tableLook(tbl, r, c) : undefined;
  const own = Object.fromEntries(Object.entries(book.styles[cell?.s ?? 0] ?? {}).filter(([, v]) => v !== undefined));
  const st = { ...(look?.fill ? { fill: look.fill } : {}), ...(look?.color ? { color: look.color } : {}), ...(look?.bold ? { bold: true } : {}), ...own, ...(cf?.style ?? {}), ...(cf?.fill ? { fill: cf.fill } : {}) } as CellStyle;
  const v = cell ? (cell.f ? (vals?.get(key(r, c)) ?? null) : cell.e ? { error: cell.e } : (cell.v ?? null)) : (vals?.get(key(r, c)) ?? null);
  const f = formatValue(v as Scalar, st.numFmt);
  return (
    <td
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{
        fontWeight: st.bold ? 700 : undefined,
        fontStyle: st.italic ? "italic" : undefined,
        textDecoration: st.underline ? "underline" : undefined,
        fontFamily: st.font ? `"${st.font}", Calibri, Carlito, sans-serif` : undefined,
        fontSize: st.size10 ? `${st.size10 / 10}pt` : undefined,
        color: f.color ?? st.color,
        background: cf?.bar ? `linear-gradient(90deg, transparent ${cf.bar.start * 100}%, ${cf.bar.color}99 ${cf.bar.start * 100}%, ${cf.bar.color}33 ${cf.bar.end * 100}%, transparent ${cf.bar.end * 100}%)${st.fill ? `, ${st.fill}` : ""}` : st.fill,
        textAlign: (st.hAlign as React.CSSProperties["textAlign"]) ?? (f.numeric ? "right" : "left"),
        verticalAlign: st.vAlign === "top" ? "top" : st.vAlign === "middle" ? "middle" : "bottom",
        width: colW(c) * 0.75 + "pt",
        maxWidth: colW(c) * 0.75 + "pt",
        height: rowH(r) * 0.75 + "pt",
        // Like on screen, text runs into empty neighbours.
        overflow: st.wrap || f.numeric ? "hidden" : "visible",
        borderTop: st.borderTop ? "1px solid #000" : look?.top,
        borderBottom: st.borderBottom ? (st.borderBottom === "double" ? "3px double #000" : "1px solid #000") : look?.bottom,
        borderLeft: st.borderLeft ? "1px solid #000" : undefined,
        borderRight: st.borderRight ? "1px solid #000" : undefined,
        whiteSpace: st.wrap ? "pre-wrap" : "nowrap",
        outline: active ? "2px solid #107c41" : undefined,
        outlineOffset: -1,
        position: active ? "relative" : undefined,
        zIndex: active ? 1 : undefined,
      }}
    >
      {f.text}
    </td>
  );
}

export function PageLayoutView({
  book,
  values,
  si,
  zoom,
  ctx,
  active,
  onSelect,
  onEdit,
  onHeaderFooter,
}: {
  book: Book;
  values: CalcResult;
  si: number;
  zoom: number;
  ctx: HfContext;
  active: { r: number; c: number };
  onSelect: (r: number, c: number) => void;
  onEdit: (r: number, c: number) => void;
  onHeaderFooter: () => void;
}) {
  const sh = book.sheets[si];
  const pg = pageOf(sh);
  const colW = (c: number) => sh.cols.get(c) ?? DEFAULT_COL;
  const rowH = (r: number) => sh.rows.get(r) ?? DEFAULT_ROW;
  const { pages, scale, titleRows, titleCols } = printPages(sh, colW, rowH);
  const [wMm, hMm] = paperMm(pg);
  const vals = values[si];
  const cond = condFormatting(book, values, si);
  const hf = (code: string | undefined, page: number, top: boolean) => {
    const parts = splitSections(code);
    return (
      <div
        className="nx-pl-hf"
        title={tl("Klicken, um Kopf- und Fußzeile zu bearbeiten")}
        onMouseDown={(e) => (e.stopPropagation(), onHeaderFooter())}
        style={top ? { top: pg.marginHeader * CM, left: pg.marginLeft * CM, right: pg.marginRight * CM } : { bottom: pg.marginFooter * CM, left: pg.marginLeft * CM, right: pg.marginRight * CM }}
      >
        {parts.map((t, i) => (
          <span key={i} style={{ textAlign: (["left", "center", "right"] as const)[i] }}>
            {t ? pageText(t, ctx, page, pages.length) : " "}
          </span>
        ))}
      </div>
    );
  };
  const list = pages.length ? pages : [{ rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], cols: [0, 1, 2, 3, 4, 5] }];
  return (
    <div className="nx-pl-view">
      <div style={{ zoom }}>
        {list.map((page, i) => {
          const rows = [...titleRows.filter((r) => r < page.rows[0]), ...page.rows];
          const cols = [...titleCols.filter((c) => c < page.cols[0]), ...page.cols];
          return (
            <div key={i} className="nx-pl-page" style={{ width: wMm * MM, height: hMm * MM }}>
              {hf(pg.header, i + 1, true)}
              <div
                className={`nx-pl-body${pg.gridlines ? " nx-pl-grid" : ""}`}
                style={{
                  position: "absolute",
                  top: pg.marginTop * CM,
                  left: pg.marginLeft * CM,
                  right: pg.marginRight * CM,
                  bottom: pg.marginBottom * CM,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: pg.centerH ? "center" : "flex-start",
                  justifyContent: pg.centerV ? "center" : "flex-start",
                }}
              >
                <div style={{ position: "relative", zoom: scale }}>
                  <table style={{ tableLayout: "fixed", borderCollapse: "collapse", font: "11pt Calibri, Carlito, sans-serif" }}>
                    <tbody>
                      {pg.headings && (
                        <tr className="nx-pl-head">
                          <td />
                          {cols.map((c) => (
                            <td key={c}>{colName(c)}</td>
                          ))}
                        </tr>
                      )}
                      {rows.map((r) => (
                        <tr key={r}>
                          {pg.headings && <td className="nx-pl-head">{r + 1}</td>}
                          {cols.map((c) => (
                            <PrintCell key={c} book={book} vals={vals} si={si} r={r} c={c} colW={colW} rowH={rowH} cond={cond} active={active.r === r && active.c === c} onMouseDown={() => onSelect(r, c)} onDoubleClick={() => onEdit(r, c)} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <PageObjects book={book} values={values} si={si} cols={cols} rows={rows} colW={colW} rowH={rowH} headings={pg.headings} />
                </div>
              </div>
              {hf(pg.footer, i + 1, false)}
              <span className="nx-pl-num">{tl("Seite {0} von {1}", i + 1, list.length)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Charts, pictures and shapes on a printed page, positioned over its table
 *  (`cols`/`rows` as printed; `headings` adds the row/column header). */
export function PageObjects({ book, values, si, cols, rows, colW, rowH, headings }: { book: Book; values: CalcResult; si: number; cols: number[]; rows: number[]; colW: (c: number) => number; rowH: (r: number) => number; headings: boolean }) {
  const sh = book.sheets[si];
  const x0 = headings ? 40 : 0;
  const y0 = headings ? 20 : 0;
  const xOf = (c: number) => {
    const i = cols.indexOf(c);
    return i < 0 ? null : x0 + cols.slice(0, i).reduce((n, k) => n + colW(k), 0);
  };
  const yOf = (r: number) => {
    const i = rows.indexOf(r);
    return i < 0 ? null : y0 + rows.slice(0, i).reduce((n, k) => n + rowH(k), 0);
  };
  const body = (o: SheetObject) =>
    o.type === "chart" && o.chart ? (
      <ChartView chart={resolveChart(book, values, si, o.chart)} width={Math.max(20, o.anchor.w)} height={Math.max(20, o.anchor.h)} />
    ) : o.type === "image" ? (
      <img src={o.src} alt={o.alt ?? o.name ?? ""} style={{ width: "100%", height: "100%", display: "block" }} />
    ) : o.shape ? (
      <ShapeBody shape={o.shape} z={1} />
    ) : null;
  return (
    <>
      {sh.objects.map((o) => {
        // An object belongs to the page that holds its top-left cell.
        const x = xOf(o.anchor.col);
        const y = yOf(o.anchor.row);
        if (x === null || y === null || o.type === "slicer") return null;
        return (
          <div key={o.id} style={{ position: "absolute", left: x + o.anchor.dx, top: y + o.anchor.dy, width: o.anchor.w, height: o.anchor.h, pointerEvents: "none" }}>
            {body(o)}
          </div>
        );
      })}
    </>
  );
}
