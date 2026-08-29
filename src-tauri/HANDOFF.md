# M1 Handoff — Tauri Migration

This `src-tauri/` directory is the M1 target. The frontend (everything in
`src/`) keeps running off `MockBackend` in dev until M1 boots.

## Step 1 — Install the toolchain
    npm i -D @tauri-apps/cli
    cargo install tauri-cli --version "^2.0"

## Step 2 — Implement the stubs
The Rust files in `src-tauri/src/` are skeletons. Flesh them out:

- `provider.rs` — replace the log-only commands with the real ProviderEvent
  surface. Each command should emit `ProviderEvent`s via `window.emit`.
- `memory.rs` — add `rusqlite` + `tokio`. Schema matches the TS type.
- `machine.rs` — already uses sysinfo; just wire it onto a 1s timer.

## Step 3 — Frontend seam
Add `services/tauri.ts` that mirrors `services/mock.ts`. The factory at
`src/state/session.ts:24` switches on `import.meta.env.TAURI_PLATFORM` to
pick one or the other.

## Step 4 — Permissions
Edit `src-tauri/capabilities/default.json` to grant only the IPC channels
the frontend actually uses.

## Step 5 — Icons
Drop real PNG/ICO icons into `src-tauri/icons/`. The placeholder path
in `tauri.conf.json` will block `tauri build` otherwise.
