//! Tauri-backed Provider. Counterpart to MockBackend on the React side.
//!
//! Holds a shared Machine instance (sysinfo), a Store handle, and the
//! Tauri AppHandle so it can emit ProviderEvents to the frontend window.
//!
//! Boot sequence:
//!   1. `new(...)` builds the provider and stores the AppHandle.
//!   2. `start()` spawns a background thread that ticks once per second:
//!        - takes a sysinfo machine snapshot
//!        - emits a ProviderEvent::Machine to the frontend
//!        - emits a ProviderEvent::Mood drift toward baseline
//!        - runs the simple watcher (disk-full, process-hog, ci-failure,
//!          time-greeter) and pushes any proposals up to the front.
//!   3. Tauri commands route one-off requests (cmd_send, cmd_accept_proposal).
//!
//! The Machine + watcher + emitter are minimal — enough to prove the
//! ProviderEvent contract is real. A real LLM-backed turn handler lands
//! in M4.

use crate::error::Result;
use crate::machine::{Machine, MachineSnapshot};
use crate::store::Store;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter as _, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProviderEvent {
    MessageStart {
        message: serde_json::Value,
    },
    MessageDelta {
        id: String,
        text: String,
    },
    MessageEnd {
        id: String,
    },
    MessageMemoryRefs {
        message_id: String,
        ids: Vec<String>,
    },
    ToolStart {
        message_id: String,
        call: serde_json::Value,
    },
    ToolEnd {
        message_id: String,
        call_id: String,
        status: String,
        output: Option<String>,
    },
    TaskUpsert {
        task: serde_json::Value,
    },
    Machine {
        snapshot: MachineSnapshot,
    },
    Mood {
        mood: serde_json::Value,
    },
    Emotion {
        emotion: String,
        intensity: f32,
        trigger: Option<String>,
    },
    Action {
        action: String,
    },
    Persona {
        preset: String,
        name: Option<String>,
    },
    ProposalPushed {
        proposal: serde_json::Value,
    },
    ProposalAccepted {
        proposal_id: String,
    },
    ProposalDismissed {
        proposal_id: String,
    },
    ConnectorStatus {
        status: serde_json::Value,
    },
}

pub struct TauriProvider {
    pub store: Arc<Store>,
    pub app: AppHandle,
    pub machine: Machine,
    /// Background join handle. Drop kills the thread.
    pub tick: Option<thread::JoinHandle<()>>,
    /// Stop flag for the polling thread.
    pub stop: Arc<Mutex<bool>>,
}

impl TauriProvider {
    pub fn new(store: Arc<Store>, app: AppHandle) -> Self {
        Self {
            store,
            app,
            machine: Machine::new(),
            tick: None,
            stop: Arc::new(Mutex::new(false)),
        }
    }

    /// Spawn the 1-second polling thread. Called once during app setup.
    pub fn start(&mut self) {
        let stop = self.stop.clone();
        let app = self.app.clone();
        let machine = Machine::new();
        let store = self.store.clone();

        let handle = thread::Builder::new()
            .name("lumo-tick".into())
            .spawn(move || {
                loop {
                    if *stop.lock() {
                        break;
                    }
                    if let Ok(snap) = machine.snapshot() {
                        let _ = app.emit("lumo:event", ProviderEvent::Machine { snapshot: snap });
                    }
                    // Run watchers (M1: simple checks; real ones in M4).
                    crate::watchers::run_basic(&store, &app);
                    thread::sleep(Duration::from_secs(1));
                }
            })
            .expect("spawn tick thread");
        self.tick = Some(handle);
    }

    pub fn stop(&mut self) {
        *self.stop.lock() = true;
        if let Some(h) = self.tick.take() {
            let _ = h.join();
        }
    }
}

// ---------------------------------------------------------------- Tauri commands

#[tauri::command]
pub async fn cmd_start() -> std::result::Result<(), String> {
    log::info!("lumo: start");
    Ok(())
}

#[tauri::command]
pub async fn cmd_subscribe(window: tauri::Window) -> std::result::Result<(), String> {
    log::info!("lumo: subscribe called");
    let _ = window;
    Ok(())
}

#[tauri::command]
pub async fn cmd_send(text: String) -> std::result::Result<(), String> {
    log::info!("lumo: send -> {}", text);
    // Real turn handler lands in M4 (real LLM). For now the React layer
    // still drives scripted replies via MockBackend; this command is a
    // landing pad so the wire is already there.
    Ok(())
}

#[tauri::command]
pub async fn cmd_cancel_task(task_id: String) -> std::result::Result<(), String> {
    log::info!("lumo: cancel -> {}", task_id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_retry_task(task_id: String) -> std::result::Result<(), String> {
    log::info!("lumo: retry -> {}", task_id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_greet_now() -> std::result::Result<(), String> {
    log::info!("lumo: greet_now");
    Ok(())
}

#[tauri::command]
pub async fn cmd_accept_proposal(proposal_id: String) -> std::result::Result<(), String> {
    log::info!("lumo: accept -> {}", proposal_id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_open_memory_console() -> std::result::Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn cmd_open_activity_panel() -> std::result::Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn cmd_machine_now(app: tauri::AppHandle) -> std::result::Result<(), String> {
    let machine = Machine::new();
    if let Ok(snap) = machine.snapshot() {
        let _ = app.emit("lumo:event", ProviderEvent::Machine { snapshot: snap });
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_set_proactiveness_band(band: String) -> std::result::Result<(), String> {
    log::info!("lumo: proactiveness -> {}", band);
    Ok(())
}

#[tauri::command]
pub async fn cmd_push_proposal(proposal: serde_json::Value) -> std::result::Result<(), String> {
    log::info!("lumo: push_proposal -> {}", proposal);
    Ok(())
}

#[tauri::command]
pub async fn cmd_set_connector_status(id: String, status: String) -> std::result::Result<(), String> {
    log::info!("lumo: connector {} -> {}", id, status);
    Ok(())
}
