//! Tauri-backed Provider that the React frontend talks to.
//!
//! In M1 this will:
//!   - read machine stats via sysinfo on demand
//!   - persist memory to a SQLite table
//!   - shell out to Hermes via reqwest (or via local sidecar)
//!
//! For the prototype skeleton we only declare the command surface; the impl
//! returns "not implemented in prototype" stubs. The frontend keeps running
//! off MockBackend in dev.

use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct TauriProvider;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderEvent {
    pub kind: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub async fn cmd_start() -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn cmd_subscribe(window: tauri::Window) -> Result<(), String> {
    // In M1: window.emit("lumo://event", ProviderEvent { ... })
    let _ = window;
    Ok(())
}

#[tauri::command]
pub async fn cmd_send(text: String) -> Result<(), String> {
    log::info!("lumo: send -> {}", text);
    Ok(())
}

#[tauri::command]
pub async fn cmd_cancel_task(task_id: String) -> Result<(), String> {
    log::info!("lumo: cancel -> {}", task_id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_retry_task(task_id: String) -> Result<(), String> {
    log::info!("lumo: retry -> {}", task_id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_greet_now() -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn cmd_accept_proposal(proposal_id: String) -> Result<(), String> {
    log::info!("lumo: accept -> {}", proposal_id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_open_memory_console() -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn cmd_open_activity_panel() -> Result<(), String> { Ok(()) }
