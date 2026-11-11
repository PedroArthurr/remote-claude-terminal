import { audio } from '../audio/engine';
import { el } from '../dom';
import type { PreviewKind } from '../fx/director';
import { prefs, type Quality, type ThemeId } from '../prefs';
import { THEMES } from '../themes';

const QUALITY: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Med' },
  { id: 'high', label: 'High' },
];
const PREVIEWS: PreviewKind[] = ['prompt', 'tool', 'permission', 'done', 'error'];

/** Look & sound sheet: theme, sound, effect quality. Changes apply live. */
export class SettingsSheet {
  readonly root: HTMLDialogElement;
  private readonly themeBtns = new Map<ThemeId, HTMLButtonElement>();
  private readonly qualityBtns = new Map<Quality, HTMLButtonElement>();
  private readonly sound: HTMLInputElement;
  private readonly volume: HTMLInputElement;
  private readonly reduce: HTMLInputElement;
  private readonly haptics: HTMLInputElement;

  constructor(preview: (k: PreviewKind) => void) {
    const themes = el(
      'div',
      { class: 'theme-list', role: 'radiogroup', 'aria-label': 'Theme' },
      ...THEMES.map((t) => {
        const b = el(
          'button',
          { class: 'theme-card', type: 'button', role: 'radio', 'data-theme-id': t.id },
          el('span', { class: 'tc-name' }, t.name),
          el('span', { class: 'tc-tag' }, t.tagline),
          el('span', { class: 'tc-swatches' }, ...t.palette.slice(0, 5).map((c) => el('i', { style: `background:${c}` }))),
        );
        b.style.setProperty('--tc-bg', t.vars['--panel'] ?? '#000');
        b.style.setProperty('--tc-fg', t.vars['--fg'] ?? '#fff');
        b.style.setProperty('--tc-accent', t.vars['--accent'] ?? '#fff');
        b.style.setProperty('--tc-font', t.vars['--font-display'] ?? 'monospace');
        b.style.setProperty('--tc-size', t.vars['--display-size'] ?? '1');
        b.addEventListener('click', () => prefs.set({ theme: t.id }));
        this.themeBtns.set(t.id, b);
        return b;
      }),
    );

    this.sound = el('input', { type: 'checkbox', onchange: () => prefs.set({ muted: !this.sound.checked }) });
    this.volume = el('input', {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      'aria-label': 'Volume',
      oninput: () => prefs.set({ volume: Number(this.volume.value) }),
      onchange: () => audio.play('ack'),
    });
    this.reduce = el('input', { type: 'checkbox', onchange: () => prefs.set({ reduce: this.reduce.checked }) });
    this.haptics = el('input', { type: 'checkbox', onchange: () => prefs.set({ haptics: this.haptics.checked }) });

    const quality = el(
      'div',
      { class: 'seg', role: 'radiogroup', 'aria-label': 'Effects quality' },
      ...QUALITY.map((q) => {
        const b = el('button', { type: 'button', role: 'radio', onclick: () => prefs.set({ quality: q.id }) }, q.label);
        this.qualityBtns.set(q.id, b);
        return b;
      }),
    );

    const form = el(
      'form',
      { method: 'dialog' },
      el('h2', {}, 'Look & sound'),
      el('div', { class: 'field' }, el('span', { class: 'label' }, 'Theme'), themes),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'label' }, 'Sound'),
        el('div', { class: 'row' }, switchEl(this.sound, 'On'), this.volume),
      ),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'label' }, 'Effects'),
        el('div', { class: 'row' }, quality, switchEl(this.reduce, 'Reduce'), switchEl(this.haptics, 'Vibrate')),
      ),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'label' }, 'Try'),
        el(
          'div',
          { class: 'try' },
          ...PREVIEWS.map((k) => el('button', { class: 'snip', type: 'button', onclick: () => preview(k) }, k)),
        ),
      ),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit', value: 'ok' }, 'Done')),
    );
    this.root = el('dialog', { class: 'sheet settings' }, form);
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.root.close();
    });
    prefs.on(() => this.sync());
    this.sync();
  }

  open(): void {
    this.sync();
    this.root.showModal();
  }

  private sync(): void {
    const p = prefs.get();
    for (const [id, b] of this.themeBtns) b.setAttribute('aria-checked', String(id === p.theme));
    for (const [id, b] of this.qualityBtns) b.setAttribute('aria-checked', String(id === p.quality));
    this.sound.checked = !p.muted;
    this.volume.value = String(p.volume);
    this.volume.disabled = p.muted;
    this.reduce.checked = p.reduce;
    this.haptics.checked = p.haptics;
  }
}

function switchEl(input: HTMLInputElement, label: string): HTMLElement {
  return el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', {}, label));
}
