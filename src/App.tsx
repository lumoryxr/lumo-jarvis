import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { SystemRail } from './components/SystemRail';
import { AvatarStage } from './components/AvatarStage';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import { TaskBoard } from './components/TaskBoard';
import { CompanionWidget } from './components/CompanionWidget';
import { MemoryConsole } from './components/MemoryConsole';
import OnboardingWizard, { useIsOnboarded, openOnboardingAt } from './components/OnboardingWizard';
import { useOnboarding } from './state/onboarding';
import { useSession, provider } from './state/session';
import { useWindowMode, installWindowModeHotkeys } from './state/windowMode';
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
 */
export default function App() {
  const boot = useSession((s) => s.boot);
  const mode = useWindowMode((s) => s.mode);
  const onboarded = useIsOnboarded();

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => installWindowModeHotkeys(), []);
  // Cmd+, opens the wizard back to step 0 (reconfigure).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openOnboardingAt(0);
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
    </div>
  );
}