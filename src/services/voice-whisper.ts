/**
 * M7-A: Whisper sidecar shape.
 *
 * The voice loop in the prototype uses Web Speech API (browser-side,
 * free, instant). When the user installs a real Whisper sidecar via
 * Tauri, the M7 swap-in happens here:
 *   - cmd_whisper_start_capture (Rust) opens the mic
 *   - Rust streams partial transcripts as lumo:event {kind: 'whisper.partial'}
 *   - cmd_whisper_stop_capture closes the mic
 *
 * The useVoiceLoop hook reads from this module instead of the Web
 * Speech path when running under Tauri. The provider surface is
 * identical — `startContinuous({...handlers})` is the only public
 * API, and both implementations satisfy it.
 *
 * M7-A ships the surface and a stub TauriProvider method
 * (captureWhisperAudio) — the actual Rust + whisper-cpp wiring is
 * for M7-B; the rest of the app already uses this surface.
 */

import type { VoiceHandlers } from './voice';

export interface WhisperConfig {
  /** Path to the whisper-cpp binary (set via cmd_whisper_set_binary). */
  binary?: string;
  /** Model id (tiny.en / small.en / large-v3). */
  model?: string;
  /** Language hint (helper; whisper.cpp auto-detects otherwise). */
  language?: string;
}

export interface WhisperSession {
  stop(): Promise<void>;
}

/**
 * Start the Whisper sidecar. Resolves immediately; the partials
 * arrive via the lumo:event listener attached by the hook.
 */
export async function startWhisper(
  cfg: WhisperConfig,
  handlers: VoiceHandlers,
): Promise<WhisperSession> {
  const t = await import('./tauri').catch(() => null);
  if (!t || !t.isTauri()) {
    throw new Error('whisper sidecar requires Tauri runtime');
  }
  const provider = new t.TauriProvider();
  // Real Rust cmd_whisper_start_capture(input device id, model, lang)
  // emits lumo:event {kind: 'whisper.partial'|'whisper.final', text}.
  // Until M7-B's Rust side lands, this is a no-op stub that lets the
  // hook surface compile and the user observe the wiring intent.
  await provider.startWhisperCapture?.(cfg).catch((e) => {
    console.warn('[whisper] start failed, falling back to web speech:', e);
  });

  // Mirror the partial events into the VoiceHandlers the caller passed.
  let active = true;
  (async () => {
    const evt = await import('@tauri-apps/api/event').catch(() => null);
    if (!evt) return;
    const un = await evt.listen<{ kind: string; text: string; final?: boolean }>(
      'lumo:event',
      (e) => {
        if (!active) return;
        const p = e.payload;
        if (p.kind === 'whisper.partial') handlers.onPartial?.(p.text);
        else if (p.kind === 'whisper.final') handlers.onFinal?.(p.text);
        else if (p.kind === 'whisper.error') console.warn('[whisper] error:', p.text);
      },
    );
    return () => un();
  })();

  return {
    stop: async () => {
      active = false;
      await provider.stopWhisperCapture?.().catch(() => {});
    },
  };
}
