import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Window-mode controller.
 *
 * Companion-product semantics:
 *   - `full`      — the original three-column workstation
 *   - `widget`    — the avatar-only bubble docked in the screen corner;
 *                   the "always-present" mode that makes her feel like she
 *                   lives in your desktop rather than only appears when you
 *                   summon her
 *   - `minimized` — collapsed to a 64px breathing dot; she's still "on" but
 *                   deliberately out of your way
 *
 * Position is remembered between sessions via localStorage so the widget
 * lands where the user last parked it. Drag is owned by the widget itself
 * (see `CompanionWidget.tsx`); this store is the single source of truth.
 */

const STORAGE_KEY = 'lumo.windowMode.v1';

interface Persisted {
  mode: WindowMode;
  pos: { x: number; y: number };
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: 'full', pos: defaultPos() };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      mode: parsed.mode ?? 'full',
      pos: parsed.pos && Number.isFinite(parsed.pos.x) && Number.isFinite(parsed.pos.y)
        ? parsed.pos
        : defaultPos(),
    };
  } catch {
    return { mode: 'full', pos: defaultPos() };
  }
}

function defaultPos(): { x: number; y: number } {
  // 24px inset from the bottom-right corner.
  if (typeof window === 'undefined') return { x: -1, y: -1 };
  return {
    x: window.innerWidth - 304,
    y: window.innerHeight - 440,
  };
}

export type WindowMode = 'full' | 'widget' | 'minimized';

interface WindowModeState {
  mode: WindowMode;
  /** Widget position in *viewport* px. -1 means "use defaultPos on next mount". */
  pos: { x: number; y: number };

  setMode: (m: WindowMode) => void;
  cycle: () => void;
  setPos: (x: number, y: number) => void;
}

export const useWindowMode = create<WindowModeState>()(
  subscribeWithSelector((set, get) => {
    const initial = load();

    // Persist on any state change.
    const persist = () => {
      try {
        const { mode, pos } = get();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, pos }));
      } catch {
        /* private mode / disabled storage — fine to lose */
      }
    };

    // Subscribe inside the store factory so it lives for the lifetime of the
    // singleton. We can't return a cleanup from a zustand factory, so we let
    // it leak — it's a single subscriber on a single store, no churn.
    queueMicrotask(() => {
      useWindowMode.subscribe(persist);
    });

    return {
      mode: initial.mode,
      pos: initial.pos,

      setMode: (mode) => set({ mode }),

      /** Quick-toggle: full → widget → minimized → full. */
      cycle: () =>
        set((s) => ({
          mode:
            s.mode === 'full' ? 'widget'
            : s.mode === 'widget' ? 'minimized'
            : 'full',
        })),

      setPos: (x, y) => {
        // Clamp inside the viewport so the widget never disappears off-screen.
        if (typeof window !== 'undefined') {
          const W = 280, H = 420;
          x = Math.max(8, Math.min(window.innerWidth - W - 8, x));
          y = Math.max(8, Math.min(window.innerHeight - H - 8, y));
        }
        set({ pos: { x, y } });
      },
    };
  }),
);

/* ----------------------------------------------------------- hotkeys */

/** `⌘L` (Mac) / `Ctrl+L` (others) — cycle the window mode from anywhere. */
export function installWindowModeHotkeys() {
  if (typeof window === 'undefined') return () => {};
  const onKey = (e: KeyboardEvent) => {
    // Don't intercept when the user is typing in an input/textarea.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      useWindowMode.getState().cycle();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** True when the user is currently in widget or minimized mode. */
export const useIsCompact = () =>
  useWindowMode((s) => s.mode !== 'full');