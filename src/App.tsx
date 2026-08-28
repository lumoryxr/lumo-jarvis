import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { SystemRail } from './components/SystemRail';
import { AvatarStage } from './components/AvatarStage';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import { TaskBoard } from './components/TaskBoard';
import { CompanionWidget } from './components/CompanionWidget';
import { MemoryConsole } from './components/MemoryConsole';
import { useSession } from './state/session';
import { useWindowMode, installWindowModeHotkeys } from './state/windowMode';
import './App.css';

/**
 * Three columns, fixed rails, fluid centre.
 *
 * Left is the machine, centre is the agent, right is the work. That mapping is
 * the whole information architecture — a user should never have to ask which
 * panel a thing lives in.
 *
 * P0-B: when `windowMode` is `widget` or `minimized`, the three-column
 * layout is hidden and only the `CompanionWidget` shows. The whole point of
 * the companion product is that she's *always* there in the corner, not
 * only when you summon the workspace.
 *
 * P0-C: `MemoryConsole` is always mounted and toggles itself via ⌘.. It's
 * the trust surface — without it, the persona is opaque.
 */
export default function App() {
  const boot = useSession((s) => s.boot);
  const mode = useWindowMode((s) => s.mode);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => installWindowModeHotkeys(), []);

  return (
    <div className="app">
      <div className="app__bg" aria-hidden>
        <span className="app__vignette" />
        <span className="app__scan" />
      </div>

      {/* The full three-column workstation is only rendered in `full` mode. */}
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

      {/* Always mounted so the canvas lifecycle hooks into the right stores.
       * The component itself early-returns null when mode === 'full'. */}
      <CompanionWidget />

      {/* P0-C: trust surface. Owns its own hotkey (⌘.) and toggles itself. */}
      <MemoryConsole />
    </div>
  );
}