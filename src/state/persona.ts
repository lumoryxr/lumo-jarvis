import { create } from 'zustand';
import type {
  Emotion, Memory, Mood, PersonaAction, PersonaPreset, Proposal,
} from '../core/types';
import * as memoryStore from '../services/memory';

/* ---------------------------------------------------------- persistence (P1-D) */

/** LocalStorage shape for the persona's emotional state. Versioned so we
 *  can evolve the schema without losing existing users. */
const PERSIST_KEY = 'lumo.persona.v1';
const PERSIST_VERSION = 1;
interface PersistedPersona {
  version: number;
  mood: Mood;
  emotion: Emotion;
  emotionIntensity: number;
  savedAt: number;
}

function readBlob(): PersistedPersona | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== PERSIST_VERSION) return null;
    if (!obj.mood || typeof obj.mood.valence !== 'number') return null;
    return obj as PersistedPersona;
  } catch {
    return null;
  }
}

function writeBlob(partial: Pick<PersistedPersona, 'mood' | 'emotion' | 'emotionIntensity'>) {
  try {
    const blob: PersistedPersona = {
      version: PERSIST_VERSION,
      savedAt: Date.now(),
      ...partial,
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));
  } catch {
    /* private mode / quota — fail silently. */
  }
}

function hydrateMood(): Mood | null {
  const b = readBlob();
  // Stale protection: a mood snapshot older than 7 days gets discarded
  // so we don't render an old "tired of you" mood at the next session.
  if (!b || Date.now() - b.savedAt > 7 * 24 * 3600 * 1000) return null;
  return b.mood;
}
function hydrateEmotion(): Emotion | null {
  const b = readBlob();
  if (!b || Date.now() - b.savedAt > 7 * 24 * 3600 * 1000) return null;
  return b.emotion;
}

/**
 * Companion-persona store.
 *
 * Lives next to `session.ts` on purpose: the assistant core (agent state,
 * tasks, conversation) and the persona (mood, memory, proposals) have
 * different lifecycles and shouldn't fight over a single zustand store. They
 * communicate through `ProviderEvent`s on the wire, never by reaching into
 * each other's state directly.
 *
 * This is the *consumer* side: it doesn't emit anything, it only reflects
 * what the provider pushed. The actual persona logic lives in the provider
 * (see `services/mock.ts` for the prototype scripts).
 *
 * Design rules baked in here:
 *   - `Mood` is a vector, not a single emotion — smooth interpolation lives
 *     in `useCompanionMood`, never in the store.
 *   - `Memory` only ever *loses* confidence here (decay tick). Boosts
 *     happen on the producer side when the user re-confirms.
 *   - `proposals[]` is a bounded ring — old ones expire, never grow.
 */

/** Stable neutral starting point so the avatar isn't jarring on first frame. */
export const NEUTRAL_MOOD: Mood = { valence: 0, arousal: 0, dominance: 0, intimacy: 0.2 };

/** Each preset carries a *baseline mood* so the avatar doesn't reset to zero
 *  when no event has fired for a while. */
export const PERSONA_BASELINE: Record<PersonaPreset, Mood> = {
  warm_curious:       { valence: 0.45, arousal: 0.20, dominance: 0.05, intimacy: 0.30 },
  playful_witty:      { valence: 0.55, arousal: 0.45, dominance: 0.10, intimacy: 0.25 },
  gentle_caring:      { valence: 0.40, arousal: -0.10, dominance: -0.10, intimacy: 0.40 },
  cool_professional:  { valence: 0.10, arousal: 0.10, dominance: 0.30, intimacy: 0.15 },
  energetic_cheerful: { valence: 0.65, arousal: 0.65, dominance: 0.15, intimacy: 0.30 },
  calm_introspective: { valence: 0.20, arousal: -0.30, dominance: 0.00, intimacy: 0.35 },
  teasing_flirty:     { valence: 0.55, arousal: 0.35, dominance: 0.10, intimacy: 0.45 },
  mature_warm:        { valence: 0.35, arousal: 0.05, dominance: 0.25, intimacy: 0.45 },
};

