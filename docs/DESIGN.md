# Lumo JARVIS — 设计文档

一个桌面端的数字人助理：**你和它说话，它替你操作这台电脑，并把长任务下发给 Hermes 去做，然后把所有任务的状态汇总给你看。**

本文是架构与设计的正文。视觉规范见 [UI.md](./UI.md)，Hermes 接入细节见 [HERMES.md](./HERMES.md)。

---

## 1. 产品定位

三句话说清它是什么：

| 它是 | 它不是 |
|---|---|
| 一个**常驻**的桌面伙伴，你随时说一句话就能派活 | 一个聊天窗口 |
| 一个**任务的中枢**——自己能做的当场做，做不完的下发给 Hermes | 又一个待办清单 App |
| 一个**在场的存在**——你看得见它在听、在想、在干活 | 一个转圈的 loading 图标 |

第三点是数字人存在的唯一理由。如果头像只是装饰，就不该做它。它的价值在于**把 Agent 的内部状态变成一眼可读的物理直觉**：颜色、湍流、转速、辉光强度共同编码"它现在在干嘛"，你不用读文字就知道。

## 2. 信息架构

界面固定三栏，映射三个不同的问题：

```
┌───────────────────────────────────────────────────────────────────────┐
│ 顶栏  LUMO / JARVIS   ACTIVE 2 · NEEDS YOU 1 · STATE idle      时钟   │
├──────────────┬─────────────────────────────────┬──────────────────────┤
│  这台机器     │          这个 Agent              │      这些活儿        │
│              │                                 │                      │
│  WORKSTATION │      ┌─────────────┐            │   MISSION BRIEF      │
│   CPU / MEM  │      │   数字人     │            │   汇总 + 计数        │
│   磁盘/网络   │      │  (WebGL)    │            │                      │
│              │      └─────────────┘            │   ─────────────      │
│  LINKS       │        状态 · 字幕               │   TASKS              │
│   Hermes ●   │  ─────────────────────────      │   [进行中|待我|全部] │
│   OS 桥 ●    │        对话流                    │                      │
│   推理端 ●   │   （含内联工具调用记录）          │   任务卡片            │
│   语音 ○     │  ─────────────────────────      │    ├ 执行方 / 状态    │
│              │   [快捷指令]                     │    ├ 进度条          │
│  TOP PROCESS │   [🎤  输入框            ➤]     │    └ 展开：步骤/操作  │
└──────────────┴─────────────────────────────────┴──────────────────────┘
    264px               自适应                          340px
```

**左=机器状态，中=Agent，右=工作。** 这个映射是整个 IA 的全部——用户永远不用想"这个东西在哪一栏"。

### 为什么右栏顶部要有 MISSION BRIEF

五张任务卡不是"现在什么情况"的答案。人真正要的是两件事：**哪些需要我**、**哪些在动**。所以 `buildBriefing()` 把任务列表压成一句话 + 五个计数 + 几条要点，放在列表之上。列表是细节，简报是答案。

## 3. 系统架构

```
┌─────────────────────── Tauri 窗口 ────────────────────────┐
│                                                           │
│  WebView (React + TypeScript)                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  components/   三栏 UI                               │  │
│  │  avatar/       HoloCore — Three.js 数字人             │  │
│  │  state/        zustand 单一 store                     │  │
│  │  services/     Provider 接口 ← 唯一的对外缝           │  │
│  └─────────────────────────────────────────────────────┘  │
│                         ↕ IPC (invoke / emit)             │
│  Rust Core                                                │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  lumo-core (独立 crate，无 GUI 依赖，有单测)          │  │
│  │    machine.rs   sysinfo 采样 → MachineSnapshot       │  │
│  │    hermes.rs    Runs API 客户端 + SSE 解码            │  │
│  │    types.rs     与 TS 对齐的 wire types              │  │
│  │  src-tauri      命令注册 / 事件推送 / 权限闸门        │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────┬──────────────────────────┬────────────────────┘
            │                          │
     ┌──────▼──────┐           ┌───────▼────────┐
     │  操作系统    │           │  hermes-agent   │
     │ 文件/进程/   │           │  127.0.0.1:8642 │
     │ Shell/截屏   │           │  OpenAI 兼容    │
     └─────────────┘           └────────────────┘
```

