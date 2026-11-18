//! OpenDocument Spreadsheet (.ods) ⇄ [`Workbook`] for Nexora Tabellen.
//!
//! Formulas are converted between Excel syntax (the model) and
//! OpenFormula (`of:=SUM([.A1:.B2])`); number formats between Excel format
//! codes and ODF data styles.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::Result;
use crate::odf::{self, AutoStyles, Extra, OdfDoc, Styles, esc_attr};
use crate::xlsx::{
    Cell, CellStyle, DefinedName, Loaded, Sheet, Value, Workbook, cell_ref, parse_ref,
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
                out.push_str(word.strip_prefix("_xlfn.").unwrap_or(&word));
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
                out.push_str(word.strip_prefix("COM.MICROSOFT.").unwrap_or(&word));
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
    for t in body
        .map(|b| b.children_named("table:table").collect::<Vec<_>>())
        .unwrap_or_default()
    {
        let mut sheet = Sheet::new(t.attr("table:name").unwrap_or("Tabelle"));
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
                    if cell.child("draw:frame").is_some() {
                        warnings.insert(
                            "Bilder und Diagramme in Tabellen werden nicht übernommen.".into(),
                        );
                    }
                    c = c.saturating_add(cn);
                }
            }
            r = r.saturating_add(n);
        }
        let _ = max_used;
        if t.child("table:shapes").is_some() {
            warnings.insert("Bilder und Diagramme in Tabellen werden nicht übernommen.".into());
        }
        if t.find("table:content-validations").is_some()
            || doc.content.find("table:content-validations").is_some()
        {
            warnings.insert("Datenüberprüfungen werden nicht übernommen.".into());
        }
        if let Some(v) = views.get(&sheet.name) {
            sheet.freeze_cols = v.freeze_cols;
            sheet.freeze_rows = v.freeze_rows;
            if let Some(g) = v.show_grid {
                sheet.show_grid = g;
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
    if body
        .and_then(|b| b.child("table:database-ranges"))
        .is_some_and(|d| d.find("table:filter").is_some())
    {
        warnings.insert("Filter werden nicht übernommen.".into());
    }
    if doc.content.find("calcext:conditional-formats").is_some()
        || doc.content.find("conditional-formats").is_some()
    {
        warnings.insert("Bedingte Formatierungen werden nicht übernommen.".into());
    }
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

/// What a save as .ods cannot keep.
pub fn losses(wb: &Workbook) -> Vec<String> {
    let mut out = BTreeSet::new();
    for s in &wb.sheets {
        if !s.charts.is_empty() || !s.images.is_empty() {
            out.insert("Diagramme und Bilder".to_string());
        }
        if !s.cond_formats.is_empty() {
            out.insert("bedingte Formatierungen".into());
        }
        if s.auto_filter.is_some() {
            out.insert("Filter".into());
        }
        if !s.validations.is_empty() {
            out.insert("Datenüberprüfungen".into());
        }
        if !s.sparklines.is_empty() {
            out.insert("Sparklines".into());
        }
    }
    out.into_iter().collect()
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
        cell_styles.push(Some(auto.get(
            "table-cell",
            &format!(r#" style:parent-style-name="Default"{data}"#),
            &body,
        )));
    }

    let mut tables = String::new();
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
            if row_cells.is_empty() && !has_cov {
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
                let Some(cell) = by_col.get(&c) else {
                    empty += 1;
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
                out.push_str(&format!("<table:table-cell{a}>{body}</table:table-cell>"));
                c += 1;
            }
            flush(&mut out, &mut empty);
            out.push_str("</table:table-row>");
            r += 1;
        }
        out.push_str("</table:table>");
        tables.push_str(&out);
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
    let font_decls = odf::font_decls(fonts.iter().map(String::as_str));
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}>{font_decls}<office:automatic-styles>{numbers}{auto}</office:automatic-styles><office:body><office:spreadsheet>{tables}{named}</office:spreadsheet></office:body></office:document-content>"#,
        ns = odf::NS,
        auto = auto.xml
    );
    let styles = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ns}>{font_decls}<office:styles><style:default-style style:family="table-cell"><style:paragraph-properties style:tab-stop-distance="1.25cm"/><style:text-properties style:font-name="Calibri" fo:font-size="11pt" fo:language="de" fo:country="DE"/></style:default-style><style:style style:name="Default" style:family="table-cell"/></office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties style:writing-mode="lr-tb"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>"#,
        ns = odf::NS
    );
    let settings = settings_xml(wb);
    let extras = vec![Extra {
        path: "settings.xml".into(),
        mime: "text/xml".into(),
        data: settings.into_bytes(),
    }];
    odf::package(
        odf::MIME_SHEET,
        content,
        styles,
        odf::meta_xml(&wb.title, &wb.author),
        extras,
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
