import type { Provider, ProviderEvent, ProviderListener } from './provider';
import type {
  Emotion, Memory, Mood, PersonaAction, PersonaPreset, Proposal, Task, TaskStatus,
  MachineSnapshot, Metric, ToolCall,
} from '../core/types';
import { useProactiveness } from '../state/proactiveness';
import { usePersona } from '../state/persona';
import { useOnboarding } from '../state/onboarding';
import { runWatchers, type WatcherSnapshot, type Watcher } from './watchers';

/**
 * The prototype's stand-in for a real backend.
 *
 * Two responsibilities stacked:
 *   1. The original assistant core — fabricates a plausible machine, a
 *      Hermes-shaped task pipeline and a scripted conversation so the
 *      assistant surface can be exercised without a gateway.
 *   2. The P0-A companion layer — opens the session by introducing herself,
 *      greets the user with a `mood` + `emotion`, listens for memory-shaped
 *      facts in user input, plays scripted emotions/actions in response,
 *      and fires proactive proposals at sensible intervals.
 *   3. P0-D: a real `Watcher` engine synthesises signals (disk / metric /
 *      process / ci / time) and emits Proposals through the same
 *      Proactiveness policy the production backend will use.
 *
 * Every event it emits is one the real providers also emit — swapping
 * `MockBackend` for `HermesProvider` is a one-line change in
 * `src/state/session.ts`.
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

const TASK_SEEDS: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'steps' | 'order' | 'labels' | 'priority'>[] = [
  {
    title: '重构 payments 模块的错误处理',
    intent: '把散落的 try/catch 收敛成统一的 Result 类型,并补上单测',
    executor: 'hermes',
    status: 'running',
    progress: 0.62,
    project: 'lumo-core',
    tags: ['refactor', 'typescript'],
    externalId: 'run_7f3a91',
  },
  {
    title: '给 Tauri 内核加上进程守护',
    intent: '子进程崩溃后自动重启,带指数退避与日志留存',
    executor: 'hermes',
    status: 'queued',
    progress: 0,
    project: 'lumo-jarvis',
    tags: ['rust', 'reliability'],
  },
  {
    title: '清理 ~/Downloads 里 30 天前的安装包',
    intent: '按扩展名与修改时间筛选,先出清单再执行',
    executor: 'local',
    status: 'review',
    progress: 1,
    project: 'workstation',
    tags: ['fs', 'needs-approval'],
    result: '找到 41 个文件,合计 12.4 GB。等待你确认后删除。',
  },
  {
    title: '每日构建流水线失败复盘',
    intent: '拉取最近 5 次 CI 日志,定位共同失败点',
    executor: 'hermes',
    status: 'done',
    progress: 1,
    project: 'lumo-core',
    tags: ['ci', 'analysis'],
    externalId: 'run_2b8c04',
    result: '5 次失败中 4 次源于 node-gyp 在 arm64 上的缓存竞态,已提交 PR #212。',
  },
  {
    title: '同步 Notion 上的产品需求到本地',
    intent: '增量拉取,冲突时保留本地版本',
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
    // P1-C: order / labels / priority are not in the seed, so we hardcode
    // defaults here. moveTask renorms order whenever the user drags.
    order: now,
    labels: [],
    priority: 1,
    steps: STEP_LABELS.map((label, i) => ({
      id: uid(),
      label,
      status: (i < done ? 'done' : i === done && seed.status === 'running' ? 'running' : 'queued') as TaskStatus,
      at: now - (STEP_LABELS.length - i) * 60_000,
    })),
  };
}

/* -------------------------------------------------------- scripted turns */

/**
 * A script is a *response shape* to a user message. P0-A adds three optional
 * layers beyond the original reply/tools/task:
 *   mood  — her baseline mood shifts during this turn
 *   emotion — the discrete emotion label she'll show for a moment
 *   action — a small bodily expression (laugh, sigh, etc.)
 *   memory — anything to remember from the user's message
 *   proposal — a proactive suggestion she'd like to bubble up
 */
