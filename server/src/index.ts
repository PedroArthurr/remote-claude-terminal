import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Response } from 'express';
import {
  API,
  PROTOCOL_VERSION,
  type ApiError,
  type CreateSessionRequest,
  type Favorite,
  type HealthResponse,
  type RenameSessionRequest,
  type SessionInfo,
  type UiConfig,
} from '@ccc/shared';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { createHostCheck, isLoopback, requestHostname } from './net';
import { WEB_DIST } from './paths';
import { SessionError, SessionManager } from './sessions';
import { attachWebSocket } from './ws';

const config = loadConfig();
const auth = createAuth(config.token);
const isAllowedHost = createHostCheck(config.host, config.allowedHosts);
const manager = new SessionManager(config);

const app = express();
app.disable('x-powered-by');

// DNS rebinding: refuse any Host we don't own.
app.use((req, res, next) => {
  const host = requestHostname(req);
  if (host && isAllowedHost(host)) return next();
  res.status(421).send('Misdirected request');
});
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use('/api', express.json({ limit: '16kb' }));
app.use(auth.guard);
app.use(auth.routes());

app.get(API.health, (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    name: 'cc-cockpit',
    protocol: PROTOCOL_VERSION,
    uptimeSec: Math.round(process.uptime()),
  };
  res.json(body);
});

app.get(API.favorites, (_req, res) => {
  res.json(config.favorites satisfies Favorite[]);
});

app.get(API.ui, (_req, res) => {
  res.json({ snippets: config.snippets } satisfies UiConfig);
});

app.get(API.sessions, (_req, res) => {
  res.json(manager.list() satisfies SessionInfo[]);
});

app.post(API.sessions, (req, res) => {
  const body = (req.body ?? {}) as Partial<CreateSessionRequest>;
  if (!Number.isInteger(body.favorite)) return fail(res, 400, 'favorite: expected index');
  try {
    res.status(201).json(manager.create(body.favorite!, body.name).info() satisfies SessionInfo);
  } catch (e) {
    handleError(res, e);
  }
});

app.patch(`${API.sessions}/:id`, (req, res) => {
  const body = (req.body ?? {}) as Partial<RenameSessionRequest>;
  if (typeof body.name !== 'string') return fail(res, 400, 'name: expected string');
  try {
    res.json(manager.rename(req.params.id, body.name).info() satisfies SessionInfo);
  } catch (e) {
    handleError(res, e);
  }
});

app.delete(`${API.sessions}/:id`, (req, res) => {
  try {
    manager.kill(req.params.id);
    res.status(204).end();
  } catch (e) {
    handleError(res, e);
  }
});

app.use('/api', (_req, res) => fail(res, 404, 'not found'));

// Production: serve the built web app. In dev, Vite serves it and proxies /api and /ws here.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/|ws$).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error } satisfies ApiError);
}

function handleError(res: Response, e: unknown): void {
  if (e instanceof SessionError) return fail(res, e.status, e.message);
  console.error('[api]', e);
  fail(res, 500, e instanceof Error ? e.message : 'internal error');
}

const server = app.listen(config.port, config.host, (err) => {
  if (err) throw err;
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  if (isLoopback(config.host)) console.log(`[server] phone access: tailscale serve --bg ${config.port}`);
  console.log(`[server] favorites: ${config.favorites.map((f) => f.name).join(', ')}`);
});
attachWebSocket(server, { manager, auth, isAllowedHost });

function shutdown(): void {
  manager.disposeAll();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
