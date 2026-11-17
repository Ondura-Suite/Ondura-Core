//! Application state shared by all windows of the suite.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use mirra_mail_core::model::{Account, AccountKind, Address};
use mirra_mail_core::secrets::{password_key, refresh_token_key};
use mirra_mail_core::{Error, MailProvider, Result, SecretStore, Store, SyncEngine};
use mirra_mail_ews::EwsProvider;
use mirra_mail_graph::GraphProvider;
use mirra_mail_imap::ImapProvider;
use serde::{Deserialize, Serialize};

pub struct AppState {
    pub engine: Arc<SyncEngine>,
    pub secrets: Arc<dyn SecretStore>,
    /// `false` if passwords are kept in the fallback file.
    pub keyring_available: bool,
    /// Set by "Beenden" in the tray menu, so the app really exits.
    pub quitting: AtomicBool,
}

impl AppState {
    pub fn store(&self) -> &Arc<Store> {
        self.engine.store()
    }

    /// Create the protocol adapter for an account and register it with the
    /// sync engine (which starts watching the inbox).
    pub fn activate(&self, account: &Account) -> Result<()> {
        match build_provider(account, &self.secrets) {
            Ok(provider) => {
                self.engine.register(&account.id, provider, true);
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

pub fn build_provider(account: &Account, secrets: &Arc<dyn SecretStore>) -> Result<Arc<dyn MailProvider>> {
    Ok(match &account.kind {
        AccountKind::Imap(cfg) => {
            let password = secrets
                .get(&password_key(&account.id))?
                .ok_or_else(|| Error::Auth("Kein Passwort gespeichert".into()))?;
            ImapProvider::new(cfg.clone(), Address::new(Some(account.display_name.clone()), &account.email), password)
        }
        AccountKind::Graph(cfg) => GraphProvider::new(
            cfg.tenant.clone(),
            cfg.client_id.clone(),
            Arc::clone(secrets),
            refresh_token_key(&account.id),
        ),
        AccountKind::Ews(cfg) => {
            let password = secrets
                .get(&password_key(&account.id))?
                .ok_or_else(|| Error::Auth("Kein Passwort gespeichert".into()))?;
            EwsProvider::new(cfg.clone(), Address::new(Some(account.display_name.clone()), &account.email), password)
        }
    })
}
