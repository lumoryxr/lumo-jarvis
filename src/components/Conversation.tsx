import { useEffect, useRef } from 'react';
import { useSession } from '../state/session';
import type { Message, ToolCall } from '../core/types';
import './Conversation.css';

const time = (t: number) =>
  new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** Inline record of a tool the agent ran, collapsed to one line. */
function ToolRow({ call }: { call: ToolCall }) {
  return (
    <div className={`tool tool--${call.status}`}>
      <span className="tool__icon" aria-hidden />
      <span className="tool__name mono">{call.name}</span>
      <span className="tool__summary mono">{call.summary}</span>
      {call.output && <span className="tool__output mono">{call.output}</span>}
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const mine = message.speaker === 'user';
  return (
    <article className={`msg msg--${message.speaker}`}>
      <header className="msg__head">
        <span className="label">{mine ? '你' : message.speaker === 'system' ? '系统' : 'JARVIS'}</span>
        <span className="label msg__time">{time(message.at)}</span>
      </header>

      {message.toolCalls?.length ? (
        <div className="msg__tools">
          {message.toolCalls.map((c) => <ToolRow key={c.id} call={c} />)}
        </div>
      ) : null}

      {message.text && (
        <div className="msg__body">
          {message.text}
          {message.streaming && <span className="msg__caret" />}
        </div>
      )}

      {!message.text && message.streaming && (
        <div className="msg__thinking"><i /><i /><i /></div>
      )}
    </article>
  );
}

export function Conversation() {
  const messages = useSession((s) => s.messages);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <div className="convo">
      <div className="convo__scroll">
        {messages.map((m) => <Bubble key={m.id} message={m} />)}
        <div ref={endRef} />
      </div>
    </div>
  );
}
