type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny element builder. Strings become text nodes (never HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') node.className = String(v);
    else if (k.startsWith('data-')) node.setAttribute(k, String(v));
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

/** Tapping `node` must not move focus (that would close the on-screen keyboard). */
export function keepFocus<T extends HTMLElement>(node: T): T {
  node.addEventListener('mousedown', (e) => e.preventDefault());
  return node;
}

/** Short haptic tick where supported (Android). */
export function buzz(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Blocked without user activation; harmless.
  }
}

export function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `${Math.floor(h / 24)}d`;
}

/** Last path segment(s) for compact display. */
export function shortPath(p: string, segments = 2): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length <= segments ? p : `…/${parts.slice(-segments).join('/')}`;
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'bad' = 'info'): void {
  let t = document.querySelector<HTMLDivElement>('.toast');
  if (!t) {
    t = el('div', { class: 'toast', role: 'status' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2800);
}

const ICONS = {
  sound:
    '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor"/><path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  sliders:
    '<path d="M4 7h9m4 0h3M4 12h3m4 0h9M4 17h11m4 0h1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
} as const;

/** Inline SVG icon (static markup only). */
export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  svg.innerHTML = ICONS[name];
  return svg;
}
