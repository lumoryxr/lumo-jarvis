import { useEffect, useState } from 'react';
import { useSession } from '../state/session';
import './TopBar.css';

/**
 * Window chrome. In the packaged Tauri build this strip is the drag region for
 * a frameless window, which is why it carries no interactive controls on the
 * left half.
 */
export function TopBar() {
  const [now, setNow] = useState(() => new Date());
  const agentState = useSession((s) => s.agentState);
  const tasks = useSession((s) => s.tasks);

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

      <div className="topbar__clock">
        <span className="mono topbar__time">
          {now.toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
        <span className="label">
          {now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' })}
        </span>
      </div>
    </header>
  );
}