interface Script {
  match: RegExp;
  reply: string[];
  tools?: { name: string; summary: string; output: string }[];
  /** P1-B: optional rich tool card. Renders as a table/diff/code/chart/log
   *  depending on the payload. Drawn after the regular tools. */
  richTool?: ToolCall;
  task?: { title: string; intent: string; executor: Task['executor']; project: string; tags: string[] } & Partial<Pick<Task, 'labels' | 'priority' | 'order'>>;
  mood?: Mood;
  emotion?: { emotion: Emotion; intensity: number; trigger?: string };
  action?: PersonaAction;
  memory?: Omit<Memory, 'id' | 'ts' | 'source'> & { source?: Memory['source'] };
  proposal?: Omit<Proposal, 'id' | 'expiresAt'> & { expiresInMs?: number };
}

const SCRIPTS: Script[] = [
  /* ---- the assistant's original repertoire ----------------------------- */
  {
    match: /(内存|memory|cpu|性能|卡)/i,
    reply: [
      '我看了一下：内存压力来自 ',
      '`node` 的三个 Vite 实例,合计 6.2 GB。',
      '\n\n其中两个的父终端已经退出,属于孤儿进程。要我结束它们吗?',
    ],
    tools: [
      { name: 'os.processes', summary: 'ps aux --sort=-%mem | head -20', output: 'node 6.2G · rustc 1.8G · chrome 1.1G' },
      { name: 'os.inspect', summary: 'pgrep -P 1 node', output: '2 orphaned node processes' },
    ],
    richTool: {
      id: uid(),
      name: 'os.processes',
      summary: '内存 Top 10',
      status: 'ok',
      kind: 'table',
      payload: {
        kind: 'table',
        columns: ['PID', '进程', 'RSS', 'CPU%', '状态'],
        rows: [
          [1824, 'node', '6.2G', '12%', '运行中'],
          [1924, 'node', '4.8G', '4%',  '孤儿'],
          [2031, 'node', '2.1G', '0%',  '孤儿'],
          [4102, 'rustc', '1.8G', '85%', '运行中'],
          [5021, 'chrome', '1.1G', '3%',  '运行中'],
          [5099, 'code', '780M', '2%',  '运行中'],
        ],
        caption: '按内存排序,前 6 项已占 16.8 GB',
      },
    } as ToolCall,
    mood: { valence: -0.05, arousal: 0.25, dominance: 0.2, intimacy: 0.4 },
    emotion: { emotion: 'concerned', intensity: 0.5, trigger: 'high memory pressure' },
  },
  {
    match: /(写|开发|实现|重构|代码|code|refactor|implement)/i,
    reply: [
      '已经把这件事下发给 Hermes 了。',
      '\n\n我给它的约束是：先出计划再动手,改动限制在目标模块内,跑完测试才算完成。',
      '进度会直接推到右边的任务板上。',
    ],
    tools: [{ name: 'hermes.dispatch', summary: 'POST /v1/runs', output: 'run_9d4e12 · started' }],
    task: {
      title: '按你的描述实现新功能',
      intent: '交给 Hermes 执行,完成后回报 diff 与测试结果',
      executor: 'hermes',
      project: 'lumo-core',
      tags: ['hermes', 'coding'],
    },
    mood: { valence: 0.2, arousal: 0.35, dominance: 0.25, intimacy: 0.4 },
    emotion: { emotion: 'curious', intensity: 0.5, trigger: 'new coding work' },
  },
  {
    match: /(任务|进度|状态|汇总|task|status|summary)/i,
    reply: [
      '当前 5 个任务：1 个在跑,1 个排队,1 个等你拍板,1 个已完成,1 个失败。',
      '\n\n需要你介入的是「清理 Downloads」——它列好了 41 个文件共 12.4 GB,等确认;',
      '还有 Notion 同步的令牌过期了。',
    ],
    mood: { valence: 0.0, arousal: 0.1, dominance: 0.15, intimacy: 0.4 },
  },
  /* ---- the companion layer's repertoire -------------------------------- */
  {
    /* "我喜欢你 / 在吗" — she lights up. */
    match: /(喜欢|想你|在吗|陪|陪我|你好)/i,
    reply: [
      '在呢。',
      '\n\n今天感觉怎么样?是要干活,还是就聊会儿?',
    ],
    mood: { valence: 0.55, arousal: 0.45, dominance: 0.0, intimacy: 0.55 },
    emotion: { emotion: 'playful', intensity: 0.7, trigger: 'user reaching out' },
    action: 'smile_wide',
  },
  {
    /* "我累了 / 烦 / 压力大" — soften, don't fix. */
    match: /(累|烦|压力|心情不好|郁闷|焦虑|难过)/i,
    reply: [
      '嗯,听到了。',
      '\n\n要不要先去倒杯水?我把 Hermes 那边的非关键任务先暂停一会儿,你回来再说。',
    ],
    mood: { valence: -0.15, arousal: -0.35, dominance: -0.2, intimacy: 0.6 },
    emotion: { emotion: 'tender', intensity: 0.7, trigger: 'user is tired' },
    action: 'tilt_head',
  },
  {
    /* "帮我看看 Notion / 同步" — task-shaped, but with empathy in the voice. */
    match: /(notion|同步|令牌|过期)/i,
    reply: [
      '我看了一下 Notion 集成,',
      '令牌 9 月 12 日到期,刷新密钥的入口在 ',
      '`lumo-core/integrations/notion.toml`。',
      '\n\n要不要我现在帮你切到新密钥,并把上次失败的那次同步重跑一次?',
    ],
    tools: [{ name: 'os.inspect', summary: 'cat integrations/notion.toml', output: 'token = "expired 2024-09-12"' }],
    mood: { valence: 0.1, arousal: 0.15, dominance: 0.25, intimacy: 0.4 },
    emotion: { emotion: 'concerned', intensity: 0.45, trigger: 'integration failing' },
  },
  {
    /* "你叫什么 / 你好 / 你是谁" — first-contact. */
    match: /(你是谁|叫什么|谁是你|who are you)/i,
    reply: [
      '我是 Lumina,住在这台机器里。',
      '\n\n干活的活我能搭把手,陪聊的活我也不推辞。今天想从哪儿开始?',
    ],
    mood: { valence: 0.4, arousal: 0.2, dominance: 0.1, intimacy: 0.45 },
    emotion: { emotion: 'playful', intensity: 0.5, trigger: 'first contact' },
    action: 'raise_eyebrow',
  },
  {
    /* "清一下磁盘 / 整理 / 优化" — proactive territory. */
    match: /(清|整理|优化|磁盘|空间|优化)/i,
    reply: [
      '行,我先列个清单,你看一下再拍板。',
      '\n\n按风险排好序——最容易撤销的先来。',
    ],
    mood: { valence: 0.15, arousal: 0.3, dominance: 0.2, intimacy: 0.4 },
    emotion: { emotion: 'curious', intensity: 0.45, trigger: 'tidying up' },
  },
];

