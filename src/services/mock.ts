import type { Provider, ProviderEvent, ProviderListener } from './provider';
import type { Task, TaskStatus, MachineSnapshot, Metric, ToolCall } from '../core/types';

/**
 * The prototype's stand-in for a real backend.
 *
 * It fabricates a plausible machine, a Hermes-shaped task pipeline and a
 * scripted conversation so the whole surface can be exercised without a
 * gateway, a webview bridge or an API key. Every event it emits is one the real
 * providers also emit — swapping `MockBackend` for `HermesProvider` is a
 * one-line change in `src/state/session.ts`.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

/* --------------------------------------------------------------- machine */

function seedMetric(id: string, label: string, base: number, fmt: (v: number) => string): Metric {
  const history = Array.from({ length: 48 }, (_, i) =>
    clamp01(base + Math.sin(i / 6) * 0.08 + (Math.random() - 0.5) * 0.06),
  );
  const value = history[history.length - 1];
  return { id, label, value, display: fmt(value), history, tone: toneFor(value) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toneFor = (v: number): Metric['tone'] => (v > 0.88 ? 'critical' : v > 0.7 ? 'warn' : 'nominal');

const PROC_NAMES = ['node', 'rustc', 'hermes-agent', 'chrome', 'Code Helper', 'docker', 'ollama', 'zsh'];

/* ----------------------------------------------------------------- tasks */

const TASK_SEEDS: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'steps'>[] = [
  {
    title: '重构 payments 模块的错误处理',
    intent: '把散落的 try/catch 收敛成统一的 Result 类型，并补上单测',
    executor: 'hermes',
    status: 'running',
    progress: 0.62,
    project: 'lumo-core',
    tags: ['refactor', 'typescript'],
    externalId: 'run_7f3a91',
  },
  {
    title: '给 Tauri 内核加上进程守护',
    intent: '子进程崩溃后自动重启，带指数退避与日志留存',
    executor: 'hermes',
    status: 'queued',
    progress: 0,
    project: 'lumo-jarvis',
    tags: ['rust', 'reliability'],
  },
  {
    title: '清理 ~/Downloads 里 30 天前的安装包',
    intent: '按扩展名与修改时间筛选，先出清单再执行',
    executor: 'local',
    status: 'review',
    progress: 1,
    project: 'workstation',
    tags: ['fs', 'needs-approval'],
    result: '找到 41 个文件，合计 12.4 GB。等待你确认后删除。',
  },
  {
    title: '每日构建流水线失败复盘',
    intent: '拉取最近 5 次 CI 日志，定位共同失败点',
    executor: 'hermes',
    status: 'done',
    progress: 1,
    project: 'lumo-core',
    tags: ['ci', 'analysis'],
    externalId: 'run_2b8c04',
    result: '5 次失败中 4 次源于 node-gyp 在 arm64 上的缓存竞态，已提交 PR #212。',
  },
  {
    title: '同步 Notion 上的产品需求到本地',
    intent: '增量拉取，冲突时保留本地版本',
    executor: 'local',
    status: 'failed',
    progress: 0.35,
    project: 'workstation',
    tags: ['sync'],
    result: 'Notion API 返回 401 — 集成令牌已过期。',
  },
];

const STEP_LABELS = ['解析意图', '制定计划', '读取工作区', '执行变更', '运行测试', '汇报结果'];

function buildTask(seed: (typeof TASK_SEEDS)[number], now: number): Task {
  const done = Math.round(seed.progress * STEP_LABELS.length);
  return {
    ...seed,
    id: uid(),
    createdAt: now - Math.floor(Math.random() * 3600_000),
    updatedAt: now,
    steps: STEP_LABELS.map((label, i) => ({
      id: uid(),
      label,
      status: (i < done ? 'done' : i === done && seed.status === 'running' ? 'running' : 'queued') as TaskStatus,
      at: now - (STEP_LABELS.length - i) * 60_000,
    })),
  };
}

/* -------------------------------------------------------- scripted turns */

interface Script {
  match: RegExp;
  reply: string[];
  tools?: { name: string; summary: string; output: string }[];
  task?: { title: string; intent: string; executor: Task['executor']; project: string; tags: string[] };
}

const SCRIPTS: Script[] = [
  {
    match: /(内存|memory|cpu|性能|卡)/i,
    reply: [
      '我看了一下：内存压力来自 ',
      '`node` 的三个 Vite 实例，合计 6.2 GB。',
      '\n\n其中两个的父终端已经退出，属于孤儿进程。要我结束它们吗？',
    ],
    tools: [
      { name: 'os.processes', summary: 'ps aux --sort=-%mem | head -20', output: 'node 6.2G · rustc 1.8G · chrome 1.1G' },
      { name: 'os.inspect', summary: 'pgrep -P 1 node', output: '2 orphaned node processes' },
    ],
  },
  {
    match: /(写|开发|实现|重构|代码|code|refactor|implement)/i,
    reply: [
      '已经把这件事下发给 Hermes 了。',
      '\n\n我给它的约束是：先出计划再动手，改动限制在目标模块内，跑完测试才算完成。',
      '进度会直接推到右边的任务板上。',
    ],
    tools: [{ name: 'hermes.dispatch', summary: 'POST /v1/runs', output: 'run_9d4e12 · started' }],
    task: {
      title: '按你的描述实现新功能',
      intent: '交给 Hermes 执行，完成后回报 diff 与测试结果',
      executor: 'hermes',
      project: 'lumo-core',
      tags: ['hermes', 'coding'],
    },
  },
  {
    match: /(任务|进度|状态|汇总|task|status|summary)/i,
    reply: [
      '当前 5 个任务：1 个在跑，1 个排队，1 个等你拍板，1 个已完成，1 个失败。',
      '\n\n需要你介入的是「清理 Downloads」——它列好了 41 个文件共 12.4 GB，等确认；',
      '还有 Notion 同步的令牌过期了。',
    ],
  },
];

const FALLBACK: string[] = [
  '收到。',
  '我可以直接在这台机器上执行，也可以下发给 Hermes 让它长时间跑。',
  '\n\n你想要哪种？',
];

/* --------------------------------------------------------------- backend */

export class MockBackend implements Provider {
  readonly id = 'mock';

  private listeners = new Set<ProviderListener>();
  private timers: number[] = [];
  private tasks = new Map<string, Task>();
  private metrics: Metric[] = [];
  private booted = false;

  subscribe(listener: ProviderListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ProviderEvent) {
    for (const l of this.listeners) l(event);
  }

  async start() {
    if (this.booted) return;
    this.booted = true;
    const now = Date.now();

    this.metrics = [
      seedMetric('cpu', 'CPU', 0.34, (v) => `${Math.round(v * 100)}%`),
      seedMetric('mem', 'MEMORY', 0.71, (v) => `${(v * 32).toFixed(1)} GB`),
      seedMetric('disk', 'DISK I/O', 0.22, (v) => `${Math.round(v * 480)} MB/s`),
      seedMetric('net', 'NETWORK', 0.41, (v) => `${Math.round(v * 120)} Mb/s`),
    ];

    for (const seed of TASK_SEEDS) {
      const task = buildTask(seed, now);
      this.tasks.set(task.id, task);
      this.emit({ kind: 'task.upsert', task });
    }

    for (const c of [
      { id: 'hermes' as const, label: 'HERMES', online: true, detail: '127.0.0.1:8642 · mock', latencyMs: 24 },
      { id: 'os' as const, label: 'OS BRIDGE', online: true, detail: 'tauri-core · mock', latencyMs: 3 },
      { id: 'llm' as const, label: 'REASONER', online: true, detail: 'local · mock', latencyMs: 180 },
      { id: 'voice' as const, label: 'VOICE', online: false, detail: 'web-speech · idle' },
    ]) {
      this.emit({ kind: 'connector', status: c });
    }

    this.pushMachine();
    this.timers.push(
      setInterval(() => this.tickMachine(), 1200) as unknown as number,
      setInterval(() => this.tickTasks(), 2600) as unknown as number,
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.listeners.clear();
    this.booted = false;
  }

  /* ------------------------------------------------------------ tickers */

  private pushMachine() {
    const snapshot: MachineSnapshot = {
      host: 'lumo-workstation',
      os: 'macOS 16.2 · Apple M4 Max',
      uptimeSec: 419_233,
      metrics: this.metrics,
      processes: PROC_NAMES.map((name, i) => ({
        pid: 1200 + i * 37,
        name,
        cpu: Math.round((1 - i / PROC_NAMES.length) * 60 + Math.random() * 12),
        mem: Math.round((1 - i / PROC_NAMES.length) * 22 + Math.random() * 6),
      })).sort((a, b) => b.cpu - a.cpu),
    };
    this.emit({ kind: 'machine', snapshot });
  }

  private tickMachine() {
    this.metrics = this.metrics.map((m) => {
      const next = clamp01(m.value + (Math.random() - 0.5) * 0.12);
      const history = [...m.history.slice(1), next];
      const display =
        m.id === 'cpu' ? `${Math.round(next * 100)}%`
        : m.id === 'mem' ? `${(next * 32).toFixed(1)} GB`
        : m.id === 'disk' ? `${Math.round(next * 480)} MB/s`
        : `${Math.round(next * 120)} Mb/s`;
      return { ...m, value: next, history, display, tone: toneFor(next) };
    });
    this.pushMachine();
  }

  private tickTasks() {
    for (const task of this.tasks.values()) {
      if (task.status !== 'running') continue;
      const progress = Math.min(1, task.progress + 0.04 + Math.random() * 0.05);
      const doneCount = Math.round(progress * task.steps.length);
      const steps = task.steps.map((s, i) => ({
        ...s,
        status: (i < doneCount ? 'done' : i === doneCount ? 'running' : 'queued') as TaskStatus,
      }));
      const next: Task = {
        ...task,
        progress,
        steps,
        updatedAt: Date.now(),
        status: progress >= 1 ? 'done' : 'running',
        result: progress >= 1 ? '变更已提交到分支 `refactor/payments-result`，42 个测试全部通过。' : task.result,
      };
      this.tasks.set(task.id, next);
      this.emit({ kind: 'task.upsert', task: next });
    }
  }

  /* --------------------------------------------------------------- turn */

  async send(text: string) {
    const script = SCRIPTS.find((s) => s.match.test(text)) ?? { match: /./, reply: FALLBACK };
    const messageId = uid();

    this.emit({
      kind: 'message.start',
      message: { id: messageId, speaker: 'jarvis', text: '', at: Date.now(), streaming: true },
    });

    let delay = 420;
    const at = (ms: number, fn: () => void) => {
      this.timers.push(setTimeout(fn, ms) as unknown as number);
    };

    for (const tool of script.tools ?? []) {
      const call: ToolCall = { id: uid(), name: tool.name, summary: tool.summary, status: 'running' };
      at(delay, () => this.emit({ kind: 'tool.start', messageId, call }));
      delay += 500 + Math.random() * 400;
      at(delay, () =>
        this.emit({ kind: 'tool.end', messageId, callId: call.id, status: 'ok', output: tool.output }),
      );
      delay += 220;
    }

    if (script.task) {
      const now = Date.now();
      const task: Task = {
        ...script.task,
        id: uid(),
        title: text.length > 28 ? `${text.slice(0, 28)}…` : text,
        status: 'running',
        progress: 0.08,
        createdAt: now,
        updatedAt: now,
        externalId: `run_${uid().slice(0, 6)}`,
        steps: STEP_LABELS.map((label, i) => ({
          id: uid(),
          label,
          status: (i === 0 ? 'running' : 'queued') as TaskStatus,
          at: now,
        })),
      };
      at(delay, () => {
        this.tasks.set(task.id, task);
        this.emit({ kind: 'task.upsert', task });
      });
    }

    // Stream the reply a few characters at a time so the avatar has something
    // to lip-sync against.
    for (const chunk of script.reply) {
      for (const piece of chunk.match(/.{1,3}/gs) ?? []) {
        delay += 26 + Math.random() * 34;
        at(delay, () => this.emit({ kind: 'message.delta', id: messageId, text: piece }));
      }
    }

    at(delay + 120, () => {
      this.emit({ kind: 'message.end', id: messageId });
      this.emit({ kind: 'speech', text: script.reply.join(''), done: true });
    });
  }

  async cancelTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const next: Task = { ...task, status: 'cancelled', updatedAt: Date.now(), result: '已按你的指令中止。' };
    this.tasks.set(taskId, next);
    this.emit({ kind: 'task.upsert', task: next });
  }

  async retryTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const next: Task = {
      ...task,
      status: 'running',
      progress: 0.05,
      updatedAt: Date.now(),
      result: undefined,
      steps: task.steps.map((s, i) => ({ ...s, status: (i === 0 ? 'running' : 'queued') as TaskStatus })),
    };
    this.tasks.set(taskId, next);
    this.emit({ kind: 'task.upsert', task: next });
  }
}
