//! Minimal BER/DER reader and DER writer for the structures S/MIME needs
//! (X.509, CMS, PKCS#12). The reader accepts BER as produced by mail
//! clients: indefinite lengths and constructed (chunked) strings.

use crate::{Error, Result};

pub const BOOLEAN: u8 = 0x01;
pub const INTEGER: u8 = 0x02;
pub const BIT_STRING: u8 = 0x03;
pub const OCTET_STRING: u8 = 0x04;
pub const NULL: u8 = 0x05;
pub const OID: u8 = 0x06;
pub const UTF8_STRING: u8 = 0x0c;
pub const PRINTABLE_STRING: u8 = 0x13;
pub const IA5_STRING: u8 = 0x16;
pub const UTC_TIME: u8 = 0x17;
pub const GENERALIZED_TIME: u8 = 0x18;
pub const SEQUENCE: u8 = 0x30;
pub const SET: u8 = 0x31;

/// One element. `tag` is the full identifier octet (class, constructed bit
/// and number), e.g. `0x30` for SEQUENCE or `0xa0` for `[0]` constructed.
#[derive(Debug, Clone, Copy)]
pub struct Tlv<'a> {
    pub tag: u8,
    /// Content octets (without end-of-contents for indefinite lengths).
    pub body: &'a [u8],
    /// The whole element including its header.
    pub raw: &'a [u8],
    /// `true` if the length was indefinite (the body then holds elements).
    pub indefinite: bool,
}

fn err(msg: &str) -> Error {
    Error::Format(msg.to_string())
}

/// Read one element from the start of `input`; returns it and the rest.
pub fn read(input: &[u8]) -> Result<(Tlv<'_>, &[u8])> {
    if input.len() < 2 {
        return Err(err("truncated element"));
    }
    let tag = input[0];
    if tag & 0x1f == 0x1f {
        return Err(err("multi-byte tags are not supported"));
    }
    let first = input[1];
    let (len, header) = if first < 0x80 {
        (Some(first as usize), 2)
    } else if first == 0x80 {
        (None, 2)
    } else {
        let n = (first & 0x7f) as usize;
        if n > 4 || input.len() < 2 + n {
            return Err(err("bad length"));
        }
        let len = input[2..2 + n].iter().fold(0usize, |a, b| (a << 8) | *b as usize);
        (Some(len), 2 + n)
    };
    match len {
        Some(len) => {
            let end = header.checked_add(len).filter(|e| *e <= input.len()).ok_or_else(|| err("element exceeds input"))?;
            Ok((Tlv { tag, body: &input[header..end], raw: &input[..end], indefinite: false }, &input[end..]))
        }
        None => {
            if tag & 0x20 == 0 {
                return Err(err("indefinite length on primitive element"));
            }
            // Walk the children up to the end-of-contents marker.
            let mut rest = &input[header..];
            loop {
                if rest.len() >= 2 && rest[0] == 0 && rest[1] == 0 {
                    let body_len = input.len() - header - rest.len();
                    let end = header + body_len + 2;
                    return Ok((Tlv { tag, body: &input[header..header + body_len], raw: &input[..end], indefinite: true }, &input[end..]));
                }
                let (_, r) = read(rest)?;
                rest = r;
            }
        }
    }
}

impl<'a> Tlv<'a> {
    /// Parse a complete element (trailing bytes are ignored).
    pub fn parse(input: &'a [u8]) -> Result<Tlv<'a>> {
        Ok(read(input)?.0)
    }

    pub fn expect(self, tag: u8) -> Result<Tlv<'a>> {
        if self.tag == tag { Ok(self) } else { Err(Error::Format(format!("expected tag {tag:#04x}, found {:#04x}", self.tag))) }
    }

    /// Child elements of a constructed element.
    pub fn children(&self) -> Result<Vec<Tlv<'a>>> {
        let mut out = Vec::new();
        let mut rest = self.body;
        while !rest.is_empty() {
            let (t, r) = read(rest)?;
            out.push(t);
            rest = r;
        }
        Ok(out)
    }

    /// Child `i`, or an error.
    pub fn child(&self, i: usize) -> Result<Tlv<'a>> {
        self.children()?.get(i).copied().ok_or_else(|| err("missing element"))
    }

    /// The octets of an OCTET STRING (or implicitly tagged one), joining
    /// the chunks of a constructed (BER) string.
    pub fn octets(&self) -> Result<Vec<u8>> {
        if self.tag & 0x20 == 0 {
            return Ok(self.body.to_vec());
        }
        let mut out = Vec::new();
        for c in self.children()? {
            out.extend(c.octets()?);
        }
        Ok(out)
    }

    /// Dotted form of an OID.
    pub fn oid(&self) -> Result<String> {
        if self.tag != OID {
            return Err(err("expected an OID"));
        }
        oid_string(self.body)
    }

    /// The element re-encoded with definite lengths (DER-ish), so it can be
    /// hashed or compared. Only needed for BER input.
    pub fn to_der(&self) -> Result<Vec<u8>> {
        if !self.indefinite && (self.tag & 0x20 == 0 || !has_indefinite(self.body)?) {
            return Ok(self.raw.to_vec());
        }
        let mut content = Vec::new();
        for c in self.children()? {
            content.extend(c.to_der()?);
        }
        Ok(tlv(self.tag, &content))
    }

    /// Unsigned big-endian integer value (leading zero stripped).
    pub fn uint(&self) -> &'a [u8] {
        let b = self.body;
        if b.len() > 1 && b[0] == 0 { &b[1..] } else { b }
    }

    pub fn small_int(&self) -> Result<u64> {
        if self.tag != INTEGER || self.body.len() > 8 {
            return Err(err("expected a small INTEGER"));
        }
        Ok(self.body.iter().fold(0u64, |a, b| (a << 8) | *b as u64))
    }
}

