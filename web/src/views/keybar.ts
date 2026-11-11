import { audio } from '../audio/engine';
import { buzz, el, keepFocus } from '../dom';

const REPEAT_DELAY_MS = 380;
const REPEAT_MS = 70;

export interface KeyBarHandlers {
  /** Bytes to send as if typed. */
  key(data: string): void;
  /** True when the app asked for application cursor keys (DECCKM). */
  appCursor(): boolean;
  toggleMode(): void;
  toggleKeyboard(): void;
}

interface KeyDef {
  label: string;
  title: string;
  /** Sequence, or the final byte of an arrow key. */
  seq: string;
  arrow?: boolean;
  cls?: string;
}

// Two rows of eight on phones, one row on wide screens.
const KEYS: KeyDef[] = [
  { label: 'esc', title: 'Escape', seq: '\x1b' },
  { label: 'tab', title: 'Tab', seq: '\t' },
  { label: '⇧tab', title: 'Shift+Tab (cycle mode)', seq: '\x1b[Z' },
  { label: '^C', title: 'Ctrl+C', seq: '\x03', cls: 'k-danger' },
  { label: '←', title: 'Left', seq: 'D', arrow: true },
  { label: '↑', title: 'Up', seq: 'A', arrow: true },
  { label: '↓', title: 'Down', seq: 'B', arrow: true },
  { label: '→', title: 'Right', seq: 'C', arrow: true },
];
const KEYS_2: KeyDef[] = [
  { label: '1', title: '1', seq: '1' },
  { label: '2', title: '2', seq: '2' },
  { label: '3', title: '3', seq: '3' },
  { label: 'y', title: 'y', seq: 'y' },
  { label: 'n', title: 'n', seq: 'n' },
  { label: '⏎', title: 'Enter', seq: '\r', cls: 'k-enter' },
];

/** Extra keys above the on-screen keyboard. Never takes focus, so the keyboard stays up. */
export class KeyBar {
  readonly root: HTMLElement;
  private readonly modeBtn: HTMLButtonElement;
  private readonly kbBtn: HTMLButtonElement;

  constructor(h: KeyBarHandlers) {
    this.modeBtn = this.button('✎', 'Compose mode', 'k-tool k-mode');
    this.kbBtn = this.button('⌨', 'Show/hide keyboard', 'k-tool k-kb');
    press(this.modeBtn, () => h.toggleMode(), false, true);
    press(this.kbBtn, () => h.toggleKeyboard(), false, true);

    const keys = [...KEYS, ...KEYS_2].map((k) => {
      const b = this.button(k.label, k.title, k.cls);
      const fire = () => h.key(k.arrow ? `${h.appCursor() ? '\x1bO' : '\x1b['}${k.seq}` : k.seq);
      press(b, fire, !!k.arrow);
      return b;
    });
    keys.splice(KEYS.length, 0, this.modeBtn, this.kbBtn);
    this.root = el('div', { class: 'keybar', role: 'toolbar', 'aria-label': 'Terminal keys' }, ...keys);
  }

  setMode(compose: boolean): void {
    this.modeBtn.classList.toggle('on', compose);
    this.modeBtn.setAttribute('aria-pressed', String(compose));
  }

  setKeyboard(open: boolean): void {
    this.kbBtn.classList.toggle('on', open);
    this.kbBtn.setAttribute('aria-pressed', String(open));
  }

  private button(label: string, title: string, cls = ''): HTMLButtonElement {
    return keepFocus(
      el('button', { class: `k ${cls}`.trim(), type: 'button', tabIndex: -1, title, 'aria-label': title }, label),
    );
  }
}

/**
 * Keys fire on press (feels instant; arrows auto-repeat while held).
 * `onRelease` fires on lift instead: focus changes need the user activation a touch `pointerup` grants.
 */
function press(btn: HTMLButtonElement, fire: () => void, repeat: boolean, onRelease = false): void {
  let delay = 0;
  let interval = 0;
  let down = false;
  const stop = () => {
    down = false;
    clearTimeout(delay);
    clearInterval(interval);
    btn.classList.remove('down');
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    down = true;
    btn.classList.add('down');
    buzz();
    audio.play('key');
    if (onRelease) return;
    fire();
    if (repeat) delay = window.setTimeout(() => (interval = window.setInterval(fire, REPEAT_MS)), REPEAT_DELAY_MS);
  });
  btn.addEventListener('pointerup', () => {
    const was = down;
    stop();
    if (was && onRelease) fire();
  });
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on Android
}
