import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Favorite } from '@ccc/shared';
import { findTailscaleIp, isLoopback, isTailscaleIp } from './net';
import { REPO_ROOT } from './paths';

export interface Config {
  /** 127.0.0.1 (behind `tailscale serve`), a Tailscale IP, or "tailscale" to auto-detect it. */
  host: string;
  /** Extra Host-header names to accept (e.g. a custom DNS name). Loopback and *.ts.net are built in. */
  allowedHosts: string[];
  port: number;
  webDevPort: number;
  shell: string;
  shellArgs: string[];
  startupCommand: string;
  defaultCwd: string;
  favorites: Favorite[];
  token: string;
  hookSecret: string;
  dataDir: string;
  /** Lines kept by each session's virtual terminal (and sent in snapshots). */
  scrollback: number;
  /** Compose-mode quick messages. */
  snippets: string[];
}

const DEFAULT_SCROLLBACK = 5000;
const DEFAULT_SNIPPETS = ['/clear', '/compact', 'continue'];
const MAX_SNIPPET_LENGTH = 4000;
const MIN_SECRET_LENGTH = 32;

export function configPath(): string {
  return process.env.CCC_CONFIG ?? path.join(REPO_ROOT, 'config.json');
}

export function loadConfig(): Config {
  const file = configPath();
  if (!existsSync(file)) {
    throw new Error(`Config not found: ${file}\nCopy config.example.json to config.json and edit it.`);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
  const cfg = validate(raw);
  // Relative paths in config are relative to the config file.
  cfg.dataDir = path.resolve(path.dirname(file), cfg.dataDir);
  if (cfg.host === 'tailscale') {
    const ip = findTailscaleIp();
    if (!ip) throw new Error('host: "tailscale" but no Tailscale IP found. Is Tailscale running?');
    cfg.host = ip;
  }
  if (cfg.favorites.length === 0) cfg.favorites = [{ name: path.basename(cfg.defaultCwd) || 'home', path: cfg.defaultCwd }];
  for (const f of cfg.favorites) {
    if (!existsSync(f.path)) console.warn(`[config] favorite "${f.name}": folder not found: ${f.path}`);
  }
  return cfg;
}

function validate(c: Partial<Config>): Config {
  const errors: string[] = [];
  const str = (k: keyof Config) => typeof c[k] === 'string' || errors.push(`${k}: expected string`);
  const num = (k: keyof Config) => Number.isInteger(c[k]) || errors.push(`${k}: expected integer`);

  str('host');
  num('port');
  num('webDevPort');
  str('shell');
  str('startupCommand');
  str('defaultCwd');
  str('token');
  str('hookSecret');
  str('dataDir');
  if (!Array.isArray(c.shellArgs) || !c.shellArgs.every((a) => typeof a === 'string')) {
    errors.push('shellArgs: expected string[]');
  }
  if (
    !Array.isArray(c.favorites) ||
    !c.favorites.every((f) => typeof f?.name === 'string' && typeof f?.path === 'string')
  ) {
    errors.push('favorites: expected {name, path}[]');
  }
  // Only loopback or Tailscale; never 0.0.0.0 or a LAN address (CLAUDE.md, item 7).
  if (typeof c.host === 'string' && c.host !== 'tailscale' && !isLoopback(c.host) && !isTailscaleIp(c.host)) {
    errors.push(`host: "${c.host}" is not allowed; use 127.0.0.1, a Tailscale IP (100.x) or "tailscale"`);
  }
  if (c.allowedHosts === undefined) c.allowedHosts = [];
  else if (!Array.isArray(c.allowedHosts) || !c.allowedHosts.every((h) => typeof h === 'string')) {
    errors.push('allowedHosts: expected string[]');
  }
  for (const k of ['token', 'hookSecret'] as const) {
    const v = c[k];
    if (typeof v === 'string' && (v.length < MIN_SECRET_LENGTH || v.startsWith('replace-with'))) {
      errors.push(`${k}: use a random value of at least ${MIN_SECRET_LENGTH} chars`);
    }
  }
  if (c.scrollback === undefined) c.scrollback = DEFAULT_SCROLLBACK;
  else if (!Number.isInteger(c.scrollback) || c.scrollback < 0) errors.push('scrollback: expected integer >= 0');
  if (c.snippets === undefined) c.snippets = DEFAULT_SNIPPETS;
  else if (
    !Array.isArray(c.snippets) ||
    !c.snippets.every((t) => typeof t === 'string' && t.trim() !== '' && t.length <= MAX_SNIPPET_LENGTH)
  ) {
    errors.push(`snippets: expected non-empty strings (max ${MAX_SNIPPET_LENGTH} chars)`);
  }
  if (typeof c.defaultCwd === 'string' && !existsSync(c.defaultCwd)) {
    errors.push(`defaultCwd: folder not found: ${c.defaultCwd}`);
  }
  if (errors.length) throw new Error(`Invalid config:\n  ${errors.join('\n  ')}`);
  return c as Config;
}
