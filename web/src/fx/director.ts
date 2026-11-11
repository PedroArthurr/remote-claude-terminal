import type { Activity, ActivityKind, SessionInfo, ToolCategory } from '@ccc/shared';
import { audio } from '../audio/engine';
import { toast } from '../dom';
import { prefs } from '../prefs';
import type { Theme } from '../themes/types';
import type { Background } from './background';
import type { Particles } from './particles';

export interface DirectorDeps {
  background: Background;
  particles: Particles;
  /** Which screen is showing. */
  view(): string;
  /** Session open in the terminal, if any. */
  attached(): string | null;
  card(id: string): HTMLElement | null;
  screen: HTMLElement;
  sessionName(id: string): string;
}

/** Kinds the settings preview can fire. */
export type PreviewKind = 'prompt' | 'tool' | 'permission' | 'done' | 'error';

const HAPTICS: Partial<Record<ActivityKind, number[]>> = {
  permission: [90, 60, 90, 60, 90],
  done: [30, 50, 120],
  error: [220],
};
// PermissionRequest and the permission Notification both arrive for one dialog: one effect.
const DEDUPE_MS: Partial<Record<ActivityKind, number>> = { permission: 4000, done: 1500, error: 1500 };

interface Anchor {
  x: number;
  y: number;
  el: HTMLElement;
  /** Card on the dashboard, or the terminal of the open session. */
  on: 'card' | 'screen';
}

/** Turns live activity into visuals, sound and haptics, depending on what is on screen. */
export class FxDirector {
  private theme: Theme | null = null;
  private recent = new Map<string, number>();

  constructor(private readonly d: DirectorDeps) {}

  setTheme(t: Theme): void {
    this.theme = t;
  }

  sessions(list: SessionInfo[]): void {
    const live = list.filter((s) => s.running);
    this.d.background.setMood(
      live.some((s) => s.state === 'working') ? 1 : 0,
      live.some((s) => s.state === 'waiting_permission') ? 1 : 0,
    );
  }

  activity(a: Activity): void {
    const gap = DEDUPE_MS[a.kind];
    if (gap) {
      const key = `${a.kind}:${a.sessionId}`;
      const now = performance.now();
      if (now - (this.recent.get(key) ?? -1e9) < gap) return;
      this.recent.set(key, now);
    }
    this.run(a.kind, a.sessionId, a.category);
  }

  /** Settings "try it": plays on the open terminal, else the first card, else mid-screen. */
  preview(kind: PreviewKind): void {
    const id = this.d.attached() ?? this.firstCardId();
    this.run(kind, id ?? '', kind === 'tool' ? (['edit', 'shell', 'search', 'web'] as const)[Math.floor(Math.random() * 4)] : undefined, true);
  }

  private run(kind: ActivityKind, id: string, category: ToolCategory | undefined, preview = false): void {
    const t = this.theme;
    if (!t) return;
    const at = this.anchor(id) ?? (preview ? this.center() : null);
    const pal = t.palette;
    const vars = t.vars;
    const name = this.d.sessionName(id);
    const elsewhere = !at && this.d.view() === 'term';

    switch (kind) {
      case 'prompt':
        audio.play('prompt');
        this.d.background.pulse();
        if (at) this.d.particles.ring(at.x, at.y, vars['--info'] ?? pal[0]!, at.on === 'card' ? 60 : 160);
        break;
      case 'tool': {
        audio.play('tool', category);
        if (!at) break;
        const color = toolColor(pal, category);
        if (at.on === 'screen') this.sweep(at.el, color);
        else this.d.particles.sparks(at.x, at.y, color, 10, t.burst === 'pixels');
        break;
      }
      case 'permission':
        audio.play('permission');
        this.haptic(kind);
        if (at) {
          this.d.particles.ring(at.x, at.y, vars['--warn'] ?? pal[0]!, at.on === 'card' ? 80 : 200, 0.9);
          retrigger(at.el, 'fx-attn');
        } else if (elsewhere) toast(`${name} · needs permission`);
        break;
      case 'permission_answered':
        audio.play('ack');
        break;
      case 'done':
        audio.play('done');
        this.haptic(kind);
        this.d.background.pulse();
        if (at) this.d.particles.burst(t.burst, at.x, at.y, pal, at.on === 'card' ? 0.75 : 1.15);
        else if (elsewhere) toast(`${name} · done`);
        break;
      case 'error':
        audio.play('error');
        this.haptic(kind);
        if (at && !prefs.get().reduce) retrigger(at.el, 'fx-glitch');
        else if (elsewhere) toast(`${name} · error`, 'bad');
        break;
      default:
        break;
    }
  }

  private anchor(id: string): Anchor | null {
    const view = this.d.view();
    if (view === 'dash') {
      const card = this.d.card(id);
      if (!card) return null;
      const r = card.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return null; // scrolled away: sound only
      const dot = card.querySelector('.sc-dot')?.getBoundingClientRect() ?? r;
      return { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2, el: card, on: 'card' };
    }
    if (view === 'term' && id && this.d.attached() === id) {
      const r = this.d.screen.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.35, el: this.d.screen, on: 'screen' };
    }
    return null;
  }

  private center(): Anchor {
    return { x: innerWidth / 2, y: innerHeight * 0.4, el: document.body, on: 'screen' };
  }

  private firstCardId(): string | null {
    const card = document.querySelector<HTMLElement>('.sc[data-id]');
    return card?.dataset.id ?? null;
  }

  private sweep(screen: HTMLElement, color: string): void {
    if (prefs.get().reduce) return;
    screen.style.setProperty('--scan', color);
    screen.style.setProperty('--scan-h', `${screen.clientHeight}px`);
    retrigger(screen, 'fx-scan');
  }

  private haptic(kind: ActivityKind): void {
    const pattern = HAPTICS[kind];
    if (!pattern || !prefs.get().haptics) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Needs a prior user gesture; harmless.
    }
  }
}

function toolColor(pal: string[], c: ToolCategory | undefined): string {
  const i = c === 'edit' ? 0 : c === 'shell' ? 1 : c === 'read' || c === 'search' ? 2 : c === 'web' ? 3 : 4;
  return pal[i % pal.length]!;
}

/** Restart a one-shot CSS animation class. */
function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  const end = (e: AnimationEvent) => {
    if (e.target !== el) return; // a child's animation bubbled up
    el.classList.remove(cls);
    el.removeEventListener('animationend', end);
  };
  el.addEventListener('animationend', end);
}
