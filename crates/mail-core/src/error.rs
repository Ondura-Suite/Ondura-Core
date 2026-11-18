use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Error type shared by the core and all protocol adapters.
#[derive(Debug, Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("network error: {0}")]
    Network(String),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("authentication failed: {0}")]
    Auth(String),

    #[error("not found: {0}")]
    NotFound(String),

    /// The target changed or already exists (e.g. a file of that name).
    #[error("conflict: {0}")]
    Conflict(String),

    #[error("operation not supported by this account type: {0}")]
    Unsupported(String),

    #[error("secret store error: {0}")]
    Secrets(String),

    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn network(e: impl std::fmt::Display) -> Self {
        Self::Network(e.to_string())
    }

    pub fn protocol(e: impl std::fmt::Display) -> Self {
        Self::Protocol(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Network(e.to_string())
    }
}
