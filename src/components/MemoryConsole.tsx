import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersona } from '../state/persona';
import * as memoryStore from '../services/memory';
import type { Memory } from '../core/types';
import './MemoryConsole.css';

const KIND_LABEL: Record<Memory['kind'], string> = {
  fact: '事实',
  preference: '偏好',
  event: '事件',
  emotion: '情绪',
  goal: '目标',
};

const KIND_TINT: Record<Memory['kind'], string> = {
  fact: 'var(--cyan)',
  preference: 'var(--cyan-soft)',
  event: 'var(--gold)',
  emotion: 'var(--magenta)',
  goal: 'var(--lime)',
};

const SOURCE_LABEL: Record<Memory['source'], string> = {
  told: '你说过',
  inferred: '我猜的',
  observed: '我看到的',
};

/**
 * Developer-style read-only console. P0-C's main deliverable: the user
 * sees everything Lumina "remembers" about them, can edit / delete / export
 * / wipe it. This is the *trust surface* — without it, the relationship
 * is opaque and the product can't claim a persona in good faith.
 *
 * Toggled with `⌘.` (Meta/Ctrl + period). Lives outside the three-column
 * layout; rendered as a fixed side panel.
 */
export function MemoryConsole() {
  const memories = usePersona((s) => s.memories);
  const removeMemory = usePersona((s) => s.removeMemory);
  const addMemory = usePersona((s) => s.addMemory);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editKind, setEditKind] = useState<Memory['kind']>('fact');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /* hotkey: ⌘. / Ctrl+. toggles the panel; custom event from TopBar opens it */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        // Esc closes the panel even from inputs
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    const onCustom = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('lumo:open-memory-console', onCustom as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('lumo:open-memory-console', onCustom as EventListener);
    };
  }, [open]);

  /* focus search on open */
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 220);
  }, [open]);

  const stats = useMemo(() => memoryStore.stats(), [memories]);

  const filtered = useMemo(() => {
    if (!query.trim()) return memories;
    return memoryStore.search(query, { minConfidence: 0 });
  }, [memories, query]);

  const grouped = useMemo(() => {
    const groups = new Map<Memory['kind'], Memory[]>();
    for (const m of filtered) {
      const arr = groups.get(m.kind) ?? [];
      arr.push(m);
      groups.set(m.kind, arr);
    }
    return groups;
  }, [filtered]);

  const beginEdit = (m: Memory) => {
    setEditing(m.id);
    setEditContent(m.content);
    setEditKind(m.kind);
  };
  const commitEdit = () => {
    if (!editing) return;
    const trimmed = editContent.trim();
    if (!trimmed) {
      removeMemory(editing);
    } else {
      // Easiest path: remove + add new with same content + kind.
      const original = memories.find((m) => m.id === editing);
      removeMemory(editing);
      if (original && trimmed !== original.content) {
        addMemory({
          ...original,
          id: Math.random().toString(36).slice(2),
          ts: Date.now(),
          content: trimmed,
          kind: editKind,
        });
      }
    }
    setEditing(null);
  };

  const wipe = () => {
    memoryStore.clear();
    setConfirmWipe(false);
    /* trigger a state refresh by removing via the store */
    usePersona.setState({ memories: [] });
  };

  if (!open) return null;

  return (
    <aside className="memory-console" role="dialog" aria-label="记忆控制台">
      <header className="memory-console__header">
        <div className="memory-console__title">
          <span className="memory-console__bracket" aria-hidden />
          <span className="label">MEMORY · CONSOLE</span>
        </div>
        <div className="memory-console__stats">
          <span><b className="mono">{stats.total}</b> 条</span>
          <span className="memory-console__sep">·</span>
          <span>平均置信度 <b className="mono">{Math.round(stats.avgConfidence * 100)}%</b></span>
          <span className="memory-console__sep">·</span>
          <span>分类 <b className="mono">{Object.values(stats.byKind).filter(Boolean).length}</b></span>
        </div>
        <div className="memory-console__actions">
          <button className="memory-console__btn" onClick={() => memoryStore.downloadExport()} title="导出 JSON">
            导出
          </button>
          <button
            className={`memory-console__btn ${confirmWipe ? 'is-confirm' : ''}`}
            onClick={() => (confirmWipe ? wipe() : setConfirmWipe(true))}
            onBlur={() => setConfirmWipe(false)}
            title={confirmWipe ? '再次点击确认' : '清空全部'}
          >
            {confirmWipe ? '确定清空?' : '清空'}
          </button>
          <button className="memory-console__btn" onClick={() => setOpen(false)} title="关闭 (⌘.)">
            ✕
          </button>
        </div>
      </header>

      <div className="memory-console__search">
        <input
          ref={searchRef}
          type="text"
          placeholder="搜索记忆（关键词 / 类型）…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="memory-console__search-input"
        />
        <span className="memory-console__search-hint">
          {filtered.length} / {memories.length}
        </span>
      </div>

      <div className="memory-console__preview">
        <details>
          <summary className="label">系统提示预览</summary>
          <pre className="memory-console__prompt">{memoryStore.buildPersonaContext() || '(无 — 还没有达到置信度阈值 0.4 的记忆)'}</pre>
        </details>
      </div>

      <div className="memory-console__body">
        {filtered.length === 0 ? (
          <div className="memory-console__empty">
            {memories.length === 0
              ? '她还没记住任何东西。和她聊几句试试 — "我叫 Lin"、"我喜欢 Rust"、"明天要开会" 都会落在这里。'
              : `没有匹配 "${query}" 的记忆。`}
          </div>
        ) : (
          (['fact', 'preference', 'event', 'emotion', 'goal'] as Memory['kind'][]).map((kind) => {
            const arr = grouped.get(kind);
            if (!arr?.length) return null;
            return (
              <section key={kind} className="memory-console__group">
                <h3 className="memory-console__group-title">
                  <span className="memory-console__dot" style={{ background: KIND_TINT[kind] }} aria-hidden />
                  <span className="label">{KIND_LABEL[kind]}</span>
                  <span className="memory-console__group-count mono">{arr.length}</span>
                </h3>
                <ul className="memory-console__list">
                  {arr.map((m) => (
                    <li
                      key={m.id}
                      className="memory-console__item"
                      style={{ '--tint': KIND_TINT[m.kind] } as React.CSSProperties}
                    >
                      {editing === m.id ? (
                        <div className="memory-console__edit">
                          <select
                            value={editKind}
                            onChange={(e) => setEditKind(e.target.value as Memory['kind'])}
                            className="memory-console__kind"
                          >
                            {(Object.keys(KIND_LABEL) as Memory['kind'][]).map((k) => (
                              <option key={k} value={k}>{KIND_LABEL[k]}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit();
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            className="memory-console__edit-input"
                            autoFocus
                          />
                          <button className="memory-console__btn is-primary" onClick={commitEdit}>保存</button>
                          <button className="memory-console__btn" onClick={() => setEditing(null)}>取消</button>
                        </div>
                      ) : (
                        <>
                          <div className="memory-console__content">{m.content}</div>
                          <div className="memory-console__meta">
                            <span title="来源">{SOURCE_LABEL[m.source]}</span>
                            <span className="memory-console__sep">·</span>
                            <span title="置信度">
                              <span className="memory-console__confidence">
                                <span
                                  className="memory-console__confidence-fill"
                                  style={{ width: `${Math.round(m.confidence * 100)}%` }}
                                />
                              </span>
                              <span className="mono memory-console__confidence-num">
                                {Math.round(m.confidence * 100)}%
                              </span>
                            </span>
                            <span className="memory-console__sep">·</span>
                            <span title={new Date(m.ts).toLocaleString('zh-CN')}>
                              {formatRelative(m.ts)}
                            </span>
                          </div>
                          <div className="memory-console__item-actions">
                            <button className="memory-console__btn is-ghost" onClick={() => beginEdit(m)}>编辑</button>
                            <button className="memory-console__btn is-ghost is-danger" onClick={() => removeMemory(m.id)}>删除</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <footer className="memory-console__footer">
        <span className="label">⌘. 切换 · 置信度 &lt; 30% 自动丢弃 · 上限 200 条</span>
      </footer>
    </aside>
  );
}

function formatRelative(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.round(d / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}