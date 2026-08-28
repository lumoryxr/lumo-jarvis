# Lumo JARVIS

一个桌面端数字人助理：**你和它说话，它替你操作电脑，把长任务下发给 [Hermes](https://github.com/NousResearch/hermes-agent) 去做，并把所有任务的状态汇总给你。**

当前状态：**设计 + 可运行的 UI 原型（M0）**。三栏界面、WebGL 数字人、对话与工具调用可视化、任务板与简报全部跑通，由一个 Mock 后端驱动；Rust 内核的机器采样与 Hermes 客户端已实现并通过单测。

## 跑起来

```bash
npm install
npm run dev          # http://localhost:5173
```

原型不需要 Hermes 网关、API 密钥或任何系统依赖——`MockBackend` 会编造一台合理的机器和一条 Hermes 形状的任务流水线，让整个界面被完整走一遍。

试试这几句：

- `汇总一下当前所有任务` — 看简报与任务板
- `内存占用有点高，看看怎么回事` — 看内联的工具调用记录
- `让 Hermes 重构 payments 模块的错误处理` — 看任务下发后落到右栏并开始推进

Rust 内核：

```bash
cd core && cargo test    # 10 个测试：机器采样 + Hermes SSE 解码
```

## 文档

| | |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | 架构正文：信息架构、Provider 缝、数字人、权限模型、任务模型、路线图 |
| [docs/UI.md](docs/UI.md) | 视觉规范：色板、字体、面板、动效、数字人调参 |
| [docs/HERMES.md](docs/HERMES.md) | Hermes 接入：网关配置、Runs API、注入约束、事件映射 |

## 结构

```
src/
  core/types.ts        领域模型（与 Rust 侧对齐）
  services/
    provider.ts        UI 与后端之间唯一的接口
    mock.ts            原型后端
    hermes.ts          Hermes 网关客户端（TS）
    voice.ts           语音输入输出
  avatar/
    HoloCore.ts        数字人渲染器
    shaders.ts         GLSL
  state/session.ts     zustand store + 简报计算
  components/          三栏 UI
  styles/tokens.css    设计令牌

core/                  Rust 内核（无 GUI 依赖，可独立编译测试）
  src/machine.rs       sysinfo 采样
  src/hermes.rs        Runs API 客户端 + SSE 解码
  src/types.rs         wire types
```

## 换掉 Mock

整个 UI 只认识 `Provider` 接口，所以换后端是 `src/state/session.ts` 里的一行：

```ts
const provider: Provider = new MockBackend();   // 现在
const provider: Provider = new TauriProvider(); // 接上真机 + Hermes
```

## 已知边界

- **Tauri GUI 层尚未落地。** 本仓库的 Rust 部分是内核逻辑（`core/`），它不依赖 webview，因此能在任何机器上编译和测试。`src-tauri` 的窗口层是 M1 的工作。
- **数字人是体积光核心，不是人脸。** 这是刻意选择，理由见 [DESIGN.md §5](docs/DESIGN.md#5-数字人)；换成 VRM 头像不需要改任何组件。
- **口型不是真同步**，现在从文本流合成包络；真同步要等 viseme 管线。
