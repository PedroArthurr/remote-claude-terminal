import type { Quality } from '../prefs';
import type { Theme } from '../themes/types';
import { createBackdrop, type Backdrop, type Mood } from './backdrops';

// Frame cap and resolution per quality level. Phones default to medium.
const LEVELS: Record<Quality, { fps: number; res: number; dprCap: number }> = {
  low: { fps: 15, res: 0.5, dprCap: 1 },
  medium: { fps: 30, res: 0.75, dprCap: 1.5 },
  high: { fps: 60, res: 1, dprCap: 2 },
};

/** Full-screen animated backdrop behind the app. Sleeps whenever it is covered or the tab is hidden. */
export class Background {
  private backdrop: Backdrop | null = null;
  private g: CanvasRenderingContext2D;
  private quality: Quality = 'medium';
  private reduce = false;
  private visible = true;
  private raf = 0;
  private lastFrame = 0;
  private t = 0;
  private mood: Mood = { energy: 0, alert: 0, pulse: 0 };
  private target = { energy: 0, alert: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d', { alpha: false })!;
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.kick());
  }

  setTheme(theme: Theme): void {
    this.backdrop = createBackdrop(theme);
    this.canvas.dataset.backdrop = theme.backdrop;
    this.resize();
  }

  setQuality(q: Quality, reduce: boolean): void {
    this.quality = q;
    this.reduce = reduce;
    this.resize();
  }

  /** False while a view covers the whole backdrop (terminal). */
  setVisible(v: boolean): void {
    this.visible = v;
    this.kick();
  }

  setMood(energy: number, alert: number): void {
    this.target = { energy, alert };
    this.kick();
  }

  pulse(): void {
    this.mood.pulse = 1;
    this.backdrop?.flourish?.();
    this.kick();
  }

  private resize(): void {
    if (!this.backdrop) return;
    const lv = LEVELS[this.quality];
    const scale = this.backdrop.fixedScale ?? Math.min(devicePixelRatio || 1, lv.dprCap) * lv.res;
    const w = Math.max(1, Math.round(innerWidth * scale));
    const h = Math.max(1, Math.round(innerHeight * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.backdrop.resize(w, h);
    this.g.imageSmoothingEnabled = false;
    // Reduced: one still frame, redrawn only when something changes.
    this.drawFrame(0);
    this.kick();
  }

  private running(): boolean {
    return !!this.backdrop && this.visible && !this.reduce && !document.hidden;
  }

  private kick(): void {
    if (this.raf || !this.running()) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.raf = 0;
    if (!this.running()) return;
    const minGap = 1000 / LEVELS[this.quality].fps;
    const elapsed = now - this.lastFrame;
    if (elapsed >= minGap - 2) {
      this.lastFrame = now;
      this.drawFrame(Math.min(0.1, elapsed / 1000));
    }
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  private drawFrame(dt: number): void {
    if (!this.backdrop) return;
    const m = this.mood;
    const k = Math.min(1, dt * 2);
    m.energy += (this.target.energy - m.energy) * k;
    m.alert += (this.target.alert - m.alert) * k;
    m.pulse = Math.max(0, m.pulse - dt * 1.5);
    this.t += dt;
    this.backdrop.draw(this.g, this.t, dt, m);
  }
}
