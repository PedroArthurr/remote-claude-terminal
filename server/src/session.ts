import { randomUUID } from 'node:crypto';
import { spawn, type IPty } from 'node-pty';
import xtermHeadless from '@xterm/headless';
import xtermSerialize from '@xterm/addon-serialize';
import type { SessionInfo, SessionState, TerminalMessage, TermSize } from '@ccc/shared';

// Both packages are CommonJS bundles; default import is the reliable interop path.
const { Terminal } = xtermHeadless;
const { SerializeAddon } = xtermSerialize;
type HeadlessTerminal = InstanceType<typeof Terminal>;

export type SessionEvent = Extract<TerminalMessage, { type: 'output' | 'resize' | 'process' }>;
export type SnapshotMessage = Extract<TerminalMessage, { type: 'snapshot' }>;

export interface SessionOptions {
  name: string;
  cwd: string;
  shell: string;
  shellArgs: string[];
  /** Typed into the shell after spawn (e.g. `claude`). Empty = plain shell. */
  startupCommand: string;
  scrollback: number;
}

const INITIAL_SIZE: TermSize = { cols: 120, rows: 30 };

const PREVIEW_LINES = 3;
const PREVIEW_SCAN = 80;
const PREVIEW_MAX_CHARS = 160;
// Box drawing and block elements used by TUI frames.
const CHROME = /[─-▟]/g;

// Vars Claude Code and host terminals inject into child processes. Inheriting them makes `claude`
// inside the PTY think it is nested in another session / running inside VS Code or Windows Terminal.
const STRIPPED_ENV =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|PLUGIN_DIRS|EXECPATH|SSE_PORT)|TERM_PROGRAM(_VERSION)?|WT_SESSION|WT_PROFILE_ID|VSCODE_\w+|CCC_\w+)$/i;

// Leave modes a crashed TUI may have left on: alt screen, mouse, bracketed paste, focus; then DECSTR.
const SANE_MODES = '\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1004l\x1b[!p';

/**
 * One shell in a PTY, mirrored by a headless terminal that is the source of truth for reconnects.
 *
 * Ordering invariant: every event is emitted from a headless `write` callback, so at any point
 * between tasks the headless state equals exactly what was already emitted. A snapshot taken at
 * that point plus the events that follow reproduce the screen with no gaps or duplicates.
 */
export class Session {
  readonly id = randomUUID();
  readonly cwd: string;
  readonly createdAt = Date.now();
  name: string;
  state: SessionState = 'idle';
  exitCode: number | null = null;
  /** Browsers attached right now (kept by the WebSocket layer). */
  viewers = 0;

  private readonly term: HeadlessTerminal;
  private readonly serializer = new SerializeAddon();
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  private proc: IPty | null = null;
  private size: TermSize = INITIAL_SIZE;
  private disposed = false;
  // Not covered by the serialize addon; tracked from the stream.
  private cursorHidden = false;
  private cursorStyle = 0;

  constructor(private readonly opts: SessionOptions) {
    this.name = opts.name;
    this.cwd = opts.cwd;
    this.term = new Terminal({ ...INITIAL_SIZE, scrollback: opts.scrollback, allowProposedApi: true });
    this.term.loadAddon(this.serializer);
    // Replies to device queries (DA, DSR/CPR, DECRQM...) come from here; browsers mute theirs.
    this.term.onData((reply) => this.proc?.write(reply));
    this.trackCursor();
    this.spawn();
  }

  get running(): boolean {
    return this.proc !== null;
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): SnapshotMessage {
    let data = this.serializer.serialize();
    if (this.cursorHidden) data += '\x1b[?25l';
    if (this.cursorStyle) data += `\x1b[${this.cursorStyle} q`;
    return {
      type: 'snapshot',
      sessionId: this.id,
      cols: this.term.cols,
      rows: this.term.rows,
      data,
      running: this.running,
    };
  }

