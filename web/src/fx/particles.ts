import type { Quality } from '../prefs';
import type { BurstStyle } from '../themes/types';

type Kind = 'spark' | 'pixel' | 'coin' | 'ember' | 'ring';

interface P {
  k: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left / total. */
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  grav: number;
  drag: number;
}

const AMOUNT: Record<Quality, number> = { low: 0.35, medium: 0.6, high: 1 };
const DPR_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
const MAX_PARTICLES = 600;

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Overlay for one-shot effects. Its loop only runs while particles are alive. */
export class Particles {
  private readonly g: CanvasRenderingContext2D;
  private list: P[] = [];
  private raf = 0;
  private last = 0;
  private quality: Quality = 'medium';
  private enabled = true;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q: Quality, reduce: boolean): void {
    this.quality = q;
    this.enabled = !reduce;
    if (!this.enabled) this.list = [];
    this.resize();
  }

  /** Celebration in the theme's style. */
  burst(style: BurstStyle, x: number, y: number, palette: string[], power = 1): void {
    if (!this.enabled) return;
    const n = (count: number) => Math.round(count * power * AMOUNT[this.quality]);
    switch (style) {
      case 'sparks':
        this.ring(x, y, palette[0]!, 140 * power);
        this.ring(x, y, palette[1] ?? palette[0]!, 90 * power, 0.5);
        for (let i = 0; i < n(70); i++) {
          const a = rand(0, Math.PI * 2);
          const s = rand(180, 620) * power;
          this.add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rand(0.5, 1.1), size: rand(1.2, 2.4), color: pick(palette), grav: 260, drag: 1.8 });
        }
        break;
      case 'bloom':
        this.ring(x, y, palette[0]!, 220 * power, 0.9);
        this.ring(x, y, palette[1] ?? palette[0]!, 120 * power, 0.6);
        for (let i = 0; i < n(50); i++) {
          const a = rand(0, Math.PI * 2);
          const s = rand(30, 160) * power;
          this.add({ k: 'ember', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, max: rand(0.9, 1.8), size: rand(2, 5), color: pick(palette), grav: -60, drag: 1.2 });
        }
        break;
      case 'pixels':
        for (let i = 0; i < n(56); i++) {
          this.add({ k: 'pixel', x, y, vx: rand(-260, 260) * power, vy: rand(-820, -380) * power, max: rand(0.9, 1.6), size: pick([4, 4, 6, 8]), color: pick(palette), grav: 1400, drag: 0.4 });
        }
        for (let i = 0; i < n(12); i++) {
          this.add({ k: 'coin', x, y, vx: rand(-180, 180), vy: rand(-760, -480), max: rand(1, 1.5), size: 8, color: palette[0]!, rot: 0, vr: rand(8, 16), grav: 1400, drag: 0.3 });
        }
        break;
    }
    this.start();
  }

  /** Small spray for a tool call. */
  sparks(x: number, y: number, color: string, count = 10, pixel = false): void {
    if (!this.enabled) return;
    const n = Math.max(2, Math.round(count * AMOUNT[this.quality]));
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0);
      const s = rand(60, 220);
      this.add({ k: pixel ? 'pixel' : 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rand(0.25, 0.55), size: pixel ? 3 : rand(1, 1.8), color, grav: 400, drag: 2.5 });
    }
    this.start();
  }

  ring(x: number, y: number, color: string, radius: number, max = 0.7): void {
    if (!this.enabled) return;
    this.add({ k: 'ring', x, y, vx: 0, vy: 0, max, size: radius, color, grav: 0, drag: 0 });
    this.start();
  }

  private add(p: Partial<P> & Pick<P, 'k' | 'x' | 'y' | 'max' | 'size' | 'color'>): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push({ vx: 0, vy: 0, rot: rand(0, 6.28), vr: rand(-6, 6), grav: 0, drag: 0, ...p, life: p.max });
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, DPR_CAP[this.quality]);
    this.canvas.width = Math.round(innerWidth * this.dpr);
    this.canvas.height = Math.round(innerHeight * this.dpr);
  }

  private start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.globalCompositeOperation = 'lighter';
    const alive: P[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      alive.push(p);
      const f = Math.exp(-p.drag * dt);
      p.vx *= f;
      p.vy = p.vy * f + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.life / p.max; // 1 → 0
      this.draw(g, p, k);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.list = alive;
    if (alive.length) this.raf = requestAnimationFrame((t) => this.tick(t));
    else {
      this.raf = 0;
      g.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  private draw(g: CanvasRenderingContext2D, p: P, k: number): void {
    g.globalAlpha = Math.min(1, k * 1.6);
    g.fillStyle = p.color;
    g.strokeStyle = p.color;
    switch (p.k) {
      case 'spark': {
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        g.stroke();
        break;
      }
      case 'ember': {
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'pixel':
        g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        break;
      case 'coin': {
        const w = Math.max(1, Math.abs(Math.cos(p.rot)) * p.size);
        g.fillRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w), p.size);
        break;
      }
      case 'ring': {
        const r = p.size * (1 - k * k);
        g.lineWidth = 2 + 4 * k;
        g.globalAlpha = k * 0.9;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2);
        g.stroke();
        break;
      }
    }
  }
}
