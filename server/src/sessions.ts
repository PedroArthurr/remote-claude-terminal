import { existsSync } from 'node:fs';
import {
  HOOK_PATH,
  MAX_SESSION_NAME,
  type Activity,
  type HookEnvelope,
  type SessionInfo,
  type SessionState,
} from '@ccc/shared';
import { compactForLog, interpretHook } from './activity';
import type { Config } from './config';
import { Session } from './session';
import type { EventStore } from './store';

// Output only changes previews; coalesce those. Lifecycle changes go out right away.
const PREVIEW_THROTTLE_MS = 700;
// Keys that answer a permission dialog: option number, y/n, Enter, Esc (reject).
const PERMISSION_ANSWER = /^(\r|[1-9]|[yYnN]|\x1b)$/;
// No hook fires on a user interrupt (Esc / Ctrl+C). Claude's spinner line ("✶ Pondering… (12s · …)")
// stays on screen while it works; if it is gone shortly after the key, the turn was cancelled.
const INTERRUPT_CHECKS_MS = [1200, 3000];
const SPINNER = /^\s*\S \p{Lu}\p{Ll}+…/mu;
const INTERRUPT_SCAN_ROWS = 40;

export class SessionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Set<(list: SessionInfo[]) => void>();
  private readonly removedListeners = new Set<(id: string) => void>();
  private readonly activityListeners = new Set<(a: Activity) => void>();
  private timer: NodeJS.Timeout | null = null;
  private lastSent = '';

  constructor(
    private readonly config: Config,
    private readonly store: EventStore,
  ) {}

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info());
  }

  create(favorite: number, name?: string): Session {
    const fav = this.config.favorites[favorite];
    if (!fav) throw new SessionError(400, 'unknown favorite');
    if (!existsSync(fav.path)) throw new SessionError(400, `folder not found: ${fav.path}`);
    const s = new Session({
      name: this.uniqueName(cleanName(name) || fav.name),
      cwd: fav.path,
      shell: this.config.shell,
      shellArgs: this.config.shellArgs,
      startupCommand: this.config.startupCommand,
      scrollback: this.config.scrollback,
      hookUrl: `http://127.0.0.1:${this.config.hookPort}${HOOK_PATH}`,
      hookSecret: this.config.hookSecret,
    });
    this.sessions.set(s.id, s);
    this.log(s, 'ccc.session_create', { name: s.name });
    s.subscribe((e) => {
      if (e.type !== 'process') return this.schedule();
      this.log(s, 'ccc.process', { running: e.running, exitCode: e.exitCode });
      if (!e.running) {
        s.activity = null;
        this.setState(s, 'idle', Date.now());
      }
      this.changed();
    });
    console.log(`[sessions] + "${s.name}" ${s.id} in ${s.cwd}`);
    this.changed();
    return s;
  }

  rename(id: string, name: string): Session {
    const s = this.require(id);
    const clean = cleanName(name);
    if (!clean) throw new SessionError(400, 'name is empty');
    s.name = clean;
    this.log(s, 'ccc.session_rename', { name: clean });
    this.changed();
    return s;
  }

  kill(id: string): void {
    const s = this.require(id);
    this.sessions.delete(id);
    for (const fn of this.removedListeners) fn(id);
    this.log(s, 'ccc.session_kill');
    s.dispose();
    console.log(`[sessions] - "${s.name}" ${s.id}`);
    this.changed();
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }

  // ── Claude state ────────────────────────────────────

  /** A Claude Code hook fired inside one of our PTYs. */
  handleHook(env: HookEnvelope): void {
    const s = this.sessions.get(env.sessionId);
    if (!s) return;
    const e = env.event;
    const now = Date.now();
    env.t = Math.min(env.t, now); // a clock from the future would freeze the state
    s.lastHookAt = now;
    const it = interpretHook(e);
    let dirty = false;

    if (e.hook_event_name === 'SessionStart' && typeof e.model === 'string') {
      s.model = e.model;
      dirty = true;
    }
    if (it) {
      const late = env.t < s.stateT;
      if (it.next && !late && !(it.soft && s.state === 'waiting_permission')) {
        dirty = this.setState(s, it.next, env.t) || dirty;
      }
      // Claude waited 60 s for input while we still think it works: an interrupt we missed.
      if (e.notification_type === 'idle_prompt' && s.state === 'working') {
        dirty = this.setState(s, 'idle', env.t) || dirty;
      }
      if (it.detail && env.t >= s.activityT && it.kind !== 'notification') {
        s.activity = it.detail;
        s.activityT = env.t;
        dirty = true;
      }
    }

    this.store.append({
      ts: now,
      sessionId: s.id,
      cwd: s.cwd,
      kind: typeof e.hook_event_name === 'string' ? e.hook_event_name : 'unknown',
      state: s.state,
      tool: typeof e.tool_name === 'string' ? e.tool_name : null,
      claudeSession: typeof e.session_id === 'string' ? e.session_id : null,
      data: compactForLog(e),
    });
    if (it) {
      this.emitActivity({
        sessionId: s.id,
        kind: it.kind,
        t: now,
        state: s.state,
        tool: it.tool,
        category: it.category,
        detail: it.detail,
      });
    }
    if (dirty) this.changed();
  }

  /** Keys typed into a session: answers to permission dialogs, interrupts. */
  noteInput(s: Session, data: string): void {
    const now = Date.now();
    if (s.state === 'waiting_permission' && PERMISSION_ANSWER.test(data)) {
      const ms = now - s.stateSince;
      this.setState(s, 'working', now);
      this.log(s, 'ccc.permission_answered', { ms, key: data === '\r' ? 'enter' : data === '\x1b' ? 'esc' : data });
      this.emitActivity({ sessionId: s.id, kind: 'permission_answered', t: now, state: s.state });
      this.changed();
      if (data === '\x1b') this.watchInterrupt(s, now);
      return;
    }
    if (s.state === 'working' && (data === '\x1b' || data === '\x03')) this.watchInterrupt(s, now);
  }

  private watchInterrupt(s: Session, at: number): void {
    for (const delay of INTERRUPT_CHECKS_MS) {
      setTimeout(() => {
        if (this.sessions.get(s.id) !== s || s.state !== 'working' || s.lastHookAt > at) return;
        if (SPINNER.test(s.screenTail(INTERRUPT_SCAN_ROWS))) return;
        const now = Date.now();
        s.activity = 'interrupted';
        this.setState(s, 'idle', now);
        this.log(s, 'ccc.interrupted');
        this.emitActivity({ sessionId: s.id, kind: 'interrupted', t: now, state: s.state, detail: 'interrupted' });
        this.changed();
      }, delay);
    }
  }

  /** Returns true if the state changed. */
  private setState(s: Session, to: SessionState, t: number): boolean {
    s.stateT = Math.max(s.stateT, t);
    if (s.state === to) return false;
    const now = Date.now();
    const from = s.state;
    const ms = now - s.stateSince;
    s.state = to;
    s.stateSince = now;
    this.log(s, 'ccc.state', { from, to, ms });
    return true;
  }

  private log(s: Session, kind: string, data?: unknown): void {
    this.store.append({ ts: Date.now(), sessionId: s.id, cwd: s.cwd, kind, state: s.state, data });
  }

  private emitActivity(a: Activity): void {
    for (const fn of this.activityListeners) fn(a);
  }

  // ── listeners ───────────────────────────────────────

  /** Called with the full list whenever it changes. */
  onChange(fn: (list: SessionInfo[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onRemoved(fn: (id: string) => void): () => void {
    this.removedListeners.add(fn);
    return () => this.removedListeners.delete(fn);
  }

  onActivity(fn: (a: Activity) => void): () => void {
    this.activityListeners.add(fn);
    return () => this.activityListeners.delete(fn);
  }

  /** Publish now (lifecycle change, viewer count...). */
  changed(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.publish();
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.publish();
    }, PREVIEW_THROTTLE_MS);
  }

  private publish(): void {
    const list = this.list();
    const json = JSON.stringify(list);
    if (json === this.lastSent) return;
    this.lastSent = json;
    for (const fn of this.listeners) fn(list);
  }

  private require(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new SessionError(404, 'session not found');
    return s;
  }

  private uniqueName(base: string): string {
    const taken = new Set([...this.sessions.values()].map((s) => s.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) {
      const name = `${base.slice(0, MAX_SESSION_NAME - 4)} ${i}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_SESSION_NAME);
}