### 为什么内核逻辑单独成 crate

`lumo-core` 不依赖 Tauri，也不依赖任何 GUI。好处是实打实的：

- **能在任何机器上编译和跑测试**，不需要装系统 webview（本仓库的 10 个 Rust 测试就是这么跑起来的）。
- SSE 解码这类容易出错的逻辑可以直接单测，不用起窗口。
- 将来要做 headless 模式（比如让 JARVIS 在服务器上常驻），内核直接复用。

`src-tauri` 只做三件事：注册命令、把事件 emit 给前端、执行权限闸门。

### 为什么 Hermes 走 Rust 而不是前端直连

三个理由，任何一个都足够：

1. 网关默认绑 `127.0.0.1` 且 **CORS 关闭**，webview 里的 `fetch` 根本连不上。
2. `API_SERVER_KEY` 不该出现在任何 JS 可达的作用域里。
3. 长任务需要在 UI 切走、甚至窗口最小化时继续跑并累积事件。

前端的 `src/services/hermes.ts` 保留了等价的 TS 实现——它用于浏览器原型模式（配 `API_SERVER_CORS_ORIGINS` 时可用），也是 Rust 端行为的可读参照。

## 4. Provider：唯一的对外缝

整个 UI 只认识一个接口：

```ts
interface Provider {
  start(): Promise<void>;
  subscribe(listener: (e: ProviderEvent) => void): () => void;
  send(text: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  retryTask(id: string): Promise<void>;
}
```

`ProviderEvent` 是一个可辨识联合：`message.start / message.delta / message.end / tool.start / tool.end / task.upsert / machine / connector / speech`。

**这就是原型和成品能共用全部组件的原因。** 换后端是 `src/state/session.ts` 里的一行：

```ts
const provider: Provider = new MockBackend();   // 原型
const provider: Provider = new TauriProvider(); // 真机
```

`MockBackend` 不是敷衍的假数据——它发出的每一个事件，真 Provider 也会发。它编造了一台合理的机器、一条 Hermes 形状的任务流水线和一段有脚本的对话，让整个界面在没有网关、没有密钥、没有 webview 的情况下被完整地走一遍。

## 5. 数字人

### 当前实现：HoloCore

默认头像不是一个绑好骨骼的人头。理由很实际：一个像样的人头需要授权模型、blendshape 绑定和 viseme 管线三样都到位才好看，缺一样就落进恐怖谷。所以默认形态是一个**体积光核心**：

| 层 | 实现 | 作用 |
|---|---|---|
| 内核辉光 | 面向相机的平面 + 双瓣径向衰减 | 给"里面有东西在烧"的感觉 |
| 外壳 | 48 细分二十面体 + 噪声位移 + 菲涅尔 | 轮廓发光，中心透明 |
| 线框 | 4 细分同场位移的 wireframe | 在辉光里透出结构 |
| 粒子壳 | 5200 点，斐波那契球分布，各自相位呼吸 | 体积感与活性 |
| HUD 环 | 3 条不同倾角的虚线环 | 陀螺仪隐喻，转速编码忙碌程度 |
| 后期 | UnrealBloom，阈值 0.30 | 只让最亮的边缘溢出 |

**状态到视觉的映射**（`STATE_LOOK`）：

| 状态 | 颜色 | 湍流 | 环转速 |
|---|---|---|---|
| `idle` 待命 | 青 | 0.55 | 0.18 |
| `listening` 聆听 | 亮青 | 0.85 | 0.42 |
| `thinking` 推理 | 紫 | 1.30 | 0.78 |
| `speaking` 应答 | 青 | 1.10 | 0.34 |
| `acting` 执行 | 金 | 1.15 | 0.60 |
| `error` 异常 | 品红 | 1.55 | 0.95 |

所有过渡都是每帧按 `1 - 0.0015^dt` 逼近目标，不是硬切。一串工具调用连续触发时不会频闪。

