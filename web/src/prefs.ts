// Per-device preferences (theme, sound, effects), kept in localStorage.

export type ThemeId = 'neon' | 'crt' | 'pixel';
export type Quality = 'low' | 'medium' | 'high';

export interface Prefs {
  theme: ThemeId;
  muted: boolean;
  /** 0..1 */
  volume: number;
  quality: Quality;
  /** No animated background, particles, glitch or sweeps. State colors and sounds stay. */
  reduce: boolean;
  haptics: boolean;
}

const KEY = 'ccc.prefs';
const COARSE = matchMedia('(pointer: coarse)').matches;

const DEFAULTS: Prefs = {
  theme: 'neon',
  muted: false,
  volume: 0.7,
  quality: COARSE ? 'medium' : 'high',
  reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  haptics: true,
};

const THEMES: ThemeId[] = ['neon', 'crt', 'pixel'];
const QUALITIES: Quality[] = ['low', 'medium', 'high'];

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      theme: THEMES.includes(raw.theme!) ? raw.theme! : DEFAULTS.theme,
      muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULTS.muted,
      volume: typeof raw.volume === 'number' ? Math.min(1, Math.max(0, raw.volume)) : DEFAULTS.volume,
      quality: QUALITIES.includes(raw.quality!) ? raw.quality! : DEFAULTS.quality,
      reduce: typeof raw.reduce === 'boolean' ? raw.reduce : DEFAULTS.reduce,
      haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULTS.haptics,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set<(p: Prefs, changed: (keyof Prefs)[]) => void>();

export const prefs = {
  get(): Readonly<Prefs> {
    return current;
  },
  set(patch: Partial<Prefs>): void {
    const changed = (Object.keys(patch) as (keyof Prefs)[]).filter((k) => patch[k] !== current[k]);
    if (!changed.length) return;
    current = { ...current, ...patch };
    localStorage.setItem(KEY, JSON.stringify(current));
    for (const fn of listeners) fn(current, changed);
  },
  on(fn: (p: Prefs, changed: (keyof Prefs)[]) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
