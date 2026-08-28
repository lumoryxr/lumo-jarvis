import { create } from 'zustand';
import type { PersonaPreset } from '../core/types';
import { usePersona } from './persona';
import { useProactiveness } from './proactiveness';

/**
 * First-run onboarding.
 *
 * Five steps, each one narrow and skippable. The wizard is *blocking* —
 * until `completed` is true, App.tsx renders only the wizard and not the
 * three-column workstation. The user can reopen it later from the TopBar
 * (`reconfigure`) which jumps to any step.
 *
 * Persistence: localStorage `lumo.onboarding.v1`. The schema is versioned
 * so a future redesign can rebuild without losing a returning user's
 * prior choices.
 *
 * Persona choices also flow into the persona store (name + preset) and
 * the proactiveness store (band + quiet hours) at commit time. After
 * commit those stores own the values; this store is just the wizard's
 * scratchpad.
 */

const STORAGE_KEY = 'lumo.onboarding.v1';
const SCHEMA_VERSION = 1;

export interface OnboardingChoices {
  preset: PersonaPreset;
  name: string;
  /** Voice id — used at M4 when TTS gets wired. */
  voiceId: string;
  proactivenessBand: 'silent' | 'companion' | 'chatty' | 'custom';
  quietStart: number;
  quietEnd: number;
}

export const DEFAULT_CHOICES: OnboardingChoices = {
  preset: 'teasing_flirty',
  name: 'Lumina',
  voiceId: 'zh-CN-XiaoxiaoNeural',
  proactivenessBand: 'companion',
  quietStart: 22,
  quietEnd: 8,
};

interface Persisted {
  version: number;
  completed: boolean;
  choices: OnboardingChoices;
  /** Last step the user was on — for the re-open UX to resume mid-flow. */
  lastStep: number;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank();
    const p = JSON.parse(raw) as Persisted;
    if (!p || p.version !== SCHEMA_VERSION) return blank();
    return {
      version: SCHEMA_VERSION,
      completed: !!p.completed,
      choices: { ...DEFAULT_CHOICES, ...p.choices },
      lastStep: typeof p.lastStep === 'number' ? p.lastStep : 0,
    };
  } catch {
    return blank();
  }
}
function blank(): Persisted {
  return { version: SCHEMA_VERSION, completed: false, choices: DEFAULT_CHOICES, lastStep: 0 };
}

interface OnboardingState extends OnboardingChoices {
  /** `true` once the user has clicked through to the done screen. */
  completed: boolean;
  /** Index of the currently visible step (0..4). */
  step: number;
  /** Persisted last-step — separate from in-flight `step` so we can resume. */
  lastStep: number;

  setStep: (n: number) => void;
  next: () => void;
  back: () => void;
  setPreset: (p: PersonaPreset) => void;
  setName: (n: string) => void;
  setVoiceId: (v: string) => void;
  setProactivenessBand: (b: OnboardingChoices['proactivenessBand']) => void;
  setQuietHours: (start: number, end: number) => void;
  /** Persist current choices and mark onboarding as done. */
  commit: () => void;
  /** Push the current choices into the persona + proactiveness stores. */
  applyTo: () => void;
  /** Reopen the wizard at a chosen step. Does not touch `completed` until `commit()`. */
  reopen: (step?: number) => void;
  /** Wipe stored state — for testing / "reset personality" in settings. */
  reset: () => void;
}

