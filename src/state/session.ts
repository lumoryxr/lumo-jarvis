import { create } from 'zustand';
import type {
  AgentState, Briefing, ConnectorId, ConnectorStatus, MachineSnapshot, Message, Task, TaskStatus,
} from '../core/types';
import type { Provider } from '../services/provider';
import { MockBackend } from '../services/mock';
import { DEFAULT_WATCHERS } from '../services/watchers';
import { usePersona, startMemoryDecay } from './persona';
import { useProactiveness, startProactivenessDailyReset } from './proactiveness';
import { recordActivity } from './activity';

/**
 * Single source of truth for the whole window.
 *
 * Swap the provider here to go from prototype to production:
 *   const provider: Provider = new MockBackend({ watchers: DEFAULT_WATCHERS });
 *   const provider: Provider = new TauriProvider();   // real OS + Hermes
 *
 * P0-A: persona / mood / memory lives in a *separate* zustand store
 * (`state/persona`). This keeps the assistant core (agent + tasks + machine)
 * single-purpose and avoids accidentally coupling emotional state to work
 * state. The two stores communicate only through `ProviderEvent`s on the
 * wire — see the companion-layer branches at the bottom of `boot()`.
 *
 * P0-D: `state/proactiveness` controls *whether* a watcher can fire right
 * now. The mock backend runs the actual watcher loop; the production
 * backend will do the same against real OS / Hermes signals.
 */
const provider: Provider = new MockBackend({ watchers: DEFAULT_WATCHERS });

const EMPTY_COUNTS: Record<TaskStatus, number> = {
  queued: 0, running: 0, blocked: 0, review: 0, done: 0, failed: 0, cancelled: 0,
};

/** P0-J: only record the FIRST greeting in a session. */
let greetedRecorded = false;

interface SessionState {
  agentState: AgentState;
  messages: Message[];
  tasks: Task[];
  machine: MachineSnapshot | null;
  connectors: Record<ConnectorId, ConnectorStatus | undefined>;
  selectedTaskId: string | null;
  /** 0..1, drives avatar displacement while speaking. */
  amplitude: number;

  boot: () => void;
  send: (text: string) => void;
  setAgentState: (s: AgentState) => void;
  setAmplitude: (a: number) => void;
  selectTask: (id: string | null) => void;
  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
}

