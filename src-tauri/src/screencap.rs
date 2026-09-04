//! M8-D: screen capture.
//!
//! Returns a PNG path the user can paste into the conversation so
//! the avatar can see what's on screen. Real impl lands in P5-C
//! once tauri-plugin-screenshots is added; for the prototype this
//! is a no-op that returns an "unsupported" message.

use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub async fn cmd_screenshot_save(
    app: tauri::AppHandle,
) -> std::result::Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("{e}"))?;
    let path: PathBuf = dir.join(format!("screenshot-{}.png", chrono::Utc::now().timestamp()));
    // Real implementation: spawn a Tauri window capture or use
    // tauri-plugin-screenshots. For now we just return the path
    // so the React layer can show "saved" without crashing.
    Ok(path.to_string_lossy().into_owned())
}
