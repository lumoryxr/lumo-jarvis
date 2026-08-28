import type { Memory } from '../core/types';

/**
 * Persistent memory store.
 *
 * In Tauri this becomes a SQLite table; for the browser prototype we use
 * `localStorage`. The shape we expose is the same either way so the rest of
 * the app never knows what's underneath.
 *
 * Trust rules baked in here, not in the consumer:
 *   - `confidence < 0.3` memories are never returned by `search()`.
 *   - `delete` and `clear` are *immediate* — there is no soft-delete. Users
 *     can re-export a snapshot before wiping (the Console surfaces this).
 *   - The persisted blob is versioned so we can migrate when the schema
 *     evolves without losing older memories on next boot.
 */

const STORAGE_KEY = 'lumo.memories.v1';
const SCHEMA_VERSION = 1;
const MAX_MEMORIES = 200;

interface Persisted {
  version: number;
  memories: Memory[];
}

function load(): Memory[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || parsed.version !== SCHEMA_VERSION) {
      // Future migrations go here. For now, any version mismatch = wipe.
      return [];
    }
    // Defensive: drop any malformed entries.
    return (parsed.memories ?? []).filter(isWellFormed);
  } catch {
    return [];
  }
}

function save(memories: Memory[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    const blob: Persisted = { version: SCHEMA_VERSION, memories };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    /* private mode / quota — fine to lose; the in-memory store still works */
  }
}

function isWellFormed(m: unknown): m is Memory {
  if (!m || typeof m !== 'object') return false;
  const x = m as Memory;
  return (
    typeof x.id === 'string'
    && typeof x.content === 'string'
    && typeof x.ts === 'number'
    && typeof x.confidence === 'number'
    && ['fact', 'preference', 'event', 'emotion', 'goal'].includes(x.kind)
    && ['told', 'inferred', 'observed'].includes(x.source)
  );
}

/* ----------------------------------------------------- in-memory cache */

/**
 * Module-level cache so the persona store doesn't pay a `localStorage`
 * round-trip on every read. Writes are mirrored to disk synchronously —
 * small enough.
 */
let cache: Memory[] | null = null;
function getCache(): Memory[] {
  if (cache === null) cache = load();
  return cache;
}
function setCache(next: Memory[]) {
  cache = next;
  save(next);
}

/* ----------------------------------------------------------- public api */

/** All memories, sorted newest first. */
export function listAll(): Memory[] {
  return [...getCache()].sort((a, b) => b.ts - a.ts);
}

/** Wipe everything. Returns count removed. */
export function clear(): number {
  const n = getCache().length;
  setCache([]);
  return n;
}

/** Remove one by id. */
export function remove(id: string): boolean {
  const next = getCache().filter((m) => m.id !== id);
  if (next.length === getCache().length) return false;
  setCache(next);
  return true;
}

/** Remove every memory matching `predicate`. Returns count removed. */
export function removeWhere(predicate: (m: Memory) => boolean): number {
  const before = getCache().length;
  const next = getCache().filter((m) => !predicate(m));
  setCache(next);
  return before - next.length;
}

/**
 * Insert or strengthen a memory.
 *
 * Dedup rules:
 *   - Exact-content match: bump confidence by `+0.15` (capped at 1), refresh ts.
 *   - Otherwise: prepend, evict lowest-confidence if over `MAX_MEMORIES`.
 */
export function upsert(m: Memory): Memory {
  const cur = getCache();
  const i = cur.findIndex((x) => x.content === m.content);
  if (i >= 0) {
    const next = [...cur];
    next[i] = {
      ...next[i],
      confidence: Math.min(1, next[i].confidence + 0.15),
      ts: Math.max(next[i].ts, m.ts),
    };
    setCache(next);
    return next[i];
  }
  const next = [m, ...cur];
  if (next.length > MAX_MEMORIES) {
    // Drop the lowest-confidence old memory, never the just-added one.
    let dropIdx = -1;
    let lowest = Infinity;
    for (let k = 1; k < next.length; k++) {
      const c = next[k].confidence;
      if (c < lowest) { lowest = c; dropIdx = k; }
    }
    if (dropIdx > 0) next.splice(dropIdx, 1);
    else next.length = MAX_MEMORIES;
  }
  setCache(next);
  return m;
}

/**
 * Search memories by keyword + tag.
 *
 * Scoring (per match):
 *   exact word match       → +1.0
 *   substring match        → +0.5
 *   kind match             → +0.3
 *   source = 'told'        → +0.4  (we trust what the user says)
 *   confidence multiplier  → × confidence (0..1)
 *
 * Results above `minConfidence` (default 0.3) only. Caller can override.
 */
