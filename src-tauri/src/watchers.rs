//! Basic watcher loop. M1 covers disk-full + a simple morning greeter;
//! the more sophisticated ones (CI integration, Hermes dispatch, process-hog
//! with rate-limits) land as M1 watchers ship + we hook them into the
//! real backend in M4.

use crate::error::Result;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProposalLike {
    pub id: String,
    pub trigger: String,
    pub reasoning: String,
    pub confidence: f32,
    pub expires_at: i64,
    pub tone: Option<String>,
    pub due_at: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
struct WatcherEvent {
    proposal: ProposalLike,
}

pub fn run_basic(store: &Store, app: &AppHandle) {
    if let Err(e) = run_inner(store, app) {
        log::warn!("lumo: watcher tick failed: {e}");
    }
}

fn run_inner(_store: &Store, app: &AppHandle) -> Result<()> {
    let hour = chrono::Utc::now().hour();
    // Morning greeting at 8-10am UTC, low confidence.
    if (8..10).contains(&hour) {
        let now = chrono::Utc::now().timestamp();
        let proposal = ProposalLike {
            id: Uuid::new_v4().to_string(),
            trigger: "morning".to_string(),
            reasoning: "早上开工了 — 有需要先处理的列表吗?".to_string(),
            confidence: 0.45,
            expires_at: now + 3600,
            tone: Some("warm".to_string()),
            due_at: None,
        };
        let _ = app.emit("lumo:event", WatcherEvent { proposal });
    }
    // Quiet every other hour.
    Ok(())
}

use chrono::Timelike;
