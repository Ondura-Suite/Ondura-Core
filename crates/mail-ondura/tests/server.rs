//! Integration tests against a running Ondura Server (ignored by default).
//!
//! Start a local instance as in Ondura-Server `docs/development.md` (plain
//! HTTP on 127.0.0.1:8080, SQLite) with the mailboxes `test@example.com` and
//! `anna@example.com` (password `secret`), then:
//!
//! ```sh
//! cargo test -p ondura-mail-ondura --test server -- --ignored --test-threads=1
//! ```

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use ondura_mail_core::model::{Account, AccountKind, Address, EwsConfig, FolderRole, OutgoingMessage, OutgoingAttachment};
use ondura_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, RemoteFolder, RemoteMessage};
use ondura_mail_core::{Error, Result, Store, SyncEngine};
use ondura_mail_ondura::OnduraProvider;

fn url() -> String {
    std::env::var("ONDURA_SERVER_TEST_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into())
}

/// The fallback must never be used against a server with the client API.
struct NoFallback;

#[async_trait]
impl MailProvider for NoFallback {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        panic!("fallback used")
    }
    async fn sync_folder(&self, _: &RemoteFolder, _: Option<&str>) -> Result<FolderChanges> {
        panic!("fallback used")
    }
    async fn fetch_body(&self, _: &str, _: &str) -> Result<FetchedBody> {
        panic!("fallback used")
    }
    async fn fetch_older(&self, _: &RemoteFolder, _: &HashSet<String>, _: Option<chrono::DateTime<chrono::Utc>>, _: usize) -> Result<Vec<RemoteMessage>> {
        panic!("fallback used")
    }
    async fn fetch_attachment(&self, _: &str, _: &str, _: &str) -> Result<Vec<u8>> {
        panic!("fallback used")
    }
    async fn set_flags(&self, _: &str, _: &str, _: Option<bool>, _: Option<bool>) -> Result<()> {
        panic!("fallback used")
    }
    async fn mark_folder_read(&self, _: &str) -> Result<()> {
        panic!("fallback used")
    }
    async fn empty_folder(&self, _: &str, _: Option<&str>) -> Result<()> {
        panic!("fallback used")
    }
    async fn move_message(&self, _: &str, _: &str, _: &str) -> Result<Option<String>> {
        panic!("fallback used")
    }
    async fn delete_message(&self, _: &str, _: &str) -> Result<()> {
        panic!("fallback used")
    }
    async fn send(&self, _: &OutgoingMessage, _: &[ondura_mail_core::model::ResolvedAttachment]) -> Result<()> {
        panic!("fallback used")
    }
    async fn save_draft(&self, _: &OutgoingMessage, _: &[ondura_mail_core::model::ResolvedAttachment]) -> Result<Option<String>> {
        panic!("fallback used")
    }
}

fn provider(user: &str) -> Arc<OnduraProvider> {
    OnduraProvider::new(&format!("{}/EWS/Exchange.asmx", url()), user, "secret", Address::new(Some(user.into()), user), Arc::new(NoFallback))
}

fn engine_for(user: &str) -> (Arc<SyncEngine>, Arc<Store>, Arc<OnduraProvider>) {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let account = Account {
        id: "acc".into(),
        display_name: user.into(),
        email: user.into(),
        kind: AccountKind::Ews(EwsConfig { url: format!("{}/EWS/Exchange.asmx", url()), username: user.into(), mailbox: None, product: Some("ondura-server".into()) }),
        color: None,
        signature: None,
        dav: None,
    };
    store.upsert_account(&account).unwrap();
    let engine = SyncEngine::new(store.clone());
    let p = provider(user);
    engine.register("acc", p.clone(), false);
    (engine, store, p)
}