const FALLBACK: Script = {
  match: /./,
  reply: [
    '收到。',
    '\n\n我可以直接在这台机器上执行,也可以下发给 Hermes 让它长时间跑。',
    '\n\n你想要哪种?',
  ],
  mood: { valence: 0.05, arousal: 0.1, dominance: 0.0, intimacy: 0.35 },
};

/* ----------------------------------------------------- memory extraction */

/**
 * Trivial regex sweep — the real impl will use the LLM. Each rule appends
 * a candidate; the caller decides what to do with them.
 *
 * Patterns:
 *   1. "my name is X" / "I'm X" / "我叫 X"
 *   2. "I like / hate / prefer X" / "我喜欢 / 讨厌 X"
 *   3. "I'm working on X" / "我正在做 X"
 *   4. "tomorrow I'll X" / "明天要 X"   → event, future-dated
 *   5. "I'm tired / sad / stressed" / "我累了 / 心情糟"   → emotion
 *   6. "my goal is X" / "我的目标 X"
 *
 * One user sentence can carry several memories — we return all of them.
 */
function extractMemories(text: string): Omit<Memory, 'id' | 'ts' | 'source'>[] {
  const t = text.trim();
  if (!t || t.length > 200) return [];
  const out: Omit<Memory, 'id' | 'ts' | 'source'>[] = [];
  const push = (m: Omit<Memory, 'id' | 'ts' | 'source'>) => out.push(m);

  /* 1. name */
  const name = t.match(/(?:我叫|我是|I'm|I am)\s*([一-龥A-Za-z][一-龥A-Za-z0-9_-]{0,15})/);
  if (name) push({ kind: 'fact', content: `名字是 ${name[1]}`, confidence: 0.95 });

  /* 2. preference (negative first — "I don't like X" before "I like Y") */
  const dislikes = [...t.matchAll(/(?:我)?(不喜欢|讨厌|不爱|don't like|hate)\s*([一-龥\w][一-龥\w\s]{0,30}?)(?:[。.!！,]|$)/gi)];
  for (const m of dislikes) push({ kind: 'preference', content: `不喜欢${m[2].trim()}`, confidence: 0.8 });
  const likes = [...t.matchAll(/(?:我)?(喜欢|爱|prefer|love)\s*([一-龥\w][一-龥\w\s]{0,30}?)(?:[。.!！,]|$)/gi)];
  for (const m of likes) {
    if (!/(喜欢|想|要)\s*(你|她|他|聊天|陪伴|陪)/.test(m[0])) {
      push({ kind: 'preference', content: `喜欢${m[2].trim()}`, confidence: 0.75 });
    }
  }

  /* 3. ongoing project / fact */
  const work = t.match(/(?:我在|正在|我目前|做的是|做的是项目)\s*([一-龥\w][一-龥\w\s]{1,30}?)(?:[。.!！,]|$)/);
  if (work) push({ kind: 'fact', content: `最近在弄:${work[1].trim()}`, confidence: 0.6 });
  const work2 = t.match(/(?:弄|写|搞|做)\s*([一-龥\w][一-龥\w\s]{1,30}?)(?:[。.!！,]|$)/);
  if (work2 && work2[1].length >= 2) push({ kind: 'fact', content: `最近在弄:${work2[1].trim()}`, confidence: 0.55 });

  /* 4. future event */
  const future = t.match(/(?:明天|下周|今晚|周一|周二|周三|周四|周五|tomorrow)\s*(?:要|得|会|将|我)?\s*([一-龥\w][一-龥\w\s]{1,30}?)(?:[。.!！,]|$)/);
  if (future) push({ kind: 'event', content: `日程:${future[1].trim()}`, confidence: 0.65 });

  /* 5. emotional state */
  if (/(我今天|现在|感觉|觉得|心情)?(累|烦|压力|糟|难过|焦虑|郁闷|疲惫|down|stressed|tired)/.test(t)) {
    push({
      kind: 'emotion',
      content: `今天感觉${/(糟|难过|烦|压力|down)/.test(t) ? '不好' : '有点累'}`,
      confidence: 0.6,
    });
  }

  /* 6. goal */
  const goal = t.match(/(?:我打算|目标是|想做到|我的目标)\s*([一-龥\w][一-龥\w\s]{1,30}?)(?:[。.!！,]|$)/);
  if (goal) push({ kind: 'goal', content: `目标:${goal[1].trim()}`, confidence: 0.65 });

  return out;
}

/* ------------------------------------------------------ synth signals */

/**
 * Real watcher engines need signals; we synthesize plausible ones so the
 * watcher produces real proposals without needing Tauri hooks.
 */
function synthDisks() {
  return [
    { mount: '/',     freeGB: 18.4, totalGB: 480, oldestFileDays: 124 },
    { mount: '/home', freeGB: 4.1,  totalGB: 120, oldestFileDays: 87 },
  ];
}
function synthCI() {
  return [
    { repo: 'lumo-core', branch: 'main', status: 'failure' as const, durationSec: 482 },
    { repo: 'lumo-jarvis', branch: 'main', status: 'success' as const, durationSec: 196 },
  ];
}

/**
 * P0-H: when the user clicks "考虑下" on a proposal, we spawn one of these
 * tasks. In a real backend this would shell out to Hermes; in the prototype
 * we just put a believable task on the board with the right executor.
 */
const ACCEPTED_PROPOSAL_SEEDS: Record<string, Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'steps' | 'status' | 'progress' | 'order' | 'labels' | 'priority'>> = {
  'metric.disk': {
    title: '扫描 ~/Downloads 的 30 天前旧文件',
    intent: '出清单,不动手,等你批准',
    executor: 'local',
    project: 'workstation',
    tags: ['fs', 'tidy', 'needs-approval'],
  },
  'metric.mem': {
    title: '排查内存占用',
    intent: '找出内存大头,出报告',
    executor: 'local',
    project: 'workstation',
    tags: ['health'],
  },
  'proc.node': {
    title: '检查 node 进程 CPU 占用',
    intent: '看是不是它正常的工作状态,再决定是否结束',
    executor: 'local',
    project: 'workstation',
    tags: ['process', 'health'],
  },
  'ci.lumo-core': {
    title: '让 Hermes 诊断 lumo-core@main 失败原因',
    intent: '拉日志 + 定位 + 给修复方案',
    executor: 'hermes',
    project: 'lumo-core',
    tags: ['ci', 'diagnose'],
  },
};

/* --------------------------------------------------------------- backend */

const PRESET: PersonaPreset = 'teasing_flirty';
const NAME = 'Lumina';

/**
 * Per-preset first-greeting tone. The same preset shouldn't say hi with the
 * same intonation across all 8 personas — a 沉静内敛 persona opening with
 * "smile_wide + playful 0.6" reads wrong. This table keeps the opening
 * beat faithful to the persona the user picked in onboarding.
 */
const FIRST_GREET_TONE: Record<PersonaPreset, { emotion: Emotion; intensity: number; action: PersonaAction }> = {
  warm_curious:       { emotion: 'curious',  intensity: 0.55, action: 'tilt_head' },
  playful_witty:      { emotion: 'playful',  intensity: 0.7,  action: 'smile_wide' },
  gentle_caring:      { emotion: 'tender',   intensity: 0.6,  action: 'smile_wide' },
  cool_professional:  { emotion: 'neutral',  intensity: 0.4,  action: 'raise_eyebrow' },
  energetic_cheerful: { emotion: 'happy',    intensity: 0.7,  action: 'smile_wide' },
  calm_introspective: { emotion: 'neutral',  intensity: 0.3,  action: 'tilt_head' },
  teasing_flirty:     { emotion: 'playful',  intensity: 0.6,  action: 'smile_wide' },
  mature_warm:        { emotion: 'tender',   intensity: 0.55, action: 'smile_wide' },
};

/** P0-V: greeting templates by language. Hour-keyed prefix preserved. */
const GREETINGS: Record<'zh' | 'en', (name: string) => string> = {
  zh: (name) => {
    const hour = new Date().getHours();
    const part = hour < 5 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    return `${part}。我是 ${name},今天陪你。`;
  },
  en: (name) => {
    const hour = new Date().getHours();
    const part = hour < 5 ? 'Still up' : hour < 11 ? 'Good morning' : hour < 14 ? 'Hey' : hour < 18 ? 'Afternoon' : 'Evening';
    return `${part}. I'm ${name}, with you today.`;
  },
};

/** Baseline mood she'd return to when nothing's happening. */
const BASELINE_MOOD: Mood = { valence: 0.35, arousal: 0.1, dominance: 0.05, intimacy: 0.45 };

export class MockBackend implements Provider {
  readonly id = 'mock';

  private listeners = new Set<ProviderListener>();
  private timers: number[] = [];
  private tasks = new Map<string, Task>();
  private metrics: Metric[] = [];
  private booted = false;
  /** Set true once we've said hello. */
  private greeted = false;
  /** Watcher engine — replaceable for tests. */
  private watchers: Watcher[];

  constructor(opts: { watchers?: Watcher[] } = {}) {
    this.watchers = opts.watchers ?? [];
  }

  subscribe(listener: ProviderListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ProviderEvent) {
    for (const l of this.listeners) l(event);
  }

  /** P0-M: annotate the last jarvis message with the memories it used. */
  private tagMessageWithMemories(messageId: string, ids: string[]) {
    this.emit({ kind: 'message.memoryRefs', messageId, ids });
  }

  /** Helper to push companion-layer events without spelling out `kind` each time. */
  private pushMood(mood: Mood) { this.emit({ kind: 'mood', mood }); }
  private pushEmotion(emotion: Emotion, intensity: number, trigger?: string) {
    this.emit({ kind: 'emotion', emotion, intensity, trigger });
  }
  private pushAction(action: PersonaAction) { this.emit({ kind: 'persona-action', action }); }
  private pushMemory(memory: Memory) { this.emit({ kind: 'memory', memory }); }
  private pushProposal(proposal: Proposal) { this.emit({ kind: 'proposal', proposal }); }

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
      // P0-D: run watchers on a 5s cadence so demo signals surface quickly.
      setInterval(() => this.tickWatchers(), 5000) as unknown as number,
      // P0-P: idle micro-actions. ~once every 25-40s, push a small
      // persona action so the avatar doesn't look frozen when the user
      // is idle. Gated by the agent state so we don't fire while the
      // user is actively in a turn.
      setInterval(() => this.maybeFireIdleAction(), 12000) as unknown as number,
    );

    /* ---------- P0-A: companion startup ---------- */
    // 1. Announce the persona (the UI's name + greeting reference).
    //    P0-F: read the live choices from onboarding so the persona event
    //    matches what the user just picked (or what they reopened to).
    this.emit({
      kind: 'persona',
      preset: usePersona.getState().preset,
      name: usePersona.getState().name,
    });
    // 2. Push the baseline mood so the avatar has a colour, not pure black.
    this.pushMood(BASELINE_MOOD);
    // 3. Greet is no longer auto-fired here. P0-F: App.tsx waits for the
    //    onboarding commit (so the name is in the persona store) and then
    //    calls `provider.greetNow?.()`. This avoids the race where greet()
    //    ran 900ms after boot with the default name.
  }

  /** P0-F: trigger the first-contact greeting on demand. Idempotent. */
  greetNow() {
    if (this.booted) this.greet();
  }

  /** First-contact greeting — distinct from the boot message in the transcript.
   *  P0-F: name + greeting tone both come from the live persona + onboarding
   *  choices, so she introduces herself under whatever name the user picked.
   *  P0-V: greets in the user's chosen language. */
  private greet() {
    if (this.greeted) return;
    this.greeted = true;
    const persona = usePersona.getState();
    const name = persona.name || NAME;
    const preset = persona.preset || PRESET;
    const tone = FIRST_GREET_TONE[preset] ?? { emotion: 'playful', intensity: 0.6, action: 'smile_wide' };
    const lang = (useOnboarding.getState().language) || 'zh';
    const greetLine = GREETINGS[lang](name);

    this.pushEmotion(tone.emotion, tone.intensity, 'first contact');
    this.pushAction(tone.action);

    this.emit({
      kind: 'message.start',
      message: {
        id: uid(),
        speaker: 'jarvis',
        at: Date.now(),
        text: greetLine,
        streaming: true,
      },
    });
    const id = 'greet';
    for (const piece of greetLine.match(/.{1,2}/gs) ?? []) {
      this.timers.push(setTimeout(() => {
        this.emit({ kind: 'message.delta', id, text: piece });
      }, 80 + Math.random() * 60) as unknown as number);
    }
    this.timers.push(setTimeout(() => {
      this.emit({ kind: 'message.end', id });
    }, 1400) as unknown as number);
  }

  /**
   * P0-H: the user approved a proactive proposal — turn its suggestedTask
   * into a real Task on the board and dismiss the proposal. Idempotent;
   * unknown ids no-op.
   */
  async acceptProposal(proposalId: string) {
    // We don't keep the proposal list here (the persona store owns it);
    // we trust the caller and just spawn whatever suggestedTask is implied.
    // For the prototype we hard-code the canonical seed tasks by trigger.
    const seed = ACCEPTED_PROPOSAL_SEEDS[proposalId];
    if (!seed) return;
    const now = Date.now();
    const task: Task = {
      ...seed,
      id: uid(),
      status: 'running',
      progress: 0.08,
      createdAt: now,
      updatedAt: now,
      externalId: `run_${uid().slice(0, 6)}`,
      labels: [],        // P1-C
      priority: 1,       // P1-C
      order: now,        // P1-C
      steps: STEP_LABELS.map((label, i) => ({
        id: uid(),
        label,
        status: (i === 0 ? 'running' : 'queued') as TaskStatus,
        at: now,
      })),
    };
    this.tasks.set(task.id, task);
    this.emit({ kind: 'task.upsert', task });
    this.pushEmotion('happy', 0.5, 'task accepted');
    this.pushAction('smile_wide');
  }

  /** P0-P: pick a small action that fits the current persona's mood. */
  private maybeFireIdleAction() {
    // Only fire when idle (not in the middle of a turn).
    const lastMsg = [...this.tasks.values()].find((t) => t.status === 'running');
    if (lastMsg) return;
    const persona = usePersona.getState();
    if (persona.emotionIntensity > 0.5) return;          // already expressing
    if (persona.lastAction) return;                    // one in flight
    // Mood-keyed pool. Higher valence = more positive actions.
    const v = persona.mood.valence;
    const pool: PersonaAction[] = v > 0.2
      ? ['smile_wide', 'tilt_head', 'look_away']
      : v < -0.2
        ? ['sigh', 'look_away', 'blink_slow']
        : ['tilt_head', 'look_away', 'blink_slow'];
    const action = pool[Math.floor(Math.random() * pool.length)];
    this.pushAction(action);
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
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
        result: progress >= 1 ? '变更已提交到分支 `refactor/payments-result`,42 个测试全部通过。' : task.result,
      };
      this.tasks.set(task.id, next);
      this.emit({ kind: 'task.upsert', task: next });

      // P0-A: when a task finishes, light up briefly and suggest a follow-up.
      if (progress >= 1 && task.status === 'running') {
        this.pushEmotion('happy', 0.55, 'task done');
        this.pushAction('smile_wide');
      }
    }
  }

  /**
   * P0-D: real watcher loop. Builds a WatcherSnapshot from the latest state,
   * runs watchers, and emits any proposals the Proactiveness policy allows.
   *
   * In production this will be driven by `sysinfo`/`tokio` and the Hermes
   * SSE stream; the policy side stays identical.
   */
  private tickWatchers() {
    const snap: WatcherSnapshot = {
      now: Date.now(),
      metrics: this.metrics.map((m) => ({ id: m.id, value: m.value, history: m.history })),
      processes: PROC_NAMES.map((name, i) => ({
        pid: 1200 + i * 37,
        name,
        cpu: clamp01((1 - i / PROC_NAMES.length) * 0.6 + Math.random() * 0.2),
        mem: clamp01((1 - i / PROC_NAMES.length) * 0.4 + Math.random() * 0.1),
      })),
      disks: synthDisks(),
      ci: synthCI(),
    };

    if (!this.watchers.length) return;  // No watchers wired — nothing to do.

    const proposals = runWatchers(snap, this.watchers, useProactiveness.getState().config.thresholds);
    const policy = useProactiveness.getState();
    for (const p of proposals) {
      if (!policy.mayFire(p.trigger)) continue;
      this.pushProposal(p);
      policy.recordFire(p.trigger);
      // The avatar reacts with a small "I have an idea" gesture when she
      // surfaces something proactively.
      this.pushAction('raise_eyebrow');
    }
  }

  /* --------------------------------------------------------------- turn */

  async send(text: string) {
    const script = SCRIPTS.find((s) => s.match.test(text)) ?? FALLBACK;
    const messageId = uid();

    this.emit({
      kind: 'message.start',
      message: { id: messageId, speaker: 'jarvis', text: '', at: Date.now(), streaming: true },
    });

    let delay = 420;
    const at = (ms: number, fn: () => void) => {
      this.timers.push(setTimeout(fn, ms) as unknown as number);
    };

    /* P0-A: push mood/emotion/action/memory/proposal before the turn begins
     * so the avatar has already settled into the right colour by the time
     * the first delta arrives. */
    if (script.mood) at(0, () => this.pushMood(script.mood!));
    if (script.emotion) at(40, () => this.pushEmotion(script.emotion!.emotion, script.emotion!.intensity, script.emotion!.trigger));
    if (script.action) at(80, () => this.pushAction(script.action!));

    /* P0-A: extract memories from the user's text. Run every rule — one
     * long sentence can carry a name, a preference, and an event, and we
     * shouldn't make the user repeat themselves. */
    const mems = extractMemories(text);
    const newMemoryIds: string[] = [];
    if (mems.length) at(60, () => {
      for (const m of mems) {
        const id = uid();
        newMemoryIds.push(id);
        this.pushMemory({ ...m, id, ts: Date.now(), source: 'told' });
      }
    });

    /* P0-A: surface a script-driven proposal (legacy path; new proposals
     * come from the watcher loop instead). */
    if (script.proposal) at(120, () => {
      const { expiresInMs, ...rest } = script.proposal!;
      this.pushProposal({
        ...rest,
        id: uid(),
        expiresAt: Date.now() + (expiresInMs ?? 24 * 60 * 60 * 1000),
      });
    });

    for (const tool of script.tools ?? []) {
      const call: ToolCall = { id: uid(), name: tool.name, summary: tool.summary, status: 'running' };
      at(delay, () => this.emit({ kind: 'tool.start', messageId, call }));
      delay += 500 + Math.random() * 400;
      at(delay, () =>
        this.emit({ kind: 'tool.end', messageId, callId: call.id, status: 'ok', output: tool.output }),
      );
      delay += 220;
    }
    // P1-B: rich tool card with structured payload (table/diff/chart/log/code).
    if (script.richTool) {
      const rc = script.richTool as ToolCall;
      const call: ToolCall = { ...rc, id: uid(), status: 'running' };
      at(delay, () => this.emit({ kind: 'tool.start', messageId, call }));
      delay += 600;
      at(delay, () =>
        this.emit({ kind: 'tool.end', messageId, callId: call.id, status: (rc.status === 'running' ? 'ok' : rc.status) as 'ok' | 'failed' | 'denied' }),
      );
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
        labels: [],     // P1-C
        priority: 1,    // P1-C: default mid-priority
        order: now,     // P1-C: arrival order; moveTask renorms
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
      /* P0-M: attach the memory ids we surfaced during this turn to the
       * message we just finished. The session store reads this and tags
       * the Message. Lets the UI say "she used 3 things she remembered". */
      if (newMemoryIds.length) {
        this.tagMessageWithMemories(messageId, newMemoryIds);
      }
      /* P0-A: drift mood back toward baseline after the turn, like exhaling. */
      this.pushMood(BASELINE_MOOD);
    });
  }

  async cancelTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const next: Task = { ...task, status: 'cancelled', updatedAt: Date.now(), result: '已按你的指令中止。' };
    this.tasks.set(taskId, next);
    this.emit({ kind: 'task.upsert', task: next });
    /* P0-A: tiny pout when she cancels something. */
    this.pushEmotion('sad', 0.25, 'cancelled by user');
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
    /* P0-A: optimistic little face. */
    this.pushEmotion('curious', 0.4, 'retry');
    this.pushAction('raise_eyebrow');
  }
}