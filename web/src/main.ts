import type { ServerMessage } from '@ccc/shared';
import { api } from './api';
import { Connection, type ConnState } from './connection';
import { el, keepFocus, toast } from './dom';
import { trackViewport } from './viewport';
import { pruneDrafts } from './views/compose';
import { Dashboard } from './views/dashboard';
import { LoginView } from './views/login';
import { TerminalView } from './views/terminal-view';
import './style.css';

type Route = { view: 'dash' } | { view: 'term'; id: string };
type View = 'boot' | 'login' | 'dash' | 'term';

const app = document.querySelector<HTMLDivElement>('#app')!;
const title = el('span', { class: 'title' });
const size = el('span', { class: 'meta' });
const connText = el('span', {}, 'connecting');
const zoom = el(
  'span',
  { class: 'zoom' },
  keepFocus(el('button', { class: 'icon-btn', title: 'Smaller text', 'aria-label': 'Smaller text', onclick: () => terminal.zoom(-1) }, 'A−')),
  keepFocus(el('button', { class: 'icon-btn', title: 'Larger text', 'aria-label': 'Larger text', onclick: () => terminal.zoom(1) }, 'A+')),
);
const back = el('button', { class: 'back', 'aria-label': 'Back to sessions', onclick: () => go({ view: 'dash' }) }, '‹');

const conn = new Connection({ onMessage, onState });
const dashboard = new Dashboard((id) => go({ view: 'term', id }));
const terminal = new TerminalView(conn, (s) => (size.textContent = s));
const login = new LoginView(() => void start());

app.append(
  el(
    'header',
    { class: 'bar' },
    back,
    el('span', { class: 'brand', onclick: () => go({ view: 'dash' }) }, 'cc', el('b', {}, '-'), 'cockpit'),
    title,
    el('span', { class: 'spacer' }),
    zoom,
    size,
    el('span', { class: 'status' }, el('i', { class: 'dot' }), connText),
  ),
  el(
    'main',
    { class: 'views' },
    el('section', { class: 'view', 'data-view': 'login' }, login.root),
    el('section', { class: 'view', 'data-view': 'dash' }, dashboard.root),
    el('section', { class: 'view', 'data-view': 'term' }, terminal.root),
  ),
);
setView('boot');
trackViewport();

addEventListener('hashchange', () => route());
void boot();

async function boot(): Promise<void> {
  try {
    if ((await login.tryUrlToken()) || (await api.authStatus()).authed) return start();
  } catch {
    toast('Server unreachable', 'bad');
  }
  showLogin();
}

async function start(): Promise<void> {
  conn.connect();
  setView('dash');
  route();
  await Promise.all([
    dashboard.loadFavorites().catch(() => undefined),
    api
      .ui()
      .then((ui) => terminal.setSnippets(ui.snippets))
      .catch(() => undefined),
  ]);
}

function showLogin(): void {
  conn.stop();
  terminal.detach();
  setView('login');
  login.focus();
}

// ── routing: #/ = dashboard, #/s/<id> = terminal ────────

function parseRoute(): Route {
  const m = /^#\/s\/([\w-]+)$/.exec(location.hash);
  return m ? { view: 'term', id: m[1]! } : { view: 'dash' };
}

// True while the current terminal entry was pushed on top of the dashboard entry.
let pushed = false;

function go(r: Route): void {
  const hash = r.view === 'term' ? `#/s/${r.id}` : '#/';
  if (location.hash === hash) return route();
  const from = parseRoute().view;
  // Opening a session pushes history so Android "back" returns to the dashboard; closing pops it.
  if (r.view === 'term' && from === 'dash') {
    pushed = true;
    location.hash = hash;
    return;
  }
  if (r.view === 'dash' && pushed) {
    pushed = false;
    history.back();
    return;
  }
  history.replaceState(null, '', hash);
  route();
}

function route(): void {
  if (app.dataset.view === 'login') return;
  const r = parseRoute();
  if (r.view === 'term') {
    terminal.attach(r.id);
    setView('term');
    updateTitle();
  } else {
    pushed = false;
    terminal.detach();
    setView('dash');
    title.textContent = '';
    size.textContent = '';
  }
}

function setView(v: View): void {
  app.dataset.view = v;
}

function updateTitle(): void {
  const s = dashboard.list.find((x) => x.id === terminal.attached);
  title.textContent = s ? s.name : '';
  document.title = s ? `${s.name} · cc-cockpit` : 'cc-cockpit';
}

// ── server messages ─────────────────────────────────────

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'sessions':
      dashboard.update(msg.sessions);
      pruneDrafts(new Set(msg.sessions.map((s) => s.id)));
      updateTitle();
      break;
    case 'closed':
      if (msg.sessionId === terminal.attached) {
        toast('Session closed');
        terminal.detach();
        go({ view: 'dash' });
      }
      break;
    case 'activity':
      dashboard.activity(msg.activity);
      break;
    case 'pong':
      break;
    default:
      terminal.handle(msg);
  }
}

let authCheck: Promise<void> | null = null;

function onState(state: ConnState): void {
  app.dataset.conn = state;
  connText.textContent = state;
  if (state === 'online') terminal.reattach();
  // A socket that keeps failing may mean the cookie is gone (token rotated).
  if (state === 'offline' && app.dataset.view !== 'login' && !authCheck) {
    authCheck = api
      .authStatus()
      .then((s) => {
        if (!s.authed) showLogin();
      })
      .catch(() => undefined)
      .finally(() => (authCheck = null));
  }
}
