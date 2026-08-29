import type {
  Memory, Message, Mood, PersonaAction, PersonaPreset, Proposal, Task,
  MachineSnapshot, ConnectorStatus,
} from '../core/types';

/**
 * The seam between the UI and anything that does real work.
 *
 * `MockBackend` implements this for the prototype; `HermesProvider` +
 * `TauriOsBridge` implement it against the real world. The UI only ever sees
 * this interface, which is why the prototype and the shipping app can share
 * every component.
 */

/** Incremental updates pushed out of a provider while a turn is in flight. */
export type ProviderEvent =
  /* -- assistant core (original) ----------------------------------------- */
  | { kind: 'message.start'; message: Message }
  | { kind: 'message.delta'; id: string; text: string }
  | { kind: 'message.end'; id: string }
  | { kind: 'tool.start'; messageId: string; call: import('../core/types').ToolCall }
  | { kind: 'tool.end'; messageId: string; callId: string; status: 'ok' | 'failed' | 'denied'; output?: string }
  | { kind: 'task.upsert'; task: Task }
  | { kind: 'machine'; snapshot: MachineSnapshot }
  | { kind: 'connector'; status: ConnectorStatus }
  | { kind: 'speech'; text: string; done: boolean }
  /* -- companion layer (P0-A) -------------------------------------------- */
  | { kind: 'mood'; mood: Mood }
  | { kind: 'emotion'; emotion: import('../core/types').Emotion; intensity: number; trigger?: string }
  | { kind: 'persona-action'; action: PersonaAction; durationMs?: number }
  | { kind: 'memory'; memory: Memory }
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'persona'; preset: PersonaPreset; name: string };

export type ProviderListener = (event: ProviderEvent) => void;

export interface Provider {
  readonly id: string;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: ProviderListener): () => void;

  /** Send a user turn. Resolves once the turn is fully dispatched, not finished. */
  send(text: string): Promise<void>;
  /** Ask the executor to abort a task. */
  cancelTask(taskId: string): Promise<void>;
  /** Re-run a failed task with the same intent. */
  retryTask(taskId: string): Promise<void>;
  /** Force the first-contact greeting to fire now (P0-F: called after onboarding). */
  greetNow?(): void;
  /** P0-H: approve a proactive proposal and spawn the suggested task. */
  acceptProposal?(proposalId: string): Promise<void>;
}
