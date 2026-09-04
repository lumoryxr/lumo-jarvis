/**
 * Browser-side LLM turn handler. When running in plain webview
 * (no Tauri), this lets the user test a real OpenAI-compatible
 * endpoint without going through Rust. Same ProviderEvent surface
 * as the Rust side, so the avatar loop picks it up identically.
 *
 * Note: CORS prevents this from working against most providers in a
 * plain browser. With Tauri the Rust side handles the request and
 * forwards deltas. This module is the "what the React side would
 * do if CORS weren't a thing" fallback.
 */


export interface LlmDirectConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  system?: string;
}

export async function streamChatLlm(
  cfg: LlmDirectConfig,
  input: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const messages = [];
  if (cfg.system) messages.push({ role: 'system', content: cfg.system });
  messages.push({ role: 'user', content: input });

  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ model: cfg.model, stream: true, messages }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`llm-direct: ${resp.status} ${await resp.text()}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let pos: number;
    while ((pos = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 2);
      for (const line of frame.split('\n')) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        try {
          const payload = JSON.parse(data);
          const text = payload?.choices?.[0]?.delta?.content ?? '';
          if (text) onDelta(text);
        } catch {
          /* skip non-JSON frames */
        }
      }
    }
  }
  return cfg.model;
}
