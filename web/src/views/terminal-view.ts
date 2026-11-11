import type { TerminalMessage, TermSize } from '@ccc/shared';
import type { Connection } from '../connection';
import { el, toast } from '../dom';
import { createTerminal, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../terminal';
import { isKeyboardOpen } from '../viewport';
import { Compose } from './compose';
import { KeyBar } from './keybar';

// Auto-focus would pop the on-screen keyboard on phones; there the user taps the terminal.
const FINE_POINTER = matchMedia('(pointer: fine)').matches;
// Enter right after the paste end marker can be read as part of the paste; give the TUI a beat.
const PASTE_ENTER_DELAY_MS = 80;
// A touch that moves more than this is a scroll, not a tap (taps focus the terminal).
const TAP_SLOP_PX = 10;

const MODE_KEY = 'ccc.inputMode';
const FONT_KEY = 'ccc.fontSize';

export type InputMode = 'term' | 'compose';

/** One xterm reused for whichever session is attached, plus the key bar and Compose box. */
export class TerminalView {
  readonly root: HTMLElement;
  private readonly host: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly exitText: HTMLElement;
  private readonly view;
  private readonly keybar: KeyBar;
  private readonly compose: Compose;
  private sessionId: string | null = null;
  private running = true;
  private lastSent: TermSize | null = null;
  private resizeTimer = 0;
  private mode: InputMode = localStorage.getItem(MODE_KEY) === 'compose' ? 'compose' : 'term';
  private fontSize = clampFont(Number(localStorage.getItem(FONT_KEY)) || DEFAULT_FONT_SIZE);

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
    this.compose = new Compose((text) => this.sendText(text));
    this.keybar = new KeyBar({
      key: (data) => this.sendKey(data),
      appCursor: () => this.view.term.modes.applicationCursorKeysMode,
      toggleMode: () => this.setMode(this.mode === 'term' ? 'compose' : 'term', true),
      toggleKeyboard: () => this.toggleKeyboard(),
    });
    this.root = el(
      'div',
      { class: 'stage' },
      el('div', { class: 'screen' }, this.host, this.overlay),
      this.compose.root,
      this.keybar.root,
    );

    this.view = createTerminal(this.host, this.fontSize);
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
    this.watchTaps();
    new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.syncSize(), 80);
    }).observe(this.host);

    this.setMode(this.mode, false);
    addEventListener('ccc:keyboard', () => this.keybar.setKeyboard(this.keyboardUp()));
    document.addEventListener('focusin', () => this.keybar.setKeyboard(this.keyboardUp()));
    document.addEventListener('focusout', () => queueMicrotask(() => this.keybar.setKeyboard(this.keyboardUp())));
  }

  get attached(): string | null {
    return this.sessionId;
  }

  setSnippets(list: string[]): void {
    this.compose.setSnippets(list);
  }

  /** Show `id`. Clears the old screen right away; the snapshot paints the new one. */
  attach(id: string): void {
    if (this.sessionId === id) return;
    this.sessionId = id;
    this.lastSent = null;
    this.root.classList.add('loading');
    this.view.term.reset();
    this.compose.setSession(id);
    this.setRunning(true, null);
    this.conn.send({ type: 'attach', sessionId: id });
  }

  detach(): void {
    if (!this.sessionId) return;
    this.sessionId = null;
    this.compose.setSession(null);
    this.view.term.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.conn.send({ type: 'detach' });
  }

  /** After a reconnect the server forgot us; ask again. */
  reattach(): void {
    this.lastSent = null;
    if (this.sessionId) this.conn.send({ type: 'attach', sessionId: this.sessionId });
  }

  /** Step the font size; the server then picks the new PTY size. */
  zoom(delta: number): void {
    const next = clampFont(this.fontSize + delta);
    if (next === this.fontSize) return;
    this.fontSize = next;
    localStorage.setItem(FONT_KEY, String(next));
    this.view.setFontSize(next);
    requestAnimationFrame(() => this.syncSize());
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
          this.view.repaint();
          this.onSize(`${term.cols}×${term.rows}`);
          this.syncSize(true);
        });
        this.setRunning(msg.running, null);
        if (FINE_POINTER && this.mode === 'term') term.focus();
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

  // ── input ─────────────────────────────────────────────

  /** Key bar: same path as typing, so the exited-process Enter-to-restart applies too. */
  private sendKey(data: string): void {
    if (!this.sessionId) return;
    this.view.term.input(data, true);
  }

  /** Compose: paste (bracketed if the app asked for it), then Enter. Empty text = just Enter. */
  private sendText(text: string): boolean {
    if (!this.sessionId) return false;
    if (!this.conn.online) {
      toast('Offline — message kept', 'bad');
      return false;
    }
    if (!this.running) {
      toast('Process exited — restart first', 'bad');
      return false;
    }
    const { term } = this.view;
    if (!text) {
      term.input('\r', true);
      return true;
    }
    const id = this.sessionId;
    term.paste(text);
    setTimeout(() => {
      if (this.sessionId === id) term.input('\r', true);
    }, PASTE_ENTER_DELAY_MS);
    return true;
  }

  private setMode(mode: InputMode, user: boolean): void {
    this.mode = mode;
    localStorage.setItem(MODE_KEY, mode);
    this.root.dataset.mode = mode;
    this.keybar.setMode(mode === 'compose');
    if (!user) return;
    // Follow the switch with the keyboard: Compose wants to type; Terminal keeps it if it was up.
    if (mode === 'compose') this.compose.focus();
    else if (this.keyboardUp()) this.view.term.focus();
  }

  private keyboardUp(): boolean {
    const a = document.activeElement;
    const focused = !!a && (a === this.compose.editor || this.host.contains(a));
    // Android's back gesture hides the keyboard but keeps focus; trust the viewport when it can tell.
    return focused && (FINE_POINTER || isKeyboardOpen() || !window.visualViewport);
  }

  private toggleKeyboard(): void {
    const target = this.mode === 'compose' ? this.compose.editor : this.view.term.textarea;
    if (this.keyboardUp()) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    // Re-focusing an already focused field does not bring the keyboard back; blur first.
    target?.blur();
    if (this.mode === 'compose') this.compose.focus();
    else this.view.term.focus();
  }

  /** Terminal mode: a tap focuses (keyboard up); a drag only scrolls. Compose mode: never steal focus. */
  private watchTaps(): void {
    let start: { x: number; y: number } | null = null;
    this.host.addEventListener('pointerdown', (e) => {
      if (FINE_POINTER) {
        if (this.mode === 'term') this.view.term.focus();
        return;
      }
      start = { x: e.clientX, y: e.clientY };
    });
    this.host.addEventListener('pointerup', (e) => {
      if (!start || this.mode !== 'term') return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      start = null;
      if (moved < TAP_SLOP_PX) this.view.term.focus();
    });
    this.host.addEventListener('pointercancel', () => (start = null));
  }

  // ── size ──────────────────────────────────────────────

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
    if (value && this.sessionId && FINE_POINTER && this.mode === 'term') this.view.term.focus();
  }

  private restart(): void {
    this.conn.send({ type: 'restart' });
  }
}

function clampFont(px: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}
