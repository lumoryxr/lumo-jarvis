import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../state/session';
import type { Message, ToolCall } from '../core/types';
import './Conversation.css';

// P0-U: inlined here (was in state/session.ts but template-literal escape
// issues with em-dash + escaped backticks pulled it out of there).
function exportConversationMarkdown(messages: Message[]): string {
  const lines: string[] = ['# Lumo JARVIS \u2014 \u5bf9\u8bdd\u8bb0\u5f55', ''];
  for (const m of messages) {
    const ts = new Date(m.at).toLocaleString('zh-CN');
    const who = m.speaker === 'user' ? '\u4f60' : m.speaker === 'system' ? '\u7cfb\u7edf' : 'Lumina';
    lines.push(`## ${who} \u00b7 ${ts}`);
    lines.push('');
    if (m.text) {
      lines.push(m.text);
      lines.push('');
    }
    if (m.toolCalls && m.toolCalls.length) {
      lines.push('**\u5de5\u5177\u8c03\u7528:**');
      for (const c of m.toolCalls) {
        const out = c.output ? `: ${c.output.slice(0, 80)}` : '';
        lines.push(`- ${c.name} \u2014 ${c.summary} (${c.status}${out})`);
      }
      lines.push('');
    }
  }
  return lines.join('\\n');
}

function exportConversationJSON(messages: Message[]): string {
  return JSON.stringify({ exportedAt: Date.now(), messages }, null, 2);
}

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
  // P0-O: if this reply owns a task, look it up so we can render a
  // compact "what she's doing" line.
  const task = useSession((s) =>
    message.taskId ? s.tasks.find((t) => t.id === message.taskId) : undefined,
  );
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

      {/* P0-M: tiny chip showing how many memories she remembered for this turn */}
      {message.memoryRefs && message.memoryRefs.length > 0 && !message.streaming && (
        <div className="msg__memchip" title={message.memoryRefs.length + ' 条记忆被用到'}>
          <span aria-hidden>◌</span>
          <span className="label">用了 {message.memoryRefs.length} 条记忆</span>
        </div>
      )}

      {!message.text && message.streaming && (
        <div className="msg__thinking"><i /><i /><i /></div>
      )}

      {/* P0-O: inline task status when this reply owns one */}
      {task && !message.streaming && (
        <div className="msg__task" data-status={task.status}>
          <span className="msg__task-dot" aria-hidden />
          <span className="msg__task-title">{task.title}</span>
          <span className="msg__task-status label">
            {task.status === 'running' ? `进行中 ${Math.round(task.progress * 100)}%`
              : task.status === 'done' ? '完成'
              : task.status === 'failed' ? '失败'
              : task.status === 'review' ? '待你拍板'
              : task.status === 'queued' ? '排队中'
              : '已取消'}
          </span>
        </div>
      )}
    </article>
  );
}

function downloadExport(content: string, ext: 'md' | 'json') {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumo-conversation-${new Date().toISOString().slice(0, 10)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function Conversation() {
  const messages = useSession((s) => s.messages);
  const endRef = useRef<HTMLDivElement>(null);
  // P0-Q: conversation search. Live filter on text + speaker; clear
  // restores the full list.
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) =>
      m.text.toLowerCase().includes(q) ||
      (m.speaker === 'user' ? '你' : m.speaker === 'system' ? '系统' : 'jarvis').includes(q),
    );
  }, [messages, query]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <div className="convo">
      <div className="convo__search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话 (按说话人/内容)…"
          className="convo__search-input"
        />
        {query && (
          <span className="convo__search-count mono">
            {visible.length} / {messages.length}
          </span>
        )}
        {/* P0-U: conversation export menu. */}
        <details className="convo__export">
          <summary className="label" title="导出对话">↓</summary>
          <div className="convo__export-menu">
            <button
              className="convo__export-btn"
              onClick={() => downloadExport(exportConversationMarkdown(messages), 'md')}
            >Markdown</button>
            <button
              className="convo__export-btn"
              onClick={() => downloadExport(exportConversationJSON(messages), 'json')}
            >JSON</button>
          </div>
        </details>
      </div>
      <div className="convo__scroll">
        {visible.length === 0 && (
          <div className="convo__no-match">没有匹配 "{query}" 的对话。</div>
        )}
        {visible.map((m) => <Bubble key={m.id} message={m} />)}
        <div ref={endRef} />
      </div>
    </div>
  );
}
