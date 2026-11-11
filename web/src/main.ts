import type { ServerMessage } from '@ccc/shared';
import { api } from './api';
import { audio } from './audio/engine';
import { Connection, type ConnState } from './connection';
import { el, icon, keepFocus, toast } from './dom';
import { Background } from './fx/background';
import { FxDirector } from './fx/director';
import { Particles } from './fx/particles';
import { prefs, type ThemeId } from './prefs';
import { applyTheme, THEMES } from './themes';
import { trackViewport } from './viewport';
import { pruneDrafts } from './views/compose';
import { Dashboard, STATE_LABEL } from './views/dashboard';
import { LoginView } from './views/login';
import { SettingsSheet } from './views/settings';
import { TerminalView } from './views/terminal-view';
import './style.css';
import './fx/fx.css';

type Route = { view: 'dash' } | { view: 'term'; id: string };
type View = 'boot' | 'login' | 'dash' | 'term';

const app = document.querySelector<HTMLDivElement>('#app')!;
// Theme variables first: the terminal and effects read the active theme when they are built.
void applyTheme(prefs.get().theme, false);

const title = el('span', { class: 'title' });
const chip = el('span', { class: 'chip' });
const size = el('span', { class: 'meta' });
const connText = el('span', {}, 'connecting');
const zoom = el(
  'span',
  { class: 'zoom' },
  keepFocus(el('button', { class: 'icon-btn', title: 'Smaller text', 'aria-label': 'Smaller text', onclick: () => terminal.zoom(-1) }, 'A−')),
  keepFocus(el('button', { class: 'icon-btn', title: 'Larger text', 'aria-label': 'Larger text', onclick: () => terminal.zoom(1) }, 'A+')),
);
const muteBtn = keepFocus(
  el('button', { class: 'icon-btn', onclick: () => prefs.set({ muted: !prefs.get().muted }) }),
);
const settingsBtn = keepFocus(
  el('button', { class: 'icon-btn', title: 'Look & sound', 'aria-label': 'Look & sound', onclick: () => settings.open() }, icon('sliders')),
);
const back = el('button', { class: 'back', 'aria-label': 'Back to sessions', onclick: () => go({ view: 'dash' }) }, '‹');

const conn = new Connection({ onMessage, onState });
const dashboard = new Dashboard((id) => go({ view: 'term', id }));
const terminal = new TerminalView(conn, (s) => (size.textContent = s));
const login = new LoginView(() => void start());
const background = new Background(document.querySelector<HTMLCanvasElement>('#fx-bg')!);
const particles = new Particles(document.querySelector<HTMLCanvasElement>('#fx-top')!);
const fx = new FxDirector({
  background,
  particles,
  view: () => app.dataset.view ?? '',
  attached: () => terminal.attached,
  card: (id) => dashboard.card(id),
  screen: terminal.screen,
  sessionName: (id) => dashboard.list.find((s) => s.id === id)?.name ?? 'session',
});
const settings = new SettingsSheet((k) => fx.preview(k));
applyFxPrefs();
dashboard.setThemeCycler(cycleTheme);
setTheme(prefs.get().theme, false);
syncMute();
prefs.on((p, changed) => {
  if (changed.includes('theme')) setTheme(p.theme, true);
  if (changed.includes('quality') || changed.includes('reduce')) applyFxPrefs();
  if (changed.includes('muted')) syncMute();
});

app.append(
  el(
    'header',
    { class: 'bar' },
    back,
    el('span', { class: 'brand', onclick: () => go({ view: 'dash' }) }, 'cc', el('b', {}, '-'), 'cockpit'),
    title,
    chip,
    el('span', { class: 'spacer' }),
    zoom,
    size,
    muteBtn,
    settingsBtn,
    el('span', { class: 'status' }, el('i', { class: 'dot' }), connText),
  ),
  el(
    'main',
    { class: 'views' },
    el('section', { class: 'view', 'data-view': 'login' }, login.root),
    el('section', { class: 'view', 'data-view': 'dash' }, dashboard.root),
    el('section', { class: 'view', 'data-view': 'term' }, terminal.root),
  ),
  settings.root,
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
    chip.textContent = '';
    size.textContent = '';
  }
}

function setView(v: View): void {
  app.dataset.view = v;
  // The terminal covers the backdrop: no point drawing it.
  background.setVisible(v !== 'term');
}

// ── theme, effects, sound ───────────────────────────────

function setTheme(id: ThemeId, user: boolean): void {
  void applyTheme(id, user).then((t) => {
    if (prefs.get().theme !== t.id) return; // switched again meanwhile
    terminal.setTheme(t); // after its fonts loaded
  });
  const t = THEMES.find((x) => x.id === id)!;
  background.setTheme(t);
  fx.setTheme(t);
  audio.setPack(t.sound);
  dashboard.setThemeName(t.name);
  if (user) audio.play('theme');
}

function cycleTheme(): void {
  const i = THEMES.findIndex((t) => t.id === prefs.get().theme);
  prefs.set({ theme: THEMES[(i + 1) % THEMES.length]!.id });
}

function applyFxPrefs(): void {
  const p = prefs.get();
  const root = document.documentElement;
  root.dataset.quality = p.quality;
  if (p.reduce) root.dataset.fx = 'reduced';
  else delete root.dataset.fx;
  background.setQuality(p.quality, p.reduce);
  particles.setQuality(p.quality, p.reduce);
}

function syncMute(): void {
  const muted = prefs.get().muted;
  muteBtn.replaceChildren(icon(muted ? 'mute' : 'sound'));
  muteBtn.title = muted ? 'Sound off' : 'Sound on';
  muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  muteBtn.classList.toggle('off', muted);
}

function updateTitle(): void {
  const s = dashboard.list.find((x) => x.id === terminal.attached);
  title.textContent = s ? s.name : '';
  chip.textContent = s ? (s.running ? STATE_LABEL[s.state] : 'exited') : '';
  chip.dataset.state = s ? (s.running ? s.state : 'exited') : '';
  document.title = s ? `${s.name} · cc-cockpit` : 'cc-cockpit';
}

// ── server messages ─────────────────────────────────────

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'sessions':
      dashboard.update(msg.sessions);
      fx.sessions(msg.sessions);
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
      fx.activity(msg.activity);
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
