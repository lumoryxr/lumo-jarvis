//! M6-E: clipboard monitor.
//!
//! Polls the OS clipboard every few seconds and detects task-like
//! content (URL, file path, error message, long TODO-style line).
//! When a new task-shaped string appears, emits a ProviderEvent
//! shaped like a proposal so the React side shows it in HER
//! THOUGHTS alongside the watcher proposals.
//!
//! The polling thread starts in setup() alongside the machine tick.

use crate::provider::ProviderEvent;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter as _};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardTask {
    pub text: String,
    pub kind: ClipboardKind,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardKind {
    Url,
    FilePath,
    Error,
    Todo,
}

/// Heuristics. Compiled once.
fn looks_like_url(s: &str) -> bool {
    url::Url::parse(s.trim()).is_ok()
}

fn looks_like_path(s: &str) -> bool {
    let t = s.trim();
    (t.starts_with('/') || t.starts_with("~/") || t.contains(":\\") || t.starts_with("./"))
        && t.len() > 3
        && !t.contains(' ')
}

fn looks_like_error(s: &str) -> bool {
    let lower = s.to_lowercase();
    lower.contains("error") || lower.contains("failed") || lower.contains("panic")
        || lower.contains("traceback") || s.contains("Traceback (most recent call last)")
}

fn looks_like_todo(s: &str) -> bool {
    static RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| {
        Regex::new(r"(?i)\b(TODO|FIXME|XXX|HACK|TBD)\b[:\s]").unwrap()
    });
    RE.is_match(s)
}

/// Classify a clipboard string into a ClipboardKind + confidence.
fn classify(text: &str) -> Option<ClipboardTask> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() < 5 || trimmed.len() > 1024 {
        return None;
    }
    if let Ok(u) = url::Url::parse(trimmed) {
        if !u.scheme().is_empty() {
            return Some(ClipboardTask {
                text: trimmed.into(),
                kind: ClipboardKind::Url,
                confidence: 0.7,
            });
        }
    }
    if looks_like_path(trimmed) {
        return Some(ClipboardTask {
            text: trimmed.into(),
            kind: ClipboardKind::FilePath,
            confidence: 0.55,
        });
    }
    if looks_like_error(trimmed) {
        return Some(ClipboardTask {
            text: trimmed.into(),
            kind: ClipboardKind::Error,
            confidence: 0.65,
        });
    }
    if looks_like_todo(trimmed) {
        return Some(ClipboardTask {
            text: trimmed.into(),
            kind: ClipboardKind::Todo,
            confidence: 0.6,
        });
    }
    None
}

pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("lumo-clipboard".into())
        .spawn(move || {
            let mut clipboard = match arboard::Clipboard::new() {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("lumo: clipboard unavailable: {e}");
                        return;
                    }
                };
                let mut last = String::new();
                let mut last_emitted: Option<Instant> = None;
                loop {
                    std::thread::sleep(Duration::from_secs(3));
                    let txt = match clipboard.get_text() {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    if txt == last {
                        continue;
                    }
                    last = txt.clone();
                    // Throttle: at most one proposal every 60s.
                    if let Some(t) = last_emitted {
                        if t.elapsed() < Duration::from_secs(60) {
                            continue;
                        }
                    }
                    if let Some(task) = classify(&txt) {
                        let now = chrono::Utc::now().timestamp();
                        let title = match &task.kind {
                            ClipboardKind::Url => format!("🔗 复制了一个链接：{}", truncate(&task.text, 60)),
                            ClipboardKind::FilePath => format!("📁 复制了一个路径：{}", truncate(&task.text, 60)),
                            ClipboardKind::Error => format!("⚠️ 复制了一段报错：{}", truncate(&task.text, 60)),
                            ClipboardKind::Todo => format!("📝 复制了一条 TODO：{}", truncate(&task.text, 60)),
                        };
                        let reasoning = match &task.kind {
                            ClipboardKind::Url => "看起来像一个 URL。要不要我打开看看，或者给 Hermes 跑一下？",
                            ClipboardKind::FilePath => "这个路径看起来像本机文件。要不要读一下/整理一下？",
                            ClipboardKind::Error => "像是报错。要不要我去查查？",
                            ClipboardKind::Todo => "TODO 文本。要不要我把它变成一个任务？",
                        };
                        let proposal = serde_json::json!({
                            "id": uuid::Uuid::new_v4().to_string(),
                            "trigger": "clipboard",
                            "reasoning": reasoning,
                            "confidence": task.confidence,
                            "expires_at": now + 3600,
                            "tone": "curious",
                            "due_at": null,
                            "created_at": now,
                            "title": title,
                            "evidence": task.text,
                        });
                        // _ = app.emit("lumo:event", ProviderEvent::ProposalPushed { proposal });
                        let _ = app.emit("lumo:event", serde_json::json!({
                            "kind": "clipboard.proposal",
                            "proposal": proposal,
                        }));
                        last_emitted = Some(Instant::now());
                    }
                }
            })
            .expect("spawn clipboard thread");
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        let cut: String = s.chars().take(n).collect();
        format!("{cut}…")
    } else {
        s.into()
    }
}

// keep Arc import for future extension without unused warnings
#[allow(dead_code)]
fn _keep_arc(x: Arc<()>) -> Arc<()> { x }
