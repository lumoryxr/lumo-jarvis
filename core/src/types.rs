//! Wire types shared with the frontend.
//!
//! These mirror `src/core/types.ts` field for field. Keeping the two in sync by
//! hand is deliberate: generating one from the other buys little for a surface
//! this small, and the explicit `serde` renames document the boundary.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Nominal,
    Warn,
    Critical,
}

impl Tone {
    /// Thresholds match the gauge colours in `tokens.css`.
    pub fn for_value(v: f32) -> Self {
        if v > 0.88 {
            Tone::Critical
        } else if v > 0.70 {
            Tone::Warn
        } else {
            Tone::Nominal
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metric {
    pub id: String,
    pub label: String,
    /// Normalised 0..1, for gauges and sparklines.
    pub value: f32,
    /// Human-readable rendering of the raw value.
    pub display: String,
    /// Rolling window, oldest first.
    pub history: Vec<f32>,
    pub tone: Tone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: u32,
    pub mem: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineSnapshot {
    pub host: String,
    pub os: String,
    pub uptime_sec: u64,
    pub metrics: Vec<Metric>,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Queued,
    Running,
    Blocked,
    Review,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskExecutor {
    Hermes,
    Local,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub intent: String,
    pub executor: TaskExecutor,
    pub status: TaskStatus,
    pub progress: f32,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    pub tags: Vec<String>,
    /// Hermes `run_id`, or a local job handle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("hermes gateway: {0}")]
    Hermes(String),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// Errors cross the Tauri boundary as plain strings.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
