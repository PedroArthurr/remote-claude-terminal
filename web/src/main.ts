import type { ServerMessage, TermSize } from '@ccc/shared';
import { Connection, type ConnState } from './connection';
import { createTerminal } from './terminal';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="bar">
    <span class="brand">cc<b>-</b>cockpit</span>
    <span class="spacer"></span>
    <span class="meta" data-ref="size"></span>
    <span class="status"><i class="dot"></i><span data-ref="conn">connecting</span></span>
  </header>
  <main class="stage">
    <div class="term" data-ref="term"></div>
    <div class="overlay" data-ref="overlay">
      <div class="card">
        <div class="card-title">Process exited</div>
        <div class="card-sub" data-ref="exit"></div>
        <button class="btn" data-ref="restart">Restart <kbd>Enter</kbd></button>
      </div>
    </div>
  </main>
`;
const ref = <T extends HTMLElement = HTMLElement>(name: string) => app.querySelector<T>(`[data-ref="${name}"]`)!;

const { term, preferredSize } = createTerminal(ref('term'));
let running = true;
let lastSent: TermSize | null = null;

const conn = new Connection({ onMessage, onState });
conn.connect();

term.onData((data) => {
  if (!running) {
    if (data === '\r') restart();
    return;
  }
  conn.send({ type: 'input', data });
});
term.onResize(({ cols, rows }) => (ref('size').textContent = `${cols}×${rows}`));
ref('restart').addEventListener('click', restart);
ref('term').addEventListener('pointerdown', () => term.focus());
term.focus();

// Ask the server for the size that fills the container. The PTY size is the server's call.
function syncSize(force = false): void {
  const s = preferredSize();
  if (!s) return;
  if (!force && lastSent && s.cols === lastSent.cols && s.rows === lastSent.rows) return;
  if (conn.send({ type: 'resize', ...s })) lastSent = s;
}

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => syncSize(), 80);
}).observe(ref('term'));

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'snapshot':
      // Reset, resize and paint in one parse pass: no blank frame on reconnect.
      term.write('\x1bc', () => term.resize(msg.cols, msg.rows));
      term.write(msg.data, () => syncSize(true));
      setRunning(msg.running, null);
      break;
    case 'output':
      term.write(msg.data);
      break;
    case 'resize':
      // After pending output, which was produced at the old size.
      term.write('', () => term.resize(msg.cols, msg.rows));
      break;
    case 'process':
      setRunning(msg.running, msg.exitCode);
      break;
    case 'pong':
      break;
  }
}

function onState(state: ConnState): void {
  app.dataset.conn = state;
  ref('conn').textContent = state;
  if (state !== 'online') lastSent = null;
}

function setRunning(value: boolean, exitCode: number | null): void {
  running = value;
  ref('overlay').classList.toggle('show', !value);
  ref('exit').textContent = exitCode === null ? '' : `exit code ${exitCode}`;
  if (value) term.focus();
}

function restart(): void {
  conn.send({ type: 'restart' });
}