> **调参教训**：第一版把菲涅尔亮度和 bloom 都开满，结果核心糊成一个纯白球，什么结构都看不见。加性混合下**平坦的内部 alpha 是灾难**——它会和背后每一层叠加然后被 bloom 推爆。解法是把外壳内部压到近乎全透（`alpha = 0.02 + fres^3.2 * 0.88`），亮度改由一个独立的、有径向衰减的辉光层提供。

### 换成真人形象

`HoloCore` 只暴露两个方法：`setState(AgentState)` 和 `setAmplitude(0..1)`。任何实现了这两个方法的东西都能替换它，`AvatarStage` 不用改：

- **VRM**（`@pixiv/three-vrm`）：`setAmplitude` → `expressionManager` 的 `aa/ih/ou` 权重；`setState` → 表情预设 + 环境光色温。
- **GLB / ReadyPlayerMe**：同上，走 ARKit 52 blendshape。
- **Live2D**：适合二次元路线，成本最低。
- **音频驱动的口型**：真正的做法是让 TTS 吐 viseme 时间轴（Azure Speech、ElevenLabs 都有），而不是像现在这样从文本流长度反推包络。见 §6。

## 6. 语音链路

| 阶段 | 原型（现在） | 生产路径 |
|---|---|---|
| 唤醒 | 点麦克风按钮 | 本地热词（openWakeWord / Porcupine），Rust 侧常驻 |
| ASR | Web Speech API | `whisper.cpp` 作为 Tauri sidecar，流式转写，全本地 |
| 端点检测 | 浏览器自动判断 | Silero VAD |
| TTS | `speechSynthesis` | 带 viseme 输出的引擎，口型才能真同步 |
| 口型 | 从 `onboundary` 事件合成的衰减包络 | viseme 时间轴 → blendshape |

麦克风电平已经是真的：`VoiceIO.startMeter()` 走 `AnalyserNode` 算 RMS，聆听时数字人是**真的**跟着你的音量在动。

## 7. 电脑管理与权限

这是整个产品**风险最高**的部分。一个能执行 shell 的助手，设计上必须默认不信任自己。

### 能力分级

| 级别 | 例子 | 策略 |
|---|---|---|
| **读** | 列进程、读系统指标、读文件元信息 | 直接执行，不打扰 |
| **可逆写** | 移动文件到废纸篓、启动应用、写入沙盒目录 | 执行，事后可撤销，记日志 |
| **不可逆 / 高危** | `rm`、改系统配置、`kill` 进程、装软件、网络请求外发 | **先出计划，等确认**（任务进 `review` 态） |

原型里"清理 ~/Downloads"那张卡就是这个模式的示范：它已经**列好了 41 个文件共 12.4 GB**，但停在 `review` 等你按「批准执行」。**先出清单再执行**是这类操作的默认交互，不是可选项。

### 闸门放在 Rust 侧

权限判定绝不能放在前端——前端只是渲染层，绕过它是平凡的。`src-tauri` 的命令处理器在真正调用系统 API 之前做三件事：

1. 路径白名单校验（拒绝 `~/.ssh`、`/etc`、keychain 等）。
2. 危险动作分类，命中则不执行，改为返回一个待确认的计划。
3. 全量审计日志：谁、什么时候、执行了什么、结果如何。

Tauri 的 capability 配置（`src-tauri/capabilities/`）是第二道闸：即使代码有洞，webview 也拿不到没声明的能力。

## 8. 任务模型

一个 `Task` 是"一件要完成的事"，不区分谁来做——`executor` 字段才区分：

- `hermes` — 下发给 Hermes 的长任务，`externalId` 存 `run_id`
- `local` — JARVIS 自己在这台机器上执行
- `user` — 需要人做的（等确认、等你决策）

状态机：

```
queued ──► running ──┬──► done
   │         │       ├──► failed ──► (retry) ──► running
   │         │       └──► review ──┬──► running   (批准)
   │         │                     └──► cancelled (驳回)
   └─────────┴──► cancelled
```

`review` 是这个模型里最重要的状态，它是人机之间的**制动器**。任何高危操作、任何 Hermes 想做但超出授权范围的事，都停在这里等人。

