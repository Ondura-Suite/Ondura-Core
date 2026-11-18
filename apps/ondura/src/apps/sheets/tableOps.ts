// Operations on Excel tables: create, edit-driven growth, totals row,
// renaming and converting back to a plain range.

import { colName, mapTokens } from "./formula";
import { type Book, type Rect, type SCell, type SheetState, type TableDef, key, withSheet } from "./model";
import { cellText, columnNames, dataRows, filterRange, newTableName, renameColumnInFormula, resolveSpec, tableAt, totalsFormula } from "./tables";

const sameRect = (a: Rect | undefined, b: Rect) => !!a && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

/** Formats a range as a table; without headers a header row is added above. */
export function createTable(book: Book, si: number, rect: Rect, hasHeader: boolean, style: string): { book: Book; table: TableDef } | string {
  const sheet = book.sheets[si];
  if (sheet.tables.some((t) => !(rect.r2 < t.range.r1 || rect.r1 > t.range.r2 || rect.c2 < t.range.c1 || rect.c1 > t.range.c2))) return "Eine Tabelle kann keine andere Tabelle überlappen.";
  if (sheet.merges.some((m) => !(rect.r2 < m.r1 || rect.r1 > m.r2 || rect.c2 < m.c1 || rect.c1 > m.c2))) return "Verbundene Zellen können nicht Teil einer Tabelle sein.";
  let b = book;
  let range = rect;
  if (!hasHeader) {
    // A header row above the data: the cells move down by one row.
    if (rect.r1 === 0 || [...Array(rect.c2 - rect.c1 + 1)].some((_, i) => sheet.cells.get(key(rect.r1 - 1, rect.c1 + i))?.v !== undefined)) {
      b = withSheet(b, si, (s) => {
        const cells = new Map<number, SCell>();
        for (const [k, c] of s.cells) {
          const r = Math.floor(k / 16384);
          const col = k % 16384;
          const inside = col >= rect.c1 && col <= rect.c2 && r >= rect.r1;
          cells.set(inside ? key(r + 1, col) : k, c);
        }
        return { ...s, cells };
      });
      range = { ...rect, r2: rect.r2 + 1 };
    } else range = { ...rect, r1: rect.r1 - 1 };
  }
  const s = b.sheets[si];
  const names = columnNames([...Array(range.c2 - range.c1 + 1)].map((_, i) => (hasHeader ? cellText(s.cells.get(key(range.r1, range.c1 + i))) : "")));
  const table: TableDef = {
    name: newTableName(b.sheets),
    range,
    headerRow: true,
    totalsRow: false,
    style,
    bandedRows: true,
    bandedCols: false,
    firstCol: false,
    lastCol: false,
    filter: true,
    columns: names.map((name) => ({ name })),
  };
  b = withSheet(b, si, (sh) => {
    const cells = new Map(sh.cells);
    names.forEach((n, i) => cells.set(key(range.r1, range.c1 + i), { ...(cells.get(key(range.r1, range.c1 + i)) ?? {}), v: n, f: undefined }));
    // The table brings its own filter; a sheet filter on the same data moves into it.
    const takeOver = !!sh.autoFilter && sameRect(sh.autoFilter.range, filterRange(table));
    if (takeOver) table.filterColumns = sh.autoFilter!.columns;
    return { ...sh, cells, tables: [...sh.tables, table], autoFilter: takeOver ? undefined : sh.autoFilter };
  });
  return { book: b, table };
}

function updateTable(book: Book, si: number, name: string, f: (t: TableDef, s: SheetState) => { table: TableDef | null; cells?: Map<number, SCell> }): Book {
  return withSheet(book, si, (s) => {
    const t = s.tables.find((x) => x.name === name);
    if (!t) return s;
    const res = f(t, s);
    const tables = res.table ? s.tables.map((x) => (x === t ? res.table! : x)) : s.tables.filter((x) => x !== t);
    return { ...s, tables, cells: res.cells ?? s.cells };
  });
}

/** Rewrites formulas in all sheets. */
function mapFormulas(book: Book, f: (formula: string, si: number, r: number, c: number) => string): Book {
  let changed = false;
  const sheets = book.sheets.map((s, si) => {
    let cells: Map<number, SCell> | null = null;
    for (const [k, c] of s.cells) {
      if (!c.f) continue;
      const nf = f(c.f, si, Math.floor(k / 16384), k % 16384);
      if (nf !== c.f) (cells ??= new Map(s.cells)).set(k, { ...c, f: nf });
    }
    if (!cells) return s;
    changed = true;
    return { ...s, cells };
  });
  return changed ? { ...book, sheets } : book;
}

