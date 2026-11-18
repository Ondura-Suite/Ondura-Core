//! Minimal NTLMv2 client (MS-NLMP) for HTTP authentication against
//! Exchange/IIS. Only what is needed to authenticate: no signing/sealing.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use hmac::{Hmac, Mac};
use md4::{Digest, Md4};
use md5::Md5;

type HmacMd5 = Hmac<Md5>;

const SIGNATURE: &[u8; 8] = b"NTLMSSP\0";

const NEGOTIATE_UNICODE: u32 = 0x0000_0001;
const REQUEST_TARGET: u32 = 0x0000_0004;
const NEGOTIATE_NTLM: u32 = 0x0000_0200;
const NEGOTIATE_ALWAYS_SIGN: u32 = 0x0000_8000;
const NEGOTIATE_EXTENDED_SESSIONSECURITY: u32 = 0x0008_0000;
const NEGOTIATE_TARGET_INFO: u32 = 0x0080_0000;
const NEGOTIATE_128: u32 = 0x2000_0000;
const NEGOTIATE_56: u32 = 0x8000_0000;

const FLAGS: u32 = NEGOTIATE_UNICODE
    | REQUEST_TARGET
    | NEGOTIATE_NTLM
    | NEGOTIATE_ALWAYS_SIGN
    | NEGOTIATE_EXTENDED_SESSIONSECURITY
    | NEGOTIATE_TARGET_INFO
    | NEGOTIATE_128
    | NEGOTIATE_56;

/// Seconds between 1601-01-01 and 1970-01-01.
const FILETIME_EPOCH_OFFSET: u64 = 11_644_473_600;

fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

fn hmac_md5(key: &[u8], parts: &[&[u8]]) -> [u8; 16] {
    let mut mac = HmacMd5::new_from_slice(key).expect("HMAC accepts any key length");
    for p in parts {
        mac.update(p);
    }
    mac.finalize().into_bytes().into()
}

/// Split `DOMAIN\user`; `user@domain` (UPN) is passed through as user name.
pub fn split_user(username: &str) -> (String, String) {
    match username.split_once('\\') {
        Some((domain, user)) => (domain.to_string(), user.to_string()),
        None => (String::new(), username.to_string()),
    }
}

/// NTOWFv2 = HMAC-MD5(MD4(UTF-16LE(password)), UTF-16LE(UPPER(user) + domain))
pub fn ntowf_v2(user: &str, domain: &str, password: &str) -> [u8; 16] {
    let nt_hash = Md4::digest(utf16le(password));
    hmac_md5(&nt_hash, &[&utf16le(&(user.to_uppercase() + domain))])
}

/// Type 1 (NEGOTIATE) message, base64 encoded.
pub fn negotiate() -> String {
    let mut m = Vec::with_capacity(32);
    m.extend_from_slice(SIGNATURE);
    m.extend_from_slice(&1u32.to_le_bytes());
    m.extend_from_slice(&FLAGS.to_le_bytes());
    m.extend_from_slice(&[0u8; 16]); // empty domain + workstation fields
    B64.encode(m)
}

/// Parsed Type 2 (CHALLENGE) message.
#[derive(Debug, Clone)]
pub struct Challenge {
    pub flags: u32,
    pub server_challenge: [u8; 8],
    pub target_info: Vec<u8>,
}

fn sec_buf(data: &[u8], at: usize) -> Option<&[u8]> {
    let len = u16::from_le_bytes(data.get(at..at + 2)?.try_into().ok()?) as usize;
    let off = u32::from_le_bytes(data.get(at + 4..at + 8)?.try_into().ok()?) as usize;
    data.get(off..off + len)
}

pub fn parse_challenge(b64: &str) -> Option<Challenge> {
    let data = B64.decode(b64.trim()).ok()?;
    if data.get(..8)? != SIGNATURE || u32::from_le_bytes(data.get(8..12)?.try_into().ok()?) != 2 {
        return None;
    }
    Some(Challenge {
        flags: u32::from_le_bytes(data.get(20..24)?.try_into().ok()?),
        server_challenge: data.get(24..32)?.try_into().ok()?,
        target_info: sec_buf(&data, 40).map(<[u8]>::to_vec).unwrap_or_default(),
    })
}

/// MsvAvTimestamp from the target info, if the server sent one.
fn av_timestamp(target_info: &[u8]) -> Option<[u8; 8]> {
    let mut i = 0;
    while i + 4 <= target_info.len() {
        let id = u16::from_le_bytes([target_info[i], target_info[i + 1]]);
        let len = u16::from_le_bytes([target_info[i + 2], target_info[i + 3]]) as usize;
        let value = target_info.get(i + 4..i + 4 + len)?;
        match id {
            0 => return None,
            7 if len == 8 => return value.try_into().ok(),
            _ => {}
        }
        i += 4 + len;
    }
    None
}

fn now_filetime() -> [u8; 8] {
    let unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let ticks = (unix.as_secs() + FILETIME_EPOCH_OFFSET) * 10_000_000 + u64::from(unix.subsec_nanos() / 100);
    ticks.to_le_bytes()
}

