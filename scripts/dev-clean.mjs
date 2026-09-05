#!/usr/bin/env node
// scripts/dev-clean.mjs
//
// Pre-dev hook that kills any vite process holding port 5173 (and
// the next two fallbacks), so a `npm run dev:clean` is guaranteed
// to bind the canonical URL.
//
// Run via `npm run dev:clean`. Regular `npm run dev` skips this
// — use that when you actually want strictPort: true to refuse.

import { execSync } from 'node:child_process';

const PORTS = [5173, 5174, 5175, 5176, 5177, 5178];

async function main() {

function listListeners() {
  try {
    const out = execSync('netstat -ano -p TCP', { encoding: 'utf8' });
    const map = new Map(); // port -> Set<pid>
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+[\d.:]+:(\d+)\s+[\d.:]+:\d+\s+LISTENING\s+(\d+)/);
      if (!m) continue;
      const port = Number(m[1]);
      const pid = Number(m[2]);
      if (PORTS.includes(port) && pid > 0) {
        if (!map.has(port)) map.set(port, new Set());
        map.get(port).add(pid);
      }
    }
    return map;
  } catch (e) {
    console.warn('[dev-clean] netstat failed:', e.message);
    return new Map();
  }
}

function isVite(pid) {
  try {
    // tasklist accepts /v 1 (verbose) but PID filter is enough.
    // Use wmic fallback: PowerShell query.
    const ps = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" ` +
               `| Select-Object -ExpandProperty CommandLine`;
    const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' });
    return /vite(\/|\\)/.test(out) || /vite\.js/.test(out);
  } catch {
    return false;
  }
}

const map = listListeners();
let killed = 0;
for (const [port, pids] of map) {
  for (const pid of pids) {
    if (isVite(pid)) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`[dev-clean] killed vite pid=${pid} on port ${port}`);
        killed++;
      } catch (e) {
        console.warn(`[dev-clean] failed to kill ${pid}:`, e.message);
      }
    }
  }
}
if (killed === 0) {
  console.log('[dev-clean] no stale vite processes on', PORTS.join('/'));
} else {
  // Wait briefly for the OS to release the sockets.
  await new Promise((r) => setTimeout(r, 600));
  console.log(`[dev-clean] cleared ${killed} process(es); port 5173 is free.`);
}
}

main().catch((e) => {
  console.error('[dev-clean] failed:', e);
  process.exit(1);
});
