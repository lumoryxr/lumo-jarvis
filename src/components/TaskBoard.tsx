import { useMemo, useState } from 'react';
import { useSession, buildBriefing } from '../state/session';
import { PanelHead, StatusChip, Progress } from './primitives';
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

const ago = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

function TaskCard({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const selectTask = useSession((s) => s.selectTask);
  const cancelTask = useSession((s) => s.cancelTask);
  const retryTask = useSession((s) => s.retryTask);

  const active = task.status === 'running';

  return (
    <li
      className={`task task--${task.status} ${open ? 'is-open' : ''}`}
      onClick={() => { setOpen((v) => !v); selectTask(task.id); }}
    >
      <div className="task__top">
        <span className={`task__executor task__executor--${task.executor}`}>
          {task.executor === 'hermes' ? 'HERMES' : task.executor === 'local' ? 'LOCAL' : 'YOU'}
        </span>
        <StatusChip status={task.status}>{STATUS_TEXT[task.status]}</StatusChip>
        <span className="task__age mono">{ago(task.updatedAt)}</span>
      </div>

      <h3 className="task__title">{task.title}</h3>
      <p className="task__intent">{task.intent}</p>

      <Progress value={task.progress} active={active} tone={task.status} />

      <div className="task__meta">
        {task.project && <span className="task__project mono">{task.project}</span>}
        {task.tags.map((t) => <span key={t} className="task__tag mono">#{t}</span>)}
        {task.externalId && <span className="task__ext mono">{task.externalId}</span>}
      </div>

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
 * Right rail: the rolled-up briefing on top, the live task list below.
 *
 * The briefing exists because a list of five cards is not an answer to "what is
 * going on" — it answers "what needs me, and what is moving".
 */
export function TaskBoard() {
  const tasks = useSession((s) => s.tasks);
  const [filter, setFilter] = useState<'active' | 'attention' | 'all'>('active');

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
      .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt);
  }, [tasks, filter]);

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
          {visible.map((t) => <TaskCard key={t.id} task={t} />)}
          {visible.length === 0 && <li className="board__empty">这一栏是空的。</li>}
        </ul>
      </section>
    </aside>
  );
}
