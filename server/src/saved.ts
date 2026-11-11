import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** What survives a server restart: enough to recreate the session and resume its conversation. */
export interface SavedSession {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  /** Last Claude Code session_id seen in a hook (resume target). */
  claudeSession: string | null;
}

/** `<dataDir>/sessions.json`, rewritten atomically on every change. */
export class SavedSessions {
  private readonly file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'sessions.json');
  }

  load(): SavedSession[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(raw) ? raw.filter(isSaved) : [];
    } catch (e) {
      console.error('[saved] unreadable sessions.json:', (e as Error).message);
      return [];
    }
  }

  save(list: SavedSession[]): void {
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(list, null, 2));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error('[saved] write failed:', (e as Error).message);
    }
  }
}

function isSaved(x: unknown): x is SavedSession {
  const s = x as Partial<SavedSession> | null;
  return (
    typeof s?.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.cwd === 'string' &&
    typeof s.createdAt === 'number' &&
    (s.claudeSession === null || typeof s.claudeSession === 'string')
  );
}
