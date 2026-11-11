import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PROTOCOL_VERSION, type HealthResponse } from '@ccc/shared';
import { loadConfig } from './config';
import { WEB_DIST } from './paths';
import { Session } from './session';
import { attachWebSocket } from './ws';

const config = loadConfig();
const app = express();
app.disable('x-powered-by');

app.get('/api/health', (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    name: 'cc-cockpit',
    protocol: PROTOCOL_VERSION,
    uptimeSec: Math.round(process.uptime()),
  };
  res.json(body);
});

// Production: serve the built web app. In dev, Vite serves it and proxies /api and /ws here.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/|ws$).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

// Marco 1: one session, alive for the server's lifetime regardless of browsers.
const session = new Session({
  name: path.basename(config.defaultCwd) || 'main',
  cwd: config.defaultCwd,
  shell: config.shell,
  shellArgs: config.shellArgs,
  startupCommand: config.startupCommand,
  scrollback: config.scrollback,
});

const server = app.listen(config.port, config.host, (err) => {
  if (err) throw err;
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  console.log(`[server] session "${session.name}" in ${session.cwd}`);
});
attachWebSocket(server, session, config);

function shutdown(): void {
  session.dispose();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
