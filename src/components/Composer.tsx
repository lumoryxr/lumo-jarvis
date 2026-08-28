import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state/session';
import { voice } from '../services/voice';
import './Composer.css';

/** Suggestions that show the three things the app actually does. */
const QUICK = [
  '汇总一下当前所有任务',
  '内存占用有点高，看看怎么回事',
  '让 Hermes 重构 payments 模块的错误处理',
];

export function Composer() {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useSession((s) => s.send);
  const setAgentState = useSession((s) => s.setAgentState);
  const setAmplitude = useSession((s) => s.setAmplitude);
  const agentState = useSession((s) => s.agentState);

  // Auto-grow the textarea up to a cap, then scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    send(value);
    setText('');
  };

  const toggleMic = async () => {
    if (listening) {
      voice.stopListening();
      setListening(false);
      setAgentState('idle');
      return;
    }
    if (!voice.supported) {
      // No silent failure — say so in the transcript the user is already reading.
      setText('（当前环境不支持语音识别，请用文字输入）');
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
          aria-label={listening ? '停止聆听' : '开始语音输入'}
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
          placeholder={listening ? '正在聆听…' : '和 JARVIS 说点什么，或直接下发任务'}
          readOnly={listening}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <button className="composer__send" onClick={submit} disabled={!text.trim()} aria-label="发送">
          <SendIcon />
        </button>
      </div>
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
