import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage } from 'node:http';

// Tailscale assigns 100.64.0.0/10 (CGNAT) and fd7a:115c:a1e0::/48.
export function isTailscaleIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 100 && b >= 64 && b <= 127;
  }
  return isIP(ip) === 6 && /^fd7a:115c:a1e0:/i.test(ip);
}

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** The machine's Tailscale IPv4, or null if Tailscale is down. */
export function findTailscaleIp(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && isTailscaleIp(a.address)) return a.address;
    }
  }
  return null;
}

/**
 * Host-header allowlist (DNS rebinding) shared by HTTP and WebSocket.
 * `*.ts.net` covers MagicDNS names behind `tailscale serve`.
 */
export function createHostCheck(bindHost: string, extra: string[]): (hostname: string) => boolean {
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', bindHost, ...extra].map((h) => h.toLowerCase()));
  return (hostname) => {
    const h = hostname.toLowerCase();
    return allowed.has(h) || h.endsWith('.ts.net');
  };
}

export function hostnameOf(value: string | undefined, withScheme = false): string | null {
  if (!value) return null;
  try {
    return new URL(withScheme ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function requestHostname(req: IncomingMessage): string | null {
  return hostnameOf(req.headers.host);
}
