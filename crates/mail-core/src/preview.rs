//! Helpers to turn raw RFC 5322 messages and HTML into model types.

use chrono::{DateTime, TimeZone, Utc};
use mail_parser::{Addr, MessageParser, MimeHeaders};

use crate::model::{Address, AttachmentInfo, MessageBody};

/// Maximum length of the preview line shown in the message list.
pub const PREVIEW_LEN: usize = 200;

/// Very small HTML-to-text conversion used for previews (not for display).
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut tag = String::new();
    let mut skip_depth = 0usize; // inside <style>/<script>/<head>
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let t = tag.trim().to_ascii_lowercase();
                let name: String = t.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
                if matches!(name.as_str(), "style" | "script" | "head") {
                    if t.starts_with('/') {
                        skip_depth = skip_depth.saturating_sub(1);
                    } else if !t.ends_with('/') {
                        skip_depth += 1;
                    }
                }
                if matches!(name.as_str(), "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3") {
                    out.push(' ');
                }
            }
            _ if in_tag => tag.push(c),
            _ if skip_depth > 0 => {}
            _ => out.push(c),
        }
    }
    decode_entities(&out)
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&auml;", "ä")
        .replace("&ouml;", "ö")
        .replace("&uuml;", "ü")
        .replace("&Auml;", "Ä")
        .replace("&Ouml;", "Ö")
        .replace("&Uuml;", "Ü")
        .replace("&szlig;", "ß")
}

/// Collapse whitespace and cut to [`PREVIEW_LEN`] characters.
pub fn make_preview(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(PREVIEW_LEN).collect()
}

pub fn preview_from_body(body: &MessageBody) -> String {
    if let Some(text) = body.text.as_deref().filter(|t| !t.trim().is_empty()) {
        make_preview(text)
    } else if let Some(html) = body.html.as_deref() {
        make_preview(&html_to_text(html))
    } else {
        String::new()
    }
}

/// Headers extracted from a raw message (or a raw header block).
#[derive(Debug, Default)]
pub struct ParsedHeaders {
    pub subject: String,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub date: Option<DateTime<Utc>>,
    pub message_id: Option<String>,
    pub is_multipart_mixed: bool,
    pub high_importance: bool,
}

fn addr(a: &Addr<'_>) -> Option<Address> {
    let email = a.address.as_deref()?.to_string();
    Some(Address::new(a.name.as_deref().map(str::to_string), email))
}

fn addresses(v: Option<&mail_parser::Address<'_>>) -> Vec<Address> {
    match v {
        Some(list) => list.iter().filter_map(addr).collect(),
        None => Vec::new(),
    }
}

/// Parse a raw header block (or full message) with `mail-parser`, which
/// takes care of RFC 2047 encoded words and charsets.
pub fn parse_headers(raw: &[u8]) -> ParsedHeaders {
    let Some(msg) = MessageParser::default().parse_headers(raw) else {
        return ParsedHeaders::default();
    };
    let date = msg
        .date()
        .and_then(|d| Utc.timestamp_opt(d.to_timestamp(), 0).single());
    let is_multipart_mixed = msg
        .content_type()
        .map(|ct| ct.ctype().eq_ignore_ascii_case("multipart") && ct.subtype().is_some_and(|s| s.eq_ignore_ascii_case("mixed")))
        .unwrap_or(false);
    let high_importance = msg
        .header_raw("Importance")
        .map(|v| v.trim().eq_ignore_ascii_case("high"))
        .or_else(|| msg.header_raw("X-Priority").map(|v| v.trim().starts_with('1') || v.trim().starts_with('2')))
        .unwrap_or(false);
    ParsedHeaders {
        subject: msg.subject().unwrap_or_default().to_string(),
        from: msg.from().and_then(|f| f.first()).and_then(addr),
        to: addresses(msg.to()),
        cc: addresses(msg.cc()),
        date,
        message_id: msg.message_id().map(|id| format!("<{id}>")),
        is_multipart_mixed,
        high_importance,
    }
}

