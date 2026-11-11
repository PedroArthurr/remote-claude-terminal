import type { ITheme } from '@xterm/xterm';
import type { ThemeId } from '../prefs';

export type BackdropId = 'grid' | 'phosphor' | 'starfield';
export type BurstStyle = 'sparks' | 'bloom' | 'pixels';
export type SoundPackId = 'synth' | 'ambient' | 'chip';

/** A theme is pure data: CSS variables, fonts, terminal colors, effect and sound choices. */
export interface Theme {
  id: ThemeId;
  name: string;
  tagline: string;
  /** CSS custom properties set on :root. */
  vars: Record<`--${string}`, string>;
  /** Loads web fonts the theme needs (lazy chunk). */
  loadFonts?: () => Promise<unknown>;
  /** Terminal font stack; first family is awaited before xterm measures it. */
  termFont: string;
  /** Some fonts (VT323) render small; the terminal size is multiplied by this. */
  termFontScale: number;
  xterm: ITheme;
  backdrop: BackdropId;
  burst: BurstStyle;
  sound: SoundPackId;
  /** Particle colors, most characteristic first. */
  palette: string[];
  /** CRT scanline + vignette overlay. */
  scanlines: boolean;
}
