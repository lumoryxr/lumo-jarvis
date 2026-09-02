# Lumo JARVIS

A desktop companion that lives on your taskbar: she watches your day,
chimes in when it helps, dispatches long-running work to the local
Hermes gateway, and lets you steer with text or full-duplex voice.

## What's inside

* **React + TypeScript + Three.js + zustand** — the UI.
* **Tauri 2.x** — the production backend (Rust). Compiles to a real
  desktop app with sysinfo, SQLite, and a Hermes HTTP client.
* **Provider seam** — `src/services/provider.ts`. The UI never talks
  to anything except a `Provider` interface; `MockBackend` (in dev)
  and `TauriProvider` (in production) both implement it.
* **VRMAvatar** — Three.js scene that renders a real humanoid. The
  procedural fallback ships in the main bundle; loading an actual
  VRM is one call to `window.lumoAvatar.loadModel(url)`.

## Demo

```bash
npm install
npm run dev
```

Vite serves on http://localhost:5173 (or the next free port if 5173
is taken). Walk through the onboarding wizard — pick a preset, name
her, set proactiveness, language. The 3D avatar appears, blinks, and
mouths the welcome line. Cursor in the avatar area → eyes + head
follow. Cmd+M → activity panel. Cmd+. → connector page. Cmd+Shift+V
→ continuous listening (mic).

## Production build (Tauri)

```bash
cargo install tauri-cli --version "^2.0"
npm install
cd src-tauri && cargo tauri dev
```

The Rust backend (`src-tauri/`) wires:

* `sysinfo` for machine stats (CPU, memory, disks, processes).
* `rusqlite` (bundled) for memory + persona + task persistence.
* `reqwest` for `cmd_hermes_*` (dispatch to a local Hermes
  gateway) and `cmd_llm_*` (OpenAI-compatible /chat/completions).
* `@pixiv/three-vrm` is `optionalDependencies` in `package.json`
  and code-split by Vite; it only loads when the user opts in
  with `window.lumoAvatar.loadModel(url)`.

## Connector page → Hermes / LLM tabs

Both connectors are configured via `Cmd+.` → tab. Settings live in
`localStorage` so the user doesn't re-enter them on every boot; the
keys themselves stay in Rust parking_lot memory and never enter the
webview state tree.

## Hotkeys

| Key | Action |
|---|---|
| Cmd+L | Toggle window mode (full / widget / min) |
| Cmd+. | Connector page (Hermes / OS / LLM / Voice) |
| Cmd+M | Activity panel |
| Cmd+, | Reopen onboarding wizard |
| Cmd+Shift+V | Toggle continuous voice loop |

## Architecture

```
src/
  core/types.ts        — single source of truth for shapes
  services/
    provider.ts        — Provider interface + ProviderEvent union
    mock.ts            — MockBackend (scripted turns)
    tauri.ts            — TauriProvider (production)
    voice.ts           — Web Speech capture + TTS, barge-in
    visemes.ts         — text → viseme stream (CN+EN)
    llm-direct.ts      — optional browser-side LLM stream
    hermes.ts          — TS Hermes HTTP client (used in dev when
                         CORS allows it; otherwise via Rust)
    watchers.ts        — proactive watcher framework
    memory.ts          — localStorage-backed memory store
  state/
    session.ts         — messages + tasks + connectors + provider
    persona.ts         — preset + name + mood + emotion + tunables
    proactiveness.ts   — band + thresholds + history heatmap
    onboarding.ts      — wizard state
    activity.ts        — activity log
    windowMode.ts      — full / widget / min
    theme.ts           — default / warm / cool / glass
  avatar/
    HoloCore.ts        — lightbulb (kept for widget mode)
    MiniHoloCore.ts    — lightbulb-lite for the floating widget
    VRMAvatar.ts       — Three.js scene (procedural + VRM)
    vrm.css            — canvas + mode pill
    shaders.ts         — HoloCore shaders
  hooks/
    useVoiceLoop.ts    — full-duplex voice hook
  components/
    App, TopBar, SystemRail, AvatarStage, Conversation,
    Composer, TaskBoard, CompanionWidget, MemoryConsole,
    ActivityPanel, OnboardingWizard, ProactivenessPanel,
    ConnectorsModal, primitives

src-tauri/
  Cargo.toml             — sysinfo, rusqlite, reqwest, tokio
  tauri.conf.json        — identifier, icons, transparent window
  capabilities/default.json
                         — core + shell + fs(scope) + dialog
  src/
    main.rs              — binary entry
    lib.rs               — Tauri Builder + setup + invoke_handler
    provider.rs          — TauriProvider (machine tick + commands)
    memory.rs            — Tauri commands for memory store
    machine.rs           — sysinfo-backed MachineSnapshot
    store.rs             — SQLite + FTS5 + migrations
    error.rs             — LumoError + Result
    watchers.rs          — basic morning greeter
    hermes.rs            — Hermes HTTP client + SSE consumer
    llm.rs               — OpenAI-compatible streaming LLM
    schema.sql           — embedded DDL
  icons/                 — 32, 128, 128@2x, ico
  tests/smoke.rs         — cargo test (memory + persona KV)
```

## Tests

```bash
npm run lint          # oxlint
npm run build         # tsc + vite build
cd src-tauri && cargo test --tests
cd src-tauri && cargo check
```

## Roadmap

* P0-A through P1-O — companion layer, polish, modal, drag, themes.
* M1 — real Tauri backend (compile-checked + tested).
* M2 — real 3D avatar (procedural + VRM + visemes + gaze).
* M3 — Hermes HTTP + full-duplex voice with barge-in.
* M4 — real LLM turn handler (OpenAI-compatible streaming).
* M5+ — production hardening: actual TTS voices, real avatar
  presets, sidecar Hermes, installer signing, auto-update.

See `docs/HANDOFF.md` (and the `HANDOFF.md` inside `src-tauri/`)
for the per-stage migration notes.
