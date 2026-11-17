//! Core of Relay.
//!
//! The design follows a "local first" approach: the UI only ever talks to the
//! local [`Store`]. Protocol adapters (IMAP/SMTP, Microsoft Graph, EWS, ...)
//! implement [`MailProvider`] and are driven by the [`SyncEngine`], which
//! mirrors remote state into the store and pushes local changes back.

pub mod error;
pub mod model;
pub mod net;
pub mod preview;
pub mod provider;
pub mod secrets;
pub mod store;
pub mod sync;
pub mod xml;

pub use error::{Error, Result};
pub use model::*;
pub use provider::{FetchedBody, FolderChanges, MailProvider, Recipients, RemoteFolder, RemoteMessage};
pub use secrets::{MemorySecretStore, SecretStore};
pub use store::Store;
pub use sync::{OutboxItem, SyncEngine, SyncEvent};
