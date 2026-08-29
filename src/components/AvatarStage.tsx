import { useEffect, useRef } from 'react';
import { HoloCore } from '../avatar/HoloCore';
import { useSession } from '../state/session';
import { usePersona } from '../state/persona';
import type { AgentState } from '../core/types';
import './AvatarStage.css';

const STATE_TEXT: Record<AgentState, string> = {
  offline: '离线',
  idle: '待命',
  listening: '聆听中',
  thinking: '推理中',
  speaking: '应答中',
  acting: '执行中',
  error: '异常',
};

/**
 * Tiny emoji-keyed map for the small mood badge. Real viseme-driven
 * expressions are M2 work; for now an emoji in a corner gives the user
 * immediate read on what she's feeling without any infrastructure.
 */
const EMOTION_GLYPH: Record<string, string> = {
  neutral: '·',
  happy: '◌',
  sad: '◔',
  angry: '◉',
  surprised: '◎',
  disgusted: '◕',
  fearful: '◐',
  tender: '♡',
  playful: '✦',
  curious: '◍',
  concerned: '◓',
};

/**
 * The centre stage: the digital human plus the minimal HUD that tells you what
 * it is doing. Deliberately sparse — the avatar is the message.
 *
 * P0-A: persona is now wired in. Mood flows into HoloCore via `setMood()`;
 * emotion/action surface as a small badge + micro-animation in the lower
 * third so the user can read the avatar's internal state without watching
 * the conversation.
 */
export function AvatarStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<HoloCore | null>(null);

  const agentState = useSession((s) => s.agentState);
  const amplitude = useSession((s) => s.amplitude);
  const lastJarvis = useSession((s) => [...s.messages].reverse().find((m) => m.speaker === 'jarvis'));

  const mood = usePersona((s) => s.mood);
  const emotion = usePersona((s) => s.emotion);
  const emotionIntensity = usePersona((s) => s.emotionIntensity);
  const lastAction = usePersona((s) => s.lastAction);
  const name = usePersona((s) => s.name);

  useEffect(() => {
    if (!canvasRef.current) return;
    const core = new HoloCore(canvasRef.current);
    coreRef.current = core;

    const ro = new ResizeObserver(() => core.resize());
    ro.observe(canvasRef.current);

    return () => {
      ro.disconnect();
      core.dispose();
      coreRef.current = null;
    };
  }, []);

  useEffect(() => coreRef.current?.setState(agentState), [agentState]);
  useEffect(() => coreRef.current?.setAmplitude(amplitude), [amplitude]);
  useEffect(() => coreRef.current?.setMood(mood), [mood]);

  // While streaming a reply we have no real audio envelope, so synthesise one
  // P0-I: per-character rhythm with rests after punctuation. We pick the next
  // *unspoken* character's consonant class (vowel -> peak, consonant -> soft)
  // and add a rest every comma/period so the avatar doesn't mouth continuous
  // drone. ~75ms cadence is enough to feel like speech without burning CPU.
  useEffect(() => {
    if (agentState !== 'speaking') return;
    const msg = lastJarvis;
    if (!msg) return;
    const text = msg.text;
    let i = msg.text.length;  // start at the *new* chars since last update
    const vowel = /[aeiouyAEIOUY一-鿿]/;
    const rest = /[,。！？.!?:;…]/;
    const id = setInterval(() => {
      // Pull the latest text length every tick (don't read a stale snapshot).
      const cur = useSession.getState().messages.find((m) => m.id === msg.id);
      const len = cur?.text.length ?? i;
      const ch = text[len - 1] ?? ' ';
      if (rest.test(ch)) {
        // brief silence — let the avatar settle between phrases.
        useSession.getState().setAmplitude(0.04);
      } else if (vowel.test(ch)) {
        // vowels / hanzi carry weight — mouth opens wider.
        useSession.getState().setAmplitude(0.5 + Math.random() * 0.35);
      } else {
        // consonants are sharper but smaller.
        useSession.getState().setAmplitude(0.18 + Math.random() * 0.22);
      }
      i = len;
    }, 75);
    return () => clearInterval(id);
  }, [agentState, lastJarvis]);

  const busy = agentState === 'thinking' || agentState === 'acting' || agentState === 'speaking';
  const showEmotion = emotion !== 'neutral' && emotionIntensity > 0.15;
  const showAction = !!lastAction;

  return (
    <section className="stage">
      <canvas ref={canvasRef} className="stage__canvas" />

      {/* Concentric guide rings drawn in CSS, behind the WebGL layer's glow. */}
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
        <span className="label">V0.1 · LOCAL</span>
      </div>

      {/* P0-A: persona readouts. Tiny on purpose — they're *hints*, not the
       * message. The avatar itself is the message. */}
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