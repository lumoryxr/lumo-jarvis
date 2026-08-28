import { useSession } from '../state/session';
import { PanelHead, Sparkline, Gauge } from './primitives';
import type { ConnectorId } from '../core/types';
import './SystemRail.css';

const CONNECTOR_ORDER: ConnectorId[] = ['hermes', 'os', 'llm', 'voice'];

const uptime = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
};

/**
 * Left rail: the machine JARVIS is running on, and the links it holds open.
 * Everything here is read-only telemetry — actions live on the task board.
 */
export function SystemRail() {
  const machine = useSession((s) => s.machine);
  const connectors = useSession((s) => s.connectors);

  const headline = machine?.metrics.slice(0, 2) ?? [];
  const rest = machine?.metrics.slice(2) ?? [];

  return (
    <aside className="rail">
      {/* --- host ---------------------------------------------------------- */}
      <section className="panel bracketed rail__panel">
        <PanelHead title="WORKSTATION" />
        <div className="rail__host">
          <div className="rail__host-name mono">{machine?.host ?? '—'}</div>
          <div className="rail__host-os">{machine?.os ?? '正在连接…'}</div>
          <div className="rail__host-up label">UPTIME {machine ? uptime(machine.uptimeSec) : '—'}</div>
        </div>

        <div className="rail__gauges">
          {headline.map((m) => (
            <Gauge key={m.id} value={m.value} label={m.label} display={m.display} tone={m.tone} />
          ))}
        </div>

        <div className="rail__metrics">
          {rest.map((m) => (
            <div key={m.id} className="rail__metric">
              <div className="rail__metric-head">
                <span className="label">{m.label}</span>
                <span className={`mono rail__metric-value rail__metric-value--${m.tone}`}>{m.display}</span>
              </div>
              <Sparkline data={m.history} tone={m.tone} />
            </div>
          ))}
        </div>
      </section>

      {/* --- links --------------------------------------------------------- */}
      <section className="panel bracketed rail__panel">
        <PanelHead title="LINKS" />
        <ul className="rail__links">
          {CONNECTOR_ORDER.map((id) => {
            const c = connectors[id];
            return (
              <li key={id} className={`rail__link ${c?.online ? 'is-on' : ''}`}>
                <span className="rail__link-dot" />
                <span className="rail__link-name mono">{c?.label ?? id.toUpperCase()}</span>
                <span className="rail__link-detail mono">{c?.detail ?? '未连接'}</span>
                {c?.latencyMs != null && <span className="rail__link-ms mono">{c.latencyMs}ms</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* --- processes ------------------------------------------------------ */}
      <section className="panel bracketed rail__panel rail__panel--grow">
        <PanelHead title="TOP PROCESSES" />
        <ul className="rail__procs">
          {(machine?.processes ?? []).slice(0, 7).map((p) => (
            <li key={p.pid} className="rail__proc">
              <span className="rail__proc-name mono">{p.name}</span>
              <span className="rail__proc-bar" style={{ width: `${p.cpu}%` }} />
              <span className="rail__proc-cpu mono">{p.cpu}%</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