fn unique(tag: &str) -> String {
    format!("{tag} {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos())
}

#[tokio::test]
#[ignore]
async fn detects_the_client_api() {
    assert!(provider("test@example.com").native().await.unwrap());
    let wrong = OnduraProvider::new(&url(), "test@example.com", "wrong", Address::new(None, "test@example.com"), Arc::new(NoFallback));
    assert!(matches!(wrong.list_folders().await, Err(Error::Auth(_))));
}

#[tokio::test]
#[ignore]
async fn mail_round_trip_through_the_engine() {
    let (engine, store, p) = engine_for("test@example.com");
    let (anna, anna_store, _) = engine_for("anna@example.com");
    engine.sync_account("acc").await.unwrap();
    anna.sync_account("acc").await.unwrap();
    let inbox = store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    let sent = store.folder_by_role("acc", FolderRole::Sent).unwrap().unwrap();
    let drafts = store.folder_by_role("acc", FolderRole::Drafts).unwrap().unwrap();
    let trash = store.folder_by_role("acc", FolderRole::Trash).unwrap().unwrap();

    // Send (with Bcc and an attachment) to anna.
    let subject = unique("Rundreise");
    let msg = OutgoingMessage {
        to: vec![Address::new(Some("Max".into()), "max@other.org")],
        bcc: vec![Address::new(None, "anna@example.com")],
        subject: subject.clone(),
        body_html: "<p>Hallo <b>Anna</b></p>".into(),
        attachments: vec![OutgoingAttachment::Data { name: "notiz.txt".into(), content_type: "text/plain".into(), data: "SGFsbG8gV2VsdA==".into() }],
        ..Default::default()
    };
    engine.send("acc", &msg).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    assert_eq!(store.op_counts("acc").unwrap().pending, 0);

    // A copy in Sent; anna (Bcc only) received it.
    engine.sync_folder(&sent.id).await.unwrap();
    assert!(store.list_messages(&sent.id, 0, 50).unwrap().iter().any(|m| m.subject == subject));
    let anna_inbox = anna_store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    anna.sync_folder(&anna_inbox.id).await.unwrap();
    let got = anna_store.list_messages(&anna_inbox.id, 0, 50).unwrap().into_iter().find(|m| m.subject == subject).expect("Bcc delivered");
    assert!(!got.is_read);
    let detail = anna.get_message(&got.id).await.unwrap();
    assert!(detail.body.html.unwrap_or_default().contains("<b>Anna</b>"));
    assert_eq!(detail.body.attachments.len(), 1);
    let att = anna.get_attachment(&got.id, &detail.body.attachments[0].id).await.unwrap();
    assert_eq!(att, b"Hallo Welt");

    // Flags, categories and a move come back through the change feed.
    anna.set_read(&got.id, true).await.unwrap();
    anna.set_flagged(&got.id, true).await.unwrap();
    anna.set_categories(&got.id, &["Rot".to_string()]).await.unwrap();
    anna.flush_account("acc").await.unwrap();
    let (fresh, fresh_store, _) = engine_for("anna@example.com");
    fresh.sync_account("acc").await.unwrap();
    let fresh_inbox = fresh_store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    let again = fresh_store.list_messages(&fresh_inbox.id, 0, 50).unwrap().into_iter().find(|m| m.subject == subject).unwrap();
    assert!(again.is_read && again.is_flagged);
    assert_eq!(again.categories, vec!["Rot".to_string()]);

    let anna_trash = anna_store.folder_by_role("acc", FolderRole::Trash).unwrap().unwrap();
    anna.move_message(&got.id, &anna_trash.id).await.unwrap();
    anna.flush_account("acc").await.unwrap();
    fresh.sync_account("acc").await.unwrap();
    assert!(!fresh_store.list_messages(&fresh_inbox.id, 0, 50).unwrap().iter().any(|m| m.subject == subject), "moved out of the inbox");
    let fresh_trash = fresh_store.folder_by_role("acc", FolderRole::Trash).unwrap().unwrap();
    let in_trash = fresh_store.list_messages(&fresh_trash.id, 0, 50).unwrap().into_iter().find(|m| m.subject == subject).expect("in the trash");
    // Permanent delete.
    fresh.delete_message(&in_trash.id).await.unwrap();
    fresh.flush_account("acc").await.unwrap();
    anna.sync_folder(&anna_trash.id).await.unwrap();
    assert!(!anna_store.list_messages(&anna_trash.id, 0, 50).unwrap().iter().any(|m| m.subject == subject));

    // Drafts.
    let draft_subject = unique("Entwurf");
    engine.save_draft("acc", &OutgoingMessage { subject: draft_subject.clone(), body_html: "<p>x</p>".into(), ..Default::default() }).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&drafts.id).await.unwrap();
    let d = store.list_messages(&drafts.id, 0, 50).unwrap().into_iter().find(|m| m.subject == draft_subject).expect("draft saved");
    engine.delete_message(&d.id).await.unwrap();
    engine.flush_account("acc").await.unwrap();

    // A compose window saving automatically: always exactly its latest version.
    let key = unique("compose");
    let window = |subject: &str| OutgoingMessage { draft_key: Some(key.clone()), subject: subject.into(), body_html: "<p>x</p>".into(), ..Default::default() };
    let tag = unique("Auto");
    for v in 1..=3 {
        engine.save_draft("acc", &window(&format!("{tag} {v}"))).await.unwrap();
        engine.flush_account("acc").await.unwrap();
    }
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&drafts.id).await.unwrap();
    let autos: Vec<String> = store.list_messages(&drafts.id, 0, 100).unwrap().into_iter().map(|m| m.subject).filter(|s| s.starts_with(&tag)).collect();
    assert_eq!(autos, [format!("{tag} 3")]);
    // Sending from the window removes the draft.
    let mut sent = window(&format!("{tag} gesendet"));
    sent.to = vec![Address::new(None, "anna@example.com")];
    engine.send("acc", &sent).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&drafts.id).await.unwrap();
    assert!(!store.list_messages(&drafts.id, 0, 100).unwrap().iter().any(|m| m.subject.starts_with(&tag)));

    // Folders.
    let name = unique("Projekt");
    engine.create_folder("acc", None, &name).await.unwrap();
    let folder = store.list_folders("acc").unwrap().into_iter().find(|f| f.name == name).expect("folder created");
    engine.rename_folder(&folder.id, &format!("{name} 2")).await.unwrap();
    engine.delete_folder(&store.list_folders("acc").unwrap().into_iter().find(|f| f.name == format!("{name} 2")).unwrap().id).await.unwrap();
    assert!(!store.list_folders("acc").unwrap().iter().any(|f| f.name.starts_with(&name)));

    // Search and quota.
    let hits = p.search("Rundreise", 50).await.unwrap();
    assert!(hits.iter().any(|(_, m)| m.subject == subject), "found in Sent");
    assert!(engine.quota("acc").await.unwrap().used > 0);
    let _ = (inbox, trash);
}

