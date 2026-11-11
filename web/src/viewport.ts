// The on-screen keyboard shrinks the visual viewport. Chrome with `interactive-widget=resizes-content`
// also shrinks the layout; other browsers only scroll it. Following the visual viewport covers both:
// #app is sized and placed from --vvh/--vvt, so the key bar always sits right above the keyboard.

const KEYBOARD_MIN_PX = 120;

let keyboardOpen = false;

export function isKeyboardOpen(): boolean {
  return keyboardOpen;
}

/** Fires `ccc:keyboard` (detail: boolean) on window when the on-screen keyboard shows or hides. */
export function trackViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let full = 0;
  let width = 0;

  const update = () => {
    if (vv.scale > 1.01) return; // pinch-zoomed: leave the layout alone
    // New width = rotation or split screen: the old full height no longer applies.
    if (Math.abs(vv.width - width) > 1) {
      width = vv.width;
      full = 0;
    }
    full = Math.max(full, vv.height);
    root.style.setProperty('--vvh', `${vv.height}px`);
    root.style.setProperty('--vvt', `${vv.offsetTop}px`);
    const open = full - vv.height > KEYBOARD_MIN_PX;
    if (open === keyboardOpen) return;
    keyboardOpen = open;
    root.dataset.kb = open ? 'open' : '';
    window.dispatchEvent(new CustomEvent<boolean>('ccc:keyboard', { detail: open }));
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
