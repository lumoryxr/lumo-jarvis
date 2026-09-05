import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// M9: dev-server hardening. We pin the dev port to 5173 so the URL
// is stable. If something else is already on 5173, Vite now fails
// loudly instead of silently falling back to 5174/5175 — that
// fallback was the source of "网页访问不了" reports: the user
// saw the old instance on 5173 (often a stale hot-reload) and
// didn't notice the new build had moved ports.
const DEFAULT_PORT = 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEFAULT_PORT,
    strictPort: true,
    // Loud banner so a port conflict is impossible to miss.
    open: false,
    host: '127.0.0.1',
  },
  // Plugins that read the active port from env still see DEFAULT_PORT.
  preview: {
    port: DEFAULT_PORT,
    strictPort: true,
    host: '127.0.0.1',
  },
});
