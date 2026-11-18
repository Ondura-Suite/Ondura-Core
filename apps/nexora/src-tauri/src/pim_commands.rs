//! Tauri commands for calendars, contacts and tasks (see `src/lib/pim.ts`).

use chrono::{DateTime, Utc};
use nexora_pim_core::provider::{Availability, EventResponse};
use nexora_pim_core::*;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn pim_collections(state: State<'_, AppState>) -> CmdResult<Vec<Collection>> {
    state.pim.store().list_collections().map_err(err)
}

#[tauri::command]
pub fn pim_set_visible(state: State<'_, AppState>, collection_id: String, visible: bool) -> CmdResult<()> {
    state.pim.store().set_collection_visible(&collection_id, visible).map_err(err)
}

#[tauri::command]
pub fn pim_set_color(state: State<'_, AppState>, collection_id: String, color: String) -> CmdResult<()> {
    state.pim.store().set_collection_color(&collection_id, &color).map_err(err)
}

#[tauri::command]
pub fn pim_create_collection(state: State<'_, AppState>, kind: CollectionKind, name: String, color: Option<String>) -> CmdResult<Collection> {
    state.pim.create_local_collection(kind, name.trim(), color.as_deref()).map_err(err)
}

#[tauri::command]
pub fn pim_delete_collection(state: State<'_, AppState>, collection_id: String) -> CmdResult<()> {
    state.pim.delete_local_collection(&collection_id).map_err(err)
}

/// Starts a sync of all accounts (results arrive as `pim-sync` events).
#[tauri::command]
pub fn pim_sync(state: State<'_, AppState>) {
    let pim = std::sync::Arc::clone(&state.pim);
    tauri::async_runtime::spawn(async move { pim.sync_all().await });
}

// ------------------------------------------------------------------ events

#[tauri::command]
pub fn pim_events(state: State<'_, AppState>, from: DateTime<Utc>, to: DateTime<Utc>) -> CmdResult<Vec<Event>> {
    state.pim.store().events_between(from, to).map_err(err)
}

#[tauri::command]
pub fn pim_search_events(state: State<'_, AppState>, query: String) -> CmdResult<Vec<Event>> {
    state.pim.store().search_events(&query, 100).map_err(err)
}

#[tauri::command]
pub async fn pim_create_event(state: State<'_, AppState>, collection_id: String, input: EventInput) -> CmdResult<()> {
    state.pim.create_event(&collection_id, &input).await.map_err(err)
}

#[tauri::command]
pub async fn pim_update_event(state: State<'_, AppState>, event_id: String, input: EventInput, scope: EditScope) -> CmdResult<()> {
    state.pim.update_event(&event_id, &input, scope).await.map_err(err)
}

#[tauri::command]
pub async fn pim_move_event(state: State<'_, AppState>, event_id: String, collection_id: String) -> CmdResult<()> {
    state.pim.move_event(&event_id, &collection_id).await.map_err(err)
}

#[tauri::command]
pub async fn pim_delete_event(state: State<'_, AppState>, event_id: String, scope: EditScope) -> CmdResult<()> {
    state.pim.delete_event(&event_id, scope).await.map_err(err)
}

#[tauri::command]
pub async fn pim_respond_event(state: State<'_, AppState>, event_id: String, response: EventResponse) -> CmdResult<()> {
    state.pim.respond_event(&event_id, response).await.map_err(err)
}

#[tauri::command]
pub async fn pim_free_busy(state: State<'_, AppState>, emails: Vec<String>, from: DateTime<Utc>, to: DateTime<Utc>) -> CmdResult<Vec<Availability>> {
    state.pim.free_busy(&emails, from, to).await.map_err(err)
}

/// Store an invitation (iCalendar text, e.g. from an e-mail) in a calendar.
#[tauri::command]
pub async fn pim_import_ics(state: State<'_, AppState>, collection_id: String, ics: String) -> CmdResult<()> {
    state.pim.import_ics(&collection_id, &ics).await.map_err(err)
}

/// Write contacts as a vCard file.
#[tauri::command]
pub fn pim_export_contacts(state: State<'_, AppState>, contact_ids: Vec<String>, path: String) -> CmdResult<()> {
    let text = state.pim.export_vcard(&contact_ids).map_err(err)?;
    std::fs::write(&path, text).map_err(|e| format!("{path} konnte nicht geschrieben werden: {e}"))
}

/// iTIP REQUEST of an event, for sending an invitation by e-mail.
#[tauri::command]
pub fn pim_invitation_ics(state: State<'_, AppState>, event_id: String) -> CmdResult<String> {
    state.pim.invitation_ics(&event_id).map_err(err)
}

// ---------------------------------------------------------------- contacts

#[tauri::command]
pub fn pim_contacts(state: State<'_, AppState>, collection_id: Option<String>, query: Option<String>) -> CmdResult<Vec<Contact>> {
    let query = query.filter(|q| !q.trim().is_empty());
    state.pim.store().list_contacts(collection_id.as_deref(), query.as_deref().map(str::trim), 5000).map_err(err)
}

#[tauri::command]
pub async fn pim_save_contact(state: State<'_, AppState>, collection_id: String, contact: Contact) -> CmdResult<()> {
    state.pim.save_contact(&collection_id, &contact).await.map_err(err)
}

#[tauri::command]
pub async fn pim_delete_contact(state: State<'_, AppState>, contact_id: String) -> CmdResult<()> {
    state.pim.delete_contact(&contact_id).await.map_err(err)
}

/// Import a `.vcf` file (one or many cards); returns the number imported.
#[tauri::command]
pub async fn pim_import_contacts(state: State<'_, AppState>, collection_id: String, path: String) -> CmdResult<usize> {
    let text = tokio::fs::read_to_string(&path).await.map_err(err)?;
    let contacts = vcard::parse_all(&text);
    let mut n = 0;
    for mut c in contacts {
        // Imported cards are new items; keep their extra properties.
        c.remote_id.clear();
        state.pim.save_contact(&collection_id, &c).await.map_err(err)?;
        n += 1;
    }
    Ok(n)
}

/// Contacts matching a query, for address completion in Nexora Mail.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    name: String,
    email: String,
}

#[tauri::command]
pub fn pim_suggest(state: State<'_, AppState>, query: String) -> CmdResult<Vec<Suggestion>> {
    if query.trim().len() < 2 {
        return Ok(vec![]);
    }
    let contacts = state.pim.store().list_contacts(None, Some(query.trim()), 30).map_err(err)?;
    let q = query.trim().to_lowercase();
    let mut out: Vec<Suggestion> = contacts
        .iter()
        .flat_map(|c| c.emails.iter().map(move |e| Suggestion { name: c.effective_name(), email: e.value.clone() }))
        .filter(|s| s.name.to_lowercase().contains(&q) || s.email.to_lowercase().contains(&q))
        .collect();
    out.truncate(8);
    Ok(out)
}

// ------------------------------------------------------------------- tasks

#[tauri::command]
pub fn pim_tasks(state: State<'_, AppState>, collection_id: Option<String>) -> CmdResult<Vec<Task>> {
    state.pim.store().list_tasks(collection_id.as_deref()).map_err(err)
}

#[tauri::command]
pub async fn pim_save_task(state: State<'_, AppState>, collection_id: String, task: Task) -> CmdResult<()> {
    state.pim.save_task(&collection_id, &task).await.map_err(err)
}

#[tauri::command]
pub async fn pim_delete_task(state: State<'_, AppState>, task_id: String) -> CmdResult<()> {
    state.pim.delete_task(&task_id).await.map_err(err)
}
