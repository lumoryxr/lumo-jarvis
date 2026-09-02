//! Memory Tauri commands. Frontend services/memory.ts can keep using
//! localStorage in dev and switch to these commands when running under
//! Tauri (see HANDOFF.md "Step 3 — Frontend seam").


use crate::store::{MemoryRow, Store};

#[tauri::command]
pub async fn cmd_memory_search(
    store: tauri::State<'_, Store>,
    query: String,
    limit: Option<usize>,
) -> std::result::Result<Vec<MemoryRow>, String> {
    store
        .memory_search(&query, limit.unwrap_or(60))
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_memory_export(store: tauri::State<'_, Store>) -> std::result::Result<String, String> {
    store.memory_export().map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_memory_clear(store: tauri::State<'_, Store>) -> std::result::Result<usize, String> {
    store.memory_clear().map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_memory_upsert(
    store: tauri::State<'_, Store>,
    row: MemoryRow,
) -> std::result::Result<(), String> {
    store.memory_upsert(&row).map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_memory_remove(
    store: tauri::State<'_, Store>,
    id: String,
) -> std::result::Result<(), String> {
    store.memory_remove(&id).map_err(Into::into)
}
