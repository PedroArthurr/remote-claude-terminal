export const PROTOCOL_VERSION = 1;

export const WS_PATH = '/ws';

export const SESSION_STATES = ['idle', 'working', 'waiting_permission', 'done', 'error'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

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

/** Browser → server. */
export type ClientMessage =
  | { type: 'input'; data: string }
  /** The client's preferred size. The server decides the actual PTY size. */
  | { type: 'resize'; cols: number; rows: number }
  /** Respawn the shell after it exited. */
  | { type: 'restart' }
  | { type: 'ping'; t: number };

/** Server → browser. Order matters: apply each message after the previous one was processed. */
export type ServerMessage =
  /** Full terminal state. First message on every connection. */
  | { type: 'snapshot'; cols: number; rows: number; data: string; running: boolean }
  | { type: 'output'; data: string }
  /** The PTY was resized; mirror it. */
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'process'; running: boolean; exitCode: number | null }
  | { type: 'pong'; t: number };
