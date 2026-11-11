// Called by Claude Code hooks (registered async). Forwards the event JSON to the cc-cockpit server.
// Contract: never print to stdout (some events inject stdout into Claude's context), always exit 0,
// and do nothing at all outside a cc-cockpit PTY.
import type { HookEnvelope } from '@ccc/shared';

const t = Date.now();
const { CCC_SESSION_ID: sessionId, CCC_HOOK_URL: url, CCC_HOOK_SECRET: secret } = process.env;
if (!sessionId || !url || !secret) process.exit(0);

const MAX_STDIN = 8 * 1024 * 1024;
// Big tool output (file reads, command logs) is useless for state and stats; keep posts small.
const MAX_POST = 256 * 1024;
const POST_TIMEOUT_MS = 2000;
// Hard stop, whatever happens (stdin never closing, a hung socket...).
setTimeout(() => process.exit(0), 5000);

async function main(): Promise<void> {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    raw += chunk as string;
    if (raw.length > MAX_STDIN) return;
  }
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    event = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  let body = JSON.stringify({ sessionId: sessionId!, t, event } satisfies HookEnvelope);
  if (body.length > MAX_POST && 'tool_response' in event) {
    event.tool_response = '[dropped: too large]';
    body = JSON.stringify({ sessionId: sessionId!, t, event } satisfies HookEnvelope);
  }
  if (body.length > MAX_POST) return;
  await fetch(url!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body,
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
}

main()
  .catch(() => undefined) // server down: Claude must not notice
  .finally(() => process.exit(0));
