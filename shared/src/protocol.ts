export const PROTOCOL_VERSION = 1;

export const SESSION_STATES = ['idle', 'working', 'waiting_permission', 'done', 'error'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export interface HealthResponse {
  ok: true;
  name: 'cc-cockpit';
  protocol: number;
  uptimeSec: number;
}

// WebSocket messages. Filled in from Marco 1 on.
export type ClientMessage = { type: 'ping'; t: number };
export type ServerMessage = { type: 'pong'; t: number };
