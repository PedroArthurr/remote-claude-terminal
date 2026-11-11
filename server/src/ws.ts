import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { WS_PATH, type ClientMessage, type ServerMessage, type TermSize } from '@ccc/shared';
import type { Auth } from './auth';
import { hostnameOf, requestHostname } from './net';
import type { Session } from './session';
import type { SessionManager } from './sessions';

const HEARTBEAT_MS = 30_000;
// A client this far behind is dropped; it resyncs from a fresh snapshot when it reconnects.
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 1000;

interface Client {
  ws: WebSocket;
  session: Session | null;
  unsubscribe: (() => void) | null;
  /** Last size this client asked for, for the attached session. */
  size: TermSize | null;
  alive: boolean;
}

export interface WsDeps {
  manager: SessionManager;
  auth: Auth;
  isAllowedHost: (hostname: string) => boolean;
}

export function attachWebSocket(server: Server, { manager, auth, isAllowedHost }: WsDeps): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const clients = new Set<Client>();

  manager.onChange((sessions) => {
    for (const c of clients) send(c, { type: 'sessions', sessions });
  });
  manager.onActivity((activity) => {
    for (const c of clients) send(c, { type: 'activity', activity });
  });
  manager.onRemoved((id) => {
    for (const c of clients) {
      if (c.session?.id !== id) continue;
      detach(c, false);
      send(c, { type: 'closed', sessionId: id });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (pathname(req) !== WS_PATH || !isTrustedOrigin(req, isAllowedHost)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!auth.isAuthed(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, session: null, unsubscribe: null, size: null, alive: true };
      clients.add(client);
      send(client, { type: 'sessions', sessions: manager.list() });
      ws.on('pong', () => (client.alive = true));
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        const msg = parseClientMessage(raw.toString());
        if (msg) handle(client, msg);
      });
      ws.on('close', () => {
        clients.delete(client);
        detach(client);
      });
      ws.on('error', () => ws.terminate());
    });
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);
  server.on('close', () => clearInterval(heartbeat));

  function attach(c: Client, session: Session): void {
    detach(c, false);
    c.session = session;
    c.size = null;
    // Snapshot and subscription in the same tick: nothing can slip in between.
    send(c, session.snapshot());
    c.unsubscribe = session.subscribe((e) => send(c, e));
    session.viewers++;
    manager.changed();
  }

  function detach(c: Client, publish = true): void {
    if (!c.session) return;
    c.unsubscribe?.();
    c.session.viewers = Math.max(0, c.session.viewers - 1);
    c.session = null;
    c.unsubscribe = null;
    c.size = null;
    if (publish) manager.changed();
  }

  function handle(c: Client, msg: ClientMessage): void {
    const s = c.session;
    switch (msg.type) {
      case 'attach': {
        const target = manager.get(msg.sessionId);
        if (target) attach(c, target);
        else send(c, { type: 'closed', sessionId: msg.sessionId });
        break;
      }
      case 'detach':
        detach(c);
        break;
      case 'input':
        // PTY size follows the last active client.
        if (c.size) s?.resize(c.size.cols, c.size.rows);
        if (!s) break;
        s.write(msg.data);
        manager.noteInput(s, msg.data);
        break;
      case 'resize':
        if (!s) break;
        c.size = { cols: msg.cols, rows: msg.rows };
        s.resize(msg.cols, msg.rows);
        break;
      case 'restart':
        s?.restart();
        break;
      case 'ping':
        send(c, { type: 'pong', t: msg.t });
        break;
    }
  }
}

function send(c: Client, msg: ServerMessage): void {
  if (c.ws.readyState !== WebSocket.OPEN) return;
  if (c.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
    c.ws.terminate();
    return;
  }
  c.ws.send(JSON.stringify(msg));
}

function pathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

// Cross-site WebSocket hijacking: the page must come from one of our own names.
// Host is checked too (DNS rebinding). They may differ behind a proxy, so each is checked on its own.
function isTrustedOrigin(req: IncomingMessage, isAllowedHost: (h: string) => boolean): boolean {
  const host = requestHostname(req);
  const origin = hostnameOf(req.headers.origin, true);
  return !!host && !!origin && isAllowedHost(host) && isAllowedHost(origin);
}

const isDim = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 2 && (v as number) <= MAX_DIM;

function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case 'attach':
      return typeof o.sessionId === 'string' ? { type: 'attach', sessionId: o.sessionId } : null;
    case 'detach':
      return { type: 'detach' };
    case 'input':
      return typeof o.data === 'string' ? { type: 'input', data: o.data } : null;
    case 'resize':
      return isDim(o.cols) && isDim(o.rows) ? { type: 'resize', cols: o.cols, rows: o.rows } : null;
    case 'restart':
      return { type: 'restart' };
    case 'ping':
      return typeof o.t === 'number' ? { type: 'ping', t: o.t } : null;
    default:
      return null;
  }
}
