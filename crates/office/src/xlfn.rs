//! Future-function prefixes of OOXML formulas.
//!
//! Excel stores functions newer than Excel 2007 with a `_xlfn.` prefix
//! (`_xlfn._xlws.` for SORT and FILTER) and LET/LAMBDA parameters with
//! `_xlpm.`; without them Excel shows `#NAME?`. Nexora keeps formulas
//! without prefixes, so they are added when writing and removed when reading.

use std::collections::HashSet;

/// Functions that need `_xlfn.` in a file.
const FUTURE: &[&str] = &[
    "ACOT",
    "ACOTH",
    "AGGREGATE",
    "ARABIC",
    "ARRAYTOTEXT",
    "BASE",
    "BETA.DIST",
    "BETA.INV",
    "BINOM.DIST",
    "BINOM.DIST.RANGE",
    "BINOM.INV",
    "BITAND",
    "BITLSHIFT",
    "BITOR",
    "BITRSHIFT",
    "BITXOR",
    "BYCOL",
    "BYROW",
    "CEILING.MATH",
    "CEILING.PRECISE",
    "CHISQ.DIST",
    "CHISQ.DIST.RT",
    "CHISQ.INV",
    "CHISQ.INV.RT",
    "CHISQ.TEST",
    "CHOOSECOLS",
    "CHOOSEROWS",
    "COMBINA",
    "CONCAT",
    "CONFIDENCE.NORM",
    "CONFIDENCE.T",
    "COT",
    "COTH",
    "COVARIANCE.P",
    "COVARIANCE.S",
    "CSC",
    "CSCH",
    "DAYS",
    "DECIMAL",
    "DROP",
    "ENCODEURL",
    "ERF.PRECISE",
    "ERFC.PRECISE",
    "EXPAND",
    "EXPON.DIST",
    "F.DIST",
    "F.DIST.RT",
    "F.INV",
    "F.INV.RT",
    "F.TEST",
    "FLOOR.MATH",
    "FLOOR.PRECISE",
    "FORECAST.LINEAR",
    "FORMULATEXT",
    "GAMMA",
    "GAMMA.DIST",
    "GAMMA.INV",
    "GAMMALN.PRECISE",
    "GAUSS",
    "GROUPBY",
    "HSTACK",
    "HYPGEOM.DIST",
    "IFNA",
    "IFS",
    "ISFORMULA",
    "ISO.CEILING",
    "ISOMITTED",
    "ISOWEEKNUM",
    "LAMBDA",
    "LET",
    "LOGNORM.DIST",
    "LOGNORM.INV",
    "MAKEARRAY",
    "MAP",
    "MAXIFS",
    "MINIFS",
    "MODE.MULT",
    "MODE.SNGL",
    "MUNIT",
    "NEGBINOM.DIST",
    "NETWORKDAYS.INTL",
    "NORM.DIST",
    "NORM.INV",
    "NORM.S.DIST",
    "NORM.S.INV",
    "NUMBERVALUE",
    "PDURATION",
    "PERCENTILE.EXC",
    "PERCENTILE.INC",
    "PERCENTOF",
    "PERCENTRANK.EXC",
    "PERCENTRANK.INC",
    "PERMUTATIONA",
    "PHI",
    "PIVOTBY",
    "POISSON.DIST",
    "QUARTILE.EXC",
    "QUARTILE.INC",
    "RANDARRAY",
    "RANK.AVG",
    "RANK.EQ",
    "REDUCE",
    "REGEXEXTRACT",
    "REGEXREPLACE",
    "REGEXTEST",
    "RRI",
    "SCAN",
    "SEC",
    "SECH",
    "SEQUENCE",
    "SHEET",
    "SHEETS",
    "SKEW.P",
    "SORTBY",
    "STDEV.P",
    "STDEV.S",
    "SWITCH",
    "T.DIST",
    "T.DIST.2T",
    "T.DIST.RT",
    "T.INV",
    "T.INV.2T",
    "T.TEST",
    "TAKE",
    "TEXTAFTER",
    "TEXTBEFORE",
    "TEXTJOIN",
    "TEXTSPLIT",
    "TOCOL",
    "TOROW",
    "UNICHAR",
    "UNICODE",
    "UNIQUE",
    "VALUETOTEXT",
    "VAR.P",
    "VAR.S",
    "VSTACK",
    "WEIBULL.DIST",
    "WORKDAY.INTL",
    "WRAPCOLS",
    "WRAPROWS",
    "XLOOKUP",
    "XMATCH",
    "XOR",
    "Z.TEST",
];
/// Functions that need `_xlfn._xlws.`.
const WORKSHEET: &[&str] = &["SORT", "FILTER"];

enum Tok {
    /// Text copied unchanged (strings, operators, numbers, sheet names).
    Raw(String),
    /// An identifier; `call` if followed by "(".
    Ident { name: String, call: bool },
}

