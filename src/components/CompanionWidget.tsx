import { useEffect, useRef, useState, useCallback } from 'react';
import { MiniHoloCore } from '../avatar/MiniHoloCore';
import { useSession } from '../state/session';
import { usePersona } from '../state/persona';
import { useWindowMode } from '../state/windowMode';
import './CompanionWidget.css';

type AgentState = import('../core/types').AgentState;

const STATE_TEXT: Record<AgentState, string> = {
  offline: '离线',
  idle: '在呢',
  listening: '听你说',
  thinking: '想想',
  speaking: '说',
  acting: '在忙',
  error: '出问题了',
};

/**
 * The always-present companion bubble.
 *
 * Three modes owned by `windowMode`:
 *   - `widget`      — this whole panel
 *   - `minimized`   — collapsed to a 64px breathing dot (rendered elsewhere)
 *   - `full`        — not visible; the main three-column layout takes over
 *
 * The widget is *draggable* by its header strip and remembers its position.
 * It runs the lightweight `MiniHoloCore` (no post-processing, no 5k-particle
 * halo) so it doesn't fry the GPU when it's always on.
 */
export function CompanionWidget() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<MiniHoloCore | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const mode = useWindowMode((s) => s.mode);
  const pos = useWindowMode((s) => s.pos);
  const setPos = useWindowMode((s) => s.setPos);
  const size = useWindowMode((s) => s.size);
  const setSize = useWindowMode((s) => s.setSize);
  const resetSize = useWindowMode((s) => s.resetSize);
  const setMode = useWindowMode((s) => s.setMode);

  const agentState = useSession((s) => s.agentState);
  const amplitude = useSession((s) => s.amplitude);
  const lastJarvis = useSession((s) => [...s.messages].reverse().find((m) => m.speaker === 'jarvis'));
  const mood = usePersona((s) => s.mood);
  const emotion = usePersona((s) => s.emotion);
  const emotionIntensity = usePersona((s) => s.emotionIntensity);
  const name = usePersona((s) => s.name);

  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  /* -------------------------------------------- canvas lifecycle */
  useEffect(() => {
    if (mode === 'full') return;
    if (!canvasRef.current) return;
    const core = new MiniHoloCore(canvasRef.current);
    coreRef.current = core;
    const ro = new ResizeObserver(() => core.resize());
    ro.observe(canvasRef.current);
    return () => {
      ro.disconnect();
      core.dispose();
      coreRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'full') return;
    coreRef.current?.setState(agentState);
  }, [agentState, mode]);
  useEffect(() => {
    if (mode === 'full') return;
    coreRef.current?.setAmplitude(amplitude);
  }, [amplitude, mode]);
  useEffect(() => {
    if (mode === 'full') return;
    coreRef.current?.setMood(mood);
  }, [mood, mode]);

  /* Synthetic amplitude while speaking — same trick as AvatarStage but a
   * touch faster since the small avatar can take more visible amplitude. */
  useEffect(() => {
    if (mode === 'full' || agentState !== 'speaking') return;
    const id = setInterval(() => {
      useSession.getState().setAmplitude(0.3 + Math.random() * 0.55);
    }, 95);
    return () => clearInterval(id);
  }, [agentState, mode]);

  /* -------------------------------------------- drag */
  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't start a drag when the user clicks the controls on the right.
    const tgt = e.target as HTMLElement;
    if (tgt.closest('.companion-widget__btn')) return;
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !dragOffset.current) return;
      const nx = e.clientX - dragOffset.current.x;
      const ny = e.clientY - dragOffset.current.y;
      setPos(nx, ny);
    },
    [dragging, setPos],
  );

  const onHeaderPointerUp = useCallback(() => setDragging(false), []);

  if (mode === 'full') return null;

  if (mode === 'minimized') {
    return <MinimizedBubble />;
  }

  const subtitle = lastJarvis?.text.split('\n')[0] ?? '点一下就展开';
  const showEmotion = emotion !== 'neutral' && emotionIntensity > 0.15;

  return (
    <div
      ref={rootRef}
      className={`companion-widget ${dragging ? 'is-dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      role="dialog"
      aria-label={`${name} 浮窗`}
    >
      <header
        className="companion-widget__header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span className="companion-widget__name">{name}</span>
        <span className={`companion-widget__state companion-widget__state--${agentState}`}>
          <span className="companion-widget__state-dot" />
          {STATE_TEXT[agentState]}
        </span>
        <div className="companion-widget__controls">
          <button
            className="companion-widget__btn"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '收起对话' : '展开对话'}
            title={expanded ? '收起' : '展开'}
          >
            {expanded ? '⌄' : '⌃'}
          </button>
          <button
            className="companion-widget__btn"
            onClick={() => setMode('minimized')}
            aria-label="最小化"
            title="最小化"
          >
            —
          </button>
          <button
            className="companion-widget__btn"
            onClick={() => setMode('full')}
            aria-label="展开到全屏"
            title="展开全屏"
          >
            ⤢
          </button>
        </div>
      </header>

      <div className="companion-widget__stage">
        <canvas ref={canvasRef} className="companion-widget__canvas" />
        {showEmotion && (
          <div className="companion-widget__emotion" key={emotion}>
            <span className="companion-widget__emotion-dot" />
            <span className="label">{emotion}</span>
          </div>
        )}
      </div>

      <footer className="companion-widget__footer">
        <p className="companion-widget__subtitle" key={lastJarvis?.id ?? 'idle'}>
          {subtitle}
        </p>
      </footer>

      <div
        className="companion-widget__resize"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startW = size.w;
          const startH = size.h;
          const move = (ev: PointerEvent) => {
            const nw = Math.round(startW + (ev.clientX - startX));
            const nh = Math.round(startH + (ev.clientY - startY));
            setSize({ w: nw, h: nh });
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
        onDoubleClick={() => resetSize()}
        title="拖拽调整大小 · 双击重置"
        aria-label="调整浮窗大小"
      />

      {expanded && (
        <div className="companion-widget__chat">
          <p className="companion-widget__hint">
            在这里键入会直接发给 {name}。
            <br />
            想要三栏布局时,点 ⤢ 或按 ⌘L。
          </p>
          <input
            type="text"
            placeholder="跟她说点什么…"
            className="companion-widget__input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                useSession.getState().send(e.currentTarget.value.trim());
                e.currentTarget.value = '';
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The collapsed state. A 64px breathing dot — she's still "on" but out of
 * your way. One click anywhere brings her back as the full widget.
 */
function MinimizedBubble() {
  const setMode = useWindowMode((s) => s.setMode);
  const mood = usePersona((s) => s.mood);
  const emotion = usePersona((s) => s.emotion);
  const emotionIntensity = usePersona((s) => s.emotionIntensity);
  const agentState = useSession((s) => s.agentState);

  const tintHue = Math.round(((mood.valence + 1) / 2) * 60 + 170); // 170..230
  const tintStyle: React.CSSProperties = {
    background: `radial-gradient(circle at 30% 30%,
      hsla(${tintHue}, 90%, 70%, 0.95),
      hsla(${tintHue}, 70%, 50%, 0.55) 60%,
      transparent 75%)`,
  };

  return (
    <button
      className="companion-min"
      onClick={() => setMode('widget')}
      aria-label="展开 Lumina"
      title="展开 Lumina"
    >
      <span className="companion-min__core" style={tintStyle} />
      {emotion !== 'neutral' && emotionIntensity > 0.2 && (
        <span className="companion-min__emotion" key={emotion} />
      )}
      {agentState === 'thinking' && <span className="companion-min__think" aria-hidden />}
    </button>
  );
}