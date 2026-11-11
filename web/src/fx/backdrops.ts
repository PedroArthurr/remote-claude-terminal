import type { BackdropId, Theme } from '../themes/types';

/** Smoothed 0..1 signals the backdrop reacts to. */
export interface Mood {
  /** Some session is working. */
  energy: number;
  /** Some session waits for a permission. */
  alert: number;
  /** Short spike on prompts / completions. */
  pulse: number;
}

export interface Colors {
  bg: string;
  fg: string;
  accent: string;
  info: string;
  warn: string;
  done: string;
  palette: string[];
}

export interface Backdrop {
  /** Canvas pixels per CSS pixel, overriding device pixel ratio (pixel art draws small, then upscales). */
  fixedScale?: number;
  resize(w: number, h: number): void;
  /** `t` and `dt` in seconds. */
  draw(g: CanvasRenderingContext2D, t: number, dt: number, mood: Mood): void;
  /** One-shot flourish (shooting star, flash...). */
  flourish?(): void;
}

export function themeColors(theme: Theme): Colors {
  const v = theme.vars;
  return {
    bg: v['--bg'] ?? '#000',
    fg: v['--fg'] ?? '#fff',
    accent: v['--accent'] ?? '#0ff',
    info: v['--info'] ?? '#f0f',
    warn: v['--warn'] ?? '#ff0',
    done: v['--done'] ?? '#0f0',
    palette: theme.palette,
  };
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Deterministic PRNG so layouts are stable across resizes. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Neon: synthwave sun + scrolling perspective grid ─────

function grid(c: Colors): Backdrop {
  let w = 0;
  let h = 0;
  let scroll = 0;
  let motes: { x: number; y: number; v: number; c: string; s: number }[] = [];
  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
      const r = rng(7);
      motes = Array.from({ length: 26 }, () => ({
        x: r() * w,
        y: r() * h,
        v: 6 + r() * 18,
        c: c.palette[Math.floor(r() * c.palette.length)]!,
        s: 0.6 + r() * 1.6,
      }));
    },
    draw(g, t, dt, m) {
      const u = Math.min(w, h) / 600; // 1 at a typical phone height
      const horizon = h * 0.62;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = c.bg;
      g.fillRect(0, 0, w, h);

      // Sky glow over the horizon.
      const sky = g.createLinearGradient(0, horizon - h * 0.45, 0, horizon);
      sky.addColorStop(0, rgba(c.bg, 0));
      sky.addColorStop(1, rgba(m.alert > 0.5 ? c.warn : c.info, 0.1 + m.pulse * 0.15 + m.energy * 0.05));
      g.fillStyle = sky;
      g.fillRect(0, 0, w, horizon);

      // Striped sun.
      const cx = w / 2;
      const sr = Math.min(w * 0.22, h * 0.2);
      const sun = g.createLinearGradient(0, horizon - sr, 0, horizon);
      sun.addColorStop(0, rgba(c.warn, 0.32 + m.pulse * 0.2));
      sun.addColorStop(1, rgba(c.info, 0.28 + m.pulse * 0.2));
      g.save();
      g.beginPath();
      g.arc(cx, horizon, sr, Math.PI, 0);
      g.clip();
      g.fillStyle = sun;
      g.fillRect(cx - sr, horizon - sr, sr * 2, sr);
      g.fillStyle = c.bg;
      for (let i = 0; i < 6; i++) {
        const y = horizon - sr * 0.08 - i * sr * 0.13 + ((t * 6 * u) % (sr * 0.13));
        g.fillRect(cx - sr, y, sr * 2, Math.max(1, sr * 0.035 * (6 - i) * 0.35));
      }
      g.restore();

      // Floor.
      g.fillStyle = rgba(c.bg, 1);
      g.fillRect(0, horizon, w, h - horizon);
      scroll = (scroll + dt * (0.12 + m.energy * 0.9)) % 1;
      g.globalCompositeOperation = 'lighter';
      const line = m.alert > 0.5 ? c.warn : c.accent;
      const rows = 14;
      g.lineWidth = Math.max(1, u);
      for (let i = 0; i < rows; i++) {
        const p = (i + scroll) / rows;
        const y = horizon + (h - horizon) * p * p;
        g.strokeStyle = rgba(line, 0.08 + p * 0.32);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      const cols = 22;
      for (let k = -cols; k <= cols; k++) {
        const xb = cx + (k / cols) * w * 1.6;
        g.strokeStyle = rgba(line, 0.16);
        g.beginPath();
        g.moveTo(cx + (k / cols) * w * 0.06, horizon);
        g.lineTo(xb, h);
        g.stroke();
      }
      // Horizon line.
      g.strokeStyle = rgba(line, 0.5 + m.pulse * 0.4);
      g.lineWidth = Math.max(1, 2 * u);
      g.beginPath();
      g.moveTo(0, horizon);
      g.lineTo(w, horizon);
      g.stroke();

      // Drifting motes.
      for (const d of motes) {
        d.y -= d.v * dt * (1 + m.energy * 2) * u;
        if (d.y < 0) d.y = h;
        g.fillStyle = rgba(d.c, 0.35 + 0.25 * Math.sin(t * 2 + d.x));
        g.fillRect(d.x, d.y, d.s * u * 2, d.s * u * 2);
      }
      g.globalCompositeOperation = 'source-over';
    },
  };
}

