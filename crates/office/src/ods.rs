//! OpenDocument Spreadsheet (.ods) ⇄ [`Workbook`] for Nexora Tabellen.
//!
//! Formulas are converted between Excel syntax (the model) and
//! OpenFormula (`of:=SUM([.A1:.B2])`); number formats between Excel format
//! codes and ODF data styles.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::Result;
use crate::odf::{self, AutoStyles, Extra, OdfDoc, Styles, esc_attr};
use crate::xlsx::{
    Anchor, AutoFilter, Cell, CellStyle, CondFormat, CondRule, DefinedName, FilterColumn, Loaded,
    Sheet, SheetChart, SheetImage, Sparkline, Validation, Value, Workbook, cell_ref, parse_ref,
};
use crate::xml::{Element, esc};

/// Cells beyond these are not materialised from repeated rows/columns.
const MAX_ROWS: u32 = 1_048_576;
const MAX_COLS: u32 = 16_384;

// ------------------------------------------------------------- formulas --

fn needs_quotes(sheet: &str) -> bool {
    !sheet.chars().all(|c| c.is_alphanumeric() || c == '_')
        || sheet.chars().next().is_some_and(|c| c.is_ascii_digit())
}

/// `$A$1` style cell reference?
fn is_cell(t: &str) -> bool {
    let t = t.trim_start_matches('$');
    let letters = t.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    if letters == 0 || letters > 3 {
        return false;
    }
    let rest = t[letters..].trim_start_matches('$');
    !rest.is_empty()
        && rest.chars().all(|c| c.is_ascii_digit())
        && parse_ref(&t.replace('$', "")).is_some_and(|(_, c)| c < MAX_COLS)
}

fn is_col(t: &str) -> bool {
    let t = t.trim_start_matches('$');
    (1..=3).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphabetic())
}

/// Excel formula (without `=`) → OpenFormula attribute value (`of:=…`).
pub fn to_openformula(f: &str) -> String {
    let chars: Vec<char> = f.chars().collect();
    let mut out = String::from("of:=");
    let mut i = 0;
    // Reads a reference token ($A$1 or $A) at i.
    let token = |i: &mut usize| -> String {
        let start = *i;
        while *i < chars.len() && (chars[*i].is_ascii_alphanumeric() || chars[*i] == '$') {
            *i += 1;
        }
        chars[start..*i].iter().collect()
    };
    let sheet_prefix = |s: &str| {
        if s.is_empty() {
            ".".to_string()
        } else if needs_quotes(s) {
            format!("'{}'.", s.replace('\'', "''"))
        } else {
            format!("{s}.")
        }
    };
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == '"' {
                    if chars.get(i + 1) == Some(&'"') {
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
        // Sheet name: 'Name'!  or  Name!
        let mut sheet = String::new();
        let mut j = i;
        if c == '\'' {
            j += 1;
            while j < chars.len() {
                if chars[j] == '\'' {
                    if chars.get(j + 1) == Some(&'\'') {
                        sheet.push('\'');
                        j += 2;
                        continue;
                    }
                    break;
                }
                sheet.push(chars[j]);
                j += 1;
            }
            if chars.get(j + 1) == Some(&'!') {
                i = j + 2;
            } else {
                // Not a sheet reference: copy literally.
                out.extend(&chars[i..=j.min(chars.len() - 1)]);
                i = j + 1;
                continue;
            }
        } else if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            while j < chars.len()
                && (chars[j].is_alphanumeric() || matches!(chars[j], '_' | '.' | '$'))
            {
                j += 1;
            }
            let word: String = chars[start..j].iter().collect();
            if chars.get(j) == Some(&'!') {
                sheet = word;
                i = j + 1;
            } else if chars.get(j) == Some(&'(') {
                out.push_str(&odf_function(word.strip_prefix("_xlfn.").unwrap_or(&word)));
                i = j;
                continue;
            } else {
                // A reference only if the whole word is one.
                let after_colon = chars.get(j) == Some(&':');
                if !(is_cell(&word) || (is_col(&word) && after_colon)) {
                    out.push_str(&word);
                    i = j;
                    continue;
                }
            }
        } else {
            out.push(if c == ',' { ';' } else { c });
            i += 1;
            continue;
        }
        // Reference (after an optional sheet).
        let first = token(&mut i);
        let mut second = None;
        if chars.get(i) == Some(&':') {
            let mut k = i + 1;
            let t = token(&mut k);
            if is_cell(&t) || is_col(&t) {
                second = Some(t);
                i = k;
            }
        }
        let p = sheet_prefix(&sheet);
        match second {
            Some(b) if is_col(&first) && is_col(&b) => {
                out.push_str(&format!("[{p}{first}1:.{b}{MAX_ROWS}]"))
            }
            Some(b) => out.push_str(&format!("[{p}{first}:.{b}]")),
            None => out.push_str(&format!("[{p}{first}]")),
        }
    }
    out
}

/// Excel ⇄ OpenFormula function names that differ (as LibreOffice writes them).
const ODF_NAMES: &[(&str, &str)] = &[
    ("FDIST", "LEGACY.FDIST"),
    ("TDIST", "LEGACY.TDIST"),
    ("CHIDIST", "LEGACY.CHIDIST"),
    ("CHIINV", "LEGACY.CHIINV"),
    ("FINV", "LEGACY.FINV"),
    ("NORMSDIST", "LEGACY.NORMSDIST"),
    ("NORMSINV", "LEGACY.NORMSINV"),
    ("CHITEST", "LEGACY.CHITEST"),
    ("F.DIST", "FDIST"),
    ("F.INV", "FINV"),
    ("FORMULATEXT", "FORMULA"),
    ("SKEW.P", "SKEWP"),
    ("CEILING", "COM.MICROSOFT.CEILING"),
    ("FLOOR", "COM.MICROSOFT.FLOOR"),
];
/// Excel functions that OpenFormula has under the `COM.MICROSOFT.` prefix
/// (besides the dotted Excel 2010 names).
const MS_ONLY: &[&str] = &[
    "CONCAT", "TEXTJOIN", "IFS", "MAXIFS", "MINIFS", "SWITCH", "AGGREGATE", "ENCODEURL", "XLOOKUP", "XMATCH", "LET", "LAMBDA", "FILTER", "SORT", "SORTBY",
    "UNIQUE", "SEQUENCE", "RANDARRAY", "TEXTBEFORE", "TEXTAFTER", "TEXTSPLIT", "VSTACK", "HSTACK", "TOCOL", "TOROW", "WRAPCOLS", "WRAPROWS", "TAKE", "DROP",
    "CHOOSECOLS", "CHOOSEROWS", "EXPAND", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "MAKEARRAY", "ISOMITTED", "ARRAYTOTEXT", "VALUETOTEXT", "REGEXTEST",
    "REGEXEXTRACT", "REGEXREPLACE", "GROUPBY", "PERCENTOF",
];
/// Dotted names that are plain OpenFormula functions.
const ODF_DOTTED: &[&str] = &["NETWORKDAYS.INTL", "WORKDAY.INTL"];

fn odf_function(name: &str) -> String {
    let up = name.to_ascii_uppercase();
    if let Some((_, o)) = ODF_NAMES.iter().find(|(e, _)| *e == up) {
        return (*o).to_string();
    }
    if MS_ONLY.contains(&up.as_str()) || (up.contains('.') && !ODF_DOTTED.contains(&up.as_str())) {
        return format!("COM.MICROSOFT.{up}");
    }
    name.to_string()
}

fn excel_function(name: &str) -> String {
    let up = name.to_ascii_uppercase();
    if let Some((e, _)) = ODF_NAMES.iter().find(|(_, o)| *o == up) {
        return (*e).to_string();
    }
    let n = up.strip_prefix("COM.MICROSOFT.").unwrap_or(&up);
    n.strip_prefix("_XLFN.").unwrap_or(n).to_string()
}

