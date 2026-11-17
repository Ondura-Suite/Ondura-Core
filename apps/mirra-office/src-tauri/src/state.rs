//! Application state shared by all windows of the suite.

use std::sync::Arc;

use mirra_mail_core::model::{Account, AccountKind, Address};
use mirra_mail_core::secrets::{password_key, refresh_token_key};
use mirra_mail_core::{Error, MailProvider, Result, SecretStore, Store, SyncEngine};
use mirra_mail_graph::GraphProvider;
use mirra_mail_imap::ImapProvider;

pub struct AppState {
    pub engine: Arc<SyncEngine>,
    pub secrets: Arc<dyn SecretStore>,
}

impl AppState {
    pub fn store(&self) -> &Arc<Store> {
        self.engine.store()
    }

    /// Create the protocol adapter for an account and register it with the
    /// sync engine.
    pub fn activate(&self, account: &Account) -> Result<()> {
        let provider = build_provider(account, &self.secrets)?;
        self.engine.register(&account.id, provider);
        Ok(())
    }
}

pub fn build_provider(account: &Account, secrets: &Arc<dyn SecretStore>) -> Result<Arc<dyn MailProvider>> {
    Ok(match &account.kind {
        AccountKind::Imap(cfg) => {
            let password = secrets
                .get(&password_key(&account.id))?
                .ok_or_else(|| Error::Auth(format!("no password stored for {}", account.email)))?;
            ImapProvider::new(cfg.clone(), Address::new(Some(account.display_name.clone()), &account.email), password)
        }
        AccountKind::Graph(cfg) => GraphProvider::new(
            cfg.tenant.clone(),
            cfg.client_id.clone(),
            Arc::clone(secrets),
            refresh_token_key(&account.id),
        ),
        AccountKind::Ews(_) => return Err(Error::Unsupported("Exchange Web Services (coming soon)".into())),
    })
}
