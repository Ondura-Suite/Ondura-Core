//! Integration test against a real IMAP server (e.g. a local Dovecot).
//!
//! Ignored by default. Run with:
//! ```sh
//! MIRRA_IMAP_TEST_PORT=10993 MIRRA_IMAP_TEST_USER=test@localhost MIRRA_IMAP_TEST_PASS=secret \
//! MIRRA_IMAP_TEST_CA=/tmp/imaptest/ca.pem cargo test -p mirra-mail-imap --test dovecot -- --ignored --test-threads=1
//! ```
//! The INBOX must contain at least three messages and the server must offer
//! `Archive`, `Trash`, `Sent` and `Drafts` folders (special-use).

use std::sync::Arc;
use std::time::Duration;

use mirra_mail_core::model::{Account, AccountKind, Address, FolderRole, ImapConfig, OutgoingMessage, Security};
use mirra_mail_core::provider::MailProvider;
use mirra_mail_core::{Store, SyncEngine, SyncEvent};
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

fn provider() -> (Arc<ImapProvider>, ImapConfig) {
    let tls = tls_with_ca(&env("MIRRA_IMAP_TEST_CA", "/tmp/imaptest/ca.pem"));
    let port: u16 = env("MIRRA_IMAP_TEST_PORT", "10993").parse().unwrap();
    let cfg = config(port, Security::Tls);
    let from = Address::new(Some("Test".into()), "test@localhost");
    (ImapProvider::with_tls_config(cfg.clone(), from, env("MIRRA_IMAP_TEST_PASS", "secret"), tls), cfg)
}

fn engine_for(provider: Arc<ImapProvider>, cfg: &ImapConfig) -> (Arc<SyncEngine>, Arc<Store>, Account) {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let account = Account {
        id: "acc".into(),
        display_name: "Test".into(),
        email: "test@localhost".into(),
        kind: AccountKind::Imap(cfg.clone()),
        color: None,
        signature: None,
    };
    store.upsert_account(&account).unwrap();
    let engine = SyncEngine::new(store.clone());
    engine.register("acc", provider, false);
    (engine, store, account)
}

#[tokio::test]
#[ignore]
async fn full_sync_roundtrip() {
    let (provider, cfg) = provider();
    let (engine, store, _) = engine_for(provider.clone(), &cfg);
    let mut events = engine.subscribe();
    tokio::spawn(async move {
        while let Ok(e) = events.recv().await {
            if let SyncEvent::Error { message, .. } = e {
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
    let trash = role(FolderRole::Trash);
    let drafts = role(FolderRole::Drafts);
    assert_eq!(inbox.name, "Posteingang");

    let msgs = store.list_messages(&inbox.id, 0, 100).unwrap();
    assert!(msgs.len() >= 3, "expected at least three messages in INBOX, got {}", msgs.len());
    let first = msgs.iter().find(|m| !m.is_read && !m.is_flagged).expect("an unread, unflagged message").clone();
    assert!(!first.subject.is_empty());
    assert!(!first.preview.is_empty(), "batch body prefetch should fill the preview");
    assert!(!store.search("nachricht", None, 10).unwrap().is_empty(), "bodies are indexed");

    // Body + flags: applied locally at once, queued for the server.
    let detail = engine.get_message(&first.id).await.unwrap();
    assert!(detail.body.text.is_some() || detail.body.html.is_some());
    engine.set_read(&first.id, true).await.unwrap();
    engine.set_flagged(&first.id, true).await.unwrap();
    assert!(store.get_message(&first.id).unwrap().is_read);
    assert_eq!(store.op_counts("acc").unwrap().pending, 2);
    engine.flush_account("acc").await.unwrap();
    assert_eq!(store.op_counts("acc").unwrap().pending, 0);

    // A fresh store must see the flags coming from the server.
    let (engine2, store2, _) = engine_for(provider.clone(), &cfg);
    engine2.sync_account("acc").await.unwrap();
    let again = store2.get_message(&first.id).unwrap();
    assert!(again.is_read && again.is_flagged, "flags must round-trip through the server");

    // Load older: start with a store that only knows the newest message.
    let oldest_before = store2.list_messages(&inbox.id, 0, 100).unwrap().len();
    let newest = store2.list_messages(&inbox.id, 0, 1).unwrap()[0].remote_id.clone();
    let keep = vec![newest];
    store2
        .apply_changes(&inbox, &mirra_mail_core::FolderChanges { present: Some(keep), ..Default::default() })
        .unwrap();
    assert_eq!(store2.count_messages(&inbox.id).unwrap(), 1);
    let loaded = engine2.load_older(&inbox.id, 100).await.unwrap();
    assert_eq!(loaded, oldest_before - 1);
    assert_eq!(engine2.load_older(&inbox.id, 100).await.unwrap(), 0, "nothing older left");

    // Move to archive, then delete (→ trash), then delete permanently.
    engine.move_message(&first.id, &archive.id).await.unwrap();
    assert!(store.get_message(&first.id).is_err(), "removed locally at once");
    engine.flush_account("acc").await.unwrap();
    let archived = store.list_messages(&archive.id, 0, 10).unwrap();
    assert_eq!(archived.len(), 1);
    engine.delete_message(&archived[0].id).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    let trashed = store.list_messages(&trash.id, 0, 10).unwrap();
    assert_eq!(trashed.len(), 1);
    engine.delete_message(&trashed[0].id).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&trash.id).await.unwrap();
    assert!(store.list_messages(&trash.id, 0, 10).unwrap().is_empty());

    // Drafts: save, then replace (old draft is removed).
    let draft = OutgoingMessage {
        to: vec![Address::new(None, "someone@example.com")],
        subject: "Entwurf Test".into(),
        body_html: "<p>Hallo</p>".into(),
        ..Default::default()
    };
    engine.save_draft("acc", &draft).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    let saved = store.list_messages(&drafts.id, 0, 10).unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].subject, "Entwurf Test");
    let replaced = OutgoingMessage { subject: "Entwurf Test 2".into(), draft_id: Some(saved[0].id.clone()), ..draft };
    engine.save_draft("acc", &replaced).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&drafts.id).await.unwrap();
    let saved = store.list_messages(&drafts.id, 0, 10).unwrap();
    assert_eq!(saved.len(), 1, "old draft replaced");
    assert_eq!(saved[0].subject, "Entwurf Test 2");
    engine.delete_message(&saved[0].id).await.unwrap();
    engine.flush_account("acc").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn idle_reports_new_mail() {
    let (provider, _) = provider();
    let (watcher, _) = self::provider();
    // Make sure the inbox exists, then wait for a change while another
    // connection appends a message.
    let waiter = tokio::spawn(async move { watcher.wait_for_change("INBOX", Duration::from_secs(20)).await });
    tokio::time::sleep(Duration::from_secs(2)).await;
    let draft = OutgoingMessage { subject: "IDLE".into(), body_html: "<p>x</p>".into(), ..Default::default() };
    provider.list_folders().await.unwrap();
    let raw = mirra_mail_imap::build_message(&Address::new(None, "a@b.c"), &draft, &[]).unwrap().formatted();
    provider.append_for_test("INBOX", &raw).await.unwrap();
    let changed = waiter.await.unwrap().unwrap();
    assert!(changed, "IDLE should report the appended message");
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
