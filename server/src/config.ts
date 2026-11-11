import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths';

export interface Favorite {
  name: string;
  path: string;
}

export interface Config {
  host: string;
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
}

const FORBIDDEN_HOSTS = new Set(['0.0.0.0', '::', '[::]', '']);

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
  // Never listen on all interfaces (see CLAUDE.md, item 7).
  if (typeof c.host === 'string' && FORBIDDEN_HOSTS.has(c.host.trim())) {
    errors.push(`host: "${c.host}" is forbidden; use 127.0.0.1 or the Tailscale IP`);
  }
  if (errors.length) throw new Error(`Invalid config:\n  ${errors.join('\n  ')}`);
  return c as Config;
}
