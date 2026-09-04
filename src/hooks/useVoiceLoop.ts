/**
 * useVoiceLoop — full-duplex voice loop hook.
 *
 * M3-E/F: wraps voice.startContinuous + session.send with barge-in.
 * When the user is talking while the avatar is speaking, we cancel
 * the current utterance, flip agentState back to thinking, and feed
 * the partial transcript straight into the session pipeline.
 */

import { useEffect, useRef } from 'react';
import { voice } from '../services/voice';
import { useSession } from '../state/session';

export function useVoiceLoop(opts: { lang?: string; silenceMs?: number; enabled?: boolean } = {}) {
  const lang = opts.lang ?? 'zh-CN';
  const silenceMs = opts.silenceMs ?? 800;
  const enabled = opts.enabled ?? false;
  const lastFinalRef = useRef('');

  useEffect(() => {
    if (!enabled) {
      voice.stopListening();
      return;
    }
    if (!voice.supported) {
      console.warn('[voice] no SpeechRecognition in this webview');
      return;
    }
    voice.startContinuous({
      lang,
      silenceMs,
      onStart: () => useSession.getState().setAgentState('listening'),
      onEnd: () => useSession.getState().setAgentState('idle'),
      onPartial: () => {
        useSession.getState().setAmplitude(0.3 + Math.random() * 0.2);
      },
      onFinal: (text) => {
        lastFinalRef.current = text;
        useSession.getState().setAgentState('thinking');
        useSession.getState().send(text);
      },
      onBargeIn: (text) => {
        // M3-E: user spoke over the avatar. Stop TTS, route their
        // text immediately.
        lastFinalRef.current = text;
        useSession.getState().setAgentState('thinking');
        useSession.getState().send(text);
      },
      onLevel: (lvl) => useSession.getState().setAmplitude(lvl),
    });
    return () => voice.stopListening();
  }, [enabled, lang, silenceMs]);
}
