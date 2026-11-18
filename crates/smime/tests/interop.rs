//! Interoperability with OpenSSL: the fixtures were made with
//! `openssl pkcs12/smime/cms` (see tests/fixtures/README.md).

use ondura_smime::{Certificate, Identity, protect, unprotect};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn pem(name: &str) -> Vec<u8> {
    let text = String::from_utf8(fixture(name)).unwrap();
    let b64: String = text.lines().filter(|l| !l.starts_with("-----")).collect();
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(b64).unwrap()
}

fn identity() -> Identity {
    Identity::from_pkcs12(&fixture("user-aes.p12"), "geheim").unwrap()
}

fn ca_fingerprint() -> String {
    Certificate::from_der(&pem("ca.pem")).unwrap().fingerprint()
}

#[test]
fn imports_pkcs12_variants() {
    for name in ["user-aes.p12", "user-3des.p12", "user-legacy.p12"] {
        let id = Identity::from_pkcs12(&fixture(name), "geheim").unwrap_or_else(|e| panic!("{name}: {e}"));
        let c = id.certificate();
        assert_eq!(c.subject_name, "Niklas Linz", "{name}");
        assert_eq!(c.issuer_name, "Ondura Test CA (MirraNET)");
        assert!(c.has_email("Niklas@Example.com"));
        assert_eq!(id.chain.len(), 2, "{name}: chain with the CA");
    }
    assert!(Identity::from_pkcs12(&fixture("user-aes.p12"), "falsch").is_err());
}

#[test]
fn verifies_openssl_signatures() {
    let raw = fixture("signed-openssl.eml");
    let u = unprotect(&raw, &[], &[], &[]).expect("S/MIME");
    let sig = u.info.signature.unwrap();
    assert!(sig.valid, "{:?}", sig.problem);
    assert!(!sig.trusted, "the test CA is not a known root");
    assert_eq!(sig.signer_emails, vec!["niklas@example.com".to_string()]);
    let text = String::from_utf8_lossy(&u.raw);
    assert!(text.starts_with("From: Niklas Linz"));
    assert!(text.contains("Content-Type: text/plain"));
    assert!(text.contains("diese Nachricht ist signiert"));

    let trusted = unprotect(&raw, &[], &[], &[ca_fingerprint()]).unwrap();
    assert!(trusted.info.signature.unwrap().trusted);

    // Tampering breaks the signature.
    let forged = String::from_utf8_lossy(&raw).replace("ist signiert", "ist gefälscht");
    let bad = unprotect(forged.as_bytes(), &[], &[], &[]).unwrap().info.signature.unwrap();
    assert!(!bad.valid);
    assert!(bad.problem.unwrap().contains("verändert"));

    let opaque = unprotect(&fixture("opaque-openssl.eml"), &[], &[], &[]).unwrap();
    assert!(opaque.info.signature.unwrap().valid);
    assert!(String::from_utf8_lossy(&opaque.raw).contains("diese Nachricht ist signiert"));
}

#[test]
fn decrypts_openssl_messages() {
    let id = identity();
    for name in ["encrypted-openssl.eml", "encrypted-oaep.eml", "encrypted-3des.eml"] {
        let u = unprotect(&fixture(name), std::slice::from_ref(&id), &[], &[]).unwrap();
        assert!(u.info.encrypted);
        assert_eq!(u.info.decrypt_error, None, "{name}");
        assert!(String::from_utf8_lossy(&u.raw).contains("Geheime Nachricht"), "{name}");
    }
    let locked = unprotect(&fixture("encrypted-openssl.eml"), &[], &[], &[]).unwrap();
    assert!(locked.info.decrypt_error.unwrap().contains("Zertifikat"));
}

#[test]
fn signs_and_encrypts_round_trip() {
    let id = identity();
    let msg = b"From: Niklas Linz <niklas@example.com>\r\nTo: anna@example.com\r\nSubject: Test\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHallo =C3=84nna\r\n";
    let now = chrono::Utc::now();
    let signed = protect(msg, Some(&id), &[], now).unwrap();
    std::fs::write(std::env::temp_dir().join("ondura-signed.eml"), &signed).unwrap();
    let u = unprotect(&signed, &[], &[], &[ca_fingerprint()]).unwrap();
    let sig = u.info.signature.unwrap();
    assert!(sig.valid && sig.trusted, "{:?}", sig.problem);
    assert!(String::from_utf8_lossy(&u.raw).contains("Hallo =C3=84nna"));

    let both = protect(msg, Some(&id), &[id.certificate().clone()], now).unwrap();
    std::fs::write(std::env::temp_dir().join("ondura-encrypted.eml"), &both).unwrap();
    assert!(!String::from_utf8_lossy(&both).contains("Hallo"));
    let u = unprotect(&both, std::slice::from_ref(&id), &[], &[]).unwrap();
    assert!(u.info.encrypted && u.info.signature.unwrap().valid);
    assert!(String::from_utf8_lossy(&u.raw).contains("Subject: Test"));
}
