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

/** P1-I: heuristic message category. Cheap regex-only — never blocks render. */
function categorize(text: string): { tag: 'ask' | 'commit' | 'share' | 'event' | 'plan'; label: string } {
  if (/\?|？/.test(text) || /能不能|要不|能否|会不会|怎么|为什么/.test(text)) {
    return { tag: 'ask', label: '提问' };
  }
  if (/批准|提交|merge|commit|我先|完成|搞|写好|弄好|发了|推送/.test(text)) {
    return { tag: 'commit', label: '提交' };
  }
  if (/下一步|计划|阶段|然后|接下来|流程|步骤/.test(text)) {
    return { tag: 'plan', label: '计划' };
  }
  if (/完成|失败|报错|异常|崩溃|已修|删除|创建|拉取/.test(text)) {
    return { tag: 'event', label: '事件' };
  }
  return { tag: 'share', label: '分享' };
}

/** Inline record of a tool the agent ran, collapsed to one line. */
/** P1-B: rich tool call rendering.
 *  Each payload kind has its own component. The dispatcher collapses to
 *  the legacy text view when payload is missing or unrecognised. */
function ToolRow({ call }: { call: ToolCall }) {
  const kind = call.payload?.kind ?? call.kind ?? 'text';
  return (
    <div className={`tool tool--${call.status}`}>
      <header className="tool__head">
        <span className="tool__icon" aria-hidden />
        <span className="tool__name mono">{call.name}</span>
        <span className="tool__summary mono">{call.summary}</span>
        <span className={`tool__kind mono tool__kind--${kind}`}>{kind}</span>
      </header>
      {call.payload && call.payload.kind !== 'text' ? (
        <ToolPayloadRenderer payload={call.payload} />
      ) : (call.output || (call.payload && call.payload.kind === 'text')) ? (
        <pre className="tool__output mono">{(call.payload && call.payload.kind === 'text') ? call.payload.text : call.output}</pre>
      ) : null}
    </div>
  );
}

function ToolPayloadRenderer({ payload }: { payload: NonNullable<ToolCall['payload']> }) {
  if (payload.kind === 'code') {
    return (
      <pre className="tool__code mono">
        <span className="tool__lang">{payload.language}</span>
        {payload.code}
      </pre>
    );
  }
  if (payload.kind === 'diff') {
    const before = payload.before.split('\n');
    const after = payload.after.split('\n');
    return (
      <div className="tool__diff mono">
        {payload.filename && <div className="tool__diff-name">— {payload.filename}</div>}
        {before.map((l, i) => (
          <div key={'b' + i} className="tool__diff-row tool__diff-row--del">{l}</div>
        ))}
        {after.map((l, i) => (
          <div key={'a' + i} className="tool__diff-row tool__diff-row--add">{l}</div>
        ))}
      </div>
    );
  }
  if (payload.kind === 'table') {
    return (
      <div className="tool__table-wrap">
        {payload.caption && <div className="tool__caption">{payload.caption}</div>}
        <table className="tool__table mono">
          <thead>
            <tr>{payload.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {payload.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? '—'}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (payload.kind === 'chart') {
    const max = Math.max(0, ...payload.series.flatMap((s) => s.values));
    return (
      <div className="tool__chart">
        {payload.chart === 'bar' ? (
          <div className="tool__bars">
            {payload.xLabels.map((x, i) => (
              <div key={i} className="tool__bar-col">
                <div className="tool__bars-stack">
                  {payload.series.map((s, j) => (
                    <div
                      key={j}
                      className="tool__bar"
                      data-series={s.label}
                      style={{ height: `${max ? (s.values[i] ?? 0) / max * 100 : 0}%` }}
                      title={`${s.label}: ${s.values[i] ?? 0}`}
                    />
                  ))}
                </div>
                <span className="tool__bar-x">{x}</span>
              </div>
            ))}
          </div>
        ) : (
          <svg className="tool__line" viewBox="0 0 200 80" preserveAspectRatio="none">
            {payload.series.map((s, idx) => {
              const max = Math.max(...s.values);
              const step = 200 / Math.max(1, s.values.length - 1);
              const points = s.values.map((v, i) => `${i * step},${80 - (v / Math.max(1, max)) * 70 - 5}`).join(' ');
              return <polyline key={idx} points={points} fill="none" stroke={`hsl(${(idx * 80) % 360} 80% 60%)`} strokeWidth="1.5" />;
            })}
          </svg>
        )}
        <div className="tool__chart-legend">
          {payload.series.map((s, i) => <span key={i} data-series={s.label}>{s.label}</span>)}
        </div>
      </div>
    );
  }
  if (payload.kind === 'log') {
    return (
      <div className="tool__log mono">
        {payload.entries.map((e, i) => (
          <div key={i} className={`tool__log-row tool__log-row--${e.level}`}>
            <span className="tool__log-level">{e.level.toUpperCase()}</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    );
  }
  if (payload.kind === 'markdown') {
    return <div className="tool__md">{payload.text}</div>;
  }
  return null;
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
              {message.text && !mine && (
                <span className={`msg__tag msg__tag--${categorize(message.text).tag}`}>{categorize(message.text).label}</span>
              )}
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
      <SmartReplyChips />
    </div>
  );
}

/** P1-H: heuristic-driven quick replies.
 *  Reads the last jarvis message and the user's recent turns to suggest
 *  three chips: a confirmation, a follow-up, and a "let me think" option.
 *  When the last line is a question or proposal, the chips adapt. */
function SmartReplyChips() {
  const messages = useSession((s) => s.messages);
  const lastJarvis = [...messages].reverse().find((m) => m.speaker === 'jarvis');
  const lastUser = [...messages].reverse().find((m) => m.speaker === 'user');
  if (!lastJarvis) return null;
  const text = lastJarvis.text ?? '';
  const isQuestion = /\?\uFF1F/.test(text) || /你(觉得|想要|想|打算|需要|要不要|好吗)/.test(text);
  const isApproval = /批准|确认|拍板|要不要|需要你/.test(text);
  const isFollowUp = /下一步|然后|现在|等会儿|我先/.test(text);

  let chips: string[];
  if (isApproval) {
    chips = ['批准执行', '先不动', '给我看看选项'];
  } else if (isQuestion) {
    chips = ['好的,就这么办', '我再想想', '你有什么建议'];
  } else if (isFollowUp) {
    chips = ['继续', '看下细节', '暂停一下'];
  } else {
    chips = ['继续', '讲点别的', '谢谢'];
  }
  // Bias by recent user message if available
  if (lastUser) {
    const userText = lastUser.text ?? '';
    if (userText.includes('明天') || userText.includes('下次')) {
      chips = ['好', '改天再说', '提醒我'];
    }
  }
  return (
    <div className="convo__replies">
      <span className="label">建议回复</span>
      {chips.map((c) => (
        <button key={c} className="convo__reply-chip" onClick={() => useSession.getState().send(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
