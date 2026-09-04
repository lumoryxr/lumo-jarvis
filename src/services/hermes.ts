/**
 * Client for a local `hermes-agent` gateway (NousResearch).
 *
 * Surface used here, all documented by the gateway's API-server feature:
 *   POST /v1/runs                 -> { run_id, status }
 *   GET  /v1/runs/{id}/events     -> SSE progress / deltas / tool calls
 *   GET  /v1/runs/{id}            -> terminal status + output
 *   POST /v1/runs/{id}/stop       -> interrupt
 *   GET  /health                  -> liveness
 *
 * The Runs API is what we want for JARVIS: a long-form coding task is dispatched
 * once, streams progress into the task board, and survives the UI navigating
 * away. `/v1/chat/completions` is the wrong shape here — it has no handle to
 * cancel or reattach to.
 *
 * Auth is a bearer token (`API_SERVER_KEY`). Because the gateway binds to
 * 127.0.0.1 and disables CORS by default, the browser prototype cannot reach it
 * directly; in the packaged app these requests are proxied through the Rust
 * core (see `src-tauri/src/hermes.rs`), which also keeps the key out of the
 * webview.
 */

export interface HermesConfig {
  baseUrl: string;
  /** Bearer token sent as Authorization header. */
  apiKey: string;
  /** Stable identity for long-term memory scoping. */
  sessionKey?: string;
}

export interface HermesRun {
  run_id: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  session_id?: string;
  output?: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
}

/** Normalised event drawn out of the gateway's SSE stream. */
export type HermesEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; args: string; callId: string }
  | { type: 'tool_result'; callId: string; output: string; ok: boolean }
  | { type: 'status'; status: HermesRun['status'] };

export class HermesClient {
  private cfg: HermesConfig;

  constructor(cfg: HermesConfig) {
    this.cfg = cfg;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.cfg.apiKey}`,
    };
    if (this.cfg.sessionKey) h['X-Hermes-Session-Key'] = this.cfg.sessionKey;
    return h;
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.cfg.baseUrl}/health`);
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Dispatch a task. `instructions` becomes the run's system prompt. */
  async createRun(input: string, opts: { instructions?: string; sessionId?: string } = {}): Promise<HermesRun> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/runs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        input,
        instructions: opts.instructions,
        session_id: opts.sessionId,
      }),
    });
    if (!res.ok) throw new Error(`hermes: createRun ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getRun(runId: string): Promise<HermesRun> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/runs/${runId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`hermes: getRun ${res.status}`);
    return res.json();
  }

  async stopRun(runId: string): Promise<void> {
    await fetch(`${this.cfg.baseUrl}/v1/runs/${runId}/stop`, {
      method: 'POST',
      headers: this.headers(),
    });
  }

  /**
   * Consume `/v1/runs/{id}/events`. Yields until the run reaches a terminal
   * status or `signal` aborts. Note the gateway drops unconsumed buffers after
   * five minutes, so attach promptly after `createRun`.
   */
  async *streamRun(runId: string, signal?: AbortSignal): AsyncGenerator<HermesEvent> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/runs/${runId}/events`, {
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`hermes: streamRun ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = parseFrame(frame);
        if (event) yield event;
      }
    }
  }
}

function parseFrame(frame: string): HermesEvent | null {
  let name = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const raw = dataLines.join('\n');
  if (!raw || raw === '[DONE]') return null;

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (name === 'hermes.tool.progress' || payload?.type === 'function_call') {
    return {
      type: 'tool',
      name: payload.name ?? 'tool',
      args: payload.arguments ?? '',
      callId: payload.call_id ?? payload.id ?? 'call',
    };
  }
  if (payload?.type === 'function_call_output') {
    return {
      type: 'tool_result',
      callId: payload.call_id,
      output: String(payload.output ?? ''),
      ok: payload.status !== 'failed',
    };
  }
  if (payload?.status && ['started', 'completed', 'failed', 'cancelled'].includes(payload.status)) {
    return { type: 'status', status: payload.status };
  }
  const delta = payload?.choices?.[0]?.delta?.content ?? payload?.delta ?? '';
  if (delta) return { type: 'delta', text: String(delta) };
  return null;
}
