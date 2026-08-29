import type { Proposal } from '../core/types';

/**
 * Watcher framework.
 *
 * A `Watcher` is a small piece of code that periodically inspects some
 * signal (disk, processes, metric, time-of-day, CI status, …) and emits a
 * `Proposal` when it spots something actionable.
 *
 * The real Tauri backend will wire these to actual signals:
 *   - `disk`     → sysinfo::Disks every 5 min
 *   - `process`  → sysinfo::Processes every 1 min
 *   - `metric`   → thresholds on the existing `MachineSnapshot`
 *   - `time`     → wall-clock based schedule
 *   - `ci`       → webhook listener (or a polling endpoint)
 *
 * For the prototype the *engine* is real — `Watcher.run()` is a real
 * interval loop and the proposal it surfaces is a real `Proposal`. The
 * signals themselves are synthesized (see `MockBackend.tickMetrics`) so
 * the watcher produces plausible events without needing real OS hooks.
 *
 * The watcher doesn't decide *whether* to fire — that's `Proactiveness.mayFire()`.
 * This separation matters: watchers are "what's happening in the world",
 * proactiveness is "should I tell the user about it".
 */

export type WatcherSignal =
  | { kind: 'disk'; mount: string; freeGB: number; totalGB: number; oldestFileDays: number }
  | { kind: 'process'; pid: number; name: string; cpuPct: number; memMB: number; durationSec: number }
  | { kind: 'metric'; metricId: string; value: number; threshold: number; trend: 'rising' | 'falling' | 'stable' }
  | { kind: 'time'; hour: number; weekday: number }
  | { kind: 'ci'; repo: string; branch: string; status: 'success' | 'failure' | 'pending' | 'cancelled'; durationSec: number };

export interface Watcher {
  id: string;
  /** Short human-readable name — appears in audit logs. */
  name: string;
  /** Time between checks in ms. */
  intervalMs: number;
  /** Inspect the latest snapshot and return zero or more proposals.
   *  Receives the user-configurable thresholds (P0-S) so the watcher can
   *  fire at the right sensitivity for this user. */
  inspect: (snapshot: WatcherSnapshot, thresholds: { diskFreeBelow: number; metricAbove: number }) => Proposal[];
}

export interface WatcherSnapshot {
  /** Current timestamp for time-based watchers. */
  now: number;
  /** Latest metric readings from `MachineSnapshot.metrics`. */
  metrics: ReadonlyArray<{ id: string; value: number; history: number[] }>;
  /** Synthesised process list. */
  processes: ReadonlyArray<{ pid: number; name: string; cpu: number; mem: number }>;
  /** Synthesised disk readings — watcher #1 surface. */
  disks: ReadonlyArray<{ mount: string; freeGB: number; totalGB: number; oldestFileDays: number }>;
  /** Synthesised CI events. */
  ci: ReadonlyArray<{ repo: string; branch: string; status: 'success' | 'failure' | 'pending' | 'cancelled'; durationSec: number }>;
}

/* ---------------------------------------------------- built-in watchers */

/** Threshold-based: when a metric sustains above `threshold` for 3 ticks. */
export const watcherMetric: Watcher = {
  id: 'metric.threshold',
  name: '指标阈值',
  intervalMs: 5_000,
  inspect: (snap, thresholds) => {
    const out: Proposal[] = [];
    for (const m of snap.metrics) {
      // Look at the last 6 samples to decide "sustained".
      const tail = m.history.slice(-6);
      if (tail.length < 4) continue;
      const sustained = tail.filter((v) => v > thresholds.metricAbove).length >= 3;
      if (!sustained) continue;
      const trend: 'rising' | 'falling' | 'stable' =
        tail.at(-1)! > tail[0]! + 0.05 ? 'rising'
        : tail.at(-1)! < tail[0]! - 0.05 ? 'falling'
        : 'stable';
      const id = `metric.${m.id}`;
      out.push({
        id: `${id}.${Date.now()}`,
        trigger: 'metric_anomaly',
        reasoning: `${m.id.toUpperCase()} 已经连续三次超过 88% 警戒线(${trend === 'rising' ? '还在涨' : trend === 'falling' ? '正在回落' : '稳定高位'})`,
        suggestedTask: m.id === 'cpu' || m.id === 'mem' ? {
          title: `检查 ${m.id.toUpperCase()} 高占用`,
          intent: '出报告 + 推荐方案,不动手',
          executor: 'local',
          project: 'workstation',
          tags: ['health', 'anomaly'],
        } : undefined,
        confidence: 0.75,
        tone: 'concerned',
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      });
    }
    return out;
  },
};

/** Disk watcher — when a mount's free space drops below 15% AND has stale files. */
export const watcherDisk: Watcher = {
  id: 'disk.full',
  name: '磁盘空间',
  intervalMs: 60_000,
  inspect: (snap, thresholds) => {
    const out: Proposal[] = [];
    for (const d of snap.disks) {
      const ratio = d.freeGB / d.totalGB;
      if (ratio > thresholds.diskFreeBelow) continue;
      out.push({
        id: `disk.${d.mount}.${Date.now()}`,
        trigger: 'metric_anomaly',
        reasoning: `${d.mount} 只剩 ${(ratio * 100).toFixed(0)}% 空间(${(d.freeGB).toFixed(1)} GB),且最旧的文件已 ${d.oldestFileDays} 天未动`,
        suggestedTask: {
          title: `扫描 ${d.mount} 的 30 天前旧文件`,
          intent: '出清单,不动手,等你批准',
          executor: 'local',
          project: 'workstation',
          tags: ['fs', 'tidy', 'needs-approval'],
        },
        confidence: 0.7,
        tone: 'matter_of_fact',
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      });
    }
    return out;
  },
};

