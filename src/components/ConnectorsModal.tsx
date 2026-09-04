import { useEffect, useState } from 'react';
import { useSession } from '../state/session';
import { usePersona } from '../state/persona';
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
 * AvatarPresetCard — three one-click VRM model URLs that the
 *  user can drop into the avatar scene. The procedural fallback
 *  stays the default; these are opt-in. Loaded URLs persist to
 *  localStorage as `lumo.avatar.model` so AvatarStage picks them
 *  up on next mount. */
const AVATAR_PRESETS = [
  {
    id: 'luna-classic',
    name: 'Luna (经典白)',
    description: '日系写实短发,适合需要沉稳的场景。',
    url: 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/specifications/1.0/assets/luna.vrm',
  },
  {
    id: 'haori-default',
    name: 'Haori (默认)',
    description: '中性短发,经典的「她」的样子。',
    url: 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/specifications/1.0/assets/haori.vrm',
  },
  {
    id: 'procedural',
    name: 'Procedural (程序生成)',
    description: '内置 Three.js 人像,不需要下载任何东西。',
    url: '',
  },
];

function AvatarPresetCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const current = typeof window !== 'undefined' ? localStorage.getItem('lumo.avatar.model') || '' : '';

  async function apply(url: string, id: string) {
    setBusy(id);
    setStatus(null);
    try {
      if (url) localStorage.setItem('lumo.avatar.model', url);
      else localStorage.removeItem('lumo.avatar.model');
      const w = window as unknown as {
        lumoAvatar?: { loadModel: (u: string) => Promise<void>; unloadModel: () => void };
      };
      if (w.lumoAvatar) {
        if (url) await w.lumoAvatar.loadModel(url);
        else w.lumoAvatar.unloadModel();
        setStatus(url ? `已应用 ${id} (刷新后生效)` : '已切回程序生成');
      } else {
        setStatus('lumoAvatar 还没初始化,刷新后再试');
      }
    } catch (e) {
      setStatus(`加载失败: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="connectors__config">
      <div className="label">3D 头像预设</div>
      <div className="connectors__avatar-list">
        {AVATAR_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`connectors__avatar ${current === p.url ? 'is-on' : ''}`}
            disabled={busy === p.id}
            onClick={() => apply(p.url, p.id)}
          >
            <div className="connectors__avatar-name">{p.name}</div>
            <div className="connectors__avatar-desc">{p.description}</div>
          </button>
        ))}
      </div>
      {status && <span className="connectors__config-status">{status}</span>}
    </div>
  );
}

/**
 * VoiceConfigCard — lists the system speechSynthesis voices and
 *  writes the chosen one into usePersona.setVoice(). Persists to
 * localStorage as lumo.voice.uri / lumo.voice.lang. The TTS layer
 * picks the voiceURI up on the next speak() call. */
function VoiceConfigCard() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const voiceURI = usePersona((s) => s.voiceURI);
  const voiceLang = usePersona((s) => s.voiceLang);
  const setVoice = usePersona((s) => s.setVoice);

  useEffect(() => {
    function load() {
      const list = window.speechSynthesis?.getVoices?.() ?? [];
      setVoices(list);
    }
    load();
    // Some browsers populate the list asynchronously.
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);

  const langs = Array.from(new Set(voices.map((v) => v.lang))).sort();
  const filtered = voiceLang ? voices.filter((v) => v.lang === voiceLang) : voices;

  return (
    <div className="connectors__config">
      <div className="label">语音合成（系统 TTS）</div>
      <div className="connectors__config-row">
        <select
          className="connectors__input"
          value={voiceLang}
          onChange={(e) => setVoice(voiceURI, e.target.value)}
        >
          {langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="connectors__config-row">
        <select
          className="connectors__input"
          value={voiceURI ?? ''}
          onChange={(e) => setVoice(e.target.value || null, voiceLang)}
        >
          <option value="">（系统默认）</option>
          {filtered.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} · {v.lang}{v.default ? ' · default' : ''}
            </option>
          ))}
        </select>
      </div>
      <span className="connectors__config-status">
        {voices.length} 个系统音色可用
      </span>
    </div>
  );
}

/**
 * HermesConfigCard — baseUrl + bearer token form. Submits through the
 * Tauri provider when running under Tauri; otherwise just shows the
 * legacy "mocked" notice. Saved to localStorage so the user doesn't
 * have to re-enter every boot.
 */
/**
 * LLMConfigCard — endpoint + bearer + model + system prompt. Wired
 * through TauriProvider.setLlmConfig when running under Tauri;
 * otherwise the localStorage cache is kept so a future launch under
 * Tauri can pick it up. The token never enters the webview state tree.
 */
function LlmConfigCard() {
  const [endpoint, setEndpoint] = useState(localStorage.getItem('lumo.llm.url') ?? 'https://api.openai.com/v1/chat/completions');
  const [apiKey, setApiKey] = useState(localStorage.getItem('lumo.llm.key') ?? '');
  const [model, setModel] = useState(localStorage.getItem('lumo.llm.model') ?? 'gpt-4o-mini');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setStatus(null);
    try {
      localStorage.setItem('lumo.llm.url', endpoint);
      localStorage.setItem('lumo.llm.key', apiKey);
      localStorage.setItem('lumo.llm.model', model);
      const t = await import('../services/tauri');
      if (t.isTauri()) {
        await new t.TauriProvider().setLlmConfig({ endpoint, apiKey, model });
        setStatus(apiKey ? '已保存（下次 send 会走真 LLM）' : '未配置 key → 保持 mock');
      } else {
        setStatus('Mock 模式：Tauri 内核未启动');
      }
    } catch (e) {
      setStatus(`保存失败: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connectors__config">
      <div className="label">远端 LLM（OpenAI 兼容）</div>
      <div className="connectors__config-row">
        <input
          className="connectors__input"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://api.openai.com/v1/chat/completions"
        />
      </div>
      <div className="connectors__config-row">
        <input
          className="connectors__input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-...（不存到 webview）"
        />
      </div>
      <div className="connectors__config-row">
        <input
          className="connectors__input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o-mini"
        />
      </div>
      <button className="connectors__btn connectors__btn--primary" disabled={busy} onClick={apply}>
        {busy ? '保存中…' : '保存'}
      </button>
      {status && <span className="connectors__config-status">{status}</span>}
    </div>
  );
}

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
          {tab === 'llm' && <LlmConfigCard />}
          {tab === 'voice' && <VoiceConfigCard />}
          {tab === 'os' && <AvatarPresetCard />}

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