export const useSession = create<SessionState>((set) => ({
  agentState: 'offline',
  messages: [
    {
      id: 'boot',
      speaker: 'jarvis',
      at: Date.now(),
      text: '早上好。所有子系统在线，工作站状态正常。\n\n有 1 个任务在跑，1 个等你拍板。要我先说汇总吗？',
    },
  ],
  tasks: [],
  machine: null,
  connectors: {} as Record<ConnectorId, ConnectorStatus | undefined>,
  selectedTaskId: null,
  amplitude: 0,

  boot: () => {
    provider.subscribe((event) => {
      switch (event.kind) {
        case 'message.start':
          set((s) => ({ messages: [...s.messages, event.message], agentState: 'thinking' }));
          // P0-J: greet arrives as message.start; record it once per session.
          if (!greetedRecorded) {
            greetedRecorded = true;
            recordActivity({
              kind: 'greeting',
              title: event.message.text || '打了个招呼',
            });
          }
          break;

        case 'message.delta':
          set((s) => ({
            agentState: 'speaking',
            messages: s.messages.map((m) => (m.id === event.id ? { ...m, text: m.text + event.text } : m)),
          }));
          break;

        case 'message.end':
          set((s) => ({
            agentState: 'idle',
            amplitude: 0,
            messages: s.messages.map((m) => (m.id === event.id ? { ...m, streaming: false } : m)),
          }));
          break;

        case 'tool.start':
          set((s) => ({
            agentState: 'acting',
            messages: s.messages.map((m) =>
              m.id === event.messageId ? { ...m, toolCalls: [...(m.toolCalls ?? []), event.call] } : m,
            ),
          }));
          break;

        case 'tool.end':
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id !== event.messageId ? m : {
                ...m,
                toolCalls: m.toolCalls?.map((c) =>
                  c.id === event.callId ? { ...c, status: event.status, output: event.output } : c,
                ),
              },
            ),
          }));
          break;

        case 'task.upsert':
          set((s) => {
            const i = s.tasks.findIndex((t) => t.id === event.task.id);
            if (i === -1) return { tasks: [event.task, ...s.tasks] };
            const prev = s.tasks[i];
            const tasks = [...s.tasks];
            tasks[i] = event.task;
            // Activity fire only on *transition* (avoid spam on every tick).
            if (prev.status !== event.task.status && (event.task.status === 'done' || event.task.status === 'failed')) {
              // P0-T: avatar reacts to outcomes.
              if (event.task.status === 'done')  usePersona.getState().pushEmotion('happy', 0.7, 'task done');
              if (event.task.status === 'failed') usePersona.getState().pushEmotion('sad',   0.6, 'task failed');
              recordActivity({
                kind: event.task.status === 'done' ? 'task_completed' : 'task_failed',
                title: event.task.status === 'done' ? `完成：${event.task.title}` : `失败：${event.task.title}`,
                detail: event.task.result,
                ref: { kind: 'task', id: event.task.id },
              });
            }
            return { tasks };
          });
          break;

        case 'machine':
          set({ machine: event.snapshot });
          break;

        case 'connector':
          set((s) => ({ connectors: { ...s.connectors, [event.status.id]: event.status } }));
          break;

        /* P0-A — companion-layer events. Routed straight into the persona
         * store. The session store stays single-purpose: agent + tasks +
         * machine. Persona has its own lifecycle. */
        case 'mood':
          usePersona.getState().pushMood(event.mood);
          break;
        case 'emotion':
          usePersona.getState().pushEmotion(event.emotion, event.intensity, event.trigger);
          break;
        case 'persona-action':
          usePersona.getState().pushAction(event.action);
          break;
        case 'memory':
          usePersona.getState().addMemory(event.memory);
          break;
        case 'proposal':
          usePersona.getState().pushProposal(event.proposal);
          recordActivity({
            kind: 'proposal_surfaced',
            title: event.proposal.reasoning,
            detail: event.proposal.suggestedTask ? `任务：${event.proposal.suggestedTask.title}` : undefined,
            ref: { kind: 'proposal', id: event.proposal.id },
          });
          break;
        case 'persona':
          usePersona.getState().setPersona(event.preset, event.name);
          break;
        case 'message.memoryRefs':
          // P0-M: tag the message with the memory ids it surfaced, so the
          // chat UI can show "she used 3 things she remembered".
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === event.messageId
                ? { ...m, memoryRefs: [...(m.memoryRefs ?? []), ...event.ids] }
                : m,
            ),
          }));
          break;
      }
    });

    void provider.start().then(() => set({ agentState: 'idle' }));
    // Memories decay slowly in the background. No-op if no memories exist.
    startMemoryDecay();
    // P0-D: midnight reset for the daily proposal cap.
    startProactivenessDailyReset();
    // Reference the store so tree-shakers don't drop the import — the
    // ProactivenessPanel subscribes to it directly, but the reset interval
    // lives here.
    void useProactiveness;
  },

  send: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((s) => ({
      agentState: 'thinking',
      messages: [...s.messages, { id: Math.random().toString(36).slice(2), speaker: 'user', text: trimmed, at: Date.now() }],
    }));
    void provider.send(trimmed);
  },

  setAgentState: (agentState) => set({ agentState }),
  setAmplitude: (amplitude) => set({ amplitude }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  cancelTask: (id) => void provider.cancelTask(id),
  retryTask: (id) => void provider.retryTask(id),
}));

/* --------------------------------------------------------------- briefing */

/**
 * Rolls the task list into the "what is going on" panel. Kept as a pure
 * function of tasks so it can be recomputed on any change without extra state.
 */
export function buildBriefing(tasks: Task[]): Briefing {
  const counts = { ...EMPTY_COUNTS };
  for (const t of tasks) counts[t.status] += 1;

  const needsAttention = tasks
    .filter((t) => t.status === 'review' || t.status === 'failed' || t.status === 'blocked')
    .map((t) => ({
      taskId: t.id,
      reason:
        t.status === 'review' ? '等待你确认后才会执行'
        : t.status === 'failed' ? (t.result ?? '执行失败')
        : '被依赖项阻塞',
    }));

  const active = counts.running + counts.queued;
  const headline =
    needsAttention.length > 0
      ? `${needsAttention.length} 项需要你，${active} 项在推进`
      : active > 0
        ? `${active} 项在推进，无阻塞`
        : '全部结清';

  const highlights: string[] = [];
  if (counts.running) highlights.push(`Hermes 正在执行 ${counts.running} 个长任务`);
  if (counts.done) highlights.push(`本节已完成 ${counts.done} 项`);
  if (counts.failed) highlights.push(`${counts.failed} 项失败，已保留现场日志`);
  const byProject = new Set(tasks.map((t) => t.project).filter(Boolean));
  if (byProject.size) highlights.push(`覆盖 ${byProject.size} 个项目：${[...byProject].join('、')}`);

  return { generatedAt: Date.now(), headline, counts, needsAttention, highlights };
}

/* --------------------------------------------------------------- conversation export (P0-U) */
/* Inlined into Conversation.tsx to avoid template-literal escape issues in
 * this already-large module. The download helper there imports nothing from
 * here; everything the exporter needs is in the component. */

export { provider };