//! [`SecretStore`] implementations: the OS credential store, with a file
//! fallback for systems without one (e.g. Linux without a Secret Service).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use ondura_mail_core::{Error, Result, SecretStore};

/// Keyring service name (changing it would lose every stored password and token).
const SERVICE: &str = "de.mirranet.office";

/// Windows Credential Manager / Secret Service (GNOME Keyring, KWallet).
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

impl KeyringSecretStore {
    /// `true` if the credential store can actually store and read a value.
    pub fn works() -> bool {
        let key = "__ondura_probe__";
        let ok = KeyringSecretStore.set(key, "1").is_ok() && matches!(KeyringSecretStore.get(key), Ok(Some(v)) if v == "1");
        let _ = KeyringSecretStore.delete(key);
        ok
    }
}

/// Fallback: a JSON file readable only by the current user. Used when no OS
/// credential store is available; the folder pane shows a hint in that case.
pub struct FileSecretStore {
    path: PathBuf,
    cache: Mutex<HashMap<String, String>>,
}

impl FileSecretStore {
    pub fn open(path: PathBuf) -> Self {
        let cache = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self { path, cache: Mutex::new(cache) }
    }

    fn persist(&self, map: &HashMap<String, String>) -> Result<()> {
        let data = serde_json::to_vec(map)?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, data).map_err(|e| Error::Secrets(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, &self.path).map_err(|e| Error::Secrets(e.to_string()))
    }
}

impl SecretStore for FileSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.cache.lock().unwrap().get(key).cloned())
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        let mut map = self.cache.lock().unwrap();
        map.insert(key.to_string(), value.to_string());
        self.persist(&map)
    }

    fn delete(&self, key: &str) -> Result<()> {
        let mut map = self.cache.lock().unwrap();
        map.remove(key);
        self.persist(&map)
    }
}

/// Reads from the keyring first and falls back to the file (so secrets saved
/// while no keyring was available keep working once one appears).
pub struct LayeredSecretStore {
    pub keyring: Option<KeyringSecretStore>,
    pub file: FileSecretStore,
}

impl SecretStore for LayeredSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        if let Some(k) = &self.keyring
            && let Ok(Some(v)) = k.get(key)
        {
            return Ok(Some(v));
        }
        self.file.get(key)
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        if let Some(k) = &self.keyring
            && k.set(key, value).is_ok()
        {
            let _ = self.file.delete(key);
            return Ok(());
        }
        self.file.set(key, value)
    }

    fn delete(&self, key: &str) -> Result<()> {
        if let Some(k) = &self.keyring {
            let _ = k.delete(key);
        }
        self.file.delete(key)
    }
}
