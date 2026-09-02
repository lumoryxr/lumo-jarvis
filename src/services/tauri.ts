/**
 * TauriProvider — production counterpart to services/mock.ts.
 *
 * Activates only when running inside a Tauri webview window.
 * Hermes dispatch is exposed via dispatchHermes() which uses
 * cmd_hermes_dispatch. The session store calls it when the user
 * creates a task with executor='hermes'.
 *
 * LLM turn handler (cmd_llm_chat) routes through OpenAI-compatible
 * /chat/completions when configured; the React side still gets
 * message.delta events so the avatar loop picks them up unchanged.
 */

import type { Provider, ProviderEvent, ProviderListener } from './provider';
import type { MachineSnapshot, Mood, Emotion, PersonaAction, PersonaPreset, Proposal } from '../core/types';
import { useSession } from '../state/session';
import { usePersona } from '../state/persona';
import { recordActivity } from '../state/activity';

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type TauriListen = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<UnlistenFn>;
type UnlistenFn = () => void;

interface TauriWindow {
  invoke: TauriInvoke;
  listen: TauriListen;
}

let _w: TauriWindow | null = null;
async function tauri(): Promise<TauriWindow> {
  if (_w) return _w;
  // @ts-ignore -- optional runtime dep
  const api = await import('@tauri-apps/api/core').catch(() => null);
  // @ts-ignore
  const evt = await import('@tauri-apps/api/event').catch(() => null);
  if (!api || !evt) throw new Error('@tauri-apps/api not available');
  _w = { invoke: api.invoke as TauriInvoke, listen: evt.listen as TauriListen };
  return _w;
}

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window;
}

export class TauriProvider implements Provider {
  readonly id = 'tauri';
  private listeners = new Set<ProviderListener>();
  private unlisten?: UnlistenFn;

  constructor() {
    this.start().catch((e) => console.error('[tauri] start failed:', e));
  }

  async start(): Promise<void> {
    const t = await tauri();
    try {
      await t.invoke<void>('cmd_start');
    } catch (e) {
      console.warn('[tauri] cmd_start failed', e);
    }
    this.unlisten = await t.listen<RustEvent>('lumo:event', (e) => {
      mirrorEvent(e.payload);
      for (const l of this.listeners) l(e.payload as ProviderEvent);
    });
  }

  subscribe(listener: ProviderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(text: string): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_send', { text });
  }

  async cancelTask(id: string): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_cancel_task', { taskId: id });
  }

  async retryTask(id: string): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_retry_task', { taskId: id });
  }

  async greetNow(): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_greet_now');
  }

  async acceptProposal(id: string): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_accept_proposal', { proposalId: id });
  }

  async setProactivenessBand(band: string): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_set_proactiveness_band', { band });
  }

  async pushProposal(p: Proposal): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_push_proposal', { proposal: p });
  }

  async setConnectorStatus(id: string, status: string): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_set_connector_status', { id, status });
  }

  async getMachineSnapshot(): Promise<MachineSnapshot> {
    const t = await tauri();
    return t.invoke<MachineSnapshot>('cmd_machine_snapshot');
  }

  async dispatchHermes(input: string, instructions?: string): Promise<{ runId: string }> {
    const t = await tauri();
    const run = await t.invoke<{ run_id: string }>('cmd_hermes_dispatch', {
      input,
      instructions: instructions ?? null,
    });
    return { runId: run.run_id };
  }

  async setHermesConfig(cfg: { baseUrl: string; apiKey: string; sessionKey?: string }): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_hermes_set_config', {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      sessionKey: cfg.sessionKey ?? 'lumo-jarvis',
    });
  }

  async setLlmConfig(cfg: { endpoint: string; apiKey: string; model: string; system?: string }): Promise<void> {
    const t = await tauri();
    await t.invoke('cmd_llm_set_config', {
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: cfg.system ?? null,
    });
  }

  /** LLM turn handler. Returns the message id; deltas arrive on the
   *  shared lumo:event listener (the Rust side emits them). */
  async chatLlm(input: string): Promise<string> {
    const t = await tauri();
    return t.invoke<string>('cmd_llm_chat', { input });
  }

  async hermesHealth(): Promise<boolean> {
    const t = await tauri();
    try {
      return await t.invoke<boolean>('cmd_hermes_health');
    } catch {
      return false;
    }
  }

  stop(): void {
    this.unlisten?.();
    this.listeners.clear();
  }
}

