import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { SystemRail } from './components/SystemRail';
import { AvatarStage } from './components/AvatarStage';
import { Conversation } from './components/Conversation';
import { Composer } from './components/Composer';
import { TaskBoard } from './components/TaskBoard';
import { useSession } from './state/session';
import './App.css';

/**
 * Three columns, fixed rails, fluid centre.
 *
 * Left is the machine, centre is the agent, right is the work. That mapping is
 * the whole information architecture — a user should never have to ask which
 * panel a thing lives in.
 */
export default function App() {
  const boot = useSession((s) => s.boot);
  useEffect(() => { boot(); }, [boot]);

  return (
    <div className="app">
      <div className="app__bg" aria-hidden>
        <span className="app__vignette" />
        <span className="app__scan" />
      </div>

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
    </div>
  );
}
