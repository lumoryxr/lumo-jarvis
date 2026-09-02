//! Lumo JARVIS Tauri backend.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod provider;
pub mod memory;
pub mod machine;
pub mod store;
pub mod error;
pub mod watchers;
pub mod hermes;

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;

use crate::provider::TauriProvider;
use crate::store::Store;
use crate::hermes::Hermes;

pub struct LumoState {
    pub provider: Arc<Mutex<TauriProvider>>,
    pub store: Arc<Store>,
    pub hermes: Arc<Hermes>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .expect("no app_data_dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("lumo.sqlite");
            let store = Arc::new(Store::open(&db_path)?);

            let mut provider = TauriProvider::new(
                store.clone(),
                app.handle().clone(),
            );
            provider.start();

            // M3-A: Hermes HTTP client. Persisted config lives next
            // to the SQLite file; for the prototype we just boot with
            // a default config and let the React side push real values
            // via cmd_hermes_set_config.
            let hermes = Arc::new(Hermes::new(Default::default()));

            app.manage(LumoState {
                provider: Arc::new(Mutex::new(provider)),
                store,
                hermes,
            });

            Ok(())
        })
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
            provider::cmd_machine_now,
            provider::cmd_set_proactiveness_band,
            provider::cmd_push_proposal,
            provider::cmd_set_connector_status,
            memory::cmd_memory_search,
            memory::cmd_memory_export,
            memory::cmd_memory_clear,
            memory::cmd_memory_upsert,
            memory::cmd_memory_remove,
            machine::cmd_machine_snapshot,
            hermes::cmd_hermes_health,
            hermes::cmd_hermes_create,
            hermes::cmd_hermes_get,
            hermes::cmd_hermes_stop,
            hermes::cmd_hermes_set_config,
            hermes::cmd_hermes_dispatch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumo JARVIS");
}
