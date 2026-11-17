//! Microsoft Graph adapter against a mock Graph endpoint.

use std::collections::HashSet;
use std::sync::Arc;

use mirra_mail_core::model::{Address, FolderRole, OutgoingMessage, ResolvedAttachment};
use mirra_mail_core::provider::MailProvider;
use mirra_mail_core::{MemorySecretStore, SecretStore};
use mirra_mail_graph::{GraphProvider, TokenResponse};
use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn provider(server: &MockServer) -> Arc<GraphProvider> {
    let secrets: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::default());
    let p = GraphProvider::with_base_url("common".into(), "client".into(), secrets, "acc:rt".into(), format!("{}/v1.0", server.uri()));
    p.tokens()
        .store(&TokenResponse { access_token: "TOKEN".into(), refresh_token: Some("RT".into()), expires_in: 3600 })
        .await
        .unwrap();
    p
}

#[tokio::test]
async fn folders_delta_bodies_and_send() {
    let server = MockServer::start().await;
    let json_ok = |v: Value| ResponseTemplate::new(200).set_body_json(v);

    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders"))
        .and(header("Authorization", "Bearer TOKEN"))
        .respond_with(json_ok(json!({ "value": [
            { "id": "IN", "displayName": "Posteingang", "parentFolderId": "ROOT", "unreadItemCount": 2, "totalItemCount": 3, "childFolderCount": 1 },
            { "id": "SENT", "displayName": "Gesendete Elemente", "parentFolderId": "ROOT", "childFolderCount": 0 }
        ]})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/IN/childFolders"))
        .respond_with(json_ok(json!({ "value": [ { "id": "SUB", "displayName": "Projekte", "parentFolderId": "IN", "childFolderCount": 0 } ]})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1.0/$batch"))
        .and(body_string_contains("mailFolders/inbox"))
        .respond_with(json_ok(json!({ "responses": [
            { "id": "inbox", "status": 200, "body": { "id": "IN" } },
            { "id": "sentitems", "status": 200, "body": { "id": "SENT" } },
            { "id": "archive", "status": 404, "body": {} }
        ]})))
        .mount(&server)
        .await;

    // Delta: first page with nextLink, second with deltaLink.
    let next = format!("{}/v1.0/me/mailFolders/IN/messages/delta?$skiptoken=2", server.uri());
    let delta = format!("{}/v1.0/me/mailFolders/IN/messages/delta?$deltatoken=D1", server.uri());
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/IN/messages/delta"))
        .and(query_param("$skiptoken", "2"))
        .respond_with(json_ok(json!({ "@odata.deltaLink": delta, "value": [
            { "id": "M2", "subject": "Zwei", "receivedDateTime": "2026-11-17T08:00:00Z", "isRead": true }
        ]})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/IN/messages/delta"))
        .and(query_param("$deltatoken", "D1"))
        .respond_with(json_ok(json!({ "@odata.deltaLink": delta, "value": [ { "id": "M2", "@removed": { "reason": "deleted" } } ]})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/IN/messages/delta"))
        .respond_with(json_ok(json!({ "@odata.nextLink": next, "value": [
            { "id": "M1", "subject": "Eins", "receivedDateTime": "2026-11-17T09:00:00Z", "isRead": false,
              "from": { "emailAddress": { "name": "Max", "address": "max@contoso.com" } }, "hasAttachments": true }
        ]})))
        .mount(&server)
        .await;

    // Bodies via $batch, with an inline image fetched separately.
    Mock::given(method("POST"))
        .and(path("/v1.0/$batch"))
        .and(body_string_contains("attachments($select"))
        .respond_with(json_ok(json!({ "responses": [
            { "id": "M1", "status": 200, "body": {
                "body": { "contentType": "html", "content": "<p>Hallo <img src=\"cid:logo\"></p>" },
                "attachments": [ { "id": "A1", "name": "logo.png", "contentType": "image/png", "size": 10, "isInline": true } ] } }
        ]})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages/M1/attachments/A1"))
        .respond_with(json_ok(json!({ "contentId": "logo", "contentType": "image/png", "contentBytes": "iVBORw0KGgo=" })))
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1.0/me/sendMail"))
        .and(body_string_contains("\"contentBytes\":\"JVBERi0=\""))
        .respond_with(ResponseTemplate::new(202))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/IN/messages"))
        .and(query_param("$orderby", "receivedDateTime desc"))
        .respond_with(json_ok(json!({ "value": [ { "id": "OLD", "subject": "Alt", "receivedDateTime": "2026-01-01T00:00:00Z" } ]})))
        .mount(&server)
        .await;

    let g = provider(&server).await;

    let folders = g.list_folders().await.unwrap();
    assert_eq!(folders.len(), 3);
    let inbox = folders.iter().find(|f| f.role == FolderRole::Inbox).unwrap();
    assert_eq!(inbox.unread_count, 2);
    assert_eq!(folders.iter().find(|f| f.remote_id == "SUB").unwrap().parent_remote_id.as_deref(), Some("IN"));
    assert_eq!(folders.iter().find(|f| f.remote_id == "SENT").unwrap().role, FolderRole::Sent);

    let changes = g.sync_folder(inbox, None).await.unwrap();
    assert!(changes.reset);
    assert_eq!(changes.upserted.len(), 2, "both delta pages are read");
    assert!(changes.new_state.as_deref().unwrap().contains("deltatoken=D1"));

    let again = g.sync_folder(inbox, changes.new_state.as_deref()).await.unwrap();
    assert!(!again.reset);
    assert_eq!(again.removed, vec!["M2".to_string()]);

    let bodies = g.fetch_bodies("IN", &["M1".into()]).await.unwrap();
    let html = bodies[0].1.body.html.clone().unwrap();
    assert!(html.contains("data:image/png;base64,iVBORw0KGgo="), "{html}");

    let msg = OutgoingMessage { to: vec![Address::new(None, "a@contoso.com")], subject: "Test".into(), body_html: "<p>x</p>".into(), ..Default::default() };
    let pdf = ResolvedAttachment { name: "a.pdf".into(), content_type: "application/pdf".into(), data: b"%PDF-".to_vec() };
    g.send(&msg, &[pdf]).await.unwrap();

    let older = g.fetch_older(inbox, &HashSet::new(), Some(chrono::Utc::now()), 50).await.unwrap();
    assert_eq!(older[0].remote_id, "OLD");
}

#[tokio::test]
async fn refreshes_token_after_401() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": { "message": "expired" } })))
        .mount(&server)
        .await;
    let g = provider(&server).await;
    // The refresh goes to login.microsoftonline.com, which is not reachable
    // here: the call must fail with an error, not hang or panic.
    let err = g.me().await.unwrap_err();
    assert!(matches!(err, mirra_mail_core::Error::Network(_) | mirra_mail_core::Error::Auth(_)), "{err:?}");
}
