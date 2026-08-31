import type { ReactNode } from 'react';
import './primitives.css';

/** Section header used at the top of every rail panel. */
export function PanelHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="panel-head">
      <span className="label">{title}</span>
      <span className="panel-head__rule" />
      {right}
    </header>
  );
}

/** A 48-sample area sparkline. Pure SVG — no chart library. */
export function Sparkline({ data, tone = 'nominal' }: { data: number[]; tone?: 'nominal' | 'warn' | 'critical' }) {
  const w = 100;
  const h = 26;
  if (data.length < 2) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} />;

  const step = w / (data.length - 1);
  const y = (v: number) => h - v * (h - 2) - 1;
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = `sg-${tone}`;

  return (
    <svg className={`spark spark--${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Circular gauge with a tick ring. Used for the headline CPU/MEM readouts. */
export function Gauge({ value, label, display, tone }: { value: number; label: string; display: string; tone: string }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className={`gauge gauge--${tone}`}>
      <svg viewBox="0 0 64 64" className="gauge__dial" aria-hidden>
        <circle cx="32" cy="32" r={R} className="gauge__track" />
        <circle
          cx="32" cy="32" r={R}
          className="gauge__fill"
          strokeDasharray={`${C * 0.75} ${C}`}
          strokeDashoffset={C * 0.75 * (1 - value)}
        />
      </svg>
      <div className="gauge__readout">
        <span className="gauge__value mono">{display}</span>
        <span className="label">{label}</span>
      </div>
    </div>
  );
}

/** Status pill; colour comes from the `--st-*` token for the status. */
export function StatusChip({ status, children }: { status: string; children: ReactNode }) {
  return (
    <span className="chip" style={{ ['--chip' as string]: `var(--st-${status}, var(--ink-faint))` }}>
      <i className="chip__dot" />
      {children}
    </span>
  );
}

/** Thin progress bar with a travelling sheen while active. */
/** P1-F: enhanced progress bar.
 *  - Renders the bar as before.
 *  - Shows elapsed time + ETA below the bar.
 *  - If `subSteps` is provided, renders mini-pip indicators per step. */
export function Progress({ value, active, tone = 'running', startedAt, subSteps }: {
  value: number;
  active?: boolean;
  tone?: string;
  /** Epoch ms when the task started. Used to compute elapsed and ETA. */
  startedAt?: number;
  /** Optional step breakdown (status per step). */
  subSteps?: { id: string; status: import('../core/types').TaskStatus }[];
}) {
  const elapsedMs = startedAt ? Date.now() - startedAt : 0;
  const etaMs = value > 0 && value < 1 ? Math.round((elapsedMs / value) * (1 - value)) : 0;
  const showEta = active && elapsedMs > 4000 && etaMs > 1000;
  return (
    <div className="progress-wrap">
      <div className="progress" style={{ ['--bar' as string]: `var(--st-${tone})` }}>
        <div className="progress__fill" style={{ width: `${Math.round(value * 100)}%` }}>
          {active && <span className="progress__sheen" />}
        </div>
      </div>
      {(showEta || subSteps) && (
        <div className="progress__meta">
          {subSteps && subSteps.length > 0 && (
            <span className="progress__steps">
              {subSteps.map((s) => (
                <span key={s.id} className={`progress__pip progress__pip--${s.status}`} title={s.status} />
              ))}
            </span>
          )}
          {showEta && (
            <span className="progress__eta mono">~{formatDuration(etaMs)}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact duration formatter (e.g. `2m 14s`, `1h 6m`). */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
