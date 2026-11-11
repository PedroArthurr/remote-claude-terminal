import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TermSize } from '@ccc/shared';
import '@xterm/xterm/css/xterm.css';

// Default look until themes land (Marco 5).
const THEME: ITheme = {
  background: '#0b0d12',
  foreground: '#d7dce6',
  cursor: '#5cf2c8',
  cursorAccent: '#0b0d12',
  selectionBackground: '#5cf2c840',
  scrollbarSliderBackground: '#ffffff14',
  scrollbarSliderHoverBackground: '#ffffff26',
  scrollbarSliderActiveBackground: '#5cf2c840',
  black: '#1b1f2a',
  red: '#ff5c7a',
  green: '#5cf2a0',
  yellow: '#ffc857',
  blue: '#6aa8ff',
  magenta: '#c792ea',
  cyan: '#5ce1f2',
  white: '#d7dce6',
  brightBlack: '#4a5266',
  brightRed: '#ff8099',
  brightGreen: '#8af7c0',
  brightYellow: '#ffd98a',
  brightBlue: '#94c0ff',
  brightMagenta: '#dab3f5',
  brightCyan: '#8aeaf7',
  brightWhite: '#ffffff',
};

export interface TermView {
  term: Terminal;
  /** Size that would fill the container, or null if it is not laid out. */
  preferredSize(): TermSize | null;
  /** Redraw everything (after being hidden, or a new snapshot). */
  repaint(): void;
}

// Mobile GPUs drop or stall the WebGL context while the view is hidden, leaving a blank terminal.
// The DOM renderer is plenty for a phone screen.
const USE_WEBGL = matchMedia('(pointer: fine)').matches;

export function createTerminal(host: HTMLElement): TermView {
  const term = new Terminal({
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, ui-monospace, monospace",
    fontSize: 14,
    cursorBlink: true,
    scrollback: 10_000, // >= server scrollback, so snapshots fit
    allowProposedApi: true,
    theme: THEME,
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
