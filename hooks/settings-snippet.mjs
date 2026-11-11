// Prints the `hooks` block for ~/.claude/settings.json (never writes it).
// Usage: npm run hooks:settings            -> snippet only
//        npm run hooks:settings -- --merge <settings.json>  -> full merged settings on stdout
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./dist/cc-hook.mjs', import.meta.url)).replace(/\\/g, '/');
if (!existsSync(script)) console.error(`warning: ${script} not built yet (npm run build -w hooks)`);

// Every event the server understands. Async: the hook never blocks or slows Claude.
const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
];

const entry = () => ({ hooks: [{ type: 'command', command: 'node', args: [script], async: true }] });
const snippet = Object.fromEntries(EVENTS.map((e) => [e, [entry()]]));

const i = process.argv.indexOf('--merge');
if (i < 0) {
  console.log(JSON.stringify({ hooks: snippet }, null, 2));
} else {
  const settings = JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  settings.hooks ??= {};
  for (const [event, entries] of Object.entries(snippet)) {
    const list = (settings.hooks[event] ??= []);
    // Idempotent: skip if a cc-hook entry is already there.
    if (!JSON.stringify(list).includes('cc-hook.mjs')) list.push(...entries);
  }
  console.log(JSON.stringify(settings, null, 2));
}
