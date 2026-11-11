import { buzz, el, keepFocus } from '../dom';

const DRAFT_PREFIX = 'ccc.draft.';
const DRAFT_SAVE_MS = 300;

/** Multi-line message box (keyboard dictation friendly). Drafts survive reloads, one per session. */
export class Compose {
  readonly root: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly snips: HTMLElement;
  private readonly sendBtn: HTMLButtonElement;
  private sessionId: string | null = null;
  private saveTimer = 0;

  /** `send` returns false when the text could not be delivered (kept in the box). */
  constructor(private readonly send: (text: string) => boolean) {
    this.input = el('textarea', {
      class: 'compose-input',
      rows: 1,
      placeholder: 'Message…  (Ctrl+Enter sends)',
      enterKeyHint: 'enter',
      autocapitalize: 'sentences',
      spellcheck: true,
      'aria-label': 'Message',
    });
    this.sendBtn = keepFocus(
      el('button', { class: 'compose-send', type: 'button', title: 'Send (paste + Enter)', 'aria-label': 'Send' }, '➤'),
    );
    this.snips = el('div', { class: 'snips', role: 'group', 'aria-label': 'Snippets' });
    this.root = el('div', { class: 'compose' }, this.snips, el('div', { class: 'compose-row' }, this.input, this.sendBtn));

    this.input.addEventListener('input', () => {
      this.autosize();
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.saveDraft(), DRAFT_SAVE_MS);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submit();
      }
    });
    this.sendBtn.addEventListener('click', () => this.submit());
  }

  setSnippets(list: string[]): void {
    this.snips.replaceChildren(
      ...list.map((text) => {
        const label = text.length > 24 ? `${text.slice(0, 23)}…` : text;
        const b = keepFocus(el('button', { class: 'snip', type: 'button', title: text }, label));
        b.addEventListener('click', () => {
          if (this.send(text)) this.flash(b);
        });
        return b;
      }),
    );
  }

  /** Swap drafts when the terminal switches sessions. */
  setSession(id: string | null): void {
    if (id === this.sessionId) return;
    this.saveDraft();
    this.sessionId = id;
    this.input.value = id ? (localStorage.getItem(DRAFT_PREFIX + id) ?? '') : '';
    this.autosize();
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  get editor(): HTMLTextAreaElement {
    return this.input;
  }

  private submit(): void {
    // Dictation often leaves trailing spaces; leading indentation is kept.
    const text = this.input.value.replace(/\s+$/, '');
    if (!this.send(text)) return;
    this.input.value = '';
    this.autosize();
    this.saveDraft();
    this.flash(this.sendBtn);
  }

  private saveDraft(): void {
    clearTimeout(this.saveTimer);
    if (!this.sessionId) return;
    const key = DRAFT_PREFIX + this.sessionId;
    if (this.input.value) localStorage.setItem(key, this.input.value);
    else localStorage.removeItem(key);
  }

  private autosize(): void {
    this.input.style.height = 'auto';
    const border = this.input.offsetHeight - this.input.clientHeight;
    this.input.style.height = `${this.input.scrollHeight + border}px`; // capped by max-height in CSS
  }

  private flash(node: HTMLElement): void {
    buzz(12);
    node.classList.remove('sent');
    void node.offsetWidth;
    node.classList.add('sent');
  }
}

/** Drop drafts of sessions that no longer exist. */
export function pruneDrafts(live: ReadonlySet<string>): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(DRAFT_PREFIX) && !live.has(key.slice(DRAFT_PREFIX.length))) localStorage.removeItem(key);
  }
}
