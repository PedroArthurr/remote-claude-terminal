import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * Append-only event log. Everything in the stats screen is derived from it.
 *
 * kind: a Claude Code hook name (`PreToolUse`, `Stop`...) or a cockpit event (`ccc.*`):
 *   ccc.session_create {name}   ccc.session_rename {name}   ccc.session_kill
 *   ccc.process {running, exitCode}   ccc.state {from, to, ms}   ccc.permission_answered {ms}
 *   ccc.interrupted   ccc.session_restore {name, claudeSession}
 */
export interface EventRow {
  ts: number;
  sessionId: string;
  cwd: string;
  kind: string;
  /** Session state after the event. */
  state?: string | null;
  tool?: string | null;
  /** Claude Code's own session_id (changes on /clear, resume...). */
  claudeSession?: string | null;
  data?: unknown;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT,
  tool TEXT,
  claude_session TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id, ts);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind, ts);
`;

export class EventStore {
  private readonly db: DatabaseSync;
  private readonly insert: StatementSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'events.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.insert = this.db.prepare(
      'INSERT INTO events (ts, session_id, cwd, kind, state, tool, claude_session, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
  }

  append(e: EventRow): void {
    try {
      this.insert.run(
        e.ts,
        e.sessionId,
        e.cwd,
        e.kind,
        e.state ?? null,
        e.tool ?? null,
        e.claudeSession ?? null,
        e.data === undefined ? null : JSON.stringify(e.data),
      );
    } catch (err) {
      // Losing a stats row must never take a session down.
      console.error('[store] append failed:', (err as Error).message);
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }
}
