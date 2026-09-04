import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state/session';
import { usePersona } from '../state/persona';
import type { AgentState } from '../core/types';
import { VRMAvatar, type AvatarMode } from '../avatar/VRMAvatar';
import { textToVisemes, type VisemeFrame } from '../services/visemes';
import './AvatarStage.css';
import '../avatar/vrm.css';

const STATE_TEXT: Record<AgentState, string> = {
  offline: '离线',
  idle: '待命',
  listening: '聆听中',
  thinking: '推理中',
  speaking: '应答中',
  acting: '执行中',
  error: '异常',
};

const EMOTION_GLYPH: Record<string, string> = {
  neutral: '·', happy: '◌', sad: '◔', angry: '◉', surprised: '◎',
  disgusted: '◕', fearful: '◐', tender: '♡', playful: '✦',
  curious: '◍', concerned: '◓',
};

/**
 * The centre stage: a Three.js scene rendering either a real VRM model
 * (when the user has dropped one in or generated one) or the
 * procedural fallback humanoid.
 *
 * P0-A baseline (mood-driven tinting) + P0-I viseme-free mouth open/
 * close are now layered on top of:
 *   - M2-A: real VRM model loading (via @pixiv/three-vrm, lazy)
 *   - M2-B: Three.js scene with a stylized procedural fallback that
 *           still talks + blinks + breathes
 *   - M2-C: text -> viseme stream drives the jaw rotation
 *   - M2-D: gaze follows the cursor (normalised -1..1)
 *   - M2-E: loadModel(url) + unloadModel() exposed via the holo-core
 *           back-compat API; settings panel will use it in P2-F
 *
 * HoloCore is kept on the canvas as a fallback for the widget mode
 * (MiniHoloCore), but the main stage uses VRMAvatar.
 */