#[tokio::test]
#[ignore]
async fn push_reports_new_mail() {
    let p = provider("test@example.com");
    // The first notice after connecting asks for a sync.
    assert!(p.wait_for_change("2", Duration::from_secs(10)).await.unwrap());
    let waiter = {
        let p = p.clone();
        tokio::spawn(async move { p.wait_for_change("2", Duration::from_secs(20)).await })
    };
    tokio::time::sleep(Duration::from_millis(500)).await;
    let anna = provider("anna@example.com");
    anna.send(&OutgoingMessage { to: vec![Address::new(None, "test@example.com")], subject: unique("Push"), body_html: "<p>x</p>".into(), ..Default::default() }, &[]).await.unwrap();
    assert!(waiter.await.unwrap().unwrap(), "woken by the server");
    // Quiet mailbox: the wait times out.
    assert!(!p.wait_for_change("2", Duration::from_secs(2)).await.unwrap());
}

#[tokio::test]
#[ignore]
async fn many_messages_and_paging() {
    let (engine, store, p) = engine_for("test@example.com");
    engine.sync_account("acc").await.unwrap();
    let inbox = store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    let remote = p.list_folders().await.unwrap().into_iter().find(|f| f.role == FolderRole::Inbox).unwrap();
    let tag = unique("Masse");
    for i in 0..30 {
        let raw = format!("From: a@example.com\r\nTo: test@example.com\r\nSubject: {tag} {i}\r\nDate: Mon, 1 Jan 2024 10:{i:02}:00 +0000\r\n\r\nx");
        p.import_message(&remote.remote_id, raw.as_bytes(), false).await.unwrap();
    }
    engine.sync_folder(&inbox.id).await.unwrap();
    let local = store.list_messages(&inbox.id, 0, 1000).unwrap();
    assert_eq!(local.iter().filter(|m| m.subject.starts_with(&tag)).count(), 30);
    // Older pages: everything known already, nothing missing.
    let known: HashSet<String> = local.iter().map(|m| m.remote_id.clone()).collect();
    assert!(p.fetch_older(&remote, &known, None, 50).await.unwrap().is_empty());
    // Mark all read, then clean up.
    engine.mark_folder_read(&inbox.id).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&inbox.id).await.unwrap();
    assert!(store.list_messages(&inbox.id, 0, 1000).unwrap().iter().all(|m| m.is_read));
    for m in store.list_messages(&inbox.id, 0, 1000).unwrap().into_iter().filter(|m| m.subject.starts_with(&tag)) {
        p.delete_message(&remote.remote_id, &m.remote_id).await.unwrap();
    }
}

