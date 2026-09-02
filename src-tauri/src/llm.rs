//! M4: real LLM turn handler. Hits an OpenAI-compatible
//! /chat/completions endpoint and streams Server-Sent Events back
//! as Hermes-style Delta events. The Rust side forwards them to the
//! webview as ProviderEvent::MessageDelta so the existing avatar
//! loop picks them up unchanged.
//!
//! Config is loaded from disk next to the SQLite store. The key never
//! enters the webview state tree; it stays in parking_lot memory.

use crate::error::LumoError;
type Result<T> = std::result::Result<T, LumoError>;
use crate::hermes::{HermesEvent, parse_sse_frame};
use crate::provider::ProviderEvent;
use parking_lot::Mutex;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter as _};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    /// Full URL of the chat-completions endpoint.
    pub endpoint: String,
    /// Bearer token. Empty => LLM is disabled (MockBackend keeps doing its thing).
    pub api_key: String,
    /// Model id sent as the "model" field. Optional.
    pub model: String,
    /// System prompt. Optional.
    pub system: Option<String>,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://api.openai.com/v1/chat/completions".into(),
            api_key: String::new(),
            model: "gpt-4o-mini".into(),
            system: Some(
                "你是 Lumina,一个桌面伴侣助手。说话简洁,有温度,偶尔俏皮。\
                 默认回复用简体中文,用户切换语言时跟随。"
                    .into(),
            ),
        }
    }
}

#[derive(Clone)]
pub struct Llm {
    pub cfg: Arc<Mutex<LlmConfig>>,
    http: HttpClient,
}

impl Llm {
    pub fn new(cfg: LlmConfig) -> Self {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(60))
            .user_agent("lumo-jarvis/0.1 (rust)")
            .build()
            .expect("reqwest client");
        Self { cfg: Arc::new(Mutex::new(cfg)), http }
    }

    pub fn config(&self) -> LlmConfig {
        self.cfg.lock().clone()
    }

    pub fn update_config(&self, cfg: LlmConfig) {
        *self.cfg.lock() = cfg;
    }

    pub fn is_configured(&self) -> bool {
        !self.cfg.lock().api_key.is_empty()
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
        h.insert(
            HeaderName::from_static("accept"),
            HeaderValue::from_static("text/event-stream"),
        );
        h
    }
}

/// Chat-completions request body (OpenAI-compatible).
#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

/// Tauri command: send `input` to the LLM, stream the SSE reply as
/// ProviderEvent::MessageDelta until the response ends, then emit
/// ProviderEvent::MessageEnd. Returns the message id used so the
/// caller can correlate.
#[tauri::command]
pub async fn cmd_llm_chat(
    llm: tauri::State<'_, Llm>,
    app: tauri::AppHandle,
    input: String,
) -> std::result::Result<String, String> {
    if !llm.is_configured() {
        return Err(std::result::Result::<(), String>::Err(
            "LLM not configured".into(),
        ).unwrap_err());
    }
    let cfg = llm.config();
    let message_id = format!("msg_{}", uuid::Uuid::new_v4());

    let _ = app.emit(
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

    let mut messages = Vec::new();
    if let Some(sys) = cfg.system.as_deref() {
        messages.push(ChatMessage { role: "system", content: sys });
    }
    messages.push(ChatMessage { role: "user", content: &input });

    let body = ChatRequest {
        model: &cfg.model,
        messages,
        stream: true,
    };

    let resp = match llm
        .http
        .post(&cfg.endpoint)
        .headers(llm.headers())
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(
                "lumo:event",
                ProviderEvent::MessageEnd { id: message_id.clone() },
            );
            return Err(format!("llm: {}", e));
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        let _ = app.emit(
            "lumo:event",
            ProviderEvent::MessageEnd { id: message_id.clone() },
        );
        return Err(format!("llm: {} {}", status, txt));
    }

    let mut stream = resp.bytes_stream();
    let app_clone = app.clone();
    let mid = message_id.clone();
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
            while let Some(pos) = text.find("\n\n") {
                let frame: String = text.drain(..pos + 2).collect();
                if let Some(ev) = parse_sse_frame(&frame) {
                    if let HermesEvent::Delta { text } = ev {
                        let _ = app_clone.emit(
                            "lumo:event",
                            ProviderEvent::MessageDelta {
                                id: mid.clone(),
                                text,
                            },
                        );
                    }
                }
            }
        }
        let _ = app_clone.emit(
            "lumo:event",
            ProviderEvent::MessageEnd { id: mid },
        );
    });

    Ok(message_id)
}

#[tauri::command]
pub async fn cmd_llm_set_config(
    llm: tauri::State<'_, Llm>,
    endpoint: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    system: Option<String>,
) -> std::result::Result<LlmConfig, String> {
    let mut cfg = llm.config();
    if let Some(v) = endpoint { cfg.endpoint = v; }
    if let Some(v) = api_key { cfg.api_key = v; }
    if let Some(v) = model { cfg.model = v; }
    if let Some(v) = system { cfg.system = Some(v); }
    llm.update_config(cfg.clone());
    Ok(cfg)
}

// keep LumoError reachable for the From conversion above (no-op but
// lets `use crate::error::*` stay without an unused-import warning).
#[allow(dead_code)]
fn _keep_lumoerror(e: LumoError) -> String { e.to_string() }
