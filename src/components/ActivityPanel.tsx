import { useMemo } from 'react';
import { useActivity, type ActivityEntry, type ActivityKind } from '../state/activity';
import './ActivityPanel.css';

const KIND_LABEL: Record<ActivityKind, string> = {
  greeting:           '初次见面',
  proposal_surfaced:  '提议',
  proposal_accepted:  '采纳',
  proposal_dismissed: '忽略',
  task_completed:     '完成',
  task_failed:        '失败',
  memory_decayed:     '记忆衰减',
  note:               '笔记',
};

const KIND_TINT: Record<ActivityKind, string> = {
  greeting:           'var(--cyan-soft)',
  proposal_surfaced:  'var(--gold)',
  proposal_accepted:  'var(--lime)',
  proposal_dismissed: 'var(--ink-faint)',
  task_completed:     'var(--lime)',
  task_failed:        'var(--magenta)',
  memory_decayed:     'var(--ink-faint)',
  note:               'var(--ink-dim)',
};

const KIND_GLYPH: Record<ActivityKind, string> = {
  greeting:           '◌',
  proposal_surfaced:  '◍',
  proposal_accepted:  '✓',
  proposal_dismissed: '×',
  task_completed:     '◆',
  task_failed:        '◉',
  memory_decayed:     '○',
  note:               '·',
};

/**
 * Activity panel. P0-J.
 *
 * Toggled via Cmd+M (or Cmd+Shift+M for the right column view of the
 * Console). Renders the rolling event log grouped by day. Click a row to
 * clear it (placeholder — the store doesn't yet support delete-by-id).
 */
export function ActivityPanel() {
  const entries = useActivity((s) => s.entries);
  const clear = useActivity((s) => s.clear);
  const open = useActivityOpen((s) => s.on);
  const close = useActivityOpen((s) => s.close);

  if (!open) return null;

  const grouped = useMemo(() => groupByDay(entries), [entries]);

  return (
    <aside className="act" role="dialog" aria-label="活动历史">
      <header className="act__head">
        <div className="act__title">
          <span className="act__dot" aria-hidden />
          <span className="label">ACTIVITY · 她做了什么</span>
        </div>
        <div className="act__stats">
          <span className="mono">{entries.length}</span>
        </div>
        <div className="act__actions">
          <button className="act__btn" onClick={clear} title="清空记录">清空</button>
          <button className="act__btn" onClick={close} title="关闭 (⌘M)">✕</button>
        </div>
      </header>

      <div className="act__body">
        {entries.length === 0 ? (
          <div className="act__empty">
            她还没做什么值得记录的事。<br />
            等她打招呼、发提议、完成任务,就会出现在这里。
          </div>
        ) : (
          grouped.map((group) => (
            <section key={group.label} className="act__group">
              <h3 className="act__group-title">
                <span className="label">{group.label}</span>
                <span className="act__group-count mono">{group.entries.length}</span>
              </h3>
              <ul className="act__list">
                {group.entries.map((e) => <Row key={e.id} entry={e} />)}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

function Row({ entry }: { entry: ActivityEntry }) {
  const tint = KIND_TINT[entry.kind];
  return (
    <li
      className="act__row"
      style={{ '--tint': tint } as React.CSSProperties}
    >
      <span className="act__row-glyph" aria-hidden>{KIND_GLYPH[entry.kind]}</span>
      <div className="act__row-body">
        <div className="act__row-head">
          <span className="act__row-kind label">{KIND_LABEL[entry.kind]}</span>
          <span className="act__row-time mono">{formatTime(entry.ts)}</span>
        </div>
        <div className="act__row-title">{entry.title}</div>
        {entry.detail && <div className="act__row-detail">{entry.detail}</div>}
      </div>
    </li>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function groupByDay(entries: ActivityEntry[]): { label: string; entries: ActivityEntry[] }[] {
  const groups: Record<string, ActivityEntry[]> = {};
  for (const e of entries) {
    const d = new Date(e.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    (groups[key] ??= []).push(e);
  }
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({
      label: key === todayKey ? '今天' : key === yesterdayKey ? '昨天' : key,
      entries: list,
    }));
}

/* ---------------------------------------------- open / close state */

import { create } from 'zustand';

export const useActivityOpen = create<{ on: boolean; close: () => void; toggle: () => void }>((set, get) => ({
  on: false,
  close: () => set({ on: false }),
  toggle: () => set({ on: !get().on }),
}));

export function openActivityPanel() { useActivityOpen.setState({ on: true }); }
export function toggleActivityPanel() { useActivityOpen.getState().toggle(); }
