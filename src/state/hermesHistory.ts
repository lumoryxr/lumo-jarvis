/**
 * M7-E: hermes dispatch history. Keeps the last 5 runs the user
 * dispatched through cmd_hermes_dispatch (or that the prototype's
 * MockBackend scripted), so the connector modal can show them
 * without forcing the user to scroll the task board.
 */

import { create } from 'zustand';

export interface HermesRunRecord {
  runId: string;
  title: string;
  intent: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** Tail of the streamed output (truncated to ~280 chars). */
  preview?: string;
}

interface HermesHistoryState {
  records: HermesRunRecord[];
  push: (rec: HermesRunRecord) => void;
  patch: (runId: string, patch: Partial<HermesRunRecord>) => void;
  clear: () => void;
}

const KEY = 'lumo.hermes.history.v1';
const SCHEMA_VERSION = 1;

function load(): HermesRunRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.v === SCHEMA_VERSION && Array.isArray(parsed.records)) {
      return parsed.records;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function save(records: HermesRunRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_VERSION, records }));
  } catch {
    /* quota / private mode */
  }
}

export const useHermesHistory = create<HermesHistoryState>((set) => ({
  records: load(),
  push: (rec) =>
    set((s) => {
      const next = [rec, ...s.records].slice(0, 5);
      save(next);
      return { records: next };
    }),
  patch: (runId, p) =>
    set((s) => {
      const next = s.records.map((r) => (r.runId === runId ? { ...r, ...p } : r));
      save(next);
      return { records: next };
    }),
  clear: () => {
    save([]);
    set({ records: [] });
  },
}));
