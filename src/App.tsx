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