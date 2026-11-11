import { WS_PATH, type ClientMessage, type ServerMessage } from '@ccc/shared';

export type ConnState = 'connecting' | 'online' | 'offline';

// Mobile links (Wi-Fi power save, Tailscale waking up, app switch) rarely close sockets cleanly:
// a dead socket looks open. Ping often and give up on it fast, then reconnect.
const PING_MS = 5_000;
/** No reply this long after a ping = dead link. */
const PONG_TIMEOUT_MS = 5_000;
/** Tighter check when coming back to the app (the socket probably died meanwhile). */
const RESUME_TIMEOUT_MS = 2_000;
/** A connect attempt that hangs this long is retried. */
const CONNECT_TIMEOUT_MS = 6_000;
const BACKOFF_MIN_MS = 250;
const BACKOFF_MAX_MS = 4_000;
const RTT_SMOOTH = 0.3;

export interface ConnectionHandlers {
  onMessage(msg: ServerMessage): void;
  onState(state: ConnState): void;
  /** Smoothed round trip (ms), after each pong. */
  onRtt?(ms: number): void;
}

/** WebSocket with auto-reconnect and a liveness check. Every (re)connect starts with a snapshot. */
export class Connection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer = 0;
  private deadline = 0;
  private stopped = true;
  private rtt = 0;
  private readonly url: string;

  constructor(private readonly h: ConnectionHandlers) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}${WS_PATH}`;
    setInterval(() => {
      if (!document.hidden) this.probe(PONG_TIMEOUT_MS);
    }, PING_MS);
    const resume = () => {
      if (this.stopped || document.hidden) return;
      if (this.ws?.readyState === WebSocket.OPEN) this.probe(RESUME_TIMEOUT_MS);
      else if (!this.ws) this.reconnectNow(); // skip the backoff wait
    };
    document.addEventListener('visibilitychange', resume);
    addEventListener('pageshow', resume);
    addEventListener('focus', resume);
    addEventListener('online', resume);
  }

  get online(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    clearTimeout(this.retryTimer);
    this.stopped = false;
    this.h.onState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.arm(CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.disarm();
      this.h.onState('online');
      this.probe(PONG_TIMEOUT_MS);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.disarm(); // any traffic proves the link
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      if (msg.type === 'pong') this.noteRtt(Date.now() - msg.t);
      this.h.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.drop();
    };
  }

  /** Closes and stays closed until `connect()` (e.g. logged out). */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.disarm();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.h.onState('offline');
  }

  /** Dropped (not queued) while offline: replaying stale keystrokes into a TUI is dangerous. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Ping; no traffic before `timeout` = dead. Keeps an earlier, tighter deadline. */
  private probe(timeout: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.arm(timeout);
    this.send({ type: 'ping', t: Date.now() });
  }

  private arm(timeout: number): void {
    if (this.deadline) return;
    this.deadline = window.setTimeout(() => {
      this.deadline = 0;
      if (this.ws) this.drop();
    }, timeout);
  }

  private disarm(): void {
    clearTimeout(this.deadline);
    this.deadline = 0;
  }

  private noteRtt(ms: number): void {
    if (ms < 0 || ms > 60_000) return;
    this.rtt = this.rtt ? this.rtt + (ms - this.rtt) * RTT_SMOOTH : ms;
    this.h.onRtt?.(Math.round(this.rtt));
  }

  /** Forget the socket (don't wait for a close that may never come) and schedule a retry. */
  private drop(): void {
    const ws = this.ws;
    this.ws = null;
    this.disarm();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already dead
      }
    }
    this.rtt = 0;
    this.h.onState('offline');
    if (this.stopped) return;
    const delay = this.attempt === 0 ? 0 : Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.attempt - 1));
    this.attempt++;
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), delay * (0.8 + Math.random() * 0.4));
  }

  private reconnectNow(): void {
    this.attempt = 0;
    clearTimeout(this.retryTimer);
    if (this.ws) this.drop();
    else this.connect();
  }
}