fn tokens(f: &str) -> Vec<Tok> {
    let chars: Vec<char> = f.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    let mut raw = String::new();
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            // String literal or quoted sheet name, copied as is.
            raw.push(c);
            i += 1;
            while i < chars.len() {
                raw.push(chars[i]);
                if chars[i] == c {
                    if chars.get(i + 1) == Some(&c) {
                        raw.push(c);
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
        let prev_word =
            i > 0 && (chars[i - 1].is_alphanumeric() || matches!(chars[i - 1], '_' | '.' | '$'));
        if (c.is_alphabetic() || c == '_') && !prev_word {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || matches!(chars[i], '_' | '.')) {
                i += 1;
            }
            let name: String = chars[start..i].iter().collect();
            let call = chars.get(i) == Some(&'(');
            if !raw.is_empty() {
                out.push(Tok::Raw(std::mem::take(&mut raw)));
            }
            out.push(Tok::Ident { name, call });
            continue;
        }
        raw.push(c);
        i += 1;
    }
    if !raw.is_empty() {
        out.push(Tok::Raw(raw));
    }
    out
}

/// Removes `_xlfn.`, `_xlws.` and `_xlpm.` prefixes.
pub(crate) fn strip(f: &str) -> String {
    if !f.contains("_xl") {
        return f.to_string();
    }
    tokens(f)
        .into_iter()
        .map(|t| match t {
            Tok::Raw(s) => s,
            Tok::Ident { name, .. } => {
                let mut n = name.as_str();
                for p in ["_xlfn.", "_xlws.", "_xlpm.", "_xlfn.", "_xlws."] {
                    if n.len() > p.len() && n[..p.len()].eq_ignore_ascii_case(p) {
                        n = &n[p.len()..];
                    }
                }
                n.to_string()
            }
        })
        .collect()
}

/// Names bound by LET and LAMBDA in a formula (upper case).
fn bound_names(f: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let up = f.to_ascii_uppercase();
    for kw in ["LET(", "LAMBDA("] {
        let mut from = 0;
        while let Some(p) = up[from..].find(kw) {
            let at = from + p;
            from = at + kw.len();
            if at > 0
                && up[..at]
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
            {
                continue;
            }
            let args = top_level_args(&f[from..]);
            let n = args.len();
            let names: Vec<&String> = if kw == "LET(" {
                args.iter().take(n.saturating_sub(1)).step_by(2).collect()
            } else {
                args.iter().take(n.saturating_sub(1)).collect()
            };
            for a in names {
                let t = a.trim();
                if !t.is_empty()
                    && t.chars()
                        .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
                {
                    out.insert(t.to_ascii_uppercase());
                }
            }
        }
    }
    out
}

/// Arguments of a call up to its closing parenthesis (split at top-level commas).
fn top_level_args(s: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    for c in s.chars() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            out.last_mut().unwrap().push(c);
            continue;
        }
        match c {
            '"' | '\'' => quote = Some(c),
            '(' | '{' => depth += 1,
            ')' | '}' if depth == 0 => break,
            ')' | '}' => depth -= 1,
            ',' if depth == 0 => {
                out.push(String::new());
                continue;
            }
            _ => {}
        }
        out.last_mut().unwrap().push(c);
    }
    out
}

/// Adds the prefixes Excel needs.
pub(crate) fn add(f: &str) -> String {
    let bound = bound_names(f);
    tokens(f)
        .into_iter()
        .map(|t| match t {
            Tok::Raw(s) => s,
            Tok::Ident { name, call } => {
                let up = name.to_ascii_uppercase();
                if call && WORKSHEET.contains(&up.as_str()) {
                    format!("_xlfn._xlws.{name}")
                } else if call && FUTURE.contains(&up.as_str()) {
                    format!("_xlfn.{name}")
                } else if bound.contains(&up) && !is_reference(&name) {
                    format!("_xlpm.{name}")
                } else {
                    name
                }
            }
        })
        .collect()
}

fn is_reference(s: &str) -> bool {
    let letters = s.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    letters > 0
        && letters <= 3
        && letters < s.len()
        && s[letters..].chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let f = r#"LET(x,SEQUENCE(3),y,SORT(x,1,-1),XLOOKUP(2,x,y)&"LET(x"&Sheet1!A1)"#;
        let w = add(f);
        assert_eq!(
            w,
            r#"_xlfn.LET(_xlpm.x,_xlfn.SEQUENCE(3),_xlpm.y,_xlfn._xlws.SORT(_xlpm.x,1,-1),_xlfn.XLOOKUP(2,_xlpm.x,_xlpm.y)&"LET(x"&Sheet1!A1)"#
        );
        assert_eq!(strip(&w), f);
        assert_eq!(
            add("SUM(A1:B2)+MAP(A1:A3,LAMBDA(v,v*2))"),
            "SUM(A1:B2)+_xlfn.MAP(A1:A3,_xlfn.LAMBDA(_xlpm.v,_xlpm.v*2))"
        );
        assert_eq!(strip("_xlfn.STDEV.S(A1:A3)"), "STDEV.S(A1:A3)");
    }
}
