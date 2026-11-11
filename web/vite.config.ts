import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Only the ports are needed here; the server owns full config validation.
function readPorts(): { port: number; webDevPort: number } {
  const env = process.env.CCC_CONFIG;
  const file = env ?? fileURLToPath(new URL('../config.json', import.meta.url));
  const fallback = fileURLToPath(new URL('../config.example.json', import.meta.url));
  const cfg = JSON.parse(readFileSync(existsSync(file) ? file : fallback, 'utf8'));
  return { port: cfg.port, webDevPort: cfg.webDevPort };
}

const { port, webDevPort } = readPorts();
const target = `http://127.0.0.1:${port}`;

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: webDevPort,
    strictPort: true,
    // Lets `tailscale serve <webDevPort>` reach the dev server from the phone.
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': { target },
      '/ws': { target, ws: true },
    },
  },
  build: {
    target: 'es2022',
  },
});
