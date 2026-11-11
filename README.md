# cc-cockpit

Personal web panel to drive Claude Code sessions running on a Windows PC from an Android phone, over Tailscale.

## Setup

```powershell
npm install
copy config.example.json config.json   # then edit it
```

Generate the two secrets (`token`, `hookSecret`) with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`config.json` keys:

| key | meaning |
|---|---|
| `host` | `127.0.0.1` (recommended, behind `tailscale serve`), a Tailscale IP (`100.x.y.z`) or `"tailscale"` to auto-detect it. Anything else is refused. |
| `allowedHosts` | Extra `Host` names to accept. Loopback and `*.ts.net` are built in. |
| `port` | Server port (default 7420). |
| `favorites` | `{name, path}[]` — the folders new sessions can start in. |
| `startupCommand` | Typed into each new shell (default `claude`). |
| `token` | Access token for browsers (≥ 32 chars). |
| `hookSecret` | Secret for the local hook endpoint (≥ 32 chars). |
| `snippets` | Compose-mode one-tap messages (default `["/clear", "/compact", "continue"]`). |

## Run

```powershell
npm run dev     # dev: server + Vite (http://127.0.0.1:5173)
npm run build   # production bundle
npm start       # production server (http://127.0.0.1:7420)
```

## Phone access with Tailscale

The server never listens on `0.0.0.0` or the LAN. Two options:

### A. `tailscale serve` (recommended: HTTPS, valid certificate)

1. Install Tailscale on the PC and on the phone, signed in to the same account.
2. In the [admin console → DNS](https://login.tailscale.com/admin/dns), enable **MagicDNS** and **HTTPS Certificates**.
3. Keep `"host": "127.0.0.1"` in `config.json`, then on the PC:
   ```powershell
   npm run build; npm start
   tailscale serve --bg 7420
   tailscale serve status        # shows the https://<pc>.<tailnet>.ts.net URL
   ```
4. On the phone (Tailscale on), open `https://<pc>.<tailnet>.ts.net`.

`tailscale serve` is reachable only inside your tailnet (that is `tailscale funnel`, which must **not** be used). To stop: `tailscale serve reset`.

Dev mode from the phone: `tailscale serve --bg 5173` while `npm run dev` runs (Vite accepts `*.ts.net`).

### B. Bind directly to the Tailscale IP

Set `"host": "tailscale"` (or the IP from `tailscale ip -4`) and open `http://100.x.y.z:7420` on the phone. Traffic is still encrypted by WireGuard, but the page is plain HTTP (no PWA install later, no `Secure` cookie).

## Sign-in

The first visit asks for the `token` from `config.json`. It is exchanged for an `HttpOnly`, `SameSite=Strict` cookie valid for a year (`Secure` over HTTPS). Shortcut: open `https://…/?token=<token>` once; the token is removed from the address bar right away.

Changing `token` in `config.json` signs every device out. Failed attempts are rate-limited.

## Security model

- Listens only on loopback or the Tailscale interface; config validation refuses anything else.
- Every HTTP request and WebSocket upgrade must carry a known `Host` (DNS rebinding).
- WebSocket upgrades require a trusted `Origin` and the auth cookie.
- `/api/*` (except `auth` and `health`) requires the auth cookie.
- `config.json` and the token are never committed.

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

Every event is appended to `data/events.db` (SQLite, `node:sqlite`); the stats screen derives everything from it.
