import { existsSync } from 'node:fs';
import { MAX_SESSION_NAME, type SessionInfo } from '@ccc/shared';
import type { Config } from './config';
import { Session } from './session';

// Output only changes previews; coalesce those. Lifecycle changes go out right away.
const PREVIEW_THROTTLE_MS = 700;

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
  private timer: NodeJS.Timeout | null = null;
  private lastSent = '';

  constructor(private readonly config: Config) {}

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
    });
    this.sessions.set(s.id, s);
    s.subscribe((e) => (e.type === 'process' ? this.changed() : this.schedule()));
    console.log(`[sessions] + "${s.name}" ${s.id} in ${s.cwd}`);
    this.changed();
    return s;
  }

  rename(id: string, name: string): Session {
    const s = this.require(id);
    const clean = cleanName(name);
    if (!clean) throw new SessionError(400, 'name is empty');
    s.name = clean;
    this.changed();
    return s;
  }

  kill(id: string): void {
    const s = this.require(id);
    this.sessions.delete(id);
    for (const fn of this.removedListeners) fn(id);
    s.dispose();
    console.log(`[sessions] - "${s.name}" ${s.id}`);
    this.changed();
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }

  /** Called with the full list whenever it changes. */
  onChange(fn: (list: SessionInfo[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onRemoved(fn: (id: string) => void): () => void {
    this.removedListeners.add(fn);
    return () => this.removedListeners.delete(fn);
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
