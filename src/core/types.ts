/**
 * Domain model for Lumo JARVIS.
 *
 * Everything the UI renders is described here. Providers (Hermes, the local OS
 * bridge, the mock backend) all normalise into these shapes, so swapping a
 * provider never touches a component.
 */

/* ------------------------------------------------------------------ agent */

/** What the digital human is doing right now. Drives avatar + HUD colour. */
export type AgentState =
  | 'offline'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'acting'
  | 'error';

export type Speaker = 'user' | 'jarvis' | 'system';

/** A single tool invocation surfaced inline in the transcript. */
export interface ToolCall {
  id: string;
  /** Tool identifier, e.g. `terminal`, `fs.write`, `hermes.dispatch`. */
  name: string;
  /** Short human-readable summary, e.g. `git status`. */
  summary: string;
  status: 'running' | 'ok' | 'failed' | 'denied';
  /** Truncated stdout / result preview. */
  output?: string;
  durationMs?: number;
}

export interface Message {
  id: string;
  speaker: Speaker;
  text: string;
  at: number;
  /** True while tokens are still streaming in. */
  streaming?: boolean;
  toolCalls?: ToolCall[];
  /** Set when this turn spawned a tracked task. */
  taskId?: string;
}

/* ------------------------------------------------------------------- task */

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Who is actually executing the work. */
export type TaskExecutor = 'hermes' | 'local' | 'user';

export interface TaskStep {
  id: string;
  label: string;
  status: TaskStatus;
  at: number;
}

export interface Task {
  id: string;
  title: string;
  /** One-line intent, shown under the title on the board. */
  intent: string;
  executor: TaskExecutor;
  status: TaskStatus;
  /** 0..1 */
  progress: number;
  createdAt: number;
  updatedAt: number;
  /** Free-form grouping, e.g. a repo name or project code. */
  project?: string;
  tags: string[];
  steps: TaskStep[];
  /** Provider-native handle: a Hermes `run_id`, a local job id, ... */
  externalId?: string;
  /** Terminal summary written when the task reaches a final state. */
  result?: string;
}

/* ---------------------------------------------------------------- machine */

/** A single live gauge on the system rail. */
export interface Metric {
  id: string;
  label: string;
  /** 0..1 for gauges; raw value carried in `display`. */
  value: number;
  display: string;
  /** Rolling window, oldest first, each 0..1. */
  history: number[];
  tone: 'nominal' | 'warn' | 'critical';
}

export interface MachineSnapshot {
  host: string;
  os: string;
  uptimeSec: number;
  metrics: Metric[];
  /** Top processes by CPU. */
  processes: { pid: number; name: string; cpu: number; mem: number }[];
}

/* ------------------------------------------------------------- connectors */

export type ConnectorId = 'hermes' | 'os' | 'voice' | 'llm';

export interface ConnectorStatus {
  id: ConnectorId;
  label: string;
  online: boolean;
  /** Short detail line, e.g. `127.0.0.1:8642` or `mock`. */
  detail: string;
  latencyMs?: number;
}

/* ------------------------------------------------------------------ brief */

/** The rolled-up "what is going on" panel. */
export interface Briefing {
  generatedAt: number;
  headline: string;
  counts: Record<TaskStatus, number>;
  /** Things that need the human. */
  needsAttention: { taskId: string; reason: string }[];
  /** Narrative bullets summarising the session. */
  highlights: string[];
}
