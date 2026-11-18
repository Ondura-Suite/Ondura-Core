//! Application state shared by all windows of the suite.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use ondura_mail_core::model::{Account, AccountKind, Address};
use ondura_mail_core::secrets::{password_key, refresh_token_key};
use ondura_mail_core::{Error, MailProvider, Result, SecretStore, Store, SyncEngine};
use ondura_mail_ews::EwsProvider;
use ondura_mail_graph::GraphProvider;
use ondura_mail_imap::ImapProvider;
use ondura_pim_core::{PimEngine, PimProvider};
use serde::{Deserialize, Serialize};

pub struct AppState {
    pub engine: Arc<SyncEngine>,
    pub pim: Arc<PimEngine>,
    pub secrets: Arc<dyn SecretStore>,
    /// `false` if passwords are kept in the fallback file.
    pub keyring_available: bool,
    /// Set by "Beenden" in the tray menu, so the app really exits.
    pub quitting: AtomicBool,
}

/// Adapters of one account: mail and/or calendars, contacts and tasks.
pub struct Providers {
    pub mail: Option<Arc<dyn MailProvider>>,
    pub pim: Option<Arc<dyn PimProvider>>,
}

impl AppState {
    pub fn store(&self) -> &Arc<Store> {
        self.engine.store()
    }

    /// Create the adapters for an account and register them with the mail
    /// and PIM engines.
    pub fn activate(&self, account: &Account) -> Result<()> {
        match build_providers(account, &self.secrets) {
            Ok(p) => {
                if let Some(mail) = p.mail {
                    self.engine.register(&account.id, mail, true);
                }
                if let Some(pim) = p.pim {
                    self.pim.register(&account.id, pim);
                    let engine = Arc::clone(&self.pim);
                    let id = account.id.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = engine.sync_account(&id).await;
                    });
                }
                Ok(())
            }
            Err(e) => {
                self.engine.set_account_error(&account.id, &e);
                Err(e)
            }
        }
    }

    pub fn settings(&self) -> AppSettings {
        let get = |k: &str| self.store().setting(k).ok().flatten();
        let defaults = AppSettings::default();
        AppSettings {
            sync_interval_minutes: get("syncIntervalMinutes").and_then(|v| v.parse().ok()).unwrap_or(defaults.sync_interval_minutes),
            notifications: get("notifications").map(|v| v == "true").unwrap_or(defaults.notifications),
            run_in_background: get("runInBackground").map(|v| v == "true").unwrap_or(defaults.run_in_background),
            load_remote_images: get("loadRemoteImages").map(|v| v == "true").unwrap_or(defaults.load_remote_images),
            keyring_available: self.keyring_available,
        }
    }

    pub fn save_settings(&self, s: &AppSettings) -> Result<()> {
        let store = self.store();
        store.set_setting("syncIntervalMinutes", &s.sync_interval_minutes.clamp(1, 120).to_string())?;
        store.set_setting("notifications", &s.notifications.to_string())?;
        store.set_setting("runInBackground", &s.run_in_background.to_string())?;
        store.set_setting("loadRemoteImages", &s.load_remote_images.to_string())?;
        Ok(())
    }
}

/// App-wide settings (per-account settings live in [`Account`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub sync_interval_minutes: u64,
    pub notifications: bool,
    pub run_in_background: bool,
    pub load_remote_images: bool,
    /// Read-only: whether the OS credential store is used.
    #[serde(default)]
    pub keyring_available: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self { sync_interval_minutes: 5, notifications: true, run_in_background: true, load_remote_images: false, keyring_available: true }
    }
}

fn password(account: &Account, secrets: &Arc<dyn SecretStore>) -> Result<String> {
    secrets
        .get(&password_key(&account.id))?
        .ok_or_else(|| Error::Auth("Kein Passwort gespeichert".into()))
}

pub fn build_providers(account: &Account, secrets: &Arc<dyn SecretStore>) -> Result<Providers> {
    let me = Address::new(Some(account.display_name.clone()), &account.email);
    let dav = |pw: &str| -> Option<Arc<dyn PimProvider>> {
        let cfg = account.dav.as_ref()?;
        let user = if cfg.username.is_empty() { account.email.as_str() } else { cfg.username.as_str() };
        ondura_pim_dav::provider(&cfg.url, user, pw, me.clone()).ok().map(|p| Arc::new(p) as Arc<dyn PimProvider>)
    };
    Ok(match &account.kind {
        AccountKind::Imap(cfg) => {
            let pw = password(account, secrets)?;
            Providers { pim: dav(&pw), mail: Some(ImapProvider::new(cfg.clone(), me.clone(), pw)) }
        }
        AccountKind::Graph(cfg) => {
            let client_id = crate::commands::effective_client_id(&cfg.client_id).map_err(ondura_mail_core::Error::Auth)?;
            let g = match cfg.mailbox.as_deref() {
                Some(mailbox) => GraphProvider::shared(cfg.tenant.clone(), client_id, Arc::clone(secrets), refresh_token_key(&account.id), mailbox),
                None => GraphProvider::new(cfg.tenant.clone(), client_id, Arc::clone(secrets), refresh_token_key(&account.id)),
            };
            Providers { mail: Some(g.clone()), pim: Some(g) }
        }
        AccountKind::Ews(cfg) => {
            let e = EwsProvider::new(cfg.clone(), me.clone(), password(account, secrets)?);
            Providers { mail: Some(e.clone()), pim: Some(e) }
        }
        AccountKind::Dav(cfg) => {
            let pw = password(account, secrets)?;
            let user = if cfg.username.is_empty() { account.email.clone() } else { cfg.username.clone() };
            let p = ondura_pim_dav::provider(&cfg.url, &user, &pw, me.clone())?;
            Providers { mail: None, pim: Some(Arc::new(p)) }
        }
    })
}
