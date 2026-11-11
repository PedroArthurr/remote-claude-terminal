export const PROTOCOL_VERSION = 2;

export const WS_PATH = '/ws';

export const API = {
  health: '/api/health',
  auth: '/api/auth',
  favorites: '/api/favorites',
  sessions: '/api/sessions',
} as const;

export const SESSION_STATES = ['idle', 'working', 'waiting_permission', 'done', 'error'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const MAX_SESSION_NAME = 40;

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
  /** Placeholder until hooks land (Marco 4). */
  state: SessionState;
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
  | { type: 'pong'; t: number };