/// OpenFormula (`of:=…`, `=…`) → Excel formula without `=`.
pub fn from_openformula(f: &str) -> String {
    let f = f
        .strip_prefix("of:")
        .or_else(|| f.strip_prefix("msoxl:"))
        .unwrap_or(f);
    let f = f.strip_prefix('=').unwrap_or(f);
    let chars: Vec<char> = f.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '"' => {
                out.push(c);
                i += 1;
                while i < chars.len() {
                    out.push(chars[i]);
                    if chars[i] == '"' {
                        if chars.get(i + 1) == Some(&'"') {
                            out.push('"');
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            '[' => {
                let mut j = i + 1;
                let mut inq = false;
                while j < chars.len() && (inq || chars[j] != ']') {
                    if chars[j] == '\'' {
                        inq = !inq;
                    }
                    j += 1;
                }
                let inner: String = chars[i + 1..j.min(chars.len())].iter().collect();
                out.push_str(&odf_ref(&inner));
                i = j + 1;
            }
            ';' => {
                out.push(',');
                i += 1;
            }
            _ if c.is_alphabetic() => {
                let start = i;
                while i < chars.len()
                    && (chars[i].is_alphanumeric() || matches!(chars[i], '_' | '.'))
                {
                    i += 1;
                }
                let word: String = chars[start..i].iter().collect();
                if chars.get(i) == Some(&'(') {
                    out.push_str(&excel_function(&word));
                } else {
                    out.push_str(word.strip_prefix("COM.MICROSOFT.").unwrap_or(&word));
                }
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// `.A1`, `$Sheet.$A$1:.$B$2`, `'My Sheet'.A1` → Excel reference.
fn odf_ref(r: &str) -> String {
    // Split at ':' outside quotes.
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut inq = false;
    for ch in r.chars() {
        if ch == '\'' {
            inq = !inq;
        }
        if ch == ':' && !inq {
            parts.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
    }
    parts.push(cur);
    let split = |p: &str| -> (Option<String>, String) {
        // Sheet is everything before the last '.' outside quotes.
        let mut inq = false;
        let mut dot = None;
        for (k, ch) in p.char_indices() {
            if ch == '\'' {
                inq = !inq;
            }
            if ch == '.' && !inq {
                dot = Some(k);
            }
        }
        match dot {
            Some(k) => {
                let sheet = p[..k].trim_start_matches('$');
                let sheet = sheet
                    .strip_prefix('\'')
                    .and_then(|s| s.strip_suffix('\''))
                    .map(|s| s.replace("''", "'"))
                    .unwrap_or_else(|| sheet.to_string());
                (
                    Some(sheet).filter(|s| !s.is_empty()),
                    p[k + 1..].to_string(),
                )
            }
            None => (None, p.to_string()),
        }
    };
    let (sheet, first) = split(&parts[0]);
    let mut s = match &sheet {
        Some(n) if needs_quotes(n) => format!("'{}'!{first}", n.replace('\'', "''")),
        Some(n) => format!("{n}!{first}"),
        None => first,
    };
    if let Some(p) = parts.get(1) {
        let (_, second) = split(p);
        s.push(':');
        s.push_str(&second);
    }
    s
}

// --------------------------------------------------------- number formats --

/// ODF data style → Excel format code.
fn excel_format(e: &Element) -> Option<String> {
    let lit = |t: &str| -> String {
        if t.chars().all(|c| " -/.:,()%€$£¥".contains(c)) {
            t.to_string()
        } else {
            format!("\"{}\"", t.replace('"', ""))
        }
    };
    let mut out = String::new();
    let long = |x: &Element| x.attr("number:style") == Some("long");
    for x in e.elements() {
        match x.name.as_str() {
            "number:number" | "number:scientific-number" => {
                let dec: usize = x
                    .attr("number:decimal-places")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0);
                let min_int: usize = x
                    .attr("number:min-integer-digits")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1);
                let int = if x.attr("number:grouping") == Some("true") {
                    if min_int > 0 { "#,##0" } else { "#,###" }
                } else if min_int > 0 {
                    "0"
                } else {
                    "#"
                };
                out.push_str(int);
                if dec > 0 {
                    out.push('.');
                    out.push_str(&"0".repeat(dec.min(15)));
                }
                if x.name == "number:scientific-number" {
                    out.push_str("E+00");
                }
            }
            "number:fraction" => out.push_str("# ?/?"),
            "number:text" => out.push_str(&lit(&x.text())),
            "number:currency-symbol" => out.push_str(&lit(&x.text())),
            "number:day" => out.push_str(if long(x) { "dd" } else { "d" }),
            "number:day-of-week" => out.push_str(if long(x) { "dddd" } else { "ddd" }),
            "number:month" => {
                out.push_str(match (x.attr("number:textual") == Some("true"), long(x)) {
                    (true, true) => "mmmm",
                    (true, false) => "mmm",
                    (false, true) => "mm",
                    (false, false) => "m",
                })
            }
            "number:year" => out.push_str(if long(x) { "yyyy" } else { "yy" }),
            "number:hours" => out.push_str(if long(x) { "hh" } else { "h" }),
            "number:minutes" => out.push_str(if long(x) { "mm" } else { "m" }),
            "number:seconds" => out.push_str(if long(x) { "ss" } else { "s" }),
            "number:am-pm" => out.push_str("AM/PM"),
            "number:boolean" => return None,
            _ => {}
        }
    }
    if e.name == "number:percentage-style" && !out.contains('%') {
        out.push('%');
    }
    (!out.is_empty() && out != "0" || e.name != "number:number-style")
        .then_some(out)
        .filter(|s| !s.is_empty() && s != "General")
}

#[derive(PartialEq)]
enum FmtKind {
    Number,
    Percent,
    Currency,
    Date,
}

/// Excel format code → (ODF data style element body, element name, kind).
fn odf_format(name: &str, code: &str) -> (String, FmtKind) {
    let code = code.split(';').next().unwrap_or(code);
    // Drop colours/conditions, keep currency symbols of locale blocks.
    let mut clean = String::new();
    let mut chars = code.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            let inner: String = chars.by_ref().take_while(|&c| c != ']').collect();
            if let Some(sym) = inner.strip_prefix('$') {
                clean.push_str(&format!("\"{}\"", sym.split('-').next().unwrap_or("")));
            }
        } else {
            clean.push(c);
        }
    }
    // Tokens: literal text or format letters.
    enum Tok {
        Lit(String),
        Code(String),
    }
    let mut toks = Vec::new();
    let cs: Vec<char> = clean.chars().collect();
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c == '"' {
            let s: String = cs[i + 1..].iter().take_while(|&&c| c != '"').collect();
            i += s.chars().count() + 2;
            toks.push(Tok::Lit(s));
        } else if c == '\\' && i + 1 < cs.len() {
            toks.push(Tok::Lit(cs[i + 1].to_string()));
            i += 2;
        } else if c == '_' || c == '*' {
            i += 2;
        } else if "dmyhsDMYHS".contains(c) {
            let n = cs[i..]
                .iter()
                .take_while(|&&x| x.eq_ignore_ascii_case(&c))
                .count();
            toks.push(Tok::Code(c.to_ascii_lowercase().to_string().repeat(n)));
            i += n;
        } else if clean[clean.char_indices().nth(i).map(|(b, _)| b).unwrap_or(0)..]
            .starts_with("AM/PM")
        {
            toks.push(Tok::Code("AM/PM".into()));
            i += 5;
        } else if "0#?.,%".contains(c) {
            let s: String = cs[i..]
                .iter()
                .take_while(|&&x| "0#?.,".contains(x))
                .collect();
            if s.is_empty() {
                toks.push(Tok::Code("%".into()));
                i += 1;
            } else {
                i += s.chars().count();
                toks.push(Tok::Code(format!("#{s}")));
            }
        } else if c == 'E' || c == 'e' {
            let s: String = cs[i..]
                .iter()
                .take_while(|&&x| "Ee+-0".contains(x))
                .collect();
            i += s.chars().count();
            toks.push(Tok::Code("E".into()));
        } else {
            toks.push(Tok::Lit(c.to_string()));
            i += 1;
        }
    }
    let is_date = toks.iter().any(|t| matches!(t, Tok::Code(c) if c.starts_with(['d', 'y', 'h', 's']) || (c.starts_with('m') && !c.starts_with('#'))));
    let mut body = String::new();
    let lit = |s: &str| format!("<number:text>{}</number:text>", esc(s));
    if is_date {
        let codes: Vec<&str> = toks
            .iter()
            .filter_map(|t| {
                if let Tok::Code(c) = t {
                    Some(c.as_str())
                } else {
                    None
                }
            })
            .collect();
        let codes: Vec<&str> = codes
            .into_iter()
            .filter(|c| !c.starts_with('#') && *c != "%" && *c != "E")
            .collect();
        let mut ci = 0;
        let mut prev_hour = false;
        let mut any_time = false;
        for t in &toks {
            match t {
                Tok::Lit(s) => body.push_str(&lit(s)),
                // Separators that look like number codes ("." in dd.mm.yyyy).
                Tok::Code(c) if c.starts_with('#') || c == "%" || c == "E" => {
                    body.push_str(&lit(c.trim_start_matches('#')))
                }
                Tok::Code(c) => {
                    let next = codes
                        .iter()
                        .skip(ci + 1)
                        .find(|x| !x.starts_with('#'))
                        .copied()
                        .unwrap_or("");
                    ci += 1;
                    let long = c.len() >= 2;
                    let ls = if long { r#" number:style="long""# } else { "" };
                    match c.chars().next().unwrap() {
                        'y' => body.push_str(&format!(
                            "<number:year{}/>",
                            if c.len() > 2 {
                                r#" number:style="long""#
                            } else {
                                ""
                            }
                        )),
                        'd' if c.len() >= 3 => body.push_str(&format!(
                            "<number:day-of-week{}/>",
                            if c.len() > 3 {
                                r#" number:style="long""#
                            } else {
                                ""
                            }
                        )),
                        'd' => body.push_str(&format!("<number:day{ls}/>")),
                        'm' if prev_hour || next.starts_with('s') => {
                            body.push_str(&format!("<number:minutes{ls}/>"));
                            any_time = true;
                        }
                        'm' if c.len() >= 3 => body.push_str(&format!(
                            r#"<number:month number:textual="true"{}/>"#,
                            if c.len() > 3 {
                                r#" number:style="long""#
                            } else {
                                ""
                            }
                        )),
                        'm' => body.push_str(&format!("<number:month{ls}/>")),
                        'h' => {
                            body.push_str(&format!("<number:hours{ls}/>"));
                            any_time = true;
                        }
                        's' => body.push_str(&format!("<number:seconds{ls}/>")),
                        'A' => body.push_str("<number:am-pm/>"),
                        _ => {}
                    }
                    prev_hour = c.starts_with('h');
                }
            }
        }
        let _ = any_time;
        return (
            format!(r#"<number:date-style style:name="{name}">{body}</number:date-style>"#),
            FmtKind::Date,
        );
    }
    let mut kind = FmtKind::Number;
    let mut has_number = false;
    for t in &toks {
        match t {
            Tok::Lit(s) if ["€", "$", "£", "¥", "EUR", "USD", "CHF"].contains(&s.trim()) => {
                kind = FmtKind::Currency;
                body.push_str(&format!(
                    "<number:currency-symbol>{}</number:currency-symbol>",
                    esc(s.trim())
                ));
            }
            Tok::Lit(s) => body.push_str(&lit(s)),
            Tok::Code(c) if c == "%" => {
                kind = FmtKind::Percent;
                body.push_str(&lit("%"));
            }
            Tok::Code(c) if c == "E" => {}
            Tok::Code(c) if c.starts_with('#') && !has_number => {
                has_number = true;
                let pat = &c[1..];
                let (int, dec) = pat.split_once('.').unwrap_or((pat, ""));
                let dec = dec
                    .chars()
                    .filter(|&x| x == '0' || x == '#' || x == '?')
                    .count();
                let min_int = int.chars().filter(|&x| x == '0').count().min(1);
                let grouping = if int.contains(',') {
                    r#" number:grouping="true""#
                } else {
                    ""
                };
                let sci = clean.contains(['E', 'e']);
                let el = if sci {
                    "number:scientific-number"
                } else {
                    "number:number"
                };
                let exp = if sci {
                    r#" number:min-exponent-digits="2""#
                } else {
                    ""
                };
                body.push_str(&format!(r#"<{el} number:decimal-places="{dec}" number:min-decimal-places="{dec}" number:min-integer-digits="{min_int}"{grouping}{exp}/>"#));
            }
            Tok::Code(_) => {}
        }
    }
    let el = match kind {
        FmtKind::Percent => "number:percentage-style",
        FmtKind::Currency => "number:currency-style",
        _ => "number:number-style",
    };
    (format!(r#"<{el} style:name="{name}">{body}</{el}>"#), kind)
}

// ----------------------------------------------------------------- dates --

/// Days since 1970-01-01 → (year, month, day).
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn days(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Serial date (1899-12-30 based) → ISO date-time.
fn serial_to_iso(v: f64) -> String {
    let day = v.floor();
    let (y, m, d) = civil(day as i64 - 25_569);
    let secs = ((v - day) * 86_400.0).round() as i64;
    if secs == 0 {
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        format!(
            "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
            secs / 3600,
            secs / 60 % 60,
            secs % 60
        )
    }
}

fn iso_to_serial(s: &str) -> Option<f64> {
    let (date, time) = s.split_once('T').unwrap_or((s, ""));
    let mut it = date.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let d: u32 = it.next()?.parse().ok()?;
    let mut v = (days(y, m, d) + 25_569) as f64;
    if !time.is_empty() {
        let t: Vec<f64> = time
            .trim_end_matches('Z')
            .split(':')
            .filter_map(|x| x.parse().ok())
            .collect();
        v += (t.first().unwrap_or(&0.0) * 3600.0
            + t.get(1).unwrap_or(&0.0) * 60.0
            + t.get(2).unwrap_or(&0.0))
            / 86_400.0;
    }
    Some(v)
}

/// `PT12H30M00S` → fraction of a day.
fn duration_to_serial(s: &str) -> Option<f64> {
    let s = s.strip_prefix("PT").or_else(|| s.strip_prefix("-PT"))?;
    let mut total = 0.0;
    let mut num = String::new();
    for c in s.chars() {
        match c {
            'H' => total += num.parse::<f64>().ok()? * 3600.0,
            'M' => total += num.parse::<f64>().ok()? * 60.0,
            'S' => total += num.parse::<f64>().ok()?,
            _ => {
                num.push(c);
                continue;
            }
        }
        num.clear();
    }
    Some(total / 86_400.0)
}

// --------------------------------------------------------------- reading --

fn border(v: &str) -> Option<String> {
    if v == "none" || v.is_empty() {
        return None;
    }
    let w = v.split_whitespace().find_map(odf::pt).unwrap_or(0.75);
    Some(
        if v.contains("double") {
            "double"
        } else if v.contains("dashed") {
            "dashed"
        } else if v.contains("dotted") {
            "dotted"
        } else if w >= 2.4 {
            "thick"
        } else if w >= 1.4 {
            "medium"
        } else {
            "thin"
        }
        .into(),
    )
}

fn cell_style(st: &Styles, name: Option<&str>) -> CellStyle {
    let g = |a: &str| st.get("table-cell", name, a);
    let mut s = CellStyle {
        bold: g("fo:font-weight")
            .is_some_and(|w| w == "bold" || w.parse::<u32>().is_ok_and(|v| v >= 600)),
        italic: g("fo:font-style").is_some_and(|v| v == "italic" || v == "oblique"),
        underline: g("style:text-underline-style").is_some_and(|v| v != "none"),
        strike: g("style:text-line-through-style").is_some_and(|v| v != "none"),
        // The document's default font is the model's default (no font set).
        font: st
            .font("table-cell", name)
            .filter(|f| Some(f) != st.font("table-cell", Some("Default")).as_ref()),
        size10: g("fo:font-size")
            .filter(|v| Some(*v) != st.get("table-cell", Some("Default"), "fo:font-size"))
            .and_then(odf::pt)
            .map(|v| (v * 10.0).round() as u32),
        color: g("fo:color")
            .and_then(odf::color)
            .filter(|c| c != "#000000"),
        fill: g("fo:background-color").and_then(odf::color),
        h_align: match g("fo:text-align") {
            Some("center") => Some("center".into()),
            Some("end" | "right") => Some("right".into()),
            Some("justify") => Some("justify".into()),
            Some("start" | "left") if g("style:text-align-source") == Some("fix") => {
                Some("left".into())
            }
            _ => None,
        },
        v_align: match g("style:vertical-align") {
            Some("top") => Some("top".into()),
            Some("middle") => Some("middle".into()),
            _ => None,
        },
        wrap: g("fo:wrap-option") == Some("wrap"),
        num_fmt: None,
        border_top: g("fo:border-top").or(g("fo:border")).and_then(border),
        border_bottom: g("fo:border-bottom").or(g("fo:border")).and_then(border),
        border_left: g("fo:border-left").or(g("fo:border")).and_then(border),
        border_right: g("fo:border-right").or(g("fo:border")).and_then(border),
        indent: g("fo:margin-left")
            .and_then(odf::mm)
            .map(|v| (v / 3.0).round() as u32)
            .filter(|&v| v > 0),
    };
    // Data style of the style or its parents.
    let mut cur = name;
    for _ in 0..16 {
        let Some(def) = cur.and_then(|n| st.style("table-cell", n)) else {
            break;
        };
        if let Some(ds) = &def.data_style {
            s.num_fmt = st.number_styles.get(ds).and_then(excel_format);
            break;
        }
        cur = def.parent.as_deref();
    }
    s
}

struct SheetView {
    freeze_cols: u32,
    freeze_rows: u32,
    show_grid: Option<bool>,
}

/// Freeze panes, grid and the active sheet from settings.xml.
fn read_settings(doc: &OdfDoc) -> (HashMap<String, SheetView>, Option<String>) {
    let mut out = HashMap::new();
    let mut active = None;
    let Some(s) = doc.pkg.xml("settings.xml").ok().flatten() else {
        return (out, None);
    };
    let mut maps = Vec::new();
    s.find_all("config:config-item-map-named", &mut maps);
    for m in maps
        .into_iter()
        .filter(|m| m.attr("config:name") == Some("Tables"))
    {
        for e in m.children_named("config:config-item-map-entry") {
            let Some(name) = e.attr("config:name") else {
                continue;
            };
            let item = |n: &str| {
                e.children_named("config:config-item")
                    .find(|i| i.attr("config:name") == Some(n))
                    .map(|i| i.text())
            };
            let num = |n: &str| {
                item(n)
                    .and_then(|v| v.trim().parse::<u32>().ok())
                    .unwrap_or(0)
            };
            let frozen = |mode: &str| item(mode).as_deref().map(str::trim) == Some("2");
            out.insert(
                name.to_string(),
                SheetView {
                    freeze_cols: if frozen("HorizontalSplitMode") {
                        num("HorizontalSplitPosition")
                    } else {
                        0
                    },
                    freeze_rows: if frozen("VerticalSplitMode") {
                        num("VerticalSplitPosition")
                    } else {
                        0
                    },
                    show_grid: item("ShowGrid").map(|v| v.trim() == "true"),
                },
            );
        }
    }
    let mut items = Vec::new();
    s.find_all("config:config-item", &mut items);
    if let Some(a) = items
        .iter()
        .find(|i| i.attr("config:name") == Some("ActiveTable"))
    {
        active = Some(a.text());
    }
    (out, active)
}

/// Parse an .ods file.
pub fn read(bytes: &[u8]) -> Result<Loaded> {
    let doc = OdfDoc::open(bytes, odf::MIME_SHEET, "Tabellendokument")?;
    let st = doc.styles();
    let mut warnings = BTreeSet::new();
    let mut wb = Workbook {
        sheets: Vec::new(),
        styles: vec![CellStyle::default()],
        ..Default::default()
    };
    (wb.title, wb.author) = doc.meta();
    let mut style_index: HashMap<CellStyle, usize> = HashMap::from([(CellStyle::default(), 0)]);
    let mut by_name: HashMap<String, usize> = HashMap::new();
    let mut intern = |name: Option<&str>, wb: &mut Workbook| -> usize {
        let Some(n) = name else { return 0 };
        if let Some(&i) = by_name.get(n) {
            return i;
        }
        let cs = cell_style(&st, Some(n));
        let i = *style_index.entry(cs.clone()).or_insert_with(|| {
            wb.styles.push(cs);
            wb.styles.len() - 1
        });
        by_name.insert(n.to_string(), i);
        i
    };
    let (views, active) = read_settings(&doc);
    let body = doc
        .content
        .child("office:body")
        .and_then(|b| b.child("office:spreadsheet"));
    // Data validations by name.
    let mut val_defs: HashMap<String, Validation> = HashMap::new();
    if let Some(cv) = body.and_then(|b| b.child("table:content-validations")) {
        for v in cv.children_named("table:content-validation") {
            match (v.attr("table:name"), parse_validation(v)) {
                (Some(n), Some(val)) => {
                    val_defs.insert(n.to_string(), val);
                }
                _ => {
                    warnings.insert("Einige Datenüberprüfungen werden nicht übernommen.".into());
                }
            }
        }
    }
    for t in body
        .map(|b| b.children_named("table:table").collect::<Vec<_>>())
        .unwrap_or_default()
    {
        let mut sheet = Sheet::new(t.attr("table:name").unwrap_or("Tabelle"));
        let mut val_cells: BTreeMap<String, Vec<(u32, u32)>> = BTreeMap::new();
        let mut frames: Vec<(u32, u32, &Element)> = Vec::new();
        // Columns (with their default cell styles).
        let mut col_defaults: Vec<Option<String>> = Vec::new();
        let mut cols = Vec::new();
        collect_named(
            t,
            &["table:table-column"],
            &[
                "table:table-columns",
                "table:table-header-columns",
                "table:table-column-group",
            ],
            &mut cols,
        );
        let mut c = 0u32;
        for col in cols {
            let n = col
                .attr("table:number-columns-repeated")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(1);
            let w = st
                .get(
                    "table-column",
                    col.attr("table:style-name"),
                    "style:column-width",
                )
                .and_then(odf::px);
            let hidden = col.attr("table:visibility") == Some("collapse");
            for k in 0..n.min(1024) {
                let ci = c + k;
                if let Some(w) = w.filter(|w| (w - 64.0).abs() > 1.0) {
                    sheet.cols.insert(ci, (w * 10.0).round() / 10.0);
                }
                if hidden {
                    sheet.hidden_cols.push(ci);
                }
                col_defaults.push(
                    col.attr("table:default-cell-style-name")
                        .filter(|s| *s != "Default")
                        .map(String::from),
                );
            }
            c = c.saturating_add(n);
        }
        // Rows.
        let mut rows = Vec::new();
        collect_named(
            t,
            &["table:table-row"],
            &[
                "table:table-rows",
                "table:table-header-rows",
                "table:table-row-group",
            ],
            &mut rows,
        );
        let mut r = 0u32;
        let mut max_used = 0u32;
        let mut matrix_ranges: Vec<(u32, u32, u32, u32)> = Vec::new();
        for row in rows {
            let n = row
                .attr("table:number-rows-repeated")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(1);
            let rs = row.attr("table:style-name");
            let height = st
                .get("table-row", rs, "style:row-height")
                .and_then(odf::px)
                .filter(|_| {
                    st.get("table-row", rs, "style:use-optimal-row-height") == Some("false")
                });
            let hidden = row.attr("table:visibility") == Some("collapse");
            let cells: Vec<&Element> = row
                .elements()
                .filter(|e| e.name == "table:table-cell" || e.name == "table:covered-table-cell")
                .collect();
            let has_content = cells.iter().any(|c| {
                c.attr("office:value-type").is_some()
                    || c.attr("table:formula").is_some()
                    || c.child("text:p").is_some()
            });
            // Long runs of empty rows (to the end of the sheet) are skipped.
            let reps = if has_content || n < 1000 {
                n.min(MAX_ROWS - r.min(MAX_ROWS))
            } else {
                0
            };
            for k in 0..reps {
                let ri = r + k;
                if let Some(h) = height {
                    sheet.rows.insert(ri, (h * 10.0).round() / 10.0);
                }
                if hidden {
                    sheet.hidden_rows.push(ri);
                }
                let mut c = 0u32;
                for cell in &cells {
                    let cn = cell
                        .attr("table:number-columns-repeated")
                        .and_then(|v| v.parse::<u32>().ok())
                        .unwrap_or(1);
                    if cell.name == "table:covered-table-cell" {
                        c = c.saturating_add(cn);
                        continue;
                    }
                    let style_name = cell
                        .attr("table:style-name")
                        .map(String::from)
                        .or_else(|| col_defaults.get(c as usize).cloned().flatten());
                    let s = intern(style_name.as_deref(), &mut wb);
                    let value = cell_value(cell);
                    let f = cell.attr("table:formula").map(from_openformula);
                    // Array (matrix) formulas: the covered results are recalculated.
                    let mrows = cell.attr("table:number-matrix-rows-spanned").and_then(|v| v.parse::<u32>().ok()).unwrap_or(1);
                    let mcols = cell.attr("table:number-matrix-columns-spanned").and_then(|v| v.parse::<u32>().ok()).unwrap_or(1);
                    let spill = (f.is_some() && (mrows > 1 || mcols > 1)).then(|| {
                        matrix_ranges.push((ri, c, ri + mrows - 1, c + mcols - 1));
                        format!("{}:{}", cell_ref(ri, c), cell_ref(ri + mrows - 1, c + mcols - 1))
                    });
                    let filled = value.is_some() || f.is_some();
                    if filled || (s != 0 && cn <= 256) {
                        for j in 0..cn.min(MAX_COLS - c.min(MAX_COLS)) {
                            let (v, e) = match &value {
                                Some(Value::Text(t))
                                    if f.is_some()
                                        && t.starts_with('#')
                                        && (t.ends_with('!')
                                            || t.ends_with('?')
                                            || t == "#N/A") =>
                                {
                                    (None, Some(t.clone()))
                                }
                                v => (v.clone(), None),
                            };
                            sheet.cells.insert(
                                cell_ref(ri, c + j),
                                Cell {
                                    v,
                                    f: f.clone(),
                                    e,
                                    s,
                                    spill: spill.clone(),
                                },
                            );
                        }
                        if filled {
                            max_used = max_used.max(ri);
                        }
                    }
                    let span = |a: &str| {
                        cell.attr(a)
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(1)
                    };
                    let (cs, rs) = (
                        span("table:number-columns-spanned"),
                        span("table:number-rows-spanned"),
                    );
                    if cs > 1 || rs > 1 {
                        sheet.merges.push(format!(
                            "{}:{}",
                            cell_ref(ri, c),
                            cell_ref(ri + rs - 1, c + cs - 1)
                        ));
                    }
                    if cell.child("office:annotation").is_some() {
                        warnings.insert("Zellkommentare werden nicht übernommen.".into());
                    }
                    if k == 0 {
                        for f in cell.children_named("draw:frame") {
                            frames.push((ri, c, f));
                        }
                    }
                    if let Some(vn) = cell.attr("table:content-validation-name") {
                        let list = val_cells.entry(vn.to_string()).or_default();
                        for j in 0..cn.min(MAX_COLS - c.min(MAX_COLS)) {
                            if list.len() < 50_000 {
                                list.push((ri, c + j));
                            }
                        }
                    }
                    c = c.saturating_add(cn);
                }
            }
            r = r.saturating_add(n);
        }
        let _ = max_used;
        // Pictures and charts: in cells (offset from the cell) or on the page.
        let mut page_frames: Vec<&Element> = Vec::new();
        if let Some(sh) = t.child("table:shapes") {
            page_frames.extend(sh.children_named("draw:frame"));
        }
        let placed = frames
            .into_iter()
            .map(|(r, c, f)| (Some((r, c)), f))
            .chain(page_frames.into_iter().map(|f| (None, f)))
            .collect::<Vec<_>>();
        for (at, f) in placed {
            let n = |a: &str| f.attr(a).and_then(odf::px).unwrap_or(0.0);
            let (x, y, w, h) = (n("svg:x"), n("svg:y"), n("svg:width"), n("svg:height"));
            let anchor = match at {
                Some((r, c)) => Anchor {
                    col: c,
                    row: r,
                    dx: x,
                    dy: y,
                    w,
                    h,
                },
                None => {
                    let (col, dx) = sheet.walk(true, 0, x);
                    let (row, dy) = sheet.walk(false, 0, y);
                    Anchor {
                        col,
                        row,
                        dx,
                        dy,
                        w,
                        h,
                    }
                }
            };
            let r1 = |v: f64| (v * 10.0).round() / 10.0;
            let anchor = Anchor {
                dx: r1(anchor.dx),
                dy: r1(anchor.dy),
                w: r1(anchor.w),
                h: r1(anchor.h),
                ..anchor
            };
            if let Some(obj) = f.child("draw:object") {
                match obj.attr("xlink:href").and_then(|h| read_chart(&doc, h)) {
                    Some(chart) => sheet.charts.push(SheetChart { chart, anchor }),
                    None => {
                        warnings
                            .insert("Einige eingebettete Objekte werden nicht angezeigt.".into());
                    }
                }
            } else if let Some(img) = f.child("draw:image") {
                match img
                    .attr("xlink:href")
                    .and_then(|h| doc.data_url(h))
                    .filter(|u| u.starts_with("data:image/") && !u.starts_with("data:image/x-"))
                {
                    Some(src) => sheet.images.push(SheetImage {
                        src,
                        anchor,
                        name: f.attr("draw:name").map(String::from),
                    }),
                    None => {
                        warnings.insert("Einige Bilder werden nicht angezeigt.".into());
                    }
                }
            }
        }
        for (name, mut cells) in val_cells {
            if let Some(v) = val_defs.get(&name) {
                sheet.validations.push(Validation {
                    range: cells_to_ranges(&mut cells),
                    ..v.clone()
                });
            }
        }
        // Conditional formatting (calcext).
        if let Some(cfs) = t.child("calcext:conditional-formats") {
            for cf in cfs.children_named("calcext:conditional-format") {
                let (_, range) =
                    model_ranges(cf.attr("calcext:target-range-address").unwrap_or_default());
                let mut rules = Vec::new();
                for e in cf.elements() {
                    match e.name.as_str() {
                        "calcext:condition" => {
                            match e.attr("calcext:value").and_then(parse_cond_value) {
                                Some(mut rule) => {
                                    let sn = e.attr("calcext:apply-style-name").unwrap_or_default();
                                    let key = st
                                        .map
                                        .iter()
                                        .find(|((fam, n), d)| {
                                            fam == "table-cell" && (n == sn || d.display == sn)
                                        })
                                        .map(|((_, n), _)| n.clone());
                                    rule.style = key.map(|k| cell_style(&st, Some(&k)));
                                    rules.push(rule);
                                }
                                None => {
                                    warnings.insert("Einige Regeln der bedingten Formatierung werden nicht unterstützt.".into());
                                }
                            }
                        }
                        "calcext:color-scale" => rules.push(CondRule {
                            kind: "colorScale".into(),
                            colors: e
                                .children_named("calcext:color-scale-entry")
                                .filter_map(|x| x.attr("calcext:color").and_then(odf::color))
                                .collect(),
                            ..Default::default()
                        }),
                        "calcext:data-bar" => rules.push(CondRule {
                            kind: "dataBar".into(),
                            colors: e
                                .attr("calcext:positive-color")
                                .and_then(odf::color)
                                .into_iter()
                                .collect(),
                            ..Default::default()
                        }),
                        _ => {
                            warnings.insert("Symbolsätze und Datumsregeln der bedingten Formatierung werden nicht unterstützt.".into());
                        }
                    }
                }
                if !rules.is_empty() && !range.is_empty() {
                    sheet.cond_formats.push(CondFormat { range, rules });
                }
            }
        }
        if let Some(groups) = t.child("calcext:sparkline-groups") {
            for g in groups.children_named("calcext:sparkline-group") {
                let kind = match g.attr("calcext:type") {
                    Some("column") => "column",
                    Some("stacked") => "stacked",
                    _ => "line",
                };
                let mut list = Vec::new();
                g.find_all("calcext:sparkline", &mut list);
                for sp in list {
                    let (Some(cell), Some(src)) = (
                        sp.attr("calcext:cell-address"),
                        sp.attr("calcext:data-range"),
                    ) else {
                        continue;
                    };
                    sheet.sparklines.push(Sparkline {
                        cell: model_ranges(cell).1,
                        source: odf_ref(src).replace('$', ""),
                        kind: kind.into(),
                        color: g.attr("calcext:color-series").and_then(odf::color),
                        negative_color: g.attr("calcext:color-negative").and_then(odf::color),
                        markers: g.attr("calcext:markers") == Some("true"),
                    });
                }
            }
        }
        if let Some(v) = views.get(&sheet.name) {
            sheet.freeze_cols = v.freeze_cols;
            sheet.freeze_rows = v.freeze_rows;
            if let Some(g) = v.show_grid {
                sheet.show_grid = g;
            }
        }
        for (r1, c1, r2, c2) in matrix_ranges {
            for rr in r1..=r2 {
                for cc in c1..=c2 {
                    let k = cell_ref(rr, cc);
                    if (rr, cc) != (r1, c1)
                        && let Some(cell) = sheet.cells.get_mut(&k)
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
        wb.sheets.push(sheet);
    }
    if wb.sheets.is_empty() {
        wb.sheets.push(Sheet::new("Tabelle1"));
    }
    if let Some(a) = active {
        wb.active = wb.sheets.iter().position(|s| s.name == a).unwrap_or(0);
    }
    // Named ranges.
    if let Some(ne) = body.and_then(|b| b.child("table:named-expressions")) {
        for n in ne.elements() {
            let (Some(name), Some(r)) = (
                n.attr("table:name"),
                n.attr("table:cell-range-address")
                    .or_else(|| n.attr("table:expression")),
            ) else {
                continue;
            };
            let formula = if n.name == "table:named-range" {
                odf_ref(r)
            } else {
                from_openformula(r)
            };
            wb.names.push(DefinedName {
                name: name.to_string(),
                formula,
                sheet: None,
            });
        }
    }
    // Auto filters (database ranges with filter buttons).
    for d in body
        .and_then(|b| b.child("table:database-ranges"))
        .map(|d| d.children_named("table:database-range").collect::<Vec<_>>())
        .unwrap_or_default()
    {
        if d.attr("table:display-filter-buttons") != Some("true") {
            continue;
        }
        let (sheet_name, range) =
            model_ranges(d.attr("table:target-range-address").unwrap_or_default());
        let Some(sheet) = wb
            .sheets
            .iter_mut()
            .find(|s| Some(&s.name) == sheet_name.as_ref())
        else {
            continue;
        };
        let start = range
            .split(':')
            .next()
            .and_then(parse_ref)
            .map(|(_, c)| c)
            .unwrap_or(0);
        let mut conds = Vec::new();
        d.find_all("table:filter-condition", &mut conds);
        let columns = conds
            .iter()
            .filter(|c| c.attr("table:operator") == Some("="))
            .map(|c| {
                let items: Vec<String> = c
                    .children_named("table:filter-set-item")
                    .filter_map(|i| i.attr("table:value").map(String::from))
                    .collect();
                FilterColumn {
                    col: start
                        + c.attr("table:field-number")
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(0),
                    values: if items.is_empty() {
                        c.attr("table:value")
                            .map(String::from)
                            .into_iter()
                            .collect()
                    } else {
                        items
                    },
                }
            })
            .collect();
        sheet.auto_filter = Some(AutoFilter { range, columns });
    }
    fill_chart_values(&mut wb);
    Ok(Loaded {
        workbook: wb,
        warnings: warnings.into_iter().collect(),
    })
}

/// Elements named `names`, also inside the wrapper elements `wrappers`.
fn collect_named<'e>(
    e: &'e Element,
    names: &[&str],
    wrappers: &[&str],
    out: &mut Vec<&'e Element>,
) {
    for c in e.elements() {
        if names.contains(&c.name.as_str()) {
            out.push(c);
        } else if wrappers.contains(&c.name.as_str()) {
            collect_named(c, names, wrappers, out);
        }
    }
}

fn cell_value(c: &Element) -> Option<Value> {
    let num = |a: &str| c.attr(a).and_then(|v| v.parse::<f64>().ok());
    match c.attr("office:value-type") {
        Some("float" | "percentage" | "currency") => num("office:value").map(Value::Number),
        Some("date") => c
            .attr("office:date-value")
            .and_then(iso_to_serial)
            .map(Value::Number),
        Some("time") => c
            .attr("office:time-value")
            .and_then(duration_to_serial)
            .map(Value::Number),
        Some("boolean") => c
            .attr("office:boolean-value")
            .map(|v| Value::Bool(v == "true" || v == "1")),
        _ => {
            let paras: Vec<String> = c.children_named("text:p").map(odf::plain_text).collect();
            let text = c
                .attr("office:string-value")
                .map(String::from)
                .unwrap_or_else(|| paras.join("\n"));
            (!text.is_empty()).then_some(Value::Text(text))
        }
    }
}

// --------------------------------------------------------------- writing --

/// What a save as .ods cannot keep (everything the model has is kept).
pub fn losses(_wb: &Workbook) -> Vec<String> {
    Vec::new()
}

fn border_xml(b: &Option<String>) -> String {
    match b.as_deref() {
        Some("medium") => "1.5pt solid #000000".into(),
        Some("thick") => "2.5pt solid #000000".into(),
        Some("double") => "2.6pt double #000000".into(),
        Some("dashed") => "0.75pt dashed #000000".into(),
        Some("dotted") => "0.75pt dotted #000000".into(),
        Some(_) => "0.75pt solid #000000".into(),
        None => "none".into(),
    }
}

/// Property elements of a cell style.
fn cell_style_body(cs: &CellStyle, fonts: &mut BTreeSet<String>) -> String {
    let mut cell = String::new();
    if let Some(f) = &cs.fill {
        cell.push_str(&format!(r#" fo:background-color="{}""#, esc_attr(f)));
    }
    if cs.wrap {
        cell.push_str(r#" fo:wrap-option="wrap""#);
    }
    match cs.v_align.as_deref() {
        Some("top") => cell.push_str(r#" style:vertical-align="top""#),
        Some("middle") => cell.push_str(r#" style:vertical-align="middle""#),
        _ => {}
    }
    for (side, b) in [
        ("top", &cs.border_top),
        ("bottom", &cs.border_bottom),
        ("left", &cs.border_left),
        ("right", &cs.border_right),
    ] {
        if b.is_some() {
            cell.push_str(&format!(r#" fo:border-{side}="{}""#, border_xml(b)));
        }
    }
    if cs.h_align.is_some() {
        cell.push_str(r#" style:text-align-source="fix" style:repeat-content="false""#);
    }
    let mut para = String::new();
    match cs.h_align.as_deref() {
        Some("center") => para.push_str(r#" fo:text-align="center""#),
        Some("right") => para.push_str(r#" fo:text-align="end""#),
        Some("justify") => para.push_str(r#" fo:text-align="justify""#),
        Some(_) => para.push_str(r#" fo:text-align="start""#),
        None => {}
    }
    if let Some(n) = cs.indent {
        para.push_str(&format!(r#" fo:margin-left="{}""#, odf::cm(n as f64 * 3.0)));
    }
    let mut text = String::new();
    if cs.bold {
        text.push_str(r#" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold""#);
    }
    if cs.italic {
        text.push_str(r#" fo:font-style="italic""#);
    }
    if cs.underline {
        text.push_str(r#" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color""#);
    }
    if cs.strike {
        text.push_str(r#" style:text-line-through-style="solid""#);
    }
    if let Some(f) = &cs.font {
        fonts.insert(f.clone());
        text.push_str(&format!(r#" style:font-name="{}""#, esc_attr(f)));
    }
    if let Some(s) = cs.size10 {
        text.push_str(&format!(r#" fo:font-size="{}pt""#, s as f64 / 10.0));
    }
    if let Some(c) = &cs.color {
        text.push_str(&format!(r#" fo:color="{}""#, esc_attr(c)));
    }
    let mut body = String::new();
    if !cell.is_empty() {
        body.push_str(&format!("<style:table-cell-properties{cell}/>"));
    }
    if !para.is_empty() {
        body.push_str(&format!("<style:paragraph-properties{para}/>"));
    }
    if !text.is_empty() {
        body.push_str(&format!("<style:text-properties{text}/>"));
    }
    body
}

/// Serialise a workbook as .ods.
pub fn write(wb: &Workbook) -> Result<Vec<u8>> {
    let mut auto = AutoStyles::new("s");
    let mut fonts: BTreeSet<String> = BTreeSet::from(["Calibri".to_string()]);
    let mut numbers = String::new();
    // Cell styles by index.
    let mut cell_styles = Vec::new();
    let mut kinds = Vec::new();
    for (i, cs) in wb.styles.iter().enumerate() {
        let mut data = String::new();
        let mut kind = FmtKind::Number;
        if let Some(code) = cs
            .num_fmt
            .as_deref()
            .filter(|c| *c != "General" && *c != "@")
        {
            let (xml, k) = odf_format(&format!("N{}", i + 1), code);
            numbers.push_str(&xml);
            data = format!(r#" style:data-style-name="N{}""#, i + 1);
            kind = k;
        }
        kinds.push(kind);
        if *cs == CellStyle::default() && data.is_empty() {
            cell_styles.push(None);
            continue;
        }
        let body = cell_style_body(cs, &mut fonts);
        cell_styles.push(Some(auto.get(
            "table-cell",
            &format!(r#" style:parent-style-name="Default"{data}"#),
            &body,
        )));
    }

    let mut tables = String::new();
    // Sheet objects, validations, conditional styles and filters.
    let mut extras: Vec<Extra> = Vec::new();
    let mut dirs: Vec<(String, String)> = Vec::new();
    let mut validations = String::new();
    let mut cond_styles = String::new();
    let mut db_ranges = String::new();
    let (mut n_val, mut n_cond, mut n_obj, mut n_img, mut n_spark) = (0, 0, 0, 0, 0);
    for sheet in &wb.sheets {
        let cells: BTreeMap<(u32, u32), &Cell> = sheet
            .cells
            .iter()
            .filter_map(|(k, v)| parse_ref(k).map(|rc| (rc, v)))
            .collect();
        let max_row = cells
            .keys()
            .map(|k| k.0)
            .chain(sheet.rows.keys().copied())
            .max()
            .unwrap_or(0);
        let max_col = cells
            .keys()
            .map(|k| k.1)
            .chain(sheet.cols.keys().copied())
            .max()
            .unwrap_or(0);
        // Merges: top-left → spans; covered cells.
        let mut spans: HashMap<(u32, u32), (u32, u32)> = HashMap::new();
        let mut covered: BTreeSet<(u32, u32)> = BTreeSet::new();
        for m in &sheet.merges {
            let Some((a, b)) = m.split_once(':') else {
                continue;
            };
            let (Some((r1, c1)), Some((r2, c2))) = (parse_ref(a), parse_ref(b)) else {
                continue;
            };
            spans.insert((r1, c1), (c2 - c1 + 1, r2 - r1 + 1));
            for r in r1..=r2 {
                for c in c1..=c2 {
                    if (r, c) != (r1, c1) {
                        covered.insert((r, c));
                    }
                }
            }
        }
        // Cell extras: (attributes, content) by position.
        let mut extra: BTreeMap<(u32, u32), (String, String)> = BTreeMap::new();
        for v in &sheet.validations {
            n_val += 1;
            let name = format!("val{n_val}");
            let mut cells = range_cells(&v.range, 20_000);
            let Some(&(r0, c0)) = cells.iter().min() else {
                continue;
            };
            validations.push_str(&validation_xml(
                &name,
                v,
                &odf_range(&cell_ref(r0, c0), &sheet.name),
            ));
            for rc in cells.drain(..) {
                extra
                    .entry(rc)
                    .or_default()
                    .0
                    .push_str(&format!(r#" table:content-validation-name="{name}""#));
            }
        }
        let frame_pos = |a: &Anchor| {
            format!(
                r#" svg:x="{}" svg:y="{}" svg:width="{}" svg:height="{}""#,
                odf::cm_px(a.dx),
                odf::cm_px(a.dy),
                odf::cm_px(a.w.max(1.0)),
                odf::cm_px(a.h.max(1.0))
            )
        };
        for img in &sheet.images {
            let Some((mime, data)) = crate::package::parse_data_url(&img.src) else {
                continue;
            };
            n_img += 1;
            let path = format!("Pictures/image{n_img}.{}", crate::package::ext_for(&mime));
            extras.push(Extra {
                path: path.clone(),
                mime,
                data,
            });
            let name = img.name.clone().unwrap_or_else(|| format!("Bild {n_img}"));
            extra.entry((img.anchor.row, img.anchor.col)).or_default().1.push_str(&format!(
                r#"<draw:frame draw:name="{}"{}{} draw:z-index="{}"><draw:image xlink:href="{path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"><text:p/></draw:image></draw:frame>"#,
                esc_attr(&name),
                "",
                frame_pos(&img.anchor),
                n_img + n_obj
            ));
        }
        for ch in &sheet.charts {
            n_obj += 1;
            let dir = format!("Object {n_obj}");
            extras.push(Extra {
                path: format!("{dir}/content.xml"),
                mime: "text/xml".into(),
                data: chart_content(&ch.chart, ch.anchor.w, ch.anchor.h, &sheet.name).into_bytes(),
            });
            extras.push(Extra {
                path: format!("{dir}/styles.xml"),
                mime: "text/xml".into(),
                data: format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {}/>"#,
                    odf::NS
                )
                .into_bytes(),
            });
            dirs.push((
                format!("{dir}/"),
                "application/vnd.oasis.opendocument.chart".into(),
            ));
            let ranges: Vec<String> = ch
                .chart
                .series
                .iter()
                .flat_map(|s| [&s.cat_ref, &s.name_ref, &s.val_ref])
                .flatten()
                .map(|r| odf_range(r, &sheet.name))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            extra.entry((ch.anchor.row, ch.anchor.col)).or_default().1.push_str(&format!(
                r#"<draw:frame draw:name="Diagramm {n_obj}"{}{} draw:z-index="{}"><draw:object draw:notify-on-update-of-ranges="{}" xlink:href="./{dir}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"><loext:p/></draw:object></draw:frame>"#,
                "",
                frame_pos(&ch.anchor),
                n_img + n_obj,
                esc_attr(&ranges.join(" ")),
            ));
        }
        let max_row = max_row.max(extra.keys().map(|k| k.0).max().unwrap_or(0));
        let max_col = max_col.max(extra.keys().map(|k| k.1).max().unwrap_or(0));
        let tstyle = auto.get(
            "table",
            r#" style:master-page-name="Default""#,
            r#"<style:table-properties table:display="true" style:writing-mode="lr-tb"/>"#,
        );
        let mut out = format!(
            r#"<table:table table:name="{}" table:style-name="{tstyle}">"#,
            esc_attr(&sheet.name)
        );
        // Columns, merging equal neighbours.
        let mut c = 0;
        while c <= max_col {
            let w = sheet.cols.get(&c).copied().unwrap_or(64.0);
            let hidden = sheet.hidden_cols.contains(&c);
            let mut n = 1;
            while c + n <= max_col
                && sheet.cols.get(&(c + n)).copied().unwrap_or(64.0) == w
                && sheet.hidden_cols.contains(&(c + n)) == hidden
            {
                n += 1;
            }
            let cs = auto.get("table-column", "", &format!(r#"<style:table-column-properties fo:break-before="auto" style:column-width="{}"/>"#, odf::cm_px(w)));
            let rep = if n > 1 {
                format!(r#" table:number-columns-repeated="{n}""#)
            } else {
                String::new()
            };
            let vis = if hidden {
                r#" table:visibility="collapse""#
            } else {
                ""
            };
            out.push_str(&format!(r#"<table:table-column table:style-name="{cs}"{rep}{vis} table:default-cell-style-name="Default"/>"#));
            c += n;
        }
        // Rows.
        let mut r = 0;
        while r <= max_row {
            let h = sheet.rows.get(&r).copied();
            let hidden = sheet.hidden_rows.contains(&r);
            let row_cells: Vec<(u32, &Cell)> = cells
                .range((r, 0)..(r, MAX_COLS))
                .map(|(k, v)| (k.1, *v))
                .collect();
            let has_cov = covered.range((r, 0)..(r, MAX_COLS)).next().is_some();
            let rs = match h {
                Some(h) => auto.get("table-row", "", &format!(r#"<style:table-row-properties style:row-height="{}" style:use-optimal-row-height="false" fo:break-before="auto"/>"#, odf::cm_px(h))),
                None => auto.get("table-row", "", r#"<style:table-row-properties style:row-height="0.452cm" style:use-optimal-row-height="true" fo:break-before="auto"/>"#),
            };
            let vis = if hidden {
                r#" table:visibility="collapse""#
            } else {
                ""
            };
            let has_extra = extra.range((r, 0)..(r, MAX_COLS)).next().is_some();
            if row_cells.is_empty() && !has_cov && !has_extra {
                // Repeat identical empty rows.
                let mut n = 1;
                while r + n <= max_row
                    && sheet.rows.get(&(r + n)).copied() == h
                    && sheet.hidden_rows.contains(&(r + n)) == hidden
                    && cells.range((r + n, 0)..(r + n, MAX_COLS)).next().is_none()
                    && covered
                        .range((r + n, 0)..(r + n, MAX_COLS))
                        .next()
                        .is_none()
                    && extra.range((r + n, 0)..(r + n, MAX_COLS)).next().is_none()
                {
                    n += 1;
                }
                let rep = if n > 1 {
                    format!(r#" table:number-rows-repeated="{n}""#)
                } else {
                    String::new()
                };
                out.push_str(&format!(r#"<table:table-row table:style-name="{rs}"{rep}{vis}><table:table-cell table:number-columns-repeated="{}"/></table:table-row>"#, max_col + 1));
                r += n;
                continue;
            }
            out.push_str(&format!(
                r#"<table:table-row table:style-name="{rs}"{vis}>"#
            ));
            let by_col: HashMap<u32, &Cell> = row_cells.into_iter().collect();
            let mut c = 0;
            let mut empty = 0;
            let flush = |out: &mut String, empty: &mut u32| {
                if *empty > 0 {
                    let rep = if *empty > 1 {
                        format!(r#" table:number-columns-repeated="{empty}""#)
                    } else {
                        String::new()
                    };
                    out.push_str(&format!("<table:table-cell{rep}/>"));
                    *empty = 0;
                }
            };
            while c <= max_col {
                if covered.contains(&(r, c)) {
                    flush(&mut out, &mut empty);
                    out.push_str("<table:covered-table-cell/>");
                    c += 1;
                    continue;
                }
                let (ex_attrs, ex_inner) = extra.get(&(r, c)).cloned().unwrap_or_default();
                let Some(cell) = by_col.get(&c) else {
                    if ex_attrs.is_empty() && ex_inner.is_empty() {
                        empty += 1;
                    } else {
                        flush(&mut out, &mut empty);
                        out.push_str(&format!(
                            "<table:table-cell{ex_attrs}>{ex_inner}</table:table-cell>"
                        ));
                    }
                    c += 1;
                    continue;
                };
                flush(&mut out, &mut empty);
                let mut a = String::new();
                if let Some(Some(name)) = cell_styles.get(cell.s) {
                    a.push_str(&format!(r#" table:style-name="{name}""#));
                }
                if let Some((cs, rs)) = spans.get(&(r, c)) {
                    a.push_str(&format!(
                        r#" table:number-columns-spanned="{cs}" table:number-rows-spanned="{rs}""#
                    ));
                }
                if let Some(f) = &cell.f {
                    a.push_str(&format!(
                        r#" table:formula="{}""#,
                        esc_attr(&to_openformula(f))
                    ));
                    if let Some((a1, b1)) = cell.spill.as_deref().and_then(|x| x.split_once(':'))
                        && let (Some((r1, c1)), Some((r2, c2))) = (parse_ref(a1), parse_ref(b1))
                    {
                        a.push_str(&format!(
                            r#" table:number-matrix-columns-spanned="{}" table:number-matrix-rows-spanned="{}""#,
                            c2 - c1 + 1,
                            r2 - r1 + 1
                        ));
                    }
                }
                let kind = kinds.get(cell.s).unwrap_or(&FmtKind::Number);
                let mut text = String::new();
                match (&cell.v, &cell.e) {
                    (_, Some(e)) => {
                        a.push_str(r#" office:value-type="string" office:string-value="""#);
                        text = e.clone();
                    }
                    (Some(Value::Number(n)), _) => match kind {
                        FmtKind::Date => a.push_str(&format!(
                            r#" office:value-type="date" office:date-value="{}""#,
                            serial_to_iso(*n)
                        )),
                        FmtKind::Percent => a.push_str(&format!(
                            r#" office:value-type="percentage" office:value="{n}""#
                        )),
                        _ => {
                            a.push_str(&format!(r#" office:value-type="float" office:value="{n}""#))
                        }
                    },
                    (Some(Value::Bool(b)), _) => {
                        a.push_str(&format!(
                            r#" office:value-type="boolean" office:boolean-value="{b}""#
                        ));
                        text = if *b { "WAHR".into() } else { "FALSCH".into() };
                    }
                    (Some(Value::Text(t)), _) => {
                        a.push_str(r#" office:value-type="string""#);
                        text = t.clone();
                    }
                    (None, None) => {}
                }
                let body: String = if text.is_empty() {
                    String::new()
                } else {
                    text.split('\n')
                        .map(|l| format!("<text:p>{}</text:p>", odf::text_xml(l)))
                        .collect()
                };
                out.push_str(&format!(
                    "<table:table-cell{a}{ex_attrs}>{ex_inner}{body}</table:table-cell>"
                ));
                c += 1;
            }
            flush(&mut out, &mut empty);
            out.push_str("</table:table-row>");
            r += 1;
        }
        // Conditional formatting (LibreOffice's calcext extension).
        if !sheet.cond_formats.is_empty() {
            out.push_str("<calcext:conditional-formats>");
            for cf in &sheet.cond_formats {
                let base = cf
                    .range
                    .split_whitespace()
                    .next()
                    .unwrap_or("A1")
                    .split(':')
                    .next()
                    .unwrap_or("A1")
                    .replace('$', "");
                out.push_str(&format!(
                    r#"<calcext:conditional-format calcext:target-range-address="{}">"#,
                    esc_attr(&odf_ranges(&cf.range, &sheet.name))
                ));
                for rule in &cf.rules {
                    match rule.kind.as_str() {
                        "colorScale" => {
                            let colors: Vec<String> = if rule.colors.len() >= 2 {
                                rule.colors.clone()
                            } else {
                                vec!["#f8696b".into(), "#ffeb84".into(), "#63be7b".into()]
                            };
                            out.push_str("<calcext:color-scale>");
                            for (i, c) in colors.iter().take(3).enumerate() {
                                let (t, v) = match (i, colors.len().min(3)) {
                                    (0, _) => ("minimum", "0"),
                                    (1, 3) => ("percentile", "50"),
                                    _ => ("maximum", "0"),
                                };
                                out.push_str(&format!(r#"<calcext:color-scale-entry calcext:value="{v}" calcext:type="{t}" calcext:color="{}"/>"#, esc_attr(c)));
                            }
                            out.push_str("</calcext:color-scale>");
                        }
                        "dataBar" => {
                            let c = rule
                                .colors
                                .first()
                                .cloned()
                                .unwrap_or_else(|| "#638ec6".into());
                            out.push_str(&format!(r##"<calcext:data-bar calcext:positive-color="{}" calcext:negative-color="#ff0000" calcext:axis-color="#000000" calcext:min-length="0" calcext:max-length="100"><calcext:formatting-entry calcext:value="0" calcext:type="minimum"/><calcext:formatting-entry calcext:value="0" calcext:type="maximum"/></calcext:data-bar>"##, esc_attr(&c)));
                        }
                        _ => {
                            let Some(value) = cond_value(rule, &base) else {
                                continue;
                            };
                            n_cond += 1;
                            let name = format!("Bedingung{n_cond}");
                            let body = cell_style_body(
                                rule.style.as_ref().unwrap_or(&CellStyle::default()),
                                &mut fonts,
                            );
                            cond_styles.push_str(&format!(r#"<style:style style:name="{name}" style:family="table-cell" style:parent-style-name="Default">{body}</style:style>"#));
                            out.push_str(&format!(r#"<calcext:condition calcext:apply-style-name="{name}" calcext:value="{}" calcext:base-cell-address="{}"/>"#, esc_attr(&value), esc_attr(&odf_range(&base, &sheet.name))));
                        }
                    }
                }
                out.push_str("</calcext:conditional-format>");
            }
            out.push_str("</calcext:conditional-formats>");
        }
        if !sheet.sparklines.is_empty() {
            out.push_str("<calcext:sparkline-groups>");
            for sp in &sheet.sparklines {
                n_spark += 1;
                let kind = match sp.kind.as_str() {
                    "column" => "column",
                    "stacked" => "stacked",
                    _ => "line",
                };
                let col = sp.color.clone().unwrap_or_else(|| "#376092".into());
                let neg = sp
                    .negative_color
                    .clone()
                    .unwrap_or_else(|| "#d00000".into());
                out.push_str(&format!(
                    r##"<calcext:sparkline-group calcext:id="{{00000000-0000-0000-0000-{n_spark:012}}}" calcext:type="{kind}" calcext:line-width="0.75pt" calcext:display-empty-cells-as="gap" calcext:markers="{}" calcext:color-series="{c}" calcext:color-negative="{n}" calcext:color-axis="#000000" calcext:color-markers="{c}" calcext:color-first="{n}" calcext:color-last="{n}" calcext:color-high="{n}" calcext:color-low="{n}"><calcext:sparklines><calcext:sparkline calcext:cell-address="{}" calcext:data-range="{}"/></calcext:sparklines></calcext:sparkline-group>"##,
                    sp.markers,
                    esc_attr(&odf_range(&sp.cell, &sheet.name)),
                    esc_attr(&odf_ranges(&sp.source, &sheet.name)),
                    c = esc_attr(&col),
                    n = esc_attr(&neg),
                ));
            }
            out.push_str("</calcext:sparkline-groups>");
        }
        out.push_str("</table:table>");
        tables.push_str(&out);
        if let Some(af) = &sheet.auto_filter {
            let (start_col, _) = af
                .range
                .split(':')
                .next()
                .and_then(|a| parse_ref(&a.replace('$', "")))
                .map(|(r, c)| (c, r))
                .unwrap_or((0, 0));
            let mut filter = String::new();
            for col in af.columns.iter().filter(|c| !c.values.is_empty()) {
                let field = col.col.saturating_sub(start_col);
                let items: String = col
                    .values
                    .iter()
                    .map(|v| format!(r#"<table:filter-set-item table:value="{}"/>"#, esc_attr(v)))
                    .collect();
                filter.push_str(&format!(r#"<table:filter-condition table:field-number="{field}" table:operator="=" table:value="{}">{items}</table:filter-condition>"#, esc_attr(&col.values[0])));
            }
            let filter = if filter.is_empty() {
                String::new()
            } else {
                format!(
                    "<table:filter><table:filter-and>{filter}</table:filter-and></table:filter>"
                )
            };
            db_ranges.push_str(&format!(
                r#"<table:database-range table:name="__Anonymous_Sheet_DB__{}" table:target-range-address="{}" table:display-filter-buttons="true">{filter}</table:database-range>"#,
                wb.sheets.iter().position(|x| std::ptr::eq(x, sheet)).unwrap_or(0),
                esc_attr(&odf_range(&af.range, &sheet.name))
            ));
        }
    }
    let mut named = String::new();
    for n in &wb.names {
        // Plain references become named ranges, everything else expressions.
        let of = to_openformula(&n.formula);
        let inner = of.strip_prefix("of:=").unwrap_or(&of);
        if inner.starts_with('[') && inner.ends_with(']') && inner.matches('[').count() == 1 {
            let addr = &inner[1..inner.len() - 1];
            let base = addr.split(':').next().unwrap_or(addr);
            named.push_str(&format!(r#"<table:named-range table:name="{}" table:base-cell-address="{}" table:cell-range-address="{}"/>"#, esc_attr(&n.name), esc_attr(base), esc_attr(addr)));
        } else {
            let base = format!(
                "${}.$A$1",
                wb.sheets
                    .first()
                    .map(|s| s.name.as_str())
                    .unwrap_or("Tabelle1")
            );
            named.push_str(&format!(r#"<table:named-expression table:name="{}" table:base-cell-address="{}" table:expression="{}"/>"#, esc_attr(&n.name), esc_attr(&base), esc_attr(&of)));
        }
    }
    if !named.is_empty() {
        named = format!("<table:named-expressions>{named}</table:named-expressions>");
    }
    if !db_ranges.is_empty() {
        db_ranges = format!("<table:database-ranges>{db_ranges}</table:database-ranges>");
    }
    if !validations.is_empty() {
        validations =
            format!("<table:content-validations>{validations}</table:content-validations>");
    }
    let font_decls = odf::font_decls(fonts.iter().map(String::as_str));
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}>{font_decls}<office:automatic-styles>{numbers}{auto}</office:automatic-styles><office:body><office:spreadsheet>{validations}{tables}{named}{db_ranges}</office:spreadsheet></office:body></office:document-content>"#,
        ns = odf::NS,
        auto = auto.xml
    );
    let styles = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ns}>{font_decls}<office:styles><style:default-style style:family="table-cell"><style:paragraph-properties style:tab-stop-distance="1.25cm"/><style:text-properties style:font-name="Calibri" fo:font-size="11pt" fo:language="de" fo:country="DE"/></style:default-style><style:style style:name="Default" style:family="table-cell"/>{cond_styles}</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties style:writing-mode="lr-tb"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>"#,
        ns = odf::NS
    );
    let settings = settings_xml(wb);
    extras.push(Extra {
        path: "settings.xml".into(),
        mime: "text/xml".into(),
        data: settings.into_bytes(),
    });
    odf::package_with(
        odf::MIME_SHEET,
        content,
        styles,
        odf::meta_xml(&wb.title, &wb.author),
        extras,
        &dirs,
    )
}

fn settings_xml(wb: &Workbook) -> String {
    let item = |n: &str, t: &str, v: &str| {
        format!(
            r#"<config:config-item config:name="{n}" config:type="{t}">{v}</config:config-item>"#
        )
    };
    let mut tables = String::new();
    for s in &wb.sheets {
        let mut e = String::new();
        let (h, v) = (
            if s.freeze_cols > 0 { "2" } else { "0" },
            if s.freeze_rows > 0 { "2" } else { "0" },
        );
        e.push_str(&item("HorizontalSplitMode", "short", h));
        e.push_str(&item("VerticalSplitMode", "short", v));
        e.push_str(&item(
            "HorizontalSplitPosition",
            "int",
            &s.freeze_cols.to_string(),
        ));
        e.push_str(&item(
            "VerticalSplitPosition",
            "int",
            &s.freeze_rows.to_string(),
        ));
        e.push_str(&item(
            "ActiveSplitRange",
            "short",
            if s.freeze_rows > 0 || s.freeze_cols > 0 {
                "2"
            } else {
                "0"
            },
        ));
        e.push_str(&item("PositionLeft", "int", "0"));
        e.push_str(&item("PositionRight", "int", &s.freeze_cols.to_string()));
        e.push_str(&item("PositionTop", "int", "0"));
        e.push_str(&item("PositionBottom", "int", &s.freeze_rows.to_string()));
        e.push_str(&item(
            "ShowGrid",
            "boolean",
            if s.show_grid { "true" } else { "false" },
        ));
        tables.push_str(&format!(
            r#"<config:config-item-map-entry config:name="{}">{e}</config:config-item-map-entry>"#,
            esc_attr(&s.name)
        ));
    }
    let active = wb
        .sheets
        .get(wb.active)
        .map(|s| s.name.as_str())
        .unwrap_or("");
    let grid = wb.sheets.get(wb.active).is_none_or(|s| s.show_grid);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>{}<config:config-item-map-named config:name="Tables">{tables}</config:config-item-map-named>{}{}</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>"#,
        item("ViewId", "string", "view1"),
        item("ActiveTable", "string", &esc(active)),
        item("ShowGrid", "boolean", if grid { "true" } else { "false" })
    )
}

// ------------------------------------------------- ranges and addresses --

fn quote_sheet(s: &str) -> String {
    if needs_quotes(s) {
        format!("'{}'", s.replace('\'', "''"))
    } else {
        s.to_string()
    }
}

/// `Tabelle1!$A$2:$A$5` or `A2:A5` (on `sheet`) → `Tabelle1.A2:Tabelle1.A5`.
fn odf_range(r: &str, sheet: &str) -> String {
    let r = r.trim().trim_start_matches('=');
    let (sh, cells) = match r.rsplit_once('!') {
        Some((s, c)) => (s.trim_matches('\'').replace("''", "'"), c),
        None => (sheet.to_string(), r),
    };
    let q = quote_sheet(&sh);
    let cells = cells.replace('$', "");
    match cells.split_once(':') {
        Some((a, b)) => format!("{q}.{a}:{q}.{b}"),
        None => format!("{q}.{cells}"),
    }
}

/// Space-separated model ranges (`A1:B2 D4`) → ODF range list.
fn odf_ranges(r: &str, sheet: &str) -> String {
    r.split_whitespace()
        .map(|x| odf_range(x, sheet))
        .collect::<Vec<_>>()
        .join(" ")
}

/// ODF range list → `(sheet, "A1:B2 D4")` (sheet of the first range).
fn model_ranges(r: &str) -> (Option<String>, String) {
    let mut sheet = None;
    let mut out = Vec::new();
    for part in r.split_whitespace() {
        let x = odf_ref(part);
        match x.rsplit_once('!') {
            Some((s, c)) => {
                sheet.get_or_insert_with(|| s.trim_matches('\'').replace("''", "'"));
                out.push(c.replace('$', ""));
            }
            None => out.push(x.replace('$', "")),
        }
    }
    (sheet, out.join(" "))
}

/// Absolute Excel reference with sheet (`Tabelle1!$A$2:$A$5`) from ODF.
fn model_ref(r: &str) -> String {
    let x = odf_ref(r.split_whitespace().next().unwrap_or(r));
    let (sheet, cells) = match x.rsplit_once('!') {
        Some((s, c)) => (Some(s.to_string()), c.to_string()),
        None => (None, x.clone()),
    };
    let abs = |c: &str| {
        let c = c.replace('$', "");
        let split = c.find(|ch: char| ch.is_ascii_digit()).unwrap_or(c.len());
        format!("${}${}", &c[..split], &c[split..])
    };
    let cells = cells.split(':').map(abs).collect::<Vec<_>>().join(":");
    match sheet {
        Some(s) => format!("{s}!{cells}"),
        None => cells,
    }
}

/// Every cell of a model range list (capped).
fn range_cells(r: &str, limit: usize) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    for part in r.split_whitespace() {
        let part = part.rsplit('!').next().unwrap_or(part).replace('$', "");
        let (a, b) = part.split_once(':').unwrap_or((&part, &part));
        let (Some((r1, c1)), Some((r2, c2))) = (parse_ref(a), parse_ref(b)) else {
            continue;
        };
        for r in r1.min(r2)..=r1.max(r2) {
            for c in c1.min(c2)..=c1.max(c2) {
                if out.len() >= limit {
                    return out;
                }
                out.push((r, c));
            }
        }
    }
    out
}

/// Cells → compact range list (`A1:A5 C2`): row runs, merged over rows.
fn cells_to_ranges(cells: &mut [(u32, u32)]) -> String {
    cells.sort();
    let mut runs: Vec<(u32, u32, u32)> = Vec::new(); // row, c1, c2
    for &(r, c) in cells.iter() {
        match runs.last_mut() {
            Some(l) if l.0 == r && l.2 + 1 == c => l.2 = c,
            _ => runs.push((r, c, c)),
        }
    }
    let mut rects: Vec<(u32, u32, u32, u32)> = Vec::new(); // r1, r2, c1, c2
    for (r, c1, c2) in runs {
        if let Some(rect) = rects
            .iter_mut()
            .find(|x| x.1 + 1 == r && x.2 == c1 && x.3 == c2)
        {
            rect.1 = r;
        } else {
            rects.push((r, r, c1, c2));
        }
    }
    rects
        .iter()
        .map(|&(r1, r2, c1, c2)| {
            if (r1, c1) == (r2, c2) {
                cell_ref(r1, c1)
            } else {
                format!("{}:{}", cell_ref(r1, c1), cell_ref(r2, c2))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ------------------------------------------------------ data validation --

/// `op` part of an ODF validation condition for a model operator.
fn validation_op(op: Option<&str>, f: &[String], what: &str) -> String {
    let v = |i: usize| {
        f.get(i)
            .map(|x| to_openformula(x).trim_start_matches("of:=").to_string())
            .unwrap_or_else(|| "0".into())
    };
    match op.unwrap_or("between") {
        "between" => format!("{what}-is-between({},{})", v(0), v(1)),
        "notBetween" => format!("{what}-is-not-between({},{})", v(0), v(1)),
        o => {
            let sym = match o {
                "equal" => "=",
                "notEqual" => "!=",
                "greaterThan" => ">",
                "lessThan" => "<",
                "greaterThanOrEqual" => ">=",
                _ => "<=",
            };
            format!("{what}(){sym}{}", v(0))
        }
    }
}

fn validation_condition(v: &Validation) -> String {
    match v.kind.as_str() {
        "list" => {
            let f = v.formulas.first().map(String::as_str).unwrap_or("");
            if let Some(lit) = f.strip_prefix('"').and_then(|x| x.strip_suffix('"')) {
                let items: Vec<String> = lit
                    .split(',')
                    .map(|i| format!("\"{}\"", i.trim().replace('"', "\"\"")))
                    .collect();
                format!("of:cell-content-is-in-list({})", items.join(";"))
            } else {
                format!(
                    "of:cell-content-is-in-list({})",
                    to_openformula(f).trim_start_matches("of:=")
                )
            }
        }
        "whole" => format!(
            "of:cell-content-is-whole-number() and {}",
            validation_op(v.operator.as_deref(), &v.formulas, "cell-content")
        ),
        "decimal" => format!(
            "of:cell-content-is-decimal-number() and {}",
            validation_op(v.operator.as_deref(), &v.formulas, "cell-content")
        ),
        "date" => format!(
            "of:cell-content-is-date() and {}",
            validation_op(v.operator.as_deref(), &v.formulas, "cell-content")
        ),
        "time" => format!(
            "of:cell-content-is-time() and {}",
            validation_op(v.operator.as_deref(), &v.formulas, "cell-content")
        ),
        "textLength" => format!(
            "of:{}",
            validation_op(
                v.operator.as_deref(),
                &v.formulas,
                "cell-content-text-length"
            )
        ),
        _ => format!(
            "of:is-true-formula({})",
            to_openformula(v.formulas.first().map(String::as_str).unwrap_or("TRUE()"))
                .trim_start_matches("of:=")
        ),
    }
}

/// Splits `a,b` / `a;b` arguments at top level.
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let (mut depth, mut inq) = (0, false);
    for ch in s.chars() {
        match ch {
            '"' => inq = !inq,
            '(' | '[' if !inq => depth += 1,
            ')' | ']' if !inq => depth -= 1,
            ',' | ';' if !inq && depth == 0 => {
                out.push(std::mem::take(&mut cur));
                continue;
            }
            _ => {}
        }
        cur.push(ch);
    }
    out.push(cur);
    out.into_iter().map(|x| x.trim().to_string()).collect()
}

fn parse_op_part(part: &str, what: &str) -> Option<(Option<String>, Vec<String>)> {
    let part = part.trim();
    for (name, op) in [
        ("-is-between(", "between"),
        ("-is-not-between(", "notBetween"),
    ] {
        if let Some(rest) = part.strip_prefix(what).and_then(|r| r.strip_prefix(name)) {
            let inner = rest.strip_suffix(')')?;
            return Some((
                Some(op.into()),
                split_args(inner)
                    .iter()
                    .map(|a| from_openformula(a))
                    .collect(),
            ));
        }
    }
    let rest = part.strip_prefix(what)?.strip_prefix("()")?;
    for (sym, op) in [
        (">=", "greaterThanOrEqual"),
        ("<=", "lessThanOrEqual"),
        ("!=", "notEqual"),
        ("<>", "notEqual"),
        (">", "greaterThan"),
        ("<", "lessThan"),
        ("=", "equal"),
    ] {
        if let Some(v) = rest.strip_prefix(sym) {
            return Some((Some(op.into()), vec![from_openformula(v)]));
        }
    }
    None
}

fn parse_validation(e: &Element) -> Option<Validation> {
    let cond = e.attr("table:condition")?;
    let cond = cond
        .strip_prefix("of:")
        .or_else(|| cond.strip_prefix("oooc:"))
        .unwrap_or(cond)
        .trim();
    let mut v = Validation {
        allow_blank: e.attr("table:allow-empty-cell") != Some("false"),
        hide_dropdown: e.attr("table:display-list") == Some("none"),
        ..Default::default()
    };
    if let Some(inner) = cond
        .strip_prefix("cell-content-is-in-list(")
        .and_then(|c| c.strip_suffix(')'))
    {
        v.kind = "list".into();
        let args = split_args(inner);
        if args.iter().all(|a| a.starts_with('"')) {
            let items: Vec<String> = args
                .iter()
                .map(|a| a.trim_matches('"').replace("\"\"", "\""))
                .collect();
            v.formulas = vec![format!("\"{}\"", items.join(","))];
        } else {
            v.formulas = vec![from_openformula(inner)];
        }
    } else if let Some(inner) = cond
        .strip_prefix("is-true-formula(")
        .and_then(|c| c.strip_suffix(')'))
    {
        v.kind = "custom".into();
        v.formulas = vec![from_openformula(inner)];
    } else if cond.starts_with("cell-content-text-length") {
        v.kind = "textLength".into();
        (v.operator, v.formulas) = parse_op_part(cond, "cell-content-text-length")?;
    } else {
        let (kind, rest) = cond.split_once(" and ")?;
        v.kind = match kind.trim() {
            "cell-content-is-whole-number()" => "whole",
            "cell-content-is-decimal-number()" => "decimal",
            "cell-content-is-date()" => "date",
            "cell-content-is-time()" => "time",
            _ => return None,
        }
        .into();
        (v.operator, v.formulas) = parse_op_part(rest, "cell-content")?;
    }
    if let Some(h) = e.child("table:help-message") {
        v.prompt_title = h.attr("table:title").map(String::from);
        let t = h
            .children_named("text:p")
            .map(odf::plain_text)
            .collect::<Vec<_>>()
            .join("\n");
        v.prompt = (!t.is_empty()).then_some(t);
    }
    if let Some(m) = e.child("table:error-message") {
        v.error_title = m.attr("table:title").map(String::from);
        let t = m
            .children_named("text:p")
            .map(odf::plain_text)
            .collect::<Vec<_>>()
            .join("\n");
        v.error = (!t.is_empty()).then_some(t);
        v.error_style = match m.attr("table:message-type") {
            Some("warning") => Some("warning".into()),
            Some("information") => Some("information".into()),
            _ => None,
        };
    }
    Some(v)
}

fn validation_xml(name: &str, v: &Validation, base: &str) -> String {
    let msg = |tag: &str, title: &Option<String>, text: &Option<String>, extra: &str| {
        let t = title
            .as_deref()
            .map(|t| format!(r#" table:title="{}""#, esc_attr(t)))
            .unwrap_or_default();
        let p: String = text
            .as_deref()
            .map(|x| {
                x.split('\n')
                    .map(|l| format!("<text:p>{}</text:p>", odf::text_xml(l)))
                    .collect()
            })
            .unwrap_or_default();
        format!(r#"<table:{tag}{t}{extra} table:display="true">{p}</table:{tag}>"#)
    };
    let kind = match v.error_style.as_deref() {
        Some("warning") => "warning",
        Some("information") => "information",
        _ => "stop",
    };
    format!(
        r#"<table:content-validation table:name="{name}" table:condition="{}" table:allow-empty-cell="{}" table:display-list="{}" table:base-cell-address="{}">{}{}</table:content-validation>"#,
        esc_attr(&validation_condition(v)),
        v.allow_blank,
        if v.hide_dropdown { "none" } else { "unsorted" },
        esc_attr(base),
        msg("help-message", &v.prompt_title, &v.prompt, ""),
        msg(
            "error-message",
            &v.error_title,
            &v.error,
            &format!(r#" table:message-type="{kind}""#)
        )
    )
}

// ------------------------------------------------- conditional formatting --

fn cond_value(rule: &CondRule, base: &str) -> Option<String> {
    let f = |i: usize| {
        rule.formulas
            .get(i)
            .map(|x| to_openformula(x).trim_start_matches("of:=").to_string())
            .unwrap_or_else(|| "0".into())
    };
    let text = || {
        format!(
            "\"{}\"",
            rule.text.clone().unwrap_or_default().replace('"', "\"\"")
        )
    };
    Some(match rule.kind.as_str() {
        "cellIs" => match rule.operator.as_deref().unwrap_or("equal") {
            "between" => format!("between({},{})", f(0), f(1)),
            "notBetween" => format!("not-between({},{})", f(0), f(1)),
            "notEqual" => format!("!={}", f(0)),
            "greaterThan" => format!(">{}", f(0)),
            "lessThan" => format!("<{}", f(0)),
            "greaterThanOrEqual" => format!(">={}", f(0)),
            "lessThanOrEqual" => format!("<={}", f(0)),
            _ => format!("={}", f(0)),
        },
        "expression" => format!("formula-is({})", f(0)),
        "containsText" => format!("contains-text({})", text()),
        "notContainsText" => format!("not-contains-text({})", text()),
        "beginsWith" => format!("begins-with({})", text()),
        "endsWith" => format!("ends-with({})", text()),
        "containsBlanks" => format!("formula-is(LEN(TRIM([.{base}]))=0)"),
        "notContainsBlanks" => format!("formula-is(LEN(TRIM([.{base}]))>0)"),
        "duplicateValues" => "duplicate".into(),
        "uniqueValues" => "unique".into(),
        "top10" => format!(
            "{}-{}({})",
            if rule.bottom { "bottom" } else { "top" },
            if rule.percent { "percent" } else { "elements" },
            rule.rank.unwrap_or(10)
        ),
        "aboveAverage" => if rule.below {
            "below-average"
        } else {
            "above-average"
        }
        .into(),
        _ => return None,
    })
}

fn parse_cond_value(v: &str) -> Option<CondRule> {
    let v = v.trim();
    let call = |name: &str| {
        v.strip_prefix(name)
            .and_then(|r| r.strip_prefix('('))
            .and_then(|r| r.strip_suffix(')'))
    };
    let unq = |s: &str| s.trim().trim_matches('"').replace("\"\"", "\"");
    let mut r = CondRule::default();
    if let Some(a) = call("between").or_else(|| call("not-between")) {
        r.kind = "cellIs".into();
        r.operator = Some(
            if v.starts_with("not") {
                "notBetween"
            } else {
                "between"
            }
            .into(),
        );
        r.formulas = split_args(a).iter().map(|x| from_openformula(x)).collect();
    } else if let Some(a) = call("formula-is") {
        r.kind = "expression".into();
        r.formulas = vec![from_openformula(a)];
    } else if let Some((name, kind)) = [
        ("contains-text", "containsText"),
        ("not-contains-text", "notContainsText"),
        ("begins-with", "beginsWith"),
        ("ends-with", "endsWith"),
    ]
    .iter()
    .find(|(n, _)| call(n).is_some())
    {
        r.kind = (*kind).into();
        r.text = Some(unq(call(name)?));
    } else if v == "duplicate" || v == "unique" {
        r.kind = if v == "duplicate" {
            "duplicateValues"
        } else {
            "uniqueValues"
        }
        .into();
    } else if v.starts_with("top-") || v.starts_with("bottom-") {
        let (name, arg) = v.split_once('(')?;
        r.kind = "top10".into();
        r.bottom = name.starts_with("bottom");
        r.percent = name.ends_with("percent");
        r.rank = arg.trim_end_matches(')').trim().parse().ok();
    } else if v.ends_with("-average") {
        r.kind = "aboveAverage".into();
        r.below = v.starts_with("below");
    } else {
        r.kind = "cellIs".into();
        for (sym, op) in [
            (">=", "greaterThanOrEqual"),
            ("<=", "lessThanOrEqual"),
            ("!=", "notEqual"),
            (">", "greaterThan"),
            ("<", "lessThan"),
            ("=", "equal"),
        ] {
            if let Some(x) = v.strip_prefix(sym) {
                r.operator = Some(op.into());
                r.formulas = vec![from_openformula(x)];
                return Some(r);
            }
        }
        return None;
    }
    Some(r)
}

// ------------------------------------------------------------------ charts --

const CHART_CLASSES: [(&str, &str); 7] = [
    ("column", "chart:bar"),
    ("bar", "chart:bar"),
    ("line", "chart:line"),
    ("area", "chart:area"),
    ("pie", "chart:circle"),
    ("doughnut", "chart:ring"),
    ("scatter", "chart:scatter"),
];

fn chart_content(c: &crate::chart::Chart, w_px: f64, h_px: f64, sheet: &str) -> String {
    let class = CHART_CLASSES
        .iter()
        .find(|(k, _)| *k == c.kind)
        .map(|(_, v)| *v)
        .unwrap_or("chart:bar");
    let mut styles = String::from(
        r##"<style:style style:name="ch1" style:family="chart"><style:graphic-properties draw:stroke="none" draw:fill-color="#ffffff"/></style:style>"##,
    );
    styles.push_str(&format!(
        r#"<style:style style:name="pa" style:family="chart"><style:chart-properties chart:vertical="{}" chart:stacked="{}" chart:three-dimensional="false" chart:lines="{}"/></style:style>"#,
        c.kind == "bar",
        c.stacked,
        c.kind == "line" || c.kind == "scatter"
    ));
    styles.push_str(r#"<style:style style:name="ax" style:family="chart"><style:chart-properties chart:display-label="true" chart:tick-marks-major-outer="true"/></style:style>"#);
    let mut series = String::new();
    let cat = c.series.iter().find_map(|s| s.cat_ref.clone());
    for (i, s) in c.series.iter().enumerate() {
        let mut g = String::new();
        if let Some(col) = &s.color {
            g = format!(
                r#"<style:graphic-properties draw:fill-color="{0}" svg:stroke-color="{0}"/>"#,
                esc_attr(col)
            );
        }
        styles.push_str(&format!(r#"<style:style style:name="s{i}" style:family="chart"><style:chart-properties chart:data-label-number="{}"/>{g}</style:style>"#, if c.labels { "value" } else { "none" }));
        let vals = s
            .val_ref
            .as_deref()
            .map(|r| {
                format!(
                    r#" chart:values-cell-range-address="{}""#,
                    esc_attr(&odf_range(r, sheet))
                )
            })
            .unwrap_or_default();
        let label = s
            .name_ref
            .as_deref()
            .map(|r| {
                format!(
                    r#" chart:label-cell-address="{}""#,
                    esc_attr(&odf_range(r, sheet))
                )
            })
            .unwrap_or_default();
        let domain = if c.kind == "scatter" {
            s.cat_ref
                .as_deref()
                .or(cat.as_deref())
                .map(|r| {
                    format!(
                        r#"<chart:domain table:cell-range-address="{}"/>"#,
                        esc_attr(&odf_range(r, sheet))
                    )
                })
                .unwrap_or_default()
        } else {
            String::new()
        };
        series.push_str(&format!(r#"<chart:series chart:style-name="s{i}"{vals}{label} chart:class="{class}">{domain}</chart:series>"#));
    }
    let title = c
        .title
        .as_deref()
        .map(|t| {
            format!(
                "<chart:title><text:p>{}</text:p></chart:title>",
                odf::text_xml(t)
            )
        })
        .unwrap_or_default();
    let legend = c
        .legend
        .as_deref()
        .map(|l| {
            let pos = match l {
                "l" => "start",
                "t" => "top",
                "b" => "bottom",
                _ => "end",
            };
            format!(r#"<chart:legend chart:legend-position="{pos}"/>"#)
        })
        .unwrap_or_default();
    let categories = cat
        .filter(|_| c.kind != "scatter")
        .map(|r| {
            format!(
                r#"<chart:categories table:cell-range-address="{}"/>"#,
                esc_attr(&odf_range(&r, sheet))
            )
        })
        .unwrap_or_default();
    let axes = if matches!(c.kind.as_str(), "pie" | "doughnut") {
        String::new()
    } else {
        format!(
            r#"<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="ax">{categories}</chart:axis><chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="ax"><chart:grid chart:class="major"/></chart:axis>"#
        )
    };
    let cats_for_pie = if matches!(c.kind.as_str(), "pie" | "doughnut") {
        format!(
            r#"<chart:axis chart:dimension="x" chart:name="primary-x">{categories}</chart:axis>"#
        )
    } else {
        String::new()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}><office:automatic-styles>{styles}</office:automatic-styles><office:body><office:chart><chart:chart svg:width="{w}" svg:height="{h}" chart:class="{class}" chart:style-name="ch1">{title}{legend}<chart:plot-area chart:style-name="pa">{axes}{cats_for_pie}{series}</chart:plot-area></chart:chart></office:chart></office:body></office:document-content>"#,
        ns = odf::NS,
        w = odf::cm_px(w_px),
        h = odf::cm_px(h_px),
    )
}

/// Chart of an embedded chart object (refs only; values are filled later).
fn read_chart(doc: &OdfDoc, href: &str) -> Option<crate::chart::Chart> {
    let dir = href.trim_start_matches("./").trim_end_matches('/');
    let content = doc.pkg.xml(&format!("{dir}/content.xml")).ok()??;
    let styles = doc.pkg.xml(&format!("{dir}/styles.xml")).ok().flatten();
    let mut roots = vec![&content];
    if let Some(s) = &styles {
        roots.push(s);
    }
    let st = Styles::from_roots(&roots);
    let ch = content.find("chart:chart")?;
    let pa = ch.child("chart:plot-area")?;
    let pa_style = pa.attr("chart:style-name");
    let class = ch.attr("chart:class").unwrap_or("chart:bar");
    let kind = match class {
        "chart:bar" if st.get("chart", pa_style, "chart:vertical") == Some("true") => "bar",
        "chart:bar" => "column",
        "chart:line" => "line",
        "chart:area" => "area",
        "chart:circle" => "pie",
        "chart:ring" => "doughnut",
        "chart:scatter" => "scatter",
        _ => return None,
    };
    let cat = pa
        .children_named("chart:axis")
        .find(|a| a.attr("chart:dimension") == Some("x"))
        .and_then(|a| a.child("chart:categories"))
        .and_then(|c| c.attr("table:cell-range-address"))
        .map(model_ref);
    let mut series = Vec::new();
    let mut labels = false;
    for s in pa.children_named("chart:series") {
        let sn = s.attr("chart:style-name");
        labels |= st
            .get("chart", sn, "chart:data-label-number")
            .is_some_and(|v| v != "none");
        let color = st
            .get("chart", sn, "draw:fill-color")
            .or_else(|| st.get("chart", sn, "svg:stroke-color"))
            .and_then(odf::color);
        let domain = s
            .child("chart:domain")
            .and_then(|d| d.attr("table:cell-range-address"))
            .map(model_ref);
        series.push(crate::chart::Series {
            name_ref: s.attr("chart:label-cell-address").map(model_ref),
            val_ref: s.attr("chart:values-cell-range-address").map(model_ref),
            cat_ref: domain.or_else(|| cat.clone()),
            color,
            ..Default::default()
        });
    }
    let legend = ch.child("chart:legend").map(|l| {
        match l.attr("chart:legend-position") {
            Some("start") => "l",
            Some("top") => "t",
            Some("bottom") => "b",
            _ => "r",
        }
        .to_string()
    });
    Some(crate::chart::Chart {
        kind: kind.into(),
        title: ch
            .child("chart:title")
            .map(|t| odf::plain_text(t).trim().to_string())
            .filter(|t| !t.is_empty()),
        series,
        legend,
        stacked: st.get("chart", pa_style, "chart:stacked") == Some("true"),
        labels,
    })
}

/// Cached values of chart series from the workbook's cells.
fn fill_chart_values(wb: &mut Workbook) {
    let lookup = |wb: &Workbook, r: &str| -> Vec<Option<Value>> {
        let (sheet, cells) = match r.rsplit_once('!') {
            Some((s, c)) => (s.trim_matches('\'').replace("''", "'"), c.to_string()),
            None => return Vec::new(),
        };
        let Some(sh) = wb.sheets.iter().find(|s| s.name == sheet) else {
            return Vec::new();
        };
        range_cells(&cells, 10_000)
            .into_iter()
            .map(|(r, c)| sh.cells.get(&cell_ref(r, c)).and_then(|x| x.v.clone()))
            .collect()
    };
    let snapshot = wb.clone();
    for sh in &mut wb.sheets {
        for ch in &mut sh.charts {
            for s in &mut ch.chart.series {
                if let Some(r) = &s.val_ref {
                    s.values = lookup(&snapshot, r)
                        .into_iter()
                        .map(|v| {
                            if let Some(Value::Number(n)) = v {
                                Some(n)
                            } else {
                                None
                            }
                        })
                        .collect();
                }
                if let Some(r) = &s.cat_ref {
                    s.categories = lookup(&snapshot, r)
                        .into_iter()
                        .map(|v| match v {
                            Some(Value::Text(t)) => t,
                            Some(Value::Number(n)) => n.to_string(),
                            Some(Value::Bool(b)) => b.to_string(),
                            None => String::new(),
                        })
                        .collect();
                }
                if let Some(r) = &s.name_ref {
                    s.name = lookup(&snapshot, r)
                        .into_iter()
                        .next()
                        .flatten()
                        .map(|v| match v {
                            Value::Text(t) => t,
                            Value::Number(n) => n.to_string(),
                            Value::Bool(b) => b.to_string(),
                        });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formulas() {
        assert_eq!(
            to_openformula("SUM(A1:B2,'My Sheet'!$C$3)"),
            "of:=SUM([.A1:.B2];['My Sheet'.$C$3])"
        );
        assert_eq!(
            to_openformula("IF(LOG10(A1)>1,\"a,b\",Tabelle2!A:A)"),
            "of:=IF(LOG10([.A1])>1;\"a,b\";[Tabelle2.A1:.A1048576])"
        );
        assert_eq!(
            from_openformula("of:=SUM([.A1:.B2];['My Sheet'.$C$3])"),
            "SUM(A1:B2,'My Sheet'!$C$3)"
        );
        assert_eq!(
            from_openformula("of:=[$Tabelle2.$A$1]*2"),
            "Tabelle2!$A$1*2"
        );
        assert_eq!(
            from_openformula(&to_openformula("_xlfn.CONCAT(A1,\"x\")")),
            "CONCAT(A1,\"x\")"
        );
    }

    #[test]
    fn dates() {
        assert_eq!(serial_to_iso(46_000.0), "2025-12-09");
        assert_eq!(iso_to_serial("2025-12-09"), Some(46_000.0));
        assert_eq!(serial_to_iso(46_000.5), "2025-12-09T12:00:00");
        assert_eq!(duration_to_serial("PT12H00M00S"), Some(0.5));
    }

    #[test]
    fn number_formats() {
        let back = |code: &str| {
            let (xml, _) = odf_format("N1", code);
            excel_format(&crate::xml::parse(format!(r#"<x xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0">{xml}</x>"#).as_bytes()).unwrap().elements().next().unwrap().clone())
        };
        assert_eq!(back("#,##0.00").as_deref(), Some("#,##0.00"));
        assert_eq!(back("0.0%").as_deref(), Some("0.0%"));
        assert_eq!(back("dd.mm.yyyy").as_deref(), Some("dd.mm.yyyy"));
        assert_eq!(back("hh:mm").as_deref(), Some("hh:mm"));
        assert_eq!(back("#,##0.00 €").as_deref(), Some("#,##0.00 €"));
    }
}
