import { MAX_SESSION_NAME, type Favorite, type SessionInfo } from '@ccc/shared';
import { api } from '../api';
import { el, relTime, shortPath, toast } from '../dom';

const KILL_ARM_MS = 3000;

interface CardRefs {
  root: HTMLElement;
  name: HTMLElement;
  path: HTMLElement;
  state: HTMLElement;
  preview: HTMLElement;
  meta: HTMLElement;
  kill: HTMLButtonElement;
  previewKey: string;
}

export class Dashboard {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly cards = new Map<string, CardRefs>();
  private sessions: SessionInfo[] = [];
  private favorites: Favorite[] = [];
  private readonly dialog: SessionDialog;

  constructor(private readonly open: (id: string) => void) {
    this.dialog = new SessionDialog();
    this.grid = el('div', { class: 'grid' });
    this.empty = el(
      'div',
      { class: 'empty' },
      el('div', { class: 'empty-glyph' }, '>_'),
      el('div', {}, 'No sessions running'),
      el('button', { class: 'btn', onclick: () => this.create() }, '+ New session'),
    );
    this.root = el(
      'div',
      { class: 'dash' },
      el(
        'div',
        { class: 'dash-head' },
        el('h1', {}, 'Sessions'),
        el('span', { class: 'count', 'data-ref': 'count' }),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-sm', onclick: () => this.create() }, '+ New'),
      ),
      this.grid,
      this.empty,
      this.dialog.root,
    );
    setInterval(() => this.refreshTimes(), 30_000);
  }

  async loadFavorites(): Promise<void> {
    this.favorites = await api.favorites();
  }

  get list(): SessionInfo[] {
    return this.sessions;
  }

  update(sessions: SessionInfo[]): void {
    this.sessions = sessions;
    const seen = new Set<string>();
    sessions.forEach((s, i) => {
      seen.add(s.id);
      let c = this.cards.get(s.id);
      if (!c) {
        c = this.buildCard(s);
        c.root.style.setProperty('--i', String(i));
        this.cards.set(s.id, c);
      }
      this.fillCard(c, s);
      // Keep DOM order equal to server order without re-inserting stable nodes.
      if (this.grid.children[i] !== c.root) this.grid.insertBefore(c.root, this.grid.children[i] ?? null);
    });
    for (const [id, c] of this.cards) {
      if (seen.has(id)) continue;
      this.cards.delete(id);
      c.root.classList.add('leaving');
      c.root.addEventListener('animationend', () => c.root.remove(), { once: true });
      setTimeout(() => c.root.remove(), 400); // in case animations are off
    }
    this.empty.classList.toggle('show', sessions.length === 0);
    const count = this.root.querySelector<HTMLElement>('[data-ref="count"]')!;
    count.textContent = sessions.length ? String(sessions.length) : '';
  }

