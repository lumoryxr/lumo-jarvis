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
  /** P0-M: memories the mock surfaced while composing this reply.
   *  Lets the user see "she used 3 things she remembered" — a trust cue. */
  memoryRefs?: string[];
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

/* -------------------------------------------------------------- companion */

/**
 * Companion-product extensions layered on top of the assistant core.
 *
 * These are intentionally separate from the agent/task machine so the original
 * IA keeps its clean responsibilities: persona / mood / memory live here, work
 * lives in `Task` / `Message`. The two communicate through `ProviderEvent`s
 * (`mood`, `emotion`, `proposal`, `persona-action`) — never by reaching into
 * each other directly.
 */

/** Plutchik's 8 primary emotions + a few companion-product specifics. */
export type Emotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'disgusted'
  | 'fearful'
  | 'tender'
  | 'playful'
  | 'curious'
  | 'concerned';

/** Russell's circumplex — independent axes the avatar paints onto. */
export interface Mood {
  /** -1 (down) .. 1 (up) */
  valence: number;
  /** -1 (calm) .. 1 (energised) */
  arousal: number;
  /** -1 (yielding) .. 1 (in charge) */
  dominance: number;
  /** 0 (stranger) .. 1 (close). Long-term, decays very slowly. */
  intimacy: number;
}

/** Persona presets the user picks during onboarding. */
export type PersonaPreset =
  | 'warm_curious'        /* default — warm + curious */
  | 'playful_witty'        /* playful + witty */
  | 'gentle_caring'        /* gentle + caring */
  | 'cool_professional'   /* cool + professional */
  | 'energetic_cheerful'   /* energetic + cheerful */
  | 'calm_introspective'   /* calm + introspective */
  | 'teasing_flirty'       /* teasing + flirty  — companion route default */
  | 'mature_warm';         /* mature + warm */

/** Persistent memory about the user. Decays in `confidence` over time. */
export interface Memory {
  id: string;
  ts: number;
  kind: 'fact' | 'preference' | 'event' | 'emotion' | 'goal';
  content: string;
  /** 0..1 — drops over time unless re-confirmed. <0.3 dropped from prompt. */
  confidence: number;
  source: 'told' | 'inferred' | 'observed';
  relatedTo?: string[];
}

/** Small bodily expressions — used until M2 swaps in real viseme control. */
export type PersonaAction =
  | 'sigh'
  | 'laugh'
  | 'yawn'
  | 'stretch'
  | 'tilt_head'
  | 'raise_eyebrow'
  | 'pout'
  | 'smile_wide'
  | 'look_away'
  | 'blink_slow';

/** A proactive suggestion she wants to bring to the user's attention. */
export interface Proposal {
  id: string;
  /** Where it came from — so the user can audit the trigger. */
  trigger: 'morning' | 'idle' | 'task_done' | 'review_due' | 'metric_anomaly'
         | 'inspiration' | 'anniversary' | 'playful';
  reasoning: string;
  /** The task she would start if approved. */
  suggestedTask?: TaskDraft;
  confidence: number;
  /** ms-since-epoch — proposals expire so they don't pile up. */
  expiresAt: number;
  /** Optional tone — affects how she presents it. */
  tone?: 'matter_of_fact' | 'warm' | 'playful' | 'concerned';
}

export interface TaskDraft {
  title: string;
  intent: string;
  executor: Task['executor'];
  project?: string;
  tags: string[];
}