export function AvatarStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<VRMAvatar | null>(null);
  const [mode, setMode] = useState<AvatarMode>('procedural');

  const agentState = useSession((s) => s.agentState);
  const amplitude = useSession((s) => s.amplitude);
  const lastJarvis = useSession((s) => [...s.messages].reverse().find((m) => m.speaker === 'jarvis'));

  const mood = usePersona((s) => s.mood);
  const emotion = usePersona((s) => s.emotion);
  const emotionIntensity = usePersona((s) => s.emotionIntensity);
  const lastAction = usePersona((s) => s.lastAction);
  const name = usePersona((s) => s.name);

  // Boot: try VRM first, fall back to procedural.
  useEffect(() => {
    if (!hostRef.current) return;
    const rect = hostRef.current.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width));
    const h = Math.max(120, Math.floor(rect.height));
    const avatar = new VRMAvatar({ width: w, height: h });
    avatarRef.current = avatar;
    avatar.attach(hostRef.current);

    // M2-A: optionally load a default model. The path is a placeholder
    // (the model isn't shipped with the prototype); users set it
    // through the settings panel that lands in P2-F.
    const saved = localStorage.getItem('lumo.avatar.model');
    if (saved) {
      avatar.loadModel(saved).then(() => setMode(avatar.getMode()));
    } else {
      setMode(avatar.getMode());
    }

    // Cursor -> gaze: normalised to -1..1, lerped in the loop.
    const onMove = (e: MouseEvent) => {
      const r = hostRef.current!.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      avatar.setGaze({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
    };
    const onLeave = () => avatar.setGaze(null);
    hostRef.current.addEventListener('mousemove', onMove);
    hostRef.current.addEventListener('mouseleave', onLeave);

    return () => {
      hostRef.current?.removeEventListener('mousemove', onMove);
      hostRef.current?.removeEventListener('mouseleave', onLeave);
      avatar.dispose();
      avatarRef.current = null;
    };
  }, []);

  // M2-C: text -> viseme stream. We push the full text through textToVisemes
  // on every state change and let the loop advance the cursor at real time.
  useEffect(() => {
    const av = avatarRef.current;
    if (!av) return;
    if (!lastJarvis || agentState !== 'speaking') {
      av.setVisemes([]);
      return;
    }
    const frames: VisemeFrame[] = textToVisemes(lastJarvis.text);
    av.setVisemes(frames);
  }, [lastJarvis?.id, agentState]);

  // M2: amplitude drives a peak boost (M2-C mixes the viseme shape with this).
  useEffect(() => avatarRef.current?.setAmplitude(amplitude), [amplitude]);

  // M7-F: emotion -> eyebrow + micro-expression. Smoothed so a sudden
  // emotion spike doesn't snap the eyebrows.
  useEffect(() => {
    avatarRef.current?.setEmotion?.(emotion, emotionIntensity);
  }, [emotion, emotionIntensity]);

  // Mood tints the head + lights.
  useEffect(() => {
    const av = avatarRef.current;
    if (!av) return;
    // Project the 4D mood onto a single hue for the head material.
    const v = mood.valence, a = mood.arousal, d = mood.dominance, i = mood.intimacy;
    const hue = ((v + 1) / 2) * 60 + 170 + a * 30;        // 170..280
    const sat = 0.55 + Math.abs(d) * 0.3;
    const lit = 0.45 + i * 0.15;
    const hex = hslToHex(hue, Math.min(1, sat), Math.min(0.7, lit));
    av.setMoodHex(hex);
  }, [mood]);

  // M2 public API: model picker exposes these through the settings panel.
  useEffect(() => {
    const w = window as unknown as {
      lumoAvatar?: { loadModel: (u: string) => void; unloadModel: () => void; getMode: () => AvatarMode };
    };
    w.lumoAvatar = {
      loadModel: (u) => avatarRef.current?.loadModel(u).then(() => setMode(avatarRef.current!.getMode())),
      unloadModel: () => { avatarRef.current?.unloadModel(); setMode('procedural'); },
      getMode: () => avatarRef.current?.getMode() ?? 'procedural',
    };
  }, [mode]);

  // Avatars mode chip at the bottom (small "VRM"/"Procedural" pill).
  // Hidden when the user hasn't loaded anything (procedural is fine).
  // Could be a settings card; the chip is the lightweight touch here.
  const busy = agentState === 'thinking' || agentState === 'acting' || agentState === 'speaking';
  const showEmotion = emotion !== 'neutral' && emotionIntensity > 0.15;
  const showAction = !!lastAction;

  return (
    <section className="stage">
      <div ref={hostRef} className="vrm-avatar-host">
        {/* VRMAvatar's canvas is appended into this div by attach(). */}
      </div>
      {/* M2: small mode pill in the corner so the user knows whether
          a VRM is loaded or we're on the procedural fallback. */}
      {mode === 'vrm' && (
        <span className="vrm-avatar-fallback-pill">VRM MODEL LOADED</span>
      )}

      <div className="stage__grid" aria-hidden>
        <span className="stage__ring stage__ring--a" />
        <span className="stage__ring stage__ring--b" />
        <span className="stage__crosshair" />
      </div>

      <div className={`stage__state stage__state--${agentState}`}>
        <span className="stage__state-dot" />
        <span className="label">{STATE_TEXT[agentState]}</span>
        {busy && <span className="stage__state-bars" aria-hidden><i /><i /><i /></span>}
      </div>

      <div className="stage__meta">
        <span className="label">{name.toUpperCase()} · CORE</span>
        <span className="label">V0.1 · {mode === 'vrm' ? 'VRM' : 'LOCAL'}</span>
      </div>

      {showEmotion && (
        <div className="stage__emotion" key={`${emotion}-${emotionIntensity.toFixed(2)}`}>
          <span className="stage__emotion-glyph" aria-hidden>{EMOTION_GLYPH[emotion] ?? '·'}</span>
          <span className="label stage__emotion-label">{emotion}</span>
        </div>
      )}

      {showAction && (
        <div className="stage__action" key={lastAction}>
          <span className="label">{lastAction}</span>
        </div>
      )}

      {lastJarvis && (
        <p className="stage__subtitle" key={lastJarvis.id}>
          {lastJarvis.text.split('\n')[0].slice(0, 96)}
          {lastJarvis.streaming && <span className="stage__caret" />}
        </p>
      )}
    </section>
  );
}

/** HSL -> 0xRRGGBB (small helper, avoids pulling in three's Color here
 *  since the avatar material already converts internally). */
function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return ((Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)) >>> 0;
}
