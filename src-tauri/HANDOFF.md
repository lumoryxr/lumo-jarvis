# M1 Handoff — Tauri Migration

The skeleton from P0-O has been filled out: the Rust backend
**type-checks, builds, and runs its own integration test**. The
frontend switches providers automatically when launched under Tauri
(see `src/services/tauri.ts` + the `__TAURI_INTERNALS__` check in
`src/state/session.ts`).

## What works today

- `cargo check` / `cargo build` pass.
- `cargo test --tests` runs the SQLite store smoke tests (memory
  upsert / FTS5 search / persona KV roundtrip).
- `npm run tauri:dev` / `tauri build` (after installing the CLI
  binary) should produce a runnable desktop app with real sysinfo
  ticks every second.
- Icons exist (32x32.png, 128x128.png, 128x128@2x.png, icon.ico) so
  tauri-build doesn't reject the bundle.

## What was wired

```
src-tauri/
  Cargo.toml                 sysinfo, rusqlite, reqwest, tokio, chrono, uuid, etc.
  tauri.conf.json            production config (frameless, transparent)
  capabilities/default.json  locked-down IPC: core + shell + fs(scope) + dialog
  HANDOFF.md                 this file
  src/
    main.rs                  binary entry, calls lib::run()
    lib.rs                   Tauri Builder + setup() + invoke_handler
    provider.rs              TauriProvider + 14 #[tauri::command]s
    memory.rs                memory_upsert/search/export/clear/remove commands
    machine.rs               sysinfo-backed MachineSnapshot + Machine::new
    store.rs                 SQLite + FTS5 schema + migrations
    error.rs                 single LumoError + Result alias
    watchers.rs              basic 8am-greeter as a stand-in for M4 watchers
    schema.sql               embedded DDL via include_str!()
  tests/
    smoke.rs                 Store roundtrip + persona KV roundtrip
  icons/                     32, 128, 128@2x PNG + Windows .ico
```

## Step 3 — Frontend seam (done)

`src/services/tauri.ts` implements the `Provider` interface and
mirrors events into the existing zustand stores via the
`applyProviderEvent` reducer added to `state/session.ts` in M1-B.
The factory at `state/session.ts` picks the right provider at
boot time.

## Step 5 — Real LLM turn handler (M4)

The current TauriProvider's `send()` is a log-only stub. M4 will
fill it with a real LLM roundtrip via `reqwest` (OpenAI-compatible
HTTP) and stream the reply back through `lumo:event` ProviderEvents.
Until then the React side keeps using MockBackend; the type contract
is the same so the swap is one line in `session.ts` once M4 lands.

## Smoke run

```
$ cargo test --tests
running 2 tests
test persona_kv_roundtrip ... ok
test store_roundtrip ... ok

test result: ok. 2 passed; 0 failed
```
