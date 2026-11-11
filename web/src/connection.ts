import { WS_PATH, type ClientMessage, type ServerMessage } from '@ccc/shared';

export type ConnState = 'connecting' | 'online' | 'offline';

const PING_MS = 10_000;
// No message for this long = dead link (mobile networks rarely close sockets cleanly).
const STALE_MS = 25_000;
const BACKOFF_MIN_MS = 300;
const BACKOFF_MAX_MS = 5_000;

export interface ConnectionHandlers {
  onMessage(msg: ServerMessage): void;
  onState(state: ConnState): void;
}

/** WebSocket with auto-reconnect and a liveness check. Every (re)connect starts with a snapshot. */
export class Connection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private lastSeen = 0;
  private retryTimer = 0;
  private readonly url: string;

  constructor(private readonly h: ConnectionHandlers) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}${WS_PATH}`;
    setInterval(() => this.checkAlive(), PING_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkAlive();
    });
    addEventListener('online', () => {
      if (this.ws?.readyState !== WebSocket.OPEN) this.reconnectNow();
    });
  }

  connect(): void {
    clearTimeout(this.retryTimer);
    this.h.onState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastSeen = Date.now();
      this.h.onState('online');
    };
    ws.onmessage = (ev) => {
      this.lastSeen = Date.now();
      this.h.onMessage(JSON.parse(ev.data as string) as ServerMessage);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.h.onState('offline');
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay * (0.8 + Math.random() * 0.4));
    };
  }

  /** Dropped (not queued) while offline: replaying stale keystrokes into a TUI is dangerous. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private checkAlive(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastSeen > STALE_MS) {
      this.reconnectNow();
      return;
    }
    this.send({ type: 'ping', t: Date.now() });
  }

  private reconnectNow(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.attempt = 0;
    this.connect();
  }
}
