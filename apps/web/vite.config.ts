import { defineConfig } from 'vite';

/**
 * The web shell. In development Vite serves it and proxies the game's socket, `/play`, to
 * `apps/server` on :8080 (`pnpm dev` runs both); `RICOCHET_SERVER` points the proxy elsewhere.
 */
const server = process.env['RICOCHET_SERVER'] ?? 'http://127.0.0.1:8080';
const proxy = { '/play': { target: server, ws: true } };

export default defineConfig({
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
});
