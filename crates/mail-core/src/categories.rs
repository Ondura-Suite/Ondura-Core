//! Colours of colour categories.
//!
//! Ondura uses one palette everywhere (it is also Ondura Server's web app
//! palette); servers that keep their own colour names (Ondura Server's keys,
//! Microsoft's `preset0`…`preset24`) are mapped to the nearest colour.

/// Ondura's category colours: (Ondura Server key, `#rrggbb`).
pub const PALETTE: [(&str, &str); 9] = [
    ("red", "#e05260"),
    ("orange", "#e8873b"),
    ("yellow", "#e6b800"),
    ("green", "#3aa655"),
    ("teal", "#17a2a2"),
    ("blue", "#3b82c4"),
    ("purple", "#9b59b6"),
    ("pink", "#e0559b"),
    ("gray", "#8a93a2"),
];

fn rgb(hex: &str) -> Option<(i32, i32, i32)> {
    let h = hex.trim().trim_start_matches('#');
    let h = match h.len() {
        3 => h.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 | 8 => h[..6].to_string(),
        _ => return None,
    };
    let n = u32::from_str_radix(&h, 16).ok()?;
    Some(((n >> 16 & 255) as i32, (n >> 8 & 255) as i32, (n & 255) as i32))
}

/// Key of the colour in `choices` (key, hex) nearest to `hex`.
pub fn nearest<'a>(hex: &str, choices: &[(&'a str, &'a str)]) -> Option<&'a str> {
    let (r, g, b) = rgb(hex)?;
    choices
        .iter()
        .filter_map(|(k, h)| rgb(h).map(|(r2, g2, b2)| (k, (r - r2).pow(2) * 3 + (g - g2).pow(2) * 4 + (b - b2).pow(2) * 2)))
        .min_by_key(|(_, d)| *d)
        .map(|(k, _)| *k)
}

/// Colour for a category without one: the usual one for colour names
/// (Outlook's "Rot", "Blaue Kategorie" …), otherwise derived from the name.
pub fn default_color(name: &str) -> &'static str {
    let key = name.trim().to_lowercase();
    // "Blaue Kategorie" → "blau": the first word without an inflection ending.
    let word = key.split_whitespace().next().unwrap_or("");
    let stems = [word, word.strip_suffix("en").unwrap_or(word), word.strip_suffix('e').unwrap_or(word)];
    let named = [
        ("rot", "red"),
        ("red", "red"),
        ("orange", "orange"),
        ("gelb", "yellow"),
        ("yellow", "yellow"),
        ("grün", "green"),
        ("green", "green"),
        ("türkis", "teal"),
        ("teal", "teal"),
        ("blau", "blue"),
        ("blue", "blue"),
        ("lila", "purple"),
        ("purple", "purple"),
        ("rosa", "pink"),
        ("pink", "pink"),
        ("grau", "gray"),
        ("gray", "gray"),
        ("grey", "gray"),
    ];
    let key_name = named.iter().find(|(n, _)| stems.contains(n)).map(|(_, k)| *k).unwrap_or_else(|| {
        let hash = key.chars().fold(0u32, |h, c| h.wrapping_mul(31).wrapping_add(c as u32));
        PALETTE[hash as usize % PALETTE.len()].0
    });
    hex_of(key_name).unwrap_or("#3b82c4")
}

/// `#rrggbb` of a palette key.
pub fn hex_of(key: &str) -> Option<&'static str> {
    PALETTE.iter().find(|(k, _)| *k == key).map(|(_, h)| *h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_nearest() {
        assert_eq!(default_color("Rot"), "#e05260");
        assert_eq!(default_color("Blaue Kategorie"), "#3b82c4");
        assert_eq!(default_color("Grüne Kategorie"), "#3aa655");
        assert_eq!(default_color("Orange Kategorie"), "#e8873b");
        assert_eq!(default_color("Projekt X"), default_color("projekt x"));
        // Same as apps/ondura/src/lib/categories.ts.
        assert_eq!(default_color("Projekt X"), "#3b82c4");
        assert_eq!(nearest("#d13438", &PALETTE), Some("red"));
        assert_eq!(nearest("#4f54d4", &PALETTE), Some("blue"));
        assert_eq!(nearest("#3aa655", &PALETTE), Some("green"));
        assert_eq!(nearest("nonsense", &PALETTE), None);
    }
}
