//! SpreadsheetML (.xlsx) ⇄ [`Workbook`] for Ondura Tabellen.
//!
//! Formulas are kept as text (English function names, as stored in the
//! file); the app evaluates them and passes the computed values back for
//! the cached `<v>` elements when saving.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::chart::{self, Chart};
use crate::chartex;
use crate::package::{self, Package, PackageWriter};
use crate::page::PageSetup;
use crate::structured;
use crate::xlfn;
use crate::xml::{Element, esc};
use crate::{Error, Result};

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    /// Workbook structure protected (sheets cannot be added, moved, …).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub protect_structure: bool,
    pub sheets: Vec<Sheet>,
    /// Shared cell formats; `Cell::s` indexes into this list. Index 0 is
    /// the default format.
    #[serde(default)]
    pub styles: Vec<CellStyle>,
    #[serde(default)]
    pub active: usize,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    /// Defined names (named ranges and constants).
    #[serde(default)]
    pub names: Vec<DefinedName>,
}

impl Default for Workbook {
    fn default() -> Self {
        Self {
            protect_structure: false,
            sheets: vec![Sheet::new("Tabelle1")],
            styles: vec![CellStyle::default()],
            active: 0,
            title: String::new(),
            author: String::new(),
            names: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefinedName {
    pub name: String,
    /// What the name refers to, as a formula without `=` (e.g. `Tabelle1!$A$1:$B$5`).
    pub formula: String,
    /// Sheet index for sheet-scoped names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<usize>,
    /// Hidden names (e.g. the solver model `solver_*`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoFilter {
    /// Filtered range including the header row, e.g. `A1:D20`.
    pub range: String,
    #[serde(default)]
    pub columns: Vec<FilterColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumn {
    /// Column offset inside the filter range.
    pub col: u32,
    /// Displayed values that are shown; `""` stands for blank cells.
    #[serde(default)]
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CondFormat {
    /// Space-separated ranges (`sqref`).
    pub range: String,
    #[serde(default)]
    pub rules: Vec<CondRule>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CondRule {
    /// `cellIs`, `expression`, `containsText`, `notContainsText`,
    /// `beginsWith`, `endsWith`, `containsBlanks`, `notContainsBlanks`,
    /// `duplicateValues`, `uniqueValues`, `top10`, `aboveAverage`,
    /// `colorScale` or `dataBar`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator: Option<String>,
    /// Formulas relative to the top-left cell of the first range.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub formulas: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<u32>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bottom: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub percent: bool,
    /// `aboveAverage` rule highlighting values below the average.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub below: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub stop: bool,
    /// Differential format (bold, italic, colours, borders).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<CellStyle>,
    /// Colour scale stops (2 or 3) or the data bar colour.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub colors: Vec<String>,
}

/// Position of a floating object: top-left cell plus offset, and size,
/// all in CSS pixels at 100 % zoom.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Anchor {
    pub col: u32,
    pub row: u32,
    pub dx: f64,
    pub dy: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetChart {
    #[serde(flatten)]
    pub chart: Chart,
    pub anchor: Anchor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetImage {
    /// `data:` URL.
    pub src: String,
    pub anchor: Anchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Alternative text for screen readers (`descr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub name: String,
    /// Cells by A1 reference.
    #[serde(default)]
    pub cells: BTreeMap<String, Cell>,
    /// Column widths in CSS pixels by 0-based column index.
    #[serde(default)]
    pub cols: BTreeMap<u32, f64>,
    /// Row heights in CSS pixels by 0-based row index.
    #[serde(default)]
    pub rows: BTreeMap<u32, f64>,
    #[serde(default)]
    pub hidden_cols: Vec<u32>,
    #[serde(default)]
    pub hidden_rows: Vec<u32>,
    /// Merged ranges, e.g. `A1:C1`.
    #[serde(default)]
    pub merges: Vec<String>,
    #[serde(default)]
    pub freeze_rows: u32,
    #[serde(default)]
    pub freeze_cols: u32,
    #[serde(default = "yes")]
    pub show_grid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter: Option<AutoFilter>,
    #[serde(default)]
    pub cond_formats: Vec<CondFormat>,
    #[serde(default)]
    pub charts: Vec<SheetChart>,
    #[serde(default)]
    pub images: Vec<SheetImage>,
    #[serde(default)]
    pub validations: Vec<Validation>,
    #[serde(default)]
    pub sparklines: Vec<Sparkline>,
    /// Excel tables ("intelligente Tabellen").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tables: Vec<SheetTable>,
    /// What-if scenarios (Szenario-Manager).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenarios: Vec<Scenario>,
    /// Cell notes (Notizen).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<Note>,
    /// Cell hyperlinks.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<Link>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protection: Option<Protection>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    /// Outline (grouping) levels of rows and columns.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub row_levels: BTreeMap<u32, u8>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub col_levels: BTreeMap<u32, u8>,
    /// Page layout; `None` = defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageSetup>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Note {
    pub cell: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Always shown (not only on hover).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub visible: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Link {
    pub cell: String,
    /// URL, `mailto:…` or a place in the workbook (`#Tabelle2!A1`).
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
}

/// Sheet protection ("Blatt schützen"); the password is only stored as a hash.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Protection {
    /// Legacy 16-bit Excel hash (hex), as written by Ondura.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Modern hash (Excel 2013+): algorithm, base64 hash and salt, spin count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algorithm: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spin_count: Option<u32>,
    /// Allowed although protected.
    pub format_cells: bool,
    pub insert_rows: bool,
    pub delete_rows: bool,
    pub sort: bool,
    pub auto_filter: bool,
    pub select_locked: bool,
    /// OpenDocument key: base64 digest of the password and its algorithm URI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odf_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odf_algorithm: Option<String>,
}

/// A named set of values for input cells.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Scenario {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Input cells (A1) and their values as text.
    pub cells: Vec<ScenarioCell>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ScenarioCell {
    pub cell: String,
    pub value: String,
}

/// An Excel table (ListObject): a named range with header, optional
/// totals row and a table style.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetTable {
    pub name: String,
    /// Whole table including header and totals rows, e.g. `A1:D20`.
    pub range: String,
    pub header_row: bool,
    pub totals_row: bool,
    /// `TableStyleMedium2` …
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    pub banded_rows: bool,
    pub banded_cols: bool,
    pub first_col: bool,
    pub last_col: bool,
    /// Filter buttons in the header row.
    pub filter: bool,
    /// Active filter criteria (columns relative to the table).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub filter_columns: Vec<FilterColumn>,
    pub columns: Vec<TableColumn>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TableColumn {
    pub name: String,
    /// sum, average, count, countNums, max, min, stdDev, var, custom
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_function: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_label: Option<String>,
    /// Formula of a calculated column (without "=").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
}

impl SheetTable {
    pub(crate) fn rect(&self) -> Option<(u32, u32, u32, u32)> {
        let (a, b) = self.range.split_once(':')?;
        let (r1, c1) = parse_ref(a)?;
        let (r2, c2) = parse_ref(b)?;
        Some((r1, c1, r2, c2))
    }
    pub(crate) fn contains(&self, r: u32, c: u32) -> bool {
        self.rect()
            .is_some_and(|(r1, c1, r2, c2)| r >= r1 && r <= r2 && c >= c1 && c <= c2)
    }
}

/// Comments part and VML drawing of a sheet's notes.
fn notes_xml(sheet: &Sheet, n: usize) -> (String, String) {
    let mut authors: Vec<String> = Vec::new();
    for note in &sheet.notes {
        let a = note.author.clone().unwrap_or_default();
        if !authors.contains(&a) {
            authors.push(a);
        }
    }
    let mut c = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>"#,
    );
    for a in &authors {
        c.push_str(&format!("<author>{}</author>", esc(a)));
    }
    c.push_str("</authors><commentList>");
    let mut v = format!(
        r#"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="{n}"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>"#
    );
    for (i, note) in sheet.notes.iter().enumerate() {
        let author = note.author.clone().unwrap_or_default();
        let aid = authors.iter().position(|a| *a == author).unwrap_or(0);
        c.push_str(&format!(
            r#"<comment ref="{}" authorId="{aid}"><text>"#,
            esc(&note.cell)
        ));
        if !author.is_empty() {
            c.push_str(&format!(r#"<r><rPr><b/><sz val="9"/><rFont val="Segoe UI"/></rPr><t xml:space="preserve">{}:</t></r><r><rPr><sz val="9"/><rFont val="Segoe UI"/></rPr><t xml:space="preserve">&#10;{}</t></r>"#, esc(&author), esc(&note.text)));
        } else {
            c.push_str(&format!(r#"<r><rPr><sz val="9"/><rFont val="Segoe UI"/></rPr><t xml:space="preserve">{}</t></r>"#, esc(&note.text)));
        }
        c.push_str("</text></comment>");
        let (r, col) = parse_ref(&note.cell).unwrap_or((0, 0));
        v.push_str(&format!(
            r##"<v:shape id="_x0000_s{}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:{};visibility:{}" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>{}, 15, {}, 2, {}, 15, {}, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>{r}</x:Row><x:Column>{col}</x:Column>{}</x:ClientData></v:shape>"##,
            n * 1024 + i + 1,
            i + 1,
            if note.visible { "visible" } else { "hidden" },
            col + 1,
            r.saturating_sub(1),
            col + 3,
            r + 3,
            if note.visible { "<x:Visible/>" } else { "" }
        ));
    }
    c.push_str("</commentList></comments>");
    v.push_str("</xml>");
    (c, v)
}

/// `C$5` (row fixed) or `$B6` (column fixed) for data table formulas.
fn cell_ref_rel(r: u32, c: u32, fix_row: bool) -> String {
    if fix_row {
        format!("{}${}", col_name(c), r + 1)
    } else {
        format!("${}{}", col_name(c), r + 1)
    }
}

/// Name of the table a cell belongs to.
pub(crate) fn table_at<'a>(tables: &'a [SheetTable], key: &str) -> Option<&'a str> {
    let (r, c) = parse_ref(key)?;
    tables
        .iter()
        .find(|t| t.contains(r, c))
        .map(|t| t.name.as_str())
}

/// Data validation of a range (`dataValidation`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Validation {
    /// Space-separated ranges.
    pub range: String,
    /// `list`, `whole`, `decimal`, `date`, `time`, `textLength` or `custom`.
    pub kind: String,
    /// `between`, `notBetween`, `equal`, `notEqual`, `greaterThan`,
    /// `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator: Option<String>,
    /// Formula 1 and 2 without `=` (a list is `"a,b,c"` or a reference).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub formulas: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub allow_blank: bool,
    /// List validation without the drop-down arrow.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hide_dropdown: bool,
    /// `stop` (default), `warning` or `information`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

/// A sparkline (Excel 2010 extension): a tiny chart of `source` in `cell`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Sparkline {
    pub cell: String,
    /// Data range, e.g. `Tabelle1!B2:G2`.
    pub source: String,
    /// `line`, `column` or `stacked` (win/loss).
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_color: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub markers: bool,
}

fn yes() -> bool {
    true
}

impl Sheet {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.into(),
            cells: BTreeMap::new(),
            cols: BTreeMap::new(),
            rows: BTreeMap::new(),
            hidden_cols: Vec::new(),
            hidden_rows: Vec::new(),
            merges: Vec::new(),
            freeze_rows: 0,
            freeze_cols: 0,
            show_grid: true,
            auto_filter: None,
            cond_formats: Vec::new(),
            charts: Vec::new(),
            images: Vec::new(),
            validations: Vec::new(),
            sparklines: Vec::new(),
            tables: Vec::new(),
            scenarios: Vec::new(),
            notes: Vec::new(),
            links: Vec::new(),
            protection: None,
            hidden: false,
            row_levels: BTreeMap::new(),
            col_levels: BTreeMap::new(),
            page: None,
        }
    }

    pub(crate) fn col_px(&self, c: u32) -> f64 {
        if self.hidden_cols.contains(&c) {
            0.0
        } else {
            self.cols.get(&c).copied().unwrap_or(64.0)
        }
    }

    pub(crate) fn row_px(&self, r: u32) -> f64 {
        if self.hidden_rows.contains(&r) {
            0.0
        } else {
            self.rows.get(&r).copied().unwrap_or(20.0)
        }
    }

    /// Distance in pixels from the start of `from` (plus `off`) to the
    /// start of `to` (plus `off2`) along columns or rows.
    fn span(&self, cols: bool, from: u32, off: f64, to: u32, off2: f64) -> f64 {
        let size = |i| if cols { self.col_px(i) } else { self.row_px(i) };
        let mut d = -off + off2;
        for i in from..to.min(from + 20000) {
            d += size(i);
        }
        d.max(1.0)
    }

    /// Cell and offset at a pixel distance from the start of `from`.
    pub(crate) fn walk(&self, cols: bool, from: u32, mut px: f64) -> (u32, f64) {
        let size = |i| if cols { self.col_px(i) } else { self.row_px(i) };
        let mut i = from;
        let limit = if cols { 16383 } else { 1_048_575 };
        while i < limit && px >= size(i) && (px > 0.0 || size(i) > 0.0) {
            px -= size(i);
            i += 1;
        }
        (i, px.max(0.0))
    }
}

const EMU_PER_PX: f64 = 9525.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Value {
    Bool(bool),
    Number(f64),
    Text(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<Value>,
    /// Formula without the leading `=`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    /// Error value such as `#DIV/0!`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub e: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub s: usize,
    /// Spill range of a dynamic array formula (`A1:B5`); the other cells of
    /// the range hold its results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spill: Option<String>,
}

fn is_zero(v: &usize) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", default)]
pub struct CellStyle {
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub strike: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Points ×10 (to keep the style hashable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size10: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// `left`, `center`, `right`, `justify`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h_align: Option<String>,
    /// `top`, `middle`, `bottom` (default).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v_align: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub wrap: bool,
    /// Excel number format code; `None` = General.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_fmt: Option<String>,
    /// Border style per side: `thin`, `medium`, `thick`, `double`, `dashed`, `dotted`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_top: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_bottom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_left: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_right: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<u32>,
    /// Cell protection: `Some(false)` = not locked (cells are locked by default).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    /// Formula hidden when the sheet is protected.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hide_formula: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub workbook: Workbook,
    pub warnings: Vec<String>,
}

// ------------------------------------------------------------ references --

/// 0-based column index → letters (`0` → `A`, `27` → `AB`).
pub fn col_name(mut c: u32) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (c % 26) as u8);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

/// `B3` → (row 2, col 1), both 0-based.
pub fn parse_ref(r: &str) -> Option<(u32, u32)> {
    let r = r.trim().trim_start_matches('$');
    let split = r.find(|c: char| c.is_ascii_digit() || c == '$')?;
    let (letters, digits) = r.split_at(split);
    if letters.is_empty() || !letters.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut col = 0u32;
    for ch in letters.chars() {
        col = col * 26 + (ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
    }
    let row: u32 = digits.trim_start_matches('$').parse().ok()?;
    (row >= 1).then(|| (row - 1, col - 1))
}

pub fn cell_ref(row: u32, col: u32) -> String {
    format!("{}{}", col_name(col), row + 1)
}

/// Move the relative references of a formula by (dr, dc) – used to expand
/// shared formulas. Absolute parts (`$A$1`) stay; text in quotes is untouched.
pub fn shift_formula(f: &str, dr: i64, dc: i64) -> String {
    let chars: Vec<char> = f.chars().collect();
    let mut out = String::with_capacity(f.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            // String literal ("" escapes a quote).
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == '"' {
                    if i + 1 < chars.len() && chars[i + 1] == '"' {
                        out.push('"');
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == '\'' {
            // Quoted sheet name.
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                i += 1;
                if chars[i - 1] == '\'' {
                    break;
                }
            }
            continue;
        }
        let prev_ident = i > 0
            && (chars[i - 1].is_ascii_alphanumeric() || chars[i - 1] == '_' || chars[i - 1] == '.');
        if !prev_ident && (c == '$' || c.is_ascii_alphabetic()) {
            // Try to read [$]LETTERS[$]DIGITS not followed by '(' or a letter.
            let start = i;
            let mut j = i;
            let col_abs = chars.get(j) == Some(&'$');
            if col_abs {
                j += 1;
            }
            let ls = j;
            while j < chars.len() && chars[j].is_ascii_alphabetic() {
                j += 1;
            }
            let letters: String = chars[ls..j].iter().collect();
            let row_abs = chars.get(j) == Some(&'$');
            if row_abs {
                j += 1;
            }
            let ds = j;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            let digits: String = chars[ds..j].iter().collect();
            let next_ok = j >= chars.len()
                || !(chars[j].is_ascii_alphanumeric() || chars[j] == '(' || chars[j] == '_');
            if !letters.is_empty()
                && letters.len() <= 3
                && !digits.is_empty()
                && next_ok
                && let Some((r, cc)) = parse_ref(&format!("{letters}{digits}"))
            {
                {
                    let nc = if col_abs { cc as i64 } else { cc as i64 + dc };
                    let nr = if row_abs { r as i64 } else { r as i64 + dr };
                    if nc < 0 || nr < 0 {
                        out.push_str("#REF!");
                    } else {
                        if col_abs {
                            out.push('$');
                        }
                        out.push_str(&col_name(nc as u32));
                        if row_abs {
                            out.push('$');
                        }
                        out.push_str(&(nr + 1).to_string());
                    }
                    i = j;
                    continue;
                }
            }
            // Not a reference: copy the identifier.
            let mut k = start;
            while k < chars.len()
                && (chars[k].is_ascii_alphanumeric()
                    || chars[k] == '_'
                    || chars[k] == '.'
                    || chars[k] == '$')
            {
                out.push(chars[k]);
                k += 1;
            }
            i = k.max(start + 1);
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

// --------------------------------------------------------------- reading --

pub const BUILTIN_FORMATS: [(u32, &str); 25] = [
    (1, "0"),
    (2, "0.00"),
    (3, "#,##0"),
    (4, "#,##0.00"),
    (9, "0%"),
    (10, "0.00%"),
    (11, "0.00E+00"),
    (12, "# ?/?"),
    (13, "# ??/??"),
    (14, "dd.mm.yyyy"),
    (15, "d-mmm-yy"),
    (16, "d-mmm"),
    (17, "mmm-yy"),
    (18, "h:mm AM/PM"),
    (19, "h:mm:ss AM/PM"),
    (20, "hh:mm"),
    (21, "hh:mm:ss"),
    (22, "dd.mm.yyyy hh:mm"),
    (37, "#,##0 ;(#,##0)"),
    (38, "#,##0 ;[Red](#,##0)"),
    (39, "#,##0.00;(#,##0.00)"),
    (40, "#,##0.00;[Red](#,##0.00)"),
    (45, "mm:ss"),
    (46, "[h]:mm:ss"),
    (49, "@"),
];

const INDEXED: [&str; 64] = [
    "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000",
    "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000", "008000",
    "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC",
    "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF",
    "800080", "800000", "008080", "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF",
    "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600",
    "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399",
    "333333",
];

struct StyleTables {
    fonts: Vec<Element>,
    fills: Vec<Option<String>>,
    borders: Vec<[Option<String>; 4]>,
    num_fmts: HashMap<u32, String>,
    theme: Vec<String>,
}

fn rgb_to_hls(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-9 {
        return (0.0, l, 0.0);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    } / 6.0;
    (h, l, s)
}

fn hls_to_rgb(h: f64, l: f64, s: f64) -> (f64, f64, f64) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let f = |mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0))
}

fn apply_tint(hex: &str, tint: f64) -> String {
    let v = u32::from_str_radix(hex, 16).unwrap_or(0);
    let (r, g, b) = (
        ((v >> 16) & 255) as f64 / 255.0,
        ((v >> 8) & 255) as f64 / 255.0,
        (v & 255) as f64 / 255.0,
    );
    let (h, mut l, s) = rgb_to_hls(r, g, b);
    l = if tint < 0.0 {
        l * (1.0 + tint)
    } else {
        l * (1.0 - tint) + tint
    };
    let (r, g, b) = hls_to_rgb(h, l.clamp(0.0, 1.0), s);
    format!(
        "{:02x}{:02x}{:02x}",
        (r * 255.0).round() as u8,
        (g * 255.0).round() as u8,
        (b * 255.0).round() as u8
    )
}

impl StyleTables {
    fn color(&self, e: Option<&Element>) -> Option<String> {
        let e = e?;
        let base = if let Some(rgb) = e.attr("rgb") {
            let rgb = if rgb.len() == 8 { &rgb[2..] } else { rgb };
            rgb.to_string()
        } else if let Some(t) = e.attr("theme").and_then(|t| t.parse::<usize>().ok()) {
            // SpreadsheetML swaps the light/dark pairs of the scheme.
            let idx = match t {
                0 => 1,
                1 => 0,
                2 => 3,
                3 => 2,
                n => n,
            };
            self.theme.get(idx)?.clone()
        } else {
            // 64/65 are the system foreground/background colours.
            let i = e
                .attr("indexed")
                .and_then(|t| t.parse::<usize>().ok())
                .filter(|i| *i < 64)?;
            INDEXED.get(i)?.to_string()
        };
        let base = match e.attr("tint").and_then(|t| t.parse::<f64>().ok()) {
            Some(t) if t.abs() > 1e-6 => apply_tint(&base, t),
            _ => base,
        };
        Some(format!("#{}", base.to_ascii_lowercase()))
    }
}

/// Parse a .xlsx file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let pkg = Package::open(bytes)?;
    let main = pkg
        .main_part("officeDocument")?
        .filter(|p| pkg.has(p))
        .or_else(|| {
            pkg.has("xl/workbook.xml")
                .then(|| "xl/workbook.xml".to_string())
        })
        .ok_or_else(|| Error::Format("Keine Excel-Arbeitsmappe gefunden.".into()))?;
    let wb = pkg
        .xml(&main)?
        .ok_or_else(|| Error::Format("Arbeitsmappe fehlt".into()))?;
    let rels: HashMap<String, package::Relationship> = pkg
        .rels(&main)?
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    let by_kind = |k: &str| {
        rels.values()
            .find(|r| r.kind == k)
            .map(|r| r.target.clone())
    };
    let mut warnings = BTreeSet::new();
    if pkg.has_vba() {
        warnings.insert("Die Datei enthält VBA-Makros. Ondura führt sie nicht aus; beim Speichern werden sie nicht übernommen. Eigene Makros legen Sie unter Ansicht/Entwicklertools › Makros an.".to_string());
    }

    let shared: Vec<String> =
        match by_kind("sharedStrings").and_then(|t| pkg.xml(&t).ok().flatten()) {
            Some(sst) => sst
                .children_named("x:si")
                .map(|si| match si.child("x:t") {
                    Some(t) => t.text(),
                    None => si
                        .children_named("x:r")
                        .filter_map(|r| r.child("x:t"))
                        .map(|t| t.text())
                        .collect(),
                })
                .collect(),
            None => Vec::new(),
        };

    let theme: Vec<String> = by_kind("theme")
        .and_then(|t| pkg.xml(&t).ok().flatten())
        .and_then(|th| th.find("a:clrScheme").cloned())
        .map(|cs| {
            cs.elements()
                .map(|c| {
                    c.child("a:srgbClr")
                        .and_then(|x| x.attr("val"))
                        .or_else(|| c.child("a:sysClr").and_then(|x| x.attr("lastClr")))
                        .unwrap_or("000000")
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default();

    let mut styles = vec![CellStyle::default()];
    let mut xf_map: Vec<usize> = Vec::new();
    let mut default_font: Option<(String, u32)> = None;
    let mut dxfs: Vec<CellStyle> = Vec::new();
    let mut style_tables: Option<StyleTables> = None;
    if let Some(st) = by_kind("styles").and_then(|t| pkg.xml(&t).ok().flatten()) {
        let mut tables = StyleTables {
            fonts: Vec::new(),
            fills: Vec::new(),
            borders: Vec::new(),
            num_fmts: HashMap::new(),
            theme,
        };
        if let Some(nf) = st.child("x:numFmts") {
            for f in nf.children_named("x:numFmt") {
                if let (Some(id), Some(code)) = (
                    f.attr("numFmtId").and_then(|v| v.parse().ok()),
                    f.attr("formatCode"),
                ) {
                    tables.num_fmts.insert(id, code.to_string());
                }
            }
        }
        if let Some(fonts) = st.child("x:fonts") {
            tables.fonts = fonts.children_named("x:font").cloned().collect();
        }
        if let Some(fills) = st.child("x:fills") {
            tables.fills = fills
                .children_named("x:fill")
                .map(|f| {
                    let p = f.child("x:patternFill")?;
                    if matches!(p.attr("patternType"), None | Some("none")) {
                        return None;
                    }
                    tables
                        .color(p.child("x:fgColor"))
                        .or_else(|| tables.color(p.child("x:bgColor")))
                })
                .collect();
        }
        if let Some(borders) = st.child("x:borders") {
            tables.borders = borders
                .children_named("x:border")
                .map(|b| {
                    let side = |n: &str| {
                        b.child(n)
                            .and_then(|s| s.attr("style"))
                            .filter(|s| *s != "none")
                            .map(String::from)
                    };
                    [
                        side("x:top"),
                        side("x:bottom"),
                        side("x:left").or_else(|| side("x:start")),
                        side("x:right").or_else(|| side("x:end")),
                    ]
                })
                .collect();
        }
        if let Some(f0) = tables.fonts.first() {
            let name = f0
                .child("x:name")
                .and_then(|n| n.attr("val"))
                .unwrap_or("Calibri")
                .to_string();
            let size = f0
                .child("x:sz")
                .and_then(|n| n.attr("val"))
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(11.0);
            default_font = Some((name, (size * 10.0).round() as u32));
        }
        if let Some(list) = st.child("x:dxfs") {
            for dxf in list.children_named("x:dxf") {
                let mut s = CellStyle::default();
                if let Some(font) = dxf.child("x:font") {
                    let flag = |n: &str| {
                        font.child(n)
                            .map(|e| !matches!(e.attr("val"), Some("0" | "false")))
                            .unwrap_or(false)
                    };
                    s.bold = flag("x:b");
                    s.italic = flag("x:i");
                    s.strike = flag("x:strike");
                    s.underline = font
                        .child("x:u")
                        .map(|u| u.attr("val") != Some("none"))
                        .unwrap_or(false);
                    s.color = tables.color(font.child("x:color"));
                }
                if let Some(p) = dxf.child("x:fill").and_then(|f| f.child("x:patternFill")) {
                    s.fill = tables
                        .color(p.child("x:bgColor"))
                        .or_else(|| tables.color(p.child("x:fgColor")));
                }
                if let Some(code) = dxf.child("x:numFmt").and_then(|n| n.attr("formatCode")) {
                    s.num_fmt = Some(code.to_string());
                }
                if let Some(b) = dxf.child("x:border") {
                    let side = |n: &str| {
                        b.child(n)
                            .and_then(|s| s.attr("style"))
                            .filter(|s| *s != "none")
                            .map(String::from)
                    };
                    [s.border_top, s.border_bottom, s.border_left, s.border_right] = [
                        side("x:top"),
                        side("x:bottom"),
                        side("x:left"),
                        side("x:right"),
                    ];
                }
                dxfs.push(s);
            }
        }
        let mut index: HashMap<CellStyle, usize> = HashMap::new();
        index.insert(CellStyle::default(), 0);
        if let Some(xfs) = st.child("x:cellXfs") {
            for xf in xfs.children_named("x:xf") {
                let mut s = CellStyle::default();
                let num: u32 = xf
                    .attr("numFmtId")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0);
                if num != 0 {
                    s.num_fmt = tables.num_fmts.get(&num).cloned().or_else(|| {
                        BUILTIN_FORMATS
                            .iter()
                            .find(|(i, _)| *i == num)
                            .map(|(_, c)| c.to_string())
                    });
                }
                if let Some(font) = xf
                    .attr("fontId")
                    .and_then(|v| v.parse::<usize>().ok())
                    .and_then(|i| tables.fonts.get(i))
                {
                    let flag = |n: &str| {
                        font.child(n)
                            .map(|e| !matches!(e.attr("val"), Some("0" | "false")))
                            .unwrap_or(false)
                    };
                    s.bold = flag("x:b");
                    s.italic = flag("x:i");
                    s.strike = flag("x:strike");
                    s.underline = font
                        .child("x:u")
                        .map(|u| u.attr("val") != Some("none"))
                        .unwrap_or(false);
                    let name = font
                        .child("x:name")
                        .and_then(|n| n.attr("val"))
                        .map(String::from);
                    let size = font
                        .child("x:sz")
                        .and_then(|n| n.attr("val"))
                        .and_then(|v| v.parse::<f64>().ok())
                        .map(|v| (v * 10.0).round() as u32);
                    if let Some((dn, ds)) = &default_font {
                        s.font = name.filter(|n| n != dn);
                        s.size10 = size.filter(|v| v != ds);
                    }
                    s.color = tables
                        .color(font.child("x:color"))
                        .filter(|c| c != "#000000");
                }
                s.fill = xf
                    .attr("fillId")
                    .and_then(|v| v.parse::<usize>().ok())
                    .and_then(|i| tables.fills.get(i).cloned().flatten());
                if let Some(b) = xf
                    .attr("borderId")
                    .and_then(|v| v.parse::<usize>().ok())
                    .and_then(|i| tables.borders.get(i))
                {
                    [s.border_top, s.border_bottom, s.border_left, s.border_right] = b.clone();
                }
                if let Some(pr) = xf.child("x:protection") {
                    s.locked = pr.attr("locked").map(|v| v != "0" && v != "false");
                    s.hide_formula = matches!(pr.attr("hidden"), Some("1" | "true"));
                }
                if let Some(al) = xf.child("x:alignment") {
                    s.h_align = al
                        .attr("horizontal")
                        .filter(|h| !matches!(*h, "general"))
                        .map(|h| match h {
                            "centerContinuous" | "distributed" => "center".to_string(),
                            "fill" => "left".to_string(),
                            other => other.to_string(),
                        });
                    s.v_align = al.attr("vertical").filter(|v| *v != "bottom").map(|v| {
                        if v == "center" {
                            "middle".to_string()
                        } else {
                            v.to_string()
                        }
                    });
                    s.wrap = matches!(al.attr("wrapText"), Some("1" | "true"));
                    s.indent = al
                        .attr("indent")
                        .and_then(|v| v.parse().ok())
                        .filter(|v| *v > 0);
                }
                let idx = *index.entry(s.clone()).or_insert_with(|| {
                    styles.push(s);
                    styles.len() - 1
                });
                xf_map.push(idx);
            }
        }
        style_tables = Some(tables);
    }

    let mut sheets = Vec::new();
    let protect_structure = wb
        .child("x:workbookProtection")
        .is_some_and(|p| matches!(p.attr("lockStructure"), Some("1" | "true")));
    let mut active = 0usize;
    if let Some(v) = wb.find("x:workbookView") {
        active = v
            .attr("activeTab")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
    }
    let mut names = Vec::new();
    // Print areas and titles by sheet position: (sheet, name, formula).
    let mut print_names: Vec<(usize, String, String)> = Vec::new();
    if let Some(d) = wb.find("x:definedNames") {
        for n in d.children_named("x:definedName") {
            let name = n.attr("name").unwrap_or_default();
            if let (Some("_xlnm.Print_Area" | "_xlnm.Print_Titles"), Some(si)) = (
                Some(name),
                n.attr("localSheetId").and_then(|v| v.parse().ok()),
            ) {
                print_names.push((si, name.to_string(), n.text()));
                continue;
            }
            if name.is_empty() || name.starts_with("_xlnm") || name.starts_with("_xlfn") {
                continue;
            }
            let formula = xlfn::strip(n.text().trim().trim_start_matches('='));
            if formula.contains("#REF!") {
                continue;
            }
            names.push(DefinedName {
                name: name.to_string(),
                formula,
                sheet: n.attr("localSheetId").and_then(|v| v.parse().ok()),
                hidden: matches!(n.attr("hidden"), Some("1" | "true")),
            });
        }
    }
    let sheet_list = wb
        .child("x:sheets")
        .map(|s| s.children_named("x:sheet").cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for (pos, sh) in sheet_list.into_iter().enumerate() {
        let name = sh.attr("name").unwrap_or("Tabelle").to_string();
        let Some(target) = sh
            .attr("r:id")
            .and_then(|id| rels.get(id))
            .map(|r| r.target.clone())
        else {
            continue;
        };
        if rels
            .values()
            .any(|r| r.target == target && r.kind == "chartsheet")
            || target.contains("chartsheet")
        {
            warnings.insert("Diagrammblätter werden nicht unterstützt.".to_string());
            continue;
        }
        let Some(ws) = pkg.xml(&target)? else {
            continue;
        };
        let mut sheet = Sheet::new(&name);
        sheet.hidden = sh.attr("state").is_some_and(|s| s != "visible");
        if let Some(view) = ws.find("x:sheetView") {
            sheet.show_grid = view.attr("showGridLines") != Some("0");
            if let Some(pane) = view
                .child("x:pane")
                .filter(|p| matches!(p.attr("state"), Some("frozen" | "frozenSplit")))
            {
                sheet.freeze_cols = pane
                    .attr("xSplit")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0) as u32;
                sheet.freeze_rows = pane
                    .attr("ySplit")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0) as u32;
            }
        }
        if let Some(cols) = ws.child("x:cols") {
            for c in cols.children_named("x:col") {
                let (Some(min), Some(max)) = (
                    c.attr("min").and_then(|v| v.parse::<u32>().ok()),
                    c.attr("max").and_then(|v| v.parse::<u32>().ok()),
                ) else {
                    continue;
                };
                let hidden = matches!(c.attr("hidden"), Some("1" | "true"));
                let width = c.attr("width").and_then(|v| v.parse::<f64>().ok());
                // Whole-sheet column definitions (max 16384) would explode; cap them.
                for i in min..=max.min(min + 1000).min(16384) {
                    if let Some(w) = width {
                        sheet.cols.insert(i - 1, (w * 7.0 + 5.0).round());
                    }
                    if hidden {
                        sheet.hidden_cols.push(i - 1);
                    }
                }
            }
        }
        let mut shared_f: HashMap<String, (String, u32, u32)> = HashMap::new();
        // Results of dynamic array formulas are recalculated, not kept.
        let mut spill_ranges: Vec<(u32, u32, u32, u32)> = Vec::new();
        // Excel data tables (What-if) become MULTIPLE.OPERATIONS formulas.
        #[allow(clippy::type_complexity)]
        let mut data_tables: Vec<((u32, u32), String, bool, bool, String, String)> = Vec::new();
        if let Some(data) = ws.child("x:sheetData") {
            for row in data.children_named("x:row") {
                let rnum: Option<u32> = row.attr("r").and_then(|v| v.parse().ok());
                if let (Some(r), Some(ht)) =
                    (rnum, row.attr("ht").and_then(|v| v.parse::<f64>().ok()))
                    && matches!(row.attr("customHeight"), Some("1" | "true"))
                {
                    sheet.rows.insert(r - 1, (ht * 4.0 / 3.0).round());
                }
                if let Some(r) = rnum
                    && matches!(row.attr("hidden"), Some("1" | "true"))
                {
                    sheet.hidden_rows.push(r - 1);
                }
                if let (Some(r), Some(l)) = (
                    rnum,
                    row.attr("outlineLevel")
                        .and_then(|v| v.parse::<u8>().ok())
                        .filter(|l| *l > 0),
                ) {
                    sheet.row_levels.insert(r - 1, l.min(7));
                }
                let row_style = row
                    .attr("s")
                    .and_then(|v| v.parse::<usize>().ok())
                    .filter(|_| matches!(row.attr("customFormat"), Some("1" | "true")));
                let mut next_col = 0u32;
                for c in row.children_named("x:c") {
                    let (r0, c0) = match c.attr("r").and_then(parse_ref) {
                        Some(x) => x,
                        None => (rnum.unwrap_or(1) - 1, next_col),
                    };
                    next_col = c0 + 1;
                    let key = cell_ref(r0, c0);
                    let xf = c
                        .attr("s")
                        .and_then(|v| v.parse::<usize>().ok())
                        .or(row_style)
                        .unwrap_or(0);
                    let mut cell = Cell {
                        s: xf_map.get(xf).copied().unwrap_or(0),
                        ..Default::default()
                    };
                    let v = c.child("x:v").map(|v| v.text());
                    match c.attr("t").unwrap_or("n") {
                        "s" => {
                            cell.v = v
                                .and_then(|i| i.trim().parse::<usize>().ok())
                                .and_then(|i| shared.get(i).cloned())
                                .map(Value::Text)
                        }
                        "str" => cell.v = v.map(Value::Text),
                        "inlineStr" => cell.v = c.child("x:is").map(|is| Value::Text(is.text())),
                        "b" => cell.v = v.map(|v| Value::Bool(v.trim() == "1")),
                        "e" => cell.e = v,
                        "d" => cell.v = v.map(Value::Text),
                        _ => {
                            cell.v = v
                                .and_then(|v| v.trim().parse::<f64>().ok())
                                .map(Value::Number)
                        }
                    }
                    if let Some(f) = c.child("x:f") {
                        let text = f.text();
                        if f.attr("t") == Some("dataTable") {
                            data_tables.push((
                                (r0, c0),
                                f.attr("ref").unwrap_or_default().to_string(),
                                matches!(f.attr("dt2D"), Some("1" | "true")),
                                matches!(f.attr("dtr"), Some("1" | "true")),
                                f.attr("r1").unwrap_or_default().to_string(),
                                f.attr("r2").unwrap_or_default().to_string(),
                            ));
                        } else if f.attr("t") == Some("shared") {
                            let si = f.attr("si").unwrap_or_default().to_string();
                            if !text.trim().is_empty() {
                                shared_f.insert(si, (text.clone(), r0, c0));
                                cell.f = Some(text);
                            } else if let Some((base, br, bc)) = shared_f.get(&si) {
                                cell.f = Some(shift_formula(
                                    base,
                                    r0 as i64 - *br as i64,
                                    c0 as i64 - *bc as i64,
                                ));
                            }
                        } else if !text.trim().is_empty() {
                            if f.attr("t") == Some("array")
                                && let Some(range) = f.attr("ref").filter(|r| r.contains(':'))
                                && let Some((a, b)) = range.split_once(':')
                                && let (Some((r1, c1)), Some((r2, c2))) =
                                    (parse_ref(a), parse_ref(b))
                                && (r2 > r1 || c2 > c1)
                            {
                                spill_ranges.push((r1, c1, r2, c2));
                                cell.spill = Some(range.to_string());
                            }
                            cell.f = Some(text);
                        }
                        if let Some(f) = &mut cell.f {
                            *f = xlfn::strip(f);
                        }
                    }
                    if cell.v.is_some() || cell.f.is_some() || cell.e.is_some() || cell.s != 0 {
                        sheet.cells.insert(key, cell);
                    }
                }
            }
        }
        for (r1, c1, r2, c2) in spill_ranges {
            for r in r1..=r2 {
                for c in c1..=c2 {
                    if (r, c) == (r1, c1) {
                        continue;
                    }
                    let k = cell_ref(r, c);
                    if let Some(cell) = sheet.cells.get_mut(&k)
                        && cell.f.is_none()
                    {
                        cell.v = None;
                        cell.e = None;
                        if cell.s == 0 {
                            sheet.cells.remove(&k);
                        }
                    }
                }
            }
        }
        for (_, range, two_d, row_input, r1, r2) in data_tables {
            let Some((a, b)) = range
                .split_once(':')
                .or(Some((range.as_str(), range.as_str())))
            else {
                continue;
            };
            let (Some((top, left)), Some((bottom, right))) = (parse_ref(a), parse_ref(b)) else {
                continue;
            };
            if top == 0 || left == 0 {
                continue;
            }
            let abs = |r: u32, c: u32| format!("${}${}", col_name(c), r + 1);
            let input = |s: &str| parse_ref(s).map(|(r, c)| abs(r, c));
            let (Some(i1), i2) = (input(&r1), input(&r2)) else {
                continue;
            };
            for r in top..=bottom {
                for c in left..=right {
                    let f = if two_d {
                        let Some(i2) = &i2 else { continue };
                        format!(
                            "MULTIPLE.OPERATIONS({},{i1},{},{i2},{})",
                            abs(top - 1, left - 1),
                            cell_ref_rel(top - 1, c, true),
                            cell_ref_rel(r, left - 1, false)
                        )
                    } else if row_input {
                        format!(
                            "MULTIPLE.OPERATIONS({},{i1},{})",
                            cell_ref_rel(r, left - 1, false),
                            cell_ref_rel(top - 1, c, true)
                        )
                    } else {
                        format!(
                            "MULTIPLE.OPERATIONS({},{i1},{})",
                            cell_ref_rel(top - 1, c, true),
                            cell_ref_rel(r, left - 1, false)
                        )
                    };
                    let cell = sheet.cells.entry(cell_ref(r, c)).or_default();
                    cell.f = Some(f);
                }
            }
        }
        if let Some(sc) = ws.child("x:scenarios") {
            for s in sc.children_named("x:scenario") {
                sheet.scenarios.push(Scenario {
                    name: s.attr("name").unwrap_or_default().to_string(),
                    comment: s.attr("comment").map(String::from),
                    cells: s
                        .children_named("x:inputCells")
                        .filter_map(|c| {
                            Some(ScenarioCell {
                                cell: c.attr("r")?.to_string(),
                                value: c.attr("val").unwrap_or_default().to_string(),
                            })
                        })
                        .collect(),
                });
            }
        }
        if let Some(m) = ws.child("x:mergeCells") {
            sheet.merges = m
                .children_named("x:mergeCell")
                .filter_map(|c| c.attr("ref"))
                .map(String::from)
                .collect();
        }
        if let Some(af) = ws
            .child("x:autoFilter")
            .and_then(|a| a.attr("ref").map(|r| (a, r)))
        {
            let (af, range) = af;
            if af
                .children_named("x:filterColumn")
                .any(|fc| fc.child("x:filters").is_none())
            {
                warnings.insert("Benutzerdefinierte Filterkriterien werden als ausgeblendete Zeilen übernommen.".to_string());
            }
            let columns = read_filter_columns(af);
            sheet.auto_filter = Some(AutoFilter {
                range: range.to_string(),
                columns,
            });
        }
        for cf in ws.children_named("x:conditionalFormatting") {
            let Some(range) = cf.attr("sqref") else {
                continue;
            };
            let mut rules: Vec<(u32, CondRule)> = Vec::new();
            for r in cf.children_named("x:cfRule") {
                let kind = r.attr("type").unwrap_or_default();
                let supported = [
                    "cellIs",
                    "expression",
                    "containsText",
                    "notContainsText",
                    "beginsWith",
                    "endsWith",
                    "containsBlanks",
                    "notContainsBlanks",
                    "duplicateValues",
                    "uniqueValues",
                    "top10",
                    "aboveAverage",
                    "colorScale",
                    "dataBar",
                ];
                if !supported.contains(&kind) {
                    warnings.insert("Symbolsätze und einige Regeln der bedingten Formatierung werden nicht unterstützt.".to_string());
                    continue;
                }
                let flag = |n: &str| matches!(r.attr(n), Some("1" | "true"));
                let mut rule = CondRule {
                    kind: kind.to_string(),
                    operator: r.attr("operator").map(String::from),
                    formulas: r.children_named("x:formula").map(|f| f.text()).collect(),
                    text: r.attr("text").map(String::from),
                    rank: r.attr("rank").and_then(|v| v.parse().ok()),
                    bottom: flag("bottom"),
                    percent: flag("percent"),
                    below: r
                        .attr("aboveAverage")
                        .is_some_and(|v| v == "0" || v == "false"),
                    stop: flag("stopIfTrue"),
                    style: r
                        .attr("dxfId")
                        .and_then(|v| v.parse::<usize>().ok())
                        .and_then(|i| dxfs.get(i).cloned()),
                    colors: Vec::new(),
                };
                if let Some(scale) = r.child("x:colorScale").or_else(|| r.child("x:dataBar")) {
                    rule.colors = scale
                        .children_named("x:color")
                        .filter_map(|c| style_tables.as_ref().and_then(|t| t.color(Some(c))))
                        .collect();
                }
                rules.push((
                    r.attr("priority")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(u32::MAX),
                    rule,
                ));
            }
            rules.sort_by_key(|(p, _)| *p);
            if !rules.is_empty() {
                sheet.cond_formats.push(CondFormat {
                    range: range.to_string(),
                    rules: rules.into_iter().map(|(_, r)| r).collect(),
                });
            }
        }
        if let Some(rid) = ws.child("x:drawing").and_then(|d| d.attr("r:id")) {
            let srels = pkg.rels(&target)?;
            if let Some(drawing) = srels.iter().find(|r| r.id == rid).map(|r| r.target.clone()) {
                read_drawing(&pkg, &drawing, &mut sheet, &mut warnings)?;
            }
        }
        read_review(&pkg, &target, &ws, &mut sheet)?;
        sheet.page = PageSetup::from_xlsx(&ws);
        for (_, kind, formula) in print_names.iter().filter(|p| p.0 == pos) {
            let page = sheet.page.get_or_insert_with(PageSetup::default);
            for part in formula.split(',') {
                let r = part
                    .rsplit_once('!')
                    .map(|x| x.1)
                    .unwrap_or(part)
                    .replace('$', "");
                if kind == "_xlnm.Print_Area" {
                    page.print_area = Some(r);
                } else if r.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                    page.title_rows = Some(r);
                } else {
                    page.title_cols = Some(r);
                }
            }
        }
        if let Some(dv) = ws.child("x:dataValidations") {
            for v in dv.children_named("x:dataValidation") {
                let Some(range) = v.attr("sqref") else {
                    continue;
                };
                let flag = |n: &str| matches!(v.attr(n), Some("1" | "true"));
                let text = |n: &str| v.attr(n).filter(|t| !t.is_empty()).map(String::from);
                sheet.validations.push(Validation {
                    range: range.to_string(),
                    kind: v.attr("type").unwrap_or("none").to_string(),
                    operator: v.attr("operator").map(String::from),
                    formulas: ["x:formula1", "x:formula2"]
                        .iter()
                        .filter_map(|f| v.child(f))
                        .map(|f| f.text())
                        .collect(),
                    allow_blank: flag("allowBlank"),
                    // Excel's attribute is inverted: showDropDown="1" hides it.
                    hide_dropdown: flag("showDropDown"),
                    error_style: v.attr("errorStyle").map(String::from),
                    error_title: text("errorTitle"),
                    error: text("error"),
                    prompt_title: text("promptTitle"),
                    prompt: text("prompt"),
                });
            }
            sheet
                .validations
                .retain(|v| v.kind != "none" || v.prompt.is_some());
        }
        // Sparklines live in the x14 extension (namespaced elements arrive
        // with their local names).
        let mut groups = Vec::new();
        ws.find_all("sparklineGroup", &mut groups);
        for g in groups {
            let color = |n: &str| {
                g.child(n).and_then(|c| c.attr("rgb")).map(|v| {
                    format!(
                        "#{}",
                        v.get(v.len().saturating_sub(6)..)
                            .unwrap_or(v)
                            .to_ascii_lowercase()
                    )
                })
            };
            let mut items = Vec::new();
            g.find_all("sparkline", &mut items);
            for sp in items {
                let (Some(source), Some(cell)) = (
                    sp.child("f").map(|f| f.text()),
                    sp.child("sqref").map(|f| f.text()),
                ) else {
                    continue;
                };
                sheet.sparklines.push(Sparkline {
                    cell: cell.trim().to_string(),
                    source: source.trim().to_string(),
                    kind: g.attr("type").unwrap_or("line").to_string(),
                    color: color("colorSeries"),
                    negative_color: color("colorNegative"),
                    markers: matches!(g.attr("markers"), Some("1" | "true")),
                });
            }
        }
        if let Some(parts) = ws.child("x:tableParts") {
            let srels = pkg.rels(&target)?;
            for tp in parts.children_named("x:tablePart") {
                let Some(t) = tp
                    .attr("r:id")
                    .and_then(|id| srels.iter().find(|r| r.id == id))
                else {
                    continue;
                };
                let Some(tx) = pkg.xml(&t.target)? else {
                    continue;
                };
                if let Some(table) = read_table(&tx) {
                    sheet.tables.push(table);
                }
            }
            // "This row" references are kept the short way: [@Spalte].
            if !sheet.tables.is_empty() {
                let tables = sheet.tables.clone();
                for (k, cell) in sheet.cells.iter_mut() {
                    if let Some(f) = &mut cell.f {
                        *f = structured::from_file(f, table_at(&tables, k));
                    }
                }
            }
        }
        sheets.push(sheet);
    }
    if sheets.is_empty() {
        sheets.push(Sheet::new("Tabelle1"));
    }
    let (title, author) = package::read_core(&pkg);
    let active = active.min(sheets.len() - 1);
    names.retain(|n| n.sheet.is_none_or(|s| s < sheets.len()));
    Ok(Loaded {
        workbook: Workbook {
            protect_structure,
            sheets,
            styles,
            active,
            title,
            author,
            names,
        },
        warnings: warnings.into_iter().collect(),
    })
}

fn xdr_pos(e: &Element) -> (u32, f64, u32, f64) {
    let num = |n: &str| {
        e.child(n)
            .map(|v| v.text())
            .and_then(|v| v.trim().parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    (
        num("xdr:col") as u32,
        num("xdr:colOff") / EMU_PER_PX,
        num("xdr:row") as u32,
        num("xdr:rowOff") / EMU_PER_PX,
    )
}

/// Notes, hyperlinks, protection and column outline levels of a worksheet.
fn read_review(pkg: &Package, target: &str, ws: &Element, sheet: &mut Sheet) -> Result<()> {
    let srels = pkg.rels(target)?;
    // Notes (comments part).
    if let Some(c) = srels.iter().find(|r| r.kind == "comments")
        && let Some(cx) = pkg.xml(&c.target)?
    {
        let authors: Vec<String> = cx
            .child("x:authors")
            .map(|a| a.children_named("x:author").map(|x| x.text()).collect())
            .unwrap_or_default();
        if let Some(list) = cx.child("x:commentList") {
            for cm in list.children_named("x:comment") {
                let Some(cell) = cm.attr("ref") else { continue };
                let mut ts = Vec::new();
                if let Some(t) = cm.child("x:text") {
                    t.find_all("x:t", &mut ts);
                }
                let text: String = ts.iter().map(|t| t.text()).collect();
                let author = cm
                    .attr("authorId")
                    .and_then(|i| i.parse::<usize>().ok())
                    .and_then(|i| authors.get(i).cloned())
                    .filter(|a| !a.is_empty());
                // Excel starts a note with "Author:" in bold; keep the text only.
                let text = match &author {
                    Some(a) => text
                        .strip_prefix(&format!("{a}:"))
                        .map(|t| t.trim_start_matches(['\n', '\r']).to_string())
                        .unwrap_or(text),
                    None => text,
                };
                sheet.notes.push(Note {
                    cell: cell.to_string(),
                    text,
                    author,
                    visible: false,
                });
            }
        }
        // Shown notes: the VML shape is not hidden.
        if let Some(v) = srels.iter().find(|r| r.kind == "vmlDrawing")
            && let Some(raw) = pkg.part(&v.target)
        {
            let vml = String::from_utf8_lossy(raw);
            for shape in vml.split("<v:shape ").skip(1) {
                let row = shape
                    .split("<x:Row>")
                    .nth(1)
                    .and_then(|x| x.split('<').next())
                    .and_then(|x| x.trim().parse::<u32>().ok());
                let col = shape
                    .split("<x:Column>")
                    .nth(1)
                    .and_then(|x| x.split('<').next())
                    .and_then(|x| x.trim().parse::<u32>().ok());
                let visible = shape.contains("<x:Visible")
                    || !shape
                        .split('>')
                        .next()
                        .unwrap_or("")
                        .contains("visibility:hidden");
                if let (Some(r), Some(c), true) = (row, col, visible) {
                    let key = cell_ref(r, c);
                    if let Some(n) = sheet.notes.iter_mut().find(|n| n.cell == key) {
                        n.visible = true;
                    }
                }
            }
        }
    }
    // Hyperlinks.
    if let Some(hl) = ws.child("x:hyperlinks") {
        for h in hl.children_named("x:hyperlink") {
            let Some(cell) = h.attr("ref") else { continue };
            let target = if let Some(rel) = h
                .attr("r:id")
                .and_then(|id| srels.iter().find(|r| r.id == id))
            {
                let mut t = rel.target.clone();
                if let Some(loc) = h.attr("location") {
                    t = format!("{t}#{loc}");
                }
                t
            } else if let Some(loc) = h.attr("location") {
                format!("#{loc}")
            } else {
                continue;
            };
            // A link on a range applies to its first cell.
            let first = cell.split(':').next().unwrap_or(cell).to_string();
            sheet.links.push(Link {
                cell: first,
                target,
                tooltip: h.attr("tooltip").map(String::from),
            });
        }
    }
    // Protection.
    if let Some(p) = ws
        .child("x:sheetProtection")
        .filter(|p| matches!(p.attr("sheet"), Some("1" | "true")))
    {
        // "0" means the action is not protected (allowed).
        let allowed = |a: &str, default_allowed: bool| {
            p.attr(a)
                .map(|v| v == "0" || v == "false")
                .unwrap_or(default_allowed)
        };
        sheet.protection = Some(Protection {
            password: p.attr("password").map(String::from),
            algorithm: p.attr("algorithmName").map(String::from),
            hash: p.attr("hashValue").map(String::from),
            salt: p.attr("saltValue").map(String::from),
            spin_count: p.attr("spinCount").and_then(|v| v.parse().ok()),
            format_cells: allowed("formatCells", false),
            insert_rows: allowed("insertRows", false),
            delete_rows: allowed("deleteRows", false),
            sort: allowed("sort", false),
            auto_filter: allowed("autoFilter", false),
            select_locked: allowed("selectLockedCells", true),
            ..Default::default()
        });
    }
    // Column outline levels.
    if let Some(cols) = ws.child("x:cols") {
        for c in cols.children_named("x:col") {
            let l: u8 = c
                .attr("outlineLevel")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if l == 0 {
                continue;
            }
            let min: u32 = c.attr("min").and_then(|v| v.parse().ok()).unwrap_or(1);
            let max: u32 = c.attr("max").and_then(|v| v.parse().ok()).unwrap_or(min);
            for i in min..=max.min(min + 1000).min(16384) {
                sheet.col_levels.insert(i - 1, l.min(7));
            }
        }
    }
    Ok(())
}

fn read_filter_columns(af: &Element) -> Vec<FilterColumn> {
    let mut columns = Vec::new();
    for fc in af.children_named("x:filterColumn") {
        let col = fc.attr("colId").and_then(|v| v.parse().ok()).unwrap_or(0);
        if let Some(f) = fc.child("x:filters") {
            let mut values: Vec<String> = f
                .children_named("x:filter")
                .filter_map(|v| v.attr("val"))
                .map(String::from)
                .collect();
            if matches!(f.attr("blank"), Some("1" | "true")) {
                values.push(String::new());
            }
            columns.push(FilterColumn { col, values });
        }
    }
    columns
}

fn auto_filter_xml(af: &AutoFilter) -> String {
    let mut x = format!(r#"<autoFilter ref="{}""#, esc(&af.range));
    if af.columns.is_empty() {
        x.push_str("/>");
        return x;
    }
    x.push('>');
    for fc in &af.columns {
        let blank = fc.values.iter().any(|v| v.is_empty());
        x.push_str(&format!(
            r#"<filterColumn colId="{}"><filters{}>"#,
            fc.col,
            if blank { r#" blank="1""# } else { "" }
        ));
        for v in fc.values.iter().filter(|v| !v.is_empty()) {
            x.push_str(&format!(r#"<filter val="{}"/>"#, esc(v)));
        }
        x.push_str("</filters></filterColumn>");
    }
    x.push_str("</autoFilter>");
    x
}

/// Range of a table without its totals row (the range its filter covers).
fn table_filter_range(t: &SheetTable) -> Option<String> {
    let (r1, c1, r2, c2) = t.rect()?;
    Some(format!(
        "{}:{}",
        cell_ref(r1, c1),
        cell_ref(r2 - u32::from(t.totals_row && r2 > r1), c2)
    ))
}

fn table_xml(t: &SheetTable, id: usize) -> String {
    let mut x = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="{id}" name="{}" displayName="{}" ref="{}"{}{}>"#,
        esc(&t.name),
        esc(&t.name),
        esc(&t.range),
        if t.header_row {
            ""
        } else {
            r#" headerRowCount="0""#
        },
        if t.totals_row {
            r#" totalsRowCount="1""#
        } else {
            r#" totalsRowShown="0""#
        },
    );
    if t.header_row && t.filter {
        x.push_str(&auto_filter_xml(&AutoFilter {
            range: table_filter_range(t).unwrap_or_default(),
            columns: t.filter_columns.clone(),
        }));
    }
    x.push_str(&format!(r#"<tableColumns count="{}">"#, t.columns.len()));
    for (i, c) in t.columns.iter().enumerate() {
        x.push_str(&format!(
            r#"<tableColumn id="{}" name="{}""#,
            i + 1,
            esc(&c.name)
        ));
        if let Some(f) = &c.totals_function {
            x.push_str(&format!(r#" totalsRowFunction="{}""#, esc(f)));
        }
        if let Some(l) = &c.totals_label {
            x.push_str(&format!(r#" totalsRowLabel="{}""#, esc(l)));
        }
        match &c.formula {
            Some(f) => x.push_str(&format!(
                "><calculatedColumnFormula>{}</calculatedColumnFormula></tableColumn>",
                esc(&xlfn::add(&structured::to_file(f, Some(&t.name))))
            )),
            None => x.push_str("/>"),
        }
    }
    x.push_str("</tableColumns>");
    x.push_str(&format!(
        r#"<tableStyleInfo name="{}" showFirstColumn="{}" showLastColumn="{}" showRowStripes="{}" showColumnStripes="{}"/></table>"#,
        esc(t.style.as_deref().unwrap_or("TableStyleMedium2")),
        u8::from(t.first_col),
        u8::from(t.last_col),
        u8::from(t.banded_rows),
        u8::from(t.banded_cols)
    ));
    x
}

/// A table part (`xl/tables/tableN.xml`); its filter becomes the sheet's.
fn read_table(t: &Element) -> Option<SheetTable> {
    let range = t.attr("ref")?.to_string();
    let name = t.attr("displayName").or(t.attr("name"))?.to_string();
    let header_row = t.attr("headerRowCount") != Some("0");
    let totals_row = t.attr("totalsRowCount").is_some_and(|v| v != "0")
        || t.attr("totalsRowShown") == Some("1") && t.attr("totalsRowCount").is_some();
    let info = t.child("x:tableStyleInfo");
    let flag = |a: &str| {
        info.and_then(|i| i.attr(a))
            .is_some_and(|v| v == "1" || v == "true")
    };
    let columns = t
        .child("x:tableColumns")
        .map(|cs| {
            cs.children_named("x:tableColumn")
                .map(|c| TableColumn {
                    name: c.attr("name").unwrap_or_default().to_string(),
                    totals_function: c
                        .attr("totalsRowFunction")
                        .filter(|f| *f != "none")
                        .map(String::from),
                    totals_label: c.attr("totalsRowLabel").map(String::from),
                    formula: c.child("x:calculatedColumnFormula").map(|f| {
                        structured::from_file(
                            &xlfn::strip(f.text().trim()),
                            t.attr("displayName").or(t.attr("name")),
                        )
                    }),
                })
                .collect()
        })
        .unwrap_or_default();
    let filter = t.child("x:autoFilter");
    Some(SheetTable {
        name,
        range,
        header_row,
        totals_row,
        style: info.and_then(|i| i.attr("name")).map(String::from),
        banded_rows: flag("showRowStripes"),
        banded_cols: flag("showColumnStripes"),
        first_col: flag("showFirstColumn"),
        last_col: flag("showLastColumn"),
        filter: filter.is_some(),
        filter_columns: filter.map(read_filter_columns).unwrap_or_default(),
        columns,
    })
}

/// Charts and pictures of a worksheet drawing part.
fn read_drawing(
    pkg: &Package,
    part: &str,
    sheet: &mut Sheet,
    warnings: &mut BTreeSet<String>,
) -> Result<()> {
    let Some(root) = pkg.xml(part)? else {
        return Ok(());
    };
    let rels: HashMap<String, package::Relationship> = pkg
        .rels(part)?
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    for a in root.elements() {
        let Some(from) = a.child("xdr:from").map(xdr_pos) else {
            if a.name == "xdr:absoluteAnchor" {
                warnings
                    .insert("Absolut positionierte Objekte werden nicht angezeigt.".to_string());
            }
            continue;
        };
        let (col, dx, row, dy) = from;
        let (w, h) = match a.child("xdr:to").map(xdr_pos) {
            Some((c2, dx2, r2, dy2)) => (
                sheet.span(true, col, dx, c2, dx2),
                sheet.span(false, row, dy, r2, dy2),
            ),
            None => {
                let ext = a.child("xdr:ext");
                let v = |n: &str| {
                    ext.and_then(|e| e.attr(n))
                        .and_then(|v| v.parse::<f64>().ok())
                        .unwrap_or(0.0)
                        / EMU_PER_PX
                };
                (v("cx").max(10.0), v("cy").max(10.0))
            }
        };
        let anchor = Anchor {
            col,
            row,
            dx,
            dy,
            w,
            h,
        };
        // Excel 2016 charts (waterfall, histogram, funnel) come wrapped in
        // markup compatibility with a fallback shape.
        let chartex_frame = a
            .child("mc:AlternateContent")
            .and_then(|ac| ac.child("mc:Choice"))
            .and_then(|c| c.child("xdr:graphicFrame"));
        if let Some(frame) = chartex_frame {
            let rel = frame
                .find("a:graphicData")
                .and_then(|g| g.elements().next())
                .and_then(|c| c.attr("r:id"))
                .and_then(|id| rels.get(id));
            match rel
                .map(|r| pkg.xml(&r.target))
                .transpose()?
                .flatten()
                .and_then(|x| chartex::read(&x))
            {
                Some(chart) => sheet.charts.push(SheetChart { chart, anchor }),
                None => {
                    warnings.insert("Einige Diagrammtypen werden nicht unterstützt.".to_string());
                }
            }
        } else if let Some(frame) = a.child("xdr:graphicFrame") {
            let chart_rel = frame
                .find("c:chart")
                .and_then(|c| c.attr("r:id"))
                .and_then(|id| rels.get(id));
            match chart_rel
                .map(|r| pkg.xml(&r.target))
                .transpose()?
                .flatten()
                .and_then(|x| chart::read(&x))
            {
                Some((chart, partial)) => {
                    if partial {
                        warnings.insert(
                            "Kombinierte Diagramme werden als einfacher Diagrammtyp angezeigt."
                                .to_string(),
                        );
                    }
                    sheet.charts.push(SheetChart { chart, anchor });
                }
                None => {
                    warnings.insert("Einige Diagrammtypen werden nicht unterstützt.".to_string());
                }
            }
        } else if let Some(pic) = a.child("xdr:pic") {
            let target = pic
                .find("a:blip")
                .and_then(|b| b.attr("r:embed"))
                .and_then(|id| rels.get(id));
            if let Some(data) = target.and_then(|t| pkg.part(&t.target)) {
                let cnv = pic.find("xdr:cNvPr");
                let name = cnv.and_then(|c| c.attr("name")).map(String::from);
                let alt = cnv
                    .and_then(|c| c.attr("descr"))
                    .filter(|d| !d.is_empty())
                    .map(String::from);
                sheet.images.push(SheetImage {
                    src: package::data_url(package::mime_for(&target.unwrap().target), data),
                    anchor,
                    name,
                    alt,
                });
            }
        } else if a.child("xdr:sp").is_some()
            || a.child("xdr:grpSp").is_some()
            || a.child("xdr:cxnSp").is_some()
        {
            warnings
                .insert("Formen und Textfelder in Tabellen werden nicht angezeigt.".to_string());
        }
    }
    Ok(())
}

// --------------------------------------------------------------- writing --

#[derive(Default)]
struct StyleWriter {
    fonts: Vec<String>,
    fills: Vec<String>,
    borders: Vec<String>,
    num_fmts: Vec<(u32, String)>,
    xfs: Vec<String>,
    dxfs: Vec<String>,
}

fn intern(list: &mut Vec<String>, v: String) -> usize {
    if let Some(i) = list.iter().position(|x| *x == v) {
        return i;
    }
    list.push(v);
    list.len() - 1
}

fn argb(c: &str) -> String {
    format!("FF{}", c.trim_start_matches('#').to_ascii_uppercase())
}

impl StyleWriter {
    fn new() -> Self {
        let mut w = Self::default();
        w.fonts.push(r#"<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>"#.into());
        w.fills
            .push(r#"<fill><patternFill patternType="none"/></fill>"#.into());
        w.fills
            .push(r#"<fill><patternFill patternType="gray125"/></fill>"#.into());
        w.borders
            .push("<border><left/><right/><top/><bottom/><diagonal/></border>".into());
        w
    }

    fn xf(&mut self, s: &CellStyle) -> usize {
        let mut font = String::from("<font>");
        if s.bold {
            font.push_str("<b/>");
        }
        if s.italic {
            font.push_str("<i/>");
        }
        if s.strike {
            font.push_str("<strike/>");
        }
        if s.underline {
            font.push_str("<u/>");
        }
        font.push_str(&format!(
            r#"<sz val="{}"/>"#,
            s.size10.map(|v| v as f64 / 10.0).unwrap_or(11.0)
        ));
        match &s.color {
            Some(c) => font.push_str(&format!(r#"<color rgb="{}"/>"#, argb(c))),
            None => font.push_str(r#"<color theme="1"/>"#),
        }
        font.push_str(&format!(
            r#"<name val="{}"/><family val="2"/>"#,
            esc(s.font.as_deref().unwrap_or("Calibri"))
        ));
        if s.font.is_none() {
            font.push_str(r#"<scheme val="minor"/>"#);
        }
        font.push_str("</font>");
        let font_id = intern(&mut self.fonts, font);
        let fill_id = match &s.fill {
            Some(c) => intern(
                &mut self.fills,
                format!(
                    r#"<fill><patternFill patternType="solid"><fgColor rgb="{}"/><bgColor indexed="64"/></patternFill></fill>"#,
                    argb(c)
                ),
            ),
            None => 0,
        };
        let side = |tag: &str, v: &Option<String>| match v {
            Some(st) => format!(
                r#"<{tag} style="{}"><color indexed="64"/></{tag}>"#,
                esc(st)
            ),
            None => format!("<{tag}/>"),
        };
        let border = format!(
            "<border>{}{}{}{}<diagonal/></border>",
            side("left", &s.border_left),
            side("right", &s.border_right),
            side("top", &s.border_top),
            side("bottom", &s.border_bottom)
        );
        let border_id = intern(&mut self.borders, border);
        let num_id = match &s.num_fmt {
            None => 0,
            Some(code) if code == "General" => 0,
            Some(code) => match BUILTIN_FORMATS.iter().find(|(_, c)| c == code) {
                Some((id, _)) if *id != 14 && *id != 22 => *id,
                _ => match self.num_fmts.iter().find(|(_, c)| c == code) {
                    Some((id, _)) => *id,
                    None => {
                        let id = 164 + self.num_fmts.len() as u32;
                        self.num_fmts.push((id, code.clone()));
                        id
                    }
                },
            },
        };
        let mut xf = format!(
            r#"<xf numFmtId="{num_id}" fontId="{font_id}" fillId="{fill_id}" borderId="{border_id}" xfId="0""#
        );
        if num_id != 0 {
            xf.push_str(r#" applyNumberFormat="1""#);
        }
        if font_id != 0 {
            xf.push_str(r#" applyFont="1""#);
        }
        if fill_id != 0 {
            xf.push_str(r#" applyFill="1""#);
        }
        if border_id != 0 {
            xf.push_str(r#" applyBorder="1""#);
        }
        let has_align = s.h_align.is_some() || s.v_align.is_some() || s.wrap || s.indent.is_some();
        let protection = (s.locked == Some(false) || s.hide_formula).then(|| {
            format!(
                "<protection{}{}/>",
                if s.locked == Some(false) {
                    r#" locked="0""#
                } else {
                    ""
                },
                if s.hide_formula { r#" hidden="1""# } else { "" }
            )
        });
        if protection.is_some() {
            xf.push_str(r#" applyProtection="1""#);
        }
        if has_align {
            xf.push_str(r#" applyAlignment="1"><alignment"#);
            if let Some(h) = &s.h_align {
                xf.push_str(&format!(r#" horizontal="{}""#, esc(h)));
            }
            if let Some(v) = &s.v_align {
                xf.push_str(&format!(
                    r#" vertical="{}""#,
                    if v == "middle" { "center" } else { v.as_str() }
                ));
            }
            if s.wrap {
                xf.push_str(r#" wrapText="1""#);
            }
            if let Some(i) = s.indent {
                xf.push_str(&format!(r#" indent="{i}""#));
            }
            xf.push_str(&format!("/>{}</xf>", protection.unwrap_or_default()));
        } else if let Some(p) = protection {
            xf.push_str(&format!(">{p}</xf>"));
        } else {
            xf.push_str("/>");
        }
        intern(&mut self.xfs, xf)
    }

    /// Differential format for conditional formatting.
    fn dxf(&mut self, s: &CellStyle) -> usize {
        let mut x = String::from("<dxf>");
        if s.bold || s.italic || s.strike || s.underline || s.color.is_some() {
            x.push_str("<font>");
            if s.bold {
                x.push_str("<b/>");
            }
            if s.italic {
                x.push_str("<i/>");
            }
            if s.strike {
                x.push_str("<strike/>");
            }
            if s.underline {
                x.push_str("<u/>");
            }
            if let Some(c) = &s.color {
                x.push_str(&format!(r#"<color rgb="{}"/>"#, argb(c)));
            }
            x.push_str("</font>");
        }
        if let Some(c) = &s.fill {
            x.push_str(&format!(r#"<fill><patternFill patternType="solid"><fgColor rgb="{0}"/><bgColor rgb="{0}"/></patternFill></fill>"#, argb(c)));
        }
        let sides = [
            ("left", &s.border_left),
            ("right", &s.border_right),
            ("top", &s.border_top),
            ("bottom", &s.border_bottom),
        ];
        if sides.iter().any(|(_, v)| v.is_some()) {
            x.push_str("<border>");
            for (tag, v) in sides {
                match v {
                    Some(st) => x.push_str(&format!(
                        r#"<{tag} style="{}"><color indexed="64"/></{tag}>"#,
                        esc(st)
                    )),
                    None => x.push_str(&format!("<{tag}/>")),
                }
            }
            x.push_str("</border>");
        }
        x.push_str("</dxf>");
        intern(&mut self.dxfs, x)
    }

    fn xml(&self) -> String {
        let mut s = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">"#,
        );
        if !self.num_fmts.is_empty() {
            s.push_str(&format!(r#"<numFmts count="{}">"#, self.num_fmts.len()));
            for (id, code) in &self.num_fmts {
                s.push_str(&format!(
                    r#"<numFmt numFmtId="{id}" formatCode="{}"/>"#,
                    esc(code)
                ));
            }
            s.push_str("</numFmts>");
        }
        for (tag, list) in [
            ("fonts", &self.fonts),
            ("fills", &self.fills),
            ("borders", &self.borders),
        ] {
            s.push_str(&format!(
                r#"<{tag} count="{}">{}</{tag}>"#,
                list.len(),
                list.concat()
            ));
        }
        s.push_str(r#"<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>"#);
        s.push_str(&format!(
            r#"<cellXfs count="{}">{}</cellXfs>"#,
            self.xfs.len(),
            self.xfs.concat()
        ));
        s.push_str(r#"<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>"#);
        s.push_str(&format!(
            r#"<dxfs count="{}">{}</dxfs>"#,
            self.dxfs.len(),
            self.dxfs.concat()
        ));
        s.push_str(r#"<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>"#);
        s
    }
}

fn number(v: f64) -> String {
    if v.is_finite() {
        // Shortest representation that round-trips.
        let s = format!("{v}");
        if s.contains('e') { format!("{v:E}") } else { s }
    } else {
        "0".into()
    }
}

/// Split `Sheet!A1:B2` into the sheet index and range.
fn split_ref<'a>(wb: &Workbook, default: usize, r: &'a str) -> Option<(usize, &'a str)> {
    match r.rsplit_once('!') {
        Some((sheet, range)) => {
            let name = sheet.trim_matches('\'').replace("''", "'");
            wb.sheets
                .iter()
                .position(|s| s.name.eq_ignore_ascii_case(&name))
                .map(|i| (i, range))
        }
        None => Some((default, r)),
    }
}

/// Current cell values of a reference, row by row, as displayed text.
fn ref_values(wb: &Workbook, default: usize, r: &str) -> Option<Vec<String>> {
    let (si, range) = split_ref(wb, default, r)?;
    let (a, b) = range.split_once(':').unwrap_or((range, range));
    let (r1, c1) = parse_ref(a)?;
    let (r2, c2) = parse_ref(b)?;
    let sheet = &wb.sheets[si];
    let mut out = Vec::new();
    for r in r1.min(r2)..=r1.max(r2).min(r1.min(r2) + 10000) {
        for c in c1.min(c2)..=c1.max(c2) {
            out.push(
                match sheet.cells.get(&cell_ref(r, c)).and_then(|c| c.v.as_ref()) {
                    Some(Value::Number(n)) => number(*n),
                    Some(Value::Text(t)) => t.clone(),
                    Some(Value::Bool(b)) => {
                        if *b {
                            "WAHR".into()
                        } else {
                            "FALSCH".into()
                        }
                    }
                    None => String::new(),
                },
            );
        }
    }
    Some(out)
}

/// Chart with its caches refreshed from the workbook.
fn refreshed(wb: &Workbook, si: usize, chart: &Chart) -> Chart {
    let mut c = chart.clone();
    for s in &mut c.series {
        if let Some(v) = s.name_ref.as_deref().and_then(|r| ref_values(wb, si, r)) {
            s.name = v.into_iter().next();
        }
        if let Some(v) = s.cat_ref.as_deref().and_then(|r| ref_values(wb, si, r)) {
            s.categories = v;
        }
        if let Some(v) = s.val_ref.as_deref().and_then(|r| ref_values(wb, si, r)) {
            s.values = v.iter().map(|x| x.parse().ok()).collect();
        }
    }
    c
}

/// Default formula of text and blank rules, relative to `cell`.
fn rule_formula(rule: &CondRule, cell: &str) -> Option<String> {
    let t = rule.text.clone().unwrap_or_default().replace('"', "\"\"");
    Some(match rule.kind.as_str() {
        "containsText" => format!(r#"NOT(ISERROR(SEARCH("{t}",{cell})))"#),
        "notContainsText" => format!(r#"ISERROR(SEARCH("{t}",{cell}))"#),
        "beginsWith" => format!(r#"LEFT({cell},LEN("{t}"))="{t}""#),
        "endsWith" => format!(r#"RIGHT({cell},LEN("{t}"))="{t}""#),
        "containsBlanks" => format!("LEN(TRIM({cell}))=0"),
        "notContainsBlanks" => format!("LEN(TRIM({cell}))>0"),
        _ => return None,
    })
}

fn xdr_marker(tag: &str, col: u32, dx: f64, row: u32, dy: f64) -> String {
    format!(
        "<xdr:{tag}><xdr:col>{col}</xdr:col><xdr:colOff>{}</xdr:colOff><xdr:row>{row}</xdr:row><xdr:rowOff>{}</xdr:rowOff></xdr:{tag}>",
        (dx * EMU_PER_PX).round() as i64,
        (dy * EMU_PER_PX).round() as i64
    )
}

fn anchor_xml(sheet: &Sheet, a: &Anchor, body: &str) -> String {
    let (c2, dx2) = sheet.walk(true, a.col, a.dx + a.w);
    let (r2, dy2) = sheet.walk(false, a.row, a.dy + a.h);
    format!(
        r#"<xdr:twoCellAnchor editAs="oneCell">{}{}{body}<xdr:clientData/></xdr:twoCellAnchor>"#,
        xdr_marker("from", a.col, a.dx, a.row, a.dy),
        xdr_marker("to", c2, dx2, r2, dy2)
    )
}

/// Serialise a workbook as .xlsx.
pub fn write(wb: &Workbook) -> Result<Vec<u8>> {
    let mut pkg = PackageWriter::new();
    let mut styles = StyleWriter::new();
    let default_style = CellStyle::default();
    let mut xf_ids: Vec<usize> = Vec::with_capacity(wb.styles.len());
    // Style 0 must map to xf 0.
    for s in &wb.styles {
        xf_ids.push(styles.xf(s));
    }
    if xf_ids.is_empty() {
        xf_ids.push(styles.xf(&default_style));
    }
    let mut sst: Vec<String> = Vec::new();
    let mut sst_index: HashMap<String, usize> = HashMap::new();
    let mut sst_count = 0usize;

    let n_sheets = wb.sheets.len();
    let mut sheet_entries = String::new();
    let mut wb_rels = Vec::new();
    let mut used_names = BTreeSet::new();
    let mut defined: Vec<String> = Vec::new();
    let mut dynamic_arrays = false;
    let (mut drawing_count, mut chart_count, mut image_count) = (0, 0, 0);
    let mut table_count = 0usize;
    let mut comment_count = 0usize;
    for (n, sheet) in wb.sheets.iter().enumerate() {
        let mut name: String = sheet
            .name
            .chars()
            .filter(|c| !matches!(c, '\\' | '/' | '?' | '*' | '[' | ']' | ':'))
            .take(31)
            .collect();
        if name.trim().is_empty() || !used_names.insert(name.to_lowercase()) {
            name = format!("Tabelle{}", n + 1);
            used_names.insert(name.to_lowercase());
        }
        let file = format!("worksheets/sheet{}.xml", n + 1);
        let rid = format!("rId{}", n + 1);
        sheet_entries.push_str(&format!(
            r#"<sheet name="{}" sheetId="{}"{} r:id="{rid}"/>"#,
            esc(&name),
            n + 1,
            if sheet.hidden {
                r#" state="hidden""#
            } else {
                ""
            }
        ));
        wb_rels.push((
            rid,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
                .to_string(),
            file.clone(),
            false,
        ));

        let mut sheet_rels: Vec<(String, String, String, bool)> = Vec::new();
        // Cells grouped by row, ordered by column.
        let mut rows: BTreeMap<u32, Vec<(u32, &Cell)>> = BTreeMap::new();
        let mut max = (0u32, 0u32);
        for (k, c) in &sheet.cells {
            if let Some((r, col)) = parse_ref(k) {
                rows.entry(r).or_default().push((col, c));
                max = (max.0.max(r), max.1.max(col));
            }
        }
        for r in sheet
            .rows
            .keys()
            .chain(sheet.hidden_rows.iter())
            .chain(sheet.row_levels.keys())
        {
            rows.entry(*r).or_default();
        }
        let mut x = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#,
        );
        let page = sheet.page.clone().unwrap_or_default();
        x.push_str(page.xlsx_sheet_pr());
        x.push_str(&format!(
            r#"<dimension ref="A1:{}"/><sheetViews><sheetView"#,
            cell_ref(max.0, max.1)
        ));
        if !sheet.show_grid {
            x.push_str(r#" showGridLines="0""#);
        }
        if n == wb.active {
            x.push_str(r#" tabSelected="1""#);
        }
        x.push_str(r#" workbookViewId="0">"#);
        if sheet.freeze_rows > 0 || sheet.freeze_cols > 0 {
            let pane = match (sheet.freeze_rows > 0, sheet.freeze_cols > 0) {
                (true, true) => "bottomRight",
                (true, false) => "bottomLeft",
                _ => "topRight",
            };
            x.push_str("<pane");
            if sheet.freeze_cols > 0 {
                x.push_str(&format!(r#" xSplit="{}""#, sheet.freeze_cols));
            }
            if sheet.freeze_rows > 0 {
                x.push_str(&format!(r#" ySplit="{}""#, sheet.freeze_rows));
            }
            x.push_str(&format!(
                r#" topLeftCell="{}" activePane="{pane}" state="frozen"/>"#,
                cell_ref(sheet.freeze_rows, sheet.freeze_cols)
            ));
        }
        x.push_str(&format!(
            r#"</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"{}{}/>"#,
            sheet
                .row_levels
                .values()
                .max()
                .map(|l| format!(r#" outlineLevelRow="{l}""#))
                .unwrap_or_default(),
            sheet
                .col_levels
                .values()
                .max()
                .map(|l| format!(r#" outlineLevelCol="{l}""#))
                .unwrap_or_default()
        ));
        let mut col_ids: BTreeSet<u32> = sheet.cols.keys().copied().collect();
        col_ids.extend(sheet.hidden_cols.iter().copied());
        col_ids.extend(sheet.col_levels.keys().copied());
        if !col_ids.is_empty() {
            x.push_str("<cols>");
            for c in col_ids {
                let px = sheet.cols.get(&c).copied().unwrap_or(64.0);
                let width = ((px - 5.0).max(0.0) / 7.0 * 256.0).round() / 256.0;
                x.push_str(&format!(
                    r#"<col min="{0}" max="{0}" width="{width}" customWidth="1""#,
                    c + 1
                ));
                if sheet.hidden_cols.contains(&c) {
                    x.push_str(r#" hidden="1""#);
                }
                if let Some(l) = sheet.col_levels.get(&c) {
                    x.push_str(&format!(r#" outlineLevel="{l}""#));
                }
                x.push_str("/>");
            }
            x.push_str("</cols>");
        }
        x.push_str("<sheetData>");
        for (r, mut cells) in rows {
            cells.sort_by_key(|(c, _)| *c);
            x.push_str(&format!(r#"<row r="{}""#, r + 1));
            if let Some(h) = sheet.rows.get(&r) {
                x.push_str(&format!(
                    r#" ht="{}" customHeight="1""#,
                    (h * 0.75 * 4.0).round() / 4.0
                ));
            }
            if sheet.hidden_rows.contains(&r) {
                x.push_str(r#" hidden="1""#);
            }
            if let Some(l) = sheet.row_levels.get(&r) {
                x.push_str(&format!(r#" outlineLevel="{l}""#));
            }
            x.push('>');
            for (c, cell) in cells {
                let r_attr = cell_ref(r, c);
                let s = xf_ids.get(cell.s).copied().unwrap_or(0);
                let s_attr = if s != 0 {
                    format!(r#" s="{s}""#)
                } else {
                    String::new()
                };
                let f = cell
                    .f
                    .as_ref()
                    .filter(|f| {
                        !f.trim_start_matches('=')
                            .to_ascii_uppercase()
                            .starts_with("MULTIPLE.OPERATIONS(")
                    })
                    .map(|f| {
                        let text = esc(&xlfn::add(&structured::to_file(
                            f.trim_start_matches('='),
                            table_at(&sheet.tables, &r_attr),
                        )));
                        match &cell.spill {
                            Some(range) => {
                                format!(r#"<f t="array" ref="{}">{text}</f>"#, esc(range))
                            }
                            None => format!("<f>{text}</f>"),
                        }
                    })
                    .unwrap_or_default();
                // Dynamic array formulas point to the XLDAPR cell metadata.
                let s_attr = if cell.f.is_some() && cell.spill.is_some() {
                    dynamic_arrays = true;
                    format!(r#"{s_attr} cm="1""#)
                } else {
                    s_attr
                };
                if let Some(e) = &cell.e {
                    x.push_str(&format!(
                        r#"<c r="{r_attr}"{s_attr} t="e">{f}<v>{}</v></c>"#,
                        esc(e)
                    ));
                    continue;
                }
                match &cell.v {
                    Some(Value::Number(v)) => x.push_str(&format!(
                        r#"<c r="{r_attr}"{s_attr}>{f}<v>{}</v></c>"#,
                        number(*v)
                    )),
                    Some(Value::Bool(b)) => x.push_str(&format!(
                        r#"<c r="{r_attr}"{s_attr} t="b">{f}<v>{}</v></c>"#,
                        u8::from(*b)
                    )),
                    Some(Value::Text(t)) if cell.f.is_some() => x.push_str(&format!(
                        r#"<c r="{r_attr}"{s_attr} t="str">{f}<v>{}</v></c>"#,
                        esc(t)
                    )),
                    Some(Value::Text(t)) => {
                        sst_count += 1;
                        let idx = *sst_index.entry(t.clone()).or_insert_with(|| {
                            sst.push(t.clone());
                            sst.len() - 1
                        });
                        x.push_str(&format!(
                            r#"<c r="{r_attr}"{s_attr} t="s"><v>{idx}</v></c>"#
                        ));
                    }
                    None if !f.is_empty() => {
                        x.push_str(&format!(r#"<c r="{r_attr}"{s_attr}>{f}</c>"#))
                    }
                    None => x.push_str(&format!(r#"<c r="{r_attr}"{s_attr}/>"#)),
                }
            }
            x.push_str("</row>");
        }
        x.push_str("</sheetData>");
        if let Some(p) = &sheet.protection {
            x.push_str(r#"<sheetProtection"#);
            if let Some(pw) = &p.password {
                x.push_str(&format!(r#" password="{}""#, esc(pw)));
            }
            if let (Some(a), Some(h), Some(salt)) = (&p.algorithm, &p.hash, &p.salt) {
                x.push_str(&format!(
                    r#" algorithmName="{}" hashValue="{}" saltValue="{}" spinCount="{}""#,
                    esc(a),
                    esc(h),
                    esc(salt),
                    p.spin_count.unwrap_or(100_000)
                ));
            }
            x.push_str(r#" sheet="1" objects="1" scenarios="1""#);
            for (attr, allowed) in [
                ("formatCells", p.format_cells),
                ("insertRows", p.insert_rows),
                ("deleteRows", p.delete_rows),
                ("sort", p.sort),
                ("autoFilter", p.auto_filter),
            ] {
                if allowed {
                    x.push_str(&format!(r#" {attr}="0""#));
                }
            }
            if !p.select_locked {
                x.push_str(r#" selectLockedCells="1""#);
            }
            x.push_str("/>");
        }
        if !sheet.scenarios.is_empty() {
            x.push_str(r#"<scenarios current="0" show="0">"#);
            for sc in &sheet.scenarios {
                x.push_str(&format!(
                    r#"<scenario name="{}" count="{}" user="Ondura""#,
                    esc(&sc.name),
                    sc.cells.len()
                ));
                if let Some(c) = &sc.comment {
                    x.push_str(&format!(r#" comment="{}""#, esc(c)));
                }
                x.push('>');
                for c in &sc.cells {
                    x.push_str(&format!(
                        r#"<inputCells r="{}" val="{}"/>"#,
                        esc(&c.cell),
                        esc(&c.value)
                    ));
                }
                x.push_str("</scenario>");
            }
            x.push_str("</scenarios>");
        }
        if let Some(af) = &sheet.auto_filter {
            x.push_str(&auto_filter_xml(af));
            let (a, b) = af.range.split_once(':').unwrap_or((&af.range, &af.range));
            let abs = |r: &str| {
                parse_ref(r)
                    .map(|(r, c)| format!("${}${}", col_name(c), r + 1))
                    .unwrap_or_default()
            };
            defined.push(format!(r#"<definedName name="_xlnm._FilterDatabase" localSheetId="{n}" hidden="1">'{}'!{}:{}</definedName>"#, esc(&name.replace('\'', "''")), abs(a), abs(b)));
        }
        if !sheet.merges.is_empty() {
            x.push_str(&format!(r#"<mergeCells count="{}">"#, sheet.merges.len()));
            for m in &sheet.merges {
                x.push_str(&format!(r#"<mergeCell ref="{}"/>"#, esc(m)));
            }
            x.push_str("</mergeCells>");
        }
        let mut priority = 0;
        for cf in &sheet.cond_formats {
            if cf.rules.is_empty() {
                continue;
            }
            let first = cf.range.split_whitespace().next().unwrap_or("A1");
            let top_left = first.split(':').next().unwrap_or("A1").replace('$', "");
            x.push_str(&format!(
                r#"<conditionalFormatting sqref="{}">"#,
                esc(&cf.range)
            ));
            for rule in &cf.rules {
                priority += 1;
                x.push_str(&format!(r#"<cfRule type="{}""#, esc(&rule.kind)));
                let scale = matches!(rule.kind.as_str(), "colorScale" | "dataBar");
                if !scale {
                    let id = styles.dxf(rule.style.as_ref().unwrap_or(&CellStyle::default()));
                    x.push_str(&format!(r#" dxfId="{id}""#));
                }
                x.push_str(&format!(r#" priority="{priority}""#));
                if rule.stop {
                    x.push_str(r#" stopIfTrue="1""#);
                }
                let op = rule.operator.clone().or_else(|| match rule.kind.as_str() {
                    "containsText" | "notContainsText" | "beginsWith" | "endsWith" => {
                        Some(rule.kind.replace("notContainsText", "notContains"))
                    }
                    _ => None,
                });
                if let Some(op) = op {
                    x.push_str(&format!(r#" operator="{}""#, esc(&op)));
                }
                if let Some(t) = &rule.text {
                    x.push_str(&format!(r#" text="{}""#, esc(t)));
                }
                if rule.kind == "top10" {
                    x.push_str(&format!(r#" rank="{}""#, rule.rank.unwrap_or(10)));
                    if rule.bottom {
                        x.push_str(r#" bottom="1""#);
                    }
                    if rule.percent {
                        x.push_str(r#" percent="1""#);
                    }
                }
                if rule.kind == "aboveAverage" && rule.below {
                    x.push_str(r#" aboveAverage="0""#);
                }
                x.push('>');
                let formulas = if rule.formulas.is_empty() {
                    rule_formula(rule, &top_left).into_iter().collect()
                } else {
                    rule.formulas.clone()
                };
                for f in formulas {
                    x.push_str(&format!(
                        "<formula>{}</formula>",
                        esc(f.trim_start_matches('='))
                    ));
                }
                match rule.kind.as_str() {
                    "colorScale" => {
                        let colors: Vec<String> = if rule.colors.len() >= 2 {
                            rule.colors.clone()
                        } else {
                            vec!["#f8696b".into(), "#ffeb84".into(), "#63be7b".into()]
                        };
                        x.push_str("<colorScale>");
                        x.push_str(r#"<cfvo type="min"/>"#);
                        if colors.len() > 2 {
                            x.push_str(r#"<cfvo type="percentile" val="50"/>"#);
                        }
                        x.push_str(r#"<cfvo type="max"/>"#);
                        for c in colors.iter().take(3) {
                            x.push_str(&format!(r#"<color rgb="{}"/>"#, argb(c)));
                        }
                        x.push_str("</colorScale>");
                    }
                    "dataBar" => {
                        let c = rule
                            .colors
                            .first()
                            .cloned()
                            .unwrap_or_else(|| "#638ec6".into());
                        x.push_str(&format!(r#"<dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="{}"/></dataBar>"#, argb(&c)));
                    }
                    _ => {}
                }
                x.push_str("</cfRule>");
            }
            x.push_str("</conditionalFormatting>");
        }
        if !sheet.validations.is_empty() {
            x.push_str(&format!(
                r#"<dataValidations count="{}">"#,
                sheet.validations.len()
            ));
            for v in &sheet.validations {
                x.push_str(&format!(r#"<dataValidation type="{}""#, esc(&v.kind)));
                if let Some(s) = &v.error_style {
                    x.push_str(&format!(r#" errorStyle="{}""#, esc(s)));
                }
                if let Some(o) = &v.operator {
                    x.push_str(&format!(r#" operator="{}""#, esc(o)));
                }
                if v.allow_blank {
                    x.push_str(r#" allowBlank="1""#);
                }
                if v.hide_dropdown {
                    x.push_str(r#" showDropDown="1""#);
                }
                x.push_str(r#" showInputMessage="1" showErrorMessage="1""#);
                for (attr, val) in [
                    ("errorTitle", &v.error_title),
                    ("error", &v.error),
                    ("promptTitle", &v.prompt_title),
                    ("prompt", &v.prompt),
                ] {
                    if let Some(t) = val {
                        x.push_str(&format!(r#" {attr}="{}""#, esc(t)));
                    }
                }
                x.push_str(&format!(r#" sqref="{}">"#, esc(&v.range)));
                for (i, f) in v.formulas.iter().take(2).enumerate() {
                    x.push_str(&format!(
                        "<formula{0}>{1}</formula{0}>",
                        i + 1,
                        esc(f.trim_start_matches('='))
                    ));
                }
                x.push_str("</dataValidation>");
            }
            x.push_str("</dataValidations>");
        }
        if !sheet.links.is_empty() {
            x.push_str("<hyperlinks>");
            for l in &sheet.links {
                x.push_str(&format!(r#"<hyperlink ref="{}""#, esc(&l.cell)));
                if let Some(loc) = l.target.strip_prefix('#') {
                    x.push_str(&format!(r#" location="{}""#, esc(loc)));
                } else {
                    let rid = format!("rId{}", sheet_rels.len() + 1);
                    sheet_rels.push((rid.clone(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink".into(), l.target.clone(), true));
                    x.push_str(&format!(r#" r:id="{rid}""#));
                }
                if let Some(t) = &l.tooltip {
                    x.push_str(&format!(r#" tooltip="{}""#, esc(t)));
                }
                x.push_str("/>");
            }
            x.push_str("</hyperlinks>");
        }
        x.push_str(&page.xlsx_print());
        x.push_str(&page.xlsx_breaks());
        let quoted = format!("'{}'", esc(&name.replace('\'', "''")));
        let abs_range = |r: &str| {
            r.split(':')
                .map(|p| {
                    let letters: String =
                        p.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
                    let digits = &p[letters.len()..];
                    match (letters.is_empty(), digits.is_empty()) {
                        (true, _) => format!("${digits}"),
                        (_, true) => format!("${letters}"),
                        _ => format!("${letters}${digits}"),
                    }
                })
                .collect::<Vec<_>>()
                .join(":")
        };
        if let Some(a) = &page.print_area {
            defined.push(format!(r#"<definedName name="_xlnm.Print_Area" localSheetId="{n}">{quoted}!{}</definedName>"#, abs_range(a)));
        }
        let titles: Vec<String> = [&page.title_cols, &page.title_rows]
            .into_iter()
            .flatten()
            .map(|t| format!("{quoted}!{}", abs_range(t)))
            .collect();
        if !titles.is_empty() {
            defined.push(format!(
                r#"<definedName name="_xlnm.Print_Titles" localSheetId="{n}">{}</definedName>"#,
                titles.join(",")
            ));
        }
        if !sheet.charts.is_empty() || !sheet.images.is_empty() {
            drawing_count += 1;
            let dname = format!("drawing{drawing_count}.xml");
            let mut d = String::from(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">"#,
            );
            let mut drels = Vec::new();
            let mut id = 1;
            for ch in &sheet.charts {
                chart_count += 1;
                id += 1;
                let rid = format!("rId{}", drels.len() + 1);
                if chart::is_chartex(&ch.chart.kind) {
                    pkg.add(
                        &format!("xl/charts/chartEx{chart_count}.xml"),
                        Some(chartex::CONTENT_TYPE),
                        chartex::write(&refreshed(wb, n, &ch.chart)),
                    );
                    drels.push((
                        rid.clone(),
                        chartex::REL.to_string(),
                        format!("../charts/chartEx{chart_count}.xml"),
                        false,
                    ));
                    let body = chartex::frame_xml(
                        id,
                        &rid,
                        (ch.anchor.w * EMU_PER_PX) as i64,
                        (ch.anchor.h * EMU_PER_PX) as i64,
                    );
                    d.push_str(&anchor_xml(sheet, &ch.anchor, &body));
                    continue;
                }
                pkg.add(
                    &format!("xl/charts/chart{chart_count}.xml"),
                    Some("application/vnd.openxmlformats-officedocument.drawingml.chart+xml"),
                    chart::write(&refreshed(wb, n, &ch.chart), None),
                );
                drels.push((
                    rid.clone(),
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"
                        .to_string(),
                    format!("../charts/chart{chart_count}.xml"),
                    false,
                ));
                let body = format!(
                    r#"<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{id}" name="Diagramm {}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>"#,
                    id - 1
                );
                d.push_str(&anchor_xml(sheet, &ch.anchor, &body));
            }
            for img in &sheet.images {
                let Some((mime, data)) = package::parse_data_url(&img.src) else {
                    continue;
                };
                image_count += 1;
                id += 1;
                let file = format!("image{image_count}.{}", package::ext_for(&mime));
                pkg.add_media(&format!("xl/media/{file}"), &mime, data);
                let rid = format!("rId{}", drels.len() + 1);
                drels.push((
                    rid.clone(),
                    package::REL_IMAGE.to_string(),
                    format!("../media/{file}"),
                    false,
                ));
                let name = img
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("Bild {}", id - 1));
                let body = format!(
                    r#"<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="{id}" name="{}"{}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>"#,
                    esc(&name),
                    img.alt
                        .as_deref()
                        .filter(|a| !a.is_empty())
                        .map(|a| format!(r#" descr="{}""#, esc(a)))
                        .unwrap_or_default(),
                    (img.anchor.w * EMU_PER_PX) as i64,
                    (img.anchor.h * EMU_PER_PX) as i64
                );
                d.push_str(&anchor_xml(sheet, &img.anchor, &body));
            }
            d.push_str("</xdr:wsDr>");
            pkg.add(
                &format!("xl/drawings/{dname}"),
                Some("application/vnd.openxmlformats-officedocument.drawing+xml"),
                d,
            );
            pkg.add(
                &format!("xl/drawings/_rels/{dname}.rels"),
                None,
                package::rels_xml(&drels),
            );
            sheet_rels.push((
                "rId1".into(),
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
                    .into(),
                format!("../drawings/{dname}"),
                false,
            ));
            x.push_str(r#"<drawing r:id="rId1"/>"#);
        }
        if !sheet.notes.is_empty() {
            comment_count += 1;
            let (comments, vml) = notes_xml(sheet, comment_count);
            pkg.add(
                &format!("xl/comments{comment_count}.xml"),
                Some("application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"),
                comments,
            );
            pkg.add(
                &format!("xl/drawings/vmlDrawing{comment_count}.vml"),
                Some("application/vnd.openxmlformats-officedocument.vmlDrawing"),
                vml,
            );
            let cid = format!("rId{}", sheet_rels.len() + 1);
            sheet_rels.push((
                cid,
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
                    .into(),
                format!("../comments{comment_count}.xml"),
                false,
            ));
            let vid = format!("rId{}", sheet_rels.len() + 1);
            sheet_rels.push((
                vid.clone(),
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing"
                    .into(),
                format!("../drawings/vmlDrawing{comment_count}.vml"),
                false,
            ));
            x.push_str(&format!(r#"<legacyDrawing r:id="{vid}"/>"#));
        }
        if !sheet.tables.is_empty() {
            x.push_str(&format!(r#"<tableParts count="{}">"#, sheet.tables.len()));
            for t in &sheet.tables {
                table_count += 1;
                let rid = format!("rId{}", sheet_rels.len() + 1);
                pkg.add(
                    &format!("xl/tables/table{table_count}.xml"),
                    Some("application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"),
                    table_xml(t, table_count),
                );
                sheet_rels.push((
                    rid.clone(),
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table"
                        .into(),
                    format!("../tables/table{table_count}.xml"),
                    false,
                ));
                x.push_str(&format!(r#"<tablePart r:id="{rid}"/>"#));
            }
            x.push_str("</tableParts>");
        }
        if !sheet.sparklines.is_empty() {
            x.push_str(r#"<extLst><ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">"#);
            for sp in &sheet.sparklines {
                let kind = match sp.kind.as_str() {
                    "column" => r#" type="column""#,
                    "stacked" => r#" type="stacked""#,
                    _ => "",
                };
                let c = |v: &Option<String>, d: &str| argb(v.as_deref().unwrap_or(d));
                x.push_str(&format!(
                    r#"<x14:sparklineGroup{kind} displayEmptyCellsAs="gap"{}><x14:colorSeries rgb="{}"/><x14:colorNegative rgb="{}"/><x14:colorAxis rgb="FF000000"/><x14:colorMarkers rgb="{}"/><x14:colorFirst rgb="FFD00000"/><x14:colorLast rgb="FFD00000"/><x14:colorHigh rgb="FFD00000"/><x14:colorLow rgb="FFD00000"/><x14:sparklines><x14:sparkline><xm:f>{}</xm:f><xm:sqref>{}</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup>"#,
                    if sp.markers { r#" markers="1""# } else { "" },
                    c(&sp.color, "#376092"),
                    c(&sp.negative_color, "#d00000"),
                    c(&sp.color, "#376092"),
                    esc(&sp.source),
                    esc(&sp.cell)
                ));
            }
            x.push_str("</x14:sparklineGroups></ext></extLst>");
        }
        x.push_str("</worksheet>");
        if !sheet_rels.is_empty() {
            pkg.add(
                &format!("xl/worksheets/_rels/sheet{}.xml.rels", n + 1),
                None,
                package::rels_xml(&sheet_rels),
            );
        }
        pkg.add(
            &format!("xl/{file}"),
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"),
            x,
        );
    }

    if dynamic_arrays {
        let id = format!("rId{}", wb.sheets.len() + 3);
        wb_rels.push((
            id,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata"
                .into(),
            "metadata.xml".into(),
            false,
        ));
        pkg.add(
            "xl/metadata.xml",
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#.to_string(),
        );
    }
    for dn in &wb.names {
        let local = dn
            .sheet
            .filter(|s| *s < n_sheets)
            .map(|s| format!(r#" localSheetId="{s}""#))
            .unwrap_or_default();
        defined.push(format!(
            r#"<definedName name="{}"{local}{}>{}</definedName>"#,
            esc(&dn.name),
            if dn.hidden { r#" hidden="1""# } else { "" },
            esc(&xlfn::add(dn.formula.trim_start_matches('=')))
        ));
    }
    let mut sst_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{sst_count}" uniqueCount="{}">"#,
        sst.len()
    );
    for s in &sst {
        let preserve = s.starts_with(' ') || s.ends_with(' ') || s.contains('\n');
        sst_xml.push_str(&format!(
            "<si><t{}>{}</t></si>",
            if preserve {
                r#" xml:space="preserve""#
            } else {
                ""
            },
            esc(s)
        ));
    }
    sst_xml.push_str("</sst>");
    let n = wb.sheets.len();
    wb_rels.push((
        format!("rId{}", n + 1),
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles".into(),
        "styles.xml".into(),
        false,
    ));
    wb_rels.push((
        format!("rId{}", n + 2),
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings".into(),
        "sharedStrings.xml".into(),
        false,
    ));
    pkg.add(
        "xl/sharedStrings.xml",
        Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"),
        sst_xml,
    );
    pkg.add(
        "xl/styles.xml",
        Some("application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
        styles.xml(),
    );
    pkg.add(
        "xl/workbook.xml",
        Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr defaultThemeVersion="164011"/>{}<bookViews><workbookView activeTab="{}"/></bookViews><sheets>{sheet_entries}</sheets>{}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>"#,
            if wb.protect_structure { r#"<workbookProtection lockStructure="1"/>"# } else { "" },
            wb.active.min(n.saturating_sub(1)),
            if defined.is_empty() { String::new() } else { format!("<definedNames>{}</definedNames>", defined.concat()) }
        ),
    );
    pkg.add(
        "xl/_rels/workbook.xml.rels",
        None,
        package::rels_xml(&wb_rels),
    );
    pkg.add(
        "docProps/core.xml",
        Some("application/vnd.openxmlformats-package.core-properties+xml"),
        package::core_xml(&wb.title, &wb.author),
    );
    pkg.add(
        "_rels/.rels",
        None,
        package::rels_xml(&[
            (
                "rId1".into(),
                package::REL_OFFICE_DOCUMENT.into(),
                "xl/workbook.xml".into(),
                false,
            ),
            (
                "rId2".into(),
                package::REL_CORE.into(),
                "docProps/core.xml".into(),
                false,
            ),
        ]),
    );
    pkg.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references() {
        assert_eq!(col_name(0), "A");
        assert_eq!(col_name(25), "Z");
        assert_eq!(col_name(26), "AA");
        assert_eq!(col_name(16383), "XFD");
        assert_eq!(parse_ref("AB12"), Some((11, 27)));
        assert_eq!(parse_ref("$C$3"), Some((2, 2)));
        assert_eq!(parse_ref("A0"), None);
    }

    #[test]
    fn shifts_shared_formulas() {
        assert_eq!(
            shift_formula("SUM(A1:B2)*$C$1+C1", 2, 1),
            "SUM(B3:C4)*$C$1+D3"
        );
        assert_eq!(
            shift_formula("IF(A1=\"B2\",LOG10(A1),Tabelle2!A1)", 1, 0),
            "IF(A2=\"B2\",LOG10(A2),Tabelle2!A2)"
        );
        assert_eq!(shift_formula("'My A1'!A1+A$1", 1, 1), "'My A1'!B2+B$1");
        assert_eq!(shift_formula("A1", -1, 0), "#REF!");
    }

    #[test]
    fn tint() {
        assert_eq!(apply_tint("4472C4", 0.0), "4472c4");
        assert_eq!(apply_tint("FFFFFF", -0.5), "808080");
    }
}
