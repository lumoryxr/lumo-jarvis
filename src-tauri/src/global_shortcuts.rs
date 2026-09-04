//! M6-D: global hotkeys. Two registered:
//!   CmdOrCtrl+Shift+Space -> toggle window visibility
//!   CmdOrCtrl+Shift+V     -> toggle continuous voice loop
//!                            (forwarded to the webview via a
//!                            lumo:event so the React side can flip
//!                            its voiceLoop state)

use serde_json::json;
use tauri::{AppHandle, Emitter as _, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SHORTCUTS: &[&str] = &[
    "CmdOrCtrl+Shift+Space",
    "CmdOrCtrl+Shift+V",
];

/// Build the plugin. The actual handler is registered in `register_all`
/// after the Tauri state is up, because we need `app.get_webview_window`.
pub fn build_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let key_str = shortcut.into_string();
                match key_str.as_str() {
                    "CmdOrCtrl+Shift+Space" => toggle_window(app),
                    "CmdOrCtrl+Shift+V" => {
                        let _ = app.emit("lumo:event", json!({
                            "kind": "shortcut",
                            "key": "ctrlShift+V",
                        }));
                    }
                    _ => {}
                }
            }
        })
        .build()
}

fn toggle_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return; };
    let visible = w.is_visible().unwrap_or(false);
    if visible {
        let _ = w.hide();
    } else {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Register the hotkeys. Safe to call from `setup` after the AppHandle
/// is in place. Failures are logged but non-fatal — global hotkeys are
/// OS-level and may be refused in some environments (headless, RDP).
pub fn register_all(app: &AppHandle) {
    for sc in SHORTCUTS {
        if let Err(e) = app.global_shortcut().register(*sc) {
            log::warn!("lumo: failed to register shortcut {sc}: {e}");
        } else {
            log::info!("lumo: registered shortcut {sc}");
        }
    }
}