/** After a cell edit: header renames, growing the table and calculated columns. */
export function tableEdit(book: Book, si: number, r: number, c: number): Book {
  const sheet = book.sheets[si];
  if (!sheet.tables.length) return book;
  const cell = sheet.cells.get(key(r, c));
  const filled = !!cell && (cell.v !== undefined || !!cell.f);
  const t = tableAt(sheet, r, c);
  if (t && t.headerRow && r === t.range.r1) {
    // Header text = column name (unique; formulas follow the rename).
    const i = c - t.range.c1;
    const old = t.columns[i].name;
    const others = t.columns.map((x) => x.name).filter((_, j) => j !== i);
    const wanted = cellText(cell).trim() || `Spalte${i + 1}`;
    const name = columnNames([...others.slice(0, i), wanted, ...others.slice(i)])[i];
    let b = updateTable(book, si, t.name, (tt, s) => {
      const cells = new Map(s.cells);
      cells.set(key(r, c), { ...(cell ?? {}), v: name, f: undefined });
      return { table: { ...tt, columns: tt.columns.map((x, j) => (j === i ? { ...x, name } : x)) }, cells };
    });
    if (name !== old) b = mapFormulas(b, (f, fsi, fr, fc) => renameColumnInFormula(f, t.name, old, name, !!tableAt(b.sheets[fsi], fr, fc) && tableAt(b.sheets[fsi], fr, fc)!.name === t.name));
    return b;
  }
  if (t && cell?.f && r >= dataRows(t).r1 && r <= dataRows(t).r2) {
    // A formula in an otherwise empty column fills the whole column.
    const { r1, r2 } = dataRows(t);
    let empty = true;
    for (let y = r1; y <= r2 && empty; y++) if (y !== r && sheet.cells.get(key(y, c))?.v !== undefined) empty = false;
    for (let y = r1; y <= r2 && empty; y++) if (y !== r && sheet.cells.get(key(y, c))?.f) empty = false;
    if (empty && r2 > r1 && /\[@/.test(cell.f)) {
      const f = cell.f;
      return updateTable(book, si, t.name, (tt, s) => {
        const cells = new Map(s.cells);
        for (let y = r1; y <= r2; y++) cells.set(key(y, c), { ...(cells.get(key(y, c)) ?? {}), f, v: undefined });
        return { table: { ...tt, columns: tt.columns.map((x, j) => (j === c - tt.range.c1 ? { ...x, formula: f } : x)) }, cells };
      });
    }
    return book;
  }
  if (t || !filled) return book;
  // Typing right below a table adds a row; right of it, a column.
  const below = sheet.tables.find((x) => !x.totalsRow && r === x.range.r2 + 1 && c >= x.range.c1 && c <= x.range.c2);
  if (below)
    return updateTable(book, si, below.name, (tt, s) => {
      const cells = new Map(s.cells);
      tt.columns.forEach((col, j) => {
        const k = key(r, tt.range.c1 + j);
        if (col.formula && !cells.get(k)?.f && cells.get(k)?.v === undefined) cells.set(k, { ...(cells.get(k) ?? {}), f: col.formula });
      });
      return { table: { ...tt, range: { ...tt.range, r2: r } }, cells };
    });
  const right = sheet.tables.find((x) => c === x.range.c2 + 1 && r >= x.range.r1 && r <= x.range.r2 - (x.totalsRow ? 1 : 0));
  if (right)
    return updateTable(book, si, right.name, (tt, s) => {
      const cells = new Map(s.cells);
      const names = columnNames([...tt.columns.map((x) => x.name), r === tt.range.r1 ? cellText(cell) : ""]);
      const name = names[names.length - 1];
      if (tt.headerRow) cells.set(key(tt.range.r1, c), { ...(cells.get(key(tt.range.r1, c)) ?? {}), v: name, f: undefined });
      return { table: { ...tt, range: { ...tt.range, c2: c }, columns: [...tt.columns, { name }] }, cells };
    });
  return book;
}

/** Turns the totals row on or off. */
export function setTotalsRow(book: Book, si: number, name: string, on: boolean): Book {
  return updateTable(book, si, name, (t, s) => {
    if (t.totalsRow === on) return { table: t };
    const cells = new Map(s.cells);
    if (!on) {
      for (let c = t.range.c1; c <= t.range.c2; c++) cells.delete(key(t.range.r2, c));
      return { table: { ...t, totalsRow: false, range: { ...t.range, r2: t.range.r2 - 1 } }, cells };
    }
    const r = t.range.r2 + 1;
    const columns = t.columns.map((col, i) => ({ ...col, totalsLabel: i === 0 ? "Ergebnis" : undefined, totalsFunction: i === t.columns.length - 1 && t.columns.length > 1 ? "sum" : undefined }));
    const table = { ...t, totalsRow: true, range: { ...t.range, r2: r }, columns };
    columns.forEach((col, i) => {
      const k = key(r, t.range.c1 + i);
      if (col.totalsLabel) cells.set(k, { ...(cells.get(k) ?? {}), v: col.totalsLabel, f: undefined });
      else if (col.totalsFunction) cells.set(k, { ...(cells.get(k) ?? {}), f: totalsFormula(table, col.name, col.totalsFunction) ?? undefined, v: undefined });
    });
    return { table, cells };
  });
}

/** Function of a totals row cell (from its dropdown). */
export function setTotalsFunction(book: Book, si: number, name: string, col: number, fn: string): Book {
  return updateTable(book, si, name, (t, s) => {
    const cells = new Map(s.cells);
    const column = t.columns[col];
    const k = key(t.range.r2, t.range.c1 + col);
    const f = totalsFormula(t, column.name, fn);
    if (f) cells.set(k, { ...(cells.get(k) ?? {}), f, v: undefined });
    else cells.delete(k);
    return { table: { ...t, columns: t.columns.map((x, i) => (i === col ? { ...x, totalsFunction: fn === "none" ? undefined : fn, totalsLabel: undefined } : x)) }, cells };
  });
}

export function setTableOption(book: Book, si: number, name: string, patch: Partial<Pick<TableDef, "bandedRows" | "bandedCols" | "firstCol" | "lastCol" | "filter" | "style" | "filterColumns">>): Book {
  return updateTable(book, si, name, (t) => ({ table: { ...t, ...patch, ...(patch.filter === false ? { filterColumns: [] } : {}) } }));
}

/** Renames a table (formulas follow). Returns an error text or the new book. */
export function renameTable(book: Book, si: number, from: string, to: string): Book | string {
  const name = to.trim();
  if (!/^[A-Za-zÄÖÜäöüß_\\][\wÄÖÜäöüß.]*$/.test(name) || /^[A-Za-z]{1,3}\d+$/.test(name) || /^[RC]$/i.test(name)) return "Der Name ist ungültig (Buchstabe am Anfang, keine Leerzeichen, kein Zellbezug).";
  if (book.sheets.some((s) => s.tables.some((t) => t.name.toLowerCase() === name.toLowerCase() && t.name !== from)) || book.names.some((n) => n.name.toLowerCase() === name.toLowerCase())) return "Der Name wird bereits verwendet.";
  const b = updateTable(book, si, from, (t) => ({ table: { ...t, name } }));
  return mapFormulas(b, (f) => mapTokens(f, (t) => (t.t === "sref" && t.table.toLowerCase() === from.toLowerCase() ? { ...t, table: name } : t.t === "ident" && t.v.toLowerCase() === from.toLowerCase() ? { ...t, v: name } : t)));
}

/** New size of a table (same header row). */
export function resizeTable(book: Book, si: number, name: string, range: Rect): Book | string {
  const t = book.sheets[si].tables.find((x) => x.name === name);
  if (!t) return book;
  if (range.r1 !== t.range.r1) return "Die Kopfzeile muss in derselben Zeile bleiben.";
  if (book.sheets[si].tables.some((x) => x !== t && !(range.r2 < x.range.r1 || range.r1 > x.range.r2 || range.c2 < x.range.c1 || range.c1 > x.range.c2))) return "Eine Tabelle kann keine andere Tabelle überlappen.";
  return updateTable(book, si, name, (tt, s) => {
    const cells = new Map(s.cells);
    const texts = [...Array(range.c2 - range.c1 + 1)].map((_, i) => cellText(cells.get(key(range.r1, range.c1 + i))));
    const names = columnNames(texts);
    names.forEach((n, i) => cells.set(key(range.r1, range.c1 + i), { ...(cells.get(key(range.r1, range.c1 + i)) ?? {}), v: n, f: undefined }));
    const columns = names.map((n) => tt.columns.find((x) => x.name === n) ?? { name: n });
    return { table: { ...tt, range, columns }, cells };
  });
}

/** Converts a table back to a range: structured references become A1 references. */
export function convertToRange(book: Book, si: number, name: string): Book {
  const t = book.sheets[si].tables.find((x) => x.name === name);
  if (!t) return book;
  const info = { sheet: si, range: t.range, headerRow: t.headerRow, totalsRow: t.totalsRow, columns: t.columns.map((c) => c.name) };
  const sheetName = book.sheets[si].name;
  const quoted = /^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const b = mapFormulas(book, (f, fsi, r, c) =>
    mapTokens(f, (tok) => {
      const own = tableAt(book.sheets[fsi], r, c)?.name === name;
      const hit = tok.t === "sref" && (tok.table ? tok.table.toLowerCase() === name.toLowerCase() : own && fsi === si);
      const whole = tok.t === "ident" && tok.v.toLowerCase() === name.toLowerCase();
      if (!hit && !whole) return tok;
      const rect = resolveSpec(info, tok.t === "sref" ? tok.spec : "", r);
      if (!rect) return { t: "raw", v: "#REF!" };
      const a = `$${colName(rect.c1)}$${rect.r1 + 1}`;
      const z = `$${colName(rect.c2)}$${rect.r2 + 1}`;
      const prefix = fsi === si ? "" : `${quoted}!`;
      return { t: "raw", v: prefix + (a === z ? a : `${a}:${z}`) };
    }),
  );
  return updateTable(b, si, name, () => ({ table: null }));
}
