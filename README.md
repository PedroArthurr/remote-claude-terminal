# cc-cockpit

Personal web panel to drive Claude Code sessions running on a Windows PC from an Android phone, over Tailscale. Installable as an app (PWA), runs in the background with the PC, and brings the sessions back after a reboot.

## Install (PC)

Needs Windows, Node.js ≥ 22.12, Git, PowerShell 7 (`pwsh`, the default shell of sessions), Claude Code (`claude` in `PATH`) and Tailscale.

```powershell
git clone <repo> cc-cockpit; cd cc-cockpit
npm install
copy config.example.json config.json   # then edit it (see below)
npm run build
```

Generate the two secrets (`token`, `hookSecret`) with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then: [hooks](#claude-code-hooks-session-states) (session states), [Tailscale](#phone-access-with-tailscale), [service](#run-as-a-service-starts-with-windows), [phone app](#install-on-the-phone-pwa).

### `config.json`

| key | meaning |
|---|---|
| `host` | `127.0.0.1` (recommended, behind `tailscale serve`), a Tailscale IP (`100.x.y.z`) or `"tailscale"` to auto-detect it. Anything else is refused. |
| `allowedHosts` | Extra `Host` names to accept. Loopback and `*.ts.net` are built in. |
| `port` | Server port (default 7420). |
| `hookPort` | Loopback-only port of the hook endpoint (default `port + 1`). |
| `webDevPort` | Vite dev server port (default 5173). |
| `shell`, `shellArgs` | Shell of each session (`pwsh.exe`, `["-NoLogo"]`). |
| `startupCommand` | Typed into each new shell (default `claude`). Empty = plain shell. |
| `defaultCwd` | Folder used when `favorites` is empty. |
| `favorites` | `{name, path}[]` — the folders new sessions can start in. |
| `token` | Access token for browsers (≥ 32 chars). |
| `hookSecret` | Secret for the local hook endpoint (≥ 32 chars). |
| `dataDir` | Event log and saved sessions (default `./data`, relative to the config file). |
| `scrollback` | Lines kept per session and sent on reconnect (default 5000). |
| `snippets` | Compose-mode one-tap messages (default `["/clear", "/compact", "continue"]`). |
| `restoreSessions` | Recreate the last run's sessions on start (default `true`). |

A config elsewhere: set `CCC_CONFIG=<path>`.

## Run

```powershell
npm run dev     # dev: server + Vite (http://127.0.0.1:5173)
npm run build   # production bundle
npm start       # production server in this terminal (http://127.0.0.1:7420)
```

For everyday use, install it as a service instead (next section).

## Run as a service (starts with Windows)

A Task Scheduler task runs `scripts/run-server.ps1`, a small supervisor that starts the production server in a hidden window, logs to `logs/server.log` and restarts the server if it exits (after 2 s, backing off to 60 s while it keeps failing at boot). No extra tools; no admin rights for the default mode.

```powershell
npm run build
npm run service -- install       # start at your logon
npm run service -- status        # task, processes, health, last log lines
npm run service -- logs          # follow the log (Ctrl+C to leave)
npm run service -- restart       # after every `npm run build`
npm run service -- stop | start
npm run service -- uninstall
```

- **At logon** (default): runs in your desktop session as you, the same as a terminal would. For it to start "with the PC" unattended, enable automatic sign-in in Windows.
- **At PC startup**, before anyone signs in: from an **admin** PowerShell, `npm run service -- install -AtStartup`. It asks for your Windows password once (kept by Task Scheduler), so Git credentials and the like keep working inside sessions.

Stop any `npm start` / `npm run dev` on the same port first; `install` warns if a server already answers. The log rotates at 5 MB (`server.log.1`).

## Sessions survive restarts

The open sessions (id, name, folder, Claude conversation id) are kept in `data/sessions.json`. When the server starts again (reboot, crash, `service restart`, dev reload) each one is recreated in its folder and resumes its conversation:

- `claude --resume <session_id>` once a hook has reported the conversation (any prompt is enough), so two sessions in the same folder each get their own conversation back;
- `claude --continue` (latest conversation in the folder) otherwise.

A restored session keeps its id, so stats stay continuous. ✕ removes a session for good. A folder that no longer exists is skipped (logged). `"restoreSessions": false` turns this off. The old screen contents are not kept: Claude redraws the conversation it resumes.

## Phone access with Tailscale

The server never listens on `0.0.0.0` or the LAN. Two options:

### A. `tailscale serve` (recommended: HTTPS, valid certificate, installable app)

1. Install Tailscale on the PC and on the phone, signed in to the same account.
2. In the [admin console → DNS](https://login.tailscale.com/admin/dns), enable **MagicDNS** and **HTTPS Certificates**.
3. Keep `"host": "127.0.0.1"` in `config.json`, then on the PC, once (`--bg` persists across reboots):
   ```powershell
   tailscale serve --bg 7420
   tailscale serve status        # shows the https://<pc>.<tailnet>.ts.net URL
   ```
4. On the phone (Tailscale on), open `https://<pc>.<tailnet>.ts.net`.

`tailscale serve` is reachable only inside your tailnet. `tailscale funnel` would publish it to the internet and must **not** be used. To stop: `tailscale serve reset`.

Dev mode from the phone: `tailscale serve --bg 5173` while `npm run dev` runs (Vite accepts `*.ts.net`). Back to production: `tailscale serve --bg 7420`.

### B. Bind directly to the Tailscale IP

Set `"host": "tailscale"` (or the IP from `tailscale ip -4`) and open `http://100.x.y.z:7420` on the phone. Traffic is still encrypted by WireGuard, but the page is plain HTTP: no app install, no offline start, no `Secure` cookie.

## Sign-in

The first visit asks for the `token` from `config.json`. It is exchanged for an `HttpOnly`, `SameSite=Strict` cookie valid for a year (`Secure` over HTTPS). Shortcut: open `https://…/?token=<token>` once; the token is removed from the address bar right away.

Changing `token` in `config.json` signs every device out. Failed attempts are rate-limited.

## Install on the phone (PWA)

With option A, in Chrome on Android: open the site, sign in, then **⋮ → Add to Home screen → Install**. The app opens full screen (no address or status bar) with its own icon and entry in the app switcher. It shares Chrome's cookies, so it stays signed in.

The service worker caches only the app itself: pages network first, hashed `/assets` cache first, old builds pruned. API calls and the WebSocket always go to the server. With the PC off the app still opens, shows *offline* and reconnects by itself when the server is back. After a new build, the next launch picks it up.

Icons are generated (no image files to edit): `npm run icons` → `web/public/icons/`.

## Security model

- Listens only on loopback or the Tailscale interface; config validation refuses anything else.
- Every HTTP request and WebSocket upgrade must carry a known `Host` (DNS rebinding).
- WebSocket upgrades require a trusted `Origin` and the auth cookie.
- `/api/*` (except `auth` and `health`) requires the auth cookie.
- The hook endpoint has its own loopback-only port (never forwarded) and its own secret.
- Resume ids are checked to be UUIDs before they are typed into a shell.
- `config.json`, `data/` and `logs/` are never committed.

## Sessions

The dashboard lists every session (name, folder, state, last lines of the screen). **+ New** starts a shell in one of the favorite folders and runs `startupCommand`. Tap a card to open its terminal; `‹` (or Android back) returns. ✎ renames; ✕ twice kills.

Sessions live in the server process: closing the tab or losing signal does not affect them. Each PTY gets `CCC_SESSION_ID` in its environment.

## Phone input

Bottom of the terminal, always above the on-screen keyboard:

- **Key bar:** `esc` `tab` `⇧tab` (Claude mode) `^C` arrows (hold to repeat) `1` `2` `3` `y` `n` `⏎`. Approving a permission = `1`/`2`/`3` or arrows + `⏎`.
- **✎** toggles **Compose**: a multi-line box (keyboard voice dictation works) and `➤` sends it as a paste followed by Enter. Empty box + `➤` = Enter. `Ctrl+Enter` sends on desktop. Drafts are kept per session. Chips above the box are the `snippets` and send in one tap.
- **⌨** shows/hides the keyboard. In Terminal mode a tap on the screen also opens it; dragging only scrolls.
- **A− / A+** in the header change the font size (remembered per device). The server resizes the PTY to match.

## Claude Code hooks (session states)

Cards show what Claude is doing: `idle`, `working`, `permission` (waiting for you), `done`, `error`, plus the current tool / last message. This comes from Claude Code hooks:

1. `npm run build` (builds `hooks/dist/cc-hook.mjs`).
2. `npm run hooks:settings` prints the `hooks` block for `~/.claude/settings.json`. Merge it by hand (append to existing event arrays). `npm run hooks:settings -- --merge <settings.json>` prints a merged copy without touching the file.

The hook is registered `async` (never blocks Claude) and is a no-op unless `CCC_SESSION_ID` is set, i.e. outside cc-cockpit PTYs it exits immediately and prints nothing. Inside a PTY it POSTs the event to `http://127.0.0.1:<hookPort>/hook` (default `port + 1`) with `hookSecret`. That port listens on loopback only and is not forwarded by `tailscale serve`.

State rules: prompt → `working`; `PermissionRequest` / permission notification → `permission`; answering it from the cockpit (`1`-`9`, `y`, `n`, `Enter`, `Esc`) → `working`; `Stop` → `done`; `StopFailure` → `error`. Esc / Ctrl+C has no hook: if Claude's spinner line disappears right after, the session goes `idle`.

Every event is appended to `data/events.db` (SQLite, `node:sqlite`); statistics are derived from it.

## Themes, effects and sound

Header `⚙` (sliders icon) opens **Look & sound**; `◆ <theme>` on the dashboard switches theme in one tap. Choices are stored per device.

| theme | look | background | celebration | sounds |
|---|---|---|---|---|
| Neon | cyberpunk, cyan/magenta | synthwave sun + scrolling grid | sparks | futuristic synth |
| CRT | green phosphor, VT323, scanlines | rolling band + oscilloscope trace | phosphor bloom | ambient / analog |
| Pixel | RPG night, Press Start 2P | pixel sky, stars, parallax hills | pixel fountain + coins | 8-bit |

Themes are data (`web/src/themes/*.ts`): CSS variables, fonts, xterm colors, backdrop, burst style, sound pack.

Effects follow hook activity: prompt → pulse ring; tool call → spark on the card / sweep across the terminal (color by tool family, pitch by tool family); permission → card blinks, nudge, vibration; done → themed burst + vibration; error → glitch. The background speeds up while something works and turns to the warning color while a permission waits. Events of other sessions while you are in a terminal show as a toast.

Sounds are synthesized with WebAudio (no files) and unlock on the first tap. Mute: speaker icon in the header.

Performance: quality Low / Med / High caps frame rate (15/30/60 fps) and resolution; **Reduce** stops the animated background, particles and glitches (colors and sounds stay). The background sleeps while a terminal is open or the tab is hidden; particles only run while visible. Phones default to Med; `prefers-reduced-motion` defaults to Reduce. **Try** buttons preview each effect.

## Troubleshooting

| symptom | check |
|---|---|
| Phone can't open the URL | Tailscale on in the phone? `tailscale serve status` on the PC lists port 7420? `npm run service -- status` says *health ok*? |
| `421 Misdirected request` | Opened through a name the server doesn't know: add it to `allowedHosts`. |
| Keeps asking for the token | `token` changed (signs every device out) or cookies were cleared. Sign in again. |
| No *Install* option in Chrome | Needs HTTPS (option A), not `http://100.x`. Reload once after the first visit so the service worker is active. |
| App shows an old version | Close it in the app switcher and open again. Last resort: Chrome → Site settings → the site → Clear & reset. |
| Keyboard hides the key bar in the installed app | Set `"display": "standalone"` in `web/public/manifest.webmanifest`, rebuild, reinstall the app. |
| Cards never leave `idle` | Hooks missing or outdated: `npm run build`, then compare `npm run hooks:settings` with `~/.claude/settings.json`. |
| Service doesn't start | `npm run service -- status` and `logs/server.log`: config errors and crashes are logged there. `EADDRINUSE` = another server on the port; `missing server\dist` = run `npm run build`. |
| Restored session shows a plain shell | `claude --resume` found no conversation (e.g. it never got a prompt): type `claude`. |
| `npm install` fails on `node-pty` | Swap it for `@lydell/node-pty` (prebuilt) before installing Visual Studio Build Tools. |
| No sound | Audio unlocks on the first tap; check the speaker icon and the phone's media volume. |

## Files

```
config.json             your settings (not committed)
data/events.db          event log (SQLite): every hook and state change
data/sessions.json      sessions to restore on the next start
logs/server.log         service log (+ server.log.1)
scripts/service.ps1     install / control the scheduled task
scripts/run-server.ps1  supervisor started by the task
scripts/gen-icons.mjs   renders the PWA icons
```
