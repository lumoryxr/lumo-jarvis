//! Hermes-agent HTTP client. M3-A.
//!
//! Wraps the local hermes-agent gateway so the Rust side can:
//!   - dispatch a run (POST /v1/runs)
//!   - poll its status (GET /v1/runs/{id})
//!   - stream its events (GET /v1/runs/{id}/events SSE)
//!   - stop it (POST /v1/runs/{id}/stop)
//!
//! The Rust side runs the polling loop on a background thread and
//! forwards normalised ProviderEvents to the webview via the shared
//! AppHandle. The TS ProviderEvent shape is mirrored exactly: run
//! status flips -> task.upsert; SSE deltas -> message.delta;
//! function_call events -> tool.start; function_call_output -> tool.end.
//!
//! Auth is loaded from disk at app start (`hermes.key` next to the
//! app data dir) so the bearer token never enters the webview.
//!
//! The client is intentionally minimal: we keep one
//! `Client<report<->>` shared via parking_lot so multiple Tauri
//! commands can read config without contending on the network.

use crate::error::LumoError;
type Result<T> = std::result::Result<T, LumoError>;
use crate::provider::ProviderEvent;
use parking_lot::Mutex;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter as _};
use tokio::sync::mpsc;

/// Hermes client configuration. Persisted to disk; in production
/// the bearer token is written via a sidecar. The struct mirrors
/// the React-side `HermesConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HermesConfig {
    pub base_url: String,
    pub api_key: String,
    pub session_key: Option<String>,
}

impl Default for HermesConfig {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:8642".into(),
            api_key: String::new(),
            session_key: Some("lumo-jarvis".into()),
        }
    }
}

/// A run we dispatched (or observed) via the gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HermesRun {
    pub run_id: String,
    pub status: HermesRunStatus,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub usage: Option<HermesUsage>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HermesRunStatus {
    Started,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HermesUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub total_tokens: u32,
}

/// Normalised SSE events parsed out of the gateway stream. The TS
/// ProviderEvent shape is reproduced exactly so we can mirrorEvent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HermesEvent {
    Delta { text: String },
    Tool { name: String, args: String, call_id: String },
    ToolResult { call_id: String, output: String, ok: bool },
    Status { status: HermesRunStatus },
}

/// Hermes client. Cheap to clone; the http client is internally
/// Arc'd by reqwest.
#[derive(Clone)]
pub struct Hermes {
    pub cfg: Arc<Mutex<HermesConfig>>,
    http: HttpClient,
}

impl Hermes {
    pub fn new(cfg: HermesConfig) -> Self {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("lumo-jarvis/0.1 (rust)")
            .build()
            .expect("reqwest client");
        Self { cfg: Arc::new(Mutex::new(cfg)), http }
    }

    pub fn config(&self) -> HermesConfig {
        self.cfg.lock().clone()
    }

