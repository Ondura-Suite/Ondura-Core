//! vCard 3.0/4.0 reading and writing (RFC 2426 / RFC 6350), for CardDAV and
//! the local address book. Unknown properties survive edits.

use chrono::NaiveDate;

use crate::ical::{Component, Prop, escape, parse, serialize, unescape};
use crate::model::{Contact, Labeled, PostalAddress};

fn split_struct(v: &str) -> Vec<String> {
    // Structured values (N, ADR, ORG) are ';'-separated with '\;' escapes.
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(n) = chars.next() {
                    cur.push('\\');
                    cur.push(n);
                }
            }
            ';' => parts.push(unescape(&std::mem::take(&mut cur))),
            _ => cur.push(c),
        }
    }
    parts.push(unescape(&cur));
    parts
}

fn type_label(p: &Prop, default: &str) -> String {
    let types: Vec<String> = p
        .params
        .iter()
        .filter(|(k, _)| k == "TYPE")
        .flat_map(|(_, v)| v.split(',').map(|t| t.trim_matches('"').to_ascii_lowercase()).collect::<Vec<_>>())
        .collect();
    for (t, label) in [("cell", "mobile"), ("work", "work"), ("home", "home")] {
        if types.iter().any(|x| x == t) {
            return label.to_string();
        }
    }
    default.to_string()
}

fn type_param(label: &str, is_phone: bool) -> &'static str {
    match label {
        "mobile" if is_phone => "CELL",
        "work" => "WORK",
        "home" => "HOME",
        _ => "OTHER",
    }
}

