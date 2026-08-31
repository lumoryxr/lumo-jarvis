import { useMemo, useState } from 'react';
import { useSession, buildBriefing } from '../state/session';
import { PanelHead, StatusChip, Progress } from './primitives';
import { ProactivenessPanel } from './ProactivenessPanel';
import type { Task, TaskStatus } from '../core/types';
import './TaskBoard.css';

const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: '排队', running: '执行中', blocked: '阻塞', review: '待确认',
  done: '完成', failed: '失败', cancelled: '已取消',
};

const FILTERS: { id: 'active' | 'attention' | 'all'; label: string }[] = [
  { id: 'active', label: '进行中' },
  { id: 'attention', label: '待我处理' },
  { id: 'all', label: '全部' },
];

const PRIORITY_LABEL: Record<0 | 1 | 2, string> = {
  0: 'P0 · 阻塞',
  1: 'P1 · 进行',
  2: 'P2 · 之后',
};

const ago = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

/** P1-C: keyboard-friendly inline label adder.
 *  Type a label and Enter to add; Backspace on empty removes last. */
function LabelEditor({ task }: { task: Task }) {
  const toggleLabel = useSession((s) => s.toggleLabel);
  const [draft, setDraft] = useState('');
  return (
    <div className="task__labels" onClick={(e) => e.stopPropagation()}>
      {task.labels.map((l) => (
        <button
          key={l}
          className="task__label"
          onClick={() => toggleLabel(task.id, l)}
          title={`点击移除 ${l}`}
        >{l}</button>
      ))}
      <input
        type="text"
        className="task__label-input"
        value={draft}
        placeholder="+ 标签"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            toggleLabel(task.id, draft.trim());
            setDraft('');
          } else if (e.key === 'Backspace' && draft === '' && task.labels.length) {
            toggleLabel(task.id, task.labels[task.labels.length - 1]);
          }
        }}
      />
    </div>
  );
}

