//! Integration test against a real IMAP server (e.g. a local Dovecot).
//!
//! Ignored by default. Run with:
//! ```sh
//! MIRRA_IMAP_TEST_PORT=10993 MIRRA_IMAP_TEST_USER=test@localhost MIRRA_IMAP_TEST_PASS=secret \
//! MIRRA_IMAP_TEST_CA=/tmp/imaptest/ca.pem cargo test -p mirra-mail-imap --test dovecot -- --ignored
//! ```
//! The INBOX must contain at least two messages and the server must offer
//! `Archive` and `Trash` folders (special-use).

use std::sync::Arc;

use mirra_mail_core::model::{Account, AccountKind, Address, FolderRole, ImapConfig, Security};
use mirra_mail_core::{Store, SyncEngine};
use mirra_mail_imap::ImapProvider;

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn tls_with_ca(path: &str) -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    let pem = std::fs::read(path).expect("read CA");
    for cert in rustls_pemfile::certs(&mut pem.as_slice()) {
        roots.add(cert.unwrap()).unwrap();
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    Arc::new(
        rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

fn config(port: u16, security: Security) -> ImapConfig {
    ImapConfig {
        imap_host: env("MIRRA_IMAP_TEST_HOST", "localhost"),
        imap_port: port,
        imap_security: security,
        smtp_host: "localhost".into(),
        smtp_port: 25,
        smtp_security: Security::StartTls,
        username: env("MIRRA_IMAP_TEST_USER", "test@localhost"),
    }
}

#[tokio::test]
#[ignore]
async fn full_sync_roundtrip() {
    let tls = tls_with_ca(&env("MIRRA_IMAP_TEST_CA", "/tmp/imaptest/ca.pem"));
    let port: u16 = env("MIRRA_IMAP_TEST_PORT", "10993").parse().unwrap();
    let cfg = config(port, Security::Tls);
    let from = Address::new(Some("Test".into()), "test@localhost");
    let provider = ImapProvider::with_tls_config(cfg.clone(), from, env("MIRRA_IMAP_TEST_PASS", "secret"), tls.clone());

    let store = Arc::new(Store::open_in_memory().unwrap());
    let account = Account {
        id: "acc".into(),
        display_name: "Test".into(),
        email: "test@localhost".into(),
        kind: AccountKind::Imap(cfg),
        color: None,
    };
    store.upsert_account(&account).unwrap();
    let engine = SyncEngine::new(store.clone());
    engine.register("acc", provider.clone());
    let mut events = engine.subscribe();
    tokio::spawn(async move {
        while let Ok(e) = events.recv().await {
            if let mirra_mail_core::SyncEvent::Error { message, .. } = e {
                eprintln!("sync error: {message}");
            }
        }
    });

    // Initial sync
    engine.sync_account("acc").await.unwrap();
    let folders = store.list_folders("acc").unwrap();
    let role = |r| folders.iter().find(|f| f.role == r).unwrap_or_else(|| panic!("missing {r:?}")).clone();
    let inbox = role(FolderRole::Inbox);
    let archive = role(FolderRole::Archive);
    role(FolderRole::Trash);
    role(FolderRole::Sent);
    assert_eq!(inbox.name, "Posteingang");

    let msgs = store.list_messages(&inbox.id, 0, 100).unwrap();
    assert!(msgs.len() >= 2, "expected at least two messages in INBOX, got {}", msgs.len());
    let first = msgs[0].clone();
    assert!(!first.subject.is_empty());
    assert!(!first.preview.is_empty(), "body prefetch should fill the preview");

    // Body + read flag
    let detail = engine.get_message(&first.id).await.unwrap();
    assert!(detail.body.text.is_some() || detail.body.html.is_some());
    engine.set_read(&first.id, true).await.unwrap();
    engine.set_flagged(&first.id, true).await.unwrap();

    // A fresh store must see the flags coming from the server.
    let store2 = Arc::new(Store::open_in_memory().unwrap());
    store2.upsert_account(&account).unwrap();
    let engine2 = SyncEngine::new(store2.clone());
    engine2.register("acc", provider.clone());
    engine2.sync_account("acc").await.unwrap();
    let again = store2.get_message(&first.id).unwrap();
    assert!(again.is_read && again.is_flagged, "flags must round-trip through the server");

    // Incremental sync picks up the remote flag change on the first engine too.
    engine.set_read(&msgs[1].id, true).await.unwrap();
    engine2.sync_folder(&inbox.id).await.unwrap();
    assert!(store2.get_message(&msgs[1].id).unwrap().is_read);

    // Move to archive, then delete (→ trash), then delete permanently.
    engine.move_message(&first.id, &archive.id).await.unwrap();
    assert!(store.get_message(&first.id).is_err());
    let archived = store.list_messages(&archive.id, 0, 10).unwrap();
    assert_eq!(archived.len(), 1);
    engine.delete_message(&archived[0].id).await.unwrap();
    let trash = role(FolderRole::Trash);
    engine.sync_folder(&trash.id).await.unwrap();
    let trashed = store.list_messages(&trash.id, 0, 10).unwrap();
    assert_eq!(trashed.len(), 1);
    engine.delete_message(&trashed[0].id).await.unwrap();
    engine.sync_folder(&trash.id).await.unwrap();
    assert!(store.list_messages(&trash.id, 0, 10).unwrap().is_empty());
}

#[tokio::test]
#[ignore]
async fn starttls_login() {
    let tls = tls_with_ca(&env("MIRRA_IMAP_TEST_CA", "/tmp/imaptest/ca.pem"));
    let port: u16 = env("MIRRA_IMAP_TEST_STARTTLS_PORT", "10143").parse().unwrap();
    let provider = ImapProvider::with_tls_config(
        config(port, Security::StartTls),
        Address::new(None, "test@localhost"),
        env("MIRRA_IMAP_TEST_PASS", "secret"),
        tls,
    );
    provider.test_login().await.unwrap();
}
