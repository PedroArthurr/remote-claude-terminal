import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Both src/*.ts (dev) and dist/index.js (prod) sit two levels below the repo root.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB_DIST = path.join(REPO_ROOT, 'web', 'dist');
