//! End-to-end test of the EWS adapter against a mock Exchange server that
//! speaks NTLM and answers the SOAP operations Ondura Mail uses.

use std::collections::HashSet;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ondura_mail_core::model::{Address, EwsConfig, FolderRole, OutgoingMessage};
use ondura_mail_core::provider::MailProvider;
use ondura_mail_ews::EwsProvider;
use wiremock::matchers::{body_string_contains, header_regex, method};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn challenge() -> String {
    let mut c = Vec::new();
    c.extend_from_slice(b"NTLMSSP\0");
    c.extend_from_slice(&2u32.to_le_bytes());
    c.extend_from_slice(&[0, 0, 0, 0, 48, 0, 0, 0]);
    c.extend_from_slice(&0xE288_8215u32.to_le_bytes());
    c.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
    c.extend_from_slice(&[0; 8]);
    c.extend_from_slice(&[4, 0, 4, 0, 48, 0, 0, 0]);
    c.extend_from_slice(&[0, 0, 0, 0]);
    B64.encode(c)
}

fn soap(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="m" xmlns:t="t"><s:Body>{body}</s:Body></s:Envelope>"#
    )
}

const MIME: &str = "From: Max Becker <max@example.com>\r\nTo: Niklas <niklas@corp.local>, anna@corp.local\r\nSubject: Angebot\r\nMessage-ID: <a1@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Niklas, anbei das Angebot.\r\n";

