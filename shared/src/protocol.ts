export const PROTOCOL_VERSION = 3;

export const WS_PATH = '/ws';

export const API = {
  health: '/api/health',
  auth: '/api/auth',
  favorites: '/api/favorites',
  sessions: '/api/sessions',
  ui: '/api/ui',
} as const;

export const SESSION_STATES = ['idle', 'working', 'waiting_permission', 'done', 'error'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const MAX_SESSION_NAME = 40;

// ── Hooks (Claude Code → hook script → local endpoint) ──

/** Path of the hook endpoint. It listens on its own loopback-only port (config `hookPort`). */
export const HOOK_PATH = '/hook';

/** Body the hook script POSTs. `event` is the raw JSON Claude Code wrote to the hook's stdin. */
export interface HookEnvelope {
  /** CCC_SESSION_ID of the PTY the hook ran in. */
  sessionId: string;
  /** Hook process start (ms epoch). Hooks run async, so this orders events that arrive out of order. */
  t: number;
  event: Record<string, unknown>;
}

/** What happened, normalized from hook events (plus a few the server infers). Drives effects. */
export type ActivityKind =
  | 'session_start'
  | 'session_end'
  | 'prompt'
  | 'tool'
  | 'tool_done'
  | 'tool_failed'
  | 'permission'
  | 'permission_answered'
  | 'permission_denied'
  | 'notification'
  | 'subagent_start'
  | 'subagent_stop'
  | 'compact'
  | 'done'
  | 'error'
  | 'interrupted';

export type ToolCategory = 'edit' | 'read' | 'search' | 'shell' | 'web' | 'agent' | 'mcp' | 'other';

export interface Activity {
  sessionId: string;
  kind: ActivityKind;
  /** ms epoch. */
  t: number;
  /** Session state after this activity. */
  state: SessionState;
  tool?: string;
  category?: ToolCategory;
  /** Short human text (tool target, prompt, last message...). */
  detail?: string;
}

export interface HealthResponse {
  ok: true;
  name: 'cc-cockpit';
  protocol: number;
  uptimeSec: number;
}

/** Terminal size in character cells. */
export interface TermSize {
  cols: number;
  rows: number;
}

// ── REST ────────────────────────────────────────────────

export interface Favorite {
  name: string;
  path: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  /** Derived from Claude Code hooks. */
  state: SessionState;
  /** When `state` was entered (ms epoch). */
  stateSince: number;
  /** One line on what Claude is doing / did (tool + target, last message...). */
  activity: string | null;
  /** Model reported by SessionStart. */
  model: string | null;
  running: boolean;
  exitCode: number | null;
  createdAt: number;
  /** Last meaningful lines of the screen, oldest first. */
  preview: string[];
  /** Browsers currently attached. */
  viewers: number;
}

export interface AuthRequest {
  token: string;
}

export interface AuthStatus {
  authed: boolean;
}

export interface CreateSessionRequest {
  /** Index into the favorites list. */
  favorite: number;
  name?: string;
}

export interface RenameSessionRequest {
  name: string;
}

/** Client-side settings that live in config.json. */
export interface UiConfig {
  /** One-tap messages in Compose mode (sent as paste + Enter). */
  snippets: string[];
}

export interface ApiError {
  error: string;
}

// ── WebSocket ───────────────────────────────────────────

/** Browser → server. Terminal messages apply to the attached session. */
export type ClientMessage =
  | { type: 'attach'; sessionId: string }
  | { type: 'detach' }
  | { type: 'input'; data: string }
  /** The client's preferred size. The server decides the actual PTY size. */
  | { type: 'resize'; cols: number; rows: number }
  /** Respawn the shell after it exited. */
  | { type: 'restart' }
  | { type: 'ping'; t: number };

/** Stream of the attached session. Order matters: apply each after the previous one was processed. */
export type TerminalMessage =
  /** Full terminal state. First message after every attach. */
  | { type: 'snapshot'; sessionId: string; cols: number; rows: number; data: string; running: boolean }
  | { type: 'output'; sessionId: string; data: string }
  /** The PTY was resized; mirror it. */
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'process'; sessionId: string; running: boolean; exitCode: number | null };

/** Server → browser. */
export type ServerMessage =
  | TerminalMessage
  /** Full list; sent on connect and whenever anything changes (throttled). */
  | { type: 'sessions'; sessions: SessionInfo[] }
  /** The attached session was closed. */
  | { type: 'closed'; sessionId: string }
  /** Live activity of any session (not only the attached one). */
  | { type: 'activity'; activity: Activity }
  | { type: 'pong'; t: number };
