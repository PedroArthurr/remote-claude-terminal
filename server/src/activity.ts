import path from 'node:path';
import type { ActivityKind, SessionState, ToolCategory } from '@ccc/shared';

/** How a hook event moves the session state. */
export interface Interpretation {
  kind: ActivityKind;
  /** New state, or null to keep the current one. */
  next: SessionState | null;
  /**
   * Soft transitions never leave `waiting_permission`: PreToolUse/PostToolUse of a parallel tool can
   * land while a permission dialog is open. Leaving it takes a hard event or the user's answer.
   */
  soft: boolean;
  tool?: string;
  category?: ToolCategory;
  detail?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function toolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Read':
    case 'NotebookRead':
      return 'read';
    case 'Grep':
    case 'Glob':
    case 'LS':
    case 'ToolSearch':
      return 'search';
    case 'Bash':
    case 'PowerShell':
    case 'BashOutput':
    case 'KillShell':
    case 'Monitor':
      return 'shell';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    case 'Task':
    case 'Agent':
    case 'SendMessage':
    case 'Skill':
    case 'Workflow':
      return 'agent';
    default:
      return 'other';
  }
}

/** Short label for what a tool call touches: file name, command, pattern... */
export function toolTarget(input: Record<string, unknown>): string | undefined {
  const file = str(input.file_path) ?? str(input.notebook_path);
  if (file) return path.basename(file.replace(/\\/g, '/'));
  const cmd = str(input.command);
  if (cmd) return oneLine(cmd, 60);
  const url = str(input.url);
  if (url) {
    try {
      const u = new URL(url);
      return oneLine(u.host + u.pathname, 60);
    } catch {
      return oneLine(url, 60);
    }
  }
  const any = str(input.pattern) ?? str(input.query) ?? str(input.description) ?? str(input.skill) ?? str(input.path);
  return any ? oneLine(any, 60) : undefined;
}

export function oneLine(s: string, max: number): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function toolInfo(e: Record<string, unknown>): Pick<Interpretation, 'tool' | 'category' | 'detail'> {
  const tool = str(e.tool_name) ?? 'tool';
  const target = toolTarget(obj(e.tool_input));
  return { tool, category: toolCategory(tool), detail: target ? `${tool} · ${target}` : tool };
}

export function interpretHook(e: Record<string, unknown>): Interpretation | null {
  const name = str(e.hook_event_name);
  switch (name) {
    case 'SessionStart':
      // After an auto-compact Claude keeps working; only a fresh/cleared/resumed session is idle.
      return {
        kind: 'session_start',
        next: e.source === 'compact' ? null : 'idle',
        soft: false,
        detail: str(e.model) ? `${str(e.source) ?? 'start'} · ${str(e.model)}` : str(e.source),
      };
    case 'SessionEnd':
      return { kind: 'session_end', next: 'idle', soft: false, detail: str(e.reason) };
    case 'UserPromptSubmit':
      return { kind: 'prompt', next: 'working', soft: false, detail: oneLine(str(e.prompt) ?? '', 100) };
    case 'PreToolUse':
      return { kind: 'tool', next: 'working', soft: true, ...toolInfo(e) };
    case 'PostToolUse':
      return { kind: 'tool_done', next: 'working', soft: true, ...toolInfo(e) };
    case 'PostToolUseFailure':
      return { kind: 'tool_failed', next: 'working', soft: true, ...toolInfo(e) };
    case 'PermissionRequest':
      return { kind: 'permission', next: 'waiting_permission', soft: false, ...toolInfo(e) };
    case 'PermissionDenied':
      return { kind: 'permission_denied', next: 'working', soft: true, ...toolInfo(e) };
    case 'Notification': {
      const type = str(e.notification_type);
      const detail = oneLine(str(e.message) ?? type ?? '', 100);
      if (type === 'permission_prompt' || type === 'elicitation_dialog' || type === 'agent_needs_input') {
        return { kind: 'permission', next: 'waiting_permission', soft: false, detail };
      }
      return { kind: 'notification', next: null, soft: false, detail };
    }
    case 'Stop':
      return { kind: 'done', next: 'done', soft: false, detail: lastMessage(e) };
    case 'StopFailure':
      return { kind: 'error', next: 'error', soft: false, detail: str(e.error) ?? 'error' };
    case 'SubagentStart':
      return { kind: 'subagent_start', next: 'working', soft: true, detail: str(e.agent_type) };
    case 'SubagentStop':
      return { kind: 'subagent_stop', next: null, soft: true, detail: str(e.agent_type) };
    case 'PreCompact':
      return { kind: 'compact', next: 'working', soft: true, detail: `compact · ${str(e.trigger) ?? ''}`.trim() };
    case 'PostCompact':
      // A manual /compact has no Stop after it.
      return { kind: 'compact', next: e.trigger === 'manual' ? 'idle' : null, soft: false, detail: 'compacted' };
    default:
      return null;
  }
}

function lastMessage(e: Record<string, unknown>): string | undefined {
  const msg = str(e.last_assistant_message);
  if (!msg) return undefined;
  const first = msg.split('\n').find((l) => l.trim()) ?? '';
  return oneLine(first.replace(/^[#>*\s-]+/, ''), 100);
}

// ── storage ─────────────────────────────────────────────

const MAX_STR = 300;
const MAX_RESPONSE_STR = 120;
const MAX_ITEMS = 20;
const MAX_DEPTH = 5;
// Already in their own columns, or repeated on every event.
const DROPPED = new Set(['session_id', 'hook_event_name', 'cwd', 'tool_name']);
// The transcript path is only needed where the stats read tokens from it.
const KEEPS_TRANSCRIPT = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);

/** Event JSON trimmed for the log, plus numbers the stats need that trimming would lose. */
export function compactForLog(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const hook = str(e.hook_event_name) ?? '';
  for (const [k, v] of Object.entries(e)) {
    if (DROPPED.has(k)) continue;
    if (k === 'transcript_path' && !KEEPS_TRANSCRIPT.has(hook)) continue;
    out[k] = trim(v, k === 'tool_response' ? MAX_RESPONSE_STR : MAX_STR, 0);
  }
  const meta = editMeta(e);
  if (meta) out.meta = meta;
  return out;
}

function trim(v: unknown, maxStr: number, depth: number): unknown {
  if (typeof v === 'string') return v.length > maxStr ? `${v.slice(0, maxStr)}…(${v.length})` : v;
  if (typeof v !== 'object' || v === null) return v;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ITEMS).map((x) => trim(x, maxStr, depth + 1));
    if (v.length > MAX_ITEMS) items.push(`…(${v.length})`);
    return items;
  }
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = trim(x, maxStr, depth + 1);
  return o;
}

const lines = (s: unknown): number => (typeof s === 'string' && s ? s.split('\n').length : 0);

/** File and line counts of a finished edit (only PostToolUse: the edit really happened). */
function editMeta(e: Record<string, unknown>): Record<string, unknown> | null {
  if (e.hook_event_name !== 'PostToolUse') return null;
  const input = obj(e.tool_input);
  const file = str(input.file_path) ?? str(input.notebook_path);
  switch (e.tool_name) {
    case 'Edit':
      return { file, added: lines(input.new_string), removed: lines(input.old_string) };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits.map(obj) : [];
      return {
        file,
        added: edits.reduce((n, x) => n + lines(x.new_string), 0),
        removed: edits.reduce((n, x) => n + lines(x.old_string), 0),
      };
    }
    case 'Write':
      return { file, added: lines(input.content), removed: null };
    case 'NotebookEdit':
      return { file, added: lines(input.new_source), removed: null };
    default:
      return null;
  }
}