interface PersonaState {
  /** The persona the user picked (or that defaulted). */
  preset: PersonaPreset;
  /** Display name — defaults to a flavour appropriate for the preset. */
  name: string;
  /** Last-pushed mood from the provider (raw, not interpolated). */
  mood: Mood;
  /** Current emotion label + intensity, set by emotion events. */
  emotion: Emotion;
  emotionIntensity: number;
  /** What triggered the last emotion — useful for UI tooltips / debug. */
  emotionTrigger?: string;
  /** Most-recent small action she performed (clears after `durationMs`). */
  lastAction?: PersonaAction;
  /** Memories the provider has surfaced this session. */
  memories: Memory[];
  /** Active proposals waiting for the user to notice / approve. */
  proposals: Proposal[];
  /** Whether the proactive-suggestion layer is enabled (default on). */
  proactiveness: 'silent' | 'companion' | 'chatty' | 'custom';

  /* -- P1-G: persona tunables --------------------------------------- */
  /** How freely she volunteers extra context. -1 sparse, +1 chatty. */
  tunables: { openness: number; playfulness: number; directness: number };
  setTunable: (key: 'openness' | 'playfulness' | 'directness', value: number) => void;

  /* -- M6-B: voice identity --------------------------------------- */
  /** Voice URI from the system speechSynthesis list. Persisted to
   *  localStorage so the user doesn't have to re-pick every boot. */
  voiceURI: string | null;
  /** Language tag for the synthesiser — usually matched to the
   *  voiceURI but kept separate so we can swap providers. */
  voiceLang: string;
  setVoice: (uri: string | null, lang: string) => void;

  /* -- setters driven by ProviderEvents ---------------------------------- */
  setPersona: (preset: PersonaPreset, name: string) => void;
  pushMood: (mood: Mood) => void;
  pushEmotion: (emotion: Emotion, intensity: number, trigger?: string) => void;
  pushAction: (action: PersonaAction) => void;
  pushProposal: (p: Proposal) => void;
  dismissProposal: (id: string) => void;
  addMemory: (m: Memory) => void;
  removeMemory: (id: string) => void;
  setProactiveness: (p: PersonaState['proactiveness']) => void;
}

const DEFAULT_PRESET: PersonaPreset = 'teasing_flirty';
const DEFAULT_NAME = 'Lumina';

const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_DECAY_PER_DAY = 0.04;
const MAX_MEMORIES = 60;
const MAX_PROPOSALS = 12;

