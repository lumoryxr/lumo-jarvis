import { useEffect, useRef } from 'react';
import { HoloCore } from '../avatar/HoloCore';
import { useSession } from '../state/session';
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
 * The centre stage: the digital human plus the minimal HUD that tells you what
 * it is doing. Deliberately sparse — the avatar is the message.
 */
export function AvatarStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<HoloCore | null>(null);

  const agentState = useSession((s) => s.agentState);
  const amplitude = useSession((s) => s.amplitude);
  const lastJarvis = useSession((s) => [...s.messages].reverse().find((m) => m.speaker === 'jarvis'));

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

  // While streaming a reply we have no real audio envelope, so synthesise one
  // from the text growing. It keeps the core alive in step with the words.
  useEffect(() => {
    if (agentState !== 'speaking') return;
    const id = setInterval(() => {
      useSession.getState().setAmplitude(0.28 + Math.random() * 0.5);
    }, 110);
    return () => clearInterval(id);
  }, [agentState]);

  const busy = agentState === 'thinking' || agentState === 'acting' || agentState === 'speaking';

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
        <span className="label">JARVIS · CORE</span>
        <span className="label">V0.1 · LOCAL</span>
      </div>

      {lastJarvis && (
        <p className="stage__subtitle" key={lastJarvis.id}>
          {lastJarvis.text.split('\n')[0].slice(0, 96)}
          {lastJarvis.streaming && <span className="stage__caret" />}
        </p>
      )}
    </section>
  );
}
