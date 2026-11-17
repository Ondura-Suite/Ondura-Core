//! [`SecretStore`] backed by the operating system's credential store.

use mirra_mail_core::{Error, Result, SecretStore};

const SERVICE: &str = "de.mirranet.office";

pub struct KeyringSecretStore;

fn entry(key: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, key).map_err(|e| Error::Secrets(e.to_string()))
}

impl SecretStore for KeyringSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        match entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Secrets(e.to_string())),
        }
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        entry(key)?.set_password(value).map_err(|e| Error::Secrets(e.to_string()))
    }

    fn delete(&self, key: &str) -> Result<()> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Secrets(e.to_string())),
        }
    }
}