// ── CRT: rolling refresh band, oscilloscope trace, phosphor specks ──

function phosphor(c: Colors): Backdrop {
  let w = 0;
  let h = 0;
  let flash = 0;
  let amp = 0;
  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    flourish() {
      flash = 1;
    },
    draw(g, t, dt, m) {
      const u = Math.min(w, h) / 600;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = c.bg;
      g.fillRect(0, 0, w, h);
      const tint = m.alert > 0.5 ? c.warn : c.accent;

      // Tube glow.
      const glow = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      glow.addColorStop(0, rgba(tint, 0.07 + m.pulse * 0.08 + flash * 0.12));
      glow.addColorStop(1, rgba(c.bg, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);

      // Rolling band.
      const period = 9 - m.energy * 5;
      const by = ((t / period) % 1) * (h * 1.4) - h * 0.2;
      const band = g.createLinearGradient(0, by - h * 0.12, 0, by + h * 0.12);
      band.addColorStop(0, rgba(tint, 0));
      band.addColorStop(0.5, rgba(tint, 0.05 + m.energy * 0.03));
      band.addColorStop(1, rgba(tint, 0));
      g.fillStyle = band;
      g.fillRect(0, by - h * 0.12, w, h * 0.24);

      // Oscilloscope trace: calm when idle, busy while working.
      amp += ((0.015 + m.energy * 0.09 + m.pulse * 0.06) * h - amp) * Math.min(1, dt * 3);
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = rgba(tint, 0.3);
      g.lineWidth = Math.max(1, 1.6 * u);
      g.beginPath();
      const mid = h * 0.7;
      for (let x = 0; x <= w; x += Math.max(3, 4 * u)) {
        const k = x / w;
        const y =
          mid +
          Math.sin(k * 14 + t * 3.1) * amp * 0.6 +
          Math.sin(k * 37 - t * 5.3) * amp * 0.25 * (0.3 + m.energy) +
          Math.sin(k * 3 + t * 0.7) * amp * 0.4;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();

      // Specks.
      const n = 40 + Math.round(m.energy * 60);
      g.fillStyle = rgba(tint, 0.18);
      for (let i = 0; i < n; i++) {
        g.fillRect(Math.random() * w, Math.random() * h, 1.5 * u + 0.5, 1.5 * u + 0.5);
      }
      g.globalCompositeOperation = 'source-over';
      flash = Math.max(0, flash - dt * 2.5);
    },
  };
}

// ── Pixel: banded night sky, twinkling stars, parallax mountains, moon ──

function starfield(c: Colors): Backdrop {
  const SKY = ['#0e0c22', '#13112a', '#181536', '#1e1a42', '#251f4e', '#2d2559'];
  let w = 0;
  let h = 0;
  let stars: { x: number; y: number; p: number; b: number }[] = [];
  let ridges: number[][] = [];
  let shoot: { x: number; y: number; life: number } | null = null;
  let travel = 0;
  return {
    fixedScale: 0.25,
    resize(nw, nh) {
      w = nw;
      h = nh;
      const r = rng(42);
      stars = Array.from({ length: Math.round((w * h) / 90) }, () => ({ x: r() * w, y: r() * h * 0.75, p: r() * 6.28, b: r() }));
      // Two ridge lines (far, near), one height per pixel column, tiled horizontally.
      ridges = [0.55, 0.72].map((base, li) => {
        const len = Math.max(64, w * 2);
        const pts: number[] = [];
        let y = h * base;
        for (let x = 0; x < len; x++) {
          y += (r() - 0.5) * (li ? 2.2 : 1.4);
          y = Math.min(h * (base + 0.12), Math.max(h * (base - 0.1), y));
          pts.push(Math.round(y));
        }
        return pts;
      });
    },
    flourish() {
      shoot = { x: w * (0.3 + Math.random() * 0.6), y: h * Math.random() * 0.25, life: 1 };
    },
    draw(g, t, dt, m) {
      const band = Math.ceil(h / SKY.length);
      SKY.forEach((col, i) => {
        g.fillStyle = col;
        g.fillRect(0, i * band, w, band);
      });
      if (m.alert > 0.5) {
        g.fillStyle = rgba(c.warn, 0.08 + 0.05 * Math.sin(t * 6));
        g.fillRect(0, 0, w, band * 2);
      }
      travel += dt * (2 + m.energy * 14);

      for (const s of stars) {
        const tw = Math.sin(t * (1.5 + s.b * 2) + s.p);
        if (tw < -0.6) continue;
        g.fillStyle = s.b > 0.85 ? c.done : tw > 0.7 ? '#ffffff' : '#9a90c6';
        const x = Math.round((((s.x - travel * (0.1 + s.b * 0.2)) % w) + w) % w);
        g.fillRect(x, Math.round(s.y), 1, 1);
      }

      // Moon.
      const mx = Math.round(w * 0.8);
      const my = Math.round(h * 0.16);
      const mr = Math.max(3, Math.round(Math.min(w, h) * 0.06));
      g.fillStyle = '#f6eedb';
      for (let dy = -mr; dy <= mr; dy++) {
        const half = Math.round(Math.sqrt(mr * mr - dy * dy));
        g.fillRect(mx - half, my + dy, half * 2, 1);
      }
      g.fillStyle = '#d8ccb0';
      g.fillRect(mx - Math.round(mr / 3), my - Math.round(mr / 4), Math.max(1, Math.round(mr / 3)), Math.max(1, Math.round(mr / 3)));

      // Shooting star.
      if (shoot) {
        shoot.x -= dt * w * 0.9;
        shoot.y += dt * h * 0.35;
        shoot.life -= dt * 1.4;
        for (let i = 0; i < 6; i++) {
          g.fillStyle = i === 0 ? '#ffffff' : rgba(c.accent, 1 - i / 6);
          g.fillRect(Math.round(shoot.x + i * 2), Math.round(shoot.y - i), 1, 1);
        }
        if (shoot.life <= 0) shoot = null;
      }

      // Mountains (far, near), drifting at parallax speeds.
      const fills = ['#211c45', '#17142f'];
      ridges.forEach((pts, li) => {
        g.fillStyle = fills[li]!;
        const off = Math.floor(travel * (li ? 0.6 : 0.25));
        for (let x = 0; x < w; x++) {
          const y = pts[(x + off) % pts.length]!;
          g.fillRect(x, y, 1, h - y);
        }
      });
    },
  };
}

const FACTORIES: Record<BackdropId, (c: Colors) => Backdrop> = { grid, phosphor, starfield };

export function createBackdrop(theme: Theme): Backdrop {
  return FACTORIES[theme.backdrop](themeColors(theme));
}