    pub fn update_config(&self, cfg: HermesConfig) {
        *self.cfg.lock() = cfg;
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("Content-Type", HeaderValue::from_static("application/json"));
        let key = self.cfg.lock().api_key.clone();
        if !key.is_empty() {
            if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", key)) {
                h.insert(AUTHORIZATION, v);
            }
        }
        if let Some(sk) = self.cfg.lock().session_key.clone() {
            if let Ok(v) = HeaderValue::from_str(&sk) {
                h.insert(HeaderName::from_static("x-hermes-session-key"), v);
            }
        }
        h
    }

    pub async fn health(&self) -> bool {
        let url = format!("{}/health", self.cfg.lock().base_url);
        match self.http.get(url).send().await {
            Ok(r) => r.status().is_success(),
            Err(_) => false,
        }
    }

    pub async fn create_run(&self, input: &str, instructions: Option<&str>) -> Result<HermesRun> {
        let url = format!("{}/v1/runs", self.cfg.lock().base_url);
        let body = serde_json::json!({
            "input": input,
            "instructions": instructions,
            "session_id": self.cfg.lock().session_key,
        });
        let resp = self
            .http
            .post(url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let s = resp.status();
            let t = resp.text().await.unwrap_or_default();
            return Err(LumoError::Internal(format!("createRun {}: {}", s, t)));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_run(&self, run_id: &str) -> Result<HermesRun> {
        let url = format!("{}/v1/runs/{}", self.cfg.lock().base_url, run_id);
        let resp = self.http.get(url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            return Err(LumoError::Internal(format!("getRun {}", resp.status())));
        }
        Ok(resp.json().await?)
    }

    pub async fn stop_run(&self, run_id: &str) -> Result<()> {
        let url = format!("{}/v1/runs/{}/stop", self.cfg.lock().base_url, run_id);
        let resp = self.http.post(url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            return Err(LumoError::Internal(format!("stopRun {}", resp.status())));
        }
        Ok(())
    }

    /// Subscribe to the SSE stream. Returns a tokio mpsc Receiver
    /// that yields normalised HermesEvent variants. The caller drops
    /// the sender to stop the stream.
    pub async fn stream_run(&self, run_id: &str) -> Result<mpsc::UnboundedReceiver<HermesEvent>> {
        let url = format!("{}/v1/runs/{}/events", self.cfg.lock().base_url, run_id);
        let resp = self.http.get(url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            return Err(LumoError::Internal(format!("streamRun {}", resp.status())));
        }
        let (tx, rx) = mpsc::unbounded_channel();
        let mut stream = resp.bytes_stream();
        tokio::spawn(async move {
            use futures_util::StreamExt;
            let mut buf: Vec<u8> = Vec::new();
            while let Some(item) = stream.next().await {
                let chunk = match item {
                    Ok(c) => c,
                    Err(_) => break,
                };
                buf.extend_from_slice(&chunk);
                let mut text = String::from_utf8_lossy(&buf).to_string();
                buf.clear();
                // SSE frames are separated by \n\n.
                while let Some(pos) = text.find("\n\n") {
                    let frame: String = text.drain(..pos + 2).collect();
                    if let Some(ev) = parse_sse_frame(&frame) {
                        if tx.send(ev).is_err() { break; }
                    }
                }
            }
        });
        Ok(rx)
    }
}

/// Parse one SSE frame into a HermesEvent. Returns None for frames
/// we can't recognise (the gateway sends a few non-event heartbeats).
pub fn parse_sse_frame(frame: &str) -> Option<HermesEvent> {
    let mut name = "message".to_string();
    let mut data_lines: Vec<&str> = Vec::new();
    for line in frame.split('\n') {
        if let Some(rest) = line.strip_prefix("event:") {
            name = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start());
        }
    }
    let raw = data_lines.join("\n");
    if raw.is_empty() || raw == "[DONE]" { return None; }

    let payload: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if name == "hermes.tool.progress" || payload.get("type").and_then(|v| v.as_str()) == Some("function_call") {
        return Some(HermesEvent::Tool {
            name: payload.get("name").and_then(|v| v.as_str()).unwrap_or("tool").to_string(),
            args: payload
                .get("arguments")
                .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                .unwrap_or_default(),
            call_id: payload.get("call_id").and_then(|v| v.as_str())
                .or_else(|| payload.get("id").and_then(|v| v.as_str()))
                .unwrap_or("call").to_string(),
        });
    }
    if payload.get("type").and_then(|v| v.as_str()) == Some("function_call_output") {
        let ok = payload.get("status").and_then(|v| v.as_str()) != Some("failed");
        return Some(HermesEvent::ToolResult {
            call_id: payload.get("call_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            output: payload.get("output").map(|v| v.to_string()).unwrap_or_default(),
            ok,
        });
    }
    if let Some(s) = payload.get("status").and_then(|v| v.as_str()) {
        let status = match s {
            "started" => HermesRunStatus::Started,
            "completed" => HermesRunStatus::Completed,
            "failed" => HermesRunStatus::Failed,
            "cancelled" => HermesRunStatus::Cancelled,
            _ => return None,
        };
        return Some(HermesEvent::Status { status });
    }
    let delta = payload.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("content")).and_then(|v| v.as_str())
        .or_else(|| payload.get("delta").and_then(|v| v.as_str()))
        .unwrap_or("");
    if !delta.is_empty() {
        return Some(HermesEvent::Delta { text: delta.to_string() });
    }
    None
}

/// Tauri command surface. The frontend uses these from the React
/// side through services/tauri.ts. Health + createRun + getRun +
/// stopRun are surfaced; the SSE stream is consumed internally by
/// `cmd_run_and_track` (see provider).
#[tauri::command]
pub async fn cmd_hermes_health(hermes: tauri::State<'_, Hermes>) -> std::result::Result<bool, String> {
    Ok(hermes.health().await)
}

