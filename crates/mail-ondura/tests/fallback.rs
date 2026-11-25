//! Servers without the client API are used through the fallback (EWS).

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use ondura_mail_core::model::{Address, FolderRole, OutgoingMessage, ResolvedAttachment};
use ondura_mail_core::provider::{FetchedBody, FolderChanges, MailProvider, RemoteFolder, RemoteMessage};
use ondura_mail_core::{Error, Result};
use ondura_mail_ondura::OnduraProvider;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[derive(Default)]
struct Fallback(AtomicUsize);

#[async_trait]
impl MailProvider for Fallback {
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(vec![RemoteFolder { remote_id: "AAMk".into(), name: "Inbox".into(), parent_remote_id: None, role: FolderRole::Inbox, unread_count: 0, total_count: 0, selectable: true }])
    }
    async fn sync_folder(&self, _: &RemoteFolder, _: Option<&str>) -> Result<FolderChanges> {
        unimplemented!()
    }
    async fn fetch_body(&self, _: &str, _: &str) -> Result<FetchedBody> {
        unimplemented!()
    }
    async fn fetch_older(&self, _: &RemoteFolder, _: &HashSet<String>, _: Option<chrono::DateTime<chrono::Utc>>, _: usize) -> Result<Vec<RemoteMessage>> {
        unimplemented!()
    }
    async fn fetch_attachment(&self, _: &str, _: &str, _: &str) -> Result<Vec<u8>> {
        unimplemented!()
    }
    async fn set_flags(&self, _: &str, _: &str, _: Option<bool>, _: Option<bool>) -> Result<()> {
        unimplemented!()
    }
    async fn mark_folder_read(&self, _: &str) -> Result<()> {
        unimplemented!()
    }
    async fn empty_folder(&self, _: &str, _: Option<&str>) -> Result<()> {
        unimplemented!()
    }
    async fn move_message(&self, _: &str, _: &str, _: &str) -> Result<Option<String>> {
        unimplemented!()
    }
    async fn delete_message(&self, _: &str, _: &str) -> Result<()> {
        unimplemented!()
    }
    async fn send(&self, _: &OutgoingMessage, _: &[ResolvedAttachment]) -> Result<()> {
        unimplemented!()
    }
    async fn save_draft(&self, _: &OutgoingMessage, _: &[ResolvedAttachment]) -> Result<Option<String>> {
        unimplemented!()
    }
}

#[tokio::test]
async fn older_server_uses_ews() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/v1/identity")).respond_with(ResponseTemplate::new(404)).mount(&server).await;
    let fallback = Arc::new(Fallback::default());
    let p = OnduraProvider::new(&format!("{}/EWS/Exchange.asmx", server.uri()), "u", "p", Address::new(None, "u@x"), fallback.clone());
    assert!(!p.native().await.unwrap());
    assert_eq!(p.list_folders().await.unwrap()[0].remote_id, "AAMk");
    assert_eq!(fallback.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn unreachable_server_decides_nothing() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/v1/identity")).respond_with(ResponseTemplate::new(503)).mount(&server).await;
    let fallback = Arc::new(Fallback::default());
    let p = OnduraProvider::new(&server.uri(), "u", "p", Address::new(None, "u@x"), fallback.clone());
    // A temporary error is reported and asked again next time.
    assert!(matches!(p.list_folders().await, Err(Error::Network(_))));
    assert_eq!(fallback.0.load(Ordering::SeqCst), 0);
    server.reset().await;
    Mock::given(method("GET")).and(path("/api/v1/identity")).respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "api": "ondura-client" }))).mount(&server).await;
    assert!(p.native().await.unwrap());
}