async fn mock_exchange() -> MockServer {
    let server = MockServer::start().await;
    let ok = |body: &str| ResponseTemplate::new(200).set_body_string(soap(body)).insert_header("Content-Type", "text/xml");

    // No credentials: advertise NTLM.
    Mock::given(method("POST"))
        .and(|r: &Request| !r.headers.contains_key("authorization"))
        .respond_with(ResponseTemplate::new(401).append_header("WWW-Authenticate", "Negotiate").append_header("WWW-Authenticate", "NTLM"))
        .mount(&server)
        .await;
    // NTLM type 1 → challenge.
    Mock::given(method("POST"))
        .and(header_regex("Authorization", "^NTLM TlRMTVNTUAAB"))
        .respond_with(ResponseTemplate::new(401).insert_header("WWW-Authenticate", format!("NTLM {}", challenge()).as_str()))
        .mount(&server)
        .await;

    let authed = || {
        Mock::given(method("POST"))
            .and(header_regex("Authorization", "^NTLM TlRMTVNTUAAD"))
    };
    authed()
        .and(body_string_contains("<m:GetFolder>"))
        .respond_with(ok(r#"<m:GetFolderResponse><m:ResponseMessages>
<m:GetFolderResponseMessage ResponseClass="Success"><m:Folders><t:Folder><t:FolderId Id="ROOT"/></t:Folder></m:Folders></m:GetFolderResponseMessage>
<m:GetFolderResponseMessage ResponseClass="Success"><m:Folders><t:Folder><t:FolderId Id="INBOX"/></t:Folder></m:Folders></m:GetFolderResponseMessage>
<m:GetFolderResponseMessage ResponseClass="Success"><m:Folders><t:Folder><t:FolderId Id="DRAFTS"/></t:Folder></m:Folders></m:GetFolderResponseMessage>
<m:GetFolderResponseMessage ResponseClass="Success"><m:Folders><t:Folder><t:FolderId Id="SENT"/></t:Folder></m:Folders></m:GetFolderResponseMessage>
<m:GetFolderResponseMessage ResponseClass="Success"><m:Folders><t:Folder><t:FolderId Id="TRASH"/></t:Folder></m:Folders></m:GetFolderResponseMessage>
<m:GetFolderResponseMessage ResponseClass="Error"><m:MessageText>x</m:MessageText><m:ResponseCode>ErrorFolderNotFound</m:ResponseCode></m:GetFolderResponseMessage>
</m:ResponseMessages></m:GetFolderResponse>"#))
        .mount(&server)
        .await;
    authed()
        .and(body_string_contains("<m:FindFolder"))
        .respond_with(ok(r#"<m:FindFolderResponse><m:ResponseMessages><m:FindFolderResponseMessage ResponseClass="Success"><m:RootFolder><t:Folders>
<t:Folder><t:FolderId Id="INBOX"/><t:ParentFolderId Id="ROOT"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>Posteingang</t:DisplayName><t:TotalCount>1</t:TotalCount><t:UnreadCount>1</t:UnreadCount></t:Folder>
<t:Folder><t:FolderId Id="SUB"/><t:ParentFolderId Id="INBOX"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>Projekte</t:DisplayName></t:Folder>
<t:Folder><t:FolderId Id="ARCH"/><t:ParentFolderId Id="ROOT"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>Archiv</t:DisplayName></t:Folder>
<t:Folder><t:FolderId Id="SENT"/><t:ParentFolderId Id="ROOT"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>Gesendete Elemente</t:DisplayName></t:Folder>
<t:Folder><t:FolderId Id="DRAFTS"/><t:ParentFolderId Id="ROOT"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>Entwürfe</t:DisplayName></t:Folder>
<t:Folder><t:FolderId Id="TRASH"/><t:ParentFolderId Id="ROOT"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>Gelöschte Elemente</t:DisplayName></t:Folder>
<t:CalendarFolder><t:FolderId Id="CAL"/><t:ParentFolderId Id="ROOT"/><t:FolderClass>IPF.Appointment</t:FolderClass><t:DisplayName>Kalender</t:DisplayName></t:CalendarFolder>
</t:Folders></m:RootFolder></m:FindFolderResponseMessage></m:ResponseMessages></m:FindFolderResponse>"#))
        .mount(&server)
        .await;
    authed()
        .and(body_string_contains("<m:SyncFolderItems>"))
        .respond_with(ok(r#"<m:SyncFolderItemsResponse><m:ResponseMessages><m:SyncFolderItemsResponseMessage ResponseClass="Success">
<m:SyncState>STATE1</m:SyncState><m:IncludesLastItemInRange>true</m:IncludesLastItemInRange><m:Changes>
<t:Create><t:Message><t:ItemId Id="MSG1" ChangeKey="C"/><t:Subject>Angebot</t:Subject><t:DateTimeReceived>2026-11-17T09:00:00Z</t:DateTimeReceived>
<t:IsRead>false</t:IsRead><t:DisplayTo>Niklas</t:DisplayTo><t:From><t:Mailbox><t:Name>Max Becker</t:Name><t:EmailAddress>max@example.com</t:EmailAddress></t:Mailbox></t:From></t:Message></t:Create>
</m:Changes></m:SyncFolderItemsResponseMessage></m:ResponseMessages></m:SyncFolderItemsResponse>"#))
        .mount(&server)
        .await;
    authed()
        .and(body_string_contains("<m:GetItem>"))
        .respond_with(ok(&format!(
            r#"<m:GetItemResponse><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Success"><m:Items><t:Message><t:MimeContent CharacterSet="UTF-8">{}</t:MimeContent><t:ItemId Id="MSG1"/></t:Message></m:Items></m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse>"#,
            B64.encode(MIME)
        )))
        .mount(&server)
        .await;
    for op in ["UpdateItem", "DeleteItem", "CreateItem"] {
        authed()
            .and(body_string_contains(format!("<m:{op} ").as_str()))
            .respond_with(ok(&format!(r#"<m:{op}Response><m:ResponseMessages><m:{op}ResponseMessage ResponseClass="Success"/></m:ResponseMessages></m:{op}Response>"#)))
            .mount(&server)
            .await;
    }
    authed()
        .and(body_string_contains("<m:MoveItem>"))
        .respond_with(ok(r#"<m:MoveItemResponse><m:ResponseMessages><m:MoveItemResponseMessage ResponseClass="Success"><m:Items><t:Message><t:ItemId Id="MSG1-MOVED"/></t:Message></m:Items></m:MoveItemResponseMessage></m:ResponseMessages></m:MoveItemResponse>"#))
        .mount(&server)
        .await;
    // Wrong NTLM response (bad credentials would end here in reality).
    server
}

fn provider(server: &MockServer) -> std::sync::Arc<EwsProvider> {
    EwsProvider::new(
        EwsConfig { url: format!("{}/EWS/Exchange.asmx", server.uri()), username: "CORP\\niklas".into(), mailbox: None },
        Address::new(Some("Niklas".into()), "niklas@corp.local"),
        "geheim".into(),
    )
}

#[tokio::test]
async fn ntlm_and_mail_operations() {
    let server = mock_exchange().await;
    let ews = provider(&server);

    // test_login asks for the inbox only; the mock answers with more.
    let _ = ews.test_login().await;

    let folders = ews.list_folders().await.unwrap();
    let role = |r| folders.iter().find(|f| f.role == r).unwrap_or_else(|| panic!("missing {r:?}"));
    assert_eq!(role(FolderRole::Inbox).remote_id, "INBOX");
    assert_eq!(role(FolderRole::Archive).remote_id, "ARCH");
    assert_eq!(role(FolderRole::Sent).remote_id, "SENT");
    assert!(folders.iter().all(|f| f.remote_id != "CAL"), "calendar folders are skipped");
    let sub = folders.iter().find(|f| f.remote_id == "SUB").unwrap();
    assert_eq!(sub.parent_remote_id.as_deref(), Some("INBOX"));
    assert_eq!(role(FolderRole::Inbox).parent_remote_id, None, "root children are top-level");

    let changes = ews.sync_folder(role(FolderRole::Inbox), None).await.unwrap();
    assert!(changes.reset);
    assert_eq!(changes.new_state.as_deref(), Some("STATE1"));
    assert_eq!(changes.upserted.len(), 1);
    assert_eq!(changes.upserted[0].from.as_ref().unwrap().email, "max@example.com");

    let body = ews.fetch_body("INBOX", "MSG1").await.unwrap();
    assert!(body.body.text.unwrap().contains("anbei das Angebot"));
    let rcpt = body.recipients.unwrap();
    assert_eq!(rcpt.to.len(), 2, "recipient addresses come from the MIME message");
    assert_eq!(rcpt.to[1].email, "anna@corp.local");

    ews.set_flags("INBOX", "MSG1", Some(true), Some(true)).await.unwrap();
    assert_eq!(ews.move_message("INBOX", "MSG1", "ARCH").await.unwrap().as_deref(), Some("MSG1-MOVED"));
    ews.delete_message("ARCH", "MSG1-MOVED").await.unwrap();

    let msg = OutgoingMessage {
        to: vec![Address::new(None, "max@example.com")],
        subject: "Re: Angebot".into(),
        body_html: "<p>Danke!</p>".into(),
        ..Default::default()
    };
    ews.send(&msg, &[]).await.unwrap();
    ews.save_draft(&msg, &[]).await.unwrap();

    // The outgoing request carries the message as base64 MIME.
    let requests = server.received_requests().await.unwrap();
    let send = requests.iter().find(|r| String::from_utf8_lossy(&r.body).contains("SendAndSaveCopy")).unwrap();
    let body = String::from_utf8_lossy(&send.body);
    let start = body.find("<t:MimeContent CharacterSet=\"UTF-8\">").unwrap() + 36;
    let end = body[start..].find('<').unwrap() + start;
    let mime = String::from_utf8(B64.decode(&body[start..end]).unwrap()).unwrap();
    assert!(mime.contains("Subject: Re: Angebot"));
    let draft = requests.iter().find(|r| String::from_utf8_lossy(&r.body).contains("<m:CreateItem MessageDisposition=\"SaveOnly\"")).unwrap();
    assert!(String::from_utf8_lossy(&draft.body).contains("<t:FolderId Id=\"DRAFTS\"/>"));

    // Every authenticated call used an NTLM type 3 message with the user name.
    let type3 = requests
        .iter()
        .filter_map(|r| r.headers.get("authorization"))
        .filter_map(|v| v.to_str().ok())
        .filter(|v| v.starts_with("NTLM TlRMTVNTUAAD"))
        .count();
    assert!(type3 >= 8, "got {type3} authenticated requests");

    let older = ews.fetch_older(role(FolderRole::Inbox), &HashSet::new(), None, 10).await;
    assert!(older.is_err() || older.unwrap().is_empty(), "FindItem is not mocked");
}

#[tokio::test]
async fn rejects_bad_credentials() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401).insert_header("WWW-Authenticate", "Basic realm=\"x\""))
        .mount(&server)
        .await;
    let err = provider(&server).test_login().await.unwrap_err();
    assert!(matches!(err, ondura_mail_core::Error::Auth(_)), "{err:?}");
}