/// NTLMv2 responses (LMv2, NTv2) for the given inputs.
pub fn responses(ntowf: &[u8; 16], server_challenge: &[u8; 8], client_challenge: &[u8; 8], timestamp: &[u8; 8], target_info: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let mut temp = Vec::with_capacity(32 + target_info.len());
    temp.extend_from_slice(&[1, 1, 0, 0, 0, 0, 0, 0]);
    temp.extend_from_slice(timestamp);
    temp.extend_from_slice(client_challenge);
    temp.extend_from_slice(&[0; 4]);
    temp.extend_from_slice(target_info);
    temp.extend_from_slice(&[0; 4]);
    let nt_proof = hmac_md5(ntowf, &[server_challenge, &temp]);
    let mut nt = nt_proof.to_vec();
    nt.extend_from_slice(&temp);
    let mut lm = hmac_md5(ntowf, &[server_challenge, client_challenge]).to_vec();
    lm.extend_from_slice(client_challenge);
    (lm, nt)
}

/// Type 3 (AUTHENTICATE) message, base64 encoded.
pub fn authenticate(challenge: &Challenge, username: &str, password: &str) -> String {
    let (domain, user) = split_user(username);
    let ntowf = ntowf_v2(&user, &domain, password);
    let client_challenge: [u8; 8] = rand::random();
    let timestamp = av_timestamp(&challenge.target_info).unwrap_or_else(now_filetime);
    let (lm, nt) = responses(&ntowf, &challenge.server_challenge, &client_challenge, &timestamp, &challenge.target_info);

    let domain_b = utf16le(&domain);
    let user_b = utf16le(&user);
    let workstation_b = utf16le("ONDURA");
    let fields: [&[u8]; 6] = [&lm, &nt, &domain_b, &user_b, &workstation_b, &[]];

    const HEADER: usize = 64;
    let mut header = Vec::with_capacity(HEADER);
    header.extend_from_slice(SIGNATURE);
    header.extend_from_slice(&3u32.to_le_bytes());
    let mut payload = Vec::new();
    for f in fields {
        let offset = (HEADER + payload.len()) as u32;
        header.extend_from_slice(&(f.len() as u16).to_le_bytes());
        header.extend_from_slice(&(f.len() as u16).to_le_bytes());
        header.extend_from_slice(&offset.to_le_bytes());
        payload.extend_from_slice(f);
    }
    header.extend_from_slice(&(FLAGS & challenge.flags | NEGOTIATE_UNICODE | NEGOTIATE_NTLM).to_le_bytes());
    debug_assert_eq!(header.len(), HEADER);
    header.extend_from_slice(&payload);
    B64.encode(header)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    // Test vectors from MS-NLMP 4.2.4 (NTLMv2 authentication).
    #[test]
    fn ntowf_v2_matches_spec() {
        assert_eq!(hex(&ntowf_v2("User", "Domain", "Password")), "0c868a403bfd7a93a3001ef22ef02e3f");
    }

    #[test]
    fn nt_proof_matches_spec() {
        let ntowf = ntowf_v2("User", "Domain", "Password");
        let server = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let client = [0xaa; 8];
        // MsvAvNbDomainName "Domain", MsvAvNbComputerName "Server", MsvAvEOL
        let mut info = vec![0x02, 0x00, 0x0c, 0x00];
        info.extend(utf16le("Domain"));
        info.extend([0x01, 0x00, 0x0c, 0x00]);
        info.extend(utf16le("Server"));
        info.extend([0x00, 0x00, 0x00, 0x00]);
        let (lm, nt) = responses(&ntowf, &server, &client, &[0; 8], &info);
        assert_eq!(hex(&nt[..16]), "68cd0ab851e51c96aabc927bebef6a1c");
        assert_eq!(hex(&lm[..16]), "86c35097ac9cec102554764a57cccc19");
    }

    #[test]
    fn messages_roundtrip() {
        let n = B64.decode(negotiate()).unwrap();
        assert_eq!(&n[..8], SIGNATURE);
        assert_eq!(n.len(), 32);

        // Build a challenge as a server would.
        let mut c = Vec::new();
        c.extend_from_slice(SIGNATURE);
        c.extend_from_slice(&2u32.to_le_bytes());
        c.extend_from_slice(&[0, 0, 0, 0, 48, 0, 0, 0]); // empty target name
        c.extend_from_slice(&FLAGS.to_le_bytes());
        c.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        c.extend_from_slice(&[0; 8]);
        c.extend_from_slice(&[4, 0, 4, 0, 48, 0, 0, 0]); // target info
        c.extend_from_slice(&[0, 0, 0, 0]);
        let ch = parse_challenge(&B64.encode(&c)).unwrap();
        assert_eq!(ch.server_challenge, [1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(ch.target_info, vec![0, 0, 0, 0]);

        let a = B64.decode(authenticate(&ch, "CORP\\niklas", "geheim")).unwrap();
        assert_eq!(u32::from_le_bytes(a[8..12].try_into().unwrap()), 3);
        assert_eq!(sec_buf(&a, 36).unwrap(), utf16le("niklas").as_slice());
        assert_eq!(sec_buf(&a, 28).unwrap(), utf16le("CORP").as_slice());
    }
}