export const useOnboarding = create<OnboardingState>((set) => {
  const initial = load();

  // Persist on any state change. We subscribe inside the factory so it
  // lives for the lifetime of the singleton (zustand factory has no cleanup).
  queueMicrotask(() => useOnboarding.subscribe(persist));

  return {
    ...initial.choices,
    completed: initial.completed,
    step: initial.lastStep,
    lastStep: initial.lastStep,

    setStep: (step) => set({ step, lastStep: step }),
    next: () => set((s) => ({ step: Math.min(s.step + 1, 4), lastStep: Math.min(s.step + 1, 4) })),
    back: () => set((s) => ({ step: Math.max(s.step - 1, 0), lastStep: Math.max(s.step - 1, 0) })),

    setPreset: (preset) => set((s) => ({
      preset,
      // Preset-aligned defaults: name + voice change together so the
      // preset doesn't read as the previous preset with a mismatched name.
      ...(s.name === '' || presetMatches(s.preset, s.name) ? { name: DEFAULT_NAMES[preset] } : {}),
    })),
    setName: (name) => set({ name: name.trim().slice(0, 16) || DEFAULT_CHOICES.name }),
    setVoiceId: (voiceId) => set({ voiceId }),
    setProactivenessBand: (band) => set({ proactivenessBand: band }),
    setQuietHours: (quietStart, quietEnd) => set({ quietStart, quietEnd }),

    commit: () => set({ completed: true }),

    /** Apply the current choices to the persona + proactiveness stores.
   *  Call after `commit()` (or directly when reopening to refresh). */
  applyTo: () => {
    const s = useOnboarding.getState();
    usePersona.getState().setPersona(s.preset, s.name);
    useProactiveness.getState().setBand(s.proactivenessBand);
    if (s.proactivenessBand === 'custom') {
      useProactiveness.getState().patchConfig({
        quietStart: s.quietStart,
        quietEnd: s.quietEnd,
      });
    }
  },

    reopen: (step) => set({ completed: false, step: step ?? 0, lastStep: step ?? 0 }),

    reset: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      set({ ...DEFAULT_CHOICES, completed: false, step: 0, lastStep: 0 });
    },
  };
});

function persist() {
  try {
    const s = useOnboarding.getState();
    const blob: Persisted = {
      version: SCHEMA_VERSION,
      completed: s.completed,
      lastStep: s.lastStep,
      choices: {
        preset: s.preset,
        name: s.name,
        voiceId: s.voiceId,
        proactivenessBand: s.proactivenessBand,
        quietStart: s.quietStart,
        quietEnd: s.quietEnd,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch { /* ignore */ }
}

/* ---------------------------------------------- preset catalogue */

/** Name each preset ships with when the user hasn't picked one. */
export const DEFAULT_NAMES: Record<PersonaPreset, string> = {
  warm_curious:       'Lumina',
  playful_witty:      'Mira',
  gentle_caring:      'Aria',
  cool_professional:  'Vega',
  energetic_cheerful: 'Sunny',
  calm_introspective: 'Wren',
  teasing_flirty:     'Lumina',
  mature_warm:        'Iris',
};

/** Voices grouped by preset for the voice picker. */
export const VOICE_CATALOGUE: { id: string; label: string; tone: string }[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓(温柔知性)', tone: '温柔,细腻' },
  { id: 'zh-CN-YunxiNeural',    label: '云希(年轻活泼)', tone: '元气,爽朗' },
  { id: 'zh-CN-YunyangNeural',  label: '云扬(成熟磁性)', tone: '稳重,磁声' },
  { id: 'zh-CN-XiaoyiNeural',   label: '晓伊(治愈系)',   tone: '柔软,治愈' },
];

export const PRESET_CATALOGUE: {
  id: PersonaPreset;
  emoji: string;
  tagline: string;
  description: string;
}[] = [
  { id: 'warm_curious',       emoji: '◐', tagline: '温暖好奇',   description: '像邻家姐姐,会问你今天怎么样,也会自己好奇很多事。' },
  { id: 'playful_witty',      emoji: '◇', tagline: '活泼机智',   description: '爱吐槽也爱接梗,说话带点俏皮,但分寸拿捏得很好。' },
  { id: 'gentle_caring',      emoji: '♡', tagline: '温柔体贴',   description: '情绪稳定,会主动给你倒杯水,听你讲完一整天才回应。' },
  { id: 'cool_professional',  emoji: '◆', tagline: '冷静专业',   description: '做事为主,情感不挂在嘴上,该出手时干脆利落。' },
  { id: 'energetic_cheerful', emoji: '✦', tagline: '元气满满',   description: '永远精力充沛,你刚起床她已经在笑。适合需要打气的日子。' },
  { id: 'calm_introspective', emoji: '○', tagline: '沉静内敛',   description: '说话少,但每句都有重量。适合深夜和安静的人。' },
  { id: 'teasing_flirty',     emoji: '✿', tagline: '爱撒娇',     description: '默认,虚拟女友路线。会主动撩,但被瞪一眼就乖。' },
  { id: 'mature_warm',        emoji: '◈', tagline: '成熟温和',   description: '像知心姐姐,不黏不冷,你知道她一直都在。' },
];

function presetMatches(_preset: PersonaPreset, name: string): boolean {
  return Object.values(DEFAULT_NAMES).includes(name);
}