### Hermes 任务的生命周期

```
用户说 "让 Hermes 重构 payments 模块"
        │
        ├─ JARVIS 判定：长任务 → 下发
        │
        ├─ Rust: hermes.create_run(input, instructions)  →  run_id
        │         instructions 里注入约束：
        │           "先出计划再动手 / 改动限制在目标模块 / 跑完测试才算完成"
        │
        ├─ Task { executor: hermes, externalId: run_id, status: running }
        │         → task.upsert → 右栏出现卡片
        │
        ├─ Rust: hermes.stream_run(run_id) ─┬─ Delta      → 卡片进度/摘要
        │                                   ├─ ToolCall   → 步骤推进
        │                                   └─ Status     → 终态
        │
        └─ status: completed → Task.status = done, result = 输出摘要
```

关键设计：**用 Runs API，不用 `/v1/chat/completions`**。后者没有句柄，没法取消，没法在 UI 切走后重新附着。Runs API 给了 `run_id`，`GET /v1/runs/{id}` 可以随时对账，`POST /v1/runs/{id}/stop` 可以中止。

注意网关的两个约束（见 [HERMES.md](./HERMES.md)）：事件缓冲 **5 分钟**不消费就丢弃，所以 `create_run` 之后要立刻接上流；并发上限默认 10，超了返回 429。

## 9. 技术选型

| 选择 | 理由 | 代价 |
|---|---|---|
| **Tauri** 而非 Electron | 包体小一个数量级，内存占用低，Rust 侧做权限闸门天然合适 | 各平台 webview 有差异；需要装系统依赖才能构建 |
| **Three.js** 原生，不用 R3F | 数字人是一个自包含的命令式渲染循环，套一层 React 协调器只是负担 | 手写生命周期管理 |
| **zustand** 而非 Redux | 单窗口应用，状态量不大，样板代码越少越好 | 大规模时缺乏严格约束 |
| **无 UI 框架**，手写 CSS | 这套视觉语言（发光、菲涅尔边、HUD 角标）没有任何组件库能给；Tailwind 只会让它更啰嗦 | 自己维护设计令牌 |
| **无图表库** | 需要的只有 sparkline 和圆环表，纯 SVG 二十行搞定 | — |

## 10. 落地路线

- **M0 · 已完成（本仓库）** — 三栏 UI、数字人渲染、对话与工具调用可视化、任务板与简报、Mock 后端跑通全流程；Rust 内核的机器采样与 Hermes SSE 解码，含 10 个单测。
- **M1 · 接通真机** — `TauriProvider` 落地，`lumo-core::machine` 的快照接到左栏，替换 `MockBackend`。
- **M2 · 接通 Hermes** — Rust 侧 `create_run` / `stream_run` 接到任务板，跑通一个真实的编码任务。
- **M3 · 电脑管理** — 文件、进程、应用控制；权限闸门与审计日志；`review` 流程端到端。
- **M4 · 语音** — whisper.cpp sidecar + 热词唤醒 + 带 viseme 的 TTS。
- **M5 · 形象** — 可选的 VRM 头像；数字人从"光核"升级为"人"。
- **M6 · 常驻** — 全局快捷键唤起、菜单栏驻留、通知中心集成、开机自启。

## 11. 已知边界

诚实地列出来：

- **Rust GUI 层未在本环境编译验证。** 本容器缺 `webkit2gtk-4.1` / `gtk3`，`src-tauri` 无法 `cargo check`。这正是内核逻辑被拆进 `lumo-core` 的原因——那部分是验证过的（10 个测试通过）。`src-tauri` 需要在装了平台依赖的机器上首次构建。
- **数字人是光核，不是人脸。** 这是本轮的刻意选择（§5），不是能力缺口。
- **口型不是真同步。** 现在从文本流合成包络；真同步要等 viseme 管线（§6）。
- **Mock 的任务标题会直接取用户输入**，真实现里应该由推理端总结成短标题。
- **前端 bundle 767 KB**（gzip 209 KB），主要是 Three.js。桌面应用里可接受；若要上 Web 需按需切分。
