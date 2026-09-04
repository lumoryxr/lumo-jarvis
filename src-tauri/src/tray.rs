//! M8-C: hide-to-tray command.
//!
//! On macOS / Windows the user can close the window without quitting
//! the app; the process stays alive in the background. A future
//! tray icon (P5-A) will surface a "show window" affordance.

use crate::error::LumoError;
type Result<T> = std::result::Result<T, LumoError>;
use tauri::Manager;

#[tauri::command]
pub async fn cmd_hide_to_tray(window: tauri::Window) -> std::result::Result<(), String> {
    let _ = window.hide();
    Ok(())
}

#[tauri::command]
pub async fn cmd_quit_app(app: tauri::AppHandle) -> std::result::Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Intercept window close events: hide instead of quit when the
/// app is configured to background-mode. Wired from lib.rs setup().
pub fn intercept_close(window: &tauri::WebviewWindow) {
    let w = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let _ = w.hide();
            api.prevent_close();
        }
    });
}
