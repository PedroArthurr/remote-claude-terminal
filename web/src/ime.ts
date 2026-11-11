/**
 * Soft-keyboard input for xterm on phones.
 *
 * xterm tracks IME text by positions inside its hidden textarea. Gboard's autocorrect, predictions
 * and dictation rewrite earlier text in place, so those positions drift and xterm re-sends chunks
 * of the textarea (the "text repeating" bug). Here the textarea is the source of truth instead:
 * every `input` event diffs it against what the PTY already got and sends backspaces + the new
 * tail. xterm still handles real keys (Enter, Backspace on an empty field, arrows, Ctrl combos).
 */

// Keep the IME context short; cleared at a word boundary once it grows past this.
const MAX_CONTEXT = 120;

export interface MobileInputHandlers {
  /** Bytes for the PTY (goes through the same path as typed keys). */
  send(data: string): void;
  /** Printable text was typed (feedback). */
  typed?(text: string): void;
}

export class MobileInput {
  /** What the PTY has received for the current textarea contents. */
  private sent = '';
  private composing = false;
  private resetPending = false;

  constructor(
    host: HTMLElement,
    private readonly textarea: HTMLTextAreaElement,
    private readonly h: MobileInputHandlers,
  ) {
    // Capture on an ancestor runs before xterm's own listeners on the textarea; stopping
    // propagation there keeps xterm's composition logic out of it entirely.
    const own = (e: Event) => e.target === textarea;
    host.addEventListener(
      'compositionstart',
      (e) => {
        if (!own(e)) return;
        e.stopPropagation();
        this.composing = true;
      },
      true,
    );
    host.addEventListener(
      'compositionupdate',
      (e) => {
        if (own(e)) e.stopPropagation();
      },
      true,
    );
    host.addEventListener(
      'compositionend',
      (e) => {
        if (!own(e)) return;
        e.stopPropagation();
        this.composing = false;
        this.sync();
        // The commit's own input event may follow; settle after it.
        setTimeout(() => this.settle(), 0);
      },
      true,
    );
    host.addEventListener(
      'input',
      (e) => {
        if (!own(e)) return;
        e.stopPropagation();
        this.sync();
      },
      true,
    );
    host.addEventListener(
      'keydown',
      (e) => {
        if (!own(e)) return;
        const k = e as KeyboardEvent;
        // IME-driven key (229 / Unidentified): the text arrives through `input`.
        if (k.isComposing || k.keyCode === 229 || k.key === 'Unidentified') {
          e.stopPropagation();
          return;
        }
        // Plain printable keys (hardware keyboard) also go through `input`: one path, no doubles.
        if (k.key.length === 1 && !k.ctrlKey && !k.altKey && !k.metaKey) {
          e.stopPropagation();
          return;
        }
        // Real key for xterm (Enter, Backspace, arrows, Ctrl+…): it may edit the line behind
        // the textarea's back, so the textarea no longer mirrors it. Start fresh.
        setTimeout(() => this.reset(), 0);
      },
      true,
    );
    host.addEventListener(
      'keypress',
      (e) => {
        if (own(e)) e.stopPropagation();
      },
      true,
    );
    // xterm clears the textarea on blur.
    textarea.addEventListener('blur', () => {
      this.sent = '';
      this.composing = false;
      this.resetPending = false;
    });
  }

  /** New session / screen: forget the old line. */
  reset(): void {
    if (this.composing) {
      this.resetPending = true;
      return;
    }
    this.resetPending = false;
    this.textarea.value = '';
    this.sent = '';
  }

  private settle(): void {
    if (this.composing) return;
    const v = this.textarea.value;
    if (this.resetPending || (v.length > MAX_CONTEXT && /\s$/.test(v))) this.reset();
  }

  private sync(): void {
    const v = this.textarea.value;
    const s = this.sent;
    if (v === s) return;
    let p = 0;
    const n = Math.min(v.length, s.length);
    while (p < n && v.charCodeAt(p) === s.charCodeAt(p)) p++;
    // Never split a surrogate pair (emoji).
    if (p > 0 && isHigh(s.charCodeAt(p - 1))) p--;
    const removed = [...s.slice(p)].length;
    const added = v.slice(p);
    this.sent = v;
    const nl = added.includes('\n');
    const out = '\x7f'.repeat(removed) + added.replace(/\r?\n/g, '\r');
    if (!out) return;
    this.h.send(out);
    if (added) this.h.typed?.(added);
    // A newline typed into the textarea already submitted the line.
    if (nl) setTimeout(() => this.reset(), 0);
  }
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
