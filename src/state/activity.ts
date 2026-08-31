import { create } from 'zustand';

/**
 * P0-J: rolling event log of meaningful things Lumina did.
 *
 * What we record:
 *   - greeting           — first contact after onboarding commit
 *   - proposal surfaced  — a watcher fired and made it through the policy
 *   - proposal accepted  — user clicked "考虑下"
 *   - proposal dismissed — user clicked "不用"
 *   - task completed     — a running task hit progress = 1
 *   - task failed        — a task transitioned to failed
 *   - memory decayed     — a memory dropped below confidence 0.3 and got pruned
 *
 * Things we DON'T record:
 *   - raw message deltas / tool starts / tool ends  (too noisy)
 *   - machine ticks (heartbeat)
 *
 * The list is capped at MAX_ENTRIES — oldest drop off. The activity panel
 * groups by day so the user can scan it.
 */

export type ActivityKind =
  | 'greeting'
  | 'proposal_surfaced'
  | 'proposal_accepted'
  | 'proposal_dismissed'
  | 'task_completed'
  | 'task_failed'
  | 'memory_decayed'
  | 'note';

export interface ActivityEntry {
  id: string;
  ts: number;
  kind: ActivityKind;
  /** Short headline. */
  title: string;
  /** Optional one-liner detail. */
  detail?: string;
  /** Set for proposal/task entries so the panel can deep-link. */
  ref?: { kind: 'task' | 'proposal' | 'memory'; id: string };
}

interface ActivityState {
  entries: ActivityEntry[];
  push: (entry: Omit<ActivityEntry, 'id' | 'ts'>) => void;
  clear: () => void;
}

const MAX_ENTRIES = 80;

const uid = () => Math.random().toString(36).slice(2, 10);

export const useActivity = create<ActivityState>((set) => ({
  entries: [],

  push: (entry) => set((s) => ({
    entries: [{ ...entry, id: uid(), ts: Date.now() }, ...s.entries].slice(0, MAX_ENTRIES),
  })),

  clear: () => set({ entries: [] }),
}));

/** Convenience helper for callers. */
export function recordActivity(entry: Omit<ActivityEntry, 'id' | 'ts'>) {
  useActivity.getState().push(entry);
}
