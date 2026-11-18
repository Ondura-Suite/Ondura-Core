//! Structured references of Excel tables in formulas.
//!
//! Nexora writes "this row" references the short way, `[@Umsatz]` (or
//! `Tabelle1[@Umsatz]` from outside the table); files spell them out as
//! `Tabelle1[[#This Row],[Umsatz]]`.

/// Splits a formula into text outside string literals and the literals.
fn outside_strings(f: &str, mut each: impl FnMut(&str) -> String) -> String {
    let mut out = String::new();
    let mut cur = String::new();
    let mut chars = f.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' {
            out.push_str(&each(&cur));
            cur.clear();
            out.push(c);
            while let Some(d) = chars.next() {
                out.push(d);
                if d == '"' {
                    if chars.peek() == Some(&'"') {
                        out.push(chars.next().unwrap());
                        continue;
                    }
                    break;
                }
            }
            continue;
        }
        cur.push(c);
    }
    out.push_str(&each(&cur));
    out
}

/// End (exclusive) of the bracket group starting at `start` (a `[`).
fn bracket_end(s: &[char], start: usize) -> Option<usize> {
    let mut depth = 0;
    let mut i = start;
    while i < s.len() {
        match s[i] {
            // An apostrophe escapes the next character in column names.
            '\'' => i += 1,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '.' || c == '\\'
}

/// Column part of a `@` reference: `Umsatz` or `[Umsatz 2026]`.
fn column_of(spec: &str) -> String {
    let t = spec.trim();
    t.strip_prefix('[')
        .and_then(|x| x.strip_suffix(']'))
        .unwrap_or(t)
        .to_string()
}

fn needs_brackets(col: &str) -> bool {
    !col.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// `[@Col]` / `T[@Col]` → `T[[#This Row],[Col]]` (`cell_table`: the table
/// the formula's cell belongs to).
pub(crate) fn to_file(f: &str, cell_table: Option<&str>) -> String {
    if !f.contains('@') {
        return f.to_string();
    }
    outside_strings(f, |part| {
        let s: Vec<char> = part.chars().collect();
        let mut out: Vec<char> = Vec::new();
        let mut i = 0;
        while i < s.len() {
            if s[i] == '['
                && s.get(i + 1) == Some(&'@')
                && let Some(end) = bracket_end(&s, i)
            {
                // Table name right before the bracket, if any.
                let mut k = out.len();
                while k > 0 && is_name_char(out[k - 1]) {
                    k -= 1;
                }
                let explicit: String = out[k..].iter().collect();
                let table = if explicit.is_empty() {
                    cell_table.map(String::from)
                } else {
                    Some(explicit)
                };
                if let Some(t) = table {
                    out.truncate(k);
                    let col = column_of(&s[i + 2..end - 1].iter().collect::<String>());
                    let text = if col.is_empty() {
                        format!("{t}[#This Row]")
                    } else {
                        format!("{t}[[#This Row],[{col}]]")
                    };
                    out.extend(text.chars());
                    i = end;
                    continue;
                }
            }
            out.push(s[i]);
            i += 1;
        }
        out.into_iter().collect()
    })
}

/// `T[[#This Row],[Col]]` → `[@Col]` (or `T[@Col]` outside the table).
pub(crate) fn from_file(f: &str, cell_table: Option<&str>) -> String {
    if !f.to_ascii_lowercase().contains("#this row") {
        return f.to_string();
    }
    outside_strings(f, |part| {
        let s: Vec<char> = part.chars().collect();
        let mut out = String::new();
        let mut i = 0;
        while i < s.len() {
            let at_name = (i == 0 || !is_name_char(s[i - 1]))
                && (s[i].is_alphabetic() || s[i] == '_' || s[i] == '\\');
            if at_name {
                let mut j = i;
                while j < s.len() && is_name_char(s[j]) {
                    j += 1;
                }
                if s.get(j) == Some(&'[')
                    && let Some(end) = bracket_end(&s, j)
                {
                    let table: String = s[i..j].iter().collect();
                    let inner: String = s[j + 1..end - 1].iter().collect();
                    let lower = inner.to_ascii_lowercase();
                    let rest = if lower.trim() == "#this row" {
                        Some(String::new())
                    } else {
                        lower
                            .strip_prefix("[#this row],")
                            .map(|r| inner[inner.len() - r.len()..].trim().to_string())
                    };
                    if let Some(col_spec) = rest {
                        let col = column_of(&col_spec);
                        let short = if col.is_empty() {
                            "[@]".to_string()
                        } else if needs_brackets(&col) {
                            format!("[@[{col}]]")
                        } else {
                            format!("[@{col}]")
                        };
                        let same = cell_table.is_some_and(|t| t.eq_ignore_ascii_case(&table));
                        if !same {
                            out.push_str(&table);
                        }
                        out.push_str(&short);
                        i = end;
                        continue;
                    }
                }
                out.extend(&s[i..j]);
                i = j;
                continue;
            }
            out.push(s[i]);
            i += 1;
        }
        out
    })
}

/// Resolves structured references to A1 ranges (for OpenDocument, which
/// has no tables): `lookup(table)` gives the sheet name and
/// (r1, c1, r2, c2, header, totals, column names).
pub(crate) fn resolve(
    f: &str,
    cell_sheet: &str,
    cell_row: u32,
    cell_table: Option<&str>,
    lookup: &dyn Fn(&str) -> Option<TableRef>,
) -> String {
    if !f.contains('[') {
        return f.to_string();
    }
    outside_strings(f, |part| {
        let s: Vec<char> = part.chars().collect();
        let mut out = String::new();
        let mut i = 0;
        while i < s.len() {
            let name_start = (i == 0 || !is_name_char(s[i - 1]))
                && (s[i].is_alphabetic() || s[i] == '_' || s[i] == '\\');
            let (table, bracket) = if name_start {
                let mut j = i;
                while j < s.len() && is_name_char(s[j]) {
                    j += 1;
                }
                if s.get(j) == Some(&'[') {
                    (Some(s[i..j].iter().collect::<String>()), j)
                } else {
                    out.extend(&s[i..j]);
                    i = j;
                    continue;
                }
            } else if s[i] == '[' && (i == 0 || !is_name_char(s[i - 1])) {
                (cell_table.map(String::from), i)
            } else {
                out.push(s[i]);
                i += 1;
                continue;
            };
            let (Some(t), Some(end)) = (table, bracket_end(&s, bracket)) else {
                out.push(s[i]);
                i += 1;
                continue;
            };
            let Some(info) = lookup(&t) else {
                out.extend(&s[i..end]);
                i = end;
                continue;
            };
            let inner: String = s[bracket + 1..end - 1].iter().collect();
            match info.range_of(&inner, cell_row, cell_sheet) {
                Some(r) => out.push_str(&r),
                None => out.push_str("#REF!"),
            }
            i = end;
        }
        out
    })
}

pub(crate) struct TableRef {
    pub sheet: String,
    pub r1: u32,
    pub c1: u32,
    pub r2: u32,
    pub c2: u32,
    pub header: bool,
    pub totals: bool,
    pub columns: Vec<String>,
}

impl TableRef {
    fn range_of(&self, spec: &str, row: u32, cell_sheet: &str) -> Option<String> {
        // Parts: keywords and columns, e.g. "[#Headers],[A]:[C]" or "@A" or "A".
        let mut parts = Vec::new();
        let chars: Vec<char> = spec.chars().collect();
        let mut i = 0;
        let mut cur = String::new();
        while i < chars.len() {
            if chars[i] == '[' {
                let end = bracket_end(&chars, i)?;
                cur.push_str(&chars[i..end].iter().collect::<String>());
                i = end;
                continue;
            }
            if chars[i] == ',' || chars[i] == ';' {
                parts.push(std::mem::take(&mut cur));
            } else {
                cur.push(chars[i]);
            }
            i += 1;
        }
        parts.push(cur);
        let (mut r1, mut r2) = (
            self.r1 + u32::from(self.header),
            self.r2 - u32::from(self.totals),
        );
        let (mut c1, mut c2) = (self.c1, self.c2);
        let col = |n: &str| {
            self.columns
                .iter()
                .position(|c| c.eq_ignore_ascii_case(n.trim()))
                .map(|p| self.c1 + p as u32)
        };
        for p in parts {
            let p = p.trim();
            let lower = column_of(p).to_ascii_lowercase();
            match lower.as_str() {
                "" => {}
                "#all" | "#alle" => (r1, r2) = (self.r1, self.r2),
                "#data" | "#daten" => {}
                "#headers" | "#kopfzeilen" => (r1, r2) = (self.r1, self.r1),
                "#totals" | "#ergebnisse" => (r1, r2) = (self.r2, self.r2),
                "#this row" | "#diese zeile" => (r1, r2) = (row, row),
                _ if p.starts_with('@') => {
                    (r1, r2) = (row, row);
                    let c = column_of(&p[1..]);
                    if !c.is_empty() {
                        let x = col(&c)?;
                        (c1, c2) = (x, x);
                    }
                }
                _ => {
                    // [A] or [A]:[C]
                    let inner = p
                        .strip_prefix('[')
                        .and_then(|x| x.strip_suffix(']'))
                        .unwrap_or(p);
                    if let Some((a, b)) = inner.split_once("]:[") {
                        (c1, c2) = (col(a)?, col(b)?);
                    } else {
                        let x = col(inner)?;
                        (c1, c2) = (x, x);
                    }
                }
            }
        }
        let q = if self.sheet.chars().all(|c| c.is_alphanumeric() || c == '_') {
            self.sheet.clone()
        } else {
            format!("'{}'", self.sheet.replace('\'', "''"))
        };
        let a = crate::xlsx::cell_ref(r1, c1);
        let b = crate::xlsx::cell_ref(r2, c2);
        let q = if self.sheet == cell_sheet {
            String::new()
        } else {
            format!("{q}!")
        };
        Some(if a == b {
            format!("{q}{a}")
        } else {
            format!("{q}{a}:{b}")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_row() {
        let f = r#"[@Menge]*[@[Preis netto]]&"[@x]"+Tabelle2[@Wert]"#;
        let w = to_file(f, Some("Tabelle1"));
        assert_eq!(
            w,
            r#"Tabelle1[[#This Row],[Menge]]*Tabelle1[[#This Row],[Preis netto]]&"[@x]"+Tabelle2[[#This Row],[Wert]]"#
        );
        assert_eq!(from_file(&w, Some("Tabelle1")), f);
        let t = || TableRef {
            sheet: "Daten".into(),
            r1: 0,
            c1: 0,
            r2: 4,
            c2: 2,
            header: true,
            totals: true,
            columns: vec!["Monat".into(), "Menge".into(), "Preis netto".into()],
        };
        let r = resolve(
            "SUM(Tabelle1[Menge])+[@[Preis netto]]+COUNTA(Tabelle1[[#Headers],[Monat]:[Menge]])",
            "Andere",
            2,
            Some("Tabelle1"),
            &|n| (n == "Tabelle1").then(t),
        );
        assert_eq!(r, "SUM(Daten!B2:B4)+Daten!C3+COUNTA(Daten!A1:B1)");
    }
}
