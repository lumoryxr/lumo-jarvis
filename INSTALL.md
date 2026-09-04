# Lumo JARVIS — Installation & Deployment

This document covers the production setup for the Tauri desktop
app. The frontend ships as `dist/` from `npm run build`; the desktop
binary ships from `cargo tauri build` inside `src-tauri/`.

## 1. Prerequisites

* Node 18+ for the frontend.
* Rust 1.74+ with the `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`,
  or `x86_64-unknown-linux-gnu` target installed.
* On Windows: WebView2 (ships with Windows 10+, install via Edge).
* On Linux: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`.

## 2. Build the desktop app

```bash
# one-time
cargo install tauri-cli --version "^2.0"
npm install

# dev (live webview + auto-reload on Rust changes)
cd src-tauri && cargo tauri dev

# production installer (msi/dmg/deb in src-tauri/target/release/bundle/)
cd src-tauri && cargo tauri build

# release helper (bumps version + builds + collects installers)
./scripts/release.sh 0.2.0
```

## 3. Configure the runtime

Open the app once. Cmd+. opens the connector page.

| Tab | What to configure | Where it persists |
|---|---|---|
| HERMES | Local Hermes gateway URL + bearer token | lumo.hermes.url + lumo.hermes.key + Rust parking_lot |
| REASONER | OpenAI-compatible `/chat/completions` URL + API key + model | lumo.llm.* |
| VOICE | Pick a system speechSynthesis voice | lumo.voice.uri + lumo.voice.lang |
| OS | Pick a VRM avatar (Luna / Haori / Procedural) | lumo.avatar.model |

The keys stay in Rust parking_lot memory and never enter the
webview state tree.

## 4. Optional: Whisper sidecar

The continuous voice loop uses Web Speech API by default. For
better accuracy, install `whisper.cpp` and configure it from the
REASONER tab once M8-A is fully wired.

```
brew install whisper-cpp   # macOS
# or download ggml-base.en.bin from
# https://huggingface.co/ggerganov/whisper.cpp
```

## 5. Auto-update

`tauri-plugin-updater` is wired. The release flow:

```bash
./scripts/release.sh 0.2.0
./scripts/build-update-manifest.sh 0.2.0 dist/release/0.2.0/installer.exe
# upload dist/release/0.2.0/update/0.2.0.json to a GitHub release tag
# upload dist/release/0.2.0/installer.exe to the same release
```

`tauri.conf.json` already points the updater at the GitHub release
URL. Sign the manifest with `minisign` and replace `pubkey` in
`tauri.conf.json` before shipping.

## 6. Permissions

The capabilities file at `src-tauri/capabilities/default.json`
locks down the IPC surface. Only these are exposed:

* core:event / core:window / core:webview / core:path (default)
* shell:allow-open (open links in the OS browser)
* fs scoped to $DOCUMENT, $DOWNLOAD, $DESKTOP
* dialog:open + dialog:save

Everything else is denied by default.

## 7. Hermes deployment (companion gateway)

Lumo JARVIS dispatches long-running coding work through your local
`hermes-agent` gateway (https://github.com/bdr-prod/external-llm).
Run it on 127.0.0.1:8642 by default; open the connector page and
paste the gateway URL + bearer token.

In production, point the gateway at a remote LLM endpoint (OpenAI,
Anthropic, local ollama, etc.). The companion app doesn't talk to
the LLM directly.

## 8. Known issues + roadmap

* Auto-update signing key is a placeholder.
* Screen capture is a stub command (lands in P5-C).
* Tray icon is not implemented (M8-C only intercepts close).
* Hermes runs are not stored in SQLite yet (Rust side stays
  stateless across restarts; M8 follow-up).
