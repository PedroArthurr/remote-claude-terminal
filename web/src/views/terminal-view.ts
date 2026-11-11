import type { TerminalMessage, TermSize } from '@ccc/shared';
import type { Connection } from '../connection';
import { el } from '../dom';
import { createTerminal } from '../terminal';

// Auto-focus would pop the on-screen keyboard on phones; there the user taps the terminal.
const FINE_POINTER = matchMedia('(pointer: fine)').matches;

/** One xterm reused for whichever session is attached. */
export class TerminalView {
  readonly root: HTMLElement;
  private readonly host: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly exitText: HTMLElement;
  private readonly view;
  private sessionId: string | null = null;
  private running = true;
  private lastSent: TermSize | null = null;
  private resizeTimer = 0;

  constructor(
    private readonly conn: Connection,
    private readonly onSize: (size: string) => void,
  ) {
    this.host = el('div', { class: 'term' });
    this.exitText = el('div', { class: 'card-sub' });
    this.overlay = el(
      'div',
      { class: 'overlay' },
      el(
        'div',
        { class: 'panel' },
        el('div', { class: 'panel-title' }, 'Process exited'),
        this.exitText,
        el('button', { class: 'btn', onclick: () => this.restart() }, 'Restart ', el('kbd', {}, 'Enter')),
      ),
    );
    this.root = el('div', { class: 'stage' }, this.host, this.overlay);

    this.view = createTerminal(this.host);
    const { term } = this.view;
    term.onData((data) => {
      if (!this.sessionId) return;
      if (!this.running) {
        if (data === '\r') this.restart();
        return;
      }
      this.conn.send({ type: 'input', data });
    });
    term.onResize(({ cols, rows }) => this.onSize(`${cols}×${rows}`));
    this.host.addEventListener('pointerdown', () => term.focus());
    new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.syncSize(), 80);
    }).observe(this.host);
  }

  get attached(): string | null {
    return this.sessionId;
  }

  /** Show `id`. Clears the old screen right away; the snapshot paints the new one. */
  attach(id: string): void {
    if (this.sessionId === id) return;
    this.sessionId = id;
    this.lastSent = null;
    this.root.classList.add('loading');
    this.view.term.reset();
    this.setRunning(true, null);
    this.conn.send({ type: 'attach', sessionId: id });
  }

  detach(): void {
    if (!this.sessionId) return;
    this.sessionId = null;
    this.view.term.blur();
    this.conn.send({ type: 'detach' });
  }

  /** After a reconnect the server forgot us; ask again. */
  reattach(): void {
    this.lastSent = null;
    if (this.sessionId) this.conn.send({ type: 'attach', sessionId: this.sessionId });
  }

  handle(msg: TerminalMessage): void {
    if (msg.sessionId !== this.sessionId) return; // in flight from a previous session
    const { term } = this.view;
    switch (msg.type) {
      case 'snapshot':
        // Reset, resize and paint in one parse pass: no blank frame on reconnect.
        term.write('\x1bc', () => term.resize(msg.cols, msg.rows));
        term.write(msg.data, () => {
          this.root.classList.remove('loading');
          this.syncSize(true);
        });
        this.setRunning(msg.running, null);
        if (FINE_POINTER) term.focus();
        break;
      case 'output':
        term.write(msg.data);
        break;
      case 'resize':
        // After pending output, which was produced at the old size.
        term.write('', () => term.resize(msg.cols, msg.rows));
        break;
      case 'process':
        this.setRunning(msg.running, msg.exitCode);
        break;
    }
  }

  // Ask the server for the size that fills the container. The PTY size is the server's call.
  private syncSize(force = false): void {
    if (!this.sessionId) return;
    const s = this.view.preferredSize();
    if (!s) return;
    if (!force && this.lastSent && s.cols === this.lastSent.cols && s.rows === this.lastSent.rows) return;
    if (this.conn.send({ type: 'resize', ...s })) this.lastSent = s;
  }

  private setRunning(value: boolean, exitCode: number | null): void {
    this.running = value;
    this.overlay.classList.toggle('show', !value);
    this.exitText.textContent = exitCode === null ? '' : `exit code ${exitCode}`;
    if (value && this.sessionId && FINE_POINTER) this.view.term.focus();
  }

  private restart(): void {
    this.conn.send({ type: 'restart' });
  }
}
