import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { SystemRail } from './components/SystemRail';
import { AvatarStage } from './components/AvatarStage';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import { TaskBoard } from './components/TaskBoard';
import { CompanionWidget } from './components/CompanionWidget';
import { MemoryConsole } from './components/MemoryConsole';
import OnboardingWizard, { useIsOnboarded, openOnboardingAt } from './components/OnboardingWizard';
import { ActivityPanel, toggleActivityPanel } from './components/ActivityPanel';
import { ConnectorsModal } from './components/ConnectorsModal';
import { useOnboarding } from './state/onboarding';
import { useSession, provider } from './state/session';
import { usePersona } from './state/persona';
import { useWindowMode, installWindowModeHotkeys } from './state/windowMode';
import { useVoiceLoop } from './hooks/useVoiceLoop';
import './App.css';

/**
 * Three columns, fixed rails, fluid centre.
 *
 * P0-B: when `windowMode` is `widget` or `minimized`, the three-column
 * layout is hidden and only the `CompanionWidget` shows.
 *
 * P0-C: `MemoryConsole` is always mounted and toggles itself via Cmd+.
 *
 * P0-E: `OnboardingWizard` blocks the rest of the UI until the user has
 * walked through the five-step config. Once committed, it never shows
 * again unless reopened from the TopBar (`reconfigure`).
 *
 * P1-E: ConnectorsModal opens via Cmd+. — a single page covering every
 * connector's status, latency, last events, and manual override buttons.
 */
export default function App() {
  const boot = useSession((s) => s.boot);
  const mode = useWindowMode((s) => s.mode);
  const onboarded = useIsOnboarded();
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  // M3-F: continuous listening toggle. Cmd+Shift+V flips it on/off.
  // While enabled, the avatar speaks back what it hears, barge-in
  // aborts the current utterance, and a 800ms silence commits a turn.
  const [voiceLoop, setVoiceLoop] = useState(false);
  useVoiceLoop({ enabled: voiceLoop });

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => installWindowModeHotkeys(), []);

    // M6-D: subscribe to global-shortcut events emitted by Rust.
    // The Cmd+Shift+V shortcut (registered in src-tauri/src/global_shortcuts.rs)
    // fires a lumo:event shortcut message that we map to the same
    // voiceLoop toggle the in-app Cmd+Shift+V handler uses.
    useEffect(() => {
      const t = (window as unknown as {
        __TAURI_INTERNALS__?: unknown;
      }).__TAURI_INTERNALS__;
      if (!t) return;
      (async () => {
        const evt = await import('@tauri-apps/api/event').catch(() => null);
        if (!evt) return;
        const un = await evt.listen<{ kind: string; key: string }>('lumo:event', (e) => {
          if (e.payload.kind === 'shortcut' && e.payload.key === 'ctrlShift+V') {
            setVoiceLoop((v) => !v);
          }
        });
        return () => un();
      })();
    }, []);

    // M6-F: bridge voiceLoop state into window for TopBar's mic pill.
    useEffect(() => {
      (window as unknown as { __lumoVoiceLoop?: boolean }).__lumoVoiceLoop = voiceLoop;
    }, [voiceLoop]);

  // M6-B: bridge the persona's voice identity into window so the
  // speechSynthesis layer (services/voice.ts) can read it on each
  // speak(). Plain zustand subscriptions inside voice.ts would
  // couple the speech engine to React's lifecycle.
  const persona = usePersona();
  useEffect(() => {
    (window as unknown as { __lumoPersona?: unknown }).__lumoPersona = {
      voiceURI: persona.voiceURI,
      voiceLang: persona.voiceLang,
    };
  }, [persona.voiceURI, persona.voiceLang]);

  // Cmd+, → wizard reconfigure. Cmd+M → activity panel.
  // Cmd+. → connector page (P1-E).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === ',' && !e.shiftKey) { e.preventDefault(); openOnboardingAt(0); return; }
        if (e.key.toLowerCase() === 'm' && !e.shiftKey) { e.preventDefault(); toggleActivityPanel(); return; }
        if (e.key === '.' && !e.shiftKey) { e.preventDefault(); setConnectorsOpen((v) => !v); return; }
                if (e.key.toLowerCase() === 'v' && e.shiftKey) { e.preventDefault(); setVoiceLoop((v) => !v); return; }
              }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wizard is blocking — render only it until completed.
  if (!onboarded) return <OnboardingWizard />;

  // Initial mount after the wizard commits: push the persisted choices into
  // the persona + proactiveness stores so the avatar is named correctly on
  // first paint. The wizard handles its own applyTo on the reopen path; this
  // covers the first-commit path where the wizard itself unmounts.
  useOnboarding.getState().applyTo();

  // P0-F: now that persona.name is correct, trigger the greeting on the
  // backend (if the provider supports it). MockBackend.greetNow() is a
  // no-op for providers without first-contact logic.
  provider.greetNow?.();

  return (
    <div className="app">
      <div className="app__bg" aria-hidden>
        <span className="app__vignette" />
        <span className="app__scan" />
      </div>

      {mode === 'full' && (
        <>
          <TopBar />
          <main className="app__body">
            <SystemRail />
            <section className="app__center panel bracketed">
              <AvatarStage />
              <div className="app__divider" />
              <Conversation />
              <Composer />
            </section>
            <TaskBoard />
          </main>
        </>
      )}

      <CompanionWidget />
      <MemoryConsole />
      <ActivityPanel />
      <ConnectorsModal open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
    </div>
  );
}