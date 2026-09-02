//! Single error type for the Rust side. Maps cleanly into the frontend's
//! `String` return values via `Into<String>` so Tauri commands can `?`
//! and still produce a useful message.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum LumoError {
    #[error("storage: {0}")]
    Storage(#[from] rusqlite::Error),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid: {0}")]
    Invalid(String),

    #[error("internal: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, LumoError>;

// Tauri commands return their own errors; converting keeps the call sites
// one-liner: `tauri::command; async fn x() -> Result<_, String>`.
impl From<LumoError> for String {
    fn from(e: LumoError) -> String {
        e.to_string()
    }
}
