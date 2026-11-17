//! Modified UTF-7 (RFC 3501 §5.1.3) used for IMAP mailbox names,
//! e.g. `Entw&APw-rfe` → `Entwürfe`.

use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;

pub fn decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('-') else {
            // Malformed: keep verbatim.
            out.push_str(&rest[start..]);
            return out;
        };
        let encoded = &after[..end];
        if encoded.is_empty() {
            out.push('&');
        } else {
            let b64 = encoded.replace(',', "/");
            match STANDARD_NO_PAD.decode(b64.as_bytes()) {
                Ok(bytes) => {
                    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect();
                    out.push_str(&String::from_utf16_lossy(&units));
                }
                Err(_) => {
                    out.push('&');
                    out.push_str(encoded);
                    out.push('-');
                }
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn decodes_mutf7() {
        assert_eq!(decode("INBOX"), "INBOX");
        assert_eq!(decode("Entw&APw-rfe"), "Entwürfe");
        assert_eq!(decode("Gel&APY-schte Elemente"), "Gelöschte Elemente");
        assert_eq!(decode("Tom &- Jerry"), "Tom & Jerry");
    }
}
