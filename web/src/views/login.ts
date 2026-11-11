import { api } from '../api';
import { el } from '../dom';

export class LoginView {
  readonly root: HTMLElement;
  private readonly input = el('input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'access token',
    enterKeyHint: 'go',
  });
  private readonly error = el('div', { class: 'login-error', role: 'alert' });
  private readonly button = el('button', { class: 'btn', type: 'submit' }, 'Unlock');

  constructor(private readonly onSuccess: () => void) {
    const form = el(
      'form',
      { class: 'login-card' },
      el('div', { class: 'login-glyph' }, '>_'),
      el('h1', {}, 'cc', el('b', {}, '-'), 'cockpit'),
      el('p', {}, 'Paste the token from config.json. This device stays signed in.'),
      // Hidden username helps password managers store the token.
      el('input', { type: 'text', autocomplete: 'username', value: 'cc-cockpit', hidden: true }),
      this.input,
      this.error,
      this.button,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit(this.input.value);
    });
    this.root = el('div', { class: 'login' }, form);
  }

  /** `?token=…` in the URL logs in once and is then scrubbed from history. */
  async tryUrlToken(): Promise<boolean> {
    const url = new URL(location.href);
    const token = url.searchParams.get('token');
    if (!token) return false;
    url.searchParams.delete('token');
    history.replaceState(null, '', url);
    return this.submit(token);
  }

  focus(): void {
    this.input.focus();
  }

  private async submit(token: string): Promise<boolean> {
    if (!token.trim()) return false;
    this.button.disabled = true;
    this.error.textContent = '';
    try {
      await api.login(token.trim());
      this.input.value = '';
      this.onSuccess();
      return true;
    } catch (e) {
      this.error.textContent = (e as Error).message;
      this.root.classList.remove('shake');
      void this.root.offsetWidth;
      this.root.classList.add('shake');
      return false;
    } finally {
      this.button.disabled = false;
    }
  }
}
