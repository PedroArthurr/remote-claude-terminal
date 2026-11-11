// Service worker: production only. In dev (same ts.net origin when served via `tailscale serve`)
// a worker left by a production visit would get in Vite's way, so dev removes it.
export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return; // plain http over a Tailscale IP: not a secure context
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
    return;
  }
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('[sw]', e));
  });
}
