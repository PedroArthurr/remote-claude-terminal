import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

// File log, on when CCC_LOG_FILE is set (the Windows service sets it). Console output stays as is.
// One rotation: server.log → server.log.1 past MAX_BYTES.
const MAX_BYTES = 5 * 1024 * 1024;
const CHECK_EVERY = 200;

const file = process.env.CCC_LOG_FILE;
if (file) setup(path.resolve(file));

function setup(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  let writes = 0;

  const rotate = () => {
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      // No file yet.
    }
  };

  const write = (level: string, args: unknown[]) => {
    if (++writes % CHECK_EVERY === 0) rotate();
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`);
    } catch {
      // A full disk must not crash the server.
    }
  };

  rotate();
  for (const [method, level] of [
    ['log', 'INFO '],
    ['info', 'INFO '],
    ['warn', 'WARN '],
    ['error', 'ERROR'],
  ] as const) {
    const orig = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      orig(...args);
      write(level, args);
    };
  }

  write('INFO ', [`[server] start pid ${process.pid}, node ${process.version}`]);
  process.on('uncaughtException', (e) => {
    write('FATAL', [e]);
    process.exit(1); // the supervisor restarts us
  });
  process.on('unhandledRejection', (e) => {
    write('FATAL', ['[unhandledRejection]', e]);
    process.exit(1); // same as Node's default, but logged
  });
  process.on('exit', (code) => write('INFO ', [`[server] exit ${code}`]));
}
