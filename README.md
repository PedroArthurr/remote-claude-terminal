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