fn parse_birthday(v: &str) -> Option<NaiveDate> {
    let v = v.trim();
    NaiveDate::parse_from_str(&v[..10.min(v.len())], "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(&v[..8.min(v.len())], "%Y%m%d"))
        .ok()
}

pub fn parse_contact(text: &str, resource_id: &str) -> Option<Contact> {
    let card = parse(text).into_iter().find(|c| c.name == "VCARD")?;
    Some(contact_from(&card, resource_id))
}

/// All contacts of a multi-card file (vCard import).
pub fn parse_all(text: &str) -> Vec<Contact> {
    parse(text)
        .into_iter()
        .filter(|c| c.name == "VCARD")
        .map(|c| {
            let mut contact = contact_from(&c, "");
            contact.raw = Some(serialize(&c));
            contact
        })
        .collect()
}

fn contact_from(card: &Component, resource_id: &str) -> Contact {
    let n = card.value("N").map(split_struct).unwrap_or_default();
    let org = card.value("ORG").map(split_struct).unwrap_or_default();
    Contact {
        remote_id: resource_id.to_string(),
        display_name: card.text("FN"),
        family_name: n.first().cloned().unwrap_or_default(),
        given_name: n.get(1).cloned().unwrap_or_default(),
        company: org.first().cloned().unwrap_or_default(),
        job_title: card.text("TITLE"),
        emails: card
            .props_named("EMAIL")
            .map(|p| Labeled { label: type_label(p, "other"), value: unescape(&p.value) })
            .filter(|l| !l.value.is_empty())
            .collect(),
        phones: card
            .props_named("TEL")
            .map(|p| Labeled { label: type_label(p, "other"), value: unescape(p.value.trim_start_matches("tel:")) })
            .filter(|l| !l.value.is_empty())
            .collect(),
        addresses: card
            .props_named("ADR")
            .map(|p| {
                let a = split_struct(&p.value);
                let get = |i: usize| a.get(i).cloned().unwrap_or_default();
                PostalAddress { label: type_label(p, "home"), street: get(2), city: get(3), postal_code: get(5), country: get(6) }
            })
            .collect(),
        birthday: card.value("BDAY").and_then(parse_birthday),
        notes: card.text("NOTE"),
        groups: card
            .value("CATEGORIES")
            .map(|v| split_list(v).into_iter().filter(|g| !g.is_empty()).collect())
            .unwrap_or_default(),
        photo: card.prop("PHOTO").and_then(photo_uri),
        ..Default::default()
    }
}

/// Values of a comma-separated list property (escaped commas stay).
fn split_list(v: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut esc = false;
    for ch in v.chars() {
        match (esc, ch) {
            (false, '\\') => esc = true,
            (false, ',') => out.push(String::new()),
            (true, 'n' | 'N') => {
                out.last_mut().unwrap().push(' ');
                esc = false;
            }
            (_, c) => {
                out.last_mut().unwrap().push(c);
                esc = false;
            }
        }
    }
    out.into_iter().map(|s| s.trim().to_string()).collect()
}

/// PHOTO as data URI (vCard 3 inline base64 or vCard 4 data URI).
fn photo_uri(p: &Prop) -> Option<String> {
    let v = p.value.trim();
    if v.starts_with("data:") {
        return Some(v.to_string());
    }
    let inline = p.param("ENCODING").is_some_and(|e| e.eq_ignore_ascii_case("b") || e.eq_ignore_ascii_case("BASE64"));
    if !inline || v.is_empty() {
        return None;
    }
    let kind = p.param("TYPE").unwrap_or("JPEG").to_ascii_lowercase();
    Some(format!("data:image/{kind};base64,{}", v.replace([' ', '\r', '\n'], "")))
}

/// New or updated vCard; properties Nexora does not edit are kept.
pub fn contact_vcard(existing: Option<&str>, uid: &str, c: &Contact) -> String {
    let mut card = existing
        .and_then(|e| parse(e).into_iter().find(|x| x.name == "VCARD"))
        .unwrap_or_else(|| {
            let mut card = Component::new("VCARD");
            card.props.push(Prop::new("VERSION", "3.0"));
            card.props.push(Prop::new("UID", uid));
            card
        });
    let name = c.effective_name();
    card.set(Prop::new("FN", escape(&name)));
    card.set(Prop::new("N", format!("{};{};;;", escape(&c.family_name), escape(&c.given_name))));
    if c.company.is_empty() {
        card.remove("ORG");
    } else {
        card.set(Prop::new("ORG", escape(&c.company)));
    }
    card.set_text("TITLE", &c.job_title);
    card.set_text("NOTE", &c.notes);
    for name in ["EMAIL", "TEL", "ADR"] {
        card.remove(name);
    }
    for e in &c.emails {
        card.props.push(Prop::new("EMAIL", escape(&e.value)).with_param("TYPE", format!("INTERNET,{}", type_param(&e.label, false))));
    }
    for t in &c.phones {
        card.props.push(Prop::new("TEL", escape(&t.value)).with_param("TYPE", type_param(&t.label, true)));
    }
    for a in &c.addresses {
        let v = format!(";;{};{};;{};{}", escape(&a.street), escape(&a.city), escape(&a.postal_code), escape(&a.country));
        card.props.push(Prop::new("ADR", v).with_param("TYPE", type_param(&a.label, false)));
    }
    match c.birthday {
        Some(b) => card.set(Prop::new("BDAY", b.format("%Y-%m-%d").to_string())),
        None => card.remove("BDAY"),
    }
    if c.groups.is_empty() {
        card.remove("CATEGORIES");
    } else {
        card.set(Prop::new("CATEGORIES", c.groups.iter().map(|g| escape(g)).collect::<Vec<_>>().join(",")));
    }
    match c.photo.as_deref().and_then(|p| p.strip_prefix("data:")).and_then(|p| p.split_once(";base64,")) {
        Some((mime, data)) => {
            let kind = mime.rsplit('/').next().unwrap_or("jpeg").to_ascii_uppercase();
            card.set(Prop::new("PHOTO", data).with_param("ENCODING", "b").with_param("TYPE", kind));
        }
        None => card.remove("PHOTO"),
    }
    card.set(Prop::new("REV", chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string()));
    serialize(&card)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CARD: &str = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:42\r\nFN:Jürgen Müller\r\nN:Müller;Jürgen;;;\r\n\
ORG:Müller\\; Söhne GmbH;Vertrieb\r\nTITLE:Leitung\r\nitem1.EMAIL;TYPE=INTERNET,WORK:jm@example.com\r\n\
TEL;TYPE=CELL:+49 170 1234567\r\nADR;TYPE=WORK:;;Hauptstr. 1;Saarbrücken;;66111;Deutschland\r\n\
BDAY:1980-02-29\r\nX-CUSTOM:bleibt\r\nPHOTO;ENCODING=b;TYPE=JPEG:AAAA\r\nEND:VCARD\r\n";

    #[test]
    fn parses_and_roundtrips() {
        let c = parse_contact(CARD, "/ab/42.vcf").unwrap();
        assert_eq!(c.display_name, "Jürgen Müller");
        assert_eq!((c.given_name.as_str(), c.family_name.as_str()), ("Jürgen", "Müller"));
        assert_eq!(c.company, "Müller; Söhne GmbH");
        assert_eq!(c.emails[0], Labeled { label: "work".into(), value: "jm@example.com".into() });
        assert_eq!(c.phones[0].label, "mobile");
        assert_eq!(c.addresses[0].city, "Saarbrücken");
        assert_eq!(c.birthday, NaiveDate::from_ymd_opt(1980, 2, 29));

        let mut edited = c.clone();
        edited.job_title = "Geschäftsführer".into();
        edited.phones.push(Labeled { label: "work".into(), value: "0681 123".into() });
        assert_eq!(c.photo.as_deref(), Some("data:image/jpeg;base64,AAAA"));
        edited.groups = vec!["Familie".into(), "Golf, Club".into()];
        let out = contact_vcard(Some(CARD), "42", &edited);
        assert!(out.contains("X-CUSTOM:bleibt"), "unknown properties are kept");
        assert!(out.contains("PHOTO"));
        assert_eq!(parse_contact(&out, "x").unwrap().groups, ["Familie", "Golf, Club"]);
        let back = parse_contact(&out, "x").unwrap();
        assert_eq!(back.job_title, "Geschäftsführer");
        assert_eq!(back.phones.len(), 2);
        assert_eq!(back.company, "Müller; Söhne GmbH");
    }
}
