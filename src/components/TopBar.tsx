import { useEffect, useState } from 'react';
import { useSession } from '../state/session';
import { useWindowMode } from '../state/windowMode';
import { openOnboardingAt, useIsOnboarded } from './OnboardingWizard';
import './TopBar.css';

/**
 * Window chrome. In the packaged Tauri build this strip is the drag region for
 * a frameless window, which is why it carries no interactive controls on the
 * left half.
 *
 * P0-B: right side hosts a small mode pill — full / widget / minimized.
 * P0-C: `⌘.` opens the Memory Console (trust surface).
 * P0-E: `⌘,` and the `·` button reopen the onboarding wizard (reconfigure).
 */
export function TopBar() {
  const [now, setNow] = useState(() => new Date());
  const agentState = useSession((s) => s.agentState);
  const tasks = useSession((s) => s.tasks);

  const mode = useWindowMode((s) => s.mode);
  const setMode = useWindowMode((s) => s.setMode);
  const cycle = useWindowMode((s) => s.cycle);
  const onboarded = useIsOnboarded();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const running = tasks.filter((t) => t.status === 'running').length;
  const attention = tasks.filter((t) => ['review', 'failed', 'blocked'].includes(t.status)).length;

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar__brand">
        <span className="topbar__mark" aria-hidden />
        <span className="topbar__name">LUMO</span>
        <span className="topbar__sep">/</span>
        <span className="topbar__product">JARVIS</span>
      </div>

      <div className="topbar__stats">
        <span className="topbar__stat">
          <span className="label">ACTIVE</span>
          <span className="mono topbar__stat-v">{running}</span>
        </span>
        <span className={`topbar__stat ${attention ? 'is-hot' : ''}`}>
          <span className="label">NEEDS YOU</span>
          <span className="mono topbar__stat-v">{attention}</span>
        </span>
        <span className="topbar__stat">
          <span className="label">STATE</span>
          <span className="mono topbar__stat-v topbar__stat-v--state">{agentState}</span>
        </span>
      </div>

      <div className="topbar__right">
        <div className="topbar__mode" role="radiogroup" aria-label="窗口模式">
          <button
            className={`topbar__mode-btn ${mode === 'full' ? 'is-on' : ''}`}
            onClick={() => setMode('full')}
            aria-pressed={mode === 'full'}
            title="三栏工作区"
          >
            <span className="label">FULL</span>
          </button>
          <button
            className={`topbar__mode-btn ${mode === 'widget' ? 'is-on' : ''}`}
            onClick={() => setMode('widget')}
            aria-pressed={mode === 'widget'}
            title="浮窗"
          >
            <span className="label">WIDGET</span>
          </button>
          <button
            className={`topbar__mode-btn ${mode === 'minimized' ? 'is-on' : ''}`}
            onClick={() => setMode('minimized')}
            aria-pressed={mode === 'minimized'}
            title="收起"
          >
            <span className="label">MIN</span>
          </button>
        </div>
        <button
          className="topbar__cycle"
          onClick={cycle}
          title="切换窗口模式 (⌘L)"
          aria-label="切换窗口模式"
        >
          <span className="label">⌘L</span>
        </button>
        <button
          className="topbar__cycle"
          onClick={() => window.dispatchEvent(new CustomEvent('lumo:open-memory-console'))}
          title="打开记忆控制台 (⌘.)"
          aria-label="打开记忆控制台"
        >
          <span className="label">⌘.</span>
        </button>
        {onboarded && (
          <button
            className="topbar__cycle"
            onClick={() => openOnboardingAt(0)}
            title="重新配置 Lumina (⌘,)"
            aria-label="重新配置 Lumina"
          >
            <span className="label">⌘,</span>
          </button>
        )}
        <div className="topbar__clock">
          <span className="mono topbar__time">
            {now.toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
          <span className="label">
            {now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' })}
          </span>
        </div>
      </div>
    </header>
  );
}