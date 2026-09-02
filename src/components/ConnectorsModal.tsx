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
/**
 * HermesConfigCard — baseUrl + bearer token form. Submits through the
 * Tauri provider when running under Tauri; otherwise just shows the
 * legacy "mocked" notice. Saved to localStorage so the user doesn't
 * have to re-enter every boot.
 */
function HermesConfigCard() {
  const [baseUrl, setBaseUrl] = useState(localStorage.getItem('lumo.hermes.url') ?? 'http://127.0.0.1:8642');
  const [apiKey, setApiKey] = useState(localStorage.getItem('lumo.hermes.key') ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setStatus(null);
    try {
      localStorage.setItem('lumo.hermes.url', baseUrl);
      localStorage.setItem('lumo.hermes.key', apiKey);
      const t = await import('../services/tauri');
      if (t.isTauri()) {
        await new t.TauriProvider().setHermesConfig({ baseUrl, apiKey });
        const ok = await new t.TauriProvider().hermesHealth();
        setStatus(ok ? '已联通' : '连接失败（gateway 未起？）');
      } else {
        setStatus('Mock 模式：未连真 gateway');
      }
    } catch (e) {
      setStatus(`保存失败: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connectors__config">
      <div className="label">本地 Hermes gateway</div>
      <div className="connectors__config-row">
        <input
          className="connectors__input"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:8642"
        />
      </div>
      <div className="connectors__config-row">
        <input
          className="connectors__input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API_SERVER_KEY（不存到 webview）"
        />
      </div>
      <button className="connectors__btn connectors__btn--primary" disabled={busy} onClick={apply}>
        {busy ? '测试中…' : '保存并测试'}
      </button>
      {status && <span className="connectors__config-status">{status}</span>}
    </div>
  );
}

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

                    {tab === 'hermes' && <HermesConfigCard />}

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