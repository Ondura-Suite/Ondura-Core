//! Integration test against a real CalDAV/CardDAV server (Radicale).
//!
//! ```sh
//! pip install radicale   # see README for the config used
//! ONDURA_DAV_URL=http://127.0.0.1:5232/niklas/ ONDURA_DAV_USER=niklas ONDURA_DAV_PASS=geheim \
//!   cargo test -p ondura-pim-dav --test radicale -- --ignored
//! ```
//! Expects a calendar supporting VEVENT+VTODO and an address book.

use std::sync::Arc;

use chrono::{Duration, Utc};
use ondura_mail_core::model::Address;
use ondura_pim_core::*;

fn env(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}

fn engine() -> Arc<PimEngine> {
    let engine = PimEngine::new(Arc::new(PimStore::open_in_memory().unwrap())).unwrap();
    let provider = ondura_pim_dav::provider(
        &env("ONDURA_DAV_URL", "http://127.0.0.1:5232/niklas/"),
        &env("ONDURA_DAV_USER", "niklas"),
        &env("ONDURA_DAV_PASS", "geheim"),
        Address::new(Some("Niklas".into()), "niklas@example.com"),
    )
    .unwrap();
    engine.register("dav", Arc::new(provider));
    engine
}

fn of(e: &PimEngine, kind: CollectionKind) -> Collection {
    e.store()
        .collections_of("dav")
        .unwrap()
        .into_iter()
        .find(|c| c.kind == kind)
        .unwrap_or_else(|| panic!("no {kind:?} collection"))
}

#[tokio::test]
#[ignore]
async fn calendar_contacts_tasks_roundtrip() {
    let e = engine();
    e.sync_account("dav").await.unwrap();
    let cal = of(&e, CollectionKind::Calendar);
    let tasks = of(&e, CollectionKind::Tasks);
    let book = of(&e, CollectionKind::Contacts);
    assert_eq!(cal.name, "Privat");
    assert_eq!(cal.color.as_deref(), Some("#c239b3"));
    assert_eq!(book.name, "Adressbuch");

    // Recurring event with an exception.
    let tag = uuid_tag();
    let start = (Utc::now() + Duration::days(2)).date_naive().and_hms_opt(8, 0, 0).unwrap().and_utc();
    let input = EventInput {
        title: format!("Weekly {tag}"),
        start,
        end: start + Duration::hours(1),
        recurrence: Some(Recurrence { freq: Freq::Weekly, interval: 1, count: Some(4), ..Default::default() }),
        reminder_minutes: Some(15),
        location: "Büro".into(),
        ..Default::default()
    };
    e.create_event(&cal.id, &input).await.unwrap();
    let range = (start - Duration::days(1), start + Duration::days(40));
    let mine = |e: &PimEngine| -> Vec<Event> {
        e.store().events_between(range.0, range.1).unwrap().into_iter().filter(|x| x.title.contains(&tag)).collect()
    };
    let events = mine(&e);
    assert_eq!(events.len(), 4);
    let second = events[1].clone();
    let moved = EventInput { title: format!("Moved {tag}"), start: second.start + Duration::hours(3), end: second.end + Duration::hours(3), ..input.clone() };
    e.update_event(&second.id, &moved, EditScope::Occurrence).await.unwrap();
    e.delete_event(&mine(&e).last().unwrap().id, EditScope::Occurrence).await.unwrap();

    // A second client sees exactly that.
    let other = engine();
    other.sync_account("dav").await.unwrap();
    let seen = mine(&other);
    assert_eq!(seen.len(), 3);
    assert!(seen.iter().any(|x| x.title.starts_with("Moved") && x.start == second.start + Duration::hours(3)));
    assert!(seen.iter().all(|x| x.location == "Büro"));

    // Delete the series.
    e.delete_event(&mine(&e)[0].id, EditScope::Series).await.unwrap();
    assert!(mine(&e).is_empty());

    // Contacts.
    let contact = Contact {
        display_name: format!("Max {tag}"),
        given_name: "Max".into(),
        family_name: tag.clone(),
        emails: vec![Labeled { label: "work".into(), value: format!("{tag}@example.com") }],
        ..Default::default()
    };
    e.save_contact(&book.id, &contact).await.unwrap();
    let mut c = e.store().list_contacts(Some(&book.id), Some(&tag), 10).unwrap()[0].clone();
    c.company = "Beispiel AG".into();
    e.save_contact(&book.id, &c).await.unwrap();
    other.sync_account("dav").await.unwrap();
    let seen = other.store().list_contacts(None, Some(&tag), 10).unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].company, "Beispiel AG");
    e.delete_contact(&c.id).await.unwrap();

    // Tasks.
    e.save_task(&tasks.id, &Task { title: format!("Task {tag}"), ..Default::default() }).await.unwrap();
    let mut t = e.store().list_tasks(Some(&tasks.id)).unwrap().into_iter().find(|t| t.title.contains(&tag)).unwrap();
    t.completed = true;
    e.save_task(&tasks.id, &t).await.unwrap();
    other.sync_account("dav").await.unwrap();
    let seen: Vec<Task> = other.store().list_tasks(None).unwrap().into_iter().filter(|t| t.title.contains(&tag)).collect();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].completed);
    e.delete_task(&t.id).await.unwrap();
    // Tasks must not show up as events and vice versa.
    assert!(e.store().events_between(range.0, range.1).unwrap().iter().all(|x| !x.title.contains("Task")));
}

#[tokio::test]
#[ignore]
async fn wrong_password_is_an_auth_error() {
    let provider = ondura_pim_dav::provider(&env("ONDURA_DAV_URL", "http://127.0.0.1:5232/niklas/"), "niklas", "falsch", Address::new(None, "x@y.z")).unwrap();
    let err = provider.list_collections().await.unwrap_err();
    assert!(matches!(err, ondura_mail_core::Error::Auth(_)), "{err:?}");
}

fn uuid_tag() -> String {
    format!("t{}", Utc::now().timestamp_nanos_opt().unwrap_or_default() % 1_000_000_000)
}
