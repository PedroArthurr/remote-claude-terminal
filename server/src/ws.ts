import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { WS_PATH, type ClientMessage, type ServerMessage, type TermSize } from '@ccc/shared';
import type { Config } from './config';
import type { Session } from './session';

const HEARTBEAT_MS = 30_000;
// A client this far behind is dropped; it resyncs from a fresh snapshot when it reconnects.
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 1000;

interface Client {
  ws: WebSocket;
  /** Last size this client asked for. */
  size: TermSize | null;
  alive: boolean;
}

export function attachWebSocket(server: Server, session: Session, config: Config): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const clients = new Set<Client>();
  // Marco 2 adds the Tailscale host names here.
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', config.host.toLowerCase()]);

  session.subscribe((e) => {
    for (const c of clients) send(c, e);
  });

  server.on('upgrade', (req, socket, head) => {
    if (pathname(req) !== WS_PATH || !isTrustedOrigin(req, allowedHosts)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, size: null, alive: true };
      // Snapshot and subscription in the same tick: nothing can slip in between.
      send(client, session.snapshot());
      clients.add(client);
      ws.on('pong', () => (client.alive = true));
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        const msg = parseClientMessage(raw.toString());
        if (msg) handle(client, msg);
      });
      ws.on('close', () => clients.delete(client));
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

  function handle(c: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case 'input':
        // PTY size follows the last active client.
        if (c.size) session.resize(c.size.cols, c.size.rows);
        session.write(msg.data);
        break;
      case 'resize':
        c.size = { cols: msg.cols, rows: msg.rows };
        session.resize(msg.cols, msg.rows);
        break;
      case 'restart':
        session.restart();
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

// Origin must match Host (cross-site WebSocket hijacking) and Host must be known (DNS rebinding).
function isTrustedOrigin(req: IncomingMessage, allowedHosts: Set<string>): boolean {
  const { host, origin } = req.headers;
  if (!host || !origin) return false;
  try {
    const h = new URL(`http://${host}`);
    return new URL(origin).host === h.host && allowedHosts.has(h.hostname);
  } catch {
    return false;
  }
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
