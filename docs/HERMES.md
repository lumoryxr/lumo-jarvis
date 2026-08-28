# Hermes 接入规格

[hermes-agent](https://github.com/NousResearch/hermes-agent)（NousResearch）是一个开源的自主 Agent 框架，自带终端、文件、网页搜索、记忆和 skills 工具集。JARVIS 把它当作**长任务的执行器**：自己能当场做完的事自己做，需要长时间干活的（写代码、开发项目、跑分析）下发给它。

## 1. 网关

Hermes 的 API server 默认不开，需要在它的 `.env` 里打开：

```env
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
API_SERVER_HOST=127.0.0.1
API_SERVER_KEY=<你的密钥>
```

启动后所有请求带 `Authorization: Bearer <API_SERVER_KEY>`。

> **CORS 默认关闭**，且只绑 `127.0.0.1`。这意味着 webview 里的 `fetch` 连不上——所有请求必须从 Tauri 的 Rust 侧发出。这不是绕路，这是对的：密钥也因此不进 JS 作用域。
>
> 只在浏览器原型模式下，才需要设 `API_SERVER_CORS_ORIGINS=http://localhost:5173`。

## 2. 为什么用 Runs API

网关提供三套接口，JARVIS 选 Runs：

| 接口 | 形状 | 为什么不用 / 用 |
|---|---|---|
| `/v1/chat/completions` | OpenAI 兼容，一问一答 | **不用**：没有句柄，没法取消，UI 切走就断了 |
| `/v1/responses` | 服务端存会话状态 | 适合多轮对话，但同样缺任务级控制 |
| **`/v1/runs`** | 创建 → 流式 → 轮询 → 中止 | **用这个**：`run_id` 就是任务卡的 `externalId` |
| `/api/jobs` | 定时任务 | M6 做"每天早上汇总昨天的 CI"这类会用到 |

## 3. 调用序列

```
POST /v1/runs
  { "input": "重构 payments 模块的错误处理",
    "instructions": "<注入的约束，见 §4>",
    "session_id": "lumo-jarvis" }
  → { "run_id": "run_7f3a91", "status": "started" }

GET /v1/runs/run_7f3a91/events          (SSE，立刻接上)
  → event: hermes.tool.progress
    data: {"name":"terminal","arguments":"{\"command\":\"ls\"}","call_id":"call_1"}
  → data: {"type":"function_call_output","call_id":"call_1","output":"src/ tests/"}
  → data: {"choices":[{"delta":{"content":"我先看一下现有的错误处理…"}}]}
  → data: {"status":"completed"}

GET  /v1/runs/run_7f3a91                 (对账，任何时候都能查)
POST /v1/runs/run_7f3a91/stop            (用户点「中止」)
```

**两个必须守住的约束：**

1. **事件缓冲 5 分钟不消费就丢弃。** `create_run` 返回后必须立刻接上 `/events`，不能等 UI 就绪。Rust 侧的做法是创建即订阅，事件先落到内存队列，前端附着时重放。
2. **并发上限默认 10**（`gateway.api_server.max_concurrent_runs`），超了返回 **429**。任务板需要一个本地排队层：超限时任务停在 `queued`，有 slot 释放再发。

## 4. 注入的约束

`instructions` 是这次接入里**最影响体验**的一个字段。放任 Hermes 自由发挥，你会得到一个改了三十个文件、没跑测试、也说不清干了什么的 run。JARVIS 下发时统一注入：

```
先出计划再动手，计划要列出你打算改哪些文件。
改动限制在目标模块内，不要顺手重构无关代码。
每完成一个步骤，简短报告一次进度。
跑完项目自带的测试，全绿才算完成。
遇到需要删除文件、修改系统配置、或安装依赖的情况，停下来说明原因，不要自己决定。
```

最后一条把 Hermes 的高危动作也接回了 JARVIS 的 `review` 闸门（见 [DESIGN.md §7](./DESIGN.md#7-电脑管理与权限)），人机之间只有一个制动器，不是两个。

## 5. 事件到 UI 的映射

| Hermes 事件 | ProviderEvent | 界面表现 |
|---|---|---|
| `hermes.tool.progress` / `function_call` | `tool.start` | 对话流里出现一行工具记录，圆点脉冲 |
| `function_call_output` | `tool.end` | 该行变绿/变红，右侧显示输出摘要 |
| `choices[].delta.content` | `message.delta` | 文字逐字流入，数字人转 `speaking` |
| `status: completed` | `task.upsert` | 任务卡进度到 100%，转 `done` |
| `status: failed` | `task.upsert` | 卡片转 `failed`，露出「重试」按钮 |
| HTTP 429 | `task.upsert` | 任务停在 `queued`，等 slot |

## 6. 实现位置

| 文件 | 角色 | 状态 |
|---|---|---|
| `core/src/hermes.rs` | Rust 客户端 + SSE 解码 | ✅ 6 个单测覆盖各类帧 |
| `src/services/hermes.ts` | TS 等价实现 | 浏览器原型模式用；也是 Rust 行为的可读参照 |
| `src/services/mock.ts` | 模拟 Hermes 形状的任务流水线 | 当前原型驱动 |

SSE 解码是这里唯一容易出错的地方——分片可能在任意字节处断开，`data:` 可能跨多行，还混着 keepalive 和 `[DONE]`。两边实现都按"缓冲到 `\n\n` 再解析单帧"处理，Rust 侧的测试专门覆盖了 token delta、工具调用、工具输出、终态、keepalive、多行 data 和不可解析帧七种情况。
