//! Lumo JARVIS Tauri backend.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod provider;
pub mod memory;
pub mod machine;
pub mod store;
pub mod error;
pub mod watchers;
pub mod hermes;
pub mod llm;
pub mod global_shortcuts;
pub mod clipboard;
pub mod whisper;
pub mod tray;
pub mod screencap;

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;

use crate::provider::TauriProvider;
use crate::store::Store;
use crate::hermes::Hermes;
use crate::llm::Llm;
use crate::whisper::{Whisper, WhisperSession};

pub struct LumoState {
    pub provider: Arc<Mutex<TauriProvider>>,
    pub store: Arc<Store>,
    pub hermes: Arc<Hermes>,
    pub llm: Arc<Llm>,
    pub whisper: Arc<Whisper>,
    pub whisper_session: Arc<WhisperSession>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(crate::global_shortcuts::build_plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            let hermes = Arc::new(Hermes::new(Default::default()));
            let llm = Arc::new(Llm::new(Default::default()));
            let whisper = Arc::new(Whisper::new(Default::default()));
            let whisper_session = Arc::new(WhisperSession::new());

            app.manage(LumoState {
                provider: Arc::new(Mutex::new(provider)),
                store,
                hermes,
                llm,
                whisper,
                whisper_session,
            });

            // M6-D: register the global hotkeys once setup is done.
            crate::global_shortcuts::register_all(app.handle());

            // M6-E: start the clipboard monitor.
            crate::clipboard::start(app.handle().clone());

            // M8-C: close-to-hide. The user can still force-quit via
            // the global Cmd+Shift+Space hotkey (which shows again).
            if let Some(window) = app.get_webview_window("main") {
                crate::tray::intercept_close(&window);
            }

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
            llm::cmd_llm_chat,
            llm::cmd_llm_set_config,
            whisper::cmd_whisper_set_config,
            whisper::cmd_whisper_start,
            whisper::cmd_whisper_push_audio_chunk,
            tray::cmd_hide_to_tray,
            tray::cmd_quit_app,
            screencap::cmd_screenshot_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumo JARVIS");
}
