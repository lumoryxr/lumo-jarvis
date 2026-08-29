//! Lumo JARVIS Tauri backend.
//!
//! Responsibilities:
//!   - Tauri command registration (TauriProvider ↔ frontend seam)
//!   - Machine snapshots (sysinfo read on demand + on interval)
//!   - Memory persistence (SQLite-backed in production; we declare the schema)
//!   - IPC bridge for the same ProviderEvent surface the prototype uses
//!
//! See docs/HANDOFF.md (M1) for the full migration plan.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod provider;
mod memory;
mod machine;

use provider::TauriProvider;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(TauriProvider::default())
        .invoke_handler(tauri::generate_handler![
            provider::cmd_start,
            provider::cmd_subscribe,
            provider::cmd_send,
            provider::cmd_cancel_task,
            provider::cmd_retry_task,
            provider::cmd_greet_now,
            provider::cmd_accept_proposal,
            provider::cmd_open_memory_console,
            provider::cmd_open_activity_panel,
            memory::cmd_memory_search,
            memory::cmd_memory_export,
            memory::cmd_memory_clear,
            machine::cmd_machine_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumo JARVIS");
}