#[tokio::test]
#[ignore]
async fn profile_pictures() {
    use ondura_mail_core::model::Photo;
    let (engine, _, me) = engine_for("test@example.com");
    let anna = provider("anna@example.com");
    // A 1×1 PNG.
    let png = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==").unwrap();
    let photo = Photo { content_type: "image/png".into(), data: png };
    me.set_photo(Some(&photo)).await.unwrap();
    // Everyone on the server sees it.
    assert_eq!(anna.person_photo("Test@Example.com").await.unwrap(), Some(photo.clone()));
    assert_eq!(engine.person_photo("test@example.com").await, Some(photo.clone()));
    // Unknown addresses and mailboxes without a picture: none.
    assert_eq!(anna.person_photo("nobody@other.org").await.unwrap(), None);
    // Through the engine, removing updates its cache at once.
    engine.set_photo("acc", None).await.unwrap();
    assert_eq!(engine.person_photo("test@example.com").await, None);
    assert_eq!(anna.person_photo("test@example.com").await.unwrap(), None);
    // Not an image: refused by the server.
    assert!(me.set_photo(Some(&Photo { content_type: "text/plain".into(), data: b"x".to_vec() })).await.is_err());
}

#[tokio::test]
#[ignore]
async fn categories_follow_the_server_list() {
    let (engine, store, p) = engine_for("test@example.com");
    engine.sync_account("acc").await.unwrap();
    let inbox = store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    let remote = p.list_folders().await.unwrap().into_iter().find(|f| f.role == FolderRole::Inbox).unwrap();
    let subject = unique("Kategorie");
    let raw = format!("From: a@example.com\r\nTo: test@example.com\r\nSubject: {subject}\r\n\r\nx");
    p.import_message(&remote.remote_id, raw.as_bytes(), true).await.unwrap();
    engine.sync_folder(&inbox.id).await.unwrap();
    let m = store.list_messages(&inbox.id, 0, 200).unwrap().into_iter().find(|m| m.subject == subject).unwrap();

    // A category created in Ondura lands in the server's list, with a colour.
    let name = unique("Rote Kategorie");
    engine.set_categories(&m.id, std::slice::from_ref(&name)).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    let list = engine.category_list().await.unwrap();
    let def = list.iter().find(|c| c.name == name).expect("registered on the server");
    assert_eq!(def.color.as_deref(), Some("#e05260"), "red for a red category");

    // Renamed in the web app: the message follows with the next sync.
    #[derive(serde::Deserialize)]
    struct Cat {
        id: i64,
        name: String,
    }
    #[derive(serde::Deserialize)]
    struct Cats {
        categories: Vec<Cat>,
    }
    let http = reqwest::Client::builder().tls_backend_preconfigured((*ondura_mail_core::net::tls_client_config()).clone()).build().unwrap();
    let cats: Cats = http.get(format!("{}/api/v1/categories", url())).basic_auth("test@example.com", Some("secret")).header("X-Ondura-Client", "test").send().await.unwrap().json().await.unwrap();
    let id = cats.categories.iter().find(|c| c.name == name).unwrap().id;
    let renamed = format!("{name} neu");
    let r = http
        .post(format!("{}/api/v1/category", url()))
        .basic_auth("test@example.com", Some("secret"))
        .header("X-Ondura-Client", "test")
        .json(&serde_json::json!({ "id": id, "name": renamed, "color": "teal" }))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success());
    engine.sync_folder(&inbox.id).await.unwrap();
    assert_eq!(store.get_message(&m.id).unwrap().categories, vec![renamed.clone()]);
    let list = engine.category_list().await.unwrap();
    assert_eq!(list.iter().find(|c| c.name == renamed).unwrap().color.as_deref(), Some("#17a2a2"));
    p.delete_message(&remote.remote_id, &m.remote_id).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn drafts_keep_bcc() {
    let (engine, store, _) = engine_for("test@example.com");
    engine.sync_account("acc").await.unwrap();
    let drafts = store.folder_by_role("acc", FolderRole::Drafts).unwrap().unwrap();
    let subject = unique("Bcc-Entwurf");
    let key = unique("bcc");
    engine
        .save_draft("acc", &OutgoingMessage { draft_key: Some(key.clone()), subject: subject.clone(), bcc: vec![Address::new(Some("Geheim".into()), "anna@example.com")], body_html: "<p>x</p>".into(), ..Default::default() })
        .await
        .unwrap();
    engine.flush_account("acc").await.unwrap();
    engine.sync_folder(&drafts.id).await.unwrap();
    let d = store.list_messages(&drafts.id, 0, 100).unwrap().into_iter().find(|m| m.subject == subject).unwrap();
    let bcc = engine.draft_bcc(&d.id).await.unwrap();
    assert_eq!(bcc.iter().map(|a| a.email.as_str()).collect::<Vec<_>>(), ["anna@example.com"]);
    engine.finish_draft("acc", &key).unwrap();
    engine.flush_account("acc").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn managing_categories() {
    let (engine, store, p) = engine_for("test@example.com");
    engine.sync_account("acc").await.unwrap();
    let inbox = store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    let remote = p.list_folders().await.unwrap().into_iter().find(|f| f.role == FolderRole::Inbox).unwrap();
    let subject = unique("Verwalten");
    let raw = format!("From: a@example.com\r\nTo: test@example.com\r\nSubject: {subject}\r\n\r\nx");
    p.import_message(&remote.remote_id, raw.as_bytes(), true).await.unwrap();
    engine.sync_folder(&inbox.id).await.unwrap();
    let m = store.list_messages(&inbox.id, 0, 200).unwrap().into_iter().find(|m| m.subject == subject).unwrap();

    // Create with a colour; recolour.
    let name = unique("Kunde");
    engine.upsert_category(&name, Some("#3aa655")).await.unwrap();
    let color = |list: &[ondura_mail_core::model::CategoryDef], n: &str| list.iter().find(|c| c.name == n).and_then(|c| c.color.clone());
    assert_eq!(color(&p.category_list().await.unwrap(), &name).as_deref(), Some("#3aa655"));
    engine.upsert_category(&name, Some("#9b59b6")).await.unwrap();
    assert_eq!(color(&p.category_list().await.unwrap(), &name).as_deref(), Some("#9b59b6"));

    // Rename: the server renames it on the message too.
    engine.set_categories(&m.id, std::slice::from_ref(&name)).await.unwrap();
    engine.flush_account("acc").await.unwrap();
    let renamed = format!("{name} B");
    engine.rename_category(&name, &renamed).await.unwrap();
    assert_eq!(store.get_message(&m.id).unwrap().categories, vec![renamed.clone()], "local copy updated at once");
    assert_eq!(store.op_counts("acc").unwrap().pending, 0, "the server did it, nothing queued");
    let (fresh, fresh_store, _) = engine_for("test@example.com");
    fresh.sync_account("acc").await.unwrap();
    let fresh_inbox = fresh_store.folder_by_role("acc", FolderRole::Inbox).unwrap().unwrap();
    let on_server = fresh_store.list_messages(&fresh_inbox.id, 0, 200).unwrap().into_iter().find(|x| x.subject == subject).unwrap();
    assert_eq!(on_server.categories, vec![renamed.clone()]);
    assert_eq!(color(&p.category_list().await.unwrap(), &renamed).as_deref(), Some("#9b59b6"), "colour kept");

    // Delete: gone from the list and the message.
    engine.delete_category(&renamed).await.unwrap();
    assert!(store.get_message(&m.id).unwrap().categories.is_empty());
    assert!(!p.category_list().await.unwrap().iter().any(|c| c.name == renamed));
    fresh.sync_folder(&fresh_inbox.id).await.unwrap();
    assert!(fresh_store.get_message(&on_server.id).unwrap().categories.is_empty());
    p.delete_message(&remote.remote_id, &m.remote_id).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn inbox_rules_run_on_the_server() {
    use ondura_mail_core::model::MailRule;
    let (engine, store, p) = engine_for("test@example.com");
    engine.sync_account("acc").await.unwrap();
    let archive_name = unique("Regelziel");
    engine.create_folder("acc", None, &archive_name).await.unwrap();
    let target = store.list_folders("acc").unwrap().into_iter().find(|f| f.name == archive_name).unwrap();
    let tag = unique("Rechnung");
    let server_rule = MailRule { id: "new-1".into(), name: "Rechnungen".into(), enabled: true, account_id: Some("acc".into()), subject_contains: Some(tag.clone()), move_to: Some(target.id.clone()), mark_read: true, category: Some("Rot".into()), ..Default::default() };
    let app_rule = MailRule { id: "new-2".into(), name: "Kennzeichnen".into(), enabled: true, account_id: Some("acc".into()), from_contains: Some("chef@".into()), flag: true, ..Default::default() };
    engine.save_all_rules(&[server_rule, app_rule]).await.unwrap();

    // One on the server, one in the app.
    let on_server = p.server_rules().await.unwrap();
    let saved = on_server.iter().find(|r| r.name == "Rechnungen").expect("saved on the server");
    assert_eq!(saved.move_to.as_deref(), Some(target.remote_id.as_str()));
    assert!(engine.rules().unwrap().iter().any(|r| r.name == "Kennzeichnen") && !engine.rules().unwrap().iter().any(|r| r.name == "Rechnungen"));
    let all = engine.all_rules().await.unwrap();
    let shown = all.iter().find(|r| r.name == "Rechnungen").unwrap();
    assert!(shown.id.starts_with("server:acc:"));
    assert_eq!(shown.move_to.as_deref(), Some(target.id.as_str()), "local folder id");

    // The server applies it on delivery.
    let anna = provider("anna@example.com");
    anna.send(&OutgoingMessage { to: vec![Address::new(None, "test@example.com")], subject: format!("{tag} Nr. 1"), body_html: "<p>x</p>".into(), ..Default::default() }, &[]).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    engine.sync_folder(&target.id).await.unwrap();
    let moved = store.list_messages(&target.id, 0, 10).unwrap();
    assert_eq!(moved.len(), 1, "moved by the server rule");
    assert!(moved[0].is_read);
    assert_eq!(moved[0].categories, vec!["Rot".to_string()]);

    // Removing it from the list deletes it on the server.
    let rest: Vec<MailRule> = all.into_iter().filter(|r| r.name != "Rechnungen").collect();
    engine.save_all_rules(&rest).await.unwrap();
    assert!(!p.server_rules().await.unwrap().iter().any(|r| r.name == "Rechnungen"));
    engine.save_all_rules(&[]).await.unwrap();
    assert!(engine.rules().unwrap().is_empty());
    p.delete_message(&target.remote_id, &moved[0].remote_id).await.unwrap();
    engine.delete_folder(&target.id).await.unwrap();
}
