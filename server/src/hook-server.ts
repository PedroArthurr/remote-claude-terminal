import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { HOOK_PATH, type HookEnvelope } from '@ccc/shared';

const MAX_BODY = 512 * 1024;

/**
 * Hook endpoint on its own loopback-only port: `tailscale serve` forwards the main port only,
 * so nothing outside this PC can reach it. Requires the hook secret; browsers are refused outright.
 */
export function startHookServer(port: number, secret: string, onHook: (e: HookEnvelope) => void): Server {
  const expected = Buffer.from(`Bearer ${secret}`);
  const server = createServer((req, res) => {
    const reply = (status: number) => {
      res.writeHead(status).end();
    };
    // A web page can POST to loopback; it always sends Origin, the hook never does.
    if (req.method !== 'POST' || pathOf(req) !== HOOK_PATH || req.headers.origin !== undefined) return reply(404);
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(401);

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reply(413);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      const env = parseEnvelope(Buffer.concat(chunks).toString('utf8'));
      if (!env) return reply(400);
      reply(204);
      try {
        onHook(env);
      } catch (e) {
        console.error('[hooks]', e);
      }
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`[hooks] listening on http://127.0.0.1:${port}${HOOK_PATH}`));
  server.on('error', (e) => console.error('[hooks] server error:', e.message));
  return server;
}

function pathOf(req: IncomingMessage): string {
  return (req.url ?? '').split('?')[0] ?? '';
}

function parseEnvelope(raw: string): HookEnvelope | null {
  try {
    const o = JSON.parse(raw) as Partial<HookEnvelope>;
    if (typeof o.sessionId !== 'string' || typeof o.t !== 'number' || !Number.isFinite(o.t)) return null;
    if (typeof o.event !== 'object' || o.event === null || Array.isArray(o.event)) return null;
    return { sessionId: o.sessionId, t: o.t, event: o.event };
  } catch {
    return null;
  }
}