fn has_indefinite(body: &[u8]) -> Result<bool> {
    let mut rest = body;
    while !rest.is_empty() {
        let (t, r) = read(rest)?;
        if t.indefinite || (t.tag & 0x20 != 0 && has_indefinite(t.body)?) {
            return Ok(true);
        }
        rest = r;
    }
    Ok(false)
}

pub fn oid_string(body: &[u8]) -> Result<String> {
    let mut parts: Vec<u64> = Vec::new();
    let mut v = 0u64;
    for (i, b) in body.iter().enumerate() {
        v = (v << 7) | (b & 0x7f) as u64;
        if b & 0x80 == 0 {
            if parts.is_empty() {
                let first = if v < 80 { v / 40 } else { 2 };
                parts.push(first);
                parts.push(v - first * 40);
            } else {
                parts.push(v);
            }
            v = 0;
        } else if i == body.len() - 1 {
            return Err(err("truncated OID"));
        }
    }
    Ok(parts.iter().map(u64::to_string).collect::<Vec<_>>().join("."))
}

// ------------------------------------------------------------------ writer

/// Encode one element with a definite length.
pub fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(content.len() + 6);
    out.push(tag);
    let len = content.len();
    if len < 0x80 {
        out.push(len as u8);
    } else {
        let bytes: Vec<u8> = len.to_be_bytes().into_iter().skip_while(|b| *b == 0).collect();
        out.push(0x80 | bytes.len() as u8);
        out.extend(bytes);
    }
    out.extend_from_slice(content);
    out
}

pub fn seq(items: &[&[u8]]) -> Vec<u8> {
    tlv(SEQUENCE, &items.concat())
}

/// DER SET OF: elements sorted by their encoding.
pub fn set_of(items: &[Vec<u8>]) -> Vec<u8> {
    let mut sorted: Vec<&Vec<u8>> = items.iter().collect();
    sorted.sort();
    tlv(SET, &sorted.into_iter().flatten().copied().collect::<Vec<u8>>())
}

pub fn oid(dotted: &str) -> Vec<u8> {
    let parts: Vec<u64> = dotted.split('.').map(|p| p.parse().expect("valid OID")).collect();
    let mut body = Vec::new();
    let mut push = |mut v: u64| {
        let mut chunk = vec![(v & 0x7f) as u8];
        v >>= 7;
        while v > 0 {
            chunk.push(0x80 | (v & 0x7f) as u8);
            v >>= 7;
        }
        chunk.reverse();
        body.extend(chunk);
    };
    push(parts[0] * 40 + parts[1]);
    for p in &parts[2..] {
        push(*p);
    }
    tlv(OID, &body)
}

pub fn int(v: u64) -> Vec<u8> {
    let mut bytes: Vec<u8> = v.to_be_bytes().into_iter().skip_while(|b| *b == 0).collect();
    if bytes.first().is_none_or(|b| b & 0x80 != 0) {
        bytes.insert(0, 0);
    }
    tlv(INTEGER, &bytes)
}

pub fn octets(data: &[u8]) -> Vec<u8> {
    tlv(OCTET_STRING, data)
}

pub fn null() -> Vec<u8> {
    vec![NULL, 0]
}

/// AlgorithmIdentifier with optional parameters.
pub fn alg(dotted: &str, params: Option<&[u8]>) -> Vec<u8> {
    match params {
        Some(p) => seq(&[&oid(dotted), p]),
        None => seq(&[&oid(dotted)]),
    }
}

/// Context-specific tag `[n]`, constructed.
pub fn ctx(n: u8, content: &[u8]) -> Vec<u8> {
    tlv(0xa0 | n, content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_oids_and_ints() {
        let o = oid("1.2.840.113549.1.7.2");
        assert_eq!(o, [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
        assert_eq!(Tlv::parse(&o).unwrap().oid().unwrap(), "1.2.840.113549.1.7.2");
        assert_eq!(int(128), [0x02, 0x02, 0x00, 0x80]);
        assert_eq!(Tlv::parse(&int(300)).unwrap().small_int().unwrap(), 300);
    }

    #[test]
    fn reads_ber_indefinite_and_chunked_strings() {
        // SEQUENCE (indefinite) { OCTET STRING (constructed, indefinite) { "ab", "c" } }
        let ber = [0x30, 0x80, 0x24, 0x80, 0x04, 0x02, b'a', b'b', 0x04, 0x01, b'c', 0x00, 0x00, 0x00, 0x00, 0xff];
        let (t, rest) = read(&ber).unwrap();
        assert_eq!(rest, [0xff]);
        let s = t.child(0).unwrap();
        assert_eq!(s.octets().unwrap(), b"abc");
        assert_eq!(t.to_der().unwrap(), [0x30, 0x09, 0x24, 0x07, 0x04, 0x02, b'a', b'b', 0x04, 0x01, b'c']);
    }

    #[test]
    fn long_lengths() {
        let data = vec![7u8; 300];
        let enc = octets(&data);
        assert_eq!(&enc[..4], [0x04, 0x82, 0x01, 0x2c]);
        assert_eq!(Tlv::parse(&enc).unwrap().body.len(), 300);
    }
}