  private buildCard(s: SessionInfo): CardRefs {
    const refs = {
      name: el('span', { class: 'sc-name' }),
      path: el('span', { class: 'sc-path' }),
      state: el('span', { class: 'badge' }),
      preview: el('div', { class: 'sc-preview' }),
      meta: el('div', { class: 'sc-meta' }),
      kill: el('button', { class: 'icon-btn danger', title: 'Kill session', 'aria-label': 'Kill session' }, '✕'),
      previewKey: '',
    };
    const rename = el('button', { class: 'icon-btn', title: 'Rename', 'aria-label': 'Rename' }, '✎');
    const root = el(
      'article',
      { class: 'sc', tabIndex: 0, role: 'button', 'aria-label': `Open ${s.name}` },
      el('div', { class: 'sc-top' }, el('i', { class: 'sc-dot' }), refs.name, refs.state, rename, refs.kill),
      refs.path,
      refs.preview,
      refs.meta,
    );

    root.addEventListener('click', () => this.open(s.id));
    root.addEventListener('keydown', (e) => {
      if (e.target === root && (e.key === 'Enter' || e.key === ' ')) this.open(s.id);
    });
    rename.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.rename(s.id);
    });
    let armTimer = 0;
    refs.kill.addEventListener('click', (e) => {
      e.stopPropagation();
      // Two taps: first arms, second kills.
      if (!refs.kill.classList.contains('armed')) {
        refs.kill.classList.add('armed');
        refs.kill.textContent = 'kill?';
        armTimer = window.setTimeout(() => {
          refs.kill.classList.remove('armed');
          refs.kill.textContent = '✕';
        }, KILL_ARM_MS);
        return;
      }
      clearTimeout(armTimer);
      refs.kill.disabled = true;
      api.killSession(s.id).catch((err: Error) => {
        refs.kill.disabled = false;
        toast(err.message, 'bad');
      });
    });
    return { root, ...refs };
  }

  private fillCard(c: CardRefs, s: SessionInfo): void {
    c.root.dataset.state = s.running ? s.state : 'exited';
    c.root.setAttribute('aria-label', `Open ${s.name}`);
    c.name.textContent = s.name;
    c.path.textContent = shortPath(s.cwd, 3);
    c.path.title = s.cwd;
    c.state.textContent = s.running ? s.state.replace('_', ' ') : `exited ${s.exitCode ?? ''}`.trim();
    const key = s.preview.join('\n');
    if (key !== c.previewKey) {
      c.previewKey = key;
      c.preview.replaceChildren(
        ...(s.preview.length ? s.preview : ['—']).map((line) => el('div', { class: 'sc-line' }, line)),
      );
      // Re-trigger the "fresh output" blink.
      c.preview.classList.remove('tick');
      void c.preview.offsetWidth;
      c.preview.classList.add('tick');
    }
    c.meta.dataset.created = String(s.createdAt);
    c.meta.dataset.viewers = String(s.viewers);
    this.fillMeta(c.meta);
  }

  private fillMeta(meta: HTMLElement): void {
    const viewers = Number(meta.dataset.viewers);
    const age = relTime(Number(meta.dataset.created));
    meta.textContent = `up ${age}${viewers ? ` · ${viewers} viewing` : ''}`;
  }

  private refreshTimes(): void {
    for (const c of this.cards.values()) this.fillMeta(c.meta);
  }

  async create(): Promise<void> {
    if (!this.favorites.length) await this.loadFavorites().catch(() => undefined);
    if (!this.favorites.length) return toast('No favorite folders in config.json', 'bad');
    const res = await this.dialog.ask({ title: 'New session', favorites: this.favorites, submit: 'Create' });
    if (!res) return;
    try {
      const s = await api.createSession({ favorite: res.favorite, name: res.name || undefined });
      this.open(s.id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  private async rename(id: string): Promise<void> {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return;
    const res = await this.dialog.ask({ title: 'Rename session', name: s.name, submit: 'Rename' });
    if (!res?.name || res.name === s.name) return;
    try {
      await api.renameSession(id, { name: res.name });
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }
}

interface DialogRequest {
  title: string;
  submit: string;
  name?: string;
  favorites?: Favorite[];
}

interface DialogResult {
  name: string;
  favorite: number;
}

/** Bottom sheet on phones, centered card on desktop. Native <dialog> for focus trap and Esc. */
class SessionDialog {
  readonly root: HTMLDialogElement;
  private readonly title = el('h2', {});
  private readonly name = el('input', {
    type: 'text',
    maxLength: MAX_SESSION_NAME,
    autocomplete: 'off',
    enterKeyHint: 'done',
  });
  private readonly favs = el('div', { class: 'fav-list', role: 'radiogroup' });
  private readonly favField = el('div', { class: 'field' }, el('span', { class: 'label' }, 'Folder'), this.favs);
  private readonly submit = el('button', { class: 'btn', type: 'submit', value: 'ok' });
  private resolve: ((r: DialogResult | null) => void) | null = null;

  constructor() {
    const form = el(
      'form',
      { method: 'dialog' },
      this.title,
      el('label', { class: 'field' }, el('span', { class: 'label' }, 'Name'), this.name),
      this.favField,
      el(
        'div',
        { class: 'actions' },
        el('button', { class: 'btn ghost', type: 'button', onclick: () => this.root.close('') }, 'Cancel'),
        this.submit,
      ),
    );
    this.root = el('dialog', { class: 'sheet' }, form);
    this.root.addEventListener('close', () => {
      const ok = this.root.returnValue === 'ok';
      const checked = this.favs.querySelector<HTMLInputElement>('input:checked');
      this.resolve?.(ok ? { name: this.name.value.trim(), favorite: Number(checked?.value ?? 0) } : null);
      this.resolve = null;
    });
    // Tap on the backdrop closes.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.root.close('');
    });
  }

  ask(req: DialogRequest): Promise<DialogResult | null> {
    this.resolve?.(null);
    this.title.textContent = req.title;
    this.submit.textContent = req.submit;
    this.name.value = req.name ?? '';
    this.favField.hidden = !req.favorites;
    this.favs.replaceChildren(
      ...(req.favorites ?? []).map((f, i) =>
        el(
          'label',
          { class: 'fav' },
          el('input', {
            type: 'radio',
            name: 'fav',
            value: String(i),
            checked: i === 0,
            onchange: () => (this.name.placeholder = f.name),
          }),
          el('span', { class: 'fav-name' }, f.name),
          el('span', { class: 'fav-path' }, f.path),
        ),
      ),
    );
    this.name.placeholder = req.favorites?.[0]?.name ?? '';
    this.root.returnValue = '';
    this.root.showModal();
    if (!req.favorites) this.name.select();
    return new Promise((r) => (this.resolve = r));
  }
}