export function search(query: string, opts: { minConfidence?: number; limit?: number } = {}): Memory[] {
  const minC = opts.minConfidence ?? 0.3;
  const limit = opts.limit ?? 8;
  const q = query.trim().toLowerCase();
  if (!q) return listAll().filter((m) => m.confidence >= minC).slice(0, limit);

  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { memory: Memory; score: number }[] = [];

  for (const m of getCache()) {
    if (m.confidence < minC) continue;
    const haystack = m.content.toLowerCase();
    let score = 0;
    let contentMatched = false;
    for (const t of terms) {
      const re = new RegExp(`\\b${escapeRe(t)}\\b`, 'i');
      if (re.test(haystack)) { score += 1.0; contentMatched = true; }
      else if (haystack.includes(t)) { score += 0.5; contentMatched = true; }
    }
    // Boosts only apply when the content actually matched something.
    // Otherwise an empty search via kind/source would surface everything.
    if (contentMatched) {
      if (m.kind === q) score += 0.3;
      if (m.source === 'told') score += 0.4;
      if (score > 0) {
        scored.push({ memory: m, score: score * m.confidence });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.memory);
}

/**
 * Compose a prompt-ready string of high-confidence memories grouped by kind.
 * Used by the LLM side at runtime; for the prototype it's a UI affordance
 * (the Console surfaces this) and a mock for the system prompt builder.
 */
export function buildPersonaContext(opts: { maxPerKind?: number; minConfidence?: number } = {}): string {
  const max = opts.maxPerKind ?? 3;
  const minC = opts.minConfidence ?? 0.4;
  const all = listAll().filter((m) => m.confidence >= minC);
  if (!all.length) return '';

  const groups = new Map<Memory['kind'], Memory[]>();
  for (const m of all) {
    const arr = groups.get(m.kind) ?? [];
    arr.push(m);
    groups.set(m.kind, arr);
  }

  const order: Memory['kind'][] = ['preference', 'fact', 'goal', 'event', 'emotion'];
  const lines: string[] = ['关于用户的我知道:'];
  for (const kind of order) {
    const arr = groups.get(kind);
    if (!arr?.length) continue;
    arr.sort((a, b) => b.confidence - a.confidence);
    for (const m of arr.slice(0, max)) {
      const conf = Math.round(m.confidence * 100);
      const origin = m.source === 'told' ? '直接说过' : m.source === 'inferred' ? '我猜的' : '我看到的';
      lines.push(`  - [${kind}|${conf}%] ${m.content} (${origin})`);
    }
  }
  return lines.join('\n');
}

/* --------------------------------------------------------------- export */

/** Snapshot the entire memory store as JSON for backup / portability. */
export function exportJSON(): string {
  return JSON.stringify(
    { version: SCHEMA_VERSION, exportedAt: Date.now(), memories: listAll() },
    null,
    2,
  );
}

/** Trigger a browser download of the JSON snapshot. No-op outside the browser. */
export function downloadExport(): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumo-memories-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Stats for the Console header. */
export function stats(): {
  total: number;
  byKind: Record<Memory['kind'], number>;
  avgConfidence: number;
  oldest?: number;
  newest?: number;
} {
  const all = listAll();
  const byKind: Record<Memory['kind'], number> = {
    fact: 0, preference: 0, event: 0, emotion: 0, goal: 0,
  };
  let sum = 0;
  for (const m of all) {
    byKind[m.kind] += 1;
    sum += m.confidence;
  }
  return {
    total: all.length,
    byKind,
    avgConfidence: all.length ? sum / all.length : 0,
    oldest: all.length ? Math.min(...all.map((m) => m.ts)) : undefined,
    newest: all.length ? Math.max(...all.map((m) => m.ts)) : undefined,
  };
}

/* ------------------------------------------------------------- helpers */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run memory decay. Intended to be called from a Tauri command on a
 * background tick in production; for the prototype we call it from
 * `startMemoryDecay()` in `state/persona.ts`.
 *
 * Returns the new list (in-memory + persisted).
 */
export function decay(ratePerDay: number, floor = 0.3): Memory[] {
  const cur = getCache();
  const next = cur
    .map((m) => ({
      ...m,
      confidence: Math.max(0, m.confidence - ratePerDay / 4),
    }))
    .filter((m) => m.confidence >= floor);
  setCache(next);
  return next;
}

/**
 * Hydrate the in-memory cache from a freshly-saved list. Useful for the
 * boot path or after a restore-from-export.
 */
export function hydrate(memories: Memory[]): void {
  const cleaned = memories.filter(isWellFormed);
  setCache(cleaned);
}