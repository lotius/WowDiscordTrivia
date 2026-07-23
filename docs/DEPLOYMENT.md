# Deployment and external dependencies

Goal: run the same app from a PC or a rented box, with as little dependence on
third-party services as the platform allows.

## What cannot be removed

A Discord Activity is loaded by Discord, in Discord's iframe, through Discord's
proxy. That imposes an irreducible floor:

| Dependency | Why it is unavoidable |
| --- | --- |
| Discord | It hosts the activity and issues the OAuth tokens |
| A public HTTPS URL | Discord's proxy has to reach your server from the internet |
| A DNS name | HTTPS certificates are issued against names, not IP addresses |
| A certificate authority | Browsers reject self-signed certs, and the iframe is a browser |

Everything beyond those four is a choice, and all of them have been removed.

## What was removed

- **Google Fonts.** `styles.css` used to `@import` from `fonts.googleapis.com`.
  Discord's iframe blocks unproxied external requests, so that stylesheet never
  loaded inside the activity and the game silently fell back to system fonts.
  The fonts now ship in the bundle via `@fontsource`, which fixes the rendering
  and removes the dependency at once.
- **Broken avatars.** Discord CDN avatars are the one external request left at
  runtime. They now degrade to the player's initial instead of a broken image
  if the request is blocked or fails.
- **A specific machine's toolchain.** A `Dockerfile` and `docker-compose.yml`
  build and run the app identically anywhere Docker runs.

Verify the client makes no external requests after a build:

```bash
npm run build
grep -r "fonts.googleapis\|fonts.gstatic\|cdn\." dist/assets/ || echo "clean"
```

## Choosing how to expose it

Ranked by how little you have to rely on someone else.

### 1. Your own server, your own domain — most independent

A VPS, or your own PC with a port forwarded. You control the whole path.

- Point a domain's A record at the machine.
- Terminate TLS with Caddy or nginx plus Let's Encrypt, proxying to `:3001`.
- Set the Discord URL mapping to that hostname once. It never changes.

External reliance: a registrar and a certificate authority. Nothing else sits
between Discord and your process.

On a home connection you also need either a static IP or dynamic DNS, and a
router that will forward 80 and 443.

### 2. A host that gives you HTTPS — simplest permanent option

Fly.io, Railway, Render, or any VPS with a managed proxy. They provide the
hostname and certificate.

**Attach a persistent volume.** `data/trivia.db` and `uploads/` must survive
redeploys. Several platforms reset the filesystem on each deploy, which would
delete the entire question library without an error. `docker-compose.yml`
already declares the two volumes; make sure the equivalent exists wherever you
deploy.

### 3. A tunnel — most convenient, least independent

`cloudflared` or `ngrok` relaying to your PC. A third party sits in the path and
can change or drop your hostname.

Quick tunnels change hostname on **every restart**, which means re-pasting the
Discord URL mapping each time, and until you do the activity shows a blank white
screen that looks exactly like a broken app. Prefer a reserved hostname:

- `NGROK_DOMAIN=your-name.ngrok-free.app` — free tier includes one
- `TUNNEL_NAME` + `TUNNEL_HOSTNAME` — cloudflared named tunnel, needs a domain

`npm run tunnel` picks the mode from `.env`. `npm run tunnel:url` reports the
hostname of a running quick tunnel.

## Running it consistently on one machine

```bash
npm run serve
```

One supervised process that builds, then runs the server and the tunnel
together. It restarts either if it crashes, with backoff so a process that
cannot start does not spin. It health-checks the server rather than assuming a
running process is a working one, and it watches the public hostname, printing a
banner when it changes — the failure that otherwise shows up as a blank white
screen in Discord with no explanation.

The current hostname is also written to `.tunnel-url.txt`.

This does not survive a reboot on its own. To start it automatically, create a
shortcut to `npm run serve` in the Windows startup folder (`shell:startup`), or
register it as a scheduled task set to run at logon.

## Running with Docker

```bash
docker compose up -d --build
```

Reads `.env` for configuration. The question library and uploads live in named
volumes, so rebuilding the image does not touch them.

To move the whole game to another machine, copy `data/trivia.db`, the `uploads/`
directory, and `.env`. That is the entire state.

> Not yet verified: Docker is not installed on the development machine, so the
> image has not been built. The Node build it wraps is the same one used
> locally, but expect to iterate on the Dockerfile the first time it runs.

## Backups

`data/trivia.db` holds 500+ hand-written questions and currently exists in one
place. SQLite can back up safely while the server is running:

```bash
sqlite3 data/trivia.db ".backup 'backup-$(date +%F).db'"
```

Copying the file with `cp` while the server is writing can produce a corrupt
snapshot; `.backup` cannot.

## Configuration

Everything is environment variables, so no code changes are needed per
environment. See `.env.example`. The ones that matter in production:

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port, default 3001 |
| `VITE_DISCORD_CLIENT_ID` | Baked into the client at **build** time — rebuild after changing |
| `DISCORD_CLIENT_SECRET` | Server-side token exchange |
| `ADMIN_TOKEN` | Gates the question library, which exposes answers |
| `CLIENT_ORIGIN` | Extra allowed browser origins; `*.discordsays.com` is always allowed |
| `VITE_SERVER_URL` | Leave empty. A value breaks the Discord iframe |
