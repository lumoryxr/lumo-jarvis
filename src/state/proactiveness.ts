import { create } from 'zustand';
import type { Proposal } from '../core/types';

/**
 * Proactiveness controller.
 *
 * Encapsulates the four-band policy the user asked for plus the watcher
 * framework that backs it. The actual watchers live in `services/watchers.ts`
 * — this store is the policy shell that decides *whether* a watcher is
 * allowed to fire right now.
 *
 *   silent   — watchers off; no proposals; avatar may still react to user
 *   companion — proposals allowed but capped (3/day); cooldowns enforced
 *   chatty    — proposals allowed liberally (6/day); cooldowns halved
 *   custom    — user picks band, daily cap, quiet hours, per-trigger on/off
 *
 * Quiet hours apply in every band: between `quietStart` and `quietEnd`
 * (next-day wrap), no proposal may surface. This is the basic "don't
 * interrupt me at 2am" rule.
 */

export type Proactiveness = 'silent' | 'companion' | 'chatty' | 'custom';

export interface ProactivenessConfig {
  /** Max proposals surfaced per session-day (rolling 24h window). */
  dailyCap: number;
  /** Cooldown between proposals of the same trigger, in minutes. */
  cooldownMin: number;
  /** Quiet hours — no proposals surface in this window. Hours are local. */
  quietStart: number;   // 0..23
  quietEnd: number;     // 0..23 (must be != quietStart)
}

const PRESETS: Record<Exclude<Proactiveness, 'custom'>, ProactivenessConfig> = {
  silent:    { dailyCap: 0,  cooldownMin: 0,   quietStart: 0, quietEnd: 0 },
  companion: { dailyCap: 3,  cooldownMin: 90,  quietStart: 22, quietEnd: 8 },
  chatty:    { dailyCap: 6,  cooldownMin: 45,  quietStart: 23, quietEnd: 7 },
};

export const DEFAULT_PROACTIVENESS: Proactiveness = 'companion';

/** True when the user is in quiet hours and proposals should be suppressed. */
export function inQuietHours(cfg: ProactivenessConfig, hour = new Date().getHours()): boolean {
  if (cfg.quietStart === cfg.quietEnd) return false; // window of 0 == no quiet hours
  if (cfg.quietStart < cfg.quietEnd) {
    return hour >= cfg.quietStart && hour < cfg.quietEnd;
  }
  // Wraps midnight: e.g. 22..8 means [22, 23] ∪ [0, 8).
  return hour >= cfg.quietStart || hour < cfg.quietEnd;
}

interface ProactivenessState {
  band: Proactiveness;
  config: ProactivenessConfig;
  /** Per-trigger on/off overrides (only meaningful in `custom` band). */
  triggerEnabled: Record<Proposal['trigger'], boolean>;
  /** Rolling 24h counter — capped to `dailyCap`. */
  firedToday: number;
  /** Map of trigger → timestamp of last fire (ms epoch). */
  lastFired: Record<Proposal['trigger'], number>;
  /** Whether a watcher currently wants to surface something (pending review). */
  pendingProposal?: Proposal;

  setBand: (b: Proactiveness) => void;
  patchConfig: (cfg: Partial<ProactivenessConfig>) => void;
  setTriggerEnabled: (trigger: Proposal['trigger'], on: boolean) => void;
  /** Returns `true` if a proposal of this trigger may fire right now. */
  mayFire: (trigger: Proposal['trigger']) => boolean;
  /** Mark a proposal as fired — call *after* the provider emits it. */
  recordFire: (trigger: Proposal['trigger']) => void;
}

const ALL_TRIGGERS: Proposal['trigger'][] = [
  'morning', 'idle', 'task_done', 'review_due', 'metric_anomaly', 'inspiration', 'anniversary', 'playful',
];

const DEFAULT_TRIGGERS: Record<Proposal['trigger'], boolean> = Object.fromEntries(
  ALL_TRIGGERS.map((t) => [t, true]),
) as Record<Proposal['trigger'], boolean>;

export const useProactiveness = create<ProactivenessState>((set, get) => ({
  band: DEFAULT_PROACTIVENESS,
  config: { ...PRESETS[DEFAULT_PROACTIVENESS] },
  triggerEnabled: { ...DEFAULT_TRIGGERS },
  firedToday: 0,
  lastFired: Object.fromEntries(ALL_TRIGGERS.map((t) => [t, 0])) as Record<Proposal['trigger'], number>,

  setBand: (band) =>
    set((s) => ({
      band,
      // Switching into a preset snaps config to that preset. Switching into
      // `custom` leaves the current config so the user can fine-tune.
      config: band === 'custom' ? s.config : { ...PRESETS[band] },
    })),

  patchConfig: (cfg) =>
    set((s) => ({
      band: 'custom',
      config: { ...s.config, ...cfg },
    })),

  setTriggerEnabled: (trigger, on) =>
    set((s) => ({
      band: 'custom',
      triggerEnabled: { ...s.triggerEnabled, [trigger]: on },
    })),

  mayFire: (trigger) => {
    const { band, config, firedToday, lastFired, triggerEnabled } = get();
    if (band === 'silent') return false;
    if (!triggerEnabled[trigger]) return false;
    if (firedToday >= config.dailyCap) return false;
    if (inQuietHours(config)) return false;
    if (lastFired[trigger] && Date.now() - lastFired[trigger] < config.cooldownMin * 60_000) return false;
    return true;
  },

  recordFire: (trigger) =>
    set((s) => ({
      firedToday: s.firedToday + 1,
      lastFired: { ...s.lastFired, [trigger]: Date.now() },
    })),
}));

/**
 * Reset the daily counter. Should be wired to a midnight cron in production;
 * for the prototype we just call it on a 6-hour interval so the cap stays
 * meaningful across long sessions.
 */
export function startProactivenessDailyReset() {
  const tick = () => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() < 15) {
      useProactiveness.setState({ firedToday: 0 });
    }
  };
  const id = setInterval(tick, 15 * 60 * 1000);
  return () => clearInterval(id);
}

export { ALL_TRIGGERS };