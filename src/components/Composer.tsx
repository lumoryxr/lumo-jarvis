import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state/session';
import { voice } from '../services/voice';
import { useProactiveness } from '../state/proactiveness';
import './Composer.css';

const QUICK = [
  '\u6c47\u603b\u4e00\u4e0b\u5f53\u524d\u6240\u6709\u4efb\u52a1',
  '\u5185\u5b58\u5360\u7528\u6709\u70b9\u9ad8\uff0c\u770b\u770b\u600e\u4e48\u56de\u4e8b',
  '\u8ba9 Hermes \u91cd\u6784 payments \u6a21\u5757\u7684\u9519\u8bef\u5904\u7406',
];

interface SlashCommand {
  name: string;
  hint: string;
  match: (s: string) => boolean;
  run: (s: string) => string | null;
}

function quietNow(): string {
  const { patchConfig, config } = useProactiveness.getState();
  const h = new Date().getHours();
  patchConfig({ quietStart: h, quietEnd: (h + 1) % 24 });
  return `\u5df2\u8bbe\u4e3a\u5b89\u9759 1 \u5c0f\u65f6 (${config.quietStart}:00 -> ${config.quietEnd}:00).`;
}

function parseScheduleDelay(text: string): { at: Date; rest: string } | null {
  const m = text.match(/^(\d{1,2}):(\d{2})\s*(.*)$/);
  if (m) {
    const hh = Number(m[1]); const mm = Number(m[2]);
    const rest = m[3].trim();
    const now = new Date();
    let at = new Date(now);
    if (/tomorrow|\u660e\u5929/i.test(rest)) at.setDate(at.getDate() + 1);
    at.setHours(hh, mm, 0, 0);
    if (at.getTime() < now.getTime()) at.setDate(at.getDate() + 1);
    return { at, rest: rest.replace(/tomorrow|\u660e\u5929/ig, '').trim() };
  }
  const rel = text.match(/^(\d+)\s*d(?:\s+(\d+)\s*h)?(?:\s+(\d+)\s*m)?(?:\s+(\d+)\s*s)?\s*(.*)$/i);
  if (rel) {
    const d = Number(rel[1] || 0);
    const h = Number(rel[2] || 0);
    const m = Number(rel[3] || 0);
    const s = Number(rel[4] || 0);
    const at = new Date(Date.now() + ((d * 86400 + h * 3600 + m * 60 + s) * 1000));
    return { at, rest: (rel[5] || '').trim() };
  }
  return null;
}

function scheduleProposal(delayMs: number, message: string): string {
  const dueAt = Date.now() + delayMs;
  const m = (window as unknown as { pushScheduled?: (at: number, msg: string) => string }).pushScheduled;
  if (typeof m === 'function') return m(dueAt, message);
  return `\u5df2\u8bb0\u4e0b\u5b89\u6392:${message}\u5728 ${new Date(dueAt).toLocaleString('zh-CN')}\u3002`;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help',    hint: 'list all',
    match: (s) => s === '/help',
    run: () => '/help /clear /memory /quiet /export / lang zh|en / voice <id> / schedule 5m' },
  { name: 'clear',   hint: 'clear this turn',
    match: (s) => s === '/clear',
    run: () => null },
  { name: 'memory',  hint: 'open memory panel',
    match: (s) => s === '/memory',
    run: () => { document.dispatchEvent(new CustomEvent('lumo:open-memory-console')); return null; } },
  { name: 'quiet',   hint: 'mute her 1 hour',
    match: (s) => s === '/quiet',
    run: () => quietNow() },
  { name: 'export',  hint: 'export conversation',
    match: (s) => s === '/export',
    run: () => { document.dispatchEvent(new CustomEvent('lumo:export-conversation')); return '\u6b63\u5728\u51c6\u5907\u5bf9\u8bdd\u6587\u4ef6\u2026'; } },
  { name: 'lang',    hint: 'switch greeting language',
    match: (s) => s.startsWith('/lang '),
    run: (s) => {
      const lang = s.slice(6).trim() as 'zh' | 'en';
      if (lang !== 'zh' && lang !== 'en') return '\u53c2\u6570\u9519\uff1a\u8bf7\u7528 /lang zh \u6216 /lang en\u3002';
      try {
        const blob = JSON.parse(localStorage.getItem('lumo.onboarding.v1') ?? '{}');
        if (blob && blob.choices) {
          blob.choices.language = lang;
          localStorage.setItem('lumo.onboarding.v1', JSON.stringify(blob));
          window.dispatchEvent(new CustomEvent('lumo:language-changed', { detail: lang }));
      } } catch { /* ignore */ }
      return `\u95ee\u5012\u8bed\u8a00\u5df2\u5207\u6362\u4e3a ${lang}\u3002`;
    },
  },
  { name: 'voice',   hint: 'switch voice id',
    match: (s) => s.startsWith('/voice '),
    run: (s) => {
      const id = s.slice(7).trim();
      try {
        const blob = JSON.parse(localStorage.getItem('lumo.onboarding.v1') ?? '{}');
        if (blob && blob.choices) {
          blob.choices.voiceId = id;
          localStorage.setItem('lumo.onboarding.v1', JSON.stringify(blob));
          window.dispatchEvent(new CustomEvent('lumo:voice-changed', { detail: id }));
      } } catch { /* ignore */ }
      return `\u8bed\u97f3\u5df2\u5207\u6362\u4e3a ${id || '(empty)'}\u3002`;
    },
  },
  { name: 'schedule', hint: 'schedule a proposal: /schedule 5m text',
    match: (s) => s.startsWith('/schedule '),
    run: (s) => {
      const rest = s.slice('/schedule '.length).trim();
      if (!rest) return '\u8bf7\u63d0\u4f9b\u65f6\u95f4\u548c\u63d0\u9192\u8bed\u3002';
      const headStr = rest.split(' ').join(' ');
      const parsed = parseScheduleDelay(headStr);
      if (!parsed) return '\u65f6\u95f4\u683c\u5f0f\u8bc6\u522b\u5931\u8d25\u3002\u5c1d\u8bd5\uff1a/schedule 5m / 2h 30m / 14:30\u3002';
      const message = parsed.rest || rest;
      const delayMs = parsed.at.getTime() - Date.now();
      return scheduleProposal(delayMs, message);
    },
  },
];

