import { useState } from 'react';
import { useSession } from '../state/session';
import type { ConnectorId, ConnectorMode, ConnectorStatus } from '../core/types';
import './ConnectorsModal.css';

const CONNECTOR_ORDER: ConnectorId[] = ['hermes', 'os', 'llm', 'voice'];
const STATUS_LABEL: Record<ConnectorMode, string> = {
  online: '在线',
  degraded: '不稳',
  offline: '离线',
};

const ERROR_LOG: Record<ConnectorId, { ts: number; msg: string }[]> = {
  hermes: [
    { ts: Date.now() - 5 * 60_000, msg: 'POST /v1/runs · run_9d4e12 · ok (1.2s)' },
    { ts: Date.now() - 18 * 60_000, msg: 'POST /v1/runs · run_2b8c04 · ok (0.6s)' },
  ],
  os: [
    { ts: Date.now() - 12 * 60_000, msg: 'sysinfo snapshot · 6 metrics · ok' },
  ],
  llm: [
    { ts: Date.now() - 2 * 60_000, msg: 'No LLM configured (mock backend in use)' },
  ],
  voice: [
    { ts: Date.now() - 4 * 60_000, msg: 'voice.listen · mic permission granted' },
  ],
};

/** P1-E: a single tab-like page that surfaces every connector's status,
 *  latency, last error, and a manual retry button. Triggered by Cmd+. or
 *  by clicking a connector in the SystemRail. */
export function ConnectorsModal({ open, onClose, focusId }: {
  open: boolean;
  onClose: () => void;
  focusId?: ConnectorId;
}) {
  const connectors = useSession((s) => s.connectors);
  const setConnectorStatus = useSession((s) => s.setConnectorStatus);
  const [tab, setTab] = useState<ConnectorId>((focusId ?? 'hermes') as ConnectorId);

  if (!open) return null;
  const active: ConnectorStatus = connectors[tab];
  const mode: ConnectorMode = active.status ?? (active.online ? 'online' : 'offline');
  const events = ERROR_LOG[tab] ?? [];

  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal connectors" onClick={(e) => e.stopPropagation()}>
        <header className="connectors__head">
          <span className="label">CONNECTORS</span>
          <button className="connectors__close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <nav className="connectors__tabs">
          {CONNECTOR_ORDER.map((id) => {
            const c = connectors[id];
            const tabMode: ConnectorMode = c.status ?? (c.online ? 'online' : 'offline');
            return (
              <button
                key={id}
                className={`connectors__tab ${tab === id ? 'is-on' : ''}`}
                onClick={() => setTab(id)}
              >
                <span className="connectors__tab-dot" data-status={tabMode} />
                <span className="mono">{c.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="connectors__detail">
          <div className="connectors__row">
            <span className="label">状态</span>
            <span className={`connectors__pill connectors__pill--${mode}`}>
              {STATUS_LABEL[mode]}
            </span>
            <span className="label">延迟</span>
            <span className="mono">{active.latencyMs != null ? `${active.latencyMs} ms` : '—'}</span>
            <span className="label">最近同步</span>
            <span className="mono">{active.lastSyncAt ? new Date(active.lastSyncAt).toLocaleTimeString('zh-CN') : '—'}</span>
          </div>

          <p className="connectors__detail-line">{active.detail}</p>

          <div className="connectors__actions">
            <button
              className="connectors__btn"
              onClick={() => setConnectorStatus(tab, 'online')}
              disabled={mode === 'online'}
            >在线</button>
            <button
              className="connectors__btn"
              onClick={() => setConnectorStatus(tab, 'degraded')}
              disabled={mode === 'degraded'}
            >标记不稳</button>
            <button
              className="connectors__btn connectors__btn--danger"
              onClick={() => setConnectorStatus(tab, 'offline')}
              disabled={mode === 'offline'}
            >中断</button>
            <button
              className="connectors__btn connectors__btn--primary"
              onClick={() => setConnectorStatus(tab, 'online')}
            >重试</button>
          </div>

          <div className="connectors__log">
            <div className="label">最近事件</div>
            <ul className="connectors__log-list mono">
              {events.map((e, i) => (
                <li key={i} className="connectors__log-row">
                  <span className="connectors__log-ts">
                    {new Date(e.ts).toLocaleTimeString('zh-CN')}
                  </span>
                  <span>{e.msg}</span>
                </li>
              ))}
              {events.length === 0 && <li className="connectors__log-empty">没有事件。</li>}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}