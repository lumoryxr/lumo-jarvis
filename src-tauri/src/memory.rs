//! SQLite-backed memory persistence.
//!
//! In M1 the localStorage version in src/services/memory.ts will be replaced
//! by these commands. The schema mirrors Memory so no migration work is
//! needed at the React layer beyond swapping the call sites.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryRow {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub confidence: f32,
    pub ts: i64,
    pub source: String,
}

#[tauri::command]
pub async fn cmd_memory_search(_query: String) -> Result<Vec<MemoryRow>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn cmd_memory_export() -> Result<String, String> {
    Ok("[]".to_string())
}

#[tauri::command]
pub async fn cmd_memory_clear() -> Result<(), String> { Ok(()) }
