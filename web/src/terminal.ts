import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TermSize } from '@ccc/shared';
import '@xterm/xterm/css/xterm.css';

export interface TermView {
  term: Terminal;
  /** Size that would fill the container, or null if it is not laid out. */
  preferredSize(): TermSize | null;
  /** Redraw everything (after being hidden, or a new snapshot). */
  repaint(): void;
  setFontSize(px: number): void;
  /** Colors and font (theme switch). */
  setAppearance(theme: ITheme, fontFamily: string): void;
}

const COARSE = matchMedia('(pointer: coarse)').matches;
// Phones: small enough for ~55 columns on a 400px-wide screen, Claude Code's layout needs width.
export const DEFAULT_FONT_SIZE = COARSE ? 12 : 14;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 24;

// Mobile GPUs drop or stall the WebGL context while the view is hidden, leaving a blank terminal.
// The DOM renderer is plenty for a phone screen.
const USE_WEBGL = matchMedia('(pointer: fine)').matches;

export function createTerminal(host: HTMLElement, fontSize: number, theme: ITheme, fontFamily: string): TermView {
  const term = new Terminal({
    fontFamily,
    fontSize,
    cursorBlink: true,
    scrollback: 10_000, // >= server scrollback, so snapshots fit
    allowProposedApi: true,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  muteQueryReplies(term);
  term.open(host);
  const webgl = USE_WEBGL ? loadWebgl(term) : null;

  return {
    term,
    preferredSize() {
      const d = fit.proposeDimensions();
      if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) return null;
      return { cols: Math.max(2, d.cols), rows: Math.max(2, d.rows) };
    },
    repaint() {
      try {
        webgl?.clearTextureAtlas();
      } catch {
        // Disposed after a context loss.
      }
      term.refresh(0, term.rows - 1);
    },
    setFontSize(px) {
      term.options.fontSize = px;
    },
    setAppearance(t, family) {
      term.options.theme = t;
      term.options.fontFamily = family;
      this.repaint();
    },
  };
}

function loadWebgl(term: Terminal): WebglAddon | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose(); // falls back to the DOM renderer
      term.refresh(0, term.rows - 1);
    });
    term.loadAddon(webgl);
    return webgl;
  } catch {
    return null; // No WebGL2: DOM renderer.
  }
}

// The server's headless terminal answers device queries. Swallow them here so the PTY gets exactly
// one reply no matter how many browsers are attached. (OSC color queries stay: only we know the theme.)
function muteQueryReplies(term: Terminal): void {
  const p = term.parser;
  const swallow = () => true;
  p.registerCsiHandler({ final: 'c' }, swallow); // DA1
  p.registerCsiHandler({ prefix: '>', final: 'c' }, swallow); // DA2
  p.registerCsiHandler({ prefix: '=', final: 'c' }, swallow); // DA3
  p.registerCsiHandler({ final: 'n' }, swallow); // DSR / CPR
  p.registerCsiHandler({ prefix: '?', final: 'n' }, swallow); // DECDSR
  p.registerCsiHandler({ intermediates: '$', final: 'p' }, swallow); // DECRQM (ANSI)
  p.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, swallow); // DECRQM (DEC)
  p.registerCsiHandler({ prefix: '>', final: 'q' }, swallow); // XTVERSION
  p.registerDcsHandler({ intermediates: '$', final: 'q' }, swallow); // DECRQSS
}
