//! Client for a local `hermes-agent` gateway.
//!
//! This lives in the Rust core rather than the webview for two reasons: the
//! gateway binds to 127.0.0.1 with CORS off by default, so a browser context
//! cannot reach it; and the bearer token stays out of any JS-reachable scope.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::types::{Error, Result};

#[derive(Debug, Clone)]
pub struct Config {
    /// e.g. `http://127.0.0.1:8642`
    pub base_url: String,
    /// `API_SERVER_KEY` from the gateway's `.env`.
    pub api_key: String,
    /// Stable identity for Hermes' long-term memory scoping.
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Started,
    Completed,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub fn is_terminal(&self) -> bool {
        !matches!(self, RunStatus::Started)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub run_id: String,
    pub status: RunStatus,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub output: Option<String>,
}

/// One decoded frame from `/v1/runs/{id}/events`.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Delta(String),
    ToolCall { call_id: String, name: String, args: String },
    ToolResult { call_id: String, output: String, ok: bool },
    Status(RunStatus),
}

#[derive(Serialize)]
struct CreateRun<'a> {
    input: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    instructions: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
}

pub struct Client {
    http: reqwest::Client,
    cfg: Config,
}

impl Client {
    pub fn new(cfg: Config) -> Self {
        Self { http: reqwest::Client::new(), cfg }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut req = self
            .http
            .request(method, format!("{}{}", self.cfg.base_url, path))
            .bearer_auth(&self.cfg.api_key);
        if let Some(key) = &self.cfg.session_key {
            req = req.header("X-Hermes-Session-Key", key);
        }
        req
    }

    pub async fn healthy(&self) -> bool {
        self.http
            .get(format!("{}/health", self.cfg.base_url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    /// Dispatch a long-form task. Attach to the event stream promptly — the
    /// gateway discards unconsumed buffers after five minutes.
    pub async fn create_run(
        &self,
        input: &str,
        instructions: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<Run> {
        let res = self
            .request(reqwest::Method::POST, "/v1/runs")
            .json(&CreateRun { input, instructions, session_id })
            .send()
            .await?;

        if !res.status().is_success() {
            let code = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(Error::Hermes(format!("create_run {code}: {body}")));
        }
        Ok(res.json().await?)
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Run> {
        let res = self
            .request(reqwest::Method::GET, &format!("/v1/runs/{run_id}"))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(Error::Hermes(format!("get_run {}", res.status())));
        }
        Ok(res.json().await?)
    }

    pub async fn stop_run(&self, run_id: &str) -> Result<()> {
        self.request(reqwest::Method::POST, &format!("/v1/runs/{run_id}/stop"))
            .send()
            .await?;
        Ok(())
    }

    /// Stream a run's events, invoking `on_event` for each decoded frame.
    /// Returns once the stream closes or a terminal status arrives.
    pub async fn stream_run<F>(&self, run_id: &str, mut on_event: F) -> Result<()>
    where
        F: FnMut(Event),
    {
        let res = self
            .request(reqwest::Method::GET, &format!("/v1/runs/{run_id}/events"))
            .header("Accept", "text/event-stream")
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(Error::Hermes(format!("stream_run {}", res.status())));
        }

        let mut stream = res.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk?));

            // SSE frames are separated by a blank line.
            while let Some(split) = buffer.find("\n\n") {
                let frame: String = buffer.drain(..split + 2).collect();
                if let Some(event) = parse_frame(&frame) {
                    let terminal = matches!(&event, Event::Status(s) if s.is_terminal());
                    on_event(event);
                    if terminal {
                        return Ok(());
                    }
                }
            }
        }
        Ok(())
    }
}

/// Decode one SSE frame. Returns `None` for keepalives and frames we ignore.
fn parse_frame(frame: &str) -> Option<Event> {
    let mut name = "message";
    let mut data = String::new();

    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            name = rest.trim();
        } else if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim());
        }
    }

    if data.is_empty() || data == "[DONE]" {
        return None;
    }

    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    if name == "hermes.tool.progress" || kind == "function_call" {
        return Some(Event::ToolCall {
            call_id: v.get("call_id").and_then(|x| x.as_str()).unwrap_or("call").to_string(),
            name: v.get("name").and_then(|x| x.as_str()).unwrap_or("tool").to_string(),
            args: v.get("arguments").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        });
    }

    if kind == "function_call_output" {
        return Some(Event::ToolResult {
            call_id: v.get("call_id").and_then(|x| x.as_str()).unwrap_or("call").to_string(),
            output: v.get("output").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            ok: v.get("status").and_then(|x| x.as_str()) != Some("failed"),
        });
    }

    if let Some(status) = v.get("status").and_then(|x| x.as_str()) {
        if let Ok(s) = serde_json::from_value::<RunStatus>(serde_json::Value::String(status.into())) {
            return Some(Event::Status(s));
        }
    }

    // OpenAI-shaped token delta.
    let delta = v
        .pointer("/choices/0/delta/content")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("delta").and_then(|x| x.as_str()))?;

    (!delta.is_empty()).then(|| Event::Delta(delta.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_token_delta() {
        let frame = "data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\n";
        assert_eq!(parse_frame(frame), Some(Event::Delta("hel".into())));
    }

    #[test]
    fn decodes_tool_progress() {
        let frame = "event: hermes.tool.progress\ndata: {\"name\":\"terminal\",\"arguments\":\"{\\\"command\\\":\\\"ls\\\"}\",\"call_id\":\"call_1\"}\n\n";
        match parse_frame(frame) {
            Some(Event::ToolCall { name, call_id, .. }) => {
                assert_eq!(name, "terminal");
                assert_eq!(call_id, "call_1");
            }
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn decodes_tool_output() {
        let frame = "data: {\"type\":\"function_call_output\",\"call_id\":\"call_1\",\"output\":\"README.md\"}\n\n";
        assert_eq!(
            parse_frame(frame),
            Some(Event::ToolResult { call_id: "call_1".into(), output: "README.md".into(), ok: true })
        );
    }

    #[test]
    fn decodes_terminal_status() {
        let frame = "data: {\"status\":\"completed\"}\n\n";
        assert_eq!(parse_frame(frame), Some(Event::Status(RunStatus::Completed)));
        assert!(RunStatus::Completed.is_terminal());
        assert!(!RunStatus::Started.is_terminal());
    }

    #[test]
    fn ignores_keepalive_and_done() {
        assert_eq!(parse_frame(": keepalive\n\n"), None);
        assert_eq!(parse_frame("data: [DONE]\n\n"), None);
    }

    #[test]
    fn joins_multiline_data() {
        // Per the SSE spec a payload may be split across several `data:` lines;
        // they concatenate with newlines before the JSON is parsed.
        let frame = "data: {\"delta\":\ndata: \"hi\"}\n\n";
        assert_eq!(parse_frame(frame), Some(Event::Delta("hi".into())));
    }

    #[test]
    fn unparseable_frame_is_skipped_not_fatal() {
        assert_eq!(parse_frame("data: not json\n\n"), None);
        assert_eq!(parse_frame("data: {\"choices\":[]}\n\n"), None);
    }
}