export const usePersona = create<PersonaState>((set, get) => ({
  preset: DEFAULT_PRESET,
  name: DEFAULT_NAME,
  // P1-D: hydrate mood + last emotion from disk so the avatar greets you
  // the way you left her, not the way she starts. Falls back to the
  // preset baseline on first run.
  mood: hydrateMood() ?? { ...PERSONA_BASELINE[DEFAULT_PRESET] },
  emotion: hydrateEmotion() ?? 'neutral',
  emotionIntensity: 0.3,
  lastAction: undefined,
  // P0-C: hydrate from persistent storage on boot so memories survive reloads.
  memories: memoryStore.listAll(),
  proposals: [],
  proactiveness: 'companion',

  // P1-G: persona tunables — adjusted in the settings wizard.
  tunables: { openness: 0, playfulness: 0, directness: 0 },

  // M6-B: voice identity — read from localStorage on boot.
  voiceURI: (typeof window !== 'undefined' && localStorage.getItem('lumo.voice.uri')) || null,
  voiceLang: (typeof window !== 'undefined' && localStorage.getItem('lumo.voice.lang')) || 'zh-CN',

  setPersona: (preset, name) =>
    set({ preset, name, mood: { ...PERSONA_BASELINE[preset] } }),

  pushMood: (mood) => {
    set({ mood });
    // P1-D: persist on every mood update so the avatar greets you the
    // way you left her. Throttled by the OS writing one localStorage entry.
    writeBlob({
      mood,
      emotion: get().emotion,
      emotionIntensity: get().emotionIntensity,
    });
  },

  pushEmotion: (emotion, intensity, trigger) => {
    set({ emotion, emotionIntensity: intensity, emotionTrigger: trigger });
    writeBlob({
      mood: get().mood,
      emotion,
      emotionIntensity: intensity,
    });
  },

  pushAction: (action) => {
    set({ lastAction: action });
    // Auto-clear after a typical micro-action so it can fire again.
    const ms = action === 'stretch' || action === 'yawn' ? 1600
             : action === 'laugh' ? 900
             : 700;
    setTimeout(() => {
      // Only clear if it's still the same action — newer one wins.
      set((s) => (s.lastAction === action ? { lastAction: undefined } : s));
    }, ms);
  },

  pushProposal: (p) => set((s) => {
    // Dedupe by trigger — only one pending suggestion of each kind.
    const filtered = s.proposals.filter((x) => x.trigger !== p.trigger);
    return {
      proposals: [p, ...filtered].slice(0, MAX_PROPOSALS)
        // Drop any that are already past their expiry.
        .filter((x) => x.expiresAt > Date.now()),
    };
  }),

  dismissProposal: (id) =>
    set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) })),

  addMemory: (m) => {
    const stored = memoryStore.upsert(m);
    set((s) => {
      // Same-content dedup also in store so React sees the bump.
      const i = s.memories.findIndex((x) => x.content === m.content);
      if (i >= 0) {
        const next = [...s.memories];
        next[i] = stored;
        return { memories: next };
      }
      return { memories: [stored, ...s.memories].slice(0, MAX_MEMORIES) };
    });
  },

  removeMemory: (id) => {
    memoryStore.remove(id);
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
  },

  setProactiveness: (proactiveness) => set({ proactiveness }),

  setTunable: (key, value) => {
    const clamped = Math.max(-1, Math.min(1, value));
    set((s) => ({ tunables: { ...s.tunables, [key]: clamped } }));
  },

  // M6-B: voice identity setter. Mirrors the value into localStorage
  // so it survives reloads and isn't lost when the user reopens the
  // wizard. The TTS layer picks it up via a useEffect (see App.tsx).
  setVoice: (uri, lang) => {
    if (typeof window !== 'undefined') {
      if (uri) localStorage.setItem('lumo.voice.uri', uri);
      else localStorage.removeItem('lumo.voice.uri');
      localStorage.setItem('lumo.voice.lang', lang);
    }
    set({ voiceURI: uri, voiceLang: lang });
  },
}));

/* ------------------------------------------------------------------ hooks */

/**
 * Smoothed mood read for the avatar — the avatar itself does the
 * cross-fade in its render loop (see HoloCore.setMood), so consumers just
 * read the target value here.
 */
export function useCompanionMood() {
  return usePersona((s) => s.mood);
}

/**
 * Decay memories on a 6-hour tick. Decay is delegated to the persistent
 * store, then the in-memory cache is refreshed from disk so React sees the
 * change in one place. Intended for Tauri-side scheduling in production.
 */
export function startMemoryDecay() {
  const tick = () => {
    const next = memoryStore.decay(MEMORY_DECAY_PER_DAY);
    if (next.length !== usePersona.getState().memories.length) {
      usePersona.setState({ memories: next });
    }
  };
  const id = setInterval(tick, 6 * 60 * 60 * 1000);
  return () => clearInterval(id);
}

/* ----------------------------------------------- p0-c: prompt builder */

/**
 * Compose a prompt-ready string of high-confidence memories grouped by kind.
 * Re-exported here so callers don't need to know about `services/memory.ts`.
 */
export function usePersonaContext(opts: Parameters<typeof memoryStore.buildPersonaContext>[0] = {}) {
  // Subscribe to memory changes so the prompt stays fresh.
  usePersona((s) => s.memories);
  return memoryStore.buildPersonaContext(opts);
}

/** Synchronous variant for non-React callers. */
export const buildPersonaContext = memoryStore.buildPersonaContext;

/** Re-export for convenience so components can `import { ... } from '../state/persona'`. */
export { PROPOSAL_TTL_MS };