type RustEvent =
  | { kind: 'message.start'; message: import('../core/types').Message }
  | { kind: 'message.delta'; id: string; text: string }
  | { kind: 'message.end'; id: string }
  | { kind: 'message.memoryRefs'; message_id: string; ids: string[] }
  | { kind: 'tool.start'; message_id: string; call: unknown }
  | { kind: 'tool.end'; message_id: string; call_id: string; status: string; output?: string }
  | { kind: 'task.upsert'; task: import('../core/types').Task }
  | { kind: 'machine'; snapshot: MachineSnapshot }
  | { kind: 'mood'; mood: Mood }
  | { kind: 'emotion'; emotion: Emotion; intensity: number; trigger?: string }
  | { kind: 'persona-action'; action: PersonaAction }
  | { kind: 'persona'; preset: PersonaPreset; name?: string }
  | { kind: 'proposal.pushed'; proposal: import('../core/types').Proposal }
  | { kind: 'proposal.accepted'; proposal_id: string }
  | { kind: 'proposal.dismissed'; proposal_id: string }
  | { kind: 'connector.status'; status: import('../core/types').ConnectorStatus };

function mirrorEvent(ev: RustEvent): void {
  switch (ev.kind) {
    case 'message.start':
    case 'message.delta':
    case 'message.end':
    case 'tool.start':
    case 'tool.end':
    case 'task.upsert':
    case 'machine':
    case 'connector.status':
    case 'message.memoryRefs':
      useSession.getState().applyProviderEvent(toTsProviderEvent(ev));
      return;
    case 'mood':
      usePersona.getState().pushMood(ev.mood);
      return;
    case 'emotion':
      usePersona.getState().pushEmotion(ev.emotion, ev.intensity, ev.trigger);
      return;
    case 'persona-action':
      usePersona.getState().pushAction(ev.action);
      return;
    case 'persona':
      usePersona.getState().setPersona(ev.preset, ev.name ?? 'Lumina');
      return;
    case 'proposal.pushed':
      usePersona.getState().pushProposal(ev.proposal);
      return;
    case 'proposal.accepted':
      recordActivity({ kind: 'proposal_accepted', title: ev.proposal_id, ref: { kind: 'proposal', id: ev.proposal_id } });
      return;
    case 'proposal.dismissed':
      recordActivity({ kind: 'proposal_dismissed', title: ev.proposal_id, ref: { kind: 'proposal', id: ev.proposal_id } });
      return;
  }
}

function toTsProviderEvent(ev: RustEvent): ProviderEvent {
  switch (ev.kind) {
    case 'message.start':
      return { kind: 'message.start', message: ev.message };
    case 'message.delta':
      return { kind: 'message.delta', id: ev.id, text: ev.text };
    case 'message.end':
      return { kind: 'message.end', id: ev.id };
    case 'message.memoryRefs':
      return { kind: 'message.memoryRefs', messageId: ev.message_id, ids: ev.ids };
    case 'tool.start':
      return { kind: 'tool.start', messageId: ev.message_id, call: ev.call as never };
    case 'tool.end':
      return {
        kind: 'tool.end',
        messageId: ev.message_id,
        callId: ev.call_id,
        status: ev.status as 'ok' | 'failed' | 'denied',
        output: ev.output,
      };
    case 'task.upsert':
      return { kind: 'task.upsert', task: ev.task };
    case 'machine':
      return { kind: 'machine', snapshot: ev.snapshot };
    case 'connector.status':
      return { kind: 'connector', status: ev.status };
    default:
      throw new Error(`unexpected rust event: ${(ev as { kind: string }).kind}`);
  }
}
