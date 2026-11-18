//! Translations of the messages the Rust side shows to users (errors,
//! notifications, compatibility notes).
//!
//! German is the source language: the German text is the key, the catalogs
//! in `locales/` map it to English and French; missing entries fall back to
//! German. The frontend sets the language ([`set_language`]) to the one of
//! its user interface.
//!
//! ```
//! use ondura_i18n::tr;
//! let e = "timeout";
//! let msg = tr!("Der Download ist fehlgeschlagen: {0}", e);
//! assert!(msg.ends_with("timeout"));
//! ```

use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

/// User interface language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    De,
    En,
    Fr,
}

impl Lang {
    /// Parses "de", "en", "fr" (also "en-US" etc.).
    pub fn parse(code: &str) -> Option<Lang> {
        match code.get(..2)?.to_ascii_lowercase().as_str() {
            "de" => Some(Lang::De),
            "en" => Some(Lang::En),
            "fr" => Some(Lang::Fr),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Lang::De => "de",
            Lang::En => "en",
            Lang::Fr => "fr",
        }
    }
}

// 0 = not set yet (German), else Lang as 1..=3.
static LANG: AtomicU8 = AtomicU8::new(0);

/// Sets the language of all following messages.
pub fn set_language(lang: Lang) {
    LANG.store(
        match lang {
            Lang::De => 1,
            Lang::En => 2,
            Lang::Fr => 3,
        },
        Ordering::Relaxed,
    );
}

/// The current language (German until [`set_language`] is called).
pub fn language() -> Lang {
    match LANG.load(Ordering::Relaxed) {
        2 => Lang::En,
        3 => Lang::Fr,
        _ => Lang::De,
    }
}

fn catalog(lang: Lang) -> Option<&'static HashMap<String, String>> {
    static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
    static FR: OnceLock<HashMap<String, String>> = OnceLock::new();
    let (cell, json) = match lang {
        Lang::De => return None,
        Lang::En => (&EN, include_str!("../locales/en.json")),
        Lang::Fr => (&FR, include_str!("../locales/fr.json")),
    };
    Some(cell.get_or_init(|| serde_json::from_str(json).unwrap_or_default()))
}

/// Translates a German text into the current language.
pub fn translate(text: &str) -> String {
    catalog(language())
        .and_then(|c| c.get(text))
        .cloned()
        .unwrap_or_else(|| text.to_string())
}

/// Replaces `{0}`, `{1}` … in `template` by `args`.
pub fn fill(template: &str, args: &[String]) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after
            .find('}')
            .and_then(|end| after[..end].parse::<usize>().ok().map(|i| (i, end)))
        {
            Some((i, end)) if i < args.len() => {
                out.push_str(&args[i]);
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `tr!("German text {0}", arg)` → translated `String`; arguments are
/// formatted with `Display`.
#[macro_export]
macro_rules! tr {
    ($text:literal) => {
        $crate::translate($text)
    };
    ($text:literal, $($arg:expr),+ $(,)?) => {
        $crate::fill(&$crate::translate($text), &[$(format!("{}", $arg)),+])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_placeholders() {
        assert_eq!(fill("{0} von {1}", &["a".into(), "b".into()]), "a von b");
        assert_eq!(fill("{x} {0} {9}", &["a".into()]), "{x} a {9}");
    }

    #[test]
    fn catalogs_parse() {
        for lang in [Lang::En, Lang::Fr] {
            let c = catalog(lang).unwrap();
            assert!(c.len() > 100, "{lang:?} catalog is empty or invalid");
            // Placeholders must survive the translation.
            for (k, v) in c {
                let ph = |s: &str| {
                    let mut p: Vec<String> = (0..10)
                        .map(|i| format!("{{{i}}}"))
                        .filter(|p| s.contains(p.as_str()))
                        .collect();
                    p.sort();
                    p
                };
                assert_eq!(ph(k), ph(v), "{lang:?}: {k}");
            }
        }
    }
}