function TaskCard({ task, onDragStart, onDragOver, onDrop }: {
  task: Task;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selectTask = useSession((s) => s.selectTask);
  const cancelTask = useSession((s) => s.cancelTask);
  const retryTask = useSession((s) => s.retryTask);
  const setPriority = useSession((s) => s.setPriority);

  const active = task.status === 'running';

  return (
    <li
      className={`task task--${task.status} task--p${task.priority} ${open ? 'is-open' : ''}`}
      onClick={() => { setOpen((v) => !v); selectTask(task.id); }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="task__top">
        <span
          className="task__grip"
          aria-hidden
          title="拖动重新排序"
          onClick={(e) => e.stopPropagation()}
        >⋮⋮</span>
        <span className={`task__executor task__executor--${task.executor}`}>
          {task.executor === 'hermes' ? 'HERMES' : task.executor === 'local' ? 'LOCAL' : 'YOU'}
        </span>
        <span className={`task__pri task__pri--${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        <select
          className="task__pri-select"
          value={task.priority}
          onChange={(e) => setPriority(task.id, Number(e.target.value) as 0 | 1 | 2)}
          onClick={(e) => e.stopPropagation()}
          aria-label="优先级"
        >
          <option value={0}>P0</option>
          <option value={1}>P1</option>
          <option value={2}>P2</option>
        </select>
        <StatusChip status={task.status}>{STATUS_TEXT[task.status]}</StatusChip>
        <span className="task__age mono">{ago(task.updatedAt)}</span>
      </div>

      <h3 className="task__title">{task.title}</h3>
      <p className="task__intent">{task.intent}</p>

      <Progress
        value={task.progress}
        active={active}
        tone={task.status}
        startedAt={task.createdAt}
        subSteps={task.steps.map((s) => ({ id: s.id, status: s.status }))}
      />

      <div className="task__meta">
        {task.project && <span className="task__project mono">{task.project}</span>}
        {task.tags.map((t) => <span key={t} className="task__tag mono">#{t}</span>)}
        {task.externalId && <span className="task__ext mono">{task.externalId}</span>}
      </div>

      <LabelEditor task={task} />

      {open && (
        <div className="task__detail" onClick={(e) => e.stopPropagation()}>
          <ol className="task__steps">
            {task.steps.map((s) => (
              <li key={s.id} className={`task__step task__step--${s.status}`}>
                <span className="task__step-dot" />
                <span className="task__step-label">{s.label}</span>
              </li>
            ))}
          </ol>

          {task.result && <p className="task__result">{task.result}</p>}

          <div className="task__actions">
            {(task.status === 'running' || task.status === 'queued') && (
              <button className="task__btn" onClick={() => cancelTask(task.id)}>中止</button>
            )}
            {(task.status === 'failed' || task.status === 'cancelled') && (
              <button className="task__btn task__btn--primary" onClick={() => retryTask(task.id)}>重试</button>
            )}
            {task.status === 'review' && (
              <>
                <button className="task__btn task__btn--primary">批准执行</button>
                <button className="task__btn" onClick={() => cancelTask(task.id)}>驳回</button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Right rail: the rolled-up briefing on top, the live task list below,
 * and the proactiveness regulator at the bottom (P0-D).
 *
 * The briefing exists because a list of five cards is not an answer to "what is
 * going on" — it answers "what needs me, and what is moving".
 */
export function TaskBoard() {
  const tasks = useSession((s) => s.tasks);
  const moveTask = useSession((s) => s.moveTask);
  const [filter, setFilter] = useState<'active' | 'attention' | 'all'>('active');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const briefing = useMemo(() => buildBriefing(tasks), [tasks]);

  const visible = useMemo(() => {
    const rank: Record<TaskStatus, number> = {
      review: 0, failed: 1, blocked: 2, running: 3, queued: 4, done: 5, cancelled: 6,
    };
    return tasks
      .filter((t) =>
        filter === 'all' ? true
        : filter === 'attention' ? ['review', 'failed', 'blocked'].includes(t.status)
        : ['running', 'queued', 'review', 'blocked'].includes(t.status),
      )
      // P1-C: sort by priority first (0 highest), then by status rank, then recency.
      .sort((a, b) =>
        a.priority - b.priority
        || rank[a.status] - rank[b.status]
        || b.updatedAt - a.updatedAt,
      );
  }, [tasks, filter]);

  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    visible.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [visible]);

  return (
    <aside className="board">
      {/* --- briefing ------------------------------------------------------ */}
      <section className="panel bracketed board__brief">
        <PanelHead title="MISSION BRIEF" />
        <p className="board__headline">{briefing.headline}</p>

        <div className="board__counts">
          {(['running', 'queued', 'review', 'done', 'failed'] as TaskStatus[]).map((s) => (
            <div key={s} className={`board__count board__count--${s}`}>
              <span className="board__count-n mono">{briefing.counts[s]}</span>
              <span className="label">{STATUS_TEXT[s]}</span>
            </div>
          ))}
        </div>

        {briefing.highlights.length > 0 && (
          <ul className="board__highlights">
            {briefing.highlights.map((h) => <li key={h}>{h}</li>)}
          </ul>
        )}
      </section>

      {/* --- task list ----------------------------------------------------- */}
      <section className="panel bracketed board__list">
        <PanelHead
          title="TASKS"
          right={
            <div className="board__filters">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`board__filter ${filter === f.id ? 'is-on' : ''}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        />

        <ul className="board__tasks">
          {visible.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onDragStart={() => setDraggingId(t.id)}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={() => {
                if (draggingId && draggingId !== t.id) {
                  const from = indexById.get(draggingId);
                  const to = indexById.get(t.id);
                  if (from != null && to != null) moveTask(draggingId, to);
                }
                setDraggingId(null);
              }}
            />
          ))}
          {visible.length === 0 && <li className="board__empty">这一栏是空的。</li>}
        </ul>
      </section>

      {/* P0-D: proactiveness regulator + active proposals. */}
      <ProactivenessPanel />
    </aside>
  );
}