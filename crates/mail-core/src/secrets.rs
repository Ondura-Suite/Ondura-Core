//! Storage for passwords and OAuth refresh tokens.
//!
//! The desktop app implements this with the OS credential store (Windows
//! Credential Manager / Secret Service on Linux). Secrets never end up in the
//! SQLite database.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::Result;

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, value: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// Key for the password of an IMAP/EWS account.
pub fn password_key(account_id: &str) -> String {
    format!("{account_id}:password")
}

/// Key for the OAuth refresh token of a Graph account.
pub fn refresh_token_key(account_id: &str) -> String {
    format!("{account_id}:refresh-token")
}

/// In-memory implementation, used for tests and as a fallback.
#[derive(Default)]
pub struct MemorySecretStore {
    inner: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemorySecretStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.inner.lock().unwrap().get(key).cloned())
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.inner.lock().unwrap().insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<()> {
        self.inner.lock().unwrap().remove(key);
        Ok(())
    }
}
