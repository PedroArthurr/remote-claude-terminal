// Bundles the hook into a single dependency-free file Claude Code can run with `node`.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cc-hook.ts'],
  outfile: 'dist/cc-hook.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'info',
});
