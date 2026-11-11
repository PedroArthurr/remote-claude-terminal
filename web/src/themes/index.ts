import type { ThemeId } from '../prefs';
import { crt } from './crt';
import { neon } from './neon';
import { pixel } from './pixel';
import type { Theme } from './types';

export type { Theme } from './types';

export const THEMES: readonly Theme[] = [neon, crt, pixel];

// index.html applies these before first paint (no flash of the default theme).
const PAINT_KEY = 'ccc.themePaint';
const SWITCH_MS = 450;

let active: Theme = neon;
let switchTimer = 0;

export function themeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? neon;
}

export function currentTheme(): Theme {
  return active;
}

/** Applies CSS variables now; resolves once the theme's fonts are usable. */
export async function applyTheme(id: ThemeId, animate = true): Promise<Theme> {
  const theme = themeById(id);
  active = theme;
  const root = document.documentElement;
  if (animate) {
    // Cross-fade colors only during the switch; permanent transitions on everything would cost.
    root.classList.add('theme-switch');
    clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => root.classList.remove('theme-switch'), SWITCH_MS);
  }
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.dataset.theme = theme.id;
  root.toggleAttribute('data-scanlines', theme.scanlines);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['--bg'] ?? '#000');
  try {
    localStorage.setItem(PAINT_KEY, JSON.stringify({ id: theme.id, vars: theme.vars, scanlines: theme.scanlines }));
  } catch {
    // Storage full or blocked: only costs a flash on next load.
  }
  await theme.loadFonts?.().catch(() => undefined);
  const family = /'([^']+)'/.exec(theme.termFont)?.[1];
  if (family) await document.fonts.load(`16px "${family}"`).catch(() => undefined);
  return theme;
}