function runSlash(text: string): { reply: string | null; handled: boolean } {
  for (const c of SLASH_COMMANDS) {
    if (c.match(text)) return { reply: c.run(text), handled: true };
  }
  return { reply: null, handled: false };
}

const HISTORY_KEY = 'lumo.composer.history.v1';
const MAX_HISTORY = 50;

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function saveHistory(h: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY))); }
  catch { /* ignore */ }
}

export function Composer() {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [histIndex, setHistIndex] = useState<number>(-1);
  const [draft, setDraft] = useState<string>('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useSession((s) => s.send);
  const setAgentState = useSession((s) => s.setAgentState);
  const setAmplitude = useSession((s) => s.setAmplitude);
  const agentState = useSession((s) => s.agentState);
  const pushSystem = useSession((s) => s.pushSystem);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (value.startsWith('/')) {
      const { reply, handled } = runSlash(value);
      if (handled) {
        if (reply) pushSystem?.(reply);
        setText('');
        setHistIndex(-1);
        setDraft('');
        return;
      }
    }
    const next = [...history];
    if (next[next.length - 1] !== value) next.push(value);
    setHistory(next);
    saveHistory(next);
    send(value);
    setText('');
    setHistIndex(-1);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = e.nativeEvent.isComposing;
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (isComposing) return;
    if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey) {
      if (history.length === 0) return;
      e.preventDefault();
      if (histIndex === -1) setDraft(text);
      const nextIdx = histIndex === -1 ? history.length - 1 : Math.max(0, histIndex - 1);
      setHistIndex(nextIdx);
      setText(history[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown' && !e.metaKey && !e.ctrlKey) {
      if (histIndex === -1) return;
      e.preventDefault();
      const nextIdx = histIndex + 1;
      if (nextIdx >= history.length) {
        setHistIndex(-1);
        setText(draft);
        setDraft('');
      } else {
        setHistIndex(nextIdx);
        setText(history[nextIdx]);
      }
    } else if (e.key === 'Escape') {
      if (text) {
        e.preventDefault();
        setText('');
        setHistIndex(-1);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setText('');
      setHistIndex(-1);
      inputRef.current?.focus();
    }
  };

  const toggleMic = async () => {
    if (listening) {
      voice.stopListening();
      setListening(false);
      setAgentState('idle');
      return;
    }
    if (!voice.supported) {
      setText('(\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u8bed\u97f3\u8bc6\u522b\uff0c\u8bf7\u7528\u6587\u5b57\u8f93\u5165)');
      return;
    }
    setListening(true);
    setAgentState('listening');
    await voice.listen({
      onPartial: setPartial,
      onFinal: (t) => {
        setPartial('');
        setText('');
        send(t);
      },
      onLevel: setAmplitude,
      onEnd: () => {
        setListening(false);
        setPartial('');
        setAmplitude(0);
        setAgentState('idle');
      },
    });
  };

  const busy = agentState === 'thinking' || agentState === 'acting';
  const showSlashHint = text.startsWith('/') && text.length <= 8;

  return (
    <div className="composer">
      <div className="composer__quick">
        {QUICK.map((q) => (
          <button key={q} className="composer__chip" onClick={() => send(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </div>

      <div className={`composer__box ${listening ? 'is-listening' : ''}`}>
        <button
          className={`composer__mic ${listening ? 'is-on' : ''}`}
          onClick={toggleMic}
          aria-label={listening ? '\u505c\u6b62\u8046\u542c' : '\u5f00\u59cb\u8bed\u97f3\u8f93\u5165'}
          aria-pressed={listening}
        >
          <MicIcon />
          {listening && <span className="composer__mic-halo" />}
        </button>

        <textarea
          ref={inputRef}
          className="composer__input"
          rows={1}
          value={listening && partial ? partial : text}
          placeholder={listening ? '\u6b63\u5728\u8046\u542c...' : '\u8bf4\u70b9\u4ec0\u4e48\uff0c\u6216\u8f93\u8d70 /help \u770b\u547c\u51fa'}
        readOnly={listening}
        onChange={(e) => { setText(e.target.value); setHistIndex(-1); }}
        onKeyDown={onKeyDown}
      />

        <button className="composer__send" onClick={submit} disabled={!text.trim()} aria-label="\u53d1\u9001">
          <SendIcon />
        </button>
      </div>

      {showSlashHint && (
        <div className="composer__hint">
          {SLASH_COMMANDS
            .filter((c) => c.name.startsWith(text.slice(1)) || text === '/' || text.startsWith('/' + c.name + ' '))
            .slice(0, 5)
            .map((c) => (
              <span key={c.name} className="composer__hint-item">
                <span className="mono">/{c.name}</span> {c.hint}
              </span>
            ))}
        </div>
      )}

      {histIndex !== -1 && (
        <div className="composer__histbar">
          history ({history.length - histIndex}/{history.length}) - Esc to cancel
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}