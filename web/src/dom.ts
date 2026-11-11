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