/// Parse a full raw message into a [`MessageBody`].
pub fn parse_body(raw: &[u8]) -> MessageBody {
    let Some(msg) = MessageParser::default().parse(raw) else {
        return MessageBody { html: None, text: Some(String::from_utf8_lossy(raw).into_owned()), attachments: vec![] };
    };
    let mut html = msg.body_html(0).map(|s| s.into_owned());
    let text = msg.body_text(0).map(|s| s.into_owned());
    let mut attachments: Vec<AttachmentInfo> = msg
        .attachments()
        .enumerate()
        .map(|(i, part)| AttachmentInfo {
            id: i.to_string(),
            name: part.attachment_name().unwrap_or("Anhang").to_string(),
            content_type: part
                .content_type()
                .map(|ct| match ct.subtype() {
                    Some(sub) => format!("{}/{}", ct.ctype(), sub),
                    None => ct.ctype().to_string(),
                })
                .unwrap_or_else(|| "application/octet-stream".into()),
            size: part.len() as u64,
            is_inline: part.content_disposition().is_some_and(|d| d.is_inline()),
            content_id: part.content_id().map(str::to_string),
        })
        .collect();

    // Embed images referenced as `cid:` so the sandboxed reading pane can
    // show them without access to the message.
    if let Some(h) = html.as_mut() {
        for (i, part) in msg.attachments().enumerate() {
            let info = &mut attachments[i];
            let Some(cid) = info.content_id.clone() else { continue };
            if !info.content_type.starts_with("image/") || part.len() > MAX_INLINE_IMAGE {
                continue;
            }
            let needle = format!("cid:{}", cid.trim_start_matches('<').trim_end_matches('>'));
            if h.contains(&needle) {
                *h = h.replace(&needle, &data_uri(&info.content_type, part.contents()));
                info.is_inline = true;
            }
        }
    }
    MessageBody { html, text, attachments }
}

/// Inline images larger than this stay attachments.
pub const MAX_INLINE_IMAGE: usize = 5 * 1024 * 1024;

pub fn data_uri(content_type: &str, data: &[u8]) -> String {
    use base64::Engine;
    format!("data:{content_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(data))
}

/// Raw bytes of attachment number `index` (as numbered by [`parse_body`]).
pub fn attachment_bytes(raw: &[u8], index: usize) -> Option<Vec<u8>> {
    let msg = MessageParser::default().parse(raw)?;
    msg.attachments().nth(index).map(|p| p.contents().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &[u8] = b"From: =?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <juergen@example.com>\r\n\
To: Niklas <niklas@mirranet.de>\r\n\
Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?= aus Saarbr\xc3\xbccken\r\n\
Date: Tue, 17 Nov 2026 10:00:00 +0100\r\n\
Message-ID: <abc@example.com>\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<html><head><style>p{color:red}</style></head><body><p>Hallo&nbsp;Niklas,</p><p>wie geht's?</p></body></html>\r\n";

    #[test]
    fn parses_encoded_headers() {
        let h = parse_headers(RAW);
        assert_eq!(h.subject, "Grüße aus Saarbrücken");
        let from = h.from.unwrap();
        assert_eq!(from.name.as_deref(), Some("Jürgen Müller"));
        assert_eq!(from.email, "juergen@example.com");
        assert_eq!(h.to.len(), 1);
        assert_eq!(h.message_id.as_deref(), Some("<abc@example.com>"));
        assert_eq!(h.date.unwrap().to_rfc3339(), "2026-11-17T09:00:00+00:00");
    }

    #[test]
    fn inlines_cid_images() {
        let raw = b"From: a@b.c\r\nSubject: x\r\nMIME-Version: 1.0\r\n\
Content-Type: multipart/related; boundary=\"B\"\r\n\r\n\
--B\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p><img src=\"cid:logo@x\"></p>\r\n\
--B\r\nContent-Type: image/png\r\nContent-ID: <logo@x>\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n\
--B--\r\n";
        let body = parse_body(raw);
        let html = body.html.unwrap();
        assert!(html.contains("data:image/png;base64,iVBORw0KGgo="), "{html}");
        assert!(body.attachments[0].is_inline);
    }

    #[test]
    fn builds_preview_from_html() {
        let body = parse_body(RAW);
        let p = preview_from_body(&body);
        assert_eq!(p, "Hallo Niklas, wie geht's?");
    }
}