  info(): SessionInfo {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      state: this.state,
      running: this.running,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      preview: this.preview(),
      viewers: this.viewers,
    };
  }

  /** Last lines with real content, skipping blank rows and TUI chrome (box borders, empty prompt). */
  preview(max = PREVIEW_LINES): string[] {
    if (this.disposed) return [];
    const buf = this.term.buffer.active;
    const bottom = buf.baseY + this.term.rows - 1;
    const lines: string[] = [];
    for (let y = bottom; y >= 0 && y > bottom - PREVIEW_SCAN && lines.length < max; y--) {
      const raw = buf.getLine(y)?.translateToString(true) ?? '';
      const text = raw.replace(CHROME, ' ').replace(/\s+/g, ' ').trim();
      if (/[\p{L}\p{N}]/u.test(text)) lines.unshift(text.slice(0, PREVIEW_MAX_CHARS));
    }
    return lines;
  }

  write(data: string): void {
    this.proc?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.size.cols && rows === this.size.rows) return;
    this.size = { cols, rows };
    this.proc?.resize(cols, rows);
    // Queued so output produced at the old size is parsed at the old size.
    this.inOrder(() => {
      this.term.resize(cols, rows);
      this.emit({ type: 'resize', sessionId: this.id, cols, rows });
    });
  }

  restart(): void {
    if (this.proc || this.disposed) return;
    // Scroll the old screen into scrollback; the new ConPTY assumes a blank screen.
    this.output(`\x1b[${this.size.rows};1H${'\n'.repeat(this.size.rows)}\x1b[H`);
    this.spawn();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const proc = this.proc;
    this.proc = null;
    try {
      proc?.kill();
    } catch {
      // Already gone.
    }
    this.listeners.clear();
    this.term.dispose();
  }

  private spawn(): void {
    const { cols, rows } = this.size;
    const proc = spawn(this.opts.shell, this.opts.shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: this.opts.cwd,
      env: this.env(),
    });
    this.proc = proc;
    this.exitCode = null;
    proc.onData((data) => {
      if (this.proc === proc) this.output(data);
    });
    proc.onExit(({ exitCode }) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.exitCode = exitCode;
      this.output(`${SANE_MODES}\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`);
      this.inOrder(() => this.emit({ type: 'process', sessionId: this.id, running: false, exitCode }));
    });
    if (this.opts.startupCommand) proc.write(`${this.opts.startupCommand}\r`);
    this.inOrder(() => this.emit({ type: 'process', sessionId: this.id, running: true, exitCode: null }));
  }

  private env(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !STRIPPED_ENV.test(k)) env[k] = v;
    }
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.CCC_SESSION_ID = this.id;
    return env;
  }

  private output(data: string): void {
    this.term.write(data, () => this.emit({ type: 'output', sessionId: this.id, data }));
  }

  /** Runs `fn` after everything written so far was parsed. */
  private inOrder(fn: () => void): void {
    this.term.write('', fn);
  }

  private emit(e: SessionEvent): void {
    if (this.disposed) return;
    for (const fn of this.listeners) fn(e);
  }

  private trackCursor(): void {
    const p = this.term.parser;
    const decset = (on: boolean) => (params: (number | number[])[]) => {
      if (params.includes(25)) this.cursorHidden = !on;
      return false; // let the default handler run too
    };
    p.registerCsiHandler({ prefix: '?', final: 'h' }, decset(true));
    p.registerCsiHandler({ prefix: '?', final: 'l' }, decset(false));
    p.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
      const ps = params[0];
      this.cursorStyle = typeof ps === 'number' ? ps : 0;
      return false;
    });
    const reset = () => {
      this.cursorHidden = false;
      this.cursorStyle = 0;
      return false;
    };
    p.registerCsiHandler({ intermediates: '!', final: 'p' }, reset); // DECSTR
    p.registerEscHandler({ final: 'c' }, reset); // RIS
  }
}