/** Process watcher — single process hogging CPU >85% for >10 min. */
export const watcherProcess: Watcher = {
  id: 'process.hog',
  name: '进程占用',
  intervalMs: 30_000,
  inspect: (snap, _thresholds) => {
    const out: Proposal[] = [];
    for (const p of snap.processes) {
      if (p.cpu < 0.85) continue;
      // No real duration signal in the mock — synthesise it from the pid.
      const durationSec = 60 * ((p.pid % 12) + 4);  // 4–15 min
      if (durationSec < 600) continue;
      out.push({
        id: `proc.${p.pid}.${Date.now()}`,
        trigger: 'metric_anomaly',
        reasoning: `${p.name} (PID ${p.pid}) 持续占用 CPU ${(p.cpu * 100).toFixed(0)}% 已约 ${Math.round(durationSec / 60)} 分钟`,
        suggestedTask: {
          title: `检查 ${p.name} 的 CPU 占用`,
          intent: '看是不是它正常的工作状态,再决定是否结束',
          executor: 'local',
          project: 'workstation',
          tags: ['process', 'health'],
        },
        confidence: 0.6,
        tone: 'concerned',
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
      });
    }
    return out;
  },
};

/** CI watcher — when a tracked repo's main branch fails, propose a diagnosis. */
export const watcherCI: Watcher = {
  id: 'ci.failure',
  name: 'CI 失败',
  intervalMs: 30_000,
  inspect: (snap, _thresholds) => {
    return snap.ci
      .filter((c) => c.status === 'failure')
      .map((c) => ({
        id: `ci.${c.repo}.${c.branch}.${Date.now()}`,
        trigger: 'task_done',
        reasoning: `${c.repo}@${c.branch} 的 CI 在 ${Math.round(c.durationSec / 60)} 分钟后失败`,
        suggestedTask: {
          title: `让 Hermes 诊断 ${c.repo}@${c.branch} 失败原因`,
          intent: '拉日志 + 定位 + 给修复方案',
          executor: 'hermes',
          project: c.repo,
          tags: ['ci', 'diagnose'],
        },
        confidence: 0.55,
        tone: 'matter_of_fact',
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      }));
  },
};

/** Time watcher — fires once at startup if morning hour, plus the playfulness pulses. */
export const watcherTime: Watcher = {
  id: 'time.greeter',
  name: '时段问候',
  intervalMs: 60_000,
  inspect: (snap, _thresholds) => {
    const h = new Date(snap.now).getHours();
    const wd = new Date(snap.now).getDay();
    const out: Proposal[] = [];
    // 9–11 weekdays only — once at boot (caller dedupes by trigger).
    if (h >= 9 && h < 11 && wd >= 1 && wd <= 5) {
      out.push({
        id: `time.morning.${Math.floor(snap.now / (4 * 60 * 60 * 1000))}`, // bucketed 4h
        trigger: 'morning',
        reasoning: `早上 ${h} 点开工,顺手列一下昨天留下的尾巴`,
        confidence: 0.6,
        tone: 'warm',
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
      });
    }
    // 14–16 on weekdays — light "any progress?" pulse.
    if (h >= 14 && h < 16 && wd >= 1 && wd <= 5) {
      out.push({
        id: `time.afternoon.${Math.floor(snap.now / (4 * 60 * 60 * 1000))}`,
        trigger: 'playful',
        reasoning: '下午三点了,看看任务进度,顺便问你要不要休息',
        confidence: 0.5,
        tone: 'playful',
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      });
    }
    return out;
  },
};

/** Default watcher set. Add/remove here, not at call sites. */
export const DEFAULT_WATCHERS: Watcher[] = [
  watcherMetric,
  watcherDisk,
  watcherProcess,
  watcherCI,
  watcherTime,
];

/* --------------------------------------------------- watcher runtime */

/**
 * Run all watchers on a `WatcherSnapshot` and collect their proposals.
 * The caller (MockBackend) then consults `Proactiveness.mayFire()` before
 * emitting each one as a Provider event.
 */
export function runWatchers(
  snap: WatcherSnapshot,
  watchers: Watcher[] = DEFAULT_WATCHERS,
  thresholds: { diskFreeBelow: number; metricAbove: number } = { diskFreeBelow: 0.15, metricAbove: 0.88 },
): Proposal[] {
  const out: Proposal[] = [];
  for (const w of watchers) {
    try {
      out.push(...w.inspect(snap, thresholds));
    } catch (err) {
      // Watchers must not crash the host. Log + continue.
      // eslint-disable-next-line no-console
      console.warn(`[watcher ${w.id}] failed:`, err);
    }
  }
  return out;
}