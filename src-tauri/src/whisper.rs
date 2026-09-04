//! M8-A: whisper sidecar (subprocess model).
//!
//! The Rust side spawns the user's local whisper-cpp binary as a
//! subprocess. The user wires up the mic capture in the React layer
//! (cmd_whisper_push_audio_chunk); transcripts come back over the
//! lumo:event bus as whisper.partial / whisper.final.
//!
//! Why a subprocess instead of binding to whisper-cpp directly?
//!   - whisper-cpp pulls multi-GB of prebuilt models at compile time.
//!   - The user already has (or wants to install) whisper.cpp once.
//!   - Updates to whisper.cpp don't require rebuilding Lumo.
//!
//! Fallback: if the binary is missing, the sidecar prints a friendly
//! error and the React layer falls back to Web Speech API.

use crate::error::Result;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter as _};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperConfig {
    /// Path to the whisper-cpp binary.
    pub binary: String,
    /// Path to the model file (e.g. ggml-base.en.bin).
    pub model: String,
    /// BCP-47 language tag. empty -> whisper auto-detects.
    pub language: String,
}

impl Default for WhisperConfig {
    fn default() -> Self {
        Self {
            binary: "whisper-cli".into(),
            model: String::new(),
            language: "zh".into(),
        }
    }
}

#[derive(Clone)]
pub struct Whisper {
    pub cfg: Arc<Mutex<WhisperConfig>>,
}

impl Whisper {
    pub fn new(cfg: WhisperConfig) -> Self {
        Self { cfg: Arc::new(Mutex::new(cfg)) }
    }
    pub fn config(&self) -> WhisperConfig {
        self.cfg.lock().clone()
    }
    pub fn update_config(&self, cfg: WhisperConfig) {
        *self.cfg.lock() = cfg;
    }
}

/// Subprocess handle held in Tauri state. The webview pushes audio
/// via cmd_whisper_push_audio_chunk; the OS spawns the reader thread
/// once at start time.
pub struct WhisperSession {
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    pub child: Arc<Mutex<Option<std::process::Child>>>,
}

impl WhisperSession {
    pub fn new() -> Self {
        Self {
            stdin: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for WhisperSession {
    fn default() -> Self { Self::new() }
}

/// Spawn whisper-cpp + start the stdout reader thread.
pub fn start(app: AppHandle, whisper: &Whisper, session: &WhisperSession) -> Result<()> {
    let cfg = whisper.config();
    if cfg.binary.is_empty() || cfg.model.is_empty() {
        return Err(crate::error::LumoError::Invalid(
            "whisper binary / model not configured".into(),
        ));
    }
    let mut cmd = Command::new(&cfg.binary);
    cmd.arg("-m").arg(&cfg.model);
    cmd.arg("--language").arg(&cfg.language);
    cmd.arg("--stream");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        crate::error::LumoError::Internal(format!("whisper spawn: {e}"))
    })?;
    let mut stdout = child.stdout.take().expect("stdout");
    let stdin = child.stdin.take().expect("stdin");
    *session.stdin.lock() = Some(stdin);
    *session.child.lock() = Some(child);

    let app_clone = app.clone();
    thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        let mut chunk = [0u8; 1024];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    buf.push_str(&String::from_utf8_lossy(&chunk[..n]));
                    while let Some(pos) = buf.find('\n') {
                        let line: String = buf.drain(..pos + 1).collect();
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                            let text = parsed
                                .get("text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let final_ = parsed
                                .get("final")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let kind = if final_ { "whisper.final" } else { "whisper.partial" };
                            let _ = app_clone.emit(
                                "lumo:event",
                                serde_json::json!({ "kind": kind, "text": text }),
                            );
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cmd_whisper_push_audio_chunk(
    session: tauri::State<'_, WhisperSession>,
    chunk: Vec<u8>,
) -> std::result::Result<(), String> {
    let mut guard = session.stdin.lock();
    if let Some(ref mut s) = *guard {
        let _ = s.write_all(&chunk);
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_whisper_set_config(
    whisper: tauri::State<'_, Whisper>,
    binary: Option<String>,
    model: Option<String>,
    language: Option<String>,
) -> std::result::Result<WhisperConfig, String> {
    let mut cfg = whisper.config();
    if let Some(v) = binary { cfg.binary = v; }
    if let Some(v) = model { cfg.model = v; }
    if let Some(v) = language { cfg.language = v; }
    whisper.update_config(cfg.clone());
    Ok(cfg)
}

#[tauri::command]
pub async fn cmd_whisper_start(
    app: tauri::AppHandle,
    whisper: tauri::State<'_, Whisper>,
    session: tauri::State<'_, WhisperSession>,
) -> std::result::Result<(), String> {
    start(app, &whisper, &session).map_err(|e| format!("{e}"))
}