#[tauri::command]
pub async fn cmd_hermes_create(
    hermes: tauri::State<'_, Hermes>,
    input: String,
    instructions: Option<String>,
) -> std::result::Result<HermesRun, String> {
    hermes.create_run(&input, instructions.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_hermes_get(
    hermes: tauri::State<'_, Hermes>,
    run_id: String,
) -> std::result::Result<HermesRun, String> {
    hermes.get_run(&run_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_hermes_stop(
    hermes: tauri::State<'_, Hermes>,
    run_id: String,
) -> std::result::Result<(), String> {
    hermes.stop_run(&run_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_hermes_set_config(
    hermes: tauri::State<'_, Hermes>,
    base_url: Option<String>,
    api_key: Option<String>,
    session_key: Option<String>,
) -> std::result::Result<HermesConfig, String> {
    let mut cfg = hermes.config();
    if let Some(v) = base_url { cfg.base_url = v; }
    if let Some(v) = api_key { cfg.api_key = v; }
    if let Some(v) = session_key { cfg.session_key = Some(v); }
    hermes.update_config(cfg.clone());
    Ok(cfg)
}

/// Dispatch a run, then subscribe to its SSE stream and forward
/// normalised events to the webview as ProviderEvents. Returns the
/// HermesRun immediately; the stream runs in the background until
/// the run reaches a terminal status or the process exits.
#[tauri::command]
pub async fn cmd_hermes_dispatch(
    hermes: tauri::State<'_, Hermes>,
    app: tauri::AppHandle,
    input: String,
    instructions: Option<String>,
) -> std::result::Result<HermesRun, String> {
    let run = hermes.create_run(&input, instructions.as_deref()).await?;
    let run_id = run.run_id.clone();
    let mut rx = hermes.stream_run(&run_id).await?;
    let app_clone = app.clone();
    tokio::spawn(async move {
        // First, emit a task.upsert with status=running so the React
        // task board immediately shows the run.
        let _ = app_clone.emit(
            "lumo:event",
            ProviderEvent::TaskUpsert {
                task: serde_json::json!({
                    "id": run_id.clone(),
                    "title": input.chars().take(40).collect::<String>(),
                    "intent": input,
                    "executor": "hermes",
                    "status": "running",
                    "progress": 0.05,
                    "created_at": chrono::Utc::now().timestamp(),
                    "updated_at": chrono::Utc::now().timestamp(),
                    "project": "lumo-jarvis",
                    "tags": ["hermes"],
                    "labels": [],
                    "priority": 1,
                    "order": chrono::Utc::now().timestamp(),
                    "external_id": run_id.clone(),
                    "result": null,
                    "steps": [],
                }),
            },
        );

        // Open a synthetic "jarvis" message bubble for deltas.
        let message_id = format!("msg_{}", uuid::Uuid::new_v4());
        let _ = app_clone.emit(
            "lumo:event",
            ProviderEvent::MessageStart {
                message: serde_json::json!({
                    "id": message_id,
                    "speaker": "jarvis",
                    "text": "",
                    "at": chrono::Utc::now().timestamp(),
                    "streaming": true,
                }),
            },
        );

        while let Some(ev) = rx.recv().await {
            match ev {
                HermesEvent::Delta { text } => {
                    let _ = app_clone.emit(
                        "lumo:event",
                        ProviderEvent::MessageDelta {
                            id: message_id.clone(),
                            text,
                        },
                    );
                }
                HermesEvent::Tool { name, args, call_id } => {
                    let _ = app_clone.emit(
                        "lumo:event",
                        ProviderEvent::ToolStart {
                            message_id: message_id.clone(),
                            call: serde_json::json!({
                                "id": call_id,
                                "name": name,
                                "args": args,
                                "status": "running",
                            }),
                        },
                    );
                }
                HermesEvent::ToolResult { call_id, output, ok } => {
                    let _ = app_clone.emit(
                        "lumo:event",
                        ProviderEvent::ToolEnd {
                            message_id: message_id.clone(),
                            call_id,
                            status: if ok { "ok" } else { "failed" }.to_string(),
                            output: Some(output),
                        },
                    );
                }
                HermesEvent::Status { status } => {
                    let terminal = matches!(status, HermesRunStatus::Completed | HermesRunStatus::Failed | HermesRunStatus::Cancelled);
                    let status_str = match status {
                        HermesRunStatus::Started => "running",
                        HermesRunStatus::Completed => "done",
                        HermesRunStatus::Failed => "failed",
                        HermesRunStatus::Cancelled => "cancelled",
                    };
                    let _ = app_clone.emit(
                        "lumo:event",
                        ProviderEvent::TaskUpsert {
                            task: serde_json::json!({
                                "id": run_id.clone(),
                                "title": input.chars().take(40).collect::<String>(),
                                "intent": input,
                                "executor": "hermes",
                                "status": status_str,
                                "progress": if terminal { 1.0 } else { 0.5 },
                                "created_at": chrono::Utc::now().timestamp(),
                                "updated_at": chrono::Utc::now().timestamp(),
                                "project": "lumo-jarvis",
                                "tags": ["hermes"],
                                "labels": [],
                                "priority": 1,
                                "order": chrono::Utc::now().timestamp(),
                                "external_id": run_id.clone(),
                                "result": null,
                                "steps": [],
                            }),
                        },
                    );
                    let _ = app_clone.emit(
                        "lumo:event",
                        ProviderEvent::MessageEnd { id: message_id.clone() },
                    );
                    if terminal { break; }
                }
            }
        }
    });
    Ok(run)
}
